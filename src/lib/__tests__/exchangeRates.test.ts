import { describe, it, expect } from 'vitest';
import { convertMoney, convertAmount, formatMoney, currencyDecimals, buildUsdUnitRates, POS_CURRENCY_CODES } from '../exchangeRates';

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
