import { describe, expect, it } from 'vitest';
import type { Invoice, Product, SupplierTransaction, VaultTransaction } from '../../types';
import { canReturnPurchase, costAfterReturn, planPurchaseReturn, returnedCostByProduct, splitPurchaseRefund } from '../purchaseReturn';
import { planInvoiceVaultEntry } from '../vaultMath';
import { planStockReversal } from '../invoiceReversal';
import { EMPTY_ACCOUNTING_CONFIG, accountBalances, buildJournal, entryIsBalanced, type JournalInput } from '../accounting';
import { runningBalances } from '../suppliers';

const T0 = Date.UTC(2026, 0, 10);

const purchase = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'b1', invoiceNumber: 'PUR-1', date: T0, type: 'purchase', currency: 'USD',
  items: [
    { productId: 'p1', description: 'Tea', quantity: 10, unitPrice: 2, total: 20 },
    { productId: 'p2', description: 'Sugar', quantity: 4, unitPrice: 5, total: 20 },
  ],
  subtotal: 40, discount: 4, taxAmount: 5.76, totalAmount: 41.76, vatRate: 16,
  paymentMethod: 'cash', vaultPosted: true, supplierId: 'sp1', supplierName: 'Acme', ...over,
});

const figures = (totalAmount: number) => ({ subtotal: totalAmount, discount: 0, taxAmount: 0, totalAmount });

describe('purchase return planning', () => {
  it('prices the returned lines with their share of the purchase discount and VAT', () => {
    const r = planPurchaseReturn(purchase(), [{ index: 0, quantity: 5 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { subtotal, discount, taxAmount, totalAmount } = r.plan.figures;
    expect(subtotal).toBe(10);
    expect(discount).toBeCloseTo(1, 9);
    expect(taxAmount).toBeCloseTo(1.44, 9);
    expect(totalAmount).toBeCloseTo(10.44, 9);
    expect(r.plan.returnedQty).toEqual([5, 0]);
  });

  it('only accepts purchases, and stops once everything went back', () => {
    expect(planPurchaseReturn({ ...purchase(), type: 'sale' }, [{ index: 0, quantity: 1 }])).toEqual({ ok: false, error: { code: 'not_sale' } });
    expect(canReturnPurchase(purchase())).toBe(true);
    expect(canReturnPurchase({ ...purchase(), returnedQty: [10, 4] })).toBe(false);
    expect(canReturnPurchase({ ...purchase(), type: 'sale' })).toBe(false);
  });
});

describe('splitPurchaseRefund', () => {
  it('takes a credit return off what is still owed, and the rest comes back in cash', () => {
    const credit = purchase({ paymentMethod: 'credit', paidAmount: 0 });
    expect(splitPurchaseRefund(credit, figures(10), 25)).toEqual({ vault: 0, vaultCurrency: 'USD', debt: 10, debtCurrency: 'USD', external: 0 });
    expect(splitPurchaseRefund(credit, figures(10), 4)).toEqual({ vault: 6, vaultCurrency: 'USD', debt: 4, debtCurrency: 'USD', external: 0 });
    expect(splitPurchaseRefund(credit, figures(10), -3)).toMatchObject({ vault: 10, debt: 0 });
  });

  it('puts a cash return back in the vault, unless the purchase never touched the vault', () => {
    expect(splitPurchaseRefund(purchase(), figures(10), 0)).toEqual({ vault: 10, vaultCurrency: 'USD', debt: 0, external: 0 });
    expect(splitPurchaseRefund(purchase({ vaultPosted: false }), figures(10), 0)).toEqual({ vault: 0, vaultCurrency: 'USD', debt: 0, external: 10 });
  });
});

describe('cost after a purchase return', () => {
  const tea: Pick<Product, 'quantity' | 'unitCost' | 'costPrice' | 'currency'> = { quantity: 20, unitCost: 3, currency: 'USD' };

  it('scales the returned value by the purchase discount', () => {
    const inv = purchase();
    const cost = returnedCostByProduct(inv, [{ ...inv.items[0], quantity: 5, total: 10 }]);
    expect(cost.get('p1')).toBeCloseTo(9, 9);
  });

  it('removes the returned goods at what they cost and re-averages the rest', () => {
    // 20 × 3 = 60 on hand; 5 go back worth 10 → 50 over 15.
    expect(costAfterReturn(tea, 5, 10, 'USD', 'USD')).toBe(3.3333);
  });

  it('leaves the cost alone across currencies, with nothing left, or without a recorded cost', () => {
    expect(costAfterReturn(tea, 5, 10, 'JOD', 'USD')).toBeNull();
    expect(costAfterReturn(tea, 20, 60, 'USD', 'USD')).toBeNull();
    expect(costAfterReturn({ quantity: 20, unitCost: 0, currency: 'USD' }, 5, 10, 'USD', 'USD')).toBeNull();
    expect(costAfterReturn(tea, 0, 0, 'USD', 'USD')).toBeNull();
  });

  it('keeps the prior unit cost when the return value exceeds carrying cost', () => {
    // 20 × 3 = 60 carrying; returning 5 at 100 must not wipe the remaining 15 to $0 COGS.
    expect(costAfterReturn(tea, 5, 100, 'USD', 'USD')).toBe(3);
  });
});

const ret = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'pr1', invoiceNumber: 'PRT-1', date: T0 + 1000, type: 'purchase_return', currency: 'USD', returnOf: 'b1', returnOfNumber: 'PUR-1',
  items: [{ productId: 'p1', description: 'Tea', quantity: 5, unitPrice: 2, total: 10, sourceLine: 0 }],
  subtotal: 10, discount: 0, taxAmount: 1.6, totalAmount: 11.6, paymentMethod: 'cash', vaultPosted: true, supplierId: 'sp1',
  refund: { vault: 11.6, vaultCurrency: 'USD', debt: 0, external: 0 }, ...over,
});

describe('purchase return effects', () => {
  it('posts the supplier cash refund as vault income', () => {
    expect(planInvoiceVaultEntry(ret())).toMatchObject({ type: 'income', amount: 11.6, currency: 'USD', source: 'purchase_return', refId: 'pr1' });
    expect(planInvoiceVaultEntry(ret({ refund: { vault: 0, vaultCurrency: 'USD', debt: 11.6, external: 0 } }))).toBeNull();
  });

  it('puts the goods back into stock when the return is deleted', () => {
    const plan = planStockReversal(ret(), new Map([['p1', { quantity: 15 }]]));
    expect(plan.updates).toEqual([{ productId: 'p1', quantity: 20 }]);
    expect(plan.shortages).toEqual([]);
  });

  it('lowers the supplier running balance with a return entry', () => {
    const txs: SupplierTransaction[] = [
      { id: 'inv-b1', supplierId: 'sp1', type: 'purchase', amount: 30, currency: 'USD', invoiceId: 'b1', date: T0, balanceAfter: 30 },
      { id: 'inv-pr1', supplierId: 'sp1', type: 'return', amount: 11.6, currency: 'USD', invoiceId: 'pr1', date: T0 + 1000, balanceAfter: 18.4 },
    ];
    expect(runningBalances(txs).get('inv-pr1')).toBeCloseTo(18.4, 9);
  });
});

describe('purchase return accounting', () => {
  const input = (over: Partial<JournalInput>): JournalInput => ({
    invoices: [], products: [], vaultTransactions: [], customerTransactions: [], payrollRecords: [],
    stockMovements: [], config: EMPTY_ACCOUNTING_CONFIG, defaultCurrency: 'USD', ...over,
  });
  const bal = (j: ReturnType<typeof buildJournal>, code: string) => accountBalances(j.entries, 'USD').get(code as never) || 0;
  const vault = (over: Partial<VaultTransaction>): VaultTransaction => ({
    id: 'v', type: 'income', category: 'purchase', amount: 0, currency: 'USD', timestamp: T0, balanceAfter: 0, ...over,
  });
  const bought = (over: Partial<Invoice> = {}) => purchase({
    items: [{ productId: 'p1', description: 'Tea', quantity: 10, unitPrice: 2, total: 20 }],
    subtotal: 20, discount: 0, taxAmount: 3.2, totalAmount: 23.2, ...over,
  });

  it('takes a cash return out of stock and input VAT, with the cash back in the vault', () => {
    const j = buildJournal(input({
      invoices: [bought(), ret()],
      vaultTransactions: [
        vault({ id: 'vb', type: 'expense', source: 'purchase_invoice', refId: 'b1', amount: 23.2 }),
        vault({ id: 'vr', type: 'income', source: 'purchase_return', refId: 'pr1', amount: 11.6 }),
      ],
    }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    expect(bal(j, '1300')).toBe(1000);
    expect(bal(j, '1400')).toBe(160);
    expect(bal(j, '1100')).toBe(-1160);
    expect(bal(j, '2100')).toBe(0);
  });

  it('takes a credit return off the supplier payable', () => {
    const credit = bought({ paymentMethod: 'credit', paidAmount: 0, vaultPosted: false });
    const creditRet = ret({ paymentMethod: 'credit', vaultPosted: false, refund: { vault: 0, vaultCurrency: 'USD', debt: 11.6, debtCurrency: 'USD', external: 0 } });
    const j = buildJournal(input({
      invoices: [credit, creditRet],
      supplierTransactions: [
        { id: 'inv-b1', supplierId: 'sp1', type: 'purchase', amount: 23.2, currency: 'USD', invoiceId: 'b1', date: T0, balanceAfter: 23.2 },
        { id: 'inv-pr1', supplierId: 'sp1', type: 'return', amount: 11.6, currency: 'USD', invoiceId: 'pr1', date: T0 + 1000, balanceAfter: 11.6 },
      ],
    }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    expect(bal(j, '1300')).toBe(1000);
    expect(bal(j, '1400')).toBe(160);
    expect(bal(j, '2150')).toBe(-1160);
    expect(bal(j, '2100')).toBe(0);
    expect(bal(j, '1100')).toBe(0);
  });
});
