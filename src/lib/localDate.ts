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
