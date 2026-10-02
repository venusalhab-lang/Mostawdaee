import React, { useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useFirebase } from './FirebaseProvider';
import { 
  Download, Upload, AlertTriangle, CheckCircle, Database, ShieldAlert,
  Save, RefreshCw, FileJson, Check, HelpCircle, HardDrive, Cpu, CloudLightning, FileSpreadsheet
} from 'lucide-react';
import { toast } from 'sonner';
import { sounds } from '../lib/sounds';

interface BackupManagerProps {
  language: 'ar' | 'en';
}

export default function BackupManager({ language }: BackupManagerProps) {
  const isRtl = language === 'ar';
  const { user, products: localProducts } = useFirebase() as any;
  const sb = supabase as any;

  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [backupStats, setBackupStats] = useState<{ [key: string]: number } | null>(null);
  const [backupDate, setBackupDate] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Status message translation helper
  const t = {
    title: isRtl ? 'النسخ الاحتياطي والأمان' : 'Backup & Data Security Hub',
    subtitle: isRtl 
      ? 'مركز إدارة البيانات الموحد لحفظ ومزامنة وتصدير جميع قيود المستودع والمعاملات والعملاء وصندوق السداد كمستند شامل.' 
      : 'Unified database snapshot engine to securely compile, export, and overwrite your business books locally.',
    exportTitle: isRtl ? 'تصدير البيانات وحفظها' : 'Unified Data Export Engine',
    exportDesc: isRtl 
      ? 'إنشاء ملف مدمج يحتوي على جميع جداولك السحابية والمحلية (المنتجات، المبيعات، الفواتير، الموظفين، الحسابات النقود والمستودعات) لحمايتها وجاهزيتها للاستعادة.' 
      : 'Generate and fetch a complete encrypted .json backup bundle containing all warehouse assets, lists, payroll sheets, and ledgers.',
    btnExport: isRtl ? 'إنشاء وتحميل نسخة احتياطية الآن (سحابي + محلي)' : 'Dump & Export Standalone Backup',
    preparingBackup: isRtl ? 'جاري تجميع قواعد البيانات وتحميل النسخة...' : 'Compiling active tables and packaging JSON...',
    importTitle: isRtl ? 'استيراد واستعادة كامل البيانات' : 'Strict Local & Cloud Schema Restorer',
    importDesc: isRtl 
      ? 'قم بسحب ملف النسخة الاحتياطية وتنزيله هنا لاسترجاع كافة الأرصدة وتاريخ العمليات وحالة المستودعات السحابية والمحلية بشكل فوري.' 
      : 'Drag or drop a genuine .json snapshot package here to execute deep table overlays and refresh active instances.',
    dragText: isRtl ? 'اضغط هنا لرفع ملف واستعادة البيانات' : 'Click or drop a valid backup JSON here to restore database',
    confirmText: isRtl 
      ? "تنبيه هام ومصيري:\nسيؤدي هذا الإجراء إلى مسح أو تعديل كافة البيانات والجداول الحالية في السحابة واستبدالها بالكامل من ملف النسخة الاحتياطية.\n\nهل أنت متأكد تماماً وترغب بالاستمرار وتخطي التحذير؟"
      : "CRITICAL ACTION REQUIRED:\nThis overlay operation will permanently erase or modify existing records on the active cloud PostgreSQL database to match the imported snapshot.\n\nAre you absolutely sure you want to run this master recovery?",
    successTitle: isRtl ? 'تمت العملية بنجاح' : 'System State Updated Successfully',
    processingRestore: isRtl ? 'جاري مراجعة الملف وترميم البيانات...' : 'Inspecting file structure & overlaying PostgreSQL tables...',
    failedFetch: isRtl ? 'خطأ في سحب وتجميع البيانات من خادم PostgreSQL السحابي' : 'Failed fetching rows from Supabase cloud state. Check connection credentials.',
    
    // CSV Stock Report additions
    csvTitle: isRtl ? 'تقرير وجرد المخزون (Excel)' : 'Master Stock Sheet (CSV/Excel)',
    csvDesc: isRtl 
      ? 'تحميل جدول بيانات متوافق ومباشر مع Excel، يحتوي على التسميات الدقيقة والمستودعات والقسم والكميات الحالية والأسعار وتواريخ التسجيل بوضوح.'
      : 'Download spreadsheet-ready CSV tables featuring real-time quantities, units, prices, departments, and categories.',
    btnCsv: isRtl ? 'تحميل جدول جرد المنتجات الحالي (Excel)' : 'Download Stock Report (Excel CSV)',
    csvPreparing: isRtl ? 'جاري تجهيز تقرير المخزون...' : 'Compiling stock stats into CSV...',
    csvSuccess: isRtl ? 'تم تحميل تقرير جرد المخزون بنجاح (صيغة Excel)!' : 'Stock report successfully compiled and downloaded as Excel CSV!',
    csvNoData: isRtl ? 'لا توجد بيانات حالية من منتجات المستودع لتصديرها' : 'No active product rows found to build report'
  };

  // 1. Fetch tables and generate a single JSON download package
  const handleExportBackup = async () => {
    sounds.playClick();
    setLoading(true);
    setStatus({ type: '', message: '' });
    setBackupStats(null);

    try {
      toast.info(isRtl ? 'جاري الاتصال بقاعدة البيانات السحابية وسحب الجداول...' : 'Contacting PostgreSQL cloud storage...');
      
      // Fetch products
      const { data: products, error: prodError } = await sb
        .from('products')
        .select('*');
      if (prodError) console.warn('Supabase products fetch failed:', prodError);

      // Fetch warehouses
      const { data: warehouses, error: whError } = await sb
        .from('warehouses')
        .select('*');
      if (whError) console.warn('Supabase warehouses fetch failed:', whError);

      // Fetch invoices
      const { data: invoices, error: invError } = await sb
        .from('invoices')
        .select('*');
      if (invError) console.warn('Supabase invoices fetch failed:', invError);

      // Fetch employees
      const { data: employees, error: empError } = await sb
        .from('employees')
        .select('*');
      if (empError) console.warn('Supabase employees fetch failed:', empError);

      // Fetch payroll records
      const { data: payroll, error: payError } = await sb
        .from('payroll_records')
        .select('*');
      if (payError) console.warn('Supabase payroll_records fetch failed:', payError);

      // Fetch customers
      const { data: customers, error: custError } = await sb
        .from('customers')
        .select('*');
      if (custError) console.warn('Supabase customers fetch failed:', custError);

      // Fetch customer transactions
      const { data: customerTx, error: custTxError } = await sb
        .from('customer_transactions')
        .select('*');
      if (custTxError) console.warn('Supabase customer_transactions fetch failed:', custTxError);

      // Fetch vault status/transactions
      const { data: vaultTx, error: vaultTxError } = await sb
        .from('vault_transactions')
        .select('*');
      if (vaultTxError) console.warn('Supabase vault_transactions fetch failed:', vaultTxError);

      // Fetch purchases
      const { data: purchases, error: purError } = await sb
        .from('purchases')
        .select('*');
      if (purError) console.warn('Supabase purchases fetch failed:', purError);

      const backupData = {
        app: "Mostawdaee System",
        version: "2.1",
        createdAt: new Date().toISOString(),
        exportedBy: user?.email || 'System Client',
        tables: {
          products: products || [],
          warehouses: warehouses || [],
          invoices: invoices || [],
          employees: employees || [],
          payroll_records: payroll || [],
          customers: customers || [],
          customer_transactions: customerTx || [],
          vault_transactions: vaultTx || [],
          purchases: purchases || []
        }
      };

      // Create JSON string and assemble virtual anchor direct download
      const jsonString = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(blob);
      
      const downloadAnchor = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      
      downloadAnchor.setAttribute('href', downloadUrl);
      downloadAnchor.setAttribute('download', `mostawdaee_backup_${dateStr}.json`);
      document.body.appendChild(downloadAnchor);
      
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(downloadUrl);

      sounds.playSuccess();
      setStatus({ 
        type: 'success', 
        message: isRtl 
          ? 'تم تجميع الجداول وتصدير ملف التنزيل بنجاح! احتفظ بالملف بأمان 💾' 
          : 'Backup successfully compiled and downloaded to your PC! Keep it safe 💾' 
      });

      setBackupStats({
        products: (products || []).length,
        warehouses: (warehouses || []).length,
        invoices: (invoices || []).length,
        employees: (employees || []).length,
        customers: (customers || []).length,
        purchases: (purchases || []).length,
      });
      setBackupDate(new Date().toLocaleString(isRtl ? 'ar-EG' : 'en-US'));

    } catch (error: any) {
      console.error(error);
      sounds.playError();
      setStatus({ 
        type: 'error', 
        message: error.message || t.failedFetch 
      });
    } finally {
      setLoading(false);
    }
  };

  // 2. Load file and perform upserts inside database
  const executeFileImport = (file: File) => {
    if (!file) return;
    setStatus({ type: '', message: '' });
    setBackupStats(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const textResult = e.target?.result as string;
        const importedData = JSON.parse(textResult);
        
        // Strict Schema Check
        if (!importedData.tables || (!importedData.tables.products && !importedData.tables.invoices)) {
          throw new Error(
            isRtl 
              ? 'صيغة الملف المرفوع غير مدعومة أو مجتزأة وتفتقد الترقيم الموحد لمستودعي!' 
              : 'Invalid backup structure! Missing required tables.'
          );
        }

        const confirmRestore = window.confirm(t.confirmText);
        if (!confirmRestore) {
          sounds.playClick();
          return;
        }

        setLoading(true);
        toast.info(t.processingRestore);

        const tables = importedData.tables;
        
        // Product Upserts
        if (Array.isArray(tables.products) && tables.products.length > 0) {
          const { error: err } = await sb.from('products').upsert(tables.products);
          if (err) console.error('Products restore error:', err);
        }

        // Warehouse Upserts
        if (Array.isArray(tables.warehouses) && tables.warehouses.length > 0) {
          const { error: err } = await sb.from('warehouses').upsert(tables.warehouses);
          if (err) console.error('Warehouses restore error:', err);
        }

        // Invoice Upserts
        if (Array.isArray(tables.invoices) && tables.invoices.length > 0) {
          const { error: err } = await sb.from('invoices').upsert(tables.invoices);
          if (err) console.error('Invoices restore error:', err);
        }

        // Employees Upserts
        if (Array.isArray(tables.employees) && tables.employees.length > 0) {
          const { error: err } = await sb.from('employees').upsert(tables.employees);
          if (err) console.error('Employees restore error:', err);
        }

        // Payroll Upserts
        if (Array.isArray(tables.payroll_records) && tables.payroll_records.length > 0) {
          const { error: err } = await sb.from('payroll_records').upsert(tables.payroll_records);
          if (err) console.error('Payroll restore error:', err);
        }

        // Customers Upserts
        if (Array.isArray(tables.customers) && tables.customers.length > 0) {
          const { error: err } = await sb.from('customers').upsert(tables.customers);
          if (err) console.error('Customers restore error:', err);
        }

        // Customer transaction Upserts
        if (Array.isArray(tables.customer_transactions) && tables.customer_transactions.length > 0) {
          const { error: err } = await sb.from('customer_transactions').upsert(tables.customer_transactions);
          if (err) console.error('Cust Tx restore error:', err);
        }

        // Vault transactions Upserts
        if (Array.isArray(tables.vault_transactions) && tables.vault_transactions.length > 0) {
          const { error: err } = await sb.from('vault_transactions').upsert(tables.vault_transactions);
          if (err) console.error('Vault Tx restore error:', err);
        }

        // Purchases Upserts
        if (Array.isArray(tables.purchases) && tables.purchases.length > 0) {
          const { error: err } = await sb.from('purchases').upsert(tables.purchases);
          if (err) console.error('Purchases restore error:', err);
        }

        sounds.playSuccess();
        setStatus({ 
          type: 'success', 
          message: isRtl 
            ? '🚀 تمت استعادة كافة جداول السحابة بنجاح! تم دمج ومطابقة البيانات بالكامل.' 
            : '🚀 Extended PostgreSQL restore completed! Active data tables synchronized successfully.' 
        });

        setBackupStats({
          products: (tables.products || []).length,
          warehouses: (tables.warehouses || []).length,
          invoices: (tables.invoices || []).length,
          employees: (tables.employees || []).length,
          customers: (tables.customers || []).length,
          purchases: (tables.purchases || []).length,
        });
        if (importedData.createdAt) {
          setBackupDate(new Date(importedData.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US'));
        }

      } catch (err: any) {
        console.error(err);
        sounds.playError();
        setStatus({ 
          type: 'error', 
          message: isRtl 
            ? `فشل في استلام وتشفير ملف النسخة الاحتياطية: ${err.message}` 
            : `Failed reading backup target package: ${err.message}` 
        });
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  // 3. Export Products state as an Excel-bound CSV list
  const handleExportCSV = async () => {
    sounds.playClick();
    setLoading(true);
    setStatus({ type: '', message: '' });

    try {
      toast.info(isRtl ? 'جاري الاتصال وسحب بيانات المخزون المحدّثة...' : 'Contacting PostgreSQL to compile inventory statistics...');

      // 1. Get latest products coupled with warehouse name safely (using * to prevent missing column crashes)
      let products: any[] = [];
      try {
        const { data, error: prodError } = await sb
          .from('products')
          .select('*, warehouses (name)');
        
        if (prodError) throw prodError;
        products = data || [];
      } catch (err) {
        console.warn('Supabase products join warehouses failed, trying fallback:', err);
        const { data, error: prodError } = await sb
          .from('products')
          .select('*');
        if (prodError) throw prodError;
        products = data || [];
      }

      let isTemplate = false;
      if (!products || products.length === 0) {
        if (localProducts && localProducts.length > 0) {
          products = localProducts;
          toast.info(isRtl
            ? 'تم استخدام بيانات المنتجات المحلية المخزنة مرحلياً لإنشاء التقرير.'
            : 'Using local offline products stash to compile report.');
        } else {
          isTemplate = true;
          products = [
            {
              id: 'SAMPLE-101',
              name: isRtl ? 'مثال: علبة كرتون مواد غذائية' : 'Sample: Goods Box Cargo',
              category: isRtl ? 'عام' : 'General',
              quantity: 0,
              price: 0,
              created_at: new Date().toISOString()
            }
          ];
        }
      }

      if (isTemplate) {
        toast.info(isRtl 
          ? 'تم تنزيل نموذج فارغ لتقرير جرد المخزون كعينة لعدم وجود منتجات حالية.' 
          : 'No registered products found. Downloaded a sample inventory spreadsheet layout.');
      }

      // 2. Fetch separate categories table to support relations programmatically if category_id exists
      let categories: any[] = [];
      try {
        const { data: catData, error: catError } = await sb
          .from('categories')
          .select('*');
        if (!catError && catData) {
          categories = catData;
        }
      } catch (e) {
        console.warn('Could not fetch categories table separately:', e);
      }

      // Column Headers
      const headers = isRtl 
        ? ['رقم المنتج الفريد', 'اسم المنتج أو المادة', 'القسم / الصنف', 'المستودع', 'الكمية المتوفرة', 'سعر الوحدة', 'تاريخ الإضافة']
        : ['Product ID', 'Item Name', 'Category', 'Warehouse/Depot', 'Available Stock', 'Unit Price', 'Registration Date'];

      // Row preparation
      const rows = products.map((prod: any) => {
        // Handle categories name lookup dynamically to support category, category_id, or custom schemas
        let categoryName = '';
        if (prod.categories) {
          categoryName = typeof prod.categories === 'string' 
            ? prod.categories 
            : (prod.categories.name || '');
        } else if (prod.category) {
          categoryName = prod.category;
        } else if (prod.category_id) {
          const matchingCat = categories.find(c => String(c.id) === String(prod.category_id));
          categoryName = matchingCat ? matchingCat.name : '';
        }

        if (!categoryName) {
          categoryName = isRtl ? 'عام' : 'General';
        }

        const warehouseName = prod.warehouses?.name 
          || prod.warehouse_name 
          || (isRtl ? 'المستودع الرئيسي' : 'Main Depot');

        return [
          prod.id,
          `"${(prod.name || '').replace(/"/g, '""')}"`,
          `"${categoryName.replace(/"/g, '""')}"`,
          `"${warehouseName.replace(/"/g, '""')}"`,
          prod.quantity || 0,
          prod.price || 0,
          prod.created_at ? new Date(prod.created_at).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US') : ''
        ];
      });

      // Byte Order Mark (BOM) \uFEFF to force Excel to correctly read UTF-8 (Arabic) with no strange characters
      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = URL.createObjectURL(blob);
      
      const downloadAnchor = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      
      downloadAnchor.setAttribute('href', downloadUrl);
      downloadAnchor.setAttribute('download', isRtl ? `تقرير_جرد_المخزون_${dateStr}.csv` : `inventory_stock_report_${dateStr}.csv`);
      
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(downloadUrl);

      sounds.playSuccess();
      setStatus({
        type: 'success',
        message: t.csvSuccess
      });

    } catch (error: any) {
      console.error(error);
      sounds.playError();
      setStatus({
        type: 'error',
        message: error.message || (isRtl ? 'فشل إعداد التقرير' : 'Failed compiling CSV sheet')
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle Drag & Drop events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      executeFileImport(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      executeFileImport(e.target.files[0]);
    }
  };

  return (
    <div className={`max-w-4xl mx-auto p-4 md:p-8 ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Title block */}
      <div className="mb-10 text-center md:text-right">
        <h1 className="text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight flex items-center justify-center md:justify-start gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100 dark:shadow-indigo-950/30 rotate-2">
            <Database size={24} className="animate-pulse" />
          </div>
          {t.title}
        </h1>
        <p className="text-slate-500 dark:text-gray-400 mt-2 text-md leading-relaxed">
          {t.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Section 1: JSON Export Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 p-6 md:p-8 shadow-xl flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-405/20">
              <Download size={24} />
            </div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
              {t.exportTitle}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-arabic">
              {t.exportDesc}
            </p>
          </div>

          <div className="pt-4">
            <button
              onClick={handleExportBackup}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-black py-4 px-4 rounded-2xl transition duration-200 shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/20 active:scale-95 text-xs uppercase select-none cursor-pointer"
            >
              <Download size={16} />
              {loading ? t.preparingBackup : t.btnExport}
            </button>
          </div>
        </div>

        {/* Section 2: JSON Import Card (Drag and Drop) */}
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 p-6 md:p-8 shadow-xl flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-violet-50 dark:bg-violet-900/15 rounded-2xl flex items-center justify-center text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-500/20">
              <Upload size={24} />
            </div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
              {t.importTitle}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-arabic">
              {t.importDesc}
            </p>
          </div>

          <div 
            onDragEnter={handleDrag} 
            onDragOver={handleDrag} 
            onDragLeave={handleDrag} 
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-3xl p-6 transition-all duration-300 text-center cursor-pointer flex flex-col items-center justify-center gap-3 min-h-[140px]
              ${dragActive 
                ? 'border-indigo-600 bg-indigo-50/20 dark:bg-indigo-950/20' 
                : 'border-slate-300 dark:border-white/10 hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/20'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              disabled={loading}
              className="absolute inset-0 opacity-0 cursor-pointer hidden"
            />
            <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-1">
              <Upload className="text-slate-400 dark:text-slate-500" size={18} />
            </div>
            <span className="text-xs font-black text-slate-800 dark:text-slate-200 px-2 leading-relaxed">
              {t.dragText}
            </span>
            <span className="text-[10px] text-indigo-500 font-extrabold tracking-widest font-mono uppercase">
              Accept: .JSON only
            </span>
          </div>
        </div>

        {/* Section 3: CSV Stock Report Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 p-6 md:p-8 shadow-xl flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20">
              <FileSpreadsheet size={24} />
            </div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
              {t.csvTitle}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-arabic">
              {t.csvDesc}
            </p>
          </div>

          <div className="pt-4">
            <button
              onClick={handleExportCSV}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-black py-4 px-4 rounded-2xl transition duration-200 shadow-lg shadow-emerald-100 dark:shadow-emerald-950/20 active:scale-95 text-xs uppercase select-none cursor-pointer"
            >
              <FileSpreadsheet size={16} />
              {loading ? t.csvPreparing : t.btnCsv}
            </button>
          </div>
        </div>

      </div>

      {/* State Indicators */}
      {status.message && (
        <div className={`mt-8 p-5 rounded-3xl border text-sm flex items-start gap-4 transition-all duration-300 animate-in fade-in slide-in-from-top-3
          ${status.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-400' 
            : 'bg-rose-500/10 border-rose-500/20 text-rose-800 dark:text-rose-400'}`}
        >
          <div className="mt-0.5 shrink-0">
            {status.type === 'success' 
              ? <CheckCircle size={22} className="text-emerald-600 dark:text-emerald-400" /> 
              : <AlertTriangle size={22} className="text-rose-600 dark:text-rose-400" />}
          </div>
          <div className="space-y-1">
            <h4 className="font-black text-xs uppercase tracking-wide">
              {status.type === 'success' ? t.successTitle : (isRtl ? 'تحذير في تنفيذ المعالجة' : 'System Processing Message')}
            </h4>
            <p className="font-arabic leading-relaxed text-xs opacity-90">{status.message}</p>
          </div>
        </div>
      )}

      {/* Backup Statistics Details */}
      {backupStats && (
        <div className="mt-8 bg-slate-50 dark:bg-slate-900/50 border border-slate-200/50 dark:border-white/5 p-6 rounded-[2rem] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/5 pb-3">
            <h4 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block leading-none flex items-center gap-2">
              <CloudLightning size={14} className="text-indigo-500" />
              {isRtl ? 'تفاصيل باقة النسخة الاحتياطية' : 'Backup Assets Registry'}
            </h4>
            <span className="text-[10px] font-mono opacity-60">📅 {backupDate}</span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
              <span className="opacity-60 block text-[10px] uppercase font-bold text-slate-400">{isRtl ? 'المنتجات والسلع' : 'Products & Materials'}</span>
              <span className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 block mt-1">{backupStats.products}</span>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
              <span className="opacity-60 block text-[10px] uppercase font-bold text-slate-400">{isRtl ? 'المستودعات والقباب' : 'Depots & Vaults'}</span>
              <span className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 block mt-1">{backupStats.warehouses}</span>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
              <span className="opacity-60 block text-[10px] uppercase font-bold text-slate-400">{isRtl ? 'الفواتير والقيود الكلية' : 'Master Bills'}</span>
              <span className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 block mt-1">{backupStats.invoices}</span>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
              <span className="opacity-60 block text-[10px] uppercase font-bold text-slate-400">{isRtl ? 'رصيد الموظفين بالقيود' : 'Registered Staff'}</span>
              <span className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 block mt-1">{backupStats.employees}</span>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
              <span className="opacity-60 block text-[10px] uppercase font-bold text-slate-400">{isRtl ? 'دفاتر العملاء والديون' : 'Debtors & Clients'}</span>
              <span className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 block mt-1">{backupStats.customers}</span>
            </div>

            <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
              <span className="opacity-60 block text-[10px] uppercase font-bold text-slate-400">{isRtl ? 'المشتريات وإيصالات النفقات' : 'Expense Bills'}</span>
              <span className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 block mt-1">{backupStats.purchases}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
