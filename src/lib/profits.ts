import type { Invoice, InvoiceItem, Product } from '../types';
import { isAdhocLine } from './adhocLine';
import { convertAmount, roundMoney } from './exchangeRates';
import { lineUnits } from './packs';

export interface InvoiceProfit {
  /** Sale value after discount and before VAT, in the invoice currency. */
  revenue: number;
  /** Cost of the goods sold on this invoice, in the invoice currency. */
  cost: number;
  /** revenue - cost. Negative means the invoice was sold at a loss. */
  profit: number;
  /** Lines whose cost is unknown. Their cost is counted as 0, so profit is overstated by them. */
  unknownCostLines: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Cost of one stock unit of a sold line in the invoice currency (pack lines multiply by lineUnits): the snapshot taken at sale time wins;
 * older invoices fall back to the product's current cost. Null when no cost is recorded.
 */
export function lineUnitCost(
  item: InvoiceItem,
  invoiceCurrency: string,
  product: Product | undefined,
  rates: Record<string, number>,
  defaultCurrency: string
): number | null {
  const asInvoiceCurrency = (amount: number, from: string): number | null => {
    const converted = convertAmount(amount, from, invoiceCurrency, rates);
    return Number.isFinite(converted) ? converted : null;
  };
  if (typeof item.unitCost === 'number' && Number.isFinite(item.unitCost) && item.unitCost >= 0) {
    return asInvoiceCurrency(item.unitCost, item.costCurrency || invoiceCurrency);
  }
  if (!product) return null;
  const cost = num(product.unitCost ?? product.costPrice);
  if (cost <= 0) return null;
  return asInvoiceCurrency(cost, product.currency || defaultCurrency);
}

/** Revenue excludes VAT (collected for the tax office) and already includes the discount. */
export function invoiceNetRevenue(inv: Pick<Invoice, 'totalAmount' | 'taxAmount'>): number {
  return num(inv.totalAmount) - num(inv.taxAmount);
}

export function saleInvoiceProfit(
  inv: Invoice,
  productsById: Map<string, Product>,
  rates: Record<string, number>,
  defaultCurrency: string
): InvoiceProfit {
  const currency = inv.currency || defaultCurrency;
  const revenue = invoiceNetRevenue(inv);
  let cost = 0;
  let unknownCostLines = 0;
  for (const item of inv.items || []) {
    const unit = lineUnitCost(item, currency, productsById.get(item.productId), rates, defaultCurrency);
    if (unit === null) {
      unknownCostLines += 1;
      continue;
    }
    cost = roundMoney(cost + unit * lineUnits(item), currency);
  }
  return { revenue, cost, profit: roundMoney(revenue - cost, currency), unknownCostLines };
}

export interface LineProfit {
  item: InvoiceItem;
  /** This line's share of the invoice's net revenue: the invoice discount is spread by line value, VAT is excluded. */
  revenue: number;
  /** Null when no cost is recorded for this line. */
  cost: number | null;
}

/**
 * Per-line split of saleInvoiceProfit. The line revenues add up to the invoice revenue exactly,
 * so a per-product report agrees with the invoice totals.
 */
export function saleLineProfits(
  inv: Invoice,
  productsById: Map<string, Product>,
  rates: Record<string, number>,
  defaultCurrency: string
): LineProfit[] {
  const currency = inv.currency || defaultCurrency;
  const items = inv.items || [];
  const gross = items.map((item) => num(item.total ?? num(item.unitPrice) * num(item.quantity)));
  const grossSum = gross.reduce((a, b) => a + b, 0);
  const revenue = invoiceNetRevenue(inv);
  return items.map((item, i) => {
    const unit = lineUnitCost(item, currency, productsById.get(item.productId), rates, defaultCurrency);
    return {
      item,
      revenue: grossSum > 0 ? (revenue * gross[i]) / grossSum : items.length ? revenue / items.length : 0,
      cost: unit === null ? null : unit * lineUnits(item),
    };
  });
}

export interface ProfitTotals {
  revenue: number;
  cost: number;
  profit: number;
  /** profit / revenue * 100, or 0 without revenue. */
  margin: number;
  saleCount: number;
  unknownCostLines: number;
  /** Purchases in the period. Shown separately: buying stock is not a cost of goods sold. */
  purchases: number;
}

/** Totals for sale invoices, converted to one display currency. Losses are kept, not clamped. */
export function summarizeProfits(
  invoices: Invoice[],
  products: Product[],
  rates: Record<string, number>,
  displayCurrency: string,
  defaultCurrency: string
): ProfitTotals {
  const byId = new Map(products.map((p) => [p.id, p]));
  const totals: ProfitTotals = { revenue: 0, cost: 0, profit: 0, margin: 0, saleCount: 0, unknownCostLines: 0, purchases: 0 };
  const addConverted = (into: number, amount: number, from: string) => {
    const converted = convertAmount(amount, from, displayCurrency, rates);
    // Skip unknown FX — never let one bad rate turn the whole dashboard into NaN.
    return Number.isFinite(converted) ? into + converted : into;
  };
  for (const inv of invoices) {
    const currency = inv.currency || defaultCurrency;
    if (inv.type === 'purchase' || inv.type === 'purchase_return') {
      const sign = inv.type === 'purchase_return' ? -1 : 1;
      totals.purchases = addConverted(totals.purchases, sign * num(inv.totalAmount), currency);
      continue;
    }
    if (inv.type !== 'sale' && inv.type !== 'return') continue;
    // A return takes its revenue and the cost of the goods back out.
    const sign = inv.type === 'return' ? -1 : 1;
    const p = saleInvoiceProfit(inv, byId, rates, defaultCurrency);
    totals.revenue = addConverted(totals.revenue, sign * p.revenue, currency);
    totals.cost = addConverted(totals.cost, sign * p.cost, currency);
    totals.unknownCostLines += p.unknownCostLines;
    if (inv.type === 'sale') totals.saleCount += 1;
  }
  totals.profit = totals.revenue - totals.cost;
  totals.margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
  return totals;
}

/** Copy the product's current cost onto each sold line so later profit reports stay stable. */
export function snapshotLineCosts(items: InvoiceItem[], productsById: Map<string, Product>, defaultCurrency: string): InvoiceItem[] {
  return items.map((item) => {
    if (typeof item.unitCost === 'number') return item;
    // Free/service lines have no catalog cost; pin 0 so profits never treat them as "unknown cost".
    if (isAdhocLine(item)) {
      return { ...item, adhoc: true, unitCost: 0, costCurrency: item.costCurrency || defaultCurrency };
    }
    const product = productsById.get(item.productId);
    if (!product) return item;
    const cost = num(product.unitCost ?? product.costPrice);
    // No recorded cost stays unknown: a 0 snapshot would report the whole sale as profit and hide the warning.
    if (cost <= 0) return item;
    return { ...item, unitCost: cost, costCurrency: product.currency || defaultCurrency };
  });
}

/**
 * Moving weighted-average unit cost after receiving stock.
 * Returns null when the purchase currency differs from the product's cost currency: mixing them would need a rate.
 * Stock at or below zero, or stock with no recorded cost, has nothing to average, so the purchase cost replaces it.
 */
export function weightedAverageCost(
  product: Pick<Product, 'quantity' | 'unitCost' | 'costPrice' | 'currency'>,
  receivedQty: number,
  receivedTotal: number,
  purchaseCurrency: string,
  defaultCurrency: string,
): number | null {
  if (!(receivedQty > 0) || !Number.isFinite(receivedTotal) || receivedTotal < 0) return null;
  const onHand = num(product.quantity);
  const onHandCost = num(product.unitCost ?? product.costPrice);
  const purchaseUnit = receivedTotal / receivedQty;
  const sameCurrency = (product.currency || defaultCurrency) === purchaseCurrency;
  // Mixing a new currency into an existing cost basis would invent a rate — refuse.
  // Empty or unpriced stock may adopt the purchase currency (caller should write product.currency).
  if (!sameCurrency) {
    if (onHand > 0 && onHandCost > 0) return null;
    return Math.round(purchaseUnit * 10_000) / 10_000;
  }
  const averaged = onHand > 0 && onHandCost > 0
    ? (onHand * onHandCost + receivedTotal) / (onHand + receivedQty)
    : purchaseUnit;
  return Math.round(averaged * 10_000) / 10_000;
}

/** Stock at cost, one total per cost currency (never summed across currencies). Negative stock adds nothing. */
export function stockValueByCurrency(
  products: Pick<Product, 'quantity' | 'unitCost' | 'costPrice' | 'currency'>[],
  defaultCurrency: string,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const p of products) {
    const qty = num(p.quantity);
    if (qty <= 0) continue;
    const code = p.currency || defaultCurrency;
    totals[code] = (totals[code] || 0) + qty * num(p.unitCost ?? p.costPrice);
  }
  return totals;
}
