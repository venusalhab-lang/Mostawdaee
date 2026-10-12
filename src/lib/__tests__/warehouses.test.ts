import { describe, expect, it } from 'vitest';
import type { Product, Warehouse } from '../../types';
import {
  canDeleteWarehouse,
  deleteBlockers,
  orderWarehouses,
  transferCandidates,
  validateTransfer,
  validateWarehouse,
  warehouseStats,
} from '../warehouses';

const wh = (id: string, name: string, parentId: string | null = null): Warehouse => ({ id, name, parentId, createdAt: 1 });

const product = (overrides: Partial<Product>): Product => ({
  id: overrides.id || 'p',
  name: 'Item',
  sku: 'SKU',
  category: '',
  brand: '',
  quantity: 1,
  unitCost: 10,
  sellingPrice: 15,
  currency: 'JOD',
  status: 'in-stock' as Product['status'],
  dateAdded: 1,
  ...overrides,
});

const warehouses = [wh('b', 'Beta'), wh('a', 'Alpha'), wh('a2', 'Alpha East', 'a'), wh('a1', 'Alpha North', 'a'), wh('o', 'Orphan', 'gone')];

describe('warehouse hierarchy', () => {
  it('lists each main warehouse followed by its branches; orphans become main', () => {
    expect(orderWarehouses(warehouses, 'en').map((w) => w.id)).toEqual(['a', 'a2', 'a1', 'b', 'o']);
  });
});

describe('warehouse stats', () => {
  const products = [
    product({ id: '1', warehouseId: 'a', quantity: 2.5, unitCost: 4 }),
    product({ id: '2', warehouseId: 'a', quantity: 0.1, unitCost: 0, costPrice: undefined }),
    product({ id: '3', warehouseId: 'a', quantity: 0.2, currency: 'ILS', unitCost: 5 }),
    product({ id: '4', warehouseId: 'a', quantity: 0 }),
    product({ id: '5', quantity: 7 }),
  ];

  it('sums decimal quantities without float noise and keeps currencies apart', () => {
    const stats = warehouseStats(products, 'a', 'JOD');
    expect(stats).toMatchObject({ stocked: 3, empty: 1, quantity: 2.8, missingCost: 1 });
    expect(stats.valueAtCost).toEqual({ JOD: 10, ILS: 1 });
  });

  it('treats products without a warehouse as the general store', () => {
    expect(warehouseStats(products, '', 'JOD')).toMatchObject({ stocked: 1, quantity: 7 });
  });
});

describe('deleting a warehouse', () => {
  it('is blocked while branches or products still point at it', () => {
    const products = [product({ id: '1', warehouseId: 'a' }), product({ id: '2', warehouseId: 'a', quantity: 0 })];
    const blockers = deleteBlockers('a', warehouses, products);
    expect(blockers).toEqual({ children: 2, stocked: 1, empty: 1 });
    expect(canDeleteWarehouse(blockers)).toBe(false);
    expect(canDeleteWarehouse(deleteBlockers('b', warehouses, products))).toBe(true);
  });
});

describe('warehouse form', () => {
  it('requires a unique name', () => {
    expect(validateWarehouse({ name: '  ', parentId: null }, warehouses, null)).toBe('name');
    expect(validateWarehouse({ name: ' alpha ', parentId: null }, warehouses, null)).toBe('duplicate');
    expect(validateWarehouse({ name: 'Alpha', parentId: null }, warehouses, 'a')).toBeNull();
  });

  it('allows one level of nesting under an existing main warehouse', () => {
    expect(validateWarehouse({ name: 'New', parentId: 'a' }, warehouses, null)).toBeNull();
    expect(validateWarehouse({ name: 'New', parentId: 'a1' }, warehouses, null)).toBe('parent');
    expect(validateWarehouse({ name: 'New', parentId: 'missing' }, warehouses, null)).toBe('parent');
    expect(validateWarehouse({ name: 'Alpha', parentId: 'b' }, warehouses, 'a')).toBe('has_children');
    expect(validateWarehouse({ name: 'Beta', parentId: 'b' }, warehouses, 'b')).toBe('parent');
  });
});

describe('stock transfer', () => {
  const products = [
    product({ id: 'z', name: 'Zeta', warehouseId: 'a', quantity: 2.5 }),
    product({ id: 'y', name: 'Yam', warehouseId: 'a', quantity: 0 }),
    product({ id: 'x', name: 'Xen', quantity: 4 }),
  ];

  it('offers only stocked rows from the chosen location', () => {
    expect(transferCandidates(products, 'a', 'en').map((p) => p.id)).toEqual(['z']);
    expect(transferCandidates(products, '', 'en').map((p) => p.id)).toEqual(['x']);
  });

  it('accepts decimal quantities and moving back to the general store', () => {
    expect(validateTransfer(products[0], '', 1.25)).toBeNull();
    expect(validateTransfer(products[0], 'b', 2.5)).toBeNull();
  });

  it('refuses the same location, zero and more than available', () => {
    expect(validateTransfer(products[0], 'a', 1)).toBe('same');
    expect(validateTransfer(products[0], 'b', 0)).toBe('quantity');
    expect(validateTransfer(products[0], 'b', Number.NaN)).toBe('quantity');
    expect(validateTransfer(products[0], 'b', 2.501)).toBe('exceeds');
    expect(validateTransfer(undefined, 'b', 1)).toBe('product');
  });
});
