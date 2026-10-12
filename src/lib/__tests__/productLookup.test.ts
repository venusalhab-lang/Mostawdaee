import { describe, it, expect } from 'vitest';
import { pickForPurchase, pickForSale, productsForCode, skuOwner } from '../productLookup';

const rows = [
  { id: 'p1', sku: 'ABC', quantity: 0, warehouseId: 'w1' },
  { id: 'PROD_SPLIT_1', sku: 'abc', quantity: 5, warehouseId: 'w2' },
  { id: 'p2', sku: 'XYZ', quantity: 3, warehouseId: 'w1' },
];

describe('productLookup', () => {
  it('finds every warehouse row of a barcode, ignoring case', () => {
    expect(productsForCode(rows, ' abc ').map((p) => p.id)).toEqual(['p1', 'PROD_SPLIT_1']);
    expect(productsForCode(rows, 'p2').map((p) => p.id)).toEqual(['p2']);
    expect(productsForCode(rows, '')).toEqual([]);
  });

  it('sells from the row that has stock', () => {
    expect(pickForSale(productsForCode(rows, 'ABC'))?.id).toBe('PROD_SPLIT_1');
    expect(pickForSale([{ quantity: 0 }, { quantity: -1 }])).toEqual({ quantity: 0 });
  });

  it('receives stock on the original row', () => {
    expect(pickForPurchase(productsForCode(rows, 'ABC'))?.id).toBe('p1');
  });

  it('lets each warehouse row keep the shared barcode', () => {
    expect(skuOwner(rows, 'ABC', rows[0], 'w1')).toBeUndefined();
    expect(skuOwner(rows, 'ABC', rows[1], 'w2')).toBeUndefined();
  });

  it('refuses a barcode taken by another product or two rows in one warehouse', () => {
    expect(skuOwner(rows, 'XYZ', rows[0], 'w1')?.id).toBe('p2');
    expect(skuOwner(rows, 'ABC', null, 'w3')?.id).toBe('p1');
    expect(skuOwner(rows, 'ABC', rows[0], 'w2')?.id).toBe('PROD_SPLIT_1');
  });
});
