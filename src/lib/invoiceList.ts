import type { Currency, Invoice } from '../types';
import { roundMoney } from './exchangeRates';
import { startOfLocalDay } from './homeDesk';
import { paymentMethodLabel, sumInvoicesByCurrency } from './invoiceDocument';
import { salePayment } from './salesPayment';
import { purchasePayment } from './suppliers';

const DAY_MS = 24 * 60 * 60 * 1000;

export type InvoiceListRange = 'all' | 'today' | 'yesterday' | 'week' | 'month';
export type InvoiceTypeFilter = 'all' | 'sales' | 'purchases' | 'returns';
export type InvoicePaymentFilter = 'all' | 'cash' | 'card' | 'wallet' | 'credit' | 'split';
export type InvoiceListLayout = 'table' | 'cards';

export function invoiceListWindow(range: InvoiceListRange, now = Date.now()): { start: number; end: number } | null {
  if (range === 'all') return null;
  const today = startOfLocalDay(now);
  if (range === 'today') return { start: today, end: now };
  if (range === 'yesterday') return { start: today - DAY_MS, end: today };
  if (range === 'week') return { start: today - 6 * DAY_MS, end: now };
  return { start: today - 29 * DAY_MS, end: now };
}

export function invoicePaymentLabel(
  inv: Pick<Invoice, 'paymentMethod' | 'paidAmount' | 'totalAmount'>,
  isRtl: boolean,
): string {
  return paymentMethodLabel(inv.paymentMethod, isRtl, inv.paidAmount, inv.totalAmount);
}

/** Sale/purchase unpaid slice in invoice currency (0 if fully settled). */
export function invoiceOwed(inv: Pick<Invoice, 'type' | 'paymentMethod' | 'paidAmount' | 'totalAmount' | 'currency'>): number {
  if (inv.type === 'sale' && inv.paymentMethod === 'credit') return salePayment(inv).owed;
  if (inv.type === 'purchase' && inv.paymentMethod === 'credit') return purchasePayment(inv).owed;
  return 0;
}

export function invoicePaidNow(inv: Pick<Invoice, 'type' | 'paymentMethod' | 'paidAmount' | 'totalAmount' | 'currency'>): number {
  if (inv.type === 'sale' && inv.paymentMethod === 'credit') return salePayment(inv).paid;
  if (inv.type === 'purchase' && inv.paymentMethod === 'credit') return purchasePayment(inv).paid;
  return Number(inv.totalAmount) || 0;
}

export function isSplitTender(inv: Pick<Invoice, 'type' | 'paymentMethod' | 'paidAmount' | 'totalAmount' | 'currency'>): boolean {
  return invoicePaidNow(inv) > 0 && invoiceOwed(inv) > 0 && inv.paymentMethod === 'credit';
}

export function matchesPaymentFilter(
  inv: Pick<Invoice, 'type' | 'paymentMethod' | 'paidAmount' | 'totalAmount' | 'currency'>,
  filter: InvoicePaymentFilter,
): boolean {
  if (filter === 'all') return true;
  const method = inv.paymentMethod || 'cash';
  if (filter === 'split') return isSplitTender(inv);
  if (filter === 'credit') return method === 'credit' && !isSplitTender(inv);
  if (filter === 'cash') return method === 'cash' || method === undefined;
  return method === filter;
}

export function matchesTypeFilter(inv: Pick<Invoice, 'type'>, filter: InvoiceTypeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'sales') return inv.type === 'sale';
  if (filter === 'purchases') return inv.type === 'purchase';
  return inv.type === 'return' || inv.type === 'purchase_return';
}

export function filterInvoiceList(
  invoices: Invoice[],
  opts: {
    query: string;
    currency: 'ALL' | Currency;
    range: InvoiceListRange;
    type: InvoiceTypeFilter;
    payment: InvoicePaymentFilter;
    now?: number;
    matchesQuery: (fields: Array<string | undefined>, query: string) => boolean;
  },
): Invoice[] {
  const window = invoiceListWindow(opts.range, opts.now);
  return invoices.filter((inv) => {
    if (opts.currency !== 'ALL' && inv.currency !== opts.currency) return false;
    if (!matchesTypeFilter(inv, opts.type)) return false;
    if (!matchesPaymentFilter(inv, opts.payment)) return false;
    if (window) {
      const d = Number(inv.date) || 0;
      if (d < window.start || d >= window.end) return false;
    }
    return opts.matchesQuery(
      [inv.invoiceNumber, inv.customerName, inv.supplierName, inv.paymentMethod],
      opts.query,
    );
  });
}

export interface InvoiceListSummary {
  count: number;
  netSalesByCurrency: Record<string, number>;
  purchasesByCurrency: Record<string, number>;
  openCreditByCurrency: Record<string, number>;
}

/** Totals for the currently filtered list — currencies stay separate. */
export function summarizeInvoiceList(invoices: Invoice[]): InvoiceListSummary {
  const netSalesByCurrency = sumInvoicesByCurrency(invoices, 'sale');
  for (const [code, amount] of Object.entries(sumInvoicesByCurrency(invoices, 'return'))) {
    netSalesByCurrency[code] = roundMoney((netSalesByCurrency[code] || 0) - amount, code);
  }
  const purchasesByCurrency = sumInvoicesByCurrency(invoices, 'purchase');
  for (const [code, amount] of Object.entries(sumInvoicesByCurrency(invoices, 'purchase_return'))) {
    purchasesByCurrency[code] = roundMoney((purchasesByCurrency[code] || 0) - amount, code);
  }
  const openCreditByCurrency: Record<string, number> = {};
  for (const inv of invoices) {
    if (inv.type !== 'sale' || inv.paymentMethod !== 'credit') continue;
    const owed = invoiceOwed(inv);
    if (owed <= 0) continue;
    // Prefer customer debt currency when present; else invoice currency.
    const code = (inv.debtCurrency || inv.currency || 'JOD') as string;
    const amount = Number.isFinite(Number(inv.debtAmount)) && inv.debtCurrency
      ? Number(inv.debtAmount)
      : owed;
    openCreditByCurrency[code] = roundMoney((openCreditByCurrency[code] || 0) + amount, code);
  }
  return { count: invoices.length, netSalesByCurrency, purchasesByCurrency, openCreditByCurrency };
}
