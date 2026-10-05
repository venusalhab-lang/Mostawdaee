import { describe, it, expect } from 'vitest';
import { applyVaultDelta, readVaultBalances, planInvoiceVaultEntry, buildVaultDoc } from '../vaultMath';

const baseInvoice: any = {
  id: 'i1', invoiceNumber: 'S-1', type: 'sale', totalAmount: 12.3456, currency: 'JOD', paymentMethod: 'cash',
};

describe('vaultMath balances', () => {
  it('avoids floating point drift (0.1 + 0.2 JOD)', () => {
    let doc: any = {};
    doc = applyVaultDelta(doc, 'JOD', 0.1).doc;
    doc = applyVaultDelta(doc, 'JOD', 0.2).doc;
    expect(readVaultBalances(doc).JOD).toBe(0.3);
  });

  it('keeps currencies isolated and rounds per currency', () => {
    let doc: any = applyVaultDelta({}, 'JOD', 0.3).doc;
    doc = applyVaultDelta(doc, 'USD', 100.456).doc;
    doc = applyVaultDelta(doc, 'IQD', 1500.6).doc;
    const b = readVaultBalances(doc);
    expect(b.USD).toBe(100.46);
    expect(b.IQD).toBe(1501);
    expect(b.JOD).toBe(0.3);
    expect(doc.currentBalance).toBe(0.3); // legacy mirror = JOD
  });

  it('reads legacy documents (currentBalance only) as JOD', () => {
    expect(readVaultBalances({ currentBalance: 55 }).JOD).toBe(55);
  });

  it('does not drift after many small operations', () => {
    let d: any = {};
    for (let i = 0; i < 1000; i++) d = applyVaultDelta(d, 'JOD', 0.001).doc;
    for (let i = 0; i < 100; i++) d = applyVaultDelta(d, 'USD', 0.1).doc;
    expect(readVaultBalances(d).JOD).toBe(1);
    expect(readVaultBalances(d).USD).toBe(10);
  });

  it('reports a negative balance instead of hiding an overdraft', () => {
    expect(applyVaultDelta({ balanceJOD: 5 }, 'JOD', -7.5).balanceAfter).toBe(-2.5);
  });

  it('keeps a separate UAE dirham balance rounded to fils', () => {
    let doc: any = applyVaultDelta({ balanceJOD: 10 }, 'AED', 100.005).doc;
    doc = applyVaultDelta(doc, 'AED', -0.1).doc;
    expect(doc.balanceAED).toBe(99.91);
    const b = readVaultBalances(doc);
    expect(b.AED).toBe(99.91);
    expect(b.JOD).toBe(10);
    expect(b.SAR).toBe(0);
  });

  it('reads vaults saved before the dirham existed as zero dirhams', () => {
    expect(readVaultBalances({ balanceJOD: 5, balanceSAR: 7 }).AED).toBe(0);
  });

  it('runs a full multi-currency scenario', () => {
    let L: any = buildVaultDoc({ JOD: 100, ILS: 0, USD: 50, IQD: 0, SAR: 0, AED: 0, LYD: 0, EGP: 0 });
    L = applyVaultDelta(L, 'JOD', 25.5).doc;
    L = applyVaultDelta(L, 'JOD', -40).doc;
    L = applyVaultDelta(L, 'USD', -10).doc;
    expect(readVaultBalances(L).JOD).toBe(85.5);
    expect(readVaultBalances(L).USD).toBe(40);
  });
});

describe('planInvoiceVaultEntry', () => {
  it('cash sales are income, rounded to currency precision', () => {
    expect(planInvoiceVaultEntry(baseInvoice)?.type).toBe('income');
    expect(planInvoiceVaultEntry(baseInvoice)?.amount).toBe(12.346);
  });

  it('card and wallet money never enters the cash vault', () => {
    expect(planInvoiceVaultEntry({ ...baseInvoice, paymentMethod: 'card' })).toBeNull();
    expect(planInvoiceVaultEntry({ ...baseInvoice, paymentMethod: 'wallet' })).toBeNull();
    expect(planInvoiceVaultEntry({ ...baseInvoice, type: 'purchase', paymentMethod: 'card' })).toBeNull();
  });

  it('can reproduce the entry an older card invoice posted, so deleting it reverses it', () => {
    expect(planInvoiceVaultEntry({ ...baseInvoice, paymentMethod: 'card' }, { includeNonCash: true })?.type).toBe('income');
  });

  it('credit (آجل) sales never touch the vault', () => {
    expect(planInvoiceVaultEntry({ ...baseInvoice, paymentMethod: 'credit' })).toBeNull();
  });

  it('purchases are expenses in their own currency', () => {
    const plan = planInvoiceVaultEntry({ ...baseInvoice, type: 'purchase', currency: 'IQD', totalAmount: 1000.5 });
    expect(plan?.type).toBe('expense');
    expect(plan?.amount).toBe(1001);
    expect(plan?.currency).toBe('IQD');
  });

  it('dirham cash sales enter the dirham balance only', () => {
    const plan = planInvoiceVaultEntry({ ...baseInvoice, currency: 'AED', totalAmount: 49.995 });
    expect(plan?.currency).toBe('AED');
    expect(plan?.amount).toBe(50);
  });

  it('sale followed by its reversal returns the balance to zero', () => {
    const sale = planInvoiceVaultEntry({ ...baseInvoice, totalAmount: 99.99, currency: 'USD' })!;
    let v: any = applyVaultDelta({}, 'USD', sale.amount).doc;
    v = applyVaultDelta(v, 'USD', -sale.amount).doc;
    expect(readVaultBalances(v).USD).toBe(0);
  });
});
