import { describe, expect, it } from 'vitest';
import {
  encodeZatcaTlv,
  formatZatcaAmount,
  isZatcaVatNumber,
  validateZatcaTlvFields,
} from '../zatcaTlv';

/** Canonical Phase-1 fields used across ZATCA developer samples. */
const SAMPLE = {
  sellerName: 'Bobs Records',
  vatNumber: '310122393500003',
  timestamp: '2022-04-25T15:28:46Z',
  invoiceTotal: '1000.00',
  vatTotal: '150.00',
};

function decodeTlv(base64: string): Record<number, string> {
  const bytes = Buffer.from(base64, 'base64');
  const out: Record<number, string> = {};
  let i = 0;
  while (i + 2 <= bytes.length) {
    const tag = bytes[i]!;
    const len = bytes[i + 1]!;
    out[tag] = bytes.subarray(i + 2, i + 2 + len).toString('utf8');
    i += 2 + len;
  }
  return out;
}

describe('isZatcaVatNumber', () => {
  it('accepts a 15-digit number starting with 3', () => {
    expect(isZatcaVatNumber('310122393500003')).toBe(true);
  });

  it('rejects wrong length or prefix', () => {
    expect(isZatcaVatNumber('110122393500003')).toBe(false);
    expect(isZatcaVatNumber('31012239350000')).toBe(false);
    expect(isZatcaVatNumber('')).toBe(false);
  });
});

describe('formatZatcaAmount', () => {
  it('formats non-negative finite amounts to 2 decimals', () => {
    expect(formatZatcaAmount(1000)).toBe('1000.00');
    expect(formatZatcaAmount(150.5)).toBe('150.50');
    expect(formatZatcaAmount(-1)).toBeNull();
    expect(formatZatcaAmount(Number.NaN)).toBeNull();
  });
});

describe('encodeZatcaTlv', () => {
  it('encodes tags 1–5 and round-trips the sample fields', () => {
    const result = encodeZatcaTlv(SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.qr.length).toBeGreaterThan(20);
    expect(decodeTlv(result.qr)).toEqual({
      1: SAMPLE.sellerName,
      2: SAMPLE.vatNumber,
      3: SAMPLE.timestamp,
      4: SAMPLE.invoiceTotal,
      5: SAMPLE.vatTotal,
    });
  });

  it('is stable for the same inputs', () => {
    const a = encodeZatcaTlv(SAMPLE);
    const b = encodeZatcaTlv(SAMPLE);
    expect(a.ok && b.ok && a.qr === b.qr).toBe(true);
  });

  it('refuses invalid fields', () => {
    expect(validateZatcaTlvFields({ ...SAMPLE, vatNumber: '123' }).map((i) => i.code)).toContain('vat_number');
    const bad = encodeZatcaTlv({ ...SAMPLE, sellerName: '' });
    expect(bad.ok).toBe(false);
  });
});
