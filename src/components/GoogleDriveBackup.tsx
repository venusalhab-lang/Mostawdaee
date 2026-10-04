import React, { useState, useEffect } from 'react';
import { 
  Cloud, CloudLightning, ShieldCheck, RefreshCw, Download, Upload, 
  Trash2, Play, CheckCircle2, AlertTriangle, Link, Link2, LogIn, ExternalLink, RefreshCw as Spinner, Lock
} from 'lucide-react';
import { Language } from '../types';
import { useFirebase } from './FirebaseProvider';
import { 
  hasDriveAccessToken, 
  listBackupFiles, 
  uploadBackupFile, 
  downloadBackupFile, 
  deleteBackupFile, 
  setDriveAccessToken,
  DriveFile 
} from '../services/googleDrive';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { sounds } from '../lib/sounds';
import { GoogleAuthProvider, signInWithPopup, auth, googleProvider, db } from '../services/firebase';
import { doc, setDoc } from '../lib/supabaseDocs';

interface Props {
  language: Language;
}

export default function GoogleDriveBackup({ language }: Props) {
  const isRtl = language === 'ar';
  
  const { 
    user, 
    products, 
    invoices, 
    employees, 
    payrollRecords, 
    customers, 
    customerTransactions,
    warehouses, 
    vault,
    vaultTransactions,
    settings,
    saveSettings,
    saveProduct,
    saveInvoice,
    saveEmployee,
    savePayrollRecord,
    saveCustomer,
    saveCustomerTransaction,
    saveWarehouse,
  } = useFirebase();

  const [isConnected, setIsConnected] = useState(hasDriveAccessToken());
  const [backups, setBackups] = useState<DriveFile[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isBackupInProgress, setIsBackupInProgress] = useState(false);
  const [isRestoreInProgress, setIsRestoreInProgress] = useState(false);
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<DriveFile | null>(null);
  const [selectedBackupForDelete, setSelectedBackupForDelete] = useState<DriveFile | null>(null);

  // Helper handling of Google Drive session expiration or errors
  const handleDriveError = (err: any, fallbackMessage: string) => {
    console.error(err);
    const msg = err?.message || '';
    if (
      msg.includes('401') || 
      msg.includes('403') || 
      msg.toLowerCase().includes('unauthorized') || 
      msg.toLowerCase().includes('invalid authentication credentials')
    ) {
      setIsConnected(false);
      setDriveAccessToken('');
      toast.error(
        isRtl 
          ? "انتهت صلاحية جلسة Google Drive. الرجاء الاتصال بالحساب مجدداً." 
          : "Google Drive session expired. Please reconnect to your account."
      );
    } else {
      toast.error(fallbackMessage);
    }
  };

  // Load list of backups from Drive if connected
  const loadBackups = async () => {
    if (!hasDriveAccessToken()) return;
    setIsLoadingList(true);
    try {
      const files = await listBackupFiles();
      setBackups(files);
    } catch (err: any) {
      handleDriveError(err, isRtl ? "فشل البحث واسترداد قائمة الملفات" : "Failed to list backup files / retrieve list");
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    setIsConnected(hasDriveAccessToken());
    if (hasDriveAccessToken()) {
      loadBackups();
    }
  }, [isConnected]);

  // Connect Google Drive Action
  const handleConnect = async () => {
    sounds.playClick();
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setDriveAccessToken(credential.accessToken);
        setIsConnected(true);
        toast.success(isRtl ? "تم ربط حساب Google Drive بنجاح! 🎉" : "Connected Google Drive successfully! 🎉");
        loadBackups();
      } else {
        throw new Error("Unable to obtain Drive Token");
      }
    } catch (err) {
      console.error(err);
      toast.error(isRtl ? "فشل الاتصال بـ Google Drive" : "Failed to authenticate with Google Drive");
    }
  };

  // Perform Backup Creation to Google Drive
  const handleCreateBackup = async () => {
    sounds.playClick();
    if (!isConnected) return;
    
    setIsBackupInProgress(true);
    try {
      const payload = {
        products,
        invoices,
        employees,
        payrollRecords,
        customers,
        customerTransactions,
        warehouses,
        vault,
        vaultTransactions,
        settings,
        timestamp: Date.now(),
        creator: user?.email || 'Anonymous',
        app: 'Mostawdaee System'
      };

      const dateStr = new Date().toISOString().split('T')[0];
      const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `mustawdae_backup_${dateStr}_${timeStr}.json`;
      const fileContent = JSON.stringify(payload, null, 2);

      await uploadBackupFile(filename, fileContent);
      
      toast.success(
        isRtl 
          ? "تم رفع ملف النسخة الاحتياطية بنجاح إلى حسابك على Google Drive! ☁️" 
          : "Backup successfully compiled and shipped to Google Drive! ☁️"
      );
      loadBackups();
    } catch (err) {
      handleDriveError(err, isRtl ? "فشل إنشاء النسخة الاحتياطية" : "Creating backup file failed");
    } finally {
      setIsBackupInProgress(false);
    }
  };

  // Perform Restore Operations securely
  const handleConfirmRestore = async () => {
    sounds.playClick();
    if (!selectedBackupForRestore) return;
    
    setIsRestoreInProgress(true);
    try {
      toast.info(isRtl ? "جاري تحميل وقراءة ملف النسخة..." : "Retrieving cloud backup stream...");
      const backupData = await downloadBackupFile(selectedBackupForRestore.id);

      if (!backupData || (!backupData.products && !backupData.invoices)) {
        throw new Error("Invalid or empty backup payload data.");
      }

      toast.info(isRtl ? "جاري إعادة بناء الجداول والبيانات..." : "Applying schema tables and restoring references...");

      // 1. Restore settings
      if (backupData.settings) {
        await saveSettings(backupData.settings);
      }

      // 2. Restore Warehouses
      if (Array.isArray(backupData.warehouses)) {
        for (const wh of backupData.warehouses) {
          await saveWarehouse(wh);
        }
      }

      // 3. Restore Products
      if (Array.isArray(backupData.products)) {
        for (const prod of backupData.products) {
          await saveProduct(prod, { skipMovement: true });
        }
      }

      // 4. Restore Invoices
      if (Array.isArray(backupData.invoices)) {
        for (const item of backupData.invoices) {
          await saveInvoice(item, { restoreOnly: true });
        }
      }

      // 5. Restore Employees
      if (Array.isArray(backupData.employees)) {
        for (const emp of backupData.employees) {
          await saveEmployee(emp);
        }
      }

      // 6. Restore Payrolls
      if (Array.isArray(backupData.payrollRecords)) {
        for (const pr of backupData.payrollRecords) {
          await savePayrollRecord(pr);
        }
      }

      // 7. Restore Customers
      if (Array.isArray(backupData.customers)) {
        for (const cust of backupData.customers) {
          await saveCustomer(cust, { restore: true });
        }
      }

      // 7b. Restore the customer ledger (without it debts would have no history)
      if (Array.isArray(backupData.customerTransactions)) {
        for (const tx of backupData.customerTransactions) {
          await saveCustomerTransaction(tx);
        }
      }

      // 8. Restore Vault (movements first, then the balance snapshot that goes with them)
      if (user?.uid) {
        if (Array.isArray(backupData.vaultTransactions)) {
          for (const tx of backupData.vaultTransactions) {
            await setDoc(doc(db, 'users', user.uid, 'vault_records', tx.id), tx);
          }
        }
        if (backupData.vault) {
          await setDoc(doc(db, 'users', user.uid, 'settings', 'vault'), backupData.vault);
        }
      }

      toast.success(
        isRtl 
          ? "تم استعادة كافة البيانات السحابية والمستندات بنجاح من النسخة الاحتياطية! 🚀" 
          : "Full-system restore completed successfully from Google Drive! 🚀"
      );
      setSelectedBackupForRestore(null);
    } catch (err: any) {
      handleDriveError(err, isRtl ? `فشل عملية استعادة البيانات: ${err.message}` : `Data restore failure: ${err.message}`);
    } finally {
      setIsRestoreInProgress(false);
    }
  };

  // Perform Delete Backup
  const handleConfirmDelete = async () => {
    sounds.playClick();
    if (!selectedBackupForDelete) return;

    try {
      await deleteBackupFile(selectedBackupForDelete.id);
      toast.success(isRtl ? "تم حذف ملف النسخة الاحتياطية بنجاح" : "Cloud backup discarded successfully");
      setBackups(prev => prev.filter(f => f.id !== selectedBackupForDelete.id));
      setSelectedBackupForDelete(null);
    } catch (err) {
      handleDriveError(err, isRtl ? "فشل حذف الملف من السحابة" : "Failed to discard backup from Drive");
    }
  };

  const formatSize = (bytesStr?: string) => {
    if (!bytesStr) return 'Unknown';
    const bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes)) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return dateStr;
    }
  };

  return (
    <div className={`max-w-6xl mx-auto p-4 md:p-8 ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header Banner */}
      <div className="mb-10 text-center md:text-left">
        <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center justify-center md:justify-start gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100 dark:shadow-indigo-900/30 rotate-3">
            <Cloud size={28} className="animate-pulse" />
          </div>
          {isRtl ? "مزامنة Google Drive السحابية" : "Google Drive Cloud Synchronizer"}
        </h1>
        <p className="text-slate-500 dark:text-gray-400 mt-2 text-lg">
          {isRtl 
            ? "احمِ بيانات مستودعك، رصيدك، وتاريخ مبيعاتك عبر حفظ واسترجاع نسخ مشفرة من ملفاتك على Google Drive الخاص بك." 
            : "Protect and secure your stock items, physical vault parameters, and invoices inside your personal Google Drive cabinet."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Control Card: Connect & Backup Actions */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-200/60 dark:border-slate-700/50 p-6 shadow-2xl space-y-6">
            <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <CloudLightning className="text-indigo-600 dark:text-indigo-400" size={20} />
              {isRtl ? "حالة الاتصال السحابي" : "Cloud Connectivity Status"}
            </h3>

            {/* Glowing Connection Indicator */}
            {isConnected ? (
              <div className="p-4 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <div>
                  <span className="text-xs text-slate-400 block tracking-tight leading-none uppercase font-bold">
                    {isRtl ? "المستودع السحابي" : "Active Drive Safe"}
                  </span>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 block mt-1">
                    {isRtl ? "متصل بالكامل بـ Google Drive" : "Fully connected to Google Drive"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                </span>
                <div>
                  <span className="text-xs text-slate-400 block tracking-tight leading-none uppercase font-bold">
                    {isRtl ? "البث السحابي" : "Cloud Stream"}
                  </span>
                  <span className="text-sm font-bold text-amber-600 dark:text-amber-400 block mt-1">
                    {isRtl ? "غير متصل بالسحابة" : "Not connected to Drive"}
                  </span>
                </div>
              </div>
            )}

            {/* Explainer / Description */}
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-arabic">
              {isRtl 
                ? "يتم تشفير وتوليد ملف النسخة الاحتياطية في ذاكرة التطبيق، ثم يتم رفعها مباشرة إلى مساحة التخزين الخاصة بك على حساب Google الشخصي بأعلى سرعة وأمان." 
                : "Compilation of data happens exclusively in local sandboxed memory before being safely uploaded as structured objects to your personal cabinet."}
            </p>

            {/* Action Buttons */}
            <div className="space-y-3 pt-2">
              {!isConnected ? (
                <button
                  onClick={handleConnect}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2.5 shadow-lg shadow-indigo-100 dark:shadow-none active:scale-95 cursor-pointer"
                >
                  <LogIn size={16} />
                  {isRtl ? "ربط الحساب بـ Google Drive" : "Connect with Google Drive"}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleCreateBackup}
                    disabled={isBackupInProgress}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2.5 shadow-lg shadow-indigo-100 dark:shadow-none active:scale-95 cursor-pointer"
                  >
                    {isBackupInProgress ? (
                      <Spinner size={16} className="animate-spin" />
                    ) : (
                      <Upload size={16} />
                    )}
                    {isRtl ? "إنشاء نسخة احتياطية جديدة" : "Save Cloud Backup Now"}
                  </button>

                  <button
                    onClick={loadBackups}
                    className="w-full py-4 bg-slate-50 dark:bg-slate-700/40 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={14} />
                    {isRtl ? "تحديث قائمة السحابة" : "Refresh Backups List"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/40 dark:border-slate-800 rounded-[2rem] p-6 space-y-4">
            <h4 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block leading-none">
              {isRtl ? "ملخص حجم الجداول النشطة" : "Active Database Metrics"}
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center py-1">
                <span className="opacity-60">{isRtl ? "أصناف مخزن المنتجات :" : "Warehouse Products:"}</span>
                <span className="font-extrabold">{products.length} {isRtl ? "صنف" : "items"}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="opacity-60">{isRtl ? "إجمالي الفواتير والقيود :" : "Invoices & Records:"}</span>
                <span className="font-extrabold">{invoices.length} {isRtl ? "فاتورة" : "bills"}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="opacity-60">{isRtl ? "أعضاء كادر الموظفين :" : "Employees Rostered:"}</span>
                <span className="font-extrabold">{employees.length} {isRtl ? "قيد" : "staff"}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="opacity-60">{isRtl ? "قائمة دفاتر العملاء السريعة :" : "Customer Ledgers:"}</span>
                <span className="font-extrabold">{customers.length} {isRtl ? "حساب" : "clients"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Content Card: Display Backups Files List */}
        <div className="lg:col-span-8">
          <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-200/60 dark:border-slate-700/50 p-6 sm:p-8 shadow-2xl relative min-h-[450px]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  {isRtl ? "النسخ الاحتياطية المتوفرة على السحابة" : "Cloud Backups History"}
                </h3>
                <span className="text-xs text-slate-400 font-bold block mt-1 uppercase tracking-widest font-mono">
                  📂 {isRtl ? "مسار التخزين الافتراضي" : "Mostawdaee Cloud Storage Directory"}
                </span>
              </div>
              
              <div className="px-3 py-1 bg-indigo-50 dark:bg-indigo-950/20 text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase rounded-lg">
                {backups.length} {isRtl ? "ملفات مكتشفة" : "Backups Found"}
              </div>
            </div>

            {/* List Body State router */}
            {!isConnected ? (
              <div className="flex flex-col items-center justify-center p-12 text-center h-[300px]">
                <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700/30 rounded-2xl flex items-center justify-center text-slate-400 mb-4 scale-90">
                  <Lock size={32} />
                </div>
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {isRtl ? "يتطلب ربط الاتصال بـ Google" : "Connection Required"}
                </h4>
                <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mt-1 leading-relaxed">
                  {isRtl 
                    ? "الرجاء تسجيل الدخول بحساب Google لتمكين قراءة تيار ملفات النسخ المتاحة واستيرادها."
                    : "Establish cloud handshaking to query standard files previously saved."}
                </p>
              </div>
            ) : isLoadingList ? (
              <div className="flex flex-col items-center justify-center p-12 text-center h-[300px]">
                <Spinner size={32} className="animate-spin text-indigo-600 mb-2" />
                <span className="text-xs text-slate-400 font-bold">{isRtl ? "جاري البحث واسترداد قائمة الملفات..." : "Fetching cloud database backups..."}</span>
              </div>
            ) : backups.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center h-[300px]">
                <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700/30 rounded-2xl flex items-center justify-center text-slate-300 mb-4">
                  ☁️
                </div>
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {isRtl ? "لا توجد نسخ احتياطية للتطبيق حتى الآن" : "No Cloud Backups Found"}
                </h4>
                <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mt-1 leading-relaxed">
                  {isRtl 
                    ? "قم بإنشاء نسخة احتياطية جديدة وسيتم إدراجها هنا لتتمكن من استعادتها في أي وقت."
                    : "Create a new backup checkpoint list to securely seal your data."}
                </p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                {backups.map((file) => (
                  <div 
                    key={file.id} 
                    className="group p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/40 dark:border-slate-700/30 hover:bg-slate-100/50 dark:hover:bg-slate-700/50 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all duration-300"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-800 dark:text-slate-200 break-all select-all font-sans">
                          {file.name}
                        </span>
                        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded font-mono text-[9px]">JSON</span>
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-3">
                        <span>📅 {formatDate(file.createdTime)}</span>
                        <span>⚖️ {formatSize(file.size)}</span>
                      </div>
                    </div>

                    {/* Action buttons on hover / responsive */}
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={() => setSelectedBackupForRestore(file)}
                        className="px-4 py-2 font-black text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl transition duration-300 flex items-center gap-1.5 active:scale-95 cursor-pointer"
                        title={isRtl ? "استعادة من هذه النسخة البديلة" : "Apply Restore State"} aria-label={isRtl ? "استعادة من هذه النسخة البديلة" : "Apply Restore State"}
                      >
                        <RefreshCw size={12} />
                        {isRtl ? "استعادة البيانات" : "Restore Data"}
                      </button>

                      <button
                        onClick={() => setSelectedBackupForDelete(file)}
                        className="p-2 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 rounded-xl transition cursor-pointer"
                        title={isRtl ? "حذف قيد النسخة نهائياً" : "Discard from cloud"} aria-label={isRtl ? "حذف قيد النسخة نهائياً" : "Discard from cloud"}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* MODAL 1: Confirm restore operations (MANDATORY User Confirmation for data modifying operations) */}
      <AnimatePresence>
        {selectedBackupForRestore && (
          <div className="fixed inset-0 bg-slate-950/40 dark:bg-slate-950/70 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 max-w-lg w-full shadow-3xl text-slate-800 dark:text-white space-y-6"
            >
              <div className="flex items-center gap-4 text-amber-500">
                <div className="w-14 h-14 bg-amber-500/10 rounded-2xl flex items-center justify-center">
                  <AlertTriangle size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold uppercase tracking-tight">
                    {isRtl ? "تحذير: استعادة وتجاوز البيانات!" : "Double Check Confirmation"}
                  </h3>
                  <span className="text-xs text-amber-600 font-bold block uppercase tracking-wider">{isRtl ? "إجراء حسّاس وتخريبي" : "Critical Destructive Action"}</span>
                </div>
              </div>

              <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <p className="font-arabic">
                  {isRtl 
                    ? `أنت على وشك استبدال كافة أصناف المنتجات، الرصيد بالخزنة، فواتير المبيعات، كادر الموظفين والمستودعات الحالية بالقيم المخزنة في النسخة السحابية:`
                    : `You are about to clear and permanently overwrite all currently deployed database documents, physical counts, ledger sheets, and currency coefficients with those matched inside:`}
                </p>
                <div className="font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded-lg font-bold select-all overflow-x-auto break-all text-[11px] text-slate-800 dark:text-cyan-400">
                  {selectedBackupForRestore.name}
                </div>
                <p className="font-arabic font-bold text-amber-600">
                  ⚠️ {isRtl ? "هذا الإجراء سيقوم بمسح البيانات الحالية ولا يمكن التراجع عنه!" : "Warning: Existing logs will be permanently updated. This action cannot be reverted."}
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setSelectedBackupForRestore(null)}
                  disabled={isRestoreInProgress}
                  className="px-5 py-3 text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-bold text-slate-700 dark:text-slate-300 rounded-xl transition active:scale-95 cursor-pointer"
                >
                  {isRtl ? "إلغاء الأمر" : "Cancel"}
                </button>
                <button
                  onClick={handleConfirmRestore}
                  disabled={isRestoreInProgress}
                  className="px-6 py-3 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md uppercase tracking-wider transition active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  {isRestoreInProgress ? <Spinner size={14} className="animate-spin" /> : <Play size={12} />}
                  {isRtl ? "نعم، استعد نسخة البيانات" : "Proceed System Restore"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: Confirm backup deletion */}
      <AnimatePresence>
        {selectedBackupForDelete && (
          <div className="fixed inset-0 bg-slate-950/40 dark:bg-slate-950/70 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 max-w-lg w-full shadow-3xl text-slate-800 dark:text-white space-y-6"
            >
              <div className="flex items-center gap-4 text-rose-500">
                <div className="w-14 h-14 bg-rose-500/10 rounded-2xl flex items-center justify-center">
                  <Trash2 size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold uppercase tracking-tight">
                    {isRtl ? "تأكيد حذف ملف النسخة احتياطياً!" : "Delete Cloud File Confirm?"}
                  </h3>
                  <span className="text-xs text-rose-600 font-bold block uppercase tracking-wider">{isRtl ? "إجراء لا يمكن التراجع عنه" : "Permanent Deletion"}</span>
                </div>
              </div>

              <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-2xl space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <p className="font-arabic">
                  {isRtl 
                    ? `هل أنت متأكد تماماً من رغبتك في مسح ملف النسخة الاحتياطية نهائياً من حساب Google Drive السحابي الخاص بك؟`
                    : `Are you absolutely sure you want to discard and delete this timestamped backup object from Cloud storage?`}
                </p>
                <div className="font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded-lg font-bold overflow-x-auto break-all text-[11px] text-slate-800 dark:text-rose-400">
                  {selectedBackupForDelete.name}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setSelectedBackupForDelete(null)}
                  className="px-5 py-3 text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 font-bold text-slate-700 dark:text-slate-300 rounded-xl transition active:scale-95 cursor-pointer"
                >
                  {isRtl ? "إلغاء الأمر" : "Cancel"}
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="px-6 py-3 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md uppercase tracking-wider transition active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  <Trash2 size={12} />
                  {isRtl ? "نعم، احذف الملف" : "Proceed Discard"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
