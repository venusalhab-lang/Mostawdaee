import React, { useState } from 'react';
import { 
  Users, 
  UserPlus, 
  Search, 
  Phone, 
  Clock, 
  Trash2, 
  Edit2, 
  Plus, 
  Minus, 
  DollarSign, 
  MessageSquare, 
  TrendingUp, 
  X, 
  TrendingDown, 
  ExternalLink,
  Coins,
  ArrowUp,
  ArrowDown,
  Share2,
  Loader2
} from 'lucide-react';
import { Language, Customer, CustomerTransaction, AppSettings, Currency } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { useFirebase } from './FirebaseProvider';
import { CURRENCY_SYMBOLS, POS_CURRENCY_CODES, currencyDecimals, formatAmount, formatMoney, roundMoney } from '../lib/exchangeRates';
import CurrencyPicker from './CurrencyPicker';
import ShowMoreBar from './ui/ShowMoreBar';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { matchesQuery, phoneMatches } from '../lib/search';
import { useScreenSearch } from '../lib/screenSearch';
import { TactileButton } from './ui/TactileButton';
import InteractiveButton from './ui/InteractiveButton';
import { toast } from 'sonner';
import { escapeHtml } from '../lib/invoiceDocument';
import { printHtmlDocument } from '../lib/printHtml';

interface Props {
  language: Language;
  settings: AppSettings;
}

export default function CustomerManagement({ language, settings }: Props) {
  const isRtl = language === 'ar';
  const { 
    customers, 
    customerTransactions, 
    saveCustomer, 
    deleteCustomer, 
    deleteCustomerLedgerTransaction,
    recordCustomerLedgerTransaction,
    vaultTransactions
  } = useFirebase();

  // Dialog & Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isMsgModalOpen, setIsMsgModalOpen] = useState(false);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedLedgerCustomer, setSelectedLedgerCustomer] = useState<Customer | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | Currency>('ALL');
  const [debtFilter, setDebtFilter] = useState<'ALL' | 'HAS_DEBT' | 'CLEAR'>('ALL');

  useScreenSearch('customers', ({ query }) => {
    setCurrencyFilter('ALL');
    setDebtFilter('ALL');
    setSearchQuery(query);
  });

  // New/Edit Customer form
  const [formData, setFormData] = useState<Partial<Customer>>({
    name: '',
    phone: '',
    totalDebt: 0,
    currency: settings.currency || 'JOD'
  });

  // Pay/Add Debt transaction form
  const [debtAction, setDebtAction] = useState<'add' | 'subtract'>('subtract');
  const [debtAmount, setDebtAmount] = useState<number>(0);
  const [debtNote, setDebtNote] = useState<string>('');
  const [syncToVault, setSyncToVault] = useState<boolean>(true);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // WhatsApp Message Composer
  const [selectedTemplate, setSelectedTemplate] = useState<string>('reminder');
  const [customMsgText, setCustomMsgText] = useState<string>('');

  const symbolOf = (code?: string) => CURRENCY_SYMBOLS[code || ''] || code || '';
  const fmtAmount = (val: number, code?: string) =>
    (Number(val) || 0).toLocaleString(undefined, {
      minimumFractionDigits: currencyDecimals(code || 'JOD'),
      maximumFractionDigits: currencyDecimals(code || 'JOD'),
    });
  // Translations Map
  const t = {
    title: isRtl ? 'إدارة العملاء والديون' : 'Customers & Debt Board',
    subtitle: isRtl ? 'متابعة حسابات المبيعات الآجلة، تحصيل ديون العملاء والتواصل المباشر' : 'Track credit accounts, collect outstanding balances and chat instantly',
    addCustomer: isRtl ? 'إضافة عميل جديد' : 'New Client Profile',
    editCustomer: isRtl ? 'تعديل بيانات العميل' : 'Edit Customer Data',
    searchPlaceholder: isRtl ? 'ابحث عبر اسم العميل أو الهاتف...' : 'Search customer by name or phone...',
    allCurrencies: isRtl ? 'جميع العملات' : 'All Currencies',
    currencyLabel: isRtl ? 'العملة الأساسية' : 'Base Currency',
    debtFilterLabel: isRtl ? 'حالة المديونية' : 'Balance Status',
    allStatus: isRtl ? 'الكل' : 'All',
    hasDebt: isRtl ? 'عليهم مستحقات' : 'Outstanding Balances',
    clearStatus: isRtl ? 'حسابات مسواة' : 'Zero/Clear Balances',
    phoneLabel: isRtl ? 'الرقم الخلوي' : 'Mobile Phone',
    nameLabel: isRtl ? 'الاسم بالكامل' : 'Full Name',
    initialDebt: isRtl ? 'رصيد المديونية الافتتاحي' : 'Opening Outstanding Debt',
    save: isRtl ? 'حفظ البيانات' : 'Commit Changes',
    cancel: isRtl ? 'إلغاء' : 'Cancel',
    totalCustomers: isRtl ? 'إجمالي العملاء' : 'Total Customers',
    activeDebts: isRtl ? 'الديون النشطة' : 'Outstanding Debts',
    manageDebt: isRtl ? 'تعديل الحساب' : 'Adjust Ledger',
    payDebt: isRtl ? 'سداد دفعة' : 'Receive Payment',
    addDebt: isRtl ? 'زيادة مديونية' : 'Add Credit/Debit',
    amount: isRtl ? 'المبلغ المالي' : 'Financial Amount',
    note: isRtl ? 'بيان الحركة (ملاحظات)' : 'Transaction Note / Reference',
    syncVault: isRtl ? 'يُسجَّل المبلغ المستلم في الخزنة كإيداع' : 'The received amount is deposited in the vault',
    sendMessage: isRtl ? 'إرسال إشعار تذكير' : 'Send Reminder Alert',
    whatsappTitle: isRtl ? 'إرسال رسالة واتساب' : 'Instantly Dispatch WhatsApp Message',
    waHeader: isRtl ? 'اختر قالب الرسالة لإرسالها إلى العميل عبر واتساب' : 'Choose a message template to send to the customer on WhatsApp',
    selectTemplate: isRtl ? 'قالب المراسلة المفضل' : 'Messaging Template Selection',
    reminderTmpl: isRtl ? 'تذكير ودي بالرصيد المستحق' : 'Friendly Debt Outstanding Reminder',
    statementTmpl: isRtl ? 'تفاصيل الرصيد الحالي' : 'Current Account Statement Notification',
    greetingTmpl: isRtl ? 'ترحيب وتهنئة' : 'Corporate Welcome Greeting',
    previewMsg: isRtl ? 'معاينة نص الرسالة الصادرة للواتساب' : 'WhatsApp Outbound Text Preview',
    sendNow: isRtl ? 'إرسال للواتساب الآن' : 'Launch Live WhatsApp Chat',
    confirmDelete: isRtl ? 'هل أنت متأكد من حذف العميل؟ لن يتم مسح بيانات الخزنة التاريخية.' : 'Are you sure you want to purge this customer? Historical safekeep balances remain safe.',
    noCustomers: isRtl ? 'لا يوجد عملاء بعد.' : 'No customers yet.',
    noMatchingCustomers: isRtl ? 'لا يوجد عملاء يطابقون خيارات البحث الحالية.' : 'No customer profiles match current parameters.',
  };

  // WhatsApp Messages Prefills generator
  const getPrefilledMessage = (customer: Customer, type: string) => {
    const sender = settings.businessName?.trim() || '';
    const formattedAmount = formatMoney(customer.totalDebt, customer.currency, isRtl ? 'ar' : 'en-US');
    if (type === 'reminder') {
      return isRtl 
        ? `السلام عليكم ورحمة الله، الأستاذ/ة ${customer.name}. نأمل أن تكونوا بخير. تذكير لطيف بالرصيد المترتب على حسابكم الكريم: بقيمة ${formattedAmount}. نشكر تعاونكم الدائم وثقتكم بنا.`
        : `Hello ${customer.name}. We hope you are doing well. This is a gentle reminder regarding your outstanding balance of ${formattedAmount}. Thank you for your continued business.`;
    } else if (type === 'statement') {
      // Retrieve top 5 recent customer transactions for detailed mini-ledger
      const recentTx = customerTransactions
        .filter(tx => tx.customerId === customer.id)
        .slice(0, 5);

      if (isRtl) {
        let message = sender ? `*كشف حساب - ${sender}*\n\n` : `*كشف حساب*\n\n`;
        message += `المحترم/ة: *${customer.name}*\n`;
        message += `تحية طيبة وبعد، إليكم ملخص حسابكم الحالي حتى تاريخ اليوم:\n\n`;
        message += `📊 *إجمالي الدين المستحق:* *${formatMoney(customer.totalDebt, customer.currency, 'en-US')}*\n`;
        message += `-----------------------------------\n`;
        message += `📜 *آخر العمليات على حسابكم:*\n`;

        if (recentTx.length === 0) {
          message += `لا توجد عمليات مسجلة حالياً.\n`;
        } else {
          recentTx.forEach(tx => {
            const typeEmoji = tx.type === 'invoice' ? "➕ فاتورة" : "➖ دفعة مستلمة";
            const dateStr = tx.date ? tx.date.substring(0, 10) : '';
            message += `${typeEmoji} بتاريخ ${dateStr} بقيمة *${formatMoney(tx.amount, tx.currency, 'en-US')}*\n`;
            if (tx.notes) {
              message += `   _(البيان: ${tx.notes})_\n`;
            }
          });
        }

        message += `-----------------------------------\n`;
        message += `لأي استفسار يرجى مراجعة إدارة المستودع. شكراً لثقتكم بنا. 🙏`;
        return message;
      } else {
        let message = sender ? `*Account Statement - ${sender}*\n\n` : `*Account Statement*\n\n`;
        message += `Dear *${customer.name}*,\n`;
        message += `Please find below a summary of your current account status:\n\n`;
        message += `📊 *Outstanding Balance:* *${formatMoney(customer.totalDebt, customer.currency, 'en-US')}*\n`;
        message += `-----------------------------------\n`;
        message += `📜 *Recent Transactions Status:*\n`;

        if (recentTx.length === 0) {
          message += `No transaction ledger entries recorded.\n`;
        } else {
          recentTx.forEach(tx => {
            const typeEmoji = tx.type === 'invoice' ? "➕ Credit Invoice" : "➖ Payment Received";
            const dateStr = tx.date ? tx.date.substring(0, 10) : '';
            message += `${typeEmoji} on ${dateStr} for *${formatMoney(tx.amount, tx.currency, 'en-US')}*\n`;
            if (tx.notes) {
              message += `   _(Ref: ${tx.notes})_\n`;
            }
          });
        }

        message += `-----------------------------------\n`;
        message += `For any inquiries, please contact management. Thank you for your continued trust! 🙏`;
        return message;
      }
    } else {
      return isRtl 
        ? `الإخوة الكرام في ${customer.name}، نسعد دائماً بخدمتكم${sender ? ` في ${sender}` : ''}. يسعدنا البقاء على تواصل معكم.`
        : `Dear ${customer.name}, thank you for dealing with ${sender || 'us'}. We are always happy to serve you.`;
    }
  };

  // Aggregates computed on the fly
  const filteredCustomers = React.useMemo(() => customers.filter(customer => {
    const matchesSearch =
      matchesQuery([customer.name, customer.customerId], searchQuery) ||
      phoneMatches(customer.phone, searchQuery);

    const matchesCurrency = currencyFilter === 'ALL' || customer.currency === currencyFilter;

    const matchesDebt = 
      debtFilter === 'ALL' || 
      (debtFilter === 'HAS_DEBT' && customer.totalDebt > 0) || 
      (debtFilter === 'CLEAR' && customer.totalDebt <= 0);

    return matchesSearch && matchesCurrency && matchesDebt;
  }), [customers, searchQuery, currencyFilter, debtFilter]);
  const customerPage = useProgressiveList(filteredCustomers, `${searchQuery}|${currencyFilter}|${debtFilter}`);

  // Calculate currency summaries
  // One independent total per currency (debts of different currencies are never added together)
  const debtSums = POS_CURRENCY_CODES.map(code => ({
    code,
    sum: customers.filter(c => c.currency === code).reduce((acc, c) => acc + (Number(c.totalDebt) || 0), 0),
  }));
  const visibleDebtSums = debtSums.filter(d => d.sum !== 0 || d.code === (settings.currency || 'JOD'));

  // Form Handlers
  const handleOpenNew = () => {
    setEditingCustomer(null);
    setFormData({
      name: '',
      phone: '',
      totalDebt: 0,
      currency: settings.currency || 'JOD'
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      phone: customer.phone,
      totalDebt: customer.totalDebt,
      currency: customer.currency
    });
    setIsModalOpen(true);
  };

  const hasBalance = (customer: Customer) =>
    roundMoney(Number(customer.totalDebt) || 0, (customer.currency || settings.currency || 'JOD') as Currency) !== 0;

  const handleDelete = async (customer: Customer) => {
    if (hasBalance(customer)) return;
    if (confirm(t.confirmDelete)) {
      try {
        await deleteCustomer(customer.id);
        toast.success(isRtl ? 'تم حذف حساب العميل بنجاح' : 'Customer successfully deleted');
      } catch (e: any) {
        const known = ['customer-has-balance', 'offline', 'aborted', 'schema-missing', 'unauthenticated', 'subscription-required', 'permission-denied'].includes(e?.code);
        toast.error(known && e?.message ? e.message : (isRtl ? 'حدث خطأ أثناء الحذف' : 'Failed to delete customer account'));
      }
    }
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone) {
      toast.warning(isRtl ? 'يرجى مراجعة وتعبئة كافة الحقول المطلوبة' : 'Please fill all required inputs');
      return;
    }

    const cleanedPhone = formData.phone.trim();
    const id = editingCustomer ? editingCustomer.id : `CUST_${crypto.randomUUID()}`;

    const newCustomer: Customer = {
      id,
      customerId: editingCustomer ? editingCustomer.customerId : `C-${id.slice(5, 13).toUpperCase()}`,
      name: formData.name.trim(),
      phone: cleanedPhone,
      createdAt: editingCustomer ? editingCustomer.createdAt : new Date().toISOString(),
      totalDebt: Number(formData.totalDebt || 0),
      currency: formData.currency as Currency
    };

    try {
      await saveCustomer(newCustomer);
      setIsModalOpen(false);
      toast.success(editingCustomer ? (isRtl ? 'تم تحديث العميل بنجاح' : 'Profile updated') : (isRtl ? 'تم تسجيل العميل بنجاح' : 'Client created successfully'));
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'خطأ في حفظ البيانات' : 'Error writing client records'));
    }
  };

  // Fast debt adjusters (receiving payments or buying on credit)
  const handleOpenLedger = (customer: Customer, action: 'add' | 'subtract') => {
    setSelectedCustomer(customer);
    setDebtAction(action);
    setDebtAmount(0);
    setDebtNote(isRtl 
      ? (action === 'subtract' ? 'دفعة نقدية سداد مديونية عميل' : 'فاتورة بيع بالآجل')
      : (action === 'subtract' ? 'Customer debt payment settlement' : 'Credit purchase invoice debit adjustment')
    );
    setSyncToVault(true);
    setIsPayModalOpen(true);
  };

  const handleSaveLedgerAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    // 1. Initial verification of input amount
    const amount = parseFloat(String(debtAmount));
    if (isNaN(amount) || amount <= 0) {
      toast.warning(isRtl ? 'يرجى إدخال مبلغ سداد صحيح أكبر من الصفر' : 'Please input a valid payment amount greater than 0');
      return;
    }

    const type = debtAction === 'subtract' ? 'payment' : 'invoice';

    // 2. Validate that the payment amount is not greater than the current debt
    if (type === 'payment') {
      const currentDebt = selectedCustomer.totalDebt || 0;
      if (amount > currentDebt) {
        toast.error(isRtl ? 'المبلغ المدفوع أكبر من قيمة الدين الحالي!' : 'The payment amount is greater than the current outstanding debt!');
        return;
      }
    }

    // Set loading indicator to safe guarding
    setIsActionLoading(true);

    const change = amount;
    const notesText = debtNote || (debtAction === 'subtract' ? (isRtl ? 'دفعة مسددة' : 'Settle payment') : (isRtl ? 'فاتورة آجل' : 'Credit invoice'));

    try {
      // 3. Run transactional records safely inside try block
      await recordCustomerLedgerTransaction(
        selectedCustomer.id,
        change,
        type,
        notesText,
        syncToVault
      );

      // 4. Update state / close modal after successful execution
      setIsPayModalOpen(false);
      toast.success(isRtl ? 'تم سداد الدفعة بنجاح!' : 'Payment processed successfully!');
    } catch (err: any) {
      // 5. Secure handler for any occurred exception to prevent app crashes
      console.error("خطأ أثناء عملية السداد / المعاملة:", err?.message || err);
      toast.error(isRtl 
        ? `عذراً، تعذر إتمام العملية: ${err?.message || 'خطأ غير معروف'}` 
        : `An error occurred while processing transaction: ${err?.message || 'Unknown error'}`
      );
    } finally {
      // Always reset loading indicator
      setIsActionLoading(false);
    }
  };

  const handleDeleteLedgerTransaction = async (tx: CustomerTransaction) => {
    const cust = customers.find(c => c.id === tx.customerId);
    if (!cust) return;
    if (tx.invoiceId || tx.id.startsWith('inv-')) {
      toast.error(isRtl
        ? 'هذا القيد ناتج عن فاتورة بيع آجل. احذف الفاتورة نفسها من شاشة الفواتير ليُعكس الدين والمخزون معاً.'
        : 'This entry comes from a credit sale. Delete the invoice itself so the debt and stock are reversed together.');
      return;
    }

    // A payment that entered the vault must give the cash back when it is deleted.
    // Entries created before this feature have no vaultRecordId, so they are matched by customer/amount/time.
    const entryTime = new Date(tx.date).getTime();
    const linkedVaultIds = new Set(customerTransactions.map(c => c.vaultRecordId).filter(Boolean));
    const txCurrency = tx.currency || cust.currency || 'JOD';
    const reachedVault = tx.type === 'payment' && (
      !!tx.vaultRecordId ||
      (vaultTransactions || []).some(v =>
        v.source === 'customer_payment' && v.refId === tx.customerId && !linkedVaultIds.has(v.id) &&
        (v.currency || 'JOD') === txCurrency &&
        Math.abs((Number(v.amount) || 0) - tx.amount) < 1e-6 && Math.abs(v.timestamp - entryTime) < 60_000)
    );

    const message = reachedVault
      ? (isRtl
          ? 'هذه دفعة دخلت الخزنة. حذفها سيعيد الدين إلى العميل ويخصم المبلغ من الخزنة بقيد عكسي. هل تريد المتابعة؟'
          : 'This payment was received into the vault. Deleting it restores the customer debt and removes the cash from the vault with a reversal entry. Continue?')
      : (isRtl
          ? 'هل أنت متأكد من حذف هذه الحركة؟ سيتم تحديث مديونية العميل تلقائياً.'
          : 'Are you sure you want to delete this ledger entry? Customer debt will be recalculated.');

    if (!confirm(message)) return;
    try {
      await deleteCustomerLedgerTransaction(tx.id, { reverseVault: reachedVault });
      toast.success(isRtl ? 'حُذفت الحركة وأُعيد حساب المديونية' : 'Ledger entry deleted and customer debt recalculated');

      if (selectedLedgerCustomer && selectedLedgerCustomer.id === cust.id) {
        const diff = tx.type === 'invoice' ? -tx.amount : tx.amount;
        setSelectedLedgerCustomer({
          ...selectedLedgerCustomer,
          totalDebt: roundMoney((selectedLedgerCustomer.totalDebt || 0) + diff, tx.currency || cust.currency)
        });
      }
    } catch (err: any) {
      if (!err?.notified) toast.error(err?.code && err?.message ? err.message : (isRtl ? 'حدث خطأ أثناء حذف الحركة' : 'Failed to delete transaction'));
    }
  };

  // WhatsApp Messaging dispatcher
  const handleOpenMessenger = (customer: Customer) => {
    setSelectedCustomer(customer);
    setSelectedTemplate('reminder');
    setCustomMsgText('');
    setIsMsgModalOpen(true);
  };

  // Phone cleanser & country-code normalizer (تنظيف رقم الهاتف وإضافة رمز الدولة إذا لم يكن موجوداً)
  const cleanAndFormatPhone = (phone: string): string => {
    // Keep only numbers/digits
    let digits = phone.replace(/\D/g, '');

    // Strip leading '00' if it exists (e.g., 00970... -> 970...)
    if (digits.startsWith('00')) {
      digits = digits.substring(2);
    }

    // Handle local numbers starting with a single '0'
    if (digits.startsWith('0') && !digits.startsWith('00')) {
      if (digits.startsWith('05')) {
        // Palestine local mobile prefix (e.g., 059... or 056...) -> prepend international 970
        digits = '970' + digits.substring(1);
      } else if (digits.startsWith('07')) {
        // Jordan local mobile prefix (e.g., 079... or 078...) -> prepend international 962
        digits = '962' + digits.substring(1);
      } else {
        // Default country code fallback (Palestine 970)
        digits = '970' + digits.substring(1);
      }
    }

    return digits;
  };

  const handleDispatchWhatsApp = () => {
    if (!selectedCustomer) return;
    const textToSend = customMsgText || getPrefilledMessage(selectedCustomer, selectedTemplate);
    // Format and clean phone, ensuring country code is present (e.g., prepending 970 or 962 if needed)
    const cleanNumbers = cleanAndFormatPhone(selectedCustomer.phone);
    const waUrl = `https://wa.me/${cleanNumbers}?text=${encodeURIComponent(textToSend)}`;
    
    // Open in new tab securely
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    setIsMsgModalOpen(false);
    toast.success(isRtl ? 'تم تحضير الرسالة وتحويلك للواتساب!' : 'Message template dispatched inside WhatsApp!');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-1 select-none">
      
      {/* Dynamic Aesthetic Bilingual Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white dark:bg-gray-800 rounded-[2rem] border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden transition-all">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-2xl">
              <Users size={24} />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white leading-tight">
              {t.title}
            </h1>
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 max-w-2xl">
            {t.subtitle}
          </p>
        </div>
        <div>
          <TactileButton onClick={handleOpenNew} variant="primary" className="h-[48px] px-6 rounded-2xl flex items-center gap-2 text-xs font-black uppercase tracking-wider">
            <UserPlus size={16} />
            {t.addCustomer}
          </TactileButton>
        </div>
      </div>

      {/* Aggregate Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Registered Accounts */}
        <div className="bg-white dark:bg-gray-800 rounded-[2rem] border border-gray-100 dark:border-gray-700 p-6 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-1">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.totalCustomers}</p>
            <h3 className="text-3xl font-black text-gray-900 dark:text-white font-mono">{customers.length}</h3>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-300 rounded-2xl">
            <Users size={24} />
          </div>
        </div>

        {/* Outstanding debts: one card per currency */}
        {visibleDebtSums.map(({ code, sum }) => (
          <div key={code} className="bg-white dark:bg-gray-800 rounded-[2rem] border border-gray-100 dark:border-gray-700 p-6 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.activeDebts} ({code})</p>
              <div className="flex items-baseline gap-1">
                <span className="text-indigo-600 dark:text-indigo-400 text-xs font-black">{symbolOf(code)}</span>
                <h3 className="text-2xl font-black text-gray-900 dark:text-white font-mono">{fmtAmount(sum, code)}</h3>
              </div>
            </div>
            <div className="p-4 bg-amber-50 dark:bg-amber-900/10 text-amber-600 dark:text-amber-400 rounded-2xl">
              <Coins size={24} />
            </div>
          </div>
        ))}

      </div>

      {/* Control Panel: Search & Filter Rail */}
      <div className="p-6 bg-white dark:bg-gray-800 rounded-[2rem] border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col lg:flex-row gap-4 justify-between items-stretch">
        
        {/* Search Input Box */}
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
            <Search size={18} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder}
            className="w-full h-[48px] pl-11 pr-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all dark:text-white"
          />
        </div>

        {/* Row Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          
          {/* Currency filtering dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.currencyLabel}:</span>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setCurrencyFilter('ALL')}
                className={`h-9 px-2.5 rounded-lg text-[11px] font-black border ${currencyFilter === 'ALL' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700'}`}
              >
                {t.allCurrencies}
              </button>
              {POS_CURRENCY_CODES.map(code => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setCurrencyFilter(code)}
                  className={`h-9 px-2.5 rounded-lg text-[11px] font-black border font-mono ${currencyFilter === code ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'}`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          {/* Debt balance status filtering dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.debtFilterLabel}:</span>
            <select
              value={debtFilter}
              onChange={(e) => setDebtFilter(e.target.value as any)}
              className="h-[44px] px-3 rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-bold focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">{t.allStatus}</option>
              <option value="HAS_DEBT">{t.hasDebt}</option>
              <option value="CLEAR">{t.clearStatus}</option>
            </select>
          </div>

        </div>

      </div>

      {/* Grid of Customer Accounts */}
      <AnimatePresence mode="popLayout">
        {filteredCustomers.length > 0 ? (
          <motion.div 
            layout 
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {customerPage.visible.map((customer, index) => {
              const currentSymbol = symbolOf(customer.currency);
              const hasDebt = customer.totalDebt > 0;
              
              return (
                <motion.div
                  layout
                  key={customer.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.03 }}
                  className="bg-white dark:bg-gray-800 rounded-[2.2rem] border border-gray-100 dark:border-gray-700 p-6 shadow-sm hover:shadow-xl dark:shadow-indigo-900/5 hover:border-indigo-100/80 transition-all flex flex-col justify-between group relative overflow-hidden"
                >
                  
                  {/* Subtle Card Accent Lines */}
                  <div className={`absolute top-0 inset-x-0 h-[4px] ${hasDebt ? 'bg-gradient-to-r from-amber-400 to-rose-400' : 'bg-emerald-400'}`} />

                  {/* Header: ID & Actions Panel */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="space-y-0.5">
                      <span className="text-[9px] font-mono tracking-widest text-[#00D2FF] font-black uppercase">
                        #{customer.customerId}
                      </span>
                      <h3 className="text-lg font-black text-gray-900 dark:text-white group-hover:text-indigo-600 transition-colors">
                        {customer.name}
                      </h3>
                    </div>

                    {/* Edit & Purge handles */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button 
                        onClick={() => handleOpenEdit(customer)}
                        className="p-2 bg-gray-50 hover:bg-indigo-50 dark:bg-gray-700/50 dark:hover:bg-indigo-950/40 text-gray-400 hover:text-indigo-600 rounded-lg transition-colors cursor-pointer"
                        title={t.editCustomer} aria-label={t.editCustomer}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button 
                        onClick={() => handleDelete(customer)}
                        disabled={hasBalance(customer)}
                        className="p-2 bg-gray-50 hover:bg-rose-50 dark:bg-gray-700/50 dark:hover:bg-rose-950/40 text-gray-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-50 disabled:hover:text-gray-400"
                        title={hasBalance(customer) ? (isRtl ? 'لا يمكن حذف عميل رصيد حسابه غير صفر' : 'A customer with a non-zero balance cannot be deleted') : t.confirmDelete}
                        aria-label={t.confirmDelete}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Body Info */}
                  <div className="space-y-4 py-2 border-t border-b border-gray-50 dark:border-gray-700/50 my-2">
                    
                    {/* Phone Number / WhatsApp key */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">{t.phoneLabel}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 font-mono">
                          {customer.phone}
                        </span>
                        
                        {/* WhatsApp Instant Trigger Button */}
                        <button 
                          onClick={() => handleOpenMessenger(customer)}
                          className="p-1.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-md hover:scale-105 active:scale-95 transition-all text-[11px] cursor-pointer"
                          title={t.sendMessage} aria-label={t.sendMessage}
                        >
                          <Phone size={11} className="inline mr-1" />
                          <MessageSquare size={11} className="inline" />
                        </button>
                      </div>
                    </div>

                    {/* Balance Outstanding displays */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                        {isRtl ? 'إجمالي الدين الفعلي' : 'Outstanding Balance'}
                      </span>
                      <div className="flex items-baseline gap-1">
                        <span className={`text-[11px] font-black ${hasDebt ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {currentSymbol}
                        </span>
                        <span className={`text-xl font-black font-mono ${hasDebt ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {fmtAmount(customer.totalDebt, customer.currency)}
                        </span>
                      </div>
                    </div>

                    {/* Account Opened timeline */}
                    <div className="flex items-center justify-between text-[10px] text-gray-400">
                      <span className="font-bold flex items-center gap-1">
                        <Clock size={11} />
                        {isRtl ? 'نشط منذ:' : 'Active Since:'}
                      </span>
                      <span className="font-mono">
                        {new Date(customer.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                  </div>

                  {/* Actions Area: Direct payments & adjustments */}
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    
                    {/* Pay/Receive debt */}
                    <TactileButton 
                      variant="success" 
                      onClick={() => handleOpenLedger(customer, 'subtract')}
                      className="py-2.5 rounded-xl text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5"
                    >
                      <TrendingDown size={13} />
                      {t.payDebt}
                    </TactileButton>

                    {/* Add debt credit */}
                    <TactileButton 
                      variant="secondary" 
                      onClick={() => handleOpenLedger(customer, 'add')}
                      className="py-2.5 rounded-xl text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5"
                    >
                      <TrendingUp size={13} />
                      {t.addDebt}
                    </TactileButton>

                  </div>

                  <div className="mt-2 text-center">
                    <button 
                      onClick={() => { setSelectedLedgerCustomer(customer); setIsLedgerModalOpen(true); }}
                      className="w-full h-[36px] bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/40 dark:hover:bg-indigo-950/20 text-gray-700 dark:text-indigo-300 rounded-xl text-[10px] font-bold border border-gray-100 dark:border-gray-700/60 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Coins size={12} className="text-indigo-500" />
                      {isRtl ? 'كشف الحساب التاريخي' : 'View Account Statement'}
                    </button>
                  </div>

                </motion.div>
              );
            })}
            <ShowMoreBar isRtl={isRtl} shown={customerPage.shown} total={customerPage.total} pageSize={customerPage.pageSize} onMore={customerPage.showMore} onAll={customerPage.showAll} className="col-span-full" />
          </motion.div>
        ) : (
          <div className="h-[250px] bg-white dark:bg-gray-800 rounded-[2rem] border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col items-center justify-center text-center p-8">
            <Users className="text-gray-300 dark:text-gray-600 mb-3" size={48} />
            <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200">
              {customers.length === 0 ? t.noCustomers : t.noMatchingCustomers}
            </h3>
            {customers.length === 0 && (
              <button 
                onClick={handleOpenNew}
                className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
              >
                {t.addCustomer}
              </button>
            )}
          </div>
        )}
      </AnimatePresence>

      {/* DIALOG 1: Add or Edit Customer Profile */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[50] flex items-center justify-center p-4">
            
            {/* Dark elegant backdrops */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-[#0F2027]"
            />

            {/* Modal Content */}
            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-2xl relative max-w-lg w-full z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-50 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                <h2 className="text-xl font-black text-gray-900 dark:text-white">
                  {editingCustomer ? t.editCustomer : t.addCustomer}
                </h2>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-700 rounded-full text-gray-400 transition-colors cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveCustomer} className="p-6 space-y-4">
                
                {/* Full name of customer */}
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider">
                    {t.nameLabel} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={isRtl ? 'مثال: شركة القدس للمقاولات العامة' : 'e.g. Al-Quds Contracting Co.'} aria-label={isRtl ? 'مثال: شركة القدس للمقاولات العامة' : 'e.g. Al-Quds Contracting Co.'}
                    className="w-full h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:text-white"
                  />
                </div>

                {/* Mobile/Phone WhatsApp key */}
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider">
                    {t.phoneLabel} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder={isRtl ? '+970599000000 أو +96277...' : '+972599... or +962...'} aria-label={isRtl ? '+970599000000 أو +96277...' : '+972599... or +962...'}
                    className="w-full h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono tracking-wide dark:text-white"
                  />
                  <p className="text-[10px] text-gray-400">
                    {isRtl ? '⚠️ يُفضل إدخال رمز الدولة لتفعيل مراسلات الواتساب السريعة تلقائياً.' : "⚠️ Always provide international dial prefix for direct WhatsApp links."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  
                  {/* Currency selector */}
                  <div className={`space-y-1 col-span-2 ${!!editingCustomer && ((editingCustomer.totalDebt || 0) > 0 || customerTransactions.some(tx => tx.customerId === editingCustomer.id)) ? 'pointer-events-none opacity-60' : ''}`}>
                    <CurrencyPicker
                      value={formData.currency || settings.currency || 'JOD'}
                      onChange={(code) => setFormData({ ...formData, currency: code })}
                      isRtl={isRtl}
                      label={t.currencyLabel}
                    />
                    {!!editingCustomer && ((editingCustomer.totalDebt || 0) > 0 || customerTransactions.some(tx => tx.customerId === editingCustomer.id)) && (
                      <p className="text-[10px] text-amber-600">
                        {isRtl ? 'لا يمكن تغيير العملة بعد وجود دين أو حركات على الحساب.' : 'Currency cannot change once the account has debt or movements.'}
                      </p>
                    )}
                  </div>

                  {/* Initial opening balance debt */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-wider">
                      {t.initialDebt}
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      disabled={!!editingCustomer}
                      value={formData.totalDebt}
                      onChange={(e) => setFormData({ ...formData, totalDebt: Number(e.target.value || 0) })}
                      placeholder="0.00"
                      className="w-full h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono dark:text-white disabled:opacity-50"
                    />
                  </div>

                </div>

                <div className="flex gap-3 pt-6">
                  <TactileButton 
                    type="button" 
                    variant="secondary" 
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-3"
                  >
                    {t.cancel}
                  </TactileButton>
                  <InteractiveButton 
                    type="submit" 
                    isRtl={isRtl}
                    className="flex-1 py-3"
                  >
                    {t.save}
                  </InteractiveButton>
                </div>

              </form>
            </motion.div>

          </div>
        )}
      </AnimatePresence>

      {/* DIALOG 2: Adjust Debt Ledger (Receive Payments / Settle or Add Debt) */}
      <AnimatePresence>
        {isPayModalOpen && selectedCustomer && (
          <div className="fixed inset-0 z-[50] flex items-center justify-center p-4">
            
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPayModalOpen(false)}
              className="absolute inset-0 bg-[#0F2027]"
            />

            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-2xl relative max-w-lg w-full z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-50 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                <div>
                  <h2 className="text-xl font-black text-gray-900 dark:text-white">
                    {debtAction === 'subtract' ? t.payDebt : t.addDebt}
                  </h2>
                  <p className="text-[10px] uppercase tracking-widest text-[#00D2FF] font-black">{selectedCustomer.name}</p>
                </div>
                <button 
                  onClick={() => setIsPayModalOpen(false)}
                  className="p-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-700 rounded-full text-gray-400 transition-colors cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveLedgerAction} className="p-6 space-y-4">
                
                {/* Current standing info info */}
                <div className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 rounded-2xl flex justify-between items-center text-sm mb-2">
                  <span className="font-semibold text-gray-500 dark:text-gray-400">{isRtl ? 'المديونية الحالية المسجلة:' : 'Current balance standing:'}</span>
                  <span className="font-mono font-black text-indigo-700 dark:text-indigo-400 text-lg">
                    {fmtAmount(selectedCustomer.totalDebt, selectedCustomer.currency)} {selectedCustomer.currency}
                  </span>
                </div>

                {/* Amount to add/pay */}
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider">
                    {t.amount} ({selectedCustomer.currency}) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none font-bold text-gray-400">
                      {symbolOf(selectedCustomer.currency)}
                    </div>
                    <input
                      type="number"
                      step="any"
                      required
                      min="0.01"
                      value={debtAmount || ''}
                      onChange={(e) => setDebtAmount(Number(e.target.value || 0))}
                      placeholder="0.00"
                      className="w-full h-[48px] pl-16 pr-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 font-mono text-base font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:text-white"
                    />
                  </div>
                </div>

                {/* Note / description */}
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider">
                    {t.note}
                  </label>
                  <input
                    type="text"
                    value={debtNote}
                    onChange={(e) => setDebtNote(e.target.value)}
                    placeholder={isRtl ? 'بيان المعاملة بالتفصيل...' : 'Transaction info...'} aria-label={isRtl ? 'بيان المعاملة بالتفصيل...' : 'Transaction info...'}
                    className="w-full h-[48px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:text-white"
                  />
                </div>

                {debtAction === 'subtract' && <div className="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-2xl flex items-start gap-3 border border-gray-100 dark:border-gray-700">
                  <input
                    type="checkbox"
                    id="syncVault"
                    checked={syncToVault}
                    onChange={(e) => setSyncToVault(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded mt-1 accent-indigo-600 cursor-pointer"
                  />
                  <label htmlFor="syncVault" className="text-xs text-gray-500 dark:text-gray-300 select-none cursor-pointer">
                    <p className="font-bold text-gray-700 dark:text-gray-200">{isRtl ? 'تسجيل الحركة في الخزنة' : 'Record in the vault'}</p>
                    <p className="text-[10px] mt-0.5">{t.syncVault}</p>
                  </label>
                </div>}

                <div className="flex gap-3 pt-4">
                  <TactileButton 
                    type="button" 
                    variant="secondary" 
                    onClick={() => setIsPayModalOpen(false)}
                    className="flex-1 py-3"
                    disabled={isActionLoading}
                  >
                    {t.cancel}
                  </TactileButton>
                  <TactileButton 
                    type="submit" 
                    variant={debtAction === 'subtract' ? 'success' : 'primary'}
                    className="flex-1 py-3 font-bold"
                    disabled={isActionLoading}
                  >
                    {isActionLoading ? (
                      <>
                        <Loader2 className="animate-spin w-4 h-4" />
                        <span>{isRtl ? 'جارٍ الحفظ...' : 'Saving...'}</span>
                      </>
                    ) : (
                      <span>{isRtl ? 'تطبيق المعاملة' : 'Submit Adjustment'}</span>
                    )}
                  </TactileButton>
                </div>

              </form>
            </motion.div>

          </div>
        )}
      </AnimatePresence>

      {/* DIALOG 3: Send via WhatsApp with dynamic Templates */}
      <AnimatePresence>
        {isMsgModalOpen && selectedCustomer && (
          <div className="fixed inset-0 z-[50] flex items-center justify-center p-4">
            
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMsgModalOpen(false)}
              className="absolute inset-0 bg-[#0F2027]"
            />

            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-2xl relative max-w-lg w-full z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-50 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                <div>
                  <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                    <MessageSquare size={20} className="text-emerald-500" />
                    {t.whatsappTitle}
                  </h2>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-500 font-black">{selectedCustomer.name}</p>
                </div>
                <button 
                  onClick={() => setIsMsgModalOpen(false)}
                  className="p-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-700 rounded-full text-gray-400 transition-colors cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={16} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                
                {/* Meta details */}
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {t.waHeader}: <strong className="text-gray-800 dark:text-gray-200 font-mono">{selectedCustomer.phone}</strong>
                </p>

                {/* Message Template selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider">{t.selectTemplate}</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => { setSelectedTemplate('reminder'); setCustomMsgText(''); }}
                      className={`py-2 px-1 text-[10px] font-bold border rounded-xl cursor-pointer ${
                        selectedTemplate === 'reminder' ? 'bg-indigo-50 border-indigo-400 text-indigo-700 dark:bg-indigo-950/45 dark:text-indigo-300' : 'bg-transparent border-gray-200 text-gray-600'
                      }`}
                    >
                      {t.reminderTmpl}
                    </button>
                    <button
                      onClick={() => { setSelectedTemplate('statement'); setCustomMsgText(''); }}
                      className={`py-2 px-1 text-[10px] font-bold border rounded-xl cursor-pointer ${
                        selectedTemplate === 'statement' ? 'bg-indigo-50 border-indigo-400 text-indigo-700 dark:bg-indigo-950/45 dark:text-indigo-300' : 'bg-transparent border-gray-200 text-gray-600'
                      }`}
                    >
                      {t.statementTmpl}
                    </button>
                    <button
                      onClick={() => { setSelectedTemplate('greeting'); setCustomMsgText(''); }}
                      className={`py-2 px-1 text-[10px] font-bold border rounded-xl cursor-pointer ${
                        selectedTemplate === 'greeting' ? 'bg-indigo-50 border-indigo-400 text-indigo-700 dark:bg-indigo-950/45 dark:text-indigo-300' : 'bg-transparent border-gray-200 text-gray-600'
                      }`}
                    >
                      {t.greetingTmpl}
                    </button>
                  </div>
                </div>

                {/* Free editing text-area */}
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider">{t.previewMsg}</label>
                  <textarea
                    rows={4}
                    value={customMsgText || getPrefilledMessage(selectedCustomer, selectedTemplate)}
                    onChange={(e) => setCustomMsgText(e.target.value)}
                    className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:text-white leading-relaxed"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <TactileButton 
                    type="button" 
                    variant="secondary" 
                    onClick={() => setIsMsgModalOpen(false)}
                    className="flex-1 py-3"
                  >
                    {t.cancel}
                  </TactileButton>
                  <TactileButton 
                    type="button" 
                    variant="success" 
                    onClick={handleDispatchWhatsApp}
                    className="flex-1 py-3 font-bold flex items-center justify-center gap-1.5"
                  >
                    <ExternalLink size={14} />
                    {t.sendNow}
                  </TactileButton>
                </div>

              </div>
            </motion.div>

          </div>
        )}
      </AnimatePresence>

      {/* DIALOG 4: Customer Account Statement Ledger */}
      <AnimatePresence>
        {isLedgerModalOpen && selectedLedgerCustomer && (
          <div className="fixed inset-0 z-[50] flex items-center justify-center p-4">
            
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsLedgerModalOpen(false); setLedgerSearchQuery(''); }}
              className="absolute inset-0 bg-[#070e11]/85 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.93, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.93, y: 15, opacity: 0 }}
              className="bg-[#112229] border border-teal-900/40 rounded-[2.5rem] shadow-2xl relative max-w-4xl w-full z-10 overflow-hidden flex flex-col max-h-[92vh]"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-teal-950/45 flex justify-between items-center bg-[#0d1b20]">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl">
                    <Coins size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white">
                      {isRtl ? 'كشف الحساب المالي المفصل' : 'Customer Account Statement Ledger'}
                    </h2>
                    <p className="text-[10px] uppercase tracking-wider text-teal-400 font-mono font-bold mt-0.5">
                      #{selectedLedgerCustomer.customerId || 'ID'} - {selectedLedgerCustomer.phone}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => { setIsLedgerModalOpen(false); setLedgerSearchQuery(''); }}
                  className="p-2 bg-[#1b3038] hover:bg-rose-900/20 text-gray-400 hover:text-rose-400 rounded-full transition-colors cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={15} />
                </button>
              </div>

              {/* Scrollable Container */}
              <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6 custom-scrollbar">
                
                {/* 1. THE HERO CARD (BILINGUAL DETAILED WORKSPACE LEDGER STATS) */}
                <div className="w-full p-6 rounded-3xl bg-gradient-to-br from-[#1b343e] via-[#203a43] to-[#2c5364] border border-white/5 shadow-xl relative overflow-hidden flex flex-col gap-4">
                  {/* Glassmorphism abstract decorative circle */}
                  <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-teal-400/5 rounded-full blur-3xl pointer-events-none" />
                  
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        {isRtl ? 'الحساب الحالي النشط' : 'Active Account Tracking'}
                      </span>
                      <h3 className="text-xl font-black text-white mt-2 leading-tight">
                        {selectedLedgerCustomer.name}
                      </h3>
                    </div>

                    {/* Quick WhatsApp Action with clean formatting and country-code builder */}
                    <button
                      onClick={() => {
                        const messageText = getPrefilledMessage(selectedLedgerCustomer, 'statement');
                        const destinationPhone = cleanAndFormatPhone(selectedLedgerCustomer.phone);
                        const waUrl = `https://wa.me/${destinationPhone}?text=${encodeURIComponent(messageText)}`;
                        window.open(waUrl, '_blank', 'noopener,noreferrer');
                        toast.success(isRtl ? 'تم تجهيز كشف الحساب وبدء المحادثة!' : 'Detailed statement prefilled inside WhatsApp!');
                      }}
                      className="px-4 py-2.5 bg-[#25D366] hover:bg-[#1ebd54] text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer max-w-max self-start md:self-auto"
                    >
                      <Share2 size={14} className="animate-bounce" />
                      {isRtl ? 'إرسال كشف الحساب 💬' : 'Send Statement 💬'}
                    </button>
                  </div>

                  <div className="w-full h-px bg-white/10" />

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wide">
                        {isRtl ? 'إجمالي الدين المترتب الحالي' : 'Outstanding Debt Balance'}
                      </p>
                      <p className="text-2xl font-black text-[#00D2FF] tracking-tight drop-shadow-[0_0_8px_rgba(0,210,255,0.4)] font-mono">
                        {selectedLedgerCustomer.totalDebt.toLocaleString(undefined, { minimumFractionDigits: 1 })}{' '}
                        <span className="text-xs uppercase text-white/80">{selectedLedgerCustomer.currency}</span>
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wide">
                        {isRtl ? 'إجمالي الدفعات المسددة' : 'Total Paid Received'}
                      </p>
                      <p className="text-lg font-black text-emerald-400 tracking-tight font-mono">
                        {formatAmount(
                          customerTransactions
                            .filter(tx => tx.customerId === selectedLedgerCustomer.id && tx.type === 'payment')
                            .reduce((acc, current) => acc + current.amount, 0),
                          selectedLedgerCustomer.currency,
                          'en-US'
                        )}{' '}
                        <span className="text-[10px] text-white/50">{selectedLedgerCustomer.currency}</span>
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wide">
                        {isRtl ? 'إجمالي المبيعات بالآجل' : 'Total Invoices Sum'}
                      </p>
                      <p className="text-lg font-black text-amber-400 tracking-tight font-mono">
                        {formatAmount(
                          customerTransactions
                            .filter(tx => tx.customerId === selectedLedgerCustomer.id && tx.type === 'invoice')
                            .reduce((acc, current) => acc + current.amount, 0),
                          selectedLedgerCustomer.currency,
                          'en-US'
                        )}{' '}
                        <span className="text-[10px] text-white/50">{selectedLedgerCustomer.currency}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Search controller & layout switches */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  {/* Local timeline filter */}
                  <div className="relative flex-1 max-w-md">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-teal-500/60">
                      <Search size={14} />
                    </div>
                    <input
                      type="text"
                      value={ledgerSearchQuery}
                      onChange={(e) => setLedgerSearchQuery(e.target.value)}
                      placeholder={isRtl ? 'تصفية الجدول والحركات بالبيان...' : 'Filter ledger entries by reference/note...'} aria-label={isRtl ? 'تصفية الجدول والحركات بالبيان...' : 'Filter ledger entries by reference/note...'}
                      className="w-full h-[40px] pl-10 pr-4 rounded-xl border border-teal-800 bg-[#0c181c] text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none text-white font-medium"
                    />
                  </div>

                  {/* Header summary label */}
                  <span className="text-xs text-teal-400 font-mono font-bold self-center">
                    {isRtl ? 'سجل الحركات التاريخي المعتمد' : 'Authorized Accounting Ledger Log'}
                  </span>
                </div>

                {/* 2. THE CHRONOLOGICAL TIMELINE LIST & TABULAR DETAILS FLOW */}
                {customerTransactions.filter(tx => tx.customerId === selectedLedgerCustomer.id).length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center text-teal-500/60 bg-[#0d1b20]/30 rounded-3xl border border-teal-900/10">
                    <Coins size={42} className="text-teal-600 mb-2 animate-pulse" />
                    <p className="text-sm font-black text-white">{isRtl ? 'لا توجد حركات مسجلة حالياً' : 'No Statement Ledger Records Found'}</p>
                    <p className="text-[11px] mt-1 text-teal-600/80 max-w-sm">{isRtl ? 'تظهر الفواتير وعمليات القبض والدفع بانتظام بمجرد اعتمادها.' : 'Chronological invoice operations and payments appear once submitted.'}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Switch layout explanation for user */}
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      {isRtl ? 'سجل الحركات الزمنية (مرتب من الأحدث للأقدم)' : 'Chronological Flow Timeline (Latest to Oldest)'}
                    </p>

                    {/* Timeline Container styled in frosted slate cards */}
                    <div className="space-y-3">
                      {customerTransactions
                        .filter(tx => {
                          if (!tx) return false;
                          if (tx.customerId !== selectedLedgerCustomer.id) return false;
                          if (!ledgerSearchQuery) return true;
                          return (tx.notes || '').toLowerCase().includes(ledgerSearchQuery.toLowerCase()) || 
                                 (tx.transactionId || '').toLowerCase().includes(ledgerSearchQuery.toLowerCase());
                        })
                        // Sort latest first
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                        .map((tx) => {
                          const isPayment = tx.type === 'payment';
                          return (
                            <div 
                              key={tx.id} 
                              className="bg-white/[0.03] border border-white/[0.06] rounded-2.5xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all hover:bg-white/[0.05]"
                            >
                              <div className="flex gap-4 items-center">
                                {/* Leading avatar icon representing movement orientation */}
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                  isPayment ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                                }`}>
                                  {isPayment ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                                </div>

                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-black text-white">
                                      {isPayment 
                                        ? (isRtl ? 'دفعة نقدية مسددة' : 'Payment Received') 
                                        : (isRtl ? 'فاتورة بيع بالآجل' : 'Credit Sale Invoice')}
                                    </p>
                                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-teal-950/40 text-teal-400 font-bold uppercase select-all">
                                      #{tx.transactionId || tx.id}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-300 font-medium">
                                    {tx.notes}
                                  </p>
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {new Date(tx.date).toLocaleString()}
                                  </span>
                                </div>
                              </div>

                              <div className="flex sm:flex-col items-end justify-between w-full sm:w-auto border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
                                <span className={`text-sm font-mono font-black ${isPayment ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {isPayment ? '-' : '+'}{formatAmount(tx.amount, tx.currency, 'en-US')}{' '}
                                  <span className="text-[10px] text-white/70">{tx.currency}</span>
                                </span>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] text-slate-400 font-bold">
                                    {isRtl ? 'الرصيد بعد الحركة:' : 'Balance After:'}{' '}
                                    <span className="text-white font-mono font-black">{formatAmount(tx.remainingBalanceAfter, tx.currency, 'en-US')}{' '}{tx.currency}</span>
                                  </span>
                                  <button
                                    onClick={() => handleDeleteLedgerTransaction(tx)}
                                    className="p-1 px-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-md transition-colors cursor-pointer ml-1"
                                    title={isRtl ? 'حذف الحركة' : 'Delete transaction'} aria-label={isRtl ? 'حذف الحركة' : 'Delete transaction'}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

              </div>

              {/* Modal Footer Controls */}
              <div className="p-6 border-t border-teal-950/45 bg-[#0d1b20] flex justify-between items-center">
                <TactileButton 
                  type="button" 
                  variant="secondary" 
                  onClick={() => { setIsLedgerModalOpen(false); setLedgerSearchQuery(''); }}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold border-teal-900/40 bg-teal-950/20 hover:bg-teal-950/40 text-gray-300"
                >
                  {isRtl ? 'إغلاق الكشف' : 'Close Statement'}
                </TactileButton>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      // Generate and build formal document print template
                      const txsToPrint = customerTransactions
                        .filter(tx => tx.customerId === selectedLedgerCustomer.id)
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                      if (txsToPrint.length === 0) {
                        toast.error(isRtl ? 'لا توجد حركات لطباعتها!' : 'No transaction ledger entries to print');
                        return;
                      }

                      const generatedRows = txsToPrint.map(tx => `
                        <tr>
                          <td style="text-align: center; font-family: monospace;">#${escapeHtml(tx.transactionId || tx.id)}</td>
                          <td>${escapeHtml(new Date(tx.date).toLocaleString(isRtl ? 'ar' : 'en'))}</td>
                          <td>${tx.type === 'payment' ? (isRtl ? 'سداد دفعة' : 'Payment Received') : (isRtl ? 'فاتورة بيع بالآجل' : 'Credit Sale')}</td>
                          <td>${escapeHtml(tx.notes || '')}</td>
                          <td style="text-align: right; font-weight: bold; color: ${tx.type === 'payment' ? '#10b981' : '#ef4444'};">
                            ${tx.type === 'payment' ? '-' : '+'}${escapeHtml(formatMoney(Number(tx.amount) || 0, tx.currency || selectedLedgerCustomer.currency || 'JOD'))}
                          </td>
                          <td style="text-align: right; font-weight: bold;">
                            ${escapeHtml(formatMoney(Number(tx.remainingBalanceAfter) || 0, tx.currency || selectedLedgerCustomer.currency || 'JOD'))}
                          </td>
                        </tr>
                      `).join('');

                      {
                        printHtmlDocument(`
                          <html>
                            <head>
                              <meta charset="UTF-8">
                              <title>${escapeHtml(isRtl ? 'كشف حساب' : 'Statement')} - ${escapeHtml(selectedLedgerCustomer.name)}</title>
                              <style>
                                body { font-family: system-ui, -apple-system, sans-serif; direction: ${isRtl ? 'rtl' : 'ltr'}; padding: 40px; color: #1e293b; background-color: #ffffff; }
                                .brand { font-size: 24px; font-weight: 900; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 20px; }
                                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                                th, td { border: 1px solid #cbd5e1; padding: 12px; font-size: 11px; text-align: ${isRtl ? 'right' : 'left'}; }
                                th { background-color: #f8fafc; color: #475569; font-weight: 800; }
                                .header-details { background-color: #f1f5f9; padding: 20px; border-radius: 12px; margin-bottom: 20px; display: grid; grid-template-cols: 1fr 1fr; gap: 10px; }
                                .detail-block p { margin: 4px 0; font-size: 12px; }
                                .footer-tag { margin-top: 40px; text-align: center; font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 15px; }
                              </style>
                            </head>
                            <body>
                              <div class="brand">كشف الحساب المالي الموحد - مستودعي</div>
                              <div class="header-details">
                                <div class="detail-block">
                                  <p><strong>العميل:</strong> ${escapeHtml(selectedLedgerCustomer.name)}</p>
                                  <p><strong>الهاتف:</strong> <span dir="ltr">${escapeHtml(selectedLedgerCustomer.phone)}</span></p>
                                </div>
                                <div class="detail-block" style="text-align: ${isRtl ? 'left' : 'right'};">
                                  <p><strong>الرصيد المترتب الحالي:</strong> <span style="font-size: 16px; color: #0284c7; font-weight: 900;">${escapeHtml(formatMoney(Number(selectedLedgerCustomer.totalDebt) || 0, selectedLedgerCustomer.currency || 'JOD'))}</span></p>
                                  <p><strong>تاريخ طباعة الكشف:</strong> ${escapeHtml(new Date().toLocaleString(isRtl ? 'ar' : 'en'))}</p>
                                </div>
                              </div>
                              <table>
                                <thead>
                                  <tr>
                                    <th>رقم الحركة</th>
                                    <th>التاريخ</th>
                                    <th>نوع الحركة</th>
                                    <th>البيان وملاحظات</th>
                                    <th style="text-align: right;">المبلغ</th>
                                    <th style="text-align: right;">الرصيد المستحق بعد الحركة</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  ${generatedRows}
                                </tbody>
                              </table>
                              <div class="footer-tag">تطبيق مستودعي لتنظيم المستودعات وإدارة الحسابات | شكراً لثقتكم بنا.</div>
                            </body>
                          </html>
                        `);
                      }
                    }}
                    className="px-5 py-2.5 rounded-xl h-[38px] cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <span>🖨️</span>
                    {isRtl ? 'طباعة كشف الحساب' : 'Print Statement'}
                  </button>
                </div>
              </div>
            </motion.div>

          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
