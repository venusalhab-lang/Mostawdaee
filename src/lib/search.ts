const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const INVISIBLE = /[\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const ARABIC_INDIC_DIGIT = /[\u0660-\u0669]/g;
const PERSIAN_DIGIT = /[\u06F0-\u06F9]/g;

/**
 * One normal form for every search box: case, diacritics, tatweel, hamza/alef/ya/ta-marbuta
 * spellings and Arabic-Indic digits all compare equal to their plain forms.
 */
export function normalizeSearchText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(TASHKEEL, '')
    .replace(INVISIBLE, '')
    .replace(ARABIC_INDIC_DIGIT, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGIT, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(' ') : [];
}

export function digitsOnly(value: unknown): string {
  return normalizeSearchText(value).replace(/\D/g, '');
}

/** "0599 123" finds "+970599123456": leading zeros and separators are ignored. */
export function phoneMatches(phone: unknown, query: string): boolean {
  const wanted = digitsOnly(query).replace(/^0+/, '');
  if (wanted.length < 3) return false;
  if (/[^\d\s+()-]/.test(normalizeSearchText(query))) return false;
  return digitsOnly(phone).includes(wanted);
}

/** Every word of the query must appear somewhere in the fields, in any order. */
export function matchesQuery(fields: readonly unknown[], query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = fields.map(normalizeSearchText).join('\n');
  return tokens.every((token) => haystack.includes(token));
}

export interface SearchFields {
  /** Shown as the result title; prefix matches here rank above matches elsewhere. */
  primary: unknown;
  /** Exact identifiers (barcode, invoice number, cheque number). An exact hit ranks first. */
  codes?: readonly unknown[];
  extra?: readonly unknown[];
  phone?: unknown;
}

export function scoreMatch(fields: SearchFields, query: string): number {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 0;
  const normalizedQuery = tokens.join(' ');
  const codes = (fields.codes || []).map(normalizeSearchText).filter(Boolean);
  const primary = normalizeSearchText(fields.primary);
  const textMatch = matchesQuery([fields.primary, ...(fields.codes || []), ...(fields.extra || [])], query);
  const phoneMatch = fields.phone !== undefined && phoneMatches(fields.phone, query);
  if (!textMatch && !phoneMatch) return 0;

  if (codes.includes(normalizedQuery)) return 100;
  if (primary === normalizedQuery) return 90;
  if (codes.some((code) => code.startsWith(normalizedQuery))) return 80;
  if (primary.startsWith(normalizedQuery)) return 70;
  if (phoneMatch) return 60;
  if (primary.split(' ').some((word) => word.startsWith(tokens[0]))) return 50;
  if (matchesQuery([fields.primary], query)) return 40;
  return 20;
}

export interface RankedMatches<T> {
  items: T[];
  total: number;
}

/** Best matches first; ties keep the caller's order (e.g. newest first). */
export function rankMatches<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => SearchFields,
  limit: number,
): RankedMatches<T> {
  if (searchTokens(query).length === 0) return { items: [], total: 0 };
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = scoreMatch(fields(item), query);
    if (score > 0) scored.push({ item, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return { items: scored.slice(0, limit).map((entry) => entry.item), total: scored.length };
}

export const RECENT_SEARCHES_KEY = 'recent_searches';
export const RECENT_SEARCHES_LIMIT = 6;

export function pushRecentSearch(recent: readonly string[], query: string): string[] {
  const value = query.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!value) return [...recent];
  const key = normalizeSearchText(value);
  return [value, ...recent.filter((item) => normalizeSearchText(item) !== key)].slice(0, RECENT_SEARCHES_LIMIT);
}
