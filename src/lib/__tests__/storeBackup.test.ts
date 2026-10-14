import { describe, expect, it } from 'vitest';
import {
  BACKUP_APP, backupCounts, buildStoreBackup, isLegacyTableBackup, isStoreBackup, newerLiveActivity, restoreStoreBackup, stockCsv,
  type RestoreActions,
} from '../storeBackup';

const noLive = { invoices: [], vaultTransactions: [], customerTransactions: [] };

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Rice "5kg"', category: 'Food', warehouseId: 'w1', quantity: 4, sellingPrice: 12.5,
  currency: 'USD', dateAdded: '2026-01-02T10:00:00.000Z', ...over,
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
    expect(isStoreBackup({ app: BACKUP_APP })).toBe(true);
    expect(isStoreBackup({ products: [] })).toBe(true);
  });

  it('restores through the app save paths, vault movements before the balance', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions: RestoreActions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'),
      saveSupplierRecord: rec('supplier'), saveSupplierTransaction: rec('supplierTx'), saveShift: rec('shift'), saveOrder: rec('order'),
      saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    };
    await restoreStoreBackup({
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
      vaultTransactions: [{ id: 'v1' }, { amount: 3 }] as any,
      vault: { currentBalance: 10, lastUpdated: 5 },
    }, actions, noLive);
    expect(calls).toEqual([
      'settings', 'warehouse', 'product', 'invoice', 'employee', 'payroll', 'customer', 'customerTx', 'supplier', 'supplierTx',
      'shift', 'order', 'vaultRecord', 'vault',
    ]);
  });

  it('refuses an old backup before writing anything when the store has newer activity', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (..._args: unknown[]) => { calls.push(name); };
    const actions = {
      saveSettings: rec('settings'), saveWarehouse: rec('warehouse'), saveProduct: rec('product'),
      saveInvoice: rec('invoice'), saveEmployee: rec('employee'), savePayrollRecord: rec('payroll'),
      saveCustomer: rec('customer'), saveCustomerTransaction: rec('customerTx'), saveShift: rec('shift'), saveOrder: rec('order'),
      saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    } as RestoreActions;
    const live = { invoices: [{ date: 2_000 }], vaultTransactions: [], customerTransactions: [] };
    await expect(restoreStoreBackup({ timestamp: 1_000, products: [product()] }, actions, live))
      .rejects.toMatchObject({ code: 'backup-older', newer: 2_000 });
    expect(calls).toEqual([]);
  });

  it('dates live activity from invoices, vault movements and ledger entries', () => {
    expect(newerLiveActivity(5_000, { invoices: [{ date: 4_000 }], vaultTransactions: [{ timestamp: 4_500 }], customerTransactions: [] })).toBeNull();
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [{ timestamp: 6_000 }], customerTransactions: [] })).toBe(6_000);
    expect(newerLiveActivity(Date.parse('2026-10-01'), { invoices: [], vaultTransactions: [], customerTransactions: [{ date: '2026-10-05T10:00:00Z' }] })).toBe(Date.parse('2026-10-05T10:00:00Z'));
    expect(newerLiveActivity(undefined, { invoices: [{ date: 1 }], vaultTransactions: [], customerTransactions: [] })).toBe(1);
    expect(newerLiveActivity(5_000, { invoices: [], vaultTransactions: [], customerTransactions: [], supplierTransactions: [{ date: 7_000 }] })).toBe(7_000);
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
      saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    } as RestoreActions;
    const live = { invoices: [], vaultTransactions: [], customerTransactions: [] };
    await restoreStoreBackup({ timestamp: 1_000, payrollRecords: [{ id: 'p1' } as any], customers: [{ id: 'c1' } as any] }, actions, live);
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
      saveShift: async (shift: { id: string }) => {
        if (shift.id === 'closed') throw Object.assign(new Error('This shift is closed'), { code: 'shift-closed' });
        calls.push(`shift:${shift.id}`);
      },
      saveVaultRecord: rec('vaultRecord'), restoreVault: rec('vault'),
    } as RestoreActions;
    await restoreStoreBackup({ shifts: [{ id: 'closed' }, { id: 'open' }] as any, vaultTransactions: [{ id: 'v1' }] as any }, actions, noLive);
    expect(calls).toEqual(['shift:open', 'vaultRecord']);
  });

  it('stops on any other shift failure', async () => {
    const ok = async () => {};
    const actions = {
      saveSettings: ok, saveWarehouse: ok, saveProduct: ok, saveInvoice: ok, saveEmployee: ok, savePayrollRecord: ok,
      saveCustomer: ok, saveCustomerTransaction: ok, saveSupplierRecord: ok, saveSupplierTransaction: ok,
      saveShift: async () => { throw Object.assign(new Error('role not allowed'), { code: 'permission-denied' }); }, saveOrder: ok,
      saveVaultRecord: ok, restoreVault: ok,
    } as RestoreActions;
    await expect(restoreStoreBackup({ shifts: [{ id: 's' }] as any }, actions, noLive)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('carries shifts in the backup', () => {
    const b = buildStoreBackup({ creator: 'x', settings: null, products: [], shifts: [{ id: 'sh1' }] } as any, 1);
    expect(b.shifts).toHaveLength(1);
    expect(buildStoreBackup({ creator: 'x', settings: null, products: [] } as any, 1).shifts).toEqual([]);
  });

  it('stops at the first failure so a refused vault is reported', async () => {
    const actions = {
      saveSettings: async () => {}, saveWarehouse: async () => {}, saveProduct: async () => {},
      saveInvoice: async () => {}, saveEmployee: async () => {}, savePayrollRecord: async () => {},
      saveCustomer: async () => {}, saveCustomerTransaction: async () => {}, saveVaultRecord: async () => {},
      saveSupplierRecord: async () => {}, saveSupplierTransaction: async () => {}, saveShift: async () => {}, saveOrder: async () => {},
      restoreVault: async () => { throw Object.assign(new Error('vault is newer'), { code: 'vault-newer' }); },
    } as RestoreActions;
    await expect(restoreStoreBackup({ vault: { currentBalance: 0, lastUpdated: 1 } as any }, actions, noLive)).rejects.toMatchObject({ code: 'vault-newer' });
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
});
