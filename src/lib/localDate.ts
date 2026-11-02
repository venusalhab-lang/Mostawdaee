/**
 * Calendar days as the merchant sees them on the device clock.
 * `new Date('2026-10-09')` is UTC midnight, which is 03:00 in Amman and the previous evening in the Americas,
 * so date inputs must never go through it.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD of the given moment in the device time zone. */
export function localIsoDate(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIsoDate(value: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d ? [y, mo, d] : null;
}

function ymd(y: number, mo: number, d: number): string | null {
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** YYYY-MM-DD → DD/MM/YYYY for typing fields. Empty stays empty. */
export function formatDisplayDate(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return '';
  return `${pad(p[2])}/${pad(p[1])}/${p[0]}`;
}

/**
 * Accepts merchant-friendly dates and returns YYYY-MM-DD, or null if invalid.
 * Supports: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, D/M/YYYY, and 8 digits DDMMYYYY.
 * Day-first (not US month-first) so 09/03/2026 is 9 March.
 */
export function parseFlexibleDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const iso = parseIsoDate(value);
  if (iso) return ymd(iso[0], iso[1], iso[2]);

  const digits = value.replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) {
    return ymd(Number(digits.slice(4)), Number(digits.slice(2, 4)), Number(digits.slice(0, 2)));
  }

  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(value);
  if (!m) return null;
  return ymd(Number(m[3]), Number(m[2]), Number(m[1]));
}

export function isIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/** First millisecond of a YYYY-MM-DD day in the device time zone, or null for an invalid date. */
export function localDayStart(value: string): number | null {
  const p = parseIsoDate(value);
  return p ? new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).getTime() : null;
}

/** Last millisecond of a YYYY-MM-DD day in the device time zone, or null for an invalid date. */
export function localDayEnd(value: string): number | null {
  const p = parseIsoDate(value);
  return p ? new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999).getTime() : null;
}

/** Timestamp for a document dated by the user: now when the day is today, otherwise the start of that day. */
export function timestampForLocalDay(value: string, now = Date.now()): number {
  if (value === localIsoDate(now)) return now;
  return localDayStart(value) ?? now;
}
