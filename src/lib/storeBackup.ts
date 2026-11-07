import type {
  AppSettings, Cheque, Customer, CustomerTransaction, Employee, Invoice, PayrollRecord, Product, Shift, Supplier, TradeOrder, SupplierTransaction, Vault,
  VaultTransaction, Warehouse,
} from '../types';
import { clearIncompleteRestore, markRestoreIncomplete } from './restoreGuard';

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
  cheques: Cheque[];
  vaultTransactions: VaultTransaction[];
  warehouses: Warehouse[];
  vault: Vault | null;
}

export type StoreBackupInput = Omit<StoreBackup, 'app' | 'timestamp' | 'creator' | 'suppliers' | 'supplierTransactions' | 'shifts' | 'orders' | 'cheques'>
  & Partial<Pick<StoreBackup, 'suppliers' | 'supplierTransactions' | 'shifts' | 'orders' | 'cheques'>>
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
    cheques: input.cheques ?? [],
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
  // Require the app marker and a numeric timestamp so random JSON cannot pass restore gates.
  return data.app === BACKUP_APP && typeof data.timestamp === 'number' && Number.isFinite(data.timestamp);
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
    shifts: n(data.shifts),
    cheques: n(data.cheques),
    vaultTransactions: n(data.vaultTransactions),
  };
}

export type RestoreMode = 'merge' | 'replace';

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
  /** Cheque register (Supabase / guest). Skips rows that are already finalized beyond the backup. */
  saveCheque: (cheque: Cheque) => Promise<void>;
  saveVaultRecord: (tx: VaultTransaction) => Promise<void>;
  restoreVault: (vault: Vault) => Promise<void>;
  /**
   * Raw merchant_documents delete (no vault/stock reversal). Used only by replace mode
   * after backup rows were upserted. Collection names match the live store paths.
   */
  deleteBookDoc?: (collection: string, id: string) => Promise<void>;
  /** Pending-only cheque delete. Non-pending orphans block replace in preflight. */
  deletePendingCheque?: (cheque: Pick<Cheque, 'id' | 'status'>) => Promise<void>;
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** What the store already holds; anything dated after the backup means the backup is out of date. */
export interface LiveBooks {
  invoices: Array<Pick<Invoice, 'date'> & Partial<Pick<Invoice, 'id'>>>;
  vaultTransactions: Array<Pick<VaultTransaction, 'timestamp'> & Partial<Pick<VaultTransaction, 'id'>>>;
  customerTransactions: Array<Pick<CustomerTransaction, 'date'> & Partial<Pick<CustomerTransaction, 'id'>>>;
  supplierTransactions?: Array<Pick<SupplierTransaction, 'date'> & Partial<Pick<SupplierTransaction, 'id'>>>;
  /** Inventory adjusts after the backup would otherwise be silently overwritten. */
  stockMovements?: Pick<{ timestamp: number }, 'timestamp'>[];
  /** Cheque register activity (created / status change) for age gate. */
  cheques?: Pick<Cheque, 'createdAt' | 'statusChangedAt'>[];
  /**
   * Live vault lastUpdated. Compared to the backup vault before any writes so a
   * vault-newer refuse cannot leave stock/debts already restored.
   */
  vault?: Pick<Vault, 'lastUpdated'> | null;
  /** Id catalogs for replace-mode orphan deletion (optional for merge). */
  products?: Pick<Product, 'id'>[];
  customers?: Pick<Customer, 'id'>[];
  suppliers?: Pick<Supplier, 'id'>[];
  employees?: Pick<Employee, 'id'>[];
  payrollRecords?: Pick<PayrollRecord, 'id'>[];
  warehouses?: Pick<Warehouse, 'id'>[];
  orders?: Pick<TradeOrder, 'id'>[];
  shifts?: Pick<Shift, 'id' | 'status'>[];
  /** Cheque id + status for replace undeletable checks and pending deletes. */
  chequeRows?: Pick<Cheque, 'id' | 'status'>[];
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
  for (const mv of live.stockMovements || []) latest = Math.max(latest, time(mv.timestamp));
  for (const ch of live.cheques || []) {
    latest = Math.max(latest, time(ch.statusChangedAt), time(ch.createdAt));
  }
  const vaultUpdated = time(live.vault?.lastUpdated);
  if (vaultUpdated) latest = Math.max(latest, vaultUpdated);
  return latest > taken ? latest : null;
}

/**
 * Same rule as the database vault restore gate: refuse when the live vault is newer than the backup vault.
 * Call before any other restore writes so money and stock never diverge mid-restore.
 */
export function assertVaultRestoreAllowed(
  backupVault: Pick<Vault, 'lastUpdated'> | null | undefined,
  liveVault: Pick<Vault, 'lastUpdated'> | null | undefined,
): void {
  if (!backupVault || typeof backupVault !== 'object') return;
  const backupUpdated = time(backupVault.lastUpdated);
  const liveUpdated = time(liveVault?.lastUpdated);
  if (!Number.isFinite(backupUpdated) || backupUpdated <= 0) {
    throw Object.assign(new Error('vault is newer'), { code: 'vault-newer', newer: liveUpdated || undefined });
  }
  if (liveUpdated > backupUpdated) {
    throw Object.assign(new Error('vault is newer'), { code: 'vault-newer', newer: liveUpdated });
  }
}

/** Live ids that are not present in the backup list (orphans after a merge upsert). */
export function orphanIds(
  liveRows: Array<{ id?: string } | null | undefined> | undefined,
  backupRows: Array<{ id?: string } | null | undefined> | undefined,
): string[] {
  const keep = new Set(
    (backupRows || []).map((row) => row?.id).filter((id): id is string => typeof id === 'string' && !!id),
  );
  const out: string[] = [];
  for (const row of liveRows || []) {
    const id = row?.id;
    if (typeof id === 'string' && id && !keep.has(id)) out.push(id);
  }
  return out;
}

/**
 * Replace mode cannot delete closed shifts or non-pending cheques (DB/RLS). Refuse before any write.
 */
export function assertReplaceAllowed(data: Partial<StoreBackup>, live: LiveBooks): void {
  const backupShiftIds = new Set(list<Shift>(data.shifts).map((s) => s.id).filter(Boolean));
  for (const shift of live.shifts || []) {
    if (!shift?.id) continue;
    if (shift.status === 'closed' && !backupShiftIds.has(shift.id)) {
      throw Object.assign(new Error('A closed shift is not in this backup and cannot be deleted'), {
        code: 'replace-undeletable',
        kind: 'shift',
        id: shift.id,
      });
    }
  }
  const backupChequeIds = new Set(list<Cheque>(data.cheques).map((c) => c.id).filter(Boolean));
  for (const cheque of live.chequeRows || []) {
    if (!cheque?.id) continue;
    if (cheque.status !== 'pending' && !backupChequeIds.has(cheque.id)) {
      throw Object.assign(new Error('A finalized cheque is not in this backup and cannot be deleted'), {
        code: 'replace-undeletable',
        kind: 'cheque',
        id: cheque.id,
      });
    }
  }
}

async function deleteOrphans(
  actions: RestoreActions,
  collection: string,
  liveRows: Array<{ id?: string }> | undefined,
  backupRows: Array<{ id?: string }> | undefined,
): Promise<void> {
  if (!actions.deleteBookDoc) {
    throw Object.assign(new Error('Replace restore is not wired'), { code: 'replace-unavailable' });
  }
  for (const id of orphanIds(liveRows, backupRows)) {
    await actions.deleteBookDoc(collection, id);
  }
}

/**
 * Writes a backup back through the app's own save paths, so roles and the database rules apply.
 * A backup older than recorded sales, payments or vault movements is refused before anything is written:
 * its product quantities would bring back goods that were already sold.
 * The live vault age is checked up front so a vault-newer refuse never follows stock/debt writes.
 * `mode: 'replace'` upserts then deletes live book rows whose ids are absent from the backup.
 */
export async function restoreStoreBackup(
  data: Partial<StoreBackup>,
  actions: RestoreActions,
  live: LiveBooks,
  options?: { mode?: RestoreMode; /** When set, marks books incomplete until this restore finishes. */ uid?: string },
): Promise<void> {
  if (!isStoreBackup(data)) {
    throw Object.assign(new Error('This file is not a Mostawdaee backup'), { code: 'invalid-backup' });
  }
  const mode: RestoreMode = options?.mode === 'replace' ? 'replace' : 'merge';
  const newer = newerLiveActivity(data.timestamp, live);
  if (newer !== null) {
    throw Object.assign(new Error('The store has activity newer than this backup'), { code: 'backup-older', newer });
  }
  assertVaultRestoreAllowed(
    data.vault && typeof data.vault === 'object' ? data.vault : null,
    live.vault,
  );
  if (mode === 'replace') assertReplaceAllowed(data, live);

  const uid = typeof options?.uid === 'string' ? options.uid : '';
  if (uid) markRestoreIncomplete(uid, mode);

  // Sequential writes: any throw aborts the rest and leaves the incomplete flag set.
  // Callers must not toast success on failure. Vault balance is last so a mid-failure
  // never reports a restored cash drawer while stock/debts are still half-applied.
  try {
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
    for (const cheque of list<Cheque>(data.cheques)) {
      if (!cheque?.id) continue;
      try {
        await actions.saveCheque(cheque);
      } catch (error: any) {
        // Live cheque already past what the backup can reach — keep it and go on.
        if (error?.code !== 'cheque-already-final') throw error;
      }
    }
    for (const tx of list<VaultTransaction>(data.vaultTransactions)) {
      if (tx?.id) await actions.saveVaultRecord(tx);
    }

    if (mode === 'replace') {
      await deleteOrphans(actions, 'warehouses', live.warehouses, list(data.warehouses));
      await deleteOrphans(actions, 'inventory', live.products, list(data.products));
      await deleteOrphans(actions, 'invoices', live.invoices, list(data.invoices));
      await deleteOrphans(actions, 'employees', live.employees, list(data.employees));
      await deleteOrphans(actions, 'payroll', live.payrollRecords, list(data.payrollRecords));
      await deleteOrphans(actions, 'customers', live.customers, list(data.customers));
      await deleteOrphans(actions, 'customer_transactions', live.customerTransactions, list(data.customerTransactions));
      await deleteOrphans(actions, 'suppliers', live.suppliers, list(data.suppliers));
      await deleteOrphans(actions, 'supplier_transactions', live.supplierTransactions, list(data.supplierTransactions));
      await deleteOrphans(actions, 'shifts', live.shifts, list(data.shifts));
      await deleteOrphans(actions, 'orders', live.orders, list(data.orders));
      await deleteOrphans(actions, 'vault_records', live.vaultTransactions, list(data.vaultTransactions));

      const backupChequeIds = new Set(list<Cheque>(data.cheques).map((c) => c.id).filter(Boolean));
      for (const cheque of live.chequeRows || []) {
        if (!cheque?.id || backupChequeIds.has(cheque.id)) continue;
        if (cheque.status !== 'pending') {
          throw Object.assign(new Error('A finalized cheque cannot be deleted during replace'), {
            code: 'replace-undeletable',
            kind: 'cheque',
            id: cheque.id,
          });
        }
        if (!actions.deletePendingCheque) {
          throw Object.assign(new Error('Replace restore is not wired for cheques'), { code: 'replace-unavailable' });
        }
        await actions.deletePendingCheque(cheque);
      }
    }

    if (data.vault && typeof data.vault === 'object') await actions.restoreVault(data.vault);
    if (uid) clearIncompleteRestore(uid);
  } catch (error) {
    // Incomplete flag stays until a later restore finishes — sales refuse meanwhile.
    throw error;
  }
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
