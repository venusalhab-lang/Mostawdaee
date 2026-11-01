import { describe, expect, it } from 'vitest';
import {
  BACKUP_APP, assertReplaceAllowed, assertVaultRestoreAllowed, backupCounts, buildStoreBackup, isLegacyTableBackup, isStoreBackup, newerLiveActivity, orphanIds, restoreStoreBackup, stockCsv,
  type RestoreActions,
} from '../storeBackup';

const noLive = { invoices: [], vaultTransactions: [], customerTransactions: [] };

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Rice "5kg"', category: 'Food', warehouseId: 'w1', quantity: 4, sellingPrice: 12.5,
  currency: 'USD', dateAdded: '2026-01-02T10:00:00.000Z', ...over,
}) as any;

const bak = (over: Record<string, unknown> = {}) => ({
  app: BACKUP_APP as typeof BACKUP_APP,
  timestamp: 1_000,
  ...over,
}) as any;

describe('store backup', () => {
  it('builds one shape with empty lists for missing books', () => {
    const b = buildStoreBackup({ creator: null, settings: null, products: [product()] } as any, 42);
    expect(b.app).toBe(BACKUP_APP);
    expect(b.timestamp).toBe(42);
    expect(b.creator).toBe('Anonymous');
    expect(b.invoices).toEqual([]);
    expect(b.vault).toBeNull();
    expect(backupCounts(b)).toMatchObject({ products: 1, invoices: 0, vaultTransactions: 0 });
  });

  it('refuses old table exports and unrelated files', () => {
    const legacy = { version: '2.0', tables: { products: [{ id: 1 }] } };
    expect(isLegacyTableBackup(legacy)).toBe(true);
    expect(isStoreBackup(legacy)).toBe(false);
    expect(isStoreBackup({ hello: 1 })).toBe(false);
    expect(isStoreBackup(null)).toBe(false);
    expect(isStoreBackup({ app: BACKUP_APP })).toBe(false);
    expect(isStoreBackup({ products: [] })).toBe(false);
    expect(isStoreBackup({ app: 'Other', timestamp: 1 })).toBe(false);
    expect(isStoreBackup({ app: BACKUP_APP, timestamp: Date.now() })).toBe(true);
  });

  it('restores through the app save paths, vault movements before the balance', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions: RestoreActions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'),
      saveSupplierRecord: rec('supplier'), saveSupplierTransaction: rec('supplierTx'), saveShift: rec('shift'), saveOrder: rec('order'),
      saveCheque: rec('cheque'), saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    };
    await restoreStoreBackup(bak({
      settings: { storeName: 'S' } as any,
      warehouses: [{ id: 'w1' }] as any,
      products: [product()],
      invoices: [{ id: 'i1' }] as any,
      employees: [{ id: 'e1' }] as any,
      payrollRecords: [{ id: 'pr1' }] as any,
      customers: [{ id: 'c1' }] as any,
      customerTransactions: [{ id: 'ct1' }] as any,
      suppliers: [{ id: 's1' }] as any,
      supplierTransactions: [{ id: 'st1' }] as any,
      shifts: [{ id: 'sh1' }] as any,
      orders: [{ id: 'po1' }] as any,
      cheques: [{ id: 'ch1' }] as any,
      vaultTransactions: [{ id: 'v1' }, { amount: 3 }] as any,
      vault: { currentBalance: 10, lastUpdated: 5 },
    }), actions, noLive);
    expect(calls).toEqual([
      'settings', 'warehouse', 'product', 'invoice', 'employee', 'payroll', 'customer', 'customerTx', 'supplier', 'supplierTx',
      'shift', 'order', 'cheque', 'vaultRecord', 'vault',
    ]);
  });

  it('refuses an old backup before writing anything when the store has newer activity', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'), saveShift: rec('shift'), saveOrder: rec('order'),
      saveCheque: rec('cheque'), saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    } as RestoreActions;
    const live = { invoices: [{ date: 2_000 }], vaultTransactions: [], customerTransactions: [] };
    await expect(restoreStoreBackup(bak({ timestamp: 1_000, products: [product()] }), actions, live))
      .rejects.toMatchObject({ code: 'backup-older', newer: 2_000 });
    expect(calls).toEqual([]);
  });

  it('dates live activity from invoices, vault movements and ledger entries', () => {
    expect(newerLiveActivity(5_000, { invoices: [{ date: 4_000 }], vaultTransactions: [{ timestamp: 4_500 }], customerTransactions: [] })).toBeNull();
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [{ timestamp: 6_000 }], customerTransactions: [] })).toBe(6_000);
    expect(newerLiveActivity(Date.parse('2026-10-01'), { invoices: [], vaultTransactions: [], customerTransactions: [{ date: '2026-10-05T10:00:00Z' }] })).toBe(Date.parse('2026-10-05T10:00:00Z'));
    expect(newerLiveActivity(undefined, { invoices: [{ date: 1 }], vaultTransactions: [], customerTransactions: [] })).toBe(1);
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [], customerTransactions: [], supplierTransactions: [{ date: 7_000 }] })).toBe(7_000);
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [], customerTransactions: [], stockMovements: [{ timestamp: 8_000 }] })).toBe(8_000);
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [], customerTransactions: [], stockMovements: [{ timestamp: 4_000 }] })).toBeNull();
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [], customerTransactions: [], cheques: [{ createdAt: '1970-01-01T00:00:09.000Z', statusChangedAt: null }] })).toBe(9_000);
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [], customerTransactions: [], vault: { lastUpdated: 9_500 } })).toBe(9_500);
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [], customerTransactions: [], vault: { lastUpdated: 4_000 } })).toBeNull();
  });

  it('keeps going past a salary that is already paid in the live books', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'),
      savePayrollRecord: async () => { throw Object.assign(new Error('Payroll already paid'), { code: 'payroll-already-paid' }); },
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'),
      saveSupplierRecord: rec('supplier'), saveSupplierTransaction: rec('supplierTx'), saveShift: rec('shift'), saveOrder: rec('order'),
      saveCheque: rec('cheque'), saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    } as RestoreActions;
    const live = { invoices: [], vaultTransactions: [], customerTransactions: [] };
    await restoreStoreBackup(bak({ payrollRecords: [{ id: 'p1' } as any], customers: [{ id: 'c1' } as any] }), actions, live);
    expect(calls).toContain('customer');
  });

  it('keeps a closed shift that is already in the live books and goes on', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'),
      saveSupplierRecord: rec('supplier'), saveSupplierTransaction: rec('supplierTx'),
      saveOrder: rec('order'),
      saveCheque: rec('cheque'),
      saveShift: async (shift: { id: string }) => {
        if (shift.id === 'closed') throw Object.assign(new Error('This shift is closed'), { code: 'shift-closed' });
        calls.push(`shift:${shift.id}`);
      },
      saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    } as RestoreActions;
    await restoreStoreBackup(bak({ shifts: [{ id: 'closed' }, { id: 'open' }] as any, vaultTransactions: [{ id: 'v1' }] as any }), actions, noLive);
    expect(calls).toEqual(['shift:open', 'vaultRecord']);
  });

  it('keeps a finalized cheque the backup cannot reach and goes on', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'),
      saveSupplierRecord: rec('supplier'), saveSupplierTransaction: rec('supplierTx'),
      saveShift: rec('shift'), saveOrder: rec('order'),
      saveCheque: async (cheque: { id: string }) => {
        if (cheque.id === 'final') throw Object.assign(new Error('already final'), { code: 'cheque-already-final' });
        calls.push(`cheque:${cheque.id}`);
      },
      saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    } as RestoreActions;
    await restoreStoreBackup(bak({ cheques: [{ id: 'final' }, { id: 'ok' }] as any, vaultTransactions: [{ id: 'v1' }] as any }), actions, noLive);
    expect(calls).toEqual(['cheque:ok', 'vaultRecord']);
  });

  it('stops on any other shift failure', async () => {
    const ok = async () => {};
    const actions = {
      saveSettings: ok, saveWarehouse: ok, saveProduct: ok, saveInvoice: ok, saveEmployee: ok, savePayrollRecord: ok,
      saveCustomer: ok, saveCustomerTransaction: ok, saveSupplierRecord: ok, saveSupplierTransaction: ok,
      saveShift: async () => { throw Object.assign(new Error('role not allowed'), { code: 'permission-denied' }); }, saveOrder: ok,
      saveCheque: ok, saveVaultRecord: ok, restoreVault: ok,
    } as RestoreActions;
    await expect(restoreStoreBackup(bak({ shifts: [{ id: 's' }] as any }), actions, noLive)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('carries shifts and cheques in the backup', () => {
    const b = buildStoreBackup({ creator: 'x', settings: null, products: [], shifts: [{ id: 'sh1' }], cheques: [{ id: 'ch1' }] } as any, 1);
    expect(b.shifts).toHaveLength(1);
    expect(b.cheques).toHaveLength(1);
    expect(backupCounts(b).cheques).toBe(1);
    expect(buildStoreBackup({ creator: 'x', settings: null, products: [] } as any, 1).shifts).toEqual([]);
    expect(buildStoreBackup({ creator: 'x', settings: null, products: [] } as any, 1).cheques).toEqual([]);
  });

  it('refuses a newer live vault before writing stock or invoices', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'),
      saveSupplierRecord: rec('supplier'), saveSupplierTransaction: rec('supplierTx'), saveShift: rec('shift'), saveOrder: rec('order'),
      saveCheque: rec('cheque'), saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    } as RestoreActions;
    await expect(restoreStoreBackup(
      bak({
        timestamp: 10_000,
        products: [product()],
        invoices: [{ id: 'i1', date: 1 }] as any,
        vault: { currentBalance: 0, lastUpdated: 1_000 } as any,
      }),
      actions,
      { ...noLive, vault: { lastUpdated: 9_000 } },
    )).rejects.toMatchObject({ code: 'vault-newer', newer: 9_000 });
    expect(calls).toEqual([]);
  });

  it('assertVaultRestoreAllowed matches the database vault gate', () => {
    expect(() => assertVaultRestoreAllowed({ lastUpdated: 5 }, { lastUpdated: 4 })).not.toThrow();
    expect(() => assertVaultRestoreAllowed({ lastUpdated: 5 }, { lastUpdated: 5 })).not.toThrow();
    expect(() => assertVaultRestoreAllowed({ lastUpdated: 5 }, { lastUpdated: 6 })).toThrowError(/vault is newer/);
    expect(() => assertVaultRestoreAllowed({ lastUpdated: 0 }, { lastUpdated: 1 })).toThrowError(/vault is newer/);
    expect(() => assertVaultRestoreAllowed(null, { lastUpdated: 9 })).not.toThrow();
  });

  it('writes a stock sheet with each price in its own currency', () => {
    const csv = stockCsv(
      [product(), product({ id: 'p2', name: 'Oil', currency: undefined, warehouseId: 'missing', dateAdded: undefined })],
      [{ id: 'w1', name: 'Main' } as any],
      false,
      'JOD',
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\n');
    expect(lines[0]).toContain('"Currency"');
    expect(lines[1]).toBe('"p1","Rice ""5kg""","Food","Main",4,12.5,"USD","2026-01-02"');
    expect(lines[2]).toBe('"p2","Oil","Food","",4,12.5,"JOD",');
  });

  it('lists orphan ids for replace mode', () => {
    expect(orphanIds([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }])).toEqual(['b']);
    expect(orphanIds([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }])).toEqual([]);
  });

  it('refuses replace before writes when a closed shift would be orphaned', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'),
      saveSupplierRecord: rec('supplier'), saveSupplierTransaction: rec('supplierTx'), saveShift: rec('shift'), saveOrder: rec('order'),
      saveCheque: rec('cheque'), saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
      deleteBookDoc: rec('delete'),
    } as RestoreActions;
    await expect(restoreStoreBackup(
      bak({ timestamp: 10_000, products: [product()] }),
      actions,
      { ...noLive, shifts: [{ id: 'closed-1', status: 'closed' }] },
      { mode: 'replace' },
    )).rejects.toMatchObject({ code: 'replace-undeletable', kind: 'shift' });
    expect(calls).toEqual([]);
  });

  it('replace deletes live products absent from the backup after upserts', async () => {
    const deleted: string[] = [];
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions: RestoreActions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'),
      saveSupplierRecord: rec('supplier'), saveSupplierTransaction: rec('supplierTx'), saveShift: rec('shift'), saveOrder: rec('order'),
      saveCheque: rec('cheque'), saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
      deleteBookDoc: async (collection, id) => { deleted.push(`${collection}:${id}`); },
      deletePendingCheque: async () => {},
    };
    await restoreStoreBackup(
      bak({ timestamp: 10_000, products: [product({ id: 'keep' })] }),
      actions,
      { ...noLive, products: [{ id: 'keep' }, { id: 'orphan' }] },
      { mode: 'replace' },
    );
    expect(calls).toContain('product');
    expect(deleted).toContain('inventory:orphan');
    expect(deleted).not.toContain('inventory:keep');
  });

  it('assertReplaceAllowed allows orphans that are still pending cheques', () => {
    expect(() => assertReplaceAllowed(
      bak({ cheques: [] }),
      { ...noLive, chequeRows: [{ id: 'c1', status: 'pending' }] },
    )).not.toThrow();
    expect(() => assertReplaceAllowed(
      bak({ cheques: [] }),
      { ...noLive, chequeRows: [{ id: 'c1', status: 'cashed' }] },
    )).toThrowError(/finalized cheque/i);
  });
});
