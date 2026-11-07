import type { AppSettings, Cheque, Customer, CustomerTransaction, Employee, Invoice, PayrollRecord, Product, Shift, Supplier, SupplierTransaction, TradeOrder, Vault, VaultTransaction, Warehouse } from '../types';
import { deleteCheque, restoreCheque } from './chequesStore';
import { readQueue } from './offlineQueue';
import type { LiveBooks, RestoreActions } from './storeBackup';
import { deleteDoc, doc, setDoc } from './supabaseDocs';
import { restoreVaultBalance, vaultRestoreMessage } from './vaultRestore';

export {
  BACKUP_FILE_PREFIX,
  DRIVE_BACKUP_QUERY,
  backupDownloadName,
  backupDriveName,
} from './backupNames';

/** Refuse restore while cash sales still wait on this device — they would fight the restored stock/vault. */
export function assertCanRestore(uid: string): void {
  const pending = readQueue(uid).length;
  if (pending <= 0) return;
  throw Object.assign(
    new Error(`Cannot restore while ${pending} sale(s) are still waiting to sync`),
    { code: 'offline-queue-pending', pending },
  );
}

export function restoreBlockedMessage(
  error: { code?: string; pending?: number; newer?: number; kind?: string } | null | undefined,
  isRtl: boolean,
): string | null {
  if (error?.code === 'offline-queue-pending') {
    const n = Number(error.pending) || 0;
    return isRtl
      ? `لا يمكن الاستعادة: توجد ${n || 'عدة'} عملية بيع على هذا الجهاز لم تُرسل بعد. اتصل بالإنترنت وانتظر إرسالها، ثم أعد المحاولة.`
      : `Cannot restore: ${n || 'some'} sale(s) on this device have not been sent yet. Connect, wait for them to sync, then try again.`;
  }
  if (error?.code === 'replace-undeletable') {
    return isRtl
      ? `تعذّرت الاستعادة بالاستبدال: يوجد ${error.kind === 'cheque' ? 'شيك نهائي' : 'وردية مغلقة'} في المتجر غير موجودة في النسخة ولا يمكن حذفها. لم يتغيّر شيء.`
      : `Replace restore refused: a live ${error.kind === 'cheque' ? 'finalized cheque' : 'closed shift'} is missing from the backup and cannot be deleted. Nothing was changed.`;
  }
  if (error?.code === 'replace-unavailable') {
    return isRtl
      ? 'استبدال الدفاتر غير متاح في هذا المسار. لم يتغيّر شيء.'
      : 'Replace restore is not available on this path. Nothing was changed.';
  }
  if (error?.code === 'restore-incomplete') {
    return isRtl
      ? 'توقفت استعادة سابقة قبل اكتمالها. أكمل الاستعادة من نسخة سليمة قبل تسجيل مبيعات جديدة.'
      : 'A previous restore did not finish. Complete a full restore from a good backup before recording new sales.';
  }
  if (error?.code === 'backup-forbidden') {
    return isRtl
      ? 'النسخ والاستعادة متاحة لصاحب المتجر فقط.'
      : 'Backup and restore are available to the store owner only.';
  }
  return vaultRestoreMessage(error, isRtl);
}

type AppSaveActions = {
  saveSettings: (settings: AppSettings) => Promise<void>;
  saveWarehouse: (warehouse: Warehouse) => Promise<void>;
  saveProduct: (product: Product, options: { skipMovement: true }) => Promise<void>;
  saveInvoice: (invoice: Invoice, options: { restoreOnly: true }) => Promise<unknown>;
  saveEmployee: (employee: Employee) => Promise<void>;
  savePayrollRecord: (payroll: PayrollRecord) => Promise<void>;
  saveCustomer: (customer: Customer, options: { restore: true }) => Promise<void>;
  saveCustomerTransaction: (tx: CustomerTransaction) => Promise<void>;
};

/** Live catalogs passed into restore (age gate + replace orphans). */
export function buildLiveBooks(input: {
  invoices: Invoice[];
  vaultTransactions: VaultTransaction[];
  customerTransactions: CustomerTransaction[];
  supplierTransactions: SupplierTransaction[];
  stockMovements: { timestamp: number }[];
  cheques: Cheque[];
  vault: Vault | null | undefined;
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  employees: Employee[];
  payrollRecords: PayrollRecord[];
  warehouses: Warehouse[];
  orders: TradeOrder[];
  shifts: Shift[];
}): LiveBooks {
  return {
    invoices: input.invoices,
    vaultTransactions: input.vaultTransactions,
    customerTransactions: input.customerTransactions,
    supplierTransactions: input.supplierTransactions,
    stockMovements: input.stockMovements,
    cheques: input.cheques,
    vault: input.vault,
    products: input.products,
    customers: input.customers,
    suppliers: input.suppliers,
    employees: input.employees,
    payrollRecords: input.payrollRecords,
    warehouses: input.warehouses,
    orders: input.orders,
    shifts: input.shifts,
    chequeRows: input.cheques,
  };
}

/** Same write path for local Settings, Backup Manager, and Google Drive restores. */
export function makeRestoreActions(db: unknown, uid: string, app: AppSaveActions): RestoreActions {
  return {
    saveSettings: app.saveSettings,
    saveWarehouse: app.saveWarehouse,
    saveProduct: app.saveProduct,
    saveInvoice: app.saveInvoice,
    saveEmployee: app.saveEmployee,
    savePayrollRecord: app.savePayrollRecord,
    saveCustomer: app.saveCustomer,
    saveCustomerTransaction: app.saveCustomerTransaction,
    saveSupplierRecord: (sp: Supplier) => setDoc(doc(db, 'users', uid, 'suppliers', sp.id), sp),
    saveSupplierTransaction: (tx: SupplierTransaction) => setDoc(doc(db, 'users', uid, 'supplier_transactions', tx.id), tx),
    saveShift: (shift: Shift) => setDoc(doc(db, 'users', uid, 'shifts', shift.id), shift),
    saveOrder: (order: TradeOrder) => setDoc(doc(db, 'users', uid, 'orders', order.id), order),
    saveCheque: (cheque: Cheque) => restoreCheque(uid, cheque),
    saveVaultRecord: (tx: VaultTransaction) => setDoc(doc(db, 'users', uid, 'vault_records', tx.id), tx),
    restoreVault: (v: Vault) => restoreVaultBalance(db, uid, v),
    deleteBookDoc: (collection: string, id: string) => deleteDoc(doc(db, 'users', uid, collection, id)),
    deletePendingCheque: async (cheque) => {
      await deleteCheque(uid, cheque as Cheque);
    },
  };
}
