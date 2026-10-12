import { describe, it, expect } from 'vitest';
import { mergeProductEdit } from '../productEdit';
import type { Product } from '../../types';

const p = (over: Partial<Product>): Product => ({
  id: 'p1', name: 'شاي', sku: 'T1', category: '', brand: '', quantity: 10, unitCost: 5, sellingPrice: 8,
  status: 'In Stock', dateAdded: 0, currency: 'JOD', warehouseId: 'w1', ...over,
});

describe('mergeProductEdit', () => {
  it('keeps a cost and warehouse changed elsewhere while the form was open', () => {
    const base = p({});
    const edited = p({ name: 'شاي أخضر' });
    const stored = p({ unitCost: 10, warehouseId: 'w2', quantity: 20 });
    const merged = mergeProductEdit(base, edited, stored);
    expect(merged).toMatchObject({ name: 'شاي أخضر', unitCost: 10, warehouseId: 'w2', quantity: 20 });
  });

  it('applies the fields the user did change', () => {
    const merged = mergeProductEdit(p({}), p({ unitCost: 6, sellingPrice: 9 }), p({ unitCost: 10 }));
    expect(merged).toMatchObject({ unitCost: 6, sellingPrice: 9 });
  });

  it('lets the user clear an optional field', () => {
    const merged = mergeProductEdit(p({ expiryDate: 100 }), p({ expiryDate: undefined }), p({ expiryDate: 100 }));
    expect(merged.expiryDate).toBeUndefined();
  });
});
