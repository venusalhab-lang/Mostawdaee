import { describe, it, expect } from 'vitest';
import { computeStockStatus, roundQty } from '../stock';
import { planStockReversal, quantitiesByProduct } from '../invoiceReversal';

describe('decimal quantities', () => {
  it('rounds to grams and never returns -0', () => {
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
    expect(roundQty(0.1 + 0.2 - 0.3)).toBe(0);
    expect(Object.is(roundQty(-0.0000001), 0)).toBe(true);
    expect(roundQty(1.0005)).toBe(1.001);
    expect(roundQty(NaN)).toBe(0);
  });

  it('ten purchases of 0.1 kg make exactly 1 kg', () => {
    let qty = 0;
    for (let i = 0; i < 10; i++) qty = roundQty(qty + 0.1);
    expect(qty).toBe(1);
  });

  it('sums repeated lines without drift', () => {
    const lines = Array.from({ length: 10 }, () => ({ productId: 'p', description: 'رز', quantity: 0.1, unitPrice: 1, total: 0.1 }));
    expect(quantitiesByProduct(lines).get('p')!.qty).toBe(1);
  });

  it('can delete the second purchase after the first was deleted', () => {
    const items = (q: number) => [{ productId: 'p', description: 'رز', quantity: q, unitPrice: 1, total: q }];
    const afterFirst = planStockReversal({ type: 'purchase', items: items(0.7) }, new Map([['p', { quantity: 0.8 }]]));
    expect(afterFirst.updates[0].quantity).toBe(0.1);
    const afterSecond = planStockReversal({ type: 'purchase', items: items(0.1) }, new Map([['p', { quantity: afterFirst.updates[0].quantity }]]));
    expect(afterSecond.shortages).toEqual([]);
    expect(afterSecond.updates[0].quantity).toBe(0);
  });

  it('treats float noise as out of stock', () => {
    expect(computeStockStatus(0.1 + 0.2 - 0.3, 5)).toBe('Out of Stock');
  });
});
