import type { Invoice } from '../types';
import { appReceiptPromo } from './brand';
import { formatReceiptMoney, roundMoney } from './exchangeRates';
import { escapeHtml, invoiceVatRate, paymentMethodLabel } from './invoiceDocument';
import { computeInvoiceTotals } from './invoiceTotals';
import { lineQuantityText } from './packs';

export type PaperWidth = 58 | 80;

/** Printable width: thermal heads leave about 5 mm blank on each side. */
export function printableMm(paper: PaperWidth): number {
  return paper === 58 ? 48 : 72;
}

export interface ReceiptInput {
  invoice: Invoice;
  isRtl: boolean;
  paper: PaperWidth;
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  taxRegistrationNumber?: string;
  /** Optional override; thermal receipts default to ASCII {@link formatReceiptMoney}. */
  money?: (amount: number, currency: string) => string;
  formatDate: (ms: number) => string;
}

function receiptTitle(inv: Invoice, isRtl: boolean): string {
  if (inv.type === 'return') return isRtl ? 'مرتجع مبيعات' : 'Sales return';
  if (inv.type === 'purchase') return isRtl ? 'فاتورة شراء' : 'Purchase';
  if (inv.type === 'purchase_return') return isRtl ? 'مرتجع مشتريات' : 'Purchase return';
  return isRtl ? 'إيصال بيع' : 'Sales receipt';
}

/**
 * Totals shown on the slip: always recompute from line totals + discount + VAT so the
 * printed math matches the items even if a stored header drifted.
 */
export function receiptFigures(inv: Invoice) {
  const currency = inv.currency;
  const linesSubtotal = inv.items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const vatRate = invoiceVatRate(inv);
  const totals = computeInvoiceTotals({
    subtotal: linesSubtotal,
    discount: Number(inv.discount) || 0,
    vatRate,
    taxEnabled: vatRate > 0,
    currency,
  });

  const creditPartial = inv.paymentMethod === 'credit' && Number(inv.paidAmount) > 0;
  const showReceived = inv.cashReceived !== undefined && !creditPartial;
  const changeDue = showReceived
    ? roundMoney(Math.max(0, Number(inv.cashReceived) - totals.total), currency)
    : Number(inv.changeDue) > 0
      ? roundMoney(Number(inv.changeDue), currency)
      : 0;

  return {
    ...totals,
    totalAmount: totals.total,
    showReceived,
    cashReceived: showReceived ? roundMoney(Number(inv.cashReceived) || 0, currency) : undefined,
    changeDue,
  };
}

/** A short page to check the printer, the paper width and Arabic text. */
export function buildTestPageHtml(paper: PaperWidth, isRtl: boolean, printerName = ''): string {
  const width = printableMm(paper);
  return `<!doctype html>
<html lang="${isRtl ? 'ar' : 'en'}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 0; size: ${paper}mm auto; }
  html, body { background: #fff; color: #000; }
  body { font-family: Tahoma, Arial, sans-serif; font-size: 12px; margin: 0 auto; padding: 3mm 0; width: ${width}mm; text-align: center; }
  .big { font-size: 16px; font-weight: 700; }
  .edge { border: 1px solid #000; padding: 1mm; margin-top: 2mm; }
</style>
</head>
<body>
  <div class="big">${isRtl ? 'طباعة تجريبية' : 'Test print'}</div>
  <div>${isRtl ? 'مستودعي' : 'Mostawdaee'} · ${paper} ${isRtl ? 'مم' : 'mm'}</div>
  ${printerName ? `<div dir="ltr">${escapeHtml(printerName)}</div>` : ''}
  <div class="edge">${isRtl ? 'يجب أن يظهر هذا الإطار كاملاً من الجهتين' : 'This frame should be fully visible on both sides'}</div>
  <div dir="ltr">0123456789 ABC abc</div>
  <div dir="ltr">${escapeHtml(formatReceiptMoney(12.5, 'JOD'))}</div>
</body>
</html>`;
}

/** A till receipt sized for 58 or 80 mm paper. Every user-supplied value is escaped. */
export function buildReceiptHtml(o: ReceiptInput): string {
  const { invoice: inv, isRtl } = o;
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const moneyFn = o.money || ((amount: number, currency: string) => formatReceiptMoney(amount, currency));
  const m = (v: number | undefined, currency?: string) =>
    escapeHtml(moneyFn(Number(v) || 0, currency || inv.currency));
  const start = isRtl ? 'right' : 'left';
  const end = isRtl ? 'left' : 'right';
  const width = printableMm(o.paper);
  const base = o.paper === 58 ? 10 : 11;
  const sign = inv.type === 'return' || inv.type === 'purchase_return' ? '-' : '';
  const figures = receiptFigures(inv);

  const items = inv.items.map((item) => {
    const qty = Number(item.quantity) || 0;
    const unit = Number(item.unitPrice) || 0;
    const unitLine = qty > 0
      ? `<div class="unit" dir="ltr">${escapeHtml(String(qty))} × ${m(unit)}</div>`
      : '';
    return `
      <tr>
        <td class="name">${escapeHtml(item.description)}${unitLine}</td>
        <td class="qty">${escapeHtml(lineQuantityText(item, isRtl))}</td>
        <td class="amt" dir="ltr">${m(item.total)}</td>
      </tr>`;
  }).join('');

  const row = (label: string, value: string, cls = '') =>
    `<div class="row ${cls}"><span>${label}</span><span dir="ltr">${value}</span></div>`;

  const contact = [o.businessAddress, o.businessPhone].filter((v) => v && v.trim()).map((v) => escapeHtml(v!.trim()));

  return `<!doctype html>
<html lang="${isRtl ? 'ar' : 'en'}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(inv.invoiceNumber)}</title>
<style>
  @page { margin: 0; size: ${o.paper}mm auto; }
  * { box-sizing: border-box; }
  html, body { background: #fff; color: #000; }
  body { font-family: Tahoma, Arial, sans-serif; font-size: ${base}px; line-height: 1.4; margin: 0 auto; padding: 3mm 0; width: ${width}mm; direction: ${isRtl ? 'rtl' : 'ltr'}; }
  .center { text-align: center; }
  .store { font-size: ${base + 4}px; font-weight: 700; }
  .muted { font-size: ${base - 1}px; }
  .title { font-weight: 700; margin-top: 2mm; }
  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: ${base - 1}px; text-align: ${start}; border-bottom: 1px solid #000; padding-bottom: 1mm; }
  td { padding: 1mm 0; vertical-align: top; }
  .name { text-align: ${start}; word-break: break-word; }
  .unit { font-size: ${Math.max(8, base - 2)}px; opacity: 0.85; margin-top: 0.5mm; }
  .qty { text-align: center; white-space: nowrap; padding: 1mm 1.5mm; }
  .amt { text-align: ${end}; white-space: nowrap; }
  .row { display: flex; justify-content: space-between; gap: 2mm; }
  .total { font-size: ${base + 3}px; font-weight: 700; border-top: 1px dashed #000; margin-top: 1mm; padding-top: 1mm; }
  .bold { font-weight: 700; }
  .footer { text-align: center; margin-top: 3mm; }
  .brand-foot { text-align: center; margin-top: 1.5mm; font-size: ${Math.max(8, base - 2)}px; color: #64748b; }
</style>
</head>
<body>
  <div class="center">
    <div class="store">${escapeHtml(o.businessName)}</div>
    ${contact.length ? `<div class="muted">${contact.join(' · ')}</div>` : ''}
    ${o.taxRegistrationNumber?.trim() ? `<div class="muted">${L('الرقم الضريبي', 'Tax No.')}: <span dir="ltr">${escapeHtml(o.taxRegistrationNumber.trim())}</span></div>` : ''}
    <div class="title">${receiptTitle(inv, isRtl)}</div>
    <div class="muted"><span dir="ltr">#${escapeHtml(inv.invoiceNumber)}</span></div>
    <div class="muted">${escapeHtml(o.formatDate(inv.date))}</div>
    ${inv.type === 'return' && inv.returnOfNumber ? `<div class="muted">${L('عن الفاتورة', 'For invoice')} <span dir="ltr">#${escapeHtml(inv.returnOfNumber)}</span></div>` : ''}
    ${inv.customerName?.trim() ? `<div class="muted">${L('العميل', 'Customer')}: ${escapeHtml(inv.customerName.trim())}</div>` : ''}
  </div>
  <div class="rule"></div>
  <table>
    <thead><tr><th>${L('الصنف', 'Item')}</th><th style="text-align:center">${L('الكمية', 'Qty')}</th><th style="text-align:${end}">${L('المبلغ', 'Amount')}</th></tr></thead>
    <tbody>${items}
    </tbody>
  </table>
  <div class="rule"></div>
  ${row(L('المجموع الفرعي', 'Subtotal'), m(figures.subtotal))}
  ${figures.discount > 0 ? row(L('الخصم', 'Discount'), `-${m(figures.discount)}`) : ''}
  ${figures.taxAmount > 0 ? row(L('الضريبة', 'VAT'), m(figures.taxAmount)) : ''}
  ${row(L('الإجمالي', 'Total'), `${sign}${m(figures.totalAmount)}`, 'total')}
  ${row(L('طريقة الدفع', 'Payment'), escapeHtml(paymentMethodLabel(inv.paymentMethod, isRtl, inv.paidAmount, figures.totalAmount)))}
  ${inv.paymentMethod === 'credit' && Number(inv.paidAmount) > 0 ? row(L('المدفوع الآن', 'Paid now'), m(inv.paidAmount), 'bold') : ''}
  ${inv.paymentMethod === 'credit' && Number(inv.debtAmount) > 0 ? row(L('المتبقي آجل', 'On account'), m(inv.debtAmount, inv.debtCurrency || inv.currency), 'bold') : ''}
  ${figures.showReceived ? row(L('المستلم', 'Received'), m(figures.cashReceived), 'bold') : ''}
  ${figures.changeDue > 0 ? row(L('الباقي', 'Change'), m(figures.changeDue), 'bold') : ''}
  <div class="footer">${L('شكراً لزيارتكم', 'Thank you')}</div>
  <div class="brand-foot">${escapeHtml(appReceiptPromo(isRtl))}</div>
</body>
</html>`;
}
