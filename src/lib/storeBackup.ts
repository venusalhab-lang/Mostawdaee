import type {
  AppSettings, Customer, CustomerTransaction, Employee, Invoice, PayrollRecord, Product, Vault, VaultTransaction, Warehouse,
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
  vaultTransactions: VaultTransaction[];
  warehouses: Warehouse[];
  vault: Vault | null;
}

export type StoreBackupInput = Omit<StoreBackup, 'app' | 'timestamp' | 'creator'> & { creator?: string | null };

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
  saveVaultRecord: (tx: VaultTransaction) => Promise<void>;
  restoreVault: (vault: Vault) => Promise<void>;
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Writes a backup back through the app's own save paths, so roles and the database rules apply.
 * Vault movements go before the balance; the balance is refused when the live vault is newer.
 */
export async function restoreStoreBackup(data: Partial<StoreBackup>, actions: RestoreActions): Promise<void> {
  if (data.settings) await actions.saveSettings(data.settings);
  for (const wh of list<Warehouse>(data.warehouses)) await actions.saveWarehouse(wh);
  for (const p of list<Product>(data.products)) await actions.saveProduct(p, { skipMovement: true });
  for (const inv of list<Invoice>(data.invoices)) await actions.saveInvoice(inv, { restoreOnly: true });
  for (const e of list<Employee>(data.employees)) await actions.saveEmployee(e);
  for (const pr of list<PayrollRecord>(data.payrollRecords)) await actions.savePayrollRecord(pr);
  for (const c of list<Customer>(data.customers)) await actions.saveCustomer(c, { restore: true });
  for (const tx of list<CustomerTransaction>(data.customerTransactions)) await actions.saveCustomerTransaction(tx);
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
