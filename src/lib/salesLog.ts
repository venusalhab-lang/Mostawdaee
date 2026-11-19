import type { Invoice, InvoiceItem } from '../types';
import { roundMoney } from './exchangeRates';
import { toCsv } from './csv';
import { lineQuantityText } from './packs';

export interface SellerContext {
  userId: string;
  userEmail?: string;
  ownerId: string;
  ownerEmail?: string;
  /** Sales saved on this device and not sent yet; the server has not stamped them. */
  pendingIds: ReadonlySet<string>;
}

/** 'unknown' = saved before the server stamped sellers. */
export type SellerKind = 'you' | 'owner' | 'member' | 'unknown';

export interface Seller {
  key: string;
  kind: SellerKind;
  email: string;
}

export const UNKNOWN_SELLER = 'unknown';

const lower = (value?: string) => (value || '').trim().toLowerCase();

export function sellerOf(invoice: Pick<Invoice, 'id' | 'actorId' | 'actorEmail'>, ctx: SellerContext): Seller {
  const actorId = invoice.actorId || '';
  if (ctx.pendingIds.has(invoice.id) || (actorId && actorId === ctx.userId)) {
    return { key: ctx.userId, kind: 'you', email: lower(ctx.userEmail) };
  }
  if (!actorId) return { key: UNKNOWN_SELLER, kind: 'unknown', email: '' };
  if (actorId === ctx.ownerId) {
    return { key: actorId, kind: 'owner', email: lower(invoice.actorEmail) || lower(ctx.ownerEmail) };
  }
  return { key: actorId, kind: 'member', email: lower(invoice.actorEmail) };
}

export interface SaleLogRow {
  invoice: Invoice;
  seller: Seller;
}

/** Sales in [start, end], newest first. */
export function saleLogRows(invoices: Invoice[], start: number, end: number, ctx: SellerContext): SaleLogRow[] {
  return invoices
    .filter((invoice) => invoice.type === 'sale')
    .filter((invoice) => {
      const at = Number(invoice.date);
      return Number.isFinite(at) && at >= start && at <= end;
    })
    .sort((a, b) => Number(b.date) - Number(a.date))
    .map((invoice) => ({ invoice, seller: sellerOf(invoice, ctx) }));
}

export interface SellerSummary {
  seller: Seller;
  count: number;
  /** One total per currency; amounts in different currencies are never added together. */
  totals: { currency: string; amount: number }[];
}

export function sellerSummaries(rows: SaleLogRow[], fallbackCurrency: string): SellerSummary[] {
  const bySeller = new Map<string, { seller: Seller; count: number; totals: Map<string, number> }>();
  for (const { invoice, seller } of rows) {
    const entry = bySeller.get(seller.key) || { seller, count: 0, totals: new Map<string, number>() };
    if (!entry.seller.email && seller.email) entry.seller = seller;
    entry.count += 1;
    const currency = invoice.currency || fallbackCurrency;
    entry.totals.set(currency, roundMoney((entry.totals.get(currency) || 0) + (Number(invoice.totalAmount) || 0), currency));
    bySeller.set(seller.key, entry);
  }
  return [...bySeller.values()]
    .map(({ seller, count, totals }) => ({
      seller,
      count,
      totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
    }))
    .sort((a, b) => b.count - a.count || a.seller.key.localeCompare(b.seller.key));
}

export function sellerName(seller: Seller, isRtl: boolean): string {
  if (seller.kind === 'you') return isRtl ? 'أنت' : 'You';
  if (seller.kind === 'owner') return seller.email || (isRtl ? 'المالك' : 'Owner');
  if (seller.kind === 'unknown') return isRtl ? 'غير مسجّل' : 'Not recorded';
  return seller.email || (isRtl ? 'عضو في الفريق' : 'Team member');
}

/** One sold line attributed to a cashier, for flat employee sales reports. */
export interface SaleLineRow {
  invoiceId: string;
  invoiceNumber: string;
  date: number;
  seller: Seller;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  currency: string;
  item: InvoiceItem;
}

/** Flatten sale invoices into item rows (newest invoice first, lines in invoice order). */
export function saleLineRows(rows: SaleLogRow[], fallbackCurrency: string): SaleLineRow[] {
  const out: SaleLineRow[] = [];
  for (const { invoice, seller } of rows) {
    const currency = invoice.currency || fallbackCurrency;
    const items = invoice.items || [];
    for (const item of items) {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const lineTotal = Number.isFinite(Number(item.total))
        ? Number(item.total)
        : roundMoney(quantity * unitPrice, currency);
      out.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        date: Number(invoice.date) || 0,
        seller,
        description: item.description || '',
        quantity,
        unitPrice,
        lineTotal,
        currency,
        item,
      });
    }
  }
  return out;
}

/** CSV for the flat line-item cashier report (BOM + Arabic-safe cells). */
export function saleLinesToCsv(lines: SaleLineRow[], isRtl: boolean): string {
  const headers = isRtl
    ? ['البائع', 'الصنف', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'العملة', 'رقم الفاتورة', 'التاريخ والوقت']
    : ['Seller', 'Item', 'Qty', 'Unit price', 'Total', 'Currency', 'Invoice #', 'Date & time'];
  const body = lines.map((line) => [
    sellerName(line.seller, isRtl),
    line.description,
    lineQuantityText(line.item, isRtl),
    line.unitPrice,
    line.lineTotal,
    line.currency,
    line.invoiceNumber,
    new Date(line.date).toISOString(),
  ]);
  return toCsv([headers, ...body]);
}

/** Simple printable HTML table for filtered cashier line items. */
export function buildSaleLinesPrintHtml(input: {
  title: string;
  lines: SaleLineRow[];
  isRtl: boolean;
  formatMoney: (amount: number, currency: string) => string;
  formatWhen: (ts: number) => string;
}): string {
  const { title, lines, isRtl, formatMoney, formatWhen } = input;
  const dir = isRtl ? 'rtl' : 'ltr';
  const th = isRtl
    ? ['البائع', 'الصنف', 'الكمية', 'السعر', 'الإجمالي', 'الفاتورة', 'الوقت']
    : ['Seller', 'Item', 'Qty', 'Price', 'Total', 'Invoice', 'When'];
  const rows = lines.map((line) => `
    <tr>
      <td>${escapeHtml(sellerName(line.seller, isRtl))}</td>
      <td>${escapeHtml(line.description)}</td>
      <td>${escapeHtml(lineQuantityText(line.item, isRtl))}</td>
      <td>${escapeHtml(formatMoney(line.unitPrice, line.currency))}</td>
      <td>${escapeHtml(formatMoney(line.lineTotal, line.currency))}</td>
      <td dir="ltr">#${escapeHtml(line.invoiceNumber)}</td>
      <td>${escapeHtml(formatWhen(line.date))}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a}
      h1{font-size:18px;margin:0 0 12px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:start}
      th{color:#64748b;font-weight:700}
    </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <p>${isRtl ? `${lines.length} بند` : `${lines.length} lines`}</p>
    <table><thead><tr>${th.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows || `<tr><td colspan="7">${isRtl ? 'لا بيانات' : 'No data'}</td></tr>`}</tbody></table>
    </body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
