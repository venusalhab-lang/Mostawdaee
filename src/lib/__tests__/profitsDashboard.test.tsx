import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const now = Date.now();
const products = [
  { id: 'tea', name: 'شاي', quantity: 10, unitCost: 2, sellingPrice: 3, currency: 'JOD' },
  { id: 'coffee', name: 'قهوة', quantity: 10, unitCost: 5, sellingPrice: 4, currency: 'JOD' },
];
const invoices = [
  { id: 'a', invoiceNumber: 'INV-1', date: now, type: 'sale', currency: 'JOD', customerName: '',
    items: [{ productId: 'tea', description: 'شاي', quantity: 10, unitPrice: 100, total: 1000, unitCost: 2, costCurrency: 'JOD' }],
    subtotal: 1000, taxAmount: 160, totalAmount: 1160 },
  { id: 'b', invoiceNumber: 'INV-2', date: now, type: 'sale', currency: 'JOD', customerName: 'محمد',
    items: [{ productId: 'coffee', description: 'قهوة', quantity: 1, unitPrice: 4, total: 4, unitCost: 5, costCurrency: 'JOD' }],
    subtotal: 4, taxAmount: 0, totalAmount: 4 },
  { id: 'c', invoiceNumber: 'INV-3', date: now, type: 'sale', currency: 'USD', customerName: '',
    items: [{ productId: 'tea', description: 'شاي', quantity: 1, unitPrice: 10, total: 10, unitCost: 2, costCurrency: 'JOD' }],
    subtotal: 10, taxAmount: 0, totalAmount: 10 },
];

vi.mock('../../components/FirebaseProvider', () => ({
  useFirebase: () => ({ invoices, products, loading: false, settings: { currency: 'JOD' } }),
}));

describe('ProfitsDashboard', async () => {
  const { default: ProfitsDashboard } = await import('../../components/ProfitsDashboard');
  const html = renderToStaticMarkup(<ProfitsDashboard language="ar" currency="JOD" />);
  const text = html.replace(/<[^>]+>/g, '|');

  it('shows each invoice net of VAT in its own currency, so net sale minus cost equals profit', () => {
    expect(text).toContain('1,000.000 د.أ');
    expect(text).not.toContain('1,160.000');
    expect(text).toContain('980.000 د.أ');
    expect(text).toContain('$10.00');
  });

  it('shows a loss as a negative amount in red, never with a plus sign', () => {
    expect(html).toMatch(/text-rose-600">‎?-1\.000 د\.أ/);
    expect(text).not.toMatch(/\+\s*‎?-/);
  });

  it('labels walk-in sales in Arabic and lists totals per currency when converting', () => {
    expect(text).toContain('زبون نقدي');
    expect(text).not.toContain('Standard POS Sale');
    expect(text).toContain('حسب العملة (بدون تحويل)');
    expect(text).toContain('بسعر صرف اليوم');
  });
});
