import React, { useState, useMemo } from 'react';
import { useFirebase } from './FirebaseProvider';
import { Language } from '../types';
import { Search, ArrowUpRight, ArrowDownLeft, Wallet, RefreshCw, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { usePreferredCurrency } from './CurrencyContext';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine 
} from 'recharts';

interface ActivityLogProps {
  language: Language;
}

const convertToILS = (amount: number, currency: string): number => {
  const c = currency ? currency.toUpperCase() : 'ILS';
  if (c === 'USD' || c === '$') return amount * 3.65;
  if (c === 'JOD' || c === 'JD' || c === 'JOD') return amount * 5.15;
  return amount; // default ILS / ₪
};

const TransactionCard = ({ type, title, subtitle, amount, currency, date, onClick }: {
  type: 'sale' | 'purchase' | 'expense';
  title: string;
  subtitle: string;
  amount: number;
  currency: string;
  date: string;
  onClick: () => void;
}) => {
  const isIncome = type === 'sale';
  const isExpense = type === 'expense';
  
  return (
    <div 
      onClick={onClick}
      className="backdrop-blur-md bg-white/70 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-2xl p-4 mb-3 flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-all duration-300 shadow-sm hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <div className={`p-3 rounded-xl backdrop-blur-lg flex-shrink-0 ${
          isIncome ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 
          isExpense ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
        }`}>
          {isIncome ? <ArrowDownLeft size={22} /> : isExpense ? <Wallet size={22} /> : <ArrowUpRight size={22} />}
        </div>
        <div className="text-right">
          <h4 className="text-slate-800 dark:text-white font-semibold text-sm md:text-base leading-snug">{title}</h4>
          <p className="text-slate-500 dark:text-gray-400 text-xs mt-1">{subtitle} • {date}</p>
        </div>
      </div>
      
      <div className="text-left font-mono">
        <span className={`font-bold text-base md:text-lg ${
          isIncome ? 'text-emerald-600 dark:text-emerald-400' : isExpense ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'
        }`}>
          {isIncome ? '+' : '-'}{amount.toLocaleString()} {currency}
        </span>
      </div>
    </div>
  );
};

interface ProfitAnalyticsChartProps {
  language: Language;
}

export function ProfitAnalyticsChart({ language }: ProfitAnalyticsChartProps) {
  const { invoices, vaultTransactions } = useFirebase();
  const { formatPrice } = usePreferredCurrency();
  const isRtl = language === 'ar';
  const [chartPeriod, setChartPeriod] = useState<'daily' | 'monthly'>('daily');

  // Recharts Daily profit calculator
  const dailyChartData = useMemo(() => {
    const dataPoints = [];
    const now = new Date();
    let hasRealData = false;

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
      const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();

      const label = d.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { weekday: 'short' });

      // Daily Sales (type = 'sale') converted to ILS
      const salesVolume = invoices
        .filter(inv => inv.type === 'sale' && inv.date >= startOfDay && inv.date <= endOfDay)
        .reduce((sum, inv) => sum + convertToILS(inv.totalAmount, inv.currency), 0);

      const purchaseVolume = invoices
        .filter(inv => inv.type === 'purchase' && inv.date >= startOfDay && inv.date <= endOfDay)
        .reduce((sum, inv) => sum + convertToILS(inv.totalAmount, inv.currency), 0);

      // Daily Expenses (type = 'expense' in vaultTransactions) converted to ILS
      const expenseVolume = vaultTransactions
        .filter(tx => tx.type === 'expense' && tx.timestamp >= startOfDay && tx.timestamp <= endOfDay)
        .reduce((sum, tx) => sum + convertToILS(tx.amount, tx.currency), 0);

      const totalOutflow = purchaseVolume + expenseVolume;
      const netProfit = salesVolume - totalOutflow;

      if (salesVolume > 0 || totalOutflow > 0) {
        hasRealData = true;
      }

      dataPoints.push({
        name: label,
        sales: Math.round(salesVolume),
        expenses: Math.round(totalOutflow),
        profit: Math.round(netProfit),
        dateStr: d.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' })
      });
    }

    if (!hasRealData) {
      const mockSales = [650, 890, 410, 720, 1100, 560, 930];
      const mockExpenses = [320, 480, 290, 310, 520, 390, 410];
      return dataPoints.map((dp, idx) => ({
        ...dp,
        sales: mockSales[idx],
        expenses: mockExpenses[idx],
        profit: mockSales[idx] - mockExpenses[idx],
        isSimulated: true
      }));
    }

    return dataPoints;
  }, [invoices, vaultTransactions, isRtl]);

  // Recharts Monthly profit calculator
  const monthlyChartData = useMemo(() => {
    const dataPoints = [];
    const now = new Date();
    let hasRealData = false;

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
      
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const endOfMonth = new Date(nextMonth.getTime() - 1).getTime();

      const label = d.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { month: 'short' });

      const salesVolume = invoices
        .filter(inv => inv.type === 'sale' && inv.date >= startOfMonth && inv.date <= endOfMonth)
        .reduce((sum, inv) => sum + convertToILS(inv.totalAmount, inv.currency), 0);

      const purchaseVolume = invoices
        .filter(inv => inv.type === 'purchase' && inv.date >= startOfMonth && inv.date <= endOfMonth)
        .reduce((sum, inv) => sum + convertToILS(inv.totalAmount, inv.currency), 0);

      const expenseVolume = vaultTransactions
        .filter(tx => tx.type === 'expense' && tx.timestamp >= startOfMonth && tx.timestamp <= endOfMonth)
        .reduce((sum, tx) => sum + convertToILS(tx.amount, tx.currency), 0);

      const totalOutflow = purchaseVolume + expenseVolume;
      const netProfit = salesVolume - totalOutflow;

      if (salesVolume > 0 || totalOutflow > 0) {
        hasRealData = true;
      }

      dataPoints.push({
        name: label,
        sales: Math.round(salesVolume),
        expenses: Math.round(totalOutflow),
        profit: Math.round(netProfit),
        dateStr: d.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long' })
      });
    }

    if (!hasRealData) {
      const mockSales = [14200, 16800, 13100, 18200, 22405, 19500];
      const mockExpenses = [8500, 10200, 9100, 11200, 13400, 11800];
      return dataPoints.map((dp, idx) => ({
        ...dp,
        sales: mockSales[idx],
        expenses: mockExpenses[idx],
        profit: mockSales[idx] - mockExpenses[idx],
        isSimulated: true
      }));
    }

    return dataPoints;
  }, [invoices, vaultTransactions, isRtl]);

  const currentChartData = chartPeriod === 'daily' ? dailyChartData : monthlyChartData;
  const isSimulated = currentChartData[0]?.isSimulated ?? false;

  const totalPeriodProfit = useMemo(() => {
    return currentChartData.reduce((sum, dp) => sum + dp.profit, 0);
  }, [currentChartData]);

  const avgPeriodProfit = useMemo(() => {
    return currentChartData.length > 0 ? Math.round(totalPeriodProfit / currentChartData.length) : 0;
  }, [currentChartData, totalPeriodProfit]);

  return (
    <div className="mt-4 flex flex-col">
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 select-none">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base md:text-lg font-bold text-slate-800 dark:text-white leading-tight">
              {isRtl ? 'تحليلات صافي الأرباح العام' : 'Consolidated Net Profits Analysis'}
            </h2>
            {isSimulated ? (
              <span className="text-[9px] font-black font-sans uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                {isRtl ? 'بيانات ديمو' : 'Demo Mode'}
              </span>
            ) : (
              <span className="text-[9px] font-black font-sans uppercase bg-emerald-500/10 text-emerald-650 dark:text-emerald-400 px-1.5 py-0.5 rounded animate-pulse">
                {isRtl ? 'مباشر' : 'Live Mode'}
              </span>
            )}
          </div>
          <p className="text-slate-500 dark:text-gray-400 text-xs mt-0.5">
            {isRtl ? 'منحنى أرباح المستودع الصافية بعد تصفية المبيعات والمصاريف التشغيلية' : 'Consolidated net profit of the warehouse calculated from sales vs expenses'}
          </p>
        </div>

        {/* Period Toggles (Daily / Monthly) */}
        <div className="flex bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200/40 dark:border-white/10 self-start sm:self-auto">
          <button
            onClick={() => setChartPeriod('daily')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all duration-150 ${chartPeriod === 'daily' ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-800'}`}
          >
            {isRtl ? 'يومي (أسبوع)' : 'Daily (Weekly)'}
          </button>
          <button
            onClick={() => setChartPeriod('monthly')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all duration-150 ${chartPeriod === 'monthly' ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-800'}`}
          >
            {isRtl ? 'شهري (6 شهور)' : 'Monthly (6 Months)'}
          </button>
        </div>
      </div>

      {/* Aggregate KPI Badges row */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-slate-55 dark:bg-white/5 p-3.5 rounded-2xl border border-slate-100/50 dark:border-white/10 bg-slate-50">
          <span className="text-[10px] uppercase text-slate-500 dark:text-gray-400 block font-bold">
            {isRtl ? 'صافي الربح للفترة' : 'Aggregated Period Profit'}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span className={`p-1 rounded-md ${totalPeriodProfit >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-505'}`}>
              {totalPeriodProfit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            </span>
            <span className={`text-sm md:text-base font-black font-mono ${totalPeriodProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatPrice(totalPeriodProfit, '₪')}
            </span>
          </div>
        </div>

        <div className="bg-slate-55 dark:bg-white/5 p-3.5 rounded-2xl border border-slate-100/50 dark:border-white/10 bg-slate-50">
          <span className="text-[10px] uppercase text-slate-500 dark:text-gray-400 block font-bold">
            {isRtl ? 'متوسط الربح التقريبي' : 'Approximate Average Profit'}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span className="p-1 rounded-md bg-indigo-500/10 text-indigo-500">
              <DollarSign size={14} />
            </span>
            <span className="text-sm md:text-base font-black font-mono text-indigo-650 dark:text-indigo-400">
              {formatPrice(avgPeriodProfit, '₪')}
            </span>
          </div>
        </div>
      </div>

      {/* Recharts LineChart Canvas */}
      <div className="h-64 w-full mt-2 col-span-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={currentChartData}
            margin={{ top: 10, right: 15, left: 5, bottom: 5 }}
          >
            <defs>
              <linearGradient id="profitGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.15}/>
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid 
              strokeDasharray="4 4" 
              vertical={false} 
              stroke="currentColor" 
              className="text-slate-150 dark:text-white/5"
            />
            <XAxis 
              dataKey="name" 
              tick={{ fill: 'currentColor', fontSize: 10, fontWeight: 700 }}
              axisLine={false}
              tickLine={false}
              className="text-slate-400 dark:text-slate-500 font-arabic"
            />
            <YAxis 
              tickFormatter={(val) => `${val >= 0 ? '+' : ''}${val}`}
              tick={{ fill: 'currentColor', fontSize: 9, fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              className="text-slate-400 dark:text-slate-500 font-mono"
            />
            <Tooltip
              cursor={{ stroke: 'rgba(99, 102, 241, 0.15)', strokeWidth: 2 }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const dataObj = payload[0].payload;
                  return (
                    <div className="bg-slate-900/95 border border-slate-700/50 backdrop-blur-md rounded-xl p-3 flex flex-col space-y-1.5 shadow-2xl text-xs text-white pointer-events-none select-none z-50">
                      <p className="font-bold text-[10px] text-slate-400 uppercase tracking-wider font-arabic">
                        {dataObj.dateStr}
                      </p>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-6 whitespace-nowrap">
                          <span className="text-[10px] text-slate-400 font-arabic font-medium">{isRtl ? 'المبيعات:' : 'Sales:'}</span>
                          <span className="font-mono font-bold text-emerald-400">{formatPrice(dataObj.sales, '₪')}</span>
                        </div>
                        <div className="flex items-center justify-between gap-6 whitespace-nowrap">
                          <span className="text-[10px] text-slate-400 font-arabic font-medium">{isRtl ? 'النفقات والمدفوعات:' : 'Expenses & Payments:'}</span>
                          <span className="font-mono font-bold text-rose-450">{formatPrice(dataObj.expenses, '₪')}</span>
                        </div>
                        <div className="border-t border-slate-700/85 my-1 pt-1 flex items-center justify-between gap-6 whitespace-nowrap">
                          <span className="text-[10px] font-black font-arabic">{isRtl ? 'صافي الربح:' : 'Net Profit:'}</span>
                          <span className={`font-mono font-extrabold ${dataObj.profit >= 0 ? 'text-emerald-400' : 'text-rose-450'}`}>
                            {formatPrice(dataObj.profit, '₪')}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            
            <ReferenceLine 
              y={0} 
              stroke="currentColor" 
              strokeDasharray="3 3" 
              className="text-slate-300 dark:text-slate-600"
            />

            <Line 
              type="monotone" 
              dataKey="profit" 
              stroke="#6366f1" 
              strokeWidth={3} 
              dot={{ r: 4, stroke: '#6366f1', strokeWidth: 2, fill: '#fff' }} 
              activeDot={{ r: 6, stroke: '#6366f1', strokeWidth: 2, fill: '#6366f1' }}
              name="Net Profit"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] font-bold font-arabic text-slate-400 dark:text-slate-500 mt-2.5 pt-3 border-t border-slate-150 dark:border-white/5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="w-2.5 h-2.5 rounded bg-indigo-500" />
          <span>{isRtl ? 'منحنى صافي الربح التقديري' : 'Approximate Net Profit Curve'}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="w-2 h-0.5 border-t border-dashed border-slate-400" />
          <span>{isRtl ? 'مستوى التعادل (الصفر)' : 'Breakeven Balance (Zero)'}</span>
        </div>
      </div>
    </div>
  );
}

export default function ActivityLog({ language }: ActivityLogProps) {
  const { invoices, vaultTransactions, loading } = useFirebase();
  const { formatPrice } = usePreferredCurrency();
  const isRtl = language === 'ar';

  const [activeTab, setActiveTab] = useState<'sales' | 'purchases' | 'expenses'>('sales');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState('ALL');

  // Relative Date Formatting Helper
  const formatRelativeDate = (timestamp: number) => {
    if (!timestamp) return isRtl ? 'الآن' : 'now';
    const date = new Date(timestamp);
    const now = new Date();
    
    const isToday = date.toDateString() === now.toDateString();
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    
    const timeStr = date.toLocaleTimeString(isRtl ? 'ar-EG' : 'en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    if (isToday) {
      return isRtl ? `اليوم، ${timeStr}` : `Today, ${timeStr}`;
    } else if (isYesterday) {
      return isRtl ? `أمس، ${timeStr}` : `Yesterday, ${timeStr}`;
    } else {
      return date.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    }
  };

  // Convert and Map real DB data dynamically
  const mappedSales = useMemo(() => {
    return invoices
      .filter(inv => inv.type === 'sale')
      .map(inv => ({
        id: inv.id,
        title: isRtl ? `فاتورة مبيعات #INV-${inv.invoiceNumber}` : `Sale Invoice #INV-${inv.invoiceNumber}`,
        subtitle: isRtl ? `الزبون: ${inv.customerName || 'عميل مباشر'}` : `Customer: ${inv.customerName || 'Walk-In'}`,
        amount: inv.totalAmount,
        currency: inv.currency === 'ILS' ? '₪' : (inv.currency === 'USD' ? '$' : 'JD'),
        rawCurrency: inv.currency,
        date: formatRelativeDate(inv.date),
        rawDate: inv.date
      }));
  }, [invoices, isRtl]);

  const mappedPurchases = useMemo(() => {
    return invoices
      .filter(inv => inv.type === 'purchase')
      .map(inv => ({
        id: inv.id,
        title: isRtl ? `فاتورة مشتريات #PUR-${inv.invoiceNumber}` : `Purchase Invoice #PUR-${inv.invoiceNumber}`,
        subtitle: isRtl ? `المورد: ${inv.supplierName || 'مورد رئيسي'}` : `Supplier: ${inv.supplierName || 'Main Supplier'}`,
        amount: inv.totalAmount,
        currency: inv.currency === 'ILS' ? '₪' : (inv.currency === 'USD' ? '$' : 'JD'),
        rawCurrency: inv.currency,
        date: formatRelativeDate(inv.date),
        rawDate: inv.date
      }));
  }, [invoices, isRtl]);

  const mappedExpenses = useMemo(() => {
    return vaultTransactions
      .filter(tx => tx.type === 'expense')
      .map(tx => ({
        id: tx.id,
        title: tx.description || (isRtl ? 'مصاريف تشغيلية' : 'Operating Expenses'),
        subtitle: isRtl ? `الفئة: ${tx.category === 'salary' ? 'رواتب' : tx.category === 'purchase' ? 'منفذة شراء' : 'أخرى'}` : `Category: ${tx.category}`,
        amount: tx.amount,
        currency: tx.currency === 'ILS' ? '₪' : (tx.currency === 'USD' ? '$' : 'JD'),
        rawCurrency: tx.currency,
        date: formatRelativeDate(tx.timestamp),
        rawDate: tx.timestamp
      }));
  }, [vaultTransactions, isRtl]);

  // Fallback default mockup data (strictly matching user's original array) if database accounts are empty
  const defaultSales = useMemo(() => [
    { id: 'mock-s1', title: isRtl ? 'فاتورة مبيعات #INV-1024' : 'Sale Invoice #INV-1024', subtitle: isRtl ? 'الزبون: أحمد خليل' : 'Customer: Ahmad Khalil', amount: 350, currency: '₪', rawCurrency: 'ILS' as const, date: isRtl ? 'اليوم، 12:30 م' : 'Today, 12:30 PM', rawDate: Date.now() },
    { id: 'mock-s2', title: isRtl ? 'فاتورة مبيعات #INV-1023' : 'Sale Invoice #INV-1023', subtitle: isRtl ? 'زبون نقدي' : 'Cash Customer', amount: 120, currency: '$', rawCurrency: 'USD' as const, date: isRtl ? 'اليوم، 10:15 ص' : 'Today, 10:15 AM', rawDate: Date.now() - 3600000 }
  ], [isRtl]);

  const defaultPurchases = useMemo(() => [
    { id: 'mock-p1', title: isRtl ? 'فاتورة مشتريات #PUR-501' : 'Purchase Invoice #PUR-501', subtitle: isRtl ? 'المورد: شركة الصيانة المتقدمة' : 'Supplier: Advanced Maintenance Co.', amount: 1500, currency: '₪', rawCurrency: 'ILS' as const, date: isRtl ? 'أمس، 04:00 م' : 'Yesterday, 04:00 PM', rawDate: Date.now() - 86400000 },
    { id: 'mock-p2', title: isRtl ? 'فاتورة مشتريات #PUR-500' : 'Purchase Invoice #PUR-500', subtitle: isRtl ? 'استيراد شاشات وبطاريات' : 'Importing Screens & Batteries', amount: 800, currency: 'JD', rawCurrency: 'JOD' as const, date: '08/06/2026', rawDate: Date.now() - 172800000 }
  ], [isRtl]);

  const defaultExpenses = useMemo(() => [
    { id: 'mock-e1', title: isRtl ? 'فاتورة كهرباء المحل' : 'Electricity Bill', subtitle: isRtl ? 'مصاريف تشغيلية' : 'Operating Expenses', amount: 200, currency: '₪', rawCurrency: 'ILS' as const, date: isRtl ? 'أمس، 01:00 م' : 'Yesterday, 01:00 PM', rawDate: Date.now() - 86400000 },
    { id: 'mock-e2', title: isRtl ? 'شراء أدوات لحام وقصدير' : 'Solder Tools & Tin', subtitle: isRtl ? 'صيانة ومعدات' : 'Maintenance & Equipments', amount: 50, currency: '$', rawCurrency: 'USD' as const, date: '05/06/2026', rawDate: Date.now() - 259200000 }
  ], [isRtl]);

  // Resolve lists dynamically
  const finalSales = mappedSales.length > 0 ? mappedSales : defaultSales;
  const finalPurchases = mappedPurchases.length > 0 ? mappedPurchases : defaultPurchases;
  const finalExpenses = mappedExpenses.length > 0 ? mappedExpenses : defaultExpenses;

  // Active collection
  const activeCollection = useMemo(() => {
    switch (activeTab) {
      case 'sales':
        return finalSales;
      case 'purchases':
        return finalPurchases;
      case 'expenses':
        return finalExpenses;
      default:
        return finalSales;
    }
  }, [activeTab, finalSales, finalPurchases, finalExpenses]);

  // Filtering Logic (Currency + Search term)
  const filteredList = useMemo(() => {
    return activeCollection
      .filter(item => {
        if (selectedCurrency === 'ALL') return true;
        const mappedSelected = selectedCurrency === '₪' ? 'ILS' : selectedCurrency === '$' ? 'USD' : 'JOD';
        return item.rawCurrency === mappedSelected;
      })
      .filter(item => {
        const query = searchTerm.toLowerCase();
        return (
          item.title.toLowerCase().includes(query) ||
          item.subtitle.toLowerCase().includes(query) ||
          String(item.amount).includes(query)
        );
      });
  }, [activeCollection, selectedCurrency, searchTerm]);

  // Manual trigger refresh
  const triggerRefresh = () => {
    toast.success(isRtl ? 'تم تحديث الحركات والمستندات بنجاح ⚡' : 'Activity list successfully updated ⚡');
  };

  const handleCardClick = (item: any) => {
    toast.info(isRtl 
      ? `تفاصيل الحركة: ${item.title} بقيمة ${item.amount} ${item.currency}` 
      : `${item.title} details: ${item.amount} ${item.currency}`
    );
  };



  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200/50 dark:border-white/10 bg-white/70 dark:bg-slate-900/55 p-6 backdrop-blur-xl flex items-center justify-center min-h-[250px]">
        <div className="text-slate-400 font-bold animate-pulse font-arabic text-center">
          {isRtl ? 'جاري جرد وتحديث الحركات والعملات...' : 'Syncing databases & currencies...'}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`rounded-3xl p-6 border border-slate-200/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/40 backdrop-blur-xl transition-all duration-300 shadow-md ${isRtl ? 'font-arabic text-right' : 'text-left'}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Dynamic Header */}
      <div className="mb-6 flex justify-between items-center select-none">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-white leading-tight">
            {isRtl ? 'سجل الحركات العام' : 'General Activity Logs'}
          </h1>
          <p className="text-slate-500 dark:text-gray-400 text-xs md:text-sm mt-1">
            {isRtl ? 'مراقبة شاملة للمبيعات، المشتريات، والمصاريف' : 'Live monitoring of sales, purchases, and expenses'}
          </p>
        </div>
        <button 
          onClick={triggerRefresh}
          className="p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white transition-all hover:scale-105 active:scale-95"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Dynamic Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {/* Search Input Box */}
        <div className="relative flex items-center">
          <input 
            type="text" 
            placeholder={isRtl ? 'ابحث برقم الفاتورة، اسم الزبون أو المورد...' : 'Search invoice, customer or supplier...'} 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full py-3 rounded-xl bg-slate-50 dark:bg-black/25 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:border-indigo-400 transition-all text-sm ${isRtl ? 'pr-10 pl-4 text-right' : 'pl-10 pr-4 text-left'}`}
          />
          <Search className={`absolute text-slate-400 dark:text-gray-500 ${isRtl ? 'right-3' : 'left-3'}`} size={16} />
        </div>

        {/* Currency Tabs switcher */}
        <div className="flex gap-1.5">
          {['ALL', '₪', '$', 'JD'].map((curr) => (
            <button
              key={curr}
              onClick={() => setSelectedCurrency(curr)}
              className={`flex-1 py-3 text-xs md:text-sm rounded-xl font-semibold transition-all duration-300 border ${
                selectedCurrency === curr 
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-transparent shadow-lg shadow-indigo-500/20' 
                  : 'bg-slate-50 dark:bg-white/5 border-slate-250 dark:border-white/10 text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              {curr === 'ALL' ? (isRtl ? 'كل العملات' : 'All') : curr}
            </button>
          ))}
        </div>
      </div>

      {/* Categories Tabs switcher */}
      <div className="flex p-1.5 rounded-2xl bg-slate-100/80 dark:bg-black/30 border border-slate-200 dark:border-white/10 mb-6 select-none">
        <button 
          onClick={() => setActiveTab('sales')}
          className={`flex-1 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-300 ${activeTab === 'sales' ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white'}`}
        >
          {isRtl ? 'المبيعات' : 'Sales'}
        </button>
        <button 
          onClick={() => setActiveTab('purchases')}
          className={`flex-1 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-300 ${activeTab === 'purchases' ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white'}`}
        >
          {isRtl ? 'المشتريات' : 'Purchases'}
        </button>
        <button 
          onClick={() => setActiveTab('expenses')}
          className={`flex-1 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-300 ${activeTab === 'expenses' ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white'}`}
        >
          {isRtl ? 'المصاريف' : 'Expenses'}
        </button>
      </div>

      {/* Scrollable list container */}
      <div className="overflow-y-auto max-h-[300px] pr-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-white/10 scrollbar-track-transparent mb-4">
        {filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400 dark:text-slate-500 select-none">
            <p className="font-semibold text-sm">
              {isRtl ? 'لا توجد حركات مسجلة تطابق مدخلات البحث الحالية.' : 'No matching activities recorded.'}
            </p>
          </div>
        ) : (
          filteredList.map((item) => (
            <TransactionCard 
              key={item.id}
              type={activeTab === 'sales' ? 'sale' : activeTab === 'purchases' ? 'purchase' : 'expense'}
              title={item.title}
              subtitle={item.subtitle}
              amount={item.amount}
              currency={item.currency}
              date={item.date}
              onClick={() => handleCardClick(item)}
            />
          ))
        )}
      </div>

      {/* Divider line */}
      <div className="border-t border-slate-200/50 dark:border-white/5 my-6" />

      {/* Profits Chart Section */}
      <ProfitAnalyticsChart language={language} />
    </div>
  );
}

