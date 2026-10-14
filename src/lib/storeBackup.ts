import type {
  AppSettings, Customer, CustomerTransaction, Employee, Invoice, PayrollRecord, Product, Shift, Supplier, TradeOrder, SupplierTransaction, Vault,
  VaultTransaction, Warehouse,
} from '../types';

export const BACKUP_APP = 'Mostawdaee System';

/** One file shape for every backup screen: the store books exactly as the app holds them. */
export interface StoreBackup {
  app: typeof BACKUP_APP;
  timestamp: number;
  creator: string;
  settings: AppSettings | null;
  products: Product[];
  invoices: Invoice[];
  employees: Employee[];
  payrollRecords: PayrollRecord[];
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  shifts: Shift[];
  orders: TradeOrder[];
  vaultTransactions: VaultTransaction[];
  warehouses: Warehouse[];
  vault: Vault | null;
}

export type StoreBackupInput = Omit<StoreBackup, 'app' | 'timestamp' | 'creator' | 'suppliers' | 'supplierTransactions' | 'shifts' | 'orders'>
  & Partial<Pick<StoreBackup, 'suppliers' | 'supplierTransactions' | 'shifts' | 'orders'>>
  & { creator?: string | null };

export function buildStoreBackup(input: StoreBackupInput, now = Date.now()): StoreBackup {
  return {
    app: BACKUP_APP,
    timestamp: now,
    creator: input.creator || 'Anonymous',
    settings: input.settings ?? null,
    products: input.products ?? [],
    invoices: input.invoices ?? [],
    employees: input.employees ?? [],
    payrollRecords: input.payrollRecords ?? [],
    customers: input.customers ?? [],
    customerTransactions: input.customerTransactions ?? [],
    suppliers: input.suppliers ?? [],
    supplierTransactions: input.supplierTransactions ?? [],
    shifts: input.shifts ?? [],
    orders: input.orders ?? [],
    vaultTransactions: input.vaultTransactions ?? [],
    warehouses: input.warehouses ?? [],
    vault: input.vault ?? null,
  };
}

/** Files written by the old table export carry `tables` and none of the store books. */
export function isLegacyTableBackup(data: any): boolean {
  return !!data && typeof data === 'object' && !!data.tables && !Array.isArray(data.products) && !Array.isArray(data.invoices);
}

export function isStoreBackup(data: any): data is Partial<StoreBackup> {
  if (!data || typeof data !== 'object' || isLegacyTableBackup(data)) return false;
  return data.app === BACKUP_APP || Array.isArray(data.products) || Array.isArray(data.invoices) || !!data.settings;
}

export function backupCounts(data: Partial<StoreBackup>) {
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    products: n(data.products),
    warehouses: n(data.warehouses),
    invoices: n(data.invoices),
    employees: n(data.employees),
    customers: n(data.customers),
    suppliers: n(data.suppliers),
    vaultTransactions: n(data.vaultTransactions),
  };
}

export interface RestoreActions {
  saveSettings: (settings: AppSettings) => Promise<void>;
  saveWarehouse: (warehouse: Warehouse) => Promise<void>;
  saveProduct: (product: Product, options: { skipMovement: true }) => Promise<void>;
  saveInvoice: (invoice: Invoice, options: { restoreOnly: true }) => Promise<unknown>;
  saveEmployee: (employee: Employee) => Promise<void>;
  savePayrollRecord: (payroll: PayrollRecord) => Promise<void>;
  saveCustomer: (customer: Customer, options: { restore: true }) => Promise<void>;
  saveCustomerTransaction: (tx: CustomerTransaction) => Promise<void>;
  /** Raw writes: balances and ledger come back exactly as saved, like customers. */
  saveSupplierRecord: (supplier: Supplier) => Promise<void>;
  saveSupplierTransaction: (tx: SupplierTransaction) => Promise<void>;
  /** Raw write; the server refuses to change a shift that is already closed. */
  saveShift: (shift: Shift) => Promise<void>;
  saveOrder: (order: TradeOrder) => Promise<void>;
  saveVaultRecord: (tx: VaultTransaction) => Promise<void>;
  restoreVault: (vault: Vault) => Promise<void>;
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** What the store already holds; anything dated after the backup means the backup is out of date. */
export interface LiveBooks {
  invoices: Pick<Invoice, 'date'>[];
  vaultTransactions: Pick<VaultTransaction, 'timestamp'>[];
  customerTransactions: Pick<CustomerTransaction, 'date'>[];
  supplierTransactions?: Pick<SupplierTransaction, 'date'>[];
}

const time = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Date.parse(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/** Latest live movement recorded after the backup was taken, or null when the backup is current. */
export function newerLiveActivity(backupTimestamp: unknown, live: LiveBooks): number | null {
  const taken = time(backupTimestamp);
  let latest = 0;
  for (const inv of live.invoices) latest = Math.max(latest, time(inv.date));
  for (const tx of live.vaultTransactions) latest = Math.max(latest, time(tx.timestamp));
  for (const tx of live.customerTransactions) latest = Math.max(latest, time(tx.date));
  for (const tx of live.supplierTransactions || []) latest = Math.max(latest, time(tx.date));
  return latest > taken ? latest : null;
}

/**
 * Writes a backup back through the app's own save paths, so roles and the database rules apply.
 * A backup older than recorded sales, payments or vault movements is refused before anything is written:
 * its product quantities would bring back goods that were already sold.
 */
export async function restoreStoreBackup(data: Partial<StoreBackup>, actions: RestoreActions, live: LiveBooks): Promise<void> {
  const newer = newerLiveActivity(data.timestamp, live);
  if (newer !== null) {
    throw Object.assign(new Error('The store has activity newer than this backup'), { code: 'backup-older', newer });
  }
  if (data.settings) await actions.saveSettings(data.settings);
  for (const wh of list<Warehouse>(data.warehouses)) await actions.saveWarehouse(wh);
  for (const p of list<Product>(data.products)) await actions.saveProduct(p, { skipMovement: true });
  for (const inv of list<Invoice>(data.invoices)) await actions.saveInvoice(inv, { restoreOnly: true });
  for (const e of list<Employee>(data.employees)) await actions.saveEmployee(e);
  for (const pr of list<PayrollRecord>(data.payrollRecords)) {
    try {
      await actions.savePayrollRecord(pr);
    } catch (error: any) {
      // A salary already paid in the live books is final (its vault expense exists); keep it and go on.
      if (error?.code !== 'payroll-already-paid' && error?.message !== 'Payroll already paid') throw error;
    }
  }
  for (const c of list<Customer>(data.customers)) await actions.saveCustomer(c, { restore: true });
  for (const tx of list<CustomerTransaction>(data.customerTransactions)) await actions.saveCustomerTransaction(tx);
  for (const s of list<Supplier>(data.suppliers)) {
    if (s?.id) await actions.saveSupplierRecord(s);
  }
  for (const tx of list<SupplierTransaction>(data.supplierTransactions)) {
    if (tx?.id) await actions.saveSupplierTransaction(tx);
  }
  for (const shift of list<Shift>(data.shifts)) {
    if (!shift?.id) continue;
    try {
      await actions.saveShift(shift);
    } catch (error: any) {
      // A closed shift already in the live books is final; keep it and go on.
      if (error?.code !== 'shift-closed') throw error;
    }
  }
  for (const order of list<TradeOrder>(data.orders)) {
    if (order?.id) await actions.saveOrder(order);
  }
  for (const tx of list<VaultTransaction>(data.vaultTransactions)) {
    if (tx?.id) await actions.saveVaultRecord(tx);
  }
  if (data.vault && typeof data.vault === 'object') await actions.restoreVault(data.vault);
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/** Stock sheet from the products the app holds. Prices keep their own currency. */
export function stockCsv(products: Product[], warehouses: Warehouse[], ar: boolean, defaultCurrency: string): string {
  const names = new Map(warehouses.map((w) => [w.id, w.name]));
  const headers = ar
    ? ['رقم المنتج', 'اسم المنتج', 'القسم', 'المستودع', 'الكمية المتوفرة', 'سعر البيع', 'العملة', 'تاريخ الإضافة']
    : ['Product ID', 'Item Name', 'Category', 'Warehouse', 'Available Stock', 'Selling Price', 'Currency', 'Date Added'];
  const rows = products.map((p) => [
    csvCell(p.id),
    csvCell(p.name),
    csvCell(p.category),
    csvCell((p.warehouseId && names.get(p.warehouseId)) || ''),
    Number(p.quantity) || 0,
    Number(p.sellingPrice) || 0,
    csvCell(p.currency || defaultCurrency),
    p.dateAdded ? csvCell(new Date(p.dateAdded).toISOString().slice(0, 10)) : '',
  ].join(','));
  return '\uFEFF' + [headers.map(csvCell).join(','), ...rows].join('\n');
}
