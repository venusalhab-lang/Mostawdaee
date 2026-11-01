import { describe, expect, it } from 'vitest';
import type { CustomerTransaction, Invoice, PayrollRecord, Product, StockMovement, SupplierTransaction, VaultTransaction } from '../../types';
import {
  EMPTY_ACCOUNTING_CONFIG,
  accountBalances,
  accountLedger,
  balanceSheet,
  buildJournal,
  buildJournalCsv,
  entryIsBalanced,
  expenseAccountOf,
  incomeStatement,
  inferVaultClass,
  inventoryAdjustmentSides,
  manualDebts,
  normalizeAccountingConfig,
  openingEntrySides,
  reconcile,
  toMinor,
  trialBalance,
  vaultNeedsClass,
  type AccountingConfig,
  type JournalInput,
} from '../accounting';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 10);

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'Tea', sku: 'T1', category: '', brand: '', quantity: 10, unitCost: 2, sellingPrice: 5,
  currency: 'USD', status: 'in-stock' as Product['status'], dateAdded: T0, ...over,
});

const sale = (over: Partial<Invoice> = {}): Invoice => ({
  id: 's1', invoiceNumber: 'INV-1', date: T0 + DAY, type: 'sale', currency: 'USD',
  items: [{ productId: 'p1', description: 'Tea', quantity: 4, unitPrice: 5, total: 20, unitCost: 2, costCurrency: 'USD' }],
  subtotal: 20, taxAmount: 3.2, totalAmount: 23.2, paymentMethod: 'cash', vaultPosted: true, ...over,
});

const purchase = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'b1', invoiceNumber: 'PUR-1', date: T0, type: 'purchase', currency: 'USD',
  items: [{ productId: 'p1', description: 'Tea', quantity: 10, unitPrice: 2, total: 20 }],
  subtotal: 20, taxAmount: 0, totalAmount: 20, paymentMethod: 'cash', vaultPosted: true, ...over,
});

const vault = (over: Partial<VaultTransaction>): VaultTransaction => ({
  id: 'v', type: 'income', category: 'manual', amount: 0, currency: 'USD', timestamp: T0, balanceAfter: 0, ...over,
});

const input = (over: Partial<JournalInput> = {}): JournalInput => ({
  invoices: [], products: [product()], vaultTransactions: [], customerTransactions: [], payrollRecords: [],
  stockMovements: [], config: EMPTY_ACCOUNTING_CONFIG, defaultCurrency: 'USD', ...over,
});

const bal = (j: ReturnType<typeof buildJournal>, code: Parameters<typeof accountBalances>[0][number]['lines'][number]['account'], currency = 'USD') =>
  accountBalances(j.entries, currency).get(code) || 0;

describe('buildJournal', () => {
  it('books a cash sale: revenue without VAT, VAT owed, cost of goods, cash in through the vault', () => {
    const j = buildJournal(input({
      invoices: [sale()],
      vaultTransactions: [vault({ id: 'vs', type: 'income', category: 'sale', source: 'sale_invoice', refId: 's1', amount: 23.2 })],
    }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    expect(bal(j, '1100')).toBe(2320);
    expect(bal(j, '1150')).toBe(0);
    expect(bal(j, '4100')).toBe(-2000);
    expect(bal(j, '2200')).toBe(-320);
    expect(bal(j, '5100')).toBe(800);
    expect(bal(j, '1300')).toBe(-800);
    expect(j.issues.unknownCostLines).toBe(0);
  });

  it('leaves a card sale in receipts pending settlement (no cash entered the vault)', () => {
    const j = buildJournal(input({ invoices: [sale({ paymentMethod: 'card', vaultPosted: false })] }));
    expect(bal(j, '1150')).toBe(2320);
    expect(bal(j, '1100')).toBe(0);
  });

  it('moves a credit sale to the customer receivable and clears it when the customer pays into the vault', () => {
    const credit = sale({ paymentMethod: 'credit', customerId: 'c1', vaultPosted: false });
    const debt: CustomerTransaction = {
      id: 'inv-s1', transactionId: 't1', customerId: 'c1', type: 'invoice', invoiceId: 's1', amount: 23.2, currency: 'USD',
      exchangeRate: 1, date: new Date(T0 + DAY).toISOString(), notes: '', remainingBalanceAfter: 23.2,
    };
    const pay: CustomerTransaction = { ...debt, id: 'pay1', type: 'payment', invoiceId: undefined, amount: 10, vaultRecordId: 'vp' };
    const j = buildJournal(input({
      invoices: [credit],
      customerTransactions: [debt, pay],
      vaultTransactions: [vault({ id: 'vp', type: 'income', category: 'sale', source: 'customer_payment', refId: 'c1', amount: 10 })],
    }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    expect(bal(j, '1200')).toBe(1320);
    expect(bal(j, '1100')).toBe(1000);
    expect(bal(j, '1150')).toBe(0);
    expect(manualDebts([credit], [debt, pay])).toEqual([]);
  });

  it('clears FX credit suspense in the invoice currency and books AR in the debt currency', () => {
    const credit = sale({
      paymentMethod: 'credit', customerId: 'c1', vaultPosted: false,
      debtAmount: 16.5, debtCurrency: 'JOD',
    });
    const debt: CustomerTransaction = {
      id: 'inv-s1', transactionId: 'inv-s1', customerId: 'c1', type: 'invoice', invoiceId: 's1',
      amount: 16.5, currency: 'JOD', exchangeRate: 16.5 / 23.2,
      date: new Date(T0 + DAY).toISOString(), notes: '', remainingBalanceAfter: 16.5,
    };
    const j = buildJournal(input({
      invoices: [credit],
      customerTransactions: [debt],
    }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    expect(bal(j, '1150', 'USD')).toBe(0);
    expect(bal(j, '1200', 'JOD')).toBe(16500);
    expect(bal(j, '1150', 'JOD')).toBe(0);
  });

  it('books a split sale: cash paid now enters the vault, remainder stays in receivables', () => {
    const split = sale({
      paymentMethod: 'credit', customerId: 'c1', paidAmount: 10, debtAmount: 13.2, debtCurrency: 'USD', vaultPosted: true,
    });
    const debt: CustomerTransaction = {
      id: 'inv-s1', transactionId: 'inv-s1', customerId: 'c1', type: 'invoice', invoiceId: 's1', amount: 13.2, currency: 'USD',
      exchangeRate: 1, date: new Date(T0 + DAY).toISOString(), notes: '', remainingBalanceAfter: 13.2,
    };
    const j = buildJournal(input({
      invoices: [split],
      customerTransactions: [debt],
      vaultTransactions: [vault({ id: 'vs', type: 'income', category: 'sale', source: 'sale_invoice', refId: 's1', amount: 10 })],
    }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    expect(bal(j, '1100')).toBe(1000);
    expect(bal(j, '1200')).toBe(1320);
    expect(bal(j, '1150')).toBe(0);
    expect(bal(j, '4100')).toBe(-2000);
  });

  it('reverses a returned cash sale: revenue, VAT and cost come back out and the refund leaves the vault', () => {
    const ret = sale({
      id: 'r1', invoiceNumber: 'RET-1', type: 'return', returnOf: 's1', date: T0 + 2 * DAY,
      items: [{ productId: 'p1', description: 'Tea', quantity: 1, unitPrice: 5, total: 5, unitCost: 2, costCurrency: 'USD', sourceLine: 0 }],
      subtotal: 5, taxAmount: 0.8, totalAmount: 5.8,
      refund: { vault: 5.8, vaultCurrency: 'USD', debt: 0, external: 0 },
    });
    const j = buildJournal(input({
      invoices: [sale(), ret],
      vaultTransactions: [
        vault({ id: 'vs', type: 'income', category: 'sale', source: 'sale_invoice', refId: 's1', amount: 23.2 }),
        vault({ id: 'vr', type: 'expense', category: 'sale', source: 'sale_return', refId: 'r1', amount: 5.8 }),
      ],
    }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    expect(bal(j, '1100')).toBe(1740);
    expect(bal(j, '1150')).toBe(0);
    expect(bal(j, '4100')).toBe(-1500);
    expect(bal(j, '2200')).toBe(-240);
    expect(bal(j, '5100')).toBe(600);
    expect(bal(j, '1300')).toBe(-600);
  });

  it('clears a credit return against the receivable it reduced', () => {
    const credit = sale({ paymentMethod: 'credit', customerId: 'c1', vaultPosted: false });
    const ret = sale({
      id: 'r1', invoiceNumber: 'RET-1', type: 'return', returnOf: 's1', paymentMethod: 'credit', customerId: 'c1', vaultPosted: false,
      refund: { vault: 0, vaultCurrency: 'USD', debt: 23.2, debtCurrency: 'USD', external: 0 },
    });
    const debt: CustomerTransaction = {
      id: 'inv-s1', transactionId: 'inv-s1', customerId: 'c1', type: 'invoice', invoiceId: 's1', amount: 23.2, currency: 'USD',
      exchangeRate: 1, date: new Date(T0 + DAY).toISOString(), notes: '', remainingBalanceAfter: 23.2,
    };
    const back: CustomerTransaction = { ...debt, id: 'inv-r1', transactionId: 'inv-r1', type: 'payment', invoiceId: 'r1', remainingBalanceAfter: 0 };
    const j = buildJournal(input({ invoices: [credit, ret], customerTransactions: [debt, back] }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    for (const code of ['1150', '1200', '4100', '2200', '5100', '1300'] as const) expect(bal(j, code)).toBe(0);
  });

  it('books a part-paid purchase: the paid part leaves the vault, the rest is owed to the supplier until paid', () => {
    const bought = purchase({ paymentMethod: 'credit', supplierId: 'sp1', paidAmount: 5 });
    const owed: SupplierTransaction = {
      id: 'inv-b1', supplierId: 'sp1', type: 'purchase', amount: 15, currency: 'USD', invoiceId: 'b1', date: T0, balanceAfter: 15,
    };
    const paid: SupplierTransaction = {
      id: 'st1', supplierId: 'sp1', type: 'payment', amount: 10, currency: 'USD', vaultRecordId: 'sp-st1', date: T0 + DAY, balanceAfter: 5,
    };
    const j = buildJournal(input({
      invoices: [bought],
      supplierTransactions: [owed, paid],
      vaultTransactions: [
        vault({ id: 'vb', type: 'expense', category: 'purchase', source: 'purchase_invoice', refId: 'b1', amount: 5 }),
        vault({ id: 'sp-st1', type: 'expense', category: 'purchase', source: 'supplier_payment', refId: 'sp1', amount: 10 }),
      ],
    }));
    expect(j.entries.every(entryIsBalanced)).toBe(true);
    expect(bal(j, '1300')).toBe(2000);
    expect(bal(j, '1100')).toBe(-1500);
    expect(bal(j, '2100')).toBe(0);
    expect(bal(j, '2150')).toBe(-500);
  });

  it('puts a supplier opening balance against opening balances', () => {
    const opening: SupplierTransaction = {
      id: 'open-sp1-USD', supplierId: 'sp1', type: 'opening', amount: 7, currency: 'USD', date: T0, balanceAfter: 7,
    };
    const j = buildJournal(input({ supplierTransactions: [opening] }));
    expect(bal(j, '2150')).toBe(-700);
    expect(bal(j, '3900')).toBe(700);
  });

  it('matches a legacy credit debt by invoice number', () => {
    const credit = sale({ paymentMethod: 'credit', customerId: 'c1' });
    const legacy: CustomerTransaction = {
      id: 'old', transactionId: 'x', customerId: 'c1', type: 'invoice', amount: 23.2, currency: 'USD', exchangeRate: 1,
      date: '2026-01-11', notes: 'فاتورة #INV-1', remainingBalanceAfter: 0,
    };
    expect(manualDebts([credit], [legacy])).toEqual([]);
    const j = buildJournal(input({ invoices: [credit], customerTransactions: [legacy] }));
    expect(bal(j, '1150')).toBe(0);
  });

  it('posts a hand-typed customer debt to opening balances, or to sales when the owner says so', () => {
    const debt: CustomerTransaction = {
      id: 'd1', transactionId: 'x', customerId: 'c1', type: 'invoice', amount: 50, currency: 'USD', exchangeRate: 1,
      date: '2026-01-11', notes: '', remainingBalanceAfter: 50,
    };
    const opening = buildJournal(input({ customerTransactions: [debt] }));
    expect(bal(opening, '3900')).toBe(-5000);
    const config: AccountingConfig = { ...EMPTY_ACCOUNTING_CONFIG, debtClasses: { d1: 'sales' } };
    const asSale = buildJournal(input({ customerTransactions: [debt], config }));
    expect(bal(asSale, '4100')).toBe(-5000);
  });

  it('books a purchase into inventory and input VAT and clears it with the vault payment', () => {
    const j = buildJournal(input({
      invoices: [purchase({ taxAmount: 3.2, totalAmount: 23.2 })],
      vaultTransactions: [vault({ id: 'vb', type: 'expense', category: 'purchase', source: 'purchase_invoice', refId: 'b1', amount: 23.2 })],
    }));
    expect(bal(j, '1300')).toBe(2000);
    expect(bal(j, '1400')).toBe(320);
    expect(bal(j, '2100')).toBe(0);
    expect(bal(j, '1100')).toBe(-2320);
  });

  it('nets a deleted cash sale to zero (the invoice is gone, the vault record and its reversal stay)', () => {
    const j = buildJournal(input({
      vaultTransactions: [
        vault({ id: 'vs', type: 'income', category: 'sale', source: 'sale_invoice', refId: 's1', amount: 23.2 }),
        vault({ id: 'rev-s1', type: 'expense', category: 'sale', source: 'reversal', refId: 's1', amount: 23.2 }),
      ],
    }));
    expect(bal(j, '1100')).toBe(0);
    expect(bal(j, '1150')).toBe(0);
  });

  it('accrues salaries and clears them when paid; a salary paid outside payroll is a direct expense', () => {
    const rec: PayrollRecord = {
      id: 'pr1', employeeId: 'e1', employeeName: 'Ali', monthYear: '01-2026', allowances: 0, deductions: 0, netSalary: 300,
      paymentDate: T0, paymentStatus: 'paid', currency: 'USD',
    };
    const j = buildJournal(input({
      payrollRecords: [rec, { ...rec, id: 'pr2', paymentStatus: 'pending', netSalary: 200 }],
      vaultTransactions: [
        vault({ id: 'vpay', type: 'expense', category: 'salary', source: 'payroll', refId: 'pr1', amount: 300 }),
        vault({ id: 'vsal', type: 'expense', category: 'salary', source: 'payroll', amount: 50 }),
      ],
    }));
    expect(bal(j, '5200')).toBe(55000);
    expect(bal(j, '2300')).toBe(-20000);
    expect(bal(j, '1100')).toBe(-35000);
  });

  it('places expenses by their saved category', () => {
    expect(expenseAccountOf({ category: 'other', description: '[إيجار] شهر 1' })).toBe('5400');
    expect(expenseAccountOf({ category: 'other', description: 'ضرائب ورسوم حكومية' })).toBe('5450');
    expect(expenseAccountOf({ category: 'other', description: '[نقل ولوجستيك داخلي] سيارة' })).toBe('5420');
    expect(expenseAccountOf({ category: 'salary', description: 'x' })).toBe('5200');
    expect(expenseAccountOf({ category: 'other', description: 'something' })).toBe('5900');
  });

  it('holds unclassified manual vault movements in suspense until the owner classifies them', () => {
    const deposit = vault({ id: 'dep', type: 'income', category: 'manual', source: 'manual', amount: 1000 });
    const j = buildJournal(input({ vaultTransactions: [deposit] }));
    expect(bal(j, '3950')).toBe(-100000);
    expect(j.issues.unclassifiedVault).toBe(1);
    expect(j.entries[0].needsReview).toBe(true);
    expect(vaultNeedsClass(deposit, EMPTY_ACCOUNTING_CONFIG)).toBe(true);

    const config: AccountingConfig = { ...EMPTY_ACCOUNTING_CONFIG, vaultClasses: { dep: 'capital' } };
    const classified = buildJournal(input({ vaultTransactions: [deposit], config }));
    expect(bal(classified, '3100')).toBe(-100000);
    expect(classified.issues.unclassifiedVault).toBe(0);
    expect(vaultNeedsClass(deposit, config)).toBe(false);
  });

  it('infers manual sales and capital deposits from how they were saved', () => {
    expect(inferVaultClass({ type: 'income', category: 'sale', description: 'x' })).toBe('sales');
    expect(inferVaultClass({ type: 'income', category: 'other', description: 'إيداع رأس مال' })).toBe('capital');
    expect(inferVaultClass({ type: 'income', category: 'other', description: '[إيداع رأس مال] من الشريك' })).toBe('capital');
    expect(inferVaultClass({ type: 'income', category: 'manual', description: 'x' })).toBeNull();
  });

  it('values stock movements at their snapshot cost, skips transfers and counts unvalued ones', () => {
    const moves: StockMovement[] = [
      { id: 'm1', productId: 'p1', productName: 'Tea', type: 'initial', before: 0, after: 10, delta: 10, timestamp: T0, unitCost: 2, costCurrency: 'USD' },
      { id: 'm2', productId: 'p1', productName: 'Tea', type: 'adjustment', before: 10, after: 9, delta: -1, timestamp: T0, unitCost: 2, costCurrency: 'USD' },
      { id: 'm3', productId: 'p1', productName: 'Tea', type: 'adjustment', before: 9, after: 5, delta: -4, timestamp: T0, transfer: true },
      { id: 'm4', productId: 'p1', productName: 'Tea', type: 'adjustment', before: 5, after: 4, delta: -1, timestamp: T0, reason: 'نقل بين المستودعات: B' },
      { id: 'm5', productId: 'gone', productName: 'Old', type: 'adjustment', before: 5, after: 4, delta: -1, timestamp: T0 },
      { id: 'm6', productId: 'p1', productName: 'Tea', type: 'adjustment', before: 4, after: 6, delta: 2, timestamp: T0 },
    ];
    const j = buildJournal(input({ stockMovements: moves }));
    expect(bal(j, '1300')).toBe(2000 - 200 + 400);
    expect(bal(j, '3900')).toBe(-2000);
    expect(bal(j, '5300')).toBe(200 - 400);
    expect(j.issues.unvaluedStockMovements).toBe(1);
    expect(j.issues.estimatedEntries).toBe(1);
  });

  it('keeps every currency in its own books and books cost in the cost currency', () => {
    const j = buildJournal(input({
      invoices: [sale({ currency: 'ILS', items: [{ productId: 'p1', description: 'Tea', quantity: 1, unitPrice: 20, total: 20, unitCost: 2, costCurrency: 'USD' }], taxAmount: 0, totalAmount: 20 })],
    }));
    expect(bal(j, '4100', 'ILS')).toBe(-2000);
    expect(bal(j, '5100', 'USD')).toBe(200);
    expect(bal(j, '5100', 'ILS')).toBe(0);
  });

  it('counts sold lines with no cost', () => {
    const j = buildJournal(input({
      products: [],
      invoices: [sale({ items: [{ productId: 'x', description: 'X', quantity: 1, unitPrice: 20, total: 20 }] })],
    }));
    expect(j.issues.unknownCostLines).toBe(1);
    expect(bal(j, '5100')).toBe(0);
  });

  it('uses pack units for cost', () => {
    const j = buildJournal(input({
      invoices: [sale({ items: [{ productId: 'p1', description: 'Tea box', quantity: 2, unitPrice: 50, total: 100, unitCost: 2, costCurrency: 'USD', packSize: 12 }] })],
    }));
    expect(bal(j, '5100')).toBe(4800);
  });

  it('rounds COGS per line into minor units (avoids float off-by-one)', () => {
    // 2.675 × 3 = 8.025 → 803 cents, not Math.round(2.675*3*100) = 802.
    const j = buildJournal(input({
      invoices: [sale({
        items: [{ productId: 'p1', description: 'Tea', quantity: 3, unitPrice: 10, total: 30, unitCost: 2.675, costCurrency: 'USD' }],
        taxAmount: 0,
        totalAmount: 30,
      })],
    }));
    expect(bal(j, '5100', 'USD')).toBe(803);
    expect(bal(j, '1300', 'USD')).toBe(-803);
  });

  it('posts opening entries and keeps 3-decimal currencies exact', () => {
    const config: AccountingConfig = {
      ...EMPTY_ACCOUNTING_CONFIG,
      entries: [{ id: 'o1', date: T0, currency: 'JOD', debit: '1500', credit: '3900', amount: 1234.567, memo: 'Bank', kind: 'opening' }],
    };
    const j = buildJournal(input({ config }));
    expect(bal(j, '1500', 'JOD')).toBe(1234567);
    expect(toMinor(0.1 + 0.2, 'USD')).toBe(30);
  });
});

describe('reports', () => {
  const config: AccountingConfig = {
    ...EMPTY_ACCOUNTING_CONFIG,
    vaultClasses: { cap: 'capital', draw: 'drawings' },
  };
  const journal = buildJournal(input({
    config,
    invoices: [purchase(), sale(), sale({ id: 's2', invoiceNumber: 'INV-2', date: T0 + 40 * DAY })],
    vaultTransactions: [
      vault({ id: 'cap', type: 'income', category: 'manual', source: 'manual', amount: 100, timestamp: T0 - DAY }),
      vault({ id: 'vb', type: 'expense', category: 'purchase', source: 'purchase_invoice', refId: 'b1', amount: 20, timestamp: T0 }),
      vault({ id: 'vs', type: 'income', category: 'sale', source: 'sale_invoice', refId: 's1', amount: 23.2, timestamp: T0 + DAY }),
      vault({ id: 'vs2', type: 'income', category: 'sale', source: 'sale_invoice', refId: 's2', amount: 23.2, timestamp: T0 + 40 * DAY }),
      vault({ id: 'rent', type: 'expense', category: 'other', source: 'expense', description: '[إيجار] يناير', amount: 5, timestamp: T0 + 2 * DAY }),
      vault({ id: 'draw', type: 'expense', category: 'manual', source: 'manual', amount: 10, timestamp: T0 + 3 * DAY }),
    ],
  }));

  it('every entry balances and the trial balance agrees', () => {
    expect(journal.entries.every(entryIsBalanced)).toBe(true);
    const tb = trialBalance(journal.entries, 'USD');
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.totalDebit).toBeGreaterThan(0);
  });

  it('income statement for a period: gross profit then net profit after expenses', () => {
    const is = incomeStatement(journal.entries, 'USD', { from: T0, to: T0 + 30 * DAY });
    expect(is.totalRevenue).toBe(2000);
    expect(is.cogs).toBe(800);
    expect(is.grossProfit).toBe(1200);
    expect(is.expenses).toEqual([{ code: '5400', amount: 500 }]);
    expect(is.netProfit).toBe(700);
  });

  it('balance sheet balances, with profits in equity and drawings reducing it', () => {
    const bs = balanceSheet(journal.entries, 'USD');
    expect(bs.balanced).toBe(true);
    expect(bs.retainedEarnings).toBe(2 * 1200 - 500);
    expect(bs.equity.find((l) => l.code === '3100')?.amount).toBe(10000);
    expect(bs.equity.find((l) => l.code === '3200')?.amount).toBe(-1000);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
    expect(bs.unclassified).toBe(0);
  });

  it('balance sheet as of an earlier date ignores later entries', () => {
    const bs = balanceSheet(journal.entries, 'USD', T0 + 30 * DAY);
    expect(bs.balanced).toBe(true);
    expect(bs.retainedEarnings).toBe(1200 - 500);
  });

  it('ledger carries an opening balance into the period and runs on the normal side', () => {
    const led = accountLedger(journal.entries, 'USD', '1100', { from: T0 + DAY, to: T0 + 30 * DAY });
    expect(led.opening).toBe(10000 - 2000);
    expect(led.rows.map((r) => r.balance)).toEqual([8000 + 2320, 8000 + 2320 - 500, 8000 + 2320 - 500 - 1000]);
    expect(led.closing).toBe(8820);
  });

  it('reconciles the cash book with the vault and the inventory book with the stock value', () => {
    const r = reconcile(journal.entries, 'USD', { vault: 111.4, stockValue: 4, customerDebt: 0 });
    expect(r.cash.book).toBe(r.cash.actual);
    expect(r.inventory.book).toBe(2000 - 1600);
    expect(r.inventory.actual).toBe(400);
  });

  it('exports the journal as quoted CSV with a BOM', () => {
    const csv = buildJournalCsv(journal.entries, 'USD', true, () => '2026-01-10');
    expect(csv.startsWith('\uFEFF"رقم القيد"')).toBe(true);
    expect(csv).toContain('"5400","الإيجار","5.00",""');
    expect(csv.split('\r\n').length).toBeGreaterThan(10);
  });
});

describe('opening and adjustment sides', () => {
  it('debits assets and credits liabilities and equity against opening balances', () => {
    expect(openingEntrySides('1500')).toEqual({ debit: '1500', credit: '3900' });
    expect(openingEntrySides('2400')).toEqual({ debit: '3900', credit: '2400' });
    expect(openingEntrySides('3100')).toEqual({ debit: '3900', credit: '3100' });
  });

  it('books the inventory gap in the right direction', () => {
    expect(inventoryAdjustmentSides(1000, 1500, '3900')).toEqual({ debit: '1300', credit: '3900', amountMinor: 500 });
    expect(inventoryAdjustmentSides(1500, 1000, '5300')).toEqual({ debit: '5300', credit: '1300', amountMinor: 500 });
    expect(inventoryAdjustmentSides(1000, 1000, '5300')).toBeNull();
  });
});

describe('normalizeAccountingConfig', () => {
  it('drops malformed classes and entries', () => {
    const c = normalizeAccountingConfig({
      vaultClasses: { a: 'capital', b: 'nonsense' },
      debtClasses: { d: 'sales', e: 'x' },
      entries: [
        { id: 'ok', date: T0, currency: 'USD', debit: '1500', credit: '3900', amount: 5, memo: 'm', kind: 'opening' },
        { id: 'bad', date: T0, currency: 'USD', debit: '9999', credit: '3900', amount: 5 },
        { id: 'neg', date: T0, currency: 'USD', debit: '1500', credit: '3900', amount: -1 },
        { id: 'same', date: T0, currency: 'USD', debit: '1500', credit: '1500', amount: 1 },
      ],
    });
    expect(c.vaultClasses).toEqual({ a: 'capital' });
    expect(c.debtClasses).toEqual({ d: 'sales' });
    expect(c.entries.map((e) => e.id)).toEqual(['ok']);
    expect(normalizeAccountingConfig(null)).toEqual({ ...EMPTY_ACCOUNTING_CONFIG, updatedAt: undefined });
  });
});
