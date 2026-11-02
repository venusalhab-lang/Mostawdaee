import type { AppSettings, Product, TradeOrder } from '../types';
import { buildInvoicePrintHtml } from './invoiceDocument';
import { orderAsPrintable, orderKindLabel } from './orders';

const day = (ms: number, isRtl: boolean) =>
  new Date(ms).toLocaleDateString(isRtl ? 'ar' : 'en', { day: 'numeric', month: 'long', year: 'numeric' });

export function buildOrderPrintHtml(order: TradeOrder, settings: AppSettings | null, products: Product[], isRtl: boolean): string {
  const isQuote = order.kind === 'quote';
  const details: { label: string; value: string }[] = [];
  if (isQuote && order.validUntil) details.push({ label: isRtl ? 'صالح حتى' : 'Valid until', value: day(order.validUntil, isRtl) });
  if (!isQuote && order.expectedDate) details.push({ label: isRtl ? 'موعد التسليم المطلوب' : 'Requested delivery', value: day(order.expectedDate, isRtl) });

  const fallbackNote = isQuote
    ? (isRtl ? 'هذا عرض سعر وليس فاتورة. الكميات تخضع للتوفر عند التأكيد.' : 'This is a quotation, not an invoice. Quantities are subject to availability on confirmation.')
    : (isRtl ? 'يرجى تأكيد الكميات والأسعار وموعد التسليم.' : 'Please confirm quantities, prices and the delivery date.');

  return buildInvoicePrintHtml({
    invoice: orderAsPrintable(order),
    products,
    isRtl,
    businessName: settings?.businessName || (isRtl ? 'مستودعي' : 'Mostawdaee'),
    businessAddress: settings?.businessAddress,
    businessPhone: settings?.businessPhone,
    businessEmail: settings?.businessEmail,
    taxRegistrationNumber: settings?.taxRegistrationNumber,
    companyLogoUrl: settings?.companyLogoUrl,
    offer: {
      title: orderKindLabel(order.kind, isRtl),
      partyLabel: isQuote ? (isRtl ? 'مقدّم إلى' : 'Prepared for') : (isRtl ? 'إلى المورد' : 'To supplier'),
      details,
      note: order.notes?.trim() || fallbackNote,
    },
  });
}
