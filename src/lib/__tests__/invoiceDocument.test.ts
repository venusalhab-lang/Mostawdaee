import { describe, expect, it } from 'vitest';
import {
  buildInvoicePrintHtml,
  formatCurrencyTotals,
  invoiceDocumentTitle,
  invoiceVatRate,
  paymentMethodLabel,
  sumInvoicesByCurrency,
} from '../invoiceDocument';
import type { Invoice } from '../../types';

const base = {
  id: '1',
  invoiceNumber: 'SAL-1',
  date: 0,
  items: [],
  subtotal: 100,
  taxAmount: 16,
  totalAmount: 116,
  type: 'sale' as const,
  currency: 'JOD' as const,
};

describe('invoiceVatRate', () => {
  it('uses the stored rate even when settings would differ', () => {
    expect(invoiceVatRate({ ...base, vatRate: 5, taxAmount: 5 })).toBe(5);
  });

  it('derives the rate from tax and subtotal for older invoices', () => {
    expect(invoiceVatRate({ taxAmount: 16, subtotal: 100 })).toBe(16);
  });

  it('returns 0 when there is no tax', () => {
    expect(invoiceVatRate({ taxAmount: 0, subtotal: 80 })).toBe(0);
  });

  it('keeps an explicitly stored zero rate', () => {
    expect(invoiceVatRate({ vatRate: 0, taxAmount: 16, subtotal: 100 })).toBe(0);
  });
});

describe('invoice document labels', () => {
  it('does not claim a tax invoice without a tax number', () => {
    expect(invoiceDocumentTitle(base, false, false)).toBe('Sales Invoice');
    expect(invoiceDocumentTitle(base, true, true)).toBe('فاتورة ضريبية');
  });

  it('labels missing payment method as cash', () => {
    expect(paymentMethodLabel(undefined, false)).toBe('Cash');
    expect(paymentMethodLabel('credit', true)).toBe('آجل');
  });
});

describe('sumInvoicesByCurrency', () => {
  it('does not mix currencies into one total', () => {
    const invoices = [
      { ...base, type: 'sale', currency: 'JOD', totalAmount: 10 },
      { ...base, id: '2', type: 'sale', currency: 'USD', totalAmount: 4 },
      { ...base, id: '3', type: 'purchase', currency: 'JOD', totalAmount: 2 },
    ] as Invoice[];
    expect(sumInvoicesByCurrency(invoices, 'sale')).toEqual({ JOD: 10, USD: 4 });
    expect(formatCurrencyTotals(sumInvoicesByCurrency(invoices, 'purchase'), '—')).toContain('د.أ');
  });
});

describe('buildInvoicePrintHtml', () => {
  const ctx = { products: [], isRtl: false, businessName: 'Shop' };

  it('prints the discount so the lines add up to the total', () => {
    const html = buildInvoicePrintHtml({ ...ctx, invoice: { ...base, discount: 10, taxAmount: 14.4, totalAmount: 104.4 } });
    expect(html).toContain('Discount');
  });

  it('omits the discount row when there is none', () => {
    expect(buildInvoicePrintHtml({ ...ctx, invoice: base })).not.toContain('Discount');
  });
});
