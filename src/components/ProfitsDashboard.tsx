import React, { useMemo, useState } from 'react';
import {
  TrendingUp,
  DollarSign,
  Activity,
  Layers,
  Database,
  Crown,
  AlertTriangle,
  FolderOpen,
  RefreshCw,
  Printer,
  FileCheck,
  X,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import { CurrencySelect } from './CurrencyPicker';
import type { Invoice, Product } from '../types';
import { buildUsdUnitRates, convertAmount, formatMoney, isPosCurrency, readCachedLiveRates, roundMoney } from '../lib/exchangeRates';
import { saleLineProfits, summarizeProfits } from '../lib/profits';
import {
  buildProfitCsv,
  buildProfitReportHtml,
  profitRows,
  profitSeries,
  profitsByCurrency,
  rangeStart,
  seriesStep,
  type ProfitRange,
  type ProfitReportProduct,
} from '../lib/profitReport';
import { printHtmlDocument } from '../lib/printHtml';
import { localIsoDate } from '../lib/localDate';
import { roundQty } from '../lib/stock';
import { lineUnits } from '../lib/packs';

interface ProfitsDashboardProps {
  language?: 'ar' | 'en';
  currency?: string;
  onClose?: () => void;
}

const PAGE_SIZE = 50;

export default function ProfitsDashboard({ language = 'en', currency = 'JOD', onClose }: ProfitsDashboardProps) {
  const { invoices = [], products = [], loading, settings } = useFirebase();
  const isAr = language === 'ar';
  const locale = isAr ? 'ar' : 'en-US';
  const L = (ar: string, en: string) => (isAr ? ar : en);

  const [timeRange, setTimeRange] = useState<ProfitRange>('monthly');
  const [selectedCurrency, setSelectedCurrency] = useState<string>(isPosCurrency(currency) ? currency : 'JOD');
  const [visibleRows, setVisibleRows] = useState(PAGE_SIZE);

  const defaultCurrency = settings?.currency || 'JOD';
  const exchangeRates = useMemo(() => buildUsdUnitRates(settings, readCachedLiveRates()), [settings]);
  const productsById = useMemo(() => new Map((products || []).map((p: Product) => [p.id, p])), [products]);
  const toDisplay = (amount: number, from: string) => convertAmount(amount, from, selectedCurrency, exchangeRates);
  const showMoney = (amount: number, code: string) => formatMoney(amount, code, locale);

  const rangeLabels: Record<ProfitRange, string> = {
    today: L('اليوم', 'Today'),
    weekly: L('آخر 7 أيام', 'Last 7 days'),
    monthly: L('هذا الشهر', 'This month'),
    all: L('كل السجلات', 'All history'),
  };

  const allRows = useMemo(
    () => profitRows(invoices || [], productsById, exchangeRates, defaultCurrency),
    [invoices, productsById, exchangeRates, defaultCurrency],
  );

  const { rows, start, now } = useMemo(() => {
    const at = Date.now();
    const from = rangeStart(timeRange, at, allRows);
    return {
      rows: allRows.filter((r) => r.date >= from).sort((a, b) => b.date - a.date),
      start: from,
      now: at,
    };
  }, [allRows, timeRange]);

  const periodInvoices = useMemo(() => {
    const ids = new Set(rows.map((r) => r.id));
    return (invoices || []).filter((inv: Invoice) => ids.has(inv.id));
  }, [rows, invoices]);

  const totals = useMemo(() => {
    const sum = summarizeProfits(periodInvoices, products || [], exchangeRates, selectedCurrency, defaultCurrency);
    return { sales: sum.revenue, cost: sum.cost, net: sum.profit, margin: sum.margin, unknownCostLines: sum.unknownCostLines, purchases: sum.purchases };
  }, [periodInvoices, products, exchangeRates, selectedCurrency, defaultCurrency]);

  const byCurrency = useMemo(() => profitsByCurrency(rows), [rows]);
  const converted = rows.some((r) => r.currency !== selectedCurrency);

  const productProfitability = useMemo(() => {
    const aggregates = new Map<string, ProfitReportProduct>();
    for (const inv of periodInvoices) {
      if (inv.type !== 'sale' && inv.type !== 'return') continue;
      const sign = inv.type === 'return' ? -1 : 1;
      const invCurrency = inv.currency || defaultCurrency;
      for (const { item, revenue, cost } of saleLineProfits(inv, productsById, exchangeRates, defaultCurrency)) {
        const product = productsById.get(item.productId);
        const name = product?.name || item.description || L('صنف محذوف', 'Deleted product');
        const key = product ? product.id : `name:${name}`;
        const entry = aggregates.get(key) || { name, qty: 0, revenue: 0, profit: 0, unknownCost: false };
        const rev = sign * convertAmount(revenue, invCurrency, selectedCurrency, exchangeRates);
        const cst = sign * convertAmount(cost ?? 0, invCurrency, selectedCurrency, exchangeRates);
        entry.qty = roundQty(entry.qty + sign * lineUnits(item));
        entry.revenue += rev;
        entry.profit += rev - cst;
        if (cost === null) entry.unknownCost = true;
        aggregates.set(key, entry);
      }
    }
    const list = [...aggregates.values()].sort((a, b) => b.profit - a.profit);
    const best = list[0] && list[0].profit > 0 ? list[0] : null;
    const weakest = list.length > 1 ? list[list.length - 1] : null;
    return { best, weakest, list };
  }, [periodInvoices, productsById, exchangeRates, selectedCurrency, defaultCurrency, isAr]);

  const step = seriesStep(timeRange, start, now);
  const chartData = useMemo(() => {
    if (!rows.some((r) => r.type === 'sale')) return [];
    return profitSeries(rows, start, now, step, toDisplay).map((p) => {
      const d = new Date(p.start);
      const label = step === 'hour'
        ? `${String(d.getHours()).padStart(2, '0')}:00`
        : step === 'day'
          ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
          : d.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
      return { label, profit: roundMoney(p.profit, selectedCurrency) };
    });
  }, [rows, start, now, step, selectedCurrency, exchangeRates, locale]);
  const stepLabel = step === 'hour' ? L('حسب الساعة', 'Hourly') : step === 'day' ? L('يومياً', 'Daily') : L('شهرياً', 'Monthly');

  const formatDate = (time: number) =>
    new Date(time).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const handleExportCSV = () => {
    if (rows.length === 0) {
      toast.error(L('لا توجد معاملات في هذه الفترة للتصدير.', 'No transactions in this period to export.'));
      return;
    }
    const summary: Array<[string, string]> = [
      [L('تقرير الأرباح', 'Profit report'), rangeLabels[timeRange]],
      [L('عملة الإجمالي', 'Totals currency'), selectedCurrency],
      [L('صافي المبيعات (بدون ضريبة)', 'Net sales (excl. VAT)'), showMoney(totals.sales, selectedCurrency)],
      [L('تكلفة البضاعة المباعة', 'Cost of goods sold'), showMoney(totals.cost, selectedCurrency)],
      [L('مجمل الربح (قبل المصاريف)', 'Gross profit (before expenses)'), `${showMoney(totals.net, selectedCurrency)} (${totals.margin.toFixed(1)}%)`],
    ];
    if (converted) {
      summary.push([L('ملاحظة', 'Note'), L('الإجمالي محوَّل بسعر صرف اليوم؛ كل فاتورة في الجدول بعملتها.', 'Totals are converted at today\'s rate; each invoice below is in its own currency.')]);
    }
    const blob = new Blob([buildProfitCsv(rows, { isAr, summary })], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `profits-${localIsoDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(L('صُدّر ملف CSV.', 'CSV exported.'));
  };

  const handlePrint = () => {
    if (rows.length === 0) {
      toast.error(L('لا توجد معاملات في هذه الفترة للطباعة.', 'No transactions in this period to print.'));
      return;
    }
    const ok = printHtmlDocument(buildProfitReportHtml({
      isAr,
      businessName: settings?.businessName || '',
      periodLabel: rangeLabels[timeRange],
      displayCurrency: selectedCurrency,
      totals,
      byCurrency,
      converted,
      products: productProfitability.list,
      rows,
      money: showMoney,
      formatDate,
    }), L('تقرير الأرباح', 'Profit report'));
    if (!ok) toast.error(L('تعذّر فتح نافذة الطباعة.', 'Could not open the print dialog.'));
  };

  const shownRows = rows.slice(0, visibleRows);

  return (
    <div className="p-4 sm:p-6 md:p-8" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 shadow-xl overflow-hidden text-slate-800 dark:text-gray-100">

        <div className="bg-slate-900 text-white px-5 sm:px-6 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-blue-600 rounded-lg shrink-0">
              <TrendingUp className="w-5 h-5 text-cyan-100" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight">{L('الأرباح', 'Profits')}</h1>
              <p className="text-xs text-slate-400">{L('المبيعات والتكلفة ومجمل الربح للفترة المحددة', 'Sales, cost and gross profit for the selected period')}</p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg shrink-0"
              aria-label={L('إغلاق', 'Close')}
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        <div className="p-4 sm:p-6 bg-slate-50 dark:bg-gray-900/40 border-b border-slate-100 dark:border-gray-700 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="grid grid-cols-4 gap-1 bg-white dark:bg-gray-800 p-1 rounded-xl border border-slate-200 dark:border-gray-700 w-full lg:w-auto" role="tablist" aria-label={L('الفترة', 'Period')}>
            {(Object.keys(rangeLabels) as ProfitRange[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={timeRange === key}
                onClick={() => { setTimeRange(key); setVisibleRows(PAGE_SIZE); }}
                className={`px-2 sm:px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg whitespace-nowrap transition-colors ${
                  timeRange === key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700'
                }`}
              >
                {rangeLabels[key]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="profits-currency" className="text-xs font-semibold text-slate-500 dark:text-gray-400">
              {L('عملة الإجمالي', 'Totals in')}
            </label>
            <CurrencySelect
              id="profits-currency"
              value={selectedCurrency}
              onChange={setSelectedCurrency}
              isRtl={isAr}
              className="w-44"
            />
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handlePrint}
                className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Printer className="w-4 h-4" />
                {L('طباعة / PDF', 'Print / PDF')}
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="flex-1 sm:flex-none px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <FileCheck className="w-4 h-4" />
                {L('تصدير CSV', 'Export CSV')}
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-4" />
              <p className="text-sm font-medium text-slate-500">{L('جارٍ تحميل السجلات...', 'Loading records...')}</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 dark:bg-gray-900/40 rounded-xl border border-dashed border-slate-200 dark:border-gray-700 p-8">
              <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-base font-bold text-slate-700 dark:text-gray-200">{L('لا توجد مبيعات أو مشتريات في هذه الفترة', 'No sales or purchases in this period')}</h3>
              <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto">
                {L('اختر فترة أخرى، أو سجّل عملية بيع من نقطة البيع.', 'Pick another period, or record a sale from the POS.')}
              </p>
            </div>
          ) : (
            <>
              {(totals.unknownCostLines > 0 || converted || totals.purchases > 0) && (
                <div className="space-y-2">
                  {totals.unknownCostLines > 0 && (
                    <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                      {L(
                        `${totals.unknownCostLines} سطر مبيع بلا سعر تكلفة مسجّل، فحُسبت تكلفته صفراً والربح المعروض أعلى من الحقيقي (معلّم بـ *). أضف سعر التكلفة للأصناف من شاشة المخزون.`,
                        `${totals.unknownCostLines} sold line(s) have no cost recorded, so they count as zero cost and profit is overstated (marked *). Add unit costs in Inventory.`,
                      )}
                    </p>
                  )}
                  {converted && (
                    <p className="text-xs text-slate-600 dark:text-gray-300 bg-slate-50 dark:bg-gray-900/40 border border-slate-200 dark:border-gray-700 rounded-lg px-4 py-2.5">
                      {L(
                        `الإجمالي محوَّل إلى ${selectedCurrency} بسعر صرف اليوم. المبالغ الأصلية لكل عملة في جدول "حسب العملة"، وكل فاتورة في السجل بعملتها.`,
                        `Totals are converted to ${selectedCurrency} at today's rate. Original amounts are in "By currency", and each invoice below is in its own currency.`,
                      )}
                    </p>
                  )}
                  {totals.purchases > 0 && (
                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      {L('مشتريات الفترة (لا تُخصم من الربح لأنها تدخل المخزون):', 'Purchases in this period (not deducted from profit; they go into stock):')}{' '}
                      <span className="font-bold text-slate-700 dark:text-gray-200">{showMoney(totals.purchases, selectedCurrency)}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-200 dark:border-gray-700 p-5 flex items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block">{L('صافي المبيعات', 'Net sales')}</span>
                    <p className="text-2xl font-black text-slate-900 dark:text-white">{showMoney(totals.sales, selectedCurrency)}</p>
                    <p className="text-xs text-slate-400">{L('بعد الخصم وبدون ضريبة القيمة المضافة', 'After discount, excluding VAT')}</p>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 rounded-lg shrink-0"><DollarSign className="w-5 h-5" /></div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-gray-700 p-5 flex items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block">{L('تكلفة البضاعة المباعة', 'Cost of goods sold')}</span>
                    <p className="text-2xl font-black text-slate-900 dark:text-white">{showMoney(totals.cost, selectedCurrency)}</p>
                    <p className="text-xs text-slate-400">{L('بسعر تكلفة الأصناف وقت البيع', 'At each item\'s cost when sold')}</p>
                  </div>
                  <div className="p-3 bg-rose-50 dark:bg-rose-900/30 text-rose-600 rounded-lg shrink-0"><Layers className="w-5 h-5" /></div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-gray-700 p-5 flex items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block">{L('مجمل الربح', 'Gross profit')}</span>
                    <p className={`text-2xl font-black ${totals.net < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{showMoney(totals.net, selectedCurrency)}</p>
                    <p className="text-xs text-slate-400">
                      <span className={`font-bold ${totals.net < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{L('الهامش', 'Margin')} {totals.margin.toFixed(1)}%</span>
                      {' · '}{L('قبل المصاريف والرواتب', 'before expenses and payroll')}
                    </p>
                  </div>
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 rounded-lg shrink-0"><Activity className="w-5 h-5" /></div>
                </div>
              </div>

              {converted && byCurrency.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-gray-700 overflow-hidden">
                  <h3 className="px-5 py-3 text-sm font-bold bg-slate-50 dark:bg-gray-900/40 border-b border-slate-100 dark:border-gray-700">
                    {L('حسب العملة (بدون تحويل)', 'By currency (not converted)')}
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-start">
                      <thead className="text-xs text-slate-500 dark:text-gray-400">
                        <tr className="border-b border-slate-100 dark:border-gray-700">
                          <th className="py-2.5 px-5 text-start font-semibold">{L('العملة', 'Currency')}</th>
                          <th className="py-2.5 px-5 text-start font-semibold">{L('صافي المبيعات', 'Net sales')}</th>
                          <th className="py-2.5 px-5 text-start font-semibold">{L('التكلفة', 'Cost')}</th>
                          <th className="py-2.5 px-5 text-start font-semibold">{L('مجمل الربح', 'Gross profit')}</th>
                          <th className="py-2.5 px-5 text-start font-semibold">{L('الهامش', 'Margin')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byCurrency.map((c) => (
                          <tr key={c.currency} className="border-b last:border-0 border-slate-100 dark:border-gray-700">
                            <td className="py-2.5 px-5 font-bold">{c.currency}</td>
                            <td className="py-2.5 px-5 whitespace-nowrap">{showMoney(c.revenue, c.currency)}</td>
                            <td className="py-2.5 px-5 whitespace-nowrap">{showMoney(c.cost, c.currency)}</td>
                            <td className={`py-2.5 px-5 whitespace-nowrap font-bold ${c.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {showMoney(c.profit, c.currency)}{c.unknownCostLines > 0 ? ' *' : ''}
                            </td>
                            <td className="py-2.5 px-5">{c.margin.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-gray-700 p-5">
                  <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-gray-700 mb-5">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-blue-600" />
                      <h3 className="text-sm font-bold">{L('مجمل الربح عبر الفترة', 'Gross profit over the period')}</h3>
                    </div>
                    <span className="text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full whitespace-nowrap">
                      {stepLabel} · {selectedCurrency}
                    </span>
                  </div>
                  <div className="h-64 w-full" dir="ltr">
                    {chartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} tickLine={false} minTickGap={16} />
                          <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} width={56} />
                          <Tooltip
                            formatter={(value: number) => [showMoney(Number(value), selectedCurrency), L('مجمل الربح', 'Gross profit')]}
                            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 11 }}
                          />
                          <Area type="monotone" dataKey="profit" stroke="#2563eb" strokeWidth={2} fill="url(#profitFill)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                        {L('لا مبيعات في هذه الفترة لرسمها.', 'No sales in this period to chart.')}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-gray-700 p-5 space-y-4">
                  <div className="pb-3 border-b border-slate-100 dark:border-gray-700 flex items-center gap-2">
                    <Crown className="w-5 h-5 text-amber-500" />
                    <h3 className="text-sm font-bold">{L('ربحية الأصناف', 'Product profitability')}</h3>
                  </div>

                  <div className="bg-emerald-50/60 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl p-4 space-y-1">
                    <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">{L('الأعلى ربحاً', 'Most profitable')}</span>
                    {productProfitability.best ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-sm truncate">{productProfitability.best.name}</span>
                        <span className="text-sm font-black text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                          {showMoney(productProfitability.best.profit, selectedCurrency)}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">{L('لا صنف حقق ربحاً في هذه الفترة.', 'No product made a profit in this period.')}</p>
                    )}
                  </div>

                  <div className="bg-orange-50/60 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/40 rounded-xl p-4 space-y-1">
                    <span className="text-xs font-bold text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {L('الأقل ربحاً', 'Least profitable')}
                    </span>
                    {productProfitability.weakest ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-sm truncate">{productProfitability.weakest.name}</span>
                        <span className={`text-sm font-black whitespace-nowrap ${productProfitability.weakest.profit < 0 ? 'text-rose-600' : 'text-orange-700 dark:text-orange-300'}`}>
                          {showMoney(productProfitability.weakest.profit, selectedCurrency)}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">{L('يظهر عند بيع صنفين أو أكثر.', 'Shown once two or more products are sold.')}</p>
                    )}
                  </div>

                  {productProfitability.list.length > 0 && (
                    <div>
                      <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block pb-2">
                        {L('ترتيب الأصناف حسب مجمل الربح', 'Products by gross profit')}
                      </span>
                      <ol className="space-y-1 max-h-48 overflow-y-auto">
                        {productProfitability.list.map((item, idx) => (
                          <li key={`${item.name}-${idx}`} className="flex items-center justify-between gap-3 text-xs py-1 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-gray-700/50">
                            <span className="truncate">{idx + 1}. {item.name}</span>
                            <span
                              className={`font-bold whitespace-nowrap ${item.unknownCost ? 'text-amber-600' : item.profit < 0 ? 'text-rose-600' : ''}`}
                              title={item.unknownCost ? L('بعض المبيعات بلا سعر تكلفة، فالربح أعلى من الحقيقي', 'Some sales have no cost recorded; profit is overstated') : undefined}
                            >
                              {showMoney(item.profit, selectedCurrency)}{item.unknownCost ? ' *' : ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-4 bg-slate-50 dark:bg-gray-900/40 border-b border-slate-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-slate-500" />
                    <h3 className="text-sm font-bold">{L('سجل الفواتير', 'Invoices')}</h3>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-gray-400">
                    {L(`${rows.length} فاتورة · كل مبلغ بعملة فاتورته`, `${rows.length} invoices · each amount in its invoice currency`)}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100/80 dark:bg-gray-900/60 border-b border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400">
                        <th className="py-3 px-4 text-start font-semibold">{L('التاريخ', 'Date')}</th>
                        <th className="py-3 px-4 text-start font-semibold">{L('رقم الفاتورة', 'Invoice')}</th>
                        <th className="py-3 px-4 text-start font-semibold">{L('العميل / المورد', 'Customer / supplier')}</th>
                        <th className="py-3 px-4 text-center font-semibold">{L('النوع', 'Type')}</th>
                        <th className="py-3 px-4 text-end font-semibold">{L('صافي البيع / قيمة الشراء', 'Net sale / purchase')}</th>
                        <th className="py-3 px-4 text-end font-semibold">{L('التكلفة', 'Cost')}</th>
                        <th className="py-3 px-4 text-end font-semibold">{L('مجمل الربح', 'Gross profit')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                      {shownRows.map((row) => {
                        const sale = row.type !== 'purchase';
                        return (
                          <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-gray-700/40">
                            <td className="py-3 px-4 text-slate-600 dark:text-gray-300 whitespace-nowrap">{formatDate(row.date)}</td>
                            <td className="py-3 px-4 font-bold whitespace-nowrap" dir="ltr">{row.invoiceNumber}</td>
                            <td className="py-3 px-4 text-slate-700 dark:text-gray-200">
                              {row.party || (sale ? L('زبون نقدي', 'Walk-in customer') : '—')}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${row.type === 'sale' ? 'bg-emerald-100 text-emerald-800' : row.type === 'return' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                                {row.type === 'sale' ? L('بيع', 'Sale') : row.type === 'return' ? L('مرتجع', 'Return') : L('شراء', 'Purchase')}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-end font-bold whitespace-nowrap">{showMoney(row.amount, row.currency)}</td>
                            <td
                              className={`py-3 px-4 text-end whitespace-nowrap ${row.unknownCostLines > 0 ? 'text-amber-600 font-semibold' : 'text-slate-500 dark:text-gray-400'}`}
                              title={row.unknownCostLines > 0 ? L(`${row.unknownCostLines} سطر بلا سعر تكلفة، فالربح أعلى من الحقيقي`, `${row.unknownCostLines} line(s) without cost; profit overstated`) : undefined}
                            >
                              {row.cost === null ? '—' : `${showMoney(row.cost, row.currency)}${row.unknownCostLines > 0 ? ' *' : ''}`}
                            </td>
                            <td className="py-3 px-4 text-end whitespace-nowrap">
                              {row.profit === null ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <span className={`font-extrabold ${row.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                  {showMoney(row.profit, row.currency)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {rows.length > visibleRows && (
                  <div className="p-3 border-t border-slate-100 dark:border-gray-700 text-center">
                    <button
                      type="button"
                      onClick={() => setVisibleRows((n) => n + PAGE_SIZE)}
                      className="px-4 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg"
                    >
                      {L(`عرض المزيد (${rows.length - visibleRows} متبقية)`, `Show more (${rows.length - visibleRows} left)`)}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
