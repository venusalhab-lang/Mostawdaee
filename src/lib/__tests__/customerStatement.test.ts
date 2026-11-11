import { describe, expect, it } from 'vitest';
import type { Customer, CustomerTransaction, Invoice } from '../../types';
import {
  buildWhatsAppStatement,
  customerPurchaseRows,
  filterCustomerStatement,
  purchaseTotalsByCurrency,
  statementLineDetail,
  statementPeriod,
  sumStatementByType,
} from '../customerStatement';

const customer: Customer = {
  id: 'c1', customerId: 'c1', name: 'أبو أحمد', phone: '0599', createdAt: '', totalDebt: 150, currency: 'ILS',
};

const tx = (over: Partial<CustomerTransaction>): CustomerTransaction => ({
  id: 't1', transactionId: 't1', customerId: 'c1', type: 'invoice', amount: 50, currency: 'ILS',
  exchangeRate: 1, date: '2026-03-10T12:00:00.000Z', notes: 'بيع', remainingBalanceAfter: 50, ...over,
});

describe('statementPeriod', () => {
  it('builds this month and last month bounds', () => {
    const now = new Date(2026, 2, 15); // March 15
    const thisMonth = statementPeriod('this_month', undefined, undefined, now);
    expect(new Date(thisMonth.fromMs!).getDate()).toBe(1);
    expect(new Date(thisMonth.fromMs!).getMonth()).toBe(2);
    expect(new Date(thisMonth.toMs!).getMonth()).toBe(2);
    expect(new Date(thisMonth.toMs!).getDate()).toBe(31);

    const last = statementPeriod('last_month', undefined, undefined, now);
    expect(new Date(last.fromMs!).getMonth()).toBe(1);
    expect(new Date(last.toMs!).getMonth()).toBe(1);
  });
});

describe('filterCustomerStatement', () => {
  it('filters by customer, period and search, oldest first', () => {
    const rows = [
      tx({ id: 'a', date: '2026-03-20T10:00:00.000Z', notes: 'سكر' }),
      tx({ id: 'b', date: '2026-02-05T10:00:00.000Z', notes: 'شاي' }),
      tx({ id: 'c', date: '2026-03-01T10:00:00.000Z', notes: 'رز', customerId: 'other' }),
      tx({ id: 'd', date: '2026-03-05T10:00:00.000Z', notes: 'قهوة' }),
    ];
    const period = statementPeriod('custom', '2026-03-01', '2026-03-31');
    const filtered = filterCustomerStatement(rows, 'c1', period);
    expect(filtered.map((r) => r.id)).toEqual(['d', 'a']);

    const searched = filterCustomerStatement(rows, 'c1', period, 'سكر');
    expect(searched.map((r) => r.id)).toEqual(['a']);
  });
});

describe('buildWhatsAppStatement', () => {
  it('includes every movement in the period, not only five', () => {
    const rows = Array.from({ length: 8 }, (_, i) => tx({
      id: `t${i}`,
      transactionId: `t${i}`,
      date: `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
      notes: `صنف ${i + 1}`,
      amount: 10,
      remainingBalanceAfter: (i + 1) * 10,
    }));
    const text = buildWhatsAppStatement({
      customer,
      txs: filterCustomerStatement(rows, 'c1', statementPeriod('this_month', undefined, undefined, new Date(2026, 2, 15))),
      period: statementPeriod('this_month', undefined, undefined, new Date(2026, 2, 15)),
      businessName: 'مستودعي',
      isRtl: true,
      isReturnCredit: () => false,
      invoices: [],
    });
    expect(text).toContain('صنف 1');
    expect(text).toContain('صنف 8');
    expect(text).toContain('أبو أحمد');
  });

  it('keeps the newest movements when the text is too long for a WhatsApp link', () => {
    const rows = Array.from({ length: 40 }, (_, i) => tx({
      id: `t${i}`, transactionId: `t${i}`, notes: `حركة رقم ${i + 1}`,
      date: new Date(2026, 2, 1 + (i % 28), 10, i).toISOString(),
    }));
    const text = buildWhatsAppStatement({
      customer, txs: rows, period: statementPeriod('all'), isRtl: true, isReturnCredit: () => false, invoices: [], maxChars: 900,
    });
    expect(text.length).toBeLessThanOrEqual(900);
    expect(text).toContain('حركة رقم 40');
    expect(text).not.toContain('حركة رقم 1\n');
    expect(text).toContain('من 40 حركة');
  });
});

const invoice = (over: Partial<Invoice>): Invoice => ({
  id: 'inv1', invoiceNumber: 'POS-1', date: new Date(2026, 2, 10, 14, 30).getTime(), items: [], subtotal: 0, taxAmount: 0,
  totalAmount: 0, type: 'sale', currency: 'ILS', customerId: 'c1', ...over,
});

describe('customerPurchaseRows', () => {
  const sugar = { productId: 'p1', description: 'سكر', quantity: 2, unitPrice: 5, total: 10, sku: 'S1' };
  const tea = { productId: 'p2', description: 'شاي', quantity: 1, unitPrice: 12, total: 12, packSize: 6, packName: 'كرتونة' };

  it('lists every item of the customer in the period with date and pack quantity, any payment method', () => {
    const rows = customerPurchaseRows([
      invoice({ id: 'a', invoiceNumber: 'POS-2', items: [tea], paymentMethod: 'cash', date: new Date(2026, 2, 12).getTime() }),
      invoice({ id: 'b', items: [sugar], paymentMethod: 'credit' }),
      invoice({ id: 'c', items: [sugar], customerId: 'other' }),
      invoice({ id: 'd', items: [sugar], date: new Date(2026, 1, 1).getTime() }),
      invoice({ id: 'e', items: [sugar], type: 'purchase' }),
    ], 'c1', statementPeriod('custom', '2026-03-01', '2026-03-31'), true);
    expect(rows.map((r) => [r.invoiceId, r.description])).toEqual([['b', 'سكر'], ['a', 'شاي']]);
    expect(rows[1].quantityText).toBe('1 كرتونة (6)');
    expect(rows[1].units).toBe(6);
  });

  it('nets returns against sales per currency', () => {
    const rows = customerPurchaseRows([
      invoice({ id: 'a', items: [sugar] }),
      invoice({ id: 'r', type: 'return', items: [{ ...sugar, quantity: 1, total: 5 }] }),
      invoice({ id: 'u', currency: 'USD', items: [{ ...sugar, total: 3 }] }),
    ], 'c1', statementPeriod('all'), true);
    expect(purchaseTotalsByCurrency(rows)).toEqual([
      { currency: 'ILS', sales: 10, returns: 5, net: 5 },
      { currency: 'USD', sales: 3, returns: 0, net: 3 },
    ]);
  });

  it('finds a credit movement by the name of an item on its invoice', () => {
    const inv = invoice({ id: 'b', items: [sugar] });
    const rows = filterCustomerStatement(
      [tx({ id: 'x', invoiceId: 'b', notes: 'فاتورة بيع آجل #POS-1' })],
      'c1', statementPeriod('all'), 'سكر', [inv],
    );
    expect(rows).toHaveLength(1);
    expect(statementLineDetail(rows[0], [inv], true)).toBe('#POS-1 — سكر × 2');
  });
});

describe('sumStatementByType', () => {
  it('splits invoices and payments in one currency', () => {
    const sums = sumStatementByType([
      tx({ type: 'invoice', amount: 100 }),
      tx({ id: 'p', type: 'payment', amount: 40 }),
    ], 'ILS', () => false);
    expect(sums).toEqual({ invoices: 100, payments: 40, returns: 0 });
  });
});
