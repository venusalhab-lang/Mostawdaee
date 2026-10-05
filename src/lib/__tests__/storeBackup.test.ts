import { describe, expect, it } from 'vitest';
import {
  BACKUP_APP, backupCounts, buildStoreBackup, isLegacyTableBackup, isStoreBackup, restoreStoreBackup, stockCsv,
  type RestoreActions,
} from '../storeBackup';

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
      vaultTransactions: [{ id: 'v1' }, { amount: 3 }] as any,
      vault: { currentBalance: 10, lastUpdated: 5 },
    }, actions);
    expect(calls).toEqual([
      'settings', 'warehouse', 'product', 'invoice', 'employee', 'payroll', 'customer', 'customerTx', 'vaultRecord', 'vault',
    ]);
  });

  it('stops at the first failure so a refused vault is reported', async () => {
    const actions = {
      saveSettings: async () => {}, saveWarehouse: async () => {}, saveProduct: async () => {},
      saveInvoice: async () => {}, saveEmployee: async () => {}, savePayrollRecord: async () => {},
      saveCustomer: async () => {}, saveCustomerTransaction: async () => {}, saveVaultRecord: async () => {},
      restoreVault: async () => { throw Object.assign(new Error('vault is newer'), { code: 'vault-newer' }); },
    } as RestoreActions;
    await expect(restoreStoreBackup({ vault: { currentBalance: 0, lastUpdated: 1 } as any }, actions)).rejects.toMatchObject({ code: 'vault-newer' });
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
