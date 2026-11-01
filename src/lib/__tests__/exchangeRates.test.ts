import { describe, it, expect } from 'vitest';
import { convertMoney, safeConvertMoney, convertAmount, formatMoney, currencyDecimals, buildUsdUnitRates, POS_CURRENCY_CODES, roundMoney, conversionBasis, DEBT_RATE_MAX_AGE_MS } from '../exchangeRates';
import { roundForCurrency } from '../vaultMath';

describe('conversionBasis', () => {
  const live = { USD: 1, JOD: 0.71, ILS: 3.6, IQD: 1310 };
  const now = 1_800_000_000_000;

  it('accepts a fresh live rate and reports when it was fetched', () => {
    const b = conversionBasis('JOD', 'IQD', null, live, now - 1000, now);
    expect(b.ok).toBe(true);
    expect(b.liveAt).toBe(now - 1000);
    expect(b.rate).toBeCloseTo(1310 / 0.71, 6);
  });

  it('refuses stale or missing live rates (built-in defaults are not enough)', () => {
    expect(conversionBasis('JOD', 'IQD', null, live, now - DEBT_RATE_MAX_AGE_MS - 1, now).ok).toBe(false);
    expect(conversionBasis('JOD', 'IQD', null, null, null, now).ok).toBe(false);
  });

  it('accepts the merchant\'s manual rates for the currencies they cover', () => {
    const s = { useManualExchangeRates: true, exchangeRateJOD_USD: 1.41, exchangeRateUSD_ILS: 3.7 };
    const b = conversionBasis('JOD', 'ILS', s, null, null, now);
    expect(b.ok).toBe(true);
    expect(b.manual).toBe(true);
    expect(conversionBasis('JOD', 'IQD', s, null, null, now).ok).toBe(false);
  });

  it('same currency needs no rate', () => {
    expect(conversionBasis('USD', 'USD', null, null, null, now)).toMatchObject({ ok: true, rate: 1 });
  });
});

describe('roundMoney', () => {
  it('rounds half away from zero on the decimal value', () => {
    expect(roundMoney(1.005, 'USD')).toBe(1.01);
    expect(roundMoney(0.285, 'USD')).toBe(0.29);
    expect(roundMoney(1.255, 'USD')).toBe(1.26);
    expect(roundMoney(1.0005, 'JOD')).toBe(1.001);
    expect(roundMoney(-1.005, 'USD')).toBe(-1.01);
    expect(roundMoney(-2.5, 'IQD')).toBe(-3);
    expect(roundMoney(0.1 + 0.2, 'USD')).toBe(0.3);
  });

  it('never returns -0, NaN or Infinity', () => {
    expect(Object.is(roundMoney(-0.0001, 'USD'), 0)).toBe(true);
    expect(roundMoney(NaN, 'USD')).toBe(0);
    expect(roundMoney(Infinity, 'USD')).toBe(0);
    expect(roundMoney(1e-9, 'JOD')).toBe(0);
    expect(roundMoney(123456789.125, 'USD')).toBe(123456789.13);
  });

  it('is the same function the vault uses', () => {
    for (const v of [1.005, 0.285, -1.005, 2.675, 1234.5675]) {
      expect(roundForCurrency(v, 'USD')).toBe(roundMoney(v, 'USD'));
      expect(roundForCurrency(v, 'JOD')).toBe(roundMoney(v, 'JOD'));
    }
  });
});

describe('exchangeRates', () => {
  it('has the supported currencies', () => {
    expect([...POS_CURRENCY_CODES]).toEqual(['JOD', 'ILS', 'USD', 'IQD', 'SAR', 'AED', 'LYD', 'EGP']);
  });

  it('uses the right decimals per currency', () => {
    expect(currencyDecimals('JOD')).toBe(3);
    expect(currencyDecimals('IQD')).toBe(0);
    expect(currencyDecimals('USD')).toBe(2);
  });

  it('is identity for the same currency', () => {
    expect(convertAmount(12.5, 'JOD', 'JOD')).toBe(12.5);
  });

  it('refuses unknown or zero rates instead of treating them as USD', () => {
    expect(Number.isNaN(convertAmount(100, 'EUR', 'USD', { USD: 1, JOD: 0.709 }))).toBe(true);
    expect(Number.isNaN(convertMoney(100, 'USD', 'EUR', { USD: 1 }))).toBe(true);
    expect(Number.isNaN(convertAmount(10, 'USD', 'JOD', { USD: 1, JOD: 0 }))).toBe(true);
    expect(safeConvertMoney(100, 'USD', 'EUR', { USD: 1 })).toBeNull();
    expect(safeConvertMoney(10, 'USD', 'JOD', { USD: 1, JOD: 0.709 })).toBeCloseTo(7.09, 5);
  });

  it('round-trips through USD consistently', () => {
    const rates = buildUsdUnitRates(null, { JOD: 0.71, ILS: 3.6, IQD: 1300, SAR: 3.75, LYD: 4.8 });
    const usd = convertAmount(71, 'JOD', 'USD', rates);
    expect(usd).toBeCloseTo(100, 6);
    expect(convertMoney(100, 'USD', 'IQD', rates)).toBe(130000);
  });

  it('formats with the currency own symbol', () => {
    expect(formatMoney(10, 'ILS')).toContain('₪');
    expect(formatMoney(10, 'SAR')).toContain('ر.س');
  });

  it('converts Egyptian pounds from a live USD rate', () => {
    const rates = buildUsdUnitRates(null, { EGP: 48.2, JOD: 0.709 });
    expect(convertMoney(1, 'USD', 'EGP', rates)).toBe(48.2);
    expect(currencyDecimals('EGP')).toBe(2);
  });

  it('handles the UAE dirham at its USD peg', () => {
    expect(currencyDecimals('AED')).toBe(2);
    expect(formatMoney(1234.5, 'AED', 'en-US')).toBe('1,234.50 د.إ');
    expect(convertMoney(100, 'USD', 'AED')).toBe(367.25);
    expect(convertMoney(367.25, 'AED', 'USD')).toBe(100);
    expect(convertMoney(10, 'AED', 'JOD')).toBe(1.931);
    const live = buildUsdUnitRates(null, { AED: 3.6727, JOD: 0.709, ILS: 3.7 });
    expect(convertMoney(1, 'USD', 'AED', live)).toBe(3.67);
    expect(live.AED).toBe(3.6727);
  });

  it('keeps live rates when manual mode is off', () => {
    const rates = buildUsdUnitRates(
      { useManualExchangeRates: false, exchangeRateJOD_USD: 2 },
      { JOD: 0.71, ILS: 3.7 }
    );
    expect(rates.JOD).toBe(0.71);
  });

  it('uses merchant-entered rates only in manual mode', () => {
    const rates = buildUsdUnitRates(
      { useManualExchangeRates: true, exchangeRateJOD_USD: 2 },
      { JOD: 0.71, ILS: 3.7 }
    );
    expect(rates.JOD).toBeCloseTo(0.5, 6);
  });
});
