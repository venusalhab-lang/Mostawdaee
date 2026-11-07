import type { Invoice, Product, VaultTransaction } from '../types';
import { isAdhocLine } from './adhocLine';
import { userCacheKey } from './userStorage';
import { lineUnits } from './packs';
import { computeStockStatus, roundQty } from './stock';
import { applyVaultDelta, planInvoiceVaultEntry } from './vaultMath';

export const OFFLINE_QUEUE_EVENT = 'mostawdaee-offline-queue';

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

/** Only immediate cash-type sales may wait for the network: purchases need a vault check and
 *  credit sales also write a customer debt, so both must be saved online in one transaction. */
export function canQueueOffline(invoice: Pick<Invoice, 'type' | 'paymentMethod'>): boolean {
  return invoice.type === 'sale' && invoice.paymentMethod !== 'credit';
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

function normalize(entry: unknown): QueuedInvoice | null {
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

function notifyQueueChanged(uid: string) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT, { detail: { uid } }));
  } catch { /* EventTarget unavailable */ }
}

export function readQueue(uid: string): QueuedInvoice[] {
  if (typeof localStorage === 'undefined' || !uid) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(userCacheKey(uid, QUEUE_KEY)) || '[]');
    return Array.isArray(raw) ? raw.map(normalize).filter((x): x is QueuedInvoice => !!x) : [];
  } catch {
    return [];
  }
}

/** Written synchronously: a sale that was taken must survive a crash or a full storage. */
export function writeQueue(uid: string, queue: QueuedInvoice[]): boolean {
  if (typeof localStorage === 'undefined' || !uid) return false;
  try {
    if (queue.length === 0) localStorage.removeItem(userCacheKey(uid, QUEUE_KEY));
    else localStorage.setItem(userCacheKey(uid, QUEUE_KEY), JSON.stringify(queue));
    notifyQueueChanged(uid);
    return true;
  } catch {
    return false;
  }
}

export function enqueueInvoice(uid: string, invoice: Invoice, storeId?: string, now = Date.now()): boolean {
  const queue = readQueue(uid);
  if (queue.some((q) => q.invoice.id === invoice.id)) return true;
  return writeQueue(uid, [...queue, { invoice, queuedAt: now, attempts: 0, ...(storeId ? { storeId } : {}) }]);
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
