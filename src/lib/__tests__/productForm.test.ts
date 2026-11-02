import { describe, expect, it } from 'vitest';
import {
  defaultProductCategory,
  generateProductSku,
  productHasAdvancedDetails,
  resolveProductCategory,
  resolveProductSku,
} from '../productForm';

describe('productForm helpers', () => {
  it('builds a short SKU- prefix without inventing stock', () => {
    expect(generateProductSku('abcd-efgh-ijkl-mnop')).toBe('SKU-ABCDEFGH');
    expect(resolveProductSku('  123  ')).toBe('123');
    expect(resolveProductSku('', 'zzzzzzzz-1111-2222-3333')).toBe('SKU-ZZZZZZZZ');
  });

  it('defaults category for empty create forms', () => {
    expect(defaultProductCategory(true)).toBe('عام');
    expect(defaultProductCategory(false)).toBe('General');
    expect(resolveProductCategory('', true)).toBe('عام');
    expect(resolveProductCategory('مشروبات', false)).toBe('مشروبات');
  });

  it('opens advanced only when optional fields are present', () => {
    expect(productHasAdvancedDetails({ name: 'A' })).toBe(false);
    expect(productHasAdvancedDetails({ brand: 'X' })).toBe(true);
    expect(productHasAdvancedDetails({ packSize: 12 }, false)).toBe(true);
    expect(productHasAdvancedDetails({}, true)).toBe(true);
    expect(productHasAdvancedDetails({ warehouseId: 'wh1' })).toBe(true);
  });
});
