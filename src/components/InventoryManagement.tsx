import { printHtmlDocument } from '../lib/printHtml';
import { INVENTORY_INTENT_EVENT, takeInventoryIntent } from '../lib/inventoryIntent';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Package, 
  Search, 
  Plus, 
  MoreVertical, 
  TrendingDown, 
  TrendingUp, 
  AlertCircle,
  X,
  Filter,
  History,
  Minus,
  Calendar,
  Tag,
  ShieldAlert,
  ArrowRightLeft,
  Edit2,
  Trash2,
  Check,
  Boxes,
  Camera,
  Download,
  FileText,
  Upload,
  Barcode,
  ClipboardCheck,
  ChevronDown,
} from 'lucide-react';
import LabelPrintModal from './LabelPrintModal';
import { Language, Product, StockStatus, ProductLog, AppSettings, Warehouse, Invoice } from '../types';
import { translations } from '../translations';
import { motion, AnimatePresence } from 'motion/react';
import SuccessVisual from './SuccessVisual';
import ContextMenu3D from './ContextMenu3D';
import useLongPress from '../hooks/useLongPress';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { TactileButton } from './ui/TactileButton';
import { useSuccessCelebration } from '../hooks/useSuccessCelebration';
import { sounds } from '../lib/sounds';
import { matchesQuery } from '../lib/search';
import { arCount } from '../lib/arabicPlural';
import { useScreenSearch } from '../lib/screenSearch';
import BarcodeScannerScanner from './ui/BarcodeScannerScanner';
import { parseProductRows, ParsedProductRow } from '../lib/productImport';
import { computeStockStatus, resolveLowStockThreshold, isExpiryCritical, isExpired } from '../lib/stock';
import { formatPackStock, isValidPackSize, packFields, packIssues, suggestedPackPrice, unitPriceInPack, lineUnits, type PackIssue } from '../lib/packs';
import { sameSku, skuOwner } from '../lib/productLookup';
import {
  defaultProductCategory,
  productHasAdvancedDetails,
  resolveProductCategory,
  resolveProductSku,
} from '../lib/productForm';
import { CURRENCY_SYMBOLS, buildUsdUnitRates, safeConvertMoney, formatMoney, readCachedLiveRates, roundMoney, POS_CURRENCY_CODES } from '../lib/exchangeRates';
import CurrencyPicker from './CurrencyPicker';
import { stockValueByCurrency } from '../lib/profits';
import ProductVisualIcon from './ProductVisualIcon';
import { productVisualTone } from '../lib/productVisual';
import { localDayStart, localIsoDate } from '../lib/localDate';
import DateField from './ui/DateField';

const PRODUCT_FORMS = { one: 'منتج واحد', two: 'منتجين', few: '{n} منتجات', many: '{n} منتجاً', other: '{n} منتج' };

interface Props {
  language: Language;
  products: Product[];
  settings?: AppSettings;
  onAddProduct: (p: Product, options?: { reason?: string }) => void | Promise<void>;
  onUpdateProduct: (p: Product, options?: {
    reason?: string;
    baseQuantity?: number;
    baseProduct?: Product;
    absoluteQuantity?: boolean;
  }) => void | Promise<void>;
  onDeleteProduct: (id: string) => void | Promise<void>;
  transactions: Invoice[];
}

const roundForExport = (v: number, cur: string) => roundMoney(Number(v) || 0, cur);

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

interface ProductRowProps {
  product: Product;
  t: any;
  isRtl: boolean;
  statusStyles: any;
  statusLabels: any;
  formatCurrency: (val: number, currency?: string) => string;
  lowStockDefault?: number;
  onQuickAdjust: (product: Product, delta: number) => void;
  onShowContextMenu: (product: Product) => void;
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void | Promise<void>;
  warehouses: Warehouse[];
}

function ProductRow({ 
  product, 
  t, 
  isRtl, 
  statusStyles, 
  statusLabels, 
  formatCurrency, 
  lowStockDefault,
  onQuickAdjust, 
  onShowContextMenu,
  onEdit,
  onDelete,
  warehouses = []
}: ProductRowProps) {
  const longPressProps = useLongPress(() => onShowContextMenu(product));
  // Always derived from the real quantity so a stale stored status can never contradict the number shown.
  const liveStatus: StockStatus = computeStockStatus(product.quantity, product.lowStockThreshold, lowStockDefault);

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <motion.tr 
      key={product.id}
      {...longPressProps}
      variants={itemVariants}
      className="group hover:bg-white/5 dark:hover:bg-slate-900/40 transition-colors select-none cursor-pointer"
    >
      {/* Product Details (المنتج) */}
      <td className="px-6 py-4.5 whitespace-nowrap">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 border border-slate-200/20 dark:border-white/10 rounded-xl flex items-center justify-center group-hover:scale-105 group-hover:border-cyan-400/30 transition-all shadow-inner ${productVisualTone(product.category, product.name)}`}>
            <ProductVisualIcon category={product.category} name={product.name} className="w-5 h-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-black text-slate-900 dark:text-slate-100 truncate group-hover:text-cyan-400 transition-colors max-w-[280px]">
              {product.name}
            </span>
            <div className="flex items-center gap-1.5 mt-1 min-w-0 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 rounded-md font-mono font-black tracking-wide uppercase truncate">
                SKU: {product.sku}
              </span>
              {product.brand && (
                <span className="text-[10px] text-slate-400 font-bold truncate">
                  • {product.brand}
                </span>
              )}
              {(() => {
                const wh = warehouses.find(w => w.id === product.warehouseId);
                if (wh) {
                  return (
                    <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-md font-black tracking-normal truncate">
                      📍 {wh.name}
                    </span>
                  );
                }
                return null;
              })()}
              {product.expiryDate && (() => {
                const isCritical = isExpiryCritical(product.expiryDate);
                const dateStr = new Date(product.expiryDate).toISOString().split('T')[0];
                return (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold flex items-center gap-1 leading-none ${
                    isCritical 
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-black animate-pulse' 
                      : 'bg-slate-100/60 dark:bg-white/5 text-slate-500 dark:text-slate-400'
                  }`}>
                    <Calendar size={10} />
                    {dateStr}
                    {isCritical && <span className="text-[8px] bg-amber-500 text-white px-1 rounded scale-90">{isExpired(product.expiryDate) ? (isRtl ? 'منتهي!' : 'Expired!') : (isRtl ? 'قريب!' : 'Critical!')}</span>}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      </td>

      {/* Category (التصنيف) */}
      <td className="px-6 py-4.5 whitespace-nowrap">
        <span className="text-xs font-black text-slate-600 dark:text-slate-300">
          {product.category || (isRtl ? 'عام' : 'General')}
        </span>
      </td>

      {/* Cost Price (سعر التكلفة) */}
      <td className="px-6 py-4.5 whitespace-nowrap min-w-[110px]">
        <span className="text-sm font-black text-slate-700/80 dark:text-slate-300/85 font-mono">
          {formatCurrency(product.unitCost, product.currency)}
        </span>
      </td>

      {/* Selling Price (سعر البيع) */}
      <td className="px-6 py-4.5 whitespace-nowrap min-w-[110px]">
        <span className="text-sm font-black text-slate-900 dark:text-slate-100 font-mono">
          {formatCurrency(product.sellingPrice, product.currency)}
        </span>
      </td>

      {/* Quantity / Interactive adjustments (الكمية مع أزرار الزيادة والنقصان) */}
      <td className="px-6 py-4.5 whitespace-nowrap">
        <div className="flex items-center gap-3.5">
          <button 
            onClick={(e) => { e.stopPropagation(); onQuickAdjust(product, -1); }}
            disabled={product.quantity <= 0}
            className="disabled:opacity-30 disabled:cursor-not-allowed w-8 h-8 rounded-lg bg-slate-100 hover:bg-rose-500/15 dark:bg-white/5 dark:hover:bg-rose-500/10 text-slate-500 hover:text-rose-500 border border-slate-200/50 dark:border-white/5 flex items-center justify-center hover:scale-110 active:scale-95 transition-all cursor-pointer"
            title={t.decrement} aria-label={t.decrement}
          >
            <Minus size={13} strokeWidth={2.5} />
          </button>
          
          <span className={`text-sm font-black min-w-[2.2rem] text-center ${
            product.quantity <= 0 
              ? 'text-rose-500 animate-pulse font-extrabold' 
              : computeStockStatus(product.quantity, product.lowStockThreshold, lowStockDefault) === 'Low Stock' 
                ? 'text-amber-500 font-bold' 
                : 'text-slate-800 dark:text-slate-200'
          }`}>
            {product.quantity}
            {(() => {
              const packs = formatPackStock(product.quantity, product, isRtl);
              return packs ? <span className="block text-[10px] font-bold text-slate-400 whitespace-nowrap">{packs}</span> : null;
            })()}
          </span>
          
          <button 
            onClick={(e) => { e.stopPropagation(); onQuickAdjust(product, 1); }}
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-emerald-500/15 dark:bg-white/5 dark:hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-500 border border-slate-200/50 dark:border-white/5 flex items-center justify-center hover:scale-110 active:scale-95 transition-all cursor-pointer"
            title={t.increment} aria-label={t.increment}
          >
            <Plus size={13} strokeWidth={2.5} />
          </button>
        </div>
      </td>

      {/* Status (الحالة) */}
      <td className="px-6 py-4.5 whitespace-nowrap">
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-black tracking-wide border ${statusStyles[liveStatus]}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 ml-1.5 animate-pulse shrink-0" />
          {statusLabels[liveStatus]}
        </span>
      </td>

      {/* Quick actions (إجراءات سريعة وتفاصيل) */}
      <td className="px-6 py-4.5 whitespace-nowrap text-left" dir="ltr">
        <div className="flex items-center justify-end gap-1.5">
          {/* Edit Button */}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(product); }}
            className="w-8.5 h-8.5 rounded-lg border border-slate-200/60 dark:border-white/5 hover:border-cyan-500/30 text-slate-400 hover:text-cyan-500 hover:bg-cyan-500/[0.06] flex items-center justify-center transition-all cursor-pointer active:scale-90"
            title={t.editProduct} aria-label={t.editProduct}
          >
            <Edit2 size={13.5} strokeWidth={2.2} />
          </button>

          {/* Delete Button */}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(product.id); }}
            className="w-8.5 h-8.5 rounded-lg border border-slate-200/60 dark:border-white/5 hover:border-rose-500/30 text-slate-400 hover:text-rose-500 hover:bg-rose-500/[0.06] flex items-center justify-center transition-all cursor-pointer active:scale-90"
            title={t.delete} aria-label={t.delete}
          >
            <Trash2 size={13.5} strokeWidth={2.2} />
          </button>

          {/* More details info */}
          <button 
            onClick={(e) => { e.stopPropagation(); onShowContextMenu(product); }}
            className="w-8.5 h-8.5 rounded-lg border border-slate-200/60 dark:border-white/5 hover:border-indigo-500/30 text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/[0.06] flex items-center justify-center transition-all cursor-pointer active:scale-90"
            title={t.productDetails} aria-label={t.productDetails}
          >
            <MoreVertical size={14} />
          </button>
        </div>
      </td>
    </motion.tr>
  );
}

export default function InventoryManagement({ 
  language, 
  products, 
  settings = { currency: 'JOD' } as AppSettings, 
  onAddProduct, 
  onUpdateProduct, 
  onDeleteProduct, 
  transactions 
}: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';
  const { formatPrice: globalFormatPrice } = usePreferredCurrency();
  
  const { warehouses = [], stockMovements = [] } = useFirebase();
  const [stockReason, setStockReason] = useState('');
  const [sellByPack, setSellByPack] = useState(false);

  // Pagination ("show more") so big catalogues stay fast
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // CSV / Excel import
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importPlan, setImportPlan] = useState<{ fileName: string; creates: Product[]; updates: Product[]; errors: string[] } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const lowStockDefault = settings?.lowStockThreshold;
  const { celebrationClass, triggerCelebration } = useSuccessCelebration();

  const filterT = {
    searchScope: isRtl ? 'نقاط البحث الفوري' : 'Live Search Target',
    allFields: isRtl ? 'الكل (الاسم/الباركود/التصنيف)' : 'All (Name/SKU/Category)',
    nameOnly: isRtl ? 'اسم المنتج' : 'Item Name',
    barcodeOnly: isRtl ? 'الباركود SKU' : 'SKU/Barcode',
    categoryOnly: isRtl ? 'التصنيف' : 'Category',
    advancedSettings: isRtl ? 'خيارات التصفية والبحث المتقدمة' : 'Advanced Search & Filters',
    priceRange: isRtl ? 'نطاق سعر البيع' : 'Selling Price Range',
    min: isRtl ? 'الأدنى' : 'Min',
    max: isRtl ? 'الأقصى' : 'Max',
    capitalRange: isRtl ? 'كمية المخزون' : 'Stock Level Range',
    warehouse: isRtl ? 'مستودع التخزين' : 'Warehouse Location',
    allWarehouses: isRtl ? 'جميع المستودعات' : 'All Warehouses',
    expiryDateStatus: isRtl ? 'حالة تاريخ الصلاحية' : 'Expiry Date Status',
    allExpiries: isRtl ? 'كل تواريخ الصلاحية' : 'All Expiry States',
    hasExpiry: isRtl ? 'يملك تاريخ صلاحية' : 'Has Expiry Date',
    criticalExpiry: isRtl ? 'ينتهي خلال أقل من 6 أشهر' : 'Expires within 6 months',
    noExpiry: isRtl ? 'لا يملك تاريخ صلاحية' : 'No Expiry Date',
    resultsCount: (found: number, total: number) => isRtl 
      ? `🔍 تم العثور على ${found} صنف من أصل ${total}` 
      : `🔍 Found ${found} of ${total} items`,
    clearFilters: isRtl ? 'إعادة تعيين الفلاتر' : 'Reset Filters',
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');

  // Advanced Filter state variables
  const [searchMode, setSearchMode] = useState<'all' | 'name' | 'sku' | 'category'>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [minPrice, setMinPrice] = useState<number | ''>('');
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [minQty, setMinQty] = useState<number | ''>('');
  const [maxQty, setMaxQty] = useState<number | ''>('');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [expiryFilter, setExpiryFilter] = useState<string>('all');

  useScreenSearch('inventory', ({ query }) => {
    setCategoryFilter('all');
    setStockFilter('all');
    setSearchMode('all');
    setMinPrice('');
    setMaxPrice('');
    setMinQty('');
    setMaxQty('');
    setWarehouseFilter('all');
    setExpiryFilter('all');
    setSearchQuery(query);
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [activeAuditTab, setActiveAuditTab] = useState<'costs' | 'movements'>('costs');
  const [showSuccessVisual, setShowSuccessVisual] = useState(false);
  const [contextMenuTarget, setContextMenuTarget] = useState<Product | null>(null);
  const [labelProducts, setLabelProducts] = useState<Product[] | null>(null);
  const [logTarget, setLogTarget] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const initialFormState: Partial<Product> = {
    name: '',
    sku: '',
    category: '',
    brand: '',
    quantity: 0,
    unitCost: 0,
    sellingPrice: 0,
    serialNumber: '',
    lowStockThreshold: undefined,
    expiryDate: undefined,
    warehouseId: '',
    baseCostPrice: undefined,
    taxRate: undefined,
    additionalCosts: undefined,
  };

  const [newProduct, setNewProduct] = useState<Partial<Product>>(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);

  const openCreateProduct = () => {
    setEditingProduct(null);
    setNewProduct({ ...initialFormState, category: defaultProductCategory(isRtl) });
    setSellByPack(false);
    setShowAdvanced(false);
    setStockReason('');
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (isModalOpen) {
      const timer = setTimeout(() => {
        if (editingProduct) barcodeInputRef.current?.focus();
        else nameInputRef.current?.focus();
      }, 150);
      setErrorMessage('');
      setIsSubmitting(false);
      return () => clearTimeout(timer);
    } else {
      setIsCameraScannerOpen(false);
    }
  }, [isModalOpen, editingProduct]);

  const handleViewProduct = (product: Product) => {
    setContextMenuTarget(product);
    setIsLogOpen(false);
    setIsModalOpen(false);
  };

  useEffect(() => {
    const handleIntent = () => {
      const intent = takeInventoryIntent();
      if (!intent) return;
      if (intent.type === 'view') {
        handleViewProduct(intent.product);
        return;
      }
      openCreateProduct();
    };

    handleIntent();
    window.addEventListener(INVENTORY_INTENT_EVENT, handleIntent);
    return () => window.removeEventListener(INVENTORY_INTENT_EVENT, handleIntent);
  }, []);

  const [sortConfig, setSortConfig] = useState<{ key: keyof Product; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.04
      }
    }
  };

  const handleSort = (key: keyof Product) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Extract all categories currently available in the system dynamically
  const dynamicCategories = useMemo(() => {
    const list = new Set<string>();
    products.forEach(p => {
      if (p.category) list.add(p.category);
    });
    return Array.from(list).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Live/manual rates (same source the POS uses) so totals never add different currencies together.
  const baseCurrency = (settings?.currency || 'JOD') as string;
  const usdRates = useMemo(() => buildUsdUnitRates(settings as any, readCachedLiveRates()), [settings]);
  /** Null when FX cannot convert — callers must omit that amount from totals (never treat as 0 value). */
  const toBaseCurrency = (value: number, from?: string): number | null => {
    const f = from || baseCurrency;
    if (f === baseCurrency) return Number(value) || 0;
    return safeConvertMoney(Number(value) || 0, f, baseCurrency, usdRates);
  };

  // Filter & Sort Logic matching mockup selectors exactly
  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      // 1. Search filter with adjustable modes (All, Name, Barcode/SKU, Category)
      const q = searchQuery.trim();
      let matchesSearch = true;
      if (q) {
        if (searchMode === 'all') {
          matchesSearch = matchesQuery([p.name, p.sku, p.serialNumber, p.brand, p.category], q);
        } else if (searchMode === 'name') {
          matchesSearch = matchesQuery([p.name], q);
        } else if (searchMode === 'sku') {
          matchesSearch = matchesQuery([p.sku, p.serialNumber], q);
        } else if (searchMode === 'category') {
          matchesSearch = matchesQuery([p.category], q);
        }
      }
      
      // 2. Category filter
      const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;

      // 3. Stock Status filter
      let matchesStock = true;
      if (stockFilter !== 'all') {
        const st = computeStockStatus(p.quantity, p.lowStockThreshold, lowStockDefault);
        matchesStock = (stockFilter === 'in' && st === 'In Stock')
          || (stockFilter === 'low' && st === 'Low Stock')
          || (stockFilter === 'out' && st === 'Out of Stock');
      }

      // 4. Advanced: Price Filter (on sellingPrice)
      let matchesPrice = true;
      if (minPrice !== '' || maxPrice !== '') {
        const priceInBase = toBaseCurrency(p.sellingPrice, p.currency);
        if (priceInBase === null) matchesPrice = false;
        else {
          if (minPrice !== '') matchesPrice = matchesPrice && priceInBase >= minPrice;
          if (maxPrice !== '') matchesPrice = matchesPrice && priceInBase <= maxPrice;
        }
      }

      // 5. Advanced: Quantity Filter
      let matchesQty = true;
      if (minQty !== '') {
        matchesQty = matchesQty && p.quantity >= minQty;
      }
      if (maxQty !== '') {
        matchesQty = matchesQty && p.quantity <= maxQty;
      }

      // 6. Advanced: Warehouse Filter
      const matchesWarehouse = warehouseFilter === 'all' || p.warehouseId === warehouseFilter;

      // 7. Advanced: Expiration/Expiry Date Filter
      let matchesExpiry = true;
      if (expiryFilter === 'has-expiry') {
        matchesExpiry = !!p.expiryDate;
      } else if (expiryFilter === 'no-expiry') {
        matchesExpiry = !p.expiryDate;
      } else if (expiryFilter === 'critical') {
        matchesExpiry = isExpiryCritical(p.expiryDate);
      }

      return matchesSearch && matchesCategory && matchesStock && matchesPrice && matchesQty && matchesWarehouse && matchesExpiry;
    });

    result.sort((a, b) => {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      if (sortConfig.key === 'status') {
        const order: Record<StockStatus, number> = { 'Out of Stock': 0, 'Low Stock': 1, 'In Stock': 2 };
        return (order[computeStockStatus(a.quantity, a.lowStockThreshold, lowStockDefault)] - order[computeStockStatus(b.quantity, b.lowStockThreshold, lowStockDefault)]) * dir;
      }
      const aValue = a[sortConfig.key] ?? '';
      const bValue = b[sortConfig.key] ?? '';
      if (typeof aValue === 'number' && typeof bValue === 'number') return (aValue - bValue) * dir;
      return String(aValue).localeCompare(String(bValue), isRtl ? 'ar' : 'en', { numeric: true, sensitivity: 'base' }) * dir;
    });

    return result;
  }, [
    products, 
    searchQuery, 
    categoryFilter, 
    stockFilter, 
    sortConfig, 
    searchMode, 
    minPrice, 
    maxPrice, 
    minQty, 
    maxQty, 
    warehouseFilter, 
    expiryFilter,
    lowStockDefault,
    isRtl,
    usdRates
  ]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, categoryFilter, stockFilter, searchMode, minPrice, maxPrice, minQty, maxQty, warehouseFilter, expiryFilter, sortConfig]);

  const visibleProducts = useMemo(() => filteredProducts.slice(0, visibleCount), [filteredProducts, visibleCount]);

  // Metrics
  const metrics = useMemo(() => {
    const totalItems = products.length;
    // Items below zero (sold offline) hold no goods, so they add nothing instead of lowering the value.
    const totalValue = Object.entries(stockValueByCurrency(products, settings?.currency || 'JOD'))
      .reduce((acc, [code, value]) => {
        const converted = toBaseCurrency(value, code);
        return converted === null ? acc : acc + converted;
      }, 0);
    const outOfStock = products.filter(p => (Number(p.quantity) || 0) <= 0).length;
    const lowStock = products.filter(p => computeStockStatus(p.quantity, p.lowStockThreshold, lowStockDefault) === 'Low Stock').length;
    return { totalItems, totalValue, outOfStock, lowStock };
  }, [products, usdRates, baseCurrency, lowStockDefault, settings?.currency]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dynamic Export Handlers for external accounting
  const statusText = (p: Product) => {
    const st = computeStockStatus(p.quantity, p.lowStockThreshold, lowStockDefault);
    return isRtl
      ? (st === 'Out of Stock' ? 'نفدت الكمية' : st === 'Low Stock' ? 'منخفض' : 'متوفر')
      : st;
  };

  const exportInventoryToCSV = () => {
    try {
      if (filteredProducts.length === 0) {
        toast.info(isRtl ? 'لا توجد منتجات لتصديرها' : 'No products to export');
        return;
      }
      const headers = isRtl 
        ? ['اسم المنتج', 'SKU / الباركود', 'التصنيف', 'العلامة التجارية', 'الكمية', 'العملة', 'سعر التكلفة', 'سعر البيع', 'القيمة الكلية (التكلفة)', 'تاريخ الصلاحية', 'حالة المخزون']
        : ['Product Name', 'SKU / Barcode', 'Category', 'Brand', 'Quantity', 'Currency', 'Cost Price', 'Selling Price', 'Total Valuation', 'Expiry Date', 'Stock Status'];

      const rows = filteredProducts.map(p => {
        const cur = p.currency || baseCurrency;
        return [
          p.name,
          p.sku,
          p.category || '',
          p.brand || '',
          String(p.quantity),
          cur,
          String(roundForExport(p.unitCost, cur)),
          String(roundForExport(p.sellingPrice, cur)),
          String(roundForExport((Number(p.quantity) || 0) * (Number(p.unitCost) || 0), cur)),
          p.expiryDate ? new Date(p.expiryDate).toISOString().split('T')[0] : '',
          statusText(p)
        ];
      });

      // Quote every field and neutralise spreadsheet formulas (=, +, -, @) coming from user-entered text.
      const escapeCsvField = (field: string) => {
        let v = String(field ?? '');
        if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = "'" + v;
        return `"${v.replace(/"/g, '""')}"`;
      };

      const csvContent = "\uFEFF" + [
        headers.map(escapeCsvField).join(','),
        ...rows.map(row => row.map(escapeCsvField).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Mostawdaee_Inventory_Export_${new Date().toISOString().slice(0, 10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(isRtl ? 'تم تصدير المخزون كملف Excel / CSV بنجاح! 📊' : 'Inventory exported as Excel / CSV successfully!');
    } catch (error) {
      console.error(error);
      toast.error(isRtl ? 'فشل تصدير البيانات' : 'Failed to export data');
    }
  };

  const exportInventoryToPDF = () => {
    try {
      if (filteredProducts.length === 0) {
        toast.info(isRtl ? 'لا توجد منتجات لتضمينها في التقرير' : 'No products to include in the report');
        return;
      }

      let rowsHtml = '';
      filteredProducts.forEach((p, idx) => {
        const st = computeStockStatus(p.quantity, p.lowStockThreshold, lowStockDefault);
        const statusStr = statusText(p);
        const statusColor = st === 'Out of Stock' 
          ? 'color: #ef4444; font-weight: bold;' 
          : st === 'Low Stock' 
            ? 'color: #f59e0b; font-weight: bold;' 
            : 'color: #10b981;';
        const cur = p.currency || baseCurrency;

        rowsHtml += `
          <tr style="background-color: ${idx % 2 === 0 ? '#f8fafc' : '#ffffff'};">
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: ${isRtl ? 'right' : 'left'}; font-weight: bold;">${escapeHtml(p.name)}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${escapeHtml(p.sku)}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${escapeHtml(p.category || '-')}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${escapeHtml(p.brand || '-')}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: bold; font-family: monospace;">${escapeHtml(p.quantity)}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${escapeHtml(formatCurrency(p.unitCost, cur))}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${escapeHtml(formatCurrency(p.sellingPrice, cur))}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: bold; font-family: monospace;">${escapeHtml(formatCurrency((Number(p.quantity) || 0) * (Number(p.unitCost) || 0), cur))}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; ${statusColor}">${escapeHtml(statusStr)}</td>
          </tr>
        `;
      });

      const currentDate = new Date().toLocaleString(isRtl ? 'ar-JO' : 'en-US');
      const totalInventoryCost = filteredProducts.reduce((acc, p) => {
        const converted = toBaseCurrency((Number(p.quantity) || 0) * (Number(p.unitCost) || 0), p.currency);
        return converted === null ? acc : acc + converted;
      }, 0);
      const totalQty = filteredProducts.reduce((acc, p) => acc + (Number(p.quantity) || 0), 0);

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
            .report-title { font-size: 15px; font-weight: 700; color: #0ea5e9; margin-top: 5px; }
            .meta-item { margin-top: 4px; color: #64748b; font-size: 10px; font-weight: bold; }
            .summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 30px 0; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; text-align: center; }
            .card-label { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: bold; letter-spacing: 0.5px; }
            .card-value { font-size: 18px; font-weight: 900; color: #0f172a; margin-top: 5px; font-family: monospace; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #0f172a; color: #ffffff; padding: 12px 8px; font-weight: 700; font-size: 10px; text-align: center; }
            tr:nth-child(even) { background-color: #f8fafc; }
            .footer { margin-top: 40px; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 9px; color: #64748b; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div class="header-left">
              <span class="company-name">${escapeHtml(settings?.businessName || (isRtl ? 'مستودعي الذكي' : 'Mostawdaee'))}</span>
              <span class="report-title">${isRtl ? 'تقرير حالة وجرد كميات المخازن والأصول' : 'Inventory Stock Audit Report'}</span>
            </div>
            <div style="text-align: ${isRtl ? 'left' : 'right'};">
              <div class="meta-item">${isRtl ? 'تاريخ التقرير' : 'Report Date'}: ${currentDate}</div>
              <div class="meta-item">${isRtl ? 'المستخدم' : 'Operator'}: ${escapeHtml(settings?.userName || (isRtl ? 'المدير المسؤول' : 'Supervisor'))}</div>
              <div class="meta-item">${isRtl ? 'عدد السجلات المشمولة' : 'Records Filtered'}: ${filteredProducts.length}</div>
            </div>
          </div>

          <div class="summary-cards">
            <div class="card">
              <div class="card-label">${isRtl ? 'إجمالي عدد المواد المخزنة' : 'Total Filtered Products'}</div>
              <div class="card-value">${filteredProducts.length}</div>
            </div>
            <div class="card">
              <div class="card-label">${isRtl ? 'إجمالي الكمية المتاحة (وحدات)' : 'Total In-Stock Units'}</div>
              <div class="card-value">${totalQty}</div>
            </div>
            <div class="card">
              <div class="card-label">${isRtl ? 'القيمة التقديرية الكلية (سعر التكلفة)' : 'Est. Inventory Value (Cost)'}</div>
              <div class="card-value" style="color: #10b981;">${formatCurrency(totalInventoryCost)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="border-top-left-radius: 8px; border-bottom-left-radius: 8px; text-align: ${isRtl ? 'right' : 'left'};">${isRtl ? 'اسم الصنف' : 'Item Name'}</th>
                <th>SKU</th>
                <th>${isRtl ? 'التصنيف' : 'Category'}</th>
                <th>${isRtl ? 'الماركة' : 'Brand'}</th>
                <th>${isRtl ? 'الكمية' : 'Qty'}</th>
                <th>${isRtl ? 'سعر التكلفة' : 'Cost Unit'}</th>
                <th>${isRtl ? 'سعر البيع' : 'Sale Unit'}</th>
                <th>${isRtl ? 'إجمالي القيمة' : 'Total Cost'}</th>
                <th style="border-top-right-radius: 8px; border-bottom-right-radius: 8px;">${isRtl ? 'الحالة' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="footer">
            ${isRtl ? 'تقرير المخزون – مستودعي' : 'Inventory report – Mostawdaee'}
          </div>
        </body>
        </html>
      `;

      printHtmlDocument(reportHtml);
      
      toast.success(isRtl ? 'تقرير الـ PDF جاهز للطباعة والحفظ! 📄🖨️' : 'PDF stock report prepared for printing or export successfully!');
    } catch (e) {
      console.error(e);
      toast.error(isRtl ? 'فشل تصدير ملف PDF' : 'Failed to export PDF');
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const name = (newProduct.name || '').trim();
    const productId = editingProduct?.id || crypto.randomUUID();
    const sku = resolveProductSku(newProduct.sku, productId);
    const category = resolveProductCategory(newProduct.category, isRtl);
    const quantity = Number(newProduct.quantity ?? 0);
    const unitCost = Number(newProduct.unitCost ?? 0);
    const sellingPrice = Number(newProduct.sellingPrice ?? 0);

    const fail = (ar: string, en: string) => {
      const msg = isRtl ? ar : en;
      setErrorMessage(msg);
      toast.error(msg);
    };

    if (!name) return fail('الرجاء تعبئة اسم المنتج', 'Please enter the product name');
    if (sellingPrice <= 0) return fail('سعر البيع يجب أن يكون أكبر من صفر', 'Selling price must be greater than zero');
    if (name.length > 200) return fail('اسم المنتج طويل جداً (الحد 200 حرف)', 'Product name is too long (max 200 chars)');
    if (sku.length > 64) return fail('الباركود طويل جداً (الحد 64 حرفاً)', 'SKU is too long (max 64 chars)');
    if (![quantity, unitCost, sellingPrice].every(Number.isFinite)) return fail('الرجاء إدخال أرقام صحيحة', 'Please enter valid numbers');
    if (quantity < 0 || unitCost < 0 || sellingPrice < 0) return fail('لا يمكن إدخال قيم سالبة', 'Values cannot be negative');
    if (newProduct.lowStockThreshold !== undefined && Number(newProduct.lowStockThreshold) < 0) return fail('حد نقص المخزون لا يمكن أن يكون سالباً', 'Low-stock level cannot be negative');

    const duplicate = skuOwner(products, sku, editingProduct, newProduct.warehouseId);
    if (duplicate) {
      return fail(`الباركود مستخدم مسبقاً للمنتج: ${duplicate.name}`, `This SKU is already used by: ${duplicate.name}`);
    }
    const packOwner = products.find((p) => p.id !== editingProduct?.id && !sameSku(p.sku, sku) && sameSku(p.packBarcode, sku));
    if (packOwner) {
      return fail(`الباركود مستخدم كباركود عبوة للمنتج: ${packOwner.name}`, `This barcode is the pack barcode of: ${packOwner.name}`);
    }

    const packSize = Number(newProduct.packSize);
    const packInput = {
      ...newProduct,
      sku,
      packPrice: newProduct.packPrice ?? suggestedPackPrice(sellingPrice, packSize),
    };
    if (sellByPack) {
      const PACK_ISSUE_TEXT: Record<PackIssue, [string, string]> = {
        pack_size: [`عدد الوحدات في العبوة يجب أن يكون رقماً صحيحاً من 2 إلى 10,000`, 'Units per pack must be a whole number from 2 to 10,000'],
        pack_price: ['سعر العبوة يجب أن يكون أكبر من صفر', 'Pack price must be greater than zero'],
        pack_barcode_same: ['باركود العبوة يجب أن يختلف عن باركود الوحدة', 'The pack barcode must differ from the unit barcode'],
        pack_barcode_taken: ['باركود العبوة مستخدم لمنتج آخر', 'The pack barcode is used by another product'],
      };
      const issue = packIssues(packInput, products.filter((p) => p.id !== editingProduct?.id))[0];
      if (issue) return fail(...PACK_ISSUE_TEXT[issue]);
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');

      const status: StockStatus = computeStockStatus(quantity, newProduct.lowStockThreshold, lowStockDefault);

      const productToSave: Product = {
        // Keep fields this form does not edit (barcode, images, ...).
        ...(editingProduct || {}),
        id: productId,
        name,
        sku,
        category,
        brand: (newProduct.brand || '').trim(),
        quantity,
        unitCost,
        costPrice: unitCost,
        sellingPrice,
        currency: newProduct.currency || settings?.currency || 'JOD',
        status: status,
        serialNumber: newProduct.serialNumber,
        lowStockThreshold: newProduct.lowStockThreshold,
        type: editingProduct?.type,
        dateAdded: editingProduct?.dateAdded || Date.now(),
        expiryDate: newProduct.expiryDate ? new Date(newProduct.expiryDate).getTime() : undefined,
        warehouseId: newProduct.warehouseId || '',
        baseCostPrice: newProduct.baseCostPrice || undefined,
        taxRate: newProduct.taxRate ?? undefined,
        additionalCosts: newProduct.additionalCosts || undefined,
        ...packFields(sellByPack, packInput),
      };

      if (editingProduct) {
        await onUpdateProduct(productToSave, {
          reason: stockReason || (isRtl ? 'تعديل من نموذج المنتج' : 'Edited from product form'),
          baseQuantity: Number(editingProduct.quantity) || 0,
          baseProduct: editingProduct,
        });
      } else {
        await onAddProduct(productToSave, { reason: isRtl ? 'رصيد افتتاحي' : 'Opening stock' });
      }

      triggerCelebration();
      toast.success(editingProduct ? (isRtl ? 'تم تحديث بيانات الصنف' : 'Product updated') : (isRtl ? 'تمت إضافة الصنف بنجاح' : 'Product added successfully'));
      setIsModalOpen(false);
      setShowSuccessVisual(true);
      setEditingProduct(null);
      setNewProduct(initialFormState);
      setSellByPack(false);
      setShowAdvanced(false);
      setStockReason('');
      
      setTimeout(() => {
        setShowSuccessVisual(false);
      }, 2500);
    } catch (error: any) {
      console.error("Error saving product:", error);
      setErrorMessage(error?.message || (isRtl ? 'حدث خطأ أثناء الحفظ. الرجاء المحاولة مرة أخرى.' : 'An error occurred during save. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickAdjust = async (product: Product, delta: number) => {
    const current = Number(product.quantity) || 0;
    if (delta < 0 && current <= 0) {
      toast.warning(isRtl ? 'الكمية صفر بالفعل' : 'Quantity is already zero');
      return;
    }
    const newQuantity = Math.max(0, current + delta);

    try {
      await onUpdateProduct({
        ...product,
        quantity: newQuantity,
        status: computeStockStatus(newQuantity, product.lowStockThreshold, lowStockDefault)
      }, {
        reason: isRtl ? 'تعديل سريع من الجدول' : 'Quick adjust from table',
        baseQuantity: current,
        baseProduct: product,
      });
      sounds.playPop();
      toast.info(`${product.name}: ${newQuantity} ${t.unitsPlural}`);
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر تعديل الكمية' : 'Could not adjust quantity'));
    }
  };

  const openStocktake = () => {
    sounds.playClick();
    window.dispatchEvent(new CustomEvent('change-screen', { detail: 'inventory-audit' }));
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(isRtl ? 'الملف كبير جداً (الحد 5 ميغابايت)' : 'File too large (max 5 MB)');
      return;
    }
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('empty');
      const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
      if (sheetRows.length > 5000) {
        toast.error(isRtl ? 'الحد الأقصى 5000 صف في الملف الواحد' : 'Max 5000 rows per file');
        return;
      }

      const parsed = parseProductRows(sheetRows, baseCurrency, isRtl);
      const creates: Product[] = [];
      const updates: Product[] = [];

      parsed.rows.forEach((row: ParsedProductRow) => {
        const matches = products.filter(p => sameSku(p.sku, row.sku));
        if (matches.length > 1) {
          // One file quantity can't be split between warehouses; updating one row would double-count the others.
          parsed.errors.push(isRtl
            ? `الباركود ${row.sku}: الصنف موزّع على أكثر من مستودع؛ عدّل كمية كل مستودع من شاشة المخزون.`
            : `Barcode ${row.sku}: this product is split across warehouses; update each warehouse's quantity in the inventory screen.`);
          return;
        }
        const existing = matches[0];
        const quantity = row.quantity ?? existing?.quantity ?? 0;
        const unitCost = row.unitCost ?? existing?.unitCost ?? 0;
        const base: Product = {
          id: existing?.id || crypto.randomUUID(),
          name: row.name,
          sku: existing?.sku || row.sku,
          category: row.category || existing?.category || '',
          brand: row.brand || existing?.brand || '',
          quantity,
          unitCost,
          costPrice: unitCost,
          sellingPrice: row.sellingPrice ?? existing?.sellingPrice ?? 0,
          currency: row.currency || existing?.currency || baseCurrency,
          status: computeStockStatus(quantity, existing?.lowStockThreshold, lowStockDefault),
          serialNumber: existing?.serialNumber,
          lowStockThreshold: existing?.lowStockThreshold,
          dateAdded: existing?.dateAdded || Date.now(),
          expiryDate: row.expiryDate ?? existing?.expiryDate,
          type: existing?.type,
          warehouseId: existing?.warehouseId || '',
          baseCostPrice: existing?.baseCostPrice,
          taxRate: existing?.taxRate,
          additionalCosts: existing?.additionalCosts,
        };
        (existing ? updates : creates).push(base);
      });

      setImportPlan({ fileName: file.name, creates, updates, errors: parsed.errors });
    } catch (err) {
      console.error('Import parse error', err);
      toast.error(isRtl ? 'تعذرت قراءة الملف. استخدم ملف CSV أو Excel (.xlsx)' : 'Could not read the file. Use a CSV or Excel (.xlsx) file');
    }
  };

  const confirmImport = async () => {
    if (!importPlan || isImporting) return;
    const jobs = [
      ...importPlan.creates.map(p => ({ p, create: true })),
      ...importPlan.updates.map(p => ({ p, create: false })),
    ];
    if (jobs.length === 0) return;
    setIsImporting(true);
    setImportProgress(0);
    let ok = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        const reason = isRtl ? 'استيراد من ملف' : 'Imported from file';
        if (job.create) await onAddProduct(job.p, { reason });
        else {
          const previous = products.find((p) => p.id === job.p.id);
          await onUpdateProduct(job.p, {
            reason,
            baseQuantity: Number(previous?.quantity) || 0,
            baseProduct: previous,
            absoluteQuantity: true,
          });
        }
        ok++;
      } catch (err) {
        console.error('Import row failed', job.p.sku, err);
        failed++;
      }
      setImportProgress(ok + failed);
    }
    setIsImporting(false);
    setImportPlan(null);
    if (failed === 0) {
      triggerCelebration();
      toast.success(isRtl ? `تم استيراد ${arCount(ok, PRODUCT_FORMS)} بنجاح` : `${ok} products imported successfully`);
    } else {
      toast.warning(isRtl ? `تم استيراد ${arCount(ok, PRODUCT_FORMS)} وفشل ${failed}` : `${ok} imported, ${failed} failed`);
    }
  };

  const handleDelete = async (id: string) => {
    const prod = products.find(p => p.id === id);
    const ok = window.confirm(isRtl
      ? `هل أنت متأكد من حذف المنتج "${prod?.name || ''}" نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`
      : `Delete "${prod?.name || ''}" permanently? This cannot be undone.`);
    if (!ok) return;
    try {
      await onDeleteProduct(id);
      sounds.playPop();
      toast.success(isRtl ? 'تم حذف المنتج' : 'Product deleted');
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر حذف المنتج' : 'Could not delete product'));
    }
  };

  const getCurrencySymbolByCode = (code: string) => CURRENCY_SYMBOLS[code] || code;

  // Each product is shown in ITS OWN currency (that is how the POS prices it); never relabelled.
  const formatCurrency = (val: number, currency?: string) =>
    formatMoney(Number(val) || 0, currency || baseCurrency, isRtl ? 'ar' : 'en-US');

  const statusStyles = {
    'In Stock': 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    'Low Stock': 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
    'Out of Stock': 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
  };

  const statusLabels = {
    'In Stock': t.inStock,
    'Low Stock': t.lowStock,
    'Out of Stock': t.outOfStock,
  };

  const handleEdit = (p: Product) => {
    const packOn = isValidPackSize(p.packSize);
    setEditingProduct(p);
    setStockReason('');
    setNewProduct(p);
    setSellByPack(packOn);
    setShowAdvanced(productHasAdvancedDetails(p, packOn));
    setIsModalOpen(true);
  };

  const productLogs = useMemo(() => {
    if (!logTarget) return [];
    const logs: ProductLog[] = [];
    (transactions || []).forEach((inv) => {
      (inv.items || []).forEach((item, idx) => {
        if (item.productId !== logTarget.id) return;
        const isSale = inv.type === 'sale' || inv.type === 'purchase_return';
        logs.push({
          id: `${inv.id}-${idx}`,
          productId: item.productId,
          action: inv.type,
          changeType: isSale ? 'decrement' : 'increment',
          quantityDelta: isSale ? -lineUnits(item) : lineUnits(item),
          previousValue: 0,
          newValue: 0,
          timestamp: inv.date,
          userName: (inv.type === 'purchase' || inv.type === 'purchase_return' ? inv.supplierName : inv.customerName) || inv.invoiceNumber || '-'
        } as ProductLog);
      });
    });
    stockMovements.filter(m => m.productId === logTarget.id).forEach((m) => {
      logs.push({
        id: `mv-${m.id}`,
        productId: m.productId,
        action: m.type === 'initial' ? 'create' : 'update_stock',
        changeType: m.delta >= 0 ? 'increment' : 'decrement',
        quantityDelta: m.delta,
        previousValue: m.before,
        newValue: m.after,
        timestamp: m.timestamp,
        userName: m.userName || '-',
        reason: m.reason,
      } as ProductLog & { reason?: string });
    });
    return logs.sort((a, b) => b.timestamp - a.timestamp);
  }, [transactions, logTarget, stockMovements]);

  return (
    <div className={`max-w-7xl mx-auto p-4 md:p-6 space-y-6 notranslate ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <SuccessVisual show={showSuccessVisual} />
      
      {/* Product Detail Modal / Context Menu */}
      <ContextMenu3D 
        isOpen={!!contextMenuTarget}
        onClose={() => setContextMenuTarget(null)}
        title={contextMenuTarget?.name || ''}
        subtitle={contextMenuTarget?.sku}
        language={language}
        details={[
          { label: t.brand, value: contextMenuTarget?.brand || 'N/A' },
          { label: t.stock, value: contextMenuTarget?.quantity?.toString() || '0' },
          { label: t.sellPrice, value: formatCurrency(contextMenuTarget?.sellingPrice || 0, contextMenuTarget?.currency) },
          { label: t.serialNumber, value: contextMenuTarget?.serialNumber || 'N/A' },
          { label: t.dateAdded, value: contextMenuTarget?.dateAdded ? new Date(contextMenuTarget.dateAdded).toLocaleDateString() : 'N/A' },
          { label: t.expiryDate, value: contextMenuTarget?.expiryDate ? new Date(contextMenuTarget.expiryDate).toLocaleDateString() : 'N/A' }
        ]}
        actions={[
          { id: 'history', label: t.historyLog, icon: <History size={18}/>, onClick: () => { setLogTarget(contextMenuTarget); setActiveAuditTab('costs'); setIsLogOpen(true); setContextMenuTarget(null); } },
          { id: 'labels', label: isRtl ? 'طباعة ملصق باركود' : 'Print barcode label', icon: <Barcode size={18}/>, onClick: () => { setLabelProducts([contextMenuTarget!]); setContextMenuTarget(null); } },
          { id: 'edit', label: t.editProduct, icon: <Edit2 size={18}/>, onClick: () => { handleEdit(contextMenuTarget!); setContextMenuTarget(null); } },
          { id: 'delete', label: t.delete, color: 'rose', icon: <Trash2 size={18}/>, onClick: () => { const id = contextMenuTarget!.id; setContextMenuTarget(null); handleDelete(id); } }
        ]}
      />
      
      {labelProducts && (
        <LabelPrintModal
          products={labelProducts}
          isRtl={isRtl}
          defaultCurrency={baseCurrency}
          businessName={settings?.businessName}
          onClose={() => setLabelProducts(null)}
        />
      )}

      {/* Page Header (ترويسة الصفحة وزر الإضافة الرئيسي) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200/40 dark:border-white/5 pb-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <div className="w-9 h-9 bg-cyan-500 rounded-xl flex items-center justify-center text-black shadow-lg shadow-cyan-500/10">
              <Package size={18} />
            </div>
            {isRtl ? 'المخزون والأصول' : t.inventory}
          </h1>
          <p className="text-xs font-bold text-slate-400 max-w-xl">
            {isRtl ? 'إدارة وتتبع جميع المنتجات والمعدات في مستودعك بسهولة وسرعة.' : 'Manage and track all products and equipment in your warehouse with ease.'}
          </p>
        </div>
        
        <TactileButton 
          onClick={openCreateProduct}
          className="px-6 py-3 rounded-xl bg-cyan-400 text-black hover:bg-cyan-300 transition-all font-black text-xs flex items-center gap-2 shadow-[0_4px_15px_rgba(6,182,212,0.25)] hover:-translate-y-0.5"
        >
          <Plus size={15} strokeWidth={2.5} />
          {isRtl ? 'إضافة منتج جديد' : t.addProduct}
        </TactileButton>
      </div>

      {/* Metrics Row (لوحة المراقبة السريعة) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t.totalItems, value: metrics.totalItems, icon: Package, color: 'cyan', bg: 'bg-cyan-500/5 dark:bg-cyan-500/5', text: 'text-cyan-500' },
          { label: t.totalValue, value: formatCurrency(metrics.totalValue, baseCurrency), icon: TrendingUp, color: 'emerald', bg: 'bg-emerald-500/5 dark:bg-emerald-500/5', text: 'text-emerald-500' },
          { label: isRtl ? 'نواقص المخزون' : 'Low Stock Items', value: metrics.lowStock, icon: TrendingDown, color: 'amber', bg: 'bg-amber-500/5 dark:bg-amber-500/5', text: 'text-amber-500' },
          { label: t.outOfStockAlert, value: metrics.outOfStock, icon: AlertCircle, color: 'rose', bg: 'bg-rose-500/5 dark:bg-rose-500/5', text: 'text-rose-500' }
        ].map((metric, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 5 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: idx * 0.05 }}
            className={`p-4 rounded-2xl border border-slate-200/50 dark:border-white/5 flex items-center gap-4 hover:border-cyan-400/15 hover:bg-white dark:hover:bg-white/[0.02] transition-colors ${metric.bg}`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${metric.text} bg-slate-100 dark:bg-white/5`}>
              <metric.icon size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{metric.label}</p>
              <p className="text-xl font-black text-slate-900 dark:text-white mt-1.5 truncate leading-none">{metric.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Table & Toolbar Container */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className={`bg-white/40 dark:bg-[#0c1221]/45 backdrop-blur-2xl rounded-2xl border border-slate-200/50 dark:border-white/5 shadow-2xl overflow-hidden flex flex-col ${celebrationClass}`}
      >
        {/* Sleek Toolbar Component (شريط أدوات التحكم والبحث والفلترة) */}
        <div className="p-4 border-b border-slate-200/40 dark:border-white/5 bg-slate-50/20 dark:bg-slate-950/10 flex flex-col md:flex-row items-stretch md:items-center gap-3">
          
          {/* Search Input */}
          <div className="relative flex-grow">
            <Search size={16} className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-4' : 'left-4'} text-slate-400`} />
            <input 
              type="text"
              placeholder={isRtl ? 'ابحث بالاسم، أو الباركود SKU...' : t.searchPlaceholder} aria-label={isRtl ? 'ابحث بالاسم، أو الباركود SKU...' : t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full ${isRtl ? 'pr-11 pl-10' : 'pl-11 pr-10'} py-2.5 bg-slate-100 dark:bg-black/40 border border-slate-200/60 dark:border-white/5 rounded-xl text-sm font-bold dark:text-white outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15 transition-all`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); sounds.playPop(); }}
                className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'left-3' : 'right-3'} p-1 hover:bg-slate-200/50 dark:hover:bg-white/10 rounded-full text-slate-400 hover:text-rose-500 transition-all cursor-pointer`}
               aria-label={isRtl ? 'إغلاق' : 'Close'}>
                <X size={14} />
              </button>
            )}
          </div>

          {/* Categories Selector */}
          <div className="relative min-w-[160px]">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full py-2.5 px-4 bg-slate-100 dark:bg-black/40 border border-slate-200/60 dark:border-white/5 rounded-xl text-xs font-black text-slate-600 dark:text-slate-300 outline-none cursor-pointer hover:border-cyan-400/35 transition-colors appearance-none"
              style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: isRtl ? 'left 12px center' : 'right 12px center', backgroundSize: '12px' }}
            >
              <option value="all" className="dark:bg-[#0c1221]">{isRtl ? 'كل التصنيفات' : 'All Categories'}</option>
              {dynamicCategories.map((cat) => (
                <option key={cat} value={cat} className="dark:bg-[#0c1221]">{cat}</option>
              ))}
            </select>
          </div>

          {/* Status Selector */}
          <div className="relative min-w-[130px]">
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              className="w-full py-2.5 px-4 bg-slate-100 dark:bg-black/40 border border-slate-200/60 dark:border-white/5 rounded-xl text-xs font-black text-slate-600 dark:text-slate-300 outline-none cursor-pointer hover:border-cyan-400/35 transition-colors appearance-none"
              style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: isRtl ? 'left 12px center' : 'right 12px center', backgroundSize: '12px' }}
            >
              <option value="all" className="dark:bg-[#0c1221]">{isRtl ? 'حسب الحالة' : 'By Status'}</option>
              <option value="in" className="dark:bg-[#0c1221]">{isRtl ? 'متوفر' : t.inStock}</option>
              <option value="low" className="dark:bg-[#0c1221]">{isRtl ? 'نواقص' : t.lowStock}</option>
              <option value="out" className="dark:bg-[#0c1221]">{isRtl ? 'نفدت الكمية' : t.outOfStock}</option>
            </select>
          </div>

          {/* Filter Advanced Toggler Button */}
          <button
            type="button"
            onClick={() => { setShowAdvancedFilters(!showAdvancedFilters); sounds.playClick(); }}
            className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-center gap-1.5 transition-all text-xs font-black cursor-pointer ${
              showAdvancedFilters 
                ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-400 font-extrabold' 
                : 'bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border-slate-200/60 dark:border-white/5 text-slate-600 dark:text-slate-300'
            }`}
            title={filterT.advancedSettings} aria-label={filterT.advancedSettings}
          >
            <Filter size={14} className={showAdvancedFilters ? 'animate-pulse' : ''} />
            <span>{isRtl ? 'تصفية متقدمة' : 'Advanced'}</span>
          </button>

          {/* Quick Data Exports */}
          <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              type="button"
              onClick={openStocktake}
              title={isRtl ? 'فتح الجرد والتسوية لتثبيت الكميات المعدودة' : 'Open stocktaking to set counted quantities'} aria-label={isRtl ? 'فتح الجرد والتسوية لتثبيت الكميات المعدودة' : 'Open stocktaking to set counted quantities'}
              className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-slate-900/5 dark:bg-white/5 text-slate-800 dark:text-slate-100 border border-slate-300/50 dark:border-white/15 hover:border-slate-400 dark:hover:border-white/30 rounded-xl text-xs font-black tracking-tight transition-all cursor-pointer"
            >
              <ClipboardCheck size={14} />
              <span>{isRtl ? 'الجرد' : 'Count'}</span>
            </button>
            <button
              type="button"
              onClick={() => { sounds.playClick(); importInputRef.current?.click(); }}
              title={isRtl ? 'استيراد منتجات من ملف CSV أو Excel (نفس أعمدة ملف التصدير)' : 'Import products from CSV/Excel (same columns as the export)'} aria-label={isRtl ? 'استيراد منتجات من ملف CSV أو Excel (نفس أعمدة ملف التصدير)' : 'Import products from CSV/Excel (same columns as the export)'}
              className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-indigo-600/10 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 hover:border-indigo-500/50 rounded-xl text-xs font-black tracking-tight transition-all cursor-pointer"
            >
              <Upload size={14} />
              <span>{isRtl ? 'استيراد' : 'Import'}</span>
            </button>
            <button
              type="button"
              onClick={exportInventoryToCSV}
              title={isRtl ? 'تصدير كميات المخزون لملف Excel/CSV' : 'Export current stock as CSV/Excel'} aria-label={isRtl ? 'تصدير كميات المخزون لملف Excel/CSV' : 'Export current stock as CSV/Excel'}
              className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-emerald-600/10 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/50 rounded-xl text-xs font-black tracking-tight transition-all cursor-pointer"
            >
              <Download size={14} />
              <span>{isRtl ? 'تصدير Excel' : 'Export Excel'}</span>
            </button>
            <button
              type="button"
              onClick={exportInventoryToPDF}
              title={isRtl ? 'طباعة وتصدير تقرير الجرد بصيغة PDF' : 'Download compiled audit PDF'} aria-label={isRtl ? 'طباعة وتصدير تقرير الجرد بصيغة PDF' : 'Download compiled audit PDF'}
              className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-cyan-600/10 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/50 rounded-xl text-xs font-black tracking-tight transition-all cursor-pointer"
            >
              <FileText size={14} />
              <span>{isRtl ? 'تقرير PDF' : 'PDF Report'}</span>
            </button>
            <button
              type="button"
              onClick={() => { sounds.playClick(); setLabelProducts(filteredProducts); }}
              title={isRtl ? 'طباعة ملصقات باركود للأصناف المعروضة' : 'Print barcode labels for the listed products'} aria-label={isRtl ? 'طباعة ملصقات باركود للأصناف المعروضة' : 'Print barcode labels for the listed products'}
              className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-slate-600/10 dark:bg-white/5 text-slate-700 dark:text-slate-200 border border-slate-500/20 hover:border-slate-500/50 rounded-xl text-xs font-black tracking-tight transition-all cursor-pointer"
            >
              <Barcode size={14} />
              <span>{isRtl ? 'ملصقات' : 'Labels'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Advanced Filters Sub-panel */}
        <AnimatePresence>
          {showAdvancedFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-b border-slate-200/40 dark:border-white/5 bg-slate-500/[0.02] dark:bg-slate-950/20"
            >
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-right" dir={isRtl ? 'rtl' : 'ltr'}>
                
                {/* 1. Search Target Scope */}
                <div className="space-y-2 lg:col-span-2">
                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                    {filterT.searchScope}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'name', 'sku', 'category'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => { setSearchMode(mode); sounds.playClick(); }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          searchMode === mode 
                            ? 'bg-cyan-500/15 border-cyan-500/35 text-cyan-600 dark:text-cyan-400 font-extrabold shadow-inner' 
                            : 'bg-white dark:bg-white/5 border-slate-200/60 dark:border-white/10 text-slate-700 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/10'
                        }`}
                      >
                        {mode === 'all' && filterT.allFields}
                        {mode === 'name' && filterT.nameOnly}
                        {mode === 'sku' && filterT.barcodeOnly}
                        {mode === 'category' && filterT.categoryOnly}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Selling Price Range */}
                <div className="space-y-2">
                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                    {filterT.priceRange} ({getCurrencySymbolByCode(settings?.currency || 'JOD')})
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder={filterT.min} aria-label={filterT.min}
                      value={minPrice}
                      onChange={e => setMinPrice(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200/60 dark:border-white/10 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-cyan-400/40"
                    />
                    <span className="text-slate-400 text-xs font-bold leading-none">-</span>
                    <input
                      type="number"
                      placeholder={filterT.max} aria-label={filterT.max}
                      value={maxPrice}
                      onChange={e => setMaxPrice(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200/60 dark:border-white/10 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-cyan-400/40"
                    />
                  </div>
                </div>

                {/* 3. Quantity Range */}
                <div className="space-y-2">
                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                    {filterT.capitalRange}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder={filterT.min} aria-label={filterT.min}
                      value={minQty}
                      onChange={e => setMinQty(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200/60 dark:border-white/10 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-cyan-400/40"
                    />
                    <span className="text-slate-400 text-xs font-bold leading-none">-</span>
                    <input
                      type="number"
                      placeholder={filterT.max} aria-label={filterT.max}
                      value={maxQty}
                      onChange={e => setMaxQty(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200/60 dark:border-white/10 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-cyan-400/40"
                    />
                  </div>
                </div>

                {/* 4. Warehouse selection */}
                <div className="space-y-2">
                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                    {filterT.warehouse}
                  </span>
                  <select
                    value={warehouseFilter}
                    onChange={e => setWarehouseFilter(e.target.value)}
                    className="w-full py-1.5 px-3 bg-white dark:bg-white/5 border border-slate-200/60 dark:border-white/10 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none cursor-pointer"
                  >
                    <option value="all" className="dark:bg-[#0c1221]">{filterT.allWarehouses}</option>
                    {warehouses.map(wh => (
                      <option key={wh.id} value={wh.id} className="dark:bg-[#0c1221]">{wh.name}</option>
                    ))}
                  </select>
                </div>

                {/* 5. Expiry categories */}
                <div className="space-y-2">
                  <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                    {filterT.expiryDateStatus}
                  </span>
                  <select
                    value={expiryFilter}
                    onChange={e => setExpiryFilter(e.target.value)}
                    className="w-full py-1.5 px-3 bg-white dark:bg-white/5 border border-slate-200/60 dark:border-white/10 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none cursor-pointer"
                  >
                    <option value="all" className="dark:bg-[#0c1221]">{filterT.allExpiries}</option>
                    <option value="has-expiry" className="dark:bg-[#0c1221]">{filterT.hasExpiry}</option>
                    <option value="critical" className="dark:bg-[#0c1221]">{filterT.criticalExpiry}</option>
                    <option value="no-expiry" className="dark:bg-[#0c1221]">{filterT.noExpiry}</option>
                  </select>
                </div>

                {/* 6. Active counters and resets */}
                <div className="lg:col-span-2 flex flex-col sm:flex-row items-center justify-between gap-3 bg-cyan-500/[0.03] dark:bg-cyan-500/[0.01] border border-cyan-500/10 p-3.5 rounded-2xl md:mt-2">
                  <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">
                    {filterT.resultsCount(filteredProducts.length, products.length)}
                  </span>
                  
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setCategoryFilter('all');
                      setStockFilter('all');
                      setSearchMode('all');
                      setMinPrice('');
                      setMaxPrice('');
                      setMinQty('');
                      setMaxQty('');
                      setWarehouseFilter('all');
                      setExpiryFilter('all');
                      sounds.playPop();
                      toast.success(isRtl ? 'تمت إعادة تعيين جميع الفلاتر بنجاح! 🔄' : 'All filters reset successfully! 🔄');
                    }}
                    className="px-3.5 py-1.5 text-xs font-extrabold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/10 hover:border-rose-500/30 rounded-xl transition-all cursor-pointer"
                  >
                    {filterT.clearFilters}
                  </button>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table View (جدول الأصول والمخزون المرتب) */}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-right min-w-[850px] border-collapse">
            <thead>
              <tr className="bg-slate-50/10 dark:bg-slate-950/25 border-b border-slate-200/30 dark:border-white/5">
                {[
                  { key: 'name', label: isRtl ? 'المنتج' : t.itemName, align: 'text-right' },
                  { key: 'category', label: isRtl ? 'التصنيف' : t.category, align: 'text-right' },
                  { key: 'unitCost', label: isRtl ? 'سعر التكلفة' : (t.unitCost || 'Cost Price'), align: 'text-right' },
                  { key: 'sellingPrice', label: isRtl ? 'سعر البيع' : t.sellPrice, align: 'text-right' },
                  { key: 'quantity', label: isRtl ? 'الكمية' : t.stock, align: 'text-right' },
                  { key: 'status', label: isRtl ? 'الحالة' : t.status, align: 'text-right' },
                ].map((col) => (
                  <th 
                    key={col.key}
                    onClick={() => handleSort(col.key as keyof Product)}
                    className="px-6 py-4.5 text-[11px] font-black text-slate-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5 font-bold">
                      <span>{col.label}</span>
                      {sortConfig.key === col.key && (
                        <span className="text-cyan-400 font-bold">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-6 py-4.5 text-[11px] font-black text-slate-400 uppercase tracking-wide text-left">{isRtl ? 'إجراءات' : t.actions}</th>
              </tr>
            </thead>
            
            <motion.tbody 
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="divide-y divide-slate-200/20 dark:divide-white/5"
            >
              {filteredProducts.length > 0 ? (
                visibleProducts.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    t={t}
                    isRtl={isRtl}
                    statusStyles={statusStyles}
                    statusLabels={statusLabels}
                    formatCurrency={formatCurrency}
                    onQuickAdjust={handleQuickAdjust}
                    onShowContextMenu={setContextMenuTarget}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    lowStockDefault={lowStockDefault}
                    warehouses={warehouses}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-20 text-slate-400 text-xs font-bold uppercase tracking-widest bg-slate-500/[0.02]">
                    <Boxes size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-700 animate-bounce" />
                    {isRtl ? 'لا توجد منتجات مطابقة لخيارات التصفية' : 'No matching items found'}
                  </td>
                </tr>
              )}
            </motion.tbody>
          </table>
        </div>

        {filteredProducts.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-slate-200/40 dark:border-white/5 text-xs font-bold text-slate-500">
            <span>
              {isRtl
                ? `عرض ${Math.min(visibleCount, filteredProducts.length)} من ${arCount(filteredProducts.length, PRODUCT_FORMS)}`
                : `Showing ${Math.min(visibleCount, filteredProducts.length)} of ${filteredProducts.length} products`}
            </span>
            {visibleCount < filteredProducts.length && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                  className="px-4 py-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/50 cursor-pointer"
                >
                  {isRtl ? `عرض ${Math.min(PAGE_SIZE, filteredProducts.length - visibleCount)} إضافي` : `Show ${Math.min(PAGE_SIZE, filteredProducts.length - visibleCount)} more`}
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filteredProducts.length)}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 cursor-pointer"
                >
                  {isRtl ? 'عرض الكل' : 'Show all'}
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Import preview */}
      <AnimatePresence>
        {importPlan && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !isImporting && setImportPlan(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              <div className="p-5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                <div>
                  <h3 className="font-black text-base text-slate-900 dark:text-white">{isRtl ? 'معاينة الاستيراد' : 'Import preview'}</h3>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5 truncate max-w-[300px]">{importPlan.fileName}</p>
                </div>
                <button type="button" disabled={isImporting} onClick={() => setImportPlan(null)} className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer disabled:opacity-40" aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{importPlan.creates.length}</p>
                    <p className="text-[11px] font-bold text-slate-500">{isRtl ? 'منتج جديد' : 'New'}</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
                    <p className="text-2xl font-black text-cyan-600 dark:text-cyan-400">{importPlan.updates.length}</p>
                    <p className="text-[11px] font-bold text-slate-500">{isRtl ? 'تحديث (نفس الباركود)' : 'Updates (same SKU)'}</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20">
                    <p className="text-2xl font-black text-rose-600 dark:text-rose-400">{importPlan.errors.length}</p>
                    <p className="text-[11px] font-bold text-slate-500">{isRtl ? 'أخطاء (تُتجاهل)' : 'Errors (skipped)'}</p>
                  </div>
                </div>

                {importPlan.updates.length > 0 && (
                  <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                    {isRtl
                      ? 'المنتجات المطابقة بالباركود ستُحدَّث بقيم الملف (الكمية والأسعار والتصنيف). يُسجَّل أي تغيير في الكمية في سجل الحركات.'
                      : 'Products with a matching SKU will be updated with the file values. Quantity changes are logged in the movement history.'}
                  </p>
                )}

                {importPlan.errors.length > 0 && (
                  <ul className="max-h-36 overflow-y-auto custom-scrollbar text-[11px] font-semibold text-rose-600 dark:text-rose-400 space-y-1 bg-rose-500/5 rounded-xl p-3">
                    {importPlan.errors.slice(0, 30).map((er, i) => <li key={i}>• {er}</li>)}
                    {importPlan.errors.length > 30 && <li>… {isRtl ? `و${importPlan.errors.length - 30} أخطاء أخرى` : `and ${importPlan.errors.length - 30} more`}</li>}
                  </ul>
                )}

                {isImporting && (
                  <div className="space-y-1.5">
                    <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                      <div className="h-full bg-cyan-500 transition-all" style={{ width: `${(importProgress / Math.max(1, importPlan.creates.length + importPlan.updates.length)) * 100}%` }} />
                    </div>
                    <p className="text-[11px] text-slate-500 font-bold text-center">{importProgress} / {importPlan.creates.length + importPlan.updates.length}</p>
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] flex items-center justify-end gap-3">
                <button type="button" disabled={isImporting} onClick={() => setImportPlan(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 cursor-pointer disabled:opacity-40">
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={isImporting || importPlan.creates.length + importPlan.updates.length === 0}
                  onClick={confirmImport}
                  className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700/50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isImporting ? (isRtl ? 'جارٍ الاستيراد...' : 'Importing...') : (isRtl ? `استيراد ${arCount(importPlan.creates.length + importPlan.updates.length, PRODUCT_FORMS)}` : `Import ${importPlan.creates.length + importPlan.updates.length} products`)}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
 
      {/* Product Registration Modal (إضافة وتعديل صنف جديد) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-2xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden transition-all duration-200"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              {/* Modal Header */}
              {editingProduct ? (
                <div className="bg-[#0b1329] p-5 text-white flex items-center justify-between border-b border-cyan-500/25">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl border border-cyan-500/20">
                      <Package size={22} className="text-cyan-400 animate-pulse animate-duration-1000" />
                    </div>
                    <div className="text-right">
                      <h3 className="font-bold text-base text-white">
                        {isRtl ? 'تعديل بيانات المنتج' : 'Edit Product Details'}
                      </h3>
                      <p className="text-xs text-slate-400 font-mono mt-0.5 tracking-wider">
                        {newProduct.sku || editingProduct.sku || editingProduct.id}
                      </p>
                    </div>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                   aria-label={isRtl ? 'إغلاق' : 'Close'}>
                    <X size={20} />
                  </button>
                </div>
              ) : (
                <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50 dark:bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-tr from-emerald-500 to-teal-400 dark:from-emerald-600 dark:to-teal-500 rounded-xl flex items-center justify-center text-white shadow-md">
                      <Plus size={20} strokeWidth={2.5} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                      {isRtl ? 'تسجيل منتج جديد' : t.addProduct}
                    </h3>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)} 
                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer"
                   aria-label={isRtl ? 'إغلاق' : 'Close'}>
                    <X size={18} />
                  </button>
                </div>
              )}
              
              {/* Modal Form — basic desk path first; advanced details stay collapsed */}
              <form onSubmit={handleAddProduct} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">

                {!editingProduct && (
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-relaxed -mt-1">
                    {isRtl
                      ? 'للتسجيل السريع: الاسم وسعر البيع كافيان. الباركود يُولَّد تلقائياً إن تُرك فارغاً.'
                      : 'For a fast entry: name and selling price are enough. An empty barcode gets an automatic SKU.'}
                  </p>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'اسم المنتج' : t.itemName}</label>
                  <input
                    ref={nameInputRef}
                    required
                    type="text"
                    maxLength={200}
                    value={newProduct.name || ''}
                    onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                    placeholder={isRtl ? 'مثال: قهوة اسبريسو 1 كجم' : 'e.g. Espresso Coffee 1kg'}
                    aria-label={isRtl ? 'اسم المنتج' : 'Product name'}
                    className="w-full px-4 py-3 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none transition-all dark:text-white font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Tag size={14} className="text-slate-400" />
                      <span>{isRtl ? 'الباركود / SKU' : t.sku}</span>
                      <span className="text-[10px] font-semibold text-slate-400">{isRtl ? '(اختياري)' : '(optional)'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        sounds.playClick();
                        setIsCameraScannerOpen(!isCameraScannerOpen);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg transition-all cursor-pointer select-none"
                    >
                      <Camera size={13} className="shrink-0" />
                      <span>{isRtl ? 'مسح' : 'Scan'}</span>
                    </button>
                  </label>
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    maxLength={64}
                    value={newProduct.sku || ''}
                    onChange={e => setNewProduct({ ...newProduct, sku: e.target.value })}
                    placeholder={isRtl ? 'امسح الباركود أو اتركه للتوليد التلقائي' : 'Scan barcode or leave blank to auto-generate'}
                    aria-label={isRtl ? 'الباركود' : 'SKU'}
                    className="w-full px-4 py-3 font-mono text-base bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus:border-emerald-500 outline-none transition-all dark:text-white font-bold"
                  />
                  <AnimatePresence>
                    {isCameraScannerOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden mt-1.5"
                      >
                        <BarcodeScannerScanner
                          isRtl={isRtl}
                          onScan={(scannedSku) => {
                            setNewProduct({ ...newProduct, sku: scannedSku });
                          }}
                          onClose={() => setIsCameraScannerOpen(false)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'التصنيف' : t.category}</label>
                    <input
                      type="text"
                      list="categories-list"
                      value={newProduct.category || ''}
                      onChange={e => setNewProduct({ ...newProduct, category: e.target.value })}
                      placeholder={defaultProductCategory(isRtl)}
                      aria-label={isRtl ? 'التصنيف' : 'Category'}
                      className="w-full px-4 py-3 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none transition-all dark:text-white font-bold"
                    />
                    <datalist id="categories-list">
                      {dynamicCategories.map((cat) => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'الكمية المتوفرة' : t.stock}</label>
                    {sellByPack && isValidPackSize(newProduct.packSize) ? (() => {
                      const size = Number(newProduct.packSize);
                      const total = Number(newProduct.quantity) || 0;
                      const packs = Math.floor(total / size + 1e-9);
                      const loose = Math.round((total - packs * size) * 1000) / 1000;
                      const setQty = (p: number, l: number) => setNewProduct({ ...newProduct, quantity: Math.max(0, p) * size + Math.max(0, l) });
                      const box = newProduct.packName?.trim() || (isRtl ? 'عبوة' : 'pack');
                      const unit = newProduct.unitName?.trim() || (isRtl ? 'وحدة' : 'unit');
                      return (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="relative block">
                              <input
                                type="number" min={0} step={1}
                                value={packs}
                                onChange={e => setQty(Math.floor(Number(e.target.value) || 0), loose)}
                                onFocus={e => e.target.select()}
                                aria-label={box}
                                className="w-full px-3 py-3 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none dark:text-white font-mono font-bold text-lg"
                              />
                              <span className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'left-3' : 'right-3'} text-xs font-bold text-slate-400`}>{box}</span>
                            </label>
                            <label className="relative block">
                              <input
                                type="number" min={0} step="any"
                                value={loose}
                                onChange={e => setQty(packs, Number(e.target.value) || 0)}
                                onFocus={e => e.target.select()}
                                aria-label={unit}
                                className="w-full px-3 py-3 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none dark:text-white font-mono font-bold text-lg"
                              />
                              <span className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'left-3' : 'right-3'} text-xs font-bold text-slate-400`}>{unit}</span>
                            </label>
                          </div>
                          <p className="text-[11px] font-bold text-slate-500">
                            {isRtl ? `المجموع: ${total} ${unit}` : `Total: ${total} ${unit}`}
                          </p>
                        </div>
                      );
                    })() : (
                      <div className="relative">
                        <input 
                          required 
                          type="number" 
                          min={0}
                          step="any"
                          value={newProduct.quantity !== undefined ? newProduct.quantity : 0}
                          onChange={e => setNewProduct({...newProduct, quantity: Number(e.target.value)})}
                          onFocus={e => e.target.select()}
                          className="w-full px-4 py-3 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none transition-all dark:text-white font-mono font-bold text-lg"
                        />
                        <ArrowRightLeft className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'left-4' : 'right-4'} text-slate-400`} size={16} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Reason for a manual quantity change (stored in the stock movement log) */}
                {editingProduct && Number(newProduct.quantity ?? 0) !== Number(editingProduct.quantity) && (
                  <div className="space-y-1.5 p-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.05]">
                    <label className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {isRtl
                        ? `سبب تغيير الكمية (${editingProduct.quantity} ← ${Number(newProduct.quantity ?? 0)})`
                        : `Reason for quantity change (${editingProduct.quantity} → ${Number(newProduct.quantity ?? 0)})`}
                    </label>
                    <input
                      type="text"
                      maxLength={300}
                      value={stockReason}
                      onChange={e => setStockReason(e.target.value)}
                      placeholder={isRtl ? 'مثال: تالف، هدية، تصحيح خطأ إدخال...' : 'e.g. damaged, gift, data correction...'} aria-label={isRtl ? 'سبب تغيير الكمية' : 'Reason for quantity change'}
                      className="w-full px-4 py-2.5 bg-white dark:bg-white/[0.02] border border-amber-500/30 rounded-xl outline-none text-sm font-bold dark:text-white"
                    />
                    <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 font-medium leading-relaxed">
                      {isRtl
                        ? 'لتثبيت كمية معدودة من الجرد الفعلي استخدم شاشة الجرد والتسوية.'
                        : 'To set a counted quantity from a physical count, use Stocktaking.'}
                      {' '}
                      <button
                        type="button"
                        onClick={openStocktake}
                        className="underline font-bold text-amber-900 dark:text-amber-200 cursor-pointer bg-transparent p-0"
                      >
                        {isRtl ? 'فتح الجرد' : 'Open stocktaking'}
                      </button>
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 dark:bg-white/[0.01] p-4 rounded-2xl border border-slate-200 dark:border-white/5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      {isRtl ? 'عملة الصنف' : 'Product Currency'}
                    </label>
                    <CurrencyPicker
                      value={newProduct.currency || settings?.currency || 'JOD'}
                      onChange={(code) => setNewProduct({ ...newProduct, currency: code })}
                      isRtl={isRtl}
                      label={isRtl ? 'عملة الصنف' : 'Product currency'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      {isRtl ? 'سعر الشراء (التكلفة)' : t.unitCost}
                    </label>
                    <input
                      required
                      type="number"
                      min={0}
                      step="any"
                      value={newProduct.unitCost !== undefined ? newProduct.unitCost : 0}
                      onChange={e => setNewProduct({ ...newProduct, unitCost: Number(e.target.value) })}
                      onFocus={e => e.target.select()}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none font-mono font-bold dark:text-white text-lg"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      {isRtl ? 'سعر البيع' : t.sellPrice}
                    </label>
                    <input
                      required
                      type="number"
                      min={0}
                      step="any"
                      value={newProduct.sellingPrice !== undefined ? newProduct.sellingPrice : 0}
                      onChange={e => setNewProduct({ ...newProduct, sellingPrice: Number(e.target.value) })}
                      onFocus={e => e.target.select()}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none font-mono font-bold dark:text-white text-lg"
                    />
                  </div>
                </div>

                {(() => {
                  const costNum = Number(newProduct.unitCost) || 0;
                  const priceNum = Number(newProduct.sellingPrice) || 0;
                  const profitAmount = priceNum - costNum;
                  const profitMargin = costNum > 0 ? ((profitAmount / costNum) * 100) : 0;
                  const isLoss = profitAmount < 0;
                  const isZero = costNum === 0 || priceNum === 0;
                  const curSym = getCurrencySymbolByCode(newProduct.currency || settings?.currency || 'JOD');
                  return (
                    <div className={`px-4 py-3 rounded-xl border flex items-center justify-between gap-3 ${
                      isZero
                        ? 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/5'
                        : isLoss
                          ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20'
                          : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                    }`}>
                      <span className={`text-xs font-bold ${isZero ? 'text-slate-500' : isLoss ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                        {isZero
                          ? (isRtl ? 'هامش الربح' : 'Margin')
                          : isLoss
                            ? (isRtl ? 'تسعير بخسارة' : 'Priced at a loss')
                            : (isRtl ? 'هامش الربح' : 'Margin')}
                      </span>
                      <span className={`text-sm font-black font-mono tabular-nums ${isZero ? 'text-slate-600 dark:text-slate-300' : isLoss ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {profitAmount > 0 ? '+' : ''}{roundMoney(profitAmount, newProduct.currency || baseCurrency)} {curSym}
                        {!isZero ? ` · ${profitMargin.toFixed(1)}%` : ''}
                      </span>
                    </div>
                  );
                })()}

                <div className="rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      setShowAdvanced((v) => !v);
                    }}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 bg-slate-50/80 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    aria-expanded={showAdvanced}
                  >
                    <span className="text-start">
                      <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">
                        {isRtl ? 'تفاصيل إضافية' : 'More details'}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                        {isRtl
                          ? 'علامة، صلاحية، عبوات، تكاليف، مستودع'
                          : 'Brand, expiry, packs, landed cost, warehouse'}
                      </span>
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  </button>

                  {showAdvanced && (
                    <div className="p-4 space-y-5 border-t border-slate-200 dark:border-white/10">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'العلامة التجارية' : t.brand}</label>
                          <input
                            type="text"
                            value={newProduct.brand || ''}
                            onChange={e => setNewProduct({ ...newProduct, brand: e.target.value })}
                            placeholder={isRtl ? 'اختياري' : 'Optional'}
                            aria-label={isRtl ? 'العلامة التجارية' : 'Brand'}
                            className="w-full px-4 py-2.5 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none dark:text-white font-bold text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'الرقم التسلسلي (S/N)' : t.serialNumber}</label>
                          <input
                            type="text"
                            value={newProduct.serialNumber || ''}
                            onChange={e => setNewProduct({ ...newProduct, serialNumber: e.target.value })}
                            placeholder={isRtl ? 'اختياري' : 'Optional'}
                            aria-label={isRtl ? 'الرقم التسلسلي' : 'Serial number'}
                            className="w-full px-4 py-2.5 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none dark:text-white font-bold text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                            <Calendar size={14} className="text-slate-400" />
                            {isRtl ? 'تاريخ الصلاحية' : t.expiryDate}
                          </label>
                          <DateField
                            value={newProduct.expiryDate ? localIsoDate(newProduct.expiryDate) : ''}
                            onChange={(iso) =>
                              setNewProduct({
                                ...newProduct,
                                expiryDate: iso ? (localDayStart(iso) ?? undefined) : undefined,
                              })
                            }
                            aria-label={isRtl ? 'تاريخ الصلاحية' : t.expiryDate}
                            className="w-full bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus-within:border-blue-500 dark:text-white font-bold text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'حد نقص المخزون' : t.itemLowStockThreshold}</label>
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              placeholder={String(resolveLowStockThreshold(undefined, lowStockDefault))}
                              aria-label={isRtl ? 'حد نقص المخزون' : 'Low-stock threshold'}
                              value={newProduct.lowStockThreshold !== undefined ? newProduct.lowStockThreshold : ''}
                              onChange={e => setNewProduct({ ...newProduct, lowStockThreshold: e.target.value ? Number(e.target.value) : undefined })}
                              className="w-full px-4 py-2.5 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-rose-400 outline-none dark:text-white font-bold text-sm"
                            />
                            <ShieldAlert className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'left-3' : 'right-3'} text-rose-400/70`} size={15} />
                          </div>
                        </div>
                      </div>

                <div className="p-4 rounded-2xl border border-slate-200 dark:border-white/5 space-y-4">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="flex flex-col">
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{isRtl ? 'يُباع أيضاً بالجملة (صندوق / كرتونة)' : 'Also sold by the pack (box / carton)'}</span>
                      <span className="text-[11px] text-slate-400 font-bold">
                        {isRtl ? 'المخزون يبقى بالوحدة؛ بيع صندوق ينقص عدد وحداته تلقائياً.' : 'Stock stays in units; selling a pack takes its units out automatically.'}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={sellByPack}
                      onChange={e => setSellByPack(e.target.checked)}
                      className="w-5 h-5 accent-indigo-600 shrink-0"
                    />
                  </label>

                  {sellByPack && (() => {
                    const size = Number(newProduct.packSize);
                    const unitPrice = Number(newProduct.sellingPrice) || 0;
                    const suggested = isValidPackSize(size) ? suggestedPackPrice(unitPrice, size) : 0;
                    const price = newProduct.packPrice ?? suggested;
                    const curr = newProduct.currency || settings?.currency || 'JOD';
                    const field = 'w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none font-bold text-sm dark:text-white';
                    return (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{isRtl ? 'اسم الوحدة' : 'Unit name'}</label>
                          <input type="text" maxLength={20} value={newProduct.unitName || ''} placeholder={isRtl ? 'علبة، حبة، قطعة' : 'can, piece'}
                            onChange={e => setNewProduct({ ...newProduct, unitName: e.target.value })} className={field} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{isRtl ? 'اسم العبوة' : 'Pack name'}</label>
                          <input type="text" maxLength={20} value={newProduct.packName || ''} placeholder={isRtl ? 'صندوق، كرتونة' : 'box, carton'}
                            onChange={e => setNewProduct({ ...newProduct, packName: e.target.value })} className={field} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{isRtl ? 'عدد الوحدات في العبوة' : 'Units per pack'}</label>
                          <input type="number" min={2} max={10000} step={1} required value={newProduct.packSize ?? ''} placeholder="20"
                            onChange={e => setNewProduct({ ...newProduct, packSize: e.target.value ? Number(e.target.value) : undefined })}
                            className={`${field} font-mono`} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{isRtl ? 'سعر العبوة (جملة)' : 'Pack price (wholesale)'}</label>
                          <input type="number" min={0} step="any" value={newProduct.packPrice ?? ''} placeholder={suggested ? String(suggested) : ''}
                            onChange={e => setNewProduct({ ...newProduct, packPrice: e.target.value ? Number(e.target.value) : undefined })}
                            onFocus={e => e.target.select()}
                            className={`${field} font-mono`} />
                          {isValidPackSize(size) && price > 0 && (
                            <p className="text-[10px] font-bold text-slate-400">
                              {isRtl
                                ? `الوحدة داخل العبوة: ${formatMoney(unitPriceInPack(price, size), curr)}${unitPrice > 0 ? ` · المفرد: ${formatMoney(unitPrice, curr)}` : ''}`
                                : `Unit inside the pack: ${formatMoney(unitPriceInPack(price, size), curr)}${unitPrice > 0 ? ` · single: ${formatMoney(unitPrice, curr)}` : ''}`}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5 col-span-2">
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{isRtl ? 'باركود العبوة (اختياري)' : 'Pack barcode (optional)'}</label>
                          <input type="text" maxLength={64} value={newProduct.packBarcode || ''}
                            onChange={e => setNewProduct({ ...newProduct, packBarcode: e.target.value })}
                            className={`${field} font-mono`} />
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="bg-slate-500/[0.03] dark:bg-slate-500/[0.01] p-4 rounded-2xl border border-slate-200/50 dark:border-white/5 space-y-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {isRtl ? 'تفصيل تكلفة الشراء (اختياري)' : 'Purchase cost breakdown (optional)'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium mt-0.5">
                      {isRtl ? 'للتدقيق على التكلفة المستوردة والضرائب والإضافات.' : 'For landed-cost audit: base, tax and extras.'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {isRtl ? 'التكلفة الأساسية' : 'Base cost'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={newProduct.baseCostPrice !== undefined ? newProduct.baseCostPrice : ''}
                        onChange={e => setNewProduct({ ...newProduct, baseCostPrice: e.target.value ? Number(e.target.value) : undefined })}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none font-mono font-bold text-sm dark:text-white"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {isRtl ? 'ضرائب / جمارك %' : 'Tax / duty %'}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder={String(settings?.defaultVatRate ?? 0)}
                        aria-label={isRtl ? 'نسبة الضرائب' : 'Tax rate'}
                        value={newProduct.taxRate !== undefined ? newProduct.taxRate : ''}
                        onChange={e => setNewProduct({ ...newProduct, taxRate: e.target.value ? Number(e.target.value) : undefined })}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none font-mono font-bold text-sm dark:text-white"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        {isRtl ? 'تكاليف إضافية' : 'Additional cost'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={newProduct.additionalCosts !== undefined ? newProduct.additionalCosts : ''}
                        onChange={e => setNewProduct({ ...newProduct, additionalCosts: e.target.value ? Number(e.target.value) : undefined })}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none font-mono font-bold text-sm dark:text-white"
                      />
                    </div>
                  </div>

                  {(() => {
                    const base = Number(newProduct.baseCostPrice) || 0;
                    const tax = newProduct.taxRate !== undefined && newProduct.taxRate !== null && Number.isFinite(Number(newProduct.taxRate)) ? Number(newProduct.taxRate) : (Number(settings?.defaultVatRate) || 0);
                    const extra = Number(newProduct.additionalCosts) || 0;
                    const calculatedCost = base + (base * (tax / 100)) + extra;
                    const curr = newProduct.currency || settings?.currency || 'JOD';

                    if (base > 0) {
                      return (
                        <div className="mt-2 text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 font-bold select-none">
                          <span>
                            {isRtl
                              ? `الإجمالي المحتسب: \u2066${calculatedCost.toFixed(2)} ${curr}\u2069`
                              : `Calculated total: ${calculatedCost.toFixed(2)} ${curr}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => setNewProduct(prev => ({ ...prev, unitCost: Number(calculatedCost.toFixed(4)) }))}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-cyan-700 dark:hover:bg-cyan-600 text-white font-bold rounded-lg transition-colors cursor-pointer text-[10px]"
                          >
                            {isRtl ? 'اعتماد كسعر الشراء' : 'Apply as purchase cost'}
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {isRtl ? 'المستودع' : 'Warehouse'}
                  </label>
                  <select
                    value={newProduct.warehouseId || ''}
                    onChange={e => setNewProduct({ ...newProduct, warehouseId: e.target.value })}
                    className="w-full px-4 py-2.5 bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl focus:border-blue-500 outline-none transition-all dark:text-white font-bold text-sm"
                  >
                    <option value="" className="text-slate-900 bg-white dark:bg-slate-900">
                      {isRtl ? 'المقر الرئيسي' : 'Headquarters'}
                    </option>
                    {warehouses.map(wh => (
                      <option key={wh.id} value={wh.id} className="text-slate-900 bg-white dark:bg-slate-900">
                        {wh.name} {wh.location ? `(${wh.location})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {newProduct.expiryDate && isExpiryCritical(newProduct.expiryDate) && (
                  <div className="flex items-center gap-2.5 p-3 bg-amber-500/[0.08] dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs rounded-xl border border-amber-500/20 font-medium">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      {isRtl
                        ? 'تاريخ الصلاحية حرج (أقل من 6 أشهر). راجع قبل الحفظ.'
                        : 'Expiry is critical (under 6 months). Review before saving.'}
                    </span>
                  </div>
                )}
                    </div>
                  )}
                </div>

                {errorMessage && (
                  <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold border border-rose-200 dark:border-rose-500/20">
                    {errorMessage}
                  </div>
                )}

                {/* Submit / Action Controls Buttons Row */}
                <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] -mx-6 -mb-6 flex items-center justify-end gap-3 mt-4">
                  {editingProduct ? (
                    <>
                      <button 
                        type="button"
                        onClick={() => setIsModalOpen(false)}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-medium rounded-xl text-sm transition-colors cursor-pointer"
                      >
                        {isRtl ? 'إلغاء الأمر' : 'Cancel'}
                      </button>
                      <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#0b1329] text-cyan-400 border border-cyan-500/30 font-bold rounded-xl text-sm hover:bg-slate-800 dark:bg-white/5 dark:hover:bg-white/10 transition-all shadow-[0_0_15px_rgba(34,211,238,0.15)] cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-4 h-4 text-cyan-400" />
                        <span>{isSubmitting ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...') : (isRtl ? 'حفظ التعديلات' : 'Save changes')}</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => setIsModalOpen(false)}
                        className="px-5 py-2.5 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isRtl ? 'إلغاء' : t.cancel}
                      </button>
                      <button 
                        type="submit"
                        disabled={!(newProduct.name || '').trim() || !(Number(newProduct.sellingPrice) > 0) || isSubmitting}
                        className="px-6 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700/50 disabled:text-slate-500 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-600/30 disabled:shadow-none cursor-pointer active:scale-95 flex items-center gap-2"
                      >
                        {isSubmitting ? (
                          <>
                            <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>{isRtl ? 'جارٍ الحفظ...' : 'Saving...'}</span>
                          </>
                        ) : (
                          <span>{isRtl ? 'حفظ المنتج' : 'Save Product'}</span>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Log Modal (سجل التدقيق والمراجعة) */}
      <AnimatePresence>
        {isLogOpen && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLogOpen(false)}
              className="absolute inset-0 bg-[#04060a]/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl bg-white dark:bg-[#0c1221] border border-slate-200 dark:border-white/10 rounded-2xl shadow-3xl overflow-hidden"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              {/* Header */}
              <div className="p-5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-black/25">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center font-bold">
                    🔍
                  </div>
                  <div className="flex flex-col">
                    <h3 className="text-sm font-black uppercase tracking-tight">
                      {isRtl ? `تدقيق ومراجعة: ${logTarget?.name}` : `Audit & Verify: ${logTarget?.name}`}
                    </h3>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                      SKU: {logTarget?.sku} • {isRtl ? 'العملة الافتراضية' : 'Default Currency'}: {logTarget?.currency || settings?.currency || 'JOD'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setIsLogOpen(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-white/5 rounded-xl transition-all cursor-pointer" aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={20} />
                </button>
              </div>

              {/* Seamless Glass Navigation Tabs */}
              <div className="flex border-b border-slate-200/50 dark:border-white/5 bg-slate-50/30 dark:bg-black/10">
                <button
                  type="button"
                  onClick={() => setActiveAuditTab('costs')}
                  className={`flex-1 py-3 text-xs font-black uppercase tracking-tight flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
                    activeAuditTab === 'costs'
                      ? 'border-indigo-500 text-indigo-600 dark:text-cyan-400 font-extrabold bg-indigo-500/[0.02]'
                      : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-500/[0.01]'
                  }`}
                >
                  <span>📊</span>
                  <span>{isRtl ? 'تدقيق تفاصيل التكلفة والتسعير' : 'Prices & Cost Audit'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveAuditTab('movements')}
                  className={`flex-1 py-3 text-xs font-black uppercase tracking-tight flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
                    activeAuditTab === 'movements'
                      ? 'border-indigo-500 text-indigo-600 dark:text-cyan-400 font-extrabold bg-indigo-500/[0.02]'
                      : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-500/[0.01]'
                  }`}
                >
                  <span>🕒</span>
                  <span>{isRtl ? 'سجل حركات كميات الصنف' : 'Stock Movement Log'}</span>
                </button>
              </div>

              {/* Scrollable Modal Container Body */}
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {activeAuditTab === 'costs' ? (
                  logTarget ? (() => {
                    const baseCurrency = logTarget.currency || settings?.currency || 'JOD';
                    
                    // Core costs
                    const rawBase = logTarget.baseCostPrice;
                    const rawTaxRate = logTarget.taxRate !== undefined ? logTarget.taxRate : undefined;
                    const rawOverhead = logTarget.additionalCosts;
                    
                    // Fallbaking defaults if cost params are undefined to render estimatated break down
                    const defaultTax = Number(settings?.defaultVatRate) || 0;
                    const parsedBase = rawBase !== undefined ? rawBase : (logTarget.unitCost / (1 + defaultTax / 100));
                    const parsedTaxRate = rawTaxRate !== undefined ? rawTaxRate : defaultTax;
                    const parsedTaxAmount = parsedBase * (parsedTaxRate / 100);
                    const parsedOverhead = rawOverhead !== undefined ? rawOverhead : 0;
                    
                    const calculatedLanded = parsedBase + parsedTaxAmount + parsedOverhead;
                    const registeredLanded = logTarget.unitCost;
                    const consumerPrice = logTarget.sellingPrice;
                    
                    const profitMargin = consumerPrice - registeredLanded;
                    const profitPercentage = registeredLanded > 0 ? (profitMargin / registeredLanded * 100) : 0;
                    const isProfitLoss = profitMargin < 0;

                    // Same live/manual rates as the POS (no hardcoded numbers)
                    const getConvertedPrice = (value: number, from: string, to: string) =>
                      safeConvertMoney(value, from, to, usdRates);

                    const moneyHere = (amount: number, code = baseCurrency) =>
                      formatMoney(amount, code, isRtl ? 'ar' : 'en-US');

                    const showIsEstimatedWarning = rawBase === undefined;

                    return (
                      <div className="space-y-5 text-right" dir={isRtl ? 'rtl' : 'ltr'}>
                        {/* Cost Breakdown Bento Grid */}
                        <div className="bg-slate-500/[0.02] dark:bg-black/30 p-5 rounded-3xl border border-slate-200/60 dark:border-white/5 space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase text-indigo-600 dark:text-cyan-400">
                              📋 {isRtl ? 'تفصيل تكاليف السلعة ومصاريف الاستيراد' : 'Item Landed Costs & Taxes Details'}
                            </span>
                            {showIsEstimatedWarning && (
                              <span className="text-[9px] bg-amber-500/10 text-amber-500 px-2.5 py-0.5 rounded-full font-bold">
                                {isRtl ? 'لم تُسجَّل تفاصيل التكلفة لهذا الصنف' : 'No cost breakdown recorded'}
                              </span>
                            )}
                          </div>

                          <div className="space-y-2.5 divide-y divide-slate-100 dark:divide-white/5 text-xs">
                            {!showIsEstimatedWarning && (<>
                            <div className="flex justify-between items-center py-2">
                              <span className="text-slate-400 font-bold">{isRtl ? 'السعر الأصلي المستورد/الأساسي:' : 'Factory / Original Base Price:'}</span>
                              <span className="font-mono font-extrabold text-slate-800 dark:text-slate-200">
                                {moneyHere(parsedBase)}
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-2.5">
                              <span className="text-slate-400 font-bold">
                                {isRtl ? `الجمارك والضرائب المتكبدة (${parsedTaxRate}%):` : `Customs & Taxes Spent (${parsedTaxRate}%):`}
                              </span>
                              <span className="font-mono font-extrabold text-slate-800 dark:text-slate-200">
                                + {moneyHere(parsedTaxAmount)}
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-2.5">
                              <span className="text-slate-400 font-bold">{isRtl ? 'تكاليف إضافية (شحن ولوجستيات):' : 'Additional Overheads (Logistics/Shipping):'}</span>
                              <span className="font-mono font-extrabold text-slate-800 dark:text-slate-200">
                                + {moneyHere(parsedOverhead)}
                              </span>
                            </div>
                            </>)}

                            <div className="flex justify-between items-center py-3 bg-indigo-500/[0.02] dark:bg-indigo-500/[0.01] px-2 rounded-xl border border-indigo-500/10">
                              <span className="text-indigo-600 dark:text-cyan-400 font-black">{isRtl ? 'تكلفة التخزين / سعر الشراء النهائي:' : 'Registered Landed Unit Cost:'}</span>
                              <span className="font-mono font-black text-indigo-600 dark:text-cyan-400 text-sm">
                                {moneyHere(registeredLanded)}
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-3">
                              <span className="text-slate-700 dark:text-slate-300 font-black">{isRtl ? 'سعر البيع المعروض للمستهلك:' : 'Consumer Selling Price:'}</span>
                              <span className="font-mono font-black text-emerald-500 text-sm">
                                {moneyHere(consumerPrice)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Profit Margin Indicator */}
                        <div className={`p-4 rounded-2xl border flex items-center justify-between ${
                          isProfitLoss 
                            ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' 
                            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                        }`}>
                          <div className="space-y-0.5">
                            <span className="text-xs font-black block">
                              💰 {isRtl ? 'الهامش والربحية الإجمالية المقدرة' : 'Gross Margin & Profitability'}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                              {isRtl ? 'الفرق بين سعر البيع وتكلفة الوصول للمخزن' : 'Difference between retail price and storage cost.'}
                            </span>
                          </div>
                          <div className="text-left">
                            <span className="text-lg font-mono font-black block">
                              {isProfitLoss ? '' : '+'}{moneyHere(profitMargin)}
                            </span>
                            <span className="text-[10px] font-bold block">
                              ({profitPercentage.toFixed(1)}%) {isRtl ? 'هامش ربح' : 'Margin markup'}
                            </span>
                          </div>
                        </div>

                        {/* Educational POS Conversion Explanation Box */}
                        <div className="bg-amber-500/10 border border-amber-500/20 p-4.5 rounded-2xl space-y-3.5 text-amber-800 dark:text-amber-400">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">💡</span>
                            <span className="text-xs font-black">
                              {isRtl ? 'توضيح مهم: كيف يحسب التطبيق الأسعار والصرف؟' : 'Important Note: How does the system calculate dynamic currencies?'}
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed font-semibold">
                            {isRtl 
                              ? 'إذا واجهت تغيراً مفاجئاً في السعر (مثل تسجيل بـ 13 وملاحظته بـ 78 في شاشة نقاط البيع)، يرجى العلم أن هذا يحدث بسبب تحويل العملات التلقائي. فالسلعة تكون مخزنة في المستودع بعملة الصنف الافتراضية (مثلاً الدينار JOD)، وعند فتح البيع بعملة الشيكل (ILS)، يضرب سعر الشراء بأسعار الصرف المتغيرة مضافاً إليه معدلات الضريبة المقررة.'
                              : 'If you register an item at 13 and it shows as 78 in the shop screen, this is due to automatic storage currency translations. The item is saved with the default store currency (JOD), and translated to shekels (ILS) dynamically based on exchange rates and tax configurations during checkout.'
                            }
                          </p>
                        </div>

                        {/* Live POS Conversion Matrix */}
                        <div className="space-y-2">
                          <span className="text-xs font-black uppercase text-slate-400 dark:text-slate-400 block px-1">
                            🌐 {isRtl ? 'محاكاة الأسعار عبر العملات المختلفة في نقاط البيع' : 'Live POS Currency Simulation Matrix'}
                          </span>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {POS_CURRENCY_CODES.map((code) => (
                              <div key={code} className="p-3 bg-slate-50 dark:bg-black/20 rounded-xl border border-slate-200/50 dark:border-white/5 text-center">
                                <span className="text-[10px] text-slate-400 font-bold block font-mono">{code}</span>
                                <p className="font-mono font-black text-xs text-slate-800 dark:text-slate-200 mt-1">{(() => { const v = getConvertedPrice(registeredLanded, baseCurrency, code); return v === null ? '—' : moneyHere(v, code); })()}</p>
                                <p className="font-mono text-[9px] text-emerald-500 font-black mt-0.5">{(() => { const v = getConvertedPrice(consumerPrice, baseCurrency, code); return v === null ? '—' : moneyHere(v, code); })()}</p>
                              </div>
                            ))}
                          </div>
                          <span className="text-[9px] text-slate-400 font-bold text-center block mt-1">
                            {isRtl ? '* السطر الأول: تكلفة الشراء • السطر الثاني: سعر البيع النهائي للمستهلك.' : '* First row is the cost price, second row is the final selling price.'}
                          </span>
                        </div>
                      </div>
                    );
                  })() : null
                ) : (
                  <div className="space-y-3.5">
                    {productLogs.length > 0 ? (
                      productLogs.map((log) => (
                        <div key={log.id} className="p-4 bg-slate-50 dark:bg-black/35 rounded-xl border border-slate-200/50 dark:border-white/5 flex items-start gap-4 hover:border-cyan-400/15 transition-all text-right" dir={isRtl ? 'rtl' : 'ltr'}>
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${log.changeType === 'increment' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                            {log.changeType === 'increment' ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-black text-xs uppercase dark:text-white">
                                {log.action === 'sale' ? t.sale
                                  : log.action === 'purchase' ? t.purchase
                                  : log.action === 'return' ? (isRtl ? 'مرتجع مبيعات' : 'Sales return')
                                  : log.action === 'purchase_return' ? (isRtl ? 'مرتجع مشتريات' : 'Purchase return')
                                  : log.action === 'create' ? (isRtl ? 'رصيد افتتاحي' : 'Opening stock')
                                  : (isRtl ? 'تعديل يدوي للكمية' : 'Manual adjustment')}
                              </p>
                              <span className="text-[10px] text-slate-400 font-bold uppercase">{new Date(log.timestamp).toLocaleString()}</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              {isRtl ? 'الكمية الفرعية المضافة/المنقوصة:' : 'Quantity Delta:'} <span className="font-mono font-black text-cyan-500" dir="ltr">{(log.quantityDelta ?? 0) > 0 ? '+' : ''}{log.quantityDelta}</span>
                              {(log.action === 'update_stock' || log.action === 'create') && (
                                <span className="font-mono text-slate-400 mx-2" dir="ltr">({String(log.previousValue)} → {String(log.newValue)})</span>
                              )}
                            </p>
                            {(log as ProductLog & { reason?: string }).reason && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-semibold">
                                {isRtl ? 'السبب: ' : 'Reason: '}{(log as ProductLog & { reason?: string }).reason}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1 font-bold">
                              <Tag size={10} /> {t.user}: <span className="font-bold text-slate-600 dark:text-slate-300">{log.userName}</span>
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-20 text-slate-400 text-xs font-bold uppercase tracking-wider">
                        <History size={40} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                        {t.noTransactionsToday}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
