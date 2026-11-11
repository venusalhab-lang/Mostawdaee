import type { Customer, CustomerTransaction, Invoice, InvoiceItem } from '../types';
import { formatMoney, roundMoney } from './exchangeRates';
import { lineQuantityText, lineUnits } from './packs';

export type StatementPeriodPreset = 'all' | 'this_month' | 'last_month' | 'custom';

export interface StatementPeriod {
  preset: StatementPeriodPreset;
  /** Inclusive start of day (local), ms. Null = open. */
  fromMs: number | null;
  /** Inclusive end of day (local), ms. Null = open. */
  toMs: number | null;
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dayEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();

export function statementPeriod(preset: StatementPeriodPreset, customFrom?: string, customTo?: string, now = new Date()): StatementPeriod {
  if (preset === 'this_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { preset, fromMs: dayStart(from), toMs: dayEnd(to) };
  }
  if (preset === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { preset, fromMs: dayStart(from), toMs: dayEnd(to) };
  }
  if (preset === 'custom') {
    const fromMs = customFrom ? dayStart(new Date(`${customFrom}T00:00:00`)) : null;
    const toMs = customTo ? dayEnd(new Date(`${customTo}T00:00:00`)) : null;
    return {
      preset,
      fromMs: Number.isFinite(fromMs as number) ? fromMs : null,
      toMs: Number.isFinite(toMs as number) ? toMs : null,
    };
  }
  return { preset: 'all', fromMs: null, toMs: null };
}

export function txTime(tx: Pick<CustomerTransaction, 'date'>): number {
  const t = Date.parse(tx.date);
  return Number.isFinite(t) ? t : 0;
}

export function filterCustomerStatement(
  txs: CustomerTransaction[],
  customerId: string,
  period: StatementPeriod,
  search = '',
  invoices: Invoice[] = [],
): CustomerTransaction[] {
  const q = search.trim().toLowerCase();
  return txs
    .filter((tx) => {
      if (!tx || tx.customerId !== customerId) return false;
      const t = txTime(tx);
      if (period.fromMs != null && t < period.fromMs) return false;
      if (period.toMs != null && t > period.toMs) return false;
      if (!q) return true;
      if ((tx.notes || '').toLowerCase().includes(q)
        || (tx.transactionId || '').toLowerCase().includes(q)
        || (tx.id || '').toLowerCase().includes(q)) return true;
      const inv = linkedInvoice(tx, invoices);
      return !!inv && ((inv.invoiceNumber || '').toLowerCase().includes(q)
        || (inv.items || []).some((item) => (item.description || '').toLowerCase().includes(q)
          || (item.sku || '').toLowerCase().includes(q)));
    })
    .sort((a, b) => txTime(a) - txTime(b));
}

export function statementLineDetail(
  tx: CustomerTransaction,
  invoices: Invoice[],
  isRtl: boolean,
): string {
  const inv = linkedInvoice(tx, invoices);
  if (inv?.items?.length) {
    const items = inv.items
      .map((item) => `${item.description || (isRtl ? 'صنف' : 'Item')} × ${lineQuantityText(item, isRtl)}`)
      .join(isRtl ? '، ' : ', ');
    return inv.invoiceNumber ? `#${inv.invoiceNumber} — ${items}` : items;
  }
  if (tx.notes?.trim()) return tx.notes.trim();
  if (inv?.invoiceNumber) {
    return isRtl ? `فاتورة #${inv.invoiceNumber}` : `Invoice #${inv.invoiceNumber}`;
  }
  return '';
}

export function linkedInvoice(tx: CustomerTransaction, invoices: Invoice[]): Invoice | undefined {
  return tx.invoiceId ? invoices.find((i) => i.id === tx.invoiceId) : undefined;
}

/** One goods line of a customer's sale or sales return, with its document date. */
export interface StatementItemRow {
  key: string;
  invoiceId: string;
  invoiceNumber: string;
  date: number;
  kind: 'sale' | 'return';
  paymentMethod?: Invoice['paymentMethod'];
  description: string;
  sku?: string;
  quantityText: string;
  /** Stock units moved (pack lines expanded). */
  units: number;
  unitPrice: number;
  total: number;
  currency: string;
}

export function invoiceItemRows(inv: Invoice, isRtl: boolean): StatementItemRow[] {
  const kind: StatementItemRow['kind'] = inv.type === 'return' ? 'return' : 'sale';
  return (inv.items || []).map((item: InvoiceItem, index) => ({
    key: `${inv.id}:${index}`,
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    date: Number(inv.date) || 0,
    kind,
    paymentMethod: inv.paymentMethod,
    description: item.description || (isRtl ? 'صنف' : 'Item'),
    sku: item.sku,
    quantityText: lineQuantityText(item, isRtl),
    units: lineUnits(item),
    unitPrice: Number(item.unitPrice) || 0,
    total: Number(item.total) || 0,
    currency: inv.currency,
  }));
}

/** Every goods line the customer bought (any payment method) or returned in the period, oldest first. */
export function customerPurchaseRows(
  invoices: Invoice[],
  customerId: string,
  period: StatementPeriod,
  isRtl: boolean,
  search = '',
): StatementItemRow[] {
  const q = search.trim().toLowerCase();
  return invoices
    .filter((inv) => inv && inv.customerId === customerId && (inv.type === 'sale' || inv.type === 'return'))
    .filter((inv) => {
      const t = Number(inv.date) || 0;
      if (period.fromMs != null && t < period.fromMs) return false;
      if (period.toMs != null && t > period.toMs) return false;
      return true;
    })
    .sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0))
    .flatMap((inv) => invoiceItemRows(inv, isRtl))
    .filter((row) => !q
      || row.description.toLowerCase().includes(q)
      || (row.sku || '').toLowerCase().includes(q)
      || row.invoiceNumber.toLowerCase().includes(q));
}

/** Net goods value per currency (returns subtract). Currencies are never added together. */
export function purchaseTotalsByCurrency(rows: StatementItemRow[]): { currency: string; sales: number; returns: number; net: number }[] {
  const by = new Map<string, { sales: number; returns: number }>();
  for (const row of rows) {
    const cur = by.get(row.currency) || { sales: 0, returns: 0 };
    if (row.kind === 'return') cur.returns += row.total;
    else cur.sales += row.total;
    by.set(row.currency, cur);
  }
  return [...by.entries()].map(([currency, v]) => ({
    currency,
    sales: roundMoney(v.sales, currency),
    returns: roundMoney(v.returns, currency),
    net: roundMoney(v.sales - v.returns, currency),
  }));
}

export function periodLabel(period: StatementPeriod, isRtl: boolean, locale: string): string {
  if (period.preset === 'all' || (period.fromMs == null && period.toMs == null)) {
    return isRtl ? 'كل الفترات' : 'All time';
  }
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  if (period.fromMs != null && period.toMs != null) return `${fmt(period.fromMs)} – ${fmt(period.toMs)}`;
  if (period.fromMs != null) return isRtl ? `من ${fmt(period.fromMs)}` : `From ${fmt(period.fromMs)}`;
  return isRtl ? `حتى ${fmt(period.toMs!)}` : `Until ${fmt(period.toMs!)}`;
}

export function sumStatementByType(
  txs: CustomerTransaction[],
  currency: string,
  isReturnCredit: (tx: CustomerTransaction) => boolean,
): { invoices: number; payments: number; returns: number } {
  let invoices = 0;
  let payments = 0;
  let returns = 0;
  for (const tx of txs) {
    if ((tx.currency || currency) !== currency) continue;
    const amount = Number(tx.amount) || 0;
    if (tx.type === 'invoice') invoices += amount;
    else if (isReturnCredit(tx)) returns += amount;
    else payments += amount;
  }
  return { invoices, payments, returns };
}

export type DebtStatus = 'paid' | 'partial' | 'open';

/** How much of one debt entry (credit sale, opening balance or manual adjustment) is still owed. */
export interface DebtAllocation {
  txId: string;
  invoiceId?: string;
  date: number;
  amount: number;
  settled: number;
  remaining: number;
  status: DebtStatus;
}

export interface CustomerDebtAllocation {
  /** Oldest first. */
  debts: DebtAllocation[];
  byTxId: Map<string, DebtAllocation>;
  /** Sum of what is still owed on the debts. */
  outstanding: number;
  /** Credits with no debt left to settle. */
  unapplied: number;
}

const debtStatus = (amount: number, remaining: number): DebtStatus =>
  remaining <= 0 ? 'paid' : remaining < amount ? 'partial' : 'open';

/**
 * Settles the customer's debts from their credits, oldest debt first. A sales return settles the sale it returns before
 * anything else. Derived from the ledger on every render, never stored, so it cannot drift from the transactions.
 * Only entries in the customer's currency take part.
 */
export function allocateCustomerDebt(
  txs: CustomerTransaction[],
  customerId: string,
  currency: string,
  invoices: Invoice[] = [],
): CustomerDebtAllocation {
  const round = (v: number) => roundMoney(v, currency);
  const returnOf = new Map(invoices.filter((i) => i.type === 'return' && i.returnOf).map((i) => [i.id, i.returnOf!]));
  const mine = txs
    .filter((tx) => tx && tx.customerId === customerId && (tx.currency || currency) === currency)
    .sort((a, b) => txTime(a) - txTime(b) || (a.type === b.type ? 0 : a.type === 'invoice' ? -1 : 1));

  const debts: DebtAllocation[] = [];
  let unapplied = 0;
  const settle = (debt: DebtAllocation, available: number) => {
    const applied = Math.min(debt.remaining, available);
    debt.settled = round(debt.settled + applied);
    debt.remaining = round(debt.amount - debt.settled);
    return round(available - applied);
  };

  for (const tx of mine) {
    const amount = round(Math.abs(Number(tx.amount) || 0));
    if (amount <= 0) continue;
    if (tx.type === 'invoice') {
      const debt: DebtAllocation = {
        txId: tx.id, invoiceId: tx.invoiceId, date: txTime(tx), amount, settled: 0, remaining: amount, status: 'open',
      };
      if (unapplied > 0) unapplied = settle(debt, unapplied);
      debts.push(debt);
      continue;
    }
    let left = amount;
    const target = tx.invoiceId ? (returnOf.get(tx.invoiceId) ?? tx.invoiceId) : undefined;
    const own = target ? debts.find((d) => d.invoiceId === target && d.remaining > 0) : undefined;
    if (own) left = settle(own, left);
    for (const debt of debts) {
      if (left <= 0) break;
      if (debt.remaining > 0) left = settle(debt, left);
    }
    unapplied = round(unapplied + left);
  }

  for (const debt of debts) debt.status = debtStatus(debt.amount, debt.remaining);
  return {
    debts,
    byTxId: new Map(debts.map((d) => [d.txId, d])),
    outstanding: round(debts.reduce((sum, d) => sum + d.remaining, 0)),
    unapplied: round(unapplied),
  };
}

/** What a payment of `amount` would settle, oldest open debt first. */
export function previewPayment(
  allocation: CustomerDebtAllocation,
  amount: number,
  currency: string,
): { debt: DebtAllocation; applied: number; remainingAfter: number; status: DebtStatus }[] {
  let left = roundMoney(Math.max(0, Number(amount) || 0), currency);
  const out: { debt: DebtAllocation; applied: number; remainingAfter: number; status: DebtStatus }[] = [];
  for (const debt of allocation.debts) {
    if (left <= 0) break;
    if (debt.remaining <= 0) continue;
    const applied = Math.min(debt.remaining, left);
    const remainingAfter = roundMoney(debt.remaining - applied, currency);
    left = roundMoney(left - applied, currency);
    out.push({ debt, applied, remainingAfter, status: debtStatus(debt.amount, remainingAfter) });
  }
  return out;
}

export function debtStatusLabel(debt: Pick<DebtAllocation, 'status' | 'remaining'>, currency: string, isRtl: boolean): string {
  if (debt.status === 'paid') return isRtl ? 'مسددة' : 'Paid';
  if (debt.status === 'open') return isRtl ? 'غير مسددة' : 'Unpaid';
  const left = formatMoney(debt.remaining, currency, 'en-US');
  return isRtl ? `مسددة جزئيًا · بقي ${left}` : `Partly paid · ${left} left`;
}

/** WhatsApp-friendly statement. Caps length so the deep link still opens. */
export function buildWhatsAppStatement(opts: {
  customer: Customer;
  txs: CustomerTransaction[];
  period: StatementPeriod;
  businessName?: string;
  isRtl: boolean;
  isReturnCredit: (tx: CustomerTransaction) => boolean;
  invoices: Invoice[];
  allocation?: CustomerDebtAllocation;
  maxChars?: number;
}): string {
  const {
    customer, txs, period, businessName, isRtl, isReturnCredit, invoices, allocation, maxChars = 3500,
  } = opts;
  const locale = isRtl ? 'ar' : 'en-US';
  const currency = customer.currency || 'JOD';
  const sums = sumStatementByType(txs, currency, isReturnCredit);
  const title = businessName?.trim()
    ? (isRtl ? `*كشف حساب - ${businessName.trim()}*` : `*Account statement - ${businessName.trim()}*`)
    : (isRtl ? '*كشف حساب*' : '*Account statement*');

  const lines: string[] = [
    title,
    '',
    isRtl ? `الزبون: *${customer.name}*` : `Customer: *${customer.name}*`,
    isRtl ? `الفترة: ${periodLabel(period, isRtl, locale)}` : `Period: ${periodLabel(period, false, locale)}`,
    isRtl
      ? `الرصيد الحالي: *${formatMoney(customer.totalDebt, currency, 'en-US')}*`
      : `Current balance: *${formatMoney(customer.totalDebt, currency, 'en-US')}*`,
    isRtl
      ? `خلال الفترة — آجل: ${formatMoney(sums.invoices, currency, 'en-US')} · سداد: ${formatMoney(sums.payments, currency, 'en-US')}${sums.returns ? ` · مرتجع: ${formatMoney(sums.returns, currency, 'en-US')}` : ''}`
      : `In period — credit: ${formatMoney(sums.invoices, currency, 'en-US')} · paid: ${formatMoney(sums.payments, currency, 'en-US')}${sums.returns ? ` · returns: ${formatMoney(sums.returns, currency, 'en-US')}` : ''}`,
    '-----------------------------------',
  ];

  const rows: string[] = [];
  if (txs.length === 0) {
    lines.push(isRtl ? 'لا توجد حركات في هذه الفترة.' : 'No movements in this period.');
  } else {
    lines.push(isRtl ? '*تفاصيل الحركات (من الأقدم للأحدث):*' : '*Movements (oldest to newest):*');
    for (const tx of txs) {
      const when = new Date(tx.date).toLocaleString(locale, {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      const kind = tx.type === 'invoice'
        ? (isRtl ? 'آجل' : 'Credit')
        : isReturnCredit(tx) ? (isRtl ? 'مرتجع' : 'Return') : (isRtl ? 'سداد' : 'Payment');
      const sign = tx.type === 'payment' ? '-' : '+';
      const inv = linkedInvoice(tx, invoices);
      let row = `• ${when} | ${kind} | ${sign}${formatMoney(Number(tx.amount) || 0, tx.currency || currency, 'en-US')}`;
      if (inv?.items?.length) {
        if (inv.invoiceNumber) row += `\n  ${isRtl ? 'فاتورة' : 'Invoice'} #${inv.invoiceNumber}`;
        for (const line of invoiceItemRows(inv, isRtl)) {
          row += `\n  - ${line.description} × ${line.quantityText} @ ${formatMoney(line.unitPrice, line.currency, 'en-US')} = ${formatMoney(line.total, line.currency, 'en-US')}`;
        }
      } else {
        const detail = statementLineDetail(tx, invoices, isRtl);
        if (detail) row += `\n  ${detail}`;
      }
      const debt = tx.type === 'invoice' ? allocation?.byTxId.get(tx.id) : undefined;
      if (debt) row += `\n  ${isRtl ? 'الحالة' : 'Status'}: ${debtStatusLabel(debt, tx.currency || currency, isRtl)}`;
      row += `\n  ${isRtl ? 'الرصيد بعد الحركة' : 'Balance after'}: ${formatMoney(Number(tx.remainingBalanceAfter) || 0, tx.currency || currency, 'en-US')}`;
      rows.push(row);
    }
  }

  const footer = ['-----------------------------------', isRtl ? 'شكراً لثقتكم.' : 'Thank you for your business.'];
  const head = lines.join('\n');
  const full = [head, ...rows, ...footer].join('\n');
  if (full.length <= maxChars) return full;

  // Too long for a WhatsApp link: keep the newest rows that fit and point to the printed statement.
  const note = (kept: number) => (isRtl
    ? `… عُرضت آخر ${kept} من ${rows.length} حركة. القائمة الكاملة في كشف الحساب المطبوع.`
    : `… Showing the last ${kept} of ${rows.length} movements. The full list is in the printed statement.`);
  const budget = maxChars - head.length - footer.join('\n').length - note(rows.length).length - 4;
  const kept: string[] = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const size = rows[i].length + 1;
    if (used + size > budget) break;
    kept.unshift(rows[i]);
    used += size;
  }
  return [head, note(kept.length), ...kept, ...footer].join('\n').slice(0, maxChars);
}
