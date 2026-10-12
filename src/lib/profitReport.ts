import type { Invoice, Product } from '../types';
import { saleInvoiceProfit } from './profits';
import { currencyDecimals, roundMoney } from './exchangeRates';
import { escapeHtml } from './invoiceDocument';
import { localIsoDate } from './localDate';
import { appName } from './brand';

export interface ProfitRow {
  id: string;
  invoiceNumber: string;
  date: number;
  /** Customer or supplier on the invoice; empty for a walk-in sale. */
  party: string;
  type: 'sale' | 'purchase';
  currency: string;
  /** Sales: after discount, before VAT, so amount - cost = profit. Purchases: the invoice total. */
  amount: number;
  tax: number;
  /** Null on purchases: buying stock is not a cost of goods sold. */
  cost: number | null;
  profit: number | null;
  /** Sold lines without a recorded cost; they count as zero cost, so the profit is overstated. */
  unknownCostLines: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const cleanParty = (value: string | undefined) => {
  const text = (value || '').replace(/\ufffd/g, '').trim();
  return text === 'null' || text === 'undefined' ? '' : text;
};

/** One row per sale or purchase, every amount in the invoice's own currency. */
export function profitRows(
  invoices: Invoice[],
  productsById: Map<string, Product>,
  rates: Record<string, number>,
  defaultCurrency: string,
): ProfitRow[] {
  const rows: ProfitRow[] = [];
  for (const inv of invoices) {
    if (inv.type !== 'sale' && inv.type !== 'purchase') continue;
    const base = {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber || '',
      date: num(inv.date),
      party: cleanParty(inv.type === 'sale' ? inv.customerName : inv.supplierName || inv.customerName),
      currency: inv.currency || defaultCurrency,
      tax: num(inv.taxAmount),
    };
    if (inv.type === 'purchase') {
      rows.push({ ...base, type: 'purchase', amount: num(inv.totalAmount), cost: null, profit: null, unknownCostLines: 0 });
      continue;
    }
    const p = saleInvoiceProfit(inv, productsById, rates, defaultCurrency);
    rows.push({ ...base, type: 'sale', amount: p.revenue, cost: p.cost, profit: p.profit, unknownCostLines: p.unknownCostLines });
  }
  return rows;
}

export interface CurrencyProfit {
  currency: string;
  revenue: number;
  cost: number;
  profit: number;
  /** profit / revenue * 100, or 0 without revenue. */
  margin: number;
  saleCount: number;
  unknownCostLines: number;
}

/** Sales totals per currency with no conversion, largest revenue first. */
export function profitsByCurrency(rows: ProfitRow[]): CurrencyProfit[] {
  const map = new Map<string, CurrencyProfit>();
  for (const row of rows) {
    if (row.type !== 'sale') continue;
    const entry = map.get(row.currency) || { currency: row.currency, revenue: 0, cost: 0, profit: 0, margin: 0, saleCount: 0, unknownCostLines: 0 };
    entry.revenue += row.amount;
    entry.cost += row.cost ?? 0;
    entry.saleCount += 1;
    entry.unknownCostLines += row.unknownCostLines;
    map.set(row.currency, entry);
  }
  return [...map.values()]
    .map((e) => {
      const revenue = roundMoney(e.revenue, e.currency);
      const cost = roundMoney(e.cost, e.currency);
      const profit = roundMoney(e.revenue - e.cost, e.currency);
      return { ...e, revenue, cost, profit, margin: revenue > 0 ? (profit / revenue) * 100 : 0 };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export type ProfitRange = 'today' | 'weekly' | 'monthly' | 'all';
export type SeriesStep = 'hour' | 'day' | 'month';

/** Start of the selected period in local time. "All" starts at the oldest row, or now when there are none. */
export function rangeStart(range: ProfitRange, now: number, rows: Pick<ProfitRow, 'date'>[] = []): number {
  const d = new Date(now);
  if (range === 'today') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (range === 'weekly') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
  if (range === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return rows.reduce((min, r) => (r.date > 0 && r.date < min ? r.date : min), now);
}

export function seriesStep(range: ProfitRange, start: number, end: number): SeriesStep {
  if (range === 'today') return 'hour';
  if (range === 'all' && end - start > 62 * 86_400_000) return 'month';
  return 'day';
}

function bucketOf(time: number, step: SeriesStep): number {
  const d = new Date(time);
  if (step === 'hour') return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
  if (step === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function nextBucket(time: number, step: SeriesStep): number {
  const d = new Date(time);
  if (step === 'hour') return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
  if (step === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/**
 * Gross profit per hour, day or month across the whole period, empty buckets included,
 * so the chart shows quiet days as zero instead of skipping them.
 */
export function profitSeries(
  rows: ProfitRow[],
  start: number,
  end: number,
  step: SeriesStep,
  toDisplay: (amount: number, currency: string) => number,
): Array<{ start: number; profit: number }> {
  const buckets = new Map<number, number>();
  for (let t = bucketOf(start, step), guard = 0; t <= end && guard < 1000; t = nextBucket(t, step), guard++) {
    buckets.set(t, 0);
  }
  for (const row of rows) {
    if (row.type !== 'sale' || row.profit === null || row.date < start || row.date > end) continue;
    const key = bucketOf(row.date, step);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + toDisplay(row.profit, row.currency));
  }
  return [...buckets.entries()].map(([s, profit]) => ({ start: s, profit }));
}

/** Rounded to the currency's minor units, no grouping separators, so spreadsheets read it as a number. */
export function plainAmount(value: number, currency: string): string {
  return roundMoney(value, currency).toFixed(currencyDecimals(currency));
}

export function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localStamp = (time: number) => {
  const d = new Date(time);
  return `${localIsoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface ProfitCsvOptions {
  isAr: boolean;
  /** Label / value pairs printed above the table. */
  summary: Array<[string, string]>;
}

export function buildProfitCsv(rows: ProfitRow[], { isAr, summary }: ProfitCsvOptions): string {
  const headers = isAr
    ? ['التاريخ', 'رقم الفاتورة', 'العميل / المورد', 'النوع', 'العملة', 'صافي البيع أو قيمة الشراء', 'الضريبة', 'التكلفة', 'مجمل الربح', 'ملاحظة']
    : ['Date', 'Invoice', 'Customer / supplier', 'Type', 'Currency', 'Net sale or purchase total', 'VAT', 'Cost', 'Gross profit', 'Note'];
  const lines = summary.map(([label, value]) => [csvCell(label), csvCell(value)].join(','));
  lines.push('', headers.map(csvCell).join(','));
  for (const row of rows) {
    const sale = row.type === 'sale';
    const note = row.unknownCostLines > 0
      ? (isAr ? `${row.unknownCostLines} سطر بلا تكلفة: الربح أعلى من الحقيقي` : `${row.unknownCostLines} line(s) without cost: profit overstated`)
      : '';
    lines.push([
      csvCell(localStamp(row.date)),
      csvCell(row.invoiceNumber),
      csvCell(row.party || (sale ? (isAr ? 'زبون نقدي' : 'Walk-in customer') : '')),
      csvCell(sale ? (isAr ? 'بيع' : 'Sale') : (isAr ? 'شراء' : 'Purchase')),
      csvCell(row.currency),
      csvCell(plainAmount(row.amount, row.currency)),
      csvCell(plainAmount(row.tax, row.currency)),
      csvCell(row.cost === null ? '' : plainAmount(row.cost, row.currency)),
      csvCell(row.profit === null ? '' : plainAmount(row.profit, row.currency)),
      csvCell(note),
    ].join(','));
  }
  return `\ufeff${lines.join('\r\n')}`;
}

export interface ProfitReportProduct {
  name: string;
  qty: number;
  revenue: number;
  profit: number;
  unknownCost: boolean;
}

export interface ProfitReportOptions {
  isAr: boolean;
  businessName: string;
  periodLabel: string;
  displayCurrency: string;
  totals: { sales: number; cost: number; net: number; margin: number; purchases: number; unknownCostLines: number };
  byCurrency: CurrencyProfit[];
  /** True when any amount was converted into the display currency. */
  converted: boolean;
  products: ProfitReportProduct[];
  rows: ProfitRow[];
  money: (value: number, currency: string) => string;
  formatDate: (time: number) => string;
}

/** Printable report (print or save as PDF). Every user-supplied value is escaped. */
export function buildProfitReportHtml(o: ProfitReportOptions): string {
  const ar = o.isAr;
  const L = (a: string, e: string) => (ar ? a : e);
  const m = (v: number, c: string) => escapeHtml(o.money(v, c));
  const signed = (v: number | null, c: string) =>
    v === null ? '—' : `<span class="${v < 0 ? 'neg' : 'pos'}">${m(v, c)}</span>`;

  const currencyRows = o.byCurrency.map((c) => `
    <tr><td>${escapeHtml(c.currency)}</td><td>${c.saleCount}</td><td>${m(c.revenue, c.currency)}</td>
    <td>${m(c.cost, c.currency)}</td><td>${signed(c.profit, c.currency)}</td><td>${c.margin.toFixed(1)}%</td></tr>`).join('');

  const productRows = o.products.map((p, i) => `
    <tr><td>${i + 1}</td><td class="start">${escapeHtml(p.name)}</td><td>${escapeHtml(p.qty)}</td>
    <td>${m(p.revenue, o.displayCurrency)}</td><td>${signed(p.profit, o.displayCurrency)}${p.unknownCost ? ' *' : ''}</td></tr>`).join('');

  const ledgerRows = o.rows.map((r) => {
    const sale = r.type === 'sale';
    return `
    <tr><td>${escapeHtml(o.formatDate(r.date))}</td><td>${escapeHtml(r.invoiceNumber)}</td>
    <td class="start">${escapeHtml(r.party || (sale ? L('زبون نقدي', 'Walk-in customer') : '—'))}</td>
    <td>${sale ? L('بيع', 'Sale') : L('شراء', 'Purchase')}</td>
    <td>${m(r.amount, r.currency)}</td>
    <td>${r.cost === null ? '—' : m(r.cost, r.currency)}${r.unknownCostLines > 0 ? ' *' : ''}</td>
    <td>${signed(r.profit, r.currency)}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(L('تقرير الأرباح', 'Profit report'))}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Tahoma, Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 13px; margin: 22px 0 8px; }
  .meta { color: #64748b; margin-top: 4px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; }
  .card b { display: block; font-size: 15px; margin-top: 4px; }
  .note { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 6px 10px; margin-top: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #0f172a; color: #fff; padding: 6px; font-size: 10px; }
  td { border-bottom: 1px solid #e2e8f0; padding: 5px 6px; text-align: center; }
  td.start { text-align: ${ar ? 'right' : 'left'}; }
  tr { break-inside: avoid; }
  .pos { color: #047857; font-weight: bold; }
  .neg { color: #be123c; font-weight: bold; }
  .foot { margin-top: 24px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
  <h1>${escapeHtml(o.businessName || L('تقرير الأرباح', 'Profit report'))}</h1>
  <div class="meta">${escapeHtml(L('تقرير الأرباح', 'Profit report'))} · ${escapeHtml(o.periodLabel)} · ${escapeHtml(L('طُبع في', 'Printed'))} ${escapeHtml(o.formatDate(Date.now()))}</div>

  <div class="cards">
    <div class="card">${L('صافي المبيعات (بدون ضريبة)', 'Net sales (excl. VAT)')}<b>${m(o.totals.sales, o.displayCurrency)}</b></div>
    <div class="card">${L('تكلفة البضاعة المباعة', 'Cost of goods sold')}<b>${m(o.totals.cost, o.displayCurrency)}</b></div>
    <div class="card">${L('مجمل الربح (قبل المصاريف)', 'Gross profit (before expenses)')}<b>${signed(o.totals.net, o.displayCurrency)} · ${o.totals.margin.toFixed(1)}%</b></div>
  </div>
  ${o.converted ? `<p class="note">${escapeHtml(L(
    `الإجمالي محوَّل إلى ${o.displayCurrency} بسعر صرف يوم الطباعة. المبالغ الأصلية لكل عملة في الجدول التالي.`,
    `Totals are converted to ${o.displayCurrency} at the rate on the print date. Original amounts per currency are below.`,
  ))}</p>` : ''}
  ${o.totals.unknownCostLines > 0 ? `<p class="note">${escapeHtml(L(
    `${o.totals.unknownCostLines} سطر مبيع بلا سعر تكلفة، فالربح المعروض أعلى من الحقيقي (معلّمة بـ *).`,
    `${o.totals.unknownCostLines} sold line(s) have no cost, so profit is overstated (marked *).`,
  ))}</p>` : ''}
  ${o.totals.purchases > 0 ? `<p class="meta">${escapeHtml(L('مشتريات الفترة (لا تُخصم من الربح لأنها تدخل المخزون):', 'Purchases in the period (not deducted; they go into stock):'))} ${m(o.totals.purchases, o.displayCurrency)}</p>` : ''}

  ${o.byCurrency.length ? `<h2>${L('حسب العملة', 'By currency')}</h2>
  <table><thead><tr><th>${L('العملة', 'Currency')}</th><th>${L('عدد المبيعات', 'Sales')}</th><th>${L('صافي المبيعات', 'Net sales')}</th><th>${L('التكلفة', 'Cost')}</th><th>${L('مجمل الربح', 'Gross profit')}</th><th>${L('الهامش', 'Margin')}</th></tr></thead>
  <tbody>${currencyRows}</tbody></table>` : ''}

  ${o.products.length ? `<h2>${L('ربح الأصناف', 'Profit by product')} (${escapeHtml(o.displayCurrency)})</h2>
  <table><thead><tr><th>#</th><th>${L('الصنف', 'Product')}</th><th>${L('الكمية', 'Qty')}</th><th>${L('صافي المبيعات', 'Net sales')}</th><th>${L('مجمل الربح', 'Gross profit')}</th></tr></thead>
  <tbody>${productRows}</tbody></table>` : ''}

  <h2>${L('الفواتير (كل فاتورة بعملتها)', 'Invoices (each in its own currency)')}</h2>
  <table><thead><tr><th>${L('التاريخ', 'Date')}</th><th>${L('رقم الفاتورة', 'Invoice')}</th><th>${L('العميل / المورد', 'Customer / supplier')}</th><th>${L('النوع', 'Type')}</th><th>${L('صافي البيع / قيمة الشراء', 'Net sale / purchase')}</th><th>${L('التكلفة', 'Cost')}</th><th>${L('مجمل الربح', 'Gross profit')}</th></tr></thead>
  <tbody>${ledgerRows}</tbody></table>

  <div class="foot">${escapeHtml(appName(ar))}</div>
</body>
</html>`;
}
