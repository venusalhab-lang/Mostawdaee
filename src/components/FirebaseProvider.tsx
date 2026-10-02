import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { testConnection, db, doc, onSnapshot, setDoc, updateDoc, deleteDoc, collection, OperationType, handleFirestoreError, User, signInWithPopup, signOut, auth, GoogleAuthProvider, googleProvider } from '../services/firebase';
import { supabase } from '../supabaseClient';
import { runTransaction } from 'firebase/firestore';
import { Product, AppSettings, Transaction, Employee, Customer, CustomerTransaction, VaultTransaction, Vault, StockMovement, Invoice, Currency, PayrollRecord, Warehouse, AuditLog } from '../types';
import { toast } from 'sonner';
import { setDriveAccessToken } from '../services/googleDrive';
import { isAdminEmail } from '../lib/adminAccess';
import { linkFirebaseAuth } from '../lib/firebaseSession';
import { clearUserCache, migrateLegacyUserCache, readUserCache, removeUserCache, writeUserCache } from '../lib/userStorage';
import { computeStockStatus } from '../lib/stock';
import { INSUFFICIENT_VAULT_FUNDS, applyVaultDelta, buildVaultDoc, planInvoiceVaultEntry, readVaultBalances, roundForCurrency } from '../lib/vaultMath';

// Recursively strips any properties with 'undefined' values, since Firestore errors if passed 'undefined'.
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
  saveProduct: (product: Product, options?: { reason?: string; skipMovement?: boolean }) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  stockMovements: StockMovement[];
  saveInvoice: (invoice: Invoice, options?: { restoreOnly?: boolean }) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  recordVaultTransaction: (record: Omit<VaultTransaction, 'id' | 'timestamp' | 'balanceAfter'>) => Promise<void>;
  saveEmployee: (employee: Employee) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;
  savePayrollRecord: (payroll: PayrollRecord) => Promise<void>;
  payPayroll: (payroll: PayrollRecord) => Promise<void>;
  deletePayrollRecord: (id: string) => Promise<void>;
  saveCustomer: (customer: Customer) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  saveCustomerTransaction: (tx: CustomerTransaction) => Promise<void>;
  deleteCustomerTransaction: (id: string) => Promise<void>;
  deleteCustomerLedgerTransaction: (txId: string, options?: { reverseVault?: boolean }) => Promise<void>;
  saveWarehouse: (warehouse: Warehouse) => Promise<void>;
  deleteWarehouse: (id: string) => Promise<void>;
  recordCustomerLedgerTransaction: (customerId: string, amount: number, type: 'invoice' | 'payment', notes: string, syncToVault?: boolean) => Promise<void>;
  recalibrateVault: (newBalance: number, currency: Currency, reason: string) => Promise<void>;
  logUserActivity: (action: string, details: string, category: 'product' | 'invoice' | 'settings' | 'employee' | 'customer' | 'warehouse' | 'vault' | 'payroll') => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const lastUidRef = useRef<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
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

  const bridgeWarnedRef = useRef(false);
  const reportBridgeFailure = (bridgeError: any) => {
    console.warn('[FirebaseProvider] Firebase auth bridge failed:', bridgeError);
    if (bridgeWarnedRef.current) return;
    bridgeWarnedRef.current = true;
    const lang = typeof document !== 'undefined' && document.documentElement.dir === 'ltr' ? 'en' : 'ar';
    toast.error(
      lang === 'en'
        ? 'Signed in, but cloud sync could not be linked. Your data may not save online until this is fixed.'
        : 'تم تسجيل الدخول لكن تعذّر ربط المزامنة السحابية، وقد لا تُحفظ بياناتك على السحابة حتى تُحل المشكلة.',
      { duration: 9000 }
    );
  };

  useEffect(() => {
    testConnection();

    // Map Supabase user to a firebase-like shape expected across the app
    const mapSessionUser = (sbSession: any) => {
      const sbUser = sbSession?.user;
      if (!sbUser) return null;
      return {
        uid: sbUser.id,
        email: sbUser.email,
        displayName: sbUser.user_metadata?.full_name || sbUser.user_metadata?.name || (sbUser.email || '').split('@')[0],
        isAnonymous: false,
        providerData: sbUser.identities ? sbUser.identities.map((id: any) => ({ providerId: id.provider, email: sbUser.email })) : [{ providerId: 'supabase', email: sbUser.email }]
      } as any;
    };

    // Initialize with current session (if any) with defensive validation
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        let session = data?.session;

        const isValidJwt = (tok: any) => typeof tok === 'string' && tok.split && tok.split('.').length === 3;

        // If there's no session yet but the URL contains an access token (OAuth redirect),
        // wait briefly to allow the Supabase client to parse the URL and populate the session.
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        const looksLikeOAuthCallback = /access_token=|refresh_token=/.test(hash || '');
        if ((!session || !(isValidJwt(session.access_token) || isValidJwt(session.refresh_token))) && looksLikeOAuthCallback) {
          await new Promise(res => setTimeout(res, 700));
          const { data: retryData } = await supabase.auth.getSession();
          session = retryData?.session;
        }

        if (session && session.access_token) {
          const mapped = mapSessionUser(session);
          if (mapped) {
            try {
              await linkFirebaseAuth(session.access_token, mapped.uid);
            } catch (bridgeError) {
              reportBridgeFailure(bridgeError);
            }
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
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();

    // Subscribe to future auth state changes from Supabase
    // IMPORTANT: Supabase holds its auth lock while this callback runs. Awaiting network calls
    // here would block every other supabase request (getSession, queries...) and freeze the app,
    // so the real work is deferred with setTimeout.
    const { data } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setTimeout(async () => {
        if (session && session.access_token) {
          const mapped = mapSessionUser(session);
          if (mapped) {
            try {
              await linkFirebaseAuth(session.access_token, mapped.uid);
            } catch (bridgeError) {
              reportBridgeFailure(bridgeError);
            }
            lastUidRef.current = mapped.uid;
            setUser((prev) => (prev && prev.uid === mapped.uid ? prev : wrapUserWithId(mapped as any)));
          }
          return;
        }

        clearUserCache(lastUidRef.current);
        lastUidRef.current = null;
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

        // 2. Fetch the corresponding profile from profiles table to read existing role
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, role, is_premium, subscription_status')
          .eq('id', sbUserId)
          .maybeSingle();

        const roleToAssign = isAdminEmail(emailVal) ? 'super_admin' : (existingProfile?.role || 'user');

        const profileData: any = {
          id: sbUserId,
          user_name: nameVal || emailVal.split('@')[0] || 'System User',
          business_name: businessVal || 'Main Warehouse',
          default_language: langVal || 'ar',
          role: roleToAssign,
          updated_at: new Date().toISOString()
        };

        if (existingProfile) {
          if (existingProfile.is_premium !== undefined) {
            profileData.is_premium = existingProfile.is_premium;
          }
          if (existingProfile.subscription_status !== undefined) {
            profileData.subscription_status = existingProfile.subscription_status;
          }
        }

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
          const trialStart = new Date().toISOString();
          const trialExpiry = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();
          await supabase
            .from('user_subscriptions')
            .insert({
              user_id: sbUserId,
              trial_start_date: trialStart,
              subscription_status: 'trial',
              expiry_date: trialExpiry,
              updated_at: new Date().toISOString()
            });
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

    // Background Offline Invoices Sync Engine
    const syncOfflineInvoices = async () => {
      try {
        const offlineInvoices: Invoice[] = readUserCache(uid, 'offline_invoices', []);
        if (offlineInvoices.length === 0) return;

        console.info(`[Offline Sync] Found ${offlineInvoices.length} offline invoices. Starting sync...`);
        const remainingInvoices: Invoice[] = [];
        
        for (const invoice of offlineInvoices) {
          try {
            // Attempt to write using standard transaction
            await runTransaction(db, async (transaction) => {
              const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
              const vaultSnap = await transaction.get(vaultStateRef);
              
              const currentVaultData = vaultSnap.exists() ? vaultSnap.data() : {};

              for (const item of invoice.items) {
                const productRef = doc(db, 'users', uid, 'inventory', item.productId);
                const productSnap = await transaction.get(productRef);
                
                let productData: Product;
                let newQuantity = 0;
                const soldQty = Number(item.quantity) || 0;
                const unitPrice = Number(item.unitPrice) || 0;
                
                if (!productSnap.exists()) {
                  const isFallback = item.productId.startsWith('fb-');
                  const initialQty = isFallback ? 100 : 50;
                  
                  newQuantity = invoice.type === 'sale' 
                    ? initialQty - soldQty 
                    : initialQty + soldQty;

                  productData = {
                    id: item.productId,
                    name: item.description || `Product ${item.productId}`,
                    sku: isFallback ? `JU-${item.productId.split('-')[1] || '1'}` : `SKU-${item.productId}`,
                    category: isFallback ? 'Beverages' : 'General',
                    brand: isFallback ? 'Demo' : 'Generic',
                    quantity: newQuantity,
                    unitCost: Number((unitPrice * 0.6).toFixed(4)),
                    sellingPrice: unitPrice,
                    status: computeStockStatus(newQuantity, undefined, settings?.lowStockThreshold),
                    dateAdded: Date.now()
                  };
                  
                  transaction.set(productRef, removeUndefined(productData));
                } else {
                  productData = productSnap.data() as Product;
                  const currentQty = Number(productData.quantity) || 0;
                  
                  newQuantity = invoice.type === 'sale' ? currentQty - soldQty : currentQty + soldQty;
                  
                  transaction.update(productRef, { 
                    quantity: newQuantity,
                    status: computeStockStatus(newQuantity, productData.lowStockThreshold, settings?.lowStockThreshold)
                  });
                }
              }

              const plan = planInvoiceVaultEntry(invoice);
              if (plan) {
                const { doc: updatedVault, balanceAfter } = applyVaultDelta(
                  currentVaultData, plan.currency, plan.type === 'income' ? plan.amount : -plan.amount);
                transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });

                const vaultRecordId = crypto.randomUUID();
                const vaultRecordRef = doc(db, 'users', uid, 'vault_records', vaultRecordId);
                const vaultRecord: VaultTransaction = { ...plan, id: vaultRecordId, timestamp: Date.now(), balanceAfter };
                transaction.set(vaultRecordRef, removeUndefined(vaultRecord));
              }

              const invoiceRef = doc(db, 'users', uid, 'invoices', invoice.id);
              transaction.set(invoiceRef, removeUndefined(invoice));
            });
          } catch (itemErr) {
            console.error(`[Offline Sync] Failed to sync invoice #${invoice.invoiceNumber}:`, itemErr);
            remainingInvoices.push(invoice);
          }
        }

        if (remainingInvoices.length === 0) {
          removeUserCache(uid, 'offline_invoices');
          toast.success(settings?.defaultLanguage === 'ar'
            ? "تمت مزامنة جميع المبيعات والفواتير المعلقة ببديل الاتصال بنجاح!"
            : "All pending offline invoices successfully synced to Cloud Firestore!"
          );
        } else {
          writeUserCache(uid, 'offline_invoices', remainingInvoices);
        }
      } catch (err) {
        console.warn("[Offline Sync] Synced handler error:", err);
      }
    };

    // Defer sync by 5 seconds after startup to ensure main services are loaded
    const syncTimer = setTimeout(() => {
      if (isMounted) {
        syncOfflineInvoices();
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      clearTimeout(syncTimer);
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
    try {
      clearUserCache(lastUidRef.current || user?.uid);
      lastUidRef.current = null;
      await signOut(auth);
      try {
        if (supabase) {
          await supabase.auth.signOut().catch(() => {});
        }
      } catch (err) {}
    } catch (error) {
      toast.error("Logout failed");
    }
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

  const recordStockMovement = async (previous: Product | undefined, next: Product, reason?: string) => {
    const before = Number(previous?.quantity) || 0;
    const after = Number(next.quantity) || 0;
    if (previous && before === after) return;
    if (!previous && after === 0) return;

    const movement: StockMovement = {
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
    setStockMovements(prev => [movement, ...prev]);
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid, 'stock_movements', movement.id), removeUndefined(movement));
    } catch (e) {
      // The audit trail must never break a product save.
      console.warn('[stock_movements] could not persist movement:', e);
    }
  };

  const saveProduct = async (product: Product, options?: { reason?: string; skipMovement?: boolean }) => {
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
    if (!user) {
      if (!options?.skipMovement) await recordStockMovement(previousProduct, product, options?.reason);
      return;
    }
    try {
      await setDoc(doc(db, 'users', user.uid, 'inventory', product.id), removeUndefined(product));
      logUserActivity(finalActionLabel, finalDetails, 'product');
      if (!options?.skipMovement) await recordStockMovement(previousProduct, product, options?.reason);
    } catch (error: any) {
      // Rejected by the server (rules / invalid data): this is NOT a connectivity problem, so undo the optimistic update and tell the caller.
      if (error?.code === 'permission-denied' || error?.code === 'invalid-argument') {
        setProducts(prev => {
          const reverted = previousProduct
            ? prev.map(p => p.id === product.id ? previousProduct : p)
            : prev.filter(p => p.id !== product.id);
          try { writeUserCache(user.uid, 'products', reverted); } catch (e) {}
          return reverted;
        });
        throw new Error(settings?.defaultLanguage === 'ar'
          ? 'رفض الخادم حفظ المنتج. تحقق من البيانات (الاسم حتى 200 حرف، الباركود حتى 64 حرفاً).'
          : 'The server rejected this product. Check the data (name up to 200 chars, SKU up to 64 chars).');
      }
      console.warn("Firestore saveProduct error, falling back to local storage:", error);
      // Soft-fail with a message instead of a crash to keep the app highly resilient
      toast.error(settings?.defaultLanguage === 'ar' 
        ? "تم الحفظ محلياً مؤقتاً بسبب ضعف الاتصال بالشبكة" 
        : "Saved locally (network is interrupted/weak)");
    }
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

    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'inventory', id));
      logUserActivity(finalActionLabel, finalDetails, 'product');
    } catch (error) {
      console.warn("Firestore deleteProduct error, falling back to local storage:", error);
      toast.error(settings?.defaultLanguage === 'ar' 
        ? "تم الحذف محلياً مؤقتاً بسبب ضعف الاتصال بالشبكة" 
        : "Deleted locally (network is interrupted/weak)");
    }
  };

  const saveInvoice = async (invoice: Invoice, options?: { restoreOnly?: boolean }) => {
    if (!user) throw new Error('No active session: sale was not saved');
    const uid = user.uid;

    // Backup restore: the backup already contains products + vault state, so only the document is written
    // (replaying stock/vault effects would double-apply them).
    if (options?.restoreOnly) {
      await setDoc(doc(db, 'users', uid, 'invoices', invoice.id), removeUndefined(invoice));
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        // 1. Get current vault balance
        const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
        const vaultSnap = await transaction.get(vaultStateRef);
        
        const currentVaultData = vaultSnap.exists() ? vaultSnap.data() : {};

        // 2. Validate and Update Inventory
        for (const item of invoice.items) {
          const productRef = doc(db, 'users', uid, 'inventory', item.productId);
          const productSnap = await transaction.get(productRef);
          
          let productData: Product;
          let newQuantity = 0;
          const soldQty = Number(item.quantity) || 0;
          const unitPrice = Number(item.unitPrice) || 0;
          
          if (!productSnap.exists()) {
            const isFallback = item.productId.startsWith('fb-');
            const initialQty = isFallback ? 100 : 50;
            
            newQuantity = invoice.type === 'sale' 
              ? initialQty - soldQty 
              : initialQty + soldQty;

            productData = {
              id: item.productId,
              name: item.description || `Product ${item.productId}`,
              sku: isFallback ? `JU-${item.productId.split('-')[1] || '1'}` : `SKU-${item.productId}`,
              category: isFallback ? 'Beverages' : 'General',
              brand: isFallback ? 'Demo' : 'Generic',
              quantity: newQuantity,
              unitCost: Number((unitPrice * 0.6).toFixed(4)),
              sellingPrice: unitPrice,
              status: computeStockStatus(newQuantity, undefined, settings?.lowStockThreshold),
              dateAdded: Date.now()
            };
            
            transaction.set(productRef, removeUndefined(productData));
          } else {
            productData = productSnap.data() as Product;
            const currentQty = Number(productData.quantity) || 0;
            
            if (invoice.type === 'sale' && currentQty < soldQty) {
              throw new Error(`Insufficient stock for ${productData.name}. Available: ${currentQty}`);
            }

            newQuantity = invoice.type === 'sale' 
              ? currentQty - soldQty 
              : currentQty + soldQty;
            
            transaction.update(productRef, { 
              quantity: newQuantity,
              status: computeStockStatus(newQuantity, productData.lowStockThreshold, settings?.lowStockThreshold)
            });
          }
        }

        const plan = planInvoiceVaultEntry(invoice);

        // 3. Update Vault (credit sales don't touch the vault until the customer pays)
        if (plan) {
          const { doc: updatedVault, balanceAfter } = applyVaultDelta(
            currentVaultData, plan.currency, plan.type === 'income' ? plan.amount : -plan.amount);
          if (plan.type === 'expense') assertVaultCanCover(balanceAfter, plan.currency); // purchases are paid from the vault
          transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });

          // 5. Record Vault Transaction
          const vaultRecordId = crypto.randomUUID();
          const vaultRecordRef = doc(db, 'users', uid, 'vault_records', vaultRecordId);
          const vaultRecord: VaultTransaction = { ...plan, id: vaultRecordId, timestamp: Date.now(), balanceAfter };
          transaction.set(vaultRecordRef, removeUndefined(vaultRecord));
        }

        // 4. Save Invoice
        const invoiceRef = doc(db, 'users', uid, 'invoices', invoice.id);
        transaction.set(invoiceRef, removeUndefined(invoice));
      });

      toast.success(invoice.type === 'sale' ? "Sale recorded" : "Purchase recorded");
    } catch (error: any) {
      if (String(error?.message || '').startsWith(INSUFFICIENT_VAULT_FUNDS)) {
        throw error; // callers show a localized message
      }
      if (String(error?.message || '').startsWith('Insufficient stock')) {
        toast.error(error.message);
        throw error;
      }
      console.warn("[Firebase saveInvoice] Transaction failed, trying offline fallback:", error);
      
      try {
        // --- OFFLINE FALLBACK ENGINE ---
        // 1. Update Products (Inventory) locally
        const updatedProducts = [...products];
        for (const item of invoice.items) {
          const idx = updatedProducts.findIndex(p => p.id === item.productId);
          const soldQty = Number(item.quantity) || 0;
          if (idx !== -1) {
            const currentQty = Number(updatedProducts[idx].quantity) || 0;
            const newQty = invoice.type === 'sale' ? currentQty - soldQty : currentQty + soldQty;
            updatedProducts[idx] = {
              ...updatedProducts[idx],
              quantity: newQty,
              status: computeStockStatus(newQty, updatedProducts[idx].lowStockThreshold, settings?.lowStockThreshold)
            };
          }
        }
        setProducts(updatedProducts);
        try {
          if (user?.uid) writeUserCache(user.uid, 'products', updatedProducts);
        } catch (e) {}

        // 2. Update Vault State locally
        const plan = planInvoiceVaultEntry(invoice);
        let localUpdatedVault: Vault | null = null;
        let localVaultTx: VaultTransaction | null = null;
        if (plan) {
          const { doc: nextDoc, balanceAfter } = applyVaultDelta(
            vault, plan.currency, plan.type === 'income' ? plan.amount : -plan.amount);
          localUpdatedVault = nextDoc;
          localVaultTx = { ...plan, id: `local-vtx-${Date.now()}`, timestamp: Date.now(), balanceAfter };
          setVault(localUpdatedVault);
          setVaultTransactions(prev => [localVaultTx as VaultTransaction, ...prev]);
        }

        // 3. Update Invoices list
        setInvoices(prev => [invoice, ...prev].sort((a,b) => b.date - a.date));

        // 4. Persist the local vault state so a reload doesn't lose it
        try {
          if (user?.uid && localUpdatedVault) writeUserCache(user.uid, 'vault', localUpdatedVault);
        } catch (e) {}

        // 5. Store in Local offline queue for future sync
        let offlineInvoices: Invoice[] = user?.uid ? readUserCache(user.uid, 'offline_invoices', []) : [];
        offlineInvoices.push(invoice);
        if (user?.uid) writeUserCache(user.uid, 'offline_invoices', offlineInvoices);

        // 6. Notify user of offline success
        toast.warning(settings?.defaultLanguage === 'ar'
          ? "تم الحفظ والترحيل محلياً مؤقتاً بسبب ضعف أو انقطاع الاتصال بالشبكة (البيع مستمر)."
          : "Network connectivity weak/offline! Sale recorded and processed locally to ensure seamless POS checkout."
        );
      } catch (fallbackErr) {
        console.error("Offline fallback failed: ", fallbackErr);
        toast.error("Failed to complete transaction locally.");
      }
    }

    // Log the action for administrative audit log trace
    const label = invoice.type === 'sale' ? 'فاتورة مبيعات' : 'فاتورة مشتريات';
    const labelEn = invoice.type === 'sale' ? 'Sale Invoice' : 'Purchase Invoice';
    const finalLabel = settings?.defaultLanguage === 'ar' ? label : labelEn;
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم إنشاء ${label} رقم #${invoice.invoiceNumber} بقيمة ${invoice.totalAmount} ${invoice.currency}`
      : `Created ${labelEn} #${invoice.invoiceNumber} for ${invoice.totalAmount} ${invoice.currency}`;
    logUserActivity(finalLabel, finalDetails, 'invoice');
  };

  const deleteInvoice = async (id: string) => {
    if (!user) return;
    const inv = invoices.find(i => i.id === id);
    const invNum = inv ? inv.invoiceNumber : id;
    const finalLabel = settings?.defaultLanguage === 'ar' ? 'حذف فاتورة' : 'Delete Invoice';
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم حذف الفاتورة رقم #${invNum} بنجاح`
      : `Invoice #${invNum} was successfully deleted`;

    try {
      const uid = user.uid;
      const plan = inv ? planInvoiceVaultEntry(inv) : null;
      if (plan) {
        // Deleting an invoice must undo its cash effect, otherwise the vault drifts from the books.
        await runTransaction(db, async (transaction) => {
          const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
          const vaultSnap = await transaction.get(vaultStateRef);
          const reverseDelta = plan.type === 'income' ? -plan.amount : plan.amount;
          const { doc: updatedVault, balanceAfter } = applyVaultDelta(vaultSnap.exists() ? vaultSnap.data() : {}, plan.currency, reverseDelta);
          transaction.set(vaultStateRef, removeUndefined(updatedVault), { merge: true });

          const recId = crypto.randomUUID();
          const reversal: VaultTransaction = {
            ...plan,
            id: recId,
            type: plan.type === 'income' ? 'expense' : 'income',
            description: `Reversal - deleted invoice #${invNum}`,
            source: 'reversal',
            timestamp: Date.now(),
            balanceAfter,
          };
          transaction.set(doc(db, 'users', uid, 'vault_records', recId), removeUndefined(reversal));
          transaction.delete(doc(db, 'users', uid, 'invoices', id));
        });
      } else {
        await deleteDoc(doc(db, 'users', uid, 'invoices', id));
      }
      logUserActivity(finalLabel, finalDetails, 'invoice');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/invoices/${id}`);
    }
  };

  /** Cash cannot go below zero: an expense that the per-currency balance can't cover is rejected. */
  const assertVaultCanCover = (balanceAfter: number, currency: Currency) => {
    if (balanceAfter < 0) {
      const available = roundForCurrency(balanceAfter, currency); // negative => shortfall
      throw new Error(`${INSUFFICIENT_VAULT_FUNDS} (${currency}). Short by ${Math.abs(available)}`);
    }
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
    if (!user) throw new Error('No active session: vault movement was not saved');
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
    if (!user) return;
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
    if (!user) return;
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
    if (!user) return;
    const finalLabel = settings?.defaultLanguage === 'ar' ? 'تسجيل راتب' : 'Record Payroll';
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم تسجيل دفعة راتب للموظف: ${payroll.employeeName} لشهر ${payroll.monthYear} بقيمة صافي: ${payroll.netSalary}`
      : `Payroll payment recorded for ${payroll.employeeName} (${payroll.monthYear}) - Net: ${payroll.netSalary}`;

    try {
      await setDoc(doc(db, 'users', user.uid, 'payroll', payroll.id), removeUndefined(payroll));
      logUserActivity(finalLabel, finalDetails, 'payroll');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/payroll/${payroll.id}`);
    }
  };

  /**
   * Pays a salary atomically: the payroll document (status 'paid') and the vault expense are written
   * in ONE transaction, so a failure can never leave a paid salary without a vault movement (or the reverse).
   */
  const payPayroll = async (payroll: PayrollRecord) => {
    if (!user) throw new Error('No active session: salary was not paid');
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
    if (!user) return;
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

  const saveCustomer = async (customer: Customer) => {
    if (!user) return;
    const exists = customers.some(c => c.id === customer.id);
    const label = exists ? 'تعديل عميل' : 'إضافة عميل';
    const labelEn = exists ? 'Edit Customer' : 'Add Customer';
    const finalLabel = settings?.defaultLanguage === 'ar' ? label : labelEn;
    const finalDetails = settings?.defaultLanguage === 'ar'
      ? `تم ${exists ? 'تعديل بيانات' : 'إضافة'} العميل: ${customer.name} (الهاتف: ${customer.phone})`
      : `Customer ${exists ? 'updated' : 'added'}: ${customer.name} (Phone: ${customer.phone})`;

    try {
      await setDoc(doc(db, 'users', user.uid, 'customers', customer.id), removeUndefined(customer));
      logUserActivity(finalLabel, finalDetails, 'customer');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/customers/${customer.id}`);
    }
  };

  const deleteCustomer = async (id: string) => {
    if (!user) return;
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
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid, 'customer_transactions', tx.id), removeUndefined(tx));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/customer_transactions/${tx.id}`);
    }
  };

  const deleteCustomerTransaction = async (id: string) => {
    if (!user) return;
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
    if (!user) throw new Error('No active session: ledger entry was not deleted');
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
    if (!user) return;
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
    if (!user) return;
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
    if (!user) throw new Error('No active session: customer movement was not saved');
    const uid = user.uid;
    const timestamp = Date.now();
    const txId = `TX_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const vaultRecordId = `VLT_${timestamp}_${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      await runTransaction(db, async (transaction) => {
        // 1. Get current customer (Read)
        const customerRef = doc(db, 'users', uid, 'customers', customerId);
        const customerSnap = await transaction.get(customerRef);
        if (!customerSnap.exists()) {
          throw new Error('Customer does not exist!');
        }
        const customerData = customerSnap.data() as Customer;
        const currentDebt = customerData.totalDebt || 0;

        // 2. Perform vault read only if we will sync an actual cash receipt
        const vaultStateRef = doc(db, 'users', uid, 'settings', 'vault');
        const shouldSyncVault = syncToVault && type === 'payment';
        let currentVaultData: any = {};
        if (shouldSyncVault) {
          const vaultSnap = await transaction.get(vaultStateRef);
          currentVaultData = vaultSnap.exists() ? vaultSnap.data() : {};
        }

        if (type === 'payment' && amount > currentDebt + 1e-9) {
          // A payment larger than the debt would silently erase debt while extra cash enters the vault.
          throw new Error(`Payment exceeds the customer's outstanding debt (${currentDebt})`);
        }

        // 3. Compute new debt
        const finalDebt = type === 'payment'
          ? Math.max(0, currentDebt - amount)
          : currentDebt + amount;

        // 4. Update customer total debt (Write)
        transaction.update(customerRef, { totalDebt: finalDebt });

        // 5. Record customer ledger transaction (Write)
        const txRef = doc(db, 'users', uid, 'customer_transactions', txId);
        const newTx: CustomerTransaction = {
          id: txId,
          transactionId: txId,
          customerId,
          type,
          invoiceId: type === 'invoice' ? `INV_${Math.floor(1000 + Math.random() * 9000)}` : undefined,
          amount,
          currency: customerData.currency,
          exchangeRate: 1.0,
          date: new Date().toISOString(),
          notes: notes || (type === 'payment' ? 'دفعة نقدية مسددة' : 'فاتورة بيع بالآجل'),
          remainingBalanceAfter: finalDebt,
          ...(shouldSyncVault ? { vaultRecordId } : {})
        };
        transaction.set(txRef, removeUndefined(newTx));

        // 6. Sync to safe/vault only for payments, not credit invoices
        if (shouldSyncVault) {
          const currency = (customerData.currency || 'JOD') as Currency;
          const cashIn = roundForCurrency(amount, currency); // all cash received enters the vault, even if above the debt
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
    if (!user) throw new Error('No active session: vault was not changed');
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
