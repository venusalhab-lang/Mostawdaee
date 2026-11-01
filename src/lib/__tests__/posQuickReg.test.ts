import { describe, expect, it } from 'vitest';
import { emptyQuickRegForm, parseQuickRegQuantity, QUICK_REG_DEFAULT_QUANTITY } from '../posQuickReg';

describe('posQuickReg', () => {
  it('never invents opening stock — default quantity is zero', () => {
    expect(QUICK_REG_DEFAULT_QUANTITY).toBe(0);
    expect(emptyQuickRegForm('wh1').quantity).toBe(0);
    expect(emptyQuickRegForm('wh1').warehouseId).toBe('wh1');
    expect(emptyQuickRegForm().warehouseId).toBe('');
  });

  it('accepts only finite non-negative quantities', () => {
    expect(parseQuickRegQuantity(0)).toBe(0);
    expect(parseQuickRegQuantity(3)).toBe(3);
    expect(parseQuickRegQuantity('2.5')).toBe(2.5);
    expect(parseQuickRegQuantity('')).toBeNull();
    expect(parseQuickRegQuantity(-1)).toBeNull();
    expect(parseQuickRegQuantity(Number.NaN)).toBeNull();
  });
});
