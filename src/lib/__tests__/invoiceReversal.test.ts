import { describe, expect, it } from 'vitest';
import { planStockReversal, quantitiesByProduct } from '../invoiceReversal';

const line = (productId: string, quantity: number) => ({
  productId, description: productId, quantity, unitPrice: 1, total: quantity,
});

describe('planStockReversal', () => {
  it('returns sold goods to stock, counting repeated lines once per product', () => {
    const plan = planStockReversal(
      { type: 'sale', items: [line('a', 2), line('a', 3), line('b', 1)] },
      new Map([['a', { quantity: 4 }], ['b', { quantity: 0 }]]),
    );
    expect(plan.updates).toEqual([{ productId: 'a', quantity: 9 }, { productId: 'b', quantity: 1 }]);
    expect(plan.shortages).toEqual([]);
  });

  it('removes purchased goods, and refuses when they were already sold', () => {
    const plan = planStockReversal(
      { type: 'purchase', items: [line('a', 5), line('b', 2)] },
      new Map([['a', { quantity: 10, name: 'A' }], ['b', { quantity: 1, name: 'B' }]]),
    );
    expect(plan.updates).toEqual([{ productId: 'a', quantity: 5 }]);
    expect(plan.shortages).toEqual([{ name: 'B', available: 1, needed: 2 }]);
  });

  it('reports products that no longer exist', () => {
    const plan = planStockReversal({ type: 'sale', items: [line('gone', 1)] }, new Map());
    expect(plan.missing).toEqual(['gone']);
    expect(plan.updates).toEqual([]);
  });

  it('aggregates quantities by product', () => {
    expect(quantitiesByProduct([line('a', 1), line('a', 2)]).get('a')?.qty).toBe(3);
  });

  it('skips ad-hoc free lines so they never move stock', () => {
    expect(
      quantitiesByProduct([
        line('a', 2),
        { productId: 'adhoc:x', description: 'Fee', quantity: 9, unitPrice: 1, total: 9, adhoc: true },
      ]).get('a')?.qty,
    ).toBe(2);
  });
});
