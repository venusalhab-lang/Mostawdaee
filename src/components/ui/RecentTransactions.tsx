import React from 'react';
import { usePreferredCurrency } from '../CurrencyContext';

// تحديد أنواع العمليات المختلفة لتخصيص الألوان والأيقونات
type TransactionType = 'sale' | 'purchase' | 'pos_reconciliation' | 'expense';

interface Transaction {
  id: string;
  title: string;
  time: string;
  amount: string;
  currency: string;
  type: TransactionType;
  reference: string;
}

interface RecentTransactionsProps {
  language?: 'ar' | 'en';
  invoices?: any[];
  formatCurrency?: (val: number, customCurrency?: string) => string;
}

export function RecentTransactions({ language = 'ar', invoices, formatCurrency }: RecentTransactionsProps) {
  const isRtl = language === 'ar';
  const { formatPrice: globalFormatPrice } = usePreferredCurrency();

  // عينة بيانات حية ومطابقة لطبيعة الحسابات متعددة العملات
  const defaultTransactionsRaw = [
    { 
      id: '1', 
      title: isRtl ? 'بيع فاتورة POS #2044' : 'Sale POS Invoice #2044', 
      time: isRtl ? 'منذ دقيقتين' : '2 minutes ago', 
      val: 350, 
      symbol: '₪', 
      type: 'sale', 
      reference: isRtl ? 'كاشير 1' : 'Cashier 1' 
    },
    { 
      id: '2', 
      title: isRtl ? 'شراء بضاعة من المورد الرئيسي' : 'Direct Purchase from main supplier', 
      time: isRtl ? 'منذ 15 دقيقة' : '15 minutes ago', 
      val: 1200, 
      symbol: '$', 
      type: 'purchase', 
      reference: isRtl ? 'مستودع أ' : 'Warehouse A' 
    },
    { 
      id: '3', 
      title: isRtl ? 'صرف دفعة مصاريف تشغيلية' : 'Paid operational expenses batch', 
      time: isRtl ? 'منذ ساعة' : '1 hour ago', 
      val: 150, 
      symbol: '₪', 
      type: 'expense', 
      reference: isRtl ? 'وصل رقم #88' : 'Receipt #88' 
    },
    { 
      id: '4', 
      title: isRtl ? 'إغلاق جرد وردية مسائية' : 'Evening shift reconciliation ledger', 
      time: isRtl ? 'منذ ساعتين' : '2 hours ago', 
      val: 450, 
      symbol: '$', 
      type: 'pos_reconciliation', 
      reference: isRtl ? 'نقطة بيع 2' : 'POS Terminal 2' 
    },
  ];

  const defaultTransactions = defaultTransactionsRaw.map(item => ({
    id: item.id,
    title: item.title,
    time: item.time,
    amount: globalFormatPrice(item.val, item.symbol),
    currency: item.symbol === '$' ? 'USD' : 'ILS',
    type: item.type as TransactionType,
    reference: item.reference
  }));

  // دمج البيانات الحية من قاعدة البيانات في حال توفرت
  const transactions: Transaction[] = React.useMemo(() => {
    if (!invoices || invoices.length === 0) {
      return defaultTransactions;
    }
    return invoices.slice(0, 8).map((inv) => {
      const isSale = inv.type === 'sale';
      const timeStr = new Date(inv.date || Date.now()).toLocaleTimeString(isRtl ? 'ar-JO' : 'en-US', { hour: '2-digit', minute: '2-digit' });
      const ref = inv.customerName || inv.supplierName || (isRtl ? 'عميل افتراضي' : 'Walk-in');
      const symbol = inv.currency === 'USD' ? '$' : inv.currency === 'JOD' ? 'د.أ' : '₪';
      const formattedAmount = formatCurrency 
        ? formatCurrency(inv.totalAmount, inv.currency) 
        : `${isSale ? '+' : '-'} ${globalFormatPrice(inv.totalAmount, symbol)}`;

      return {
        id: inv.id,
        title: isSale 
          ? (isRtl ? `بيع فاتورة #${inv.invoiceNumber}` : `Sale Invoice #${inv.invoiceNumber}`)
          : (isRtl ? `توريد بضائع #${inv.invoiceNumber}` : `Purchase Cargo #${inv.invoiceNumber}`),
        time: timeStr,
        amount: formattedAmount,
        currency: inv.currency || 'ILS',
        type: (inv.type as TransactionType) || (isSale ? 'sale' : 'purchase'),
        reference: ref
      };
    });
  }, [invoices, language, formatCurrency]);

  // دالة ذكية لتحديد لون وتأثير المبلغ بناءً على نوع العملية
  const getTransactionStyle = (type: TransactionType) => {
    switch (type) {
      case 'sale':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200/50 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20';
      case 'purchase':
        return 'text-sky-600 bg-sky-50 border-sky-200/50 dark:text-sky-400 dark:bg-sky-500/10 dark:border-sky-500/20';
      case 'expense':
        return 'text-rose-600 bg-rose-50 border-rose-200/50 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/20';
      default:
        return 'text-amber-600 bg-amber-50 border-amber-200/50 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20';
    }
  };

  return (
    <div className="w-full max-w-full h-full flex flex-col notranslate box-border">
      {/* رأس القائمة */}
      <div className="flex items-center justify-between mb-4 select-none">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-350 font-arabic truncate mr-2">
          {isRtl ? 'آخر العمليات الفورية' : 'Last Instant Operations'}
        </h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 text-slate-550 dark:text-slate-400 font-mono animate-pulse shrink-0">
          {isRtl ? 'تحديث مباشر' : 'Live Update'}
        </span>
      </div>

      {/* قائمة العمليات مع خاصية التمرير النظيف والسلس */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar w-full max-w-full overflow-x-hidden">
        {transactions.map((tx) => (
          <div 
            key={tx.id} 
            className="group flex justify-between items-center p-3 rounded-xl bg-slate-50/50 border border-slate-150 text-xs transition-all duration-200 ease-out hover:bg-white hover:border-slate-350 hover:-translate-y-0.5 dark:bg-white/[0.01] dark:border-white/5 dark:hover:bg-white/[0.04] dark:hover:border-white/10 will-change-transform cursor-pointer w-full box-border"
          >
            {/* تفاصيل العملية (اليمين) */}
            <div className="flex flex-col gap-1 text-right min-w-0 flex-1 pl-3">
              <p className="font-bold text-slate-700 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white transition-colors truncate">
                {tx.title}
              </p>
              <div className="flex items-center gap-2 text-slate-450 dark:text-slate-500 text-[11px] font-arabic truncate">
                <span className="shrink-0">{tx.time}</span>
                <span className="h-1 w-1 rounded-full bg-slate-250 dark:bg-slate-750 shrink-0"></span>
                <span className="font-mono truncate">{tx.reference}</span>
              </div>
            </div>

            {/* القيمة والعملة (اليسار) */}
            <div className="text-left font-mono shrink-0">
              <span className={`font-mono font-black px-2.5 py-1 rounded-lg border ${getTransactionStyle(tx.type)}`}>
                {tx.amount}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

