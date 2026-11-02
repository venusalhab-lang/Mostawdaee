import { describe, expect, it } from 'vitest';
import type { Invoice, Supplier, SupplierTransaction } from '../../types';
import {
  checkPurchasePayment,
  findSupplierByName,
  owedBalances,
  purchaseDeleteRequiresSupplierLedger,
  purchasePayment,
  runningBalances,
  supplierSuggestions,
  totalOwed,
  withBalance,
} from '../suppliers';
import { planInvoiceVaultEntry } from '../vaultMath';

const purchase = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'p1', invoiceNumber: 'PINV-1', date: 0, type: 'purchase', currency: 'JOD',
  items: [{ productId: 'x', description: 'X', quantity: 10, unitPrice: 2, total: 20 }],
  subtotal: 20, taxAmount: 3.2, totalAmount: 23.2, paymentMethod: 'cash', ...over,
});

describe('purchasePayment', () => {
  it('pays a cash purchase in full and owes nothing', () => {
    expect(purchasePayment(purchase())).toEqual({ paid: 23.2, owed: 0 });
  });

  it('splits a partial purchase and clamps what was paid to the total', () => {
    expect(purchasePayment(purchase({ paymentMethod: 'credit', paidAmount: 10 }))).toEqual({ paid: 10, owed: 13.2 });
    expect(purchasePayment(purchase({ paymentMethod: 'credit' }))).toEqual({ paid: 0, owed: 23.2 });
    expect(purchasePayment(purchase({ paymentMethod: 'credit', paidAmount: 99 }))).toEqual({ paid: 23.2, owed: 0 });
  });

  it('takes from the vault only what was paid', () => {
    expect(planInvoiceVaultEntry(purchase())?.amount).toBe(23.2);
    expect(planInvoiceVaultEntry(purchase({ paymentMethod: 'credit', paidAmount: 10 }))?.amount).toBe(10);
    expect(planInvoiceVaultEntry(purchase({ paymentMethod: 'credit', paidAmount: 0 }))).toBeNull();
  });
});

describe('checkPurchasePayment', () => {
  it('needs a registered supplier and a paid part within the total', () => {
    expect(checkPurchasePayment('cash', 20, 0, 'JOD', undefined)).toBeNull();
    expect(checkPurchasePayment('credit', 20, 0, 'JOD', undefined)).toBe('supplier_required');
    expect(checkPurchasePayment('credit', 20, -1, 'JOD', 's1')).toBe('paid_invalid');
    expect(checkPurchasePayment('credit', 20, 20.0001, 'JOD', 's1')).toBeNull();
    expect(checkPurchasePayment('credit', 20, 20.001, 'JOD', 's1')).toBe('paid_exceeds_total');
    expect(checkPurchasePayment('credit', 20, 5, 'JOD', 's1')).toBeNull();
  });
});

describe('purchaseDeleteRequiresSupplierLedger', () => {
  it('requires a ledger only when credit AP or return debt would be reversed', () => {
    expect(purchaseDeleteRequiresSupplierLedger(purchase())).toBe(false);
    expect(purchaseDeleteRequiresSupplierLedger(purchase({ paymentMethod: 'credit', paidAmount: 23.2, supplierId: 's1' }))).toBe(false);
    expect(purchaseDeleteRequiresSupplierLedger(purchase({ paymentMethod: 'credit', paidAmount: 10, supplierId: 's1' }))).toBe(true);
    expect(purchaseDeleteRequiresSupplierLedger(purchase({ paymentMethod: 'credit', paidAmount: 10 }))).toBe(false);
    expect(purchaseDeleteRequiresSupplierLedger({
      ...purchase({ type: 'purchase_return', paymentMethod: 'cash' }),
      supplierId: 's1',
      refund: { debt: 5, vault: 0, vaultCurrency: 'JOD', external: 0 },
    })).toBe(true);
    expect(purchaseDeleteRequiresSupplierLedger({
      ...purchase({ type: 'purchase_return', paymentMethod: 'cash' }),
      supplierId: 's1',
      refund: { debt: 0, vault: 8, vaultCurrency: 'JOD', external: 0 },
    })).toBe(false);
  });
});

describe('balances', () => {
  const supplier = (balances: Supplier['balances'], name = 'المورد'): Supplier => ({ id: name, name, balances, createdAt: 0 });

  it('keeps one balance per currency and never mixes them', () => {
    const b = withBalance(withBalance({ JOD: 10 }, 'USD', 5.555), 'JOD', -2.5);
    expect(b).toEqual({ JOD: 7.5, USD: 5.56 });
    expect(owedBalances(supplier(b))).toEqual([{ currency: 'JOD', amount: 7.5 }, { currency: 'USD', amount: 5.56 }]);
    expect(totalOwed([supplier({ JOD: 1 }), supplier({ JOD: 2, ILS: 3 })])).toEqual({ JOD: 3, ILS: 3 });
  });

  it('suggests names typed on old purchases that are not suppliers yet', () => {
    const invoices = [
      purchase({ supplierName: ' شركة  النور ' }),
      purchase({ id: 'p2', supplierName: 'شركة النور' }),
      purchase({ id: 'p3', supplierName: 'الأمل' }),
      purchase({ id: 'p4', supplierName: 'موجود', supplierId: 's9' }),
      purchase({ id: 'p5', supplierName: 'مسجل' }),
    ];
    expect(supplierSuggestions(invoices, [supplier({}, 'مسجل')])).toEqual([
      { name: 'شركة النور', purchases: 2 },
      { name: 'الأمل', purchases: 1 },
    ]);
    expect(findSupplierByName([supplier({}, 'شركة النور')], '  شركة النور')).toBeDefined();
  });
});

describe('runningBalances', () => {
  const tx = (id: string, type: SupplierTransaction['type'], amount: number, date: number, currency: SupplierTransaction['currency'] = 'JOD'): SupplierTransaction =>
    ({ id, supplierId: 's1', type, amount, currency, date, balanceAfter: 999 });

  it('recomputes each balance per currency from the remaining entries', () => {
    const rows = [tx('a', 'opening', 100, 1), tx('b', 'purchase', 50, 2), tx('u', 'purchase', 7, 2, 'USD'), tx('c', 'payment', 30, 3)];
    const all = runningBalances(rows);
    expect([all.get('a'), all.get('b'), all.get('c'), all.get('u')]).toEqual([100, 150, 120, 7]);
    const afterDelete = runningBalances(rows.filter((r) => r.id !== 'b'));
    expect(afterDelete.get('c')).toBe(70);
  });
});
