import { appName } from './brand';
import { formatMoney } from './exchangeRates';
import { lineQuantityText } from './packs';
import type { Invoice, InvoiceItem, Product } from '../types';

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
  isRtl: boolean
): string {
  switch (method) {
    case 'credit':
      return isRtl ? 'آجل' : 'On credit';
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

  const currency = inv.currency || 'USD';
  const money = (value: number) => escapeHtml(formatMoney(value, currency));
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

  const itemsHtml = inv.items.map((item, idx) => {
    const sku = invoiceItemSku(item, products);
    return `
      <tr style="background:${idx % 2 === 0 ? '#fff' : '#f8fafc'}">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:${isRtl ? 'right' : 'left'}">
          <div style="font-weight:700;color:#0f172a">${escapeHtml(item.description)}</div>
          ${sku ? `<div style="font-size:10px;color:#64748b;margin-top:2px;font-family:ui-monospace,monospace">${skuLabel}: ${escapeHtml(sku)}</div>` : ''}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${escapeHtml(lineQuantityText(item, isRtl))}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:ui-monospace,monospace">${money(item.unitPrice)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:${isRtl ? 'left' : 'right'};font-family:ui-monospace,monospace;font-weight:700">${money(item.total)}</td>
      </tr>`;
  }).join('');

  const contactLines = [
    businessAddress ? escapeHtml(businessAddress) : '',
    businessPhone ? escapeHtml(businessPhone) : '',
    businessEmail ? escapeHtml(businessEmail) : '',
  ].filter(Boolean).join(' · ');

  const logoHtml = companyLogoUrl
    ? `<img src="${escapeHtml(companyLogoUrl)}" alt="" style="max-height:56px;max-width:120px;object-fit:contain" referrerPolicy="no-referrer" />`
    : '';

  return `<!DOCTYPE html>
<html lang="${isRtl ? 'ar' : 'en'}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} ${escapeHtml(inv.invoiceNumber)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Inter:wght@400;600;700&display=swap');
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #0f172a;
      background: #fff;
      font: 12px/1.5 ${isRtl ? "'Cairo'" : "'Inter'"}, system-ui, sans-serif;
    }
    h1, h2, p { margin: 0; }
    table { width: 100%; border-collapse: collapse; }
    .wrap { max-width: 760px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
    .biz { font-size: 20px; font-weight: 700; }
    .muted { color: #64748b; font-size: 11px; }
    .title { margin: 20px 0 16px; font-size: 16px; font-weight: 700; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 20px; }
    .meta span { color: #64748b; }
    .meta b { font-weight: 700; color: #0f172a; }
    th { background: #0f172a; color: #fff; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; padding: 9px 12px; }
    .totals { width: 280px; margin-${isRtl ? 'right' : 'left'}: auto; margin-top: 16px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals .grand { margin-top: 8px; padding-top: 10px; border-top: 1px solid #0f172a; font-size: 15px; font-weight: 700; }
    .notes { margin-top: 28px; color: #475569; font-size: 11px; }
    .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 36px; }
    .sign { border-top: 1px solid #cbd5e1; padding-top: 8px; color: #64748b; font-size: 11px; text-align: center; }
    .foot { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 10px; }
    @media print {
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="head">
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          ${logoHtml}
          <div>
            <h1 class="biz">${escapeHtml(businessName)}</h1>
            ${contactLines ? `<p class="muted">${contactLines}</p>` : ''}
            ${taxRegistrationNumber ? `<p class="muted">${isRtl ? 'الرقم الضريبي' : 'Tax No.'}: ${escapeHtml(taxRegistrationNumber)}</p>` : ''}
          </div>
        </div>
      </div>
      <div style="text-align:${isRtl ? 'left' : 'right'}">
        <div class="title">${escapeHtml(title)}</div>
        <div style="font-family:ui-monospace,monospace;font-weight:700;font-size:14px">#${escapeHtml(inv.invoiceNumber)}</div>
      </div>
    </header>

    <section class="meta">
      <div><span>${isRtl ? 'التاريخ' : 'Date'}</span><br/><b>${escapeHtml(dateStr)} · ${escapeHtml(timeStr)}</b></div>
      <div><span>${escapeHtml(offer?.partyLabel ?? (inv.type === 'purchase' ? (isRtl ? 'من' : 'From') : (isRtl ? 'إلى' : 'Bill to')))}</span><br/><b>${escapeHtml(party)}</b></div>
      ${offer
        ? offer.details.map((d) => `<div><span>${escapeHtml(d.label)}</span><br/><b>${escapeHtml(d.value)}</b></div>`).join('')
        : `<div><span>${isRtl ? 'طريقة الدفع' : 'Payment'}</span><br/><b>${escapeHtml(paymentMethodLabel(inv.paymentMethod, isRtl))}</b></div>`}
      <div><span>${isRtl ? 'العملة' : 'Currency'}</span><br/><b>${escapeHtml(currency)}</b></div>
      ${isReturn && inv.returnOfNumber ? `<div><span>${isRtl ? 'عن الفاتورة' : 'For invoice'}</span><br/><b dir="ltr">#${escapeHtml(inv.returnOfNumber)}</b></div>` : ''}
      ${isReturn && inv.returnReason ? `<div style="grid-column:1 / -1"><span>${isRtl ? 'سبب الإرجاع' : 'Reason'}</span><br/><b>${escapeHtml(inv.returnReason)}</b></div>` : ''}
    </section>

    <table>
      <thead>
        <tr>
          <th style="text-align:${isRtl ? 'right' : 'left'}">${isRtl ? 'الصنف' : 'Item'}</th>
          <th style="width:12%">${isRtl ? 'الكمية' : 'Qty'}</th>
          <th style="width:20%">${isRtl ? 'سعر الوحدة' : 'Unit'}</th>
          <th style="width:22%;text-align:${isRtl ? 'left' : 'right'}">${isRtl ? 'المجموع' : 'Amount'}</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <div class="totals">
      <div><span>${isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span><span>${money(inv.subtotal)}</span></div>
      ${Number(inv.discount) > 0 ? `<div><span>${isRtl ? 'الخصم' : 'Discount'}</span><span>-${money(Number(inv.discount))}</span></div>` : ''}
      <div><span>${isRtl ? 'الضريبة' : 'VAT'} (${escapeHtml(vat)}%)</span><span>${money(inv.taxAmount)}</span></div>
      <div class="grand"><span>${isRtl ? 'الإجمالي' : 'Total'}</span><span>${money(inv.totalAmount)}</span></div>
    </div>

    ${einvoice?.qrDataUrl ? `
    <div style="display:flex;align-items:center;gap:14px;margin-top:24px;padding:12px;border:1px solid #e2e8f0;border-radius:10px">
      <img src="${escapeHtml(einvoice.qrDataUrl)}" alt="QR" style="width:110px;height:110px" />
      <div style="font-size:11px;color:#334155">
        <div style="font-weight:700">${isRtl ? 'فاتورة مسجّلة في نظام الفوترة الوطني الأردني' : "Registered with Jordan's National Invoicing System"}</div>
        ${einvoice.number ? `<div style="margin-top:4px;font-family:ui-monospace,monospace">${escapeHtml(einvoice.number)}</div>` : ''}
      </div>
    </div>` : ''}

    <p class="notes">${escapeHtml(offer?.note ?? (isRtl ? 'يرجى مراجعة الكميات والمبالغ عند الاستلام.' : 'Please verify quantities and amounts on receipt.'))}</p>

    <div class="signs">
      <div class="sign">${isRtl ? 'توقيع المستلم' : 'Received by'}</div>
      <div class="sign">${escapeHtml(businessName)}</div>
    </div>

    <footer class="foot">${escapeHtml(appName(isRtl))}</footer>
  </div>
</body>
</html>`;
}
