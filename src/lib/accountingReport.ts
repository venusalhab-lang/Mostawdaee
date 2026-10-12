import { currencyDecimals, formatMoney } from './exchangeRates';
import { escapeHtml } from './invoiceDocument';
import { fromMinor } from './accounting';

/** One printed row of a financial statement. Amounts are minor units of the report currency; null leaves the cell empty. */
export interface ReportRow {
  label: string;
  code?: string;
  amounts: (number | null)[];
  kind?: 'section' | 'line' | 'total';
}

export interface AccountingReport {
  isAr: boolean;
  businessName: string;
  title: string;
  /** Period or "as of" date. */
  subtitle: string;
  currency: string;
  /** Headers of the amount columns. */
  columns: string[];
  rows: ReportRow[];
  notes?: string[];
}

export function buildAccountingReportHtml(r: AccountingReport, locale: string): string {
  const L = (ar: string, en: string) => (r.isAr ? ar : en);
  const money = (minor: number | null) => (minor === null ? '' : formatMoney(fromMinor(minor, r.currency), r.currency, locale));
  const body = r.rows.map((row) => {
    const cls = row.kind === 'section' ? 'section' : row.kind === 'total' ? 'total' : '';
    const cells = r.columns.map((_, i) => {
      const v = row.amounts[i] ?? null;
      return `<td class="num${v !== null && v < 0 ? ' neg' : ''}">${escapeHtml(money(v))}</td>`;
    }).join('');
    return `<tr class="${cls}"><td class="code">${escapeHtml(row.code || '')}</td><td>${escapeHtml(row.label)}</td>${cells}</tr>`;
  }).join('');
  const notes = (r.notes || []).map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('');
  return `<!doctype html><html lang="${r.isAr ? 'ar' : 'en'}" dir="${r.isAr ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${escapeHtml(r.title)}</title>
<style>
@page { size: A4; margin: 14mm; }
body { font-family: Tahoma, Arial, sans-serif; color: #0f172a; font-size: 12px; }
h1 { font-size: 18px; margin: 0 0 4px; }
.meta { color: #475569; margin-bottom: 14px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: start; }
th { background: #f1f5f9; font-weight: 700; }
td.num, th.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
td.code { color: #64748b; width: 52px; }
tr.section td { background: #f8fafc; font-weight: 700; }
tr.total td { font-weight: 700; border-top: 2px solid #0f172a; }
.neg { color: #b91c1c; }
.note { color: #92400e; margin: 10px 0 0; }
</style></head><body>
<h1>${escapeHtml(r.title)}</h1>
<div class="meta">${escapeHtml(r.businessName)}${r.businessName ? ' — ' : ''}${escapeHtml(r.subtitle)} — ${escapeHtml(L('العملة', 'Currency'))}: ${escapeHtml(r.currency)}</div>
<table><thead><tr><th>${escapeHtml(L('رمز', 'Code'))}</th><th>${escapeHtml(L('البند', 'Item'))}</th>${r.columns.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join('')}</tr></thead>
<tbody>${body}</tbody></table>${notes}
</body></html>`;
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function buildAccountingReportCsv(r: AccountingReport): string {
  const d = currencyDecimals(r.currency);
  const plain = (minor: number | null) => (minor === null ? '' : fromMinor(minor, r.currency).toFixed(d));
  const out = [
    [r.title, r.subtitle, r.currency].map(csvCell).join(','),
    [r.isAr ? 'رمز' : 'Code', r.isAr ? 'البند' : 'Item', ...r.columns].map(csvCell).join(','),
    ...r.rows.map((row) => [row.code || '', row.label, ...r.columns.map((_, i) => plain(row.amounts[i] ?? null))].map(csvCell).join(',')),
    ...(r.notes || []).map((n) => csvCell(n)),
  ];
  return `\uFEFF${out.join('\r\n')}\r\n`;
}
