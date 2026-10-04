import { describe, expect, it } from 'vitest';
import { invoiceNetRevenue, saleInvoiceProfit, snapshotLineCosts, stockValueByCurrency, summarizeProfits, weightedAverageCost } from '../profits';
import type { Invoice, Product } from '../../types';

const rates = { USD: 1, JOD: 0.709, ILS: 3.7 };

const product = (over: Partial<Product>): Product => ({
  id: 'p1', name: 'شاي', sku: 'T1', category: '', brand: '', quantity: 10, unitCost: 2, sellingPrice: 3,
  status: 'In Stock', dateAdded: 0, currency: 'JOD', ...over,
});

const sale = (over: Partial<Invoice>): Invoice => ({
  id: 'i1', invoiceNumber: '1', date: 0, type: 'sale', currency: 'JOD',
  items: [{ productId: 'p1', description: 'شاي', quantity: 2, unitPrice: 3, total: 6 }],
  subtotal: 6, taxAmount: 0, totalAmount: 6, ...over,
});

describe('profits', () => {
  it('excludes VAT from revenue', () => {
    expect(invoiceNetRevenue({ totalAmount: 116, taxAmount: 16 })).toBe(100);
  });

  it('uses the cost snapshot taken at sale time, not today\'s cost', () => {
    const inv = sale({ items: [{ productId: 'p1', description: 'شاي', quantity: 2, unitPrice: 3, total: 6, unitCost: 1, costCurrency: 'JOD' }] });
    const byId = new Map([['p1', product({ unitCost: 5 })]]);
    expect(saleInvoiceProfit(inv, byId, rates, 'JOD')).toMatchObject({ revenue: 6, cost: 2, profit: 4, unknownCostLines: 0 });
  });

  it('keeps losses instead of hiding them', () => {
    const byId = new Map([['p1', product({ unitCost: 4 })]]);
    expect(saleInvoiceProfit(sale({}), byId, rates, 'JOD').profit).toBe(-2);
  });

  it('never invents a cost: unknown cost lines are counted openly', () => {
    const byId = new Map([['p1', product({ unitCost: 0 })]]);
    const p = saleInvoiceProfit(sale({}), byId, rates, 'JOD');
    expect(p.cost).toBe(0);
    expect(p.unknownCostLines).toBe(1);
  });

  it('converts a product cost in another currency to the invoice currency', () => {
    const byId = new Map([['p1', product({ unitCost: 1, currency: 'USD' })]]);
    const p = saleInvoiceProfit(sale({}), byId, rates, 'JOD');
    expect(p.cost).toBeCloseTo(2 * 0.709, 6);
  });

  it('does not count purchases as cost of goods sold', () => {
    const purchase = sale({ id: 'b1', type: 'purchase', totalAmount: 100, subtotal: 100 });
    const t = summarizeProfits([sale({}), purchase], [product({})], rates, 'JOD', 'JOD');
    expect(t.revenue).toBe(6);
    expect(t.cost).toBe(4);
    expect(t.profit).toBe(2);
    expect(t.purchases).toBe(100);
    expect(t.saleCount).toBe(1);
  });

  it('snapshots the current product cost onto new sale lines', () => {
    const byId = new Map([['p1', product({ unitCost: 2.5, currency: 'USD' })]]);
    const [line] = snapshotLineCosts(sale({}).items, byId, 'JOD');
    expect(line.unitCost).toBe(2.5);
    expect(line.costCurrency).toBe('USD');
  });
});

describe('weightedAverageCost', () => {
  const product = { quantity: 10, unitCost: 2, currency: 'JOD' };

  it('averages the stock on hand with the received cost', () => {
    expect(weightedAverageCost(product, 10, 40, 'JOD', 'JOD')).toBe(3);
  });

  it('uses the purchase cost when nothing is on hand', () => {
    expect(weightedAverageCost({ ...product, quantity: 0 }, 4, 10, 'JOD', 'JOD')).toBe(2.5);
    expect(weightedAverageCost({ ...product, quantity: -3 }, 4, 10, 'JOD', 'JOD')).toBe(2.5);
  });

  it('refuses to mix currencies', () => {
    expect(weightedAverageCost(product, 10, 40, 'USD', 'JOD')).toBeNull();
    expect(weightedAverageCost({ ...product, currency: undefined }, 10, 40, 'USD', 'USD')).toBe(3);
  });

  it('ignores empty receipts', () => {
    expect(weightedAverageCost(product, 0, 0, 'JOD', 'JOD')).toBeNull();
  });
});

describe('stockValueByCurrency', () => {
  it('keeps each currency separate and ignores negative stock', () => {
    expect(stockValueByCurrency([
      { quantity: 2, unitCost: 5, currency: 'JOD' },
      { quantity: 3, unitCost: 10, currency: 'USD' },
      { quantity: 1, unitCost: 4 },
      { quantity: -4, unitCost: 100, currency: 'USD' },
    ], 'JOD')).toEqual({ JOD: 14, USD: 30 });
  });
});
