import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Package, Store, Warehouse as WarehouseIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AppSettings, Currency, Language, Product, Warehouse } from '../types';
import { CurrencySelect } from './CurrencyPicker';
import { ONBOARDING_VAT_OPTIONS } from '../lib/onboarding';
import { computeStockStatus } from '../lib/stock';
import { sounds } from '../lib/sounds';

interface Props {
  settings: AppSettings;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  onCurrencyPrefer: (code: Currency) => void;
  saveSettings: (settings: AppSettings) => Promise<void>;
  saveWarehouse: (warehouse: Warehouse) => Promise<void>;
  saveProduct: (product: Product, options?: { reason?: string }) => Promise<void>;
  onFinished: (goToPos: boolean) => void;
}

type Step = 0 | 1 | 2;

const inputClass =
  'mt-1.5 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm font-semibold text-slate-900 dark:text-white outline-none focus:border-slate-400 dark:focus:border-white/30';

export default function OnboardingWizard({
  settings,
  language,
  onLanguageChange,
  onCurrencyPrefer,
  saveSettings,
  saveWarehouse,
  saveProduct,
  onFinished,
}: Props) {
  const isRtl = language === 'ar';
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);

  const [businessName, setBusinessName] = useState(
    settings.businessName === 'مستودعي' || !settings.businessName.trim() ? '' : settings.businessName,
  );
  const [currency, setCurrency] = useState<Currency>(settings.currency || 'JOD');
  const [vatRate, setVatRate] = useState(Number.isFinite(settings.defaultVatRate) ? settings.defaultVatRate : 16);
  const [lang, setLang] = useState<Language>(settings.defaultLanguage || language);

  const [warehouseName, setWarehouseName] = useState(L('المستودع الرئيسي', 'Main warehouse'));
  const [warehouseId, setWarehouseId] = useState<string | null>(null);

  const [productName, setProductName] = useState('');
  const [productQty, setProductQty] = useState('10');
  const [productCost, setProductCost] = useState('');
  const [productSell, setProductSell] = useState('');

  const steps = [
    { title: L('متجرك', 'Your store'), icon: Store },
    { title: L('المستودع', 'Warehouse'), icon: WarehouseIcon },
    { title: L('أول صنف', 'First item'), icon: Package },
  ];

  const markComplete = async (extra: Partial<AppSettings> = {}) => {
    await saveSettings({
      ...settings,
      ...extra,
      businessName: (extra.businessName ?? businessName.trim()) || settings.businessName || L('متجري', 'My store'),
      currency: (extra.currency as Currency) || currency,
      defaultVatRate: extra.defaultVatRate ?? vatRate,
      defaultLanguage: (extra.defaultLanguage as Language) || lang,
      onboardingCompletedAt: Date.now(),
    });
  };

  /** A finished store always has at least one warehouse — never mark onboarding done without one. */
  const ensureWarehouse = async (): Promise<string> => {
    if (warehouseId) return warehouseId;
    const id = `WH_${crypto.randomUUID()}`;
    await saveWarehouse({
      id,
      name: warehouseName.trim() || L('المستودع الرئيسي', 'Main warehouse'),
      location: '',
      parentId: null,
      createdAt: Date.now(),
    });
    setWarehouseId(id);
    return id;
  };

  const finish = async (goToPos: boolean) => {
    setBusy(true);
    try {
      await ensureWarehouse();
      await markComplete();
      sounds.playSuccess?.();
      toast.success(L('متجرك جاهز. يمكنك البيع الآن.', 'Your store is ready. You can sell now.'));
      onFinished(goToPos);
    } catch (err: any) {
      if (!err?.notified) toast.error(L('تعذّر حفظ الإعداد. حاول مرة أخرى.', 'Could not save setup. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const saveStoreStep = async () => {
    const name = businessName.trim();
    if (!name) {
      toast.error(L('أدخل اسم المتجر.', 'Enter the store name.'));
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      toast.error(L('نسبة الضريبة غير صالحة.', 'VAT rate is invalid.'));
      return;
    }
    setBusy(true);
    try {
      await saveSettings({
        ...settings,
        businessName: name,
        currency,
        defaultVatRate: vatRate,
        defaultLanguage: lang,
      });
      onLanguageChange(lang);
      onCurrencyPrefer(currency);
      sounds.playClick?.();
      setStep(1);
    } catch (err: any) {
      if (!err?.notified) toast.error(L('تعذّر حفظ بيانات المتجر.', 'Could not save store details.'));
    } finally {
      setBusy(false);
    }
  };

  const saveWarehouseStep = async () => {
    const name = warehouseName.trim();
    if (!name) {
      toast.error(L('أدخل اسم المستودع.', 'Enter the warehouse name.'));
      return;
    }
    setBusy(true);
    try {
      const id = `WH_${crypto.randomUUID()}`;
      await saveWarehouse({
        id,
        name,
        location: '',
        parentId: null,
        createdAt: Date.now(),
      });
      setWarehouseId(id);
      sounds.playClick?.();
      setStep(2);
    } catch (err: any) {
      if (!err?.notified) toast.error(L('تعذّر إنشاء المستودع.', 'Could not create the warehouse.'));
    } finally {
      setBusy(false);
    }
  };

  const saveProductStep = async () => {
    const name = productName.trim();
    if (!name) {
      toast.error(L('أدخل اسم الصنف، أو تخطَّ هذه الخطوة.', 'Enter an item name, or skip this step.'));
      return;
    }
    const qty = Number(productQty);
    const cost = Number(productCost);
    const sell = Number(productSell);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error(L('الكمية غير صالحة.', 'Quantity is invalid.'));
      return;
    }
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(sell) || sell < 0) {
      toast.error(L('أدخل تكلفة وسعر بيع صحيحين (صفر أو أكثر).', 'Enter valid cost and sell prices (zero or more).'));
      return;
    }
    setBusy(true);
    try {
      const whId = await ensureWarehouse();
      const id = crypto.randomUUID();
      const sku = `SKU-${id.slice(0, 8).toUpperCase()}`;
      await saveProduct(
        {
          id,
          name,
          sku,
          category: L('عام', 'General'),
          brand: '',
          quantity: qty,
          unitCost: cost,
          sellingPrice: sell,
          currency,
          status: computeStockStatus(qty, 5, settings.lowStockThreshold),
          lowStockThreshold: 5,
          dateAdded: Date.now(),
          warehouseId: whId,
        },
        { reason: L('رصيد افتتاحي', 'Opening stock') },
      );
      await markComplete();
      sounds.playSuccess?.();
      toast.success(L('متجرك جاهز. يمكنك البيع الآن.', 'Your store is ready. You can sell now.'));
      onFinished(true);
    } catch (err: any) {
      if (!err?.notified) toast.error(L('تعذّر حفظ الصنف.', 'Could not save the item.'));
    } finally {
      setBusy(false);
    }
  };

  /** Skip the optional first product only — warehouse must already exist (step 1). */
  const skipProductAndEnter = async () => {
    if (!warehouseId) {
      toast.error(L('أنشئ المستودع أولاً قبل الدخول.', 'Create the warehouse before entering.'));
      return;
    }
    sounds.playClick?.();
    await finish(false);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center bg-slate-950/55 p-0 sm:p-4"
      dir={isRtl ? 'rtl' : 'ltr'}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="w-full sm:max-w-lg max-h-[94dvh] flex flex-col bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10"
      >
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 dark:border-white/10 shrink-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {L(`الخطوة ${step + 1} من 3`, `Step ${step + 1} of 3`)}
          </p>
          <h2 id="onboarding-title" className="mt-1 text-xl font-black text-slate-900 dark:text-white">
            {L('إعداد متجرك', 'Set up your store')}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {L('دقائق قليلة ثم تكون جاهزاً للبيع.', 'A few minutes, then you are ready to sell.')}
          </p>
          <div className="mt-4 flex gap-2">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const active = i === step;
              const done = i < step;
              return (
                <div
                  key={s.title}
                  className={`flex-1 flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-bold ${
                    active
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : done
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
                        : 'bg-slate-50 text-slate-400 dark:bg-white/5'
                  }`}
                >
                  {done ? <Check size={14} /> : <Icon size={14} />}
                  <span className="truncate">{s.title}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {step === 0 && (
            <>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">{L('اسم المتجر', 'Store name')}</span>
                <input
                  autoFocus
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  maxLength={80}
                  placeholder={L('مثال: بقالة الحي', 'e.g. Neighborhood grocery')}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">{L('عملة البيع الأساسية', 'Primary sales currency')}</span>
                <CurrencySelect
                  value={currency}
                  onChange={(code) => setCurrency(code)}
                  isRtl={isRtl}
                  className="mt-1.5 w-full"
                  aria-label={L('العملة', 'Currency')}
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">{L('نسبة الضريبة الافتراضية', 'Default VAT rate')}</span>
                <select
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  className={inputClass}
                >
                  {ONBOARDING_VAT_OPTIONS.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}%
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className="text-xs font-bold text-slate-500">{L('لغة الواجهة', 'Interface language')}</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {([
                    { code: 'ar' as const, label: 'العربية' },
                    { code: 'en' as const, label: 'English' },
                  ]).map((opt) => (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => setLang(opt.code)}
                      className={`rounded-xl px-3 py-2.5 text-sm font-bold border cursor-pointer ${
                        lang === opt.code
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {L('مكان تخزين البضاعة. يمكنك إضافة مستودعات أخرى لاحقاً.', 'Where stock is kept. You can add more warehouses later.')}
              </p>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">{L('اسم المستودع', 'Warehouse name')}</span>
                <input
                  autoFocus
                  value={warehouseName}
                  onChange={(e) => setWarehouseName(e.target.value)}
                  maxLength={80}
                  className={inputClass}
                />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {L('أضف صنفاً واحداً للتجربة، أو تخطَّ وأضفه لاحقاً من المخزون.', 'Add one sample item, or skip and add items later from Inventory.')}
              </p>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">{L('اسم الصنف', 'Item name')}</span>
                <input
                  autoFocus
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  maxLength={120}
                  placeholder={L('مثال: ماء 1 لتر', 'e.g. Water 1L')}
                  className={inputClass}
                />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-bold text-slate-500">{L('الكمية', 'Qty')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={productQty}
                    onChange={(e) => setProductQty(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-500">{L('التكلفة', 'Cost')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={productCost}
                    onChange={(e) => setProductCost(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-500">{L('البيع', 'Sell')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={productSell}
                    onChange={(e) => setProductSell(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 dark:border-white/10 flex flex-wrap items-center gap-2 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {step > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="inline-flex items-center gap-1 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer disabled:opacity-50"
            >
              {isRtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              {L('رجوع', 'Back')}
            </button>
          )}
          <div className="flex-1" />
          {step === 2 ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={skipProductAndEnter}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer disabled:opacity-50"
              >
                {L('تخطي الصنف والدخول', 'Skip item & enter')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={saveProductStep}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black cursor-pointer disabled:opacity-50"
              >
                {L('حفظ وبدء البيع', 'Save & start selling')}
                {isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={step === 0 ? saveStoreStep : saveWarehouseStep}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black cursor-pointer disabled:opacity-50"
            >
              {L('متابعة', 'Continue')}
              {isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
