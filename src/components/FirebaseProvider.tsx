import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { OperationType, handleFirestoreError, User, signInWithPopup, signOut, auth, GoogleAuthProvider, googleProvider } from '../services/firebase';
import { supabase } from '../supabaseClient';
import { SYNC_PROBLEM_EVENT, collection, db, deleteDoc, doc, onSnapshot, resetSync, runTransaction, setDoc, updateDoc } from '../lib/supabaseDocs';
import { Product, AppSettings, Transaction, Employee, Customer, CustomerTransaction, VaultTransaction, Vault, StockMovement, Invoice, Currency, PayrollRecord, Warehouse, AuditLog } from '../types';
import { toast } from 'sonner';
import { setDriveAccessToken } from '../services/googleDrive';
import { completeOAuthSessionFromLocation, urlLooksLikeOAuthCallback } from '../lib/completeOAuthSession';
import { clearUserCache, migrateLegacyUserCache, readUserCache, removeUserCache, writeUserCache } from '../lib/userStorage';
import { computeStockStatus } from '../lib/stock';
import { formatMoney } from '../lib/exchangeRates';
import { snapshotLineCosts, weightedAverageCost } from '../lib/profits';
import { planStockReversal, quantitiesByProduct } from '../lib/invoiceReversal';
import { QueuedInvoice, canQueueOffline, enqueueInvoice, isOfflineError, localSaleShortages, readQueue, writeQueue } from '../lib/offlineQueue';
import { INSUFFICIENT_VAULT_FUNDS, applyVaultDelta, buildVaultDoc, planInvoiceVaultEntry, readVaultBalances, roundForCurrency } from '../lib/vaultMath';

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
  vaultTransactions: VaultTransaction[];
  warehouses: Warehouse[];
  auditLogs: AuditLog[];
  vault: Vault | null;
  saveSettings: (settings: AppSettings) => Promise<void>;
  saveProduct: (product: Product, options?: { reason?: string; skipMovement?: boolean; baseQuantity?: number }) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  stockMovements: StockMovement[];
  /** Resolves with the invoice number actually stored (the server may add a suffix if another device used it). */
  saveInvoice: (invoice: Invoice, options?: { restoreOnly?: boolean }) => Promise<string>;
  deleteInvoice: (id: string) => Promise<void>;
  recordVaultTransaction: (record: Omit<VaultTransaction, 'id' | 'timestamp' | 'balanceAfter'>) => Promise<void>;
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
  deleteWarehouse: (id: string) => Promise<void>;
  recordCustomerLedgerTransaction: (customerId: string, amount: number, type: 'invoice' | 'payment', notes: string, syncToVault?: boolean) => Promise<void>;
  recalibrateVault: (newBalance: number, currency: Currency, reason: string) => Promise<void>;
  logUserActivity: (action: string, details: string, category: 'product' | 'invoice' | 'settings' | 'employee' | 'customer' | 'warehouse' | 'vault' | 'payroll') => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

function syncRejectionMessage(code: string | undefined): string | null {
  const ar = typeof document === 'undefined' || document.documentElement.dir !== 'ltr';
  if (code === 'schema-missing') {
    return ar
      ? 'المزامنة السحابية غير مفعّلة على الخادم بعد، فلم يُحفظ هذا التغيير في السحابة. تواصل مع الدعم.'
      : 'Cloud sync is not enabled on the server yet, so this change was not saved to the cloud. Contact support.';
  }
  if (code === 'unauthenticated') {
    return ar
      ? 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى لحفظ التغييرات.'
      : 'Your session has ended. Sign in again to save changes.';
  }
  if (code === 'subscription-required') {
    return ar
      ? 'انتهى الاشتراك، فلم يُحفظ هذا التغيير. جدّد الاشتراك من الإعدادات لمتابعة العمل.'
      : 'Your subscription has ended, so this change was not saved. Renew from Settings to continue.';
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
  ar?: boolean;
}

interface CommitInvoiceResult {
  status: 'saved' | 'duplicate';
  negativeStock: string[];
  /** The number actually stored; differs from the requested one when another device already used it. */
  invoiceNumber: string;
}

/** False once the server reports the invoice_numbers collection isn't installed yet. */
let invoiceNumberClaimsEnabled = true;
const MAX_NUMBER_SUFFIX = 20;

/** Reserves a sale number on the server so two devices or tabs can never store the same one. */
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

/**
 * Applies an invoice (stock, vault, document) in one atomic commit. Idempotent by invoice id:
 * an invoice that already exists is never applied twice, so retries and replays are safe.
 */
async function commitInvoice(uid: string, invoice: Invoice, opts: CommitInvoiceOptions): Promise<CommitInvoiceResult> {
  const claim = invoiceNumberClaimsEnabled && invoice.type === 'sale' && !!invoice.invoiceNumber;
  try {
    return await commitInvoiceOnce(uid, invoice, opts, claim);
  } catch (error: any) {
    if (!claim || error?.code !== 'collection-not-installed') throw error;
    invoiceNumberClaimsEnabled = false;
    console.warn('[commitInvoice] invoice_numbers is not installed; saving without a number claim. Run supabase_production_setup.sql.');
    return commitInvoiceOnce(uid, invoice, opts, false);
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
    for (const [productId, { qty: movedQty, description }] of qtyByProduct) {
      const productRef = doc(db, 'users', uid, 'inventory', productId);
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) {
        throw Object.assign(new Error(`${PRODUCT_NOT_FOUND}: ${description || productId}`), { code: 'product-not-found', productName: description || productId });
      }
      const productData = { ...(productSnap.data() as Product), id: productId };
      productsRead.set(productId, productData);
      const currentQty = Number(productData.quantity) || 0;
      if (invoice.type === 'sale' && currentQty < movedQty) {
        if (!opts.allowNegativeStock) {
          throw Object.assign(new Error(`Insufficient stock for ${productData.name}. Available: ${currentQty}`), {
            code: 'insufficient-stock', productName: productData.name, available: currentQty,
          });
        }
        result.negativeStock.push(productData.name);
      }
      const newQuantity = invoice.type === 'sale' ? currentQty - movedQty : currentQty + movedQty;
      const newCost = invoice.type === 'purchase'
        ? weightedAverageCost(
            productData,
            movedQty,
            invoice.items.filter((i) => i.productId === productId).reduce((sum, i) => sum + (Number(i.total) || 0), 0),
            invoice.currency,
            opts.defaultCurrency,
          )
        : null;
      transaction.update(productRef, {
        quantity: newQuantity,
        status: computeStockStatus(newQuantity, productData.lowStockThreshold, opts.lowStockThreshold),
        ...(newCost !== null ? { unitCost: newCost } : {}),
      });
    }
    // Credit, card and wallet invoices don't touch the cash vault.
    const plan = planInvoiceVaultEntry(invoice);
    const invoiceToWrite: Invoice = {
      ...invoice,
      ...(invoice.type === 'sale' ? { items: snapshotLineCosts(invoice.items, productsRead, opts.defaultCurrency) } : {}),
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
    if (invoice.type === 'sale' && invoice.paymentMethod === 'credit') {
      if (!invoice.customerId) {
        throw Object.assign(new Error('Credit sales need a registered customer'), { code: 'customer-required' });
      }
      const customerRef = doc(db, 'users', uid, 'customers', invoice.customerId);
      const customerSnap = await transaction.get(customerRef);
      if (!customerSnap.exists()) {
        throw Object.assign(new Error('Customer not found'), { code: 'customer-not-found' });
      }
      const customer = customerSnap.data() as Customer;
      const debtCurrency = (customer.currency || invoice.currency) as Currency;
      const debtAmount = invoice.debtCurrency === debtCurrency && Number.isFinite(invoice.debtAmount)
        ? Number(invoice.debtAmount)
        : debtCurrency === invoice.currency ? invoice.totalAmount : null;
      if (debtAmount === null) {
        throw Object.assign(new Error('Customer currency changed; reopen the invoice'), { code: 'customer-currency-changed' });
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
        exchangeRate: invoice.totalAmount > 0 ? debtAmount / invoice.totalAmount : 1,
        date: new Date(invoice.date || Date.now()).toISOString(),
        notes: `${opts.ar ? 'فاتورة بيع آجل' : 'Credit sale'} #${invoice.invoiceNumber}`,
        remainingBalanceAfter: remaining,
      };
      transaction.set(doc(db, 'users', uid, 'customer_transactions', txId), removeUndefined(ledgerEntry));
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
        if (urlLooksLikeOAuthCallback()) {
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
      setTimeout(async () => {
        if (event === 'INITIAL_SESSION') return;

        if (session && session.access_token) {
          const mapped = mapSessionUser(session);
          if (mapped) {
            lastUidRef.current = mapped.uid;
            setUser((prev) => (prev && prev.uid === mapped.uid ? prev : wrapUserWithId(mapped as any)));
          }
          return;
        }

        if (event !== 'SIGNED_OUT' && event !== 'USER_DELETED') return;

        clearUserCache(lastUidRef.current);
        lastUidRef.current = null;
        resetSync();
        try { await signOut(auth); } catch (e) {}
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

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const uid = user.uid;
    lastUidRef.current = uid;
    migrateLegacyUserCache(uid);
    setSettings(readUserCache(uid, 'settings', null));
    setProducts(readUserCache(uid, 'products', []));
    setInvoices(readUserCache(uid, 'invoices', []));
    setEmployees(readUserCache(uid, 'employees', []));
    setPayrollRecords(readUserCache(uid, 'payroll', []));
    setCustomers(readUserCache(uid, 'customers', []));
    setCustomerTransactions(readUserCache(uid, 'customer_transactions', []));
    setVaultTransactions(readUserCache(uid, 'vault_records', []));
    setWarehouses(readUserCache(uid, 'warehouses', []));
    setVault(readUserCache(uid, 'vault', null));
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
        const snapData = snap.data() as AppSettings;
        setSettings(snapData);
        try {
          writeUserCache(uid, 'settings', snapData);
        } catch (e) {
          console.error("Local caching failed", e);
        }

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
      } else {
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
      setProducts(items);
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
      const sorted = items.sort((a,b) => b.date - a.date);
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

    // Listen to Vault Transactions
    const vaultRef = collection(db, 'users', uid, 'vault_records');
    const unsubscribeVaultTransactions = onSnapshot(vaultRef, (snap) => {
      if (!isMounted) return;
      const items: VaultTransaction[] = [];
      snap.forEach(doc => items.push({ ...doc.data() } as VaultTransaction));
      const sorted = items.sort((a,b) => b.timestamp - a.timestamp);
      setVaultTransactions(sorted);
      writeUserCache(uid, 'vault_records', sorted);
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
        const stateObj = buildVaultDoc(readVaultBalances(snapData), snapData.lastUpdated || Date.now());
        setVault(stateObj);
        writeUserCache(uid, 'vault', stateObj);
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
      const queue = readQueue(uid);
      if (queue.length === 0) return;
      syncing = true;
      const current = latestSettingsRef.current;
      const ar = current?.defaultLanguage !== 'en';
      const remaining: QueuedInvoice[] = [];
      const negative = new Set<string>();
      const needsReview: string[] = [];
      let sent = 0;
      try {
        for (let i = 0; i < queue.length; i++) {
          const entry = queue[i];
          try {
            const r = await commitInvoice(uid, entry.invoice, {
              lowStockThreshold: current?.lowStockThreshold,
              defaultCurrency: current?.currency || 'JOD',
              allowNegativeStock: true,
              ar: current?.defaultLanguage !== 'en',
            });
            sent += 1;
            r.negativeStock.forEach((name) => negative.add(name));
          } catch (err: any) {
            if (isOfflineError(err) || err?.code === 'unauthenticated') {
              remaining.push(...queue.slice(i));
              break;
            }
            remaining.push({ ...entry, attempts: entry.attempts + 1, lastError: String(err?.message || err) });
            needsReview.push(entry.invoice.invoiceNumber);
          }
        }
      } finally {
        const processed = new Set(queue.map((q) => q.invoice.id));
        const addedMeanwhile = readQueue(uid).filter((q) => !processed.has(q.invoice.id));
        writeQueue(uid, [...remaining, ...addedMeanwhile]);
        syncing = false;
      }
      if (!isMounted) return;
      if (sent > 0) {
        toast.success(ar ? `أُرسلت ${sent} عملية بيع حُفظت أثناء انقطاع الاتصال.` : `${sent} sale(s) taken offline were sent.`);
      }
      if (negative.size > 0) {
        toast.warning(ar
          ? `مبيعات دون اتصال جعلت مخزون هذه الأصناف سالباً، راجع الجرد: ${Array.from(negative).join('، ')}`
          : `Offline sales made stock negative for: ${Array.from(negative).join(', ')}. Please recount.`, { duration: 12000 });
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

  const login = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setDriveAccessToken(credential.accessToken);
        toast.success(settings?.defaultLanguage === 'ar' ? "تم حفظ الوصول إلى Google Drive" : "Google Drive access granted");
      }
    } catch (error) {
      toast.error("Login failed");
      console.error(error);
    }
  };

  const logout = async () => {
    const uid = lastUidRef.current || user?.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const pending = uid ? readQueue(uid).length : 0;
    if (pending > 0) {
      toast.error(ar
        ? `توجد ${pending} عملية بيع محفوظة على هذا الجهاز لم تُرسل بعد. اتصل بالإنترنت وانتظر إرسالها قبل تسجيل الخروج حتى لا تضيع.`
        : `${pending} sale(s) on this device have not been sent yet. Connect and wait for them to send before signing out.`,
        { id: 'logout-pending', duration: 10000 });
      throw Object.assign(new Error('Pending offline sales'), { code: 'pending-offline', notified: true });
    }
    clearUserCache(uid);
    lastUidRef.current = null;
    try { await signOut(auth); } catch { /* legacy Firebase session */ }
    const { error } = await supabase.auth.signOut();
    // Offline, the global sign-out cannot reach the server; still end the session on this device.
    if (error) await supabase.auth.signOut({ scope: 'local' });
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
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/settings/profile`);
    }
  };

  const buildStockMovement = (previous: Product | undefined, next: Product, reason?: string): StockMovement | null => {
    const before = Number(previous?.quantity) || 0;
    const after = Number(next.quantity) || 0;
    if (previous && before === after) return null;
    if (!previous && after === 0) return null;
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
   * Only the difference is applied to the stored quantity, so a sale made meanwhile is never erased.
   */
  const saveProduct = async (product: Product, options?: { reason?: string; skipMovement?: boolean; baseQuantity?: number }) => {
    if (!user) throw guestWriteBlocked();
    // Determine action for logging before state updates
    const exists = products.some(p => p.id === product.id);
    const actionLabel = exists ? 'تعديل منتج' : 'إضافة منتج';
    const actionLabelEn = exists ? 'Edit Product' : 'Add Product';
    const finalActionLabel = settings?.defaultLanguage === 'ar' ? actionLabel : actionLabelEn;
    const finalDetails = settings?.defaultLanguage === 'ar' 
      ? `تم ${exists ? 'تعديل' : 'إضافة'} المنتج: ${product.name} بنجاح (الترميز: ${product.sku})`
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
          let quantity = Number(product.quantity) || 0;
          if (stored) {
            const base = options?.baseQuantity ?? (Number(previousProduct?.quantity) || 0);
            quantity = (Number(stored.quantity) || 0) + (quantity - base);
            if (quantity < 0) {
              throw Object.assign(new Error('Stock would go negative'), { code: 'negative-stock', available: Number(stored.quantity) || 0 });
            }
          }
          saved = { ...product, quantity, status: computeStockStatus(quantity, product.lowStockThreshold, settings?.lowStockThreshold) };
          transaction.set(productRef, removeUndefined(saved));
          movement = buildStockMovement(stored, saved, options?.reason);
          if (movement) transaction.set(doc(db, 'users', uid, 'stock_movements', movement.id), removeUndefined(movement));
        });
        if (saved.quantity !== product.quantity) {
          setProducts(prev => prev.map(p => p.id === saved.id ? saved : p));
        }
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
      throw productWriteError(error);
    }
  };

  /** Moves stock between warehouses in one write: the source and destination change together or not at all. */
  const transferStock = async (productId: string, toWarehouseId: string, quantity: number) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const ar = settings?.defaultLanguage !== 'en';
    const qty = Number(quantity) || 0;
    if (qty <= 0) throw new Error(ar ? 'كمية النقل يجب أن تكون أكبر من صفر.' : 'Transfer quantity must be greater than zero.');
    const reason = ar ? 'نقل بين المستودعات' : 'Warehouse transfer';
    const local = products.find(p => p.id === productId);
    const destinationId = local
      ? products.find(p => p.id !== productId && p.sku === local.sku && (p.warehouseId || '') === toWarehouseId)?.id
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
    });

    try {
      await runTransaction(db, async (transaction) => {
        movements.length = 0;
        const sourceRef = doc(db, 'users', uid, 'inventory', productId);
        const sourceSnap = await transaction.get(sourceRef);
        if (!sourceSnap.exists()) throw new Error(ar ? 'المنتج غير موجود.' : 'Product not found.');
        const source = { ...(sourceSnap.data() as Product), id: productId };
        const available = Number(source.quantity) || 0;
        if (available < qty) {
          throw new Error(ar ? `الكمية المتوفرة ${available} فقط.` : `Only ${available} available.`);
        }
        if (available === qty) {
          transaction.update(sourceRef, { warehouseId: toWarehouseId });
          return;
        }
        const remaining = available - qty;
        transaction.update(sourceRef, {
          quantity: remaining,
          status: computeStockStatus(remaining, source.lowStockThreshold, settings?.lowStockThreshold),
        });
        movements.push(movement(source, available, remaining));

        const destSnap = destinationId ? await transaction.get(doc(db, 'users', uid, 'inventory', destinationId)) : null;
        if (destinationId && destSnap?.exists()) {
          const dest = { ...(destSnap.data() as Product), id: destinationId };
          const before = Number(dest.quantity) || 0;
          const after = before + qty;
          transaction.update(doc(db, 'users', uid, 'inventory', destinationId), {
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
      if (!isOfflineError(error)) {
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
        if (error?.code === 'customer-not-found' || error?.code === 'customer-required') {
          throw notify(ar
            ? 'العميل غير موجود (ربما حُذف). اختر عميلاً مسجلاً للبيع الآجل. لم تُسجَّل العملية.'
            : 'The customer no longer exists. Choose a registered customer for a credit sale. Nothing was recorded.', { code: error.code });
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
        throw error;
      }
    }

    // --- No connection ---
    if (!canQueueOffline(invoice)) {
      throw notify(ar
        ? 'لا يوجد اتصال بالإنترنت. فواتير الشراء والبيع الآجل تحتاج اتصالاً لأنها تمسّ الخزنة أو ديون الزبائن، فلم يُحفظ شيء.'
        : 'No internet connection. Purchases and credit sales need a connection because they touch the vault or customer debt. Nothing was saved.', { code: 'offline' });
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
    if (!enqueueInvoice(uid, queuedInvoice)) {
      throw notify(ar
        ? 'لا يوجد اتصال، وتعذّر حفظ البيع على هذا الجهاز لأن مساحة التخزين ممتلئة. لم تُسجَّل العملية.'
        : 'No connection, and this device has no storage space left to keep the sale. Nothing was recorded.', { code: 'storage-full' });
    }

    const updatedProducts = products.map((p) => {
      const sold = invoice.items.filter((i) => i.productId === p.id).reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
      if (!sold) return p;
      const newQty = (Number(p.quantity) || 0) - sold;
      return { ...p, quantity: newQty, status: computeStockStatus(newQty, p.lowStockThreshold, settings?.lowStockThreshold) };
    });
    setProducts(updatedProducts);
    writeUserCache(uid, 'products', updatedProducts);

    const plan = planInvoiceVaultEntry(invoice);
    if (plan) {
      const { doc: nextDoc, balanceAfter } = applyVaultDelta(vault, plan.currency, plan.type === 'income' ? plan.amount : -plan.amount);
      const localVaultTx: VaultTransaction = { ...plan, id: `inv-${invoice.id}`, timestamp: Date.now(), balanceAfter };
      setVault(nextDoc as Vault);
      setVaultTransactions((prev) => [localVaultTx, ...prev]);
      writeUserCache(uid, 'vault', nextDoc);
    }
    setInvoices((prev) => [queuedInvoice, ...prev.filter((i) => i.id !== invoice.id)].sort((a, b) => b.date - a.date));

    toast.warning(ar
      ? 'لا يوجد اتصال: حُفظ البيع على هذا الجهاز وسيُرسل تلقائياً عند عودة الاتصال. لا تسجّل الخروج قبل ذلك.'
      : 'Offline: the sale is kept on this device and will be sent automatically when the connection returns. Do not sign out before then.',
      { duration: 7000 });

    logInvoice();
    return invoice.invoiceNumber;
  };

  /**
   * Deletes an invoice and undoes everything it did, in one write: stock, vault cash and customer debt.
   * Refuses (and changes nothing) when the books can no longer be reversed honestly.
   */
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

        // 1. Stock
        const current = new Map<string, Product | undefined>();
        for (const productId of quantitiesByProduct(inv.items).keys()) {
          const snap = await transaction.get(doc(db, 'users', uid, 'inventory', productId));
          current.set(productId, snap.exists() ? (snap.data() as Product) : undefined);
        }
        const stock = planStockReversal(inv, current);
        if (stock.shortages.length) {
          const s0 = stock.shortages[0];
          throw fail(ar
            ? `لا يمكن حذف فاتورة الشراء: بيع جزء من بضاعتها. المتوفر من «${s0.name}» ${s0.available} والمطلوب إرجاعه ${s0.needed}.`
            : `Cannot delete this purchase: some goods were already sold. "${s0.name}" has ${s0.available}, ${s0.needed} needed.`, 'insufficient-stock');
        }
        missing = stock.missing;
        for (const u of stock.updates) {
          const product = current.get(u.productId);
          transaction.update(doc(db, 'users', uid, 'inventory', u.productId), {
            quantity: u.quantity,
            status: computeStockStatus(u.quantity, product?.lowStockThreshold, settings?.lowStockThreshold),
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

        // 3. Customer debt
        if (inv.type === 'sale' && inv.paymentMethod === 'credit' && inv.customerId) {
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
    record: Omit<VaultTransaction, 'id' | 'timestamp' | 'balanceAfter'>
  ) => {
    const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
    const vaultSnap = await transaction.get(vaultStateRef);
    const currency = (record.currency || 'JOD') as Currency;
    const amount = roundForCurrency(Number(record.amount) || 0, currency);
    const { doc: updatedVault, balanceAfter } = applyVaultDelta(
      vaultSnap.exists() ? vaultSnap.data() : {}, currency, record.type === 'income' ? amount : -amount);
    if (record.type === 'expense') assertVaultCanCover(balanceAfter, currency);

    const vaultRecordId = crypto.randomUUID();
    const vaultRecordRef = doc(db, 'users', uid, 'vault_records', vaultRecordId);
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

  const recordVaultTransaction = async (record: Omit<VaultTransaction, 'id' | 'timestamp' | 'balanceAfter'>) => {
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
      ? `تم تسجيل دفعة راتب للموظف: ${payroll.employeeName} لشهر ${payroll.monthYear} بقيمة صافي: ${payroll.netSalary}`
      : `Payroll payment recorded for ${payroll.employeeName} (${payroll.monthYear}) - Net: ${payroll.netSalary}`;

    const uid = user.uid;
    try {
      await runTransaction(db, async (transaction) => {
        const payrollRef = doc(db, 'users', uid, 'payroll', payroll.id);
        const existing = await transaction.get(payrollRef);
        // A paid salary must never be turned back into a pending one (its vault expense stays).
        if (existing.exists() && (existing.data() as PayrollRecord).paymentStatus === 'paid') {
          throw new Error('Payroll already paid');
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
          throw new Error('Payroll already paid');
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
          ? `تم صرف راتب ${payroll.employeeName} لشهر ${payroll.monthYear} بقيمة ${amount} ${currency}`
          : `Salary paid to ${payroll.employeeName} (${payroll.monthYear}) - ${amount} ${currency}`,
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
      if (record && record.paymentStatus === 'paid') {
        // A paid salary already left the vault: deleting the record must return the money (reversal entry).
        const currency = (record.currency || settings?.currency || 'JOD') as Currency;
        const amount = roundForCurrency(Number(record.netSalary) || 0, currency);
        await runTransaction(db, async (transaction) => {
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
            description: `Reversal - deleted payroll ${empName} (${period})`,
            timestamp: Date.now(),
            balanceAfter,
          };
          transaction.set(doc(db, 'users', uid, 'vault_records', recId), removeUndefined(reversal));
          transaction.delete(doc(db, 'users', uid, 'payroll', id));
        });
      } else {
        await deleteDoc(doc(db, 'users', uid, 'payroll', id));
      }
      logUserActivity(finalLabel, finalDetails, 'payroll');
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
            notes: ar ? 'رصيد افتتاحي' : 'Opening balance',
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

    try {
      await deleteDoc(doc(db, 'users', user.uid, 'customers', id));
      logUserActivity(finalLabel, finalDetails, 'customer');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/customers/${id}`);
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
    try {
      await runTransaction(db, async (transaction) => {
        const txRef = doc(db, 'users', uid, 'customer_transactions', txId);
        const txSnap = await transaction.get(txRef);
        if (!txSnap.exists()) throw new Error('Ledger entry does not exist');
        const tx = txSnap.data() as CustomerTransaction;

        const customerRef = doc(db, 'users', uid, 'customers', tx.customerId);
        const customerSnap = await transaction.get(customerRef);

        const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
        const reverseVault = tx.type === 'payment' && (options?.reverseVault ?? !!tx.vaultRecordId);
        const vaultSnap = reverseVault ? await transaction.get(vaultStateRef) : null;

        if (customerSnap.exists()) {
          const debt = Number((customerSnap.data() as Customer).totalDebt) || 0;
          // Deleting an invoice removes the debt it added; deleting a payment brings the debt back.
          const finalDebt = Math.max(0, debt + (tx.type === 'invoice' ? -tx.amount : tx.amount));
          transaction.update(customerRef, { totalDebt: finalDebt });
        }

        if (reverseVault && vaultSnap) {
          const currency = (tx.currency || 'JOD') as Currency;
          const amount = roundForCurrency(Number(tx.amount) || 0, currency);
          const { doc: updatedVault, balanceAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, currency, -amount);
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
    syncToVault: boolean = false
  ) => {
    if (!user) throw guestWriteBlocked();
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive number');
    const uid = user.uid;
    const timestamp = Date.now();
    const txId = `TX_${crypto.randomUUID()}`;
    const vaultRecordId = `VLT_${crypto.randomUUID()}`;

    try {
      await runTransaction(db, async (transaction) => {
        // 1. Get current customer (Read)
        const customerRef = doc(db, 'users', uid, 'customers', customerId);
        const customerSnap = await transaction.get(customerRef);
        if (!customerSnap.exists()) {
          throw new Error('Customer does not exist!');
        }
        const customerData = customerSnap.data() as Customer;
        const currency = (customerData.currency || 'JOD') as Currency;
        const currentDebt = roundForCurrency(Number(customerData.totalDebt) || 0, currency);
        const value = roundForCurrency(amount, currency);
        if (value <= 0) throw new Error('Amount is too small for this currency');

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
          throw new Error(`Payment exceeds the customer's outstanding debt (${currentDebt})`);
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
          notes: notes || (type === 'payment' ? 'دفعة نقدية مسددة' : 'فاتورة بيع بالآجل'),
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

  const recalibrateVault = async (newBalance: number, currency: Currency, reason: string) => {
    if (!user) throw guestWriteBlocked();
    const uid = user.uid;
    const timestamp = Date.now();
    const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
    const target = roundForCurrency(Number(newBalance) || 0, currency);
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
          description: reason || `Manual recalibration [${currency}]: Adjusted to ${target}`,
          timestamp,
          balanceAfter: target
        };
        transaction.set(doc(db, 'users', uid, 'vault_records', id), removeUndefined(adjustmentRecord));
      });

      if (appliedDiff === 0) {
        toast.info(settings?.defaultLanguage === 'ar' ? `لم يتم تغيير رصيد ${currency}` : `No balance change was requested for ${currency}`);
        return;
      }

      const logLabel = settings?.defaultLanguage === 'ar' ? 'معايرة الخزنة' : 'Vault Recalibration';
      const logDetails = settings?.defaultLanguage === 'ar'
        ? `تمت إعادة معايرة رصيد الخزنة بال${currency} إلى قيمة ${target}. السبب: ${reason || 'تسوية يدوية'}`
        : `Safe vault balance in ${currency} was recalibrated to ${target}. Reason: ${reason || 'Manual settlement'}`;
      logUserActivity(logLabel, logDetails, 'vault');

      toast.success(settings?.defaultLanguage === 'ar' ? `تمت إعادة معايرة رصيد الخزنة بال${currency} بنجاح` : `Safe/Vault ${currency} balance successfully recalibrated`);
    } catch (error) {
      toast.error(settings?.defaultLanguage === 'ar' ? "فشلت عملية إعادة المعايرة" : "Failed to recalibrate physical safe");
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}/settings/vault_recalibrate`);
    }
  };

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
      deleteWarehouse,
      recordCustomerLedgerTransaction,
      recalibrateVault,
      logUserActivity,
      login, 
      logout 
}), [
    user, loading, settings, products, invoices, employees, payrollRecords, customers,
    customerTransactions, vaultTransactions, stockMovements, warehouses, vault, auditLogs,
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
