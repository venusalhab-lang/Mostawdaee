import React, { useEffect, useRef, useState } from 'react';
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
  Loader2,
  ShoppingCart,
  Package,
  ListOrdered
} from 'lucide-react';
import { Language, Customer, CustomerTransaction, AppSettings, Currency, Invoice } from '../types';
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
import { checkManualArIncrease, MANUAL_AR_REASON_MIN } from '../lib/customerLedger';
import {
  buildWhatsAppStatement,
  customerPurchaseRows,
  filterCustomerStatement,
  invoiceItemRows,
  periodLabel,
  purchaseTotalsByCurrency,
  statementLineDetail,
  statementPeriod,
  sumStatementByType,
  type StatementItemRow,
  type StatementPeriodPreset,
} from '../lib/customerStatement';
import { requestPosSale } from '../lib/posIntent';

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
    vaultTransactions,
    invoices
  } = useFirebase();
  const returnIds = React.useMemo(() => new Set(invoices.filter((i) => i.type === 'return').map((i) => i.id)), [invoices]);
  /** A sales return lowers the debt like a payment, but no money was received. */
  const isReturnCredit = React.useCallback(
    (tx: CustomerTransaction) => tx.type === 'payment' && !!tx.invoiceId && returnIds.has(tx.invoiceId),
    [returnIds],
  );

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
  const [ledgerPeriodPreset, setLedgerPeriodPreset] = useState<StatementPeriodPreset>('this_month');
  const [ledgerFromDate, setLedgerFromDate] = useState('');
  const [ledgerToDate, setLedgerToDate] = useState('');
  const [ledgerView, setLedgerView] = useState<'movements' | 'items'>('movements');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | Currency>('ALL');
  const [debtFilter, setDebtFilter] = useState<'ALL' | 'HAS_DEBT' | 'CLEAR'>('ALL');

  useScreenSearch('customers', ({ query, recordId }) => {
    setCurrencyFilter('ALL');
    setDebtFilter('ALL');
    setSearchQuery(query);
    const target = recordId ? customers.find((c) => c.id === recordId) : undefined;
    if (target) openStatement(target);
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
  const payDraftRef = useRef<string | null>(null);
  useEffect(() => { payDraftRef.current = null; }, [isPayModalOpen, selectedCustomer?.id, debtAction, debtAmount, syncToVault]);
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
    addDebt: isRtl ? 'تسوية رصيد يدوية' : 'Manual balance adjustment',
    amount: isRtl ? 'المبلغ المالي' : 'Financial Amount',
    note: isRtl ? 'بيان الحركة (ملاحظات)' : 'Transaction Note / Reference',
    syncVault: isRtl ? 'يُسجَّل المبلغ المستلم في الخزنة كإيداع' : 'The received amount is deposited in the vault',
    sendMessage: isRtl ? 'إرسال إشعار تذكير' : 'Send Reminder Alert',
    whatsappTitle: isRtl ? 'إرسال رسالة واتساب' : 'Send WhatsApp message',
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
      const period = statementPeriod(ledgerPeriodPreset, ledgerFromDate, ledgerToDate);
      const txs = filterCustomerStatement(customerTransactions, customer.id, period, ledgerSearchQuery, invoices);
      return buildWhatsAppStatement({
        customer,
        txs,
        period,
        businessName: sender,
        isRtl,
        isReturnCredit,
        invoices,
      });
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

  const activeLedgerPeriod = React.useMemo(
    () => statementPeriod(ledgerPeriodPreset, ledgerFromDate, ledgerToDate),
    [ledgerPeriodPreset, ledgerFromDate, ledgerToDate],
  );
  const ledgerTxs = React.useMemo(() => {
    if (!selectedLedgerCustomer) return [];
    return filterCustomerStatement(
      customerTransactions,
      selectedLedgerCustomer.id,
      activeLedgerPeriod,
      ledgerSearchQuery,
      invoices,
    );
  }, [selectedLedgerCustomer, customerTransactions, activeLedgerPeriod, ledgerSearchQuery, invoices]);
  const ledgerSums = React.useMemo(() => {
    if (!selectedLedgerCustomer) return { invoices: 0, payments: 0, returns: 0 };
    return sumStatementByType(ledgerTxs, selectedLedgerCustomer.currency || 'JOD', isReturnCredit);
  }, [selectedLedgerCustomer, ledgerTxs, isReturnCredit]);

  const ledgerItemRows = React.useMemo(() => {
    if (!selectedLedgerCustomer) return [];
    return customerPurchaseRows(invoices, selectedLedgerCustomer.id, activeLedgerPeriod, isRtl, ledgerSearchQuery);
  }, [selectedLedgerCustomer, invoices, activeLedgerPeriod, isRtl, ledgerSearchQuery]);
  const ledgerItemTotals = React.useMemo(() => purchaseTotalsByCurrency(ledgerItemRows), [ledgerItemRows]);
  const invoiceById = React.useMemo(() => new Map(invoices.map((inv) => [inv.id, inv])), [invoices]);

  const tableLocale = isRtl ? 'ar-u-nu-latn' : 'en-GB';
  const fmtDate = (ms: number) => (Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString(tableLocale, { year: 'numeric', month: '2-digit', day: '2-digit' })
    : '—');
  const fmtTime = (ms: number) => (Number.isFinite(ms)
    ? new Date(ms).toLocaleTimeString(tableLocale, { hour: '2-digit', minute: '2-digit' })
    : '—');
  const paymentLabel = (row: StatementItemRow) => {
    if (row.kind === 'return') return isRtl ? 'مرتجع' : 'Return';
    switch (row.paymentMethod) {
      case 'credit': {
        const paid = Number(invoiceById.get(row.invoiceId)?.paidAmount) || 0;
        return paid > 0 ? (isRtl ? 'نقد + آجل' : 'Cash + credit') : (isRtl ? 'آجل' : 'Credit');
      }
      case 'card': return isRtl ? 'بطاقة' : 'Card';
      case 'wallet': return isRtl ? 'محفظة' : 'Wallet';
      default: return isRtl ? 'نقدي' : 'Cash';
    }
  };

  function printLedger(customer: Customer) {
    const itemsMode = ledgerView === 'items';
    if (itemsMode ? ledgerItemRows.length === 0 : ledgerTxs.length === 0) {
      toast.error(isRtl ? 'لا يوجد ما يُطبع في هذه الفترة.' : 'Nothing to print in this period.');
      return;
    }
    const locale = isRtl ? 'ar' : 'en';
    const currency = customer.currency || 'JOD';
    const money = (v: number, c: string) => escapeHtml(formatMoney(v, c, 'en-US'));
    const end = isRtl ? 'left' : 'right';
    const kindLabel = (tx: CustomerTransaction) => (tx.type === 'payment'
      ? (isReturnCredit(tx) ? (isRtl ? 'مرتجع مبيعات' : 'Sales return') : (isRtl ? 'سداد دفعة' : 'Payment received'))
      : (isRtl ? 'بيع بالآجل' : 'Credit sale'));

    let body: string;
    if (itemsMode) {
      const rows = ledgerItemRows.map((row) => `
        <tr class="${row.kind === 'return' ? 'ret' : ''}">
          <td class="num">${escapeHtml(fmtDate(row.date))}</td>
          <td class="num">${escapeHtml(fmtTime(row.date))}</td>
          <td class="num">#${escapeHtml(row.invoiceNumber)}</td>
          <td>${escapeHtml(paymentLabel(row))}</td>
          <td><b>${escapeHtml(row.description)}</b>${row.sku ? `<div class="sku">${escapeHtml(row.sku)}</div>` : ''}</td>
          <td class="amt">${row.kind === 'return' ? '−' : ''}${escapeHtml(row.quantityText)}</td>
          <td class="amt">${money(row.unitPrice, row.currency)}</td>
          <td class="amt"><b>${row.kind === 'return' ? '−' : ''}${money(row.total, row.currency)}</b></td>
        </tr>`).join('');
      const totals = ledgerItemTotals.map((tot) => `
        <tr class="total"><td colspan="7" class="amt">${isRtl ? 'صافي المشتريات' : 'Net bought'} (${escapeHtml(tot.currency)})</td>
        <td class="amt">${money(tot.net, tot.currency)}</td></tr>`).join('');
      body = `
        <table>
          <thead><tr>
            <th>${isRtl ? 'التاريخ' : 'Date'}</th><th>${isRtl ? 'الوقت' : 'Time'}</th><th>${isRtl ? 'الفاتورة' : 'Invoice'}</th>
            <th>${isRtl ? 'الدفع' : 'Payment'}</th><th>${isRtl ? 'الصنف' : 'Item'}</th><th class="amt">${isRtl ? 'الكمية' : 'Qty'}</th>
            <th class="amt">${isRtl ? 'سعر الوحدة' : 'Unit price'}</th><th class="amt">${isRtl ? 'المجموع' : 'Total'}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot>${totals}</tfoot>
        </table>`;
    } else {
      const rows = ledgerTxs.map((tx) => {
        const t = Date.parse(tx.date);
        const inv = tx.invoiceId ? invoiceById.get(tx.invoiceId) : undefined;
        const items = inv ? invoiceItemRows(inv, isRtl) : [];
        const detail = items.length ? '' : statementLineDetail(tx, invoices, isRtl);
        const itemRows = items.map((row) => `
          <tr class="item">
            <td colspan="3"></td>
            <td>${escapeHtml(row.description)}</td>
            <td class="amt">${escapeHtml(row.quantityText)}</td>
            <td class="amt">${money(row.unitPrice, row.currency)}</td>
            <td class="amt">${money(row.total, row.currency)}</td>
            <td colspan="2"></td>
          </tr>`).join('');
        return `
          <tr class="mv">
            <td class="num">${escapeHtml(fmtDate(t))}</td>
            <td class="num">${escapeHtml(fmtTime(t))}</td>
            <td>${escapeHtml(kindLabel(tx))}${inv?.invoiceNumber ? `<div class="sku">#${escapeHtml(inv.invoiceNumber)}</div>` : ''}</td>
            <td colspan="4">${escapeHtml(detail)}</td>
            <td class="amt" style="color:${tx.type === 'payment' ? '#059669' : '#dc2626'}"><b>${tx.type === 'payment' ? '−' : '+'}${money(Number(tx.amount) || 0, tx.currency || currency)}</b></td>
            <td class="amt"><b>${money(Number(tx.remainingBalanceAfter) || 0, tx.currency || currency)}</b></td>
          </tr>${itemRows}`;
      }).join('');
      body = `
        <table>
          <thead><tr>
            <th>${isRtl ? 'التاريخ' : 'Date'}</th><th>${isRtl ? 'الوقت' : 'Time'}</th><th>${isRtl ? 'الحركة' : 'Movement'}</th>
            <th>${isRtl ? 'الصنف / البيان' : 'Item / note'}</th><th class="amt">${isRtl ? 'الكمية' : 'Qty'}</th>
            <th class="amt">${isRtl ? 'سعر الوحدة' : 'Unit price'}</th><th class="amt">${isRtl ? 'المجموع' : 'Line total'}</th>
            <th class="amt">${isRtl ? 'المبلغ' : 'Amount'}</th><th class="amt">${isRtl ? 'الرصيد' : 'Balance'}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    printHtmlDocument(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${escapeHtml(isRtl ? 'كشف حساب' : 'Statement')} - ${escapeHtml(customer.name)}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; direction: ${isRtl ? 'rtl' : 'ltr'}; padding: 32px; color: #1e293b; background: #fff; }
            .brand { font-size: 20px; font-weight: 900; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 16px; }
            .header-details { background: #f1f5f9; padding: 16px; border-radius: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .header-details p { margin: 3px 0; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 10.5px; text-align: ${isRtl ? 'right' : 'left'}; vertical-align: top; }
            th { background: #f8fafc; color: #475569; font-weight: 800; }
            .amt { text-align: ${end}; white-space: nowrap; font-variant-numeric: tabular-nums; }
            .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
            .sku { font-size: 9px; color: #64748b; font-family: monospace; }
            tr.mv td { background: #fff; }
            tr.item td { background: #f8fafc; color: #334155; border-top-color: #e2e8f0; }
            tr.ret td { background: #ecfdf5; }
            tr.total td { background: #f1f5f9; font-weight: 900; }
            thead { display: table-header-group; }
            tr { page-break-inside: avoid; }
            .footer-tag { margin-top: 28px; text-align: center; font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; }
          </style>
        </head>
        <body>
          <div class="brand">${escapeHtml(settings.businessName?.trim() || (isRtl ? 'مستودعي' : 'Mostawdaee'))} — ${itemsMode
            ? (isRtl ? 'الأصناف المشتراة' : 'Items bought')
            : (isRtl ? 'كشف حساب زبون' : 'Customer statement')}</div>
          <div class="header-details">
            <div>
              <p><strong>${isRtl ? 'الزبون' : 'Customer'}:</strong> ${escapeHtml(customer.name)}</p>
              <p><strong>${isRtl ? 'الهاتف' : 'Phone'}:</strong> <span dir="ltr">${escapeHtml(customer.phone)}</span></p>
              <p><strong>${isRtl ? 'الفترة' : 'Period'}:</strong> ${escapeHtml(periodLabel(activeLedgerPeriod, isRtl, locale))}</p>
            </div>
            <div style="text-align: ${end};">
              <p><strong>${isRtl ? 'الرصيد الحالي' : 'Current balance'}:</strong> <span style="font-size: 15px; color: #0284c7; font-weight: 900;">${money(Number(customer.totalDebt) || 0, currency)}</span></p>
              <p><strong>${isRtl ? 'آجل الفترة' : 'Credit in period'}:</strong> ${money(ledgerSums.invoices, currency)}</p>
              <p><strong>${isRtl ? 'سداد الفترة' : 'Paid in period'}:</strong> ${money(ledgerSums.payments, currency)}</p>
              <p><strong>${isRtl ? 'تاريخ الطباعة' : 'Printed'}:</strong> ${escapeHtml(`${fmtDate(Date.now())} ${fmtTime(Date.now())}`)}</p>
            </div>
          </div>
          ${body}
          <div class="footer-tag">${isRtl ? 'مستودعي · كشف حساب للتصفية الشهرية' : 'Mostawdaee · statement for monthly settlement'}</div>
        </body>
      </html>
    `);
  }

  function openStatement(customer: Customer) {
    setSelectedLedgerCustomer(customer);
    setLedgerPeriodPreset('this_month');
    setLedgerFromDate('');
    setLedgerToDate('');
    setLedgerSearchQuery('');
    setLedgerView('movements');
    setIsLedgerModalOpen(true);
  }

  const closeLedgerModal = React.useCallback(() => {
    setIsLedgerModalOpen(false);
    setLedgerSearchQuery('');
    setLedgerPeriodPreset('this_month');
    setLedgerFromDate('');
    setLedgerToDate('');
    setLedgerView('movements');
  }, []);

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

  // Payments collect AR; "add" is a manual balance adjustment only (never a fake sale invoice).
  const handleOpenLedger = (customer: Customer, action: 'add' | 'subtract') => {
    setSelectedCustomer(customer);
    setDebtAction(action);
    setDebtAmount(0);
    setDebtNote(action === 'subtract'
      ? (isRtl ? 'دفعة نقدية سداد مديونية عميل' : 'Customer debt payment settlement')
      : '');
    setSyncToVault(action === 'subtract');
    setIsPayModalOpen(true);
  };

  const handleSaveLedgerAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    const amount = parseFloat(String(debtAmount));
    if (isNaN(amount) || amount <= 0) {
      toast.warning(isRtl ? 'يرجى إدخال مبلغ صحيح أكبر من الصفر' : 'Please enter a valid amount greater than 0');
      return;
    }

    const type = debtAction === 'subtract' ? 'payment' : 'invoice';
    const notesText = debtNote.trim();

    if (type === 'invoice' && checkManualArIncrease(notesText)) {
      toast.error(isRtl
        ? `اكتب سبب التسوية (${MANUAL_AR_REASON_MIN} أحرف على الأقل). هذه ليست فاتورة بيع ولا تغيّر المخزون.`
        : `Enter a reason (at least ${MANUAL_AR_REASON_MIN} characters). This is not a sales invoice and does not change stock.`);
      return;
    }

    if (type === 'payment') {
      const currentDebt = selectedCustomer.totalDebt || 0;
      if (amount > currentDebt) {
        toast.error(isRtl ? 'المبلغ المدفوع أكبر من قيمة الدين الحالي!' : 'The payment amount is greater than the current outstanding debt!');
        return;
      }
    }

    if (type === 'invoice') {
      const current = roundMoney(Number(selectedCustomer.totalDebt) || 0, selectedCustomer.currency);
      const next = roundMoney(current + amount, selectedCustomer.currency);
      const confirmMsg = isRtl
        ? `تسوية يدوية لرصيد «${selectedCustomer.name}»\nالحالي: ${fmtAmount(current, selectedCustomer.currency)}\nبعد الزيادة: ${fmtAmount(next, selectedCustomer.currency)}\nالسبب: ${notesText}\n\nهذه ليست فاتورة بيع ولن تُنشئ حركة مخزون. هل تعتمد؟`
        : `Manual balance adjustment for “${selectedCustomer.name}”\nCurrent: ${fmtAmount(current, selectedCustomer.currency)}\nAfter increase: ${fmtAmount(next, selectedCustomer.currency)}\nReason: ${notesText}\n\nThis is not a sales invoice and creates no stock movement. Apply?`;
      if (!window.confirm(confirmMsg)) return;
    }

    setIsActionLoading(true);

    try {
      await recordCustomerLedgerTransaction(
        selectedCustomer.id,
        amount,
        type,
        type === 'payment' ? (notesText || (isRtl ? 'دفعة مسددة' : 'Settle payment')) : notesText,
        type === 'payment' && syncToVault,
        (payDraftRef.current ||= crypto.randomUUID()),
      );

      payDraftRef.current = null;
      setIsPayModalOpen(false);
      toast.success(type === 'payment'
        ? (isRtl ? 'تم تسجيل الدفعة.' : 'Payment recorded.')
        : (isRtl ? 'تم تسجيل تسوية الرصيد في كشف الحساب.' : 'Balance adjustment recorded on the statement.'));
    } catch (err: any) {
      console.error(err);
      if (!err?.notified) toast.error(err?.message || (isRtl
        ? 'تعذّر إتمام العملية.'
        : 'Could not complete the transaction.'));
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDeleteLedgerTransaction = async (tx: CustomerTransaction) => {
    const cust = customers.find(c => c.id === tx.customerId);
    if (!cust) return;
    if (isReturnCredit(tx)) {
      toast.error(isRtl
        ? 'هذا القيد ناتج عن مرتجع مبيعات. احذف فاتورة المرتجع نفسها من شاشة الفواتير ليُعكس الدين والمخزون معاً.'
        : 'This entry comes from a sales return. Delete the return invoice itself so the debt and stock are reversed together.');
      return;
    }
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

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => requestPosSale({ customerId: customer.id })}
                      className="h-[36px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ShoppingCart size={12} />
                      {isRtl ? 'بيع أصناف لهذا الزبون' : 'Sell items to customer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openStatement(customer)}
                      className="h-[36px] bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/40 dark:hover:bg-indigo-950/20 text-gray-700 dark:text-indigo-300 rounded-xl text-[10px] font-bold border border-gray-100 dark:border-gray-700/60 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Coins size={12} className="text-indigo-500" />
                      {isRtl ? 'كشف الحساب والأصناف' : 'Statement & items'}
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
                  {debtAction === 'add' && (
                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300 mt-1 max-w-sm leading-snug">
                      {isRtl
                        ? 'زيادة يدوية لكشف الحساب فقط — ليست فاتورة بيع ولن تمسّ المخزون. للبيع الآجل استخدم نقطة البيع أو الفواتير.'
                        : 'Statement-only increase — not a sales invoice and does not touch stock. For credit sales use POS or Invoices.'}
                    </p>
                  )}
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

                {/* Note / audit reason */}
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider">
                    {debtAction === 'add'
                      ? (isRtl ? 'سبب التسوية' : 'Adjustment reason')
                      : t.note}
                    {debtAction === 'add' && <span className="text-rose-500"> *</span>}
                  </label>
                  <input
                    type="text"
                    value={debtNote}
                    onChange={(e) => setDebtNote(e.target.value)}
                    required={debtAction === 'add'}
                    minLength={debtAction === 'add' ? MANUAL_AR_REASON_MIN : undefined}
                    placeholder={debtAction === 'add'
                      ? (isRtl ? 'مثال: رصيد مرحّل من دفتر قديم / تسوية جرد ديون...' : 'e.g. Opening balance from old books / AR reconciliation...')
                      : (isRtl ? 'بيان المعاملة بالتفصيل...' : 'Transaction info...')}
                    aria-label={debtAction === 'add'
                      ? (isRtl ? 'سبب التسوية' : 'Adjustment reason')
                      : (isRtl ? 'بيان المعاملة' : 'Transaction notes')}
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
              onClick={closeLedgerModal}
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
                  type="button"
                  onClick={closeLedgerModal}
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

                    <div className="flex flex-wrap gap-2 self-start md:self-auto">
                      <button
                        type="button"
                        onClick={() => {
                          const id = selectedLedgerCustomer.id;
                          closeLedgerModal();
                          requestPosSale({ customerId: id });
                        }}
                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
                      >
                        <ShoppingCart size={14} />
                        {isRtl ? 'بيع أصناف' : 'Sell items'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const messageText = getPrefilledMessage(selectedLedgerCustomer, 'statement');
                          const destinationPhone = cleanAndFormatPhone(selectedLedgerCustomer.phone);
                          const waUrl = `https://wa.me/${destinationPhone}?text=${encodeURIComponent(messageText)}`;
                          window.open(waUrl, '_blank', 'noopener,noreferrer');
                          toast.success(isRtl ? 'تم تجهيز كشف الحساب للفترة المحددة.' : 'Statement for the selected period is ready in WhatsApp.');
                        }}
                        className="px-4 py-2.5 bg-[#25D366] hover:bg-[#1ebd54] text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
                      >
                        <Share2 size={14} />
                        {isRtl ? 'إرسال كشف الفترة' : 'Send period statement'}
                      </button>
                    </div>
                  </div>

                  <div className="w-full h-px bg-white/10" />

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wide">
                        {isRtl ? 'الرصيد الحالي' : 'Current balance'}
                      </p>
                      <p className="text-2xl font-black text-[#00D2FF] tracking-tight font-mono">
                        {formatMoney(selectedLedgerCustomer.totalDebt, selectedLedgerCustomer.currency, isRtl ? 'ar' : 'en-US')}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wide">
                        {isRtl ? 'آجل الفترة' : 'Credit in period'}
                      </p>
                      <p className="text-lg font-black text-amber-400 tracking-tight font-mono">
                        {formatMoney(ledgerSums.invoices, selectedLedgerCustomer.currency, isRtl ? 'ar' : 'en-US')}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wide">
                        {isRtl ? 'سداد الفترة' : 'Paid in period'}
                      </p>
                      <p className="text-lg font-black text-emerald-400 tracking-tight font-mono">
                        {formatMoney(ledgerSums.payments, selectedLedgerCustomer.currency, isRtl ? 'ar' : 'en-US')}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wide">
                        {isRtl ? 'الفترة المعروضة' : 'Shown period'}
                      </p>
                      <p className="text-sm font-bold text-teal-200 leading-snug">
                        {periodLabel(activeLedgerPeriod, isRtl, isRtl ? 'ar' : 'en-US')}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {ledgerTxs.length} {isRtl ? 'حركة' : 'movements'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['this_month', isRtl ? 'هذا الشهر' : 'This month'],
                      ['last_month', isRtl ? 'الشهر الماضي' : 'Last month'],
                      ['all', isRtl ? 'كل الفترات' : 'All time'],
                      ['custom', isRtl ? 'من / إلى' : 'From / to'],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setLedgerPeriodPreset(id)}
                        className={`px-3 py-1.5 rounded-xl text-[11px] font-black border transition-all cursor-pointer ${
                          ledgerPeriodPreset === id
                            ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {ledgerPeriodPreset === 'custom' && (
                    <div className="grid grid-cols-2 gap-2 max-w-md">
                      <label className="text-[10px] font-bold text-slate-400 space-y-1">
                        <span>{isRtl ? 'من تاريخ' : 'From'}</span>
                        <input
                          type="date"
                          value={ledgerFromDate}
                          onChange={(e) => setLedgerFromDate(e.target.value)}
                          className="w-full h-9 rounded-xl border border-teal-800 bg-[#0c181c] px-2 text-xs text-white"
                        />
                      </label>
                      <label className="text-[10px] font-bold text-slate-400 space-y-1">
                        <span>{isRtl ? 'إلى تاريخ' : 'To'}</span>
                        <input
                          type="date"
                          value={ledgerToDate}
                          onChange={(e) => setLedgerToDate(e.target.value)}
                          className="w-full h-9 rounded-xl border border-teal-800 bg-[#0c181c] px-2 text-xs text-white"
                        />
                      </label>
                    </div>
                  )}
                  <div className="relative flex-1 max-w-md">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-teal-500/60">
                      <Search size={14} />
                    </div>
                    <input
                      type="text"
                      value={ledgerSearchQuery}
                      onChange={(e) => setLedgerSearchQuery(e.target.value)}
                      placeholder={isRtl ? 'ابحث باسم الصنف أو رقم الفاتورة أو البيان...' : 'Search item, invoice number or note...'}
                      aria-label={isRtl ? 'ابحث باسم الصنف أو رقم الفاتورة أو البيان...' : 'Search item, invoice number or note...'}
                      className="w-full h-[40px] pl-10 pr-4 rounded-xl border border-teal-800 bg-[#0c181c] text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none text-white font-medium"
                    />
                  </div>
                </div>

                <div role="tablist" className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[#0c181c] border border-teal-900/40 max-w-md">
                  {([
                    ['movements', isRtl ? `الحركات المالية (${ledgerTxs.length})` : `Movements (${ledgerTxs.length})`, ListOrdered],
                    ['items', isRtl ? `الأصناف المشتراة (${ledgerItemRows.length})` : `Items bought (${ledgerItemRows.length})`, Package],
                  ] as const).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={ledgerView === id}
                      onClick={() => setLedgerView(id)}
                      className={`h-9 rounded-xl text-[11px] font-black inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        ledgerView === id ? 'bg-teal-500/20 text-teal-200 border border-teal-500/40' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  ))}
                </div>

                {ledgerView === 'items' ? (
                  ledgerItemRows.length === 0 ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center bg-[#0d1b20]/30 rounded-3xl border border-teal-900/10">
                      <Package size={42} className="text-teal-600 mb-2" />
                      <p className="text-sm font-black text-white">{isRtl ? 'لا توجد أصناف مشتراة في هذه الفترة' : 'No items bought in this period'}</p>
                      <p className="text-[11px] mt-1 text-teal-600/80 max-w-sm">
                        {isRtl ? 'تظهر هنا كل فواتير البيع المسجلة على هذا الزبون من نقطة البيع (نقداً أو آجلاً) ومرتجعاته.' : 'Every sale invoice recorded to this customer at the POS (cash or credit) and its returns appear here.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                        <table className="w-full min-w-[720px] text-[11px] text-slate-200">
                          <thead className="bg-white/[0.04] text-slate-400 font-black">
                            <tr>
                              <th className="px-3 py-2.5 text-start">{isRtl ? 'التاريخ' : 'Date'}</th>
                              <th className="px-3 py-2.5 text-start">{isRtl ? 'الوقت' : 'Time'}</th>
                              <th className="px-3 py-2.5 text-start">{isRtl ? 'الفاتورة' : 'Invoice'}</th>
                              <th className="px-3 py-2.5 text-start">{isRtl ? 'الدفع' : 'Payment'}</th>
                              <th className="px-3 py-2.5 text-start">{isRtl ? 'الصنف' : 'Item'}</th>
                              <th className="px-3 py-2.5 text-end">{isRtl ? 'الكمية' : 'Qty'}</th>
                              <th className="px-3 py-2.5 text-end">{isRtl ? 'سعر الوحدة' : 'Unit price'}</th>
                              <th className="px-3 py-2.5 text-end">{isRtl ? 'المجموع' : 'Total'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ledgerItemRows.map((row) => (
                              <tr key={row.key} className={`border-t border-white/[0.05] ${row.kind === 'return' ? 'bg-emerald-500/[0.04]' : ''}`}>
                                <td className="px-3 py-2 font-mono whitespace-nowrap">{fmtDate(row.date)}</td>
                                <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-400">{fmtTime(row.date)}</td>
                                <td className="px-3 py-2 font-mono whitespace-nowrap">#{row.invoiceNumber}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{paymentLabel(row)}</td>
                                <td className="px-3 py-2 font-bold text-white">
                                  {row.description}
                                  {row.sku ? <span className="block text-[9px] font-mono text-slate-500">{row.sku}</span> : null}
                                </td>
                                <td className="px-3 py-2 text-end font-mono whitespace-nowrap">{row.kind === 'return' ? '−' : ''}{row.quantityText}</td>
                                <td className="px-3 py-2 text-end font-mono whitespace-nowrap">{formatMoney(row.unitPrice, row.currency, 'en-US')}</td>
                                <td className={`px-3 py-2 text-end font-mono font-black whitespace-nowrap ${row.kind === 'return' ? 'text-emerald-400' : 'text-white'}`}>
                                  {row.kind === 'return' ? '−' : ''}{formatMoney(row.total, row.currency, 'en-US')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ledgerItemTotals.map((tot) => (
                          <div key={tot.currency} className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-[11px] text-slate-300">
                            <span className="font-bold">{isRtl ? 'صافي المشتريات' : 'Net bought'}:</span>{' '}
                            <span className="font-mono font-black text-white">{formatMoney(tot.net, tot.currency, 'en-US')}</span>
                            {tot.returns > 0 && (
                              <span className="ms-2 text-slate-500">
                                ({isRtl ? 'مبيعات' : 'sales'} {formatMoney(tot.sales, tot.currency, 'en-US')} − {isRtl ? 'مرتجع' : 'returns'} {formatMoney(tot.returns, tot.currency, 'en-US')})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ) : ledgerTxs.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center text-teal-500/60 bg-[#0d1b20]/30 rounded-3xl border border-teal-900/10">
                    <Coins size={42} className="text-teal-600 mb-2" />
                    <p className="text-sm font-black text-white">{isRtl ? 'لا توجد حركات في هذه الفترة' : 'No movements in this period'}</p>
                    <p className="text-[11px] mt-1 text-teal-600/80 max-w-sm">
                      {isRtl ? 'غيّر الفترة أو أزل التصفية لعرض كل ما سجّله الزبون بالآجل والسداد.' : 'Change the period or clear the filter to see all credit and payment rows.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      {isRtl ? 'الحركات مرتبة من الأقدم إلى الأحدث (مناسبة لتصفية الشهر)' : 'Movements oldest → newest (for monthly settlement)'}
                    </p>
                    <div className="space-y-3">
                      {ledgerTxs.map((tx) => {
                          const isPayment = tx.type === 'payment';
                          const inv = tx.invoiceId ? invoiceById.get(tx.invoiceId) : undefined;
                          const itemRows = inv ? invoiceItemRows(inv, isRtl) : [];
                          const detail = itemRows.length ? '' : statementLineDetail(tx, invoices, isRtl);
                          return (
                            <div
                              key={tx.id}
                              className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-3 transition-all hover:bg-white/[0.05]"
                            >
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                              <div className="flex gap-4 items-center min-w-0">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                  isPayment ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                                }`}>
                                  {isPayment ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                                </div>

                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-xs font-black text-white">
                                      {isPayment 
                                        ? (isReturnCredit(tx) ? (isRtl ? 'مرتجع مبيعات' : 'Sales return') : (isRtl ? 'دفعة نقدية مسددة' : 'Payment Received'))
                                        : (isRtl ? 'فاتورة بيع بالآجل' : 'Credit Sale Invoice')}
                                    </p>
                                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-teal-950/40 text-teal-400 font-bold uppercase select-all">
                                      #{tx.transactionId || tx.id}
                                    </span>
                                  </div>
                                  {inv?.invoiceNumber ? (
                                    <p className="text-[11px] text-slate-300 font-bold">
                                      {isRtl ? 'فاتورة' : 'Invoice'} <span className="font-mono">#{inv.invoiceNumber}</span>
                                    </p>
                                  ) : null}
                                  {detail ? (
                                    <p className="text-[11px] text-slate-300 font-medium break-words">{detail}</p>
                                  ) : null}
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {fmtDate(Date.parse(tx.date))} · {fmtTime(Date.parse(tx.date))}
                                  </span>
                                </div>
                              </div>

                              <div className="flex sm:flex-col items-end justify-between w-full sm:w-auto border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0 shrink-0">
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
                                    type="button"
                                    onClick={() => handleDeleteLedgerTransaction(tx)}
                                    className="p-1 px-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-md transition-colors cursor-pointer ml-1"
                                    title={isRtl ? 'حذف الحركة' : 'Delete transaction'} aria-label={isRtl ? 'حذف الحركة' : 'Delete transaction'}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                            </div>
                            {itemRows.length > 0 && <StatementItemsTable rows={itemRows} isRtl={isRtl} invoice={inv} />}
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
                  onClick={closeLedgerModal}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold border-teal-900/40 bg-teal-950/20 hover:bg-teal-950/40 text-gray-300"
                >
                  {isRtl ? 'إغلاق الكشف' : 'Close Statement'}
                </TactileButton>
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => printLedger(selectedLedgerCustomer)}
                    className="px-5 py-2.5 rounded-xl h-[38px] cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <span>🖨️</span>
                    {ledgerView === 'items'
                      ? (isRtl ? 'طباعة جدول الأصناف' : 'Print items table')
                      : (isRtl ? 'طباعة كشف الفترة' : 'Print period statement')}
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

function StatementItemsTable({ rows, isRtl, invoice }: { rows: StatementItemRow[]; isRtl: boolean; invoice?: Invoice }) {
  const cur = invoice?.currency || rows[0]?.currency || 'JOD';
  const discount = Number(invoice?.discount) || 0;
  const tax = Number(invoice?.taxAmount) || 0;
  const paid = invoice?.type === 'sale' ? Number(invoice.paymentMethod === 'credit' ? invoice.paidAmount : invoice.totalAmount) || 0 : 0;
  const summary: [string, number][] = invoice ? [
    ...(discount > 0 ? [[isRtl ? 'خصم' : 'Discount', -discount] as [string, number]] : []),
    ...(tax > 0 ? [[isRtl ? 'ضريبة' : 'VAT', tax] as [string, number]] : []),
    [isRtl ? 'إجمالي الفاتورة' : 'Invoice total', Number(invoice.totalAmount) || 0],
    ...(paid > 0 ? [[isRtl ? 'مدفوع نقداً' : 'Paid now', -paid] as [string, number]] : []),
  ] : [];
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.05] bg-black/10">
      <table className="w-full min-w-[420px] text-[11px] text-slate-300">
        <thead className="text-slate-500 font-black">
          <tr>
            <th className="px-3 py-1.5 text-start">{isRtl ? 'الصنف' : 'Item'}</th>
            <th className="px-3 py-1.5 text-end">{isRtl ? 'الكمية' : 'Qty'}</th>
            <th className="px-3 py-1.5 text-end">{isRtl ? 'سعر الوحدة' : 'Unit price'}</th>
            <th className="px-3 py-1.5 text-end">{isRtl ? 'المجموع' : 'Total'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-white/[0.04]">
              <td className="px-3 py-1.5 font-bold text-slate-100">{row.description}</td>
              <td className="px-3 py-1.5 text-end font-mono whitespace-nowrap">{row.quantityText}</td>
              <td className="px-3 py-1.5 text-end font-mono whitespace-nowrap">{formatMoney(row.unitPrice, row.currency, 'en-US')}</td>
              <td className="px-3 py-1.5 text-end font-mono font-black text-slate-100 whitespace-nowrap">{formatMoney(row.total, row.currency, 'en-US')}</td>
            </tr>
          ))}
        </tbody>
        {summary.length > 0 && (
          <tfoot className="text-slate-400">
            {summary.map(([label, value]) => (
              <tr key={label} className="border-t border-white/[0.04]">
                <td colSpan={3} className="px-3 py-1 text-end font-bold">{label}</td>
                <td className="px-3 py-1 text-end font-mono font-black text-slate-200 whitespace-nowrap">
                  {value < 0 ? '−' : ''}{formatMoney(Math.abs(value), cur, 'en-US')}
                </td>
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}
