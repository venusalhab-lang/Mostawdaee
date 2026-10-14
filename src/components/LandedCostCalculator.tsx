import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Package, Truck, ShieldCheck, DollarSign, ArrowRightLeft, TrendingUp, Info, CheckCircle2, Check, Loader2 } from 'lucide-react';
import { Language, ProductDetails, LogisticsCosts, CalculationResults, Product, StockStatus, AppSettings } from '../types';
import { translations } from '../translations';
import { motion, AnimatePresence } from 'motion/react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { computeStockStatus } from '../lib/stock';
import { apiUrl, readApiJson } from '../lib/apiBase';
import { buildUsdUnitRates, convertAmount, readCachedLiveRates, roundMoney } from '../lib/exchangeRates';
import { toast } from 'sonner';

interface Props {
  language: Language;
  settings: AppSettings;
  onAddProduct: (p: Product) => Promise<void> | void;
  defaultVat: number;
  defaultCustoms: number;
}

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const CURRENCIES = [
  { id: 'JOD', symbol: 'د.أ', label: 'jodLabel', defaultRate: (base: string) => base === 'USD' ? 0.71 : base === 'EUR' ? 0.77 : 1 },
  { id: 'USD', symbol: '$', label: 'usdLabel', defaultRate: (base: string) => base === 'JOD' ? 1.41 : 1 },
  { id: 'EUR', symbol: '€', label: 'eurLabel', defaultRate: (base: string) => base === 'JOD' ? 1.30 : 1 },
  { id: 'ILS', symbol: '₪', label: 'ilsLabel', defaultRate: (base: string) => base === 'JOD' ? 0.20 : 1 },
];

export default function LandedCostCalculator({ language, settings, onAddProduct, defaultVat, defaultCustoms }: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';
  
  const [showToast, setShowToast] = useState(false);
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState(CURRENCIES[1]);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const localCurrency = settings.currency || 'JOD';

  /** Local units per one foreign unit from cached/default rates, or null when the pair is unknown. */
  const approximateRate = (from: string): number | null => {
    if (from === localCurrency) return 1;
    const rates = buildUsdUnitRates(settings, readCachedLiveRates());
    if (!rates[from] || !rates[localCurrency]) return null;
    return Number(convertAmount(1, from, localCurrency, rates).toFixed(6));
  };
  const [rateSource, setRateSource] = useState<'same' | 'live' | 'approximate' | 'manual' | 'missing'>(() =>
    CURRENCIES[1].id === localCurrency ? 'same' : approximateRate(CURRENCIES[1].id) ? 'approximate' : 'missing');

  // Form State
  const [product, setProduct] = useState<ProductDetails>({
    name: '',
    quantity: 100,
    unitCost: 10,
    currency: 'USD',
  });

  const [logistics, setLogistics] = useState<LogisticsCosts>(() => ({
    exchangeRate: approximateRate(CURRENCIES[1].id) ?? 0,
    shippingCost: 500,
    customsDuty: defaultCustoms,
    isDutyFixed: false,
    clearanceFees: 200,
    inlandTransport: 150,
    vatRate: defaultVat,
    insuranceCost: undefined,
    inspectionFees: undefined,
  }));

  const rateRequest = useRef(0);
  const fetchExchangeRate = async (baseCurrency: string) => {
    const request = ++rateRequest.current;
    if (baseCurrency === localCurrency) {
      setLogistics(prev => ({ ...prev, exchangeRate: 1 }));
      setRateSource('same');
      return;
    }

    // Never keep the previous currency's rate while the new one loads.
    const fallback = approximateRate(baseCurrency);
    setLogistics(prev => ({ ...prev, exchangeRate: fallback ?? 0 }));
    setRateSource(fallback ? 'approximate' : 'missing');

    setIsFetchingRate(true);
    try {
      const response = await fetch(apiUrl(`/api/exchange-rate/${baseCurrency}`));
      const data = await readApiJson(response);
      if (!response.ok || !data) throw new Error('Fetch failed');
      if (data.provider === 'local_database_fallback' || String(data.base_code || '').toUpperCase() !== baseCurrency.toUpperCase()) {
        throw new Error('Not a live rate');
      }
      const live = Number(data?.rates?.[localCurrency]);
      if (!(live > 0)) throw new Error('Rate missing');
      if (request !== rateRequest.current) return;
      setLogistics(prev => ({ ...prev, exchangeRate: live }));
      setRateSource('live');
    } catch (error) {
      if (request !== rateRequest.current) return;
      console.error("Error fetching rate:", error);
      toast.warning(fallback
        ? (isRtl ? 'تعذّر جلب السعر المباشر؛ يُستخدم سعر تقريبي. راجعه قبل الحفظ.' : 'Live rate unavailable; using an approximate rate. Check it before saving.')
        : (isRtl ? 'تعذّر جلب سعر الصرف. أدخله يدوياً.' : 'Could not load the exchange rate. Enter it manually.'));
    } finally {
      if (request === rateRequest.current) setIsFetchingRate(false);
    }
  };

  // Update exchange rate when currency changes
  const handleCurrencyChange = (curr: any) => {
    setSelectedCurrency(curr);
    setProduct(prev => ({ ...prev, currency: curr.id }));
    fetchExchangeRate(curr.id);
  };

  // Update logistics if defaults change
  useEffect(() => {
    setLogistics(prev => ({
      ...prev,
      customsDuty: defaultCustoms,
      vatRate: defaultVat
    }));
  }, [defaultVat, defaultCustoms]);

  // Fetch initial exchange rate
  useEffect(() => {
    fetchExchangeRate(selectedCurrency.id);
  }, [localCurrency]);

  // Calculation Logic
  const results: CalculationResults = useMemo(() => {
    const qty = Number(product.quantity) || 0;
    const unitC = Number(product.unitCost) || 0;
    const exRate = Number(logistics.exchangeRate) || 0;
    const shipCost = Number(logistics.shippingCost) || 0;
    const customsD = Number(logistics.customsDuty) || 0;
    const clearF = Number(logistics.clearanceFees) || 0;
    const inlandT = Number(logistics.inlandTransport) || 0;
    const insurC = Number(logistics.insuranceCost) || 0;
    const inspectF = Number(logistics.inspectionFees) || 0;
    const vRate = Number(logistics.vatRate) || 0;

    const totalFOBForeign = qty * unitC;
    const baseCostLocal = totalFOBForeign * exRate;
    
    // Shipping is often quoted in foreign currency (e.g. USD)
    const shippingLocal = shipCost * exRate;
    
    let customsLocal = 0;
    if (logistics.isDutyFixed) {
      customsLocal = customsD; // Now treated as local if fixed
    } else {
      customsLocal = baseCostLocal * (customsD / 100);
    }
    
    // These are explicitly "Local Fees" as per request
    const handlingLocal = clearF; 
    const transportLocal = inlandT;
    const insuranceLocal = insurC;
    const inspectionLocal = inspectF;
    
    const subtotalBeforeVAT = baseCostLocal + shippingLocal + customsLocal + handlingLocal + transportLocal + insuranceLocal + inspectionLocal;
    const vatLocal = subtotalBeforeVAT * (vRate / 100);
    
    const totalLanded = subtotalBeforeVAT + vatLocal;
    
    return {
      totalFOBCost: Number(baseCostLocal.toFixed(4)),
      totalLandedCost: Number(totalLanded.toFixed(4)),
      costPerUnit: qty > 0 ? Number((totalLanded / qty).toFixed(4)) : 0,
      breakdown: {
        baseCost: Number(baseCostLocal.toFixed(4)),
        shipping: Number(shippingLocal.toFixed(4)),
        customs: Number(customsLocal.toFixed(4)),
        fees: Number((handlingLocal + transportLocal + insuranceLocal + inspectionLocal).toFixed(4)),
        taxes: Number(vatLocal.toFixed(4)),
      }
    };
  }, [product, logistics]);

  const rateReady = selectedCurrency.id === localCurrency || Number(logistics.exchangeRate) > 0;

  const handleSendToInventory = async () => {
    if (!rateReady || isSaving) return;
    const status: StockStatus = computeStockStatus(product.quantity);
    const newId = crypto.randomUUID();

    const newInvProduct: Product = {
      id: newId,
      name: product.name || t.importedProduct,
      sku: sku || `SKU-${newId.slice(0, 8).toUpperCase()}`,
      category: category || t.importedCategory,
      brand: 'Imported',
      quantity: product.quantity,
      unitCost: results.costPerUnit,
      currency: localCurrency,
      sellingPrice: roundMoney(results.costPerUnit * 1.5, localCurrency), // 50% markup default
      status: status,
      dateAdded: Date.now()
    };

    setIsSaving(true);
    try {
      await onAddProduct(newInvProduct);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (error: any) {
      toast.error(error?.message || (isRtl ? 'تعذّر حفظ الصنف' : 'Could not save the product'));
    } finally {
      setIsSaving(false);
    }
  };

  const chartData = [
    { name: t.baseCost, value: results.breakdown.baseCost },
    { name: t.shipping, value: results.breakdown.shipping },
    { name: t.customs, value: results.breakdown.customs },
    { name: t.handling + ' & ' + t.transport, value: results.breakdown.fees },
    { name: t.taxes, value: results.breakdown.taxes },
  ];

  const formatCurrencyLocal = (val: number) => {
    return new Intl.NumberFormat(language === 'ar' ? (localCurrency === 'JOD' ? 'ar-JO' : 'ar-IL') : 'en-US', {
      style: 'currency',
      currency: localCurrency,
      minimumFractionDigits: 2,
    }).format(val);
  };

  const formatCurrencyForeign = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: product.currency,
    }).format(val);
  };

  return (
    <div className={`max-w-7xl mx-auto p-6 space-y-6 notranslate ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className={`fixed top-8 ${isRtl ? 'left-1/2 -translate-x-1/2' : 'right-8'} z-[100] flex items-center gap-3 bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-2xl border border-emerald-500`}
          >
            <CheckCircle2 size={24} />
            <span className="font-bold">{t.productAddedSuccess}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{t.landedCost}</h1>
          <p className="text-gray-500 mt-1">{t.calculatorSummary}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Input Form (Col 7) */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:col-span-7 space-y-6"
        >
          <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-6 premium-card">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Product Info */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.itemName}</label>
                <input
                  type="text"
                  value={product.name}
                  onChange={(e) => setProduct({ ...product, name: e.target.value })}
                  placeholder={t.placeholderItem} aria-label={t.placeholderItem}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.sku}</label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="SKU-XXXX" aria-label="SKU-XXXX"
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Currency Selection Tabs */}
              <div className="md:col-span-2 space-y-4">
                <label className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <DollarSign size={16} className="text-indigo-600" />
                  {t.currency}
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {CURRENCIES.map((curr) => (
                    <button
                      key={curr.id}
                      type="button"
                      onClick={() => handleCurrencyChange(curr)}
                      className={`relative flex flex-col items-center justify-center p-5 rounded-2xl border-2 transition-all group overflow-hidden ${
                        selectedCurrency.id === curr.id
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-900 dark:text-indigo-300 shadow-md ring-4 ring-indigo-50 dark:ring-indigo-900/10'
                          : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-indigo-200 dark:hover:border-indigo-500'
                      }`}
                    >
                      {selectedCurrency.id === curr.id && (
                        <div className="absolute top-2 right-2 bg-indigo-600 text-white rounded-full p-1 shadow-sm">
                          <Check size={12} strokeWidth={4} />
                        </div>
                      )}
                      <span className={`text-2xl font-bold mb-1 ${selectedCurrency.id === curr.id ? 'text-indigo-600' : 'text-gray-400 dark:text-gray-600 group-hover:text-indigo-400'}`}>
                        {curr.symbol}
                      </span>
                      <span className="text-sm font-bold whitespace-nowrap">
                        {t[curr.label as keyof typeof t]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Exchange Rate Input */}
              {selectedCurrency.id !== localCurrency && (
                <div className="md:col-span-2 space-y-3 bg-gray-50 dark:bg-gray-900/50 p-6 rounded-3xl border border-gray-100 dark:border-gray-700">
                  <label className="text-sm font-bold text-gray-700 dark:text-gray-300 block">
                    {t.exchangeRateFor}: <span className="font-mono text-indigo-600">1 {selectedCurrency.id} = ? {localCurrency}</span>
                    <span className="ms-2 text-xs font-medium text-gray-500">
                      {rateSource === 'live' && (isRtl ? '(سعر مباشر)' : '(live rate)')}
                      {rateSource === 'approximate' && (isRtl ? '(سعر تقريبي — راجعه)' : '(approximate — check it)')}
                      {rateSource === 'manual' && (isRtl ? '(أدخلته يدوياً)' : '(entered manually)')}
                      {rateSource === 'missing' && (isRtl ? '(غير متوفر — أدخله يدوياً)' : '(unavailable — enter it)')}
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={logistics.exchangeRate || ''}
                      onChange={(e) => { setLogistics({ ...logistics, exchangeRate: Number(e.target.value) }); setRateSource('manual'); }}
                      className="w-full px-5 py-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-xl font-bold shadow-sm dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => fetchExchangeRate(selectedCurrency.id)}
                      disabled={isFetchingRate}
                      title={isRtl ? 'تحديث سعر الصرف لتلك العملة' : 'Refresh live rate for this currency'} aria-label={isRtl ? 'تحديث سعر الصرف لتلك العملة' : 'Refresh live rate for this currency'}
                      className={`absolute inset-y-0 ${isRtl ? 'left-5' : 'right-5'} flex items-center text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 disabled:opacity-50 transition-all cursor-pointer`}
                    >
                      {isFetchingRate ? (
                        <div className="animate-spin text-indigo-600">
                          <Loader2 size={22} />
                        </div>
                      ) : (
                        <ArrowRightLeft size={22} />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="h-px bg-gray-50 dark:bg-gray-700" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* FOB Cost & Qty */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.baseCost} ({product.currency})</label>
                <input
                  type="number"
                  value={product.unitCost}
                  onChange={(e) => setProduct({ ...product, unitCost: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.quantity}</label>
                <input
                  type="number"
                  value={product.quantity}
                  onChange={(e) => setProduct({ ...product, quantity: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Freight & Customs */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.shippingCost} ({product.currency})</label>
                <input
                  type="number"
                  value={logistics.shippingCost}
                  onChange={(e) => setLogistics({ ...logistics, shippingCost: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.customsDuty} (%)</label>
                <input
                  type="number"
                  value={logistics.customsDuty}
                  onChange={(e) => setLogistics({ ...logistics, customsDuty: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono dark:text-white"
                />
              </div>
            </div>

            <div className="h-px bg-gray-50 dark:bg-gray-700" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Local Fees */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.clearanceFees} ({localCurrency})</label>
                <input
                  type="number"
                  value={logistics.clearanceFees}
                  onChange={(e) => setLogistics({ ...logistics, clearanceFees: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.inlandTransport} ({localCurrency})</label>
                <input
                  type="number"
                  value={logistics.inlandTransport}
                  onChange={(e) => setLogistics({ ...logistics, inlandTransport: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Optional Insurance & Inspection */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.insuranceCost} ({localCurrency})</label>
                <input
                  type="number"
                  value={logistics.insuranceCost !== undefined && !isNaN(logistics.insuranceCost) ? logistics.insuranceCost : ''}
                  onChange={(e) => setLogistics({ ...logistics, insuranceCost: e.target.value === '' ? undefined : Number(e.target.value) })}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.inspectionFees} ({localCurrency})</label>
                <input
                  type="number"
                  value={logistics.inspectionFees !== undefined && !isNaN(logistics.inspectionFees) ? logistics.inspectionFees : ''}
                  onChange={(e) => setLogistics({ ...logistics, inspectionFees: e.target.value === '' ? undefined : Number(e.target.value) })}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.vat} (%)</label>
              <input
                type="number"
                value={logistics.vatRate}
                onChange={(e) => setLogistics({ ...logistics, vatRate: Number(e.target.value) })}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono dark:text-white"
              />
            </div>
          </div>
        </motion.div>

        {/* Right Side: Results (Col 5) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="grid grid-cols-1 gap-4">
            {/* Total FOB Card */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
              className="bg-indigo-600 p-6 rounded-3xl text-white shadow-xl shadow-indigo-100 dark:shadow-indigo-900/30"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="p-2 bg-indigo-500/50 rounded-lg">
                  <DollarSign size={20} />
                </div>
                <span className="text-indigo-100 text-xs font-mono">{product.currency} {formatCurrencyForeign(product.unitCost * product.quantity)}</span>
              </div>
              <p className="text-indigo-100 text-sm font-medium">{t.totalFOB}</p>
              <h3 className="text-3xl font-bold font-mono mt-1">{formatCurrencyLocal(results.totalFOBCost)}</h3>
            </motion.div>

            {/* Total Landed Card */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
              className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-xl shadow-gray-50 dark:shadow-black/20"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                  <ShieldCheck size={20} />
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-emerald-600 dark:text-emerald-400 text-xs font-bold">{t.safeArrival}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-[10px] uppercase font-bold tracking-widest">{t.totalLanded}</span>
                </div>
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">{t.totalLanded}</p>
              <h3 className="text-4xl font-bold text-gray-900 dark:text-white font-mono mt-1">{formatCurrencyLocal(results.totalLandedCost)}</h3>
            </motion.div>

            {/* Cost Per Unit Card */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
              className="bg-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-emerald-100 dark:shadow-emerald-900/30"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="p-2 bg-emerald-500/50 rounded-lg">
                  <ArrowRightLeft size={20} />
                </div>
                <span className="text-emerald-100 text-xs">{t.basedOn} {product.quantity} {product.quantity === 1 ? t.unitSingular : t.unitsPlural}</span>
              </div>
              <p className="text-emerald-100 text-sm font-medium">{t.costPerUnit}</p>
              <h3 className="text-3xl font-bold font-mono mt-1">{formatCurrencyLocal(results.costPerUnit)}</h3>
            </motion.div>
          </div>

          <motion.button 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSendToInventory}
            disabled={!product.name || !rateReady || isSaving}
            className="w-full flex items-center justify-center gap-3 px-6 py-5 bg-white dark:bg-gray-800 border-2 border-indigo-600 text-indigo-700 dark:text-indigo-400 rounded-3xl font-bold text-lg hover:bg-indigo-600 hover:text-white transition-all shadow-lg shadow-indigo-50 dark:shadow-indigo-900/10 disabled:opacity-50 disabled:cursor-not-allowed group premium-button"
          >
            <TrendingUp className="group-hover:translate-y-[-2px] transition-transform" />
            {t.sendToInventory}
          </motion.button>

          {/* Mini Breakdown Chart */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm premium-card"
          >
            <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-4">{t.breakdown} (%)</h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    innerRadius={50}
                    outerRadius={65}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {chartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
