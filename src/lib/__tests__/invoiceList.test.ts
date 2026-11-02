import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../types';
import {
  filterInvoiceList,
  invoiceListWindow,
  invoicePaymentLabel,
  isSplitTender,
  matchesPaymentFilter,
  summarizeInvoiceList,
} from '../invoiceList';

const inv = (over: Partial<Invoice> = {}): Invoice => ({
  id: '1',
  invoiceNumber: 'S-1',
  type: 'sale',
  date: Date.parse('2026-10-26T12:00:00+03:00'),
  items: [],
  subtotal: 50,
  taxAmount: 0,
  totalAmount: 50,
  currency: 'USD',
  paymentMethod: 'cash',
  ...over,
});

describe('invoiceList', () => {
  it('labels split tender honestly', () => {
    expect(invoicePaymentLabel(inv({ paymentMethod: 'credit', paidAmount: 30 }), true)).toBe('نقد + آجل');
    expect(isSplitTender(inv({ paymentMethod: 'credit', paidAmount: 30 }))).toBe(true);
    expect(matchesPaymentFilter(inv({ paymentMethod: 'credit', paidAmount: 30 }), 'split')).toBe(true);
    expect(matchesPaymentFilter(inv({ paymentMethod: 'credit' }), 'credit')).toBe(true);
    expect(matchesPaymentFilter(inv({ paymentMethod: 'credit' }), 'split')).toBe(false);
  });

  it('filters by type, payment and range', () => {
    const now = Date.parse('2026-10-26T18:00:00+03:00');
    const list = [
      inv({ id: 'a', paymentMethod: 'credit', paidAmount: 20 }),
      inv({ id: 'b', type: 'purchase', paymentMethod: 'cash', invoiceNumber: 'P-1' }),
      inv({ id: 'c', type: 'return', date: Date.parse('2026-10-20T12:00:00+03:00') }),
    ];
    expect(filterInvoiceList(list, {
      query: '', currency: 'ALL', range: 'today', type: 'sales', payment: 'split', now,
      matchesQuery: () => true,
    }).map((i) => i.id)).toEqual(['a']);
    expect(filterInvoiceList(list, {
      query: '', currency: 'ALL', range: 'all', type: 'returns', payment: 'all', now,
      matchesQuery: () => true,
    }).map((i) => i.id)).toEqual(['c']);
  });

  it('summarizes open credit without mixing currencies', () => {
    const s = summarizeInvoiceList([
      inv({ paymentMethod: 'credit', paidAmount: 30, debtAmount: 20, debtCurrency: 'USD' }),
      inv({ id: '2', currency: 'JOD', totalAmount: 10, paymentMethod: 'credit', debtAmount: 10, debtCurrency: 'JOD' }),
    ]);
    expect(s.count).toBe(2);
    expect(s.openCreditByCurrency.USD).toBe(20);
    expect(s.openCreditByCurrency.JOD).toBe(10);
  });

  it('builds day windows from local midnight', () => {
    const now = Date.parse('2026-10-26T15:00:00+03:00');
    const today = invoiceListWindow('today', now)!;
    expect(today.start).toBeLessThanOrEqual(now);
    expect(today.end).toBe(now);
  });
});
