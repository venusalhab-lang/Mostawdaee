import { appInvoicePromo, appName } from './brand';
import { formatMoney } from './exchangeRates';
import { lineQuantityText } from './packs';
import { salePayment } from './salesPayment';
import { purchasePayment } from './suppliers';
import type { Currency, Invoice, InvoiceItem, Product } from '../types';

export function escapeHtml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Prefer the rate stored on the invoice. Old invoices without vatRate derive it from tax/subtotal. */
export function invoiceVatRate(inv: Pick<Invoice, 'vatRate' | 'taxAmount' | 'subtotal'>): number {
  if (typeof inv.vatRate === 'number' && Number.isFinite(inv.vatRate)) {
    return inv.vatRate;
  }
  const sub = Number(inv.subtotal) || 0;
  const tax = Number(inv.taxAmount) || 0;
  if (sub <= 0 || tax <= 0) return 0;
  return Number(((tax / sub) * 100).toFixed(4));
}

export function invoiceItemSku(item: InvoiceItem, products: Product[]): string {
  if (item.sku && item.sku.trim()) return item.sku.trim();
  const product = products.find((p) => p.id === item.productId);
  return product?.sku?.trim() || '';
}

export function paymentMethodLabel(
  method: Invoice['paymentMethod'],
  isRtl: boolean,
  paidAmount?: number,
  totalAmount?: number,
): string {
  switch (method) {
    case 'credit': {
      const total = Number(totalAmount);
      const paid = Number(paidAmount);
      const split = Number.isFinite(total) && Number.isFinite(paid) && paid > 0 && paid < total - 1e-9;
      if (split) return isRtl ? 'نقد + آجل' : 'Cash + credit';
      return isRtl ? 'آجل' : 'On credit';
    }
    case 'card':
      return isRtl ? 'بطاقة' : 'Card';
    case 'wallet':
      return isRtl ? 'محفظة' : 'Wallet';
    case 'cash':
    default:
      return isRtl ? 'نقدي' : 'Cash';
  }
}

export function invoiceTypeLabel(type: Invoice['type'], isRtl: boolean): string {
  if (type === 'return') return isRtl ? 'مرتجع مبيعات' : 'Sales return';
  if (type === 'purchase_return') return isRtl ? 'مرتجع مشتريات' : 'Purchase return';
  return type === 'sale'
    ? (isRtl ? 'مبيعات' : 'Sale')
    : (isRtl ? 'مشتريات' : 'Purchase');
}

export function invoiceDocumentTitle(
  inv: Invoice,
  isRtl: boolean,
  hasTaxRegistration: boolean
): string {
  if (inv.type === 'purchase') {
    return isRtl ? 'فاتورة مشتريات' : 'Purchase Invoice';
  }
  if (inv.type === 'return') {
    return isRtl ? 'إشعار دائن (مرتجع مبيعات)' : 'Credit Note (Sales Return)';
  }
  if (inv.type === 'purchase_return') {
    return isRtl ? 'إشعار مدين (مرتجع مشتريات)' : 'Debit Note (Purchase Return)';
  }
  if (hasTaxRegistration && (Number(inv.taxAmount) || 0) > 0) {
    return isRtl ? 'فاتورة ضريبية' : 'Tax Invoice';
  }
  return isRtl ? 'فاتورة مبيعات' : 'Sales Invoice';
}

export function sumInvoicesByCurrency(
  invoices: Invoice[],
  type: Invoice['type']
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const inv of invoices) {
    if (inv.type !== type) continue;
    const code = inv.currency || 'USD';
    totals[code] = (totals[code] || 0) + (Number(inv.totalAmount) || 0);
  }
  return totals;
}

export function formatCurrencyTotals(
  totals: Record<string, number>,
  emptyLabel: string
): string {
  const parts = Object.entries(totals)
    .filter(([, amount]) => amount !== 0)
    .map(([code, amount]) => formatMoney(amount, code));
  return parts.length ? parts.join(' · ') : emptyLabel;
}

export interface InvoicePrintContext {
  invoice: Invoice;
  products: Product[];
  isRtl: boolean;
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  businessEmail?: string;
  taxRegistrationNumber?: string;
  companyLogoUrl?: string;
  /** Present only when the national e-invoicing system accepted this invoice. */
  einvoice?: { qrDataUrl: string; number?: string };
  /** Quotations and purchase orders reuse the layout with their own title, details and closing note. */
  offer?: { title: string; partyLabel: string; details: { label: string; value: string }[]; note: string };
}

function defaultInvoiceTerms(inv: Invoice, isRtl: boolean): string {
  if (inv.type === 'return') {
    return isRtl
      ? 'إشعار دائن: يُرجى الاحتفاظ به للمطابقة مع فاتورتكم الأصلية. الكميات والمبالغ أعلاه نهائية لهذه العملية.'
      : 'Credit note: keep this document to match against your original invoice. Quantities and amounts above are final for this return.';
  }
  if (inv.type === 'purchase_return') {
    return isRtl
      ? 'إشعار مدين للمورد: يُرجى مطابقة الكميات والمبالغ مع فاتورة الشراء الأصلية.'
      : 'Supplier debit note: please match quantities and amounts to the original purchase.';
  }
  if (inv.type === 'purchase') {
    return isRtl
      ? 'يرجى التحقق من الكميات والأسعار عند الاستلام. أي اختلاف يُبلَّغ فوراً.'
      : 'Please verify quantities and prices on receipt. Report any discrepancy immediately.';
  }
  if (inv.paymentMethod === 'credit') {
    const { paid, owed } = salePayment(inv);
    if (owed > 0 && paid > 0) {
      return isRtl
        ? 'تم استلام جزء من المبلغ نقداً؛ المتبقي مسجّل ديناً على حساب العميل. يُرجى السداد حسب الاتفاق ومراجعة الكميات عند الاستلام.'
        : 'Part of this invoice was paid in cash; the remainder is on the customer account. Please settle as agreed and verify quantities on receipt.';
    }
    if (owed > 0) {
      return isRtl
        ? 'فاتورة آجلة: المبلغ مستحق على حساب العميل حسب الاتفاق. يُرجى مراجعة الكميات والمبالغ عند الاستلام.'
        : 'On-account invoice: the amount is due on the customer account as agreed. Please verify quantities and amounts on receipt.';
    }
  }
  return isRtl
    ? 'يرجى مراجعة الكميات والمبالغ عند الاستلام. الأسعار بالعملة الموضحة أعلاه.'
    : 'Please verify quantities and amounts on receipt. Prices are in the currency shown above.';
}

export function buildInvoicePrintHtml(ctx: InvoicePrintContext): string {
  const {
    invoice: inv,
    products,
    isRtl,
    businessName,
    businessAddress,
    businessPhone,
    businessEmail,
    taxRegistrationNumber,
    companyLogoUrl,
    einvoice,
    offer,
  } = ctx;

  const currency = (inv.currency || 'USD') as Currency;
  const money = (value: number, code: Currency = currency) => escapeHtml(formatMoney(value, code));
  const vat = invoiceVatRate(inv);
  const issued = new Date(inv.date);
  const dateStr = issued.toLocaleDateString(isRtl ? 'ar' : 'en', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const timeStr = issued.toLocaleTimeString(isRtl ? 'ar' : 'en', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const party = (inv.type === 'purchase_return' ? inv.supplierName : inv.customerName || inv.supplierName) || (isRtl ? 'زبون نقدي' : 'Walk-in');
  const isReturn = inv.type === 'return' || inv.type === 'purchase_return';
  const title = offer?.title ?? invoiceDocumentTitle(inv, isRtl, !!taxRegistrationNumber);
  const skuLabel = isRtl ? 'رمز الصنف' : 'SKU';
  const start = isRtl ? 'right' : 'left';
  const end = isRtl ? 'left' : 'right';

  const saleTender = inv.type === 'sale' && inv.paymentMethod === 'credit' ? salePayment(inv) : null;
  const purchaseTender = inv.type === 'purchase' && inv.paymentMethod === 'credit' ? purchasePayment(inv) : null;
  const debtCurrency = (inv.debtCurrency || currency) as Currency;
  const debtShown = Number.isFinite(Number(inv.debtAmount)) ? Number(inv.debtAmount) : (saleTender?.owed ?? 0);

  const itemsHtml = inv.items.map((item, idx) => {
    const sku = invoiceItemSku(item, products);
    return `
      <tr class="${idx % 2 === 0 ? 'odd' : 'even'}">
        <td class="num">${idx + 1}</td>
        <td class="item">
          <div class="item-name">${escapeHtml(item.description)}</div>
          ${sku ? `<div class="item-sku">${skuLabel}: ${escapeHtml(sku)}</div>` : ''}
        </td>
        <td class="qty">${escapeHtml(lineQuantityText(item, isRtl))}</td>
        <td class="unit">${money(item.unitPrice)}</td>
        <td class="amt">${money(item.total)}</td>
      </tr>`;
  }).join('');

  const addressBlock = [
    businessAddress ? `<div>${escapeHtml(businessAddress)}</div>` : '',
    businessPhone ? `<div dir="ltr">${escapeHtml(businessPhone)}</div>` : '',
    businessEmail ? `<div dir="ltr">${escapeHtml(businessEmail)}</div>` : '',
    taxRegistrationNumber
      ? `<div>${isRtl ? 'الرقم الضريبي' : 'Tax No.'}: <span dir="ltr">${escapeHtml(taxRegistrationNumber)}</span></div>`
      : '',
  ].filter(Boolean).join('');

  const logoHtml = companyLogoUrl
    ? `<img class="logo" src="${escapeHtml(companyLogoUrl)}" alt="" referrerPolicy="no-referrer" />`
    : `<div class="logo-fallback" aria-hidden="true">${escapeHtml((businessName || appName(isRtl)).slice(0, 1))}</div>`;

  const paymentBlock = offer
    ? offer.details.map((d) => `
        <div class="meta-cell">
          <span class="lbl">${escapeHtml(d.label)}</span>
          <b>${escapeHtml(d.value)}</b>
        </div>`).join('')
    : `
        <div class="meta-cell">
          <span class="lbl">${isRtl ? 'طريقة الدفع' : 'Payment'}</span>
          <b>${escapeHtml(paymentMethodLabel(inv.paymentMethod, isRtl, inv.paidAmount, inv.totalAmount))}</b>
        </div>
        <div class="meta-cell">
          <span class="lbl">${isRtl ? 'العملة' : 'Currency'}</span>
          <b dir="ltr">${escapeHtml(currency)}</b>
        </div>`;

  const settlementRows = (() => {
    if (offer) return '';
    const rows: string[] = [];
    if (saleTender && saleTender.owed > 0) {
      if (saleTender.paid > 0) {
        rows.push(`<div><span>${isRtl ? 'المدفوع الآن' : 'Paid now'}</span><span dir="ltr">${money(saleTender.paid)}</span></div>`);
      }
      rows.push(`<div class="due"><span>${isRtl ? 'المتبقي آجل' : 'Balance due'}</span><span dir="ltr">${money(debtShown, debtCurrency)}</span></div>`);
    } else if (purchaseTender && purchaseTender.owed > 0) {
      if (purchaseTender.paid > 0) {
        rows.push(`<div><span>${isRtl ? 'المدفوع الآن' : 'Paid now'}</span><span dir="ltr">${money(purchaseTender.paid)}</span></div>`);
      }
      rows.push(`<div class="due"><span>${isRtl ? 'المتبقي للمورد' : 'Still owed to supplier'}</span><span dir="ltr">${money(purchaseTender.owed)}</span></div>`);
    } else if (inv.cashReceived !== undefined && Number(inv.changeDue) > 0) {
      rows.push(`<div><span>${isRtl ? 'المستلم' : 'Received'}</span><span dir="ltr">${money(Number(inv.cashReceived))}</span></div>`);
      rows.push(`<div><span>${isRtl ? 'الباقي للعميل' : 'Change'}</span><span dir="ltr">${money(Number(inv.changeDue))}</span></div>`);
    }
    return rows.join('');
  })();

  const notes = escapeHtml(offer?.note ?? defaultInvoiceTerms(inv, isRtl));
  const showVat = (Number(inv.taxAmount) || 0) > 0 || (Number(inv.vatRate) || 0) > 0;

  return `<!DOCTYPE html>
<html lang="${isRtl ? 'ar' : 'en'}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} #${escapeHtml(inv.invoiceNumber)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Source+Sans+3:wght@400;600;700&display=swap');
    @page { size: A4; margin: 14mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #0f172a;
      background: #fff;
      font: 11.5px/1.45 ${isRtl ? "'Cairo'" : "'Source Sans 3'"}, system-ui, sans-serif;
    }
    h1, h2, p { margin: 0; }
    table { width: 100%; border-collapse: collapse; }
    .wrap { max-width: 180mm; margin: 0 auto; }
    .brand-bar {
      height: 4px;
      background: #0f172a;
      margin: 0 0 18px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e2e8f0;
    }
    .brand { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
    .logo { max-height: 52px; max-width: 110px; object-fit: contain; }
    .logo-fallback {
      width: 48px; height: 48px; border-radius: 10px; background: #0f172a; color: #fff;
      display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; flex-shrink: 0;
    }
    .biz { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; }
    .contact { margin-top: 6px; color: #64748b; font-size: 10.5px; line-height: 1.55; }
    .doc {
      text-align: ${end};
      flex-shrink: 0;
      min-width: 150px;
    }
    .doc-title {
      display: inline-block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #0f172a;
      border: 1px solid #0f172a;
      padding: 5px 10px;
      border-radius: 6px;
    }
    .doc-no {
      margin-top: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 700;
      font-size: 15px;
      direction: ltr;
      unicode-bidi: isolate;
    }
    .doc-sub { margin-top: 4px; color: #64748b; font-size: 10.5px; }
    .parties {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin: 18px 0 16px;
    }
    .card {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      min-height: 72px;
    }
    .lbl { display: block; color: #64748b; font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 4px; }
    .card b { font-size: 13px; font-weight: 700; word-break: break-word; }
    .meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 18px;
      margin-bottom: 18px;
    }
    .meta-cell b { font-size: 12px; font-weight: 700; }
    thead th {
      background: #0f172a;
      color: #fff;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 9px 10px;
      text-align: center;
    }
    thead th.item-h { text-align: ${start}; }
    thead th.amt-h { text-align: ${end}; }
    td.num { width: 28px; text-align: center; color: #94a3b8; font-size: 10px; font-variant-numeric: tabular-nums; }
    td.item { text-align: ${start}; }
    td.qty, td.unit { text-align: center; font-variant-numeric: tabular-nums; }
    td.unit, td.amt { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    td.amt { text-align: ${end}; font-weight: 700; }
    td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr.even td { background: #f8fafc; }
    .item-name { font-weight: 700; color: #0f172a; }
    .item-sku { margin-top: 2px; font-size: 9.5px; color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .below {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 20px;
      margin-top: 16px;
      align-items: start;
    }
    .totals {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .totals div { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 11.5px; }
    .totals span:last-child { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .totals .grand {
      margin-top: 6px;
      padding-top: 10px;
      border-top: 1.5px solid #0f172a;
      font-size: 14px;
      font-weight: 800;
    }
    .totals .due { color: #92400e; font-weight: 700; }
    .notes-box {
      color: #475569;
      font-size: 10.5px;
      line-height: 1.55;
      padding: 10px 12px;
      background: #f8fafc;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
    }
    .notes-box .lbl { margin-bottom: 6px; }
    .einvoice {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-top: 18px;
      padding: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
    }
    .einvoice img { width: 96px; height: 96px; }
    .einvoice .t { font-size: 11px; color: #334155; font-weight: 700; }
    .einvoice .n { margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    .signs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 48px;
      margin-top: 40px;
    }
    .sign {
      border-top: 1px solid #cbd5e1;
      padding-top: 8px;
      color: #64748b;
      font-size: 10.5px;
      text-align: center;
      min-height: 48px;
    }
    .foot {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      color: #94a3b8;
      font-size: 9.5px;
      line-height: 1.5;
    }
    .foot .promo { color: #64748b; }
    @media print {
      thead th, .brand-bar, .logo-fallback, tr.even td {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand-bar"></div>
    <header class="head">
      <div class="brand">
        ${logoHtml}
        <div>
          <h1 class="biz">${escapeHtml(businessName)}</h1>
          ${addressBlock ? `<div class="contact">${addressBlock}</div>` : ''}
        </div>
      </div>
      <div class="doc">
        <div class="doc-title">${escapeHtml(title)}</div>
        <div class="doc-no">#${escapeHtml(inv.invoiceNumber)}</div>
        <div class="doc-sub">${escapeHtml(dateStr)} · ${escapeHtml(timeStr)}</div>
      </div>
    </header>

    <section class="parties">
      <div class="card">
        <span class="lbl">${isRtl ? 'من' : 'From'}</span>
        <b>${escapeHtml(businessName)}</b>
      </div>
      <div class="card">
        <span class="lbl">${escapeHtml(offer?.partyLabel ?? (inv.type === 'purchase' || inv.type === 'purchase_return' ? (isRtl ? 'المورد' : 'Supplier') : (isRtl ? 'إلى / العميل' : 'Bill to')))}</span>
        <b>${escapeHtml(party)}</b>
      </div>
    </section>

    <section class="meta">
      ${paymentBlock}
      ${isReturn && inv.returnOfNumber ? `
        <div class="meta-cell">
          <span class="lbl">${isRtl ? 'عن الفاتورة' : 'For invoice'}</span>
          <b dir="ltr">#${escapeHtml(inv.returnOfNumber)}</b>
        </div>` : ''}
      ${isReturn && inv.returnReason ? `
        <div class="meta-cell" style="grid-column:1 / -1">
          <span class="lbl">${isRtl ? 'سبب الإرجاع' : 'Reason'}</span>
          <b>${escapeHtml(inv.returnReason)}</b>
        </div>` : ''}
    </section>

    <table>
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th class="item-h">${isRtl ? 'الصنف' : 'Item'}</th>
          <th style="width:14%">${isRtl ? 'الكمية' : 'Qty'}</th>
          <th style="width:18%">${isRtl ? 'سعر الوحدة' : 'Unit price'}</th>
          <th class="amt-h" style="width:20%">${isRtl ? 'المبلغ' : 'Amount'}</th>
        </tr>
      </thead>
      <tbody>${itemsHtml || `<tr><td colspan="5" style="padding:16px;text-align:center;color:#94a3b8">${isRtl ? 'لا توجد أصناف' : 'No line items'}</td></tr>`}</tbody>
    </table>

    <div class="below">
      <div class="notes-box">
        <span class="lbl">${isRtl ? 'ملاحظات' : 'Notes'}</span>
        <div>${notes}</div>
      </div>
      <div class="totals">
        <div><span>${isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span><span dir="ltr">${money(inv.subtotal)}</span></div>
        ${Number(inv.discount) > 0 ? `<div><span>${isRtl ? 'الخصم' : 'Discount'}</span><span dir="ltr">−${money(Number(inv.discount))}</span></div>` : ''}
        ${showVat ? `<div><span>${isRtl ? 'الضريبة' : 'VAT'} (${escapeHtml(String(vat))}%)</span><span dir="ltr">${money(inv.taxAmount)}</span></div>` : ''}
        <div class="grand"><span>${isRtl ? 'الإجمالي' : 'Total'}</span><span dir="ltr">${money(inv.totalAmount)}</span></div>
        ${settlementRows}
      </div>
    </div>

    ${einvoice?.qrDataUrl ? `
    <div class="einvoice">
      <img src="${escapeHtml(einvoice.qrDataUrl)}" alt="QR" />
      <div>
        <div class="t">${isRtl ? 'فاتورة مسجّلة في نظام الفوترة الوطني الأردني' : "Registered with Jordan's National Invoicing System"}</div>
        ${einvoice.number ? `<div class="n" dir="ltr">${escapeHtml(einvoice.number)}</div>` : ''}
      </div>
    </div>` : ''}

    <div class="signs">
      <div class="sign">${isRtl ? 'توقيع المستلم' : 'Received by'}</div>
      <div class="sign">${isRtl ? 'ختم / توقيع' : 'Stamp / signed'} · ${escapeHtml(businessName)}</div>
    </div>

    <footer class="foot">
      <div class="promo">${escapeHtml(appInvoicePromo(isRtl))}</div>
    </footer>
  </div>
</body>
</html>`;
}
