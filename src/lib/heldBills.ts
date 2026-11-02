import type { InvoiceItem } from '../types';
import { lineUnits } from './packs';
import { dropPendingUserCache, userCacheKey } from './userStorage';

export type HeldBillStatus = 'parked' | 'open';

export interface HeldBill {
  id: string;
  invoiceNumber: string;
  items: InvoiceItem[];
  discount: number;
  date: number;
  time: string;
  itemCount: number;
  totalAmount: number;
  currency: string;
  mode: 'sale';
  /** parked = waiting; open = currently loaded in the cart (kept on disk until checkout). */
  status?: HeldBillStatus;
}

const KEY = 'held_bills';

export function normalizeHeldBill(raw: unknown): HeldBill | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<HeldBill>;
  if (!b.id || !Array.isArray(b.items)) return null;
  return {
    id: String(b.id),
    invoiceNumber: String(b.invoiceNumber || `HLD-${String(b.id).slice(0, 6).toUpperCase()}`),
    items: b.items as InvoiceItem[],
    discount: Number(b.discount) || 0,
    date: Number(b.date) || 0,
    time: String(b.time || ''),
    itemCount: Number(b.itemCount) || 0,
    totalAmount: Number(b.totalAmount) || 0,
    currency: String(b.currency || 'JOD'),
    mode: 'sale',
    status: b.status === 'open' ? 'open' : 'parked',
  };
}

export function readHeldBills(uid: string): HeldBill[] {
  if (typeof localStorage === 'undefined' || !uid) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(userCacheKey(uid, KEY)) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeHeldBill).filter((b): b is HeldBill => !!b);
  } catch {
    return [];
  }
}

/** Synchronous write — a parked cart must survive a crash the same way offline sales do. */
export function writeHeldBills(uid: string, bills: HeldBill[]): boolean {
  if (typeof localStorage === 'undefined' || !uid) return false;
  dropPendingUserCache(uid, KEY);
  try {
    if (bills.length === 0) localStorage.removeItem(userCacheKey(uid, KEY));
    else localStorage.setItem(userCacheKey(uid, KEY), JSON.stringify(bills));
    return true;
  } catch {
    return false;
  }
}

/** Units of a product sitting in parked holds (open/in-cart hold is excluded — those units are in the cart). */
export function unitsHeldParked(bills: HeldBill[], productId: string, excludeBillId?: string): number {
  let total = 0;
  for (const bill of bills) {
    if (bill.id === excludeBillId) continue;
    if ((bill.status || 'parked') === 'open') continue;
    for (const item of bill.items) {
      if (item.productId === productId) total += lineUnits(item);
    }
  }
  return total;
}

export function unitsInHeldBill(bill: Pick<HeldBill, 'items'>, productId: string): number {
  return bill.items.reduce((sum, item) => sum + (item.productId === productId ? lineUnits(item) : 0), 0);
}

/**
 * Whether a parked bill can be opened given live stock, after other parked holds
 * and (optionally) the current cart if the merchant keeps it — restore replaces the cart, so cartUnits defaults to 0.
 */
export function heldBillFitsStock(
  bill: Pick<HeldBill, 'items'>,
  quantityByProduct: Record<string, number>,
  reservedByOthers: (productId: string) => number,
): { ok: true } | { ok: false; productId: string; available: number; needed: number } {
  const neededByProduct = new Map<string, number>();
  for (const item of bill.items) {
    neededByProduct.set(item.productId, (neededByProduct.get(item.productId) || 0) + lineUnits(item));
  }
  for (const [productId, needed] of neededByProduct) {
    const book = Number(quantityByProduct[productId]);
    const available = (Number.isFinite(book) ? book : 0) - reservedByOthers(productId);
    if (needed > available) {
      return { ok: false, productId, available: Math.max(0, available), needed };
    }
  }
  return { ok: true };
}

export function parkedHeldBills(bills: HeldBill[]): HeldBill[] {
  return bills.filter((b) => (b.status || 'parked') !== 'open');
}

export function openHeldBill(bills: HeldBill[]): HeldBill | undefined {
  return bills.find((b) => b.status === 'open');
}
