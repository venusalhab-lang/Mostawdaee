import { describe, expect, it } from 'vitest';
import { grandTotal, lineTotal, parseGridNumber, roundMoney } from '../grid/gridMath';

describe('gridMath', () => {
  it('parses numbers and blanks', () => {
    expect(parseGridNumber('')).toBeNull();
    expect(parseGridNumber('  ')).toBeNull();
    expect(parseGridNumber('1,250.5')).toBe(1250.5);
    expect(parseGridNumber('x')).toBeNaN();
  });

  it('computes line and grand totals', () => {
    expect(lineTotal(3, 2.5)).toBe(7.5);
    expect(grandTotal([
      { quantity: 2, unitPrice: 3 },
      { quantity: 1, unitPrice: 4 },
    ])).toBe(10);
    expect(roundMoney(1.23456)).toBe(1.235);
  });
});
