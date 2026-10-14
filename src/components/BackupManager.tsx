import React, { useState, useRef } from 'react';
import { useFirebase } from './FirebaseProvider';
import { db } from '../services/firebase';
import { doc, setDoc } from '../lib/supabaseDocs';
import { restoreVaultBalance, vaultRestoreMessage } from '../lib/vaultRestore';
import { backupCounts, buildStoreBackup, isLegacyTableBackup, isStoreBackup, restoreStoreBackup, stockCsv } from '../lib/storeBackup';
import { 
  Download, Upload, AlertTriangle, CheckCircle, Database, CloudLightning, FileSpreadsheet
} from 'lucide-react';
import { toast } from 'sonner';
import { sounds } from '../lib/sounds';

interface BackupManagerProps {
  language: 'ar' | 'en';
}

function downloadFile(content: BlobPart, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function BackupManager({ language }: BackupManagerProps) {
  const isRtl = language === 'ar';
  const {
    user, settings, products, invoices, employees, payrollRecords, customers, customerTransactions,
    suppliers, supplierTransactions, shifts, orders, vaultTransactions, warehouses, vault,
    saveSettings, saveWarehouse, saveProduct, saveInvoice, saveEmployee, savePayrollRecord, saveCustomer, saveCustomerTransaction,
  } = useFirebase();

  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [backupStats, setBackupStats] = useState<ReturnType<typeof backupCounts> | null>(null);
  const [backupDate, setBackupDate] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);

  const t = {
    title: isRtl ? 'النسخ الاحتياطي والأمان' : 'Backup & Data Security Hub',
    subtitle: isRtl 
      ? 'احفظ دفاتر متجرك في ملف على جهازك، واستعدها منه عند الحاجة.' 
      : 'Save your store books to a file on this device and restore them when needed.',
    exportTitle: isRtl ? 'تصدير البيانات وحفظها' : 'Export your books',
    exportDesc: isRtl 
      ? 'ملف واحد يحوي الأصناف والمستودعات والفواتير والعملاء وديونهم والموردين وأرصدتهم وحركات الخزنة ورصيدها والورديات وأوامر الشراء وعروض الأسعار والموظفين والرواتب والإعدادات.' 
      : 'One file with products, warehouses, invoices, customers and their debts, suppliers and their balances, vault movements and balance, shifts, purchase orders and quotations, employees, payroll and settings.',
    btnExport: isRtl ? 'تحميل نسخة احتياطية الآن' : 'Download a backup now',
    preparingBackup: isRtl ? 'جارٍ تجهيز النسخة...' : 'Preparing the backup...',
    importTitle: isRtl ? 'استيراد واستعادة كامل البيانات' : 'Restore from a backup file',
    importDesc: isRtl 
      ? 'اختر ملف نسخة من مستودعي. تُعاد السجلات التي فيه، ولا يُستبدل رصيد الخزنة إذا سُجّلت بعده حركات أحدث.' 
      : 'Choose a Mostawdaee backup file. Its records are written back; the vault balance is kept if newer movements were recorded after it.',
    dragText: isRtl ? 'اضغط هنا لرفع ملف واستعادة البيانات' : 'Click or drop a backup file here to restore',
    confirmText: isRtl 
      ? "ستُكتب سجلات هذا الملف فوق السجلات التي تحمل نفس المعرّف في متجرك.\nالسجلات غير الموجودة في الملف تبقى كما هي.\n\nهل تريد المتابعة؟"
      : "Records in this file will overwrite records with the same id in your store.\nRecords that are not in the file stay as they are.\n\nContinue?",
    successTitle: isRtl ? 'تمت العملية بنجاح' : 'Done',
    processingRestore: isRtl ? 'جارٍ استعادة السجلات...' : 'Restoring records...',
    legacyFile: isRtl
      ? 'هذا الملف من صيغة قديمة لا تحوي دفاتر المتجر، فلم يُستعد منه شيء. استخدم نسخة أحدث أو نسخة Google Drive.'
      : 'This file uses an old format without the store books, so nothing was restored. Use a newer backup or a Google Drive backup.',
    invalidFile: isRtl ? 'هذا الملف ليس نسخة احتياطية من مستودعي.' : 'This file is not a Mostawdaee backup.',
    csvTitle: isRtl ? 'تقرير وجرد المخزون (Excel)' : 'Stock sheet (CSV/Excel)',
    csvDesc: isRtl 
      ? 'جدول يفتح في Excel: اسم الصنف والقسم والمستودع والكمية وسعر البيع بعملته وتاريخ الإضافة.'
      : 'A sheet that opens in Excel: item name, category, warehouse, quantity, selling price in its currency and date added.',
    btnCsv: isRtl ? 'تحميل جدول جرد المنتجات الحالي (Excel)' : 'Download stock sheet (Excel CSV)',
    csvPreparing: isRtl ? 'جارٍ تجهيز تقرير المخزون...' : 'Preparing the stock sheet...',
    csvSuccess: isRtl ? 'تم تحميل تقرير جرد المخزون (صيغة Excel).' : 'Stock sheet downloaded (Excel CSV).',
    csvNoData: isRtl ? 'لا توجد أصناف لتصديرها بعد.' : 'There are no products to export yet.',
  };

  const handleExportBackup = () => {
    sounds.playClick();
    setStatus({ type: '', message: '' });
    const backup = buildStoreBackup({
      creator: user?.email,
      settings, products, invoices, employees, payrollRecords, customers, customerTransactions,
      suppliers, supplierTransactions, shifts, orders, vaultTransactions, warehouses, vault,
    });
    downloadFile(JSON.stringify(backup, null, 2), 'application/json', `mostawdaee_backup_${new Date().toISOString().slice(0, 10)}.json`);
    sounds.playSuccess();
    setStatus({
      type: 'success',
      message: isRtl ? 'تم تنزيل النسخة. احتفظ بالملف في مكان آمن.' : 'Backup downloaded. Keep the file somewhere safe.',
    });
    setBackupStats(backupCounts(backup));
    setBackupDate(new Date().toLocaleString(isRtl ? 'ar-EG' : 'en-US'));
  };

  const executeFileImport = (file: File) => {
    if (!file || loading || importingRef.current) return;
    importingRef.current = true;
    setStatus({ type: '', message: '' });
    setBackupStats(null);

    const reader = new FileReader();
    reader.onerror = () => {
      importingRef.current = false;
      sounds.playError();
      setStatus({ type: 'error', message: t.invalidFile });
    };
    reader.onload = async (e) => {
      try {
        await importText(e);
      } finally {
        importingRef.current = false;
      }
    };
    reader.readAsText(file);
  };

  const importText = async (e: ProgressEvent<FileReader>) => {
    let data: any;
    try {
      data = JSON.parse(String(e.target?.result || ''));
    } catch {
      sounds.playError();
      setStatus({ type: 'error', message: t.invalidFile });
      return;
    }
    if (isLegacyTableBackup(data)) {
      sounds.playError();
      setStatus({ type: 'error', message: t.legacyFile });
      return;
    }
    if (!isStoreBackup(data)) {
      sounds.playError();
      setStatus({ type: 'error', message: t.invalidFile });
      return;
    }
    if (!window.confirm(t.confirmText)) {
      sounds.playClick();
      return;
    }
    if (!user) return;

    setLoading(true);
    toast.info(t.processingRestore);
    try {
      await restoreStoreBackup(data, {
        saveSettings, saveWarehouse, saveProduct, saveInvoice, saveEmployee, savePayrollRecord, saveCustomer, saveCustomerTransaction,
        saveSupplierRecord: (sp) => setDoc(doc(db, 'users', user.uid, 'suppliers', sp.id), sp),
        saveSupplierTransaction: (tx) => setDoc(doc(db, 'users', user.uid, 'supplier_transactions', tx.id), tx),
        saveShift: (shift) => setDoc(doc(db, 'users', user.uid, 'shifts', shift.id), shift),
        saveOrder: (order) => setDoc(doc(db, 'users', user.uid, 'orders', order.id), order),
        saveVaultRecord: (tx) => setDoc(doc(db, 'users', user.uid, 'vault_records', tx.id), tx),
        restoreVault: (v) => restoreVaultBalance(db, user.uid, v),
      }, { invoices, vaultTransactions, customerTransactions, supplierTransactions });
      sounds.playSuccess();
      setStatus({ type: 'success', message: isRtl ? 'تمت استعادة السجلات من الملف.' : 'Records were restored from the file.' });
      setBackupStats(backupCounts(data));
      if (data.timestamp) setBackupDate(new Date(data.timestamp).toLocaleString(isRtl ? 'ar-EG' : 'en-US'));
    } catch (err: any) {
      console.error(err);
      sounds.playError();
      setStatus({
        type: 'error',
        message: vaultRestoreMessage(err, isRtl) || (isRtl
          ? 'توقفت الاستعادة قبل اكتمالها. تحقق من الاتصال ومن أن الملف نسخة احتياطية من مستودعي، ثم أعد المحاولة.'
          : 'The restore stopped before finishing. Check your connection and that the file is a Mostawdaee backup, then try again.'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    sounds.playClick();
    setStatus({ type: '', message: '' });
    if (products.length === 0) {
      setStatus({ type: 'error', message: t.csvNoData });
      return;
    }
    const csv = stockCsv(products, warehouses, isRtl, settings?.currency || 'JOD');
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(csv, 'text/csv;charset=utf-8;', isRtl ? `تقرير_جرد_المخزون_${dateStr}.csv` : `inventory_stock_report_${dateStr}.csv`);
    sounds.playSuccess();
    setStatus({ type: 'success', message: t.csvSuccess });
  };

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
    e.target.value = '';
  };

  const statCards: Array<{ key: keyof ReturnType<typeof backupCounts>; ar: string; en: string }> = [
    { key: 'products', ar: 'المنتجات والسلع', en: 'Products' },
    { key: 'warehouses', ar: 'المستودعات', en: 'Warehouses' },
    { key: 'invoices', ar: 'الفواتير', en: 'Invoices' },
    { key: 'employees', ar: 'الموظفون', en: 'Employees' },
    { key: 'customers', ar: 'العملاء', en: 'Customers' },
    { key: 'vaultTransactions', ar: 'حركات الخزنة', en: 'Vault movements' },
  ];

  return (
    <div className={`max-w-4xl mx-auto p-4 md:p-8 ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mb-10 text-center md:text-right">
        <h1 className="text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight flex items-center justify-center md:justify-start gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white">
            <Database size={24} />
          </div>
          {t.title}
        </h1>
        <p className="text-slate-500 dark:text-gray-400 mt-2 text-md leading-relaxed">
          {t.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 p-6 md:p-8 shadow-xl flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-400/20">
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
              className="w-full flex items-center justify-center gap-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-black py-4 px-4 rounded-2xl transition duration-200 active:scale-95 text-xs uppercase select-none cursor-pointer"
            >
              <Download size={16} />
              {loading ? t.preparingBackup : t.btnExport}
            </button>
          </div>
        </div>

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
            onClick={() => !loading && fileInputRef.current?.click()}
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
              {loading ? t.processingRestore : t.dragText}
            </span>
            <span className="text-[10px] text-indigo-500 font-extrabold tracking-widest font-mono uppercase">
              .JSON
            </span>
          </div>
        </div>

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
              className="w-full flex items-center justify-center gap-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-black py-4 px-4 rounded-2xl transition duration-200 active:scale-95 text-xs uppercase select-none cursor-pointer"
            >
              <FileSpreadsheet size={16} />
              {t.btnCsv}
            </button>
          </div>
        </div>
      </div>

      {status.message && (
        <div className={`mt-8 p-5 rounded-3xl border text-sm flex items-start gap-4
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
              {status.type === 'success' ? t.successTitle : (isRtl ? 'لم تكتمل العملية' : 'Not completed')}
            </h4>
            <p className="font-arabic leading-relaxed text-xs opacity-90">{status.message}</p>
          </div>
        </div>
      )}

      {backupStats && (
        <div className="mt-8 bg-slate-50 dark:bg-slate-900/50 border border-slate-200/50 dark:border-white/5 p-6 rounded-[2rem] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/5 pb-3">
            <h4 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block leading-none flex items-center gap-2">
              <CloudLightning size={14} className="text-indigo-500" />
              {isRtl ? 'محتوى النسخة' : 'Backup contents'}
            </h4>
            <span className="text-[10px] font-mono opacity-60">{backupDate}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
            {statCards.map((card) => (
              <div key={card.key} className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-white/5">
                <span className="opacity-60 block text-[10px] uppercase font-bold text-slate-400">{isRtl ? card.ar : card.en}</span>
                <span className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 block mt-1">{backupStats[card.key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
