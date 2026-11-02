import type { Cheque, Product } from '../types';
import { dueCounts } from './cheques';
import { daysUntilExpiry, isExpired, isLowStock } from './stock';

/** Expiry notices only within this window (avoids flooding the desk). */
export const EXPIRY_NOTICE_DAYS = 30;
/** Subscription reminder when this many days or fewer remain. */
export const SUBSCRIPTION_NOTICE_DAYS = 7;

export type StoreNoticeKind =
  | 'stock_out'
  | 'stock_low'
  | 'expiry_past'
  | 'expiry_soon'
  | 'cheque_overdue'
  | 'cheque_soon'
  | 'offline_sales'
  | 'held_bills'
  | 'subscription_soon';

export type StoreNoticeSeverity = 'critical' | 'attention' | 'info';

export interface StoreNotice {
  id: string;
  kind: StoreNoticeKind;
  severity: StoreNoticeSeverity;
  titleAr: string;
  titleEn: string;
  detailAr: string;
  detailEn: string;
  /** Screen id for change-screen navigation when the merchant opens the item. */
  screen?: string;
  count: number;
}

export interface StoreNoticesInput {
  products: Array<Pick<Product, 'id' | 'name' | 'quantity' | 'lowStockThreshold' | 'expiryDate' | 'type'>>;
  lowStockDefault?: number | null;
  cheques: Cheque[];
  today: string;
  now?: number;
  offlinePending: number;
  heldParked: number;
  /** Null/undefined = no subscription reminder (unknown or locked elsewhere). */
  subscriptionDaysRemaining?: number | null;
}

const severityRank: Record<StoreNoticeSeverity, number> = {
  critical: 0,
  attention: 1,
  info: 2,
};

function notice(
  partial: Omit<StoreNotice, 'count'> & { count?: number },
): StoreNotice {
  return { ...partial, count: partial.count ?? 1 };
}

/**
 * Builds a quiet desk summary: aggregated counts only, no per-SKU spam.
 * Money/stock facts must already be true in the live books — this never invents figures.
 */
export function buildStoreNotices(input: StoreNoticesInput): StoreNotice[] {
  const now = input.now ?? Date.now();
  const catalog = (input.products || []).filter((p) => p.type !== 'asset');
  const out: StoreNotice[] = [];

  let outOfStock = 0;
  let lowStock = 0;
  let expired = 0;
  let expirySoon = 0;
  for (const product of catalog) {
    const qty = Number(product.quantity) || 0;
    if (qty <= 0) outOfStock += 1;
    else if (isLowStock(qty, product.lowStockThreshold, input.lowStockDefault)) lowStock += 1;

    const days = daysUntilExpiry(product.expiryDate, now);
    if (days === null) continue;
    if (isExpired(product.expiryDate, now)) expired += 1;
    else if (days <= EXPIRY_NOTICE_DAYS) expirySoon += 1;
  }

  if (outOfStock > 0) {
    out.push(notice({
      id: 'stock_out',
      kind: 'stock_out',
      severity: 'critical',
      titleAr: 'أصناف نفدت كميتها',
      titleEn: 'Out of stock',
      detailAr: `${outOfStock} صنف بكمية صفر.`,
      detailEn: `${outOfStock} item(s) at zero quantity.`,
      screen: 'inventory',
      count: outOfStock,
    }));
  }
  if (lowStock > 0) {
    out.push(notice({
      id: 'stock_low',
      kind: 'stock_low',
      severity: 'attention',
      titleAr: 'أصناف منخفضة المخزون',
      titleEn: 'Low stock',
      detailAr: `${lowStock} صنف عند حد التنبيه أو دونه.`,
      detailEn: `${lowStock} item(s) at or below the alert level.`,
      screen: 'inventory',
      count: lowStock,
    }));
  }
  if (expired > 0) {
    out.push(notice({
      id: 'expiry_past',
      kind: 'expiry_past',
      severity: 'critical',
      titleAr: 'أصناف منتهية الصلاحية',
      titleEn: 'Expired items',
      detailAr: `${expired} صنف تجاوز تاريخ الصلاحية.`,
      detailEn: `${expired} item(s) past expiry.`,
      screen: 'inventory',
      count: expired,
    }));
  }
  if (expirySoon > 0) {
    out.push(notice({
      id: 'expiry_soon',
      kind: 'expiry_soon',
      severity: 'attention',
      titleAr: 'صلاحية قريبة',
      titleEn: 'Expiring soon',
      detailAr: `${expirySoon} صنف خلال ${EXPIRY_NOTICE_DAYS} يوماً.`,
      detailEn: `${expirySoon} item(s) within ${EXPIRY_NOTICE_DAYS} days.`,
      screen: 'inventory',
      count: expirySoon,
    }));
  }

  const chequeDue = dueCounts(input.cheques || [], input.today);
  if (chequeDue.overdue > 0) {
    out.push(notice({
      id: 'cheque_overdue',
      kind: 'cheque_overdue',
      severity: 'critical',
      titleAr: 'شيكات متأخرة',
      titleEn: 'Overdue cheques',
      detailAr: `${chequeDue.overdue} شيك معلّق تجاوز تاريخ الاستحقاق.`,
      detailEn: `${chequeDue.overdue} pending cheque(s) past due.`,
      screen: 'cheques',
      count: chequeDue.overdue,
    }));
  }
  if (chequeDue.soon > 0) {
    out.push(notice({
      id: 'cheque_soon',
      kind: 'cheque_soon',
      severity: 'attention',
      titleAr: 'شيكات مستحقة قريباً',
      titleEn: 'Cheques due soon',
      detailAr: `${chequeDue.soon} شيك معلّق خلال سبعة أيام.`,
      detailEn: `${chequeDue.soon} pending cheque(s) due within seven days.`,
      screen: 'cheques',
      count: chequeDue.soon,
    }));
  }

  const offline = Math.max(0, Math.floor(Number(input.offlinePending) || 0));
  if (offline > 0) {
    out.push(notice({
      id: 'offline_sales',
      kind: 'offline_sales',
      severity: 'critical',
      titleAr: 'مبيعات بانتظار الإرسال',
      titleEn: 'Sales waiting to sync',
      detailAr: `${offline} عملية بيع محفوظة على هذا الجهاز لم تُرسل بعد.`,
      detailEn: `${offline} sale(s) saved on this device have not been sent yet.`,
      screen: 'pos',
      count: offline,
    }));
  }

  const held = Math.max(0, Math.floor(Number(input.heldParked) || 0));
  if (held > 0) {
    out.push(notice({
      id: 'held_bills',
      kind: 'held_bills',
      severity: 'info',
      titleAr: 'فواتير معلّقة',
      titleEn: 'Held bills',
      detailAr: `${held} فاتورة معلّقة على هذا الجهاز.`,
      detailEn: `${held} held bill(s) on this device.`,
      screen: 'pos',
      count: held,
    }));
  }

  const subDays = input.subscriptionDaysRemaining;
  if (typeof subDays === 'number' && Number.isFinite(subDays) && subDays > 0 && subDays <= SUBSCRIPTION_NOTICE_DAYS) {
    out.push(notice({
      id: 'subscription_soon',
      kind: 'subscription_soon',
      severity: subDays <= 3 ? 'attention' : 'info',
      titleAr: 'الاشتراك ينتهي قريباً',
      titleEn: 'Subscription ending soon',
      detailAr: `يتبقى ${subDays} يوماً. التجديد من الإعدادات.`,
      detailEn: `${subDays} day(s) remaining. Renew in Settings.`,
      screen: 'settings',
      count: subDays,
    }));
  }

  return out.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count);
}

export function noticeTitle(notice: StoreNotice, isRtl: boolean): string {
  return isRtl ? notice.titleAr : notice.titleEn;
}

export function noticeDetail(notice: StoreNotice, isRtl: boolean): string {
  return isRtl ? notice.detailAr : notice.detailEn;
}

export function noticesBadgeCount(notices: StoreNotice[]): number {
  return notices.length;
}
