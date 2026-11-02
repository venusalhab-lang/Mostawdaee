import React, { useEffect, useRef, useState, useMemo } from 'react';
import { 
  Shield, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  History, 
  Plus, 
  Minus,
  Search,
  X,
  Wallet,
  TrendingDown,
  TrendingUp,
  Receipt,
  Download,
  Filter,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFirebase } from './FirebaseProvider';
import { Language, VaultTransaction, VaultSource, AppSettings, Currency } from '../types';
import { translations } from '../translations';
import { toast } from 'sonner';
import { useSuccessCelebration } from '../hooks/useSuccessCelebration';
import { sounds } from '../lib/sounds';
import ExcelExportButton from './ui/ExcelExportButton';
import DateField from './ui/DateField';
import ShowMoreBar from './ui/ShowMoreBar';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { formatMoney } from '../lib/exchangeRates';
import { VAULT_CURRENCIES, readVaultBalances, roundForCurrency } from '../lib/vaultMath';
import { localDayEnd, localDayStart } from '../lib/localDate';
import { downloadCsv, toCsv } from '../lib/csv';

interface Props {
  language: Language;
  settings: AppSettings;
}

type VaultKind = 'sale' | 'sale_return' | 'customer_payment' | 'purchase' | 'purchase_return' | 'supplier_payment' | 'payroll' | 'expense' | 'manual' | 'reversal';

const VAULT_KINDS: VaultKind[] = ['sale', 'sale_return', 'customer_payment', 'purchase', 'purchase_return', 'supplier_payment', 'payroll', 'expense', 'manual', 'reversal'];

const CURRENCY_NAMES: Record<Currency, { ar: string; en: string }> = {
  JOD: { ar: 'دينار أردني', en: 'Jordanian Dinar' },
  ILS: { ar: 'شيكل', en: 'Shekel' },
  USD: { ar: 'دولار أمريكي', en: 'US Dollar' },
  IQD: { ar: 'دينار عراقي', en: 'Iraqi Dinar' },
  SAR: { ar: 'ريال سعودي', en: 'Saudi Riyal' },
  AED: { ar: 'درهم إماراتي', en: 'UAE Dirham' },
  LYD: { ar: 'دينار ليبي', en: 'Libyan Dinar' },
  EGP: { ar: 'جنيه مصري', en: 'Egyptian Pound' },
};

/** Works for new entries (with `source`) and old ones (category only). */
function vaultKindOf(tx: VaultTransaction): VaultKind {
  const source: VaultSource | undefined = tx.source;
  if (source === 'sale_invoice') return 'sale';
  if (source === 'sale_return') return 'sale_return';
  if (source === 'purchase_invoice') return 'purchase';
  if (source === 'purchase_return') return 'purchase_return';
  if (source === 'supplier_payment') return 'supplier_payment';
  if (source === 'customer_payment') return 'customer_payment';
  if (source === 'payroll') return 'payroll';
  if (source === 'expense') return 'expense';
  if (source === 'reversal') return 'reversal';
  if (source === 'manual') return 'manual';
  if (tx.category === 'sale') return 'sale';
  if (tx.category === 'purchase') return 'purchase';
  if (tx.category === 'salary') return 'payroll';
  if (tx.category === 'manual') return 'manual';
  return tx.type === 'expense' ? 'expense' : 'manual';
}

export default function VaultManagement({ language, settings }: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';
  const { vault, vaultTransactions, recordVaultTransaction, recalibrateVault } = useFirebase();
  const { triggerCelebration } = useSuccessCelebration();
  
  // State variables for Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'income' | 'expense' | 'recalibrate'>('income');
  const [category, setCategory] = useState('general');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const entryDraftRef = useRef<string | null>(null);
  const openModal = (type: 'income' | 'expense' | 'recalibrate') => {
    setModalType(type);
    setCategory('general');
    setAmount('');
    setDescription('');
    setIsModalOpen(true);
  };
  
  // State variables for Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterKind, setFilterKind] = useState<'all' | VaultKind>('all');
  const [onlyActiveCurrency, setOnlyActiveCurrency] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Dynamic display currency toggle
  const [activeCurrency, setActiveCurrency] = useState<Currency>(VAULT_CURRENCIES.includes(settings.currency as Currency) ? (settings.currency as Currency) : 'JOD');
  useEffect(() => { entryDraftRef.current = null; }, [isModalOpen, modalType, category, amount, description, activeCurrency]);

  const expenseCategories = [
    { id: 'general', label: isRtl ? 'مصروف عام' : 'General Expense' },
    { id: 'rent', label: isRtl ? 'إيجار' : 'Rent' },
    { id: 'utilities', label: isRtl ? 'كهرباء ومياه واشتراكات' : 'Utilities' },
    { id: 'transport', label: isRtl ? 'نقل ولوجستيك داخلي' : 'Transport' },
    { id: 'tax', label: isRtl ? 'ضرائب ورسوم حكومية' : 'Taxes' },
  ];

  const incomeCategories = [
    { id: 'general', label: isRtl ? 'إيداع عام' : 'General Deposit' },
    { id: 'sale', label: isRtl ? 'عائدات مبيعات' : 'Sales Revenue' },
    { id: 'refund', label: isRtl ? 'مرتجع نقدي' : 'Cash Refund' },
    { id: 'investment', label: isRtl ? 'إيداع رأس مال' : 'Capital deposit' },
  ];

  const kindLabels: Record<VaultKind, string> = {
    sale: isRtl ? 'عائد مبيعات' : 'Sales',
    sale_return: isRtl ? 'مرتجع مبيعات' : 'Sales Return',
    purchase_return: isRtl ? 'مرتجع مشتريات' : 'Purchase Return',
    customer_payment: isRtl ? 'تحصيل من عميل' : 'Customer Payment',
    purchase: isRtl ? 'مشتريات' : 'Purchase',
    supplier_payment: isRtl ? 'دفعة لمورد' : 'Supplier Payment',
    payroll: isRtl ? 'رواتب' : 'Payroll',
    expense: isRtl ? 'مصاريف تشغيل' : 'Expenses',
    manual: isRtl ? 'حركة يدوية / تسوية' : 'Manual / Adjustment',
    reversal: isRtl ? 'قيد عكسي (حذف فاتورة)' : 'Reversal',
  };

  const txLabel = (tx: VaultTransaction) => kindLabels[vaultKindOf(tx)];

  // Formatting utility (per-currency decimals, e.g. IQD 0 / JOD 3)
  const formatCurrency = (val: number, customCurrency?: string) =>
    formatMoney(Number(val) || 0, customCurrency || activeCurrency, isRtl ? 'ar' : 'en-US');

  const balances = useMemo(() => readVaultBalances(vault), [vault]);

  // Get current active physical balance
  const activeBalance = balances[activeCurrency] ?? 0;

  // Calculate dynamic statistics representing income & expenses completed "Today" in the active currency
  const { todayIncome, todayExpense } = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTimestamp = startOfToday.getTime();

    let inc = 0;
    let exp = 0;

    vaultTransactions.forEach(tx => {
      // Must match active currency and have processed today
      if (tx.timestamp >= todayTimestamp && (tx.currency || 'JOD') === activeCurrency) {
        if (tx.type === 'income') {
          inc += tx.amount;
        } else if (tx.type === 'expense') {
          exp += tx.amount;
        }
      }
    });

    return { todayIncome: inc, todayExpense: exp };
  }, [vaultTransactions, activeCurrency]);

  // Advanced reactive transactions ledger filter
  const filteredTransactions = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const fTime = fromDate ? localDayStart(fromDate) : null;
    const tTime = toDate ? localDayEnd(toDate) : null;
    return vaultTransactions.filter(tx => {
      // 1. Text Search matching description, ID, or category
      const matchesSearch = !q ||
        tx.description?.toLowerCase().includes(q) ||
        tx.category?.toLowerCase().includes(q) ||
        txLabel(tx).toLowerCase().includes(q) ||
        tx.id?.toLowerCase().includes(q);
      
      // 2. Select Type filter
      const matchesType = filterType === 'all' || tx.type === filterType;

      // 3. Date Range starting 'From Date'
      const matchesFrom = fTime === null || tx.timestamp >= fTime;

      // 4. Date Range ending 'To Date'
      const matchesTo = tTime === null || tx.timestamp <= tTime;

      const matchesKind = filterKind === 'all' || vaultKindOf(tx) === filterKind;
      const matchesCurrency = !onlyActiveCurrency || (tx.currency || 'JOD') === activeCurrency;

      return matchesSearch && matchesType && matchesFrom && matchesTo && matchesKind && matchesCurrency;
    });
  }, [vaultTransactions, searchQuery, filterType, fromDate, toDate, filterKind, onlyActiveCurrency, activeCurrency]);
  const txPage = useProgressiveList(filteredTransactions, `${searchQuery}|${filterType}|${fromDate}|${toDate}|${filterKind}|${onlyActiveCurrency}|${activeCurrency}`);

  // Record/recalibrate a transaction
  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // A typed "-50" must be refused, not silently read as 50.
    const typed = String(amount).trim();
    const parsed = typed === '' ? NaN : Number(typed);
    const numAmount = Number.isFinite(parsed) ? roundForCurrency(parsed, activeCurrency) : NaN;
    const cleanWithdraw = numAmount;
    const cleanBalance = balances[activeCurrency] ?? 0;

    if (modalType === 'expense') {
      if (isNaN(cleanWithdraw) || cleanWithdraw <= 0) {
        toast.error(isRtl ? 'يرجى إدخال مبلغ سحب صحيح' : 'Please enter a valid withdrawal amount');
        return;
      }

      if (cleanWithdraw > cleanBalance) {
        toast.error(isRtl
          ? `الرصيد غير كافٍ بالخزنة! المتوفر: ${formatCurrency(cleanBalance)}`
          : `Insufficient funds in the vault! Available: ${formatCurrency(cleanBalance)}`);
        return;
      }
    } else {
      if (isNaN(numAmount) || numAmount < 0) {
        toast.error(isRtl ? 'يجب إدخال مبلغ صحيح أكبر من أو يساوي صفر' : 'Please enter a valid amount greater than or equal to zero');
        return;
      }

      if (modalType !== 'recalibrate' && numAmount === 0) {
        toast.error(isRtl ? 'يجب إدخال مبلغ صحيح أكبر من صفر للعمليات النقدية' : 'Please enter a valid amount greater than zero');
        return;
      }
    }

    if (modalType === 'recalibrate') {
      const reason = description.trim();
      if (reason.length < 3) {
        toast.error(isRtl
          ? 'اكتب سبب التسوية (3 أحرف على الأقل)؛ يُحفظ في سجل التدقيق.'
          : 'Enter a reason for the adjustment (at least 3 characters); it is kept in the audit record.');
        return;
      }
      const diff = roundForCurrency(numAmount - cleanBalance, activeCurrency);
      const confirmMsg = isRtl
        ? `تسوية ${activeCurrency}\nالحالي: ${formatCurrency(cleanBalance)}\nالجديد: ${formatCurrency(numAmount)}\nالفرق: ${formatCurrency(diff)}\nالسبب: ${reason}\n\nهل تعتمد التسوية؟`
        : `Adjust ${activeCurrency}\nCurrent: ${formatCurrency(cleanBalance)}\nNew: ${formatCurrency(numAmount)}\nDifference: ${formatCurrency(diff)}\nReason: ${reason}\n\nApply this adjustment?`;
      if (!window.confirm(confirmMsg)) return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (modalType === 'recalibrate') {
        await recalibrateVault(numAmount, activeCurrency, description.trim());
      } else {
        let mappedCategory: VaultTransaction['category'] = 'other';
        if (category === 'sale') mappedCategory = 'sale';
        else if (category === 'purchase') mappedCategory = 'purchase';
        else if (category === 'general') mappedCategory = 'manual';

        // Retrieve specific subcategory label for clearer description
        const selectedCat = (modalType === 'income' ? incomeCategories : expenseCategories).find(c => c.id === category);
        const categoryLabel = selectedCat ? selectedCat.label : (modalType === 'income' ? (isRtl ? 'إيداع نقدي غير مصنف' : 'Uncategorized Cash Deposit') : (isRtl ? 'سحب نقدي غير مصنف' : 'Uncategorized Cash Withdrawal'));
        const note = description.trim();
        const finalDescription = !note ? categoryLabel : (selectedCat && category !== 'general' ? `[${categoryLabel}] ${note}` : note);

        await recordVaultTransaction({
          id: (entryDraftRef.current ||= crypto.randomUUID()),
          type: modalType,
          category: mappedCategory,
          source: modalType === 'expense' && category !== 'general' ? 'expense' : 'manual',
          amount: numAmount,
          currency: activeCurrency,
          description: finalDescription
        });
      }

      triggerCelebration();
      sounds.playSuccess();
      toast.success(isRtl ? 'تم تسجيل العملية وتحديث الرصيد.' : 'Transaction saved and balance updated.');
      
      entryDraftRef.current = null;
      setIsModalOpen(false);
      setAmount('');
      setDescription('');
      setCategory('general');
    } catch (err: any) {
      if (!err?.notified) toast.error(isRtl ? 'حدث خطأ أثناء حفظ العملية' : 'An error occurred while saving the transaction');
    } finally {
      setIsSubmitting(false);
    }
  };

  // CSV Export utility
  const handleExportCSV = () => {
    try {
      if (filteredTransactions.length === 0) {
        toast.info(isRtl ? 'لا توجد حركات لتصديرها ضمن التصفية المحددة' : 'No transactions match the selected filters');
        return;
      }
      
      const headers = isRtl 
        ? ['المعرف المالي', 'التاريخ والوقت', 'نوع الحركة', 'التصنيف', 'المبلغ', 'العملة', 'الملاحظات والبيان', 'الرصيد بعد الحركة']
        : ['Tx ID', 'Timestamp', 'Type', 'Category', 'Amount', 'Currency', 'Notes/Description', 'Balance After'];
        
      const rows = filteredTransactions.map(tx => [
        `TX-${tx.id.substring(0, 8).toUpperCase()}`,
        new Date(tx.timestamp).toLocaleString('en-US'),
        tx.type === 'income' ? (isRtl ? 'إيداع / إيراد' : 'Income') : (isRtl ? 'سحب / مصروف' : 'Expense'),
        txLabel(tx),
        tx.amount,
        tx.currency,
        tx.description || '',
        tx.balanceAfter
      ]);
      
      downloadCsv(toCsv([headers, ...rows]), `mustawdae_vault_ledger_${new Date().toISOString().split('T')[0]}.csv`);
      
      sounds.playPop();
      toast.success(isRtl ? 'صُدّرت الحركات المعروضة إلى ملف CSV.' : 'Filtered ledger exported to CSV.');
    } catch (e) {
      toast.error(isRtl ? 'فشل تصدير التقرير المالي' : 'Failed to export financial ledger report');
    }
  };

  // Clear all filters
  const handleClearFilters = () => {
    setSearchQuery('');
    setFilterType('all');
    setFromDate('');
    setToDate('');
    setFilterKind('all');
    setOnlyActiveCurrency(false);
    toast.success(isRtl ? 'أُعيد ضبط التصفية' : 'Filters reset');
  };

  // Structured data formatting tailored for Excel sheet reports
  const buildExcelData = () => {
    return filteredTransactions.map(tx => {
      const isIncome = tx.type === 'income';
      const categoryLabel = txLabel(tx);

      if (isRtl) {
        return {
          'معرف الحركة': `#TX-${tx.id.substring(0, 8).toUpperCase()}`,
          'التاريخ والوقت': new Date(tx.timestamp).toLocaleString('en-US'),
          'نوع الحركة': isIncome ? 'إيداع / إيراد' : 'سحب / مصروف',
          'تصنيف الحركة': categoryLabel,
          'المبلغ': tx.amount,
          'العملة': tx.currency,
          'البيان والملاحظات': tx.description || '',
          'الرصيد بعد الحركة': tx.balanceAfter
        };
      } else {
        return {
          'Transaction ID': `#TX-${tx.id.substring(0, 8).toUpperCase()}`,
          'Timestamp': new Date(tx.timestamp).toLocaleString('en-US'),
          'Type': isIncome ? 'Income' : 'Expense',
          'Category': categoryLabel,
          'Amount': tx.amount,
          'Currency': tx.currency,
          'Statement / Description': tx.description || '',
          'Balance After': tx.balanceAfter
        };
      }
    });
  };

  return (
    <div className={`max-w-7xl mx-auto p-4 sm:p-6 space-y-8 notranslate text-comfortable page-fade-in ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* 1. Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-gray-200 dark:border-white/5">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3 tracking-tight">
            <Shield className="text-cyan-600 dark:text-[#00E5FF] drop-shadow-[0_0_15px_rgba(0,229,255,0.4)]" size={32} />
            <span className="heading-soft">{isRtl ? 'الخزنة' : 'Cash vault'}</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isRtl ? 'رصيد الخزنة وحركات الإيداع والسحب.' : 'Vault balance, deposits and withdrawals.'}
          </p>
        </div>
        
        {/* Cash flow action triggers */}
        <div className="flex flex-wrap items-center gap-3">
          <button 
            type="button"
            onClick={() => openModal('expense')}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 text-white font-bold text-sm shadow-md shadow-rose-950/20 transition-all active:scale-[0.98] border border-red-400/20"
          >
            <Minus size={16} />
            {isRtl ? 'سحب / صرف من الخزنة' : 'Withdrawal / Expense'}
          </button>
          
          <button 
            type="button"
            onClick={() => openModal('income')}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-sm shadow-md shadow-emerald-950/20 transition-all active:scale-[0.98] border border-emerald-400/20"
          >
            <Plus size={16} />
            {isRtl ? 'إيداع نقدي بالخزنة' : 'Cash Deposit'}
          </button>

          <button 
            type="button"
            onClick={() => openModal('recalibrate')}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-sm shadow-md shadow-cyan-950/20 transition-all active:scale-[0.98] border border-cyan-400/20"
          >
            <RefreshCw size={16} />
            {isRtl ? 'تسوية رصيد الخزنة' : 'Adjust vault balance'}
          </button>
        </div>
      </div>

      {/* 2. Glass-like Currency Toggle Toolbar */}
      <div className="bg-white dark:bg-slate-900/40 border border-slate-200/65 dark:border-white/[0.06] rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 select-none shadow-sm">
        <div className="flex items-center gap-2">
          <Wallet className="text-cyan-600 dark:text-[#00E5FF] w-4 h-4" />
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {isRtl ? 'عملة العرض والمعاملات:' : 'Display and transaction currency:'}
          </span>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {VAULT_CURRENCIES.map((cur) => (
            <button
              key={cur}
              type="button"
              onClick={() => {
                setActiveCurrency(cur);
                sounds.playPop();
              }}
              className={`flex-1 md:flex-none min-w-[110px] px-4 py-2.5 rounded-xl text-xs font-black transition-all text-center ${
                activeCurrency === cur 
                  ? 'bg-cyan-50 dark:bg-[#00E5FF]/15 text-cyan-600 dark:text-[#00E5FF] border border-cyan-200 dark:border-[#00E5FF]/40 shadow-[0_4px_12px_rgba(0,184,212,0.1)]'
                  : 'bg-slate-50 dark:bg-white/[0.02] hover:bg-slate-100 dark:hover:bg-white/[0.08] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/5'
              }`}
            >
              <span className="block">{isRtl ? CURRENCY_NAMES[cur].ar : CURRENCY_NAMES[cur].en} ({cur})</span>
              <span className="block font-mono text-[10px] opacity-80 mt-0.5">{formatMoney(balances[cur] || 0, cur, isRtl ? 'ar' : 'en-US')}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Bento-Grid statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Card 1: Total Current Balance */}
        <div className="relative overflow-hidden rounded-[2rem] bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-[#00E5FF]/20 p-8 shadow-md dark:shadow-2xl transition-all duration-500 hover:shadow-cyan-500/5 hover:-translate-y-1 group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#00E5FF]/5 rounded-full blur-3xl group-hover:bg-[#00E5FF]/10 transition-colors pointer-events-none" />
          <div className="relative space-y-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Wallet className="text-cyan-600 dark:text-[#00E5FF]" size={16} />
                {isRtl ? 'الرصيد الفعلي في الخزنة' : 'Total Safe Balance'}
              </span>
              <span className="text-[10px] bg-cyan-100 dark:bg-[#00E5FF]/10 border border-cyan-300 dark:border-[#00E5FF]/20 text-cyan-700 dark:text-[#00E5FF] px-2.5 py-1 rounded-md font-mono font-bold tracking-widest uppercase">
                {activeCurrency}
              </span>
            </div>
            
            <div className="relative font-black text-slate-900 dark:text-white tracking-tight tabular-nums font-mono pt-1 text-3xl sm:text-4xl">
              {formatCurrency(activeBalance)}
            </div>
            
            <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{isRtl ? 'الرصيد المسجّل في الدفاتر' : 'Balance recorded in the books'}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Today's Income */}
        <div className="relative overflow-hidden rounded-[2rem] bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-emerald-500/10 p-8 shadow-md dark:shadow-2xl transition-all duration-500 hover:shadow-emerald-500/5 hover:-translate-y-1 group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-colors pointer-events-none" />
          <div className="relative space-y-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="text-emerald-500 dark:text-emerald-400" size={16} />
                {isRtl ? 'إيرادات ومقبوضات اليوم' : 'Today\'s Cash Inflow'}
              </span>
              <span className="text-[10px] bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 rounded-md font-mono font-bold">
                +{activeCurrency}
              </span>
            </div>
            
            <div className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight tabular-nums font-mono pt-1">
              + {formatCurrency(todayIncome)}
            </div>
            
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {isRtl ? 'مجموع الداخل من مبيعات ومقبوضات اليوم' : 'Sum of registered deposits finalized today'}
            </p>
          </div>
        </div>

        {/* Card 3: Today's Expenses */}
        <div className="relative overflow-hidden rounded-[2rem] bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-rose-500/10 p-8 shadow-md dark:shadow-2xl transition-all duration-500 hover:shadow-rose-500/5 hover:-translate-y-1 group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-3xl group-hover:bg-rose-500/10 transition-colors pointer-events-none" />
          <div className="relative space-y-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                <TrendingDown className="text-rose-500 dark:text-rose-400" size={16} />
                {isRtl ? 'سحوبات ومصروفات اليوم' : 'Today\'s Cash Outflow'}
              </span>
              <span className="text-[10px] bg-rose-100 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 px-2.5 py-1 rounded-md font-mono font-bold">
                -{activeCurrency}
              </span>
            </div>
            
            <div className="text-3xl sm:text-4xl font-black text-rose-600 dark:text-rose-400 tracking-tight tabular-nums font-mono pt-1">
              - {formatCurrency(todayExpense)}
            </div>
            
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {isRtl ? 'مجموع السحوبات ومصروفات الكادر الحالية' : 'Sum of registered costs & wages debited today'}
            </p>
          </div>
        </div>

      </div>

      {/* 4. Filter and Configuration Toolbar */}
      <div className="bg-white dark:bg-slate-900/40 border border-slate-100 dark:border-white/[0.06] rounded-[2rem] p-6 space-y-6 shadow-sm">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="p-2.5 bg-cyan-100 dark:bg-[#00E5FF]/10 text-cyan-700 dark:text-[#00E5FF] rounded-xl">
              <Filter size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{isRtl ? 'تصفية الحركات' : 'Filter movements'}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{isRtl ? 'ابحث بالتاريخ أو النوع أو الوصف.' : 'Filter by date, type, or description.'}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            {/* Clear filters Button */}
            {(searchQuery || filterType !== 'all' || fromDate || toDate || filterKind !== 'all' || onlyActiveCurrency) && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="flex-1 md:flex-none px-4 py-2.5 rounded-xl border border-red-200 hover:bg-red-50 text-red-500 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10 text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={14} />
                {isRtl ? 'إعادة تعيين الفلاتر' : 'Reset Filters'}
              </button>
            )}

            {/* Export Report */}
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex-1 md:flex-none px-5 py-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-white rounded-xl border border-slate-200 dark:border-white/10 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              <Download size={14} />
              {isRtl ? 'تصدير التقرير (CSV)' : 'Export Ledger (CSV)'}
            </button>

            {/* Export Excel Report */}
            <ExcelExportButton 
              reportData={buildExcelData} 
              fileName={isRtl ? 'تقرير_الخزنة_المركزي' : 'central_vault_ledger'} 
              isRtl={isRtl} 
            />
          </div>
        </div>

        {/* Inputs row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          
          {/* Search Box */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isRtl ? 'البحث بالاسم أو البيان' : 'Search Details / Notes'}</label>
            <div className="relative">
              <Search className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-3' : 'left-3'} text-slate-400 w-4 h-4`} />
              <input 
                type="text"
                placeholder={isRtl ? 'ابحث في الوصف أو التصنيف...' : 'Search records...'} aria-label={isRtl ? 'ابحث في الوصف أو التصنيف...' : 'Search records...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'} py-2.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl outline-none text-xs focus:ring-1 focus:ring-[#00E5FF] transition-all text-slate-900 dark:text-white`}
              />
            </div>
          </div>

          {/* Movement Type Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isRtl ? 'نوع المعاملة' : 'Transaction Type'}</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl outline-none text-xs focus:ring-1 focus:ring-[#00E5FF] transition-all text-slate-900 dark:text-white"
            >
              <option value="all" className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">{isRtl ? 'جميع الحركات المالية' : 'All Movements'}</option>
              <option value="income" className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">{isRtl ? 'مقبوضات وإيداعات فقط' : 'Incomes Only'}</option>
              <option value="expense" className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">{isRtl ? 'مدفوعات ومصروفات فقط' : 'Expenses Only'}</option>
            </select>
          </div>

          {/* Source / kind selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isRtl ? 'مصدر الحركة' : 'Movement Source'}</label>
            <select
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value as any)}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl outline-none text-xs focus:ring-1 focus:ring-[#00E5FF] transition-all text-slate-900 dark:text-white"
            >
              <option value="all" className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">{isRtl ? 'كل المصادر' : 'All sources'}</option>
              {VAULT_KINDS.map(k => (
                <option key={k} value={k} className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">{kindLabels[k]}</option>
              ))}
            </select>
          </div>

          {/* Currency scope */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isRtl ? 'نطاق العملة' : 'Currency Scope'}</label>
            <select
              value={onlyActiveCurrency ? 'active' : 'all'}
              onChange={(e) => setOnlyActiveCurrency(e.target.value === 'active')}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl outline-none text-xs focus:ring-1 focus:ring-[#00E5FF] transition-all text-slate-900 dark:text-white"
            >
              <option value="all" className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">{isRtl ? 'كل العملات' : 'All currencies'}</option>
              <option value="active" className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">{isRtl ? `العملة المعروضة فقط (${activeCurrency})` : `Selected currency only (${activeCurrency})`}</option>
            </select>
          </div>

          {/* From date */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isRtl ? 'من تاريخ' : 'From Date'}</label>
            <DateField
              value={fromDate}
              max={toDate || undefined}
              onChange={setFromDate}
              compact
              aria-label={isRtl ? 'من تاريخ' : 'From Date'}
              className="w-full px-1 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl outline-none text-xs focus-within:ring-1 focus-within:ring-[#00E5FF] transition-all text-slate-900 dark:text-white"
            />
          </div>

          {/* To Date */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isRtl ? 'إلى تاريخ' : 'To Date'}</label>
            <DateField
              value={toDate}
              min={fromDate || undefined}
              onChange={setToDate}
              compact
              aria-label={isRtl ? 'إلى تاريخ' : 'To Date'}
              className="w-full px-1 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl outline-none text-xs focus-within:ring-1 focus-within:ring-[#00E5FF] transition-all text-slate-900 dark:text-white"
            />
          </div>

        </div>
      </div>

      {/* 5. Master Ledger Transaction Table */}
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-slate-900/25 border border-slate-200/80 dark:border-white/[0.06] rounded-[2rem] overflow-hidden shadow-sm md:shadow"
      >
        <div className="p-6 border-b border-slate-100 dark:border-white/[0.04] bg-slate-50/60 dark:bg-white/[0.01] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <History className="text-cyan-600 dark:text-[#00E5FF]" size={20} />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-sans">{isRtl ? 'سجل حركات الخزنة' : 'Vault movements'}</h2>
          </div>
          <span className="live-badge bg-cyan-100 text-cyan-800 dark:bg-cyan-500/10 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20 px-2.5 py-1 rounded text-[10px] font-bold">
            {isRtl ? 'يتحدّث مع السحابة' : 'Synced with the cloud'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right" dir={isRtl ? 'rtl' : 'ltr'}>
            <thead className="bg-slate-100/60 dark:bg-black/20 border-b border-slate-200/80 dark:border-white/[0.04]">
              <tr className="text-slate-500 dark:text-slate-400">
                <th className={`px-6 py-4 text-xs font-bold tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'التاريخ والوقت' : 'Timestamp'}</th>
                <th className={`px-6 py-4 text-xs font-bold tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'معرف الحركة' : 'Movement ID'}</th>
                <th className={`px-6 py-4 text-xs font-bold tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'التصنيف / نوع الحركة' : 'Category / Type'}</th>
                <th className={`px-6 py-4 text-xs font-bold tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'العملة' : 'Currency'}</th>
                <th className="px-6 py-4 text-xs font-bold tracking-wider text-center">{isRtl ? 'المبلغ' : 'Amount'}</th>
                <th className={`px-6 py-4 text-xs font-bold tracking-wider ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'البيان / الملاحظات والتفاصيل' : 'Statement Description'}</th>
                <th className="px-6 py-4 text-xs font-bold tracking-wider text-center">{isRtl ? 'الرصيد بعد الحركة' : 'Balance After'}</th>
              </tr>
            </thead>
            
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04] text-sm text-slate-800 dark:text-slate-100">
              <AnimatePresence>
                {txPage.visible.map((tx) => {
                  const isIncome = tx.type === 'income';
                  return (
                    <motion.tr 
                      key={tx.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors"
                    >
                      {/* Date */}
                      <td className="px-6 py-4 whitespace-nowrap text-slate-500 dark:text-slate-400 text-xs font-mono">
                        {new Date(tx.timestamp).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      
                      {/* Short ID */}
                      <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-cyan-600 dark:text-[#00E5FF]">
                        #TX-{tx.id.substring(0, 6).toUpperCase()}
                      </td>
                      
                      {/* Badge category */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold ${
                          isIncome 
                            ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20' 
                            : 'bg-rose-100 dark:bg-rose-500/10 text-rose-800 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20'
                        }`}>
                          {isIncome ? <ArrowUpCircle size={11} className="text-emerald-600 dark:text-emerald-400" /> : <ArrowDownCircle size={11} className="text-rose-600 dark:text-rose-400" />}
                          {txLabel(tx)}
                        </span>
                      </td>

                      {/* Currency */}
                      <td className="px-6 py-4 whitespace-nowrap font-mono font-bold text-slate-600 dark:text-slate-300 text-xs">
                        {tx.currency || 'JOD'}
                      </td>
                      
                      {/* Amount with clean coloration */}
                      <td className={`px-6 py-4 whitespace-nowrap text-xs font-bold text-center font-mono ${
                        isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {isIncome ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
                      </td>
                      
                      {/* Statement notes */}
                      <td className="px-6 py-4 text-slate-800 dark:text-slate-200 text-xs font-sans">
                        <span className="font-semibold block text-slate-800 dark:text-slate-300">{tx.description}</span>
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 tracking-wider font-mono">{vaultKindOf(tx)}</span>
                      </td>

                      {/* Balance After */}
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-center font-bold text-slate-600 dark:text-slate-400 font-mono">
                        {formatCurrency(tx.balanceAfter || 0, tx.currency)}
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
          <ShowMoreBar isRtl={isRtl} shown={txPage.shown} total={txPage.total} pageSize={txPage.pageSize} onMore={txPage.showMore} onAll={txPage.showAll} className="px-6 border-t border-slate-100 dark:border-white/[0.04]" />
          
          {filteredTransactions.length === 0 && (
            <div className="py-20 text-center space-y-4 bg-white dark:bg-slate-900/10">
              <div className="w-16 h-16 bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/[0.08] rounded-full flex items-center justify-center mx-auto text-slate-400 dark:text-slate-500">
                <Receipt size={32} />
              </div>
              <p className="text-slate-400 text-xs font-bold leading-relaxed">
                {isRtl ? 'لا توجد أي سجلات أو قيود مالية مسجلة حالياً ضمن النطاق المحدد' : 'No financial transaction rows saved.'}
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* 6. Glowing Neon Form Modal (Interactive 3D Wizard) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.96, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 15 }}
              className="relative w-full max-w-lg bg-[#ffffff] dark:bg-[#0e172a] border border-slate-200 dark:border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden text-slate-900 dark:text-white"
            >
              {/* Header */}
              <div className={`p-8 ${
                modalType === 'income' 
                  ? 'bg-emerald-500/10 border-b border-emerald-100 dark:border-emerald-500/20' 
                  : modalType === 'expense' 
                    ? 'bg-rose-500/10 border-b border-rose-100 dark:border-rose-500/20'
                    : 'bg-cyan-500/10 border-b border-cyan-100 dark:border-cyan-500/20'
              } text-slate-900 dark:text-white flex justify-between items-center`}>
                <div className="flex items-center gap-3">
                  {modalType === 'income' && <Plus className="text-emerald-600 dark:text-emerald-400" size={24} />}
                  {modalType === 'expense' && <Minus className="text-rose-600 dark:text-rose-400" size={24} />}
                  {modalType === 'recalibrate' && <RefreshCw className="text-cyan-600 dark:text-cyan-400 animate-spin-slow" size={24} />}
                  <div>
                    <h3 className="text-xl font-bold font-sans text-slate-900 dark:text-white">
                      {modalType === 'income' && (isRtl ? 'إيداع في الخزنة' : 'Cash deposit')}
                      {modalType === 'expense' && (isRtl ? 'سحب من الخزنة' : 'Cash withdrawal')}
                      {modalType === 'recalibrate' && (isRtl ? 'تسوية رصيد الخزنة' : 'Adjust vault balance')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {modalType === 'income' && (isRtl ? 'سجّل مبلغاً نقدياً دخل الخزنة.' : 'Record cash that came into the vault.')}
                      {modalType === 'expense' && (isRtl ? 'سجّل سحباً نقدياً أو مصروفاً من الخزنة.' : 'Record a cash withdrawal or expense from the vault.')}
                      {modalType === 'recalibrate' && (isRtl ? 'أدخل الرصيد الفعلي بعد الجرد لمطابقة رصيد الخزنة.' : 'Enter the counted balance to match the vault balance.')}
                    </p>
                  </div>
                </div>
                
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)} 
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition-all text-slate-500 dark:text-white"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={20} />
                </button>
              </div>

              {/* Form Content body */}
              <form onSubmit={handleAction} className="p-8 space-y-6">
                
                {/* Category selectors */}
                {modalType !== 'recalibrate' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isRtl ? 'تصنيف ونوع الحركة' : 'Allocation Sub-category'}</label>
                    <div className="flex flex-wrap gap-2">
                      {(modalType === 'income' ? incomeCategories : expenseCategories).map((cat) => (
                        <button
                           key={cat.id}
                           type="button"
                           onClick={() => setCategory(cat.id)}
                           className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                             category === cat.id 
                               ? (modalType === 'income' ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 border-emerald-500/40' : 'bg-rose-500/20 text-rose-800 dark:text-rose-400 border-rose-500/40')
                               : 'bg-slate-50 dark:bg-black/30 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/5 hover:text-slate-900 dark:hover:text-white'
                           }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Amount input alongside currency descriptor */}
                <div className="grid grid-cols-3 gap-4">
                  
                  {/* Amount */}
                  <div className="col-span-2 space-y-2">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      {modalType === 'recalibrate' 
                        ? (isRtl ? 'رصيد الخزنة الفعلي الجديد' : 'New counted vault balance')
                        : (isRtl ? 'مبلغ العملية المالي' : 'Transaction Value')}
                    </label>
                    <div className="relative">
                      <input 
                        type="number"
                        step="any"
                        min={0}
                        required
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-5 py-3.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl text-xl font-bold text-slate-900 dark:text-white focus:ring-1 focus:ring-cyan-400 transition-all outline-none"
                      />
                    </div>
                  </div>

                  {/* Active Currency */}
                  <div className="col-span-1 space-y-2">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isRtl ? 'العملة المعنية' : 'Currency'}</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-3.5 bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/5 rounded-2xl text-center font-bold text-slate-600 dark:text-slate-300 text-sm h-[54px] pointer-events-none select-none"
                      value={activeCurrency}
                      disabled
                    />
                  </div>

                </div>

                {/* Memorandum Descriptor */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {modalType === 'recalibrate'
                      ? (isRtl ? 'سبب التسوية وتفاصيل الجرد' : 'Reason / count details')
                      : (isRtl ? 'البيان / تفاصيل وملاحظات الحركة' : 'Description / notes')}
                  </label>
                  <textarea 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    required={modalType === 'recalibrate'}
                    minLength={modalType === 'recalibrate' ? 3 : undefined}
                    placeholder={modalType === 'recalibrate'
                      ? (isRtl ? 'مثال: تسوية النقدية مطابقة جرد نهاية الشهر...' : 'e.g. Month-end cash count adjustment...')
                      : (isRtl ? 'اكتب بياناً مفصلاً على هذه المعاملة (مثال: دفعة مبيعات الفاتورة #113)...' : 'Write memo details here...')} aria-label={modalType === 'recalibrate'
                      ? (isRtl ? 'سبب التسوية' : 'Adjustment reason')
                      : (isRtl ? 'بيان الحركة' : 'Transaction notes')}
                    className="w-full px-4 py-3.5 bg-slate-50 dark:bg-black/45 border border-slate-200 dark:border-white/10 rounded-2xl text-xs font-medium text-slate-900 dark:text-white focus:ring-1 focus:ring-cyan-500 outline-none transition-all resize-none"
                  />
                  {modalType === 'recalibrate' && (() => {
                    const typed = String(amount).trim();
                    const parsed = typed === '' ? NaN : Number(typed);
                    if (!Number.isFinite(parsed) || parsed < 0) return null;
                    const next = roundForCurrency(parsed, activeCurrency);
                    const diff = roundForCurrency(next - activeBalance, activeCurrency);
                    return (
                      <div className="rounded-xl border border-cyan-200/60 dark:border-cyan-500/20 bg-cyan-50/80 dark:bg-cyan-500/10 px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-200 space-y-0.5">
                        <div className="flex justify-between gap-2"><span>{isRtl ? 'الحالي' : 'Current'}</span><span className="font-mono" dir="ltr">{formatCurrency(activeBalance)}</span></div>
                        <div className="flex justify-between gap-2"><span>{isRtl ? 'الجديد' : 'New'}</span><span className="font-mono" dir="ltr">{formatCurrency(next)}</span></div>
                        <div className="flex justify-between gap-2"><span>{isRtl ? 'الفرق' : 'Difference'}</span><span className="font-mono" dir="ltr">{formatCurrency(diff)}</span></div>
                      </div>
                    );
                  })()}
                </div>

                {/* Confirm Action Button */}
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full disabled:opacity-60 disabled:cursor-not-allowed py-4 rounded-2xl font-black text-white shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2.5 ${
                    modalType === 'income' 
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-emerald-500/25' 
                      : modalType === 'expense'
                        ? 'bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 shadow-rose-500/25'
                        : 'bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 shadow-cyan-500/25'
                  }`}
                >
                  <Shield size={16} />
                  {modalType === 'income' && (isRtl ? 'اعتماد الإيداع في الخزنة' : 'Confirm deposit')}
                  {modalType === 'expense' && (isRtl ? 'اعتماد السحب من الخزنة' : 'Confirm withdrawal')}
                  {modalType === 'recalibrate' && (isRtl ? 'حفظ تسوية الرصيد' : 'Save balance adjustment')}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
