import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const now = Date.now();
const data = {
  user: { uid: 'owner' },
  settings: { currency: 'JOD', businessName: 'متجر' },
  products: [{ id: 'tea', name: 'شاي', quantity: 6, unitCost: 2, sellingPrice: 5, currency: 'JOD' }],
  invoices: [{
    id: 's1', invoiceNumber: 'INV-1', date: now, type: 'sale', currency: 'JOD', paymentMethod: 'cash', vaultPosted: true,
    items: [{ productId: 'tea', description: 'شاي', quantity: 4, unitPrice: 5, total: 20, unitCost: 2, costCurrency: 'JOD' }],
    subtotal: 20, taxAmount: 3.2, totalAmount: 23.2,
  }],
  vaultTransactions: [
    { id: 'v1', type: 'income', category: 'sale', source: 'sale_invoice', refId: 's1', amount: 23.2, currency: 'JOD', timestamp: now, balanceAfter: 0 },
    { id: 'v2', type: 'income', category: 'manual', source: 'manual', amount: 100, currency: 'JOD', timestamp: now, balanceAfter: 0, description: 'إيداع' },
    { id: 'v3', type: 'expense', category: 'other', source: 'expense', amount: 5, currency: 'JOD', timestamp: now, balanceAfter: 0, description: '[إيجار] الشهر' },
  ],
  customerTransactions: [],
  payrollRecords: [],
  stockMovements: [],
  customers: [],
  vault: { balanceJOD: 118.2, lastUpdated: now },
};

vi.mock('../../components/FirebaseProvider', () => ({ useFirebase: () => data }));
vi.mock('../../hooks/useAccountingConfig', () => ({
  useAccountingConfig: () => ({ config: { vaultClasses: {}, debtClasses: {}, entries: [] }, loading: false, error: null, update: vi.fn() }),
}));

describe('AccountingDashboard summary', async () => {
  const { default: AccountingDashboard } = await import('../../components/AccountingDashboard');
  const text = renderToStaticMarkup(<AccountingDashboard language="ar" />).replace(/<[^>]+>/g, '|');

  it('shows sales without VAT, gross profit, expenses and net profit for the period', () => {
    expect(text).toContain('20.000 د.أ');
    expect(text).toContain('12.000 د.أ');
    expect(text).toContain('5.000 د.أ');
    expect(text).toContain('7.000 د.أ');
  });

  it('shows the cash book equal to the vault and the VAT owed', () => {
    expect(text).toContain('118.200 د.أ');
    expect(text).toContain('3.200 د.أ');
    expect(text).not.toContain('لا يطابق رصيد الخزنة');
  });

  it('asks the owner to classify the manual deposit and flags the inventory gap', () => {
    expect(text).toContain('1 حركة خزنة يدوية تحتاج تصنيفاً');
    expect(text).toContain('المخزون في الدفاتر');
  });
});
