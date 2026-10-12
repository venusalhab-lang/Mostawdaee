import { describe, expect, it } from 'vitest';
import { arCount } from '../arabicPlural';

const days = { one: 'يوم واحد', two: 'يومان', few: '{n} أيام', many: '{n} يوماً', other: '{n} يوم' };

describe('arCount', () => {
  it.each([
    [0, '0 يوم'],
    [1, 'يوم واحد'],
    [2, 'يومان'],
    [3, '3 أيام'],
    [10, '10 أيام'],
    [11, '11 يوماً'],
    [25, '25 يوماً'],
    [100, '100 يوم'],
    [101, '101 يوم'],
    [102, '102 يوم'],
  ])('%i days', (n, expected) => {
    expect(arCount(n, days)).toBe(expected);
  });

  it('falls back to the many form when other is missing', () => {
    const { other: _other, ...noOther } = days;
    expect(arCount(100, noOther)).toBe('100 يوماً');
    expect(arCount(0, noOther)).toBe('0 يوماً');
  });

  it('uses the zero form when given', () => {
    expect(arCount(0, { ...days, zero: 'لا أيام' })).toBe('لا أيام');
  });
});
