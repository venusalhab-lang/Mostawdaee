/** Public product name. Do not change package ids, storage keys, or API product ids. */
export const APP_NAME_AR = 'مستودعي';
export const APP_NAME_EN = 'Mostawdaee';

/** Public site shown on quiet invoice/receipt footers — not a store-badge marketing strip. */
export const APP_SITE = 'mostawdaee.com';

export function appName(isRtl: boolean): string {
  return isRtl ? APP_NAME_AR : APP_NAME_EN;
}

/** Quiet footer on printed A4 invoices and on-screen invoice preview. */
export function appInvoicePromo(isRtl: boolean): string {
  return isRtl
    ? `صدرت عبر مستودعي · ${APP_SITE}`
    : `Issued with Mostawdaee · ${APP_SITE}`;
}

/** Narrow till-receipt line (58/80 mm) — keeps product presence without crowding the paper. */
export function appReceiptPromo(isRtl: boolean): string {
  return isRtl
    ? `مستودعي · ${APP_SITE}`
    : `Mostawdaee · ${APP_SITE}`;
}
