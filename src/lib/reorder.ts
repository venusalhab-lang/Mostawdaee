import type { Currency, Invoice, Product } from '../types';
import { isValidPackSize, lineUnits } from './packs';
import { resolveLowStockThreshold, roundQty } from './stock';

/**
 * What to buy again, from what actually sold. Every number here can be traced back:
 * units sold in the window (net of returns) ÷ days = daily rate; the suggestion tops stock up to
 * `rate × coverDays + low-stock level`. Nothing is guessed for products with no sales.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A product added three days ago is not judged on three days of sales. */
export const MIN_RATE_DAYS = 7;

export interface ReorderOptions {
  now: number;
  /** Days of sales history used for the daily rate. */
  windowDays: number;
  /** Days of sales the order should cover. */
  coverDays: number;
  globalThreshold?: number | null;
  defaultCurrency: Currency;
}

export interface LastPurchase {
  invoiceId: string;
  date: number;
  supplierId?: string;
  supplierName?: string;
  /** Price paid for one single unit, before VAT, in the purchase currency. */
  unitCost: number;
  currency: Currency;
}

export interface ReorderLine {
  product: Product;
  threshold: number;
  onHand: number;
  /** Units sold in the window, net of returns. */
  soldUnits: number;
  /** Days the rate is averaged over. */
  rateDays: number;
  perDay: number;
  /** Days of stock left at the current rate; null when nothing sold. */
  daysLeft: number | null;
  /** Units to order; rounded up to whole packs when the product has a pack. 0 = review by hand. */
  suggestedUnits: number;
  packSize?: number;
  last?: LastPurchase;
  /** One unit at the last purchase price, else the product's average cost. */
  unitCost: number;
  costCurrency: Currency;
}

export function lastPurchases(invoices: Invoice[]): Map<string, LastPurchase> {
  const out = new Map<string, LastPurchase>();
  for (const inv of invoices) {
    if (inv.type !== 'purchase') continue;
    for (const item of inv.items || []) {
      if (!item.productId) continue;
      const prev = out.get(item.productId);
      if (prev && prev.date >= inv.date) continue;
      const units = lineUnits(item);
      const lineCost = Number(item.total) || (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0);
      out.set(item.productId, {
        invoiceId: inv.id,
        date: inv.date,
        supplierId: inv.supplierId,
        supplierName: inv.supplierName,
        unitCost: units > 0 ? lineCost / units : 0,
        currency: inv.currency,
      });
    }
  }
  return out;
}

/** Net units sold per product since `from`: sales minus sales returns. */
export function unitsSoldSince(invoices: Invoice[], from: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.date < from) continue;
    const sign = inv.type === 'sale' ? 1 : inv.type === 'return' ? -1 : 0;
    if (!sign) continue;
    for (const item of inv.items || []) {
      if (!item.productId) continue;
      out.set(item.productId, (out.get(item.productId) || 0) + sign * lineUnits(item));
    }
  }
  return out;
}

export function planReorder(products: Product[], invoices: Invoice[], opts: ReorderOptions): ReorderLine[] {
  const windowDays = Math.max(1, Math.round(opts.windowDays));
  const coverDays = Math.max(1, Math.round(opts.coverDays));
  const sold = unitsSoldSince(invoices, opts.now - windowDays * DAY_MS);
  const last = lastPurchases(invoices);
  const lines: ReorderLine[] = [];

  for (const product of products) {
    if (product.type === 'asset') continue;
    const onHand = roundQty(Number(product.quantity) || 0);
    const threshold = resolveLowStockThreshold(product.lowStockThreshold, opts.globalThreshold);
    const soldUnits = Math.max(0, roundQty(sold.get(product.id) || 0));
    const age = product.dateAdded ? (opts.now - product.dateAdded) / DAY_MS : windowDays;
    const rateDays = Math.min(windowDays, Math.max(MIN_RATE_DAYS, Math.ceil(age)));
    const perDay = soldUnits / rateDays;
    const daysLeft = perDay > 0 ? Math.max(0, onHand) / perDay : null;

    const need = perDay > 0 ? perDay * coverDays + threshold - onHand : 0;
    let suggestedUnits = need > 0 ? Math.ceil(need - 1e-9) : 0;
    const packSize = isValidPackSize(product.packSize) ? Number(product.packSize) : undefined;
    if (packSize && suggestedUnits > 0) suggestedUnits = Math.ceil(suggestedUnits / packSize) * packSize;

    const low = onHand <= threshold;
    if (suggestedUnits <= 0 && !low) continue;

    const lp = last.get(product.id);
    const avgCost = Number(product.unitCost) || 0;
    lines.push({
      product,
      threshold,
      onHand,
      soldUnits,
      rateDays,
      perDay,
      daysLeft,
      suggestedUnits,
      packSize,
      last: lp,
      unitCost: lp && lp.unitCost > 0 ? lp.unitCost : avgCost,
      costCurrency: lp && lp.unitCost > 0 ? lp.currency : ((product.currency as Currency) || opts.defaultCurrency),
    });
  }

  return lines.sort((a, b) => {
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const db = b.daysLeft ?? Number.POSITIVE_INFINITY;
    return da - db || a.onHand - b.onHand || a.product.name.localeCompare(b.product.name);
  });
}

export interface SupplierGroup {
  key: string;
  supplierId?: string;
  supplierName?: string;
  lines: ReorderLine[];
}

/** Lines grouped by the supplier of their last purchase; products never bought come last. */
export function groupBySupplier(lines: ReorderLine[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const line of lines) {
    const id = line.last?.supplierId;
    const name = line.last?.supplierName?.trim();
    const key = id ? `id:${id}` : name ? `name:${name.toLowerCase()}` : '';
    const group = groups.get(key) || { key, supplierId: id, supplierName: name, lines: [] };
    groups.set(key, group);
    group.lines.push(line);
  }
  return [...groups.values()].sort((a, b) => (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0) || b.lines.length - a.lines.length);
}

/** Estimated cost per currency; currencies are never added together. */
export function estimateCost(lines: Pick<ReorderLine, 'unitCost' | 'costCurrency'>[], qty: (i: number) => number): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {};
  lines.forEach((line, i) => {
    const q = qty(i);
    if (!(q > 0) || !(line.unitCost > 0)) return;
    out[line.costCurrency] = (out[line.costCurrency] || 0) + q * line.unitCost;
  });
  return out;
}
