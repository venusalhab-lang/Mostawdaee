import React, { useState } from 'react';
import { 
  User, Building2, Percent, Globe, Save, CheckCircle2, 
  Sparkles, Palette, Zap, Moon, Sun, Monitor, 
  ShieldCheck, Bell, Database, Download, RefreshCw, Upload,
  Type, Volume2, Info, Copy, Check, FileText, DatabaseZap, CheckSquare, AlertTriangle,
  Phone, MapPin, Mail, Crown
} from 'lucide-react';
import SubscriptionSettings from './SubscriptionSettings';
import { Language, AppSettings, Currency } from '../types';
import { translations } from '../translations';
import { motion, AnimatePresence } from 'motion/react';
import { TactileButton } from './ui/TactileButton';
import { useFirebase } from './FirebaseProvider';
import { toast } from 'sonner';
import { isSupabaseConfigured, getSupabaseClient, fetchSupabaseProducts, insertSupabaseProduct, SupabaseProductRow, getSupabaseCredentials, saveSupabaseCredentials, clearSupabaseCredentials } from '../services/supabase';
import { db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';

interface Props {
  language: Language;
  onLanguageToggle: () => void;
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
}

type SettingsSection = 'profile' | 'visuals' | 'inventory' | 'notifications' | 'subscription' | 'system';

export default function Settings({ language, onLanguageToggle, settings, onSaveSettings }: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';
  
  const { 
    recalibrateVault, 
    products = [], 
    invoices = [],
    employees = [],
    payrollRecords = [],
    customers = [],
    customerTransactions = [],
    vaultTransactions = [],
    warehouses = [],
    vault = null,
    saveSettings,
    saveWarehouse,
    saveProduct,
    saveInvoice,
    saveEmployee,
    savePayrollRecord,
    saveCustomer,
    saveCustomerTransaction,
    user
  } = useFirebase();
  
  const [activeSection, setActiveSection] = useState<SettingsSection>('visuals');
  const [formData, setFormData] = useState<AppSettings>({
    ...settings,
    primaryColor: settings.primaryColor || '#4f46e5',
    fontSize: settings.fontSize || 14,
    mandatorySerial: settings.mandatorySerial ?? false,
    lowStockThreshold: settings.lowStockThreshold ?? 5,
    soundEffects: settings.soundEffects ?? true,
    toastNotifications: settings.toastNotifications ?? true,
    useManualExchangeRates: settings.useManualExchangeRates ?? false,
    exchangeRateUSD_ILS: settings.exchangeRateUSD_ILS ?? 3.70,
    exchangeRateJOD_ILS: settings.exchangeRateJOD_ILS ?? 5.22,
    exchangeRateJOD_USD: settings.exchangeRateJOD_USD ?? 1.41,
  });

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error(isRtl ? 'حجم الشعار كبير جداً، يرجى اختيار ملف أصغر من 2 ميغابايت' : 'Logo size is too large, please select a file under 2MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, companyLogoUrl: reader.result as string }));
        toast.success(isRtl ? 'تم تحميل الشعار في الإعدادات! اضغط حفظ التغييرات لاعتماده لطباعة الفواتير 📥' : 'Logo uploaded! Click save settings to commit 📥');
      };
      reader.readAsDataURL(file);
    }
  };

  const [selectedBackupForLocalRestore, setSelectedBackupForLocalRestore] = useState<any | null>(null);
  const [isLocalRestoreInProgress, setIsLocalRestoreInProgress] = useState(false);
  
  const [recalibrateData, setRecalibrateData] = useState({ amount: '', currency: 'JOD' as Currency, reason: '' });
  const [showToast, setShowToast] = useState(false);
  
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      toast.error(isRtl ? "متصفحك الحالي لا يدعم إشعارات المتصفح" : "Your browser does not support desktop notifications");
      return;
    }

    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") {
        toast.success(isRtl ? "تم تفعيل الإشعارات الفورية بنجاح! 🔔" : "Direct browser notifications fully enabled! 🔔");
        try {
          new Notification(isRtl ? "مستودعي الذكي" : "Mostawdaee System", {
            body: isRtl ? "تم تفعيل الإشارات اللحظية لنظام الرادار والمبيعات بنجاح." : "Instant radar limits and operations tracking successfully configured.",
          });
        } catch (e) {
          console.error("Could not spawn welcome desktop notification:", e);
        }
      } else {
        toast.error(isRtl ? "تم رفض صلاحية الإشعارات" : "Notification permission denied");
      }
    } else {
      toast.success(isRtl ? "الإشعارات مفعلة بالفعل" : "Notifications are already enabled");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const sections: { id: SettingsSection; label: string; icon: any }[] = [
    { id: 'profile', label: t.traderProfile, icon: User },
    { id: 'visuals', label: t.visuals, icon: Palette },
    { id: 'inventory', label: t.safetyLogic, icon: ShieldCheck },
    { id: 'notifications', label: t.notifications, icon: Bell },
    { id: 'subscription', label: language === 'ar' ? 'الاشتراك' : 'Subscription', icon: Crown },
    { id: 'system', label: t.systemManagement, icon: Database },
  ];

  const handleExportData = () => {
    const payload = {
      products,
      invoices,
      employees,
      payrollRecords,
      customers,
      customerTransactions,
      vaultTransactions,
      warehouses,
      vault,
      settings: formData,
      timestamp: Date.now(),
      creator: user?.email || 'Anonymous',
      app: 'Mostawdaee System'
    };

    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mustawdae_local_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    toast.success(isRtl ? "تم تحميل ملف النسخة الاحتياطية بنجاح! 💾" : "Backup file downloaded successfully! 💾");
  };

  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const backupData = JSON.parse(text);

        // Validation check
        if (!backupData || (backupData.app !== 'Mostawdaee System' && !backupData.products && !backupData.settings)) {
          toast.error(isRtl ? "هذا الملف غير متوافق مع نظام مستودعي الذكي!" : "Invalid file structure! Not a valid Mostawdaee System backup.");
          return;
        }

        setSelectedBackupForLocalRestore(backupData);
      } catch (err) {
        console.error(err);
        toast.error(isRtl ? "خطأ في قراءة وتحليل ملف JSON!" : "Error parsing JSON backup file!");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmLocalRestore = async () => {
    if (!selectedBackupForLocalRestore || !user) return;
    setIsLocalRestoreInProgress(true);
    try {
      toast.info(isRtl ? "جاري البدء في استعادة البيانات المحلية..." : "Starting local system restore...");

      // 1. Settings
      if (selectedBackupForLocalRestore.settings) {
        await saveSettings(selectedBackupForLocalRestore.settings);
        setFormData(selectedBackupForLocalRestore.settings);
      }

      // 2. Warehouses
      if (Array.isArray(selectedBackupForLocalRestore.warehouses)) {
        for (const wh of selectedBackupForLocalRestore.warehouses) {
          await saveWarehouse(wh);
        }
      }

      // 3. Products
      if (Array.isArray(selectedBackupForLocalRestore.products)) {
        for (const prod of selectedBackupForLocalRestore.products) {
          await saveProduct(prod, { skipMovement: true });
        }
      }

      // 4. Invoices
      if (Array.isArray(selectedBackupForLocalRestore.invoices)) {
        for (const item of selectedBackupForLocalRestore.invoices) {
          await saveInvoice(item, { restoreOnly: true });
        }
      }

      // 5. Employees
      if (Array.isArray(selectedBackupForLocalRestore.employees)) {
        for (const emp of selectedBackupForLocalRestore.employees) {
          await saveEmployee(emp);
        }
      }

      // 6. Payroll Records
      if (Array.isArray(selectedBackupForLocalRestore.payrollRecords)) {
        for (const pr of selectedBackupForLocalRestore.payrollRecords) {
          await savePayrollRecord(pr);
        }
      }

      // 7. Customers
      if (Array.isArray(selectedBackupForLocalRestore.customers)) {
        for (const cust of selectedBackupForLocalRestore.customers) {
          await saveCustomer(cust);
        }
      }

      // 8. Customer Transactions
      if (Array.isArray(selectedBackupForLocalRestore.customerTransactions)) {
        for (const tx of selectedBackupForLocalRestore.customerTransactions) {
          await saveCustomerTransaction(tx);
        }
      }

      // 9. Vault Transactions (using setDoc directly)
      if (Array.isArray(selectedBackupForLocalRestore.vaultTransactions)) {
        for (const tx of selectedBackupForLocalRestore.vaultTransactions) {
          await setDoc(doc(db, 'users', user.uid, 'vault_records', tx.id), tx);
        }
      }

      // 10. Vault Balance State direct restoration
      if (selectedBackupForLocalRestore.vault) {
        await setDoc(doc(db, 'users', user.uid, 'settings', 'vault'), selectedBackupForLocalRestore.vault);
      }

      toast.success(
        isRtl 
          ? "تم استعادة كافة البيانات المحلية بنجاح من ملف النسخة الاحتياطية! 🚀" 
          : "Local system restore completed successfully! 🚀"
      );
      setSelectedBackupForLocalRestore(null);
    } catch (err: any) {
      console.error(err);
      toast.error(isRtl ? `فشل الاستعادة: ${err.message}` : `Restore failed: ${err.message}`);
    } finally {
      setIsLocalRestoreInProgress(false);
    }
  };

  const [sqlTab, setSqlTab] = useState<'schema' | 'inserts' | 'supabase'>('schema');
  const [isSqlCopied, setIsSqlCopied] = useState(false);

  // Supabase local overrides states
  const [supabaseSetUrl, setSupabaseSetUrl] = useState(() => getSupabaseCredentials().url);
  const [supabaseSetKey, setSupabaseSetKey] = useState(() => getSupabaseCredentials().key);
  const [localIsConfigured, setLocalIsConfigured] = useState(isSupabaseConfigured());

  const handleSaveLocalSupabase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseSetUrl.trim() || !supabaseSetKey.trim()) {
      toast.error(isRtl ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields');
      return;
    }
    let cleanedUrl = supabaseSetUrl.trim();
    if (cleanedUrl.toLowerCase().includes('kwvrtsnvadjknioqbb')) {
      cleanedUrl = 'https://kwvrtsnvadjknioqbbxs.supabase.co';
    } else {
      cleanedUrl = cleanedUrl.replace(/supabse\.co/gi, 'supabase.co');
      cleanedUrl = cleanedUrl.replace(/supabse\.com/gi, 'supabase.co');
      cleanedUrl = cleanedUrl.replace(/supabase\.com/gi, 'supabase.co');
    }
    setSupabaseSetUrl(cleanedUrl);
    saveSupabaseCredentials(cleanedUrl, supabaseSetKey.trim());
    setLocalIsConfigured(isSupabaseConfigured());
    toast.success(isRtl ? 'تم حفظ مفاتيح Supabase بنجاح!' : 'Supabase credentials saved successfully!');
  };

  const handleClearLocalSupabase = () => {
    clearSupabaseCredentials();
    setSupabaseSetUrl('');
    setSupabaseSetKey('');
    setLocalIsConfigured(false);
    toast.info(isRtl ? 'تم مسح الإعدادات بنجاح!' : 'Credentials cleared.');
  };

  // Supabase dynamic sandbox states
  const [supabaseLoading, setSupabaseLoading] = useState(false);
  const [supabaseSuccess, setSupabaseSuccess] = useState<boolean | null>(null);
  const [supabaseErrorMsg, setSupabaseErrorMsg] = useState('');
  const [supabaseLiveProducts, setSupabaseLiveProducts] = useState<SupabaseProductRow[]>([]);

  const handleTestSupabaseFetch = async () => {
    setSupabaseLoading(true);
    setSupabaseSuccess(null);
    setSupabaseErrorMsg('');
    try {
      const data = await fetchSupabaseProducts();
      if (data) {
        setSupabaseLiveProducts(data);
        setSupabaseSuccess(true);
        toast.success(isRtl ? 'تم الاتصال بـ Supabase وجلب المنتجات بنجاح!' : 'Connected and fetched products from Supabase!');
      } else {
        throw new Error('No data returned from products table.');
      }
    } catch (err: any) {
      setSupabaseSuccess(false);
      setSupabaseErrorMsg(err.message || String(err));
      toast.error(isRtl ? 'فشل جلب المنتجات. يرجى مراجعة قيم المفاتيح وقواعد RLS.' : 'Failed to fetch products. Check credentials and RLS setup.');
    } finally {
      setSupabaseLoading(false);
    }
  };

  const handleSyncToSupabase = async () => {
    if (products.length === 0) {
      toast.error(isRtl ? 'لا توجد منتجات محلية لمزامنتها!' : 'No local products found to sync!');
      return;
    }
    setSupabaseLoading(true);
    setSupabaseSuccess(null);
    setSupabaseErrorMsg('');
    try {
      let syncedCount = 0;
      const client = getSupabaseClient();
      if (!client) {
        throw new Error('Supabase client failed to initialize. Check your credentials.');
      }
      
      const { data: { user: sbUser } } = await client.auth.getUser();
      const finalUserId = sbUser?.id;
      
      if (!finalUserId) {
        throw new Error(isRtl 
          ? 'المستخدم غير مسجل دخوله في Supabase! تتطلب قاعدة RLS وجود معرف مستخدم صالح (user_id REFERENCES auth.users).' 
          : 'No active logged-in user found on Supabase auth. The user_id REFERENCES auth.users(id) requires a valid active UUID user session.'
        );
      }

      for (const prod of products) {
        await insertSupabaseProduct({
          product_name: prod.name,
          quantity: prod.quantity,
          price: prod.sellingPrice,
          user_id: finalUserId
        });
        syncedCount++;
      }
      
      setSupabaseSuccess(true);
      toast.success(isRtl 
        ? `تمت مزامنة ${syncedCount} بنجاح مع جدول products في Supabase Cloud!`
        : `Successfully synced ${syncedCount} products to Supabase Cloud!`
      );
      
      const fresh = await fetchSupabaseProducts();
      if (fresh) setSupabaseLiveProducts(fresh);
    } catch (err: any) {
      setSupabaseSuccess(false);
      setSupabaseErrorMsg(err.message || String(err));
      toast.error(isRtl 
        ? `فشل مزامنة البيانات: ${err.message}` 
        : `Failed to insert products: ${err.message}`
      );
    } finally {
      setSupabaseLoading(false);
    }
  };

  const supabaseIntegrationText = `-- ==========================================================
-- SUPABASE CLOUD DATABASE DDL: products
-- ==========================================================

-- 1. إنشاء جدول المنتجات المطابق تماماً لمتطلباتك:
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    quantity INT DEFAULT 0,
    price NUMERIC(10, 2) DEFAULT 0.00,
    -- هنا المربط: عمود يربط المنتج بالمستخدم اللي أضافه
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL
);

-- 2. تفعيل جدار الحماية ومستوى حماية الصفوف (Row Level Security):
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 3. سياسة القراءة: "المستخدم يرى منتجاته فقط"
CREATE POLICY "المستخدم يرى منتجاته فقط" ON products
    FOR SELECT
    USING (auth.uid() = user_id);

-- 4. سياسة الإضافة: "المستخدم يضيف لنفسه فقط"
CREATE POLICY "المستخدم يضيف لنفسه فقط" ON products
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 5. سياسة التعديل والحذف: "المستخدم يعدل ويحذف منتجاته فقط"
CREATE POLICY "المستخدم يعدل ويحذف منتجاته فقط" ON products
    FOR ALL -- تشمل UPDATE و DELETE
    USING (auth.uid() = user_id);

-- 6. كود جلب المنتجات في تطبيق React/TypeScript:
/*
const { data, error } = await supabase
  .from('products')
  .select('*');
*/`;

  const ddlSchemaText = `-- 1. إنشاء جدول العملات
CREATE TABLE currencies (
    id SERIAL PRIMARY KEY,
    code VARCHAR(3) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    exchange_rate DECIMAL(10, 4) NOT NULL DEFAULT 1.0000,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. إنشاء جدول المنتجات
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(50) UNIQUE,
    quantity INT NOT NULL DEFAULT 0,
    min_safety_quantity INT NOT NULL DEFAULT 5,
    purchase_price DECIMAL(15, 4) NOT NULL DEFAULT 0.0000,
    landed_cost DECIMAL(15, 4) NOT NULL DEFAULT 0.0000, -- حساب التكلفة الواصلة
    selling_price DECIMAL(15, 4) NOT NULL DEFAULT 0.0000,
    currency_id INT REFERENCES currencies(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. إنشاء جدول فواتير المبيعات
CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    invoice_type VARCHAR(20) CHECK (invoice_type IN ('CASH', 'CREDIT')) NOT NULL,
    total_amount DECIMAL(15, 4) NOT NULL DEFAULT 0.0000,
    discount DECIMAL(15, 4) NOT NULL DEFAULT 0.0000,
    currency_id INT REFERENCES currencies(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. إنشاء جدول تفاصيل الفاتورة
CREATE TABLE invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id INT REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id),
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(15, 4) NOT NULL,
    UNIQUE(invoice_id, product_id) -- تمنع تكرار نفس المنتج في نفس الفاتورة كسطرين منفصلين
);

-- إضافة كشافات (Indexes) لتسريع عمليات البحث عن طريق الباركود وفواتير المبيعات
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);`;

  const generateSqlInserts = () => {
    let sql = `-- ==========================================================\n`;
    sql += `-- MOSTAWDAEE POSTGRESQL INSERT DUMP (GENERATED LATEST DATA)\n`;
    sql += `-- Generated At: ${new Date().toISOString()}\n`;
    sql += `-- ==========================================================\n\n`;

    // 1. Currencies
    sql += `-- MAPPING ACTIVE CURRENCIES\n`;
    sql += `INSERT INTO currencies (id, code, name, exchange_rate) VALUES\n`;
    sql += `  (1, 'JOD', 'Jordanian Dinar', 1.0000),\n`;
    sql += `  (2, 'USD', 'US Dollar', 1.4110),\n`;
    sql += `  (3, 'ILS', 'Israeli Shekel', 0.2720)\n`;
    sql += `ON CONFLICT (code) DO UPDATE SET exchange_rate = EXCLUDED.exchange_rate;\n\n`;

    // 2. Products Map & Inserts
    if (products && products.length > 0) {
      sql += `-- MAPPING PRODUCTS (${products.length} ENTRIES)\n`;
      sql += `INSERT INTO products (id, barcode, name, sku, quantity, min_safety_quantity, purchase_price, landed_cost, selling_price, currency_id, created_at) VALUES\n`;
      
      const productLines = products.map((p, idx) => {
        const id = idx + 1;
        const barcode = p.sku || p.id;
        const cleanName = (p.name || '').replace(/'/g, "''");
        const sku = p.sku || `SKU-${id}`;
        const qty = p.quantity || 0;
        const minQty = p.lowStockThreshold || settings.lowStockThreshold || 5;
        const buyPrice = p.unitCost || 0;
        const landCost = p.unitCost || 0;
        const sellPrice = p.sellingPrice || 0;
        
        const currentCur = settings.currency || 'JOD';
        const curId = currentCur === 'JOD' ? 1 : currentCur === 'USD' ? 2 : 3;

        const pDate = p.dateAdded || Date.now();
        const dateStr = `TO_TIMESTAMP(${Math.floor(pDate / 1000)})`;

        return `  (${id}, '${barcode}', '${cleanName}', '${sku}', ${qty}, ${minQty}, ${buyPrice.toFixed(4)}, ${landCost.toFixed(4)}, ${sellPrice.toFixed(4)}, ${curId}, ${dateStr})`;
      });

      sql += productLines.join(',\n') + ';\n\n';
    } else {
      sql += `-- No products recorded in current workspace to export.\n\n`;
    }

    // Maps for foreign keys Referencing ID indexes
    const productIdMap = new Map<string, number>();
    products.forEach((p, idx) => {
      productIdMap.set(p.id, idx + 1);
    });

    // 3. Invoices Inserts
    if (invoices && invoices.length > 0) {
      sql += `-- MAPPING INVOICES (${invoices.length} ENTRIES)\n`;
      sql += `INSERT INTO invoices (id, invoice_number, invoice_type, total_amount, discount, currency_id, created_at) VALUES\n`;

      const invoiceLines = invoices.map((i, idx) => {
        const id = idx + 1;
        const invNo = i.invoiceNumber || `INV-POS-${id}`;
        const type = i.type === 'sale' ? 'CREDIT' : 'CASH';
        const total = i.totalAmount || 0;
        const discount = 0.0000;
        
        const invoiceCur = i.currency || settings.currency || 'JOD';
        const curId = invoiceCur === 'JOD' ? 1 : invoiceCur === 'USD' ? 2 : 3;

        const iDate = i.date || Date.now();
        const dateStr = `TO_TIMESTAMP(${Math.floor(iDate / 1000)})`;

        return `  (${id}, '${invNo}', '${type}', ${total.toFixed(4)}, ${discount.toFixed(4)}, ${curId}, ${dateStr})`;
      });

      sql += invoiceLines.join(',\n') + ';\n\n';

      // 4. Invoice Items Inserts
      sql += `-- MAPPING INVOICE DETAILED ITEMS\n`;
      sql += `INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price) VALUES\n`;

      const itemLines: string[] = [];
      invoices.forEach((i, idx) => {
        const invoiceId = idx + 1;
        if (i.items && Array.isArray(i.items)) {
          i.items.forEach(itm => {
            const mappedProdId = productIdMap.get(itm.productId);
            if (mappedProdId) {
              itemLines.push(`  (${invoiceId}, ${mappedProdId}, ${itm.quantity}, ${itm.unitPrice || 0})`);
            }
          });
        }
      });

      if (itemLines.length > 0) {
        sql += itemLines.join(',\n') + ';\n';
      } else {
        sql += `-- No valid items mapped to invoices.\n`;
      }
    } else {
      sql += `-- No invoices recorded in current workspace to export.\n\n`;
    }

    return sql;
  };

  const handleDownloadFullSql = () => {
    const fullContent = `${ddlSchemaText}\n\n\n-- ==========================================================\n-- INITIAL SEED & DYNAMIC DATA INSERTION\n-- ==========================================================\n\n${generateSqlInserts()}`;
    const blob = new Blob([fullContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mostawdaee_postgresql_migration_dump_${new Date().toISOString().split('T')[0]}.sql`;
    a.click();
    toast.success(isRtl ? 'تم توليد وتنزيل ملف SQL الموحد بنجاح!' : 'Fully consolidated backup .sql generated and downloaded!');
  };

  const handleCopySqlToClipboard = () => {
    const textToCopy = 
      sqlTab === 'schema' 
        ? ddlSchemaText 
        : sqlTab === 'inserts' 
          ? generateSqlInserts() 
          : supabaseIntegrationText;
    navigator.clipboard.writeText(textToCopy);
    setIsSqlCopied(true);
    toast.success(isRtl ? 'تم النسخ إلى الحافظة بنجاح!' : 'Copied selected code blocks to clipboard!');
    setTimeout(() => setIsSqlCopied(false), 2000);
  };

  const accentColors = [
    { name: 'Indigo', value: '#4f46e5' },
    { name: 'Emerald', value: '#10b981' },
    { name: 'Royal Blue', value: '#2563eb' },
    { name: 'Purple', value: '#9333ea' },
    { name: 'Rose', value: '#e11d48' },
    { name: 'Amber', value: '#d97706' },
  ];

  return (
    <div className={`max-w-6xl mx-auto p-4 md:p-8 ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-8 ${isRtl ? 'left-1/2 -translate-x-1/2' : 'right-8'} z-[110] flex items-center gap-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl text-indigo-600 dark:text-indigo-400 px-6 py-4 rounded-2xl shadow-2xl border border-white/20 dark:border-gray-700/30`}
          >
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <span className="font-black block">{t.settingsSaved}</span>
              <span className="text-xs text-gray-500">{new Date().toLocaleTimeString()}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mb-10 text-center md:text-left">
        <h1 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight flex items-center justify-center md:justify-start gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-200 dark:shadow-indigo-900/30 rotate-3">
            <Zap size={28} />
          </div>
          {t.controlCenter}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 text-lg">{t.appSettingsDescription}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Navigation Sidebar */}
        <aside className="lg:col-span-3 space-y-2">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 relative group ${
                  isActive 
                    ? 'bg-white dark:bg-gray-800 shadow-xl shadow-indigo-100/50 dark:shadow-black/20 text-indigo-600 dark:text-indigo-400 font-black' 
                    : 'text-gray-500 hover:bg-white/50 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-gray-300'
                }`}
              >
                <div className={`p-2 rounded-xl transition-colors ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'bg-gray-100 dark:bg-gray-900 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20'}`}>
                  <Icon size={20} />
                </div>
                <span className="text-sm tracking-tight">{section.label}</span>
                {isActive && (
                  <motion.div 
                    layoutId="active-nav"
                    className={`absolute w-1.5 h-6 bg-indigo-600 rounded-full ${isRtl ? 'left-0' : 'right-0'}`}
                  />
                )}
              </button>
            );
          })}
        </aside>

        {/* Content Area */}
        <main className="lg:col-span-9">
          <form onSubmit={handleSubmit} className="space-y-8">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="bg-white/40 dark:bg-gray-900/40 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/20 dark:border-gray-800/50 shadow-2xl space-y-8"
            >
              {activeSection === 'profile' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <User className="text-indigo-600" />
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-wider">{t.traderProfile}</h2>
                  </div>
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-black text-gray-400 uppercase ml-1">{t.userName}</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={formData.userName}
                            onChange={(e) => setFormData({ ...formData, userName: e.target.value })}
                            className="w-full px-5 py-4 bg-white/50 dark:bg-gray-800/50 border border-white dark:border-gray-700/50 rounded-[1.5rem] focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all dark:text-white font-bold"
                            placeholder={t.placeholderUserName}
                          />
                          <User className={`absolute top-4 ${isRtl ? 'left-4' : 'right-4'} text-gray-300`} size={20} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-black text-gray-400 uppercase ml-1">{t.businessName}</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={formData.businessName}
                            onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                            className="w-full px-5 py-4 bg-white/50 dark:bg-gray-800/50 border border-white dark:border-gray-700/50 rounded-[1.5rem] focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all dark:text-white font-bold"
                            placeholder={t.placeholderBusinessName}
                          />
                          <Building2 className={`absolute top-4 ${isRtl ? 'left-4' : 'right-4'} text-gray-300`} size={20} />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-black text-gray-400 uppercase ml-1">{isRtl ? 'الرقم الضريبي للمنشأة' : 'Tax Registration Number'}</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={formData.taxRegistrationNumber || ''}
                            onChange={(e) => setFormData({ ...formData, taxRegistrationNumber: e.target.value })}
                            className="w-full px-5 py-4 bg-white/50 dark:bg-gray-800/50 border border-white dark:border-gray-700/50 rounded-[1.5rem] focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all dark:text-white font-bold font-mono"
                            placeholder={isRtl ? 'أدخل الرقم الضريبي الرسمي للشركة' : 'Enter registered VAT/tax registration ID'}
                          />
                          <FileText className={`absolute top-4 ${isRtl ? 'left-4' : 'right-4'} text-gray-300`} size={20} />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-black text-gray-400 uppercase ml-1">{isRtl ? 'هاتف المنشأة المعتمد' : 'Registered Business Phone'}</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={formData.businessPhone || ''}
                            onChange={(e) => setFormData({ ...formData, businessPhone: e.target.value })}
                            className="w-full px-5 py-4 bg-white/50 dark:bg-gray-800/50 border border-white dark:border-gray-700/50 rounded-[1.5rem] focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all dark:text-white font-bold"
                            placeholder="e.g. +962 7 XXX XXXX"
                          />
                          <Phone className={`absolute top-4 ${isRtl ? 'left-4' : 'right-4'} text-gray-300`} size={20} />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-black text-gray-400 uppercase ml-1">{isRtl ? 'البريد الإلكتروني للعمل' : 'Corporate Email Address'}</label>
                        <div className="relative">
                          <input
                            type="email"
                            value={formData.businessEmail || ''}
                            onChange={(e) => setFormData({ ...formData, businessEmail: e.target.value })}
                            className="w-full px-5 py-4 bg-white/50 dark:bg-gray-800/50 border border-white dark:border-gray-700/50 rounded-[1.5rem] focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all dark:text-white font-bold"
                            placeholder="info@business.com"
                          />
                          <Mail className={`absolute top-4 ${isRtl ? 'left-4' : 'right-4'} text-gray-300`} size={20} />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-black text-gray-400 uppercase ml-1">{isRtl ? 'عنوان المنشأة / الفرع' : 'Operational Address / Branch'}</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={formData.businessAddress || ''}
                            onChange={(e) => setFormData({ ...formData, businessAddress: e.target.value })}
                            className="w-full px-5 py-4 bg-white/50 dark:bg-gray-800/50 border border-white dark:border-gray-700/50 rounded-[1.5rem] focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all dark:text-white font-bold"
                            placeholder={isRtl ? 'عمان، الأردن - الفرع الرئيسي' : 'Amman, Jordan - Main HQ'}
                          />
                          <MapPin className={`absolute top-4 ${isRtl ? 'left-4' : 'right-4'} text-gray-300`} size={20} />
                        </div>
                      </div>
                    </div>

                    {/* Company Logo Upload Block */}
                    <div className="bg-slate-500/[0.02] p-6 rounded-[2rem] border border-slate-200/50 dark:border-white/5 space-y-4">
                      <span className="text-sm font-black text-gray-400 uppercase block mb-1">
                        🖼️ {isRtl ? 'شعار المنشأة الرسمي المطبوع' : 'Official Print-Ready Company Logo'}
                      </span>
                      <div className="flex flex-col sm:flex-row items-center gap-6">
                        {formData.companyLogoUrl ? (
                          <div className="relative shrink-0 w-24 h-24 bg-white rounded-2xl border border-slate-200/80 p-2 flex items-center justify-center group overflow-hidden">
                            <img 
                              src={formData.companyLogoUrl} 
                              alt="Company Logo Preview" 
                              className="max-w-full max-h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                            <button
                              type="button"
                              onClick={() => setFormData(p => ({ ...p, companyLogoUrl: undefined }))}
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-black cursor-pointer"
                            >
                              {isRtl ? 'إزالة 🗑️' : 'Remove 🗑️'}
                            </button>
                          </div>
                        ) : (
                          <div className="w-24 h-24 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center text-[10px] text-slate-400 font-bold">
                            <span>{isRtl ? 'لا يوجد شعار' : 'No Logo Set'}</span>
                          </div>
                        )}

                        <div className="flex-1 space-y-2">
                          <label className="inline-flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl cursor-pointer shadow-lg shadow-indigo-100 dark:shadow-none transition-all active:scale-95 text-center">
                            <Upload size={14} />
                            <span>{isRtl ? 'تحميل شعار من الجهاز' : 'Upload Logo File'}</span>
                            <input 
                              type="file" 
                              accept="image/*" 
                              onChange={handleLogoChange}
                              className="hidden" 
                            />
                          </label>
                          <p className="text-[10px] text-slate-450 dark:text-slate-500 font-semibold leading-relaxed">
                            {isRtl 
                              ? 'سيظهر هذا الشعار تلقائياً في الجزء العلوي للمطبوعات وفواتير العملاء. الصيغ المدعومة (PNG, JPG, SVG) بحد أقصى 2 ميغابايت.'
                              : 'This logo will automatically print at the header of all official sales and purchase invoices. Max file size: 2MB.'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'visuals' && (
                <div className="space-y-8">
                  <div className="flex items-center gap-3">
                    <Palette className="text-purple-600" />
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-wider">{t.visuals}</h2>
                  </div>

                  {/* Accent Color */}
                  <div className="space-y-4">
                    <label className="text-sm font-black text-gray-400 uppercase ml-1">{t.primaryColor}</label>
                    <div className="flex flex-wrap gap-4">
                      {accentColors.map((color) => (
                        <button
                          key={color.value}
                          type="button"
                          onClick={() => setFormData({ ...formData, primaryColor: color.value })}
                          className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
                            formData.primaryColor === color.value ? 'scale-110 shadow-lg ring-4 ring-offset-4 ring-indigo-500/30' : 'hover:scale-105'
                          }`}
                          style={{ backgroundColor: color.value }}
                        >
                          <AnimatePresence>
                            {formData.primaryColor === color.value && (
                              <motion.div 
                                initial={{ scale: 0 }} 
                                animate={{ scale: 1 }} 
                                className="w-6 h-6 bg-white rounded-full shadow-inner"
                              />
                            )}
                          </AnimatePresence>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Size & Mode */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4 p-6 bg-white/20 dark:bg-gray-800/20 rounded-[2rem] border border-white/10">
                      <div className="flex items-center justify-between">
                        <Type size={20} className="text-gray-400" />
                        <span className="text-xl font-bold dark:text-white">{formData.fontSize}px</span>
                      </div>
                      <label className="text-sm font-black text-gray-400 uppercase">{t.fontSize}</label>
                      <input 
                        type="range" 
                        min="12" 
                        max="20" 
                        step="1"
                        value={formData.fontSize}
                        onChange={(e) => setFormData({ ...formData, fontSize: Number(e.target.value) })}
                        className="w-full accent-indigo-600 h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    <div className="space-y-4">
                      <label className="text-sm font-black text-gray-400 uppercase ml-1">{t.currencySelect}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['JOD', 'USD', 'ILS'] as const).map((curr) => (
                          <button
                            key={curr}
                            type="button"
                            onClick={() => setFormData({ ...formData, currency: curr })}
                            className={`py-3 px-2 rounded-xl text-xs font-black transition-all border-2 ${
                              formData.currency === curr 
                                ? 'border-indigo-600 bg-white dark:bg-gray-800 text-indigo-600' 
                                : 'border-transparent bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {curr === 'JOD' ? t.jodLabel : curr === 'USD' ? t.usdLabel : t.ilsLabel}
                          </button>
                        ))}
                      </div>

                      {/* التحكم في أسعار الصرف يدويا */}
                      <div className="mt-4 p-5 bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-slate-200/60 dark:border-white/5 space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-800 dark:text-gray-200 font-arabic">
                            {isRtl ? '⚙️ التحكم بأسعار الصرف يدوياً' : '⚙️ Custom Exchange Rates'}
                          </span>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={formData.useManualExchangeRates} 
                              onChange={(e) => setFormData({ ...formData, useManualExchangeRates: e.target.checked })}
                              className="sr-only peer" 
                            />
                            <div className="w-10 h-6 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                          </label>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-405 leading-relaxed font-arabic">
                          {isRtl 
                            ? 'قم بتفعيل هذا الخيار لإدخال وتثبيت أسعار صرف مخصصة للعملات بدلاً من الاعتماد التلقائي على جلب الأسعار اللحظية من الإنترنت.' 
                            : 'Enable this setting to enforce static manual exchange rates instead of live online queries.'}
                        </p>

                        {formData.useManualExchangeRates && (
                          <div className="space-y-3 pt-2 animate-fade-in">
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                <span className="font-arabic">{isRtl ? 'سعر الدولار مقابل الشيكل (USD ➡️ ILS)' : 'USD to ILS Rate'}</span>
                                <span className="font-mono text-xs">₪</span>
                              </div>
                              <input 
                                type="number" 
                                step="0.001"
                                value={formData.exchangeRateUSD_ILS}
                                onChange={(e) => setFormData({ ...formData, exchangeRateUSD_ILS: Number(e.target.value) })}
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-xs font-bold dark:text-white outline-none focus:ring-4 focus:ring-indigo-500/10"
                              />
                            </div>

                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                <span className="font-arabic">{isRtl ? 'سعر الدينار مقابل الشيكل (JOD ➡️ ILS)' : 'JOD to ILS Rate'}</span>
                                <span className="font-mono text-xs">₪</span>
                              </div>
                              <input 
                                type="number" 
                                step="0.001"
                                value={formData.exchangeRateJOD_ILS}
                                onChange={(e) => setFormData({ ...formData, exchangeRateJOD_ILS: Number(e.target.value) })}
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-xs font-bold dark:text-white outline-none focus:ring-4 focus:ring-indigo-500/10"
                              />
                            </div>

                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                <span className="font-arabic">{isRtl ? 'سعر الدينار مقابل الدولار (JOD ➡️ USD)' : 'JOD to USD Rate'}</span>
                                <span className="font-mono text-xs">$</span>
                              </div>
                              <input 
                                type="number" 
                                step="0.001"
                                value={formData.exchangeRateJOD_USD}
                                onChange={(e) => setFormData({ ...formData, exchangeRateJOD_USD: Number(e.target.value) })}
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-xs font-bold dark:text-white outline-none focus:ring-4 focus:ring-indigo-500/10"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-sm font-black text-gray-400 uppercase ml-1">{t.themeSelection}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['light', 'soft', 'modern'] as const).map((theme) => (
                          <button
                            key={theme}
                            type="button"
                            onClick={() => setFormData({ ...formData, theme })}
                            className={`py-3 px-2 rounded-xl text-xs font-black transition-all border-2 ${
                              formData.theme === theme 
                                ? 'border-indigo-600 bg-white dark:bg-gray-800 text-indigo-600' 
                                : 'border-transparent bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {theme.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, darkMode: !formData.darkMode })}
                      className="flex items-center justify-between p-6 bg-white/50 dark:bg-gray-800/50 rounded-[2rem] border border-white/20 hover:bg-white/80 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${formData.darkMode ? 'bg-indigo-950 text-indigo-400' : 'bg-orange-100 text-orange-600'}`}>
                          {formData.darkMode ? <Moon size={24} /> : <Sun size={24} />}
                        </div>
                        <span className="font-black dark:text-white uppercase tracking-tight">{t.darkMode}</span>
                      </div>
                      <div className={`w-14 h-8 rounded-full border-2 transition-colors relative flex items-center ${formData.darkMode ? 'bg-indigo-600 border-indigo-400' : 'bg-gray-200 border-gray-300'}`}>
                        <motion.div 
                          animate={{ x: formData.darkMode ? 24 : 4 }}
                          className="w-5 h-5 bg-white rounded-full shadow-md"
                        />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, enableAnimations: !formData.enableAnimations })}
                      className="flex items-center justify-between p-6 bg-white/50 dark:bg-gray-800/50 rounded-[2rem] border border-white/20 hover:bg-white/80 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${formData.enableAnimations ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                          <Sparkles size={24} />
                        </div>
                        <span className="font-black dark:text-white uppercase tracking-tight">{t.enableAnimations}</span>
                      </div>
                      <div className={`w-14 h-8 rounded-full border-2 transition-colors relative flex items-center ${formData.enableAnimations ? 'bg-indigo-600 border-indigo-400' : 'bg-gray-200 border-gray-300'}`}>
                        <motion.div 
                          animate={{ x: formData.enableAnimations ? 24 : 4 }}
                          className="w-5 h-5 bg-white rounded-full shadow-md"
                        />
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {activeSection === 'inventory' && (
                <div className="space-y-8">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="text-emerald-600" />
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-wider">{t.safetyLogic}</h2>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <label className="text-sm font-black text-gray-400 uppercase ml-1">{t.lowStockThreshold}</label>
                      <div className="flex items-center gap-4 bg-white/50 dark:bg-gray-800/50 p-6 rounded-[2rem] border border-white/20">
                        <Zap className="text-orange-500" size={24} />
                        <input
                          type="number"
                          value={formData.lowStockThreshold}
                          onChange={(e) => setFormData({ ...formData, lowStockThreshold: Number(e.target.value) })}
                          className="bg-transparent text-3xl font-black text-gray-900 dark:text-white w-20 outline-none"
                        />
                        <span className="text-gray-400 font-bold">{t.unitsPlural}</span>
                      </div>
                      <p className="text-xs text-gray-500 mx-2 flex items-center gap-2">
                        <Info size={14} /> {isRtl ? 'عند هذا العدد يظهر تنبيه نقص المخزون.' : 'Stock is flagged as low at or below this quantity.'}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <label className="text-sm font-black text-gray-400 uppercase ml-1">{t.mandatorySerial}</label>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, mandatorySerial: !formData.mandatorySerial })}
                        className="w-full flex items-center justify-between p-6 bg-white/50 dark:bg-gray-800/50 rounded-[2rem] border border-white/20 hover:bg-white/80 transition-all"
                      >
                        <ShieldCheck size={32} className={formData.mandatorySerial ? 'text-indigo-600' : 'text-gray-300'} />
                        <div className={`w-14 h-8 rounded-full border-2 transition-colors relative flex items-center ${formData.mandatorySerial ? 'bg-indigo-600 border-indigo-400' : 'bg-gray-200 border-gray-300'}`}>
                          <motion.div 
                            animate={{ x: formData.mandatorySerial ? 24 : 4 }}
                            className="w-5 h-5 bg-white rounded-full shadow-md"
                          />
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="bg-emerald-50 dark:bg-emerald-900/10 p-6 rounded-[2rem] border border-emerald-100 dark:border-emerald-900/30">
                    <h3 className="font-black text-emerald-800 dark:text-emerald-400 uppercase text-xs mb-4 flex items-center gap-2">
                      <Percent size={14} /> {t.financialDefaults}
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-emerald-600 block mb-1">{t.defaultVat}</span>
                        <input
                          type="number"
                          value={formData.defaultVatRate}
                          onChange={(e) => setFormData({ ...formData, defaultVatRate: Number(e.target.value) })}
                          className="w-full bg-white dark:bg-gray-900/50 rounded-xl px-4 py-3 border border-emerald-200 dark:border-emerald-800 font-black text-emerald-900 dark:text-emerald-300 outline-none focus:ring-4 focus:ring-emerald-500/20"
                        />
                      </div>
                      <div>
                        <span className="text-xs text-emerald-600 block mb-1">{t.defaultCustoms}</span>
                        <input
                          type="number"
                          value={formData.defaultCustomsDuty}
                          onChange={(e) => setFormData({ ...formData, defaultCustomsDuty: Number(e.target.value) })}
                          className="w-full bg-white dark:bg-gray-900/50 rounded-xl px-4 py-3 border border-emerald-200 dark:border-emerald-800 font-black text-emerald-900 dark:text-emerald-300 outline-none focus:ring-4 focus:ring-emerald-500/20"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'notifications' && (
                <div className="space-y-8">
                  <div className="flex items-center gap-3">
                    <Bell className="text-amber-600" />
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-wider">{t.notifications}</h2>
                  </div>

                  {/* AI Verbosity */}
                  <div className="space-y-4 p-8 bg-indigo-50 dark:bg-indigo-950/20 rounded-[2.5rem] border border-indigo-100 dark:border-indigo-900/30">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Zap className="text-indigo-600" />
                        <span className="font-black dark:text-white uppercase">{t.aiVerbosity}</span>
                      </div>
                      <span className="px-4 py-1 bg-white dark:bg-gray-800 rounded-full text-xs font-black text-indigo-600 shadow-sm uppercase">
                        {formData.aiVerbosity}
                      </span>
                    </div>
                    <div className="flex gap-4">
                      {(['concise', 'detailed'] as const).map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setFormData({ ...formData, aiVerbosity: level })}
                          className={`flex-1 py-4 px-6 rounded-2xl text-sm font-black transition-all border-2 ${
                            formData.aiVerbosity === level 
                              ? 'border-indigo-600 bg-white dark:bg-gray-800 text-indigo-700 dark:text-indigo-400' 
                              : 'border-transparent bg-indigo-100/50 dark:bg-indigo-900/10 text-indigo-400'
                          }`}
                        >
                          {level.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, soundEffects: !formData.soundEffects })}
                      className="flex items-center justify-between p-6 bg-white/50 dark:bg-gray-800/50 rounded-[2rem] border border-white/20 hover:bg-white/80 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${formData.soundEffects ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400'}`}>
                          <Volume2 size={24} />
                        </div>
                        <span className="font-black dark:text-white uppercase tracking-tight">{t.soundEffects}</span>
                      </div>
                      <div className={`w-14 h-8 rounded-full border-2 transition-colors relative flex items-center ${formData.soundEffects ? 'bg-indigo-600 border-indigo-400' : 'bg-gray-200 border-gray-300'}`}>
                        <motion.div 
                          animate={{ x: formData.soundEffects ? 24 : 4 }}
                          className="w-5 h-5 bg-white rounded-full shadow-md"
                        />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, toastNotifications: !formData.toastNotifications })}
                      className="flex items-center justify-between p-6 bg-white/50 dark:bg-gray-800/50 rounded-[2rem] border border-white/20 hover:bg-white/80 transition-all group"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${formData.toastNotifications ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                          <Bell size={24} />
                        </div>
                        <span className="font-black dark:text-white uppercase tracking-tight">{t.toastNotifications}</span>
                      </div>
                      <div className={`w-14 h-8 rounded-full border-2 transition-colors relative flex items-center ${formData.toastNotifications ? 'bg-indigo-600 border-indigo-400' : 'bg-gray-200 border-gray-300'}`}>
                        <motion.div 
                          animate={{ x: formData.toastNotifications ? 24 : 4 }}
                          className="w-5 h-5 bg-white rounded-full shadow-md"
                        />
                      </div>
                    </button>
                  </div>

                  {/* Native Browser Notification Perms Trigger */}
                  <div className="p-6 bg-indigo-50/40 dark:bg-slate-900/40 backdrop-blur-md rounded-[2rem] border border-indigo-100/30 dark:border-slate-800/60 mt-4">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                      <div className="space-y-1">
                        <h4 className="font-black text-slate-800 dark:text-slate-100 uppercase text-sm">
                          {isRtl ? 'صلاحيات إشعارات المتصفح' : 'Browser Desktop Alerts'}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-arabic">
                          {isRtl 
                            ? 'اسمَح لمتصفحك بإرسال إشعارات عندما يقترب منتج من النفاذ في رادار المخازن اللحظي.' 
                            : 'Provide authorization to dispatch background alerts for depleting goods tracking.'}
                        </p>
                      </div>
                      
                      <button
                        type="button"
                        onClick={requestNotificationPermission}
                        className={`px-6 py-3.5 font-black rounded-2xl text-xs uppercase tracking-wider transition-all duration-300 flex items-center gap-2.5 shadow-md hover:shadow-lg active:scale-95 cursor-pointer ${
                          notificationPermission === 'granted'
                            ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 pointer-events-none'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600'
                        }`}
                      >
                        <Bell size={16} className={notificationPermission === 'granted' ? 'text-emerald-500 animate-none' : 'text-white animate-bounce'} />
                        {notificationPermission === 'granted'
                          ? (isRtl ? 'مُفعّلة ومسموح بها ✓' : 'Allowed & Active ✓')
                          : (isRtl ? 'تفعيل الإشعارات الفورية' : 'Enable Live Alerts')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'subscription' && <SubscriptionSettings language={language} />}

              {activeSection === 'system' && (
                <div className="space-y-8">
                  <div className="flex items-center gap-3">
                    <Database className="text-indigo-600" />
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-wider">{t.systemManagement}</h2>
                  </div>

                  {/* Recalibrate Safe */}
                  <div className="p-8 bg-gray-50 dark:bg-gray-800/50 rounded-[2.5rem] border border-gray-200 dark:border-gray-700/50">
                    <div className="flex items-center gap-3 mb-6">
                      <RefreshCw size={20} className="text-indigo-500" />
                      <h3 className="font-black dark:text-white uppercase">{t.recalibrateVault}</h3>
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-1">
                        <label className="text-xs font-black text-gray-400 uppercase block mb-1">{isRtl ? "العملة" : "Currency"}</label>
                        <select
                          value={recalibrateData.currency}
                          onChange={(e) => setRecalibrateData({ ...recalibrateData, currency: e.target.value as Currency })}
                          className="w-full bg-white dark:bg-gray-900 rounded-xl px-4 py-3 border border-gray-200 dark:border-gray-700 font-bold dark:text-white"
                        >
                          <option value="JOD">JOD (د.أ)</option>
                          <option value="ILS">ILS (₪)</option>
                          <option value="USD">USD ($)</option>
                          <option value="IQD">IQD (د.ع)</option>
                          <option value="SAR">SAR (ر.س)</option>
                          <option value="LYD">LYD (د.ل)</option>
                        </select>
                      </div>
                      <div className="md:col-span-1">
                        <label className="text-xs font-black text-gray-400 uppercase block mb-1">{isRtl ? "الرصيد الجديد" : "New Balance"}</label>
                        <input
                          type="number"
                          placeholder="0.00"
                          value={recalibrateData.amount}
                          onChange={(e) => setRecalibrateData({ ...recalibrateData, amount: e.target.value })}
                          className="w-full bg-white dark:bg-gray-900 rounded-xl px-4 py-3 border border-gray-200 dark:border-gray-700 font-bold dark:text-white"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-xs font-black text-gray-400 uppercase block mb-1">{isRtl ? 'سبب المعايرة' : 'Reason'}</label>
                        <input
                          type="text"
                          placeholder={isRtl ? 'مثال: جرد شهري' : 'e.g. Monthly count'}
                          value={recalibrateData.reason}
                          onChange={(e) => setRecalibrateData({ ...recalibrateData, reason: e.target.value })}
                          className="w-full bg-white dark:bg-gray-900 rounded-xl px-4 py-3 border border-gray-200 dark:border-gray-700 font-bold dark:text-white"
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!recalibrateData.amount || isNaN(Number(recalibrateData.amount)) || Number(recalibrateData.amount) < 0) {
                            toast.error(isRtl ? "الرجاء إدخال رصيد صحيح وغير سالب" : "Please enter a valid, non-negative balance");
                            return;
                          }
                          try {
                            const cur = recalibrateData.currency || 'JOD';
                            await recalibrateVault(Number(recalibrateData.amount), cur, recalibrateData.reason);
                            setRecalibrateData({ amount: '', currency: 'JOD' as Currency, reason: '' });
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase transition-all shadow-md active:scale-95"
                      >
                        {isRtl ? "تنفيذ إعادة المعايرة" : "Execute Recalibration"}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-2 italic">{t.recalibrateDescription}</p>
                  </div>

                  {/* Local Backup & Restore Hub */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Backup Panel */}
                    <div className="flex flex-col p-8 bg-gradient-to-br from-indigo-950 to-slate-900 rounded-[2.5rem] shadow-xl text-white border border-indigo-500/20">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-indigo-600/30 rounded-2xl flex items-center justify-center border border-indigo-400/20 text-indigo-300">
                          <Download size={24} />
                        </div>
                        <div>
                          <h3 className="text-lg font-black uppercase tracking-tight leading-none text-white">
                            {isRtl ? "نسخ احتياطي محلي" : "Local Backup"}
                          </h3>
                          <span className="text-[10px] text-indigo-300 font-bold uppercase tracking-wider font-mono">
                            JSON Backup Package
                          </span>
                        </div>
                      </div>
                      <p className="text-indigo-100/70 text-xs leading-relaxed mb-6 flex-1 font-arabic">
                        {isRtl 
                          ? "قم بتحميل نسخة احتياطية متكاملة بجميع بيانات وتجارة وعملات وموظفي المستودع مباشرة على جهازك." 
                          : "Download an offline standalone database snapshot containing all inventories, ledgers, and configurations safely."}
                      </p>
                      <button
                        type="button"
                        onClick={handleExportData}
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-xs uppercase transition-all active:scale-95 shadow-lg shadow-indigo-950/50 cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Download size={14} />
                        {isRtl ? "تصدير نسخة JSON" : "Download Backup"}
                      </button>
                    </div>

                    {/* Restore Panel */}
                    <div className="flex flex-col p-8 bg-gradient-to-br from-slate-800 to-slate-950 rounded-[2.5rem] shadow-xl text-white border border-slate-700/50">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 text-emerald-400">
                          <Upload size={24} />
                        </div>
                        <div>
                          <h3 className="text-lg font-black uppercase tracking-tight leading-none text-white">
                            {isRtl ? "استعادة نسخة محلية" : "Local Restore"}
                          </h3>
                          <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider font-mono">
                            JSON Recovery Engine
                          </span>
                        </div>
                      </div>
                      <p className="text-slate-300/70 text-xs leading-relaxed mb-6 flex-1 font-arabic">
                        {isRtl 
                          ? "قم برفع ملف النسخة الاحتياطية (.json) الذي قمت بتحميله مسبقاً لاستعادة كافة المعاملات والمنتجات على الفور." 
                          : "Re-import and overlay previous warehouse states directly by importing a valid exported JSON file."}
                      </p>
                      <label className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-black text-xs uppercase text-center transition-all active:scale-95 border border-slate-700 cursor-pointer flex items-center justify-center gap-2">
                        <Upload size={14} />
                        <span>{isRtl ? "استيراد نسخة JSON" : "Upload & Restore"}</span>
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleLocalFileSelect}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                  {/* Language Toggle */}
                  <div className="flex items-center justify-between p-6 bg-white dark:bg-gray-800 rounded-[2rem] border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-4">
                      <Globe className="text-indigo-400" />
                      <div>
                        <p className="font-black text-gray-900 dark:text-white uppercase tracking-tight">{t.defaultLanguage}</p>
                        <p className="text-xs text-gray-500">{t.initialLanguageStartup}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const newLang = formData.defaultLanguage === 'en' ? 'ar' : 'en';
                        setFormData({ ...formData, defaultLanguage: newLang });
                        onLanguageToggle();
                      }}
                      className="px-6 py-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl font-black text-sm uppercase border border-indigo-100 dark:border-indigo-800"
                    >
                      {formData.defaultLanguage === 'en' ? 'EN' : 'العربية'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>

            {/* Save Button */}
            <div className="pt-4">
              <TactileButton
                type="submit"
                variant="primary"
                fullWidth
                className="py-6 rounded-[2rem] text-xl font-black uppercase tracking-widest shadow-2xl shadow-indigo-200 dark:shadow-indigo-900/40"
              >
                <div className="flex items-center justify-center gap-4">
                  <Save size={24} />
                  {t.saveSettings}
                </div>
              </TactileButton>
            </div>
          </form>
        </main>
      </div>

      {/* LOCAL BACKUP CONFIRMATION MODAL */}
      <AnimatePresence>
        {selectedBackupForLocalRestore && (
          <div className="fixed inset-0 bg-slate-950/40 dark:bg-slate-950/70 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 max-w-lg w-full shadow-3xl text-slate-800 dark:text-white space-y-6"
              dir={isRtl ? "rtl" : "ltr"}
            >
              <div className={`flex items-center gap-4 ${isRtl ? 'flex-row' : 'flex-row-reverse'} justify-between text-amber-500`}>
                <div className={isRtl ? 'text-right' : 'text-left'}>
                  <h3 className="text-xl font-extrabold uppercase tracking-tight">
                    {isRtl ? "تأكيد استعادة المحتوى!" : "Confirm Local Restore!"}
                  </h3>
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-bold block uppercase tracking-wider">
                    {isRtl ? "عملية حساسة ومحلية بالكامل" : "Highly Crucial Offline Recovery"}
                  </span>
                </div>
                <div className="w-14 h-14 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20">
                  <AlertTriangle size={32} />
                </div>
              </div>

              <div className="p-5 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <p className="font-arabic font-bold text-amber-600 dark:text-amber-400 text-sm">
                  ⚠️ {isRtl 
                    ? "تحذير: سيقوم هذا الإجراء فوراً بمسح واستبدال كافة المعاملات والمنتجات والخزنة والرواتب والعملاء الحالية بالبيانات المحلية!" 
                    : "Warning: Proceeding will overwrite all current items, warehouses, ledgers, staff, payrolls, and currencies."}
                </p>

                {/* File Contents Overview */}
                <div className="space-y-2 border-t border-b border-amber-500/10 py-3">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black">
                    {isRtl ? "مكونات ملف النسخة المكتشفة:" : "Discovered Assets inside Backup Package:"}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono select-none">
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex justify-between items-center border border-slate-100 dark:border-slate-800">
                      <span className="opacity-60">{isRtl ? "المنتجات:" : "Products:"}</span>
                      <span className="font-black text-indigo-500">{(selectedBackupForLocalRestore.products || []).length}</span>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex justify-between items-center border border-slate-100 dark:border-slate-800">
                      <span className="opacity-60">{isRtl ? "الفواتير:" : "Invoices:"}</span>
                      <span className="font-black text-indigo-500">{(selectedBackupForLocalRestore.invoices || []).length}</span>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex justify-between items-center border border-slate-100 dark:border-slate-800">
                      <span className="opacity-60">{isRtl ? "المستودعات:" : "Warehouses:"}</span>
                      <span className="font-black text-indigo-500">{(selectedBackupForLocalRestore.warehouses || []).length}</span>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex justify-between items-center border border-slate-100 dark:border-slate-800">
                      <span className="opacity-60">{isRtl ? "الموظفون:" : "Employees:"}</span>
                      <span className="font-black text-indigo-500">{(selectedBackupForLocalRestore.employees || []).length}</span>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex justify-between items-center border border-slate-100 dark:border-slate-800">
                      <span className="opacity-60">{isRtl ? "العملاء:" : "Customers:"}</span>
                      <span className="font-black text-indigo-500">{(selectedBackupForLocalRestore.customers || []).length}</span>
                    </div>
                    <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex justify-between items-center border border-slate-100 dark:border-slate-800">
                      <span className="opacity-60">{isRtl ? "حساب الإعدادات:" : "Settings:"}</span>
                      <span className="font-black text-emerald-500">{selectedBackupForLocalRestore.settings ? (isRtl ? "نعم" : "YES") : (isRtl ? "لا" : "NO")}</span>
                    </div>
                  </div>
                </div>

                <div className="font-mono bg-slate-100 dark:bg-slate-800 p-2 text-center rounded-lg font-bold text-[10px] text-slate-500 dark:text-cyan-400">
                  {isRtl ? "تاريخ توليد النسخة: " : "Compiled On: "}
                  {selectedBackupForLocalRestore.timestamp ? new Date(selectedBackupForLocalRestore.timestamp).toLocaleString(isRtl ? 'ar-EG' : 'en-US') : 'N/A'}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setSelectedBackupForLocalRestore(null)}
                  disabled={isLocalRestoreInProgress}
                  className="px-5 py-3 text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-bold text-slate-700 dark:text-slate-300 rounded-xl transition active:scale-95 cursor-pointer"
                >
                  {isRtl ? "إلغاء الأمر" : "Cancel"}
                </button>
                <button
                  onClick={handleConfirmLocalRestore}
                  disabled={isLocalRestoreInProgress}
                  className="px-6 py-3 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md uppercase tracking-wider transition active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  {isLocalRestoreInProgress ? <RefreshCw size={14} className="animate-spin" /> : <Check size={12} />}
                  {isRtl ? "نعم، استعد نسخة البيانات محلياً" : "Restore Database Now"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

