import { describe, expect, it } from 'vitest';
import type { Invoice, Product } from '../../types';
import { estimateCost, groupBySupplier, lastPurchases, planReorder, unitsSoldSince } from '../reorder';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 14);

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'Rice', sku: 'R1', category: '', brand: '', quantity: 10, unitCost: 2, sellingPrice: 3,
  currency: 'JOD', status: 'In Stock', lowStockThreshold: 5, dateAdded: NOW - 100 * DAY, ...over,
});

const inv = (over: Partial<Invoice>): Invoice => ({
  id: Math.random().toString(36), invoiceNumber: 'X', date: NOW - DAY, items: [], subtotal: 0, taxAmount: 0,
  totalAmount: 0, type: 'sale', currency: 'JOD', ...over,
});

const opts = { now: NOW, windowDays: 30, coverDays: 14, defaultCurrency: 'JOD' as const };

describe('reorder', () => {
  it('nets sales returns and counts pack lines in units', () => {
    const sold = unitsSoldSince([
      inv({ items: [{ productId: 'p1', description: '', quantity: 2, unitPrice: 1, total: 2, packSize: 12 }] }),
      inv({ type: 'return', items: [{ productId: 'p1', description: '', quantity: 4, unitPrice: 1, total: 4 }] }),
      inv({ date: NOW - 40 * DAY, items: [{ productId: 'p1', description: '', quantity: 99, unitPrice: 1, total: 99 }] }),
      inv({ type: 'purchase', items: [{ productId: 'p1', description: '', quantity: 50, unitPrice: 1, total: 50 }] }),
    ], NOW - 30 * DAY);
    expect(sold.get('p1')).toBe(20);
  });

  it('tops stock up to rate × cover days + the low-stock level', () => {
    // 60 units in 30 days = 2/day; 2 × 14 + 5 − 10 = 23
    const [line] = planReorder([product()], [inv({ items: [{ productId: 'p1', description: '', quantity: 60, unitPrice: 3, total: 180 }] })], opts);
    expect(line.perDay).toBe(2);
    expect(line.daysLeft).toBe(5);
    expect(line.suggestedUnits).toBe(23);
  });

  it('rounds up to whole packs', () => {
    const [line] = planReorder([product({ packSize: 12 })], [inv({ items: [{ productId: 'p1', description: '', quantity: 60, unitPrice: 3, total: 180 }] })], opts);
    expect(line.suggestedUnits).toBe(24);
    expect(line.packSize).toBe(12);
  });

  it('does not judge a new product on a few days of sales', () => {
    const [line] = planReorder([product({ dateAdded: NOW - 2 * DAY })], [inv({ items: [{ productId: 'p1', description: '', quantity: 14, unitPrice: 3, total: 42 }] })], opts);
    expect(line.rateDays).toBe(7);
    expect(line.perDay).toBe(2);
  });

  it('lists low stock without sales but suggests nothing it cannot back up', () => {
    const lines = planReorder([product({ quantity: 3 }), product({ id: 'p2', quantity: 50 }), product({ id: 'a', quantity: 0, type: 'asset' })], [], opts);
    expect(lines.map((l) => l.product.id)).toEqual(['p1']);
    expect(lines[0].suggestedUnits).toBe(0);
    expect(lines[0].daysLeft).toBeNull();
  });

  it('skips products that have enough for the cover period', () => {
    const lines = planReorder([product({ quantity: 100 })], [inv({ items: [{ productId: 'p1', description: '', quantity: 30, unitPrice: 3, total: 90 }] })], opts);
    expect(lines).toEqual([]);
  });

  it('takes the supplier and unit cost of the latest purchase, per unit even on pack lines', () => {
    const last = lastPurchases([
      inv({ type: 'purchase', date: NOW - 20 * DAY, supplierId: 's-old', supplierName: 'Old', items: [{ productId: 'p1', description: '', quantity: 1, unitPrice: 5, total: 5 }] }),
      inv({ id: 'new', type: 'purchase', date: NOW - 5 * DAY, supplierId: 's1', supplierName: 'Nour', currency: 'USD', items: [{ productId: 'p1', description: '', quantity: 2, unitPrice: 30, total: 60, packSize: 12 }] }),
    ]);
    expect(last.get('p1')).toMatchObject({ invoiceId: 'new', supplierId: 's1', unitCost: 2.5, currency: 'USD' });
  });

  it('falls back to the average cost in the product currency', () => {
    const [line] = planReorder([product({ quantity: 1, unitCost: 4, currency: 'ILS' })], [], opts);
    expect(line.unitCost).toBe(4);
    expect(line.costCurrency).toBe('ILS');
  });

  it('groups by supplier with never-bought products last, and keeps currencies apart', () => {
    const lines = planReorder(
      [product({ id: 'a', quantity: 1 }), product({ id: 'b', quantity: 1 }), product({ id: 'c', quantity: 1 })],
      [
        inv({ type: 'purchase', supplierId: 's1', supplierName: 'Nour', currency: 'USD', items: [{ productId: 'a', description: '', quantity: 1, unitPrice: 10, total: 10 }] }),
        inv({ type: 'purchase', supplierName: 'Cash supplier', items: [{ productId: 'b', description: '', quantity: 1, unitPrice: 2, total: 2 }] }),
      ],
      opts,
    );
    const groups = groupBySupplier(lines);
    expect(groups.map((g) => g.supplierName ?? '')).toEqual(['Nour', 'Cash supplier', '']);
    expect(estimateCost(lines, () => 3)).toEqual({ USD: 30, JOD: 12 });
  });
});
