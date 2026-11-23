import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Invoice, Product, VaultTransaction } from '../types';
import { isAdhocLine } from './adhocLine';
import { userCacheKey } from './userStorage';
import { lineUnits } from './packs';
import { computeStockStatus, roundQty } from './stock';
import { applyVaultDelta, planInvoiceVaultEntry } from './vaultMath';

export const OFFLINE_QUEUE_EVENT = 'mostawdaee-offline-queue';
/** Fired when localStorage cannot keep a queued sale (quota / private mode). */
export const OFFLINE_QUEUE_STORAGE_FULL_EVENT = 'mostawdaee-offline-queue-storage-full';

/** True only for a missing connection. Conflicts, permissions and validation errors are not "offline". */
export function isOfflineError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string; name?: string } | null;
  if (!e) return false;
  if (e.code === 'offline') return true;
  // Never treat a structured business/auth rejection as offline — even if the browser reports no network.
  const code = String(e.code || '');
  if (
    code &&
    /insufficient|permission|denied|not-found|aborted|invalid|conflict|vault|stock|customer|supplier|collection|role|quota|payroll|shift|backup/i.test(code)
  ) {
    return false;
  }
  const text = `${e.name || ''} ${e.message || ''} ${e.details || ''}`;
  return /Failed to fetch|NetworkError|Load failed|Network request failed|fetch failed|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|AuthRetryableFetchError|timed out|TimeoutError/i.test(text);
}

/**
 * Cash-type sales may wait on the device when the cloud cannot be reached, including an expired
 * session that still has a stored login (refresh needs the network).
 */
export function canDeferSaleToQueue(error: unknown): boolean {
  if (isOfflineError(error)) return true;
  return (error as { code?: string } | null)?.code === 'unauthenticated';
}

/**
 * Only cash sales may wait for the network.
 * Purchases need a vault check; credit writes customer debt; card/wallet have no offline capture proof.
 */
export function canQueueOffline(invoice: Pick<Invoice, 'type' | 'paymentMethod'>): boolean {
  const method = invoice.paymentMethod || 'cash';
  return invoice.type === 'sale' && method === 'cash';
}

export interface QueuedInvoice {
  invoice: Invoice;
  queuedAt: number;
  attempts: number;
  lastError?: string;
  /** Owner of the store the sale was taken in; absent on sales queued before this was recorded. */
  storeId?: string;
}

/** A sale is only ever sent to the store it was taken in (a cashier may be removed while offline). */
export function belongsToStore(entry: Pick<QueuedInvoice, 'storeId'>, ownerId: string): boolean {
  return !!entry.storeId && entry.storeId === ownerId;
}

const QUEUE_KEY = 'offline_invoices';
const DURABLE_DIR = 'offline-queue';

function durablePath(uid: string): string {
  return `${DURABLE_DIR}/${uid}.json`;
}

export function normalizeQueuedEntry(entry: unknown): QueuedInvoice | null {
  const e = entry as Partial<QueuedInvoice> & Partial<Invoice>;
  if (!e || typeof e !== 'object') return null;
  if (e.invoice && typeof e.invoice === 'object' && (e.invoice as Invoice).id) {
    return {
      invoice: e.invoice as Invoice, queuedAt: Number(e.queuedAt) || 0, attempts: Number(e.attempts) || 0, lastError: e.lastError,
      ...(typeof e.storeId === 'string' && e.storeId ? { storeId: e.storeId } : {}),
    };
  }
  if (e.id && Array.isArray(e.items)) {
    return { invoice: e as Invoice, queuedAt: Number(e.date) || 0, attempts: 0 };
  }
  return null;
}

/** Prefer the entry that has progressed further (attempts) or was queued later. */
export function preferQueuedEntry(a: QueuedInvoice, b: QueuedInvoice): QueuedInvoice {
  if (a.attempts !== b.attempts) return a.attempts >= b.attempts ? a : b;
  return a.queuedAt >= b.queuedAt ? a : b;
}

/** Union by invoice id — used when hydrating localStorage from the durable native mirror. */
export function mergeQueueEntries(local: QueuedInvoice[], durable: QueuedInvoice[]): QueuedInvoice[] {
  const byId = new Map<string, QueuedInvoice>();
  for (const entry of local) {
    if (!entry?.invoice?.id) continue;
    byId.set(entry.invoice.id, entry);
  }
  for (const entry of durable) {
    if (!entry?.invoice?.id) continue;
    const prev = byId.get(entry.invoice.id);
    byId.set(entry.invoice.id, prev ? preferQueuedEntry(prev, entry) : entry);
  }
  return Array.from(byId.values()).sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
}

export function parseQueuePayload(raw: unknown): QueuedInvoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeQueuedEntry).filter((x): x is QueuedInvoice => !!x);
}

function queuesEqual(a: QueuedInvoice[], b: QueuedInvoice[]): boolean {
  if (a.length !== b.length) return false;
  const ids = (rows: QueuedInvoice[]) => rows.map((r) => `${r.invoice.id}:${r.attempts}:${r.queuedAt}`).sort().join('|');
  return ids(a) === ids(b);
}

/** Test seam / native mirror. Web leaves this null — localStorage only. */
export interface DurableQueueBackend {
  read(uid: string): Promise<QueuedInvoice[] | null>;
  write(uid: string, queue: QueuedInvoice[]): Promise<void>;
}

let durableBackendOverride: DurableQueueBackend | null | undefined;

/** Inject a backend in tests; pass `null` to force no durable mirror. */
export function setDurableQueueBackend(backend: DurableQueueBackend | null | undefined): void {
  durableBackendOverride = backend;
}

function filesystemDurableBackend(): DurableQueueBackend | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!Capacitor.isNativePlatform()) return null;
  } catch {
    return null;
  }
  return {
    async read(uid: string) {
      try {
        const file = await Filesystem.readFile({
          path: durablePath(uid),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        const text = typeof file.data === 'string' ? file.data : '';
        if (!text) return [];
        return parseQueuePayload(JSON.parse(text));
      } catch {
        return null;
      }
    },
    async write(uid: string, queue: QueuedInvoice[]) {
      try {
        await Filesystem.mkdir({ path: DURABLE_DIR, directory: Directory.Data, recursive: true });
      } catch { /* exists */ }
      if (queue.length === 0) {
        try {
          await Filesystem.deleteFile({ path: durablePath(uid), directory: Directory.Data });
        } catch { /* missing */ }
        return;
      }
      await Filesystem.writeFile({
        path: durablePath(uid),
        data: JSON.stringify(queue),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
    },
  };
}

function activeDurableBackend(): DurableQueueBackend | null {
  if (durableBackendOverride !== undefined) return durableBackendOverride;
  return filesystemDurableBackend();
}

function notifyQueueChanged(uid: string) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT, { detail: { uid } }));
  } catch { /* EventTarget unavailable */ }
}

function notifyStorageFull(uid: string) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_STORAGE_FULL_EVENT, { detail: { uid } }));
  } catch { /* EventTarget unavailable */ }
}

function mirrorQueueAsync(uid: string, queue: QueuedInvoice[]): void {
  const backend = activeDurableBackend();
  if (!backend || !uid) return;
  void backend.write(uid, queue).catch(() => undefined);
}

export function readQueue(uid: string): QueuedInvoice[] {
  if (typeof localStorage === 'undefined' || !uid) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(userCacheKey(uid, QUEUE_KEY)) || '[]');
    return parseQueuePayload(raw);
  } catch {
    return [];
  }
}

/**
 * Written synchronously to localStorage first (sale must not wait on disk I/O).
 * On Android, also mirrors to app Data so a wiped WebView storage can recover pending cash sales.
 */
export function writeQueue(uid: string, queue: QueuedInvoice[]): boolean {
  if (typeof localStorage === 'undefined' || !uid) return false;
  try {
    if (queue.length === 0) localStorage.removeItem(userCacheKey(uid, QUEUE_KEY));
    else localStorage.setItem(userCacheKey(uid, QUEUE_KEY), JSON.stringify(queue));
    notifyQueueChanged(uid);
    mirrorQueueAsync(uid, queue);
    return true;
  } catch {
    notifyStorageFull(uid);
    return false;
  }
}

export function enqueueInvoice(uid: string, invoice: Invoice, storeId?: string, now = Date.now()): boolean {
  const queue = readQueue(uid);
  if (queue.some((q) => q.invoice.id === invoice.id)) return true;
  return writeQueue(uid, [...queue, { invoice, queuedAt: now, attempts: 0, ...(storeId ? { storeId } : {}) }]);
}

/**
 * On native: merge durable mirror into localStorage when local is empty or missing sales.
 * Safe to call on every login; no-op on web without an injected backend.
 */
export async function hydrateDurableQueue(uid: string): Promise<QueuedInvoice[]> {
  if (!uid) return [];
  const local = readQueue(uid);
  const backend = activeDurableBackend();
  if (!backend) return local;
  let durable: QueuedInvoice[] | null = null;
  try {
    durable = await backend.read(uid);
  } catch {
    return local;
  }
  if (!durable || durable.length === 0) {
    if (local.length > 0) mirrorQueueAsync(uid, local);
    return local;
  }
  const merged = mergeQueueEntries(local, durable);
  if (!queuesEqual(merged, local)) {
    if (!writeQueue(uid, merged)) {
      // localStorage full — keep returning what we could read so UI still shows risk.
      return local.length > 0 ? local : durable;
    }
  } else if (local.length > 0) {
    mirrorQueueAsync(uid, local);
  }
  return merged;
}

/** Sales still waiting for this store (or every entry when the owner is not known yet). */
export function queueForStore(
  queue: QueuedInvoice[],
  ownerId?: string | null,
  /** Invoice ids already on the server — never re-apply their stock/vault locally. */
  excludeIds?: Iterable<string> | null,
): QueuedInvoice[] {
  const skip = excludeIds ? new Set(excludeIds) : null;
  return queue.filter((entry) => {
    if (skip?.has(entry.invoice.id)) return false;
    if (!ownerId) return true;
    return belongsToStore(entry, ownerId);
  });
}

/** Keeps server invoices and any queued sale that has not reached the server yet. */
export function mergeQueuedInvoices(
  server: Invoice[],
  queue: QueuedInvoice[],
  ownerId?: string | null,
): Invoice[] {
  const byId = new Map(server.map((invoice) => [invoice.id, invoice]));
  for (const entry of queueForStore(queue, ownerId, byId.keys())) {
    byId.set(entry.invoice.id, entry.invoice);
  }
  return Array.from(byId.values()).sort((a, b) => b.date - a.date);
}

/** Re-applies stock deductions from sales still in the queue on top of a server/cache snapshot. */
export function applyQueuedSalesToProducts(
  products: Product[],
  queue: QueuedInvoice[],
  ownerId?: string | null,
  excludeIds?: Iterable<string> | null,
): Product[] {
  const pending = queueForStore(queue, ownerId, excludeIds);
  if (pending.length === 0) return products;
  return products.map((product) => {
    let sold = 0;
    for (const entry of pending) {
      for (const item of entry.invoice.items) {
        if (isAdhocLine(item)) continue;
        if (item.productId === product.id) sold += lineUnits(item);
      }
    }
    if (!sold) return product;
    const quantity = roundQty((Number(product.quantity) || 0) - sold);
    return { ...product, quantity, status: computeStockStatus(quantity, product.lowStockThreshold) };
  });
}

/** Re-applies cash-vault movements from sales still in the queue on top of a server vault snapshot. */
export function applyQueuedSalesToVault(
  vault: unknown,
  queue: QueuedInvoice[],
  ownerId?: string | null,
  excludeIds?: Iterable<string> | null,
): unknown {
  let doc = vault;
  for (const entry of queueForStore(queue, ownerId, excludeIds)) {
    const plan = planInvoiceVaultEntry(entry.invoice);
    if (!plan) continue;
    doc = applyVaultDelta(doc, plan.currency, plan.type === 'income' ? plan.amount : -plan.amount).doc;
  }
  return doc;
}

/** Keeps server vault rows and local cash rows for sales still waiting to sync. */
export function mergeQueuedVaultRecords(
  server: VaultTransaction[],
  queue: QueuedInvoice[],
  ownerId?: string | null,
  /** Optional live vault: when set, each queued row gets a real running balanceAfter. */
  vaultSnapshot?: unknown,
  excludeIds?: Iterable<string> | null,
): VaultTransaction[] {
  const byId = new Map(server.map((row) => [row.id, row]));
  const pending = queueForStore(queue, ownerId, excludeIds)
    .map((entry) => {
      const plan = planInvoiceVaultEntry(entry.invoice);
      if (!plan) return null;
      return {
        entry,
        plan,
        id: `inv-${entry.invoice.id}`,
        timestamp: entry.queuedAt || entry.invoice.date || Date.now(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row)
    .sort((a, b) => a.timestamp - b.timestamp);

  let running = vaultSnapshot;
  for (const row of pending) {
    if (byId.has(row.id)) continue;
    let balanceAfter = 0;
    if (running !== undefined) {
      const applied = applyVaultDelta(
        running,
        row.plan.currency,
        row.plan.type === 'income' ? row.plan.amount : -row.plan.amount,
      );
      running = applied.doc;
      balanceAfter = applied.balanceAfter;
    }
    byId.set(row.id, {
      ...row.plan,
      id: row.id,
      timestamp: row.timestamp,
      balanceAfter,
    });
  }
  return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Serializes queue reads/writes across tabs so two cashiers on one account cannot drop a sale.
 * Both enqueue and sync must pass `{ required: true }` — fail closed rather than risk a lost sale.
 */
export async function withQueueLock<T>(
  uid: string,
  work: () => Promise<T> | T,
  opts?: { required?: boolean },
): Promise<T> {
  if (!uid) return work();
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks?.request) {
    return locks.request(`mostawdaee-offline-queue:${uid}`, () => work());
  }
  if (typeof localStorage === 'undefined') {
    if (opts?.required) throw Object.assign(new Error('Offline queue lock unavailable'), { code: 'queue-locked' });
    return work();
  }
  const key = userCacheKey(uid, 'queue_lock');
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const staleMs = 30_000;
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    let held: { token: string; at: number } | null = null;
    try {
      const raw = localStorage.getItem(key);
      held = raw ? JSON.parse(raw) as { token: string; at: number } : null;
    } catch { held = null; }
    if (!held || Date.now() - Number(held.at) > staleMs) {
      try {
        localStorage.setItem(key, JSON.stringify({ token, at: Date.now() }));
        const check = JSON.parse(localStorage.getItem(key) || 'null') as { token?: string } | null;
        if (check?.token === token) {
          try {
            return await work();
          } finally {
            try {
              const cur = JSON.parse(localStorage.getItem(key) || 'null') as { token?: string } | null;
              if (cur?.token === token) localStorage.removeItem(key);
            } catch { /* ignore */ }
          }
        }
      } catch {
        if (opts?.required) throw Object.assign(new Error('Offline queue lock unavailable'), { code: 'queue-locked' });
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (opts?.required) throw Object.assign(new Error('Offline queue is busy'), { code: 'queue-locked' });
  return work();
}

export interface StockShortage {
  productId: string;
  name: string;
  available: number;
  requested: number;
}

/** Stock check against the last known local stock, one check per product. */
export function localSaleShortages(invoice: Invoice, products: Product[]): StockShortage[] {
  const requested = new Map<string, { qty: number; name: string }>();
  for (const item of invoice.items) {
    // Free/service lines never touch inventory — same gate as quantitiesByProduct / online commit.
    if (isAdhocLine(item) || !item.productId) continue;
    const entry = requested.get(item.productId) || { qty: 0, name: item.description };
    entry.qty += lineUnits(item);
    requested.set(item.productId, entry);
  }
  const shortages: StockShortage[] = [];
  for (const [productId, { qty, name }] of requested) {
    const product = products.find((p) => p.id === productId);
    const available = product ? Number(product.quantity) || 0 : 0;
    if (!product || available < qty) shortages.push({ productId, name: product?.name || name, available, requested: qty });
  }
  return shortages;
}
