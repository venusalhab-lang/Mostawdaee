import type { Currency, Invoice, Product } from '../types';
import { roundMoney } from './exchangeRates';
import { roundQty } from './stock';
import { planReturnLines, remainingQty, type RefundSplit, type ReturnFigures, type ReturnLineRequest, type ReturnPlanResult } from './salesReturn';

export function canReturnPurchase(original: Invoice): boolean {
  return original.type === 'purchase' && remainingQty(original).some((q) => q > 0);
}

/** Validates the quantities sent back against what is left on the purchase and prices them. */
export function planPurchaseReturn(original: Invoice, requests: ReturnLineRequest[]): ReturnPlanResult {
  if (original.type !== 'purchase') return { ok: false, error: { code: 'not_sale' } };
  return planReturnLines(original, requests);
}

/**
 * How the supplier settles the return, following how the purchase was paid.
 * A credit purchase comes off what is still owed to the supplier first; anything beyond that the supplier pays back in cash.
 * `debt` is the amount taken off the supplier balance.
 */
export function splitPurchaseRefund(original: Invoice, figures: ReturnFigures, supplierOwed: number): RefundSplit {
  const currency = original.currency as Currency;
  const total = figures.totalAmount;
  if (original.paymentMethod === 'credit') {
    const debt = roundMoney(Math.min(total, Math.max(0, supplierOwed)), currency);
    return { vault: roundMoney(total - debt, currency), vaultCurrency: currency, debt, debtCurrency: currency, external: 0 };
  }
  if (original.vaultPosted === false) return { vault: 0, vaultCurrency: currency, debt: 0, external: total };
  return { vault: total, vaultCurrency: currency, debt: 0, external: 0 };
}

/** What the returned lines cost per product, after the purchase's invoice discount, in the purchase currency. */
export function returnedCostByProduct(original: Invoice, items: Invoice['items']): Map<string, number> {
  const linesTotal = original.items.reduce((sum, i) => sum + (Number(i.total) || 0), 0);
  const discount = Math.min(Math.max(Number(original.discount) || 0, 0), linesTotal);
  const scale = linesTotal > 0 ? (linesTotal - discount) / linesTotal : 1;
  const out = new Map<string, number>();
  for (const item of items) {
    out.set(item.productId, (out.get(item.productId) || 0) + (Number(item.total) || 0) * scale);
  }
  return out;
}

/**
 * Average unit cost after sending `units` back at `value`: the returned goods leave at what they cost.
 * Null when nothing should change (different currencies, no stock left, or no recorded cost).
 */
export function costAfterReturn(
  product: Pick<Product, 'quantity' | 'unitCost' | 'costPrice' | 'currency'>,
  units: number,
  value: number,
  purchaseCurrency: string,
  defaultCurrency: string,
): number | null {
  if (!(units > 0) || !Number.isFinite(value) || value < 0) return null;
  if ((product.currency || defaultCurrency) !== purchaseCurrency) return null;
  const onHand = roundQty(Number(product.quantity) || 0);
  const cost = Number(product.unitCost ?? product.costPrice) || 0;
  const left = roundQty(onHand - units);
  if (left <= 0 || cost <= 0) return null;
  const carrying = onHand * cost;
  // Returning above carrying cost must not invent free stock (WAC → 0) and overstate later profit.
  if (value > carrying) return Math.round(cost * 10_000) / 10_000;
  const averaged = (carrying - value) / left;
  return Math.round(averaged * 10_000) / 10_000;
}
