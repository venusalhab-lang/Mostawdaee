import { describe, expect, it } from 'vitest';
import { checkSalePayment, salePayment } from '../salesPayment';
import { planInvoiceVaultEntry } from '../vaultMath';
import type { Invoice } from '../../types';

const sale = (over: Partial<Invoice> = {}): Invoice => ({
  id: 's1',
  invoiceNumber: 'S-1',
  type: 'sale',
  date: 1,
  items: [],
  subtotal: 50,
  taxAmount: 0,
  totalAmount: 50,
  currency: 'USD',
  paymentMethod: 'cash',
  ...over,
});

describe('salePayment', () => {
  it('treats cash sales as paid in full', () => {
    expect(salePayment(sale())).toEqual({ paid: 50, owed: 0 });
  });

  it('treats legacy full credit (no paidAmount) as unpaid', () => {
    expect(salePayment(sale({ paymentMethod: 'credit' }))).toEqual({ paid: 0, owed: 50 });
  });

  it('splits cash + credit on paidAmount', () => {
    expect(salePayment(sale({ paymentMethod: 'credit', paidAmount: 30 }))).toEqual({ paid: 30, owed: 20 });
    expect(salePayment(sale({ paymentMethod: 'credit', paidAmount: 0 }))).toEqual({ paid: 0, owed: 50 });
    expect(salePayment(sale({ paymentMethod: 'credit', paidAmount: 99 }))).toEqual({ paid: 50, owed: 0 });
  });
});

describe('checkSalePayment', () => {
  it('requires a customer for credit', () => {
    expect(checkSalePayment('credit', 50, 30, 'USD', undefined)).toBe('customer_required');
    expect(checkSalePayment('credit', 50, 30, 'USD', 'c1')).toBeNull();
  });

  it('rejects overpay on credit', () => {
    expect(checkSalePayment('credit', 50, 60, 'USD', 'c1')).toBe('paid_exceeds_total');
  });
});

describe('vault plan for split sales', () => {
  it('posts only the paid slice of a credit sale into the vault', () => {
    expect(planInvoiceVaultEntry(sale({ paymentMethod: 'credit' }))).toBeNull();
    expect(planInvoiceVaultEntry(sale({ paymentMethod: 'credit', paidAmount: 0 }))).toBeNull();
    expect(planInvoiceVaultEntry(sale({ paymentMethod: 'credit', paidAmount: 30 }))?.amount).toBe(30);
  });
});
