import type { Invoice } from '../types';
import { roundMoney } from './exchangeRates';

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
