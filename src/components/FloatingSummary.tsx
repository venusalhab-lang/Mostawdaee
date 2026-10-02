import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, ShoppingBag, Info } from 'lucide-react';
import { Language, Transaction, Product } from '../types';
import { translations } from '../translations';

interface Props {
  language: Language;
  transactions: Transaction[];
  products: Product[];
}

export default function FloatingSummary({ language, transactions, products }: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';

  const today = new Date().setHours(0,0,0,0);
  const todaysTx = transactions.filter(tx => tx.timestamp >= today);
  const salesCount = todaysTx.filter(tx => tx.type === 'sale').length;
  const purchasesCount = todaysTx.filter(tx => tx.type === 'purchase').length;
  
  const lowStockItems = products.filter(p => p.status === 'Low Stock').length;

  return (
    <motion.div
      initial={{ opacity: 0, x: isRtl ? -50 : 50, scale: 0.8 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      className={`fixed bottom-8 ${isRtl ? 'left-8' : 'right-8'} z-40 max-w-xs w-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-3xl border border-white dark:border-gray-700 p-4 shadow-2xl glass-panel group hidden lg:block`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
          <TrendingUp size={20} />
        </div>
        <div className="flex-1">
          <h4 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">{t.dailySummary}</h4>
          <p className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">
            {salesCount > 0 || purchasesCount > 0 
              ? (isRtl ? `تم تسجيل ${salesCount} مبيعات و ${purchasesCount} مشتريات اليوم.` : `${salesCount} sales & ${purchasesCount} purchases today.`)
              : t.noTransactionsToday}
          </p>
        </div>
      </div>
      
      {lowStockItems > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <Info size={14} className="text-amber-500" />
          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-tight">
            {isRtl ? `${lowStockItems} أصناف منخفضة المخزون` : `${lowStockItems} items low on stock`}
          </span>
        </div>
      )}
    </motion.div>
  );
}
