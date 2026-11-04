import { describe, expect, it } from 'vitest';
import { invoiceNetRevenue, saleInvoiceProfit, saleLineProfits, snapshotLineCosts, stockValueByCurrency, summarizeProfits, weightedAverageCost } from '../profits';
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

  it('skips invoices in currencies that cannot convert, instead of NaN-ing the dashboard', () => {
    const exotic = sale({ id: 'x1', currency: 'EUR' as any, totalAmount: 50, subtotal: 50 });
    const t = summarizeProfits([sale({}), exotic], [product({})], rates, 'JOD', 'JOD');
    expect(Number.isFinite(t.revenue)).toBe(true);
    expect(t.revenue).toBe(6);
    expect(t.saleCount).toBe(2);
  });

  it('takes a return back out of revenue and cost without counting it as a sale', () => {
    const ret = sale({ id: 'r1', type: 'return', items: [{ productId: 'p1', description: 'شاي', quantity: 1, unitPrice: 3, total: 3, unitCost: 2 }],
      subtotal: 3, totalAmount: 3 });
    const t = summarizeProfits([sale({}), ret], [product({})], rates, 'JOD', 'JOD');
    expect(t.revenue).toBe(3);
    expect(t.cost).toBe(2);
    expect(t.profit).toBe(1);
    expect(t.saleCount).toBe(1);
  });

  it('snapshots the current product cost onto new sale lines', () => {
    const byId = new Map([['p1', product({ unitCost: 2.5, currency: 'USD' })]]);
    const [line] = snapshotLineCosts(sale({}).items, byId, 'JOD');
    expect(line.unitCost).toBe(2.5);
    expect(line.costCurrency).toBe('USD');
  });
});

describe('saleLineProfits', () => {
  it('spreads the invoice discount by line value and excludes VAT', () => {
    const inv = sale({
      items: [
        { productId: 'p1', description: 'a', quantity: 2, unitPrice: 30, total: 60 },
        { productId: 'p2', description: 'b', quantity: 1, unitPrice: 40, total: 40 },
      ],
      subtotal: 100, discount: 10, taxAmount: 14.4, totalAmount: 104.4,
    });
    const byId = new Map([['p1', product({ id: 'p1', unitCost: 20 })], ['p2', product({ id: 'p2', unitCost: 0 })]]);
    const lines = saleLineProfits(inv, byId, rates, 'JOD');
    expect(lines[0].revenue).toBeCloseTo(54, 9);
    expect(lines[1].revenue).toBeCloseTo(36, 9);
    expect(lines[0].revenue + lines[1].revenue).toBeCloseTo(saleInvoiceProfit(inv, byId, rates, 'JOD').revenue, 9);
    expect(lines[0].cost).toBe(40);
    expect(lines[1].cost).toBeNull();
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

  it('refuses to mix currencies into an existing cost basis, but lets empty stock adopt the purchase', () => {
    expect(weightedAverageCost(product, 10, 40, 'USD', 'JOD')).toBeNull();
    expect(weightedAverageCost({ ...product, quantity: 0 }, 10, 40, 'USD', 'JOD')).toBe(4);
    expect(weightedAverageCost({ ...product, currency: undefined }, 10, 40, 'USD', 'USD')).toBe(3);
  });

  it('ignores empty receipts', () => {
    expect(weightedAverageCost(product, 0, 0, 'JOD', 'JOD')).toBeNull();
  });

  it('does not dilute the purchase cost with stock that has no recorded cost', () => {
    expect(weightedAverageCost({ quantity: 10, unitCost: 0, currency: 'JOD' }, 10, 100, 'JOD', 'JOD')).toBe(10);
  });
});

describe('snapshotLineCosts without a cost', () => {
  it('leaves the cost unknown instead of recording 0', () => {
    const byId = new Map([['p1', product({ unitCost: 0, costPrice: undefined })]]);
    const [line] = snapshotLineCosts(sale({}).items, byId, 'JOD');
    expect(line.unitCost).toBeUndefined();
    const p = saleInvoiceProfit({ ...sale({}), items: [line] }, byId, {}, 'JOD');
    expect(p.unknownCostLines).toBe(1);
  });

  it('pins free/service lines at zero cost so profits do not warn', () => {
    const [line] = snapshotLineCosts(
      [{ productId: 'adhoc:x', description: 'Fee', quantity: 1, unitPrice: 10, total: 10, adhoc: true }],
      new Map(),
      'JOD',
    );
    expect(line.unitCost).toBe(0);
    expect(line.costCurrency).toBe('JOD');
    const p = saleInvoiceProfit(
      { ...sale({}), items: [line], subtotal: 10, discount: 0, taxAmount: 0, totalAmount: 10, vatRate: 0 },
      new Map(),
      {},
      'JOD',
    );
    expect(p.unknownCostLines).toBe(0);
    expect(p.revenue).toBe(10);
    expect(p.cost).toBe(0);
    expect(p.profit).toBe(10);
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
