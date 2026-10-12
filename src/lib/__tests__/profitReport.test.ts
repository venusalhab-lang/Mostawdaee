import { describe, expect, it } from 'vitest';
import {
  buildProfitCsv, buildProfitReportHtml, plainAmount, profitRows, profitSeries, profitsByCurrency, rangeStart, seriesStep,
} from '../profitReport';
import type { Invoice, Product } from '../../types';

const rates = { USD: 1, JOD: 0.709, ILS: 3.7 };
const product = (id: string, unitCost: number): Product => ({
  id, name: id, sku: id, category: '', brand: '', quantity: 100, unitCost, sellingPrice: 1,
  status: 'In Stock', dateAdded: 0, currency: 'JOD',
});
const byId = new Map([['tea', product('tea', 2)], ['coffee', product('coffee', 5)], ['water', product('water', 0.5)], ['sugar', product('sugar', 0)]]);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

const sale = (id: string, over: Partial<Invoice>): Invoice => ({
  id, invoiceNumber: id, date: at(2026, 9, 11), type: 'sale', currency: 'JOD', items: [], subtotal: 0, taxAmount: 0, totalAmount: 0, ...over,
});

const invoices: Invoice[] = [
  sale('INV-1', { items: [{ productId: 'tea', description: 'tea', quantity: 2, unitPrice: 3, total: 6, unitCost: 2, costCurrency: 'JOD' }], subtotal: 6, totalAmount: 6 }),
  sale('INV-2', { customerName: 'محمد', items: [{ productId: 'coffee', description: 'coffee', quantity: 1, unitPrice: 4, total: 4, unitCost: 5, costCurrency: 'JOD' }], subtotal: 4, totalAmount: 4 }),
  sale('INV-3', { items: [{ productId: 'water', description: 'water', quantity: 1, unitPrice: 7, total: 7, packSize: 12, packName: 'كرتونة' }], subtotal: 7, totalAmount: 7 }),
  sale('INV-4', { items: [{ productId: 'tea', description: 'tea', quantity: 10, unitPrice: 100, total: 1000, unitCost: 2, costCurrency: 'JOD' }], subtotal: 1000, taxAmount: 160, totalAmount: 1160 }),
  sale('INV-5', { items: [{ productId: 'sugar', description: 'sugar', quantity: 1, unitPrice: 1, total: 1 }], subtotal: 1, totalAmount: 1 }),
  sale('INV-6', { currency: 'USD', items: [{ productId: 'tea', description: 'tea', quantity: 1, unitPrice: 10, total: 10, unitCost: 2, costCurrency: 'JOD' }], subtotal: 10, totalAmount: 10 }),
  sale('PUR-1', { type: 'purchase', supplierName: 'مورد', totalAmount: 50, subtotal: 50 }),
];
const rows = profitRows(invoices, byId, rates, 'JOD');
const row = (id: string) => rows.find((r) => r.id === id)!;

describe('profitRows', () => {
  it('shows net sale, cost and profit in the invoice currency so they add up', () => {
    expect(row('INV-4')).toMatchObject({ amount: 1000, tax: 160, cost: 20, profit: 980 });
    for (const r of rows.filter((x) => x.type === 'sale')) expect(r.amount - (r.cost ?? 0)).toBeCloseTo(r.profit!, 9);
  });

  it('keeps a loss negative', () => {
    expect(row('INV-2').profit).toBe(-1);
  });

  it('costs a pack line by its units', () => {
    expect(row('INV-3')).toMatchObject({ cost: 6, profit: 1 });
  });

  it('flags a line without cost', () => {
    expect(row('INV-5')).toMatchObject({ cost: 0, unknownCostLines: 1 });
  });

  it('gives purchases no cost or profit', () => {
    expect(row('PUR-1')).toMatchObject({ type: 'purchase', amount: 50, cost: null, profit: null, party: 'مورد' });
  });
});

describe('profitsByCurrency', () => {
  it('totals each currency on its own without converting', () => {
    const [jod, usd] = profitsByCurrency(rows);
    expect(jod).toMatchObject({ currency: 'JOD', revenue: 1018, cost: 35, profit: 983, saleCount: 5, unknownCostLines: 1 });
    expect(usd.currency).toBe('USD');
    expect(usd.revenue).toBe(10);
    expect(usd.cost).toBeCloseTo(2.82, 2);
  });
});

describe('profit series', () => {
  it('covers every day of the month, quiet days as zero', () => {
    const now = at(2026, 9, 11, 15);
    const start = rangeStart('monthly', now);
    const points = profitSeries(rows.filter((r) => r.currency === 'JOD'), start, now, seriesStep('monthly', start, now), (v) => v);
    expect(points).toHaveLength(11);
    expect(points[0].profit).toBe(0);
    expect(points[10].profit).toBeCloseTo(983, 6);
  });

  it('uses hours for today and months for a long history', () => {
    const now = at(2026, 9, 11, 15);
    expect(seriesStep('today', rangeStart('today', now), now)).toBe('hour');
    const old = [{ date: at(2025, 0, 5) }];
    expect(seriesStep('all', rangeStart('all', now, old), now)).toBe('month');
  });
});

describe('CSV export', () => {
  const csv = buildProfitCsv(rows, { isAr: true, summary: [['صافي المبيعات', '1,018.000 د.أ']] });
  const lines = csv.replace('\ufeff', '').split('\r\n');

  it('quotes every cell, so amounts with thousands separators stay in one column', () => {
    expect(lines[0]).toBe('"صافي المبيعات","1,018.000 د.أ"');
    const inv4 = lines.find((l) => l.includes('"INV-4"'))!;
    expect(inv4.split('","')).toHaveLength(10);
    expect(inv4).toContain('"1000.000","160.000","20.000","980.000"');
  });

  it('writes plain numbers with a minus sign for losses', () => {
    expect(lines.find((l) => l.includes('"INV-2"'))).toContain('"-1.000"');
    expect(plainAmount(1234.5, 'JOD')).toBe('1234.500');
    expect(plainAmount(1234.5, 'USD')).toBe('1234.50');
  });

  it('names walk-in sales in Arabic and notes missing costs', () => {
    expect(lines.find((l) => l.includes('"INV-1"'))).toContain('"زبون نقدي"');
    expect(lines.find((l) => l.includes('"INV-5"'))).toContain('بلا تكلفة');
  });
});

describe('printable report', () => {
  const html = buildProfitReportHtml({
    isAr: true,
    businessName: '<b>متجر</b>',
    periodLabel: 'هذا الشهر',
    displayCurrency: 'JOD',
    totals: { sales: 1025.09, cost: 37, net: 988.09, margin: 96.4, purchases: 50, unknownCostLines: 1 },
    byCurrency: profitsByCurrency(rows),
    converted: true,
    products: [{ name: 'شاي', qty: 13, revenue: 1013, profit: 987, unknownCost: false }],
    rows,
    money: (v, c) => `${v.toFixed(3)} ${c}`,
    formatDate: () => '11/10/2026',
  });

  it('keeps Arabic names and escapes user text', () => {
    expect(html).toContain('شاي');
    expect(html).toContain('محمد');
    expect(html).toContain('&lt;b&gt;متجر&lt;/b&gt;');
    expect(html).not.toContain('<b>متجر</b>');
  });

  it('marks losses, conversion and missing costs', () => {
    expect(html).toContain('<span class="neg">-1.000 JOD</span>');
    expect(html).toContain('بسعر صرف يوم الطباعة');
    expect(html).toContain('سطر مبيع بلا سعر تكلفة');
  });
});
