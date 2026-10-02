export const POS_CURRENCY_CODES = ['JOD', 'ILS', 'USD', 'IQD', 'SAR', 'LYD'] as const;
export type PosCurrency = (typeof POS_CURRENCY_CODES)[number];

export const CURRENCY_SYMBOLS: Record<string, string> = {
  JOD: 'د.أ',
  ILS: '₪',
  USD: '$',
  IQD: 'د.ع',
  SAR: 'ر.س',
  LYD: 'د.ل',
};

/** Minor-unit digits used for money rounding/printing per currency. */
export const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  ILS: 2,
  SAR: 2,
  JOD: 3,
  LYD: 3,
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

export function roundMoney(value: number, code: string): number {
  const d = currencyDecimals(code);
  const f = 10 ** d;
  return Math.round((Number(value) || 0) * f + Number.EPSILON) / f;
}

export function formatMoney(value: number, code: string, locale?: string): string {
  const d = currencyDecimals(code);
  const num = (Number(value) || 0).toLocaleString(locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
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

/** Fetches live USD-based rates (same source as the header ticker) and caches them. */
export async function fetchLiveUsdRates(force = false): Promise<Record<string, number> | null> {
  if (!force) {
    const fresh = readCachedLiveRates(CACHE_TTL_MS);
    if (fresh) return fresh;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error(`rates http ${res.status}`);
    const data = await res.json();
    const out: Record<string, number> = { USD: 1 };
    for (const code of TRACKED) {
      const v = Number(data?.rates?.[code]);
      if (v > 0) out[code] = v;
    }
    if (!(out.JOD > 0) || !(out.ILS > 0)) throw new Error('incomplete rates payload');
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rates: out } satisfies CachedRates));
    } catch {
      // ignore quota errors
    }
    return out;
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
  if (settings?.useManualExchangeRates || !live) applySettings(rates, settings);
  rates.USD = 1;
  return rates;
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
