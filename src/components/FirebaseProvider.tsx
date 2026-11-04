import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { OperationType, handleFirestoreError, type User } from '../lib/storeErrors';
import { clearDriveConnect, finishDriveConnect, isDriveConnectPending } from '../lib/driveConnect';
import { supabase } from '../supabaseClient';
import { SYNC_PROBLEM_EVENT, collection, db, deleteDoc, doc, onSnapshot, resetSync, runTransaction, setDoc, updateDoc } from '../lib/supabaseDocs';
import { Product, AppSettings, Transaction, Employee, Customer, CustomerTransaction, VaultTransaction, Vault, StockMovement, Invoice, Currency, PayrollRecord, Warehouse, AuditLog, Supplier, SupplierTransaction, Shift, TradeOrder } from '../types';
import { toast } from 'sonner';
import { setDriveAccessToken } from '../services/googleDrive';
import { completeOAuthSessionFromLocation, oauthProviderError, urlLooksLikeOAuthCallback } from '../lib/completeOAuthSession';
import { clearUserCache, migrateLegacyUserCache, readUserCache, removeUserCache, writeUserCache } from '../lib/userStorage';
import { readHeldBills } from '../lib/heldBills';
import { computeStockStatus, roundQty } from '../lib/stock';
import { sameSku } from '../lib/productLookup';
import { mergeProductEdit } from '../lib/productEdit';
import { formatMoney } from '../lib/exchangeRates';
import { consumeInvoiceNumber, peekInvoiceNumber } from '../lib/invoiceNumber';
import { snapshotLineCosts, weightedAverageCost } from '../lib/profits';
import { planStockReversal, quantitiesByProduct } from '../lib/invoiceReversal';
import { planSalesReturn, splitRefund, type ReturnLineRequest } from '../lib/salesReturn';
import { costAfterReturn, planPurchaseReturn, returnedCostByProduct, splitPurchaseRefund } from '../lib/purchaseReturn';
import { findSupplierByName, owedBalances, purchaseDeleteRequiresSupplierLedger, purchasePayment, supplierBalance, withBalance } from '../lib/suppliers';
import { lineUnits } from '../lib/packs';
import { canOpenShift, cashDifference, openShiftOf, summarizeShift } from '../lib/shifts';
import {
  QueuedInvoice,
  applyQueuedSalesToProducts,
  applyQueuedSalesToVault,
  belongsToStore,
  canDeferSaleToQueue,
  canQueueOffline,
  enqueueInvoice,
  isOfflineError,
  localSaleShortages,
  mergeQueuedInvoices,
  mergeQueuedVaultRecords,
  readQueue,
  withQueueLock,
  writeQueue,
} from '../lib/offlineQueue';
import { type Workspace, currentWorkspace, ensureWorkspace, refreshWorkspace, subscribeWorkspace } from '../lib/workspace';
import { type WorkspaceAction, can as roleCan, canOpenScreen as roleCanOpenScreen } from '../lib/roles';
import type { PlatformRole } from '../lib/platformStaff';
import { fetchPlatformRole } from '../lib/adminSubscriptionApi';
import { setPasswordRecovery } from '../lib/passwordRecovery';
import { INSUFFICIENT_VAULT_FUNDS, applyVaultDelta, buildVaultDoc, planInvoiceVaultEntry, readVaultBalances, roundForCurrency } from '../lib/vaultMath';
import { salePayment } from '../lib/salesPayment';
import { checkManualArIncrease, formatManualArNote } from '../lib/customerLedger';

// Recursively strips any properties with 'undefined' values, since Firestore errors if passed 'undefined'.
export const PRODUCT_NOT_FOUND = 'Product not found';

const removeUndefined = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      if (obj[key] !== undefined) {
        cleaned[key] = removeUndefined(obj[key]);
      }
    }
    return cleaned;
  }
  return obj;
};

// Maps 'uid' to 'id' dynamically on the User object to maintain cross-system capability and prevent session failures
const wrapUserWithId = (firebaseUser: User | null): User | null => {
  if (!firebaseUser) return null;
  return new Proxy(firebaseUser, {
    get(target, prop, receiver) {
      if (prop === 'id') return target.uid;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  }) as any;
};

interface FirebaseContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  settings: AppSettings | null;
  products: Product[];
  transactions: Transaction[]; // Legacy/Combined
  invoices: Invoice[]; // Changed from Transaction[]
  employees: Employee[];
  payrollRecords: PayrollRecord[];
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  /** Till shifts of the store, newest first. */
  shifts: Shift[];
  /** Purchase orders and quotations, newest first. */
  orders: TradeOrder[];
  vaultTransactions: VaultTransaction[];
  warehouses: Warehouse[];
  auditLogs: AuditLog[];
  vault: Vault | null;
  saveSettings: (settings: AppSettings) => Promise<void>;
  saveProduct: (product: Product, options?: {
    reason?: string;
    skipMovement?: boolean;
    baseQuantity?: number;
    baseProduct?: Product;
    /** Set quantity to the submitted value only if the stored book still equals `baseQuantity`. */
    absoluteQuantity?: boolean;
  }) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  stockMovements: StockMovement[];
  /** Resolves with the invoice number actually stored (the server may add a suffix if another device used it). */
  saveInvoice: (invoice: Invoice, options?: { restoreOnly?: boolean }) => Promise<string>;
  deleteInvoice: (id: string) => Promise<void>;
  /** Records a sales return against a saved sale; owner/manager only. Errors carry a localized message. */
  createSalesReturn: (input: Omit<SalesReturnInput, 'invoiceNumber'>) => Promise<Invoice>;
  /** Sends goods of a purchase back to its supplier. Errors carry a localized message. */
  createPurchaseReturn: (input: Omit<SalesReturnInput, 'invoiceNumber'>) => Promise<Invoice>;
  /** Pass the same `id` when retrying: a movement already saved under it is not applied again. */
  recordVaultTransaction: (record: Omit<VaultTransaction, 'id' | 'timestamp' | 'balanceAfter'> & { id?: string }) => Promise<void>;
  saveEmployee: (employee: Employee) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;
  savePayrollRecord: (payroll: PayrollRecord) => Promise<void>;
  payPayroll: (payroll: PayrollRecord) => Promise<void>;
  deletePayrollRecord: (id: string) => Promise<void>;
  saveCustomer: (customer: Customer, options?: { restore?: boolean }) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  saveCustomerTransaction: (tx: CustomerTransaction) => Promise<void>;
  deleteCustomerTransaction: (id: string) => Promise<void>;
  deleteCustomerLedgerTransaction: (txId: string, options?: { reverseVault?: boolean }) => Promise<void>;
  saveWarehouse: (warehouse: Warehouse) => Promise<void>;
  transferStock: (productId: string, toWarehouseId: string, quantity: number) => Promise<void>;
  /**
   * Applies a stocktake in one transaction: every counted line is written together or none are.
   * Each line must still match `expectedQty` on the server (book drift aborts the whole apply).
   */
  applyStocktake: (input: {
    auditNumber: string;
    lines: Array<{ productId: string; productName: string; expectedQty: number; actualQty: number; movementLabel: string }>;
  }) => Promise<void>;
  deleteWarehouse: (id: string) => Promise<void>;
  /** `draftId` makes a retry of the same entry a no-op instead of a second payment. */
  recordCustomerLedgerTransaction: (customerId: string, amount: number, type: 'invoice' | 'payment', notes: string, syncToVault?: boolean, draftId?: string) => Promise<void>;
  /** New suppliers may start with what is already owed, one amount per currency. Errors carry a localized message. */
  saveSupplier: (supplier: Pick<Supplier, 'id' | 'name' | 'phone' | 'notes'>, openingBalances?: Array<{ currency: Currency; amount: number }>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  /** Saves a purchase order or quotation. Never touches stock or money; a converted order can no longer change. */
  saveOrder: (order: TradeOrder) => Promise<void>;
  /** Links an order to the invoice made from it. */
  markOrderConverted: (orderId: string, invoice: Pick<Invoice, 'id' | 'invoiceNumber'>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  recordSupplierPayment: (input: { id: string; supplierId: string; amount: number; currency: Currency; notes?: string }) => Promise<void>;
  deleteSupplierTransaction: (txId: string) => Promise<void>;
  /** Opens a shift for the signed-in account. Errors carry a localized message. */
  openShift: (input: { id: string; currency: Currency; openingFloat: number; notes?: string }) => Promise<void>;
  /** Closes an open shift with the cash counted per currency; the summary is frozen with it. */
  closeShift: (input: { id: string; counted: Partial<Record<Currency, number>>; notes?: string }) => Promise<Shift>;
  recalibrateVault: (newBalance: number, currency: Currency, reason: string) => Promise<void>;
  logUserActivity: (action: string, details: string, category: 'product' | 'invoice' | 'settings' | 'employee' | 'customer' | 'warehouse' | 'vault' | 'payroll') => Promise<void>;
  logout: () => Promise<void>;
  /** The store this account works in; null until it is known for the signed-in user. */
  workspace: Workspace | null;
  isStoreOwner: boolean;
  can: (action: WorkspaceAction) => boolean;
  canOpenScreen: (screen: string) => boolean;
  /** Role in the founder's platform team, whatever store the account works in; null for merchants. */
  platformRole: PlatformRole | null;
  /** False until the platform-role check for the signed-in user has settled. */
  platformRoleReady: boolean;
}

// Display preferences a member keeps on this device; the store profile itself belongs to the owner.
const MEMBER_PREFERENCE_KEYS = ['defaultLanguage', 'darkMode', 'theme', 'enableAnimations', 'aiVerbosity'] as const;

function isMember(): boolean {
  const role = currentWorkspace()?.role;
  return !!role && role !== 'owner';
}

function withMemberPreferences(uid: string, storeSettings: AppSettings): AppSettings {
  if (!isMember()) return storeSettings;
  return { ...storeSettings, ...readUserCache<Partial<AppSettings>>(uid, 'member_prefs', {}) };
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

function syncRejectionMessage(code: string | undefined): string | null {
  const ar = typeof document === 'undefined' || document.documentElement.dir !== 'ltr';
  if (code === 'schema-missing' || code === 'collection-not-installed') {
    return ar
      ? 'قاعدة البيانات غير مكتملة بعد (شغّل ملفات Supabase SQL). لم يُحفظ هذا التغيير. تواصل مع الدعم.'
      : 'The database schema is incomplete (run the Supabase SQL files). This change was not saved. Contact support.';
  }
  if (code === 'unauthenticated') {
    return ar
      ? 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى لحفظ التغييرات.'
      : 'Your session has ended. Sign in again to save changes.';
  }
  if (code === 'subscription-required' && isMember()) {
    return ar
      ? 'اشتراك المتجر منتهٍ، فلم يُحفظ هذا التغيير. تواصل مع مالك المتجر لتجديده.'
      : "The store's subscription has ended, so this change was not saved. Ask the store owner to renew.";
  }
  if (code === 'subscription-required') {
    return ar
      ? 'انتهى الاشتراك، فلم يُحفظ هذا التغيير. جدّد الاشتراك من الإعدادات لمتابعة العمل.'
      : 'Your subscription has ended, so this change was not saved. Renew from Settings to continue.';
  }
  if (code === 'role-denied') {
    return ar
      ? 'صلاحياتك في هذا المتجر لا تسمح بهذا التغيير، فلم يُحفظ. اطلب من مالك المتجر أو المدير تنفيذه.'
      : 'Your role in this store does not allow this change, so it was not saved. Ask the owner or a manager.';
  }
  if (code === 'einvoice-locked') {
    return ar
      ? 'هذه الفاتورة مقبولة لدى نظام الفوترة الوطني، فلا يمكن تعديلها أو حذفها. تُصحَّح بفاتورة إرجاع.'
      : 'This invoice was accepted by the national e-invoicing system, so it cannot be edited or deleted. Correct it with a return invoice.';
  }
  if (code === 'permission-denied') {
    return ar
      ? 'رفض الخادم حفظ هذا التغيير لهذا الحساب.'
      : 'The server refused to save this change for this account.';
  }
  return null;
}

function readStoredSession(): any | null {
  try {
    const key = (supabase.auth as any).storageKey as string | undefined;
    if (!key || typeof localStorage === 'undefined') return null;
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    return stored?.user?.id && stored?.access_token ? stored : null;
  } catch {
    return null;
  }
}

/** Cash cannot go below zero: an expense that the per-currency balance can't cover is rejected. */
function assertVaultCanCover(balanceAfter: number, currency: Currency) {
  if (balanceAfter < 0) {
    const available = roundForCurrency(balanceAfter, currency); // negative => shortfall
    throw new Error(`${INSUFFICIENT_VAULT_FUNDS} (${currency}). Short by ${Math.abs(available)}`);
  }
}

interface CommitInvoiceOptions {
  lowStockThreshold?: number;
  defaultCurrency: string;
  /** Replaying a sale that already happened offline: record it even if stock goes negative. */
  allowNegativeStock?: boolean;
  /** Same replay: a sale line whose product was deleted meanwhile is recorded without a stock change. */
  allowMissingProducts?: boolean;
  ar?: boolean;
}

interface CommitInvoiceResult {
  status: 'saved' | 'duplicate';
  negativeStock: string[];
  missingProducts?: string[];
  /** The number actually stored; differs from the requested one when another device already used it. */
  invoiceNumber: string;
}

/** False once the server reports the invoice_numbers collection isn't installed yet. */
let invoiceNumberClaimsEnabled = true;
const MAX_NUMBER_SUFFIX = 20;

/** Reserves a sale or purchase number on the server so two devices or tabs can never store the same one. */
async function claimInvoiceNumber(transaction: any, uid: string, invoice: Invoice): Promise<string> {
  const base = invoice.invoiceNumber;
  for (let attempt = 1; attempt <= MAX_NUMBER_SUFFIX; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    const ref = doc(db, 'users', uid, 'invoice_numbers', encodeURIComponent(candidate));
    const snap = await transaction.get(ref);
    if (!snap.exists()) {
      transaction.set(ref, { invoiceId: invoice.id, claimedAt: Date.now() });
      return candidate;
    }
    if ((snap.data() as { invoiceId?: string })?.invoiceId === invoice.id) return candidate;
  }
  throw Object.assign(new Error(`Invoice number ${base} is already used`), { code: 'invoice-number-taken' });
}

export interface SalesReturnInput {
  /** Stable per return draft, so a retry after a lost reply never posts the return twice. */
  id: string;
  originalId: string;
  lines: ReturnLineRequest[];
  reason: string;
  invoiceNumber: string;
}

interface SalesReturnResult {
  status: 'saved' | 'duplicate';
  invoice: Invoice;
  missingProducts: string[];
}

/**
 * Applies a sales return in one atomic commit: goods back to stock, the money back the way the sale was paid
 * (vault, customer debt, or outside the app for card/wallet), and the returned quantities on the original sale.
 * Quantities are checked against the server copy of the sale, so two devices cannot return the same units twice.
 */
async function commitSalesReturn(uid: string, input: SalesReturnInput, opts: CommitInvoiceOptions): Promise<SalesReturnResult> {
  const fail = (message: string, code: string, extra: object = {}) => Object.assign(new Error(message), { code, ...extra });
  const run = async (claim: boolean) => {
    let result: SalesReturnResult | null = null;
    await runTransaction(db, async (transaction) => {
      result = null;
      const returnRef = doc(db, 'users', uid, 'invoices', input.id);
      const existing = await transaction.get(returnRef);
      if (existing.exists()) {
        result = { status: 'duplicate', invoice: { ...(existing.data() as Invoice), id: input.id }, missingProducts: [] };
        return;
      }
      const originalRef = doc(db, 'users', uid, 'invoices', input.originalId);
      const originalSnap = await transaction.get(originalRef);
      if (!originalSnap.exists()) throw fail('Original invoice not found', 'not-found');
      const original = { ...(originalSnap.data() as Invoice), id: input.originalId };
      const planned = planSalesReturn(original, input.lines);
      if (!planned.ok) throw fail(`Return rejected: ${planned.error.code}`, 'return-invalid', { detail: planned.error });
      const { plan } = planned;

      // Fail closed: never refund money/AR if any returned product is gone (purchase returns already refuse).
      for (const [productId, { qty, description }] of quantitiesByProduct(plan.items)) {
        const productRef = doc(db, 'users', uid, 'inventory', productId);
        const productSnap = await transaction.get(productRef);
        if (!productSnap.exists()) {
          throw fail(`${PRODUCT_NOT_FOUND}: ${description || productId}`, 'product-not-found', { productName: description || productId });
        }
        const product = productSnap.data() as Product;
        const quantity = roundQty((Number(product.quantity) || 0) + qty);
        transaction.update(productRef, {
          quantity,
          status: computeStockStatus(quantity, product.lowStockThreshold, opts.lowStockThreshold),
        });
      }
      const missingProducts: string[] = [];

      let currentDebt = 0;
      const customerRef = original.customerId ? doc(db, 'users', uid, 'customers', original.customerId) : null;
      if (original.paymentMethod === 'credit') {
        const customerSnap = customerRef ? await transaction.get(customerRef) : null;
        if (!customerSnap?.exists()) throw fail('Customer not found', 'customer-not-found');
        const customer = customerSnap.data() as Customer;
        const debtCurrency = (original.debtCurrency || original.currency) as Currency;
        if ((customer.currency || debtCurrency) !== debtCurrency) throw fail('Customer currency changed', 'customer-currency-changed');
        currentDebt = Number(customer.totalDebt) || 0;
      }
      const refund = splitRefund(original, plan.figures, currentDebt);
      const invoiceNumber = claim
        ? await claimInvoiceNumber(transaction, uid, { ...original, id: input.id, invoiceNumber: input.invoiceNumber })
        : input.invoiceNumber;

      const returnInvoice: Invoice = {
        id: input.id,
        invoiceNumber,
        type: 'return',
        date: Date.now(),
        currency: original.currency,
        customerName: original.customerName,
        customerId: original.customerId,
        paymentMethod: original.paymentMethod,
        vatRate: original.vatRate,
        items: plan.items,
        subtotal: plan.figures.subtotal,
        discount: plan.figures.discount,
        taxAmount: plan.figures.taxAmount,
        totalAmount: plan.figures.totalAmount,
        ...(plan.figures.debtAmount !== undefined ? { debtAmount: plan.figures.debtAmount, debtCurrency: original.debtCurrency } : {}),
        returnOf: original.id,
        returnOfNumber: original.invoiceNumber,
        returnReason: input.reason.trim(),
        refund,
        vaultPosted: refund.vault > 0,
      };

      const vaultPlan = planInvoiceVaultEntry(returnInvoice);
      if (vaultPlan) {
        const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
        const vaultSnap = await transaction.get(vaultStateRef);
        const { doc: updatedVault, balanceAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, vaultPlan.currency, -vaultPlan.amount);
        assertVaultCanCover(balanceAfter, vaultPlan.currency);
        transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
        const vaultRecordId = `inv-${input.id}`;
        transaction.set(doc(db, 'users', uid, 'vault_records', vaultRecordId),
          removeUndefined({ ...vaultPlan, id: vaultRecordId, timestamp: Date.now(), balanceAfter } as VaultTransaction));
      }

      if (refund.debt > 0 && customerRef && original.customerId) {
        const debtCurrency = refund.debtCurrency || (original.currency as Currency);
        const remaining = roundForCurrency(currentDebt - refund.debt, debtCurrency);
        transaction.update(customerRef, { totalDebt: remaining });
        const txId = `inv-${input.id}`;
        const entry: CustomerTransaction = {
          id: txId,
          transactionId: txId,
          customerId: original.customerId,
          type: 'payment',
          invoiceId: input.id,
          amount: refund.debt,
          currency: debtCurrency,
          exchangeRate: plan.figures.totalAmount > 0 ? refund.debt / plan.figures.totalAmount : 1,
          date: new Date().toISOString(),
          notes: `${opts.ar ? 'مرتجع مبيعات' : 'Sales return'} #${invoiceNumber} ${opts.ar ? 'عن الفاتورة' : 'for invoice'} #${original.invoiceNumber}`,
          remainingBalanceAfter: remaining,
        };
        transaction.set(doc(db, 'users', uid, 'customer_transactions', txId), removeUndefined(entry));
      }

      transaction.update(originalRef, { returnedQty: plan.returnedQty });
      transaction.set(returnRef, removeUndefined(returnInvoice));
      result = { status: 'saved', invoice: returnInvoice, missingProducts };
    });
    return result as unknown as SalesReturnResult;
  };

  const claim = invoiceNumberClaimsEnabled && !!input.invoiceNumber;
  try {
    return await run(claim);
  } catch (error: any) {
    if (!claim || error?.code !== 'collection-not-installed') throw error;
    throw Object.assign(
      new Error('Invoice numbering is not installed on the database. Run supabase_production_setup.sql.'),
      { code: 'collection-not-installed' },
    );
  }
}

/**
 * Sends goods back to the supplier in one atomic commit: stock out at what it cost, the supplier settles it
 * off what is owed (credit purchase) or in cash into the vault, and the returned quantities go on the purchase.
 * Refused when the goods are no longer in stock, so the return can never push stock below zero.
 */
async function commitPurchaseReturn(uid: string, input: SalesReturnInput, opts: CommitInvoiceOptions): Promise<SalesReturnResult> {
  const fail = (message: string, code: string, extra: object = {}) => Object.assign(new Error(message), { code, ...extra });
  let result: SalesReturnResult | null = null;
  await runTransaction(db, async (transaction) => {
    result = null;
    const returnRef = doc(db, 'users', uid, 'invoices', input.id);
    const existing = await transaction.get(returnRef);
    if (existing.exists()) {
      result = { status: 'duplicate', invoice: { ...(existing.data() as Invoice), id: input.id }, missingProducts: [] };
      return;
    }
    const originalRef = doc(db, 'users', uid, 'invoices', input.originalId);
    const originalSnap = await transaction.get(originalRef);
    if (!originalSnap.exists()) throw fail('Original invoice not found', 'not-found');
    const original = { ...(originalSnap.data() as Invoice), id: input.originalId };
    const planned = planPurchaseReturn(original, input.lines);
    if (!planned.ok) throw fail(`Return rejected: ${planned.error.code}`, 'return-invalid', { detail: planned.error });
    const { plan } = planned;
    const currency = original.currency as Currency;

    const costChanges: NonNullable<Invoice['costChanges']> = {};
    const returnedCost = returnedCostByProduct(original, plan.items);
    for (const [productId, { qty, description }] of quantitiesByProduct(plan.items)) {
      const productRef = doc(db, 'users', uid, 'inventory', productId);
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) {
        throw fail(`${PRODUCT_NOT_FOUND}: ${description || productId}`, 'product-not-found', { productName: description || productId });
      }
      const product = productSnap.data() as Product;
      const onHand = roundQty(Number(product.quantity) || 0);
      if (onHand < qty) {
        throw fail(`Insufficient stock for ${product.name}`, 'insufficient-stock', { productName: product.name, available: onHand, needed: qty });
      }
      const quantity = roundQty(onHand - qty);
      const newCost = costAfterReturn(product, qty, returnedCost.get(productId) || 0, currency, opts.defaultCurrency);
      if (newCost !== null) {
        const before = Number(product.unitCost ?? product.costPrice);
        costChanges[productId] = { before: Number.isFinite(before) ? before : 0, after: newCost };
      }
      transaction.update(productRef, {
        quantity,
        status: computeStockStatus(quantity, product.lowStockThreshold, opts.lowStockThreshold),
        ...(newCost !== null ? { unitCost: newCost } : {}),
      });
    }

    let supplierOwed = 0;
    let supplier: Supplier | null = null;
    const supplierRef = original.supplierId ? doc(db, 'users', uid, 'suppliers', original.supplierId) : null;
    if (original.paymentMethod === 'credit') {
      const supplierSnap = supplierRef ? await transaction.get(supplierRef) : null;
      if (!supplierSnap?.exists()) throw fail('Supplier not found', 'supplier-not-found');
      supplier = supplierSnap.data() as Supplier;
      supplierOwed = supplierBalance(supplier, currency);
    }
    const refund = splitPurchaseRefund(original, plan.figures, supplierOwed);

    const returnInvoice: Invoice = {
      id: input.id,
      invoiceNumber: input.invoiceNumber,
      type: 'purchase_return',
      date: Date.now(),
      currency: original.currency,
      supplierName: supplier?.name || original.supplierName,
      supplierId: original.supplierId,
      paymentMethod: original.paymentMethod,
      vatRate: original.vatRate,
      items: plan.items,
      subtotal: plan.figures.subtotal,
      discount: plan.figures.discount,
      taxAmount: plan.figures.taxAmount,
      totalAmount: plan.figures.totalAmount,
      returnOf: original.id,
      returnOfNumber: original.invoiceNumber,
      returnReason: input.reason.trim(),
      refund,
      vaultPosted: refund.vault > 0,
      ...(Object.keys(costChanges).length ? { costChanges } : {}),
    };

    const vaultPlan = planInvoiceVaultEntry(returnInvoice);
    if (vaultPlan) {
      const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
      const vaultSnap = await transaction.get(vaultStateRef);
      const { doc: updatedVault, balanceAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, vaultPlan.currency, vaultPlan.amount);
      transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
      const vaultRecordId = `inv-${input.id}`;
      transaction.set(doc(db, 'users', uid, 'vault_records', vaultRecordId),
        removeUndefined({ ...vaultPlan, id: vaultRecordId, timestamp: Date.now(), balanceAfter } as VaultTransaction));
    }

    if (refund.debt > 0 && supplier && supplierRef && original.supplierId) {
      const balances = withBalance(supplier.balances, currency, -refund.debt);
      transaction.update(supplierRef, { balances });
      const txId = `inv-${input.id}`;
      const entry: SupplierTransaction = {
        id: txId,
        supplierId: original.supplierId,
        type: 'return',
        amount: refund.debt,
        currency,
        invoiceId: input.id,
        date: Date.now(),
        notes: `${opts.ar ? 'مرتجع مشتريات' : 'Purchase return'} #${input.invoiceNumber} ${opts.ar ? 'عن الفاتورة' : 'for purchase'} #${original.invoiceNumber}`,
        balanceAfter: supplierBalance({ balances }, currency),
      };
      transaction.set(doc(db, 'users', uid, 'supplier_transactions', txId), removeUndefined(entry));
    }

    transaction.update(originalRef, { returnedQty: plan.returnedQty });
    transaction.set(returnRef, removeUndefined(returnInvoice));
    result = { status: 'saved', invoice: returnInvoice, missingProducts: [] };
  });
  return result as unknown as SalesReturnResult;
}

/**
 * Applies an invoice (stock, vault, document) in one atomic commit. Idempotent by invoice id:
 * an invoice that already exists is never applied twice, so retries and replays are safe.
 */
async function commitInvoice(uid: string, invoice: Invoice, opts: CommitInvoiceOptions): Promise<CommitInvoiceResult> {
  const claim = invoiceNumberClaimsEnabled
    && (invoice.type === 'sale' || invoice.type === 'purchase')
    && !!invoice.invoiceNumber;
  try {
    return await commitInvoiceOnce(uid, invoice, opts, claim);
  } catch (error: any) {
    if (!claim || error?.code !== 'collection-not-installed') throw error;
    // Fail closed: unique invoice numbers require supabase_production_setup.sql.
    throw Object.assign(
      new Error('Invoice numbering is not installed on the database. Run supabase_production_setup.sql.'),
      { code: 'collection-not-installed' },
    );
  }
}

async function commitInvoiceOnce(uid: string, requested: Invoice, opts: CommitInvoiceOptions, claim: boolean): Promise<CommitInvoiceResult> {
  let result: CommitInvoiceResult = { status: 'saved', negativeStock: [], invoiceNumber: requested.invoiceNumber };
  await runTransaction(db, async (transaction) => {
    result = { status: 'saved', negativeStock: [], invoiceNumber: requested.invoiceNumber };
    const invoiceRef = doc(db, 'users', uid, 'invoices', requested.id);
    const existing = await transaction.get(invoiceRef);
    if (existing.exists()) {
      const stored = existing.data() as Invoice;
      result = { status: 'duplicate', negativeStock: [], invoiceNumber: stored?.invoiceNumber || requested.invoiceNumber };
      return;
    }
    const invoice: Invoice = claim
      ? { ...requested, invoiceNumber: await claimInvoiceNumber(transaction, uid, requested) }
      : requested;
    result.invoiceNumber = invoice.invoiceNumber;

    const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
    const vaultSnap = await transaction.get(vaultStateRef);
    const currentVaultData = vaultSnap.exists() ? vaultSnap.data() : {};

    // One stock check per product, even if it appears on several lines.
    const qtyByProduct = quantitiesByProduct(invoice.items);
    const productsRead = new Map<string, Product>();
    const costChanges: NonNullable<Invoice['costChanges']> = {};
    // An invoice-level discount on a purchase lowers what each line really cost, in proportion to the line.
    const linesTotal = invoice.items.reduce((sum, i) => sum + (Number(i.total) || 0), 0);
    const purchaseDiscount = invoice.type === 'purchase' ? Math.min(Math.max(Number(invoice.discount) || 0, 0), linesTotal) : 0;
    const costScale = purchaseDiscount > 0 && linesTotal > 0 ? (linesTotal - purchaseDiscount) / linesTotal : 1;
    const productEntries = [...qtyByProduct.entries()];
    const productRefs = productEntries.map(([productId]) => doc(db, 'users', uid, 'inventory', productId));
    // Batched OCC reads — one round-trip for the whole cart instead of one per SKU.
    const productSnaps = productRefs.length
      ? await transaction.getMany(productRefs)
      : [];
    for (let i = 0; i < productEntries.length; i += 1) {
      const [productId, { qty: movedQty, description }] = productEntries[i];
      const productRef = productRefs[i];
      const productSnap = productSnaps[i];
      if (!productSnap.exists()) {
        if (opts.allowMissingProducts && invoice.type === 'sale') {
          (result.missingProducts ||= []).push(description || productId);
          continue;
        }
        throw Object.assign(new Error(`${PRODUCT_NOT_FOUND}: ${description || productId}`), { code: 'product-not-found', productName: description || productId });
      }
      const productData = { ...(productSnap.data() as Product), id: productId };
      productsRead.set(productId, productData);
      const currentQty = roundQty(Number(productData.quantity) || 0);
      if (invoice.type === 'sale' && currentQty < movedQty) {
        if (!opts.allowNegativeStock) {
          throw Object.assign(new Error(`Insufficient stock for ${productData.name}. Available: ${currentQty}`), {
            code: 'insufficient-stock', productName: productData.name, available: currentQty,
          });
        }
        result.negativeStock.push(productData.name);
      }
      const newQuantity = roundQty(invoice.type === 'sale' ? currentQty - movedQty : currentQty + movedQty);
      const productCurrency = productData.currency || opts.defaultCurrency;
      let newCost: number | null = null;
      let adoptPurchaseCurrency = false;
      if (invoice.type === 'purchase') {
        const receivedTotal = invoice.items
          .filter((line) => line.productId === productId)
          .reduce((sum, line) => sum + (Number(line.total) || 0), 0) * costScale;
        newCost = weightedAverageCost(productData, movedQty, receivedTotal, invoice.currency, opts.defaultCurrency);
        if (newCost === null && productCurrency !== invoice.currency && currentQty > 0 && (Number(productData.unitCost ?? productData.costPrice) || 0) > 0) {
          throw Object.assign(
            new Error(`Purchase currency ${invoice.currency} differs from product cost currency ${productCurrency} for ${productData.name}`),
            { code: 'currency-mismatch', productName: productData.name },
          );
        }
        adoptPurchaseCurrency = productCurrency !== invoice.currency && newCost !== null;
      }
      if (newCost !== null) {
        const before = Number(productData.unitCost ?? productData.costPrice);
        costChanges[productId] = { before: Number.isFinite(before) ? before : 0, after: newCost };
      }
      transaction.update(productRef, {
        quantity: newQuantity,
        status: computeStockStatus(newQuantity, productData.lowStockThreshold, opts.lowStockThreshold),
        ...(newCost !== null ? { unitCost: newCost } : {}),
        ...(adoptPurchaseCurrency ? { currency: invoice.currency } : {}),
      });
    }
    // Credit, card and wallet invoices don't touch the cash vault.
    const plan = planInvoiceVaultEntry(invoice);
    const invoiceToWrite: Invoice = {
      ...invoice,
      ...(invoice.type === 'sale' ? { items: snapshotLineCosts(invoice.items, productsRead, opts.defaultCurrency) } : {}),
      ...(Object.keys(costChanges).length ? { costChanges } : {}),
      vaultPosted: !!plan,
    };

    if (plan) {
      const { doc: updatedVault, balanceAfter } = applyVaultDelta(
        currentVaultData, plan.currency, plan.type === 'income' ? plan.amount : -plan.amount);
      if (plan.type === 'expense') assertVaultCanCover(balanceAfter, plan.currency);
      transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
      const vaultRecordId = `inv-${invoice.id}`;
      const vaultRecordRef = doc(db, 'users', uid, 'vault_records', vaultRecordId);
      const vaultRecord: VaultTransaction = { ...plan, id: vaultRecordId, timestamp: Date.now(), balanceAfter };
      transaction.set(vaultRecordRef, removeUndefined(vaultRecord));
    }

    // A credit sale and its customer debt are one write: neither can exist without the other.
    // Split tender: vault already took `paid`; only the unpaid slice goes on the customer.
    if (invoice.type === 'sale' && invoice.paymentMethod === 'credit') {
      if (!invoice.customerId) {
        throw Object.assign(new Error('Credit sales need a registered customer'), { code: 'customer-required' });
      }
      const { paid, owed } = salePayment(invoice);
      invoiceToWrite.paidAmount = paid;
      if (owed > 0) {
        const customerRef = doc(db, 'users', uid, 'customers', invoice.customerId);
        const customerSnap = await transaction.get(customerRef);
        if (!customerSnap.exists()) {
          throw Object.assign(new Error('Customer not found'), { code: 'customer-not-found' });
        }
        const customer = customerSnap.data() as Customer;
        const debtCurrency = (customer.currency || invoice.currency) as Currency;
        const debtAmount = invoice.debtCurrency === debtCurrency && Number.isFinite(invoice.debtAmount)
          ? Number(invoice.debtAmount)
          : debtCurrency === invoice.currency ? owed : null;
        if (debtAmount === null) {
          throw Object.assign(new Error('Customer currency changed; reopen the invoice'), { code: 'customer-currency-changed' });
        }
        if (!(debtAmount > 0)) {
          throw Object.assign(new Error('Credit remainder must be positive'), { code: 'debt-invalid' });
        }
        const remaining = roundForCurrency((Number(customer.totalDebt) || 0) + debtAmount, debtCurrency);
        transaction.update(customerRef, { totalDebt: remaining });
        const txId = `inv-${invoice.id}`;
        const ledgerEntry: CustomerTransaction = {
          id: txId,
          transactionId: txId,
          customerId: invoice.customerId,
          type: 'invoice',
          invoiceId: invoice.id,
          amount: debtAmount,
          currency: debtCurrency,
          exchangeRate: owed > 0 ? debtAmount / owed : 1,
          date: new Date(invoice.date || Date.now()).toISOString(),
          notes: paid > 0
            ? `${opts.ar ? 'بيع نقد+آجل' : 'Cash + credit sale'} #${invoice.invoiceNumber}`
            : `${opts.ar ? 'فاتورة بيع آجل' : 'Credit sale'} #${invoice.invoiceNumber}`,
          remainingBalanceAfter: remaining,
        };
        transaction.set(doc(db, 'users', uid, 'customer_transactions', txId), removeUndefined(ledgerEntry));
        invoiceToWrite.debtAmount = debtAmount;
        invoiceToWrite.debtCurrency = debtCurrency;
      }
    }

    // The unpaid part of a credit purchase is owed to the supplier in the purchase currency, in the same write.
    if (invoice.type === 'purchase' && invoice.paymentMethod === 'credit') {
      if (!invoice.supplierId) {
        throw Object.assign(new Error('Credit purchases need a registered supplier'), { code: 'supplier-required' });
      }
      const supplierRef = doc(db, 'users', uid, 'suppliers', invoice.supplierId);
      const supplierSnap = await transaction.get(supplierRef);
      if (!supplierSnap.exists()) {
        throw Object.assign(new Error('Supplier not found'), { code: 'supplier-not-found' });
      }
      const supplier = supplierSnap.data() as Supplier;
      const currency = invoice.currency as Currency;
      const { paid, owed } = purchasePayment(invoice);
      invoiceToWrite.paidAmount = paid;
      invoiceToWrite.supplierName = supplier.name;
      if (owed > 0) {
        const balances = withBalance(supplier.balances, currency, owed);
        transaction.update(supplierRef, { balances });
        const txId = `inv-${invoice.id}`;
        const entry: SupplierTransaction = {
          id: txId,
          supplierId: invoice.supplierId,
          type: 'purchase',
          amount: owed,
          currency,
          invoiceId: invoice.id,
          date: Number(invoice.date) || Date.now(),
          notes: `${opts.ar ? 'فاتورة شراء آجل' : 'Credit purchase'} #${invoice.invoiceNumber}`,
          balanceAfter: supplierBalance({ balances }, currency),
        };
        transaction.set(doc(db, 'users', uid, 'supplier_transactions', txId), removeUndefined(entry));
      }
    }

    transaction.set(invoiceRef, removeUndefined(invoiceToWrite));
  });
  return result;
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const lastUidRef = useRef<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(currentWorkspace());
  const [platformRole, setPlatformRole] = useState<{ uid: string; role: PlatformRole | null } | null>(null);
  const [platformRoleReady, setPlatformRoleReady] = useState(false);
  const latestSettingsRef = useRef<AppSettings | null>(null);
  latestSettingsRef.current = settings;
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerTransactions, setCustomerTransactions] = useState<CustomerTransaction[]>([]);
  const [vaultTransactions, setVaultTransactions] = useState<VaultTransaction[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierTransactions, setSupplierTransactions] = useState<SupplierTransaction[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [vault, setVault] = useState<Vault | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const resetLocalBusinessState = () => {
    setProducts([]);
    setInvoices([]);
    setEmployees([]);
    setPayrollRecords([]);
    setCustomers([]);
    setCustomerTransactions([]);
    setVaultTransactions([]);
    setStockMovements([]);
    setSuppliers([]);
    setSupplierTransactions([]);
    setShifts([]);
    setWarehouses([]);
    setVault(null);
    setAuditLogs([]);
    setSettings(null);
  };

  useEffect(() => {
    // Map Supabase user to a firebase-like shape expected across the app
    const mapSessionUser = (sbSession: any) => {
      const sbUser = sbSession?.user;
      if (!sbUser) return null;
      return {
        uid: sbUser.id,
        email: sbUser.email,
        email_confirmed_at: sbUser.email_confirmed_at || null,
        displayName: sbUser.user_metadata?.full_name || sbUser.user_metadata?.name || (sbUser.email || '').split('@')[0],
        isAnonymous: false,
        providerData: sbUser.identities ? sbUser.identities.map((id: any) => ({ providerId: id.provider, email: sbUser.email })) : [{ providerId: 'supabase', email: sbUser.email }]
      } as any;
    };

    // Initialize with current session (if any) with defensive validation
    (async () => {
      try {
        const returnedFromGoogle = urlLooksLikeOAuthCallback();
        const driveError = isDriveConnectPending() ? oauthProviderError(window.location.href) : null;
        if (driveError) {
          clearDriveConnect();
          toast.error(document.documentElement.dir === 'ltr'
            ? `Google Drive was not connected: ${driveError}`
            : `لم يتم ربط Google Drive: ${driveError}`);
        }
        if (returnedFromGoogle) {
          try {
            await completeOAuthSessionFromLocation();
          } catch (oauthError) {
            console.warn('[FirebaseProvider] OAuth return could not be completed:', oauthError);
            toast.error(
              typeof document !== 'undefined' && document.documentElement.dir === 'ltr'
                ? 'Google sign-in returned, but the session could not be saved. Try again.'
                : 'عاد Google لكن تعذر حفظ الجلسة. حاول مرة أخرى.'
            );
          }
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        let session = data?.session;
        if (session && (await finishDriveConnect(session, returnedFromGoogle)) === 'wrong-account') {
          session = (await supabase.auth.getSession()).data.session;
        }

        // Offline with an expired token: Supabase keeps the stored session but cannot refresh it.
        // Keep the merchant signed in on this device; writes go to the offline queue until it refreshes.
        if (!session && (isOfflineError(sessionError) || (typeof navigator !== 'undefined' && navigator.onLine === false))) {
          session = readStoredSession();
        }

        if (session && session.access_token) {
          const mapped = mapSessionUser(session);
          if (mapped) {
            lastUidRef.current = mapped.uid;
            setUser((prev) => (prev && prev.uid === mapped.uid ? prev : wrapUserWithId(mapped as any)));
          } else {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } catch (e) {
        console.warn('[FirebaseProvider] Supabase initial session check failed:', e);
        const mapped = isOfflineError(e) ? mapSessionUser(readStoredSession()) : null;
        if (mapped) lastUidRef.current = mapped.uid;
        setUser(mapped ? wrapUserWithId(mapped as any) : null);
      } finally {
        setLoading(false);
      }
    })();

    // Subscribe to future auth state changes from Supabase
    // IMPORTANT: Supabase holds its auth lock while this callback runs. Awaiting network calls
    // here would block every other supabase request (getSession, queries...) and freeze the app,
    // so the real work is deferred with setTimeout.
    // INITIAL_SESSION often arrives empty while Google PKCE is still exchanging ?code=.
    // Treating that as a logout sent users back to the login screen after a successful browser return.
    const { data } = supabase.auth.onAuthStateChange((event: any, session: any) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
      setTimeout(async () => {
        if (event === 'INITIAL_SESSION') return;

        if (session && session.access_token) {
          // A Google account other than the store's came back from "connect Drive": the store session is being restored.
          if ((await finishDriveConnect(session)) === 'wrong-account') return;
          const mapped = mapSessionUser(session);
          if (mapped) {
            if (lastUidRef.current && lastUidRef.current !== mapped.uid) {
              // Another account signed in without a sign-out (e.g. a reset link): drop the previous books first.
              resetSync();
              resetLocalBusinessState();
            }
            lastUidRef.current = mapped.uid;
            setUser((prev) => (prev && prev.uid === mapped.uid ? prev : wrapUserWithId(mapped as any)));
          }
          return;
        }

        if (event !== 'SIGNED_OUT' && event !== 'USER_DELETED') return;

        clearUserCache(lastUidRef.current);
        lastUidRef.current = null;
        resetSync();
        clearDriveConnect();
        setDriveAccessToken('');
        setUser(null);
        setLoading(false);
        resetLocalBusinessState();
      }, 0);
    });

    const subscription = data?.subscription;
    return () => {
      try { subscription?.unsubscribe(); } catch (e) {}
    };
  }, []);

  useEffect(() => subscribeWorkspace(setWorkspace), []);

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    let known: string | null = null;
    const key = (ws: Workspace) => `${ws.ownerId}:${ws.role}`;
    void ensureWorkspace(uid).then((ws) => { known = key(ws); }, () => undefined);
    // Another device may add, remove or re-role this account; its books must never mix with another store's.
    const recheck = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void refreshWorkspace(uid).then((ws) => {
        if (ws.source !== 'server' || ws.userId !== uid) return;
        if (known && key(ws) !== known) {
          clearUserCache(uid);
          window.location.reload();
          return;
        }
        known = key(ws);
      }, () => undefined);
    };
    window.addEventListener('online', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      window.removeEventListener('online', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const uid = user.uid;
    lastUidRef.current = uid;
    migrateLegacyUserCache(uid);
    const bootQueue = readQueue(uid);
    setSettings(readUserCache(uid, 'settings', null));
    setProducts(applyQueuedSalesToProducts(readUserCache(uid, 'products', []), bootQueue));
    setInvoices(mergeQueuedInvoices(readUserCache(uid, 'invoices', []), bootQueue));
    setEmployees(readUserCache(uid, 'employees', []));
    setPayrollRecords(readUserCache(uid, 'payroll', []));
    setCustomers(readUserCache(uid, 'customers', []));
    setCustomerTransactions(readUserCache(uid, 'customer_transactions', []));
    setSuppliers(readUserCache(uid, 'suppliers', []));
    setSupplierTransactions(readUserCache(uid, 'supplier_transactions', []));
    setShifts(readUserCache(uid, 'shifts', []));
    setOrders(readUserCache(uid, 'orders', []));
    const bootVault = readUserCache(uid, 'vault', null);
    setVaultTransactions(mergeQueuedVaultRecords(readUserCache(uid, 'vault_records', []), bootQueue, undefined, bootVault));
    setWarehouses(readUserCache(uid, 'warehouses', []));
    setVault(applyQueuedSalesToVault(bootVault, bootQueue) as Vault | null);
    setAuditLogs(readUserCache(uid, 'audit_logs', []));
    let isMounted = true;
    const onSyncProblem = (event: Event) => {
      const message = syncRejectionMessage((event as CustomEvent<string>).detail);
      if (message && isMounted) toast.error(message, { id: 'sync-problem', duration: 10000 });
    };
    window.addEventListener(SYNC_PROBLEM_EVENT, onSyncProblem);

    // Safety timeout of 3.5 seconds to guarantee that the loading state is never stuck
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn("[FirebaseProvider] Safety timeout triggered. Guaranteeing loading state resolved.");
        setLoading(false);
      }
    }, 3500);

    // Helper to synchronize user profiles & trial entries to Supabase DB so they appear instantly in Admin Dashboard
    const syncProfileToSupabase = async (
      userId: string,
      emailVal: string,
      nameVal: string,
      businessVal: string,
      langVal: string
    ) => {
      if (!emailVal) return;
      try {
        const sbUserId = userId;

        // role, is_premium and subscription_status are server-owned; the client only names its profile.
        const profileData: any = {
          id: sbUserId,
          user_name: nameVal || emailVal.split('@')[0] || 'System User',
          business_name: businessVal || 'Main Warehouse',
          default_language: langVal || 'ar',
          updated_at: new Date().toISOString()
        };

        // Try to update with email fields as well, fallback if columns don't exist
        try {
          const payload = { ...profileData, user_email: emailVal, email: emailVal };
          const { error } = await supabase
            .from('profiles')
            .upsert(payload, { onConflict: 'id' });

          if (error) {
            // Fallback: try upsert with only standard fields
            await supabase
              .from('profiles')
              .upsert(profileData, { onConflict: 'id' });
          }
        } catch (e) {
          await supabase
            .from('profiles')
            .upsert(profileData, { onConflict: 'id' });
        }

        // 3. Subscription Trial structure double checking
        const { data: existingSub } = await supabase
          .from('user_subscriptions')
          .select('user_id')
          .eq('user_id', sbUserId)
          .maybeSingle();

        if (!existingSub) {
          await supabase
            .from('user_subscriptions')
            .insert({ user_id: sbUserId, subscription_status: 'trial' });
        }
      } catch (err) {
        console.warn('[FirebaseProvider] Supabase replication sync warning:', err);
      }
    };

    // Proactive background sync as soon as session starts to ensure they show up in subscribers/admin instantly
    if (user.email) {
      syncProfileToSupabase(
        uid,
        user.email,
        user.displayName || user.email.split('@')[0],
        'مستودعي',
        'ar'
      );
    }

    // Listen to Settings
    const settingsRef = doc(db, 'users', uid, 'settings', 'profile');
    const unsubscribeSettings = onSnapshot(settingsRef, (snap) => {
      if (!isMounted) return;
      if (snap.exists()) {
        const snapData = withMemberPreferences(uid, snap.data() as AppSettings);
        setSettings(snapData);
        try {
          writeUserCache(uid, 'settings', snapData);
        } catch (e) {
          console.error("Local caching failed", e);
        }
        if (isMember()) return;

        // Trigger safe reactive sync to Supabase database
        syncProfileToSupabase(
          uid,
          user.email || '',
          snapData.userName || user.displayName || '',
          snapData.businessName || '',
          snapData.defaultLanguage || 'ar'
        );

        // Auto-Repair: If userName is empty or blank, resolve and write the correct name
        if (!snapData.userName) {
            const repairUserName = async () => {
            let finalUserName = user.displayName || '';
            try {
              const { data: { session: sbSession } } = await supabase.auth.getSession();
              if (sbSession?.user?.user_metadata) {
                finalUserName = sbSession.user.user_metadata.full_name || sbSession.user.user_metadata.name || finalUserName;
              }
            } catch (err) {}
            if (!finalUserName) {
              finalUserName = user.email ? user.email.split('@')[0] : '';
            }
            if (finalUserName && isMounted) {
              await updateDoc(settingsRef, { userName: finalUserName }).catch(() => {});
            }
          };
          repairUserName();
        }
      } else if (!isMember()) {
        // Initial defaults if none exist
        const writeDefaults = async () => {
          let finalUserName = user.displayName || '';
          try {
            const { data: { session: sbSession } } = await supabase.auth.getSession();
            if (sbSession?.user?.user_metadata) {
              finalUserName = sbSession.user.user_metadata.full_name || sbSession.user.user_metadata.name || finalUserName;
            }
          } catch (err) {
            console.warn("[FirebaseProvider] Error resolving Supabase metadata:", err);
          }

          if (!finalUserName) {
            finalUserName = user.email ? user.email.split('@')[0] : 'مدير النظام';
          }

          const defaults: AppSettings = {
            userName: finalUserName,
            businessName: 'مستودعي',
            defaultVatRate: 16,
            defaultCustomsDuty: 5,
            defaultLanguage: 'ar', 
            enableAnimations: true,
            aiVerbosity: 'detailed',
            theme: 'modern',
            darkMode: false,
            currency: 'JOD',
            useManualExchangeRates: false,
            exchangeRateUSD_ILS: 3.70,
            exchangeRateJOD_ILS: 5.22,
            exchangeRateJOD_USD: 1.41
          };
          
          if (isMounted) {
            await setDoc(settingsRef, defaults).catch(e => console.error("Error setting defaults", e));
            // Trigger safe reactive sync to Supabase database for new profiles
            syncProfileToSupabase(
              uid,
              user.email || '',
              defaults.userName,
              defaults.businessName,
              defaults.defaultLanguage
            );
          }
        };

        writeDefaults();
      }
    }, (error) => {
      console.error(`[FirebaseProvider] Settings stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/settings/profile`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Inventory
    const inventoryRef = collection(db, 'users', uid, 'inventory');
    const unsubscribeInventory = onSnapshot(inventoryRef, (snap) => {
      if (!isMounted) return;
      const items: Product[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as Product));
      // Cache the server snapshot only. Queue deductions are applied for display, never persisted
      // into the cache — otherwise a reload would subtract the same offline sales twice.
      const merged = applyQueuedSalesToProducts(items, readQueue(uid), currentWorkspace()?.ownerId);
      setProducts(merged);
      try {
        writeUserCache(uid, 'products', items);
      } catch (e) {
        console.error("Local caching for inventory failed", e);
      }
      setLoading(false);
    }, (error) => {
      console.error(`[FirebaseProvider] Inventory stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/inventory`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Invoices
    const invoicesRef = collection(db, 'users', uid, 'invoices');
    const unsubscribeInvoices = onSnapshot(invoicesRef, (snap) => {
      if (!isMounted) return;
      const items: Invoice[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as Invoice));
      const sorted = mergeQueuedInvoices(items.sort((a,b) => b.date - a.date), readQueue(uid), currentWorkspace()?.ownerId);
      setInvoices(sorted);
      writeUserCache(uid, 'invoices', sorted);
    }, (error) => {
      console.error(`[FirebaseProvider] Invoices stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/invoices`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Employees
    const employeesRef = collection(db, 'users', uid, 'employees');
    const unsubscribeEmployees = onSnapshot(employeesRef, (snap) => {
      if (!isMounted) return;
      const items: Employee[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as Employee));
      setEmployees(items);
      writeUserCache(uid, 'employees', items);
    }, (error) => {
      console.error(`[FirebaseProvider] Employees stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/employees`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Payroll Records
    const payrollRef = collection(db, 'users', uid, 'payroll');
    const unsubscribePayroll = onSnapshot(payrollRef, (snap) => {
      if (!isMounted) return;
      const items: PayrollRecord[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as PayrollRecord));
      const sorted = items.sort((a, b) => b.paymentDate - a.paymentDate);
      setPayrollRecords(sorted);
      writeUserCache(uid, 'payroll', sorted);
    }, (error) => {
      console.error(`[FirebaseProvider] Payroll stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/payroll`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Customers
    const customersRef = collection(db, 'users', uid, 'customers');
    const unsubscribeCustomers = onSnapshot(customersRef, (snap) => {
      if (!isMounted) return;
      const items: Customer[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as Customer));
      const sorted = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setCustomers(sorted);
      writeUserCache(uid, 'customers', sorted);
    }, (error) => {
      console.error(`[FirebaseProvider] Customers stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/customers`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Customer Transactions
    const customerTransactionsRef = collection(db, 'users', uid, 'customer_transactions');
    const unsubscribeCustomerTransactions = onSnapshot(customerTransactionsRef, (snap) => {
      if (!isMounted) return;
      const items: CustomerTransaction[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as CustomerTransaction));
      const sorted = items.sort((a, b) => b.date.localeCompare(a.date));
      setCustomerTransactions(sorted);
      writeUserCache(uid, 'customer_transactions', sorted);
    }, (error) => {
      console.error(`[FirebaseProvider] CustomerTransactions stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/customer_transactions`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to manual stock movements (non-critical: a failure here must never block the app)
    const stockMovementsRef = collection(db, 'users', uid, 'stock_movements');
    const unsubscribeStockMovements = onSnapshot(stockMovementsRef, (snap) => {
      if (!isMounted) return;
      const items: StockMovement[] = [];
      snap.forEach(d => items.push({ ...d.data() } as StockMovement));
      setStockMovements(items.sort((a, b) => b.timestamp - a.timestamp));
    }, (error) => {
      console.warn('[FirebaseProvider] stock_movements stream error (rules not deployed?):', error?.code || error);
    });

    // Suppliers (non-critical: missing until supabase_production_setup.sql is re-run)
    const unsubscribeSuppliers = onSnapshot(collection(db, 'users', uid, 'suppliers'), (snap) => {
      if (!isMounted) return;
      const items: Supplier[] = [];
      snap.forEach(d => items.push({ ...d.data() } as Supplier));
      const sorted = items.sort((a, b) => a.name.localeCompare(b.name));
      setSuppliers(sorted);
      writeUserCache(uid, 'suppliers', sorted);
    }, (error) => {
      console.warn('[FirebaseProvider] suppliers stream error:', error?.code || error);
    });
    const unsubscribeSupplierTransactions = onSnapshot(collection(db, 'users', uid, 'supplier_transactions'), (snap) => {
      if (!isMounted) return;
      const items: SupplierTransaction[] = [];
      snap.forEach(d => items.push({ ...d.data() } as SupplierTransaction));
      const sorted = items.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
      setSupplierTransactions(sorted);
      writeUserCache(uid, 'supplier_transactions', sorted);
    }, (error) => {
      console.warn('[FirebaseProvider] supplier_transactions stream error:', error?.code || error);
    });
    // Shifts (non-critical: missing until supabase_production_setup.sql is re-run)
    const unsubscribeShifts = onSnapshot(collection(db, 'users', uid, 'shifts'), (snap) => {
      if (!isMounted) return;
      const items: Shift[] = [];
      snap.forEach(d => items.push({ ...d.data() } as Shift));
      const sorted = items.sort((a, b) => (Number(b.openedAt) || 0) - (Number(a.openedAt) || 0));
      setShifts(sorted);
      writeUserCache(uid, 'shifts', sorted);
    }, (error) => {
      console.warn('[FirebaseProvider] shifts stream error:', error?.code || error);
    });
    // Orders (non-critical: missing until supabase_production_setup.sql is re-run)
    const unsubscribeOrders = onSnapshot(collection(db, 'users', uid, 'orders'), (snap) => {
      if (!isMounted) return;
      const items: TradeOrder[] = [];
      snap.forEach(d => items.push({ ...d.data() } as TradeOrder));
      const sorted = items.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0) || String(b.number).localeCompare(String(a.number)));
      setOrders(sorted);
      writeUserCache(uid, 'orders', sorted);
    }, (error) => {
      console.warn('[FirebaseProvider] orders stream error:', error?.code || error);
    });

    // Listen to Vault Transactions
    const vaultRef = collection(db, 'users', uid, 'vault_records');
    const unsubscribeVaultTransactions = onSnapshot(vaultRef, (snap) => {
      if (!isMounted) return;
      const items: VaultTransaction[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as VaultTransaction));
      const serverRows = items.sort((a, b) => b.timestamp - a.timestamp);
      const sorted = mergeQueuedVaultRecords(
        serverRows,
        readQueue(uid),
        currentWorkspace()?.ownerId,
        // Prefer live vault state when present; otherwise the last server vault cache.
        vault || readUserCache(uid, 'vault', null),
      );
      setVaultTransactions(sorted);
      // Cache server rows only — boot merges the queue once.
      writeUserCache(uid, 'vault_records', serverRows);
    }, (error) => {
      console.error(`[FirebaseProvider] VaultTransactions stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/vault_records`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Vault State
    const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
    const unsubscribeVaultState = onSnapshot(vaultStateRef, (snap) => {
      if (!isMounted) return;
      if (snap.exists()) {
        const snapData = snap.data();
        const serverVault = buildVaultDoc(readVaultBalances(snapData), snapData.lastUpdated || Date.now());
        const stateObj = applyQueuedSalesToVault(
          serverVault,
          readQueue(uid),
          currentWorkspace()?.ownerId,
        ) as Vault;
        setVault(stateObj);
        // Persist the server vault only; boot re-applies the offline queue once.
        writeUserCache(uid, 'vault', serverVault);
      } else {
        const defaultVault = buildVaultDoc(readVaultBalances({}));
        setDoc(vaultStateRef, defaultVault).catch(e => console.error("Error initializing vault", e));
      }
    }, (error) => {
      console.error(`[FirebaseProvider] VaultState stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/settings/vault`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Warehouses
    const warehousesRef = collection(db, 'users', uid, 'warehouses');
    const unsubscribeWarehouses = onSnapshot(warehousesRef, (snap) => {
      if (!isMounted) return;
      const items: Warehouse[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as Warehouse));
      const sorted = items.sort((a,b) => b.createdAt - a.createdAt);
      setWarehouses(sorted);
      writeUserCache(uid, 'warehouses', sorted);
    }, (error) => {
      console.error(`[FirebaseProvider] Warehouses stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/warehouses`);
      } catch (e) {
        console.error(e);
      }
    });

    // Listen to Audit Logs
    const auditLogsRef = collection(db, 'users', uid, 'audit_logs');
    const unsubscribeAuditLogs = onSnapshot(auditLogsRef, (snap) => {
      if (!isMounted) return;
      const items: AuditLog[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as AuditLog));
      const sorted = items.sort((a,b) => b.timestamp - a.timestamp);
      setAuditLogs(sorted);
      writeUserCache(uid, 'audit_logs', sorted);
    }, (error) => {
      console.error(`[FirebaseProvider] AuditLogs stream error:`, error);
      if (isMounted) setLoading(false);
      try {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/audit_logs`);
      } catch (e) {
        console.error(e);
      }
    });

    // Sends sales taken offline. Idempotent: an invoice that already reached the server is skipped.
    let syncing = false;
    const syncOfflineInvoices = async () => {
      if (syncing || !isMounted) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const store = currentWorkspace();
      if (!store || store.userId !== uid) return;
      if (readQueue(uid).length === 0) return;
      syncing = true;
      const current = latestSettingsRef.current;
      const ar = current?.defaultLanguage !== 'en';
      const negative = new Set<string>();
      const missing = new Set<string>();
      const needsReview: string[] = [];
      let otherStore = 0;
      let sent = 0;
      try {
        await withQueueLock(uid, async () => {
          const queue = readQueue(uid);
          if (queue.length === 0) return;
          const remaining: QueuedInvoice[] = [];
          for (let i = 0; i < queue.length; i++) {
            let entry = queue[i];
            // Pre-storeId queue rows: only the store owner may claim them into this store.
            if (!entry.storeId && uid === store.ownerId) {
              entry = { ...entry, storeId: store.ownerId };
            }
            if (!belongsToStore(entry, store.ownerId)) {
              remaining.push(entry);
              otherStore += 1;
              continue;
            }
            try {
              const r = await commitInvoice(uid, entry.invoice, {
                lowStockThreshold: current?.lowStockThreshold,
                defaultCurrency: current?.currency || 'JOD',
                // Fail closed: conflicted offline sales stay queued for review, not negative stock.
                allowNegativeStock: false,
                allowMissingProducts: false,
                ar: current?.defaultLanguage !== 'en',
              });
              sent += 1;
              r.negativeStock.forEach((name) => negative.add(name));
              r.missingProducts?.forEach((name) => missing.add(name));
            } catch (err: any) {
              if (canDeferSaleToQueue(err)) {
                remaining.push(...queue.slice(i));
                break;
              }
              if (err?.code === 'insufficient-stock' || err?.code === 'product-not-found') {
                remaining.push({ ...entry, attempts: entry.attempts + 1, lastError: String(err?.message || err) });
                needsReview.push(entry.invoice.invoiceNumber);
                if (err?.code === 'insufficient-stock' && err?.productName) negative.add(String(err.productName));
                if (err?.code === 'product-not-found' && err?.productName) missing.add(String(err.productName));
                continue;
              }
              remaining.push({ ...entry, attempts: entry.attempts + 1, lastError: String(err?.message || err) });
              needsReview.push(entry.invoice.invoiceNumber);
            }
          }
          const processed = new Set(queue.map((q) => q.invoice.id));
          const addedMeanwhile = readQueue(uid).filter((q) => !processed.has(q.invoice.id));
          writeQueue(uid, [...remaining, ...addedMeanwhile]);
        }, { required: true });
      } catch (err: any) {
        if (err?.code !== 'queue-locked') console.warn('[offline sync] unexpected error:', err);
      } finally {
        syncing = false;
      }
      if (!isMounted) return;
      if (sent > 0) {
        toast.success(ar ? `أُرسلت ${sent} عملية بيع حُفظت أثناء انقطاع الاتصال.` : `${sent} sale(s) taken offline were sent.`);
      }
      if (negative.size > 0) {
        toast.error(ar
          ? `مبيعات محفوظة بلا اتصال لم تُرسل لأن المخزون غير كافٍ. راجع الجرد ثم أعد المحاولة: ${Array.from(negative).join('، ')}`
          : `Queued offline sales were not sent — insufficient stock. Recount, then retry: ${Array.from(negative).join(', ')}`, { duration: 12000 });
      }
      if (missing.size > 0) {
        toast.error(ar
          ? `مبيعات محفوظة بلا اتصال لم تُرسل لأن الصنف لم يعد في المخزون: ${Array.from(missing).join('، ')}`
          : `Queued offline sales were not sent — product no longer in inventory: ${Array.from(missing).join(', ')}`, { duration: 12000 });
      }
      if (otherStore > 0) {
        toast.error(ar
          ? `على هذا الجهاز ${otherStore} عملية بيع أُخذت في متجر لم يعد هذا الحساب عضواً فيه، فلم تُرسل إلى المتجر الحالي. تواصل مع صاحب ذلك المتجر لتسجيلها.`
          : `${otherStore} sale(s) on this device were taken in a store this account no longer belongs to, so they were not sent to the current store. Ask that store's owner to record them.`,
          { id: 'offline-other-store', duration: 15000 });
      }
      if (needsReview.length > 0) {
        toast.error(ar
          ? `تعذّر إرسال ${needsReview.length} عملية بيع محفوظة على هذا الجهاز (${needsReview.join('، ')}). ما زالت محفوظة؛ تواصل مع الدعم إن تكرر ذلك.`
          : `${needsReview.length} offline sale(s) could not be sent (${needsReview.join(', ')}). They are still kept on this device.`, { id: 'offline-review', duration: 12000 });
      }
    };

    const syncTimer = setTimeout(() => { void syncOfflineInvoices(); }, 3000);
    const syncInterval = setInterval(() => { void syncOfflineInvoices(); }, 60_000);
    const onOnline = () => { void syncOfflineInvoices(); };
    window.addEventListener('online', onOnline);

    return () => {
      isMounted = false;
      window.removeEventListener(SYNC_PROBLEM_EVENT, onSyncProblem);
      clearTimeout(safetyTimeout);
      clearTimeout(syncTimer);
      clearInterval(syncInterval);
      window.removeEventListener('online', onOnline);
      unsubscribeSettings();
      unsubscribeInventory();
      unsubscribeInvoices();
      unsubscribeEmployees();
      unsubscribePayroll();
      unsubscribeCustomers();
      unsubscribeCustomerTransactions();
      unsubscribeVaultTransactions();
      unsubscribeStockMovements();
      unsubscribeSuppliers();
      unsubscribeSupplierTransactions();
      unsubscribeShifts();
      unsubscribeOrders();
      unsubscribeVaultState();
      unsubscribeWarehouses();
      unsubscribeAuditLogs();
    };
  }, [user]);

  const logUserActivity = async (
    action: string,
    details: string,
    category: 'product' | 'invoice' | 'settings' | 'employee' | 'customer' | 'warehouse' | 'vault' | 'payroll'
  ) => {
    if (!user) return;
    const logId = crypto.randomUUID();
    const logData: AuditLog = {
      id: logId,
      action,
      details,
      timestamp: Date.now(),
      category,
      userName: settings?.userName || user.displayName || user.email?.split('@')[0] || 'Unknown',
      email: user.email || 'unknown@domain.com'
    };

    setAuditLogs(prev => [logData, ...prev]);
    try {
      const currentLogs = [logData, ...auditLogs];
      writeUserCache(user.uid, 'audit_logs', currentLogs.slice(0, 200));
    } catch (e) {}

    try {
      await setDoc(doc(db, 'users', user.uid, 'audit_logs', logId), removeUndefined(logData));
    } catch (error) {
      console.warn("[Firebase logUserActivity] Failed to persist activity log:", error);
    }
  };

  const logout = async () => {
    const uid = lastUidRef.current || user?.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const ownerId = currentWorkspace()?.ownerId;
    // Sales of a store this account was removed from can never be sent from here, so they do not block signing out.
    const pending = uid ? readQueue(uid).filter((q) => !ownerId || belongsToStore(q, ownerId)).length : 0;
    if (pending > 0) {
      toast.error(ar
        ? `توجد ${pending} عملية بيع محفوظة على هذا الجهاز لم تُرسل بعد. اتصل بالإنترنت وانتظر إرسالها قبل تسجيل الخروج حتى لا تضيع.`
        : `${pending} sale(s) on this device have not been sent yet. Connect and wait for them to send before signing out.`,
        { id: 'logout-pending', duration: 10000 });
      throw Object.assign(new Error('Pending offline sales'), { code: 'pending-offline', notified: true });
    }
    const held = uid ? readHeldBills(uid).length : 0;
    if (held > 0) {
      toast.error(ar
        ? `توجد ${held} فاتورة معلّقة على هذا الجهاز. أتمم بيعها أو احذفها من نقطة البيع قبل تسجيل الخروج.`
        : `${held} held bill(s) are still on this device. Finish or discard them in POS before signing out.`,
        { id: 'logout-held', duration: 10000 });
      throw Object.assign(new Error('Held bills pending'), { code: 'pending-held', notified: true });
    }
    clearUserCache(uid);
    lastUidRef.current = null;
    clearDriveConnect();
    // Only this device: other devices of the store (a cashier's phone) stay signed in.
    await supabase.auth.signOut({ scope: 'local' });
    setDriveAccessToken('');
  };

  /** Trial preview has no account to save to: refuse instead of showing a success that never persisted. */
  const guestWriteBlocked = () => {
    const ar = settings?.defaultLanguage !== 'en';
    const message = ar
      ? 'وضع المعاينة لا يحفظ أي بيانات. سجّل الدخول لحفظ عملك.'
      : 'Preview mode does not save anything. Sign in to keep your work.';
    toast.info(message, { id: 'guest-not-saved' });
    return Object.assign(new Error(message), { code: 'guest', notified: true });
  };

  const saveSettings = async (newSettings: AppSettings) => {
    if (user?.uid && isMember()) {
      const prefs = Object.fromEntries(MEMBER_PREFERENCE_KEYS.map((key) => [key, newSettings[key]]));
      writeUserCache(user.uid, 'member_prefs', prefs);
      const next = { ...(settings || newSettings), ...prefs } as AppSettings;
      setSettings(next);
      writeUserCache(user.uid, 'settings', next);
      return;
    }
    const previous = settings;
    setSettings(newSettings);
    if (user?.uid) {
      writeUserCache(user.uid, 'settings', newSettings);
    }

    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'profile'), removeUndefined(newSettings));
      
      const finalLabel = newSettings.defaultLanguage === 'ar' ? 'تعديل الإعدادات' : 'Change Settings';
      const finalDetails = newSettings.defaultLanguage === 'ar' 
        ? `تم تعديل إعدادات النظام وتحديث الملف الشخصي بنجاح`
        : `System settings and profile were successfully updated`;
      logUserActivity(finalLabel, finalDetails, 'settings');
    } catch (error) {
      if (previous) {
        setSettings(previous);
        writeUserCache(user.uid, 'settings', previous);
      }
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/settings/profile`);
    }
  };

  const buildStockMovement = (previous: Product | undefined, next: Product, reason?: string): StockMovement | null => {
    const before = Number(previous?.quantity) || 0;
    const after = Number(next.quantity) || 0;
    if (previous && before === after) return null;
    if (!previous && after === 0) return null;
    const unitCost = Number(next.unitCost ?? next.costPrice);
    return {
      id: crypto.randomUUID(),
      productId: next.id,
      productName: next.name,
      type: previous ? 'adjustment' : 'initial',
      before,
      after,
      delta: after - before,
      reason: reason?.trim() || undefined,
      timestamp: Date.now(),
      userName: settings?.userName || (user as any)?.email || undefined,
      ...(Number.isFinite(unitCost) && unitCost > 0
        ? { unitCost, costCurrency: next.currency || settings?.currency || 'JOD' }
        : {}),
    };
  };

  const recordStockMovement = async (previous: Product | undefined, next: Product, reason?: string) => {
    const movement = buildStockMovement(previous, next, reason);
    if (!movement) return;
    setStockMovements(prev => [movement, ...prev]);
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid, 'stock_movements', movement.id), removeUndefined(movement));
    } catch (e) {
      // The audit trail must never break a product save.
      console.warn('[stock_movements] could not persist movement:', e);
    }
  };

  const productWriteError = (error: any) => {
    const ar = settings?.defaultLanguage !== 'en';
    if (error?.code === 'negative-stock') {
      return Object.assign(new Error(ar
        ? `تغيّرت الكمية من جهاز آخر (المتوفر الآن ${error.available})، والتعديل سيجعلها سالبة. لم يُحفظ.`
        : `The quantity changed on another device (now ${error.available}); this edit would make it negative. Not saved.`), { code: error.code });
    }
    const message = isOfflineError(error)
      ? (ar ? 'لا يوجد اتصال بالإنترنت؛ لم يُحفظ التعديل. أعد المحاولة عند عودة الاتصال.' : 'No connection: the change was not saved. Try again when you are back online.')
      : syncRejectionMessage(error?.code)
        || (error?.code === 'invalid-argument'
          ? (ar ? 'بيانات المنتج غير صالحة للحفظ.' : 'The product data is not valid.')
          : (ar ? 'تعذّر حفظ التعديل على الخادم.' : 'The change could not be saved to the server.'));
    return Object.assign(new Error(message), { code: error?.code });
  };

  /**
   * `baseQuantity` is the quantity the caller started from (e.g. when the edit form opened).
   * By default only the difference is applied to the stored quantity, so a sale made meanwhile is never erased.
   * `absoluteQuantity` sets the submitted quantity when the stored book still equals `baseQuantity` (import / set-to-N).
   * `baseProduct` is the whole product as the form loaded it: fields the user did not touch keep the stored value.
   */
  const saveProduct = async (product: Product, options?: {
    reason?: string;
    skipMovement?: boolean;
    baseQuantity?: number;
    baseProduct?: Product;
    absoluteQuantity?: boolean;
  }) => {
    if (!user) throw guestWriteBlocked();
    // Determine action for logging before state updates
    const exists = products.some(p => p.id === product.id);
    const actionLabel = exists ? 'تعديل منتج' : 'إضافة منتج';
    const actionLabelEn = exists ? 'Edit Product' : 'Add Product';
    const finalActionLabel = settings?.defaultLanguage === 'ar' ? actionLabel : actionLabelEn;
    const finalDetails = settings?.defaultLanguage === 'ar' 
      ? `تم ${exists ? 'تعديل' : 'إضافة'} المنتج: ${product.name} بنجاح (الباركود: ${product.sku})`
      : `Product successfully ${exists ? 'updated' : 'added'}: ${product.name} (SKU: ${product.sku})`;

    // Optimistic state and localStorage update for weak/interrupted connection resilience
    setProducts(prev => {
      const exists = prev.some(p => p.id === product.id);
      const updated = exists 
        ? prev.map(p => p.id === product.id ? product : p)
        : [...prev, product];
      try {
        if (user?.uid) writeUserCache(user.uid, 'products', updated);
      } catch (e) {
        console.error("Local caching for saveProduct failed", e);
      }
      return updated;
    });

    const previousProduct = products.find(p => p.id === product.id);
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    try {
      if (options?.skipMovement) {
        // Backup restore: the saved document is written exactly as it was.
        await setDoc(doc(db, 'users', uid, 'inventory', product.id), removeUndefined(product));
      } else {
        let saved = product;
        let movement: StockMovement | null = null;
        await runTransaction(db, async (transaction) => {
          const productRef = doc(db, 'users', uid, 'inventory', product.id);
          const snap = await transaction.get(productRef);
          const stored = snap.exists() ? ({ ...(snap.data() as Product), id: product.id }) : undefined;
          let quantity = roundQty(Number(product.quantity) || 0);
          let fields = product;
          if (stored) {
            const base = roundQty(options?.baseQuantity ?? options?.baseProduct?.quantity ?? (Number(previousProduct?.quantity) || 0));
            const book = roundQty(Number(stored.quantity) || 0);
            if (options?.absoluteQuantity) {
              if (book !== base) {
                throw Object.assign(
                  new Error(ar
                    ? `كمية «${product.name}» تغيّرت (المتوفر الآن ${book}).`
                    : `Quantity for “${product.name}” changed (now ${book}).`),
                  { code: 'stock-changed', available: book },
                );
              }
              quantity = roundQty(Number(product.quantity) || 0);
            } else {
              quantity = roundQty(book + (quantity - base));
            }
            if (quantity < 0) {
              throw Object.assign(new Error('Stock would go negative'), { code: 'negative-stock', available: book });
            }
            if (options?.baseProduct) fields = mergeProductEdit(options.baseProduct, product, stored);
          }
          saved = { ...fields, quantity, status: computeStockStatus(quantity, fields.lowStockThreshold, settings?.lowStockThreshold) };
          transaction.set(productRef, removeUndefined(saved));
          movement = buildStockMovement(stored, saved, options?.reason);
          if (movement) transaction.set(doc(db, 'users', uid, 'stock_movements', movement.id), removeUndefined(movement));
        });
        setProducts(prev => prev.map(p => p.id === saved.id ? saved : p));
        const committed = movement as StockMovement | null;
        if (committed) setStockMovements(prev => [committed, ...prev]);
      }
      logUserActivity(finalActionLabel, finalDetails, 'product');
    } catch (error: any) {
      // Nothing reached the server: undo the optimistic update so the screen never shows unsaved stock.
      setProducts(prev => {
        const reverted = previousProduct
          ? prev.map(p => p.id === product.id ? previousProduct : p)
          : prev.filter(p => p.id !== product.id);
        try { writeUserCache(user.uid, 'products', reverted); } catch (e) {}
        return reverted;
      });
      if (error?.code === 'stock-changed') throw error;
      throw productWriteError(error);
    }
  };

  /** Moves stock between warehouses in one write: the source and destination change together or not at all. */
  const transferStock = async (productId: string, toWarehouseId: string, quantity: number) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const qty = roundQty(Number(quantity) || 0);
    if (qty <= 0) throw new Error(ar ? 'كمية النقل يجب أن تكون أكبر من صفر.' : 'Transfer quantity must be greater than zero.');
    const reason = ar ? 'نقل بين المستودعات' : 'Warehouse transfer';
    const local = products.find(p => p.id === productId);
    const destinationId = local
      ? products.find(p => p.id !== productId && sameSku(p.sku, local.sku) && (p.warehouseId || '') === toWarehouseId)?.id
      : undefined;
    const movements: StockMovement[] = [];
    const movement = (product: Product, before: number, after: number): StockMovement => ({
      id: crypto.randomUUID(),
      productId: product.id,
      productName: product.name,
      type: 'adjustment',
      before,
      after,
      delta: after - before,
      reason,
      timestamp: Date.now(),
      userName: settings?.userName || (user as any)?.email || undefined,
      transfer: true,
    });

    try {
      await runTransaction(db, async (transaction) => {
        movements.length = 0;
        const sourceRef = doc(db, 'users', uid, 'inventory', productId);
        const sourceSnap = await transaction.get(sourceRef);
        if (!sourceSnap.exists()) throw new Error(ar ? 'المنتج غير موجود.' : 'Product not found.');
        const source = { ...(sourceSnap.data() as Product), id: productId };
        const available = roundQty(Number(source.quantity) || 0);
        if (available < qty) {
          throw new Error(ar ? `الكمية المتوفرة ${available} فقط.` : `Only ${available} available.`);
        }
        const destSnap = destinationId ? await transaction.get(doc(db, 'users', uid, 'inventory', destinationId)) : null;
        const hasDestination = !!destinationId && !!destSnap?.exists();
        if (available === qty && !hasDestination) {
          // The whole product moves; no second row is needed.
          transaction.update(sourceRef, { warehouseId: toWarehouseId });
          const toName = warehouses.find(w => w.id === toWarehouseId)?.name || toWarehouseId;
          movements.push({ ...movement(source, available, available), reason: `${reason}: ${toName}` });
          for (const m of movements) {
            transaction.set(doc(db, 'users', uid, 'stock_movements', m.id), removeUndefined(m));
          }
          return;
        }
        const remaining = roundQty(available - qty);
        transaction.update(sourceRef, {
          quantity: remaining,
          status: computeStockStatus(remaining, source.lowStockThreshold, settings?.lowStockThreshold),
        });
        movements.push(movement(source, available, remaining));

        if (hasDestination && destSnap) {
          const dest = { ...(destSnap.data() as Product), id: destinationId! };
          const before = roundQty(Number(dest.quantity) || 0);
          const after = roundQty(before + qty);
          transaction.update(doc(db, 'users', uid, 'inventory', destinationId!), {
            quantity: after,
            status: computeStockStatus(after, dest.lowStockThreshold, settings?.lowStockThreshold),
          });
          movements.push(movement(dest, before, after));
        } else {
          const splitId = `PROD_SPLIT_${crypto.randomUUID()}`;
          const split: Product = {
            ...source,
            id: splitId,
            quantity: qty,
            warehouseId: toWarehouseId,
            dateAdded: Date.now(),
            status: computeStockStatus(qty, source.lowStockThreshold, settings?.lowStockThreshold),
          };
          transaction.set(doc(db, 'users', uid, 'inventory', splitId), removeUndefined(split));
          movements.push(movement(split, 0, qty));
        }
        for (const m of movements) {
          transaction.set(doc(db, 'users', uid, 'stock_movements', m.id), removeUndefined(m));
        }
      });
    } catch (error: any) {
      if (isOfflineError(error)) throw new Error(ar ? 'لا يوجد اتصال بالإنترنت؛ لم يتم النقل.' : 'No connection: nothing was transferred.');
      const rejection = syncRejectionMessage(error?.code);
      if (rejection) throw new Error(rejection);
      throw error;
    }
    if (movements.length) setStockMovements(prev => [...movements, ...prev]);
    logUserActivity(
      ar ? 'نقل مخزون' : 'Stock Transfer',
      ar ? `نُقلت ${qty} من «${local?.name || productId}» إلى مستودع آخر` : `Moved ${qty} of "${local?.name || productId}" to another warehouse`,
      'product',
    );
  };

  const applyStocktake = async (input: {
    auditNumber: string;
    lines: Array<{ productId: string; productName: string; expectedQty: number; actualQty: number; movementLabel: string }>;
  }) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const lines = input.lines.filter((line) => roundQty(line.expectedQty) !== roundQty(line.actualQty));
    if (!lines.length) return;

    const updatedById = new Map<string, Product>();
    const movements: StockMovement[] = [];

    try {
      await runTransaction(db, async (transaction) => {
        // All reads first (required by the doc transaction model) — batched per collection.
        const snaps = await transaction.getMany(
          lines.map((line) => doc(db, 'users', uid, 'inventory', line.productId)),
        );

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const snap = snaps[i];
          if (!snap.exists()) {
            throw Object.assign(
              new Error(ar ? `الصنف «${line.productName}» لم يعد في المخزون` : `“${line.productName}” is no longer in stock`),
              { code: 'product-missing', productName: line.productName },
            );
          }
          const stored = { ...(snap.data() as Product), id: line.productId };
          const book = roundQty(Number(stored.quantity) || 0);
          const expected = roundQty(line.expectedQty);
          const actual = roundQty(line.actualQty);
          if (actual < 0) {
            throw Object.assign(new Error(ar ? 'الكمية المعدودة لا يمكن أن تكون سالبة' : 'Counted quantity cannot be negative'), { code: 'invalid-qty' });
          }
          if (book !== expected) {
            throw Object.assign(
              new Error(ar
                ? `كمية «${line.productName}» تغيّرت بعد بدء الجرد (المتوفر الآن ${book}).`
                : `Quantity for “${line.productName}” changed after the count started (now ${book}).`),
              { code: 'stock-changed', productName: line.productName, available: book },
            );
          }
          if (book === actual) continue;

          const saved: Product = {
            ...stored,
            quantity: actual,
            status: computeStockStatus(actual, stored.lowStockThreshold, settings?.lowStockThreshold),
          };
          transaction.set(doc(db, 'users', uid, 'inventory', line.productId), removeUndefined(saved));
          const movement = buildStockMovement(stored, saved, line.movementLabel || `${ar ? 'جرد' : 'Stocktake'} ${input.auditNumber}`);
          if (movement) {
            transaction.set(doc(db, 'users', uid, 'stock_movements', movement.id), removeUndefined(movement));
            movements.push(movement);
          }
          updatedById.set(saved.id, saved);
        }
      });
    } catch (error: any) {
      if (error?.code === 'stock-changed' || error?.code === 'product-missing' || error?.code === 'invalid-qty') {
        throw error;
      }
      throw productWriteError(error);
    }

    if (updatedById.size) {
      setProducts((prev) => {
        const next = prev.map((p) => updatedById.get(p.id) || p);
        try { writeUserCache(uid, 'products', next); } catch { /* ignore */ }
        return next;
      });
    }
    if (movements.length) setStockMovements((prev) => [...movements, ...prev]);
    logUserActivity(
      ar ? 'اعتماد جرد' : 'Apply stocktake',
      ar
        ? `اعتُمد الجرد ${input.auditNumber} · ${updatedById.size} صنف`
        : `Stocktake ${input.auditNumber} applied · ${updatedById.size} products`,
      'product',
    );
  };

  const deleteProduct = async (id: string) => {
    const prod = products.find(p => p.id === id);
    const prodName = prod ? prod.name : id;
    const finalActionLabel = settings?.defaultLanguage === 'ar' ? 'حذف منتج' : 'Delete Product';
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم حذف المنتج: ${prodName} بنجاح`
      : `Product successfully deleted: ${prodName}`;

    // Optimistic state and localStorage update for weak/interrupted connection resilience
    setProducts(prev => {
      const updated = prev.filter(p => p.id !== id);
      try {
        if (user?.uid) writeUserCache(user.uid, 'products', updated);
      } catch (e) {
        console.error("Local caching for deleteProduct failed", e);
      }
      return updated;
    });

    if (!user) throw guestWriteBlocked();
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'inventory', id));
      logUserActivity(finalActionLabel, finalDetails, 'product');
    } catch (error: any) {
      if (prod) {
        setProducts(prev => {
          const restored = prev.some(p => p.id === id) ? prev : [...prev, prod];
          try { writeUserCache(user.uid, 'products', restored); } catch (e) {}
          return restored;
        });
      }
      throw productWriteError(error);
    }
  };

  const saveInvoice = async (invoice: Invoice, options?: { restoreOnly?: boolean }): Promise<string> => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;

    // Backup restore: the backup already contains products + vault state, so only the document is written
    // (replaying stock/vault effects would double-apply them).
    if (options?.restoreOnly) {
      await setDoc(doc(db, 'users', uid, 'invoices', invoice.id), removeUndefined(invoice));
      return invoice.invoiceNumber;
    }

    const ar = settings?.defaultLanguage !== 'en';
    const defaultCurrency = settings?.currency || 'JOD';
    const notify = (message: string, extra: Record<string, unknown> = {}) => {
      toast.error(message, { duration: 7000 });
      return Object.assign(new Error(message), { notified: true, ...extra });
    };

    const logInvoice = (invoiceNumber = invoice.invoiceNumber) => {
      const label = invoice.type === 'sale' ? 'فاتورة مبيعات' : 'فاتورة مشتريات';
      const labelEn = invoice.type === 'sale' ? 'Sale Invoice' : 'Purchase Invoice';
      logUserActivity(
        ar ? label : labelEn,
        ar
          ? `تم إنشاء ${label} رقم #${invoiceNumber} بقيمة ${formatMoney(invoice.totalAmount, invoice.currency)}`
          : `Created ${labelEn} #${invoiceNumber} for ${formatMoney(invoice.totalAmount, invoice.currency)}`,
        'invoice'
      );
    };

    try {
      const { status, invoiceNumber } = await commitInvoice(uid, invoice, { lowStockThreshold: settings?.lowStockThreshold, defaultCurrency, ar });
      if (status === 'saved') logInvoice(invoiceNumber);
      return invoiceNumber;
    } catch (error: any) {
      if (!canDeferSaleToQueue(error)) {
        const rejection = syncRejectionMessage(error?.code);
        if (rejection) throw Object.assign(new Error(rejection), { code: error?.code });
        if (String(error?.message || '').startsWith(INSUFFICIENT_VAULT_FUNDS)) {
          throw error; // callers show a localized message
        }
        if (error?.code === 'insufficient-stock') {
          toast.error(ar ? `الكمية المتوفرة من «${error.productName}» هي ${error.available} فقط. لم تُسجَّل العملية.` : error.message);
          throw Object.assign(error, { notified: true });
        }
        if (error?.code === 'product-not-found') {
          toast.error(ar
            ? `الصنف «${error.productName}» غير موجود في المخزون (ربما حُذف). أزله من الفاتورة وأعد المحاولة.`
            : `“${error.productName}” is no longer in inventory (it may have been deleted). Remove it and try again.`);
          throw Object.assign(error, { notified: true });
        }
        if (error?.code === 'currency-mismatch') {
          throw notify(ar
            ? `عملة الشراء تختلف عن عملة تكلفة «${error.productName}» وللصنف رصيد بتكلفة مسجّلة. غيّر عملة الفاتورة أو صفّر الرصيد أولاً. لم تُسجَّل العملية.`
            : `Purchase currency differs from the cost currency of “${error.productName}”, which still has a costed balance. Change the invoice currency or clear stock first. Nothing was recorded.`, { code: 'currency-mismatch' });
        }
        if (error?.code === 'customer-not-found' || error?.code === 'customer-required') {
          throw notify(ar
            ? 'العميل غير موجود (ربما حُذف). اختر عميلاً مسجلاً للبيع الآجل. لم تُسجَّل العملية.'
            : 'The customer no longer exists. Choose a registered customer for a credit sale. Nothing was recorded.', { code: error.code });
        }
        if (error?.code === 'supplier-required') {
          throw notify(ar
            ? 'الشراء الآجل يحتاج مورداً مسجلاً. اختر المورد أو أضفه أولاً. لم تُسجَّل العملية.'
            : 'A credit purchase needs a registered supplier. Pick or add the supplier first. Nothing was recorded.', { code: error.code });
        }
        if (error?.code === 'supplier-not-found') {
          throw notify(ar
            ? 'المورد غير موجود (ربما حُذف). اختر مورداً مسجلاً لفاتورة الشراء الآجلة. لم تُسجَّل العملية.'
            : 'The supplier no longer exists. Choose a registered supplier for a credit purchase. Nothing was recorded.', { code: error.code });
        }
        if (error?.code === 'customer-currency-changed') {
          throw notify(ar
            ? 'تغيّرت عملة حساب العميل. أعد فتح الفاتورة لحساب الدين بعملته. لم تُسجَّل العملية.'
            : "The customer's account currency changed. Reopen the invoice so the debt is converted. Nothing was recorded.", { code: error.code });
        }
        if (error?.code === 'aborted') {
          throw notify(ar
            ? 'تغيّرت البيانات من جهاز آخر أثناء الحفظ. لم تُسجَّل العملية، أعد المحاولة.'
            : 'The data changed on another device while saving. Nothing was recorded; try again.', { code: 'aborted' });
        }
        if (error?.code === 'invoice-number-taken') {
          throw notify(ar
            ? 'رقم الفاتورة مستخدم مسبقاً. غيّر الرقم أو اتركه فارغاً ليُولَّد تلقائياً. لم تُسجَّل العملية.'
            : 'That invoice number is already used. Change it or leave it blank for an automatic number. Nothing was recorded.', { code: 'invoice-number-taken' });
        }
        throw error;
      }
      // Expired session + purchase/credit: refuse (cannot safely queue those). Cash sales fall through.
      if (error?.code === 'unauthenticated' && !canQueueOffline(invoice)) {
        const rejection = syncRejectionMessage('unauthenticated');
        throw Object.assign(new Error(rejection || error.message), { code: 'unauthenticated' });
      }
    }

    // --- No connection / deferred cash sale ---
    if (!canQueueOffline(invoice)) {
      throw notify(ar
        ? 'انقطع الاتصال بالإنترنت قبل تأكيد الحفظ. فواتير الشراء والبيع الآجل تحتاج اتصالاً لأنها تمسّ الخزنة أو ديون الزبائن. أعد المحاولة عند عودة الاتصال؛ لن تُسجَّل الفاتورة مرتين.'
        : 'The connection dropped before the save was confirmed. Purchases and credit sales need a connection because they touch the vault or customer debt. Try again when you are back online; the invoice will not be recorded twice.', { code: 'offline' });
    }
    const shortages = localSaleShortages(invoice, products);
    if (shortages.length > 0) {
      const s = shortages[0];
      throw notify(ar
        ? `الكمية المتوفرة من «${s.name}» هي ${s.available} فقط. لم تُسجَّل العملية.`
        : `Insufficient stock for ${s.name}. Available: ${s.available}`, { code: 'insufficient-stock' });
    }
    const productsById = new Map(products.map((p) => [p.id, p]));
    const queuedInvoice: Invoice = { ...invoice, items: snapshotLineCosts(invoice.items, productsById, defaultCurrency) };
    const ownerId = currentWorkspace()?.ownerId;
    if (!ownerId) {
      throw notify(ar
        ? 'تعذّر تحديد المتجر لحفظ البيع أثناء انقطاع الاتصال. لم تُسجَّل العملية.'
        : 'Could not determine which store should keep this offline sale. Nothing was recorded.', { code: 'no-store' });
    }
    let queued: boolean;
    try {
      queued = await withQueueLock(uid, () => enqueueInvoice(uid, queuedInvoice, ownerId), { required: true });
    } catch (lockErr: any) {
      if (lockErr?.code === 'queue-locked') {
        throw notify(ar
          ? 'جهاز آخر على نفس الحساب يحفظ بيعاً الآن. أعد المحاولة بعد لحظات؛ لم تُسجَّل العملية.'
          : 'Another tab on this account is saving a sale. Try again in a moment; nothing was recorded.', { code: 'queue-locked' });
      }
      throw lockErr;
    }
    if (!queued) {
      throw notify(ar
        ? 'لا يوجد اتصال، وتعذّر حفظ البيع على هذا الجهاز لأن مساحة التخزين ممتلئة. لم تُسجَّل العملية.'
        : 'No connection, and this device has no storage space left to keep the sale. Nothing was recorded.', { code: 'storage-full' });
    }

    const updatedProducts = products.map((p) => {
      const sold = invoice.items.filter((i) => i.productId === p.id).reduce((sum, i) => sum + lineUnits(i), 0);
      if (!sold) return p;
      const newQty = roundQty((Number(p.quantity) || 0) - sold);
      return { ...p, quantity: newQty, status: computeStockStatus(newQty, p.lowStockThreshold, settings?.lowStockThreshold) };
    });
    setProducts(updatedProducts);
    // Do not write deducted stock into the product cache — the queue is the source of pending
    // deductions and boot applies it on top of the last server snapshot.

    let nextVaultTxs = vaultTransactions;
    const plan = planInvoiceVaultEntry(invoice);
    if (plan) {
      const { doc: nextDoc, balanceAfter } = applyVaultDelta(vault, plan.currency, plan.type === 'income' ? plan.amount : -plan.amount);
      const localVaultTx: VaultTransaction = { ...plan, id: `inv-${invoice.id}`, timestamp: Date.now(), balanceAfter };
      nextVaultTxs = [localVaultTx, ...vaultTransactions.filter((tx) => tx.id !== localVaultTx.id)];
      setVault(nextDoc as Vault);
      setVaultTransactions(nextVaultTxs);
      // Same rule as products: keep vault cache as last server doc; queue re-applies on boot.
      writeUserCache(uid, 'vault_records', nextVaultTxs);
    }
    const nextInvoices = [queuedInvoice, ...invoices.filter((i) => i.id !== invoice.id)].sort((a, b) => b.date - a.date);
    setInvoices(nextInvoices);
    writeUserCache(uid, 'invoices', nextInvoices);

    toast.warning(ar
      ? 'تعذّر الوصول للسحابة: حُفظ البيع على هذا الجهاز وسيُرسل تلقائياً عند عودة الاتصال. لا تسجّل الخروج قبل ذلك.'
      : 'Cloud unreachable: the sale is kept on this device and will be sent automatically when the connection returns. Do not sign out before then.',
      { duration: 7000 });

    logInvoice();
    return invoice.invoiceNumber;
  };

  /**
   * Deletes an invoice and undoes everything it did, in one write: stock, vault cash and customer debt.
   * Refuses (and changes nothing) when the books can no longer be reversed honestly.
   */
  const createSalesReturn = async (input: Omit<SalesReturnInput, 'invoiceNumber'>): Promise<Invoice> => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    const ownerId = workspace?.ownerId;
    let result: SalesReturnResult;
    const peeked = peekInvoiceNumber('RET', uid, ownerId);
    try {
      result = await commitSalesReturn(uid, { ...input, invoiceNumber: peeked }, {
        lowStockThreshold: settings?.lowStockThreshold,
        defaultCurrency: settings?.currency || 'JOD',
        ar,
      });
    } catch (error: any) {
      if (isOfflineError(error)) {
        throw fail(ar
          ? 'انقطع الاتصال قبل تأكيد المرتجع. أعد المحاولة عند عودة الاتصال؛ لن يُسجَّل مرتين.'
          : 'The connection dropped before the return was confirmed. Try again when online; it will not be recorded twice.', 'offline');
      }
      if (String(error?.message || '').startsWith(INSUFFICIENT_VAULT_FUNDS)) {
        throw fail(ar
          ? 'رصيد الخزنة بهذه العملة لا يكفي لردّ المبلغ نقداً، فلم يُسجَّل المرتجع.'
          : 'The vault balance in this currency cannot cover the cash refund, so the return was not recorded.', 'vault-insufficient');
      }
      const messages: Record<string, [string, string]> = {
        'not-found': ['الفاتورة الأصلية غير موجودة (ربما حُذفت).', 'The original invoice no longer exists.'],
        'return-invalid': ['تغيّرت الكميات المتاحة للإرجاع (ربما سُجّل مرتجع من جهاز آخر). أعد فتح الفاتورة وحاول مجدداً.', 'The quantities left to return changed (perhaps another device recorded a return). Reopen the invoice and try again.'],
        'product-not-found': ['صنف في المرتجع لم يعد في المخزون، فلم يُسجَّل المرتجع ولا استرداد المال.', 'A returned product is no longer in inventory, so the return and refund were not recorded.'],
        'customer-not-found': ['حساب العميل لهذه الفاتورة الآجلة غير موجود، فلا يمكن خصم المرتجع من دينه.', "This credit sale's customer account no longer exists, so the return cannot lower the debt."],
        'customer-currency-changed': ['تغيّرت عملة حساب العميل بعد الفاتورة، فلم يُسجَّل المرتجع.', "The customer's account currency changed after the sale, so the return was not recorded."],
        aborted: ['تغيّرت البيانات من جهاز آخر أثناء الحفظ. لم يُسجَّل المرتجع، أعد المحاولة.', 'The data changed on another device while saving. Nothing was recorded; try again.'],
        'role-denied': ['تسجيل المرتجعات لمالك المتجر والمدير فقط.', 'Only the store owner or a manager can record returns.'],
        'invoice-number-taken': ['تعذّر حجز رقم للمرتجع. أعد المحاولة.', 'Could not reserve a number for the return. Try again.'],
      };
      const known = messages[error?.code];
      if (known) throw fail(ar ? known[0] : known[1], error.code);
      const rejection = syncRejectionMessage(error?.code);
      if (rejection) throw fail(rejection, error.code);
      throw error;
    }

    const saved = result.invoice;
    // A retry finds the return already saved under the number peeked now; the counter must still move past it.
    if (result.status === 'saved' || saved.invoiceNumber === peeked) consumeInvoiceNumber('RET', uid, ownerId);
    if (result.status === 'saved') {
      logUserActivity(
        ar ? 'مرتجع مبيعات' : 'Sales Return',
        ar
          ? `سُجّل المرتجع #${saved.invoiceNumber} عن الفاتورة #${saved.returnOfNumber} بقيمة ${formatMoney(saved.totalAmount, saved.currency)}`
          : `Return #${saved.invoiceNumber} for invoice #${saved.returnOfNumber} - ${formatMoney(saved.totalAmount, saved.currency)}`,
        'invoice',
      );
    }
    return saved;
  };

  const createPurchaseReturn = async (input: Omit<SalesReturnInput, 'invoiceNumber'>): Promise<Invoice> => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    const ownerId = workspace?.ownerId;
    const peeked = peekInvoiceNumber('PRT', uid, ownerId);
    let result: SalesReturnResult;
    try {
      result = await commitPurchaseReturn(uid, { ...input, invoiceNumber: peeked }, {
        lowStockThreshold: settings?.lowStockThreshold,
        defaultCurrency: settings?.currency || 'JOD',
        ar,
      });
    } catch (error: any) {
      if (isOfflineError(error)) {
        throw fail(ar
          ? 'انقطع الاتصال قبل تأكيد المرتجع. أعد المحاولة عند عودة الاتصال؛ لن يُسجَّل مرتين.'
          : 'The connection dropped before the return was confirmed. Try again when online; it will not be recorded twice.', 'offline');
      }
      if (error?.code === 'insufficient-stock') {
        throw fail(ar
          ? `لا يمكن إرجاع «${error.productName}» للمورد: المتوفر في المخزون ${error.available} والمطلوب إرجاعه ${error.needed}.`
          : `Cannot send “${error.productName}” back: ${error.available} in stock, ${error.needed} needed.`, 'insufficient-stock');
      }
      if (error?.code === 'product-not-found') {
        throw fail(ar
          ? `الصنف «${error.productName}» لم يعد موجوداً في المخزون، فلا يمكن إرجاعه.`
          : `“${error.productName}” no longer exists in stock, so it cannot be returned.`, 'product-not-found');
      }
      const messages: Record<string, [string, string]> = {
        'not-found': ['فاتورة الشراء الأصلية غير موجودة (ربما حُذفت).', 'The original purchase no longer exists.'],
        'return-invalid': ['تغيّرت الكميات المتاحة للإرجاع (ربما سُجّل مرتجع من جهاز آخر). أعد فتح الفاتورة وحاول مجدداً.', 'The quantities left to return changed (perhaps another device recorded a return). Reopen the purchase and try again.'],
        'supplier-not-found': ['حساب المورد لهذا الشراء الآجل غير موجود، فلا يمكن خصم المرتجع من رصيده.', "This credit purchase's supplier account no longer exists, so the return cannot lower the balance."],
        aborted: ['تغيّرت البيانات من جهاز آخر أثناء الحفظ. لم يُسجَّل المرتجع، أعد المحاولة.', 'The data changed on another device while saving. Nothing was recorded; try again.'],
        'role-denied': ['تسجيل مرتجع المشتريات لمالك المتجر والمدير فقط.', 'Only the store owner or a manager can record purchase returns.'],
      };
      const known = messages[error?.code];
      if (known) throw fail(ar ? known[0] : known[1], error.code);
      const rejection = syncRejectionMessage(error?.code);
      if (rejection) throw fail(rejection, error.code);
      throw error;
    }

    const saved = result.invoice;
    if (result.status === 'saved' || saved.invoiceNumber === peeked) consumeInvoiceNumber('PRT', uid, ownerId);
    if (result.status === 'saved') {
      logUserActivity(
        ar ? 'مرتجع مشتريات' : 'Purchase Return',
        ar
          ? `سُجّل مرتجع المشتريات #${saved.invoiceNumber} عن الفاتورة #${saved.returnOfNumber} بقيمة ${formatMoney(saved.totalAmount, saved.currency)}`
          : `Purchase return #${saved.invoiceNumber} for purchase #${saved.returnOfNumber} - ${formatMoney(saved.totalAmount, saved.currency)}`,
        'invoice',
      );
    }
    return saved;
  };

  const deleteInvoice = async (id: string) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const known = invoices.find(i => i.id === id);
    // Credit sales saved before the debt was linked to the invoice id are matched by number.
    const legacyLedgerId = known?.paymentMethod === 'credit' && known.customerId
      ? customerTransactions.find(t =>
          t.customerId === known.customerId && t.type === 'invoice' && t.id !== `inv-${id}`
          && (t.invoiceId === id || (t.notes || '').includes(`#${known.invoiceNumber}`)))?.id
      : undefined;
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code });
    let missing: string[] = [];

    try {
      await runTransaction(db, async (transaction) => {
        const invoiceRef = doc(db, 'users', uid, 'invoices', id);
        const invoiceSnap = await transaction.get(invoiceRef);
        if (!invoiceSnap.exists()) throw fail(ar ? 'الفاتورة غير موجودة (ربما حُذفت من جهاز آخر).' : 'The invoice no longer exists.', 'not-found');
        const inv = { ...(invoiceSnap.data() as Invoice), id };
        if ((inv.type === 'sale' || inv.type === 'purchase') && (inv.returnedQty || []).some((q) => Number(q) > 0)) {
          throw fail(ar
            ? 'لهذه الفاتورة مرتجعات مسجّلة. احذف المرتجعات أولاً ثم احذف الفاتورة.'
            : 'This invoice has recorded returns. Delete the returns first, then the invoice.', 'has-returns');
        }

        // 1. Stock
        const current = new Map<string, Product | undefined>();
        for (const productId of quantitiesByProduct(inv.items).keys()) {
          const snap = await transaction.get(doc(db, 'users', uid, 'inventory', productId));
          current.set(productId, snap.exists() ? (snap.data() as Product) : undefined);
        }
        const stock = planStockReversal(inv, current);
        if (stock.shortages.length) {
          const s0 = stock.shortages[0];
          throw fail(inv.type === 'return'
            ? (ar
              ? `لا يمكن حذف المرتجع: بيعت البضاعة المرتجعة. المتوفر من «${s0.name}» ${s0.available} والمطلوب سحبه ${s0.needed}.`
              : `Cannot delete this return: the returned goods were sold again. "${s0.name}" has ${s0.available}, ${s0.needed} needed.`)
            : (ar
              ? `لا يمكن حذف فاتورة الشراء: بيع جزء من بضاعتها. المتوفر من «${s0.name}» ${s0.available} والمطلوب إرجاعه ${s0.needed}.`
              : `Cannot delete this purchase: some goods were already sold. "${s0.name}" has ${s0.available}, ${s0.needed} needed.`), 'insufficient-stock');
        }
        missing = stock.missing;
        for (const u of stock.updates) {
          const product = current.get(u.productId);
          // Undo this purchase's (or purchase return's) cost averaging only while nothing later has averaged the cost again.
          const cost = inv.type === 'purchase' || inv.type === 'purchase_return' ? inv.costChanges?.[u.productId] : undefined;
          const currentCost = Number(product?.unitCost ?? product?.costPrice);
          const restoreCost = !!cost && Number.isFinite(cost.before) && Math.abs(currentCost - cost.after) < 1e-6;
          transaction.update(doc(db, 'users', uid, 'inventory', u.productId), {
            quantity: u.quantity,
            status: computeStockStatus(u.quantity, product?.lowStockThreshold, settings?.lowStockThreshold),
            ...(restoreCost ? { unitCost: cost!.before } : {}),
          });
        }

        // 2. Vault
        const plan = inv.vaultPosted === false ? null : planInvoiceVaultEntry(inv, { includeNonCash: inv.vaultPosted === undefined });
        if (plan) {
          const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
          const vaultSnap = await transaction.get(vaultStateRef);
          const reverseDelta = plan.type === 'income' ? -plan.amount : plan.amount;
          const { doc: updatedVault, balanceAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, plan.currency, reverseDelta);
          if (reverseDelta < 0) assertVaultCanCover(balanceAfter, plan.currency);
          transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
          const recId = `rev-${id}`;
          const reversal: VaultTransaction = {
            ...plan,
            id: recId,
            type: plan.type === 'income' ? 'expense' : 'income',
            description: `${ar ? 'عكس قيد فاتورة محذوفة' : 'Reversal - deleted invoice'} #${inv.invoiceNumber}`,
            source: 'reversal',
            timestamp: Date.now(),
            balanceAfter,
          };
          transaction.set(doc(db, 'users', uid, 'vault_records', recId), removeUndefined(reversal));
        }

        // 3. Customer debt (only when an unpaid slice was posted on the customer)
        if (inv.type === 'sale' && inv.paymentMethod === 'credit' && inv.customerId && salePayment(inv).owed > 0) {
          let ledgerId = `inv-${id}`;
          let ledgerSnap = await transaction.get(doc(db, 'users', uid, 'customer_transactions', ledgerId));
          if (!ledgerSnap.exists() && legacyLedgerId) {
            ledgerId = legacyLedgerId;
            ledgerSnap = await transaction.get(doc(db, 'users', uid, 'customer_transactions', ledgerId));
          }
          if (!ledgerSnap.exists()) {
            throw fail(ar
              ? 'لم نجد قيد الدين المرتبط بهذه الفاتورة الآجلة في حساب العميل، فلم تُحذف كي لا يختلّ الحساب.'
              : 'The customer debt entry for this credit sale was not found, so it was not deleted.', 'ledger-not-found');
          }
          const entry = ledgerSnap.data() as CustomerTransaction;
          const customerRef = doc(db, 'users', uid, 'customers', inv.customerId);
          const customerSnap = await transaction.get(customerRef);
          if (customerSnap.exists()) {
            const customer = customerSnap.data() as Customer;
            const debtCurrency = (entry.currency || customer.currency || inv.currency) as Currency;
            const remaining = roundForCurrency((Number(customer.totalDebt) || 0) - (Number(entry.amount) || 0), debtCurrency);
            if (remaining < 0) {
              throw fail(ar
                ? 'سدّد العميل جزءاً من هذه الفاتورة. سجّل إرجاع المبلغ له أولاً ثم احذف الفاتورة.'
                : 'The customer already paid part of this invoice. Record the refund first, then delete it.', 'debt-already-paid');
            }
            transaction.update(customerRef, { totalDebt: remaining });
          }
          transaction.delete(doc(db, 'users', uid, 'customer_transactions', ledgerId));
        }

        // 4. Supplier balance: the unpaid part of a credit purchase comes off what is owed.
        // Fail closed when a ledger row is required but missing — never leave inflated AP after delete.
        if (inv.type === 'purchase' && inv.paymentMethod === 'credit' && inv.supplierId) {
          const ledgerRef = doc(db, 'users', uid, 'supplier_transactions', `inv-${id}`);
          const ledgerSnap = await transaction.get(ledgerRef);
          if (purchaseDeleteRequiresSupplierLedger(inv) && !ledgerSnap.exists()) {
            throw fail(ar
              ? 'لم نجد قيد الدين المرتبط بهذه فاتورة الشراء الآجلة في حساب المورد، فلم تُحذف كي لا يختلّ الرصيد.'
              : 'The supplier debt entry for this credit purchase was not found, so it was not deleted.', 'ledger-not-found');
          }
          if (ledgerSnap.exists()) {
            const entry = ledgerSnap.data() as SupplierTransaction;
            const supplierRef = doc(db, 'users', uid, 'suppliers', inv.supplierId);
            const supplierSnap = await transaction.get(supplierRef);
            if (supplierSnap.exists()) {
              const supplier = supplierSnap.data() as Supplier;
              const currency = (entry.currency || inv.currency) as Currency;
              const balances = withBalance(supplier.balances, currency, -(Number(entry.amount) || 0));
              if (supplierBalance({ balances }, currency) < 0) {
                throw fail(ar
                  ? 'دُفع للمورد أكثر مما سيبقى له بعد حذف هذه الفاتورة. احذف دفعة المورد الزائدة أولاً ثم احذف الفاتورة.'
                  : 'The supplier was paid more than would remain owed after deleting this purchase. Delete the extra payment first.', 'supplier-already-paid');
              }
              transaction.update(supplierRef, { balances });
            }
            transaction.delete(ledgerRef);
          }
        }

        // 5. A purchase return: what it took off the supplier balance is owed again.
        if (inv.type === 'purchase_return' && (Number(inv.refund?.debt) || 0) > 0 && inv.supplierId) {
          const ledgerRef = doc(db, 'users', uid, 'supplier_transactions', `inv-${id}`);
          const ledgerSnap = await transaction.get(ledgerRef);
          if (purchaseDeleteRequiresSupplierLedger(inv) && !ledgerSnap.exists()) {
            throw fail(ar
              ? 'لم نجد قيد المرتجع في حساب المورد، فلم يُحذف كي لا يختلّ الرصيد.'
              : 'The supplier ledger entry for this purchase return was not found, so it was not deleted.', 'ledger-not-found');
          }
          const supplierRef = doc(db, 'users', uid, 'suppliers', inv.supplierId);
          const supplierSnap = await transaction.get(supplierRef);
          if (ledgerSnap.exists() && supplierSnap.exists()) {
            const entry = ledgerSnap.data() as SupplierTransaction;
            const supplier = supplierSnap.data() as Supplier;
            const currency = (entry.currency || inv.currency) as Currency;
            transaction.update(supplierRef, { balances: withBalance(supplier.balances, currency, Number(entry.amount) || 0) });
          }
          if (ledgerSnap.exists()) transaction.delete(ledgerRef);
        }

        if (inv.type === 'return' || inv.type === 'purchase_return') {
          // The debt the return took off goes back on the customer.
          if (inv.type === 'return' && (Number(inv.refund?.debt) || 0) > 0 && inv.customerId) {
            const ledgerRef = doc(db, 'users', uid, 'customer_transactions', `inv-${id}`);
            const ledgerSnap = await transaction.get(ledgerRef);
            const customerRef = doc(db, 'users', uid, 'customers', inv.customerId);
            const customerSnap = await transaction.get(customerRef);
            if (ledgerSnap.exists() && customerSnap.exists()) {
              const entry = ledgerSnap.data() as CustomerTransaction;
              const customer = customerSnap.data() as Customer;
              const debtCurrency = (entry.currency || customer.currency || inv.currency) as Currency;
              transaction.update(customerRef, {
                totalDebt: roundForCurrency((Number(customer.totalDebt) || 0) + (Number(entry.amount) || 0), debtCurrency),
              });
            }
            if (ledgerSnap.exists()) transaction.delete(ledgerRef);
          }
          // The returned units become returnable again on the original sale or purchase.
          if (inv.returnOf) {
            const originalRef = doc(db, 'users', uid, 'invoices', inv.returnOf);
            const originalSnap = await transaction.get(originalRef);
            if (originalSnap.exists()) {
              const original = originalSnap.data() as Invoice;
              const returnedQty = original.items.map((_, i) => Number(original.returnedQty?.[i]) || 0);
              for (const item of inv.items) {
                const line = item.sourceLine;
                if (line === undefined || line < 0 || line >= returnedQty.length) continue;
                returnedQty[line] = Math.max(0, roundQty(returnedQty[line] - (Number(item.quantity) || 0)));
              }
              transaction.update(originalRef, { returnedQty });
            }
          }
        }

        transaction.delete(invoiceRef);
      });
    } catch (error: any) {
      if (isOfflineError(error)) {
        throw fail(ar ? 'لا يوجد اتصال بالإنترنت؛ لم تُحذف الفاتورة.' : 'No connection: the invoice was not deleted.', 'offline');
      }
      if (String(error?.message || '').startsWith(INSUFFICIENT_VAULT_FUNDS)) {
        throw fail(ar
          ? 'رصيد الخزنة بهذه العملة لا يكفي لإرجاع قيمة هذه الفاتورة، فلم تُحذف.'
          : 'The vault balance in this currency cannot cover reversing this invoice, so it was not deleted.', 'vault-insufficient');
      }
      const rejection = syncRejectionMessage(error?.code);
      if (rejection) throw fail(rejection, error.code);
      throw error;
    }

    if (missing.length) {
      toast.warning(ar
        ? `حُذفت الفاتورة. أصناف لم تعد موجودة فلم تُعدَّل كميتها: ${missing.join('، ')}`
        : `Invoice deleted. These products no longer exist, so their stock was not changed: ${missing.join(', ')}`);
    }
    const invNum = known?.invoiceNumber || id;
    logUserActivity(
      ar ? 'حذف فاتورة' : 'Delete Invoice',
      ar ? `حُذفت الفاتورة رقم #${invNum} وعُكست آثارها على المخزون والخزنة والديون` : `Invoice #${invNum} deleted and its stock, vault and debt effects reversed`,
      'invoice',
    );
  };


  const commitVaultRecordTransaction = async (
    transaction: any,
    uid: string,
    { id: requestedId, ...record }: Omit<VaultTransaction, 'id' | 'timestamp' | 'balanceAfter'> & { id?: string }
  ) => {
    const vaultRecordId = requestedId || crypto.randomUUID();
    const vaultRecordRef = doc(db, 'users', uid, 'vault_records', vaultRecordId);
    if (requestedId) {
      const saved = await transaction.get(vaultRecordRef);
      if (saved.exists()) return saved.data() as VaultTransaction;
    }
    const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
    const vaultSnap = await transaction.get(vaultStateRef);
    const currency = (record.currency || 'JOD') as Currency;
    const amount = roundForCurrency(Number(record.amount) || 0, currency);
    const { doc: updatedVault, balanceAfter } = applyVaultDelta(
      vaultSnap.exists() ? vaultSnap.data() : {}, currency, record.type === 'income' ? amount : -amount);
    if (record.type === 'expense') assertVaultCanCover(balanceAfter, currency);

    const vaultRecord: VaultTransaction = {
      ...record,
      id: vaultRecordId,
      timestamp: Date.now(),
      amount,
      currency,
      balanceAfter
    };

    transaction.set(vaultRecordRef, removeUndefined(vaultRecord));
    transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
    return vaultRecord;
  };

  const recordVaultTransaction = async (record: Omit<VaultTransaction, 'id' | 'timestamp' | 'balanceAfter'> & { id?: string }) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;

    try {
      await runTransaction(db, async (transaction) => {
        await commitVaultRecordTransaction(transaction, uid, record);
      });
    } catch (error: any) {
      if (String(error?.message || '').startsWith(INSUFFICIENT_VAULT_FUNDS)) throw error;
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}/vault_records/transaction`);
    }
  };

  const saveEmployee = async (employee: Employee) => {
    if (!user) throw guestWriteBlocked();
    const exists = employees.some(e => e.id === employee.id);
    const label = exists ? 'تعديل موظف' : 'إضافة موظف';
    const labelEn = exists ? 'Edit Employee' : 'Add Employee';
    const finalLabel = settings?.defaultLanguage === 'ar' ? label : labelEn;
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم ${exists ? 'تعديل بيانات' : 'إضافة'} الموظف: ${employee.name} (${employee.role})`
      : `Employee ${exists ? 'updated' : 'added'}: ${employee.name} (${employee.role})`;

    try {
      await setDoc(doc(db, 'users', user.uid, 'employees', employee.id), removeUndefined(employee));
      logUserActivity(finalLabel, finalDetails, 'employee');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/employees/${employee.id}`);
    }
  };

  const deleteEmployee = async (id: string) => {
    if (!user) throw guestWriteBlocked();
    const emp = employees.find(e => e.id === id);
    const empName = emp ? emp.name : id;
    const finalLabel = settings?.defaultLanguage === 'ar' ? 'حذف موظف' : 'Delete Employee';
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم حذف الموظف: ${empName}`
      : `Employee deleted: ${empName}`;

    try {
      await deleteDoc(doc(db, 'users', user.uid, 'employees', id));
      logUserActivity(finalLabel, finalDetails, 'employee');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/employees/${id}`);
    }
  };

  const savePayrollRecord = async (payroll: PayrollRecord) => {
    if (!user) throw guestWriteBlocked();
    const finalLabel = settings?.defaultLanguage === 'ar' ? 'تسجيل راتب' : 'Record Payroll';
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم تسجيل راتب الموظف ${payroll.employeeName} لشهر ${payroll.monthYear}، والصافي ${formatMoney(Number(payroll.netSalary) || 0, payroll.currency || settings?.currency || 'JOD', 'en-US')}`
      : `Payroll recorded for ${payroll.employeeName} (${payroll.monthYear}) - Net: ${formatMoney(Number(payroll.netSalary) || 0, payroll.currency || settings?.currency || 'JOD', 'en-US')}`;

    const uid = user.uid;
    try {
      await runTransaction(db, async (transaction) => {
        const payrollRef = doc(db, 'users', uid, 'payroll', payroll.id);
        const existing = await transaction.get(payrollRef);
        // A paid salary must never be turned back into a pending one (its vault expense stays).
        if (existing.exists() && (existing.data() as PayrollRecord).paymentStatus === 'paid') {
          throw Object.assign(new Error('Payroll already paid'), { code: 'payroll-already-paid' });
        }
        transaction.set(payrollRef, removeUndefined(payroll));
      });
      logUserActivity(finalLabel, finalDetails, 'payroll');
    } catch (error: any) {
      if (String(error?.message || '') === 'Payroll already paid') throw error;
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}/payroll/${payroll.id}`);
    }
  };

  /**
   * Pays a salary atomically: the payroll document (status 'paid') and the vault expense are written
   * in ONE transaction, so a failure can never leave a paid salary without a vault movement (or the reverse).
   */
  const payPayroll = async (payroll: PayrollRecord) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const currency = (payroll.currency || settings?.currency || 'JOD') as Currency;
    const amount = roundForCurrency(Number(payroll.netSalary) || 0, currency);
    if (amount <= 0) throw new Error('Net salary must be greater than zero');

    try {
      await runTransaction(db, async (transaction) => {
        const payrollRef = doc(db, 'users', uid, 'payroll', payroll.id);
        const existing = await transaction.get(payrollRef);
        if (existing.exists() && (existing.data() as PayrollRecord).paymentStatus === 'paid') {
          throw Object.assign(new Error('Payroll already paid'), { code: 'payroll-already-paid' });
        }
        await commitVaultRecordTransaction(transaction, uid, {
          type: 'expense',
          category: 'salary',
          source: 'payroll',
          refId: payroll.id,
          amount,
          currency,
          description: `Salary: ${payroll.employeeName} (${payroll.monthYear})`,
        });
        transaction.set(payrollRef, removeUndefined({ ...payroll, netSalary: amount, currency, paymentStatus: 'paid', paymentDate: Date.now() }));
      });
      logUserActivity(
        settings?.defaultLanguage === 'ar' ? 'صرف راتب' : 'Pay Payroll',
        settings?.defaultLanguage === 'ar'
          ? `تم صرف راتب ${payroll.employeeName} لشهر ${payroll.monthYear} بقيمة ${formatMoney(amount, currency, 'en-US')}`
          : `Salary paid to ${payroll.employeeName} (${payroll.monthYear}) - ${formatMoney(amount, currency, 'en-US')}`,
        'payroll');
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg.startsWith(INSUFFICIENT_VAULT_FUNDS) || msg === 'Payroll already paid' || msg.startsWith('Net salary')) throw error;
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}/payroll/${payroll.id}`);
    }
  };

  const deletePayrollRecord = async (id: string) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const record = payrollRecords.find(p => p.id === id);
    const empName = record ? record.employeeName : id;
    const period = record ? record.monthYear : '';
    const finalLabel = settings?.defaultLanguage === 'ar' ? 'حذف راتب' : 'Delete Payroll';
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم حذف سجل الراتب للموظف: ${empName} (${period})`
      : `Payroll record deleted for ${empName} (${period})`;

    try {
      let deleted = false;
      await runTransaction(db, async (transaction) => {
        const payrollRef = doc(db, 'users', uid, 'payroll', id);
        const snap = await transaction.get(payrollRef);
        if (!snap.exists()) return;
        deleted = true;
        const stored = snap.data() as PayrollRecord;
        if (stored.paymentStatus === 'paid') {
          // A paid salary already left the vault: deleting the record must return the money (reversal entry).
          const currency = (stored.currency || settings?.currency || 'JOD') as Currency;
          const amount = roundForCurrency(Number(stored.netSalary) || 0, currency);
          const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
          const vaultSnap = await transaction.get(vaultStateRef);
          const { doc: updatedVault, balanceAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, currency, amount);
          transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
          const recId = crypto.randomUUID();
          const reversal: VaultTransaction = {
            id: recId,
            type: 'income',
            category: 'salary',
            source: 'reversal',
            refId: id,
            amount,
            currency,
            description: `Reversal - deleted payroll ${stored.employeeName || empName} (${stored.monthYear || period})`,
            timestamp: Date.now(),
            balanceAfter,
          };
          transaction.set(doc(db, 'users', uid, 'vault_records', recId), removeUndefined(reversal));
        }
        transaction.delete(payrollRef);
      });
      if (deleted) logUserActivity(finalLabel, finalDetails, 'payroll');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${uid}/payroll/${id}`);
    }
  };

  const saveCustomer = async (customer: Customer, options?: { restore?: boolean }) => {
    if (!user) throw guestWriteBlocked();
    const exists = customers.some(c => c.id === customer.id);
    const label = exists ? 'تعديل عميل' : 'إضافة عميل';
    const labelEn = exists ? 'Edit Customer' : 'Add Customer';
    const finalLabel = settings?.defaultLanguage === 'ar' ? label : labelEn;
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم ${exists ? 'تعديل بيانات' : 'إضافة'} العميل: ${customer.name} (الهاتف: ${customer.phone})`
      : `Customer ${exists ? 'updated' : 'added'}: ${customer.name} (Phone: ${customer.phone})`;

    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code });
    if (options?.restore) {
      // Backup restore writes the saved document as it was; its ledger is restored separately.
      await setDoc(doc(db, 'users', uid, 'customers', customer.id), removeUndefined(customer));
      return;
    }
    try {
      await runTransaction(db, async (transaction) => {
        const customerRef = doc(db, 'users', uid, 'customers', customer.id);
        const snap = await transaction.get(customerRef);
        if (snap.exists()) {
          // Edit: only the profile fields. Debt changes only through ledger movements.
          const current = snap.data() as Customer;
          const currencyChanged = !!customer.currency && customer.currency !== current.currency;
          if (currencyChanged && (Number(current.totalDebt) || 0) !== 0) {
            throw fail(ar ? 'لا يمكن تغيير عملة عميل عليه دين.' : 'The currency of a customer with debt cannot change.', 'currency-locked');
          }
          transaction.update(customerRef, removeUndefined({
            name: customer.name,
            phone: customer.phone,
            ...(currencyChanged ? { currency: customer.currency } : {}),
          }));
          return;
        }
        if (exists) throw fail(ar ? 'حُذف هذا العميل من جهاز آخر.' : 'This customer was deleted on another device.', 'not-found');

        const currency = (customer.currency || settings?.currency || 'JOD') as Currency;
        const opening = roundForCurrency(Math.max(0, Number(customer.totalDebt) || 0), currency);
        transaction.set(customerRef, removeUndefined({ ...customer, currency, totalDebt: opening }));
        if (opening > 0) {
          const txId = `open-${customer.id}`;
          const entry: CustomerTransaction = {
            id: txId,
            transactionId: txId,
            customerId: customer.id,
            type: 'invoice',
            amount: opening,
            currency,
            exchangeRate: 1,
            date: new Date().toISOString(),
            notes: formatManualArNote(ar ? 'رصيد افتتاحي عند إنشاء العميل' : 'Opening balance on customer create', ar),
            remainingBalanceAfter: opening,
          };
          transaction.set(doc(db, 'users', uid, 'customer_transactions', txId), removeUndefined(entry));
        }
      });
      logUserActivity(finalLabel, finalDetails, 'customer');
    } catch (error: any) {
      if (isOfflineError(error)) throw fail(ar ? 'لا يوجد اتصال بالإنترنت؛ لم يُحفظ العميل.' : 'No connection: the customer was not saved.', 'offline');
      const rejection = syncRejectionMessage(error?.code);
      if (rejection) throw fail(rejection, error.code);
      throw error;
    }
  };

  const deleteCustomer = async (id: string) => {
    if (!user) throw guestWriteBlocked();
    const cust = customers.find(c => c.id === id);
    const custName = cust ? cust.name : id;
    const finalLabel = settings?.defaultLanguage === 'ar' ? 'حذف عميل' : 'Delete Customer';
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم حذف العميل: ${custName}`
      : `Customer deleted: ${custName}`;

    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code });
    try {
      await runTransaction(db, async (transaction) => {
        const customerRef = doc(db, 'users', uid, 'customers', id);
        const snap = await transaction.get(customerRef);
        if (!snap.exists()) return;
        const stored = snap.data() as Customer;
        const currency = (stored.currency || settings?.currency || 'JOD') as Currency;
        const balance = roundForCurrency(Number(stored.totalDebt) || 0, currency);
        if (balance !== 0) {
          throw fail(ar
            ? `لا يمكن حذف «${stored.name || custName}» لأن رصيد حسابه ${formatMoney(balance, currency)}. سوِّ الحساب أولاً.`
            : `“${stored.name || custName}” cannot be deleted while the account balance is ${formatMoney(balance, currency)}. Settle it first.`, 'customer-has-balance');
        }
        transaction.delete(customerRef);
      });
      logUserActivity(finalLabel, finalDetails, 'customer');
    } catch (error: any) {
      if (error?.code === 'customer-has-balance') throw error;
      if (isOfflineError(error)) throw fail(ar ? 'لا يوجد اتصال بالإنترنت؛ لم يُحذف العميل.' : 'No connection: the customer was not deleted.', 'offline');
      const rejection = syncRejectionMessage(error?.code);
      if (rejection) throw fail(rejection, error.code);
      throw error;
    }
  };

  const saveCustomerTransaction = async (tx: CustomerTransaction) => {
    if (!user) throw guestWriteBlocked();
    try {
      await setDoc(doc(db, 'users', user.uid, 'customer_transactions', tx.id), removeUndefined(tx));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/customer_transactions/${tx.id}`);
    }
  };

  const deleteCustomerTransaction = async (id: string) => {
    if (!user) throw guestWriteBlocked();
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'customer_transactions', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/customer_transactions/${id}`);
    }
  };

  /**
   * Deletes a customer ledger entry atomically: the customer's debt is recalculated from the SERVER value,
   * and when the entry was a payment that entered the vault, the cash is returned with a reversal record.
   */
  const deleteCustomerLedgerTransaction = async (txId: string, options?: { reverseVault?: boolean }) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code });
    try {
      await runTransaction(db, async (transaction) => {
        const txRef = doc(db, 'users', uid, 'customer_transactions', txId);
        const txSnap = await transaction.get(txRef);
        if (!txSnap.exists()) throw new Error('Ledger entry does not exist');
        const tx = txSnap.data() as CustomerTransaction;

        // A credit sale's debt belongs to its invoice: removing it alone would leave sold goods unpaid.
        if (tx.invoiceId || txId.startsWith('inv-')) {
          throw fail(ar
            ? 'هذا القيد ناتج عن فاتورة بيع آجل. احذف الفاتورة نفسها من شاشة الفواتير ليُعكس الدين والمخزون معاً.'
            : 'This entry comes from a credit sale. Delete the invoice itself so the debt and stock are reversed together.', 'ledger-owned-by-invoice');
        }

        const customerRef = doc(db, 'users', uid, 'customers', tx.customerId);
        const customerSnap = await transaction.get(customerRef);

        const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
        const reverseVault = tx.type === 'payment' && (options?.reverseVault ?? !!tx.vaultRecordId);
        const vaultSnap = reverseVault ? await transaction.get(vaultStateRef) : null;

        if (customerSnap.exists()) {
          const customer = customerSnap.data() as Customer;
          const debtCurrency = (tx.currency || customer.currency || 'JOD') as Currency;
          const debt = Number(customer.totalDebt) || 0;
          // Deleting a debt entry removes the debt it added; deleting a payment brings the debt back.
          const finalDebt = roundForCurrency(debt + (tx.type === 'invoice' ? -tx.amount : tx.amount), debtCurrency);
          if (finalDebt < 0) {
            throw fail(ar
              ? 'سدّد العميل جزءاً من هذا الدين، فحذفه سيجعل رصيده سالباً. احذف الدفعة المرتبطة أولاً أو سجّل إرجاع المبلغ له.'
              : 'The customer already paid part of this debt, so deleting it would make the balance negative. Delete the related payment first or record a refund.', 'debt-already-paid');
          }
          transaction.update(customerRef, { totalDebt: finalDebt });
        }

        if (reverseVault && vaultSnap) {
          const currency = (tx.currency || 'JOD') as Currency;
          const amount = roundForCurrency(Number(tx.amount) || 0, currency);
          const { doc: updatedVault, balanceAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, currency, -amount);
          if (balanceAfter < 0) {
            throw fail(ar
              ? `رصيد الخزنة بعملة ${currency} لا يكفي لإرجاع هذه الدفعة، فلم تُحذف.`
              : `The ${currency} vault balance cannot cover returning this payment, so it was not deleted.`, 'vault-insufficient');
          }
          transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
          const recId = crypto.randomUUID();
          const reversal: VaultTransaction = {
            id: recId,
            type: 'expense',
            category: 'sale',
            source: 'reversal',
            refId: tx.customerId,
            amount,
            currency,
            description: `Reversal - deleted customer payment ${tx.transactionId}`,
            timestamp: Date.now(),
            balanceAfter,
          };
          transaction.set(doc(db, 'users', uid, 'vault_records', recId), removeUndefined(reversal));
        }

        transaction.delete(txRef);
      });
    } catch (error: any) {
      if (String(error?.message || '').startsWith('Ledger entry does not exist')) throw error;
      if (['ledger-owned-by-invoice', 'debt-already-paid', 'vault-insufficient'].includes(error?.code)) throw error;
      if (isOfflineError(error)) throw fail(ar ? 'لا يوجد اتصال بالإنترنت؛ لم يُحذف القيد.' : 'No connection: the entry was not deleted.', 'offline');
      const rejection = syncRejectionMessage(error?.code);
      if (rejection) throw fail(rejection, error.code);
      handleFirestoreError(error, OperationType.DELETE, `users/${uid}/customer_transactions/${txId}`);
    }
  };

  const saveWarehouse = async (warehouse: Warehouse) => {
    if (!user) throw guestWriteBlocked();
    const exists = warehouses.some(w => w.id === warehouse.id);
    const label = exists ? 'تعديل مستودع' : 'إضافة مستودع';
    const labelEn = exists ? 'Edit Warehouse' : 'Add Warehouse';
    const finalLabel = settings?.defaultLanguage === 'ar' ? label : labelEn;
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم ${exists ? 'تعديل' : 'إضافة'} المستودع: ${warehouse.name}`
      : `Warehouse ${exists ? 'updated' : 'added'}: ${warehouse.name}`;

    try {
      await setDoc(doc(db, 'users', user.uid, 'warehouses', warehouse.id), removeUndefined(warehouse));
      logUserActivity(finalLabel, finalDetails, 'warehouse');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/warehouses/${warehouse.id}`);
    }
  };

  const deleteWarehouse = async (id: string) => {
    if (!user) throw guestWriteBlocked();
    const wh = warehouses.find(w => w.id === id);
    const whName = wh ? wh.name : id;
    const finalLabel = settings?.defaultLanguage === 'ar' ? 'حذف مستودع' : 'Delete Warehouse';
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم حذف المستودع: ${whName}`
      : `Warehouse deleted: ${whName}`;

    try {
      await deleteDoc(doc(db, 'users', user.uid, 'warehouses', id));
      logUserActivity(finalLabel, finalDetails, 'warehouse');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/warehouses/${id}`);
    }
  };

  const recordCustomerLedgerTransaction = async (
    customerId: string,
    amount: number,
    type: 'invoice' | 'payment',
    notes: string,
    syncToVault: boolean = false,
    draftId?: string,
  ) => {
    if (!user) throw guestWriteBlocked();
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    if (!Number.isFinite(amount) || amount <= 0) throw fail(ar ? 'المبلغ يجب أن يكون أكبر من صفر.' : 'Amount must be a positive number', 'invalid-amount');
    // Hand-typed debt increases are not sales — require an audit reason so AR cannot inflate silently.
    let ledgerNotes = String(notes || '').trim();
    if (type === 'invoice') {
      if (checkManualArIncrease(ledgerNotes)) {
        throw fail(
          ar
            ? 'اكتب سبب تسوية الرصيد (3 أحرف على الأقل). هذه ليست فاتورة بيع.'
            : 'Enter a reason for the balance adjustment (at least 3 characters). This is not a sales invoice.',
          'reason-required',
        );
      }
      ledgerNotes = formatManualArNote(ledgerNotes, ar);
    }
    const uid = user.uid;
    const timestamp = Date.now();
    const key = draftId || crypto.randomUUID();
    const txId = `TX_${key}`;
    const vaultRecordId = `VLT_${key}`;

    try {
      await runTransaction(db, async (transaction) => {
        if (draftId && (await transaction.get(doc(db, 'users', uid, 'customer_transactions', txId))).exists()) return;
        // 1. Get current customer (Read)
        const customerRef = doc(db, 'users', uid, 'customers', customerId);
        const customerSnap = await transaction.get(customerRef);
        if (!customerSnap.exists()) {
          throw fail(ar ? 'العميل غير موجود.' : 'Customer does not exist.', 'not-found');
        }
        const customerData = customerSnap.data() as Customer;
        const currency = (customerData.currency || 'JOD') as Currency;
        const currentDebt = roundForCurrency(Number(customerData.totalDebt) || 0, currency);
        const value = roundForCurrency(amount, currency);
        if (value <= 0) throw fail(ar ? 'المبلغ صغير جداً لهذه العملة.' : 'Amount is too small for this currency', 'invalid-amount');

        // 2. Perform vault read only if we will sync an actual cash receipt
        const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
        const shouldSyncVault = syncToVault && type === 'payment';
        let currentVaultData: any = {};
        if (shouldSyncVault) {
          const vaultSnap = await transaction.get(vaultStateRef);
          currentVaultData = vaultSnap.exists() ? vaultSnap.data() : {};
        }

        if (type === 'payment' && value > currentDebt) {
          // A payment larger than the debt would silently erase debt while extra cash enters the vault.
          throw fail(
            ar ? `المبلغ أكبر من دين العميل (${currentDebt}).` : `Payment exceeds the customer's outstanding debt (${currentDebt})`,
            'payment-exceeds-debt',
          );
        }

        // 3. Compute new debt
        const finalDebt = roundForCurrency(type === 'payment' ? currentDebt - value : currentDebt + value, currency);

        // 4. Update customer total debt (Write)
        transaction.update(customerRef, { totalDebt: finalDebt });

        // 5. Record customer ledger transaction (Write)
        const txRef = doc(db, 'users', uid, 'customer_transactions', txId);
        const newTx: CustomerTransaction = {
          id: txId,
          transactionId: txId,
          customerId,
          type,
          amount: value,
          currency,
          exchangeRate: 1,
          date: new Date().toISOString(),
          notes: ledgerNotes || (type === 'payment' ? (ar ? 'دفعة نقدية مسددة' : 'Cash payment') : ledgerNotes),
          remainingBalanceAfter: finalDebt,
          ...(shouldSyncVault ? { vaultRecordId } : {})
        };
        transaction.set(txRef, removeUndefined(newTx));

        // 6. Sync to safe/vault only for payments, not credit invoices
        if (shouldSyncVault) {
          const cashIn = value;
          const { doc: updatedVault, balanceAfter } = applyVaultDelta(currentVaultData, currency, cashIn);
          transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });

          const vaultRecordRef = doc(db, 'users', uid, 'vault_records', vaultRecordId);
          const vaultRecord: VaultTransaction = {
            id: vaultRecordId,
            timestamp,
            type: 'income',
            category: 'sale',
            source: 'customer_payment',
            refId: customerId,
            amount: cashIn,
            currency,
            description: `${notes || 'دفعة عميل'} - ${customerData.name}`,
            balanceAfter
          };
          transaction.set(vaultRecordRef, removeUndefined(vaultRecord));
        }
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}/customer_transactions/${txId}_txn`);
      throw error;
    }
  };

  const supplierWriteError = (error: any, ar: boolean, offlineAr: string, offlineEn: string) => {
    if (error?.notified === false) return error;
    if (isOfflineError(error)) return Object.assign(new Error(ar ? offlineAr : offlineEn), { code: 'offline', notified: false });
    if (String(error?.message || '').startsWith(INSUFFICIENT_VAULT_FUNDS)) {
      return Object.assign(new Error(ar
        ? 'رصيد الخزنة بهذه العملة لا يكفي لهذه الدفعة، فلم تُسجَّل.'
        : 'The vault balance in this currency cannot cover this payment, so it was not recorded.'), { code: 'vault-insufficient', notified: false });
    }
    if (error?.code === 'aborted') {
      return Object.assign(new Error(ar
        ? 'تغيّرت البيانات من جهاز آخر أثناء الحفظ. لم يُسجَّل شيء، أعد المحاولة.'
        : 'The data changed on another device while saving. Nothing was recorded; try again.'), { code: 'aborted', notified: false });
    }
    const rejection = syncRejectionMessage(error?.code);
    if (rejection) return Object.assign(new Error(rejection), { code: error.code, notified: false });
    return error;
  };

  const saveSupplier = async (
    supplier: Pick<Supplier, 'id' | 'name' | 'phone' | 'notes'>,
    openingBalances: Array<{ currency: Currency; amount: number }> = [],
  ) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    const name = supplier.name.trim().replace(/\s+/g, ' ');
    if (!name) throw fail(ar ? 'اكتب اسم المورد.' : 'Enter the supplier name.', 'name-required');
    const sameName = findSupplierByName(suppliers, name);
    if (sameName && sameName.id !== supplier.id) {
      throw fail(ar ? `يوجد مورد مسجّل باسم «${sameName.name}». استخدمه أو اختر اسماً مختلفاً.` : `A supplier named “${sameName.name}” already exists. Use it or choose another name.`, 'supplier-duplicate');
    }
    let created = false;
    try {
      await runTransaction(db, async (transaction) => {
        created = false;
        const supplierRef = doc(db, 'users', uid, 'suppliers', supplier.id);
        const snap = await transaction.get(supplierRef);
        const profile = { name, phone: supplier.phone?.trim() || '', notes: supplier.notes?.trim() || '' };
        if (snap.exists()) {
          // Balances change only through purchases, payments and opening entries.
          transaction.update(supplierRef, profile);
          return;
        }
        created = true;
        let balances: Supplier['balances'] = {};
        const now = Date.now();
        for (const opening of openingBalances) {
          const amount = roundForCurrency(Number(opening.amount) || 0, opening.currency);
          if (amount <= 0) continue;
          balances = withBalance(balances, opening.currency, amount);
          const txId = `open-${supplier.id}-${opening.currency}`;
          const entry: SupplierTransaction = {
            id: txId,
            supplierId: supplier.id,
            type: 'opening',
            amount,
            currency: opening.currency,
            date: now,
            notes: ar ? 'رصيد افتتاحي' : 'Opening balance',
            balanceAfter: supplierBalance({ balances }, opening.currency),
          };
          transaction.set(doc(db, 'users', uid, 'supplier_transactions', txId), removeUndefined(entry));
        }
        const record: Supplier = { id: supplier.id, ...profile, balances, createdAt: now };
        transaction.set(supplierRef, removeUndefined(record));
      });
      logUserActivity(
        ar ? (created ? 'إضافة مورد' : 'تعديل مورد') : (created ? 'Add Supplier' : 'Edit Supplier'),
        ar ? `${created ? 'أُضيف' : 'عُدّل'} المورد: ${name}` : `Supplier ${created ? 'added' : 'updated'}: ${name}`,
        'invoice',
      );
    } catch (error: any) {
      throw supplierWriteError(error, ar, 'لا يوجد اتصال بالإنترنت؛ لم يُحفظ المورد.', 'No connection: the supplier was not saved.');
    }
  };

  const deleteSupplier = async (id: string) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    let name = suppliers.find((s) => s.id === id)?.name || id;
    try {
      await runTransaction(db, async (transaction) => {
        const supplierRef = doc(db, 'users', uid, 'suppliers', id);
        const snap = await transaction.get(supplierRef);
        if (!snap.exists()) return;
        const stored = snap.data() as Supplier;
        name = stored.name || name;
        const open = owedBalances(stored);
        if (open.length) {
          const list = open.map((b) => formatMoney(b.amount, b.currency)).join(ar ? ' و' : ' and ');
          throw fail(ar
            ? `لا يمكن حذف «${name}» لأن رصيد حسابه ${list}. سوِّ الحساب أولاً.`
            : `“${name}” cannot be deleted while the account balance is ${list}. Settle it first.`, 'supplier-has-balance');
        }
        // Purchases and payments stay reversible only while their supplier account exists.
        if (supplierTransactions.some((t) => t.supplierId === id)) {
          throw fail(ar
            ? `لا يمكن حذف «${name}» لأن له حركات في كشف الحساب (مشتريات آجلة أو دفعات). يبقى محفوظاً ليبقى السجل قابلاً للتدقيق.`
            : `“${name}” has statement entries (credit purchases or payments), so it is kept to keep the records auditable.`, 'supplier-has-history');
        }
        transaction.delete(supplierRef);
      });
      logUserActivity(ar ? 'حذف مورد' : 'Delete Supplier', ar ? `حُذف المورد: ${name}` : `Supplier deleted: ${name}`, 'invoice');
    } catch (error: any) {
      throw supplierWriteError(error, ar, 'لا يوجد اتصال بالإنترنت؛ لم يُحذف المورد.', 'No connection: the supplier was not deleted.');
    }
  };

  const orderFail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });

  const saveOrder = async (order: TradeOrder) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const isQuote = order.kind === 'quote';
    const party = (isQuote ? order.customerName : order.supplierName)?.trim();
    if (!party) {
      throw orderFail(isQuote ? (ar ? 'اكتب اسم العميل.' : 'Enter the customer name.') : (ar ? 'اختر المورد.' : 'Choose the supplier.'), 'party-required');
    }
    if (!order.items.length) throw orderFail(ar ? 'أضف صنفاً واحداً على الأقل.' : 'Add at least one item.', 'items-required');
    if (order.items.some((l) => !(Number(l.quantity) > 0) || !(Number(l.unitPrice) >= 0))) {
      throw orderFail(ar ? 'كل كمية يجب أن تكون أكبر من صفر، والسعر لا يكون سالباً.' : 'Every quantity must be above zero and no price can be negative.', 'line-invalid');
    }
    try {
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, 'users', uid, 'orders', order.id);
        const snap = await transaction.get(ref);
        const stored = snap.exists() ? (snap.data() as TradeOrder) : null;
        if (stored?.status === 'converted') {
          throw orderFail(ar ? 'هذا الطلب تحوّل إلى فاتورة ولا يمكن تعديله.' : 'This order became an invoice and can no longer change.', 'order-converted');
        }
        transaction.set(ref, removeUndefined({
          ...order,
          ...(isQuote ? { customerName: party } : { supplierName: party }),
          status: order.status === 'converted' ? stored?.status || 'draft' : order.status,
          invoiceId: stored?.invoiceId,
          invoiceNumber: stored?.invoiceNumber,
          createdAt: stored?.createdAt || order.createdAt || Date.now(),
          updatedAt: Date.now(),
        }));
      });
    } catch (error: any) {
      throw supplierWriteError(error, ar, 'لا يوجد اتصال بالإنترنت؛ لم يُحفظ الطلب.', 'No connection: the order was not saved.');
    }
  };

  const markOrderConverted = async (orderId: string, invoice: Pick<Invoice, 'id' | 'invoiceNumber'>) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    try {
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, 'users', uid, 'orders', orderId);
        const snap = await transaction.get(ref);
        if (!snap.exists()) return;
        const stored = snap.data() as TradeOrder;
        if (stored.status === 'converted') return;
        transaction.set(ref, removeUndefined({
          ...stored, status: 'converted', invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, updatedAt: Date.now(),
        }));
      });
    } catch (error: any) {
      throw supplierWriteError(error, ar, 'لا يوجد اتصال بالإنترنت؛ لم يُربط الطلب بالفاتورة.', 'No connection: the order was not linked to the invoice.');
    }
  };

  const deleteOrder = async (id: string) => {
    if (!user) throw guestWriteBlocked();
    const ar = settings?.defaultLanguage !== 'en';
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'orders', id));
    } catch (error: any) {
      throw supplierWriteError(error, ar, 'لا يوجد اتصال بالإنترنت؛ لم يُحذف الطلب.', 'No connection: the order was not deleted.');
    }
  };

  /** Pays a supplier from the vault. Pass the same `id` when retrying: a payment already saved under it is not paid twice. */
  const recordSupplierPayment = async (input: { id: string; supplierId: string; amount: number; currency: Currency; notes?: string }) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    const amount = roundForCurrency(Number(input.amount) || 0, input.currency);
    if (amount <= 0) throw fail(ar ? 'اكتب مبلغاً أكبر من صفر.' : 'Enter an amount above zero.', 'amount-invalid');
    let saved: { name: string; balanceAfter: number } | null = null;
    try {
      await runTransaction(db, async (transaction) => {
        saved = null;
        const txRef = doc(db, 'users', uid, 'supplier_transactions', input.id);
        if ((await transaction.get(txRef)).exists()) return;
        const supplierRef = doc(db, 'users', uid, 'suppliers', input.supplierId);
        const supplierSnap = await transaction.get(supplierRef);
        if (!supplierSnap.exists()) throw fail(ar ? 'المورد غير موجود (ربما حُذف).' : 'The supplier no longer exists.', 'supplier-not-found');
        const supplier = supplierSnap.data() as Supplier;
        const owed = supplierBalance(supplier, input.currency);
        if (amount > owed) {
          throw fail(ar
            ? `المبلغ أكبر من المستحق للمورد بعملة ${input.currency} (${formatMoney(owed, input.currency)}).`
            : `The amount is more than what is owed to the supplier in ${input.currency} (${formatMoney(owed, input.currency)}).`, 'payment-exceeds-balance');
        }
        const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
        const vaultSnap = await transaction.get(vaultStateRef);
        const { doc: updatedVault, balanceAfter: vaultAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, input.currency, -amount);
        assertVaultCanCover(vaultAfter, input.currency);
        transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
        const vaultRecordId = `sp-${input.id}`;
        const vaultRecord: VaultTransaction = {
          id: vaultRecordId,
          timestamp: Date.now(),
          type: 'expense',
          category: 'purchase',
          source: 'supplier_payment',
          refId: input.supplierId,
          amount,
          currency: input.currency,
          description: `${ar ? 'دفعة للمورد' : 'Supplier payment'} - ${supplier.name}${input.notes?.trim() ? ` (${input.notes.trim()})` : ''}`,
          balanceAfter: vaultAfter,
        };
        transaction.set(doc(db, 'users', uid, 'vault_records', vaultRecordId), removeUndefined(vaultRecord));

        const balances = withBalance(supplier.balances, input.currency, -amount);
        transaction.update(supplierRef, { balances });
        const balanceAfter = supplierBalance({ balances }, input.currency);
        const entry: SupplierTransaction = {
          id: input.id,
          supplierId: input.supplierId,
          type: 'payment',
          amount,
          currency: input.currency,
          vaultRecordId,
          date: Date.now(),
          notes: input.notes?.trim() || undefined,
          balanceAfter,
        };
        transaction.set(txRef, removeUndefined(entry));
        saved = { name: supplier.name, balanceAfter };
      });
    } catch (error: any) {
      throw supplierWriteError(error, ar, 'انقطع الاتصال قبل تأكيد الدفعة. أعد المحاولة عند عودة الاتصال؛ لن تُدفع مرتين.', 'The connection dropped before the payment was confirmed. Try again when online; it will not be paid twice.');
    }
    const done = saved as { name: string; balanceAfter: number } | null;
    if (done) {
      logUserActivity(
        ar ? 'دفعة لمورد' : 'Supplier Payment',
        ar
          ? `دُفع ${formatMoney(amount, input.currency)} للمورد ${done.name} من الخزنة. المتبقي له ${formatMoney(done.balanceAfter, input.currency)}`
          : `Paid ${formatMoney(amount, input.currency)} to ${done.name} from the vault. Still owed ${formatMoney(done.balanceAfter, input.currency)}`,
        'vault',
      );
    }
  };

  /** Deletes a payment or opening entry and undoes it: a payment's cash goes back into the vault. */
  const deleteSupplierTransaction = async (txId: string) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    let removed: SupplierTransaction | null = null;
    try {
      await runTransaction(db, async (transaction) => {
        removed = null;
        const txRef = doc(db, 'users', uid, 'supplier_transactions', txId);
        const txSnap = await transaction.get(txRef);
        if (!txSnap.exists()) return;
        const tx = { ...(txSnap.data() as SupplierTransaction), id: txId };
        if (tx.type === 'purchase' || tx.invoiceId) {
          throw fail(ar
            ? 'هذا القيد ناتج عن فاتورة شراء آجل أو مرتجع مشتريات. احذف الفاتورة نفسها ليُعكس المخزون والرصيد معاً.'
            : 'This entry comes from a credit purchase or a purchase return. Delete that invoice so stock and balance are reversed together.', 'ledger-owned-by-invoice');
        }
        const currency = tx.currency as Currency;
        const amount = roundForCurrency(Number(tx.amount) || 0, currency);
        const supplierRef = doc(db, 'users', uid, 'suppliers', tx.supplierId);
        const supplierSnap = await transaction.get(supplierRef);
        const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
        const vaultSnap = tx.type === 'payment' && tx.vaultRecordId ? await transaction.get(vaultStateRef) : null;
        if (supplierSnap.exists()) {
          const supplier = supplierSnap.data() as Supplier;
          const balances = withBalance(supplier.balances, currency, tx.type === 'payment' ? amount : -amount);
          if (supplierBalance({ balances }, currency) < 0) {
            throw fail(ar
              ? 'دُفع للمورد جزء من هذا الرصيد، فحذفه سيجعل حسابه سالباً. احذف الدفعة المرتبطة أولاً.'
              : 'Part of this balance was already paid, so deleting it would make the account negative. Delete the related payment first.', 'supplier-already-paid');
          }
          transaction.update(supplierRef, { balances });
        }
        if (vaultSnap) {
          const { doc: updatedVault, balanceAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, currency, amount);
          transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });
          const recId = `rev-${txId}`;
          const reversal: VaultTransaction = {
            id: recId,
            type: 'income',
            category: 'purchase',
            source: 'reversal',
            refId: tx.supplierId,
            amount,
            currency,
            description: `${ar ? 'عكس دفعة مورد محذوفة' : 'Reversal - deleted supplier payment'} ${txId}`,
            timestamp: Date.now(),
            balanceAfter,
          };
          transaction.set(doc(db, 'users', uid, 'vault_records', recId), removeUndefined(reversal));
        }
        transaction.delete(txRef);
        removed = tx;
      });
    } catch (error: any) {
      throw supplierWriteError(error, ar, 'لا يوجد اتصال بالإنترنت؛ لم يُحذف القيد.', 'No connection: the entry was not deleted.');
    }
    const done = removed as SupplierTransaction | null;
    if (done) {
      const name = suppliers.find((s) => s.id === done.supplierId)?.name || done.supplierId;
      logUserActivity(
        ar ? 'حذف قيد مورد' : 'Delete Supplier Entry',
        ar
          ? `حُذف ${done.type === 'payment' ? 'دفعة' : 'رصيد افتتاحي'} بقيمة ${formatMoney(done.amount, done.currency)} من حساب ${name}`
          : `Deleted ${done.type} of ${formatMoney(done.amount, done.currency)} from ${name}`,
        done.type === 'payment' ? 'vault' : 'invoice',
      );
    }
  };

  const shiftWriteError = (error: any, ar: boolean, offlineAr: string, offlineEn: string) => {
    if (error?.code === 'shift-closed') {
      return Object.assign(new Error(ar ? 'هذه الوردية مغلقة ولا يمكن تعديلها.' : 'This shift is closed and cannot be changed.'), { code: 'shift-closed', notified: false });
    }
    return supplierWriteError(error, ar, offlineAr, offlineEn);
  };

  const openShift = async (input: { id: string; currency: Currency; openingFloat: number; notes?: string }) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    const raw = Number(input.openingFloat);
    if (!Number.isFinite(raw) || raw < 0) {
      throw fail(ar ? 'رصيد الافتتاح يجب أن يكون صفراً أو أكثر.' : 'The opening float must be zero or more.', 'invalid-amount');
    }
    const openingFloat = roundForCurrency(raw, input.currency);
    // Fast local guard; the transaction also locks via settings/active_shift for multi-device races.
    if (!canOpenShift(shifts, uid, input.id)) {
      throw fail(ar ? 'لديك وردية مفتوحة. أغلقها أولاً قبل فتح وردية جديدة.' : 'You already have an open shift. Close it before opening a new one.', 'shift-open');
    }
    let created = false;
    try {
      await runTransaction(db, async (transaction) => {
        created = false;
        const ref = doc(db, 'users', uid, 'shifts', input.id);
        const lockRef = doc(db, 'users', uid, 'settings', 'active_shift');
        const [snap, lockSnap] = await Promise.all([transaction.get(ref), transaction.get(lockRef)]);
        if (snap.exists()) return;

        if (lockSnap.exists()) {
          const lockedId = String((lockSnap.data() as { shiftId?: string })?.shiftId || '');
          if (lockedId && lockedId !== input.id) {
            const otherSnap = await transaction.get(doc(db, 'users', uid, 'shifts', lockedId));
            if (otherSnap.exists() && (otherSnap.data() as Shift).status === 'open') {
              throw fail(ar ? 'لديك وردية مفتوحة. أغلقها أولاً قبل فتح وردية جديدة.' : 'You already have an open shift. Close it before opening a new one.', 'shift-open');
            }
          }
        }

        created = true;
        const record: Shift = {
          id: input.id,
          status: 'open',
          openedAt: Date.now(),
          currency: input.currency,
          openingFloat,
          openingNotes: input.notes?.trim() || undefined,
          userName: settings?.userName || user.displayName || user.email?.split('@')[0] || undefined,
          actorId: uid,
          actorEmail: user.email || undefined,
        };
        transaction.set(ref, removeUndefined(record));
        transaction.set(lockRef, removeUndefined({ shiftId: input.id, actorId: uid, openedAt: record.openedAt }), { merge: true });
      });
    } catch (error: any) {
      if (error?.code === 'shift-open') throw error;
      throw shiftWriteError(error, ar, 'لا يوجد اتصال بالإنترنت؛ لم تُفتح الوردية.', 'No connection: the shift was not opened.');
    }
    if (created) {
      logUserActivity(
        ar ? 'فتح وردية' : 'Open Shift',
        ar ? `فُتحت وردية برصيد افتتاح ${formatMoney(openingFloat, input.currency)}` : `Shift opened with a float of ${formatMoney(openingFloat, input.currency)}`,
        'vault',
      );
    }
  };

  const closeShift = async (input: { id: string; counted: Partial<Record<Currency, number>>; notes?: string }): Promise<Shift> => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code, notified: false });
    const ownerId = currentWorkspace()?.ownerId;
    // A sale still waiting on this device is not in the invoices yet, so the expected cash would be short of it.
    if (readQueue(uid).some((q) => !ownerId || belongsToStore(q, ownerId))) {
      throw fail(ar
        ? 'توجد مبيعات محفوظة على هذا الجهاز لم تُرسل بعد. اتصل بالإنترنت وانتظر إرسالها ثم أغلق الوردية.'
        : 'Some sales on this device have not been sent yet. Connect, wait for them to send, then close the shift.', 'pending-offline');
    }
    const counted: Partial<Record<Currency, number>> = {};
    for (const [code, value] of Object.entries(input.counted) as Array<[Currency, number | undefined]>) {
      if (value === undefined) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        throw fail(ar ? `النقد المعدود بعملة ${code} يجب أن يكون صفراً أو أكثر.` : `Counted ${code} cash must be zero or more.`, 'invalid-amount');
      }
      counted[code] = roundForCurrency(n, code);
    }
    let closed: Shift | null = null;
    try {
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, 'users', uid, 'shifts', input.id);
        const lockRef = doc(db, 'users', uid, 'settings', 'active_shift');
        const [snap, lockSnap] = await Promise.all([transaction.get(ref), transaction.get(lockRef)]);
        if (!snap.exists()) throw fail(ar ? 'لم تُعثر على الوردية.' : 'Shift not found.', 'not-found');
        const stored = snap.data() as Shift;
        if (stored.status === 'closed') throw fail(ar ? 'هذه الوردية مغلقة مسبقاً.' : 'This shift is already closed.', 'shift-closed');
        const closedAt = Date.now();
        const summary = summarizeShift({ ...stored, id: stored.id || input.id, closedAt }, invoices, closedAt, shifts);
        const missing = summary.filter((t) => counted[t.currency] === undefined && (t.currency === stored.currency || t.expectedCash !== 0));
        if (missing.length) {
          const list = missing.map((t) => t.currency).join(ar ? '، ' : ', ');
          throw fail(ar ? `أدخل النقد المعدود بعملة: ${list}.` : `Enter the counted cash in: ${list}.`, 'count-required');
        }
        const closing = {
          status: 'closed' as const,
          closedAt,
          counted,
          summary,
          closingNotes: input.notes?.trim() || undefined,
          closedByEmail: user.email || undefined,
        };
        closed = { ...stored, ...closing };
        transaction.update(ref, removeUndefined(closing));
        const lockedId = String((lockSnap.exists() ? (lockSnap.data() as { shiftId?: string })?.shiftId : '') || '');
        if (lockedId === input.id || lockedId === stored.id) {
          transaction.delete(lockRef);
        }
      });
    } catch (error: any) {
      if (error?.code === 'shift-closed' || error?.code === 'not-found' || error?.code === 'count-required' || error?.code === 'pending-offline' || error?.code === 'invalid-amount') throw error;
      throw shiftWriteError(error, ar, 'لا يوجد اتصال بالإنترنت؛ لم تُغلق الوردية.', 'No connection: the shift was not closed.');
    }
    const result = closed as Shift | null;
    if (!result) throw fail(ar ? 'لم تُغلق الوردية.' : 'The shift was not closed.', 'not-closed');
    const main = result.summary?.find((t) => t.currency === result.currency);
    const diff = main ? cashDifference(main, result.counted) : null;
    logUserActivity(
      ar ? 'إغلاق وردية' : 'Close Shift',
      main
        ? (ar
          ? `المتوقع ${formatMoney(main.expectedCash, main.currency)}، المعدود ${formatMoney(Number(result.counted?.[main.currency]) || 0, main.currency)}${diff ? `، الفرق ${formatMoney(diff, main.currency)}` : ''}`
          : `Expected ${formatMoney(main.expectedCash, main.currency)}, counted ${formatMoney(Number(result.counted?.[main.currency]) || 0, main.currency)}${diff ? `, difference ${formatMoney(diff, main.currency)}` : ''}`)
        : (ar ? 'أُغلقت الوردية' : 'Shift closed'),
      'vault',
    );
    return result;
  };

  const recalibrateVault = async (newBalance: number, currency: Currency, reason: string) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < 3) {
      const message = ar
        ? 'اكتب سبب التسوية (3 أحرف على الأقل)؛ يُحفظ في سجل التدقيق.'
        : 'Enter a reason for the adjustment (at least 3 characters); it is kept in the audit record.';
      toast.error(message);
      throw Object.assign(new Error(message), { code: 'reason-required', notified: true });
    }
    const timestamp = Date.now();
    const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
    const target = roundForCurrency(Number(newBalance) || 0, currency);
    if (!Number.isFinite(Number(newBalance)) || target < 0) {
      const message = ar ? 'رصيد الخزنة لا يمكن أن يكون سالباً. أدخل المبلغ الموجود فعلاً في الصندوق.' : 'The vault balance cannot be negative. Enter the cash actually in the drawer.';
      toast.error(message);
      throw Object.assign(new Error(message), { code: 'invalid-amount', notified: true });
    }
    let appliedDiff = 0;

    try {
      // Read the SERVER balance inside the transaction (never the possibly stale local state)
      // and write the new balance + its adjustment record atomically.
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(vaultStateRef);
        const balances = readVaultBalances(snap.exists() ? snap.data() : {});
        const diff = roundForCurrency(target - balances[currency], currency);
        appliedDiff = diff;
        if (diff === 0) return;

        balances[currency] = target;
        transaction.set(vaultStateRef, removeUndefined(buildVaultDoc(balances, timestamp)), { merge: true });

        const id = crypto.randomUUID();
        const adjustmentRecord: VaultTransaction = {
          id,
          type: diff > 0 ? 'income' : 'expense',
          category: 'manual',
          source: 'manual',
          amount: Math.abs(diff),
          currency,
          description: trimmedReason,
          timestamp,
          balanceAfter: target
        };
        transaction.set(doc(db, 'users', uid, 'vault_records', id), removeUndefined(adjustmentRecord));
      });

      if (appliedDiff === 0) {
        toast.info(ar ? `لم يتم تغيير رصيد ${currency}` : `No balance change was requested for ${currency}`);
        return;
      }

      const logLabel = settings?.defaultLanguage === 'ar' ? 'معايرة الخزنة' : 'Vault Recalibration';
      const logDetails = settings?.defaultLanguage === 'ar'
        ? `تمت تسوية رصيد الخزنة بعملة ${currency} إلى ${target}. السبب: ${reason || 'تسوية يدوية'}`
        : `Safe vault balance in ${currency} was recalibrated to ${target}. Reason: ${reason || 'Manual settlement'}`;
      logUserActivity(logLabel, logDetails, 'vault');

      toast.success(settings?.defaultLanguage === 'ar' ? `تمت تسوية رصيد الخزنة بعملة ${currency}` : `Vault ${currency} balance adjusted`);
    } catch (error: any) {
      toast.error(settings?.defaultLanguage === 'ar' ? "تعذّرت تسوية الرصيد" : "Failed to adjust the vault balance");
      if (error && typeof error === 'object') error.notified = true;
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}/settings/vault_recalibrate`);
    }
  };

  const activeWorkspace = user && workspace?.userId === user.uid ? workspace : null;
  const storeRole = activeWorkspace?.role ?? 'owner';
  const activePlatformRole = user && platformRole?.uid === user.uid ? platformRole.role : null;
  const activePlatformRoleReady = !user || user.isAnonymous
    ? true
    : !!(platformRoleReady && platformRole?.uid === user.uid);

  useEffect(() => {
    if (!user || user.isAnonymous) {
      setPlatformRole(null);
      setPlatformRoleReady(true);
      return;
    }
    let cancelled = false;
    const uid = user.uid;
    setPlatformRoleReady(false);
    void fetchPlatformRole(user as any).then((role) => {
      if (cancelled) return;
      setPlatformRole({ uid, role });
      setPlatformRoleReady(true);
    });
    return () => { cancelled = true; };
  }, [user?.uid, (user as any)?.email_confirmed_at]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable context value: consumers re-render only when real data changes, not on every
  // provider render (the actions only close over the state listed in the deps below).
  const contextValue = useMemo<FirebaseContextType>(() => ({ 
      user, 
      loading, 
      isAuthenticated: !!user, 
      settings, 
      products, 
      transactions: invoices as any, 
      invoices,
      employees,
      payrollRecords,
      customers,
      customerTransactions,
      suppliers,
      supplierTransactions,
      shifts,
      orders,
      vaultTransactions,
      stockMovements,
      warehouses,
      auditLogs,
      vault,
      saveSettings, 
      saveProduct, 
      deleteProduct, 
      saveInvoice, 
      deleteInvoice,
      createSalesReturn,
      createPurchaseReturn,
      recordVaultTransaction,
      saveEmployee,
      deleteEmployee,
      savePayrollRecord,
      payPayroll,
      deletePayrollRecord,
      saveCustomer,
      deleteCustomer,
      saveCustomerTransaction,
      deleteCustomerTransaction,
      deleteCustomerLedgerTransaction,
      saveWarehouse,
      transferStock,
      applyStocktake,
      deleteWarehouse,
      recordCustomerLedgerTransaction,
      saveSupplier,
      deleteSupplier,
      saveOrder,
      markOrderConverted,
      deleteOrder,
      recordSupplierPayment,
      deleteSupplierTransaction,
      openShift,
      closeShift,
      recalibrateVault,
      logUserActivity,
      logout,
      workspace: activeWorkspace,
      isStoreOwner: storeRole === 'owner',
      can: (action: WorkspaceAction) => roleCan(storeRole, action),
      canOpenScreen: (screen: string) => screen === 'admin-dashboard'
        ? !!activePlatformRole
        : roleCanOpenScreen(storeRole, screen),
      platformRole: activePlatformRole,
      platformRoleReady: activePlatformRoleReady,
}), [
    user, loading, settings, products, invoices, employees, payrollRecords, customers,
    customerTransactions, suppliers, supplierTransactions, shifts, orders, vaultTransactions, stockMovements, warehouses, vault, auditLogs, activeWorkspace,
    activePlatformRole, activePlatformRoleReady,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FirebaseContext.Provider value={contextValue}>
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
};
