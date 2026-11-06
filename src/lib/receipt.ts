import type { Invoice, InvoiceItem } from '../types';
import { appReceiptPromo } from './brand';
import { currencyDecimals, formatReceiptMoney, roundMoney } from './exchangeRates';
import { escapeHtml, invoiceVatRate, paymentMethodLabel } from './invoiceDocument';
import { computeInvoiceTotals } from './invoiceTotals';
import { isPackLine, lineQuantityText } from './packs';

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
  formatDate: (ms: number) => string;
}

function receiptTitle(inv: Invoice, isRtl: boolean): string {
  if (inv.type === 'return') return isRtl ? 'مرتجع مبيعات' : 'Sales return';
  if (inv.type === 'purchase') return isRtl ? 'فاتورة شراء' : 'Purchase';
  if (inv.type === 'purchase_return') return isRtl ? 'مرتجع مشتريات' : 'Purchase return';
  return isRtl ? 'إيصال بيع' : 'Sales receipt';
}

/** Amount only (ASCII, fixed decimals). Currency is printed once on the slip. */
export function formatReceiptAmount(value: number, code: string): string {
  const d = currencyDecimals(code);
  return roundMoney(Number(value) || 0, code).toFixed(d);
}

/** Line amount the merchant expects: unit price × quantity (not a stale stored total). */
export function receiptLineAmount(item: Pick<InvoiceItem, 'quantity' | 'unitPrice' | 'total'>, currency: string): number {
  const qty = Number(item.quantity) || 0;
  const unit = Number(item.unitPrice) || 0;
  if (qty > 0 && unit >= 0) return roundMoney(qty * unit, currency);
  return roundMoney(Number(item.total) || 0, currency);
}

/**
 * Totals from price×qty lines + discount + VAT so 5 × 2 prints as amount 10,
 * subtotal 10, total 10 — with unit price still visible as 5 on the slip.
 */
export function receiptFigures(inv: Invoice) {
  const currency = inv.currency;
  const linesSubtotal = inv.items.reduce((sum, item) => sum + receiptLineAmount(item, currency), 0);
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
  <div dir="ltr">5.000 x 2 = 10.000</div>
  <div dir="ltr">${escapeHtml(formatReceiptMoney(12.5, 'JOD'))}</div>
</body>
</html>`;
}

/** A till receipt sized for 58 or 80 mm paper. Every user-supplied value is escaped. */
export function buildReceiptHtml(o: ReceiptInput): string {
  const { invoice: inv, isRtl } = o;
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const code = inv.currency;
  const amt = (v: number | undefined) => escapeHtml(formatReceiptAmount(Number(v) || 0, code));
  const width = printableMm(o.paper);
  const base = o.paper === 58 ? 11 : 12;
  const sign = inv.type === 'return' || inv.type === 'purchase_return' ? '-' : '';
  const figures = receiptFigures(inv);

  const items = inv.items.map((item) => {
    const qty = Number(item.quantity) || 0;
    const unit = Number(item.unitPrice) || 0;
    const lineTotal = receiptLineAmount(item, code);
    const qtyLabel = lineQuantityText(item, isRtl);
    const packNote = isPackLine(item)
      ? `<div class="meta">${escapeHtml(isRtl ? 'بيع بالعبوة' : 'Sold by pack')} · ${escapeHtml(qtyLabel)}</div>`
      : '';
    // Price × qty = amount, all labeled — so 5 and 2 are visible, not only the 10.
    return `<div class="line">
      <div class="desc">${escapeHtml(item.description)}</div>
      ${packNote}
      <table class="calc">
        <tr>
          <td class="k">${L('السعر', 'Price')}</td>
          <td class="v" dir="ltr">${amt(unit)}</td>
        </tr>
        <tr>
          <td class="k">${L('الكمية', 'Qty')}</td>
          <td class="v" dir="ltr">${escapeHtml(String(qty))}${isPackLine(item) ? ` (${escapeHtml(qtyLabel)})` : ''}</td>
        </tr>
        <tr class="sum">
          <td class="k">${L('المبلغ', 'Amount')}</td>
          <td class="v" dir="ltr">${amt(lineTotal)}</td>
        </tr>
      </table>
    </div>`;
  }).join('');

  const totalRow = (label: string, value: string, strong = false) =>
    `<tr class="${strong ? 'grand' : ''}"><td class="k">${escapeHtml(label)}</td><td class="v" dir="ltr">${value}</td></tr>`;

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
  body {
    font-family: Tahoma, Arial, sans-serif;
    font-size: ${base}px;
    line-height: 1.35;
    margin: 0 auto;
    padding: 3mm 0;
    width: ${width}mm;
    direction: ${isRtl ? 'rtl' : 'ltr'};
  }
  .center { text-align: center; }
  .store { font-size: ${base + 3}px; font-weight: 700; }
  .muted { font-size: ${base - 1}px; }
  .title { font-weight: 700; margin-top: 2mm; }
  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  .line { margin: 2mm 0 3mm; }
  .desc { font-weight: 700; margin-bottom: 1mm; word-break: break-word; }
  .meta { font-size: ${Math.max(9, base - 2)}px; margin-bottom: 1mm; }
  table.calc, table.sums { width: 100%; border-collapse: collapse; }
  table.calc td, table.sums td { padding: 0.8mm 0; vertical-align: baseline; }
  td.k { text-align: ${isRtl ? 'right' : 'left'}; padding-${isRtl ? 'left' : 'right'}: 2mm; }
  td.v {
    text-align: ${isRtl ? 'left' : 'right'};
    white-space: nowrap;
    font-family: "Courier New", Courier, monospace;
    font-weight: 700;
    width: 42%;
  }
  tr.sum td { border-top: 1px dotted #000; padding-top: 1.2mm; }
  table.sums tr.grand td { font-size: ${base + 2}px; border-top: 1px dashed #000; padding-top: 2mm; font-weight: 700; }
  .footer { text-align: center; margin-top: 3mm; }
  .brand-foot { text-align: center; margin-top: 1.5mm; font-size: ${Math.max(8, base - 2)}px; }
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
    <div class="muted" dir="ltr">${L('العملة', 'Currency')}: ${escapeHtml(code)}</div>
    ${inv.type === 'return' && inv.returnOfNumber ? `<div class="muted">${L('عن الفاتورة', 'For invoice')} <span dir="ltr">#${escapeHtml(inv.returnOfNumber)}</span></div>` : ''}
    ${inv.customerName?.trim() ? `<div class="muted">${L('العميل', 'Customer')}: ${escapeHtml(inv.customerName.trim())}</div>` : ''}
  </div>
  <div class="rule"></div>
  ${items}
  <div class="rule"></div>
  <table class="sums">
    ${totalRow(L('المجموع الفرعي', 'Subtotal'), amt(figures.subtotal))}
    ${figures.discount > 0 ? totalRow(L('الخصم', 'Discount'), `-${amt(figures.discount)}`) : ''}
    ${figures.taxAmount > 0 ? totalRow(L('الضريبة', 'VAT'), amt(figures.taxAmount)) : ''}
    ${totalRow(L('الإجمالي', 'Total'), `${sign}${amt(figures.totalAmount)}`, true)}
    ${totalRow(L('الدفع', 'Payment'), escapeHtml(paymentMethodLabel(inv.paymentMethod, isRtl, inv.paidAmount, figures.totalAmount)))}
    ${inv.paymentMethod === 'credit' && Number(inv.paidAmount) > 0 ? totalRow(L('المدفوع', 'Paid'), amt(inv.paidAmount)) : ''}
    ${inv.paymentMethod === 'credit' && Number(inv.debtAmount) > 0 ? totalRow(L('آجل', 'Credit'), escapeHtml(formatReceiptAmount(Number(inv.debtAmount) || 0, inv.debtCurrency || code)) + ' ' + escapeHtml(inv.debtCurrency || code)) : ''}
    ${figures.showReceived ? totalRow(L('المستلم', 'Received'), amt(figures.cashReceived)) : ''}
    ${figures.changeDue > 0 ? totalRow(L('الباقي', 'Change'), amt(figures.changeDue)) : ''}
  </table>
  <div class="footer">${L('شكراً لزيارتكم', 'Thank you')}</div>
  <div class="brand-foot">${escapeHtml(appReceiptPromo(isRtl))}</div>
</body>
</html>`;
}
