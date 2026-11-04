import { printHtmlDocument } from '../lib/printHtml';
import { buildReceiptHtml } from '../lib/receipt';
import { printReceipt, printerErrorMessage, readReceiptPrinter } from '../lib/receiptPrinter';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Barcode, 
  Plus, 
  Minus, 
  Trash2, 
  Sparkles, 
  ShoppingCart, 
  Truck, 
  Percent, 
  CheckCircle2, 
  Coins,
  Search,
  AlertCircle,
  Keyboard,
  Info,
  Printer,
  CreditCard,
  Smartphone,
  PauseCircle,
  Package,
  Clock,
  User,
  X,
  MonitorSmartphone,
  CalendarClock,
  Undo2,
} from 'lucide-react';
import { useFirebase } from './FirebaseProvider';
import ReturnModal from './ReturnModal';
import { canReturn, findReturnableSales } from '../lib/salesReturn';
import { migrateLegacyUserCache } from '../lib/userStorage';
import {
  type HeldBill,
  heldBillFitsStock,
  openHeldBill,
  parkedHeldBills,
  readHeldBills,
  unitsHeldParked,
  writeHeldBills,
} from '../lib/heldBills';
import { Language, Product, Invoice, InvoiceItem, Currency } from '../types';
import { translations } from '../translations';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import CashPaymentModal from './CashPaymentModal';
import {
  CURRENCY_SYMBOLS,
  PosCurrency,
  isPosCurrency,
  buildUsdUnitRates,
  safeConvertMoney,
  roundMoney,
  formatMoney,
  currencyDecimals,
  fetchLiveUsdRates,
  readCachedLiveRates,
  readCachedLiveRatesTimestamp,
} from '../lib/exchangeRates';
import { planPosCreditDebt } from '../lib/posDebtFx';
import { consumeInvoiceNumber, peekInvoiceNumber } from '../lib/invoiceNumber';
import { computeInvoiceTotals, resolveVatRate } from '../lib/invoiceTotals';
import { markUnsavedWork } from '../lib/backNavigation';
import { playPosBeep } from '../lib/sounds';
import { getExternalSalesApi } from '../lib/externalSalesApi';
import { computeStockStatus } from '../lib/stock';
import { pickForPurchase, pickForSale, productsForCode } from '../lib/productLookup';
import { formatPackStock, isPackLine, lineAsPack, lineKey, lineQuantityText, lineUnits, productPack, productsForPackCode, unitsInCart } from '../lib/packs';
import { checkSalePayment } from '../lib/salesPayment';
import CurrencyPicker from './CurrencyPicker';
import ShiftPanel from './ShiftPanel';
import { openShiftOf } from '../lib/shifts';
import { emptyQuickRegForm, parseQuickRegQuantity } from '../lib/posQuickReg';
import { buildAdhocInvoiceItem, isAdhocLine, validateAdhocDraft } from '../lib/adhocLine';
import { resolveProductCategory, resolveProductSku } from '../lib/productForm';
import ShowMoreBar from './ui/ShowMoreBar';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { productVisualEmoji, productVisualTone } from '../lib/productVisual';
import {
  buildCustomerDisplayLines,
  idleCustomerDisplaySnapshot,
  openCustomerDisplayWindow,
  publishCustomerDisplay,
  type CustomerDisplaySnapshot,
} from '../lib/customerDisplay';

interface POSSystemProps {
  language: Language;
}

const POS_SYMBOLS = CURRENCY_SYMBOLS;

/** Quick cash buttons sized to each currency's real denominations. */
const QUICK_CASH: Record<string, number[]> = {
  USD: [10, 20, 50, 100],
  ILS: [20, 50, 100, 200],
  SAR: [10, 50, 100, 500],
  AED: [10, 50, 100, 200],
  JOD: [5, 10, 20, 50],
  LYD: [5, 10, 20, 50],
  EGP: [50, 100, 200, 500],
  IQD: [1000, 5000, 10000, 25000],
};

/** Keeps what the cashier is typing; only a whole number above zero changes the line, and 0 on leave removes it. */
function QtyInput({ value, onCommit, className, style }: { value: number; onCommit: (qty: number) => void; className?: string; style?: React.CSSProperties }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <input
      type="number"
      min="0"
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const qty = parseInt(e.target.value, 10);
        if (qty > 0) onCommit(qty);
      }}
      onBlur={() => {
        const qty = parseInt(draft, 10);
        if (qty === 0) onCommit(0);
        else setDraft(String(value));
      }}
      className={className}
      style={style}
    />
  );
}

function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Phone / tablet: soft keyboard should not own the POS. Desktop keeps wedge-scanner focus. */
function useTouchPosLayout(): boolean {
  const [touch, setTouch] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 1023px)').matches;
  });
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const narrow = window.matchMedia('(max-width: 1023px)');
    const sync = () => setTouch(coarse.matches || narrow.matches);
    sync();
    coarse.addEventListener('change', sync);
    narrow.addEventListener('change', sync);
    return () => {
      coarse.removeEventListener('change', sync);
      narrow.removeEventListener('change', sync);
    };
  }, []);
  return touch;
}

export default function POSSystem({ language }: POSSystemProps) {
  const t = translations[language];
  const isRtl = language === 'ar';
  const touchPos = useTouchPosLayout();
  /** Bluetooth / HID wedge on a phone: user opts in so the barcode field keeps focus. */
  const [wedgeScannerMode, setWedgeScannerMode] = useState(false);
  const stickyScannerFocus = !touchPos || wedgeScannerMode;
  
  const { products, invoices, saveInvoice, settings, saveProduct, warehouses, user, can, workspace, shifts, customers } = useFirebase();
  const myShift = openShiftOf(shifts, user?.uid);
  const [showShiftPanel, setShowShiftPanel] = useState(false);
  const [shiftPanelTab, setShiftPanelTab] = useState<'drawer' | 'day'>('drawer');
  const [showReturnLookup, setShowReturnLookup] = useState(false);
  const [returnQuery, setReturnQuery] = useState('');
  const [returnTarget, setReturnTarget] = useState<Invoice | null>(null);
  const canManageCatalog = can('manage_catalog');
  const canAdjustLinePrice = can('back_office');
  const canProcessReturn = can('reverse_invoice');
  const requireOpenShift = !!settings?.requireOpenShift;
  const storeCurrency = isPosCurrency(settings?.currency) ? settings.currency : 'JOD';
  const [posCurrency, setPosCurrency] = useState<PosCurrency>(() => {
    try {
      const saved = localStorage.getItem('mustawdae_pos_checkout_currency');
      if (isPosCurrency(saved)) return saved;
    } catch { /* ignore */ }
    return storeCurrency;
  });
  const activeCurrency = posCurrency;
  const [liveRates, setLiveRates] = useState<Record<string, number> | null>(() => readCachedLiveRates());
  const [ratesAt, setRatesAt] = useState<number | null>(() => readCachedLiveRatesTimestamp());
  const [ratesLoading, setRatesLoading] = useState(false);
  const usdUnitRates = useMemo(() => buildUsdUnitRates(settings, liveRates), [settings, liveRates]);
  const hadLiveRatesRef = useRef(!!liveRates);
  const [invoiceTick, setInvoiceTick] = useState(0);
  // Original catalog price per product, so switching currency never compounds rounding errors.
  const itemBaseRef = useRef<Record<string, { amount: number; currency: string }>>({});
  const externalApi = getExternalSalesApi();
  const sessionUid = user?.uid || 'guest';
  const storeId = workspace?.ownerId;
  
  // Quick Product Registration state variables
  const [showQuickRegModal, setShowQuickRegModal] = useState(false);
  const [quickRegForm, setQuickRegForm] = useState(() => emptyQuickRegForm());
  const [showAdhocModal, setShowAdhocModal] = useState(false);
  const [adhocForm, setAdhocForm] = useState({ description: '', quantity: '1', unitPrice: '', unitCost: '' });

  // States
  const [posMode, setPosMode] = useState<'sale' | 'purchase'>('sale');
  const invoicePrefix = posMode === 'sale' ? 'POS' : 'SUP';
  const previewInvoiceNo = useMemo(() => peekInvoiceNumber(invoicePrefix, sessionUid, storeId), [invoicePrefix, sessionUid, storeId, invoiceTick]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedItems, setScannedItems] = useState<InvoiceItem[]>([]);
  useEffect(() => {
    markUnsavedWork('pos-cart', scannedItems.length > 0);
    return () => markUnsavedWork('pos-cart', false);
  }, [scannedItems.length]);
  
  // Advanced POS states
  const [lastScannedProductId, setLastScannedProductId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'wallet'>('cash');
  const [receivedAmount, setReceivedAmount] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);

  const discountInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    migrateLegacyUserCache(sessionUid);
    setHeldBills(readHeldBills(sessionUid));
  }, [sessionUid]);

  const persistHeld = (next: HeldBill[]): boolean => {
    if (!writeHeldBills(sessionUid, next)) {
      toast.error(isRtl
        ? 'تعذّر حفظ الفواتير المعلّقة على هذا الجهاز. لم يُغيَّر شيء.'
        : 'Could not save held bills on this device. Nothing was changed.');
      playBeep('error');
      return false;
    }
    setHeldBills(next);
    return true;
  };

  // Handle suspend current bill — disk write first, then clear the cart (fail-closed).
  const handleSuspendBill = () => {
    if (posMode !== 'sale') return;
    if (scannedItems.length === 0) {
      toast.error(isRtl ? 'لا يمكن تعليق فاتورة فارغة!' : 'Cannot suspend an empty bill!');
      playBeep('error');
      return;
    }
    const open = openHeldBill(heldBills);
    const heldId = open?.id || crypto.randomUUID();
    const billNum = open?.invoiceNumber || `HLD-${heldId.slice(0, 6).toUpperCase()}`;
    const formattedTime = new Date().toLocaleTimeString(isRtl ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
    const itemsCount = scannedItems.reduce((acc, item) => acc + lineUnits(item), 0);

    const newHeldBill: HeldBill = {
      id: heldId,
      invoiceNumber: billNum,
      items: [...scannedItems],
      discount: discount,
      date: Date.now(),
      time: formattedTime,
      itemCount: itemsCount,
      totalAmount: grandTotal,
      currency: activeCurrency,
      mode: 'sale',
      status: 'parked',
    };
    const withoutOpen = heldBills.filter((b) => b.id !== heldId);
    const next = [...withoutOpen, newHeldBill];
    if (!persistHeld(next)) return;

    setScannedItems([]);
    setDiscount(0);
    setReceivedAmount('');
    playBeep('success_checkout');
    toast.success(
      isRtl
        ? `عُلّقت الفاتورة #${billNum} على هذا الجهاز فقط — لا تحجز المخزون على الأجهزة الأخرى`
        : `Bill #${billNum} held on this device only — it does not reserve stock on other devices`,
      { duration: 5500 },
    );
  };

  // Restore suspended bill — stays on disk as "open" until checkout succeeds.
  const handleRestoreBill = (bill: HeldBill) => {
    if (posMode !== 'sale' || (bill.mode ?? 'sale') !== 'sale') return;
    if ((bill.status || 'parked') === 'open') return;
    if (scannedItems.length > 0) {
      if (!window.confirm(isRtl ? 'هناك منتجات في السلة حالياً. هل ترغب في سحب الفاتورة المعلقة واستبدال السلة الحالية بها؟' : 'You have active items. Restore held bill and replace current cart?')) {
        return;
      }
    }
    const qtyById = Object.fromEntries(products.map((p) => [p.id, Number(p.quantity) || 0]));
    const stock = heldBillFitsStock(bill, qtyById, (productId) => unitsHeldParked(heldBills, productId, bill.id));
    if (stock.ok === false) {
      const name = bill.items.find((i) => i.productId === stock.productId)?.description || stock.productId;
      toast.error(isRtl
        ? `لا يمكن استرجاع الفاتورة: المخزون غير كافٍ لـ «${name}» (المتوفر ${stock.available}).`
        : `Cannot restore: insufficient stock for “${name}” (available ${stock.available}).`);
      playBeep('error');
      return;
    }

    const alreadyOpen = openHeldBill(heldBills);
    let next = heldBills.map((b) => (b.id === bill.id ? { ...b, status: 'open' as const } : b));
    if (alreadyOpen && alreadyOpen.id !== bill.id) {
      next = next.map((b) => (b.id === alreadyOpen.id ? { ...b, status: 'parked' as const } : b));
    }
    if (!persistHeld(next)) return;

    itemBaseRef.current = {};
    setScannedItems(bill.items);
    setDiscount(bill.discount ?? 0);
    if (isPosCurrency(bill.currency)) {
      setPosCurrency(bill.currency);
    }
    playBeep('success');
    toast.success(isRtl ? 'تم استرجاع الفاتورة المعلقة بنجاح للواجهة' : 'Suspended bill restored successfully');
  };

  // Discard a held bill
  const handleDiscardHeldBill = (billId: string) => {
    if (window.confirm(isRtl ? 'هل أنت متأكد من رغبتك في حذف وإلغاء هذه الفاتورة المعلقة تماماً؟' : 'Are you sure you want to permanently discard this held bill?')) {
      const discarded = heldBills.find((b) => b.id === billId);
      const next = heldBills.filter((b) => b.id !== billId);
      if (!persistHeld(next)) return;
      if (discarded?.status === 'open') {
        setScannedItems([]);
        setDiscount(0);
        setReceivedAmount('');
      }
      playBeep('error');
      toast.success(isRtl ? 'تم إلغاء الفاتورة المعلقة وإزالتها من الذاكرة بنجاح' : 'Held bill discarded successfully');
    }
  };

  const finishOpenHeldBill = () => {
    const open = openHeldBill(heldBills);
    if (!open) return;
    const next = heldBills.filter((b) => b.id !== open.id);
    if (!writeHeldBills(sessionUid, next)) {
      console.warn('[POS] held bill stayed open after sale; will retry on next action');
      return;
    }
    setHeldBills(next);
  };

  const handleCurrencyChange = (targetCurrency: string, showToast = true) => {
    if (!isPosCurrency(targetCurrency) || targetCurrency === posCurrency) return;
    if (scannedItems.length > 0) {
      const nextItems: typeof scannedItems = [];
      for (const item of scannedItems) {
        const base = itemBaseRef.current[lineKey(item)];
        const newPrice = safeConvertMoney(
          base ? base.amount : item.unitPrice,
          base ? base.currency : posCurrency,
          targetCurrency,
          usdUnitRates,
        );
        if (newPrice === null) {
          toast.error(isRtl
            ? `تعذّر تحويل أسعار السلة إلى ${targetCurrency}. بقيت العملة ${posCurrency}.`
            : `Could not convert the cart to ${targetCurrency}. Kept ${posCurrency}.`);
          return;
        }
        const qty = Number(item.quantity) || 0;
        nextItems.push({ ...item, unitPrice: newPrice, total: roundMoney(newPrice * qty, targetCurrency) });
      }
      const nextDiscount = safeConvertMoney(discount, posCurrency, targetCurrency, usdUnitRates);
      if (nextDiscount === null) {
        toast.error(isRtl
          ? `تعذّر تحويل الخصم إلى ${targetCurrency}. بقيت العملة ${posCurrency}.`
          : `Could not convert the discount to ${targetCurrency}. Kept ${posCurrency}.`);
        return;
      }
      setScannedItems(nextItems);
      setDiscount(nextDiscount);
      setReceivedAmount('');
    }
    setPosCurrency(targetCurrency);
    try { localStorage.setItem('mustawdae_pos_checkout_currency', targetCurrency); } catch { /* ignore */ }
    if (showToast) {
      toast.success(
        isRtl
          ? `عملة الصندوق: ${targetCurrency} — التحويل بسعر الصرف الحالي`
          : `Checkout currency: ${targetCurrency} — converted at the current rate`
      );
    }
  };
  const [discount, setDiscount] = useState<number>(0);
  const [enableTax, setEnableTax] = useState<boolean>(false);

  /** Park an open hold before emptying the cart so reserved stock is not lost. */
  const parkOpenHeldOrAbort = (): boolean => {
    const open = openHeldBill(heldBills);
    if (!open) return true;
    return persistHeld(heldBills.map((b) => (b.id === open.id ? { ...b, status: 'parked' as const } : b)));
  };

  const clearCartState = () => {
    itemBaseRef.current = {};
    setScannedItems([]);
    setDiscount(0);
    setReceivedAmount('');
  };

  const switchMode = (mode: 'sale' | 'purchase') => {
    if (mode === posMode) return;
    if (scannedItems.length > 0 && !window.confirm(isRtl
      ? 'سيتم تفريغ السلة الحالية عند تغيير الوضع. هل تريد المتابعة؟'
      : 'Switching mode clears the current cart. Continue?')) return;
    if (!parkOpenHeldOrAbort()) return;
    setPosMode(mode);
    clearCartState();
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastInvoiceNumber, setLastInvoiceNumber] = useState('');
  const [lastCompletedInvoice, setLastCompletedInvoice] = useState<Invoice | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductLookup, setShowProductLookup] = useState(false);
  const [isCameraScanning, setIsCameraScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualScanInput, setManualScanInput] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showCashPaymentModal, setShowCashPaymentModal] = useState(false);

  const submitLockRef = useRef(false);
  const submitRef = useRef<(cashOverride?: number) => Promise<void>>(async () => {});
  const draftIdRef = useRef<string | null>(null);
  useEffect(() => { draftIdRef.current = null; }, [scannedItems, posMode, discount, enableTax, paymentMethod, activeCurrency]);

  const displayedProducts = products;

  // Retrieve unique categories
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of displayedProducts) if (p.category) counts.set(p.category, (counts.get(p.category) || 0) + 1);
    return counts;
  }, [displayedProducts]);
  const categoriesList = ['all', ...categoryCounts.keys()];
  const gridProducts = useMemo(
    () => (selectedCategory === 'all' ? displayedProducts : displayedProducts.filter(p => p.category === selectedCategory)),
    [displayedProducts, selectedCategory],
  );
  const gridPage = useProgressiveList(gridProducts, selectedCategory);

  const refreshRates = async (force = false) => {
    setRatesLoading(true);
    try {
      const r = await fetchLiveUsdRates(force);
      if (r) {
        setLiveRates(r);
        setRatesAt(readCachedLiveRatesTimestamp() || Date.now());
      }
    } finally {
      setRatesLoading(false);
    }
  };

  useEffect(() => {
    refreshRates(true);
    const interval = setInterval(() => refreshRates(true), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!liveRates || hadLiveRatesRef.current) {
      hadLiveRatesRef.current = !!liveRates;
      return;
    }
    hadLiveRatesRef.current = true;
    if (scannedItems.length === 0) return;
    setScannedItems((prev) => {
      const next: typeof prev = [];
      for (const item of prev) {
        const base = itemBaseRef.current[lineKey(item)];
        if (!base) {
          next.push(item);
          continue;
        }
        const newPrice = safeConvertMoney(base.amount, base.currency, posCurrency, usdUnitRates);
        if (newPrice === null) {
          next.push(item);
          continue;
        }
        const qty = Number(item.quantity) || 0;
        next.push({ ...item, unitPrice: newPrice, total: roundMoney(newPrice * qty, posCurrency) });
      }
      return next;
    });
  }, [liveRates, posCurrency, usdUnitRates, scannedItems.length]);

  // Background offline sales synchronization hook
  useEffect(() => {
    let syncInProgress = false;

    if (!externalApi) return;

    const triggerSync = async () => {
      if (syncInProgress) return;
      
      const offlineKeys = localStorage.getItem('offline_sales');
      if (!offlineKeys) return;

      let offlineSales: any[] = [];
      try {
        offlineSales = JSON.parse(offlineKeys);
      } catch (e) {
        console.error('Error parsing offline sales:', e);
        return;
      }

      if (offlineSales.length === 0) return;

      syncInProgress = true;
      console.log(`Starting background sync for ${offlineSales.length} offline invoice(s)...`);
      
      const successful_ids: number[] = [];
      
      for (const sale of offlineSales) {
        try {
          const response = await fetch(`${externalApi}/sales/store`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...sale, is_synced: true })
          });

          if (response.ok) {
            successful_ids.push(sale.id);
          }
        } catch (err) {
          console.warn(`Sync failed for invoice ${sale.id}:`, err);
          // Break cycle early if internet connection is completely down
          break;
        }
      }

      if (successful_ids.length > 0) {
        const currentOfflineKeys = localStorage.getItem('offline_sales');
        if (currentOfflineKeys) {
          try {
            const currentSales = JSON.parse(currentOfflineKeys);
            const remainingSales = currentSales.filter((s: any) => !successful_ids.includes(s.id));
            if (remainingSales.length === 0) {
              localStorage.removeItem('offline_sales');
            } else {
              localStorage.setItem('offline_sales', JSON.stringify(remainingSales));
            }
            toast.success(
              isRtl 
                ? `أُرسلت الفواتير المحفوظة على الجهاز إلى الخادم (${successful_ids.length}).` 
                : `Invoices saved on this device were sent to the server (${successful_ids.length}).`
            );
          } catch (storageErr) {
            console.error('Failed to update storage after sync:', storageErr);
          }
        }
      }
      
      syncInProgress = false;
    };

    window.addEventListener('online', triggerSync);
    const interval = setInterval(triggerSync, 30000);
    triggerSync();

    return () => {
      window.removeEventListener('online', triggerSync);
      clearInterval(interval);
    };
  }, [isRtl, externalApi]);

  // Fetch live exchange rate every time a new invoice starts (whenever scannedItems goes from having items to being empty)
  const prevScannedCount = useRef(0);
  useEffect(() => {
    if (scannedItems.length === 0 && prevScannedCount.current > 0) {
      refreshRates();
    }
    prevScannedCount.current = scannedItems.length;
  }, [scannedItems.length]);

  // Shared handler for matching barcode SKU or product ID and registering it
  const handleScannedProductCode = (decodedText: string) => {
    const cleanText = decodedText.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
    setBarcodeInput(cleanText);
    
    const codeMatches = productsForCode(products, cleanText);
    const packMatches = codeMatches.length ? [] : productsForPackCode(products, cleanText);
    const asPack = packMatches.length > 0;
    const candidates = asPack ? packMatches : codeMatches;
    const matchedProduct = posMode === 'purchase' ? pickForPurchase(candidates) : pickForSale(candidates);

    if (matchedProduct) {
      addItemToPOS(matchedProduct, asPack);
      toast.success(
        isRtl 
          ? `تم مسح وإضافة المنتج: ${matchedProduct.name}`
          : `Scanned and added item: ${matchedProduct.name}`
      );
    } else {
      // Fallback search by name containing scanned code
      const matchByName = products.filter(
        p => p.name.toLowerCase().includes(cleanText.toLowerCase())
      );
      if (matchByName.length === 1) {
        addItemToPOS(matchByName[0]);
        toast.success(
          isRtl 
            ? `تم مسح وإضافة المنتج: ${matchByName[0].name}`
            : `Scanned and added item: ${matchByName[0].name}`
        );
      } else {
        playBeep('error');
        setBarcodeInput('');
        if (!canManageCatalog) {
          toast.error(isRtl ? `الباركود "${cleanText}" غير مسجل. اطلب من المدير إضافته.` : `Barcode "${cleanText}" is not registered. Ask a manager to add it.`);
          return;
        }
        setQuickRegForm({
          ...emptyQuickRegForm(warehouses?.[0]?.id || ''),
          sku: cleanText,
        });
        setBarcodeInput('');
        setShowQuickRegModal(true);
        toast.info(
          isRtl 
            ? `الباركود "${cleanText}" غير مسجل. سجّله الآن وأدخل الكمية الموجودة فعلاً (صفر إن لم يصل بعد).` 
            : `Barcode "${cleanText}" is not registered. Register it now and enter the quantity actually on hand (zero if not received yet).`
        );
      }
    }
  };

  const scanHandlerRef = useRef(handleScannedProductCode);
  scanHandlerRef.current = handleScannedProductCode;

  // Setup live camera scanner effect with high-performance Html5Qrcode
  useEffect(() => {
    let qrcodeScanner: Html5Qrcode | null = null;
    let isScanningActive = false;
    let timerId: any = null;

    if (isCameraScanning) {
      setCameraError(null);
      setManualScanInput('');

      // Wait 150ms for the modal to mount and render the id="reader" div in the DOM
      timerId = setTimeout(() => {
        const readerElement = document.getElementById("reader");
        if (readerElement) {
          try {
            qrcodeScanner = new Html5Qrcode("reader");

            const onScanSuccess = async (decodedText: string) => {
              // Close scanner first to avoid double triggers
              setIsCameraScanning(false);
              if (qrcodeScanner && isScanningActive) {
                try {
                  await qrcodeScanner.stop();
                } catch (err) {
                  console.warn("Could not stop camera cleanly:", err);
                }
              }
              scanHandlerRef.current(decodedText);
            };

            const onScanFailure = (error: any) => {
              // Noise log, empty in production of POS to keep log clean
            };

            qrcodeScanner.start(
              { facingMode: "environment" },
              {
                fps: 20,
                qrbox: { width: 280, height: 160 }
              },
              onScanSuccess,
              onScanFailure
            ).then(() => {
              isScanningActive = true;
              // Block soft keyboard from appearing on any auto-focused sub-controls
              setTimeout(() => {
                const inputs = document.querySelectorAll('#reader input, #reader button, #reader select');
                inputs.forEach(input => {
                  input.setAttribute('inputmode', 'none');
                  input.setAttribute('readonly', 'true');
                  (input as HTMLElement).blur();
                });
              }, 350);
            }).catch(err => {
              console.warn("[BarcodeScanner] Safe exception caught: Camera hardware missing or permissions denied by browser sandbox. Error detail:", err);
              setCameraError(
                isRtl 
                  ? "تعذر تشغيل الكاميرا بسبب أذونات المتصفح أو لعدم توفر عتاد كاميرا بيئية في هذا الجهاز."
                  : "Camera startup bypassed: device streams are blocked, missing, or restricted."
              );
            });
          } catch (initErr) {
            console.error("Failed to parent Html5Qrcode:", initErr);
          }
        } else {
          setCameraError(
            isRtl
              ? "تعذر تحديد موضع الكاميرا في واجهة المستودع."
              : "Could not locate scanner frame element in view."
          );
        }
      }, 150);
    }

    return () => {
      if (timerId) clearTimeout(timerId);
      if (qrcodeScanner) {
        if (qrcodeScanner.isScanning) {
          qrcodeScanner.stop().catch(err => console.warn("Clean stop failed during unmount:", err));
        }
      }
    };
  }, [isCameraScanning, products, posMode, isRtl]);

  // References
  const scannerInputRef = useRef<HTMLInputElement>(null);

  const focusScanner = () => {
    if (!stickyScannerFocus) return;
    const active = document.activeElement as HTMLElement | null;
    const tag = active?.tagName;
    if (active && active !== scannerInputRef.current && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;
    scannerInputRef.current?.focus({ preventScroll: true });
  };

  // Desktop / wedge mode: return to the barcode field after a click has already run.
  // On touch POS this is off by default so the soft keyboard does not cover the cart.
  useEffect(() => {
    if (!stickyScannerFocus) {
      const active = document.activeElement;
      if (active === scannerInputRef.current) scannerInputRef.current?.blur();
      return;
    }
    const timer = window.setTimeout(() => focusScanner(), 0);

    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('input, textarea, select, [role="dialog"]')) return;
      window.setTimeout(() => focusScanner(), 0);
    };

    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
      window.clearTimeout(timer);
    };
  }, [stickyScannerFocus]);

  const playBeep = playPosBeep;

  // Setup Keyboard shortcut listeners (e.g. F9, F10, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showCashPaymentModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowCashPaymentModal(false);
          setTimeout(() => focusScanner(), 150);
        }
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        handleSuspendBill();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (scannedItems.length > 0) {
          if (confirm(isRtl ? 'هل أنت متأكد من إلغاء الفاتورة الحالية بالكامل وتفريغ السلة؟' : 'Are you sure you want to cancel the current invoice and clear the cart?')) {
            if (!parkOpenHeldOrAbort()) return;
            clearCartState();
            playBeep('error');
            toast.success(isRtl ? 'تم إلغاء الفاتورة بالكامل وتفريغ السلة بنجاح' : 'Invoice canceled and cart cleared successfully');
          }
        }
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (discountInputRef.current) {
          discountInputRef.current.focus();
          discountInputRef.current.select();
          toast.info(isRtl ? 'تم تركيز حقل الخصم المباشر' : 'Discount input field focused');
        }
      } else if (e.key === 'F10') {
        e.preventDefault();
        if (scannedItems.length > 0) {
          setShowCashPaymentModal(true);
        } else {
          toast.error(isRtl ? 'ليست هناك أي مواد ممسوحة في المعاملة!' : 'Cart is empty!');
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        focusScanner();
        toast.info(isRtl ? 'تم تركيز ماسح الباركود' : 'Barcode scanner focused');
      } else if (e.key === 'F7') {
        e.preventDefault();
        if (!canManageCatalog) return;
        setQuickRegForm(emptyQuickRegForm(warehouses?.[0]?.id || ''));
        setShowQuickRegModal(true);
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (posMode !== 'sale') return;
        setAdhocForm({ description: '', quantity: '1', unitPrice: '', unitCost: '' });
        setShowAdhocModal(true);
      } else if (e.key === 'F6') {
        e.preventDefault();
        if (posMode !== 'sale' || !canProcessReturn) return;
        setReturnQuery('');
        setShowReturnLookup(true);
      } else if (e.key === 'Escape') {
        if (scannedItems.length > 0) {
          if (confirm(isRtl ? 'هل تريد بالتأكيد إفراغ المعاملة الحالية؟' : 'Are you sure you want to clear current items?')) {
            if (!parkOpenHeldOrAbort()) return;
            clearCartState();
            playBeep('error');
            toast.success(isRtl ? 'تم إفراغ السلة بنجاح' : 'Cart cleared successfully');
          }
        }
      } else {
        // High-volume Spacebar and Enter payment confirmation shortcuts
        if (scannedItems.length > 0) {
          const activeTag = document.activeElement?.tagName;
          const isInputActive = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

          if (e.key === 'Enter') {
            const isFromScanner = document.activeElement === scannerInputRef.current;
            // Trigger payment instantly on Enter if focused on barcode scanner AND it's empty, or not in any input/textarea
            if ((isFromScanner && !barcodeInput.trim()) || !isInputActive) {
              e.preventDefault();
              if (!e.repeat) submitRef.current();
            }
          } else if (e.key === ' ' || e.code === 'Space') {
            // Trigger payment instantly on Spacebar if no input text fields are active
            if (!isInputActive) {
              e.preventDefault();
              setShowCashPaymentModal(true);
            }
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scannedItems, posMode, discount, warehouses, showCashPaymentModal, barcodeInput, heldBills, isRtl]);

  // Handle Scanning Lookup (Now supporting asynchronous external API fallbacks safely)
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Sanitize carriage returns, line feeds & other hidden emulation control chars
    const query = barcodeInput.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
    if (!query) return;

    // 1. Search locally synchronized inventory (instant match)
    const codeMatches = productsForCode(products, query);
    const matchedProduct = posMode === 'purchase' ? pickForPurchase(codeMatches) : pickForSale(codeMatches);

    if (matchedProduct) {
      addItemToPOS(matchedProduct);
      setBarcodeInput('');
      return;
    }

    const packMatches = productsForPackCode(products, query);
    const packProduct = posMode === 'purchase' ? pickForPurchase(packMatches) : pickForSale(packMatches);
    if (packProduct) {
      addItemToPOS(packProduct, true);
      setBarcodeInput('');
      return;
    }

    // Try searching by name containing the query as local fallback
    const matchByName = products.filter(
      p => p.name.toLowerCase().includes(query.toLowerCase())
    );
    if (matchByName.length === 1) {
      addItemToPOS(matchByName[0]);
      setBarcodeInput('');
      return;
    } else if (matchByName.length > 1) {
      // Open search lookup helper
      setSearchTerm(query);
      setShowProductLookup(true);
      return;
    }

    // 2. If not found locally, attempt a secure network API lookup (as requested)
    let apiProductFound = false;
    if (externalApi) try {
      // Show light feedback that we're validating online database
      toast.info(isRtl ? 'المنتج غير مسجّل على الجهاز، جارٍ البحث في قاعدة الباركود على الإنترنت...' : 'Checking online barcode database...', { duration: 1500 });
      
      // Perform genuine network fetch request to the custom endpoint
      const response = await fetch(`${externalApi}/products/barcode/${encodeURIComponent(query)}`);
      
      if (response.ok) {
        const externalProduct = await response.json();
        if (externalProduct && (externalProduct.name || externalProduct.title)) {
          // Map external product format to app-compatible Product format
          const mappedProduct: any = {
            id: externalProduct.id ? `ext-${externalProduct.id}` : `ext-${Date.now()}`,
            name: externalProduct.name || externalProduct.title,
            sku: externalProduct.barcode || externalProduct.sku || query,
            unitCost: Number(externalProduct.costPrice || externalProduct.price || 0),
            sellingPrice: Number(externalProduct.sellingPrice || externalProduct.price || 0),
            quantity: Number(externalProduct.stock ?? externalProduct.quantity ?? 0),
            category: externalProduct.category || '',
            brand: externalProduct.brand || ''
          };
          
          addItemToPOS(mappedProduct);
          setBarcodeInput('');
          apiProductFound = true;
          toast.success(isRtl ? 'تم العثور على المنتج وإضافته بنجاح للائحة عبر الـ API!' : 'Product found and added from API database!');
          return;
        }
      }
    } catch (apiError) {
      console.warn("External API lookup bypassed or failed:", apiError);
    }

    // 3. Fallback to Fast Registration Modal if completely unfound or API fails
    if (!apiProductFound && !canManageCatalog) {
      playBeep('error');
      setBarcodeInput('');
      toast.error(isRtl
        ? `الرمز "${query}" غير مسجل في المخزون. اطلب من المدير إضافة الصنف.`
        : `SKU "${query}" is not in inventory. Ask a manager to add the product.`);
      return;
    }
    if (!apiProductFound) {
      playBeep('error');
      setQuickRegForm({
        ...emptyQuickRegForm(warehouses?.[0]?.id || ''),
        sku: query,
      });
      setBarcodeInput('');
      setShowQuickRegModal(true);
      toast.info(
        isRtl
          ? `الرمز "${query}" غير مسجل. سجّله الآن وأدخل الكمية الموجودة فعلاً (صفر إن لم يصل بعد).`
          : `SKU "${query}" is not registered. Register it now and enter the quantity actually on hand (zero if not received yet).`
      );
    }
  };

  /** Price of one unit or one pack of the product in its own currency: selling price on sales, cost on purchases. */
  const basePriceFor = (product: Product, asPack: boolean) => {
    const pack = asPack ? productPack(product) : null;
    if (posMode === 'sale') return pack ? pack.price : Number(product.sellingPrice) || 0;
    return (Number(product.unitCost) || 0) * (pack ? pack.size : 1);
  };

  const insufficientStock = (available: number) => {
    playBeep('error');
    toast.warning(
      isRtl
        ? `الكمية غير كافية بالمخزن! المتبقي فقط: ${available} وحدة.`
        : `Insufficient inventory! Only ${available} left in stock.`
    );
  };

  const addItemToPOS = (product: Product, asPack = false) => {
    const pack = asPack ? productPack(product) : null;
    const key = lineKey({ productId: product.id, packSize: pack?.size });
    const existingIndex = scannedItems.findIndex(item => lineKey(item) === key);
    const targetPrice = basePriceFor(product, !!pack);

    // Convert base price using the product's custom currency (or default store currency) to the POS activeCurrency
    const baseCurrency = product.currency || settings?.currency || 'JOD';
    const finalPrice = safeConvertMoney(targetPrice, baseCurrency, activeCurrency, usdUnitRates);
    if (finalPrice === null) {
      toast.error(isRtl
        ? `تعذّر تحويل سعر «${product.name}» من ${baseCurrency} إلى ${activeCurrency}. لم يُضف للسلة.`
        : `Could not convert “${product.name}” from ${baseCurrency} to ${activeCurrency}. Not added.`);
      return;
    }

    // Stock is checked in units across every line of this product (a box line and a loose line share it),
    // after units already parked in other held bills.
    if (posMode === 'sale') {
      const productQty = Number(product.quantity) || 0;
      const reserved = unitsHeldParked(heldBills, product.id);
      const available = productQty - reserved;
      if (unitsInCart(scannedItems, product.id) + (pack ? pack.size : 1) > available) {
        insufficientStock(Math.max(0, available));
        return;
      }
    }

    if (existingIndex !== -1) {
      const existing = scannedItems[existingIndex];
      const newQty = (Number(existing.quantity) || 0) + 1;
      const uPrice = Number(existing.unitPrice) || 0;
      const updated = [...scannedItems];
      updated[existingIndex] = { ...existing, quantity: newQty, total: roundMoney(newQty * uPrice, activeCurrency) };
      setScannedItems(updated);
    } else {
      // Add standard new item with dynamic converted price
      itemBaseRef.current[key] = { amount: targetPrice, currency: baseCurrency };
      const newItem: InvoiceItem = {
        productId: product.id,
        description: product.name,
        quantity: 1,
        unitPrice: finalPrice,
        total: finalPrice,
        sku: product.sku,
        ...(pack ? { packSize: pack.size, packName: lineAsPack(pack).packName } : {}),
      };
      setScannedItems([...scannedItems, newItem]);
    }
    
    // Set the last scanned product state to trigger UI visual flash confirmation
    setLastScannedProductId(product.id);
    setTimeout(() => {
      setLastScannedProductId(null);
    }, 1500);

    playBeep('success');
  };

  /** Sale mode: the line at this quantity, plus the product's other lines, must fit in stock. */
  const fitsStock = (item: InvoiceItem, qty: number) => {
    if (posMode !== 'sale') return true;
    if (isAdhocLine(item)) return true;
    const product = products.find(p => p.id === item.productId);
    if (!product) {
      toast.error(isRtl
        ? `الصنف «${item.description}» لم يعد في المخزون. أزله من السلة.`
        : `“${item.description}” is no longer in inventory. Remove it from the cart.`);
      return false;
    }
    const available = Math.max(0, (Number(product.quantity) || 0) - unitsHeldParked(heldBills, product.id));
    if (unitsInCart(scannedItems, item.productId, lineKey(item)) + lineUnits({ ...item, quantity: qty }) <= available) return true;
    insufficientStock(available);
    return false;
  };

  const updateItemQty = (key: string, delta: number) => {
    const idx = scannedItems.findIndex(item => lineKey(item) === key);
    if (idx === -1) return;

    const updated = [...scannedItems];
    const currentQty = Number(updated[idx].quantity) || 0;
    const newQty = currentQty + delta;

    if (newQty <= 0) {
      removeItem(key);
      return;
    }
    if (delta > 0 && !fitsStock(updated[idx], newQty)) return;

    const uPrice = Number(updated[idx].unitPrice) || 0;
    updated[idx] = { ...updated[idx], quantity: newQty, total: roundMoney(newQty * uPrice, activeCurrency) };
    setScannedItems(updated);
  };

  const setItemQty = (key: string, val: number) => {
    if (isNaN(val)) return;
    if (val <= 0) {
      removeItem(key);
      return;
    }

    const idx = scannedItems.findIndex(item => lineKey(item) === key);
    if (idx === -1) return;
    if (!fitsStock(scannedItems[idx], val)) return;

    const updated = [...scannedItems];
    const uPrice = Number(updated[idx].unitPrice) || 0;
    updated[idx] = { ...updated[idx], quantity: val, total: roundMoney(val * uPrice, activeCurrency) };
    setScannedItems(updated);
  };

  /** Switches a line between the single unit and the pack, keeping its count (3 units become 3 packs). */
  const toggleLinePack = (key: string) => {
    const idx = scannedItems.findIndex(item => lineKey(item) === key);
    if (idx === -1) return;
    const item = scannedItems[idx];
    const product = products.find(p => p.id === item.productId);
    const pack = product ? productPack(product) : null;
    if (!product || !pack) return;
    const toPack = !isPackLine(item);
    const nextKey = lineKey({ productId: item.productId, packSize: toPack ? pack.size : undefined });
    const other = scannedItems.find(i => lineKey(i) === nextKey);
    const qty = (Number(item.quantity) || 0) + (Number(other?.quantity) || 0);
    const rest = scannedItems.filter(i => lineKey(i) !== key && lineKey(i) !== nextKey);
    const next: InvoiceItem = {
      ...item,
      quantity: qty,
      packSize: toPack ? pack.size : undefined,
      packName: toPack ? lineAsPack(pack).packName : undefined,
    };
    if (posMode === 'sale') {
      const available = Math.max(0, (Number(product.quantity) || 0) - unitsHeldParked(heldBills, product.id));
      if (unitsInCart(rest, item.productId) + lineUnits(next) > available) {
        insufficientStock(available);
        return;
      }
    }
    const baseCurrency = product.currency || settings?.currency || 'JOD';
    const baseAmount = basePriceFor(product, toPack);
    itemBaseRef.current[nextKey] = { amount: baseAmount, currency: baseCurrency };
    const unitPrice = safeConvertMoney(baseAmount, baseCurrency, activeCurrency, usdUnitRates);
    if (unitPrice === null) {
      toast.error(isRtl
        ? `تعذّر تحويل سعر «${product.name}». لم يُغيَّر السطر.`
        : `Could not convert “${product.name}”. Line unchanged.`);
      return;
    }
    const replaced = { ...next, unitPrice, total: roundMoney(qty * unitPrice, activeCurrency) };
    const at = Math.min(idx, rest.length);
    setScannedItems([...rest.slice(0, at), replaced, ...rest.slice(at)]);
  };

  const removeItem = (key: string) => {
    setScannedItems(scannedItems.filter(item => lineKey(item) !== key));
    toast.success(isRtl ? 'تم حذف الصنف من القائمة' : 'Item removed from bill');
  };

  /** Managers/owners may change the line unit (or pack) price on the current cart. */
  const setItemUnitPrice = (key: string, raw: string) => {
    if (!canAdjustLinePrice || posMode !== 'sale') return;
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) {
      toast.error(isRtl ? 'سعر غير صالح.' : 'Invalid price.');
      return;
    }
    const idx = scannedItems.findIndex((item) => lineKey(item) === key);
    if (idx < 0) return;
    const qty = Number(scannedItems[idx].quantity) || 0;
    const next = [...scannedItems];
    const rounded = roundMoney(price, activeCurrency);
    next[idx] = { ...next[idx], unitPrice: rounded, total: roundMoney(qty * rounded, activeCurrency) };
    setScannedItems(next);
  };

  const returnMatches = useMemo(
    () => (showReturnLookup ? findReturnableSales(invoices, returnQuery) : []),
    [showReturnLookup, invoices, returnQuery],
  );

  // Calculations
  const totalPieces = scannedItems.reduce((acc, item) => acc + lineUnits(item), 0);
  const vatRate = resolveVatRate(settings?.defaultVatRate);
  const {
    subtotal,
    discount: appliedDiscount,
    taxAmount,
    total: grandTotal,
  } = computeInvoiceTotals({
    subtotal: scannedItems.reduce((acc, item) => acc + (Number(item.total) || 0), 0),
    discount,
    vatRate,
    taxEnabled: enableTax,
    currency: activeCurrency as Currency,
  });

  const customerDisplayHoldUntilRef = useRef(0);
  const [customerDisplayEpoch, setCustomerDisplayEpoch] = useState(0);
  const storeKey = workspace?.ownerId || user?.uid || 'local';
  const businessLabel = settings?.businessName?.trim() || (isRtl ? 'مستودعي' : 'Mostawdaee');

  useEffect(() => {
    if (Date.now() < customerDisplayHoldUntilRef.current) return;

    if (posMode !== 'sale') {
      publishCustomerDisplay(
        idleCustomerDisplaySnapshot({
          language: isRtl ? 'ar' : 'en',
          businessName: businessLabel,
          currency: activeCurrency as Currency,
          storeKey,
        }),
      );
      return;
    }

    if (scannedItems.length === 0) {
      publishCustomerDisplay(
        idleCustomerDisplaySnapshot({
          language: isRtl ? 'ar' : 'en',
          businessName: businessLabel,
          currency: activeCurrency as Currency,
          storeKey,
        }),
      );
      return;
    }

    const snapshot: CustomerDisplaySnapshot = {
      v: 1,
      updatedAt: Date.now(),
      status: 'cart',
      language: isRtl ? 'ar' : 'en',
      businessName: businessLabel,
      currency: activeCurrency as Currency,
      lines: buildCustomerDisplayLines(scannedItems, isRtl ? 'ar' : 'en'),
      itemCount: totalPieces,
      subtotal,
      discount: appliedDiscount,
      taxAmount,
      total: grandTotal,
      storeKey,
    };
    publishCustomerDisplay(snapshot);
  }, [
    scannedItems,
    posMode,
    subtotal,
    appliedDiscount,
    taxAmount,
    grandTotal,
    totalPieces,
    activeCurrency,
    businessLabel,
    storeKey,
    isRtl,
    customerDisplayEpoch,
  ]);

  const openCustomerScreen = async () => {
    const win = await openCustomerDisplayWindow();
    if (!win) {
      toast.error(
        isRtl
          ? 'تعذّر فتح شاشة العميل. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.'
          : 'Could not open the customer display. Allow pop-ups and try again.',
      );
      return;
    }
    setCustomerDisplayEpoch((n) => n + 1);
    toast.success(
      isRtl
        ? 'تم فتح شاشة العميل — اسحبها إلى الشاشة الأمامية إن لزم.'
        : 'Customer display opened — drag it to the front screen if needed.',
    );
  };

  const printThermalReceipt = (invoiceObj: Invoice, cashSale = false) => {
    const html = buildReceiptHtml({
      invoice: invoiceObj,
      isRtl,
      paper: readReceiptPrinter().paper,
      businessName: settings?.businessName || (isRtl ? 'مستودعي' : 'Mostawdaee'),
      businessAddress: settings?.businessAddress,
      businessPhone: settings?.businessPhone,
      taxRegistrationNumber: settings?.taxRegistrationNumber,
      money: (amount, currency) => formatMoney(amount, currency || activeCurrency),
      formatDate: (ms) => new Date(ms).toLocaleString(isRtl ? 'ar-JO' : 'en-US'),
    });
    printReceipt(html, invoiceObj.invoiceNumber, { cashSale }).catch((err) => {
      toast.error(printerErrorMessage(err, isRtl), {
        id: 'receipt-print',
        action: { label: isRtl ? 'طباعة عبر النظام' : 'Use system print', onClick: () => printHtmlDocument(html, invoiceObj.invoiceNumber) },
      });
    });
  };

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId],
  );
  const customerMatches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
      .slice(0, 8);
  }, [customers, customerQuery]);

  // Submit standard invoice
  const handleSubmitProcess = async (cashOverride?: number, methodOverride?: 'cash' | 'card' | 'wallet') => {
    const method = methodOverride || paymentMethod;
    if (submitLockRef.current) return;
    if (scannedItems.length === 0) {
      playBeep('error');
      toast.error(isRtl ? 'ليست هناك أي مواد ممسوحة في المعاملة!' : 'Cart is empty!');
      return;
    }
    if (posMode === 'sale' && requireOpenShift && !myShift && !can('back_office')) {
      playBeep('error');
      toast.error(isRtl
        ? 'يجب فتح عدّ الدرج قبل البيع. افتح الوردية ثم أعد المحاولة.'
        : 'Open a drawer count before selling. Open your shift, then try again.');
      setShiftPanelTab('drawer');
      setShowShiftPanel(true);
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const typedCash = typeof cashOverride === 'number' ? cashOverride : parseFloat(receivedAmount);
      const isCashSale = posMode === 'sale' && method === 'cash';
      const parsedCash = isCashSale
        ? (receivedAmount !== '' || typeof cashOverride === 'number'
          ? (Number.isFinite(typedCash) ? typedCash : 0)
          : grandTotal)
        : grandTotal;

      let saleMethod: 'cash' | 'card' | 'wallet' | 'credit' = posMode === 'purchase' ? 'cash' : method;
      let paidNow = parsedCash;
      let changeDue = 0;
      let debtAmount: number | undefined;
      let debtCurrency: Currency | undefined;
      const customer = selectedCustomer;

      if (posMode === 'sale' && isCashSale && parsedCash < grandTotal - 1e-6) {
        if (!customer) {
          setIsSubmitting(false);
          submitLockRef.current = false;
          playBeep('error');
          toast.error(isRtl
            ? 'المبلغ أقل من الإجمالي. اختر عميلاً لتسجيل الباقي ديناً، أو أدخل المبلغ كاملاً.'
            : 'Amount is less than the total. Select a customer to put the remainder on account, or take full payment.');
          return;
        }
        paidNow = roundMoney(Math.max(0, parsedCash), activeCurrency);
        const payErr = checkSalePayment('credit', grandTotal, paidNow, activeCurrency as Currency, customer.id);
        if (payErr) {
          setIsSubmitting(false);
          submitLockRef.current = false;
          playBeep('error');
          toast.error(isRtl ? 'تعذّر تسجيل الدفع الجزئي.' : 'Could not record the partial payment.');
          return;
        }
        const owed = roundMoney(grandTotal - paidNow, activeCurrency);
        const custCurrency = (customer.currency || activeCurrency) as Currency;
        const debtPlan = planPosCreditDebt({
          owed,
          billCurrency: activeCurrency as Currency,
          customerCurrency: custCurrency,
          settings,
          liveRates,
          liveAt: readCachedLiveRatesTimestamp(),
          usdUnitRates,
        });
        if (!debtPlan.ok) {
          setIsSubmitting(false);
          submitLockRef.current = false;
          playBeep('error');
          toast.error(isRtl
            ? `لا يوجد سعر صرف موثوق من ${activeCurrency} إلى ${custCurrency} لتسجيل الدين. حدّث الأسعار أو أدخل أسعارك من الإعدادات، أو اجعل الفاتورة بعملة العميل.`
            : `No trusted ${activeCurrency} → ${custCurrency} rate to record this debt. Refresh rates, set manual rates in Settings, or bill in the customer's currency.`);
          return;
        }
        debtAmount = debtPlan.debtAmount;
        debtCurrency = debtPlan.debtCurrency;
        saleMethod = 'credit';
        changeDue = 0;
      } else if (isCashSale) {
        paidNow = parsedCash;
        changeDue = roundMoney(Math.max(0, parsedCash - grandTotal), activeCurrency);
      }

      const generatedNo = peekInvoiceNumber(invoicePrefix, sessionUid, storeId);

      const officialInvoice: Invoice = {
        id: (draftIdRef.current ||= crypto.randomUUID()),
        invoiceNumber: generatedNo,
        customerName: posMode === 'sale'
          ? (customer?.name || (isRtl ? 'مبيعات نقطة البيع' : 'POS sale'))
          : undefined,
        customerId: posMode === 'sale' && saleMethod === 'credit' ? customer?.id : (posMode === 'sale' && customer ? customer.id : undefined),
        supplierName: posMode === 'purchase' ? (isRtl ? 'مشتريات توريد مباشرة' : 'Direct Supplier') : undefined,
        items: [...scannedItems],
        subtotal,
        taxAmount,
        vatRate: enableTax ? vatRate : 0,
        totalAmount: grandTotal,
        type: posMode,
        date: Date.now(),
        currency: activeCurrency as Currency,
        discount: appliedDiscount,
        cashReceived: isCashSale ? paidNow : undefined,
        changeDue: isCashSale ? changeDue : undefined,
        // Supply at the counter is always cash from the vault; sale may be cash, card, wallet, or credit/split.
        paymentMethod: saleMethod,
        ...(saleMethod === 'credit' ? {
          paidAmount: paidNow,
          debtAmount,
          debtCurrency,
        } : {}),
      };

      // Persist first: any failure here aborts checkout (cart is kept) instead of showing a false success.
      if (!user) {
        toast.warning(
          isRtl
            ? 'وضع المعاينة (ضيف): لا تُحفظ الفاتورة ولا يتغيّر المخزون. سجّل الدخول لإتمام البيع.'
            : 'Guest preview: the sale is not saved and stock is unchanged. Sign in to complete a real sale.',
          { duration: 6000 }
        );
        setIsSubmitting(false);
        return;
      }
      officialInvoice.invoiceNumber = await saveInvoice(officialInvoice);
      consumeInvoiceNumber(invoicePrefix, sessionUid, storeId);
      draftIdRef.current = null;

      // Optional mirror to a third-party API (only when VITE_EXTERNAL_SALES_API is configured).
      if (externalApi && posMode === 'sale') {
        const invoiceData = {
          id: Date.now(),
          items: scannedItems.map((item) => ({
            product_id: item.productId,
            quantity: lineUnits(item),
            price: isPackLine(item) ? (Number(item.total) || 0) / (lineUnits(item) || 1) : item.unitPrice,
          })),
          total_amount: grandTotal,
          cash_received: parsedCash,
          change_due: changeDue,
          created_at: new Date().toISOString(),
          is_synced: false,
        };
        try {
          const response = await fetch(`${externalApi}/sales/store`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...invoiceData, is_synced: true }),
          });
          if (!response.ok) throw new Error(`external api ${response.status}`);
        } catch (apiErr) {
          console.warn('External API post failed; queued for background sync:', apiErr);
          try {
            const queued = JSON.parse(localStorage.getItem('offline_sales') || '[]');
            queued.push(invoiceData);
            localStorage.setItem('offline_sales', JSON.stringify(queued));
          } catch (storageErr) {
            console.error('Failed to queue external sale:', storageErr);
          }
        }
      }

      // Only a sale that was actually saved may open the cash drawer; reprints never do.
      printThermalReceipt(officialInvoice, (isCashSale && paidNow > 0) || (saleMethod === 'credit' && paidNow > 0));

      if (posMode === 'sale') {
        customerDisplayHoldUntilRef.current = Date.now() + 7000;
        publishCustomerDisplay({
          v: 1,
          updatedAt: Date.now(),
          status: 'paid',
          language: isRtl ? 'ar' : 'en',
          businessName: businessLabel,
          currency: activeCurrency as Currency,
          lines: buildCustomerDisplayLines(scannedItems, isRtl ? 'ar' : 'en'),
          itemCount: totalPieces,
          subtotal,
          discount: appliedDiscount,
          taxAmount,
          total: grandTotal,
          changeDue: isCashSale ? changeDue : undefined,
          storeKey,
        });
        window.setTimeout(() => {
          customerDisplayHoldUntilRef.current = 0;
          setCustomerDisplayEpoch((n) => n + 1);
        }, 7000);
      }

      // Clear State
      setLastInvoiceNumber(officialInvoice.invoiceNumber);
      setInvoiceTick((t) => t + 1);
      setLastCompletedInvoice(officialInvoice);
      clearCartState();
      setEnableTax(false);
      setPaymentMethod('cash');
      setSelectedCustomerId('');
      setCustomerQuery('');
      if (posMode === 'sale') finishOpenHeldBill();
      setIsSubmitting(false);
      setShowCashPaymentModal(false);
      setShowSuccessModal(true);
      playBeep('success_checkout');
    } catch (error: any) {
      console.error(error);
      setIsSubmitting(false);
      playBeep('error');
      const vaultShort = /INSUFFICIENT_VAULT_FUNDS|insufficient.?vault|vault/i.test(String(error?.code || error?.message || ''));
      if (vaultShort) {
        toast.error(isRtl
          ? 'رصيد الخزنة غير كافٍ لهذه المشتريات؛ لم تُحفظ الفاتورة وبقيت السلة.'
          : 'Vault balance is insufficient for this purchase; nothing was saved and the cart was kept.');
      } else if (!error?.notified && !String(error?.message || '').startsWith('Insufficient stock')) {
        toast.error(isRtl ? 'تعذّر حفظ الفاتورة؛ لم تُسجَّل العملية وبقيت السلة كما هي.' : 'Could not save the invoice; nothing was recorded and the cart was kept.');
      }
    } finally {
      submitLockRef.current = false;
    }
  };
  submitRef.current = handleSubmitProcess;

  // Format currency with standard support
  const formatCurrencyValue = (val: number, customCurrency?: string) =>
    formatMoney(val, customCurrency || activeCurrency);

  const lookupTerm = searchTerm.toLowerCase();
  const filteredLookupProducts = showProductLookup
    ? products.filter(p => p.name.toLowerCase().includes(lookupTerm) || p.sku?.toLowerCase().includes(lookupTerm)).slice(0, 100)
    : [];

  return (
    <div className="flex-1 p-2 sm:p-4 lg:p-6 flex flex-col min-h-[85vh] text-slate-800 dark:text-slate-100" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Title & Mode Switcher header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-200/60 dark:border-slate-800/60">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-600 text-white rounded-xl">
              <Barcode size={22} />
            </span>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {isRtl ? 'نظام المبيعات والتوريد المباشر بالباركود' : 'Direct Sales & Supply POS'}
            </h1>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold mt-1">
            {isRtl ? 'امسح الباركود، أو انقر على المنتجات للبيع السريع، أو ابحث يدوياً' : 'Scan items, tap menu cards, or search manually for fast checkouts'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
        {posMode === 'sale' && (
          <button
            type="button"
            onClick={() => {
              void openCustomerScreen();
            }}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 cursor-pointer transition-colors"
            title={isRtl ? 'فتح شاشة العميل على الشاشة الثانية' : 'Open customer display on the second screen'}
          >
            <MonitorSmartphone size={15} />
            {isRtl ? 'شاشة العميل' : 'Customer display'}
          </button>
        )}
        {posMode === 'sale' && canProcessReturn && (
          <button
            type="button"
            onClick={() => {
              setReturnQuery('');
              setShowReturnLookup(true);
            }}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 cursor-pointer transition-colors"
            title={isRtl ? 'مرتجع مبيعات (F6)' : 'Sales return (F6)'}
          >
            <Undo2 size={15} />
            {isRtl ? 'مرتجع (F6)' : 'Return (F6)'}
          </button>
        )}
        {posMode === 'sale' && can('back_office') && (
          <button
            type="button"
            onClick={() => {
              setShiftPanelTab('day');
              setShowShiftPanel(true);
            }}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 cursor-pointer transition-colors"
            title={isRtl ? 'ملخص إقفال يوم المتجر' : 'Store day-close summary'}
          >
            <CalendarClock size={15} />
            {isRtl ? 'إقفال اليوم' : 'Day close'}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setShiftPanelTab('drawer');
            setShowShiftPanel(true);
          }}
          className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-black cursor-pointer transition-colors ${
            myShift
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300'
          }`}
        >
          <Clock size={15} />
          {myShift
            ? (isRtl
              ? `عدّ الدرج منذ ${new Date(myShift.openedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`
              : `Drawer count since ${new Date(myShift.openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`)
            : (isRtl ? 'عدّ الدرج' : 'Drawer count')}
        </button>
        {/* Premium Mode Segment Switcher */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-900/60 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 w-fit self-start shrink-0 select-none">
          <button 
            type="button"
            onClick={() => switchMode('sale')}
            className={`px-5 py-2.5 rounded-xl text-xs font-black tracking-tight transition-all duration-300 flex items-center gap-2 cursor-pointer ${
              posMode === 'sale' 
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md' 
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <ShoppingCart size={15} />
            <span>{isRtl ? 'نقطة البيع' : 'POS'}</span>
          </button>
          
          {can('back_office') && <button 
            type="button"
            onClick={() => switchMode('purchase')}
            className={`px-5 py-2.5 rounded-xl text-xs font-black tracking-tight transition-all duration-300 flex items-center gap-2 cursor-pointer ${
              posMode === 'purchase' 
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md' 
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <Truck size={15} />
            <span>{isRtl ? 'وضع توريد البضائع' : 'Stock Supply Mode'}</span>
          </button>}
        </div>
        </div>
      </div>
      <ShiftPanel
        isOpen={showShiftPanel}
        onClose={() => setShowShiftPanel(false)}
        language={isRtl ? 'ar' : 'en'}
        defaultCurrency={activeCurrency}
        initialTab={shiftPanelTab}
      />

      {posMode === 'sale' && requireOpenShift && !myShift && !can('back_office') && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span>{isRtl ? 'البيع متوقف حتى فتح عدّ الدرج لهذه الجلسة.' : 'Selling is blocked until you open a drawer count for this session.'}</span>
          <button
            type="button"
            onClick={() => {
              setShiftPanelTab('drawer');
              setShowShiftPanel(true);
            }}
            className="rounded-xl bg-amber-600 px-3 py-1.5 text-white cursor-pointer"
          >
            {isRtl ? 'فتح الوردية' : 'Open shift'}
          </button>
        </div>
      )}

      {/* Main Grid Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6 flex-1 items-stretch">
        
        {/* Left Side: Product Grid, touch points, categories, barcode scan bar */}
        <div className="lg:col-span-2 flex flex-col gap-4 min-w-0 box-border">
          
          {/* 1. Barcode scanning bar input */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch w-full">
            <form onSubmit={handleBarcodeSubmit} className="relative flex-1">
              <input 
                ref={scannerInputRef}
                type="text" 
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder={isRtl ? "امسح الباركود أو اكتب الرمز" : "Scan a barcode or type the SKU"} aria-label={isRtl ? "امسح الباركود أو اكتب رمز الصنف" : "Scan a barcode or type the SKU"} 
                className="w-full bg-white dark:bg-white/[0.03] border-2 border-emerald-500/50 focus:border-emerald-500 rounded-xl ps-5 pe-5 xl:pe-32 py-4 text-emerald-600 dark:text-emerald-400 font-arabic tabular-nums text-base font-bold placeholder:font-medium placeholder:text-slate-400 shadow-sm outline-none transition-colors truncate"
                autoFocus={stickyScannerFocus}
                inputMode={touchPos && !wedgeScannerMode ? 'search' : undefined}
                enterKeyHint="done"
              />
              <div className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-emerald-600 dark:text-emerald-400 font-bold hidden xl:flex items-center gap-2 text-xs whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>{isRtl ? 'جاهز للمسح' : 'Ready to scan'}</span>
              </div>
            </form>
            <button
              type="button"
              onClick={() => setIsCameraScanning(true)}
              className="px-6 py-4 sm:py-0 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:via-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold flex items-center justify-center gap-2.5 transition shadow-lg shadow-cyan-500/15 active:scale-95 cursor-pointer text-xs md:text-sm shrink-0 border border-cyan-400/20"
              title={isRtl ? "مسح الباركود باستخدام الكاميرا" : "Scan barcode using Camera"} aria-label={isRtl ? "مسح الباركود باستخدام الكاميرا" : "Scan barcode using Camera"}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-200 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-200"></span>
              </span>
              <span className="text-base sm:text-lg">📸</span>
              <span>{isRtl ? 'مسح باركود الكاميرا' : 'Camera Scan Barcode'}</span>
            </button>
          </div>

          {/* 2. Quick camera & manual inventory helper lookup buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-white/[0.02] p-3 rounded-xl border border-slate-200/50 dark:border-white/5">
            <div className="flex flex-wrap items-center gap-2">
              <button 
                type="button"
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isCameraScanning ? 'bg-cyan-500 text-white' : 'bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10'
                }`}
                onClick={() => setIsCameraScanning(true)}
              >
                📊 {isRtl ? "تفعيل مسح الكاميرا" : "Scan via Device Camera"}
              </button>
              {touchPos && (
                <button
                  type="button"
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    wedgeScannerMode
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10'
                  }`}
                  onClick={() => {
                    setWedgeScannerMode((on) => {
                      const next = !on;
                      if (next) window.setTimeout(() => scannerInputRef.current?.focus({ preventScroll: true }), 0);
                      else scannerInputRef.current?.blur();
                      return next;
                    });
                  }}
                  title={isRtl
                    ? 'لماسح باركود بلوتوث يعمل كلوحة مفاتيح. يبقي الحقل مركّزاً وقد تظهر لوحة المفاتيح.'
                    : 'For a Bluetooth barcode scanner that types like a keyboard. Keeps the field focused; the soft keyboard may appear.'}
                  aria-pressed={wedgeScannerMode}
                >
                  {wedgeScannerMode
                    ? (isRtl ? 'وضع الماسح: يعمل' : 'Scanner mode: on')
                    : (isRtl ? 'وضع الماسح' : 'Scanner mode')}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setShowProductLookup(true);
                }}
                className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 hover:text-indigo-600 transition"
              >
                🔍 {isRtl ? 'البحث بالاسم' : 'Lookup Item'}
              </button>

              {posMode === 'sale' && (
                <>
                  <span className="h-4 w-[1px] bg-slate-200 dark:bg-white/10" />
                  <button
                    type="button"
                    onClick={() => {
                      setAdhocForm({ description: '', quantity: '1', unitPrice: '', unitCost: '' });
                      setShowAdhocModal(true);
                    }}
                    className="text-xs font-bold text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5 hover:text-cyan-600 transition cursor-pointer"
                    title={isRtl ? 'بند حر أو خدمة بدون مخزون' : 'Free/service line without stock'}
                  >
                    {isRtl ? 'بند حر (F8)' : 'Free item (F8)'}
                  </button>
                </>
              )}

              {canManageCatalog && <>
              <span className="h-4 w-[1px] bg-slate-200 dark:bg-white/10" />

              <button
                type="button"
                onClick={() => {
                  setQuickRegForm(emptyQuickRegForm(warehouses?.[0]?.id || ''));
                  setShowQuickRegModal(true);
                }}
                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 hover:text-emerald-500 transition cursor-pointer"
              >
                {isRtl ? 'تسجيل منتج سريع (F7)' : 'Quick product (F7)'}
              </button>
              </>}
            </div>
          </div>

          {/* 3. Horizontal scrolling category filter strip (Cafe style) */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide w-full box-border">
            {categoriesList.map((cat) => {
              const count = cat === 'all' 
                ? displayedProducts.length 
                : categoryCounts.get(cat) || 0;
              
              const label = cat === 'all' 
                ? (isRtl ? 'الكل' : 'All Items')
                : cat;
              
              const isSelected = selectedCategory === cat;
              return (
                <button 
                  key={cat} 
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`whitespace-nowrap px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isSelected 
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-md' 
                      : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  {label} <span className="text-[10px] opacity-60 font-mono">({count})</span>
                </button>
              );
            })}
          </div>

          {/* 4. Touch grid displaying products based on active category */}
          <div className="flex-1 overflow-y-auto max-h-[550px] w-full box-border pr-1">
            {displayedProducts.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center gap-2 py-16 px-6 rounded-xl border border-dashed border-slate-300 dark:border-white/10">
                <Package size={28} className="text-slate-400" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {isRtl ? 'لا توجد أصناف في المخزون بعد' : 'No products in inventory yet'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                  {isRtl
                    ? 'أضف أصنافك من شاشة المخزون أو بالتسجيل السريع (F7)، ثم امسح الباركود أو اختر الصنف للبيع.'
                    : 'Add products from Inventory or Quick Register (F7), then scan or tap a product to sell.'}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 w-full box-border">
              {gridPage.visible
                .map((product) => {
                  const emoji = productVisualEmoji(product.category, product.name);
                  const tone = productVisualTone(product.category, product.name);
                  const rawPrice = posMode === 'sale' ? product.sellingPrice : product.unitCost;
                  const baseCurrency = product.currency || settings?.currency || 'JOD';
                  const activePrice = safeConvertMoney(rawPrice, baseCurrency, activeCurrency, usdUnitRates);

                  return (
                    <button 
                      key={product.id} 
                      type="button"
                      onClick={() => addItemToPOS(product)}
                      className="group relative flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.02] hover:border-emerald-500/50 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all duration-200 active:scale-95 min-h-[120px] box-border cursor-pointer shadow-sm text-center"
                    >
                      <span className={`text-3xl mb-1.5 w-12 h-12 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform ${tone}`}>
                        {emoji}
                      </span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 line-clamp-2 w-full text-center">
                        {product.name}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {isRtl ? 'بالمخزن:' : 'Qty:'} {formatPackStock(product.quantity, product, isRtl) ?? product.quantity}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold mt-1 text-xs">
                        {activePrice === null ? '—' : formatCurrencyValue(activePrice)}
                      </span>
                    </button>
                  );
                })}
            </div>
            <ShowMoreBar isRtl={isRtl} shown={gridPage.shown} total={gridPage.total} pageSize={gridPage.pageSize} onMore={gridPage.showMore} onAll={gridPage.showAll} />
          </div>

          {/* Keyboard Shortcuts indicators inside active terminal */}
          <div className="mt-4 pt-3 border-t border-slate-200/50 dark:border-slate-800/80 flex flex-wrap items-center gap-2.5 text-[10px] text-slate-400 font-extrabold select-none font-arabic">
            <span className="bg-slate-100 dark:bg-slate-900 border border-slate-200/40 px-2 py-0.5 rounded text-slate-700 dark:text-slate-400">
              <kbd className="font-mono bg-white dark:bg-slate-950 px-1 border border-slate-300 dark:border-white/10 rounded">F9</kbd> {isRtl ? 'تركيز الماسح الكاشف' : 'Focus Scanner'}
            </span>
            <span className="bg-slate-100 dark:bg-slate-900 border border-slate-200/40 px-2 py-0.5 rounded text-slate-700 dark:text-slate-400">
              <kbd className="font-mono bg-white dark:bg-slate-950 px-1 border border-slate-300 dark:border-white/10 rounded">F2</kbd> {isRtl ? 'تعليق الفاتورة' : 'Hold/Suspend'}
            </span>
            <span className="bg-slate-100 dark:bg-slate-900 border border-slate-200/40 px-2 py-0.5 rounded text-slate-700 dark:text-slate-400 text-rose-600 dark:text-rose-400">
              <kbd className="font-mono bg-white dark:bg-slate-950 px-1 border border-rose-300 dark:border-rose-900/40 rounded text-rose-600">F4</kbd> {isRtl ? 'إلغاء الفاتورة بالكامل' : 'Cancel/Clear Invoice'}
            </span>
            <span className="bg-slate-100 dark:bg-slate-900 border border-slate-200/40 px-2 py-0.5 rounded text-slate-700 dark:text-slate-400">
              <kbd className="font-mono bg-white dark:bg-slate-950 px-1 border border-slate-300 dark:border-white/10 rounded">F3</kbd> {isRtl ? 'تركيز الخصم' : 'Focus Discount'}
            </span>
            <span className="bg-slate-100 dark:bg-slate-900 border border-slate-200/40 px-2 py-0.5 rounded text-slate-700 dark:text-slate-400">
              <kbd className="font-mono bg-white dark:bg-slate-950 px-1 border border-slate-300 dark:border-white/10 rounded">F10</kbd> {isRtl ? 'دفع فوري' : 'Submit Check'}
            </span>
          </div>

        </div>

        {/* Right Side: Invoice settlement, shopping cart & pay tools (Cart & Checkout) */}
        <div className="w-full lg:w-96 xl:w-[410px] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-[#0f172a] box-border overflow-hidden shrink-0">
          
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] flex justify-between items-center box-border">
            <div className="flex items-center gap-2">
              <ShoppingCart size={16} className="text-emerald-500" />
              <h2 className="font-bold text-slate-900 dark:text-white text-sm">
                {isRtl ? 'الفاتورة الحالية' : 'Current Checkout Invoice'}
              </h2>
            </div>
            <span className="text-xs font-mono bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 px-2 py-1 rounded">
              #{previewInvoiceNo}
            </span>
          </div>

          <div className="px-4 py-3 bg-slate-100 dark:bg-white/[0.01] border-b border-slate-200/50 dark:border-white/5 space-y-2">
            <CurrencyPicker
              value={activeCurrency}
              onChange={(code) => handleCurrencyChange(code)}
              isRtl={isRtl}
              label={isRtl ? 'عملة الصندوق' : 'Checkout currency'}
            />
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              <span>
                {activeCurrency === storeCurrency
                  ? (isRtl ? `الأسعار بعملة ${activeCurrency}` : `Prices in ${activeCurrency}`)
                  : `1 ${storeCurrency} = ${(() => {
                      const rate = safeConvertMoney(1, storeCurrency, activeCurrency, usdUnitRates);
                      return rate === null ? '—' : formatMoney(rate, activeCurrency);
                    })()}`}
                {' · '}
                {settings?.useManualExchangeRates
                  ? (isRtl ? 'سعر يدوي' : 'Manual')
                  : liveRates
                    ? (isRtl ? 'سعر مباشر' : 'Live')
                    : (isRtl ? 'سعر احتياطي' : 'Fallback')}
                {ratesAt ? ` · ${new Date(ratesAt).toLocaleTimeString(isRtl ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' })}` : ''}
              </span>
              <button
                type="button"
                onClick={() => refreshRates(true)}
                disabled={ratesLoading}
                className="text-emerald-600 dark:text-emerald-400 font-bold disabled:opacity-50"
              >
                {ratesLoading ? '...' : (isRtl ? 'تحديث' : 'Refresh')}
              </button>
            </div>
          </div>

          {/* Suspended Bills Management Banner */}
          {posMode === 'sale' && heldBills.length > 0 && (
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-800/80 flex flex-col gap-2 transition-all">
              <div className="flex justify-between items-center text-xs text-slate-700 dark:text-slate-300 font-black">
                <span className="flex items-center gap-1.5 font-arabic">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                  {isRtl ? 'الفواتير المعلقة بانتظار الصندوق (' : 'Suspended Bills ('}
                  <span className="text-amber-600 dark:text-amber-400">{parkedHeldBills(heldBills).length}</span>)
                </span>
                <span className="text-[10px] text-slate-400 font-medium font-arabic">
                  {isRtl ? 'محلية لهذا الجهاز · لا حجز مخزون سحابي' : 'This device only · no cloud stock hold'}
                </span>
              </div>
              
              <div className="grid grid-cols-1 gap-2 max-h-[160px] overflow-y-auto pr-1">
                {heldBills.map(bill => {
                  const isOpen = (bill.status || 'parked') === 'open';
                  const itemsCount = bill.itemCount ?? bill.items.reduce((acc, item) => acc + lineUnits(item), 0);
                  const billTotal = bill.totalAmount ?? bill.items.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
                  const displayTime = bill.time || new Date(bill.date || Date.now()).toLocaleTimeString(isRtl ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
                  const billCurrency = bill.currency || activeCurrency;
                  
                  return (
                    <div 
                      key={bill.id} 
                      className={`group flex flex-col gap-1.5 bg-white dark:bg-slate-950 border rounded-xl p-2.5 shadow-xs transition-all font-arabic relative overflow-hidden ${
                        isOpen
                          ? 'border-emerald-400/50 dark:border-emerald-500/30'
                          : 'border-slate-200 dark:border-slate-800/65 hover:border-amber-500/50 dark:hover:border-amber-500/30'
                      }`}
                    >
                      <span className={`absolute top-0 bottom-0 left-0 w-1 opacity-70 group-hover:opacity-100 transition-opacity ${isOpen ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      
                      <div className="flex items-center justify-between gap-2 pl-1.5">
                        <span className="text-xs font-mono font-black text-slate-800 dark:text-slate-200">
                          #{bill.invoiceNumber}
                          {isOpen && (
                            <span className="ms-2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                              {isRtl ? 'في السلة' : 'In cart'}
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400 font-mono flex items-center gap-0.5">
                            {displayTime}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDiscardHeldBill(bill.id)}
                            className="text-slate-400 hover:text-rose-500 transition-colors font-medium p-1 text-[11px] hover:bg-slate-100 dark:hover:bg-white/5 rounded-md cursor-pointer"
                            title={isRtl ? "إلغاء وإتلاف الفاتورة" : "Delete held bill"} aria-label={isRtl ? "إلغاء وإتلاف الفاتورة" : "Delete held bill"}
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-between items-center text-[11px] leading-none pl-1.5">
                        <div className="text-slate-500 dark:text-slate-400 font-medium">
                          {isRtl ? `عدد الأصناف: ${itemsCount}` : `Items: ${itemsCount}`}
                        </div>
                        <div className="text-slate-900 dark:text-amber-400 font-extrabold font-mono text-xs">
                          {formatMoney(Number(billTotal) || 0, billCurrency)}
                        </div>
                      </div>

                      {!isOpen && (
                        <button
                          type="button"
                          onClick={() => handleRestoreBill(bill)}
                          className="mt-1 w-full flex items-center justify-center gap-1 py-1.5 bg-amber-500/10 hover:bg-amber-600 hover:text-white text-amber-700 dark:text-amber-300 rounded-lg text-[11px] font-bold transition-all border border-amber-500/20 active:scale-[0.98] cursor-pointer"
                        >
                          {isRtl ? 'استرجاع الفاتورة' : 'Restore bill'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Scrollable invoice active slots */}
          <div className="flex-1 overflow-y-auto p-3 box-border space-y-2 max-h-[350px]">
            {scannedItems.length === 0 ? (
              <div className="text-center py-20 flex flex-col items-center justify-center space-y-2">
                <span className="text-3xl">🛒</span>
                <span className="text-xs text-slate-400 font-bold">
                  {isRtl ? 'سلة المشتريات فارغة حالياً' : 'Your cart is currently empty'}
                </span>
                <p className="text-[10px] text-slate-400 max-w-xs px-4">
                  {isRtl ? 'امسح الباركود الخاص بالقطعة أو اضغط على أحد المنتجات السريعة باليمين لبدء الفاتورة.' : 'Scan code or click easy-selection products to start.'}
                </p>
              </div>
            ) : (
              scannedItems.map((item) => {
                const free = isAdhocLine(item);
                const origin = free ? undefined : products.find(p => p.id === item.productId);
                const key = lineKey(item);
                const pack = origin ? productPack(origin) : null;
                const unitName = origin?.unitName?.trim() || (isRtl ? 'وحدة' : 'unit');
                const packName = pack?.name || (isRtl ? 'عبوة' : 'pack');
                return (
                  <div 
                    key={key} 
                    className={`flex flex-col p-3 rounded-xl border transition-all duration-300 w-full box-border ${
                      item.productId === lastScannedProductId
                        ? 'bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-500/30 shadow-md shadow-emerald-500/20'
                        : free
                          ? 'border-cyan-200/80 bg-cyan-50/50 dark:border-cyan-500/20 dark:bg-cyan-500/[0.06]'
                          : 'border-slate-100 bg-slate-50 dark:border-white/5 dark:bg-white/[0.02] hover:border-slate-300 dark:hover:border-white/10'
                    }`}
                  >
                    <div className="flex justify-between items-start w-full gap-2">
                      <span className="font-semibold text-xs text-slate-800 dark:text-slate-200 line-clamp-2">
                        {item.description}
                        {free && (
                          <span className="ms-1.5 inline-flex align-middle px-1.5 py-0.5 rounded-md text-[9px] font-black bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/20">
                            {isRtl ? 'حر' : 'Free'}
                          </span>
                        )}
                      </span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 shrink-0 text-xs">
                        {formatCurrencyValue(item.total)}
                      </span>
                    </div>

                    {/* Quantity state controls */}
                    <div className="flex justify-between items-center mt-3.5 w-full">
                      <span className="flex flex-col gap-1">
                        <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 flex-wrap">
                          {canAdjustLinePrice && posMode === 'sale' ? (
                            <input
                              type="number"
                              min={0}
                              step={10 ** -currencyDecimals(activeCurrency)}
                              defaultValue={item.unitPrice}
                              key={`${key}-${item.unitPrice}`}
                              onBlur={(e) => {
                                const next = Number(e.target.value);
                                if (Number.isFinite(next) && Math.abs(next - item.unitPrice) > 1e-9) {
                                  setItemUnitPrice(key, e.target.value);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              className="w-20 rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 px-1.5 py-0.5 text-[11px] font-mono font-bold text-slate-800 dark:text-slate-100"
                              title={isRtl ? 'تعديل سعر السطر' : 'Edit line price'}
                              aria-label={isRtl ? 'سعر السطر' : 'Line price'}
                            />
                          ) : (
                            formatCurrencyValue(item.unitPrice)
                          )}
                          <span>
                            / {free
                              ? (isRtl ? 'بدون مخزون' : 'no stock')
                              : isPackLine(item)
                                ? `${item.packName || packName} (${item.packSize})`
                                : (pack ? unitName : (isRtl ? 'للوحدة' : 'unit'))}
                          </span>
                        </span>
                        {pack && !free && (
                          <span className="inline-flex w-fit rounded-md border border-slate-200 dark:border-white/10 overflow-hidden text-[10px] font-bold" role="group" aria-label={isRtl ? 'البيع بالوحدة أو بالعبوة' : 'Sell by unit or pack'}>
                            {[false, true].map((asPack) => {
                              const active = isPackLine(item) === asPack;
                              return (
                                <button
                                  key={String(asPack)}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() => { if (!active) toggleLinePack(key); }}
                                  className={`px-2 py-0.5 transition-colors ${active ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10'}`}
                                >
                                  {asPack ? packName : unitName}
                                </button>
                              );
                            })}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2 bg-white dark:bg-black/20 rounded-lg p-1 border border-slate-200 dark:border-white/5">
                        <button 
                          type="button"
                          onClick={() => updateItemQty(key, -1)}
                          className="w-6 h-6 rounded bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-700 dark:text-white hover:bg-rose-500 hover:text-white transition-colors text-xs font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <QtyInput
                          value={item.quantity}
                          onCommit={(qty) => setItemQty(key, qty)}
                          className="w-10 bg-transparent text-center font-bold text-xs text-slate-900 dark:text-white border-0 p-0 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded font-mono select-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          style={{ MozAppearance: 'textfield' }}
                        />
                        <button 
                          type="button"
                          onClick={() => updateItemQty(key, 1)}
                          className="w-6 h-6 rounded bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-700 dark:text-white hover:bg-emerald-500 hover:text-white transition-colors text-xs font-bold cursor-pointer"
                        >
                          +
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => removeItem(key)}
                          className="text-slate-300 hover:text-rose-600 transition p-1 ml-1"
                          title={isRtl ? "حذف" : "Remove"} aria-label={isRtl ? "حذف" : "Remove"}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Math calculation blocks */}
          <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] box-border space-y-3.5">
            
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>{isRtl ? 'المجموع الأساسي الفرعي:' : 'Subtotal:'}</span>
                <span className="font-mono font-semibold">{formatCurrencyValue(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                <label className="flex items-center gap-1.5 cursor-pointer select-none py-0.5">
                  <input 
                    type="checkbox" 
                    id="enable-vat-tax-checkbox"
                    checked={enableTax} 
                    onChange={(e) => {
                      setEnableTax(e.target.checked);
                    }}
                    className="w-3.5 h-3.5 rounded border-slate-300 dark:border-white/10 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                  />
                  <span className="text-xs font-black font-arabic text-slate-700 dark:text-slate-300">
                    {isRtl ? `تفعيل الضريبة (${vatRate}%) [اختياري]:` : `VAT Tax (${vatRate}%) [Optional]:`}
                  </span>
                </label>
                <span className="font-mono font-semibold">{formatCurrencyValue(taxAmount)}</span>
              </div>
              
              {/* Settlements Quick Discount Option */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  🏷️ {isRtl ? `خصم وتنزيل مباشر (${POS_SYMBOLS[activeCurrency] || activeCurrency}) [F3]:` : `Direct Discount (${POS_SYMBOLS[activeCurrency] || activeCurrency}) [F3]:`}
                </span>
                <input 
                  type="number" 
                  min="0"
                  ref={discountInputRef}
                  placeholder="0.00"
                  value={discount || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setDiscount(isNaN(val) ? 0 : val);
                  }}
                  className="w-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-0.5 text-center font-mono text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Grand Total Block */}
              <div className="flex justify-between items-center pt-2.5 border-t border-slate-200 dark:border-white/5 mt-2">
                <span className="text-sm font-black text-slate-900 dark:text-white">
                  {isRtl ? 'الإجمالي المطلوب:' : 'Grand Due:'}
                </span>
                <div className="text-left select-text">
                  <div className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                    {formatCurrencyValue(grandTotal)}
                  </div>
                  <div className="flex items-center gap-1.5 justify-end mt-0.5">
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 select-all">
                      {(() => {
                        const alt = activeCurrency === 'USD' ? 'JOD' : 'USD';
                        const altAmt = safeConvertMoney(grandTotal, activeCurrency, alt, usdUnitRates);
                        return altAmt === null ? '' : `≈ ${formatCurrencyValue(altAmt, alt)}`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Direct Sales Advanced Checkout Panel */}
            {posMode === 'sale' && scannedItems.length > 0 && (
              <div className="bg-slate-100/50 dark:bg-black/30 p-2.5 rounded-xl border border-slate-200/50 dark:border-white/5 space-y-2 transition-all">
                <div className="space-y-1.5">
                  <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <User size={11} />
                    {isRtl ? 'العميل (مطلوب للدين):' : 'Customer (required for credit):'}
                  </span>
                  {selectedCustomer ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200/60 dark:border-emerald-500/20 bg-emerald-50/80 dark:bg-emerald-500/10 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">{selectedCustomer.name}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                          {isRtl ? 'دين حالي' : 'Debt'} {formatMoney(Number(selectedCustomer.totalDebt) || 0, selectedCustomer.currency || activeCurrency)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedCustomerId(''); setCustomerQuery(''); }}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                        aria-label={isRtl ? 'إزالة العميل' : 'Clear customer'}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <input
                        type="search"
                        value={customerQuery}
                        onChange={(e) => setCustomerQuery(e.target.value)}
                        placeholder={isRtl ? 'ابحث بالاسم أو الهاتف…' : 'Search name or phone…'}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      {customerQuery.trim() && (
                        <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950">
                          {customerMatches.length === 0 ? (
                            <p className="px-2.5 py-2 text-[10px] text-slate-400">{isRtl ? 'لا نتائج' : 'No matches'}</p>
                          ) : customerMatches.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => { setSelectedCustomerId(c.id); setCustomerQuery(''); }}
                              className="w-full text-start px-2.5 py-1.5 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-500/10 cursor-pointer border-b border-slate-100 dark:border-white/5 last:border-0"
                            >
                              <span className="font-bold text-slate-800 dark:text-slate-100">{c.name}</span>
                              {c.phone ? <span className="text-slate-400 ms-2 font-mono text-[10px]">{c.phone}</span> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 block">
                  {isRtl ? 'طريقة الدفع:' : 'Payment method:'}
                </span>
                
                {/* Gateway Selector Tabs */}
                <div className="grid grid-cols-3 gap-1 px-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod('cash');
                      setReceivedAmount('');
                    }}
                    className={`py-1.5 text-[10px] font-black rounded-lg border flex flex-col items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                      paymentMethod === 'cash'
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                        : 'bg-white dark:bg-white/[0.02] border-slate-200 dark:border-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <Coins size={12} />
                    <span>{isRtl ? 'نقدي' : 'Cash'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod('card');
                      setReceivedAmount(grandTotal.toFixed(currencyDecimals(activeCurrency)));
                    }}
                    className={`py-1.5 text-[10px] font-black rounded-lg border flex flex-col items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                      paymentMethod === 'card'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-white dark:bg-white/[0.02] border-slate-200 dark:border-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <CreditCard size={12} />
                    <span>{isRtl ? 'بطاقة بنكية' : 'Card'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod('wallet');
                      setReceivedAmount(grandTotal.toFixed(currencyDecimals(activeCurrency)));
                    }}
                    className={`py-1.5 text-[10px] font-black rounded-lg border flex flex-col items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                      paymentMethod === 'wallet'
                        ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                        : 'bg-white dark:bg-white/[0.02] border-slate-200 dark:border-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <Smartphone size={12} />
                    <span>{isRtl ? 'محفظة جوال' : 'Wallet'}</span>
                  </button>
                </div>

                {(paymentMethod === 'card' || paymentMethod === 'wallet') && (
                  <p className="text-[10px] font-bold leading-snug text-slate-500 dark:text-slate-400 px-0.5">
                    {paymentMethod === 'card'
                      ? (isRtl
                        ? 'البطاقة تُسجَّل كمبيعات فقط؛ المبلغ لا يدخل الخزنة ولا درج النقد (يُحصَّل عبر الجهاز البنكي).'
                        : 'Card is recorded as a sale only; it does not enter the vault or cash drawer (settled on the bank terminal).')
                      : (isRtl
                        ? 'المحفظة تُسجَّل كمبيعات فقط؛ المبلغ لا يدخل الخزنة ولا درج النقد (يبقى في المحفظة الإلكترونية).'
                        : 'Wallet is recorded as a sale only; it does not enter the vault or cash drawer (stays in the e-wallet).')}
                  </p>
                )}

                {/* Cash Calculator Box */}
                {paymentMethod === 'cash' && (
                  <div className="pt-2 border-t border-slate-200/50 dark:border-white/5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 shrink-0">
                        {isRtl ? 'المبلغ المستلم:' : 'Amount Received:'}
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={receivedAmount}
                        onChange={(e) => setReceivedAmount(e.target.value)}
                        className="w-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-0.5 text-center font-mono text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>

                    {/* Change / on-account preview */}
                    {(() => {
                      const rec = parseFloat(receivedAmount);
                      const hasRec = receivedAmount !== '' && Number.isFinite(rec);
                      const over = hasRec && rec >= grandTotal - 1e-6;
                      const under = hasRec && rec < grandTotal - 1e-6;
                      const onAccount = under && !!selectedCustomer;
                      const short = under && !selectedCustomer;
                      return (
                    <div className={`p-1.5 rounded-lg border text-center transition-colors text-xs font-medium ${
                      over
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                        : onAccount
                          ? 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300'
                          : short
                            ? 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400'
                            : 'bg-slate-100 dark:bg-slate-800/40 border-transparent text-slate-500 dark:text-slate-400'
                    }`}>
                      <div className="text-[9px] font-bold">
                        {!hasRec
                          ? (isRtl ? 'المبلغ المتبقي للعميل:' : 'Change to return:')
                          : over
                            ? (isRtl ? 'الباقي للعميل:' : 'Change to return:')
                            : onAccount
                              ? (isRtl ? 'نقد الآن · الباقي ديناً على العميل' : 'Cash now · remainder on account')
                              : (isRtl ? 'اختر عميلاً لتسجيل الباقي ديناً، أو أكمل المبلغ' : 'Select a customer for the remainder, or take full payment')
                        }
                      </div>
                      <div className="font-mono font-black text-sm mt-0.5">
                        {over
                          ? formatCurrencyValue(rec - grandTotal)
                          : onAccount
                            ? `${formatCurrencyValue(Math.max(0, rec))} + ${formatCurrencyValue(grandTotal - Math.max(0, rec))}`
                            : formatCurrencyValue(0)
                        }
                      </div>
                    </div>
                      );
                    })()}

                    {/* Quick money keyboard tags */}
                    <div className="grid grid-cols-4 gap-1 pt-0.5">
                      {(QUICK_CASH[activeCurrency] || QUICK_CASH.USD).map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => {
                            const cur = parseFloat(receivedAmount) || 0;
                            setReceivedAmount((cur + num).toString());
                          }}
                          className="py-1 text-[9px] font-mono font-bold rounded bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 cursor-pointer text-center"
                        >
                          +{num}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Submit checkout triggers */}
            <div className="grid grid-cols-2 gap-3 w-full box-border pt-1">
              <button 
                type="button"
                onClick={() => {
                  if (posMode === 'sale') {
                    handleSuspendBill();
                  } else {
                    handleSubmitProcess();
                  }
                }}
                disabled={isSubmitting || scannedItems.length === 0}
                className="py-3 rounded-xl bg-slate-200 dark:bg-white/10 text-slate-800 dark:text-white font-bold hover:bg-slate-300 dark:hover:bg-white/20 transition-all flex items-center justify-center gap-1.5 text-xs cursor-pointer disabled:opacity-50"
              >
                {posMode === 'sale' ? (
                  <>
                    <PauseCircle size={14} className="text-amber-500 animate-pulse" />
                    <span>{isRtl ? 'تعليق الفاتورة (F2)' : 'Suspend Bill (F2)'}</span>
                  </>
                ) : (
                  <span>📥 {isRtl ? 'تأكيد التوريد والترحيل' : 'Submit Inventory'}</span>
                )}
              </button>
              
              <button 
                type="button"
                onClick={() => {
                  if (posMode === 'sale' && paymentMethod === 'cash') {
                    const rec = parseFloat(receivedAmount);
                    const hasRec = receivedAmount !== '' && Number.isFinite(rec);
                    if (!hasRec || rec >= grandTotal - 1e-6 || selectedCustomerId) {
                      handleSubmitProcess();
                    } else {
                      setShowCashPaymentModal(true);
                    }
                  } else {
                    handleSubmitProcess();
                  }
                }}
                disabled={
                  isSubmitting ||
                  scannedItems.length === 0 ||
                  (posMode === 'sale' && paymentMethod === 'cash' && receivedAmount !== '' && parseFloat(receivedAmount) < grandTotal - 1e-6 && !selectedCustomerId)
                }
                className="py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black transition-all flex items-center justify-center gap-1.5 text-xs shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
              >
                <span>
                  {posMode === 'sale' && paymentMethod === 'cash' && selectedCustomerId && receivedAmount !== '' && parseFloat(receivedAmount) < grandTotal - 1e-6
                    ? (isRtl ? 'نقد + آجل وطباعة' : 'Cash + credit & print')
                    : (isRtl ? 'إتمام وطباعة [Enter]' : 'Pay & Print [Enter]')}
                </span>
              </button>
            </div>

          </div>

        </div>

      </div>

      {/* Dynamic Product Lookup Modal Dialog */}
      <AnimatePresence>
        {showProductLookup && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-950 rounded-[2rem] border border-slate-200 dark:border-slate-800 p-6 max-w-lg w-full shadow-2xl space-y-4"
            >
              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
                <h3 className="font-black text-slate-900 dark:text-white text-base">
                  {isRtl ? 'البحث التفصيلي عن صنف في المستودع' : 'Filter & Add Warehouse Item'}
                </h3>
                <button 
                  type="button" 
                  onClick={() => setShowProductLookup(false)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400">
                  <Search size={16} />
                </div>
                <input 
                  type="text"
                  placeholder={isRtl ? "اكتب اسم المادة أو الـ SKU المفقود..." : "Type text search SKU description..."} aria-label={isRtl ? "اكتب اسم المادة أو الـ SKU المفقود..." : "Type text search SKU description..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pr-10 pl-4 py-2.5 text-xs text-slate-900 dark:text-white"
                  autoFocus
                />
              </div>

              {/* Results */}
              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {filteredLookupProducts.length === 0 ? (
                  <p className="text-center py-6 text-xs text-slate-400 font-extrabold">{isRtl ? 'لم نعثر على أي أصناف مطابقة!' : 'No matching items found!'}</p>
                ) : (
                  filteredLookupProducts.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        addItemToPOS(p);
                        setShowProductLookup(false);
                      }}
                      className="w-full p-3 bg-slate-50 hover:bg-indigo-50 dark:bg-slate-900 dark:hover:bg-slate-950/60 rounded-xl flex items-center justify-between border border-transparent hover:border-slate-200 text-right cursor-pointer"
                    >
                      <div className="space-y-0.5">
                        <p className="font-extrabold text-xs text-slate-900 dark:text-white">{p.name}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">SKU: {p.sku || p.id} • {isRtl ? 'المتوفر:' : 'Qty:'} {p.quantity}</p>
                      </div>
                      <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 font-mono">
                        {(() => {
                          const shown = safeConvertMoney(
                            posMode === 'sale' ? p.sellingPrice : p.unitCost,
                            p.currency || settings?.currency || 'JOD',
                            activeCurrency,
                            usdUnitRates,
                          );
                          return shown === null ? '—' : formatCurrencyValue(shown);
                        })()}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Receipt Check Dialog */}
      <AnimatePresence>
        {showSuccessModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-950 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 p-8 max-w-md w-full shadow-2xl text-center space-y-6"
            >
              <div className="flex flex-col items-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-500 dark:text-emerald-400 flex items-center justify-center text-3xl shadow-inner animate-bounce">
                  <CheckCircle2 size={36} />
                </div>
                <h3 className="font-extrabold text-slate-900 dark:text-white text-xl">
                  {isRtl ? 'تم اعتماد العملية' : 'Transaction posted'}
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-400 font-semibold leading-relaxed">
                  {isRtl 
                    ? `حُفظت الفاتورة رقم ${lastInvoiceNumber} وعُدّل المخزون والأرصدة.`
                    : `Invoice ${lastInvoiceNumber} was saved; stock and balances were updated.`}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-3">
                {lastCompletedInvoice && (
                  <button
                    type="button"
                    onClick={() => printThermalReceipt(lastCompletedInvoice)}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-extrabold rounded-xl text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Printer size={15} />
                    <span>{isRtl ? 'طباعة الإيصال' : 'Print receipt'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowSuccessModal(false);
                    focusScanner();
                  }}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-xs transition active:scale-95 cursor-pointer"
                >
                  {isRtl ? 'المتابعة ومسح صنف ومادة جديدة' : 'Scan Next Item'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Live Camera Scanner Overlay Dialog */}
      <AnimatePresence>
        {isCameraScanning && (
          <div className="camera-popup-overlay fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-cyan-500/30 rounded-[2.5rem] p-6 max-w-sm w-full shadow-2xl text-center space-y-5 relative"
            >
              <button 
                type="button" 
                onClick={() => setIsCameraScanning(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full w-8 h-8 flex items-center justify-center transition-all cursor-pointer z-50 text-xs"
              >
                ✕
              </button>

              <div className="space-y-1">
                <div className="w-12 h-12 bg-cyan-500/15 text-cyan-400 rounded-full flex items-center justify-center mx-auto text-xl border border-cyan-500/20">
                  📸
                </div>
                <h3 className="font-extrabold text-white text-base">
                  {isRtl ? 'مسح باركود المنتج بالكاميرا' : 'Scan Product Barcode / QR'}
                </h3>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed max-w-xs mx-auto">
                  {isRtl 
                    ? 'وجه كاميرا الهاتف أو جهازك نحو ملصق الباركود الخاص بالقطعة للتعرف السريع والآلي' 
                    : 'Point your camera directly at the barcode or price tag of the item for instant tracking.'}
                </p>
              </div>

              {cameraError ? (
                <div className="p-5 rounded-2xl bg-slate-900 border border-amber-500/30 text-center space-y-3 max-w-sm mx-auto">
                  <div className="text-amber-500 text-3xl font-bold">⚠️</div>
                  <p className="text-xs font-black text-amber-400">
                    {isRtl 
                      ? 'الوصول للكاميرا معطل أو غير مدعوم' 
                      : 'Camera access is disabled or unsupported'}
                  </p>
                  <p className="text-[10px] text-slate-400 leading-normal font-semibold">
                    {isRtl
                      ? 'إذا كنت تتصفح داخل بيئة اختبار محكومة، يرجى تفعيل أذونات الكاميرا، أو تشغيل التطبيق في نافذة مستقلة. يمكنك إدخال الباركود يدوياً أدناه لمحاكاة عملية المسح اللحظي بنجاح!'
                      : 'If you are viewing within a sandboxed frame, please check browser permissions or open in a new tab. You can type any barcode/SKU below to simulate a real hardware scan trigger!'}
                  </p>
                  
                  {/* Simulated scanner helper panel */}
                  <div className="pt-3 border-t border-slate-800 space-y-2">
                    <label className="block text-[10px] font-black text-slate-300 text-right">
                      {isRtl ? 'محاكاة قارئ الباركود (أدخل SKU أو الرمز):' : 'Barcode Simulator (Enter SKU/Barcode Code):'}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualScanInput}
                        onChange={(e) => setManualScanInput(e.target.value)}
                        placeholder="e.g. ESP-1, 12345, or any code" aria-label="e.g. ESP-1, 12345, or any code"
                        className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-400 outline-none focus:border-emerald-500"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (manualScanInput.trim()) {
                              handleScannedProductCode(manualScanInput.trim());
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (manualScanInput.trim()) {
                            handleScannedProductCode(manualScanInput.trim());
                          }
                        }}
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-[10px] tracking-wide whitespace-nowrap cursor-pointer transition active:scale-95"
                      >
                        {isRtl ? 'محاكاة المسح' : 'Simulate Scan'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* The element container designed for html5-qrcode renderer */
                <div 
                  id="reader" 
                  className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-inner max-w-sm mx-auto w-full text-white animate-pulse"
                />
              )}

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setIsCameraScanning(false)}
                  className="px-6 py-2.5 bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white rounded-xl text-xs transition active:scale-95 font-bold cursor-pointer w-full"
                >
                  {isRtl ? 'إلغاء المعاينة والمطابقة' : 'Cancel Scan / Back'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cash Payment Modal Helper */}
      <CashPaymentModal
        isOpen={showCashPaymentModal}
        onClose={() => setShowCashPaymentModal(false)}
        totalAmount={grandTotal}
        currency={POS_SYMBOLS[activeCurrency] || activeCurrency}
        decimals={currencyDecimals(activeCurrency)}
        quickAmounts={QUICK_CASH[activeCurrency] || QUICK_CASH.USD}
        onConfirm={(received) => handleSubmitProcess(received, 'cash')}
        language={isRtl ? 'ar' : 'en'}
      />

      {/* Free / service line — no inventory */}
      <AnimatePresence>
        {showAdhocModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 my-8 text-slate-800 dark:text-slate-100"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-lg font-extrabold tracking-tight text-cyan-700 dark:text-cyan-300">
                    {isRtl ? 'بند حر / خدمة' : 'Free item / service'}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1 font-semibold">
                    {isRtl
                      ? 'يُضاف للفاتورة والخزنة دون خصم من المخزون. لتسجيل صنف دائم استخدم F7.'
                      : 'Adds to the invoice and vault without stock. Use F7 to register a lasting product.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdhocModal(false)}
                  className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 cursor-pointer"
                  aria-label={isRtl ? 'إغلاق' : 'Close'}
                >
                  <X size={16} />
                </button>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-500">{isRtl ? 'الوصف' : 'Description'}</span>
                <input
                  autoFocus
                  type="text"
                  value={adhocForm.description}
                  onChange={(e) => setAdhocForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm font-bold outline-none focus:border-cyan-500"
                  placeholder={isRtl ? 'مثل: أجرة توصيل، تصليح، صنف لمرة واحدة' : 'e.g. delivery fee, repair, one-off item'}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-500">{isRtl ? 'الكمية' : 'Qty'}</span>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={adhocForm.quantity}
                    onChange={(e) => setAdhocForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm font-bold tabular-nums outline-none focus:border-cyan-500"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-500">{isRtl ? `السعر (${activeCurrency})` : `Price (${activeCurrency})`}</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={adhocForm.unitPrice}
                    onChange={(e) => setAdhocForm((f) => ({ ...f, unitPrice: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm font-bold tabular-nums outline-none focus:border-cyan-500"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-500">{isRtl ? 'التكلفة (اختياري للأرباح)' : 'Cost (optional for profit)'}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={adhocForm.unitCost}
                  onChange={(e) => setAdhocForm((f) => ({ ...f, unitCost: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm font-bold tabular-nums outline-none focus:border-cyan-500"
                  placeholder="0"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const checked = validateAdhocDraft({
                    description: adhocForm.description,
                    quantity: adhocForm.quantity,
                    unitPrice: adhocForm.unitPrice,
                  });
                  if (checked.ok === false) {
                    const why = checked.reason;
                    toast.error(
                      why === 'description'
                        ? (isRtl ? 'أدخل وصفاً للبند.' : 'Enter a description.')
                        : why === 'quantity'
                          ? (isRtl ? 'أدخل كمية صحيحة أكبر من صفر.' : 'Enter a quantity greater than zero.')
                          : (isRtl ? 'أدخل سعراً صحيحاً (صفر أو أكثر).' : 'Enter a valid price (zero or more).'),
                    );
                    return;
                  }
                  const costRaw = adhocForm.unitCost.trim() === '' ? 0 : Number(adhocForm.unitCost);
                  if (!Number.isFinite(costRaw) || costRaw < 0) {
                    toast.error(isRtl ? 'التكلفة غير صحيحة.' : 'Cost is not valid.');
                    return;
                  }
                  const line = buildAdhocInvoiceItem({
                    description: checked.description,
                    quantity: checked.quantity,
                    unitPrice: checked.unitPrice,
                    currency: activeCurrency as Currency,
                    unitCost: costRaw,
                  });
                  setScannedItems((prev) => [...prev, line]);
                  setShowAdhocModal(false);
                  playBeep('success');
                  toast.success(isRtl ? 'أُضيف البند الحر إلى السلة.' : 'Free item added to the cart.');
                }}
                className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-black py-3 cursor-pointer"
              >
                {isRtl ? 'إضافة إلى السلة' : 'Add to cart'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quick Product Registration Portal popup dialog */}
      <AnimatePresence>
        {showQuickRegModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 my-8 text-slate-800 dark:text-slate-100"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <span className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-600 dark:text-emerald-400 text-xs font-bold">+</span>
                  <h3 className="text-lg font-extrabold tracking-tight">
                    {isRtl ? 'تسجيل منتج غير مدرج' : 'Register new product'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickRegModal(false);
                    setTimeout(() => focusScanner(), 150);
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!quickRegForm.name.trim()) {
                  toast.error(isRtl ? 'حقل الاسم مطلوب للتسجيل!' : 'Product name is required!');
                  return;
                }
                if (Number(quickRegForm.sellingPrice) <= 0) {
                  toast.error(isRtl ? 'حقل سعر البيع مطلوب ويجب أن يكون أكبر من صفر!' : 'Selling price is required and must be greater than zero!');
                  return;
                }
                const initialQty = parseQuickRegQuantity(quickRegForm.quantity);
                if (initialQty === null) {
                  toast.error(isRtl
                    ? 'أدخل الكمية الموجودة فعلاً في المخزن (صفر أو أكثر). لا تُخترع كمية افتراضية.'
                    : 'Enter the quantity actually on hand (zero or more). No default stock is invented.');
                  return;
                }
                if (Number(quickRegForm.unitCost) < 0 || Number(quickRegForm.sellingPrice) < 0) {
                  toast.error(isRtl ? 'لا يمكن إدخال قيم سالبة!' : 'Negative values are not allowed!');
                  return;
                }

                try {
                  const generatedId = crypto.randomUUID();
                  const finalSku = resolveProductSku(quickRegForm.sku, generatedId);
                  const effectiveThreshold = Number(quickRegForm.lowStockThreshold) || 5;

                  const status = computeStockStatus(initialQty, effectiveThreshold, settings?.lowStockThreshold);

                  const newProduct: Product = {
                    id: generatedId,
                    name: quickRegForm.name.trim(),
                    sku: finalSku,
                    category: resolveProductCategory(quickRegForm.category, isRtl),
                    brand: quickRegForm.brand.trim() || '-',
                    quantity: initialQty,
                    unitCost: Number(quickRegForm.unitCost) || 0,
                    sellingPrice: Number(quickRegForm.sellingPrice) || 0,
                    status: status,
                    lowStockThreshold: effectiveThreshold,
                    dateAdded: Date.now(),
                    warehouseId: quickRegForm.warehouseId || '',
                    currency: activeCurrency
                  };

                  await saveProduct(newProduct);
                  if (posMode === 'sale' && initialQty <= 0) {
                    toast.success(
                      isRtl
                        ? `سُجّل «${newProduct.name}» بكمية صفر. لن يُضاف للسلة حتى يتوفر مخزون (توريد أو جرد).`
                        : `“${newProduct.name}” was saved with zero stock. It will not join the cart until stock is received or counted.`,
                    );
                  } else {
                    addItemToPOS(newProduct);
                    toast.success(
                      isRtl
                        ? `سُجّل «${newProduct.name}» في المخزون وأُضيف للفاتورة.`
                        : `“${newProduct.name}” was saved to inventory and added to this ticket.`,
                    );
                  }
                  setShowQuickRegModal(false);
                  setTimeout(() => {
                    focusScanner();
                  }, 200);
                } catch (err) {
                  console.error(err);
                  toast.error(isRtl ? 'حدث خطأ غير متوقع أثناء حفظ المنتج.' : 'An error occurred while saving the product details.');
                }
              }} className="space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {isRtl
                    ? 'الصنف غير مسجّل. أدخل بياناته والكمية الموجودة فعلاً في المخزن. الكمية الافتراضية صفر — لا تُخترع وحدات وهمية.'
                    : 'This item is not registered. Enter its details and the quantity actually on hand. Opening stock defaults to zero — no phantom units.'}
                </p>

                {/* SKU / Barcode */}
                <div>
                  <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">
                    {isRtl ? 'رمز الباركود / SKU' : 'Barcode / SKU'}
                  </label>
                  <input
                    type="text"
                    required
                    value={quickRegForm.sku}
                    onChange={(e) => setQuickRegForm({ ...quickRegForm, sku: e.target.value })}
                    placeholder={isRtl ? 'أدخل الباركود الخاص بالمادة' : 'Enter product barcode SKU...'} aria-label={isRtl ? 'أدخل الباركود الخاص بالمادة' : 'Enter product barcode SKU...'}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400 outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">
                    {isRtl ? 'اسم المنتج الصنف *' : 'Product Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={quickRegForm.name}
                    onChange={(e) => setQuickRegForm({ ...quickRegForm, name: e.target.value })}
                    placeholder={isRtl ? 'اسم المادة مثلا: عصير ربيع 1 لتر' : 'e.g. Fresh Mango Juice 1L'} aria-label={isRtl ? 'اسم المادة مثلا: عصير ربيع 1 لتر' : 'e.g. Fresh Mango Juice 1L'}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm font-semibold outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Grid for prices */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">
                      {isRtl ? `سعر التكلفة (${activeCurrency})` : `Cost Price (${activeCurrency})`}
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={quickRegForm.unitCost || ''}
                      onChange={(e) => setQuickRegForm({ ...quickRegForm, unitCost: Number(e.target.value) })}
                      placeholder="0.00"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm font-semibold outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">
                      {isRtl ? `سعر البيع المعروض * (${activeCurrency})` : `Selling Price * (${activeCurrency})`}
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      required
                      value={quickRegForm.sellingPrice || ''}
                      onChange={(e) => setQuickRegForm({ ...quickRegForm, sellingPrice: Number(e.target.value) })}
                      placeholder="10.50"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm font-semibold text-indigo-600 dark:text-indigo-400 outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Grid for Initial Stock & Threshold */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">
                      {isRtl ? 'الكمية الموجودة فعلاً' : 'Quantity on hand'}
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={Number.isFinite(quickRegForm.quantity) ? quickRegForm.quantity : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setQuickRegForm({
                          ...quickRegForm,
                          quantity: raw.trim() === '' ? Number.NaN : Number(raw),
                        });
                      }}
                      placeholder="0"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm font-semibold outline-none focus:border-indigo-500"
                    />
                    <p className="mt-1 text-[10px] font-bold text-slate-400">
                      {isRtl ? 'اترك صفراً إن لم يصل الصنف بعد؛ لن يُباع بلا مخزون.' : 'Leave zero if not received yet; sales require stock.'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">
                      {isRtl ? 'حد التنبيه قبل نفاد الصنف' : 'Low Stock Warning Threshold'}
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      required
                      value={quickRegForm.lowStockThreshold}
                      onChange={(e) => setQuickRegForm({ ...quickRegForm, lowStockThreshold: Number(e.target.value) })}
                      placeholder="5"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm font-semibold outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Optional Category and Brand */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">
                      {isRtl ? 'التصنيف / الفئة' : 'Category / Class'}
                    </label>
                    <input
                      type="text"
                      list="quick-categories-list"
                      value={quickRegForm.category}
                      onChange={(e) => setQuickRegForm({ ...quickRegForm, category: e.target.value })}
                      placeholder={isRtl ? 'اكتب أو اختر تصنيفاً' : 'e.g. Dairy, Soft Drinks...'} aria-label={isRtl ? 'اكتب أو اختر تصنيفاً' : 'e.g. Dairy, Soft Drinks...'}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm font-semibold outline-none focus:border-indigo-500"
                    />
                    <datalist id="quick-categories-list">
                      {categoriesList.filter(c => c !== 'all').map(c => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">
                      {isRtl ? 'المستودع الرئيسي الافتراضي' : 'Default Warehouse'}
                    </label>
                    <select
                      value={quickRegForm.warehouseId}
                      onChange={(e) => setQuickRegForm({ ...quickRegForm, warehouseId: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm font-semibold outline-none focus:border-indigo-500"
                    >
                      <option value="">{isRtl ? 'المستودع العام الأساسي' : 'Primary Central Warehouse'}</option>
                      {warehouses && warehouses.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Modal actions */}
                <div className="flex gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuickRegModal(false);
                      setTimeout(() => focusScanner(), 150);
                    }}
                    className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-bold rounded-xl text-xs transition active:scale-95 cursor-pointer text-center"
                  >
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>

                  <button
                    type="submit"
                    className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black rounded-xl text-xs transition active:scale-95 cursor-pointer shadow-md text-center"
                  >
                    {isRtl ? 'حفظ الصنف وإضافته فوراً للبيع' : 'Save & Add to Bill'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sales return lookup — managers/owners (server forbids cashier stock increases). */}
      <AnimatePresence>
        {showReturnLookup && !returnTarget && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[160] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-950 rounded-[2rem] border border-slate-200 dark:border-slate-800 p-6 max-w-lg w-full shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Undo2 className="text-rose-500" size={18} />
                  <h3 className="font-black text-lg text-slate-900 dark:text-white">
                    {isRtl ? 'مرتجع مبيعات' : 'Sales return'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReturnLookup(false)}
                  className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  aria-label={isRtl ? 'إغلاق' : 'Close'}
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-slate-500 font-semibold">
                {isRtl
                  ? 'ابحث برقم الفاتورة أو اسم العميل، ثم اختر الفاتورة لإرجاع الكميات.'
                  : 'Search by invoice number or customer name, then pick the sale to return.'}
              </p>
              <input
                autoFocus
                type="text"
                value={returnQuery}
                onChange={(e) => setReturnQuery(e.target.value)}
                placeholder={isRtl ? 'رقم الفاتورة أو اسم العميل…' : 'Invoice number or customer…'}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm font-semibold outline-none focus:border-rose-500"
              />
              <div className="max-h-64 overflow-y-auto space-y-2">
                {returnQuery.trim() && returnMatches.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6">
                    {isRtl ? 'لا توجد فاتورة قابلة للإرجاع بهذا البحث.' : 'No returnable sale matches this search.'}
                  </p>
                )}
                {returnMatches.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => {
                      setReturnTarget(inv);
                      setShowReturnLookup(false);
                    }}
                    className="w-full text-start rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3 hover:border-rose-400 hover:bg-rose-50/60 dark:hover:bg-rose-500/10 transition cursor-pointer"
                  >
                    <div className="flex justify-between gap-2 text-xs font-black text-slate-800 dark:text-slate-100">
                      <span>#{inv.invoiceNumber}</span>
                      <span className="font-mono text-rose-600">{formatCurrencyValue(inv.totalAmount, inv.currency)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 font-semibold">
                      {(inv.customerName || (isRtl ? 'عميل نقدي' : 'Walk-in'))}
                      {' · '}
                      {new Date(inv.date).toLocaleString(isRtl ? 'ar-JO' : 'en-GB')}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {returnTarget && canReturn(returnTarget) && (
        <ReturnModal
          original={returnTarget}
          isRtl={isRtl}
          onClose={() => setReturnTarget(null)}
          onSaved={(saved) => {
            setReturnTarget(null);
            toast.success(
              isRtl
                ? `تم تسجيل المرتجع #${saved.invoiceNumber}`
                : `Return #${saved.invoiceNumber} recorded`,
            );
          }}
        />
      )}
    </div>
  );
}
