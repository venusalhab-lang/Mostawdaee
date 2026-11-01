import type { Currency, Invoice, InvoiceItem } from '../types';
import { roundMoney } from './exchangeRates';
import { roundQty } from './stock';

export interface ReturnLineRequest {
  /** Index of the line on the original sale. */
  index: number;
  /** Quantity in the line's own unit (packs for a pack line). */
  quantity: number;
}

export type ReturnPlanError =
  | { code: 'not_sale' }
  | { code: 'empty' }
  | { code: 'bad_line'; index: number }
  | { code: 'too_many'; index: number; remaining: number };

export interface ReturnFigures {
  subtotal: number;
  discount: number;
  taxAmount: number;
  totalAmount: number;
  /** Credit sales only: the share of the customer debt, in the debt currency. */
  debtAmount?: number;
}

export interface ReturnPlan {
  items: InvoiceItem[];
  figures: ReturnFigures;
  /** Quantities returned per original line after this return. */
  returnedQty: number[];
  /** Every line of the sale is now fully returned. */
  complete: boolean;
}

/** Quantities already returned per line of a sale. */
export function returnedSoFar(original: Pick<Invoice, 'items' | 'returnedQty'>): number[] {
  return original.items.map((_, i) => roundQty(Number(original.returnedQty?.[i]) || 0));
}

export function remainingQty(original: Pick<Invoice, 'items' | 'returnedQty'>): number[] {
  const done = returnedSoFar(original);
  return original.items.map((item, i) => roundQty(Math.max(0, (Number(item.quantity) || 0) - done[i])));
}

/** True while at least one unit of the sale can still be returned. */
export function canReturn(original: Invoice): boolean {
  return original.type === 'sale' && remainingQty(original).some((q) => q > 0);
}

/** Value of `q` units of a line; the whole line is its stored total. */
function lineAmount(item: InvoiceItem, q: number, currency: Currency): number {
  if (q <= 0) return 0;
  if (q >= (Number(item.quantity) || 0)) return Number(item.total) || 0;
  return roundMoney((Number(item.unitPrice) || 0) * q, currency);
}

/**
 * The share of the sale covered by `qty` units per line. A fully covered sale gives the stored figures exactly,
 * so a sale returned in several steps always adds back up to its own totals.
 */
function cumulativeFigures(original: Invoice, qty: number[]): ReturnFigures {
  const currency = original.currency as Currency;
  const full = original.items.every((item, i) => qty[i] >= (Number(item.quantity) || 0));
  const debtCurrency = (original.debtCurrency || currency) as Currency;
  const hasDebt = original.paymentMethod === 'credit' && Number.isFinite(Number(original.debtAmount));
  if (full) {
    return {
      subtotal: Number(original.subtotal) || 0,
      discount: Number(original.discount) || 0,
      taxAmount: Number(original.taxAmount) || 0,
      totalAmount: Number(original.totalAmount) || 0,
      ...(hasDebt ? { debtAmount: Number(original.debtAmount) || 0 } : {}),
    };
  }
  const linesTotal = original.items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const subtotal = roundMoney(original.items.reduce((sum, item, i) => sum + lineAmount(item, qty[i], currency), 0), currency);
  const share = linesTotal > 0 ? subtotal / linesTotal : 0;
  const discount = roundMoney((Number(original.discount) || 0) * share, currency);
  const originalNet = linesTotal - (Number(original.discount) || 0);
  const taxAmount = originalNet > 0 ? roundMoney((Number(original.taxAmount) || 0) * ((subtotal - discount) / originalNet), currency) : 0;
  const totalAmount = roundMoney(subtotal - discount + taxAmount, currency);
  const total = Number(original.totalAmount) || 0;
  return {
    subtotal,
    discount,
    taxAmount,
    totalAmount,
    ...(hasDebt ? { debtAmount: total > 0 ? roundMoney((Number(original.debtAmount) || 0) * (totalAmount / total), debtCurrency) : 0 } : {}),
  };
}

function difference(after: ReturnFigures, before: ReturnFigures, original: Invoice): ReturnFigures {
  const currency = original.currency as Currency;
  const debtCurrency = (original.debtCurrency || currency) as Currency;
  return {
    subtotal: roundMoney(after.subtotal - before.subtotal, currency),
    discount: roundMoney(after.discount - before.discount, currency),
    taxAmount: roundMoney(after.taxAmount - before.taxAmount, currency),
    totalAmount: roundMoney(after.totalAmount - before.totalAmount, currency),
    ...(after.debtAmount !== undefined ? { debtAmount: roundMoney(after.debtAmount - (before.debtAmount || 0), debtCurrency) } : {}),
  };
}

export type ReturnPlanResult =
  | { ok: true; plan: ReturnPlan; error?: undefined }
  | { ok: false; error: ReturnPlanError; plan?: undefined };

/** Validates the requested quantities against what is left and prices the return. */
export function planSalesReturn(original: Invoice, requests: ReturnLineRequest[]): ReturnPlanResult {
  if (original.type !== 'sale') return { ok: false, error: { code: 'not_sale' } };
  return planReturnLines(original, requests);
}

/** The line and price math shared by sales and purchase returns; the caller checks the invoice type. */
export function planReturnLines(original: Invoice, requests: ReturnLineRequest[]): ReturnPlanResult {
  const before = returnedSoFar(original);
  const left = remainingQty(original);
  const thisReturn = original.items.map(() => 0);
  for (const r of requests) {
    const q = roundQty(Number(r.quantity));
    if (!Number.isInteger(r.index) || r.index < 0 || r.index >= original.items.length || !Number.isFinite(q) || q < 0) {
      return { ok: false, error: { code: 'bad_line', index: r.index } };
    }
    thisReturn[r.index] = roundQty(thisReturn[r.index] + q);
  }
  for (let i = 0; i < thisReturn.length; i++) {
    if (thisReturn[i] > left[i]) return { ok: false, error: { code: 'too_many', index: i, remaining: left[i] } };
  }
  if (!thisReturn.some((q) => q > 0)) return { ok: false, error: { code: 'empty' } };

  const currency = original.currency as Currency;
  const after = before.map((q, i) => roundQty(q + thisReturn[i]));
  const items: InvoiceItem[] = [];
  original.items.forEach((item, i) => {
    if (thisReturn[i] <= 0) return;
    items.push({
      ...item,
      quantity: thisReturn[i],
      total: roundMoney(lineAmount(item, after[i], currency) - lineAmount(item, before[i], currency), currency),
      sourceLine: i,
    });
  });

  return {
    ok: true,
    plan: {
      items,
      figures: difference(cumulativeFigures(original, after), cumulativeFigures(original, before), original),
      returnedQty: after,
      complete: original.items.every((item, i) => after[i] >= (Number(item.quantity) || 0)),
    },
  };
}

export interface RefundSplit {
  /** Paid back in cash from the vault, in `vaultCurrency`. */
  vault: number;
  vaultCurrency: Currency;
  /** Taken off the customer's debt, in `debtCurrency`. */
  debt: number;
  debtCurrency?: Currency;
  /** Card or wallet sale: refunded outside the app, no vault or debt movement. */
  external: number;
}

/**
 * How the money goes back, following how the sale was paid.
 * Credit: lower AR first; cash paid at sale returns from the vault.
 * Legacy full-آجل (no paidAmount): refundable amount is tracked in debtCurrency via debtAmount.
 * Split tender: cash share = proportional paidAmount in invoice currency.
 */
export function splitRefund(original: Invoice, figures: ReturnFigures, currentDebt: number): RefundSplit {
  const currency = original.currency as Currency;
  if (original.paymentMethod === 'credit') {
    const debtCurrency = (original.debtCurrency || currency) as Currency;
    const arPortion = figures.debtAmount ?? figures.totalAmount;
    const debt = roundMoney(Math.min(arPortion, Math.max(0, currentDebt)), debtCurrency);
    const uncoveredAr = roundMoney(arPortion - debt, debtCurrency);
    const total = Number(original.totalAmount) || 0;
    const share = total > 0 ? figures.totalAmount / total : 1;
    const hasExplicitPaid = original.paidAmount !== undefined && original.paidAmount !== null;
    if (!hasExplicitPaid) {
      // Legacy full credit: everything was on AR (possibly FX); uncovered AR comes back as cash in debt currency.
      return { vault: uncoveredAr, vaultCurrency: debtCurrency, debt, debtCurrency, external: 0 };
    }
    const paidAtSale = roundMoney(Math.min(Math.max(Number(original.paidAmount) || 0, 0), total), currency);
    const paidShare = roundMoney(paidAtSale * share, currency);
    if (debtCurrency === currency) {
      return {
        vault: roundMoney(paidShare + uncoveredAr, currency),
        vaultCurrency: currency,
        debt,
        debtCurrency,
        external: 0,
      };
    }
    // Split + FX: cash share stays in invoice currency; uncovered AR refunded in debt currency is not mixed into vault.
    // Uncovered AR in another currency is rare (customer already settled); treat as external so cash drawer stays honest.
    return {
      vault: paidShare,
      vaultCurrency: currency,
      debt,
      debtCurrency,
      external: uncoveredAr > 0 ? uncoveredAr : 0,
    };
  }
  const nonCash = original.paymentMethod === 'card' || original.paymentMethod === 'wallet';
  if (nonCash && original.vaultPosted !== true) {
    return { vault: 0, vaultCurrency: currency, debt: 0, external: figures.totalAmount };
  }
  if (original.vaultPosted === false) return { vault: 0, vaultCurrency: currency, debt: 0, external: figures.totalAmount };
  return { vault: figures.totalAmount, vaultCurrency: currency, debt: 0, external: 0 };
}
