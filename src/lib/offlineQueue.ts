import type { Invoice, Product } from '../types';
import { userCacheKey } from './userStorage';

/** True only for a missing connection. Conflicts, permissions and validation errors are not "offline". */
export function isOfflineError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string; name?: string } | null;
  if (!e) return false;
  if (e.code === 'offline') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const text = `${e.name || ''} ${e.message || ''} ${e.details || ''}`;
  return /Failed to fetch|NetworkError|Load failed|Network request failed|fetch failed|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|AuthRetryableFetchError/i.test(text);
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
}

const QUEUE_KEY = 'offline_invoices';

function normalize(entry: unknown): QueuedInvoice | null {
  const e = entry as Partial<QueuedInvoice> & Partial<Invoice>;
  if (!e || typeof e !== 'object') return null;
  if (e.invoice && typeof e.invoice === 'object' && (e.invoice as Invoice).id) {
    return { invoice: e.invoice as Invoice, queuedAt: Number(e.queuedAt) || 0, attempts: Number(e.attempts) || 0, lastError: e.lastError };
  }
  if (e.id && Array.isArray(e.items)) {
    return { invoice: e as Invoice, queuedAt: Number(e.date) || 0, attempts: 0 };
  }
  return null;
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
    return true;
  } catch {
    return false;
  }
}

export function enqueueInvoice(uid: string, invoice: Invoice, now = Date.now()): boolean {
  const queue = readQueue(uid);
  if (queue.some((q) => q.invoice.id === invoice.id)) return true;
  return writeQueue(uid, [...queue, { invoice, queuedAt: now, attempts: 0 }]);
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
    const entry = requested.get(item.productId) || { qty: 0, name: item.description };
    entry.qty += Number(item.quantity) || 0;
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
