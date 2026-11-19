import { describe, expect, it } from 'vitest';
import type { Product } from '../../types';
import {
  applyCodeToRow,
  createEmptyPurchaseRows,
  purchaseGridGrandTotal,
  validatePurchaseGrid,
} from '../grid/purchaseGrid';

const products: Product[] = [
  {
    id: 'p1',
    name: 'سكر',
    sku: 'SUGAR',
    brand: '',
    category: 'عام',
    quantity: 10,
    unitCost: 1.5,
    sellingPrice: 2,
    currency: 'JOD',
    status: 'In Stock',
    dateAdded: 0,
  },
  {
    id: 'PROD_SPLIT_p1_wh2',
    name: 'سكر',
    sku: 'SUGAR',
    brand: '',
    category: 'عام',
    quantity: 3,
    unitCost: 1.5,
    sellingPrice: 2,
    currency: 'JOD',
    status: 'In Stock',
    warehouseId: 'wh2',
    dateAdded: 0,
  },
];

describe('purchaseGrid', () => {
  it('creates empty draft rows', () => {
    expect(createEmptyPurchaseRows(3)).toHaveLength(3);
    expect(createEmptyPurchaseRows(3)[0].quantity).toBe('1');
  });

  it('resolves barcode to the original catalogue row for purchase', () => {
    const row = applyCodeToRow({
      id: 'r1', code: 'SUGAR', productId: '', description: '', quantity: '2', unitPrice: '', errorKey: null,
    }, products);
    expect(row.productId).toBe('p1');
    expect(row.description).toBe('سكر');
    expect(row.unitPrice).toBe('1.5');
  });

  it('validates qty/cost and builds invoice items', () => {
    const rows = createEmptyPurchaseRows(2);
    rows[0] = { ...rows[0], code: 'SUGAR', quantity: '4', unitPrice: '1.25' };
    const result = validatePurchaseGrid(rows, products);
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([
      { productId: 'p1', description: 'سكر', quantity: 4, unitPrice: 1.25 },
    ]);
    expect(purchaseGridGrandTotal(result.rows)).toBe(5);
  });

  it('flags unmatched codes and bad qty', () => {
    const rows = createEmptyPurchaseRows(2);
    rows[0] = { ...rows[0], code: 'NOPE', quantity: '1', unitPrice: '1' };
    rows[1] = { ...rows[1], code: 'SUGAR', quantity: '0', unitPrice: '1' };
    const result = validatePurchaseGrid(rows, products);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.key).sort()).toEqual(['bad_qty', 'unmatched']);
  });

  it('flags duplicate product at the same cost', () => {
    const rows = createEmptyPurchaseRows(2);
    rows[0] = { ...rows[0], code: 'SUGAR', quantity: '1', unitPrice: '2' };
    rows[1] = { ...rows[1], code: 'SUGAR', quantity: '2', unitPrice: '2' };
    const result = validatePurchaseGrid(rows, products);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.key === 'duplicate')).toBe(true);
  });
});
