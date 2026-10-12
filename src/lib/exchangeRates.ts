import { apiUrl } from './apiBase';

export const POS_CURRENCY_CODES = ['JOD', 'ILS', 'USD', 'IQD', 'SAR', 'AED', 'LYD', 'EGP'] as const;
export type PosCurrency = (typeof POS_CURRENCY_CODES)[number];

export const CURRENCY_SYMBOLS: Record<string, string> = {
  JOD: 'د.أ',
  ILS: '₪',
  USD: '$',
  IQD: 'د.ع',
  SAR: 'ر.س',
  AED: 'د.إ',
  LYD: 'د.ل',
  EGP: 'ج.م',
};

/** Minor-unit digits used for money rounding/printing per currency. */
export const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  ILS: 2,
  SAR: 2,
  AED: 2,
  JOD: 3,
  LYD: 3,
  EGP: 2,
  IQD: 0,
};

/** Units of each currency per 1 USD – last-resort fallback only. */
export const DEFAULT_USD_UNITS: Record<string, number> = {
  USD: 1,
  JOD: 0.709,
  ILS: 3.7,
  IQD: 1310,
  SAR: 3.75,
  LYD: 4.8,
  AED: 3.6725,
  EGP: 50.7,
};

export interface RateSettings {
  useManualExchangeRates?: boolean;
  exchangeRateJOD_USD?: number;
  exchangeRateUSD_ILS?: number;
  exchangeRateJOD_ILS?: number;
}

const CACHE_KEY = 'mustawdae_fx_usd_rates_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;
const TRACKED = ['JOD', 'ILS', 'IQD', 'SAR', 'LYD', 'AED', 'EGP'];

export function isPosCurrency(value: string | undefined | null): value is PosCurrency {
  return !!value && (POS_CURRENCY_CODES as readonly string[]).includes(value);
}

export function currencyDecimals(code: string): number {
  return CURRENCY_DECIMALS[code] ?? 2;
}

/**
 * Half away from zero on the decimal value the user sees: 1.005 → 1.01, 0.285 → 0.29, -1.005 → -1.01.
 * Scaling through the decimal string avoids binary drift such as 1.005 * 100 = 100.49999999999999.
 */
export function roundMoney(value: number, code: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  const d = currencyDecimals(code);
  const [mantissa, exp = '0'] = Math.abs(n).toPrecision(15).split('e');
  const scaled = Math.round(Number(`${mantissa}e${Number(exp) + d}`));
  const rounded = Number(`${scaled}e-${d}`);
  return rounded === 0 ? 0 : Math.sign(n) * rounded;
}

/** The number alone, rounded and padded to the currency's minor units (for layouts that print the code separately). */
export function formatAmount(value: number, code: string, locale?: string): string {
  const d = currencyDecimals(code);
  return roundMoney(Number(value) || 0, code).toLocaleString(locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function formatMoney(value: number, code: string, locale?: string): string {
  const num = formatAmount(value, code, locale);
  const symbol = CURRENCY_SYMBOLS[code] || code;
  return symbol === '$' ? `$${num}` : `${num} ${symbol}`;
}

interface CachedRates {
  ts: number;
  rates: Record<string, number>;
}

export function readCachedLiveRates(maxAgeMs = Infinity): Record<string, number> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRates;
    if (!parsed?.rates || Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.rates;
  } catch {
    return null;
  }
}

function parseUsdRatesPayload(data: unknown): Record<string, number> | null {
  const rates = (data as { rates?: Record<string, number> } | null)?.rates;
  if (!rates) return null;
  const out: Record<string, number> = { USD: 1 };
  for (const code of TRACKED) {
    const v = Number(rates[code]);
    if (v > 0) out[code] = v;
  }
  if (!(out.JOD > 0) || !(out.ILS > 0)) return null;
  return out;
}

function persistLiveRates(out: Record<string, number>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rates: out } satisfies CachedRates));
  } catch {
    // ignore quota errors
  }
}

export function readCachedLiveRatesTimestamp(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRates;
    return typeof parsed?.ts === 'number' ? parsed.ts : null;
  } catch {
    return null;
  }
}

/** Fetches live USD-based rates (same source as the header ticker) and caches them. */
export async function fetchLiveUsdRates(force = false): Promise<Record<string, number> | null> {
  if (!force) {
    const fresh = readCachedLiveRates(CACHE_TTL_MS);
    if (fresh) return fresh;
  }

  const tryUrl = async (url: string, rejectFallback = false): Promise<Record<string, number> | null> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`rates http ${res.status}`);
    const data = await res.json();
    if (rejectFallback && data?.provider === 'local_database_fallback') return null;
    return parseUsdRatesPayload(data);
  };

  try {
    const proxied = await tryUrl(apiUrl('/api/exchange-rate/USD'), true);
    if (proxied) {
      persistLiveRates(proxied);
      return proxied;
    }
  } catch {
    // fall through to the public feed
  }

  try {
    const direct = await tryUrl('https://open.er-api.com/v6/latest/USD');
    if (!direct) throw new Error('incomplete rates payload');
    persistLiveRates(direct);
    return direct;
  } catch (e) {
    console.warn('[exchangeRates] live fetch failed, using cache/defaults', e);
    return readCachedLiveRates();
  }
}

function applySettings(rates: Record<string, number>, s?: RateSettings | null) {
  const jodUsd = Number(s?.exchangeRateJOD_USD);
  if (jodUsd > 0) rates.JOD = 1 / jodUsd;
  const usdIls = Number(s?.exchangeRateUSD_ILS);
  if (usdIls > 0) rates.ILS = usdIls;
  const jodIls = Number(s?.exchangeRateJOD_ILS);
  if (jodIls > 0 && rates.JOD > 0 && !(usdIls > 0)) rates.ILS = jodIls * rates.JOD;
}

/**
 * Single source of truth for every screen that converts money.
 * manual setting -> settings values win; otherwise live/cached rates win; settings only as fallback.
 */
export function buildUsdUnitRates(
  settings?: RateSettings | null,
  live?: Record<string, number> | null
): Record<string, number> {
  const rates: Record<string, number> = { ...DEFAULT_USD_UNITS };
  if (live) Object.assign(rates, live);
  if (settings?.useManualExchangeRates) applySettings(rates, settings);
  else if (!live) applySettings(rates, settings);
  rates.USD = 1;
  return rates;
}

/** Live rates older than this are not trusted for amounts that become debts. */
export const DEBT_RATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ConversionBasis {
  ok: boolean;
  /** Both sides come from the merchant's own rates. */
  manual: boolean;
  /** When the live rates used were fetched; null when none were needed. */
  liveAt: number | null;
  /** Units of `to` per one unit of `from`. */
  rate: number;
}

function manualCovers(code: string, s?: RateSettings | null): boolean {
  if (code === 'USD') return true;
  if (!s?.useManualExchangeRates) return false;
  if (code === 'JOD') return Number(s.exchangeRateJOD_USD) > 0;
  if (code === 'ILS') return Number(s.exchangeRateUSD_ILS) > 0 || (Number(s.exchangeRateJOD_ILS) > 0 && Number(s.exchangeRateJOD_USD) > 0);
  return false;
}

/**
 * Whether converting `from` → `to` rests on a known rate: the merchant's manual rate or a live rate
 * fetched within `maxAgeMs`. Built-in defaults are never enough for a debt.
 */
export function conversionBasis(
  from: string,
  to: string,
  settings: RateSettings | null | undefined,
  live: Record<string, number> | null,
  liveAt: number | null,
  now = Date.now(),
  maxAgeMs = DEBT_RATE_MAX_AGE_MS
): ConversionBasis {
  const rates = buildUsdUnitRates(settings, live);
  const rate = convertAmount(1, from, to, rates);
  if (from === to) return { ok: true, manual: false, liveAt: null, rate: 1 };
  const fresh = !!live && liveAt !== null && now - liveAt <= maxAgeMs && now >= liveAt - 60_000;
  let usedLive = false;
  for (const code of [from, to]) {
    if (manualCovers(code, settings)) continue;
    if (fresh && Number(live?.[code]) > 0) { usedLive = true; continue; }
    return { ok: false, manual: false, liveAt: null, rate };
  }
  return { ok: true, manual: !usedLive, liveAt: usedLive ? liveAt : null, rate };
}

export function convertAmount(
  amount: number | string,
  from: string,
  to: string,
  rates: Record<string, number> = DEFAULT_USD_UNITS
): number {
  const value = Number(amount) || 0;
  if (!from || from === to) return value;
  const fromRate = Number(rates[from]) || 1;
  const toRate = Number(rates[to]) || 1;
  return (value / fromRate) * toRate;
}

/** Convert and round to the target currency's minor unit. */
export function convertMoney(
  amount: number | string,
  from: string,
  to: string,
  rates: Record<string, number> = DEFAULT_USD_UNITS
): number {
  return roundMoney(convertAmount(amount, from, to, rates), to);
}
