import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../types';
import { canReturn, findReturnableSales, planSalesReturn, remainingQty, splitRefund } from '../salesReturn';
import { computeInvoiceTotals } from '../invoiceTotals';

function sale(overrides: Partial<Invoice> = {}): Invoice {
  const items = [
    { productId: 'a', description: 'Tea', quantity: 3, unitPrice: 1.333, total: 3.999 },
    { productId: 'b', description: 'Sugar', quantity: 2, unitPrice: 2.5, total: 5 },
  ];
  const t = computeInvoiceTotals({ subtotal: 8.999, discount: 1, vatRate: 16, currency: 'JOD' });
  return {
    id: 's1', invoiceNumber: 'POS-1', date: 1, type: 'sale', currency: 'JOD', items,
    subtotal: t.subtotal, discount: t.discount, taxAmount: t.taxAmount, totalAmount: t.total, vatRate: 16,
    paymentMethod: 'cash', vaultPosted: true,
    ...overrides,
  };
}

const apply = (inv: Invoice, returnedQty: number[]): Invoice => ({ ...inv, returnedQty });

describe('sales return planning', () => {
  it('returns part of a line at the sale price with its share of discount and tax', () => {
    const r = planSalesReturn(sale(), [{ index: 1, quantity: 1 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.items).toEqual([expect.objectContaining({ productId: 'b', quantity: 1, total: 2.5, sourceLine: 1 })]);
    const { subtotal, discount, taxAmount, totalAmount } = r.plan.figures;
    expect(subtotal).toBe(2.5);
    expect(totalAmount).toBeCloseTo(subtotal - discount + taxAmount, 9);
    expect(r.plan.returnedQty).toEqual([0, 1]);
    expect(r.plan.complete).toBe(false);
  });

  it('adds back up to the sale exactly when it is returned in several steps', () => {
    let inv = sale();
    const totals = { subtotal: 0, discount: 0, taxAmount: 0, totalAmount: 0 };
    for (const step of [[{ index: 0, quantity: 1 }], [{ index: 0, quantity: 1 }, { index: 1, quantity: 1 }], [{ index: 0, quantity: 1 }, { index: 1, quantity: 1 }]]) {
      const r = planSalesReturn(inv, step);
      if (!r.ok) throw new Error(r.error.code);
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r.plan.figures[k];
      expect(r.plan.items.reduce((s, i) => s + i.total, 0)).toBeCloseTo(r.plan.figures.subtotal, 9);
      inv = apply(inv, r.plan.returnedQty);
    }
    const original = sale();
    expect(totals.subtotal).toBeCloseTo(original.subtotal, 9);
    expect(totals.discount).toBeCloseTo(original.discount!, 9);
    expect(totals.taxAmount).toBeCloseTo(original.taxAmount, 9);
    expect(totals.totalAmount).toBeCloseTo(original.totalAmount, 9);
    expect(canReturn(inv)).toBe(false);
  });

  it('refuses more than what is left, nothing at all, or a line that does not exist', () => {
    const inv = apply(sale(), [2, 0]);
    expect(remainingQty(inv)).toEqual([1, 2]);
    expect(planSalesReturn(inv, [{ index: 0, quantity: 2 }])).toEqual({ ok: false, error: { code: 'too_many', index: 0, remaining: 1 } });
    expect(planSalesReturn(inv, [])).toEqual({ ok: false, error: { code: 'empty' } });
    expect(planSalesReturn(inv, [{ index: 5, quantity: 1 }])).toMatchObject({ ok: false, error: { code: 'bad_line' } });
    expect(planSalesReturn(inv, [{ index: 0, quantity: -1 }])).toMatchObject({ ok: false, error: { code: 'bad_line' } });
    expect(planSalesReturn({ ...inv, type: 'purchase' }, [{ index: 0, quantity: 1 }])).toEqual({ ok: false, error: { code: 'not_sale' } });
  });

  it('keeps the credit share in the customer currency', () => {
    const inv = sale({ paymentMethod: 'credit', customerId: 'c1', debtCurrency: 'USD', debtAmount: 14 });
    const r = planSalesReturn(inv, [{ index: 0, quantity: 3 }, { index: 1, quantity: 2 }]);
    if (!r.ok) throw new Error(r.error.code);
    expect(r.plan.figures.debtAmount).toBe(14);
  });
});

describe('refund split', () => {
  const figures = { subtotal: 10, discount: 0, taxAmount: 0, totalAmount: 10 };

  it('pays a cash sale back from the vault', () => {
    expect(splitRefund(sale(), figures, 0)).toEqual({ vault: 10, vaultCurrency: 'JOD', debt: 0, external: 0 });
  });

  it('records a card sale as refunded outside the app', () => {
    expect(splitRefund(sale({ paymentMethod: 'card', vaultPosted: false }), figures, 0))
      .toEqual({ vault: 0, vaultCurrency: 'JOD', debt: 0, external: 10 });
  });

  it('lowers the debt first and returns in cash only what the customer already paid', () => {
    const credit = sale({ paymentMethod: 'credit', vaultPosted: false, debtCurrency: 'USD' });
    const withDebt = { ...figures, debtAmount: 14 };
    expect(splitRefund(credit, withDebt, 20)).toEqual({ vault: 0, vaultCurrency: 'USD', debt: 14, debtCurrency: 'USD', external: 0 });
    expect(splitRefund(credit, withDebt, 5)).toEqual({ vault: 9, vaultCurrency: 'USD', debt: 5, debtCurrency: 'USD', external: 0 });
    expect(splitRefund(credit, withDebt, -3)).toEqual({ vault: 14, vaultCurrency: 'USD', debt: 0, debtCurrency: 'USD', external: 0 });
  });

  it('returns the cash slice of a split tender and lowers the on-account remainder', () => {
    const split = sale({
      paymentMethod: 'credit',
      paidAmount: 30,
      totalAmount: 50,
      debtAmount: 20,
      debtCurrency: 'JOD',
      vaultPosted: true,
    });
    const full = { subtotal: 50, discount: 0, taxAmount: 0, totalAmount: 50, debtAmount: 20 };
    expect(splitRefund(split, full, 20)).toEqual({
      vault: 30, vaultCurrency: 'JOD', debt: 20, debtCurrency: 'JOD', external: 0,
    });
    expect(splitRefund(split, full, 5)).toEqual({
      vault: 45, vaultCurrency: 'JOD', debt: 5, debtCurrency: 'JOD', external: 0,
    });
  });

  it('finds returnable sales by number or customer, newest first', () => {
    const a = sale({ id: '1', invoiceNumber: 'POS-100', customerName: 'Ali', date: 10 });
    const b = sale({ id: '2', invoiceNumber: 'POS-200', customerName: 'Sara', date: 20 });
    const done = sale({ id: '3', invoiceNumber: 'POS-100b', date: 30, returnedQty: [3, 2] });
    expect(findReturnableSales([a, b, done], 'POS-100').map((i) => i.id)).toEqual(['1']);
    expect(findReturnableSales([a, b, done], 'sa').map((i) => i.id)).toEqual(['2']);
    expect(findReturnableSales([a, b, done], '')).toEqual([]);
  });
});
