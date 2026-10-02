import { describe, it, expect } from 'vitest';
import { convertMoney, convertAmount, formatMoney, currencyDecimals, buildUsdUnitRates, POS_CURRENCY_CODES } from '../exchangeRates';

describe('exchangeRates', () => {
  it('has the six supported currencies', () => {
    expect([...POS_CURRENCY_CODES]).toEqual(['JOD', 'ILS', 'USD', 'IQD', 'SAR', 'LYD']);
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
});
