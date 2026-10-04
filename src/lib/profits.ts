import type { Invoice, InvoiceItem, Product } from '../types';
import { convertAmount } from './exchangeRates';

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
 * Unit cost of a sold line in the invoice currency: the snapshot taken at sale time wins;
 * older invoices fall back to the product's current cost. Null when no cost is recorded.
 */
export function lineUnitCost(
  item: InvoiceItem,
  invoiceCurrency: string,
  product: Product | undefined,
  rates: Record<string, number>,
  defaultCurrency: string
): number | null {
  if (typeof item.unitCost === 'number' && Number.isFinite(item.unitCost) && item.unitCost >= 0) {
    return convertAmount(item.unitCost, item.costCurrency || invoiceCurrency, invoiceCurrency, rates);
  }
  if (!product) return null;
  const cost = num(product.unitCost ?? product.costPrice);
  if (cost <= 0) return null;
  return convertAmount(cost, product.currency || defaultCurrency, invoiceCurrency, rates);
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
    cost += unit * num(item.quantity);
  }
  return { revenue, cost, profit: revenue - cost, unknownCostLines };
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
  for (const inv of invoices) {
    const currency = inv.currency || defaultCurrency;
    if (inv.type === 'purchase') {
      totals.purchases += convertAmount(num(inv.totalAmount), currency, displayCurrency, rates);
      continue;
    }
    if (inv.type !== 'sale') continue;
    const p = saleInvoiceProfit(inv, byId, rates, defaultCurrency);
    totals.revenue += convertAmount(p.revenue, currency, displayCurrency, rates);
    totals.cost += convertAmount(p.cost, currency, displayCurrency, rates);
    totals.unknownCostLines += p.unknownCostLines;
    totals.saleCount += 1;
  }
  totals.profit = totals.revenue - totals.cost;
  totals.margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
  return totals;
}

/** Copy the product's current cost onto each sold line so later profit reports stay stable. */
export function snapshotLineCosts(items: InvoiceItem[], productsById: Map<string, Product>, defaultCurrency: string): InvoiceItem[] {
  return items.map((item) => {
    if (typeof item.unitCost === 'number') return item;
    const product = productsById.get(item.productId);
    if (!product) return item;
    const cost = num(product.unitCost ?? product.costPrice);
    return { ...item, unitCost: cost, costCurrency: product.currency || defaultCurrency };
  });
}

/**
 * Moving weighted-average unit cost after receiving stock.
 * Returns null when the purchase currency differs from the product's cost currency: mixing them would need a rate.
 * Stock at or below zero has no cost to average, so the purchase cost replaces it.
 */
export function weightedAverageCost(
  product: Pick<Product, 'quantity' | 'unitCost' | 'costPrice' | 'currency'>,
  receivedQty: number,
  receivedTotal: number,
  purchaseCurrency: string,
  defaultCurrency: string,
): number | null {
  if (!(receivedQty > 0) || !Number.isFinite(receivedTotal) || receivedTotal < 0) return null;
  if ((product.currency || defaultCurrency) !== purchaseCurrency) return null;
  const onHand = num(product.quantity);
  const purchaseUnit = receivedTotal / receivedQty;
  const averaged = onHand > 0
    ? (onHand * num(product.unitCost ?? product.costPrice) + receivedTotal) / (onHand + receivedQty)
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
