import React, { useMemo, useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Package, 
  FileText, 
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Bell,
  X,
  DollarSign,
  Search,
  AlertTriangle,
  ChevronRight,
  Layers,
  RefreshCw,
  Plus,
  Calendar,
  ShoppingCart,
  Check,
  CheckCircle,
  UserPlus
} from 'lucide-react';
import { Language, Product, AppSettings, VaultTransaction, Vault, Invoice, CustomerTransaction } from '../types';
import { translations } from '../translations';
import { motion, AnimatePresence } from 'motion/react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import Counter from './Counter';
import { toast } from 'sonner';
import QuickActions from './QuickActions';
import RadarAlerts from './RadarAlerts';
import PredictiveAnalytics from './PredictiveAnalytics';
import KpiCards from './KpiCards';
import ActivityLog from './ActivityLog';

import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { isLowStock } from '../lib/stock';
import { readVaultBalances } from '../lib/vaultMath';
import { getExternalSalesApi } from '../lib/externalSalesApi';
import { POS_CURRENCY_CODES, buildUsdUnitRates, convertMoney, formatMoney, readCachedLiveRates } from '../lib/exchangeRates';
import { GlassStatCard } from './ui/GlassStatCard';
import { SalesChart } from './ui/SalesChart';
import { RecentTransactions } from './ui/RecentTransactions';
import { NetIncome7DayTrend } from './ui/NetIncome7DayTrend';
import { sounds } from '../lib/sounds';

interface Props {
  language: Language;
  products: Product[];
  settings: AppSettings;
  vault: Vault | null;
  vaultTransactions: VaultTransaction[];
}

export default function Dashboard({ language, products, settings, vault, vaultTransactions }: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';
  const { transactions, employees, recordVaultTransaction, customers, saveInvoice, recordCustomerLedgerTransaction } = useFirebase();
  const { formatPrice: globalFormatPrice, preferredCurrency } = usePreferredCurrency();
  const activeCurrency = preferredCurrency === 'DEFAULT' ? (settings?.currency || 'JOD') : preferredCurrency;
  const invoices = transactions as unknown as Invoice[];

  // Smart Integrated Quick POS (البيع المباشر السريع) Board State
  const [qsSearchTerm, setQsSearchTerm] = useState('');
  const [qsSelectedProduct, setQsSelectedProduct] = useState<Product | null>(null);
  const [qsQuantity, setQsQuantity] = useState('1');
  const [qsPrice, setQsPrice] = useState<string>('');
  const [qsPayType, setQsPayType] = useState<'cash' | 'credit'>('cash');
  const [qsSelectedCustomer, setQsSelectedCustomer] = useState('');
  const [qsIsSubmitting, setQsIsSubmitting] = useState(false);
  const [qsSuccess, setQsSuccess] = useState(false);
  const [qsShowSuggestions, setQsShowSuggestions] = useState(false);

  const qsFilteredProducts = useMemo(() => {
    if (!qsSearchTerm.trim()) return [];
    const term = qsSearchTerm.toLowerCase();
    return products.filter(p => 
      p.name.toLowerCase().includes(term) || 
      (p.serialNumber && p.serialNumber.toLowerCase().includes(term)) ||
      ((p as any).barcode && (p as any).barcode.toLowerCase().includes(term)) ||
      (p.sku && p.sku.toLowerCase().includes(term))
    );
  }, [products, qsSearchTerm]);

  const handleQsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let productToSell = qsSelectedProduct;
    if (!productToSell && qsSearchTerm.trim()) {
      const matches = products.filter(p => 
        p.name.toLowerCase().includes(qsSearchTerm.toLowerCase()) || 
        (p.serialNumber && p.serialNumber.toLowerCase().includes(qsSearchTerm.toLowerCase())) ||
        ((p as any).barcode && (p as any).barcode.toLowerCase().includes(qsSearchTerm.toLowerCase())) ||
        (p.sku && p.sku.toLowerCase().includes(qsSearchTerm.toLowerCase()))
      );
      if (matches.length > 0) {
        productToSell = matches[0];
      }
    }

    if (qsIsSubmitting || !productToSell) {
      toast.error(isRtl ? 'الرجاء كتابة اسم أو باركود منتج متاح للبيع السريع' : 'Please search for a valid available product first');
      return;
    }

    const qty = Number(qsQuantity);
    if (isNaN(qty) || qty <= 0) {
      toast.error(isRtl ? 'الرجاء إدخال كمية بيع صحيحة وبقيمة موجبة' : 'Please enter a valid positive sell quantity');
      return;
    }

    const priceOverride = qsPrice ? Number(qsPrice) : (productToSell.sellingPrice || 0);
    if (isNaN(priceOverride) || priceOverride < 0) {
      toast.error(isRtl ? 'الرجاء إدخال سعر بيع صحيح وموجب' : 'Please enter a valid positive selling price');
      return;
    }

    const availableStock = Number(productToSell.quantity) || 0;
    if (qty > availableStock) {
      toast.error(isRtl ? `الكمية المدخلة تجاوزت الرصيد المتاح (${availableStock} قطعة)` : `Quantity exceeds available stock (${availableStock} pcs)`);
      return;
    }

    setQsIsSubmitting(true);
    try {
      const randomId = `qpos-${Date.now()}`;
      const generatedNo = `POS-${Math.floor(10000 + Math.random() * 90000)}`;
      const totalAmountVal = qty * priceOverride;

      // Build official invoice
      const quickInvoice: Invoice = {
        id: randomId,
        invoiceNumber: generatedNo,
        customerName: qsPayType === 'credit' && qsSelectedCustomer
          ? (customers.find(c => c.id === qsSelectedCustomer)?.name || (isRtl ? 'ذمم عميل' : 'Credit Customer'))
          : (isRtl ? 'بيع سريع مباشر' : 'Direct Quick Sale'),
        items: [{
          productId: productToSell.id,
          description: productToSell.name,
          quantity: qty,
          unitPrice: priceOverride,
          total: totalAmountVal
        }],
        subtotal: totalAmountVal,
        taxAmount: 0,
        totalAmount: totalAmountVal,
        type: 'sale',
        date: Date.now(),
        currency: activeCurrency as any,
        discount: 0,
        cashReceived: qsPayType === 'cash' ? totalAmountVal : 0,
        changeDue: 0,
        paymentMethod: qsPayType === 'credit' ? 'credit' : 'cash',
        customerId: qsPayType === 'credit' ? qsSelectedCustomer : undefined
      };

      // Save Invoice to database (credit sales don't touch the vault until the customer pays)
      await saveInvoice(quickInvoice);

      // Credit sale: increase the customer's debt (ledger + totalDebt) in the customer's own currency
      if (qsPayType === 'credit' && qsSelectedCustomer) {
        const customer = customers.find(c => c.id === qsSelectedCustomer);
        const customerCurrency = customer?.currency || (activeCurrency as any);
        const debtAmount = customerCurrency === activeCurrency
          ? totalAmountVal
          : convertMoney(totalAmountVal, activeCurrency as any, customerCurrency, buildUsdUnitRates(settings, readCachedLiveRates()));
        await recordCustomerLedgerTransaction(
          qsSelectedCustomer,
          debtAmount,
          'invoice',
          `${isRtl ? 'فاتورة بيع آجل' : 'Credit sale'} #${generatedNo}`
        );
      }

      // Optional external API mirror (disabled unless VITE_EXTERNAL_SALES_API is configured)
      const externalApi = getExternalSalesApi();
      if (externalApi) {
        const invoiceData = {
          id: Date.now(),
          items: [{ product_id: productToSell.id, quantity: qty, price: priceOverride }],
          total_amount: totalAmountVal,
          cash_received: qsPayType === 'cash' ? totalAmountVal : 0,
          change_due: 0,
          created_at: new Date().toISOString(),
          is_synced: false
        };
        try {
          const res = await fetch(`${externalApi}/sales/store`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...invoiceData, is_synced: true })
          });
          if (!res.ok) throw new Error(`external api ${res.status}`);
        } catch (apiErr) {
          try {
            const existingOfflineSales = JSON.parse(localStorage.getItem('offline_sales') || '[]');
            existingOfflineSales.push(invoiceData);
            localStorage.setItem('offline_sales', JSON.stringify(existingOfflineSales));
          } catch (e) {}
        }
      }

      // Play success check sound and trigger success visual feedback loop
      sounds.playClick();
      setQsSuccess(true);
      toast.success(isRtl ? '✅ تم تسجيل مبيعات البيع السريع بنجاح وتخفيض المخازن وتحديث الخزينة!' : '✅ Successful Quick POS checkout! Stock deducted and safe updated.');
      
      // Clear values after 2 seconds
      setTimeout(() => {
        setQsSelectedProduct(null);
        setQsSearchTerm('');
        setQsQuantity('1');
        setQsPrice('');
        setQsSuccess(false);
      }, 1800);

    } catch (err: any) {
      console.error(err);
      toast.error(isRtl ? 'حدث خطأ غير متوقع أثناء تسجيل الدورة السريعة' : 'Fatal exception during quick checkout.');
    } finally {
      setQsIsSubmitting(false);
    }
  };

  const [showBanner, setShowBanner] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [salaryAmount, setSalaryAmount] = useState<string>('');
  const [selectedCurrency, setSelectedCurrency] = useState<'JOD' | 'ILS' | 'USD'>('JOD');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [activeChartTab, setActiveChartTab] = useState<'trends' | 'categories'>('trends');
  const [detailModalType, setDetailModalType] = useState<'sales' | 'stock' | 'low_stock' | 'today_invoices' | null>(null);
  
  // 1. حالات التحكم (State Management)
  const [timeFilter, setTimeFilter] = useState('month'); // فلتر الوقت
  const [loading, setLoading] = useState(false);
  
  const [simulatePayday, setSimulatePayday] = useState(() => {
    return localStorage.getItem('simulate_salary_payday') === 'true';
  });

  // Real-time calendar date and clock state
  const [time, setTime] = useState(new Date());
  
  // Real-time exchange rate state
  const [exchangeRate, setExchangeRate] = useState<number | null>(3.70);
  const [isFetchingRate, setIsFetchingRate] = useState(true);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchRates = async () => {
    const currentCurrency = settings?.currency || 'JOD';
    const baseCode = currentCurrency === 'ILS' ? 'USD' : currentCurrency;

    // Self-healing fetch client with automatic retry on server startup or HTML response
    const fetchWithRetry = async (url: string, options: RequestInit, retries = 3, delay = 1500): Promise<Response> => {
      try {
        const res = await fetch(url, options);
        const contentType = res.headers.get('content-type') || '';
        const isHtml = contentType.includes('text/html');
        const isStartupStatus = [502, 503, 504].includes(res.status);
        
        if (isStartupStatus && retries > 0) {
          console.warn(`Server returned status ${res.status}. Retrying in ${delay}ms... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchWithRetry(url, options, retries - 1, delay * 1.5);
        }
        
        if (res.ok && isHtml && retries > 0) {
          const clonedRes = res.clone();
          const textCheck = await clonedRes.text();
          if (textCheck.trim().startsWith('<!DOCTYPE html>') || textCheck.includes('<html')) {
            console.warn(`Server returned an HTML page instead of JSON. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, retries - 1, delay * 1.5);
          }
        }
        
        return res;
      } catch (err) {
        if (retries > 0) {
          console.warn(`Network error fetching from server: ${err}. Retrying in ${delay}ms... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchWithRetry(url, options, retries - 1, delay * 1.5);
        }
        throw err;
      }
    };

    if (settings?.useManualExchangeRates) {
      if (baseCode === 'JOD') {
        setExchangeRate(settings.exchangeRateJOD_ILS ?? 5.22);
      } else {
        setExchangeRate(settings.exchangeRateUSD_ILS ?? 3.70);
      }
      return;
    }

    try {
      setIsFetchingRate(true);
      const response = await fetchWithRetry(`/api/exchange-rate/${baseCode}?t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      const data = await response.json();
      if (data && data.rates && data.rates.ILS) {
        setExchangeRate(data.rates.ILS);
      }
    } catch (error) {
      console.warn(`[Dashboard] Using standard cached rate of ${baseCode} to ILS (Server rate endpoint offline or unreachable):`, error);
      // Fallback state
      if (baseCode === 'JOD') {
        setExchangeRate(settings?.exchangeRateJOD_ILS ?? 5.22);
      } else {
        setExchangeRate(settings?.exchangeRateUSD_ILS ?? 3.70);
      }
    } finally {
      setIsFetchingRate(false);
    }
  };

  // Fetch live exchange rate when active currency, manual status, or manual values change
  useEffect(() => {
    if (settings?.useManualExchangeRates) {
      const isJod = (settings?.currency || 'JOD') === 'JOD';
      setExchangeRate(isJod ? (settings?.exchangeRateJOD_ILS ?? 5.22) : (settings?.exchangeRateUSD_ILS ?? 3.70));
      setIsFetchingRate(false);
    } else {
      fetchRates();
    }
  }, [
    settings?.useManualExchangeRates, 
    settings?.exchangeRateUSD_ILS, 
    settings?.exchangeRateJOD_ILS, 
    settings?.currency
  ]);

  // Periodic hourly refresh
  useEffect(() => {
    const rateInterval = setInterval(() => {
      if (!settings?.useManualExchangeRates) {
        fetchRates();
      }
    }, 3600000); // refresh hourly
    return () => clearInterval(rateInterval);
  }, [settings?.useManualExchangeRates, settings?.currency]);

  useEffect(() => {
    const checkPayday = () => {
      const today = new Date();
      const is1st = today.getDate() === 1 || localStorage.getItem('simulate_salary_payday') === 'true';
      const currentMonthKey = `salary_paid_${today.getFullYear()}_${today.getMonth() + 1}`;
      const isPaid = localStorage.getItem(currentMonthKey) === 'true';
      setShowBanner(is1st && !isPaid);
    };

    checkPayday();
    const interval = setInterval(checkPayday, 1000 * 30); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [simulatePayday]);

  // Prevent background body scrolling when detail modal is active
  useEffect(() => {
    if (detailModalType) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [detailModalType]);

  // Close detail modal on Escape key press
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDetailModalType(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      if (!settings?.useManualExchangeRates) {
        await fetchRates();
      }
      await new Promise(resolve => setTimeout(resolve, 600));
    } catch (error) {
      console.error("Error updating dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [timeFilter]); // تتحدث اللوحة تلقائياً بمجرد تغيير الفلتر

  // 2. دوال الإجراءات السريعة (Quick Actions)
  const handleAddNewProduct = () => {
    window.dispatchEvent(new CustomEvent('change-screen', { detail: 'inventory' }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-add-product'));
    }, 100);
  };

  const handleCreateInvoice = () => {
    window.dispatchEvent(new CustomEvent('change-screen', { detail: 'pos' }));
  };

  // Real-time calculations for Filtered Activity
  const statsObj = useMemo(() => {
    const list = (invoices || []).filter(inv => inv.currency === activeCurrency);
    const now = new Date();
    let startTime = 0;

    if (timeFilter === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      startTime = today.getTime();
    } else if (timeFilter === 'week') {
      startTime = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    } else if (timeFilter === 'month') {
      startTime = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    } else if (timeFilter === 'year') {
      startTime = now.getTime() - 365 * 24 * 60 * 60 * 1000;
    }

    const filteredInvoices = list.filter(inv => inv.date >= startTime);
    const filteredSales = filteredInvoices
      .filter(inv => inv.type === 'sale')
      .reduce((sum, inv) => sum + inv.totalAmount, 0);

    const filteredSalesCount = filteredInvoices.filter(inv => inv.type === 'sale').length;
    const threshold = settings?.lowStockThreshold ?? 5;
    const criticalProducts = products.filter(p => isLowStock(p.quantity, p.lowStockThreshold, threshold));

    // Real numbers only: an empty period shows 0, never demo figures.
    return {
      sales: filteredSales,
      invoicesCount: filteredSalesCount,
      criticalCount: criticalProducts.length,
    };
  }, [invoices, products, timeFilter, activeCurrency, settings]);

  // multi-currency sales analysis for top stats card
  const salesByCurrency = useMemo(() => {
    const list = (invoices || []).filter(inv => inv.type === 'sale');
    const now = new Date();
    let startTime = 0;

    if (timeFilter === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      startTime = today.getTime();
    } else if (timeFilter === 'week') {
      startTime = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    } else if (timeFilter === 'month') {
      startTime = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    } else if (timeFilter === 'year') {
      startTime = now.getTime() - 365 * 24 * 60 * 60 * 1000;
    }

    const filtered = list.filter(inv => inv.date >= startTime);
    const totals = {} as Record<string, number>;
    POS_CURRENCY_CODES.forEach(code => {
      totals[code] = filtered
        .filter(i => (i.currency || 'JOD') === code)
        .reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);
    });
    return totals;
  }, [invoices, timeFilter]);

  // Sales of the other currencies (never converted/mixed with the active one)
  const otherCurrencySales = POS_CURRENCY_CODES
    .filter(code => code !== activeCurrency && (salesByCurrency[code] || 0) > 0)
    .map(code => ({ code, value: salesByCurrency[code] }));

  // Today's sales (active currency only; purchases are not sales)
  const todayInvoicesData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStarts = today.getTime();

    const todaysList = (invoices || []).filter(inv =>
      inv.type === 'sale' && inv.date >= todayStarts && (inv.currency || 'JOD') === activeCurrency);
    return {
      count: todaysList.length,
      totalAmount: todaysList.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0),
    };
  }, [invoices, activeCurrency]);

  // Total quantity of stocked items in warehouse
  const totalStockItemsSum = useMemo(() => {
    return products.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
  }, [products]);

  // Customer debts: every customer debt is converted from ITS currency to the active one (never summed raw)
  const totalDebtIn = useMemo(() => {
    const rates = buildUsdUnitRates(settings, readCachedLiveRates());
    return (customers || []).reduce((sum, c) => {
      const debt = Number(c.totalDebt) || 0;
      if (debt <= 0) return sum;
      const from = (c.currency || activeCurrency) as any;
      return sum + (from === activeCurrency ? debt : convertMoney(debt, from, activeCurrency as any, rates));
    }, 0);
  }, [customers, activeCurrency, settings]);

  // Real cash in the vault for the active currency
  const vaultBalanceActive = useMemo(() => readVaultBalances(vault)[activeCurrency as keyof ReturnType<typeof readVaultBalances>] ?? 0, [vault, activeCurrency]);

  // Categorical top-performing data for analytics charts
  const topCategoriesData = useMemo(() => {
    const counts: Record<string, number> = {};
    products.forEach(p => {
      const cat = p.category || (isRtl ? 'عام' : 'General');
      counts[cat] = (counts[cat] || 0) + (Number(p.quantity) || 0);
    });
    const data = Object.entries(counts).map(([name, value]) => ({ name, value }));
    data.sort((a, b) => b.value - a.value);
    
    return data.slice(0, 5);
  }, [products, isRtl]);

  // Active business alerts intelligence (Low stock + Expiration warnings)
  const smartAlerts = useMemo(() => {
    const alerts: Array<{ id: string; title: string; type: 'low_stock' | 'expiry' | 'system'; desc: string; date: string }> = [];
    const threshold = settings?.lowStockThreshold ?? 5;

    // 1. Expiration dates check (next 30 days)
    products.filter(p => p.expiryDate).forEach(p => {
      const daysLeft = Math.round((Number(p.expiryDate) - Date.now()) / (3600 * 24 * 1000));
      if (daysLeft > 0 && daysLeft <= 30) {
        alerts.push({
          id: `expiry-${p.id}`,
          title: isRtl ? '⚠️ مادة تقترب صلاحيتها للانتهاء' : '⚠️ Expiry Approaching',
          type: 'expiry',
          desc: isRtl 
            ? `المادة (${p.name}) ستنتهي صلاحيتها خلال ${daysLeft} يوم!`
            : `Item (${p.name}) will expire in ${daysLeft} days!`,
          date: new Date(p.expiryDate!).toLocaleDateString()
        });
      }
    });

    // 2. Critical Stock quantity check
    products.filter(p => isLowStock(p.quantity, p.lowStockThreshold, threshold)).forEach(p => {
      alerts.push({
        id: `stock-${p.id}`,
        title: isRtl ? '📉 مخزون حرج منخفض جداً' : '📉 Critical Low Stock',
        type: 'low_stock',
        desc: isRtl 
          ? `المنتج (${p.name}) كميته الحالية ${p.quantity} قطع فقط!`
          : `Product (${p.name}) stock is very low: only ${p.quantity} left!`,
        date: isRtl ? 'الآن' : 'now'
      });
    });

    // fallback alerts for elegant look
    if (alerts.length === 0) {
      alerts.push({
        id: 'sys-ok',
        title: isRtl ? '🛡️ نظام مستودعي مستقر' : '🛡️ System Safe',
        type: 'system',
        desc: isRtl ? 'تم فحص المخزون وهو يتطابق تماماً مع معايير الأمان المودعة.' : 'All goods and warehouse items are within secure safety limits.',
        date: isRtl ? 'الآن' : 'now'
      });
    }

    return alerts.slice(0, 3);
  }, [products, isRtl, settings]);

  // Stock movements logs derived in real-time
  const stockMovements = useMemo(() => {
    const movements: Array<{
      id: string;
      item: string;
      action: 'sale' | 'purchase';
      quantity: number;
      employee: string;
      timestamp: number;
    }> = [];

    const sorted = [...invoices].sort((a, b) => b.date - a.date);
    for (const inv of sorted) {
      if (movements.length >= 5) break;
      const employeeName = inv.type === 'sale' 
        ? (inv.customerName || (isRtl ? 'معرض المبيعات' : 'Sales Floor'))
        : (inv.supplierName || (isRtl ? 'قسم الاستيراد' : 'Import Dept'));
      
      if (inv.items && inv.items.length > 0) {
        for (const item of inv.items) {
          if (movements.length >= 5) break;
          movements.push({
            id: `${inv.id}-${item.productId}`,
            item: item.description || item.productId,
            action: inv.type,
            quantity: item.quantity,
            employee: employeeName,
            timestamp: inv.date
          });
        }
      }
    }

    return movements;
  }, [invoices, products, isRtl]);

  const searchResults = useMemo(() => {
    if (!quickSearch.trim()) return [];
    return products.filter(p => 
      p.name.toLowerCase().includes(quickSearch.toLowerCase()) || 
      p.sku?.toLowerCase().includes(quickSearch.toLowerCase())
    );
  }, [quickSearch, products]);

  const lastInvoices = useMemo(() => {
    return [...invoices].sort((a, b) => b.date - a.date).slice(0, 5);
  }, [invoices]);

  const toggleSimulation = () => {
    const nextVal = !simulatePayday;
    setSimulatePayday(nextVal);
    if (nextVal) {
      localStorage.setItem('simulate_salary_payday', 'true');
      const today = new Date();
      const currentMonthKey = `salary_paid_${today.getFullYear()}_${today.getMonth() + 1}`;
      localStorage.removeItem(currentMonthKey);
      setShowBanner(true);
      toast.success(isRtl ? 'تم تفعيل محاكاة موعد صرف الرواتب!' : 'Salary payday simulation activated!');
    } else {
      localStorage.removeItem('simulate_salary_payday');
      const today = new Date();
      const is1st = today.getDate() === 1;
      const currentMonthKey = `salary_paid_${today.getFullYear()}_${today.getMonth() + 1}`;
      const isPaid = localStorage.getItem(currentMonthKey) === 'true';
      setShowBanner(is1st && !isPaid);
      toast.info(isRtl ? 'تم إلغاء المحاكاة' : 'Payday simulation deactivated');
    }
  };

  const chartData = useMemo(() => {
    const months = isRtl 
      ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    
    const currentDate = new Date();
    const result = [];
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const monthLabel = months[d.getMonth() % 12];
      
      const monthRevenue = invoices
        .filter(t => {
          const transDate = new Date(t.date);
          return t.type === 'sale' && 
                 t.currency === activeCurrency &&
                 transDate.getMonth() === d.getMonth() && 
                 transDate.getFullYear() === d.getFullYear();
        })
        .reduce((sum, t) => sum + t.totalAmount, 0);

      const monthExpenses = vaultTransactions
        .filter(v => {
          const vDate = new Date(v.timestamp);
          return v.type === 'expense' && 
                 v.source !== 'reversal' &&
                 v.currency === activeCurrency &&
                 vDate.getMonth() === d.getMonth() && 
                 vDate.getFullYear() === d.getFullYear();
        })
        .reduce((sum, v) => sum + v.amount, 0);

      result.push({
        name: monthLabel,
        revenue: monthRevenue,
        expenses: monthExpenses
      });
    }
    
    return result;
  }, [invoices, vaultTransactions, isRtl, activeCurrency]);

  const formatCurrency = (val: number, customCurrency?: string) =>
    formatMoney(Number(val) || 0, customCurrency || settings?.currency || activeCurrency, isRtl ? 'ar' : 'en-US');

  const locale = isRtl ? 'ar-EG' : 'en-US';
  const formattedTime = time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const formattedDate = time.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="dashboard-container dashboard-wrapper select-none notranslate min-h-screen flex-1 min-w-0 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6 transition-colors duration-300 overflow-x-hidden" dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* Smart insight banners / low stock alerts */}
      <div className="mb-6 space-y-4">
        <AnimatePresence>
          {showBanner && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-550 to-orange-600 text-white p-5 rounded-3xl relative shadow-lg border border-amber-300/30"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-white shrink-0">
                  <Bell size={24} className="animate-bounce" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-amber-100">{isRtl ? "تنبيه صرف الرواتب" : "PAYROLL REMINDER"}</p>
                  <p className="text-[15px] font-bold text-white">
                    {isRtl ? "تذكير: اليوم هو موعد صرف رواتب الموظفين" : "Reminder: Today is the employee salary payday"}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsModalOpen(true)}
                  className="px-5 py-2.5 bg-white hover:bg-amber-550 text-amber-700 font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-95 shrink-0 uppercase tracking-wider cursor-pointer"
                >
                  {isRtl ? "تسجيل صرف الرواتب" : "Log Salary Payment"}
                </button>
                
                <button 
                  onClick={() => {
                    const today = new Date();
                    const currentMonthKey = `salary_paid_${today.getFullYear()}_${today.getMonth() + 1}`;
                    localStorage.setItem(currentMonthKey, 'true');
                    setShowBanner(false);
                    toast.success(isRtl ? "تم إخفاء التنبيه لهذا الشهر" : "Dismissed reminder for this month");
                  }}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white shrink-0 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* CENTRAL MODERN LANDING HUB WITH GLASSMORPHISM & FLOATING ISLAND DESIGN STYLE */}
      <div className="relative mb-8 rounded-[2.5rem] bg-gradient-to-tr from-slate-50 via-teal-50/20 to-indigo-50/30 dark:from-slate-900/90 dark:via-indigo-950/20 dark:to-slate-900/90 p-5 sm:p-8 shadow-2xl border border-white dark:border-white/5 backdrop-blur-2xl overflow-hidden select-none" id="smart-ops-dashboard-hub">
        
        {/* Glow ambient background wave gradient highlights (تمويج ألوان تفاعلي) */}
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-gradient-to-br from-indigo-500/10 to-teal-400/10 dark:from-indigo-500/15 dark:to-emerald-500/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[500px] bg-gradient-to-tr from-emerald-500/10 to-cyan-400/10 dark:from-emerald-500/15 dark:to-cyan-500/10 rounded-full blur-3xl pointer-events-none translate-y-1/2" />

        {/* 1. Hub Header Branding Block */}
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 mb-6 border-b border-indigo-150/40 dark:border-white/5">
          <div className="text-start">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-750 bg-indigo-100/70 dark:text-cyan-400 dark:bg-indigo-950/65 px-3 py-1 rounded-full border border-indigo-200/50 dark:border-indigo-900/30">
              {isRtl ? 'بوابة العمليات اللوجستية المركزية' : 'Central Logistics & Ops Portal'}
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2.5 font-arabic tracking-tight flex items-center gap-2">
              <span className="bg-gradient-to-r from-indigo-805 via-teal-700 to-indigo-900 dark:from-indigo-400 dark:via-cyan-400 dark:to-teal-400 bg-clip-text text-transparent">
                {isRtl ? 'الشاشة الرئيسية لبيان المعاملات 🏢' : 'Operations Dashboard Hub'}
              </span>
            </h1>
            <p className="text-xs text-slate-805 dark:text-slate-350 font-arabic font-extrabold mt-1.5 opacity-95">
              {isRtl ? 'إدارة لحظية متكاملة لبيانات المبيعات والمستودع والذمم والعمليات اللوجستية المتطورة ومراقبة النقدية.' : 'Comprehensive real-time manager of client billing, catalog, supplier receivables, and financial safe balances.'}
            </p>
          </div>
        </div>

        {/* 2. TOP SECTION: Compacter, ultra-sleek, beautifully aligned "صندوق البيع السريع الفوري" */}
        <div className="relative z-10 mb-8 p-6 sm:p-8 rounded-[2.5rem] border-2 border-indigo-100/60 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900/95 backdrop-blur-3xl transition-all" id="quick-pos-section">
          {/* Animated fluid top border accent using gradients */}
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-indigo-500 via-teal-400 to-indigo-600 opacity-90 rounded-t-full" />
          
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-5 border-b border-indigo-100/50 dark:border-white/5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 via-indigo-700 to-teal-555 text-white rounded-2xl flex items-center justify-center shadow-lg transform hover:rotate-6 transition-transform">
                <ShoppingCart size={22} className="stroke-[2.5]" />
              </div>
              <div className="text-start">
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-arabic tracking-tight flex items-center gap-2">
                  <span className="bg-gradient-to-r from-indigo-800 via-teal-700 to-indigo-900 dark:from-indigo-400 dark:via-cyan-400 dark:to-teal-400 bg-clip-text text-transparent">
                    {isRtl ? 'صندوق البيع السريع الفوري ⚡' : 'Integrated Instant Quick POS Terminal ⚡'}
                  </span>
                </h3>
                <p className="text-xs text-slate-800 dark:text-slate-300 font-arabic font-semibold mt-1">
                  {isRtl ? 'سجل العمليات الفورية، واخصم من المستودع تلقائياً وحدّث توازن النقدية فوراً وبكبسة واحدة' : 'Instant client billing, automatic stock adjustments & real-time safe integration.'}
                </p>
              </div>
            </div>
            
            <div className="text-xs font-black text-slate-900 dark:text-white font-arabic bg-indigo-50 dark:bg-slate-800 px-4 py-2.5 rounded-2xl border border-indigo-100 dark:border-white/5 shadow-sm shrink-0">
              {isRtl ? `العملة النشطة: ${({ JOD: 'دينار أردني', ILS: 'شيكل إسرائيلي', USD: 'دولار أمريكي', IQD: 'دينار عراقي', SAR: 'ريال سعودي', LYD: 'دينار ليبي' } as Record<string, string>)[activeCurrency] || activeCurrency}` : `Active Currency: ${activeCurrency}`}
            </div>
          </div>

          <form onSubmit={handleQsSubmit} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              
              {/* Column 1: Product Selection & Customer (Span 5) */}
              <div className="lg:col-span-5 flex flex-col justify-between gap-4">
                
                {/* Product search & selection */}
                <div className="relative text-start font-arabic">
                  <label className="block text-xs font-black text-slate-900 dark:text-slate-200 mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                    <Search size={14} className="text-indigo-600 dark:text-indigo-400" />
                    <span>{isRtl ? 'اختر المنتج للبيع السريع والخصم' : 'Search & Add Product'}</span>
                  </label>
                  <div className="relative">
                    <Search size={16} className={`absolute ${isRtl ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none`} />
                    <input
                      type="text"
                      value={qsSearchTerm}
                      placeholder={isRtl ? 'ابحث بالاسم، باركود، رقم تسلسلي، SKU...' : 'Search by name, barcode, SKU...'}
                      onChange={(e) => {
                        setQsSearchTerm(e.target.value);
                        setQsShowSuggestions(true);
                        if (qsSelectedProduct && e.target.value !== qsSelectedProduct.name) {
                          setQsSelectedProduct(null);
                        }
                      }}
                      onFocus={() => setQsShowSuggestions(true)}
                      className={`w-full ${isRtl ? 'pr-10 pl-10' : 'pl-10 pr-10'} py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-black placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-slate-900 dark:text-white`}
                    />
                    {qsSelectedProduct && (
                      <button
                        type="button"
                        onClick={() => {
                          sounds.playClick();
                          setQsSelectedProduct(null);
                          setQsSearchTerm('');
                          setQsPrice('');
                        }}
                        className={`absolute ${isRtl ? 'left-3.5' : 'right-3.5'} top-1/2 -translate-y-1/2 p-1.5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full text-slate-500 transition-colors`}
                        title={isRtl ? 'إلغاء التحديد' : 'Clear selection'}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Suggestions list popup overlay */}
                  <AnimatePresence>
                    {qsShowSuggestions && qsSearchTerm.trim() !== '' && !qsSelectedProduct && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute left-0 right-0 mt-1.5 max-h-56 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-2xl shadow-2xl z-50 divide-y divide-slate-100 dark:divide-white/5 scrollbar-thin"
                      >
                        {qsFilteredProducts.length > 0 ? (
                          qsFilteredProducts.map(p => {
                            const available = Number(p.quantity) || 0;
                            return (
                              <div
                                key={p.id}
                                onClick={() => {
                                  sounds.playClick();
                                  setQsSelectedProduct(p);
                                  setQsSearchTerm(p.name);
                                  setQsPrice((p.sellingPrice || 0).toString());
                                  setQsShowSuggestions(false);
                                }}
                                className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer transition-colors flex items-center justify-between text-xs font-arabic"
                              >
                                <div className="text-start">
                                  <p className="font-extrabold text-slate-900 dark:text-white">{p.name}</p>
                                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">SKU: {p.sku || p.id} {p.serialNumber ? `• S/N: ${p.serialNumber}` : ((p as any).barcode ? `• Barcode: ${(p as any).barcode}` : '')}</p>
                                </div>
                                <div className="text-end shrink-0">
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${
                                    available <= 0 
                                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300' 
                                      : available <= (Number(p.lowStockThreshold) || 5) 
                                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' 
                                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-555/20 dark:text-emerald-300'
                                  }`}>
                                    {isRtl ? `${available} متوفر` : `${available} in stock`}
                                  </span>
                                  <p className="font-bold font-mono text-slate-900 dark:text-white mt-1">
                                    {formatCurrency(p.sellingPrice || 0, activeCurrency)}
                                  </p>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="px-4 py-3.5 text-center text-slate-500 dark:text-slate-400 font-arabic text-xs font-extrabold animate-pulse">
                            {isRtl ? '⚠️ لا توجد مادة متطابقة في المستودع' : '⚠️ No matching catalog materials'}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Customer Account selection */}
                <div className="text-start font-arabic">
                  <label className="block text-xs font-black text-slate-900 dark:text-slate-200 mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                    <UserPlus size={14} className="text-indigo-600 dark:text-indigo-400" />
                    <span>{isRtl ? 'العميل المستلم (لتسجيل الديون)' : 'Customer Selector'}</span>
                  </label>
                  <select
                    value={qsSelectedCustomer}
                    onChange={(e) => {
                      sounds.playClick();
                      setQsSelectedCustomer(e.target.value);
                    }}
                    className="w-full h-[42px] px-3 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-705 rounded-2xl text-xs font-arabic font-bold text-slate-900 dark:text-slate-105 focus:outline-none focus:ring-2 focus:ring-indigo-505 cursor-pointer shadow-sm"
                  >
                    <option value="" className="text-slate-905 dark:text-black font-extrabold">
                      {isRtl ? '👤 زبون نقدي عام (بدون دين)' : '👤 Cash (General Guest)'}
                    </option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id} className="text-slate-905 dark:text-black font-extrabold">
                        {c.name} {c.totalDebt > 0 ? `(ذمم: ${c.totalDebt.toFixed(0)} ₪)` : ''}
                      </option>
                    ))}
                  </select>
                </div>

              </div>

              {/* Column 2: Quantity & Price Overrides inputs (Span 4) */}
              <div className="lg:col-span-4 flex flex-col justify-between gap-4">
                
                {/* Quantity adjustments */}
                <div className="text-start font-arabic">
                  <label className="block text-xs font-black text-slate-900 dark:text-slate-200 mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                    <ShoppingCart size={14} className="text-indigo-600 dark:text-indigo-400" />
                    <span>{isRtl ? 'الكمية المراد بيعها' : 'Selling Quantity'}</span>
                  </label>
                  <div className="flex h-[42px] items-center border border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-950 overflow-hidden shadow-sm">
                    <button
                      type="button"
                      onClick={() => {
                        sounds.playClick();
                        setQsQuantity(prev => Math.max(1, (parseInt(prev) || 1) - 1).toString());
                      }}
                      className="w-12 h-full flex items-center justify-center border-l dark:border-l-0 border-r dark:border-r border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 active:scale-95 transition-all font-black text-lg select-none"
                    >
                      -
                    </button>
                    <input
                      type="text"
                      pattern="[0-9]*"
                      value={qsQuantity}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setQsQuantity(val === '' ? '1' : val);
                      }}
                      className="w-full text-center bg-transparent border-0 font-extrabold font-mono text-sm focus:outline-none focus:ring-0 text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        sounds.playClick();
                        const maxStock = qsSelectedProduct ? (qsSelectedProduct.quantity || 0) : 99999;
                        setQsQuantity(prev => {
                          const next = (parseInt(prev) || 1) + 1;
                          return next <= maxStock ? next.toString() : prev;
                        });
                      }}
                      className="w-12 h-full flex items-center justify-center border-l dark:border-l border-r dark:border-r-0 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 active:scale-95 transition-all font-black text-lg select-none"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Selling Price input field (Custom overrides on the fly!) */}
                <div className="text-start font-arabic">
                  <label className="block text-xs font-black text-slate-900 dark:text-slate-200 mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                    <DollarSign size={14} className="text-indigo-600 dark:text-indigo-400" />
                    <span>{isRtl ? 'تخصيص سعر بيع المفرد (اختياري)' : 'Manual Selling Unit Price'}</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder={qsSelectedProduct ? (qsSelectedProduct.sellingPrice || 0).toString() : '0.00'}
                      value={qsPrice}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.]/g, '');
                        setQsPrice(val);
                      }}
                      className="w-full h-[42px] px-3 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-mono text-start"
                    />
                    <span className={`absolute ${isRtl ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-[10px] font-black pointer-events-none text-slate-500 bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded-md`}>
                      {activeCurrency}
                    </span>
                  </div>
                </div>

                {/* Method selector: Cash / Credit debt toggle */}
                <div className="text-start font-arabic">
                  <label className="block text-xs font-black text-slate-900 dark:text-slate-200 mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                    <Wallet size={14} className="text-indigo-600 dark:text-indigo-400" />
                    <span>{isRtl ? 'آلية الدفع للفاتورة السريعة' : 'Payment Framework'}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 bg-slate-100 dark:bg-slate-950 p-1 border border-slate-300 dark:border-slate-700 rounded-2xl h-[42px] items-center">
                    <button
                      type="button"
                      onClick={() => {
                        sounds.playClick();
                        setQsPayType('cash');
                      }}
                      className={`h-full rounded-xl text-xs font-black font-arabic transition-all flex items-center justify-center ${
                        qsPayType === 'cash'
                          ? 'bg-slate-900 text-white dark:bg-indigo-600 shadow-md scale-95'
                          : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {isRtl ? '💵 مبيعات كاش' : '💵 Cash'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        sounds.playClick();
                        setQsPayType('credit');
                      }}
                      className={`h-full rounded-xl text-xs font-black font-arabic transition-all flex items-center justify-center ${
                        qsPayType === 'credit'
                          ? 'bg-slate-900 text-white dark:bg-indigo-600 shadow-md scale-95'
                          : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {isRtl ? '🏦 مبيعات آجل' : '🏦 Credit'}
                    </button>
                  </div>
                </div>

              </div>

              {/* Column 3: The Receipt Terminal Panel & Submitter (Span 3) */}
              <div className="lg:col-span-3">
                <div className="w-full h-full bg-slate-900 text-white rounded-[2rem] p-5 border border-slate-800 shadow-[0_15px_30px_rgba(0,0,0,0.35)] flex flex-col justify-between select-none relative overflow-hidden min-h-[200px]">
                  
                  {/* Decorative ambient micro-light shadows */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-32 h-32 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

                  <div className="text-start relative z-10 font-arabic">
                    <span className="text-[9px] font-black uppercase tracking-widest text-teal-400 block antialiased font-mono">
                      {isRtl ? 'إجمالي الدفع المستحق' : 'TOTAL AMOUNT DUE'}
                    </span>
                    
                    {/* Continuous dynamic price feedback */}
                    <div className="mt-1 flex flex-col">
                      <span className="text-3xl font-black font-mono tracking-tight text-white select-all">
                        {(() => {
                          const currentQty = parseInt(qsQuantity) || 1;
                          const currentPrice = qsSelectedProduct 
                            ? (qsPrice !== '' ? Number(qsPrice) : (qsSelectedProduct.sellingPrice || 0)) 
                            : 0;
                          return formatCurrency(currentQty * currentPrice, activeCurrency);
                        })()}
                      </span>
                    </div>

                    {/* Compact selected item summary feedback */}
                    <div className="mt-4 pt-4 border-t border-slate-800 space-y-2 text-[11px] font-semibold text-slate-300">
                      {qsSelectedProduct ? (
                        <>
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="truncate text-teal-300 font-extrabold">{qsSelectedProduct.name}</span>
                            <span className="shrink-0 font-mono text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                              x{qsQuantity}
                            </span>
                          </div>
                          
                          <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                            <span>{isRtl ? 'المعدل المفرد:' : 'Unit Price:'}</span>
                            <span>
                              {formatCurrency(qsPrice !== '' ? Number(qsPrice) : (qsSelectedProduct.sellingPrice || 0), activeCurrency)}
                            </span>
                          </div>
                          
                          {Number(qsSelectedProduct.quantity) <= (Number(qsSelectedProduct.lowStockThreshold) || 5) && (
                            <p className="text-[10px] text-rose-400 font-bold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-900/35 leading-tight">
                              ⚠️ {isRtl ? 'صنف منخفض المخزون!' : 'Inventory volume is critical!'}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-slate-400 animate-pulse text-[10px] font-arabic font-semibold">
                          {isRtl ? '⏳ الرجاء كتابة وتحديد منتج لتوليد الحساب التلقائي...' : '⏳ Quick POS is waiting for active product selection...'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Submit checkout button block */}
                  <div className="pt-4 mt-4 border-t border-slate-800 relative z-10 w-full shrink-0">
                    <button
                      type="submit"
                      disabled={qsIsSubmitting || !qsSelectedProduct || (qsPayType === 'credit' && !qsSelectedCustomer)}
                      className={`w-full h-11 rounded-2xl text-white font-extrabold font-arabic text-xs tracking-wide flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        qsSuccess
                          ? 'bg-emerald-600 border border-emerald-555 shadow-md animate-bounce'
                          : !qsSelectedProduct
                            ? 'bg-slate-800 text-slate-500 border border-slate-800/50 cursor-not-allowed shadow-none'
                            : qsPayType === 'credit' && !qsSelectedCustomer
                              ? 'bg-gradient-to-r from-amber-600 to-amber-700 hover:opacity-95 shadow-lg shadow-amber-950/40'
                              : 'bg-gradient-to-r from-indigo-600 to-teal-600 hover:opacity-95 shadow-lg shadow-indigo-950/40'
                      }`}
                    >
                      {qsIsSubmitting ? (
                        <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : qsSuccess ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-emerald-100" />
                          <span>{isRtl ? 'تم الخصم المخزني والتسجيل!' : 'Receipt processed!'}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 text-indigo-200" />
                          <span>
                            {qsPayType === 'credit' && !qsSelectedCustomer
                              ? (isRtl ? 'اختر ذمم العميل أولاً' : 'Choose debtor client')
                              : (isRtl ? 'اضغط للمحاسبة السريعة والتخزين' : 'Process Checkout Receipt')}
                          </span>
                        </>
                      )}
                    </button>
                  </div>

                </div>
              </div>

            </div>
          </form>
        </div>


        {/* 3. MIDDLE SECTION: The Three Main Symmetrical Action Buttons side-by-side */}
        <div className="mb-8 relative z-10">
          <h2 className="text-xs font-black text-slate-950 dark:text-slate-300 uppercase tracking-widest mb-4 text-start font-arabic">
            ⚡ {isRtl ? 'قائمة العمليات السريعة ومنافذ النظام' : 'Main Quick Actions Hub'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Button 1: "البيع" (Sales / POS) */}
            <motion.div
              whileHover={{ y: -5, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                sounds.playClick();
                window.dispatchEvent(new CustomEvent('change-screen', { detail: 'pos' }));
              }}
              className="group cursor-pointer p-6 rounded-3xl bg-gradient-to-br from-indigo-100/70 to-emerald-50/70 dark:from-slate-900/60 dark:to-emerald-950/20 hover:from-indigo-150/80 hover:to-emerald-100/85 dark:hover:from-slate-800/80 hover:border-emerald-400/50 border border-slate-300 dark:border-white/5 shadow-lg select-none hover:shadow-emerald-500/10 backdrop-blur-md transition-all text-start"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-950 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                  <ShoppingCart size={24} className="stroke-[2.5]" />
                </div>
                <div className="px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-black font-arabic">
                  {isRtl ? 'نقاط البيع ⚡' : 'Live POS'}
                </div>
              </div>
              <h3 className="text-lg font-black text-slate-955 dark:text-white font-arabic">
                {isRtl ? 'البيع (نقاط البيع)' : 'Sales / POS'}
              </h3>
              <p className="text-xs text-slate-900 dark:text-slate-350 mt-1.5 font-arabic leading-relaxed font-black">
                {isRtl ? 'فتح نظام البيع الفوري والتحصيل لإصدار الفواتير القانونية وحساب المبيعات اليومية' : 'Launch the instant POS checkout to process orders and print receipts'}
              </p>
            </motion.div>

            {/* Button 2: "الشراء" (Purchases) */}
            <motion.div
              whileHover={{ y: -5, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                sounds.playClick();
                window.dispatchEvent(new CustomEvent('change-screen', { detail: 'purchases-expenses' }));
              }}
              className="group cursor-pointer p-6 rounded-3xl bg-gradient-to-br from-indigo-100/70 to-indigo-50/60 dark:from-slate-900/60 dark:to-indigo-950/20 hover:from-indigo-150/80 hover:to-indigo-100/85 dark:hover:from-slate-800/80 hover:border-indigo-400/50 border border-slate-300 dark:border-white/5 shadow-lg select-none hover:shadow-indigo-500/10 backdrop-blur-md transition-all text-start"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-950 dark:text-indigo-450 group-hover:scale-110 transition-transform">
                  <Package size={24} className="stroke-[2.5]" />
                </div>
                <div className="px-2.5 py-1 rounded-xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[10px] font-black font-arabic">
                  {isRtl ? 'المخازن والتوريد 📦' : 'Inbound ERP'}
                </div>
              </div>
              <h3 className="text-lg font-black text-slate-955 dark:text-white font-arabic">
                {isRtl ? 'الشراء والمصاريف' : 'Purchases & Expenses'}
              </h3>
              <p className="text-xs text-slate-900 dark:text-slate-350 mt-1.5 font-arabic leading-relaxed font-black">
                {isRtl ? 'تسجيل فواتير الشراء الجديدة من الموردين، تكلفة الشحن، والوارد المستودعي الفوري' : 'Log warehouse purchase orders, import invoices, cargo and logistics expenses'}
              </p>
            </motion.div>

            {/* Button 3: "الديون" (Debts / Accounts) */}
            <motion.div
              whileHover={{ y: -5, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                sounds.playClick();
                window.dispatchEvent(new CustomEvent('change-screen', { detail: 'customers' }));
              }}
              className="group cursor-pointer p-6 rounded-3xl bg-gradient-to-br from-amber-100 to-slate-200 dark:from-slate-900/60 dark:to-amber-950/20 hover:from-amber-150 hover:to-slate-150 dark:hover:from-slate-800/80 hover:border-amber-400/50 border border-slate-300 dark:border-white/5 shadow-lg select-none hover:shadow-amber-500/10 backdrop-blur-md transition-all text-start"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-550/10 flex items-center justify-center text-amber-950 dark:text-amber-450 group-hover:scale-110 transition-transform">
                  <Wallet size={24} className="stroke-[2.5]" />
                </div>
                <div className="px-2.5 py-1 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-black font-arabic">
                  {isRtl ? 'الذمم والديون 💳' : 'Receivables & AP'}
                </div>
              </div>
              <h3 className="text-lg font-black text-slate-955 dark:text-white font-arabic">
                {isRtl ? 'الديون والحسابات' : 'Debts & Accounts'}
              </h3>
              <p className="text-xs text-slate-900 dark:text-slate-350 mt-1.5 font-arabic leading-relaxed font-black">
                {isRtl ? 'مستحقات العملاء المدينة ومستحقات الموردين ومراجعة كشوف الذمم بصفحة واحدة' : 'Track customer debt balances, record partial payments, and manage supplier cash targets'}
              </p>
            </motion.div>

          </div>
        </div>


        {/* 4. BOTTOM SECTION: Essential Overview/Metrics Subsection - Beautiful scannable glass islands with high-contrast text */}
        <div className="relative z-10 text-start">
          <h2 className="text-xs font-black text-slate-955 dark:text-slate-300 uppercase tracking-widest mb-4 font-arabic">
            📊 {isRtl ? 'خلاصة المؤشرات المالية ومستويات المخزن الموثقة' : 'System Overview & Core KPIs'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            
            {/* Metric 1: Total Sales */}
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 shadow-md">
              <span className="text-[10px] font-black text-slate-955 dark:text-slate-400 block uppercase tracking-wider font-arabic">
                {isRtl ? 'إجمالي حجم المبيعات العام' : 'TRACTABLE REVENUE VOLUME'}
              </span>
              <div className="mt-2.5 flex flex-col">
                <span className="text-2xl font-black font-mono text-emerald-800 dark:text-emerald-400">
                  {formatCurrency(statsObj.sales, activeCurrency)}
                </span>
                {otherCurrencySales.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px] font-mono text-slate-955 dark:text-slate-300 font-black">
                    {otherCurrencySales.map(({ code, value }) => (
                      <span key={code} className="bg-slate-100 dark:bg-slate-805 px-1.5 py-0.5 rounded">{formatMoney(value, code, isRtl ? 'ar' : 'en-US')}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Metric 2: Stock Security Level */}
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 shadow-md flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black text-slate-955 dark:text-slate-400 block uppercase tracking-wider font-arabic">
                  {isRtl ? 'مستويات المخزون وحالة التوريد' : 'INVENTORY STOCK VOLUME'}
                </span>
                <div className="mt-2.5 flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-slate-955 dark:text-white font-mono">
                    {totalStockItemsSum.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-955 dark:text-slate-305 font-arabic font-black">
                    {isRtl ? 'وحدة متوفرة' : 'units in stock'}
                  </span>
                </div>
              </div>
              <div className="mt-2">
                {statsObj.criticalCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-rose-800 bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 px-2 py-0.5 rounded-md animate-pulse border border-rose-200 dark:border-rose-500/20">
                    <span>⚠️</span>
                    <span>{isRtl ? `${statsObj.criticalCount} أصناف منقوصة` : `${statsObj.criticalCount} low stock`}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-800 bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 px-2 py-0.5 rounded-md border border-emerald-250 dark:border-emerald-500/20">
                    <span>🟢</span>
                    <span>{isRtl ? 'المخزون مستقر تماماً' : 'Stock level is healthy'}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Metric 3: Debt Liquidity Status */}
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 shadow-md flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black text-slate-955 dark:text-slate-400 block uppercase tracking-wider font-arabic">
                  {isRtl ? 'الذمم والتوازنات المالية' : 'CREDIT & DEBT POSITION'}
                </span>
                
                <div className="mt-2 space-y-1.5 text-xs font-black font-arabic">
                  <div className="flex justify-between items-center text-slate-955 dark:text-slate-250">
                    <span>{isRtl ? 'ديون العملاء لنا ↗️' : 'Receivables:'}</span>
                    <span className="font-mono text-indigo-800 dark:text-indigo-400 font-extrabold text-sm">
                      {formatCurrency(totalDebtIn, activeCurrency)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-955 dark:text-slate-250 font-arabic font-black">
                    <span>{isRtl ? `رصيد الخزنة (${activeCurrency}) 🏦` : `Vault balance (${activeCurrency}):`}</span>
                    <span className="font-mono text-amber-600 dark:text-amber-550 font-extrabold text-sm">
                      {formatCurrency(vaultBalanceActive, activeCurrency)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>



      {/* 3. قائمة آخر العمليات السريعة (recent-activity) */}
      <div className="recent-activity mb-6 text-start">
        <h5 className="font-arabic font-black text-slate-700 dark:text-slate-300 border-b border-slate-200/50 dark:border-white/10 pb-2.5 mb-3 flex items-center justify-between">
          <span className="text-xs">{isRtl ? 'آخر العمليات الفورية اللحظية' : 'Recent Instant Sales Log'}</span>
          <span className="text-[10px] font-mono font-bold text-emerald-500 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-full select-none animate-pulse">
            • {isRtl ? 'مستودعي تزامني' : 'Live Syncing'}
          </span>
        </h5>
        
        {lastInvoices.length === 0 ? (
          <p className="font-arabic font-bold text-slate-400 dark:text-slate-500 text-center py-6 text-xs bg-slate-50/55 dark:bg-white/[0.01] rounded-2xl border border-dashed border-slate-200 dark:border-white/5">
            {isRtl ? '📭 لا توجد مبيعات سريعة مسجلة حالياً' : '📭 No quick checkpoints logged yet'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {lastInvoices.slice(0, 5).map((inv) => (
              <div 
                key={inv.id} 
                className="flex items-center justify-between p-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.015] rounded-2xl border border-slate-200/60 dark:border-white/5 transition-all shadow-sm flex-row"
              >
                <div className="text-start">
                  <p className="font-bold text-xs text-slate-800 dark:text-slate-100 font-arabic">
                    {inv.customerName}
                  </p>
                  <p className="text-[9px] font-mono text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1.5">
                    <span>Invoice #{inv.invoiceNumber}</span>
                    <span>•</span>
                    <span>{new Date(inv.date).toLocaleTimeString(isRtl ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                </div>
                <div className="text-end">
                  <span className="font-mono font-black text-xs text-emerald-600 dark:text-emerald-400 block">
                    +{formatCurrency(inv.totalAmount, inv.currency || activeCurrency)}
                  </span>
                  <p className="text-[9px] font-arabic font-extrabold text-slate-400 dark:text-slate-500 mt-1">
                    {inv.type === 'sale' ? (isRtl ? 'مبيعات' : 'Sale') : (isRtl ? 'مشتريات' : 'Purchase')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 1. TOP STATS CARDS: 4 Responsive Summary Cards with hover effects and icons */}
      <div className="mb-6">
        <h2 className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-4 uppercase tracking-wider font-arabic">
          {isRtl ? 'الحالة العامة للمستودع' : 'General Warehouse State'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 select-none">
          
          {/* Card 1: Total Sales (multi-currency support) */}
          <GlassStatCard
            title={isRtl ? 'إجمالي حركة المبيعات' : 'Total Sales'}
            value={
              <div className="flex flex-col gap-0.5">
                <span className="text-xl sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(statsObj.sales, activeCurrency)}
                </span>
                {otherCurrencySales.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] font-mono text-slate-400">
                    {otherCurrencySales.map(({ code, value }) => (
                      <span key={code}>{formatMoney(value, code, isRtl ? 'ar' : 'en-US')}</span>
                    ))}
                  </div>
                )}
              </div>
            }
            subText={isRtl ? 'الرصيد في الفاصل الزمني' : 'Sales volumes in time filter'}
            icon={<TrendingUp size={18} />}
            trend={{ type: 'up', text: isRtl ? 'متعدد العملات' : 'Multi-Currency' }}
            onClick={() => {
              sounds.playClick();
              setDetailModalType('sales');
            }}
          />

          {/* Card 2: Total Stock Items (Sum of all quantities in warehouse) */}
          <GlassStatCard
            title={isRtl ? 'إجمالي بضائع المستودع' : 'Total Stock Items'}
            value={
              <div className="flex items-baseline gap-1">
                <span className="text-slate-800 dark:text-white font-black">{totalStockItemsSum.toLocaleString()}</span>
                <span className="text-xs uppercase text-slate-400 dark:text-slate-555 font-bold">{isRtl ? 'قطعة' : 'pcs'}</span>
              </div>
            }
            subText={`${isRtl ? 'موزعة على أصناف:' : 'Across SKU categories:'} ${products.length}`}
            icon={<Package size={18} />}
            onClick={() => {
              sounds.playClick();
              setDetailModalType('stock');
            }}
          />

          {/* Card 3: Low Stock Warnings */}
          <GlassStatCard
            title={isRtl ? 'مواد أوشكت على النفاد' : 'Low Stock Warnings'}
            value={`${statsObj.criticalCount} ${isRtl ? 'أصناف' : 'SKUs'}`}
            subText={isRtl ? 'أصناف تحت الحد الحرج للتوريد' : 'Items under safety threshold'}
            icon={<AlertTriangle size={18} />}
            trend={statsObj.criticalCount > 0 ? { type: 'down', text: isRtl ? 'نواقص حرج' : 'Low Stock' } : undefined}
            onClick={() => {
              sounds.playClick();
              setDetailModalType('low_stock');
            }}
          />

          {/* Card 4: Today's Invoices Count */}
          <GlassStatCard
            title={isRtl ? 'عدد فواتير اليوم' : "Today's Invoices Count"}
            value={`${todayInvoicesData.count} ${isRtl ? 'فواتير' : 'Invoices'}`}
            subText={`${isRtl ? 'الإجمالي القيمي اليومي:' : 'Daily value sum:'} ${formatCurrency(todayInvoicesData.totalAmount, activeCurrency)}`}
            icon={<FileText size={18} />}
            trend={{ type: 'up', text: isRtl ? 'اليوم' : 'Today' }}
            onClick={() => {
              sounds.playClick();
              setDetailModalType('today_invoices');
            }}
          />

        </div>
      </div>



      {/* الصف الثاني والثالث: شبكة الـ Bento Grid المتكاملة */}
      <div className="bento-grid-layout">
        
        {/* العمود الكبير (اليسار): التحليلات والدراسات البيانية التفاعلية والجداول */}
        <div className="grid-col-large flex flex-col gap-6">
          
          <PredictiveAnalytics language={language} />
          
          {/* أزرار الإجراءات السريعة في رص أنيق */}
          <QuickActions language={language} />

          {/* ترند صافي الدخل والمصروفات لـ 7 أيام متواصلة */}
          <div className="w-full">
            <NetIncome7DayTrend 
              language={language}
              invoices={invoices}
              vaultTransactions={vaultTransactions || []}
              activeCurrency={activeCurrency}
              formatCurrency={formatCurrency}
            />
          </div>

          {/* 2. ANALYTICS SECTION: Interactive Tabbed Visualizer suited for Recharts/Chart.js styling */}
          <div id="bento-analysis-tab" className="w-full rounded-2xl border border-slate-200/80 bg-white/70 backdrop-blur-xl p-6 shadow-sm dark:border-white/10 dark:bg-slate-800/20 dark:shadow-2xl relative overflow-hidden flex flex-col justify-between box-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 select-none">
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-105 font-arabic">
                  {isRtl ? 'رسومات التحليل البياني المركزي' : 'Core Graphical Analytical System'}
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-450 font-arabic mt-0.5">
                  {activeChartTab === 'trends' 
                    ? (isRtl ? 'الفلو الزمني لحجم الإيرادات والمصروفات التشغيلية' : 'Flow timeline of revenue and operational expenses')
                    : (isRtl ? 'حصص الفئات المختلفة للبضائع والمخزون المودع' : 'Share breakdown of products in inventory by category')}
                </p>
              </div>

              {/* أزرار تفعيل التابات التبادلية */}
              <div className="flex p-0.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-arabic">
                <button 
                  onClick={() => { sounds.playClick(); setActiveChartTab('trends'); }}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                    activeChartTab === 'trends' 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-850 dark:text-slate-450'
                  }`}
                >
                  {isRtl ? 'ترند الإيرادات والمصاريف' : 'Sales vs Expenses'}
                </button>
                <button 
                  onClick={() => { sounds.playClick(); setActiveChartTab('categories'); }}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                    activeChartTab === 'categories' 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-850 dark:text-slate-450'
                  }`}
                >
                  {isRtl ? 'توزيع فئات السلع' : 'Stock Categories'}
                </button>
              </div>
            </div>

            {/* الرسم البياني التفاعلي التبادلي */}
            <div className="w-full h-72 relative">
              {activeChartTab === 'trends' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                      </linearGradient>
                      <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:stroke-slate-700/50" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                        border: '1px solid rgba(255,255,255,0.1)', 
                        borderRadius: '12px',
                        color: '#fff',
                        fontSize: '12px'
                      }} 
                    />
                    <Area type="monotone" dataKey="revenue" name={isRtl ? 'المبيعات' : 'Sales'} stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorSales)" />
                    <Area type="monotone" dataKey="expenses" name={isRtl ? 'المصاريف التشغيلية' : 'Expenses'} stroke="#3b82f6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorExpenses)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : topCategoriesData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs font-bold text-slate-400 font-arabic">
                  {isRtl ? 'لا توجد منتجات بعد. أضف منتجات لتظهر توزيعات الفئات.' : 'No products yet. Add products to see category distribution.'}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topCategoriesData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:stroke-slate-700/50" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                        border: '1px solid rgba(255,255,255,0.1)', 
                        borderRadius: '12px',
                        color: '#fff',
                        fontSize: '12px'
                      }} 
                    />
                    <Bar dataKey="value" name={isRtl ? 'المخزون المتوفر' : 'In Stock'} radius={[6, 6, 0, 0]}>
                      {topCategoriesData.map((entry, index) => {
                        const colors = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899'];
                        return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* 3. LIVE RECENT ACTIVITY TABLES (Recent 5 Transactions & Recent Stock Movements) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-full box-border">
            
            {/* Table A: Recent 5 Transactions */}
            <div className="rounded-2xl border border-slate-200 bg-white/75 backdrop-blur-xl p-6 shadow-sm dark:border-white/10 dark:bg-slate-800/10 flex flex-col justify-between overflow-hidden">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 font-arabic flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    {isRtl ? 'آخر 5 فواتير في السجل المالي' : 'Recent 5 Transactions Ledger'}
                  </h3>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-arabic">
                    {isRtl ? 'مستند مباشر' : 'Live Sync'}
                  </span>
                </div>
                
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-start border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-white/5 text-slate-400 font-semibold font-arabic">
                        <th className="py-2.5 text-start">{isRtl ? 'رقم الفاتورة' : 'Invoice ID'}</th>
                        <th className="py-2.5 text-start">{isRtl ? 'الجهة/العميل' : 'Entity'}</th>
                        <th className="py-2.5 text-start">{isRtl ? 'القيمة' : 'Amount'}</th>
                        <th className="py-2.5 text-start">{isRtl ? 'الحالة' : 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-slate-700 dark:text-slate-300">
                      {lastInvoices.length === 0 && (
                        <tr><td colSpan={4} className="py-6 text-center text-slate-400 font-arabic">{isRtl ? 'لا توجد فواتير بعد' : 'No invoices yet'}</td></tr>
                      )}
                      {lastInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={() => {
                          window.dispatchEvent(new CustomEvent('change-screen', { detail: 'pos' }));
                        }}>
                          <td className="py-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">#{inv.invoiceNumber}</td>
                          <td className="py-3">
                            <p className="font-bold font-arabic text-slate-800 dark:text-white truncate max-w-[125px]">
                              {inv.type === 'sale' 
                                ? (inv.customerName || (isRtl ? 'عميل كاش وصالة' : 'Walk-in Client')) 
                                : (inv.supplierName || (isRtl ? 'مستورد رئيسي' : 'Core Supplier'))}
                            </p>
                          </td>
                          <td className="py-3 font-mono font-extrabold text-slate-900 dark:text-white">
                            {formatCurrency(inv.totalAmount, inv.currency)}
                          </td>
                          <td className="py-3">
                            <span className="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200/40 font-arabic">
                              {inv.type === 'sale'
                                ? (inv.paymentMethod === 'credit' ? (isRtl ? 'بيع آجل' : 'On Credit') : (isRtl ? 'بيع مدفوع' : 'Sale Paid'))
                                : (isRtl ? 'شراء توريد' : 'Cargo Rcvd')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Table B: Recent Stock Movements */}
            <div className="rounded-2xl border border-slate-200 bg-white/75 backdrop-blur-xl p-6 shadow-sm dark:border-white/10 dark:bg-slate-800/10 flex flex-col justify-between overflow-hidden">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 font-arabic flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
                    {isRtl ? 'آخر حركات السلع المخزنية' : 'Recent Stock Movements Log'}
                  </h3>
                </div>

                <div className="overflow-x-auto w-full">
                  <table className="w-full text-start border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-white/5 text-slate-400 font-semibold font-arabic">
                        <th className="py-2.5 text-start">{isRtl ? 'اسم المادة' : 'Item'}</th>
                        <th className="py-2.5 text-start">{isRtl ? 'الحركة' : 'Action'}</th>
                        <th className="py-2.5 text-start">{isRtl ? 'المقدار' : 'Quantity'}</th>
                        <th className="py-2.5 text-start">{isRtl ? 'الموظف/القسم' : 'Operator'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-slate-700 dark:text-slate-300">
                      {stockMovements.length === 0 && (
                        <tr><td colSpan={4} className="py-6 text-center text-slate-400 font-arabic">{isRtl ? 'لا توجد حركات مخزنية بعد' : 'No stock movements yet'}</td></tr>
                      )}
                      {stockMovements.map((move) => (
                        <tr key={move.id} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 font-bold font-arabic text-slate-800 dark:text-white truncate max-w-[130px]" title={move.item}>{move.item}</td>
                          <td className="py-3">
                            <span className={`inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded text-[10px] font-arabic ${
                              move.action === 'purchase'
                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                                : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                            }`}>
                              {move.action === 'purchase' ? (isRtl ? '📥 توريد دخول' : '📥 Input') : (isRtl ? '📤 بيع خروج' : '📤 Output')}
                            </span>
                          </td>
                          <td className="py-3 font-mono font-extrabold text-slate-900 dark:text-white">
                            {move.action === 'purchase' ? '+' : '-'}{move.quantity}
                          </td>
                          <td className="py-3 font-bold font-arabic text-slate-500 dark:text-slate-400 truncate max-w-[100px]" title={move.employee}>{move.employee}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* العمود المتوسط (اليمين): لوحة الإشعارات الذكية، رادار النواقص وسجل الحركة */}
        <div className="grid-col-medium flex flex-col gap-6">
          
          {/* 4. SMART NOTIFICATION SYSTEM: Business Alert Panel */}
          <div className="rounded-2xl border border-slate-200 bg-white/75 backdrop-blur-xl p-6 shadow-sm dark:border-white/10 dark:bg-slate-800/20 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/5 select-none">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white font-arabic flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
                {isRtl ? 'نظام الإشعارات الذكي' : 'Smart Notification Panel'}
              </h3>
            </div>

            <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
              {smartAlerts.map((alert) => (
                <div key={alert.id} className={`p-4 rounded-xl border flex flex-col gap-1.5 transition-all text-xs ${
                  alert.type === 'expiry' 
                    ? 'bg-amber-500/5 border-amber-500/30 text-amber-900 dark:text-amber-100' 
                    : alert.type === 'low_stock'
                      ? 'bg-rose-500/5 border-rose-500/30 text-rose-900 dark:text-rose-100'
                      : 'bg-emerald-505/5 border-emerald-500/30 text-emerald-950 dark:text-emerald-100'
                }`}>
                  <div className="flex justify-between items-center select-none">
                    <span className="font-extrabold font-arabic text-xs tracking-tight">
                      {alert.title}
                    </span>
                    <span className="text-[10px] font-mono opacity-60">
                      {alert.date}
                    </span>
                  </div>
                  <p className="font-semibold font-arabic leading-relaxed opacity-90 text-[11px]">
                    {alert.desc}
                  </p>
                  
                  {alert.type !== 'system' && (
                    <div className="flex justify-end gap-2 pt-1 select-none">
                      <button 
                        onClick={() => {
                          sounds.playClick();
                          window.dispatchEvent(new CustomEvent('change-screen', { detail: 'inventory' }));
                          toast.info(isRtl ? 'توجيه المستند لتصحيح النواقص...' : 'Navigating to stock manager...');
                        }}
                        className="px-2.5 py-1 text-[10px] font-bold rounded bg-slate-900 text-white dark:bg-white/10 dark:hover:bg-white/15 dark:text-white font-arabic hover:opacity-90 active:scale-95 transition-all shrink-0"
                      >
                        {isRtl ? 'معالجة النقص' : 'Resolve Alert'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <RadarAlerts language={language} />
          
          <ActivityLog language={language} />
        </div>

      </div>

      {/* Salary disburse modal popup drawer */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white/95 backdrop-blur-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/85 text-slate-800"
            >
              {/* Header */}
              <div className="p-8 bg-gradient-to-br from-indigo-600 to-indigo-800 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-white">
                    <DollarSign size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black">{isRtl ? "صرف الرواتب" : "Log Salary Payment"}</h3>
                    <p className="text-[10px] text-indigo-100 uppercase tracking-widest">{isRtl ? "الخزينة الرئيسية" : "Main Safehouse"}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-white/20 rounded-xl transition-all cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Form */}
              <form 
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (isSubmitting) return;
                  
                  const numAmount = Number(salaryAmount);
                  if (isNaN(numAmount) || numAmount <= 0) {
                    toast.error(isRtl ? "الرجاء إدخال مبلغ صحيح وموجب" : "Please enter a valid positive salary amount");
                    return;
                  }

                  const currentCurrencyBalance = readVaultBalances(vault)[selectedCurrency];

                  if (numAmount > currentCurrencyBalance) {
                    toast.error(
                      isRtl 
                        ? `عذراً! الرصيد المتوفر في الخزينة بال${selectedCurrency} غير كافٍ لإتمام عملية الصرف. المتوفر: ${formatCurrency(currentCurrencyBalance, selectedCurrency)}`
                        : `Insufficient funds! Available ${selectedCurrency} balance is too low. Available: ${formatCurrency(currentCurrencyBalance, selectedCurrency)}`
                    );
                    return;
                  }

                  setIsSubmitting(true);
                  try {
                    await recordVaultTransaction({
                      type: 'expense',
                      category: 'salary',
                      source: 'payroll',
                      amount: numAmount,
                      currency: selectedCurrency,
                      description: isRtl ? 'مصاريف تشغيلية - رواتب' : 'Operating Expense - Salaries'
                    });

                    // Save that it is paid for the current month
                    const today = new Date();
                    const currentMonthKey = `salary_paid_${today.getFullYear()}_${today.getMonth() + 1}`;
                    localStorage.setItem(currentMonthKey, 'true');
                    
                    setShowBanner(false);
                    setIsModalOpen(false);
                    toast.success(isRtl ? 'تم تسجيل وتوثيق صرف الرواتب بنجاح!' : 'Payroll disburse recorded successfully!');
                  } catch (error) {
                    console.error("Error logging salary payment: ", error);
                    toast.error(isRtl ? 'حدث خطأ أثناء الاتصال بالخزينة' : 'Error updating safe ledger');
                  } finally {
                    setIsSubmitting(false);
                  }
                }} 
                className="p-8 space-y-6"
              >
                <div className="space-y-4">
                  <p className="text-xs text-slate-550 leading-relaxed font-sans font-medium">
                    {isRtl 
                      ? "سيتم قيد مبالغ الصرف كمصروف تشغيلي (Operating Expense - Salaries) وسحب قيمة المبلغ مباشرة من رصيد الخزينة."
                      : "The disbursement value will be recorded as an operating expense (Operating Expense - Salaries), and debited directly from the safe balance."}
                  </p>
                  
                  {/* Inputs Row */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-1.5">
                      <label className="text-xs font-black text-slate-500 uppercase tracking-widest block">
                        {isRtl ? "المبلغ المطلوب صرفه" : "Amount to pay"}
                      </label>
                      <input 
                        type="number"
                        required
                        value={salaryAmount}
                        onChange={(e) => setSalaryAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xl font-black focus:ring-2 focus:ring-indigo-500 text-slate-800"
                      />
                    </div>
                    <div className="col-span-1 space-y-1.5">
                      <label className="text-xs font-black text-slate-555 uppercase tracking-widest block">
                        {isRtl ? "العملة" : "Currency"}
                      </label>
                      <select
                        value={selectedCurrency}
                        onChange={(e) => setSelectedCurrency(e.target.value as 'JOD' | 'ILS' | 'USD')}
                        className="w-full px-3 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 text-xs outline-none h-[64px]"
                      >
                        <option value="JOD">JOD ($)</option>
                        <option value="ILS">ILS (₪)</option>
                        <option value="USD">USD ($)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Submit button */}
                <div className="pt-4 flex gap-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold text-sm transition-all cursor-pointer"
                  >
                    {isRtl ? "إلغاء السحب" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-450 text-white rounded-2xl font-extrabold text-sm transition-all shadow-md hover:shadow-lg disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isSubmitting ? (isRtl ? "جاري الحفظ..." : "Processing...") : (isRtl ? "تأكيد تسجيل الصرف" : "Confirm Disburse")}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Smart Detail Modals */}
        {detailModalType && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailModalType(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            
            {/* Modal panel container */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="relative w-full max-w-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200/50 dark:border-white/10 text-slate-800 dark:text-slate-100 max-h-[85vh] flex flex-col"
            >
              {/* Header */}
              <div className="p-6 bg-gradient-to-br from-indigo-700/90 to-indigo-900/90 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center text-white shrink-0">
                    {detailModalType === 'sales' && <TrendingUp size={20} />}
                    {detailModalType === 'stock' && <Package size={20} />}
                    {detailModalType === 'low_stock' && <AlertTriangle size={20} />}
                    {detailModalType === 'today_invoices' && <FileText size={20} />}
                  </div>
                  <div>
                    <h3 className="text-lg font-black font-arabic">
                      {detailModalType === 'sales' && (isRtl ? 'تحليل المبيعات والتوزيع المالي' : 'Sales Analysis & Financial Split')}
                      {detailModalType === 'stock' && (isRtl ? 'تفاصيل مستودع البضائع والفئات' : 'Warehouse Goods & Categories Details')}
                      {detailModalType === 'low_stock' && (isRtl ? 'تقرير المنتجات منخفضة المخزون' : 'Low Stock Products Report')}
                      {detailModalType === 'today_invoices' && (isRtl ? 'سجل الفواتير الصادرة والواردة اليوم' : "Today's Issued & Received Invoices Ledger")}
                    </h3>
                    <p className="text-[11px] text-indigo-200 uppercase tracking-wider font-arabic mt-0.5">
                      {detailModalType === 'sales' && (isRtl ? `الفاصل الزمني الحالي: ${timeFilter}` : `Current active filter Timebox: ${timeFilter}`)}
                      {detailModalType === 'stock' && (isRtl ? 'إحصاءات شاملة لتوزيع السلع' : 'Comprehensive statistics of item weight splits')}
                      {detailModalType === 'low_stock' && (isRtl ? 'قائمة الأصناف التي تحت حد الأمان' : 'Items containing volumes lower than safety limits')}
                      {detailModalType === 'today_invoices' && (isRtl ? 'رصد الحركة اللحظية للفواتير' : 'Monitoring system logs for today')}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => { sounds.playClick(); setDetailModalType(null); }}
                  className="p-2 hover:bg-white/20 rounded-xl transition-all cursor-pointer text-white/80 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Scrollable Context Box */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 min-w-0">
                {detailModalType === 'sales' && (() => {
                  // Calculate period start
                  const now = Date.now();
                  let prdStart = 0;
                  if (timeFilter === 'today') {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    prdStart = today.getTime();
                  } else if (timeFilter === 'week') {
                    prdStart = now - 7 * 24 * 60 * 60 * 1000;
                  } else if (timeFilter === 'month') {
                    prdStart = now - 30 * 24 * 60 * 60 * 1000;
                  } else if (timeFilter === 'year') {
                    prdStart = now - 365 * 24 * 60 * 60 * 1000;
                  }

                  // Active currency only (never mix currencies); split by the REAL payment method
                  const periodSalesInvoices = invoices.filter(inv =>
                    inv.type === 'sale' && inv.date >= prdStart && (inv.currency || 'JOD') === activeCurrency);

                  const cashSales = periodSalesInvoices.filter(inv => !inv.paymentMethod || inv.paymentMethod === 'cash');
                  const cardSales = periodSalesInvoices.filter(inv => inv.paymentMethod === 'card' || inv.paymentMethod === 'wallet');
                  const creditSales = periodSalesInvoices.filter(inv => inv.paymentMethod === 'credit');

                  const cashTotalSum = cashSales.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);
                  const cardTotalSum = cardSales.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);
                  const creditTotalSum = creditSales.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);
                  
                  const topInvoices = [...periodSalesInvoices].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 3);

                  return (
                    <div className="space-y-6 text-start">
                      {/* Visual Split Cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="p-4 rounded-2xl bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 text-emerald-950 dark:text-emerald-100">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold font-arabic">{isRtl ? 'مبيعات الكاش الفورية' : 'Cash Counter Sales'}</span>
                            <span className="text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded font-bold font-mono">CASH</span>
                          </div>
                          <h4 className="text-xl font-mono font-black mt-2 text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(cashTotalSum, activeCurrency)}
                          </h4>
                          <p className="text-[10px] opacity-75 font-arabic mt-1">
                            {isRtl ? `عدد عمليات الكاش: ${cashSales.length}` : `Total cash invoices: ${cashSales.length}`}
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 text-indigo-950 dark:text-indigo-100">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold font-arabic">{isRtl ? 'مبيعات البطاقات والمحافظ' : 'Card & Wallet Sales'}</span>
                            <span className="text-[10px] bg-indigo-500/20 px-2 py-0.5 rounded font-bold font-mono">CARD</span>
                          </div>
                          <h4 className="text-xl font-mono font-black mt-2 text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(cardTotalSum, activeCurrency)}
                          </h4>
                          <p className="text-[10px] opacity-75 font-arabic mt-1">
                            {isRtl ? `عدد عمليات البطاقات: ${cardSales.length}` : `Total card invoices: ${cardSales.length}`}
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 text-amber-950 dark:text-amber-100">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold font-arabic">{isRtl ? 'مبيعات آجلة (ذمم)' : 'Credit Sales (receivable)'}</span>
                            <span className="text-[10px] bg-amber-500/20 px-2 py-0.5 rounded font-bold font-mono">CREDIT</span>
                          </div>
                          <h4 className="text-xl font-mono font-black mt-2 text-amber-600 dark:text-amber-400">
                            {formatCurrency(creditTotalSum, activeCurrency)}
                          </h4>
                          <p className="text-[10px] opacity-75 font-arabic mt-1">
                            {isRtl ? `عدد الفواتير الآجلة: ${creditSales.length} (لا تدخل الخزنة حتى التحصيل)` : `Credit invoices: ${creditSales.length} (not in vault until collected)`}
                          </p>
                        </div>
                      </div>

                      {/* Multi-currency state checklist */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 font-arabic">
                          {isRtl ? 'الأحجام النقدية التفصيلية حسب العملات المتاحة' : 'Cash volume details per standard wallet'}
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono text-center">
                          {POS_CURRENCY_CODES.map(code => (
                            <div key={code} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-white/5">
                              <p className="text-[10px] text-slate-400 uppercase">{code}</p>
                              <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200 mt-1">{formatMoney(salesByCurrency[code] || 0, code, isRtl ? 'ar' : 'en-US')}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Top 3 High Invoices */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 font-arabic">
                          {isRtl ? 'أعلى فواتير مبيع قيمةً في هذه الفترة' : 'Top highest value sales invoices in period'}
                        </h4>
                        {topInvoices.length > 0 ? (
                          <div className="space-y-2">
                            {topInvoices.map((inv) => (
                              <div key={inv.id} className="flex justify-between items-center p-3.5 rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-800/20 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-xs font-extrabold text-indigo-600 dark:text-indigo-400">#{inv.invoiceNumber}</span>
                                  <div className="text-start">
                                    <p className="text-xs font-bold font-arabic">{inv.customerName || (isRtl ? 'عميل صالة كاش' : 'Live Client')}</p>
                                    <p className="text-[10px] text-slate-400">{new Date(inv.date).toLocaleDateString()}</p>
                                  </div>
                                </div>
                                <span className="font-mono font-extrabold text-xs text-slate-800 dark:text-white">
                                  {formatCurrency(inv.totalAmount, inv.currency)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 text-center py-4 font-arabic">{isRtl ? 'لا يوجد فواتير مسجلة في هذا النطاق.' : 'No invoices matched in this scope.'}</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {detailModalType === 'stock' && (() => {
                  // Calculate category allocations
                  const catCounts: Record<string, { qty: number; itemsCount: number }> = {};
                  products.forEach(p => {
                    const cat = p.category || (isRtl ? 'عام' : 'General');
                    if (!catCounts[cat]) {
                      catCounts[cat] = { qty: 0, itemsCount: 0 };
                    }
                    catCounts[cat].qty += (Number(p.quantity) || 0);
                    catCounts[cat].itemsCount += 1;
                  });

                  // sort categories by total quantity
                  const sortedCats = Object.entries(catCounts)
                    .map(([name, val]) => ({ name, ...val }))
                    .sort((a, b) => b.qty - a.qty);

                  const topItemsStock = [...products].sort((a, b) => b.quantity - a.quantity).slice(0, 5);

                  return (
                    <div className="space-y-6 text-start">
                      {/* Category allocations table */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 font-arabic">
                          {isRtl ? 'توزيع الكميات الإجمالية حسب فئات المخزون' : 'Stock volume distributions by core category'}
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-start border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-white/5 text-slate-400 font-semibold font-arabic">
                                <th className="py-2 text-start">{isRtl ? 'الفئة' : 'Category'}</th>
                                <th className="py-2 text-center">{isRtl ? 'عدد الأصناف' : 'SKUs Count'}</th>
                                <th className="py-2 text-end">{isRtl ? 'الكمية الإجمالية' : 'Total Units'}</th>
                                <th className="py-2 text-end">{isRtl ? 'الحصة' : 'Weight'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-slate-700 dark:text-slate-300">
                              {sortedCats.map((cat, idx) => {
                                const pct = totalStockItemsSum > 0 ? Math.round((cat.qty / totalStockItemsSum) * 100) : 0;
                                return (
                                  <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                                    <td className="py-2.5 font-bold font-arabic">{cat.name}</td>
                                    <td className="py-2.5 text-center font-mono font-bold text-slate-550">{cat.itemsCount}</td>
                                    <td className="py-2.5 text-end font-mono font-extrabold text-slate-800 dark:text-white">{cat.qty.toLocaleString()}</td>
                                    <td className="py-2.5 text-end font-mono">
                                      <span className="font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full text-[10px]">
                                        {pct}%
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Top 5 Stock items */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 font-arabic">
                          {isRtl ? 'أعلى 5 أصناف سلع تخزيناً بالقطعة' : 'Top 5 highly stocked warehouse products'}
                        </h4>
                        {topItemsStock.length > 0 ? (
                          <div className="space-y-2">
                            {topItemsStock.map((p) => (
                              <div key={p.id} className="flex justify-between items-center p-3.5 rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-800/20 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all">
                                <div className="flex items-center gap-3">
                                  <span className="p-2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-lg shrink-0">
                                    <Package size={16} />
                                  </span>
                                  <div className="text-start">
                                    <p className="text-xs font-bold font-arabic text-slate-800 dark:text-white">{p.name}</p>
                                    <p className="text-[10px] text-slate-500 font-mono">SKU: {p.sku || p.id.slice(0, 8)} • {p.category}</p>
                                  </div>
                                </div>
                                <span className="font-mono font-extrabold text-[11px] px-3 py-1 rounded bg-slate-200/50 dark:bg-white/5 text-slate-800 dark:text-white border border-slate-300/20">
                                  {p.quantity} {isRtl ? 'قطعة' : 'pcs'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 text-center py-4 font-arabic">{isRtl ? 'لا يوجد أصناف متطابقة.' : 'No stock products recorded yet.'}</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {detailModalType === 'low_stock' && (() => {
                  const threshold = settings?.lowStockThreshold ?? 5;
                  const criticalProducts = products.filter(p => isLowStock(p.quantity, p.lowStockThreshold, threshold));

                  return (
                    <div className="space-y-6 text-start">
                      <div>
                        <div className="flex items-center justify-between mb-3 select-none">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest font-arabic">
                            {isRtl ? 'الأصناف المتصورة بالنواقص الحرجة للتمويل' : 'List of products undercritical safety threshold'}
                          </h4>
                          <span className="text-[10px] font-extrabold px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-full">
                            {criticalProducts.length} {isRtl ? 'تنبيهات نواقص' : 'Alerts'}
                          </span>
                        </div>

                        {criticalProducts.length > 0 ? (
                          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                            {criticalProducts.map((p) => (
                              <div key={p.id} className="flex justify-between items-center p-3.5 rounded-xl border border-rose-500/25 bg-rose-500/[0.02] dark:bg-rose-500/[0.04] hover:bg-rose-500/[0.05] transition-all">
                                <div className="flex items-center gap-3">
                                  <span className="p-2 bg-rose-500/10 text-rose-500 rounded-lg shrink-0">
                                    <AlertTriangle size={16} />
                                  </span>
                                  <div className="text-start">
                                    <p className="text-xs font-bold font-arabic text-slate-800 dark:text-white">{p.name}</p>
                                    <p className="text-[10px] text-slate-400 font-mono">SKU: {p.sku || p.id.slice(0, 8)} • {p.category}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="text-end text-[10px] font-sans font-medium text-slate-400">
                                    <p>{isRtl ? `الحد الأدنى: ${p.lowStockThreshold ?? threshold}` : `Min req: ${p.lowStockThreshold ?? threshold}`}</p>
                                  </div>
                                  <span className="font-mono font-black text-xs px-2.5 py-1 rounded bg-rose-500 text-white dark:bg-rose-500/[0.15] dark:text-rose-400">
                                    {p.quantity} {isRtl ? 'قطع' : 'pcs'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/10 rounded-2xl border border-dashed border-slate-200 dark:border-white/5 select-none text-slate-500">
                            <span className="text-2xl">🌱</span>
                            <p className="text-xs font-bold font-arabic mt-2 text-emerald-600 dark:text-emerald-400">
                              {isRtl ? 'رائع! لا يوجد أي نواقص حالية في المستودع.' : 'Great! All inventory levels are above safety thresholds.'}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Actions buttons */}
                      <div className="pt-2 select-none flex justify-center">
                        <button
                          onClick={() => {
                            sounds.playClick();
                            setDetailModalType(null);
                            window.dispatchEvent(new CustomEvent('change-screen', { detail: 'inventory' }));
                            toast.info(isRtl ? 'توجيه المستند لمدير المستودع لتجهيز التوريد...' : 'Navigating to stock manager for restocking...');
                          }}
                          className="w-full sm:w-auto px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-extrabold font-arabic shadow-md hover:shadow-lg transition-all transform active:scale-95 cursor-pointer"
                        >
                          {isRtl ? 'إدارة النواقص وتوريد فورية' : 'Procure & Restock Now'}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {detailModalType === 'today_invoices' && (() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const todayStarts = today.getTime();

                  const todaysInvoices = invoices.filter(inv => inv.date >= todayStarts && (inv.currency || 'JOD') === activeCurrency);

                  return (
                    <div className="space-y-6 text-start">
                      {/* Today summaries cards */}
                      <div className="grid grid-cols-2 gap-3 mb-4 text-center select-none">
                        <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
                          <span className="text-[10px] text-slate-400 font-arabic">{isRtl ? 'مجموع فواتير اليوم' : "Today's Ledger Invoices"}</span>
                          <h5 className="text-sm font-black mt-1 text-indigo-600 dark:text-indigo-400">
                            {todaysInvoices.length} {isRtl ? 'فواتير ومستندات' : 'Docs'}
                          </h5>
                        </div>
                        <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                          <span className="text-[10px] text-slate-400 font-arabic">{isRtl ? `مبيعات اليوم (${activeCurrency})` : `Today's sales (${activeCurrency})`}</span>
                          <h5 className="text-sm font-black mt-1 text-emerald-600 dark:text-emerald-400 font-mono">
                            {formatCurrency(todayInvoicesData.totalAmount, activeCurrency)}
                          </h5>
                        </div>
                      </div>

                      {/* Complete list */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 font-arabic">
                          {isRtl ? 'التدفق المالي للفواتير خلال اليوم للتدقيق اللحظي' : "Today's Live Invoices Flow & Ledger"}
                        </h4>
                        {todaysInvoices.length > 0 ? (
                          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                            {todaysInvoices.map((inv) => {
                              const timeStr = new Date(inv.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                              return (
                                <div key={inv.id} className="flex justify-between items-center p-3 rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-800/20 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                  <div className="flex items-center gap-3">
                                    <span className={`p-1.5 rounded-lg text-white font-mono text-[9px] font-bold ${
                                      inv.type === 'sale' ? 'bg-emerald-500' : 'bg-blue-500'
                                    }`}>
                                      {inv.type === 'sale' ? 'SAL' : 'PUR'}
                                    </span>
                                    <div className="text-start">
                                      <span className="font-mono text-xs font-extrabold text-slate-800 dark:text-white">#{inv.invoiceNumber}</span>
                                      <p className="text-[10px] text-slate-500 font-semibold font-arabic truncate max-w-[150px]">
                                        {inv.type === 'sale' 
                                          ? (inv.customerName || (isRtl ? 'عميل كاش وصالة' : 'Counter Client'))
                                          : (inv.supplierName || (isRtl ? 'شركة توريد مستوردة' : 'Wholesale Supplier'))}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3 font-mono">
                                    <span className="text-[10px] text-slate-400 font-bold">{timeStr}</span>
                                    <span className="font-extrabold text-xs text-slate-900 dark:text-white">
                                      {formatCurrency(inv.totalAmount, inv.currency)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/10 rounded-2xl border border-dashed border-slate-200 dark:border-white/5 select-none text-slate-500 text-xs font-arabic">
                            <span>📝</span>
                            <p className="mt-2 font-bold">{isRtl ? 'لم تصدر أي فواتير بيع أو توريد اليوم حتى الآن.' : 'No invoices or POS transactions processed today yet.'}</p>
                          </div>
                        )}
                      </div>

                      {/* Navigate to POS quick trigger */}
                      <div className="pt-2 select-none flex justify-center">
                        <button
                          onClick={() => {
                            sounds.playClick();
                            setDetailModalType(null);
                            window.dispatchEvent(new CustomEvent('change-screen', { detail: 'pos' }));
                            toast.info(isRtl ? 'فتح نظام المبيعات لإصدار فاتورة...' : 'Opening POS terminal for transactions...');
                          }}
                          className="w-full sm:w-auto px-6 py-3 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold font-arabic shadow-md hover:shadow-lg transition-all transform active:scale-95 cursor-pointer"
                        >
                          {isRtl ? 'فتح منصة الفواتير والمبيعات' : 'Open Sales Terminal / POS'}
                        </button>
                      </div>
                    </div>
                  );
                })()}

              </div>

              {/* Close Footer */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850/40 border-t border-slate-100 dark:border-white/5 flex justify-end shrink-0 select-none">
                <button 
                  onClick={() => { sounds.playClick(); setDetailModalType(null); }}
                  className="px-5 py-2 bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl font-bold font-arabic text-xs active:scale-95 transition-all text-center cursor-pointer"
                >
                  {isRtl ? 'إغلاق نافذة التفاصيل' : 'Close Details'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

