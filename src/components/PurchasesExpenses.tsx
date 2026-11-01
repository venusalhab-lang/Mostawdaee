import { consumeInvoiceNumber, peekInvoiceNumber } from '../lib/invoiceNumber';
import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  Printer,
  Truck,
  Undo2,
  ClipboardList,
  FileText as OrderIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { Language, Invoice, InvoiceItem, Product, Currency, VaultTransaction } from '../types';
import { toast } from 'sonner';
import { sounds } from '../lib/sounds';
import { currencyDecimals, formatMoney } from '../lib/exchangeRates';
import { isOfflineError } from '../lib/offlineQueue';
import { formatPackStock, lineKey, lineQuantityText, productPack } from '../lib/packs';
import CurrencyPicker from './CurrencyPicker';
import ShowMoreBar from './ui/ShowMoreBar';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { readVaultBalances, INSUFFICIENT_VAULT_FUNDS, planInvoiceVaultEntry, roundForCurrency } from '../lib/vaultMath';
import { computeInvoiceTotals, resolveVatRate } from '../lib/invoiceTotals';
import { localDayEnd, localDayStart, localIsoDate, timestampForLocalDay } from '../lib/localDate';
import {
  EXPENSE_CATEGORY_IDS,
  type ExpenseCategoryId,
  EXPENSE_ENTRY_CATEGORY_IDS,
  expenseCategoryLabel,
  expenseCategoryOf,
  expenseDescription as expenseDescriptionText,
  topExpenseCategory,
} from '../lib/expenseCategories';
import { buildInvoicePrintHtml } from '../lib/invoiceDocument';
import { printHtmlDocument } from '../lib/printHtml';
import { appName } from '../lib/brand';
import { checkPurchasePayment, findSupplierByName, purchasePayment } from '../lib/suppliers';
import SuppliersPanel from './SuppliersPanel';
import ReturnModal from './ReturnModal';
import { canReturnPurchase } from '../lib/purchaseReturn';
import { csvCell } from '../lib/csv';
import ReorderPanel from './ReorderPanel';
import OrdersPanel from './OrdersPanel';
import { orderToPurchaseLines } from '../lib/orders';
import type { TradeOrder } from '../types';

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
    user,
    workspace,
    suppliers,
    saveSupplier,
    markOrderConverted,
    orders,
    can
  } = useFirebase();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'purchases' | 'expenses' | 'suppliers' | 'reorder' | 'orders'>('purchases');
  /** The purchase order the open purchase form was filled from; it is marked received once the purchase is saved. */
  const [sourceOrder, setSourceOrder] = useState<TradeOrder | null>(null);

  // Search/Filters states
  const [searchQuery, setSearchQuery] = useState('');
  const [expenseFilter, setExpenseFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');


  // Active modal controls
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<Invoice | null>(null);
  const [returnTarget, setReturnTarget] = useState<Invoice | null>(null);

  // New Purchase Form state
  const [supplierName, setSupplierName] = useState('');
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<string>(() => localIsoDate());
  const [purchaseItems, setPurchaseItems] = useState<Omit<InvoiceItem, 'total'>[]>([]);
  const [purchaseTaxRate, setPurchaseTaxRate] = useState<number>(() => resolveVatRate(settings?.defaultVatRate));
  const [selectedProductId, setSelectedProductId] = useState('');
  const [itemQuantity, setItemQuantity] = useState<string>('1');
  const [itemUnitCost, setItemUnitCost] = useState<string>('');
  const [itemByPack, setItemByPack] = useState(false);
  const [purchaseCurrency, setPurchaseCurrency] = useState<Currency>(settings?.currency || 'JOD');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [paidNow, setPaidNow] = useState('');
  const [addingSupplier, setAddingSupplier] = useState(false);
  // One id per draft: a second click, or a retry after a lost reply, is recognised as the same purchase.
  const purchaseIdRef = useRef<string | null>(null);
  const expenseIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => { purchaseIdRef.current = null; }, [purchaseItems, supplierName, purchaseCurrency, purchaseTaxRate, purchaseDate, paymentMode, paidNow]);

  // Registered suppliers first, then names typed on older purchases.
  const existingSuppliers = useMemo(() => {
    const list = new Set<string>(suppliers.map(s => s.name));
    invoices.forEach(inv => {
      if (inv.type === 'purchase' && inv.supplierName && !findSupplierByName(suppliers, inv.supplierName)) {
        list.add(inv.supplierName.trim());
      }
    });
    return Array.from(list);
  }, [invoices, suppliers]);
  const matchedSupplier = useMemo(() => findSupplierByName(suppliers, supplierName), [suppliers, supplierName]);

  const addTypedSupplier = async () => {
    const name = supplierName.trim();
    if (!name || addingSupplier) return;
    setAddingSupplier(true);
    try {
      await saveSupplier({ id: crypto.randomUUID(), name });
      toast.success(isRtl ? `أُضيف «${name}» إلى الموردين` : `“${name}” added to suppliers`);
    } catch (err: any) {
      if (!err?.notified) toast.error(err?.message || (isRtl ? 'تعذّر إضافة المورد.' : 'Could not add the supplier.'));
    } finally {
      setAddingSupplier(false);
    }
  };

  // New Expense Form state
  const [expenseCategory, setExpenseCategory] = useState('utilities');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseCurrency, setExpenseCurrency] = useState<Currency>(settings?.currency || 'JOD');
  useEffect(() => { expenseIdRef.current = null; }, [expenseCategory, expenseAmount, expenseDescription, expenseCurrency]);

  /** New OpEx entries — no salary (payroll is Employees only). */
  const expenseEntryCategories = EXPENSE_ENTRY_CATEGORY_IDS.map((id) => ({ id, label: expenseCategoryLabel(id, isRtl) }));
  /** History filters keep salary so older payroll-linked rows remain findable. */
  const expenseFilterCategories = EXPENSE_CATEGORY_IDS.map((id) => ({ id, label: expenseCategoryLabel(id, isRtl) }));

  // Generate a random invoice No if left empty
  const triggerAutoInvoiceNo = () => {
    setPurchaseInvoiceNo(peekInvoiceNumber('PINV', user?.uid || 'guest', workspace?.ownerId));
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
    const pack = itemByPack ? productPack(prod) : null;
    const key = lineKey({ productId: selectedProductId, packSize: pack?.size });

    // Same product bought the same way at the same cost is one line; another cost keeps its own line.
    const existingIdx = purchaseItems.findIndex(i => lineKey(i) === key && Number(i.unitPrice) === cost);
    if (existingIdx > -1) {
      const updated = [...purchaseItems];
      updated[existingIdx] = { ...updated[existingIdx], quantity: updated[existingIdx].quantity + qty };
      setPurchaseItems(updated);
    } else {
      setPurchaseItems([
        ...purchaseItems,
        {
          productId: selectedProductId,
          description: prod.name,
          quantity: qty,
          unitPrice: cost,
          ...(pack ? { packSize: pack.size, packName: pack.name || undefined } : {}),
        }
      ]);
    }

    // Reset fields
    setSelectedProductId('');
    setItemQuantity('1');
    setItemUnitCost('');
    setItemByPack(false);
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
  const paidNowValue = paymentMode === 'cash' ? purchaseDraftTotal
    : paymentMode === 'credit' ? 0
      : roundForCurrency(Number(paidNow) || 0, purchaseCurrency);
  const owedLater = roundForCurrency(Math.max(purchaseDraftTotal - paidNowValue, 0), purchaseCurrency);

  // Handle saving the full Purchase Invoice (increments stock automatically via transactions inside FirebaseProvider)
  const handleSavePurchaseInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    sounds.playClick();

    if (!supplierName.trim()) {
      toast.error(isRtl ? "يرجى تحديد اسم المورّد" : "Please declare the supplier name");
      return;
    }
    if (purchaseItems.length === 0) {
      toast.error(isRtl ? "الفاتورة فارغة! يرجى إضافة منتج واحد على الأقل" : "Your invoice draft is empty! Please add items.");
      return;
    }
    const paymentProblem = checkPurchasePayment(
      paymentMode === 'cash' || (paymentMode === 'partial' && owedLater <= 0 && paidNowValue <= purchaseDraftTotal) ? 'cash' : 'credit', purchaseDraftTotal, paidNowValue, purchaseCurrency, matchedSupplier?.id);
    if (paymentProblem) {
      toast.error(paymentProblem === 'supplier_required'
        ? (isRtl ? 'الشراء الآجل يحتاج مورداً مسجلاً. أضف المورد أولاً.' : 'A credit purchase needs a registered supplier. Add the supplier first.')
        : paymentProblem === 'paid_exceeds_total'
          ? (isRtl ? 'المدفوع الآن أكبر من إجمالي الفاتورة.' : 'The amount paid now is more than the invoice total.')
          : (isRtl ? 'المبلغ المدفوع الآن غير صالح.' : 'The amount paid now is not valid.'));
      return;
    }

    const sessionUid = user?.uid || 'guest';
    const storeId = workspace?.ownerId;
    const typedInvoiceNo = purchaseInvoiceNo.trim();
    const suggestedNo = peekInvoiceNumber('PINV', sessionUid, storeId);
    // The sequence advances only once the invoice is saved, so a failed save leaves no gap.
    const usesSequence = !typedInvoiceNo || typedInvoiceNo === suggestedNo;
    const finalInvoiceNo = usesSequence ? suggestedNo : typedInvoiceNo;

    const parsedItems = purchaseLines;

    purchaseIdRef.current ||= crypto.randomUUID();
    const newInvoice: Invoice = {
      id: purchaseIdRef.current,
      invoiceNumber: finalInvoiceNo,
      supplierName: matchedSupplier?.name || supplierName.trim(),
      ...(matchedSupplier ? { supplierId: matchedSupplier.id } : {}),
      date: timestampForLocalDay(purchaseDate),
      items: parsedItems,
      subtotal: purchaseDraftSubtotal,
      taxAmount: purchaseDraftTax,
      vatRate: resolveVatRate(purchaseTaxRate, 0),
      totalAmount: purchaseDraftTotal,
      type: 'purchase',
      currency: purchaseCurrency,
      ...(paymentMode === 'cash' || owedLater <= 0 ? { paymentMethod: 'cash' as const } : { paymentMethod: 'credit' as const, paidAmount: paidNowValue }),
    };

    savingRef.current = true;
    setIsSaving(true);
    try {
      await saveInvoice(newInvoice);
      purchaseIdRef.current = null;
      if (usesSequence) consumeInvoiceNumber('PINV', sessionUid, storeId);

      toast.success(isRtl ? "تم حفظ فاتورة الشراء وإضافة الكميات إلى المخزون" : "Purchase invoice saved and stock updated");
      if (sourceOrder) {
        const order = sourceOrder;
        setSourceOrder(null);
        markOrderConverted(order.id, newInvoice).catch((err: any) => {
          toast.error(err?.message || (isRtl ? `حُفظت الفاتورة، لكن تعذّر تعليم أمر الشراء ${order.number} كمستلم. علّمه من قائمة الأوامر.` : `The purchase was saved, but order ${order.number} could not be marked received.`));
        });
      }

      setIsPurchaseModalOpen(false);
      // Reset State
      setSupplierName('');
      setPurchaseInvoiceNo('');
      setPurchaseDate(localIsoDate());
      setPurchaseItems([]);
      setPaymentMode('cash');
      setPaidNow('');
    } catch (err: any) {
      console.error("Critical Purchase Save Error:", err);
      if (!err?.notified) toast.error(vaultErrorMessage(err, isOfflineError(err)
        ? (isRtl ? 'انقطع الاتصال قبل تأكيد الحفظ. أعد المحاولة؛ لن تُسجَّل الفاتورة مرتين.' : 'The connection dropped before the save was confirmed. Try again; it will not be recorded twice.')
        : (isRtl ? 'تعذّر حفظ فاتورة الشراء. حاول مرة أخرى.' : 'Could not save the purchase invoice. Please try again.')));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const receiveOrder = (order: TradeOrder) => {
    const { items, missing } = orderToPurchaseLines(order, products);
    if (!items.length) {
      toast.error(isRtl ? 'لا يوجد في أمر الشراء صنف ما زال موجوداً في المخزون.' : 'None of the items on this order exist in the inventory any more.');
      return;
    }
    if (missing.length) {
      toast.warning(isRtl ? `لم تُنقل أصناف حُذفت من المخزون: ${missing.join('، ')}` : `Items deleted from the inventory were left out: ${missing.join(', ')}`);
    }
    sounds.playClick();
    setSupplierName(order.supplierName || '');
    setPurchaseCurrency(order.currency);
    setPurchaseTaxRate(order.vatRate);
    setPurchaseItems(items);
    setPurchaseDate(localIsoDate());
    setPurchaseInvoiceNo('');
    setPaymentMode('cash');
    setPaidNow('');
    setSourceOrder(order);
    setIsPurchaseModalOpen(true);
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
    if (savingRef.current) return;
    sounds.playClick();

    const typed = parseFloat(String(expenseAmount));
    const amt = Number.isFinite(typed) ? roundForCurrency(typed, expenseCurrency) : NaN;
    if (isNaN(amt) || amt <= 0) {
      toast.error(isRtl ? "يرجى إدخال قيمة صحيحة للمصروف" : "Please record a valid positive expense amount");
      return;
    }
    if (!expenseDescription.trim()) {
      toast.error(isRtl ? "يرجى كتابة بيان ووصف للمصروف" : "Declaration description is required");
      return;
    }

    // Payroll must go through Employees → Pay salary (atomic payroll + vault). Never mint a fake payroll row here.
    if (expenseCategory === 'salary' || !EXPENSE_ENTRY_CATEGORY_IDS.includes(expenseCategory as (typeof EXPENSE_ENTRY_CATEGORY_IDS)[number])) {
      toast.error(isRtl
        ? 'صرف الرواتب من شاشة الموظفين فقط، حتى يبقى السجل مرتبطاً بالموظف والخزنة معاً.'
        : 'Pay staff salaries from Employees only, so the payroll record and vault stay linked.');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    expenseIdRef.current ||= crypto.randomUUID();
    try {
      const descriptionText = expenseDescriptionText(expenseCategory as ExpenseCategoryId, isRtl, expenseDescription);
      
      // Direct integration into our core central treasury vault system
      await recordVaultTransaction({
        id: expenseIdRef.current,
        type: 'expense',
        category: 'other',
        source: 'expense',
        amount: amt,
        currency: expenseCurrency,
        description: descriptionText
      });

      expenseIdRef.current = null;
      toast.success(isRtl ? "تم تسجيل المصروف وخصمه من الخزنة" : "Expense recorded and deducted from the vault");
      setIsExpenseModalOpen(false);
      setExpenseAmount('');
      setExpenseDescription('');
    } catch (err: any) {
      console.error("Critical Expense Save Error:", err);
      if (!err?.notified) toast.error(vaultErrorMessage(err, isOfflineError(err)
        ? (isRtl ? 'انقطع الاتصال قبل تأكيد التسجيل. أعد المحاولة؛ لن يُخصم المصروف مرتين.' : 'The connection dropped before the expense was confirmed. Try again; it will not be deducted twice.')
        : (isRtl ? 'فشل تسجيل المصروف' : 'Failed to log expense')));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const { preferredCurrency } = usePreferredCurrency();
  const activeCurrency = preferredCurrency === 'DEFAULT' ? (settings?.currency || 'JOD') : preferredCurrency;

  // Filter Purchase invoices
  const filteredPurchases = useMemo(() => {
    return invoices
      .filter(inv => inv.type === 'purchase' || inv.type === 'purchase_return')
      .filter(inv => inv.currency === activeCurrency)
      .filter(inv => {
        const term = searchQuery.toLowerCase();
        const matchesSupplier = inv.supplierName?.toLowerCase().includes(term);
        const matchesNo = inv.invoiceNumber?.toLowerCase().includes(term);
        const matchesItemName = inv.items?.some(it => it.description?.toLowerCase().includes(term));
        const matchesText = matchesSupplier || matchesNo || matchesItemName;

        let matchesFrom = true;
        let matchesTo = true;
        const fTime = fromDate ? localDayStart(fromDate) : null;
        if (fTime !== null) matchesFrom = inv.date >= fTime;
        const tTime = toDate ? localDayEnd(toDate) : null;
        if (tTime !== null) matchesTo = inv.date <= tTime;

        return matchesText && matchesFrom && matchesTo;
      })
      .sort((a, b) => b.date - a.date);
  }, [invoices, searchQuery, fromDate, toDate, activeCurrency]);

  // Filter expenses (derived from vault records marked as of type 'expense', excluding direct auto purchases if desired, or displaying all operational costs)
  const filteredExpenses = useMemo(() => {
    return vaultTransactions
      // Operating expenses only: purchases (own screen), reversals of deleted sales and cash refunds of sales returns are not OpEx.
      .filter(tx => tx.type === 'expense' && tx.source !== 'purchase_invoice' && tx.source !== 'reversal' && tx.source !== 'sale_return' && tx.category !== 'purchase')
      .filter(tx => tx.currency === activeCurrency)
      .filter(tx => {
        const term = searchQuery.toLowerCase();
        // Check matching description
        const descMatch = tx.description?.toLowerCase().includes(term) || tx.id?.includes(term);
        
        const catMatch = expenseFilter === 'all' || expenseCategoryOf(tx) === expenseFilter;

        let matchesFrom = true;
        let matchesTo = true;
        const fTime = fromDate ? localDayStart(fromDate) : null;
        if (fTime !== null) matchesFrom = tx.timestamp >= fTime;
        const tTime = toDate ? localDayEnd(toDate) : null;
        if (tTime !== null) matchesTo = tx.timestamp <= tTime;

        return descMatch && catMatch && matchesFrom && matchesTo;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [vaultTransactions, searchQuery, expenseFilter, fromDate, toDate, activeCurrency]);
  const purchasePage = useProgressiveList(filteredPurchases, `${searchQuery}|${fromDate}|${toDate}|${activeCurrency}`);
  const expensePage = useProgressiveList(filteredExpenses, `${searchQuery}|${expenseFilter}|${fromDate}|${toDate}|${activeCurrency}`);

  const topExpense = useMemo(() => topExpenseCategory(filteredExpenses), [filteredExpenses]);

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
      ? ["رقم الفاتورة", "اسم المورد", "تاريخ التوريد", "عدد الأصناف", "الإجمالي (شامل الضريبة)", "العملة", "حالة الدفع"]
      : ["Invoice Number", "Supplier Name", "Purchase Date", "Items Count", "Total (incl. VAT)", "Currency", "Status"];

    const rws = filteredPurchases.map(inv => [
      inv.invoiceNumber,
      inv.supplierName || (isRtl ? "مورّد مجهول" : "Unknown Supplier"),
      new Date(inv.date).toLocaleDateString(isRtl ? 'ar-JO' : 'en-US'),
      inv.items?.length || 0,
      inv.type === 'purchase_return' ? -(Number(inv.totalAmount) || 0) : inv.totalAmount,
      inv.currency,
      inv.type === 'purchase_return'
        ? `${isRtl ? 'مرتجع عن' : 'Return of'} ${inv.returnOfNumber || ''}`.trim()
        : purchasePayment(inv).owed > 0
        ? `${isRtl ? 'آجل عند الشراء' : 'On credit'} ${purchasePayment(inv).owed}`
        : (isRtl ? "مدفوعة نقداً" : "Paid in cash")
    ]);

    // Build the CSV string with BOM for correct Arabic rendering in Excel
    const BOM = "\uFEFF";
    const csvContent = BOM + [headers.join(","), ...rws.map(r => r.map(csvCell).join(","))].join("\n");

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
              : 'Record supplier purchases, stock received, and operating expenses.'}
          </p>
        </div>

        {/* Action buttons triggers */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              sounds.playClick();
              if (sourceOrder) {
                setSourceOrder(null);
                setPurchaseItems([]);
                setSupplierName('');
              }
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

        <button
          onClick={() => {
            sounds.playClick();
            setActiveTab('suppliers');
          }}
          className={`px-6 py-3 font-extrabold text-sm border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'suppliers'
              ? 'border-amber-600 text-amber-700 dark:text-amber-400 dark:border-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Truck size={16} />
          {isRtl ? "الموردون" : "Suppliers"}
          <span className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold rounded-full">
            {suppliers.length}
          </span>
        </button>

        <button
          onClick={() => {
            sounds.playClick();
            setActiveTab('reorder');
          }}
          className={`px-6 py-3 font-extrabold text-sm border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'reorder'
              ? 'border-rose-600 text-rose-700 dark:text-rose-400 dark:border-rose-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <ClipboardList size={16} />
          {isRtl ? "إعادة الطلب" : "Reorder"}
        </button>

        <button
          onClick={() => {
            sounds.playClick();
            setActiveTab('orders');
          }}
          className={`px-6 py-3 font-extrabold text-sm border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'orders'
              ? 'border-violet-600 text-violet-700 dark:text-violet-400 dark:border-violet-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <OrderIcon size={16} />
          {isRtl ? "أوامر الشراء" : "Purchase orders"}
          <span className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold rounded-full">
            {orders.filter(o => o.kind === 'purchase_order' && (o.status === 'draft' || o.status === 'sent')).length}
          </span>
        </button>
      </div>

      {activeTab === 'reorder' && (
        <ReorderPanel isRtl={isRtl} defaultCurrency={activeCurrency as Currency} onOrdersCreated={() => setActiveTab('orders')} />
      )}

      {activeTab === 'orders' && (
        <OrdersPanel kind="purchase_order" isRtl={isRtl} defaultCurrency={activeCurrency as Currency} onConvert={receiveOrder} />
      )}

      {activeTab === 'suppliers' && (
        <SuppliersPanel isRtl={isRtl} defaultCurrency={activeCurrency as Currency} />
      )}

      {/* Main Filter Toolbar */}
        {(activeTab === 'purchases' || activeTab === 'expenses') && (
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
                {expenseFilterCategories.map(cat => (
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
        )}

      {/* RENDER ACTIVE TAB CODES */}

      {/* TAB 1: PURCHASES */}
      {activeTab === 'purchases' && (
        <div className="space-y-4">
          
          {/* Warning informational banner */}
          <div className="p-4 bg-indigo-50/60 dark:bg-indigo-950/25 border border-indigo-100 dark:border-indigo-900/40 rounded-2xl flex items-start gap-3">
            <Info className="text-indigo-600 mt-0.5 flex-shrink-0" size={18} />
            <div className="text-xs text-indigo-900/80 dark:text-indigo-400 leading-relaxed font-arabic">
              {isRtl
                ? "💡 عند حفظ فاتورة الشراء تُضاف كمياتها إلى المخزون، ويُخصم من الخزنة ما دُفع الآن فقط؛ والباقي يُسجَّل ديناً للمورد في تبويب الموردين."
                : "💡 Saving a purchase adds its quantities to stock and takes only what is paid now from the vault; the rest is owed to the supplier (Suppliers tab)."}
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
              <span>{isRtl ? "إجمالي القيمة بعد التصفية:" : "Total Filtered Value:"}</span>
              <span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-sm whitespace-nowrap">
                {formatCurrencyValue(filteredPurchases.reduce((sum, item) => sum + (item.type === 'purchase_return' ? -1 : 1) * (Number(item.totalAmount) || 0), 0), activeCurrency)}
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
                    <th className="px-6 py-4 whitespace-nowrap">{isRtl ? "الإجمالي (شامل الضريبة)" : "Total (incl. VAT)"}</th>
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
                    purchasePage.visible.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors duration-200">
                        <td className="px-6 py-4 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {inv.invoiceNumber}
                          {inv.type === 'purchase_return' && (
                            <span className="ms-2 font-arabic text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">{isRtl ? 'مرتجع' : 'Return'}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">{inv.supplierName || (isRtl ? "مورّد مجهول" : "Unknown Supplier")}</td>
                        <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">{new Date(inv.date).toLocaleString(isRtl ? 'ar-JO' : 'en-US')}</td>
                        <td className="px-6 py-4 text-center font-bold whitespace-nowrap">{inv.items?.length || 0}</td>
                        <td className={`px-6 py-4 font-extrabold whitespace-nowrap ${inv.type === 'purchase_return' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-cyan-400'}`} dir="ltr">{inv.type === 'purchase_return' ? '−' : ''}{formatCurrencyValue(inv.totalAmount, inv.currency)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {(() => {
                            if (inv.type === 'purchase_return') {
                              return (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-full">
                                  <Undo2 size={12} />
                                  {isRtl ? 'مرتجع عن ' : 'Return of '}
                                  <span className="font-mono" dir="ltr">#{inv.returnOfNumber || inv.returnOf}</span>
                                </span>
                              );
                            }
                            const { owed } = purchasePayment(inv);
                            if (owed <= 0) {
                              return (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
                                  <CheckCircle2 size={12} />
                                  {isRtl ? "مدفوعة نقداً" : "Paid in cash"}
                                </span>
                              );
                            }
                            return (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-full">
                                <Truck size={12} />
                                {isRtl ? "آجل عند الشراء " : "On credit "}
                                <span className="font-mono" dir="ltr">{formatCurrencyValue(owed, inv.currency)}</span>
                              </span>
                            );
                          })()}
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
                            {can('back_office') && canReturnPurchase(inv) && (
                              <button
                                onClick={() => { sounds.playClick(); setReturnTarget(inv); }}
                                className="p-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/10 dark:hover:bg-amber-900/35 text-amber-600 dark:text-amber-400 rounded-xl transition cursor-pointer"
                                title={isRtl ? 'مرتجع للمورد' : 'Return to supplier'} aria-label={isRtl ? 'مرتجع للمورد' : 'Return to supplier'}
                              >
                                <Undo2 size={14} />
                              </button>
                            )}
                            {can('reverse_invoice') && (
                            <button
                              onClick={async () => {
                                sounds.playClick();
                                const vaultPlan = inv.vaultPosted === false
                                  ? null
                                  : planInvoiceVaultEntry(inv, { includeNonCash: inv.vaultPosted === undefined });
                                const notifyDeleteError = (err: any, fallback: string) => {
                                  if (err?.notified) return;
                                  toast.error(err?.message || fallback);
                                };
                                if (inv.type === 'purchase_return') {
                                  const debt = Number(inv.refund?.debt) || 0;
                                  const parts = [
                                    isRtl ? 'تعود كمياته إلى المخزون' : 'its quantities come back into stock',
                                    vaultPlan
                                      ? (isRtl
                                        ? `يُسحب ${formatCurrencyValue(vaultPlan.amount, vaultPlan.currency)} من الخزنة (ما ردّه المورد نقداً)`
                                        : `${formatCurrencyValue(vaultPlan.amount, vaultPlan.currency)} leaves the vault (supplier cash refund)`)
                                      : '',
                                    debt > 0
                                      ? (isRtl ? 'يعود ما خُصم إلى رصيد المورد' : 'any balance reduction is added back to the supplier')
                                      : '',
                                  ].filter(Boolean).join(isRtl ? '، ' : ', ');
                                  if (!confirm(isRtl
                                    ? `حذف مرتجع المشتريات #${inv.invoiceNumber}؟ ${parts}.`
                                    : `Delete purchase return #${inv.invoiceNumber}? ${parts}.`)) return;
                                  try {
                                    await deleteInvoice(inv.id);
                                    toast.success(isRtl ? 'حُذف المرتجع وعُكست آثاره' : 'Return deleted and reversed');
                                  } catch (err: any) {
                                    notifyDeleteError(err, isRtl ? 'تعذّر حذف المرتجع' : 'Could not delete the return');
                                  }
                                  return;
                                }
                                const { owed } = purchasePayment(inv);
                                const parts = [
                                  vaultPlan
                                    ? (isRtl
                                      ? `يعود ${formatCurrencyValue(vaultPlan.amount, vaultPlan.currency)} إلى الخزنة`
                                      : `${formatCurrencyValue(vaultPlan.amount, vaultPlan.currency)} returns to the vault`)
                                    : '',
                                  owed > 0
                                    ? (isRtl
                                      ? `يُخصم ${formatCurrencyValue(owed, inv.currency)} من المستحق للمورد`
                                      : `${formatCurrencyValue(owed, inv.currency)} comes off the supplier balance`)
                                    : '',
                                  isRtl ? 'وتُخصم كمياتها من المخزون' : 'its quantities are removed from stock',
                                ].filter(Boolean).join(isRtl ? '، ' : ', ');
                                if (!confirm(isRtl ? `حذف فاتورة الشراء؟ ${parts}.` : `Delete this purchase? ${parts}.`)) return;
                                try {
                                  await deleteInvoice(inv.id);
                                  toast.success(isRtl ? 'تم حذف الفاتورة وعكس آثارها' : 'Invoice deleted and reversed');
                                } catch (err: any) {
                                  notifyDeleteError(err, isRtl ? 'تعذّر حذف الفاتورة' : 'Could not delete the invoice');
                                }
                              }}
                              className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl transition cursor-pointer"
                             aria-label={isRtl ? 'حذف' : 'Delete'}>
                              <Trash2 size={14} />
                            </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <ShowMoreBar isRtl={isRtl} shown={purchasePage.shown} total={purchasePage.total} pageSize={purchasePage.pageSize} onMore={purchasePage.showMore} onAll={purchasePage.showAll} className="px-6 border-t border-slate-100 dark:border-slate-800" />
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
                    activeCurrency
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
                  {topExpense ? expenseCategoryLabel(topExpense.id, isRtl) : '—'}
                </span>
                {topExpense && (
                  <span className="text-[11px] font-bold text-slate-400 mt-0.5 block">
                    {formatCurrencyValue(topExpense.amount, activeCurrency)}
                    {' · '}
                    <span dir="ltr">{Math.round(topExpense.share * 100)}%</span>
                  </span>
                )}
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
                    expensePage.visible.map((tx) => (
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
            <ShowMoreBar isRtl={isRtl} shown={expensePage.shown} total={expensePage.total} pageSize={expensePage.pageSize} onMore={expensePage.showMore} onAll={expensePage.showAll} className="px-6 border-t border-slate-100 dark:border-slate-800" />
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
                    {sourceOrder ? (
                      <span className="text-xs text-violet-600 dark:text-violet-400 font-bold">
                        {isRtl ? `استلام أمر الشراء ${sourceOrder.number} — عدّل الكميات حسب ما وصل فعلاً` : `Receiving purchase order ${sourceOrder.number} — adjust quantities to what actually arrived`}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Automatic Database Inventory Increment System</span>
                    )}
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
                    {supplierName.trim() && (
                      matchedSupplier ? (
                        <p className="text-[11px] font-bold text-emerald-600">{isRtl ? '✓ مورد مسجّل' : '✓ Registered supplier'}</p>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          {isRtl ? 'غير مسجّل كمورد. ' : 'Not a registered supplier. '}
                          <button type="button" onClick={addTypedSupplier} disabled={addingSupplier} className="font-bold text-indigo-600 hover:underline disabled:opacity-50">
                            {isRtl ? 'إضافته كمورد' : 'Add as supplier'}
                          </button>
                        </p>
                      )
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center justify-between">
                      <span>{isRtl ? "رقم الفاتورة" : "Invoice Reference Number"}</span>
                      <button 
                        type="button" 
                        onClick={triggerAutoInvoiceNo}
                        className="text-[10px] text-indigo-500 font-extrabold hover:underline"
                      >
                        {isRtl ? 'توليد رقم' : 'Generate'}
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
                      label={isRtl ? 'عملة الفاتورة' : 'Invoice currency'}
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
                          setItemByPack(false);
                          const chosen = products.find(p => p.id === e.target.value);
                          if (chosen) setItemUnitCost(String(chosen.unitCost));
                        }}
                      >
                        <option value="">-- {isRtl ? "اختر السلعة لتحديث كميتها" : "Select Product Item"} --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} (SKU: {p.sku}) [ {isRtl ? 'المتوفر:' : 'In Stock:'} {formatPackStock(p.quantity, p, isRtl) ?? p.quantity} ]
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const pack = activeSelectedProduct ? productPack(activeSelectedProduct) : null;
                        if (!activeSelectedProduct || !pack) return null;
                        const unitName = activeSelectedProduct.unitName?.trim() || (isRtl ? 'وحدة' : 'unit');
                        const packName = pack.name || (isRtl ? 'عبوة' : 'pack');
                        const choose = (byPack: boolean) => {
                          setItemByPack(byPack);
                          const unitCost = Number(activeSelectedProduct.unitCost) || 0;
                          setItemUnitCost(String(Math.round(unitCost * (byPack ? pack.size : 1) * 10_000) / 10_000));
                        };
                        return (
                          <span className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-[10px] font-bold" role="group" aria-label={isRtl ? 'الشراء بالوحدة أو بالعبوة' : 'Buy by unit or pack'}>
                            {[false, true].map((byPack) => (
                              <button
                                key={String(byPack)}
                                type="button"
                                aria-pressed={itemByPack === byPack}
                                onClick={() => choose(byPack)}
                                className={`px-2.5 py-1 ${itemByPack === byPack ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                              >
                                {byPack ? `${packName} (${pack.size})` : unitName}
                              </button>
                            ))}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Quantity cost field */}
                    <div className="md:col-span-2 space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400">
                        {itemByPack && activeSelectedProduct && productPack(activeSelectedProduct)
                          ? (isRtl ? `عدد ${productPack(activeSelectedProduct)!.name || 'العبوات'}` : 'Packs')
                          : (isRtl ? "كمية الشراء" : "Purchase Qty")}
                      </label>
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
                        {itemByPack
                          ? (isRtl ? "تكلفة العبوة الواحدة" : "Cost per pack")
                          : (isRtl ? "سعر تكلفة الحبة الموردة" : "Unit cost price")} ( {purchaseCurrency} )
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        placeholder="0.00"
                        className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded-xl text-sm focus:outline-none dark:text-white"
                        value={itemUnitCost}
                        onChange={(e) => setItemUnitCost(e.target.value)}
                      />
                      {(() => {
                        const pack = itemByPack && activeSelectedProduct ? productPack(activeSelectedProduct) : null;
                        const cost = parseFloat(itemUnitCost);
                        if (!pack || !Number.isFinite(cost) || cost <= 0) return null;
                        return (
                          <p className="text-[10px] font-bold text-slate-400">
                            {isRtl ? 'تكلفة الوحدة: ' : 'Per unit: '}{formatCurrencyValue(cost / pack.size, purchaseCurrency)}
                          </p>
                        );
                      })()}
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
                              <td className="px-4 py-3 text-center font-bold whitespace-nowrap">{lineQuantityText(item, isRtl)}</td>
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
                      <span className="block text-[10px] text-indigo-500 uppercase tracking-wider">{isRtl ? "الإجمالي (شامل الضريبة)" : "Total (incl. VAT)"}</span>
                      <span className="text-indigo-600 dark:text-cyan-400 text-sm font-black">{formatCurrencyValue(purchaseDraftTotal, purchaseCurrency)}</span>
                    </div>
                  </div>
                </div>

                {/* Payment: what leaves the vault now and what stays owed to the supplier */}
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-black text-slate-500">{isRtl ? 'طريقة الدفع:' : 'Payment:'}</span>
                    <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-bold" role="group" aria-label={isRtl ? 'طريقة الدفع' : 'Payment'}>
                      {([['cash', isRtl ? 'نقداً' : 'Cash'], ['credit', isRtl ? 'آجل' : 'Credit'], ['partial', isRtl ? 'جزئي' : 'Partial']] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={paymentMode === mode}
                          onClick={() => setPaymentMode(mode)}
                          className={`px-4 py-2 ${paymentMode === mode ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {paymentMode === 'partial' && (
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                        {isRtl ? 'المدفوع الآن' : 'Paid now'}
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step={currencyDecimals(purchaseCurrency) > 0 ? String(10 ** -currencyDecimals(purchaseCurrency)) : '1'}
                          className="w-32 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono dark:text-white focus:outline-none"
                          value={paidNow}
                          onChange={(e) => setPaidNow(e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <span className="text-slate-500">
                      {isRtl ? 'يُخصم من الخزنة الآن: ' : 'From the vault now: '}
                      <b className="font-mono text-slate-800 dark:text-slate-100" dir="ltr">{formatCurrencyValue(paidNowValue, purchaseCurrency)}</b>
                      <span className="text-slate-400"> ({isRtl ? 'المتاح ' : 'available '}<span className="font-mono" dir="ltr">{formatCurrencyValue(readVaultBalances(vault)[purchaseCurrency] || 0, purchaseCurrency)}</span>)</span>
                    </span>
                    {paymentMode !== 'cash' && (
                      <span className="text-slate-500">
                        {isRtl ? 'يبقى للمورد: ' : 'Owed to the supplier: '}
                        <b className="font-mono text-amber-700 dark:text-amber-300" dir="ltr">{formatCurrencyValue(owedLater, purchaseCurrency)}</b>
                      </span>
                    )}
                  </div>
                  {paymentMode !== 'cash' && !matchedSupplier && (
                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                      {isRtl ? 'الشراء الآجل يحتاج مورداً مسجّلاً: اختر اسماً من القائمة أو أضفه كمورد.' : 'A credit purchase needs a registered supplier: pick one from the list or add it.'}
                    </p>
                  )}
                  {paymentMode === 'partial' && paidNowValue > purchaseDraftTotal && (
                    <p className="text-[11px] font-bold text-rose-600">{isRtl ? 'المدفوع الآن أكبر من إجمالي الفاتورة.' : 'Paid now is more than the invoice total.'}</p>
                  )}
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
                    disabled={isSaving}
                    className="px-6 py-3 text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none uppercase tracking-wider transition active:scale-95 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
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
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">{isRtl ? 'يُخصم من الخزنة' : 'Deducted from the vault'}</span>
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
                    {expenseEntryCategories.map(cat => (
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
                    step={10 ** -currencyDecimals(expenseCurrency)}
                    min={0}
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
                    disabled={isSaving}
                    className="px-6 py-3 text-xs font-black bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-lg shadow-sky-50 dark:shadow-none uppercase tracking-wider transition active:scale-95 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                  >
                    {isRtl ? "تسجيل المصروف" : "Log Expense"}
                  </button>
                </div>

              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: PURCHASE INVOICE DETAIL MODAL */}
      <AnimatePresence>
        {returnTarget && (
          <ReturnModal
            original={returnTarget}
            isRtl={isRtl}
            onClose={() => setReturnTarget(null)}
            onSaved={(saved) => {
              setReturnTarget(null);
              toast.success(isRtl ? `سُجّل مرتجع المشتريات #${saved.invoiceNumber}` : `Purchase return #${saved.invoiceNumber} recorded`);
            }}
          />
        )}
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
                      {invoiceDetail.type === 'purchase_return'
                        ? (isRtl ? "تفاصيل مرتجع المشتريات" : "Purchase return details")
                        : (isRtl ? "تفاصيل فاتورة مراجعة التوريد" : "Purchase Invoice Auditor Review")}
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
                    <span className="block text-slate-400">{isRtl ? "تاريخ الفاتورة" : "Invoice date"}</span>
                    <span className="font-extrabold text-sm">{new Date(invoiceDetail.date).toLocaleString(isRtl ? 'ar-JO' : 'en-US')}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400">{isRtl ? "المجموع قبل الضريبة" : "Subtotal (before VAT)"}</span>
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
                            <td className="px-4 py-3 text-center font-bold text-slate-900 dark:text-white whitespace-nowrap">{lineQuantityText(item, isRtl)}</td>
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
                  <span className="text-sm font-bold">{isRtl ? "الإجمالي (شامل الضريبة):" : "Total (incl. VAT):"}</span>
                  <span className="text-xl font-black text-indigo-600 dark:text-cyan-400">{formatCurrencyValue(invoiceDetail.totalAmount, invoiceDetail.currency)}</span>
                </div>
                {(() => {
                  const { paid, owed } = purchasePayment(invoiceDetail);
                  if (owed <= 0) return null;
                  return (
                    <div className="flex flex-wrap justify-between gap-2 text-xs pb-2">
                      <span className="text-slate-500">{isRtl ? 'دُفع من الخزنة: ' : 'Paid from the vault: '}<b className="font-mono" dir="ltr">{formatCurrencyValue(paid, invoiceDetail.currency)}</b></span>
                      <span className="text-slate-500">{isRtl ? 'آجل للمورد: ' : 'Owed to the supplier: '}<b className="font-mono text-amber-700 dark:text-amber-300" dir="ltr">{formatCurrencyValue(owed, invoiceDetail.currency)}</b></span>
                    </div>
                  );
                })()}
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
