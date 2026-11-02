import type { Shift, ShiftCurrencyTotals } from '../types';
import { escapeHtml } from './invoiceDocument';
import { cashDifference } from './shifts';
import { printableMm, type PaperWidth } from './receipt';

export interface ShiftReportOptions {
  isAr: boolean;
  businessName: string;
  shift: Shift;
  /** The frozen summary of a closed shift, or the live one while it is open. */
  totals: ShiftCurrencyTotals[];
  money: (value: number, currency: string) => string;
  formatDate: (time: number) => string;
  paper?: PaperWidth;
}

/** Z-report (closed shift) or X-report (open shift), sized for receipt paper (80 mm unless told otherwise). Every user-supplied value is escaped. */
export function buildShiftReportHtml(o: ShiftReportOptions): string {
  const ar = o.isAr;
  const L = (a: string, e: string) => (ar ? a : e);
  const closed = o.shift.status === 'closed';
  const m = (v: number, c: string) => escapeHtml(o.money(v, c));
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="v">${value}</td></tr>`;

  const sections = o.totals.map((t) => {
    const diff = closed ? cashDifference(t, o.shift.counted) : null;
    const counted = o.shift.counted?.[t.currency];
    return `
    <h2>${escapeHtml(t.currency)}</h2>
    <table>
      ${row(L('عدد المبيعات', 'Sales'), String(t.salesCount))}
      ${row(L('إجمالي المبيعات', 'Total sales'), m(t.sales, t.currency), 'b')}
      ${row(L('  نقدي', '  Cash'), m(t.byMethod.cash, t.currency))}
      ${row(L('  بطاقة', '  Card'), m(t.byMethod.card, t.currency))}
      ${row(L('  محفظة', '  Wallet'), m(t.byMethod.wallet, t.currency))}
      ${row(L('  آجل', '  On credit'), m(t.byMethod.credit, t.currency))}
      ${row(L('الخصومات', 'Discounts'), m(t.discounts, t.currency))}
      ${row(L('الضريبة', 'VAT'), m(t.tax, t.currency))}
      ${row(L(`المرتجعات (${t.returnsCount})`, `Returns (${t.returnsCount})`), m(t.returns, t.currency))}
    </table>
    <table class="cash">
      ${row(L('رصيد الافتتاح', 'Opening float'), m(t.openingFloat, t.currency))}
      ${row(L('+ مبيعات نقدية', '+ Cash sales'), m(t.cashSales, t.currency))}
      ${row(L('− مرتجعات نقدية', '− Cash refunds'), m(t.cashRefunds, t.currency))}
      ${row(L('النقد المتوقع في الدرج', 'Expected cash in drawer'), m(t.expectedCash, t.currency), 'b')}
      ${closed ? row(L('النقد المعدود', 'Counted cash'), counted === undefined ? '—' : m(Number(counted), t.currency), 'b') : ''}
      ${diff === null ? '' : row(
        diff === 0 ? L('مطابق', 'Balanced') : diff > 0 ? L('زيادة', 'Over') : L('عجز', 'Short'),
        m(Math.abs(diff), t.currency),
        diff === 0 ? 'b ok' : 'b bad',
      )}
    </table>`;
  }).join('');

  const by = o.shift.userName || o.shift.actorEmail || '';
  const closer = o.shift.closedByEmail && o.shift.closedByEmail !== o.shift.actorEmail ? o.shift.closedByEmail : '';
  const notes = [o.shift.openingNotes, o.shift.closingNotes].filter((n) => n && n.trim());

  return `<!DOCTYPE html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(closed ? L('تقرير إغلاق الوردية', 'Z-report') : L('تقرير وردية مفتوحة', 'X-report'))}</title>
<style>
  @page { size: ${o.paper ?? 80}mm auto; margin: 0; }
  body { font-family: Tahoma, Arial, sans-serif; color: #000; background: #fff; font-size: ${o.paper === 58 ? 10 : 11}px; margin: 0 auto; padding: 3mm 0; max-width: ${printableMm(o.paper ?? 80)}mm; }
  h1 { font-size: 14px; text-align: center; margin: 0; }
  .kind { text-align: center; font-weight: bold; margin: 4px 0 8px; font-size: 12px; }
  .meta { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; }
  .meta div { display: flex; justify-content: space-between; gap: 6px; }
  h2 { font-size: 12px; margin: 10px 0 4px; border-bottom: 1px solid #000; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; white-space: pre; }
  td.v { text-align: ${ar ? 'left' : 'right'}; }
  tr.b td { font-weight: bold; }
  table.cash { margin-top: 4px; border-top: 1px dashed #000; }
  tr.bad td { text-decoration: underline; }
  .notes { margin-top: 8px; border-top: 1px dashed #000; padding-top: 4px; white-space: pre-wrap; }
  .foot { margin-top: 10px; text-align: center; font-size: 10px; }
  .sign { margin-top: 18px; display: flex; justify-content: space-between; gap: 8px; font-size: 10px; }
  .sign span { flex: 1; border-top: 1px solid #000; padding-top: 2px; text-align: center; }
</style>
</head>
<body>
  <h1>${escapeHtml(o.businessName || L('مستودعي', 'Mostawdaee'))}</h1>
  <div class="kind">${escapeHtml(closed ? L('تقرير إغلاق الوردية (Z)', 'Shift close report (Z)') : L('تقرير وردية مفتوحة (X)', 'Open shift report (X)'))}</div>
  <div class="meta">
    <div><span>${escapeHtml(L('رقم الوردية', 'Shift'))}</span><span>${escapeHtml(o.shift.id.slice(0, 8).toUpperCase())}</span></div>
    ${by ? `<div><span>${escapeHtml(L('الكاشير', 'Cashier'))}</span><span>${escapeHtml(by)}</span></div>` : ''}
    <div><span>${escapeHtml(L('الافتتاح', 'Opened'))}</span><span>${escapeHtml(o.formatDate(o.shift.openedAt))}</span></div>
    ${closed && o.shift.closedAt ? `<div><span>${escapeHtml(L('الإغلاق', 'Closed'))}</span><span>${escapeHtml(o.formatDate(o.shift.closedAt))}</span></div>` : ''}
    ${closer ? `<div><span>${escapeHtml(L('أغلقها', 'Closed by'))}</span><span>${escapeHtml(closer)}</span></div>` : ''}
  </div>
  ${sections}
  ${notes.length ? `<div class="notes">${notes.map((n) => escapeHtml(n!)).join('<br/>')}</div>` : ''}
  ${closed ? `<div class="sign"><span>${escapeHtml(L('توقيع الكاشير', 'Cashier'))}</span><span>${escapeHtml(L('توقيع المسؤول', 'Supervisor'))}</span></div>` : ''}
  <div class="foot">${escapeHtml(L('طُبع في', 'Printed'))} ${escapeHtml(o.formatDate(Date.now()))}</div>
</body>
</html>`;
}
