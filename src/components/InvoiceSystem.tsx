import { consumeInvoiceNumber, peekInvoiceNumber } from '../lib/invoiceNumber';
import { computeInvoiceTotals, resolveVatRate } from '../lib/invoiceTotals';
import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations } from '../translations';
import { Language, Invoice, InvoiceItem, Product, Currency } from '../types';
import { formatPackStock, isPackLine, lineAsPack, lineKey, lineQuantityText, lineUnits, productPack, unitsInCart } from '../lib/packs';
import { buildAdhocInvoiceItem, isAdhocLine, validateAdhocDraft } from '../lib/adhocLine';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { toast } from 'sonner';
import {
  FileText,
  Plus,
  Printer,
  Search,
  PlusCircle,
  Trash2,
  Download,
  Building,
  User,
  CheckCircle2,
  Share2,
  TrendingUp,
  Undo2,
  LayoutList,
  LayoutGrid,
} from 'lucide-react';
import {
  filterInvoiceList,
  invoiceOwed,
  invoicePaidNow,
  invoicePaymentLabel,
  isSplitTender,
  summarizeInvoiceList,
  type InvoiceListLayout,
  type InvoiceListRange,
  type InvoicePaymentFilter,
  type InvoiceTypeFilter,
} from '../lib/invoiceList';
import ReturnModal from './ReturnModal';
import { canReturn } from '../lib/salesReturn';
import { canReturnPurchase } from '../lib/purchaseReturn';
import { appInvoicePromo, appName } from '../lib/brand';
import { matchesQuery } from '../lib/search';
import { useScreenSearch } from '../lib/screenSearch';
import {
  POS_CURRENCY_CODES,
  CURRENCY_SYMBOLS,
  formatMoney,
  roundMoney,
  currencyDecimals,
  safeConvertMoney,
  buildUsdUnitRates,
  readCachedLiveRates,
  readCachedLiveRatesTimestamp,
  conversionBasis,
} from '../lib/exchangeRates';
import CurrencyPicker from './CurrencyPicker';
import ShowMoreBar from './ui/ShowMoreBar';
import { useProgressiveList } from '../hooks/useProgressiveList';
import EInvoicePanel from './EInvoicePanel';
import { type EInvoiceSubmission, eInvoiceQrDataUrl, fetchEInvoiceSubmissions } from '../lib/einvoiceApi';
import {
  buildInvoicePrintHtml,
  escapeHtml,
  formatCurrencyTotals,
  invoiceDocumentTitle,
  invoiceItemSku,
  invoiceTypeLabel,
  invoiceVatRate,
  sumInvoicesByCurrency,
} from '../lib/invoiceDocument';
import { printHtmlDocument } from '../lib/printHtml';
import { csvCell } from '../lib/csv';
import OrdersPanel from './OrdersPanel';
import { orderToSaleLines } from '../lib/orders';
import type { TradeOrder } from '../types';

interface InvoiceSystemProps {
  language: Language;
  initialView?: 'list' | 'create';
}

const TYPE_TONES = {
  sale: { border: 'border-indigo-100 dark:border-indigo-900/50', bar: 'bg-indigo-500', iconBg: 'bg-indigo-50', text: 'text-indigo-600' },
  purchase: { border: 'border-emerald-100 dark:border-emerald-900/50', bar: 'bg-emerald-500', iconBg: 'bg-emerald-50', text: 'text-emerald-600' },
  return: { border: 'border-rose-100 dark:border-rose-900/50', bar: 'bg-rose-500', iconBg: 'bg-rose-50', text: 'text-rose-600' },
  purchase_return: { border: 'border-amber-100 dark:border-amber-900/50', bar: 'bg-amber-500', iconBg: 'bg-amber-50', text: 'text-amber-600' },
} as const;
const isReturnType = (type: Invoice['type']) => type === 'return' || type === 'purchase_return';
const typeTone = (type: Invoice['type']) => TYPE_TONES[type] || TYPE_TONES.sale;

export default function InvoiceSystem({ language, initialView = 'list' }: InvoiceSystemProps) {
  const t = translations[language];
  const isRtl = language === 'ar';
  const { products, invoices, saveInvoice, deleteInvoice, settings, user, customers, can, workspace, markOrderConverted } = useFirebase();
  const { preferredCurrency } = usePreferredCurrency();
  const activeCurrency = preferredCurrency === 'DEFAULT' ? (settings?.currency || 'JOD') : preferredCurrency;

  const formatCurrency = (val: number, customCurrency?: string) => {
    return formatMoney(Number(val) || 0, customCurrency || settings?.currency || 'JOD');
  };
  const printRef = useRef<HTMLDivElement>(null);
  const [listCurrency, setListCurrency] = useState<'ALL' | Currency>('ALL');
  const [listRange, setListRange] = useState<InvoiceListRange>('all');
  const [listType, setListType] = useState<InvoiceTypeFilter>('all');
  const [listPayment, setListPayment] = useState<InvoicePaymentFilter>('all');
  const [listLayout, setListLayout] = useState<InvoiceListLayout>(() => {
    try {
      return localStorage.getItem('mustawdae_invoice_list_layout') === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  });

  const [view, setView] = useState<'list' | 'create' | 'view'>(initialView);
  const [invoiceType, setInvoiceType] = useState<'sale' | 'purchase'>('sale');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [invSearchTerm, setInvSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Invoice; direction: 'desc' | 'asc' }>({ key: 'date', direction: 'desc' });
  const [returnOpen, setReturnOpen] = useState(false);
  const [listMode, setListMode] = useState<'invoices' | 'quotes'>('invoices');
  /** The quotation the open sale form was filled from; it is marked invoiced once the sale is saved. */
  const [sourceQuote, setSourceQuote] = useState<TradeOrder | null>(null);
  const [deletingReturn, setDeletingReturn] = useState(false);

  // Keep the open invoice in step with the store (a return updates the quantities left on its sale).
  React.useEffect(() => {
    if (!selectedInvoice) return;
    const fresh = invoices.find((inv) => inv.id === selectedInvoice.id);
    if (fresh && fresh !== selectedInvoice) setSelectedInvoice(fresh);
  }, [invoices, selectedInvoice]);

  const relatedReturns = React.useMemo(() => {
    const returnType = selectedInvoice?.type === 'sale' ? 'return' : selectedInvoice?.type === 'purchase' ? 'purchase_return' : null;
    return returnType ? invoices.filter((inv) => inv.type === returnType && inv.returnOf === selectedInvoice!.id) : [];
  }, [invoices, selectedInvoice]);

  const openInvoice = (id: string) => {
    const target = invoices.find((inv) => inv.id === id);
    if (target) setSelectedInvoice(target);
    else toast.error(isRtl ? 'الفاتورة غير موجودة.' : 'Invoice not found.');
  };

  const handleDeleteReturn = async (ret: Invoice) => {
    const msg = ret.type === 'purchase_return'
      ? (isRtl
        ? `حذف مرتجع المشتريات #${ret.invoiceNumber}؟ تعود كمياته إلى المخزون، ويُسحب من الخزنة ما ردّه المورد نقداً، ويعود ما خُصم إلى رصيد المورد.`
        : `Delete purchase return #${ret.invoiceNumber}? Its quantities come back into stock, the supplier's cash refund leaves the vault and any balance reduction is added back.`)
      : (isRtl
        ? `حذف المرتجع #${ret.invoiceNumber}؟ ستُسحب كمياته من المخزون من جديد، ويُعاد ما رُدّ نقداً إلى الخزنة، ويعود ما خُصم إلى دين العميل.`
        : `Delete return #${ret.invoiceNumber}? Its quantities leave stock again, the cash refund goes back to the vault and any debt reduction is added back.`);
    if (!confirm(msg)) return;
    setDeletingReturn(true);
    try {
      await deleteInvoice(ret.id);
      toast.success(isRtl ? 'حُذف المرتجع وعُكست آثاره' : 'Return deleted and reversed');
      const original = ret.returnOf ? invoices.find((inv) => inv.id === ret.returnOf) : undefined;
      if (original) setSelectedInvoice(original);
      else {
        setSelectedInvoice(null);
        setView('list');
      }
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذّر حذف المرتجع' : 'Could not delete the return'));
    } finally {
      setDeletingReturn(false);
    }
  };

  useScreenSearch('invoices', ({ query, recordId }) => {
    setListMode('invoices');
    setListCurrency('ALL');
    setListRange('all');
    setListType('all');
    setListPayment('all');
    setInvSearchTerm(query);
    const record = recordId ? invoices.find((inv) => inv.id === recordId) : undefined;
    setSelectedInvoice(record || null);
    setView(record ? 'view' : 'list');
  });

  const setLayout = (next: InvoiceListLayout) => {
    setListLayout(next);
    try { localStorage.setItem('mustawdae_invoice_list_layout', next); } catch { /* ignore */ }
  };

  const clearListFilters = () => {
    setInvSearchTerm('');
    setListCurrency('ALL');
    setListRange('all');
    setListType('all');
    setListPayment('all');
  };

  const handleSort = (key: keyof Invoice) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedInvoices = React.useMemo(() => {
    const result = filterInvoiceList(invoices, {
      query: invSearchTerm,
      currency: listCurrency,
      range: listRange,
      type: listType,
      payment: listPayment,
      matchesQuery,
    });
    result.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal! < bVal!) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal! > bVal!) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [invoices, invSearchTerm, sortConfig, listCurrency, listRange, listType, listPayment]);

  const listSummary = React.useMemo(() => summarizeInvoiceList(sortedInvoices), [sortedInvoices]);
  const hasActiveFilters = Boolean(invSearchTerm.trim())
    || listCurrency !== 'ALL'
    || listRange !== 'all'
    || listType !== 'all'
    || listPayment !== 'all';

  const invoiceSearchPlaceholder = isRtl
    ? 'ابحث برقم الفاتورة أو اسم العميل أو المورد…'
    : 'Search by invoice #, customer, or supplier…';

  const formatInvoiceWhen = (ms: number) =>
    new Date(ms).toLocaleString(isRtl ? 'ar' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  const partyName = (inv: Invoice) =>
    (inv.type === 'purchase_return' ? inv.supplierName : inv.customerName || inv.supplierName)
    || (isRtl ? 'زبون نقدي' : 'Walk-in');

  const tenderHint = (inv: Invoice) => {
    if (inv.paymentMethod !== 'credit') return null;
    const paid = invoicePaidNow(inv);
    const owed = invoiceOwed(inv);
    if (owed <= 0 && paid <= 0) return null;
    if (isSplitTender(inv) || owed > 0) {
      return isRtl
        ? `مدفوع ${formatCurrency(paid, inv.currency)} · آجل ${formatCurrency(Number(inv.debtAmount) || owed, inv.debtCurrency || inv.currency)}`
        : `Paid ${formatCurrency(paid, inv.currency)} · Due ${formatCurrency(Number(inv.debtAmount) || owed, inv.debtCurrency || inv.currency)}`;
    }
    return null;
  };

  const openInvoiceRow = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setView('view');
  };

  // Create Invoice State
  const [customerName, setCustomerName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [adhocDraft, setAdhocDraft] = useState({ description: '', quantity: '1', unitPrice: '' });
  const [newInvoiceSuccess, setNewInvoiceSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invoiceCurrency, setInvoiceCurrency] = useState<Currency>(settings?.currency || 'JOD');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credit'>('cash');
  /** Credit sales: amount settled now; blank/0 = full آجل. */
  const [creditPaidNow, setCreditPaidNow] = useState('');
  const draftIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  React.useEffect(() => { draftIdRef.current = null; }, [invoiceItems, customerName, supplierName, invoiceType, invoiceCurrency, selectedCustomerId, paymentMethod, creditPaidNow]);

  const resetDraft = () => {
    setCustomerName('');
    setSupplierName('');
    setInvoiceItems([]);
    setSelectedCustomerId('');
    setPaymentMethod('cash');
    setCreditPaidNow('');
    setSourceQuote(null);
  };

  const convertQuote = (quote: TradeOrder) => {
    const { items, missing } = orderToSaleLines(quote, products);
    if (!items.length) {
      toast.error(isRtl ? 'لا يوجد في العرض صنف ما زال موجوداً في المخزون.' : 'None of the quoted items exist in the inventory any more.');
      return;
    }
    if (missing.length) {
      toast.warning(isRtl ? `لم تُنقل أصناف حُذفت من المخزون: ${missing.join('، ')}` : `Items deleted from the inventory were left out: ${missing.join(', ')}`);
    }
    if (resolveVatRate(quote.vatRate) !== resolveVatRate(settings?.defaultVatRate)) {
      toast.warning(isRtl
        ? `الفاتورة تُحسب بضريبة ${resolveVatRate(settings?.defaultVatRate)}% من الإعدادات، والعرض كان بضريبة ${quote.vatRate}%. راجع الإجمالي قبل الحفظ.`
        : `The invoice uses the ${resolveVatRate(settings?.defaultVatRate)}% VAT from Settings; the quotation used ${quote.vatRate}%. Check the total before saving.`, { duration: 8000 });
    }
    setInvoiceType('sale');
    setInvoiceCurrency(quote.currency);
    setCustomerName(quote.customerName || '');
    setSelectedCustomerId(quote.customerId && customers.some((c) => c.id === quote.customerId) ? quote.customerId : '');
    setPaymentMethod('cash');
    setInvoiceItems(items);
    setSourceQuote(quote);
    setView('create');
  };

  const printDocument = (html: string) => {
    printHtmlDocument(html);
  };

  // Dynamic Export Helpers for Accounting Use
  const exportInvoicesToCSV = () => {
    try {
      const headers = isRtl
        ? ['رقم الفاتورة', 'النوع', 'العميل / المورد', 'طريقة الدفع', 'التاريخ', 'المجموع', 'العملة']
        : ['Invoice Number', 'Type', 'Client / Supplier', 'Payment', 'Date', 'Total', 'Currency'];

      const rows = sortedInvoices.map(inv => {
        const typeStr = invoiceTypeLabel(inv.type, isRtl);
        const entityName = inv.customerName || inv.supplierName || (isRtl ? 'زبون نقدي' : 'Walk-in');
        const formattedDate = new Date(inv.date).toLocaleDateString(isRtl ? 'ar' : 'en');
        const code = inv.currency || activeCurrency;

        return [
          inv.invoiceNumber,
          typeStr,
          entityName,
          invoicePaymentLabel(inv, isRtl),
          formattedDate,
          ((isReturnType(inv.type) ? -1 : 1) * (Number(inv.totalAmount) || 0)).toFixed(currencyDecimals(code)),
          code
        ];
      });

      const escapeCsvField = csvCell;

      const csvContent = "\uFEFF" + [
        headers.map(escapeCsvField).join(','),
        ...rows.map(row => row.map(escapeCsvField).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Mostawdaee_Invoices_Export_${new Date().toISOString().slice(0, 10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(isRtl ? 'تم تصدير الفواتير كملف Excel / CSV بنجاح! 📊' : 'Invoices exported as Excel / CSV successfully!');
    } catch (error) {
      console.error(error);
      toast.error(isRtl ? 'فشل تصدير الفواتير' : 'Failed to export invoices');
    }
  };

  const exportInvoicesToPDF = () => {
    try {
      let rowsHtml = '';
      const salesByCurrency = sumInvoicesByCurrency(sortedInvoices, 'sale');
      const returnsByCurrency = sumInvoicesByCurrency(sortedInvoices, 'return');
      for (const [code, amount] of Object.entries(returnsByCurrency)) {
        salesByCurrency[code] = roundMoney((salesByCurrency[code] || 0) - amount, code);
      }
      const purchasesByCurrency = sumInvoicesByCurrency(sortedInvoices, 'purchase');
      for (const [code, amount] of Object.entries(sumInvoicesByCurrency(sortedInvoices, 'purchase_return'))) {
        purchasesByCurrency[code] = roundMoney((purchasesByCurrency[code] || 0) - amount, code);
      }
      const emptyTotal = isRtl ? 'لا يوجد' : 'None';

      sortedInvoices.forEach((inv, idx) => {
        const typeStr = invoiceTypeLabel(inv.type, isRtl);
        const typeColor = inv.type === 'sale' ? 'color: #4f46e5; font-weight: bold;' : inv.type === 'return' ? 'color: #e11d48; font-weight: bold;' : inv.type === 'purchase_return' ? 'color: #d97706; font-weight: bold;' : 'color: #10b981; font-weight: bold;';
        const entityName = inv.customerName || inv.supplierName || (isRtl ? 'زبون نقدي' : 'Walk-in');
        const formattedDate = new Date(inv.date).toLocaleDateString(isRtl ? 'ar' : 'en');

        rowsHtml += `
          <tr style="background-color: ${idx % 2 === 0 ? '#f8fafc' : '#ffffff'};">
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: bold; font-family: monospace;">#${escapeHtml(inv.invoiceNumber)}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; ${typeColor}">${typeStr}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: ${isRtl ? 'right' : 'left'}; font-weight: bold;">${escapeHtml(entityName)}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${escapeHtml(invoicePaymentLabel(inv, isRtl))}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${formattedDate}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace; font-weight: bold;" dir="ltr">${isReturnType(inv.type) ? '−' : ''}${formatCurrency(inv.totalAmount, inv.currency)}</td>
          </tr>
        `;
      });

      const currentDate = new Date().toLocaleString(isRtl ? 'ar-JO' : 'en-US');

      const reportHtml = `
        <html>
        <head>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&family=Inter:wght@400;600;800&display=swap');
            body { 
              font-family: ${isRtl ? "'Cairo', serif" : "'Inter', sans-serif"}; 
              direction: ${isRtl ? 'rtl' : 'ltr'}; 
              padding: 40px; 
              color: #1e293b; 
              background: #fff;
              font-size: 11px;
            }
            .header-container { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px double #e2e8f0; padding-bottom: 20px; }
            .header-left { display: flex; flex-direction: column; }
            .company-name { font-size: 24px; font-weight: 900; color: #0f172a; letter-spacing: -0.5px; }
            .report-title { font-size: 15px; font-weight: 700; color: #4f46e5; margin-top: 5px; }
            .meta-item { margin-top: 4px; color: #64748b; font-size: 10px; font-weight: bold; }
            .summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 30px 0; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; text-align: center; }
            .card-label { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: bold; letter-spacing: 0.5px; }
            .card-value { font-size: 18px; font-weight: 900; color: #0f172a; margin-top: 5px; font-family: monospace; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #0d1221; color: #ffffff; padding: 12px 8px; font-weight: 700; font-size: 10px; text-align: center; }
            tr:nth-child(even) { background-color: #f8fafc; }
            .footer { margin-top: 40px; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 9px; color: #64748b; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div class="header-left">
              <span class="company-name">${settings?.businessName || appName(isRtl)}</span>
              <span class="report-title">${isRtl ? 'كشف الفواتير' : 'Invoice list'}</span>
            </div>
            <div style="text-align: ${isRtl ? 'left' : 'right'};">
              <div class="meta-item">${isRtl ? 'تاريخ التقرير' : 'Report Date'}: ${currentDate}</div>
              ${listCurrency !== 'ALL' ? `<div class="meta-item">${isRtl ? 'العملة' : 'Currency'}: ${listCurrency}</div>` : ''}
            </div>
          </div>

          <div class="summary-cards">
            <div class="card">
              <div class="card-label">${isRtl ? 'صافي المبيعات (بعد المرتجعات)' : 'Net sales (after returns)'}</div>
              <div class="card-value" style="color: #4f46e5; font-size: 14px;">${formatCurrencyTotals(salesByCurrency, emptyTotal)}</div>
            </div>
            <div class="card">
              <div class="card-label">${isRtl ? 'المشتريات' : 'Purchases'}</div>
              <div class="card-value" style="color: #10b981; font-size: 14px;">${formatCurrencyTotals(purchasesByCurrency, emptyTotal)}</div>
            </div>
            <div class="card">
              <div class="card-label">${isRtl ? 'عدد الفواتير' : 'Invoices'}</div>
              <div class="card-value">${sortedInvoices.length}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="border-top-left-radius: 8px; border-bottom-left-radius: 8px;">${isRtl ? 'رقم الفاتورة' : 'Invoice Number'}</th>
                <th>${isRtl ? 'النوع' : 'Type'}</th>
                <th style="text-align: ${isRtl ? 'right' : 'left'};">${isRtl ? 'العميل / المورد' : 'Party'}</th>
                <th>${isRtl ? 'الدفع' : 'Payment'}</th>
                <th>${isRtl ? 'التاريخ' : 'Date'}</th>
                <th style="border-top-right-radius: 8px; border-bottom-right-radius: 8px;">${isRtl ? 'الإجمالي' : 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="footer">
            ${appName(isRtl)}
          </div>
        </body>
        </html>
      `;

      printHtmlDocument(reportHtml);

      toast.success(isRtl ? 'جاهز للطباعة' : 'Ready to print');
    } catch (e) {
      console.error(e);
      toast.error(isRtl ? 'تعذرت طباعة الكشف' : 'Could not print the list');
    }
  };

  const exportSingleInvoiceToPDF = async (inv: Invoice) => {
    try {
      let einvoice: { qrDataUrl: string; number?: string } | undefined;
      if (user && (inv.type === 'sale' || inv.type === 'return')) {
        const sent = (await fetchEInvoiceSubmissions([inv.id]).catch(() => ({} as Record<string, EInvoiceSubmission>)))[inv.id];
        if (sent?.status === 'accepted' && sent.qr) {
          einvoice = { qrDataUrl: await eInvoiceQrDataUrl(sent.qr), number: sent.einv_num || undefined };
        }
      }
      printDocument(buildInvoicePrintHtml({
        einvoice,
        invoice: inv,
        products,
        isRtl,
        businessName: settings?.businessName || appName(isRtl),
        businessAddress: settings?.businessAddress,
        businessPhone: settings?.businessPhone,
        businessEmail: settings?.businessEmail,
        taxRegistrationNumber: settings?.taxRegistrationNumber,
        companyLogoUrl: settings?.companyLogoUrl,
      }));
      toast.success(isRtl ? 'جاهز للطباعة' : 'Ready to print');
    } catch (e) {
      console.error(e);
      toast.error(isRtl ? 'تعذرت الطباعة' : 'Could not print');
    }
  };

  const currentRates = () => buildUsdUnitRates(settings, readCachedLiveRates());

  const creditCustomer = invoiceType === 'sale' && paymentMethod === 'credit'
    ? customers.find((c) => c.id === selectedCustomerId)
    : undefined;
  const debtCurrency = (creditCustomer?.currency || invoiceCurrency) as Currency;
  const debtBasis = creditCustomer && debtCurrency !== invoiceCurrency
    ? conversionBasis(invoiceCurrency, debtCurrency, settings, readCachedLiveRates(), readCachedLiveRatesTimestamp())
    : null;

  /** A product is priced in its own currency; the invoice line must be in the invoice currency. */
  const linePrice = (product: Product, asPack = false): number | null => {
    const pack = asPack ? productPack(product) : null;
    const base = invoiceType === 'sale'
      ? (pack ? pack.price : Number(product.sellingPrice) || 0)
      : (Number(product.unitCost) || 0) * (pack ? pack.size : 1);
    const from = product.currency || settings?.currency || 'JOD';
    if (from === invoiceCurrency) return base;
    return safeConvertMoney(base, from, invoiceCurrency, currentRates());
  };

  /** Sale: this product's lines, with one line set to `qty`, must fit in stock. */
  const fitsStock = (product: Product | undefined, item: InvoiceItem, qty: number) => {
    if (invoiceType !== 'sale') return true;
    if (isAdhocLine(item)) return true;
    if (!product) {
      toast.error(isRtl
        ? `الصنف «${item.description}» لم يعد في المخزون.`
        : `“${item.description}” is no longer in inventory.`);
      return false;
    }
    const available = Number(product.quantity) || 0;
    if (unitsInCart(invoiceItems, product.id, lineKey(item)) + lineUnits({ ...item, quantity: qty }) <= available) return true;
    toast.error(`${t.stock}: ${formatPackStock(available, product, isRtl) ?? available}`);
    return false;
  };

  const changeInvoiceCurrency = (code: Currency) => {
    if (code === invoiceCurrency) return;
    if (invoiceItems.length) {
      const rates = currentRates();
      const next: typeof invoiceItems = [];
      for (const item of invoiceItems) {
        const unitPrice = safeConvertMoney(item.unitPrice, invoiceCurrency, code, rates);
        if (unitPrice === null) {
          toast.error(isRtl
            ? `تعذّر تحويل بنود الفاتورة إلى ${code}. بقيت العملة ${invoiceCurrency}.`
            : `Could not convert invoice lines to ${code}. Kept ${invoiceCurrency}.`);
          return;
        }
        next.push({ ...item, unitPrice, total: roundMoney((Number(item.quantity) || 0) * unitPrice, code) });
      }
      setInvoiceItems(next);
      toast.info(isRtl ? `حُوّلت أسعار البنود إلى ${code}` : `Line prices converted to ${code}`);
    }
    setInvoiceCurrency(code);
  };

  const addItem = (product: Product, asPack = false) => {
    // Check stock for sales
    if (invoiceType === 'sale' && product.quantity <= 0) {
      toast.error(t.outOfStock);
      return;
    }

    const pack = asPack ? productPack(product) : null;
    const key = lineKey({ productId: product.id, packSize: pack?.size });
    const price = linePrice(product, !!pack);
    if (price === null) {
      toast.error(isRtl
        ? `تعذّر تحويل سعر «${product.name}» إلى ${invoiceCurrency}. لم يُضف.`
        : `Could not convert “${product.name}” to ${invoiceCurrency}. Not added.`);
      return;
    }
    const existing = invoiceItems.find(item => lineKey(item) === key);
    
    if (existing) {
      const newQty = (Number(existing.quantity) || 0) + 1;
      if (!fitsStock(product, existing, newQty)) return;
      setInvoiceItems(invoiceItems.map(item => {
        if (lineKey(item) === key) {
          const uPrice = Number(item.unitPrice) || 0;
          return { ...item, quantity: newQty, total: roundMoney(newQty * uPrice, invoiceCurrency) };
        }
        return item;
      }));
    } else {
      const newItem: InvoiceItem = {
        productId: product.id,
        description: product.name,
        quantity: 1,
        unitPrice: price,
        total: price,
        sku: product.sku,
        ...(pack ? { packSize: pack.size, packName: lineAsPack(pack).packName } : {}),
      };
      if (!fitsStock(product, newItem, 1)) return;
      setInvoiceItems([...invoiceItems, newItem]);
    }
  };

  const updateItem = (key: string, quantity: number, unitPrice: number) => {
    const current = invoiceItems.find(item => lineKey(item) === key);
    if (!current) return;
    const product = products.find(p => p.id === current.productId);
    const finalQty = Math.max(1, Number(quantity) || 0);
    const targetPrice = Math.max(0, Number(unitPrice) || 0);
    if (finalQty > (Number(current.quantity) || 0) && !fitsStock(product, current, finalQty)) return;

    setInvoiceItems(invoiceItems.map(item => {
      if (lineKey(item) === key) {
        return { ...item, quantity: finalQty, unitPrice: targetPrice, total: roundMoney(finalQty * targetPrice, invoiceCurrency) };
      }
      return item;
    }));
  };

  /** Switches a line between the single unit and the pack at the product's price for that unit, keeping the count. */
  const toggleItemPack = (key: string) => {
    const item = invoiceItems.find(i => lineKey(i) === key);
    const product = item ? products.find(p => p.id === item.productId) : undefined;
    const pack = product ? productPack(product) : null;
    if (!item || !product || !pack) return;
    const toPack = !isPackLine(item);
    const nextKey = lineKey({ productId: item.productId, packSize: toPack ? pack.size : undefined });
    const other = invoiceItems.find(i => lineKey(i) === nextKey);
    const qty = (Number(item.quantity) || 0) + (Number(other?.quantity) || 0);
    const unitPrice = linePrice(product, toPack);
    const next: InvoiceItem = {
      ...item,
      quantity: qty,
      unitPrice,
      total: roundMoney(qty * unitPrice, invoiceCurrency),
      packSize: toPack ? pack.size : undefined,
      packName: toPack ? lineAsPack(pack).packName : undefined,
    };
    const rest = invoiceItems.filter(i => lineKey(i) !== key && lineKey(i) !== nextKey);
    if (invoiceType === 'sale' && unitsInCart(rest, product.id) + lineUnits(next) > (Number(product.quantity) || 0)) {
      toast.error(`${t.stock}: ${formatPackStock(Number(product.quantity) || 0, product, isRtl) ?? product.quantity}`);
      return;
    }
    const at = Math.min(invoiceItems.findIndex(i => lineKey(i) === key), rest.length);
    setInvoiceItems([...rest.slice(0, at), next, ...rest.slice(at)]);
  };

  const removeItem = (key: string) => {
    setInvoiceItems(invoiceItems.filter(item => lineKey(item) !== key));
  };

  const vatRate = resolveVatRate(settings?.defaultVatRate);
  const draftTotals = computeInvoiceTotals({
    subtotal: invoiceItems.reduce((acc, item) => acc + (Number(item.total) || 0), 0),
    vatRate,
    currency: invoiceCurrency,
  });

  const handleCreateInvoice = async (shouldPrint = false) => {
    if (invoiceItems.length === 0 || submittingRef.current) return;
    if (invoiceType === 'sale' && !customerName.trim()) {
      toast.error(t.clientName);
      return;
    }
    if (invoiceType === 'sale' && paymentMethod === 'credit' && !selectedCustomerId) {
      toast.error(isRtl ? 'البيع الآجل يحتاج عميلاً مسجلاً' : 'Credit sales need a registered customer');
      return;
    }
    if (invoiceType === 'purchase' && !supplierName.trim()) {
      toast.error(isRtl ? 'يرجى إدخال اسم المورد' : 'Supplier name is required');
      return;
    }
    if (debtBasis && !debtBasis.ok) {
      toast.error(isRtl
        ? `لا يوجد سعر صرف حديث من ${invoiceCurrency} إلى ${debtCurrency} لتسجيل الدين. اتصل بالإنترنت لتحديث الأسعار، أو أدخل أسعارك يدوياً من الإعدادات، أو اجعل الفاتورة بعملة العميل.`
        : `No recent ${invoiceCurrency} → ${debtCurrency} rate to record this debt. Go online to refresh rates, set manual rates in Settings, or bill in the customer's currency.`);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    const { subtotal, taxAmount: tax, total: totalAmount } = draftTotals;

    const numberPrefix = invoiceType === 'sale' ? 'SAL' : 'PUR';
    const sessionUid = user?.uid || 'guest';
    const invoiceNo = peekInvoiceNumber(numberPrefix, sessionUid, workspace?.ownerId);
    const chosenCustomer = customers.find((c) => c.id === selectedCustomerId);

    const newInvoice: Invoice = {
      id: (draftIdRef.current ||= crypto.randomUUID()),
      invoiceNumber: invoiceNo,
      customerName: invoiceType === 'sale' ? customerName.trim() : undefined,
      supplierName: invoiceType === 'purchase' ? supplierName.trim() : undefined,
      date: Date.now(),
      items: invoiceItems,
      subtotal,
      taxAmount: tax,
      vatRate,
      totalAmount,
      type: invoiceType,
      currency: invoiceCurrency,
      paymentMethod: invoiceType === 'sale' ? paymentMethod : 'cash',
      customerId: invoiceType === 'sale' && selectedCustomerId ? selectedCustomerId : undefined,
    };
    if (invoiceType === 'sale' && paymentMethod === 'credit' && chosenCustomer) {
      const rawPaid = creditPaidNow.trim() === '' ? 0 : parseFloat(creditPaidNow);
      const paidNow = Number.isFinite(rawPaid) ? Math.max(0, rawPaid) : 0;
      if (paidNow > totalAmount + 1e-9) {
        toast.error(isRtl ? 'المدفوع الآن أكبر من إجمالي الفاتورة' : 'Paid now exceeds the invoice total');
        submittingRef.current = false;
        setIsSubmitting(false);
        return;
      }
      const settled = roundMoney(paidNow, invoiceCurrency);
      const owed = roundMoney(totalAmount - settled, invoiceCurrency);
      if (owed <= 0) {
        // Fully paid at the counter — record as cash (customer stays linked for history).
        newInvoice.paymentMethod = 'cash';
        newInvoice.cashReceived = settled;
      } else {
        newInvoice.paidAmount = settled;
        // The debt is kept in the customer's currency; the provider writes it with the invoice in one transaction.
        const customerCurrency = (chosenCustomer.currency || invoiceCurrency) as Currency;
        newInvoice.debtCurrency = customerCurrency;
        if (customerCurrency === invoiceCurrency) {
          newInvoice.debtAmount = owed;
        } else {
          const debtAmount = safeConvertMoney(owed, invoiceCurrency, customerCurrency, currentRates());
          if (debtAmount === null) {
            toast.error(isRtl
              ? `تعذّر تحويل الدين إلى ${customerCurrency}. لم تُحفظ الفاتورة.`
              : `Could not convert the debt to ${customerCurrency}. Invoice not saved.`);
            submittingRef.current = false;
            setIsSubmitting(false);
            return;
          }
          newInvoice.debtAmount = debtAmount;
        }
      }
    }

    try {
      newInvoice.invoiceNumber = await saveInvoice(newInvoice);
      consumeInvoiceNumber(numberPrefix, sessionUid, workspace?.ownerId);
      draftIdRef.current = null;
      if (sourceQuote && invoiceType === 'sale') {
        const quote = sourceQuote;
        markOrderConverted(quote.id, newInvoice).catch((err: any) => {
          toast.error(err?.message || (isRtl ? `حُفظت الفاتورة، لكن تعذّر ربط عرض السعر ${quote.number} بها.` : `The sale was saved, but quotation ${quote.number} could not be linked to it.`));
        });
      }

      if (shouldPrint) {
        setSelectedInvoice(newInvoice);
        setView('view');
        resetDraft();
        toast.success(isRtl ? 'تم حفظ الفاتورة' : 'Invoice saved');
        setTimeout(() => {
          exportSingleInvoiceToPDF(newInvoice);
        }, 400);
      } else {
        setNewInvoiceSuccess(true);
        setTimeout(() => {
          setNewInvoiceSuccess(false);
          setView('list');
          resetDraft();
        }, 2000);
      }
    } catch (error) {
      console.error(error);
      const msg = String((error as any)?.message || '');
      if (msg.startsWith('Insufficient vault funds')) {
        toast.error(isRtl ? 'رصيد الخزنة بهذه العملة غير كافٍ لدفع فاتورة الشراء. أضف رصيداً للخزنة أو غيّر العملة.' : 'Not enough balance in the vault for this currency to pay this purchase. Deposit funds or change the currency.');
      } else if (!(error as any)?.notified && !msg.startsWith('Insufficient stock')) {
        toast.error(isRtl ? "فشلت عملية حفظ الفاتورة" : "Failed to record invoice");
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const filteredProducts = React.useMemo(() => {
    const q = searchTerm.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, searchTerm]);
  const invoicePage = useProgressiveList(
    sortedInvoices,
    `${invSearchTerm}|${listCurrency}|${listRange}|${listType}|${listPayment}|${sortConfig.key}|${sortConfig.direction}`,
  );
  const productPage = useProgressiveList(filteredProducts, `${searchTerm}|${invoiceType}`);

  const quickSellProducts = React.useMemo(() => {
    if (invoiceType !== 'sale') return [];
    
    const productCounts: Record<string, number> = {};
    invoices.filter(inv => inv.type === 'sale').forEach(inv => {
      inv.items.forEach(item => {
        productCounts[item.productId] = (productCounts[item.productId] || 0) + 1;
      });
    });

    const sortedBySales = products
      .filter(p => p.quantity > 0)
      .sort((a, b) => (productCounts[b.id] || 0) - (productCounts[a.id] || 0));

    return sortedBySales.slice(0, 4);
  }, [invoices, products, invoiceType]);

  return (
    <div className={`space-y-8 px-4 sm:px-0 notranslate ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{t.salesAndPurchases}</h2>
          <p className="text-gray-500 mt-1">{t.officialInvoice}</p>
        </div>
        {view === 'list' ? (
          <button
            onClick={() => {
              if (sourceQuote) resetDraft();
              setView('create');
            }}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20 hover:bg-indigo-700 transition-all premium-button"
          >
            <Plus size={20} />
            {t.newTransaction}
          </button>
        ) : (
          <button
            onClick={() => {
              if (sourceQuote) resetDraft();
              setView('list');
            }}
            className="px-6 py-3 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-2xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
          >
            {t.cancel}
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {view === 'list' && (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {can('back_office') && (
              <div className="inline-flex bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl" role="tablist">
                {([['invoices', isRtl ? 'الفواتير' : 'Invoices'], ['quotes', isRtl ? 'عروض الأسعار' : 'Quotations']] as const).map(([mode, label]) => (
                  <button key={mode} type="button" role="tab" aria-selected={listMode === mode} onClick={() => setListMode(mode)}
                    className={`px-5 py-2 rounded-xl text-sm font-bold transition ${listMode === mode ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-gray-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {listMode === 'quotes' && can('back_office') ? (
              <OrdersPanel kind="quote" isRtl={isRtl} defaultCurrency={activeCurrency as Currency} onConvert={convertQuote} />
            ) : (<>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-3 premium-card">
              <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
                <div className="relative flex-1 w-full">
                  <Search size={18} className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-4' : 'left-4'} text-gray-400`} />
                  <input
                    type="search"
                    placeholder={invoiceSearchPlaceholder}
                    aria-label={invoiceSearchPlaceholder}
                    value={invSearchTerm}
                    onChange={(e) => setInvSearchTerm(e.target.value)}
                    className={`w-full ${isRtl ? 'pr-11 pl-4' : 'pl-11 pr-4'} py-3 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all dark:text-white`}
                  />
                </div>
                <select
                  dir="ltr"
                  value={listCurrency}
                  onChange={(e) => setListCurrency(e.target.value as 'ALL' | Currency)}
                  aria-label={isRtl ? 'العملة' : 'Currency'}
                  className="w-full lg:w-auto px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-xl text-sm font-bold dark:text-white outline-none"
                >
                  <option value="ALL">{isRtl ? 'كل العملات' : 'All currencies'}</option>
                  {POS_CURRENCY_CODES.map((code) => (
                    <option key={code} value={code}>{code} ({CURRENCY_SYMBOLS[code]})</option>
                  ))}
                </select>
                <div className="inline-flex self-stretch lg:self-center bg-gray-100 dark:bg-gray-900 p-1 rounded-xl" role="group" aria-label={isRtl ? 'عرض القائمة' : 'List layout'}>
                  {([
                    ['table', LayoutList, isRtl ? 'جدول' : 'Table'],
                    ['cards', LayoutGrid, isRtl ? 'بطاقات' : 'Cards'],
                  ] as const).map(([mode, Icon, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={listLayout === mode}
                      onClick={() => setLayout(mode)}
                      className={`flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition ${
                        listLayout === mode ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm' : 'text-gray-500'
                      }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {(['date', 'totalAmount'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={sortConfig.key === key}
                      onClick={() => handleSort(key)}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                        sortConfig.key === key
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-100 dark:border-gray-700'
                      }`}
                    >
                      {key === 'date' ? t.date : t.total}{sortConfig.key === key ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={exportInvoicesToCSV}
                    aria-label={isRtl ? 'تصدير Excel' : 'Export Excel'}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-emerald-600/10 text-emerald-600 border border-emerald-500/20 rounded-xl text-xs font-black"
                  >
                    <Download size={14} />
                    <span className="hidden sm:inline">{isRtl ? 'تصدير' : 'Export'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={exportInvoicesToPDF}
                    aria-label={isRtl ? 'طباعة الكشف' : 'Print list'}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-indigo-600/10 text-indigo-600 border border-indigo-500/20 rounded-xl text-xs font-black"
                  >
                    <Printer size={14} />
                    <span className="hidden sm:inline">{isRtl ? 'طباعة' : 'Print'}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2" role="group" aria-label={isRtl ? 'المدة' : 'Period'}>
                {([
                  ['all', isRtl ? 'كل الوقت' : 'All time'],
                  ['today', isRtl ? 'اليوم' : 'Today'],
                  ['yesterday', isRtl ? 'أمس' : 'Yesterday'],
                  ['week', isRtl ? '7 أيام' : '7 days'],
                  ['month', isRtl ? '30 يوماً' : '30 days'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={listRange === value}
                    onClick={() => setListRange(value)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition ${
                      listRange === value
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                        : 'bg-gray-50 dark:bg-gray-900 text-gray-500 border-transparent hover:border-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2" role="group" aria-label={isRtl ? 'النوع' : 'Type'}>
                {([
                  ['all', isRtl ? 'الكل' : 'All'],
                  ['sales', isRtl ? 'مبيعات' : 'Sales'],
                  ['purchases', isRtl ? 'مشتريات' : 'Purchases'],
                  ['returns', isRtl ? 'مرتجعات' : 'Returns'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={listType === value}
                    onClick={() => setListType(value)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition ${
                      listType === value
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-gray-50 dark:bg-gray-900 text-gray-500 border-transparent hover:border-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="w-px h-5 bg-gray-200 dark:bg-gray-700 self-center mx-1" aria-hidden />
                {([
                  ['all', isRtl ? 'كل الدفع' : 'All tender'],
                  ['cash', isRtl ? 'نقدي' : 'Cash'],
                  ['card', isRtl ? 'بطاقة' : 'Card'],
                  ['wallet', isRtl ? 'محفظة' : 'Wallet'],
                  ['credit', isRtl ? 'آجل' : 'Credit'],
                  ['split', isRtl ? 'نقد+آجل' : 'Cash+credit'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={listPayment === value}
                    onClick={() => setListPayment(value)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition ${
                      listPayment === value
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-gray-50 dark:bg-gray-900 text-gray-500 border-transparent hover:border-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearListFilters}
                    className="px-3 py-1.5 rounded-full text-[11px] font-black text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                  >
                    {isRtl ? 'مسح الفلاتر' : 'Clear filters'}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  label: isRtl ? 'النتائج' : 'Results',
                  value: String(listSummary.count),
                  tone: 'text-slate-900 dark:text-white',
                },
                {
                  label: isRtl ? 'صافي المبيعات' : 'Net sales',
                  value: formatCurrencyTotals(listSummary.netSalesByCurrency, isRtl ? '—' : '—'),
                  tone: 'text-indigo-600',
                },
                {
                  label: isRtl ? 'المشتريات' : 'Purchases',
                  value: formatCurrencyTotals(listSummary.purchasesByCurrency, isRtl ? '—' : '—'),
                  tone: 'text-emerald-600',
                },
                {
                  label: isRtl ? 'آجل مفتوح (من النتائج)' : 'Open credit (in results)',
                  value: formatCurrencyTotals(listSummary.openCreditByCurrency, isRtl ? '—' : '—'),
                  tone: 'text-amber-700 dark:text-amber-400',
                },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
                  <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">{card.label}</div>
                  <div className={`mt-1 text-sm font-black font-mono break-words ${card.tone}`} dir="ltr">{card.value}</div>
                </div>
              ))}
            </div>

            {sortedInvoices.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 px-6 py-16 text-center">
                <FileText className="mx-auto text-gray-300 mb-3" size={36} />
                <p className="text-base font-bold text-gray-700 dark:text-gray-200">
                  {invoices.length === 0
                    ? (isRtl ? 'لا فواتير بعد.' : 'No invoices yet.')
                    : (isRtl ? 'لا نتائج تطابق الفلاتر الحالية.' : 'No invoices match the current filters.')}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {invoices.length === 0
                    ? (isRtl ? 'أنشئ فاتورة أو أكمل بيعاً من نقطة البيع.' : 'Create an invoice or complete a POS sale.')
                    : (isRtl ? 'جرّب مسح الفلاتر أو توسيع المدة.' : 'Clear filters or widen the date range.')}
                </p>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearListFilters}
                    className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold"
                  >
                    {isRtl ? 'مسح الفلاتر' : 'Clear filters'}
                  </button>
                )}
              </div>
            ) : listLayout === 'table' ? (
              <div className="overflow-x-auto rounded-3xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-700">
                      <th className={`py-3 px-4 font-black ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'الوقت' : 'When'}</th>
                      <th className={`py-3 px-4 font-black ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'الرقم' : '#'}</th>
                      <th className={`py-3 px-4 font-black ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'النوع' : 'Type'}</th>
                      <th className={`py-3 px-4 font-black ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'الطرف' : 'Party'}</th>
                      <th className={`py-3 px-4 font-black ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'الدفع' : 'Payment'}</th>
                      <th className={`py-3 px-4 font-black ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجمالي' : 'Total'}</th>
                      <th className="py-3 px-4 font-black text-center">{isRtl ? 'إجراء' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700/80">
                    {invoicePage.visible.map((inv) => {
                      const hint = tenderHint(inv);
                      return (
                        <tr
                          key={inv.id}
                          className="hover:bg-gray-50/80 dark:hover:bg-white/[0.03] cursor-pointer"
                          onClick={() => openInvoiceRow(inv)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openInvoiceRow(inv);
                            }
                          }}
                          tabIndex={0}
                          role="link"
                          aria-label={`${invoiceTypeLabel(inv.type, isRtl)} ${inv.invoiceNumber}`}
                        >
                          <td className="py-3 px-4 font-mono text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatInvoiceWhen(Number(inv.date))}</td>
                          <td className="py-3 px-4 font-mono font-bold text-indigo-600" dir="ltr">#{inv.invoiceNumber}</td>
                          <td className={`py-3 px-4 text-xs font-black ${typeTone(inv.type).text}`}>{invoiceTypeLabel(inv.type, isRtl)}</td>
                          <td className="py-3 px-4 font-bold text-gray-900 dark:text-gray-100 max-w-[12rem] truncate" dir="auto">{partyName(inv)}</td>
                          <td className="py-3 px-4">
                            <div className="text-xs font-bold text-gray-700 dark:text-gray-200">{invoicePaymentLabel(inv, isRtl)} · {inv.currency}</div>
                            {hint && <div className="text-[10px] text-amber-700 dark:text-amber-400 font-bold mt-0.5" dir="ltr">{hint}</div>}
                          </td>
                          <td className={`py-3 px-4 font-mono font-black ${typeTone(inv.type).text} ${isRtl ? 'text-left' : 'text-right'}`} dir="ltr">
                            {isReturnType(inv.type) ? '−' : ''}{formatCurrency(inv.totalAmount, inv.currency)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); exportSingleInvoiceToPDF(inv); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-700 text-[10px] font-black text-slate-600 dark:text-slate-200"
                              aria-label={isRtl ? 'طباعة' : 'Print'}
                            >
                              <Printer size={12} />
                              {isRtl ? 'طباعة' : 'Print'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {invoicePage.visible.map((inv) => {
                  const hint = tenderHint(inv);
                  return (
                    <div
                      key={inv.id}
                      role="link"
                      tabIndex={0}
                      onClick={() => openInvoiceRow(inv)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openInvoiceRow(inv);
                        }
                      }}
                      className={`text-start bg-white dark:bg-gray-800 p-6 rounded-3xl border ${typeTone(inv.type).border} shadow-sm premium-card group relative overflow-hidden cursor-pointer`}
                    >
                      <div className={`absolute top-0 ${isRtl ? 'left-0' : 'right-0'} w-1.5 h-full ${typeTone(inv.type).bar}`} />
                      <div className="flex items-center justify-between mb-4 gap-3">
                        <div className={`w-12 h-12 ${typeTone(inv.type).iconBg} dark:bg-gray-700 rounded-2xl flex items-center justify-center ${typeTone(inv.type).text}`}>
                          {isReturnType(inv.type) ? <Undo2 size={24} /> : <FileText size={24} />}
                        </div>
                        <div className={isRtl ? 'text-left' : 'text-right'}>
                          <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{invoiceTypeLabel(inv.type, isRtl)}</div>
                          <div className="text-xs font-bold text-gray-500 font-mono" dir="ltr">#{inv.invoiceNumber}</div>
                          <div className="text-sm font-mono text-gray-600 dark:text-gray-400">{formatInvoiceWhen(Number(inv.date))}</div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate" dir="auto">{partyName(inv)}</h3>
                          <p className="text-[11px] text-gray-400 font-bold mt-1">{invoicePaymentLabel(inv, isRtl)} · {inv.currency}</p>
                          {hint && <p className="text-[10px] text-amber-700 dark:text-amber-400 font-bold mt-1" dir="ltr">{hint}</p>}
                        </div>
                        <div className="flex items-center justify-between pt-4 border-t border-gray-50 dark:border-gray-700">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); exportSingleInvoiceToPDF(inv); }}
                            className="py-1.5 px-3 rounded-xl bg-slate-50 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600/50 transition-colors cursor-pointer inline-flex items-center gap-1.5 text-[10px] font-black"
                            aria-label={isRtl ? 'طباعة' : 'Print'}
                          >
                            <Printer size={11} />
                            <span>{isRtl ? 'طباعة' : 'Print'}</span>
                          </button>
                          <span className={`text-xl font-black ${typeTone(inv.type).text} font-mono`} dir="ltr">
                            {isReturnType(inv.type) ? '−' : ''}{formatCurrency(inv.totalAmount, inv.currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {sortedInvoices.length > 0 && (
              <ShowMoreBar isRtl={isRtl} shown={invoicePage.shown} total={invoicePage.total} pageSize={invoicePage.pageSize} onMore={invoicePage.showMore} onAll={invoicePage.showAll} className="mt-4" />
            )}
            </>)}
        </motion.div>
      )}

        {view === 'create' && (
          <motion.div
            key="create"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-xl overflow-hidden premium-card"
          >
            {sourceQuote && !newInvoiceSuccess && (
              <div className="px-8 py-3 bg-violet-50 dark:bg-violet-950/30 border-b border-violet-100 dark:border-violet-900/40 text-sm font-bold text-violet-700 dark:text-violet-300">
                {isRtl ? `فاتورة بيع من عرض السعر ${sourceQuote.number} — المخزون يُفحص عند الحفظ` : `Sale from quotation ${sourceQuote.number} — stock is checked on save`}
              </div>
            )}
            {newInvoiceSuccess ? (
              <div className="p-20 text-center flex flex-col items-center gap-4">
                <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={48} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{t.transactionSuccess}</h3>
              </div>
            ) : (
              <div className="flex flex-col h-full lg:flex-row">
                {/* Left: Product Picker */}
                <div className="p-8 border-r border-gray-100 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/30 w-full lg:w-[40%]">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-black text-gray-900 dark:text-white">{t.inventory}</h3>
                    <div className="flex bg-gray-100 dark:bg-gray-800 p-1.5 rounded-2xl">
                      <button
                        onClick={() => { setInvoiceType('sale'); setInvoiceItems([]); }}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${invoiceType === 'sale' ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        {t.sale}
                      </button>
                      {can('back_office') && <button
                        onClick={() => { setInvoiceType('purchase'); setInvoiceItems([]); setPaymentMethod('cash'); setSelectedCustomerId(''); }}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${invoiceType === 'purchase' ? 'bg-white dark:bg-gray-700 text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        {t.purchase}
                      </button>}
                    </div>
                  </div>

                  {quickSellProducts.length > 0 && (
                    <div className="mb-6 space-y-3">
                      <div className="flex items-center gap-2 text-gray-500 mb-2 px-1">
                        <TrendingUp size={14} />
                        <span className="text-[10px] font-black uppercase tracking-widest">{t.frequentItems}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {quickSellProducts.map(p => (
                          <button
                            key={`quick-${p.id}`}
                            onClick={() => addItem(p)}
                            className="p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-2xl text-right hover:border-indigo-400 transition-all group"
                          >
                            <div className="font-bold text-xs text-indigo-900 dark:text-indigo-100 truncate group-hover:text-indigo-600 transition-colors">{p.name}</div>
                            <div className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">{formatCurrency(p.sellingPrice, p.currency)}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="relative mb-6">
                    <Search className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-gray-400`} size={18} />
                    <input 
                      type="text"
                      placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pr-12 pl-12 py-3.5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white font-medium"
                    />
                  </div>
                  <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
                    {productPage.visible.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addItem(p)}
                        className={`w-full p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl flex items-center justify-between hover:border-indigo-600 dark:hover:border-indigo-500 group transition-all text-right ${invoiceType === 'sale' && p.quantity <= 0 ? 'opacity-50 grayscale' : ''}`}
                      >
                        <PlusCircle size={20} className="text-gray-300 dark:text-gray-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                        <div>
                          <div className="font-bold text-gray-900 dark:text-white">{p.name}</div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] bg-gray-50 dark:bg-gray-900 px-2 py-0.5 rounded-lg text-gray-500 font-mono">{isRtl ? 'المتوفر' : 'Stock'}: {formatPackStock(p.quantity, p, isRtl) ?? p.quantity}</span>
                            <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 font-mono">{formatCurrency(invoiceType === 'sale' ? p.sellingPrice : p.unitCost, p.currency)}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                    <ShowMoreBar isRtl={isRtl} shown={productPage.shown} total={productPage.total} pageSize={productPage.pageSize} onMore={productPage.showMore} onAll={productPage.showAll} />
                  </div>
                </div>

                {/* Right: Invoice Builder */}
                <div className="p-8 space-y-6 flex-1 bg-white dark:bg-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-widest">{t.billingDetails}</h3>
                    <div className="px-4 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest">
                      {invoiceType === 'sale' ? t.newSale : t.newPurchase}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-gray-400 uppercase flex items-center gap-1.5">
                          <User size={12} />
                          {invoiceType === 'sale' ? t.clientName : t.customerSupplier}
                        </label>
                        {invoiceType === 'sale' ? (
                          <>
                            <select
                              value={selectedCustomerId}
                              onChange={(e) => {
                                const id = e.target.value;
                                setSelectedCustomerId(id);
                                const found = customers.find((c) => c.id === id);
                                if (found) {
                                  setCustomerName(found.name);
                                } else {
                                  setCustomerName('');
                                  if (paymentMethod === 'credit') setPaymentMethod('cash');
                                }
                              }}
                              className="w-full px-4 py-3.5 bg-gray-50 dark:bg-gray-900 border border-transparent dark:border-gray-700 rounded-2xl focus:bg-white dark:focus:bg-gray-800 focus:border-indigo-500 outline-none font-bold dark:text-white"
                            >
                              <option value="">{isRtl ? 'زبون عابر (اكتب الاسم)' : 'Walk-in (type a name)'}</option>
                              {customers.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>
                              ))}
                            </select>
                            {!selectedCustomerId && (
                              <input
                                type="text"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder={t.placeholderUserName} aria-label={t.placeholderUserName}
                                className="w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-900 border border-transparent dark:border-gray-700 rounded-2xl focus:bg-white dark:focus:bg-gray-800 focus:border-indigo-500 outline-none font-bold dark:text-white"
                              />
                            )}
                          </>
                        ) : (
                          <input
                            type="text"
                            value={supplierName}
                            onChange={(e) => setSupplierName(e.target.value)}
                            placeholder={t.placeholderBusinessName} aria-label={t.placeholderBusinessName}
                            className="w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-900 border border-transparent dark:border-gray-700 rounded-2xl focus:bg-white dark:focus:bg-gray-800 focus:border-indigo-500 outline-none font-bold dark:text-white"
                          />
                        )}
                      </div>
                    </div>
                    <CurrencyPicker
                      value={invoiceCurrency}
                      onChange={(code) => changeInvoiceCurrency(code as Currency)}
                      isRtl={isRtl}
                      label={isRtl ? 'عملة الفاتورة' : 'Invoice currency'}
                    />

                    {invoiceType === 'sale' && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-gray-400 uppercase">{isRtl ? 'طريقة الدفع' : 'Payment'}</label>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            ['cash', isRtl ? 'نقدي' : 'Cash'],
                            ['card', isRtl ? 'بطاقة' : 'Card'],
                            ['credit', isRtl ? 'آجل' : 'Credit'],
                          ] as const).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              disabled={value === 'credit' && !selectedCustomerId}
                              onClick={() => setPaymentMethod(value)}
                              className={`py-3 rounded-2xl text-xs font-black border transition-all ${
                                paymentMethod === value
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-gray-50 dark:bg-gray-900 text-gray-500 border-transparent disabled:opacity-40'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {paymentMethod === 'card' && (
                          <p className="text-[11px] font-bold leading-snug text-gray-500 dark:text-gray-400">
                            {isRtl
                              ? 'البطاقة تُسجَّل كمبيعات فقط؛ المبلغ لا يدخل الخزنة (يُحصَّل عبر الجهاز البنكي).'
                              : 'Card is recorded as a sale only; it does not enter the vault (settled on the bank terminal).'}
                          </p>
                        )}
                        {paymentMethod === 'credit' && (
                          <div className="space-y-1 pt-1">
                            <label className="text-[10px] font-black text-gray-400 uppercase">
                              {isRtl ? 'المدفوع الآن للخزنة (الباقي آجل)' : 'Paid now to the vault (remainder on account)'}
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={creditPaidNow}
                              onChange={(e) => setCreditPaidNow(e.target.value)}
                              placeholder="0"
                              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-transparent dark:border-gray-700 rounded-2xl focus:bg-white dark:focus:bg-gray-800 focus:border-indigo-500 outline-none font-mono font-bold dark:text-white"
                            />
                            {(() => {
                              const raw = creditPaidNow.trim() === '' ? 0 : parseFloat(creditPaidNow);
                              const paid = Number.isFinite(raw) ? Math.max(0, Math.min(raw, draftTotals.total)) : 0;
                              const owed = Math.max(0, draftTotals.total - paid);
                              return (
                                <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                                  {isRtl ? 'إلى الخزنة الآن' : 'To vault now'}{' '}
                                  <span className="font-mono" dir="ltr">{formatMoney(paid, invoiceCurrency, 'en-US')}</span>
                                  {' · '}
                                  {isRtl ? 'دين' : 'On account'}{' '}
                                  <span className="font-mono" dir="ltr">{formatMoney(owed, invoiceCurrency, 'en-US')}</span>
                                </p>
                              );
                            })()}
                          </div>
                        )}
                        {debtBasis && (
                          <p className={`text-[11px] font-bold leading-relaxed ${debtBasis.ok ? 'text-gray-500 dark:text-gray-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {debtBasis.ok ? (
                              <>
                                {isRtl ? 'يُسجَّل الدين بعملة العميل: ' : 'Debt is recorded in the customer\'s currency: '}
                                <span dir="ltr" className="font-mono">
                                  {(() => {
                                    const raw = creditPaidNow.trim() === '' ? 0 : parseFloat(creditPaidNow);
                                    const paid = Number.isFinite(raw) ? Math.max(0, Math.min(raw, draftTotals.total)) : 0;
                                    const owed = Math.max(0, draftTotals.total - paid);
                                    const shown = safeConvertMoney(owed, invoiceCurrency, debtCurrency, currentRates());
                                    return shown === null ? '—' : formatMoney(shown, debtCurrency, 'en-US');
                                  })()}
                                  {` · 1 ${invoiceCurrency} = ${Number(debtBasis.rate.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${debtCurrency}`}
                                </span>
                                {' · '}
                                {debtBasis.manual
                                  ? (isRtl ? 'سعرك اليدوي' : 'your manual rate')
                                  : `${isRtl ? 'سعر محدَّث' : 'rate as of'} ${new Date(debtBasis.liveAt!).toLocaleString(isRtl ? 'ar' : 'en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                              </>
                            ) : (
                              isRtl
                                ? `لا يوجد سعر صرف حديث من ${invoiceCurrency} إلى ${debtCurrency}. اتصل بالإنترنت أو أدخل أسعارك يدوياً من الإعدادات، أو اجعل الفاتورة بعملة العميل.`
                                : `No recent ${invoiceCurrency} → ${debtCurrency} rate. Go online, set manual rates in Settings, or bill in the customer's currency.`
                            )}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="bg-gray-50/50 dark:bg-gray-900/50 p-6 rounded-[2.5rem] space-y-4 min-h-[400px] border-2 border-dashed border-gray-100 dark:border-gray-700 overflow-y-auto">
                      {invoiceType === 'sale' && (
                        <div className="rounded-2xl border border-cyan-200/70 dark:border-cyan-500/20 bg-cyan-50/40 dark:bg-cyan-500/5 p-3 space-y-2">
                          <p className="text-[11px] font-black text-cyan-800 dark:text-cyan-300">
                            {isRtl ? 'بند حر / خدمة (بدون مخزون)' : 'Free item / service (no stock)'}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_0.5fr_0.7fr_auto] gap-2">
                            <input
                              type="text"
                              value={adhocDraft.description}
                              onChange={(e) => setAdhocDraft((d) => ({ ...d, description: e.target.value }))}
                              placeholder={isRtl ? 'الوصف' : 'Description'}
                              className="px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-cyan-100 dark:border-white/10 text-xs font-bold outline-none focus:border-cyan-500"
                            />
                            <input
                              type="number"
                              min="0.001"
                              step="any"
                              value={adhocDraft.quantity}
                              onChange={(e) => setAdhocDraft((d) => ({ ...d, quantity: e.target.value }))}
                              placeholder={isRtl ? 'كمية' : 'Qty'}
                              className="px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-cyan-100 dark:border-white/10 text-xs font-bold tabular-nums outline-none focus:border-cyan-500"
                            />
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={adhocDraft.unitPrice}
                              onChange={(e) => setAdhocDraft((d) => ({ ...d, unitPrice: e.target.value }))}
                              placeholder={isRtl ? 'السعر' : 'Price'}
                              className="px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-cyan-100 dark:border-white/10 text-xs font-bold tabular-nums outline-none focus:border-cyan-500"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const checked = validateAdhocDraft(adhocDraft);
                                if (!checked.ok) {
                                  toast.error(isRtl ? 'أكمل الوصف والكمية والسعر.' : 'Fill description, quantity and price.');
                                  return;
                                }
                                setInvoiceItems((prev) => [
                                  ...prev,
                                  buildAdhocInvoiceItem({
                                    description: checked.description,
                                    quantity: checked.quantity,
                                    unitPrice: checked.unitPrice,
                                    currency: invoiceCurrency,
                                  }),
                                ]);
                                setAdhocDraft({ description: '', quantity: '1', unitPrice: '' });
                              }}
                              className="px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-black cursor-pointer"
                            >
                              {isRtl ? 'إضافة' : 'Add'}
                            </button>
                          </div>
                        </div>
                      )}
                      {invoiceItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4 mt-20 opacity-40">
                          <PlusCircle size={48} strokeWidth={1} />
                          <p className="font-bold text-sm tracking-widest uppercase">{t.searchPlaceholder}</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {invoiceItems.map(item => {
                            const key = lineKey(item);
                            const free = isAdhocLine(item);
                            const origin = free ? undefined : products.find(p => p.id === item.productId);
                            const pack = origin ? productPack(origin) : null;
                            const unitName = origin?.unitName?.trim() || (isRtl ? 'وحدة' : 'unit');
                            const packName = pack?.name || (isRtl ? 'عبوة' : 'pack');
                            return (
                            <div key={key} className="flex items-center justify-between bg-white dark:bg-gray-800 p-5 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 group hover:shadow-md transition-all">
                              <button onClick={() => removeItem(key)} className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 p-2 rounded-xl transition-colors" aria-label={isRtl ? 'حذف' : 'Delete'}>
                                <Trash2 size={18} />
                              </button>
                              
                              <div className="flex-1 flex flex-col items-center gap-2">
                                <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-900 px-3 py-1 rounded-xl">
                                  <button onClick={() => updateItem(key, item.quantity - 1, item.unitPrice)} className="text-gray-400 hover:text-indigo-600 font-black text-lg">-</button>
                                  <span className="font-mono font-black text-gray-900 dark:text-white w-8 text-center">{item.quantity}</span>
                                  <button onClick={() => updateItem(key, item.quantity + 1, item.unitPrice)} className="text-gray-400 hover:text-indigo-600 font-black text-lg">+</button>
                                </div>
                                {pack && (
                                  <span className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-[10px] font-black" role="group" aria-label={isRtl ? 'بالوحدة أو بالعبوة' : 'By unit or pack'}>
                                    {[false, true].map((asPack) => {
                                      const active = isPackLine(item) === asPack;
                                      return (
                                        <button
                                          key={String(asPack)}
                                          type="button"
                                          aria-pressed={active}
                                          onClick={() => { if (!active) toggleItemPack(key); }}
                                          className={`px-2 py-0.5 ${active ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                        >
                                          {asPack ? `${packName} (${pack.size})` : unitName}
                                        </button>
                                      );
                                    })}
                                  </span>
                                )}
                                <div className="flex items-center gap-1 font-mono text-[10px] font-black text-gray-400">
                                  <span>{CURRENCY_SYMBOLS[invoiceCurrency] || invoiceCurrency}</span>
                                  <input 
                                    type="number" 
                                    min={0}
                                    step="any"
                                    value={item.unitPrice} 
                                    onChange={(e) => updateItem(key, item.quantity, parseFloat(e.target.value) || 0)}
                                    className="w-16 bg-transparent outline-none text-center focus:text-indigo-600"
                                    aria-label={isPackLine(item) ? (isRtl ? `سعر ${packName}` : `${packName} price`) : (isRtl ? 'سعر الوحدة' : 'Unit price')}
                                  />
                                </div>
                              </div>

                              <div className="text-right flex-1 pr-4">
                                <div className="font-black text-gray-900 dark:text-gray-100 leading-tight">
                                  {item.description}
                                  {free && (
                                    <span className="ms-1.5 inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-black bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                                      {isRtl ? 'حر' : 'Free'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 mt-1 font-mono">{formatCurrency(item.total, invoiceCurrency)}</div>
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 pt-6 px-4">
                      <div className="flex justify-between text-xs font-black text-gray-400 uppercase tracking-widest">
                        <span className="font-mono">{formatCurrency(draftTotals.taxAmount, invoiceCurrency)}</span>
                        <span>{t.tax} ({vatRate}%)</span>
                      </div>
                      <div className="flex justify-between text-2xl font-black text-indigo-600 dark:text-indigo-400 pt-3 border-t-2 border-gray-50 dark:border-gray-700">
                        <span className="font-mono">{formatCurrency(draftTotals.total, invoiceCurrency)}</span>
                        <span className="uppercase tracking-tighter">{t.total}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 pt-4">
                      {/* Save without printing button */}
                      <button
                        type="button"
                        disabled={isSubmitting || invoiceItems.length === 0 || (invoiceType === 'sale' ? !customerName.trim() || (paymentMethod === 'credit' && !selectedCustomerId) : !supplierName.trim())}
                        onClick={() => handleCreateInvoice(false)}
                        className="flex-1 py-4 px-6 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-2xl font-bold text-sm shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isSubmitting ? (
                          <svg className="animate-spin h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <FileText size={18} />
                        )}
                        <span>{isRtl ? "حفظ بدون طباعة" : "Save without Printing"}</span>
                      </button>

                      {/* Save and print button */}
                      <button
                        type="button"
                        disabled={isSubmitting || invoiceItems.length === 0 || (invoiceType === 'sale' ? !customerName.trim() || (paymentMethod === 'credit' && !selectedCustomerId) : !supplierName.trim())}
                        onClick={() => handleCreateInvoice(true)}
                        className={`flex-1 py-4 px-6 ${
                          invoiceType === 'sale' 
                            ? 'bg-indigo-600 shadow-indigo-100 dark:shadow-indigo-900/30 hover:bg-indigo-700' 
                            : 'bg-emerald-600 shadow-emerald-100 dark:shadow-emerald-900/30 hover:bg-emerald-700'
                        } text-white rounded-2xl font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 cursor-pointer`}
                      >
                        {isSubmitting ? (
                          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <Printer size={18} />
                        )}
                        <span>{isRtl ? "حفظ وطباعة الفاتورة" : "Save & Print Invoice"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {view === 'view' && selectedInvoice && (
          <motion.div
            key="view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-8 w-full"
          >
            <div className="flex flex-wrap gap-3 w-full justify-end px-4 no-print">
              <button
                onClick={() => {
                  setView('list');
                  setSelectedInvoice(null);
                }}
                className="flex items-center gap-2 px-5 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl font-bold transition-all active:scale-95 cursor-pointer no-print"
              >
                {isRtl ? 'العودة للسجل' : 'Back to List'}
              </button>
              <button
                onClick={() => {
                  const party = selectedInvoice.customerName || selectedInvoice.supplierName || '';
                  const amount = formatCurrency(selectedInvoice.totalAmount, selectedInvoice.currency);
                  const text = isRtl
                    ? `فاتورة ${selectedInvoice.invoiceNumber}${party ? ` — ${party}` : ''} — ${amount}`
                    : `Invoice ${selectedInvoice.invoiceNumber}${party ? ` — ${party}` : ''} — ${amount}`;
                  if (navigator.share) {
                    navigator.share({ title: selectedInvoice.invoiceNumber, text });
                  } else {
                    navigator.clipboard?.writeText(text);
                    toast.success(isRtl ? 'تم نسخ ملخص الفاتورة' : 'Invoice summary copied');
                  }
                }}
                className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-700 rounded-2xl font-bold shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-all active:scale-95 cursor-pointer no-print"
              >
                <Share2 size={20} />
                {t.shareInvoice}
              </button>
              <button
                onClick={() => exportSingleInvoiceToPDF(selectedInvoice)}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 dark:shadow-indigo-900/30 hover:bg-indigo-700 transition-all active:scale-95 cursor-pointer no-print"
              >
                <Printer size={20} />
                {isRtl ? 'طباعة' : 'Print'}
              </button>
              {can('reverse_invoice') && selectedInvoice.type === 'sale' && canReturn(selectedInvoice) && (
                <button
                  type="button"
                  onClick={() => setReturnOpen(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-rose-600 text-white rounded-2xl font-bold shadow-lg shadow-rose-100 dark:shadow-rose-900/30 hover:bg-rose-700 transition-all active:scale-95 cursor-pointer no-print"
                >
                  <Undo2 size={20} />
                  {isRtl ? 'مرتجع' : 'Return'}
                </button>
              )}
              {can('back_office') && selectedInvoice.type === 'purchase' && canReturnPurchase(selectedInvoice) && (
                <button
                  type="button"
                  onClick={() => setReturnOpen(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-2xl font-bold shadow-lg shadow-amber-100 dark:shadow-amber-900/30 hover:bg-amber-700 transition-all active:scale-95 cursor-pointer no-print"
                >
                  <Undo2 size={20} />
                  {isRtl ? 'مرتجع للمورد' : 'Return to supplier'}
                </button>
              )}
              {((can('reverse_invoice') && selectedInvoice.type === 'return') || (can('back_office') && selectedInvoice.type === 'purchase_return')) && (
                <button
                  type="button"
                  disabled={deletingReturn}
                  onClick={() => handleDeleteReturn(selectedInvoice)}
                  className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 text-rose-600 border border-rose-200 dark:border-rose-900/50 rounded-2xl font-bold hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all active:scale-95 cursor-pointer disabled:opacity-50 no-print"
                >
                  <Trash2 size={20} />
                  {deletingReturn ? (isRtl ? 'جارٍ الحذف...' : 'Deleting...') : (isRtl ? 'حذف المرتجع' : 'Delete return')}
                </button>
              )}
            </div>

            {returnOpen && (selectedInvoice.type === 'sale' || selectedInvoice.type === 'purchase') && (
              <ReturnModal
                original={selectedInvoice}
                isRtl={isRtl}
                onClose={() => setReturnOpen(false)}
                onSaved={(saved) => {
                  setReturnOpen(false);
                  toast.success(saved.type === 'purchase_return'
                    ? (isRtl ? `سُجّل مرتجع المشتريات #${saved.invoiceNumber}` : `Purchase return #${saved.invoiceNumber} recorded`)
                    : (isRtl ? `سُجّل المرتجع #${saved.invoiceNumber}` : `Return #${saved.invoiceNumber} recorded`));
                  setSelectedInvoice(saved);
                }}
              />
            )}

            {isReturnType(selectedInvoice.type) && (
              <div className="w-full max-w-3xl rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/20 p-4 text-sm space-y-1 no-print">
                {selectedInvoice.returnOf && (
                  <p>
                    {isRtl ? 'مرتجع عن الفاتورة' : 'Return for invoice'}{' '}
                    <button type="button" onClick={() => openInvoice(selectedInvoice.returnOf!)} className="font-mono font-bold text-indigo-600 hover:underline" dir="ltr">
                      #{selectedInvoice.returnOfNumber || selectedInvoice.returnOf}
                    </button>
                  </p>
                )}
                {selectedInvoice.refund && (
                  <p className="text-slate-600 dark:text-slate-300">
                    {[
                      selectedInvoice.refund.debt > 0 && `${selectedInvoice.type === 'purchase_return' ? (isRtl ? 'خُصم من رصيد المورد' : 'Taken off the supplier balance') : (isRtl ? 'خُصم من دين العميل' : 'Taken off the debt')} ${formatMoney(selectedInvoice.refund.debt, selectedInvoice.refund.debtCurrency || selectedInvoice.currency)}`,
                      selectedInvoice.refund.vault > 0 && `${selectedInvoice.type === 'purchase_return' ? (isRtl ? 'ردّه المورد نقداً إلى الخزنة' : 'Paid back by the supplier into the vault') : (isRtl ? 'رُدّ نقداً من الخزنة' : 'Cash refund from the vault')} ${formatMoney(selectedInvoice.refund.vault, selectedInvoice.refund.vaultCurrency)}`,
                      selectedInvoice.refund.external > 0 && `${selectedInvoice.type === 'purchase_return' ? (isRtl ? 'يُسوّى مع المورد خارج التطبيق' : 'Settled with the supplier outside the app') : (isRtl ? 'يُردّ بالبطاقة/المحفظة خارج التطبيق' : 'Refunded by card/wallet outside the app')} ${formatMoney(selectedInvoice.refund.external, selectedInvoice.currency)}`,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            )}

            {relatedReturns.length > 0 && (
              <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm no-print">
                <p className="font-bold text-slate-700 dark:text-slate-200 mb-2">{isRtl ? 'مرتجعات هذه الفاتورة' : 'Returns of this invoice'}</p>
                <div className="flex flex-wrap gap-2">
                  {relatedReturns.map((ret) => (
                    <button key={ret.id} type="button" onClick={() => setSelectedInvoice(ret)}
                      className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 font-bold text-xs hover:bg-rose-100">
                      <span className="font-mono" dir="ltr">#{ret.invoiceNumber}</span> · <span dir="ltr">{formatMoney(ret.totalAmount, ret.currency)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <EInvoicePanel invoice={selectedInvoice} isRtl={isRtl} />

            <div
              id="invoice-capture"
              ref={printRef}
              className="w-full max-w-3xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xl p-8 sm:p-12 rounded-[2rem] border border-slate-200 dark:border-slate-800"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              <div className="flex flex-col sm:flex-row justify-between gap-6 pb-6 mb-6 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-start gap-3">
                  {settings?.companyLogoUrl ? (
                    <div className="w-14 h-14 bg-white rounded-xl border border-slate-200 p-1 flex items-center justify-center shrink-0">
                      <img src={settings.companyLogoUrl} alt="" className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
                      <Building size={22} />
                    </div>
                  )}
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                      {settings?.businessName || appName(isRtl)}
                    </h2>
                    <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                      {settings?.businessAddress && <p>{settings.businessAddress}</p>}
                      {settings?.businessPhone && <p className="font-mono">{settings.businessPhone}</p>}
                      {settings?.businessEmail && <p>{settings.businessEmail}</p>}
                      {settings?.taxRegistrationNumber && (
                        <p>{isRtl ? 'الرقم الضريبي' : 'Tax No.'}: <span className="font-mono">{settings.taxRegistrationNumber}</span></p>
                      )}
                    </div>
                  </div>
                </div>
                <div className={`${isRtl ? 'text-left' : 'text-right'}`}>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {invoiceDocumentTitle(selectedInvoice, isRtl, !!settings?.taxRegistrationNumber)}
                  </p>
                  <p className="font-mono font-bold text-indigo-600 dark:text-indigo-400 mt-1">#{selectedInvoice.invoiceNumber}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm mb-8">
                <div>
                  <p className="text-[11px] text-slate-400 font-bold">{isRtl ? 'التاريخ' : 'Date'}</p>
                  <p className="font-semibold">
                    {new Date(selectedInvoice.date).toLocaleString(isRtl ? 'ar' : 'en', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 font-bold">{selectedInvoice.type === 'purchase' ? (isRtl ? 'من' : 'From') : (isRtl ? 'إلى' : 'Bill to')}</p>
                  <p className="font-semibold">{(selectedInvoice.type === 'purchase_return' ? selectedInvoice.supplierName : selectedInvoice.customerName || selectedInvoice.supplierName) || (isRtl ? 'زبون نقدي' : 'Walk-in')}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 font-bold">{isRtl ? 'طريقة الدفع' : 'Payment'}</p>
                  <p className="font-semibold">{invoicePaymentLabel(selectedInvoice, isRtl)}</p>
                  {selectedInvoice.paymentMethod === 'credit' && (invoiceOwed(selectedInvoice) > 0 || invoicePaidNow(selectedInvoice) > 0) && (
                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mt-1" dir="ltr">
                      {isRtl ? 'مدفوع' : 'Paid'} {formatCurrency(invoicePaidNow(selectedInvoice), selectedInvoice.currency)}
                      {' · '}
                      {isRtl ? 'آجل' : 'Due'} {formatCurrency(Number(selectedInvoice.debtAmount) || invoiceOwed(selectedInvoice), selectedInvoice.debtCurrency || selectedInvoice.currency)}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 font-bold">{isRtl ? 'العملة' : 'Currency'}</p>
                  <p className="font-semibold font-mono">{selectedInvoice.currency}</p>
                </div>
                {isReturnType(selectedInvoice.type) && selectedInvoice.returnOfNumber && (
                  <div>
                    <p className="text-[11px] text-slate-400 font-bold">{isRtl ? 'عن الفاتورة' : 'For invoice'}</p>
                    <p className="font-semibold font-mono" dir="ltr">#{selectedInvoice.returnOfNumber}</p>
                  </div>
                )}
                {isReturnType(selectedInvoice.type) && selectedInvoice.returnReason && (
                  <div className="col-span-2">
                    <p className="text-[11px] text-slate-400 font-bold">{isRtl ? 'سبب الإرجاع' : 'Reason'}</p>
                    <p className="font-semibold">{selectedInvoice.returnReason}</p>
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 mb-8">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <th className={`py-3 px-4 font-bold ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'الصنف' : 'Item'}</th>
                      <th className="py-3 px-4 text-center font-bold w-20">{isRtl ? 'الكمية' : 'Qty'}</th>
                      <th className="py-3 px-4 text-center font-bold w-28">{isRtl ? 'سعر الوحدة' : 'Unit'}</th>
                      <th className={`py-3 px-4 font-bold w-32 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'المجموع' : 'Amount'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                    {selectedInvoice.items.map((item, idx) => {
                      const sku = invoiceItemSku(item, products);
                      return (
                        <tr key={idx}>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 dark:text-slate-100">{item.description}</div>
                            {sku && <div className="text-[11px] text-slate-400 font-mono mt-0.5">{isRtl ? 'رمز الصنف' : 'SKU'}: {sku}</div>}
                          </td>
                          <td className="py-3 px-4 text-center">{lineQuantityText(item, isRtl)}</td>
                          <td className="py-3 px-4 text-center font-mono text-slate-500">{formatCurrency(item.unitPrice, selectedInvoice.currency)}</td>
                          <td className={`py-3 px-4 font-mono font-bold ${isRtl ? 'text-left' : 'text-right'}`}>{formatCurrency(item.total, selectedInvoice.currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid sm:grid-cols-2 gap-6 mt-2">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 p-4 text-xs text-slate-500 leading-relaxed">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-2">{isRtl ? 'ملاحظات' : 'Notes'}</p>
                  <p>
                    {selectedInvoice.paymentMethod === 'credit' && invoiceOwed(selectedInvoice) > 0
                      ? (invoicePaidNow(selectedInvoice) > 0
                        ? (isRtl
                          ? 'تم استلام جزء من المبلغ نقداً؛ المتبقي مسجّل ديناً على حساب العميل. يُرجى السداد حسب الاتفاق ومراجعة الكميات عند الاستلام.'
                          : 'Part paid in cash; the remainder is on the customer account. Settle as agreed and verify quantities on receipt.')
                        : (isRtl
                          ? 'فاتورة آجلة: المبلغ مستحق على حساب العميل حسب الاتفاق. يُرجى مراجعة الكميات والمبالغ عند الاستلام.'
                          : 'On-account invoice: amount due on the customer account as agreed. Verify quantities and amounts on receipt.'))
                      : (isRtl
                        ? 'يرجى مراجعة الكميات والمبالغ عند الاستلام. الأسعار بالعملة الموضحة أعلاه.'
                        : 'Please verify quantities and amounts on receipt. Prices are in the currency shown above.')}
                  </p>
                </div>
                <div className="max-w-sm sm:ms-auto w-full space-y-2 text-sm rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
                  <div className="flex justify-between">
                    <span className="text-slate-400">{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span>
                    <span className="font-mono" dir="ltr">{formatCurrency(selectedInvoice.subtotal, selectedInvoice.currency)}</span>
                  </div>
                  {Number(selectedInvoice.discount) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">{isRtl ? 'الخصم' : 'Discount'}</span>
                      <span className="font-mono" dir="ltr">−{formatCurrency(Number(selectedInvoice.discount), selectedInvoice.currency)}</span>
                    </div>
                  )}
                  {(Number(selectedInvoice.taxAmount) > 0 || Number(selectedInvoice.vatRate) > 0) && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">{isRtl ? 'الضريبة' : 'VAT'} ({invoiceVatRate(selectedInvoice)}%)</span>
                      <span className="font-mono" dir="ltr">{formatCurrency(selectedInvoice.taxAmount, selectedInvoice.currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-3 border-t border-slate-200 dark:border-slate-700 text-base font-bold">
                    <span>{isRtl ? 'الإجمالي' : 'Total'}</span>
                    <span className="font-mono" dir="ltr">{formatCurrency(selectedInvoice.totalAmount, selectedInvoice.currency)}</span>
                  </div>
                  {selectedInvoice.paymentMethod === 'credit' && invoiceOwed(selectedInvoice) > 0 && (
                    <>
                      {invoicePaidNow(selectedInvoice) > 0 && (
                        <div className="flex justify-between text-xs font-bold">
                          <span className="text-slate-500">{isRtl ? 'المدفوع الآن' : 'Paid now'}</span>
                          <span className="font-mono" dir="ltr">{formatCurrency(invoicePaidNow(selectedInvoice), selectedInvoice.currency)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs font-bold text-amber-800 dark:text-amber-300">
                        <span>{isRtl ? 'المتبقي آجل' : 'Balance due'}</span>
                        <span className="font-mono" dir="ltr">
                          {formatCurrency(Number(selectedInvoice.debtAmount) || invoiceOwed(selectedInvoice), selectedInvoice.debtCurrency || selectedInvoice.currency)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8 mt-10 pt-6 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                <div className="pt-8 border-t border-slate-200 dark:border-slate-700">{isRtl ? 'توقيع المستلم' : 'Received by'}</div>
                <div className="pt-8 border-t border-slate-200 dark:border-slate-700">
                  {isRtl ? 'ختم / توقيع' : 'Stamp / signed'} · {settings?.businessName || appName(isRtl)}
                </div>
              </div>
              <p className="mt-8 text-center text-[11px] text-slate-400">{appInvoicePromo(isRtl)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
