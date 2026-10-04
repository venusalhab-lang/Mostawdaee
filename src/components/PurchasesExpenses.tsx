import { consumeInvoiceNumber, peekInvoiceNumber } from '../lib/invoiceNumber';
import React, { useState, useMemo } from 'react';
import { 
  ShoppingBag, 
  Wallet, 
  Plus, 
  Search, 
  Calendar, 
  X, 
  FileText, 
  User, 
  ChevronDown, 
  Trash2, 
  Eye, 
  DollarSign, 
  Percent, 
  CheckCircle2, 
  TrendingDown, 
  Info, 
  Copy, 
  Check, 
  Code,
  ArrowRight,
  Database,
  Briefcase,
  HelpCircle,
  Download,
  Printer
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { Language, Invoice, InvoiceItem, Product, Currency, VaultTransaction } from '../types';
import { toast } from 'sonner';
import { sounds } from '../lib/sounds';
import { formatMoney } from '../lib/exchangeRates';
import CurrencyPicker from './CurrencyPicker';
import { readVaultBalances, INSUFFICIENT_VAULT_FUNDS, roundForCurrency } from '../lib/vaultMath';
import { computeInvoiceTotals, resolveVatRate } from '../lib/invoiceTotals';
import { buildInvoicePrintHtml } from '../lib/invoiceDocument';
import { printHtmlDocument } from '../lib/printHtml';
import { appName } from '../lib/brand';

interface Props {
  language: Language;
}

export default function PurchasesExpenses({ language }: Props) {
  const isRtl = language === 'ar';
  const { formatPrice: globalFormatPrice } = usePreferredCurrency();
  
  // Use Firebase Provider to get live stock, invoices, vault, settings, and functions
  const { 
    products, 
    invoices, 
    vaultTransactions, 
    vault,
    settings, 
    saveInvoice, 
    recordVaultTransaction, 
    deleteInvoice,
    user
  } = useFirebase();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'purchases' | 'expenses'>('purchases');

  // Search/Filters states
  const [searchQuery, setSearchQuery] = useState('');
  const [expenseFilter, setExpenseFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');


  // Active modal controls
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<Invoice | null>(null);

  // New Purchase Form state
  const [supplierName, setSupplierName] = useState('');
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [purchaseItems, setPurchaseItems] = useState<Omit<InvoiceItem, 'total'>[]>([]);
  const [purchaseTaxRate, setPurchaseTaxRate] = useState<number>(() => resolveVatRate(settings?.defaultVatRate));
  const [selectedProductId, setSelectedProductId] = useState('');
  const [itemQuantity, setItemQuantity] = useState<string>('1');
  const [itemUnitCost, setItemUnitCost] = useState<string>('');
  const [purchaseCurrency, setPurchaseCurrency] = useState<Currency>(settings?.currency || 'JOD');

  // Extract list of all unique previously used suppliers to provide a streamlined autocomplete suggestions list
  const existingSuppliers = useMemo(() => {
    const list = new Set<string>();
    invoices.forEach(inv => {
      if (inv.type === 'purchase' && inv.supplierName) {
        list.add(inv.supplierName.trim());
      }
    });
    return Array.from(list);
  }, [invoices]);

  // New Expense Form state
  const [expenseCategory, setExpenseCategory] = useState('utilities');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseCurrency, setExpenseCurrency] = useState<Currency>(settings?.currency || 'JOD');

  // Categories helper translation maps
  const expenseCategories = [
    { id: 'rent', label: isRtl ? 'إيجار مقار عمل' : 'Workplace Rent' },
    { id: 'utilities', label: isRtl ? 'كهرباء ومياه واشتراكات' : 'Electricity & Utilities' },
    { id: 'shipping', label: isRtl ? 'توصيل وشحن لوجستي' : 'Shipping & Logistics' },
    { id: 'salary', label: isRtl ? 'رواتب الموظفين' : 'Staff Salaries' },
    { id: 'damaged', label: isRtl ? 'تلف وهدر بضائع' : 'Damaged Goods Waste' },
    { id: 'marketing', label: isRtl ? 'تسويق وإيرادات إعلانات' : 'Marketing & Advertising' },
    { id: 'general', label: isRtl ? 'مصرف تشغيلي عام' : 'General Operational Expense' }
  ];

  const getCategoryLabel = (catId: string) => {
    const found = expenseCategories.find(c => c.id === catId);
    return found ? found.label : (isRtl ? 'مصروف أخرى' : 'Other Expense');
  };

  // Generate a random invoice No if left empty
  const triggerAutoInvoiceNo = () => {
    setPurchaseInvoiceNo(peekInvoiceNumber('PINV', user?.uid || 'guest'));
  };

  // Calculated numbers for line item creation preview
  const activeSelectedProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId);
  }, [products, selectedProductId]);

  // Handle addition of a single item to purchase draft
  const handleAddLineItem = () => {
    sounds.playClick();
    if (!selectedProductId) {
      toast.error(isRtl ? "الرجاء اختيار المنتج أولاً" : "Please select a product first");
      return;
    }
    const qty = parseFloat(itemQuantity);
    const cost = parseFloat(itemUnitCost);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(isRtl ? "الكمية يجب أن تكون أكبر من الصفر" : "Quantity must be greater than zero");
      return;
    }
    if (cost === undefined || isNaN(cost) || cost < 0) {
      toast.error(isRtl ? "سعر التكلفة المدخل غير صالح" : "Invalid cost price entered");
      return;
    }

    const prod = products.find(p => p.id === selectedProductId);
    if (!prod) return;

    // Check if product is already added in the list to prevent duplicates or append quantity
    const existingIdx = purchaseItems.findIndex(i => i.productId === selectedProductId);
    if (existingIdx > -1) {
      const updated = [...purchaseItems];
      updated[existingIdx] = { ...updated[existingIdx], quantity: updated[existingIdx].quantity + qty, unitPrice: cost };
      setPurchaseItems(updated);
    } else {
      setPurchaseItems([
        ...purchaseItems,
        {
          productId: selectedProductId,
          description: prod.name,
          quantity: qty,
          unitPrice: cost
        }
      ]);
    }

    // Reset fields
    setSelectedProductId('');
    setItemQuantity('1');
    setItemUnitCost('');
    toast.success(isRtl ? "تمت إضافة البند إلى الفاتورة" : "Line item added to invoice draft");
  };

  // Remove a line item
  const handleRemoveLineItem = (index: number) => {
    sounds.playClick();
    setPurchaseItems(prev => prev.filter((_, i) => i !== index));
  };

  // Calculate totals of draft purchase invoice card
  const purchaseLines = useMemo(() => purchaseItems.map(item => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    return { ...item, quantity, unitPrice, total: roundForCurrency(quantity * unitPrice, purchaseCurrency) };
  }), [purchaseItems, purchaseCurrency]);

  const { subtotal: purchaseDraftSubtotal, taxAmount: purchaseDraftTax, total: purchaseDraftTotal } = useMemo(
    () => computeInvoiceTotals({
      subtotal: purchaseLines.reduce((acc, item) => acc + item.total, 0),
      vatRate: purchaseTaxRate,
      currency: purchaseCurrency,
    }),
    [purchaseLines, purchaseTaxRate, purchaseCurrency]
  );

  // Handle saving the full Purchase Invoice (increments stock automatically via transactions inside FirebaseProvider)
  const handleSavePurchaseInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    sounds.playClick();

    if (!supplierName.trim()) {
      toast.error(isRtl ? "يرجى تحديد اسم المورّد" : "Please declare the supplier name");
      return;
    }
    if (purchaseItems.length === 0) {
      toast.error(isRtl ? "الفاتورة فارغة! يرجى إضافة منتج واحد على الأقل" : "Your invoice draft is empty! Please add items.");
      return;
    }

    const sessionUid = user?.uid || 'guest';
    const typedInvoiceNo = purchaseInvoiceNo.trim();
    // Empty or the auto-suggested number -> consume the sequence so the next one differs
    const finalInvoiceNo = !typedInvoiceNo || typedInvoiceNo === peekInvoiceNumber('PINV', sessionUid)
      ? consumeInvoiceNumber('PINV', sessionUid)
      : typedInvoiceNo;

    const parsedItems = purchaseLines;

    const newInvoice: Invoice = {
      id: crypto.randomUUID(),
      invoiceNumber: finalInvoiceNo,
      supplierName: supplierName.trim(),
      date: new Date(purchaseDate).getTime(),
      items: parsedItems,
      subtotal: purchaseDraftSubtotal,
      taxAmount: purchaseDraftTax,
      vatRate: resolveVatRate(purchaseTaxRate, 0),
      totalAmount: purchaseDraftTotal,
      type: 'purchase',
      currency: purchaseCurrency,
      paymentMethod: 'cash'
    };

    try {
      await saveInvoice(newInvoice);

      toast.success(isRtl ? "تم حفظ فاتورة الشراء وإضافة الكميات إلى المخزون" : "Purchase invoice saved and stock updated");

      setIsPurchaseModalOpen(false);
      // Reset State
      setSupplierName('');
      setPurchaseInvoiceNo('');
      setPurchaseDate(new Date().toISOString().split('T')[0]);
      setPurchaseItems([]);
    } catch (err: any) {
      console.error("Critical Purchase Save Error:", err);
      if (!err?.notified) toast.error(vaultErrorMessage(err, isRtl ? `حدث خطأ أثناء حفظ الفاتورة: ${err.message}` : `Save operation failed: ${err.message}`));
    }
  };

  const vaultErrorMessage = (err: any, fallback: string) => {
    const msg = String(err?.message || '');
    if (msg.startsWith(INSUFFICIENT_VAULT_FUNDS)) {
      return isRtl
        ? 'رصيد الخزنة بهذه العملة غير كافٍ لإتمام العملية. أضف رصيداً للخزنة أو غيّر العملة.'
        : 'Not enough balance in the vault for this currency. Deposit funds or change the currency.';
    }
    return fallback;
  };

  // Action: Add Operational Expense directly to vault transactions
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    sounds.playClick();

    const amt = parseFloat(String(expenseAmount));
    if (isNaN(amt) || amt <= 0) {
      toast.error(isRtl ? "يرجى إدخال قيمة صحيحة للمصروف" : "Please record a valid positive expense amount");
      return;
    }
    if (!expenseDescription.trim()) {
      toast.error(isRtl ? "يرجى كتابة بيان ووصف للمصروف" : "Declaration description is required");
      return;
    }

    try {
      const descriptionText = `[${getCategoryLabel(expenseCategory)}] ${expenseDescription.trim()}`;
      
      // Direct integration into our core central treasury vault system
      await recordVaultTransaction({
        type: 'expense',
        category: expenseCategory === 'salary' ? 'salary' : 'other',
        source: expenseCategory === 'salary' ? 'payroll' : 'expense',
        amount: amt,
        currency: expenseCurrency,
        description: descriptionText
      });

      toast.success(isRtl ? "تم تسجيل المصروف وخصمه من الخزنة" : "Expense recorded and deducted from the vault");
      setIsExpenseModalOpen(false);
      setExpenseAmount('');
      setExpenseDescription('');
    } catch (err: any) {
      console.error("Critical Expense Save Error:", err);
      if (!err?.notified) toast.error(vaultErrorMessage(err, isRtl ? 'فشل تسجيل المصروف' : 'Failed to log expense'));
    }
  };

  const { preferredCurrency } = usePreferredCurrency();
  const activeCurrency = preferredCurrency === 'DEFAULT' ? (settings?.currency || 'JOD') : preferredCurrency;

  // Filter Purchase invoices
  const filteredPurchases = useMemo(() => {
    return invoices
      .filter(inv => inv.type === 'purchase')
      .filter(inv => inv.currency === activeCurrency)
      .filter(inv => {
        const term = searchQuery.toLowerCase();
        const matchesSupplier = inv.supplierName?.toLowerCase().includes(term);
        const matchesNo = inv.invoiceNumber?.toLowerCase().includes(term);
        const matchesItemName = inv.items?.some(it => it.description?.toLowerCase().includes(term));
        const matchesText = matchesSupplier || matchesNo || matchesItemName;

        let matchesFrom = true;
        let matchesTo = true;
        if (fromDate) {
          const fTime = new Date(fromDate).getTime();
          matchesFrom = inv.date >= fTime;
        }
        if (toDate) {
          const tTime = new Date(toDate).setHours(23, 59, 59, 999);
          matchesTo = inv.date <= tTime;
        }

        return matchesText && matchesFrom && matchesTo;
      })
      .sort((a, b) => b.date - a.date);
  }, [invoices, searchQuery, fromDate, toDate, activeCurrency]);

  // Filter expenses (derived from vault records marked as of type 'expense', excluding direct auto purchases if desired, or displaying all operational costs)
  const filteredExpenses = useMemo(() => {
    return vaultTransactions
      // Operating expenses only: purchases (own screen) and reversal entries (deleted sales) are not OpEx.
      .filter(tx => tx.type === 'expense' && tx.source !== 'purchase_invoice' && tx.source !== 'reversal' && tx.category !== 'purchase')
      .filter(tx => tx.currency === activeCurrency)
      .filter(tx => {
        const term = searchQuery.toLowerCase();
        // Check matching description
        const descMatch = tx.description?.toLowerCase().includes(term) || tx.id?.includes(term);
        
        // Category filter matching
        let catMatch = true;
        if (expenseFilter !== 'all') {
          // If the descriptions contains the category label bracket e.g. [الرواتب]
          const catObj = expenseCategories.find(c => c.id === expenseFilter);
          const activeLabel = catObj?.label.toLowerCase() || '';
          catMatch = tx.description?.toLowerCase().includes(expenseFilter) || 
                     tx.description?.toLowerCase().includes(activeLabel) ||
                     (expenseFilter === 'salary' && tx.category === 'salary');
        }

        let matchesFrom = true;
        let matchesTo = true;
        if (fromDate) {
          const fTime = new Date(fromDate).getTime();
          matchesFrom = tx.timestamp >= fTime;
        }
        if (toDate) {
          const tTime = new Date(toDate).setHours(23, 59, 59, 999);
          matchesTo = tx.timestamp <= tTime;
        }

        return descMatch && catMatch && matchesFrom && matchesTo;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [vaultTransactions, searchQuery, expenseFilter, fromDate, toDate, activeCurrency]);

  // Currency Formatter Utility
  const formatCurrencyValue = (amount: number, currencyCode: Currency) => {
    return formatMoney(Number(amount) || 0, currencyCode, isRtl ? 'ar' : 'en-US');
  };

  // Export Filtered Purchases as CSV
  const downloadPurchasesCSV = () => {
    sounds.playClick();
    if (filteredPurchases.length === 0) {
      toast.warning(isRtl ? "لا توجد سجلات مشتريات لتصديرها!" : "No purchase records to export!");
      return;
    }

    // Define CSV header structure
    const headers = isRtl
      ? ["رقم الفاتورة", "اسم المورد", "تاريخ التوريد", "عدد الأصناف", "صافي القيمة", "العملة", "حالة الدفع"]
      : ["Invoice Number", "Supplier Name", "Purchase Date", "Items Count", "Total Amount", "Currency", "Status"];

    const rws = filteredPurchases.map(inv => [
      inv.invoiceNumber,
      inv.supplierName || (isRtl ? "مورّد مجهول" : "Unknown Supplier"),
      new Date(inv.date).toLocaleDateString(isRtl ? 'ar-JO' : 'en-US'),
      inv.items?.length || 0,
      inv.totalAmount,
      inv.currency,
      isRtl ? "مدفوعة ومستلمة" : "Fully Settled"
    ]);

    // Build the CSV string with BOM for correct Arabic rendering in Excel
    const BOM = "\uFEFF";
    const csvContent = BOM + [headers.join(","), ...rws.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `purchases_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success(isRtl ? "تم تحميل ملف CSV بنجاح! 📂" : "CSV file downloaded successfully! 📂");
  };

  // Generate a clean corporate-ready printable Purchase Invoice
  const printPurchaseInvoice = (invoice: Invoice) => {
    sounds.playClick();
    const ok = printHtmlDocument(buildInvoicePrintHtml({
      invoice,
      products,
      isRtl,
      businessName: settings?.businessName || appName(isRtl),
      businessAddress: settings?.businessAddress,
      businessPhone: settings?.businessPhone,
      businessEmail: settings?.businessEmail,
      taxRegistrationNumber: settings?.taxRegistrationNumber,
      companyLogoUrl: settings?.companyLogoUrl,
    }));
    if (!ok) toast.error(isRtl ? 'تعذّر تجهيز الطباعة على هذا الجهاز' : 'Printing is not available on this device');
  };


  return (
    <div className={`max-w-7xl mx-auto p-4 md:p-8 ${isRtl ? 'font-arabic' : 'font-sans'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
            <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-xl shadow-indigo-100 dark:shadow-indigo-950/30">
              <ShoppingBag size={28} />
            </div>
            {isRtl ? "المشتريات والمصاريف التشغيلية" : "Purchases & Expenses Portal"}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-base">
            {isRtl 
              ? "إدارة متكاملة لفواتير توريد البضائع من الموردين وتسجيل التكاليف والمصاريف التشغيلية لربطها بالخزنة."
              : "Consolidated system to track supplier purchases, increment warehouse products, and catalog utility costs."}
          </p>
        </div>

        {/* Action buttons triggers */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              sounds.playClick();
              setIsPurchaseModalOpen(true);
            }}
            className="px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl flex items-center gap-2 shadow-lg shadow-indigo-100 dark:shadow-none transition-all cursor-pointer active:scale-95"
          >
            <Plus size={16} />
            {isRtl ? "إضافة فاتورة شراء" : "Record Supplier Purchase"}
          </button>

          <button
            onClick={() => {
              sounds.playClick();
              setIsExpenseModalOpen(true);
            }}
            className="px-5 py-3.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm rounded-xl flex items-center gap-2 shadow-lg shadow-sky-100 dark:shadow-none transition-all cursor-pointer active:scale-95"
          >
            <Wallet size={16} />
            {isRtl ? "تسجيل مصروف جديد" : "Log Operational Expense"}
          </button>
        </div>
      </div>

      {/* Tabs Menu Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 mb-8 overflow-x-auto pb-1">
        <button
          onClick={() => {
            sounds.playClick();
            setActiveTab('purchases');
          }}
          className={`px-6 py-3 font-extrabold text-sm border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'purchases' 
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <ShoppingBag size={16} />
          {isRtl ? "فواتير المشتريات والتوريد" : "Supplier Purchases Invoices"}
          <span className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold rounded-full">
            {filteredPurchases.length}
          </span>
        </button>

        <button
          onClick={() => {
            sounds.playClick();
            setActiveTab('expenses');
          }}
          className={`px-6 py-3 font-extrabold text-sm border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'expenses' 
              ? 'border-sky-600 text-sky-600 dark:text-sky-400 dark:border-sky-400' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Wallet size={16} />
          {isRtl ? "سجل المصاريف والمدفوعات" : "Operational Expenses Ledger"}
          <span className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold rounded-full">
            {filteredExpenses.length}
          </span>
        </button>
      </div>

      {/* Main Filter Toolbar */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-800 shadow-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-6">
          
          {/* Quick Search Input */}
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder={isRtl ? "بحث برقم الفاتورة، اسم المورّد، أو البند..." : "Search by number, supplier, items..."} aria-label={isRtl ? "بحث برقم الفاتورة، اسم المورّد، أو البند..." : "Search by number, supplier, items..."}
              className={`w-full py-2.5 pl-10 pr-4 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:outline-none dark:text-white ${isRtl ? 'pr-4 pl-10' : ''}`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Subcategory Select Filter if on Expenses Tab */}
          {activeTab === 'expenses' && (
            <div className="w-full md:w-56">
              <select
                className="w-full py-2.5 px-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm border border-slate-200 dark:border-slate-700 focus:border-sky-500 focus:outline-none dark:text-white"
                value={expenseFilter}
                onChange={(e) => setExpenseFilter(e.target.value)}
              >
                <option value="all">{isRtl ? "كافة فئات المصاريف" : "All Expense Categories"}</option>
                {expenseCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date Picker Interval Filter */}
          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
            <div className="relative">
              <Calendar className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="date"
                className="py-1.5 pl-8 pr-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none dark:text-white"
                title={isRtl ? "من تاريخ" : "From Date"}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <span className="text-xs text-slate-400">{isRtl ? "إلى" : "to"}</span>
            <div className="relative">
              <Calendar className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="date"
                className="py-1.5 pl-8 pr-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none dark:text-white"
                title={isRtl ? "إلى تاريخ" : "To Date"}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            {(fromDate || toDate || searchQuery || expenseFilter !== 'all') && (
              <button
                onClick={() => {
                  sounds.playClick();
                  setSearchQuery('');
                  setFromDate('');
                  setToDate('');
                  setExpenseFilter('all');
                }}
                className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-full transition cursor-pointer"
                title={isRtl ? "مسح التصفية" : "Clear filters"} aria-label={isRtl ? "مسح التصفية" : "Clear filters"}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      


      {/* RENDER ACTIVE TAB CODES */}

      {/* TAB 1: PURCHASES */}
      {activeTab === 'purchases' && (
        <div className="space-y-4">
          
          {/* Warning informational banner */}
          <div className="p-4 bg-indigo-50/60 dark:bg-indigo-950/25 border border-indigo-100 dark:border-indigo-900/40 rounded-2xl flex items-start gap-3">
            <Info className="text-indigo-600 mt-0.5 flex-shrink-0" size={18} />
            <div className="text-xs text-indigo-900/80 dark:text-indigo-400 leading-relaxed font-arabic">
              {isRtl
                ? "💡 ربط المخزن التلقائي: عند تسجيل أي فاتورة تزويد/شراء بضاعة جديدة، يقوم تيار الترانزكشن التلقائي برفع وإضافة مستويات جرد السلع بالكميات المدخلة فوراً في قاعدة البيانات وتحديث رصيد الميزانية بالخزنة."
                : "💡 Native Inventory Bound: Recording purchase invoices automatically increments row stock levels inside the live products table and accurately updates dynamic cash ledger pools."}
            </div>
          </div>

          {/* Export & Summary Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-indigo-50/20 dark:bg-slate-800/15 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="text-xs font-semibold text-slate-500 font-arabic flex flex-wrap items-center gap-1.5 md:gap-3">
              <span>{isRtl ? "الفواتير المعروضة:" : "Displayed Invoices:"}</span>
              <span className="font-extrabold text-indigo-600 dark:text-cyan-400 text-sm whitespace-nowrap">
                {filteredPurchases.length} {isRtl ? "فاتورة" : "Invoices"}
              </span>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <span>{isRtl ? "إجمالي القيمة المفلترة:" : "Total Filtered Value:"}</span>
              <span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-sm whitespace-nowrap">
                {formatCurrencyValue(filteredPurchases.reduce((sum, item) => sum + item.totalAmount, 0), settings?.currency || 'JOD')}
              </span>
            </div>

            <button
              onClick={downloadPurchasesCSV}
              className="w-full sm:w-auto px-4 py-2 text-xs font-black bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow flex items-center justify-center gap-2 cursor-pointer transition text-indigo-600 dark:text-cyan-400 font-arabic"
            >
              <Download size={14} />
              {isRtl ? "تحميل ملف CSV" : "Download CSV Report"}
            </button>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[800px] md:min-w-full" dir={isRtl ? 'rtl' : 'ltr'}>
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-400 uppercase text-[10px] font-black tracking-wider border-b border-slate-200/50 dark:border-slate-700/50">
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "رقم الفاتورة" : "Invoice No"}</th>
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "اسم المورّد" : "Supplier Name"}</th>
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "تاريخ التوريد" : "Purchase Date"}</th>
                    <th className="px-6 py-4 text-center whitespace-nowrap">{isRtl ? "عدد الأصناف" : "Items Count"}</th>
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "صافي القيمة" : "Total Amount"}</th>
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "حالة الدفع" : "Status"}</th>
                    <th className="px-6 py-4 text-center whitespace-nowrap">{isRtl ? "خيارات ومراجعة" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-16 text-slate-400">
                        <ShoppingBag size={48} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                        <h4 className="text-base font-bold text-slate-800 dark:text-slate-200">{isRtl ? "لا توجد فواتير شراء مطابقة" : "No purchase invoices found"}</h4>
                        <p className="text-xs text-slate-400 mt-1">{isRtl ? "اضغط على زر (إضافة فاتورة شراء) لتسجيل أول فاتورة توريد." : "Click Record Purchase to draft and write your first invoice."}</p>
                      </td>
                    </tr>
                  ) : (
                    filteredPurchases.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors duration-200">
                        <td className="px-6 py-4 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">{inv.invoiceNumber}</td>
                        <td className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">{inv.supplierName || (isRtl ? "مورّد مجهول" : "Unknown Supplier")}</td>
                        <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">{new Date(inv.date).toLocaleString(isRtl ? 'ar-JO' : 'en-US')}</td>
                        <td className="px-6 py-4 text-center font-bold whitespace-nowrap">{inv.items?.length || 0}</td>
                        <td className="px-6 py-4 font-extrabold text-slate-900 dark:text-cyan-400 whitespace-nowrap">{formatCurrencyValue(inv.totalAmount, inv.currency)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
                            <CheckCircle2 size={12} />
                            {isRtl ? "مدفوعة ومستلمة" : "Fully Settled"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => {
                                sounds.playClick();
                                setInvoiceDetail(inv);
                              }}
                              className="p-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/10 dark:hover:bg-indigo-900/35 text-indigo-600 dark:text-indigo-400 rounded-xl transition cursor-pointer"
                              title={isRtl ? "عرض تفاصيل الفاتورة" : "View Details"} aria-label={isRtl ? "عرض تفاصيل الفاتورة" : "View Details"}
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => printPurchaseInvoice(inv)}
                              className="p-2 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/10 dark:hover:bg-sky-900/35 text-sky-600 dark:text-sky-400 rounded-xl transition cursor-pointer"
                              title={isRtl ? "طباعة الفاتورة" : "Print Invoice"} aria-label={isRtl ? "طباعة الفاتورة" : "Print Invoice"}
                            >
                              <Printer size={14} />
                            </button>
                            <button
                              onClick={async () => {
                                sounds.playClick();
                                if (confirm(isRtl ? "هل تريد بالتأكيد حذف فاتورة الشراء؟ ستُرجَع قيمتها إلى الخزنة وتُخصم كمياتها من المخزون." : "Delete this purchase? Its amount returns to the vault and its quantities are removed from stock.")) {
                                  try {
                                    await deleteInvoice(inv.id);
                                    toast.success(isRtl ? "تم حذف الفاتورة وعكس آثارها" : "Invoice deleted and reversed");
                                  } catch (err: any) {
                                    toast.error(err?.message || (isRtl ? "تعذّر حذف الفاتورة" : "Could not delete the invoice"));
                                  }
                                }
                              }}
                              className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl transition cursor-pointer"
                             aria-label={isRtl ? 'حذف' : 'Delete'}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: EXPENSES */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          
          {/* Quick Metrics stats cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-bold block uppercase tracking-wider">{isRtl ? "إجمالي مصاريف التشغيل" : "Total OpEx Burn"}</span>
                <span className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1 block">
                  {formatCurrencyValue(
                    filteredExpenses.reduce((acc, curr) => acc + curr.amount, 0),
                    settings?.currency || 'JOD'
                  )}
                </span>
              </div>
              <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/10 rounded-2xl flex items-center justify-center text-rose-500">
                <TrendingDown size={22} />
              </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-bold block uppercase tracking-wider">{isRtl ? "فئة المصروف الأعلى" : "Top Outflow Segment"}</span>
                <span className="text-lg font-extrabold text-slate-800 dark:text-white mt-1.5 block">
                  {isRtl ? "خدمات ولوجستيات" : "Utilities & Logistics"}
                </span>
              </div>
              <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/20 rounded-2xl flex items-center justify-center text-indigo-500">
                <Wallet size={20} />
              </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-bold block uppercase tracking-wider">{isRtl ? "القيود والمدفوعات التشغيلية" : "Recorded Payments count"}</span>
                <span className="text-2xl font-black text-slate-900 dark:text-white mt-1 block">
                  {filteredExpenses.length} {isRtl ? "سند دفع" : "records"}
                </span>
              </div>
              <div className="w-12 h-12 bg-sky-50 dark:bg-sky-950/20 rounded-2xl flex items-center justify-center text-sky-500">
                <FileText size={20} />
              </div>
            </div>
          </div>

          {/* Expenses data grid table */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[750px] md:min-w-full" dir={isRtl ? 'rtl' : 'ltr'}>
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-400 uppercase text-[10px] font-black tracking-wider border-b border-slate-200/50 dark:border-slate-700/50">
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "معرف السند" : "Transaction ID"}</th>
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "البيان والوصف" : "Operational Description"}</th>
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "تاريخ السحب" : "Execution Date"}</th>
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "قيمة السند" : "Expense Value"}</th>
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "تصنيف العملية" : "Safe Class"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-16 text-slate-400">
                        <Wallet size={48} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                        <h4 className="text-base font-bold text-slate-800 dark:text-slate-200">{isRtl ? "لا توجد مصاريف تشغيلية" : "No operational expenses logged"}</h4>
                        <p className="text-xs text-slate-400 mt-1">{isRtl ? "انقر على زر (تسجيل مصروف جديد) لسحب واستهلاك قيد مالي." : "Click Log Expense to update and decrement secure liquid values."}</p>
                      </td>
                    </tr>
                  ) : (
                    filteredExpenses.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors duration-200">
                        <td className="px-6 py-4 font-mono font-extrabold text-xs text-slate-500 whitespace-nowrap">#{tx.id ? tx.id.slice(-8).toUpperCase() : 'N/A'}</td>
                        <td className="px-6 py-4 font-semibold text-slate-800 dark:text-slate-300 max-w-sm truncate whitespace-nowrap">{tx.description}</td>
                        <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">{new Date(tx.timestamp).toLocaleString(isRtl ? 'ar-JO' : 'en-US')}</td>
                        <td className="px-6 py-4 font-extrabold text-rose-500 whitespace-nowrap">-{formatCurrencyValue(tx.amount, tx.currency)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-extrabold rounded uppercase ${
                            tx.category === 'salary' 
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' 
                              : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400'
                          }`}>
                            {tx.category === 'salary' ? (isRtl ? 'رواتب' : 'Salary') : (isRtl ? 'مصاريف تشغيلية' : 'General OpEx')}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD NEW PURCHASE INVOICE */}
      <AnimatePresence>
        {isPurchaseModalOpen && (
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-3xl text-slate-800 dark:text-white"
            >
              
              {/* Modal Top */}
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-600 rounded-xl text-white">
                    <Plus size={18} />
                  </div>
                  <div>
                    <h3 className="font-black text-xl">{isRtl ? "تسجيل فاتورة توريد / مشتريات" : "Create New Supplier Purchase Invoice"}</h3>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Automatic Database Inventory Increment System</span>
                  </div>
                </div>

                <button
                  onClick={() => setIsPurchaseModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={20} />
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleSavePurchaseInvoice} className="p-6 md:p-8 space-y-6">
                
                {/* Meta Inputs row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-wider">{isRtl ? "اسم المورّد / الشركة" : "Supplier Name / Enterprise"}</label>
                    <input
                      type="text"
                      className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:border-indigo-500 focus:outline-none dark:text-white"
                      placeholder={isRtl ? "اختر أو اكتب اسم المورّد..." : "Select or type supplier name..."} aria-label={isRtl ? "اختر أو اكتب اسم المورّد..." : "Select or type supplier name..."}
                      required
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      list="suppliers-list"
                    />
                    <datalist id="suppliers-list">
                      {existingSuppliers.map((sup, sIdx) => (
                        <option key={sIdx} value={sup} />
                      ))}
                    </datalist>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center justify-between">
                      <span>{isRtl ? "رقم الفاتورة" : "Invoice Reference Number"}</span>
                      <button 
                        type="button" 
                        onClick={triggerAutoInvoiceNo}
                        className="text-[10px] text-indigo-500 font-extrabold hover:underline"
                      >
                        ⚡ {isRtl ? "توليد تلقائي" : "Auto Generate"}
                      </button>
                    </label>
                    <input
                      type="text"
                      className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono focus:border-indigo-500 focus:outline-none dark:text-white"
                      placeholder={isRtl ? "أدخل رقم الفاتورة أو اضغط توليد تلقائي" : "e.g., PINV-94921"} aria-label={isRtl ? "أدخل رقم الفاتورة أو اضغط توليد تلقائي" : "e.g., PINV-94921"}
                      value={purchaseInvoiceNo}
                      onChange={(e) => setPurchaseInvoiceNo(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <CurrencyPicker
                      value={purchaseCurrency}
                      onChange={setPurchaseCurrency}
                      isRtl={isRtl}
                      label={isRtl ? 'عملة الدفع من الخزنة' : 'Payment currency (from vault)'}
                    />
                    <p className="text-xs font-mono text-slate-500">
                      {isRtl ? 'المتاح: ' : 'Available: '}
                      {formatMoney(readVaultBalances(vault)[purchaseCurrency] || 0, purchaseCurrency, isRtl ? 'ar' : 'en-US')}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-wider">{isRtl ? "تاريخ الفاتورة" : "Invoice Issue Date"}</label>
                    <input
                      type="date"
                      className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:border-indigo-500 focus:outline-none dark:text-white"
                      required
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                    />
                  </div>
                </div>

                {/* Sub-Card: Line items dynamic insertion builder */}
                <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-800/80 rounded-[2rem] space-y-4">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-wide">
                    ➕ {isRtl ? "باني بنود الفاتورة التلقائي" : "Automated Invoice Item Appender"}
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    
                    {/* Item Dropdown */}
                    <div className="md:col-span-5 space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400">{isRtl ? "اختر صنفاً من المخزن" : "Select warehouse product"}</label>
                      <select
                        className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded-xl text-xs sm:text-sm focus:outline-none dark:text-white"
                        value={selectedProductId}
                        onChange={(e) => {
                          setSelectedProductId(e.target.value);
                          const chosen = products.find(p => p.id === e.target.value);
                          if (chosen) setItemUnitCost(String(chosen.unitCost));
                        }}
                      >
                        <option value="">-- {isRtl ? "اختر السلعة لتحديث كميتها" : "Select Product Item"} --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} (SKU: {p.sku}) [ {isRtl ? 'المتوفر:' : 'In Stock:'} {p.quantity} ]
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quantity cost field */}
                    <div className="md:col-span-2 space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400">{isRtl ? "كمية الشراء" : "Purchase Qty"}</label>
                      <input
                        type="number"
                        className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded-xl text-sm focus:outline-none dark:text-white"
                        min="0"
                        step="any"
                        value={itemQuantity}
                        onChange={(e) => setItemQuantity(e.target.value)}
                      />
                    </div>

                    {/* Cost prices unit */}
                    <div className="md:col-span-3 space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400">
                        {isRtl ? "سعر تكلفة الحبة الموردة" : "Unit cost price"} ( {purchaseCurrency} )
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        placeholder="0.00"
                        className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded-xl text-sm focus:outline-none dark:text-white"
                        value={itemUnitCost}
                        onChange={(e) => setItemUnitCost(e.target.value)}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={handleAddLineItem}
                        className="w-full py-3 bg-sky-600 hover:bg-sky-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                      >
                        {isRtl ? "إضافة البند" : "Append"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Draft list table */}
                <div className="border border-slate-200/50 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-800">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200/50 dark:border-slate-700/50 flex justify-between items-center">
                    <span className="text-xs font-black block text-slate-500 uppercase tracking-widest">{isRtl ? "تفاصيل بنود الفاتورة المدخلة" : "Draft Invoice Items Details"}</span>
                    <span className="text-[10px] font-extrabold bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded">{purchaseItems.length} {isRtl ? "مدخلات" : "Draft lines"}</span>
                  </div>
                  
                  {purchaseItems.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      {isRtl ? "الفاتورة لا تحتوي على أي بنود حالياً" : "Zero items appended to the purchase. Build item rows above."}
                    </div>
                  ) : (
                    <div className="max-h-[220px] overflow-y-auto overflow-x-auto">
                      <table className="w-full text-xs text-left min-w-[500px] md:min-w-full" dir={isRtl ? 'rtl' : 'ltr'}>
                        <thead>
                          <tr className="bg-slate-50/20 text-slate-400 border-b border-slate-100">
                            <th className="px-4 py-2 whitespace-nowrap">{isRtl ? "البند" : "Item"}</th>
                            <th className="px-4 py-2 text-center whitespace-nowrap">{isRtl ? "الكمية" : "Qty"}</th>
                            <th className="px-4 py-2 whitespace-nowrap">{isRtl ? "التكلفة" : "Unit Cost"}</th>
                            <th className="px-4 py-2 whitespace-nowrap">{isRtl ? "الإجمالي" : "Total"}</th>
                            <th className="px-4 py-2 text-center whitespace-nowrap">{isRtl ? "حذف" : "Drop"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {purchaseLines.map((item, index) => (
                            <tr key={index} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors duration-200">
                              <td className="px-4 py-3 font-semibold whitespace-nowrap">{item.description}</td>
                              <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{item.quantity}</td>
                              <td className="px-4 py-3 font-mono whitespace-nowrap">{formatCurrencyValue(item.unitPrice, purchaseCurrency)}</td>
                              <td className="px-4 py-3 font-extrabold whitespace-nowrap">{formatCurrencyValue(item.total, purchaseCurrency)}</td>
                              <td className="px-4 py-3 text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveLineItem(index)}
                                  className="text-rose-500 hover:bg-rose-50 p-1 rounded-lg transition"
                                 aria-label={isRtl ? 'حذف' : 'Delete'}>
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Calculation breakdown row and tax rate inputs */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center pt-2">
                  <div className="md:col-span-5 flex items-center gap-2">
                    <span className="text-xs text-slate-400 whitespace-nowrap">{isRtl ? "معدل ضريبة المشتريات (%) :" : "Tax rate (%) :"}</span>
                    <input
                      type="number"
                      className="w-20 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 rounded-lg text-xs font-bold text-center dark:text-white focus:outline-none"
                      value={purchaseTaxRate}
                      onChange={(e) => setPurchaseTaxRate(Number(e.target.value))}
                    />
                  </div>

                  <div className="md:col-span-7 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl flex items-center justify-around gap-2 text-slate-500 text-xs font-black">
                    <div className="text-center">
                      <span className="block text-[10px] text-slate-400 uppercase tracking-wider">{isRtl ? "المجموع الفرعي" : "Subtotal"}</span>
                      <span className="text-slate-700 dark:text-slate-300">{formatCurrencyValue(purchaseDraftSubtotal, purchaseCurrency)}</span>
                    </div>
                    <div className="text-center border-x border-slate-200 dark:border-slate-800 px-6">
                      <span className="block text-[10px] text-slate-400 uppercase tracking-wider">{isRtl ? "الضريبة المضافة" : "VAT Tax"}</span>
                      <span className="text-slate-700 dark:text-slate-300">{formatCurrencyValue(purchaseDraftTax, purchaseCurrency)}</span>
                    </div>
                    <div className="text-center">
                      <span className="block text-[10px] text-indigo-500 uppercase tracking-wider">{isRtl ? "صافي القيمة النهائية" : "Grand Total"}</span>
                      <span className="text-indigo-600 dark:text-cyan-400 text-sm font-black">{formatCurrencyValue(purchaseDraftTotal, purchaseCurrency)}</span>
                    </div>
                  </div>
                </div>

                {/* Submits row */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsPurchaseModalOpen(false)}
                    className="px-5 py-3 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition uppercase tracking-wider active:scale-95 cursor-pointer"
                  >
                    {isRtl ? "إلغاء وتراجع" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-3 text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none uppercase tracking-wider transition active:scale-95 cursor-pointer"
                  >
                    {isRtl ? "تأكيد فوري وحفظ الفاتورة" : "Commit & Post Stock"}
                  </button>
                </div>

              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: LOG NEW EXPENSE */}
      <AnimatePresence>
        {isExpenseModalOpen && (
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] w-full max-w-lg shadow-3xl text-slate-800 dark:text-white"
            >
              
              {/* Modal Top */}
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-sky-600 rounded-xl text-white">
                    <Wallet size={18} />
                  </div>
                  <div>
                    <h3 className="font-black text-xl">{isRtl ? "سحب وتسجيل مصروف" : "Log New Operational Expense"}</h3>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Decrements physical central treasury ledger</span>
                  </div>
                </div>

                <button
                  onClick={() => setIsExpenseModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={20} />
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleSaveExpense} className="p-6 space-y-4">
                
                {/* Category selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider">{isRtl ? "نوع وفئة المصروف" : "Expense Category"}</label>
                  <select
                    className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:border-sky-500 focus:outline-none dark:text-white"
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                  >
                    {expenseCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.label}</option>
                    ))}
                  </select>
                </div>

                {/* Amount input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider">
                    {isRtl ? "قيمة المصروف النقدي" : "Expense cash value"} ( {expenseCurrency} )
                  </label>
                  <CurrencyPicker
                    value={expenseCurrency}
                    onChange={setExpenseCurrency}
                    isRtl={isRtl}
                    label={isRtl ? 'عملة المصروف' : 'Expense currency'}
                  />
                  <p className="text-xs font-mono text-slate-500">
                    {isRtl ? 'المتاح: ' : 'Available: '}
                    {formatMoney(readVaultBalances(vault)[expenseCurrency] || 0, expenseCurrency, isRtl ? 'ar' : 'en-US')}
                  </p>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    required
                    className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold focus:border-sky-500 focus:outline-none dark:text-white"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                  />
                </div>

                {/* Description input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider">{isRtl ? "التفاصيل والبيان ووصف المسحوب" : "Brief Details & Recipient"}</label>
                  <textarea
                    rows={3}
                    placeholder={isRtl ? "مثال: دفع فاتورة كهرباء المخزن لشهر مايو 2026 بالتكامل مع شركة النور" : "e.g., Paid warehouse electricity bill for May 2026"} aria-label={isRtl ? "مثال: دفع فاتورة كهرباء المخزن لشهر مايو 2026 بالتكامل مع شركة النور" : "e.g., Paid warehouse electricity bill for May 2026"}
                    required
                    className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm focus:border-sky-500 focus:outline-none dark:text-white"
                    value={expenseDescription}
                    onChange={(e) => setExpenseDescription(e.target.value)}
                  />
                </div>

                {/* Submits row */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsExpenseModalOpen(false)}
                    className="px-5 py-3 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition uppercase tracking-wider active:scale-95 cursor-pointer"
                  >
                    {isRtl ? "إلغاء الأمر" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-3 text-xs font-black bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-lg shadow-sky-50 dark:shadow-none uppercase tracking-wider transition active:scale-95 cursor-pointer"
                  >
                    {isRtl ? "سحب وقيد المصير مالي" : "Log Expense"}
                  </button>
                </div>

              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: PURCHASE INVOICE DETAIL MODAL */}
      <AnimatePresence>
        {invoiceDetail && (
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] w-full max-w-2xl shadow-3xl text-slate-800 dark:text-white overflow-hidden"
            >
              
              {/* Modal Head Header */}
              <div className="p-6 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="text-indigo-600" size={20} />
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-white">
                      {isRtl ? "تفاصيل فاتورة مراجعة التوريد" : "Purchase Invoice Auditor Review"}
                    </h3>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest font-mono">
                      Invoice Ref: #{invoiceDetail.invoiceNumber}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setInvoiceDetail(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body Info details */}
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="block text-slate-400">{isRtl ? "اسم المورد الرئيسي" : "Supplier"}</span>
                    <span className="font-extrabold text-sm text-slate-800 dark:text-white">{invoiceDetail.supplierName}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400">{isRtl ? "تاريخ الإصدار والتوظيف" : "Logged Date"}</span>
                    <span className="font-extrabold text-sm">{new Date(invoiceDetail.date).toLocaleString(isRtl ? 'ar-JO' : 'en-US')}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400">{isRtl ? "مجموع قيمة السلع الخام" : "Subtotal"}</span>
                    <span className="font-bold">{formatCurrencyValue(invoiceDetail.subtotal || 0, invoiceDetail.currency)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400">{isRtl ? "مبلغ الضريبة" : "VAT Tax"}</span>
                    <span className="font-bold">{formatCurrencyValue(invoiceDetail.taxAmount || 0, invoiceDetail.currency)}</span>
                  </div>
                </div>

                {/* Items detailed sub grid list */}
                <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/30">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/80 text-[10px] uppercase font-black tracking-widest text-slate-400 font-arabic">
                    {isRtl ? "السجلات والسلع المشمولة بالفاتورة" : "Matched rows inside purchase invoice"}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left min-w-[500px] md:min-w-full" dir={isRtl ? 'rtl' : 'ltr'}>
                      <thead>
                        <tr className="bg-slate-50/10 text-slate-400 uppercase text-[9px]">
                          <th className="px-4 py-2 whitespace-nowrap">{isRtl ? "اسم السلعة" : "Product Item"}</th>
                          <th className="px-4 py-2 text-center whitespace-nowrap">{isRtl ? "الكمية" : "Qty"}</th>
                          <th className="px-4 py-2 whitespace-nowrap">{isRtl ? "التكلفة" : "Cost price"}</th>
                          <th className="px-4 py-2 whitespace-nowrap">{isRtl ? "الإجمالي" : "Total Cost"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {invoiceDetail.items?.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors duration-200">
                            <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">{item.description}</td>
                            <td className="px-4 py-3 text-center font-bold text-slate-900 dark:text-white whitespace-nowrap">{item.quantity}</td>
                            <td className="px-4 py-3 font-mono whitespace-nowrap">{formatCurrencyValue(item.unitPrice, invoiceDetail.currency)}</td>
                            <td className="px-4 py-3 font-extrabold text-indigo-600 dark:text-cyan-400 whitespace-nowrap">
                              {formatCurrencyValue(item.quantity * item.unitPrice, invoiceDetail.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex justify-between items-center py-4 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-sm font-bold">{isRtl ? "صافي قيمة الفاتورة الكلي :" : "Grand Settlement Total :"}</span>
                  <span className="text-xl font-black text-indigo-600 dark:text-cyan-400">{formatCurrencyValue(invoiceDetail.totalAmount, invoiceDetail.currency)}</span>
                </div>
              </div>

              {/* Close row */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => printPurchaseInvoice(invoiceDetail)}
                  className="px-5 py-2 text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  <Printer size={13} />
                  {isRtl ? "طباعة الفاتورة" : "Print Invoice"}
                </button>
                <button
                  onClick={() => setInvoiceDetail(null)}
                  className="px-5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer"
                >
                  {isRtl ? "إغلاق النافذة" : "Close Auditor View"}
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
