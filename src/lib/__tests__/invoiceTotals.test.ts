import { describe, expect, it } from 'vitest';
import { computeInvoiceTotals, resolveVatRate } from '../invoiceTotals';

describe('resolveVatRate', () => {
  it('keeps a real 0% rate', () => {
    expect(resolveVatRate(0)).toBe(0);
    expect(resolveVatRate('0')).toBe(0);
  });

  it('falls back only for missing or invalid values', () => {
    expect(resolveVatRate(undefined)).toBe(16);
    expect(resolveVatRate(null)).toBe(16);
    expect(resolveVatRate('')).toBe(16);
    expect(resolveVatRate('abc')).toBe(16);
    expect(resolveVatRate(-5)).toBe(16);
    expect(resolveVatRate(150)).toBe(16);
    expect(resolveVatRate(undefined, 0)).toBe(0);
  });
});

describe('computeInvoiceTotals', () => {
  it('charges tax on the amount after discount', () => {
    const t = computeInvoiceTotals({ subtotal: 100, discount: 10, vatRate: 16, currency: 'USD' });
    expect(t).toEqual({ subtotal: 100, discount: 10, net: 90, taxAmount: 14.4, total: 104.4 });
  });

  it('never lets the discount exceed the subtotal', () => {
    const t = computeInvoiceTotals({ subtotal: 50, discount: 80, vatRate: 16, currency: 'USD' });
    expect(t.discount).toBe(50);
    expect(t.total).toBe(0);
  });

  it('rounds to the currency precision', () => {
    const t = computeInvoiceTotals({ subtotal: 10.0005, vatRate: 16, currency: 'JOD' });
    expect(t.taxAmount).toBe(1.6);
    expect(t.total).toBe(11.601);
  });

  it('skips tax when disabled', () => {
    const t = computeInvoiceTotals({ subtotal: 100, vatRate: 16, taxEnabled: false, currency: 'USD' });
    expect(t.taxAmount).toBe(0);
    expect(t.total).toBe(100);
  });
});
