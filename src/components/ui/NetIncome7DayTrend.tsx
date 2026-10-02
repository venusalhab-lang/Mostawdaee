import React, { useMemo } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  ReferenceLine 
} from 'recharts';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { Invoice, VaultTransaction, Currency } from '../../types';

interface NetIncome7DayTrendProps {
  language: 'ar' | 'en';
  invoices: Invoice[];
  vaultTransactions: VaultTransaction[];
  activeCurrency: any;
  formatCurrency: (val: number, customCurrency?: string) => string;
}

export function NetIncome7DayTrend({ 
  language, 
  invoices = [], 
  vaultTransactions = [], 
  activeCurrency, 
  formatCurrency 
}: NetIncome7DayTrendProps) {
  const isRtl = language === 'ar';

  const trendData = useMemo(() => {
    const dataPoints: Array<{ name: string; income: number; expense: number; netIncome: number; rawDate: number; isSimulated: boolean }> = [];
    // Reversals of deleted invoices cancel entries of invoices that no longer exist, so they are not counted.
    const countable = vaultTransactions.filter(vt => !(vt.source === 'reversal' && (vt.category === 'sale' || vt.category === 'purchase')));
    const now = new Date();

    // Build values for the last 7 days (6 days ago -> today)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const startOfDay = d.getTime();
      d.setHours(23, 59, 59, 999);
      const endOfDay = d.getTime();

      // Label for weekday
      const label = d.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { weekday: 'short' });

      // Daily Invoices: Sales (Income) & Purchases (Expense)
      const daySales = invoices
        .filter(inv => inv.type === 'sale' && inv.currency === activeCurrency && inv.date >= startOfDay && inv.date <= endOfDay)
        .reduce((sum, inv) => sum + inv.totalAmount, 0);

      const dayPurchases = invoices
        .filter(inv => inv.type === 'purchase' && inv.currency === activeCurrency && inv.date >= startOfDay && inv.date <= endOfDay)
        .reduce((sum, inv) => sum + inv.totalAmount, 0);

      // Daily Vault items: Income (non-sales) & Expense (non-purchases)
      const dayVaultIncome = countable
        .filter(vt => vt.type === 'income' && vt.category !== 'sale' && vt.currency === activeCurrency && vt.timestamp >= startOfDay && vt.timestamp <= endOfDay)
        .reduce((sum, vt) => sum + vt.amount, 0);

      const dayVaultExpense = countable
        .filter(vt => vt.type === 'expense' && vt.category !== 'purchase' && vt.currency === activeCurrency && vt.timestamp >= startOfDay && vt.timestamp <= endOfDay)
        .reduce((sum, vt) => sum + vt.amount, 0);

      const totalIncome = daySales + dayVaultIncome;
      const totalExpense = dayPurchases + dayVaultExpense;
      const netIncome = totalIncome - totalExpense;

      dataPoints.push({
        name: label,
        income: totalIncome,
        expense: totalExpense,
        netIncome: netIncome,
        rawDate: startOfDay,
        isSimulated: false,
      });
    }

    return dataPoints;
  }, [invoices, vaultTransactions, activeCurrency, isRtl]);

  const totalNet = useMemo(() => {
    return trendData.reduce((sum, dp) => sum + dp.netIncome, 0);
  }, [trendData]);

  const isSimulated = false;

  return (
    <div className="w-full flex flex-col justify-between text-slate-900 dark:text-white select-none h-full bg-white/70 dark:bg-white/[0.03] p-6 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-sm backdrop-blur-xl">
      {/* Header element */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-100 dark:border-white/5 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 font-arabic">
              {isRtl ? 'منحنى صافي الدخل اليومي (7 أيام)' : '7-Day Net Daily Income Trend'}
            </h3>
            {isSimulated ? (
              <span className="text-[9px] font-black font-sans uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                {isRtl ? 'بيانات افتراضية' : 'Demo Mode'}
              </span>
            ) : (
              <span className="text-[9px] font-black font-sans uppercase bg-emerald-500/10 text-emerald-650 dark:text-emerald-400 px-1.5 py-0.5 rounded animate-pulse">
                {isRtl ? 'تقدير فوري حقيقي' : 'Live Mode'}
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-450 font-arabic mt-0.5">
            {isRtl 
              ? 'مقارنة المبيعات والإيرادات الخارجية مع المشتريات والمصروفات التشغيلية للمستودع' 
              : 'Direct evaluation of net income flows combining invoices and cash drawer ledgers'}
          </p>
        </div>

        {/* Aggregate Net Total for last 7 Days */}
        <div className="flex items-center gap-3 bg-slate-50 dark:bg-white/5 px-4 py-2 rounded-xl border border-slate-200/50 dark:border-white/5 self-start sm:self-auto shadow-sm">
          <div className={`p-1.5 rounded-lg ${totalNet >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-450'}`}>
            {totalNet >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          </div>
          <div className="text-end sm:text-start">
            <span className="text-[9px] font-black uppercase text-slate-400 block tracking-widest leading-none">
              {isRtl ? 'إجمالي صافي الأسبوع' : 'Total Net Weekly'}
            </span>
            <span className={`text-xs font-black font-mono leading-normal block mt-0.5 ${totalNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-605 dark:text-rose-455'}`}>
              {formatCurrency(totalNet, activeCurrency)}
            </span>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="flex-1 w-full min-h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={trendData}
            margin={{ top: 10, right: 15, left: 5, bottom: 5 }}
          >
            <defs>
              <linearGradient id="glowEffect" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.15}/>
                <stop offset="100%" stopColor="#4f46e5" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid 
              strokeDasharray="4 4" 
              vertical={false} 
              stroke="currentColor" 
              className="text-slate-100 dark:text-white/5"
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
                    <div className="bg-slate-900/90 dark:bg-slate-900/95 border border-slate-700/50 backdrop-blur-md rounded-xl p-3 flex flex-col space-y-1.5 shadow-2xl text-xs text-white pointer-events-none select-none z-50">
                      <p className="font-bold text-[10px] text-slate-450 uppercase tracking-wider font-arabic">
                        {isRtl ? `يوم ${dataObj.name}` : `Weekday: ${dataObj.name}`}
                      </p>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-6 whitespace-nowrap">
                          <span className="text-[10px] text-slate-400 font-arabic font-medium">{isRtl ? 'المقبوضات:' : 'Income:'}</span>
                          <span className="font-mono font-bold text-emerald-400">{formatCurrency(dataObj.income, activeCurrency)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-6 whitespace-nowrap">
                          <span className="text-[10px] text-slate-400 font-arabic font-medium">{isRtl ? 'المدفوعات:' : 'Expense:'}</span>
                          <span className="font-mono font-bold text-rose-400">{formatCurrency(dataObj.expense, activeCurrency)}</span>
                        </div>
                        <div className="border-t border-slate-700/80 my-1 pt-1 flex items-center justify-between gap-6 whitespace-nowrap">
                          <span className="text-[10px] font-black font-arabic">{isRtl ? 'صافي اليوم:' : 'Net Daily:'}</span>
                          <span className={`font-mono font-extrabold ${dataObj.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCurrency(dataObj.netIncome, activeCurrency)}
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
              className="text-slate-350 dark:text-slate-600"
            />

            <Line 
              type="monotone" 
              dataKey="netIncome" 
              stroke="#6366f1" 
              strokeWidth={3} 
              dot={{ r: 4, stroke: '#6366f1', strokeWidth: 2, fill: '#fff' }} 
              activeDot={{ r: 6, stroke: '#6366f1', strokeWidth: 2, fill: '#6366f1' }}
              name="Net Income"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Quick Color-key Legend */}
      <div className="flex items-center gap-4 text-[10px] font-bold font-arabic text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-105/10">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-indigo-500" />
          <span>{isRtl ? 'خط صافي الدخل اليومي' : 'Net Daily Income Path'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-0.5 border-t border-dashed border-slate-400" />
          <span>{isRtl ? 'خط الصفر المتوازن' : 'Breakeven Zero Reference'}</span>
        </div>
      </div>
    </div>
  );
}
