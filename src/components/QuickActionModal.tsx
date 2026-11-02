import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShoppingCart, PlusSquare, Wallet, BarChart3, HelpCircle, Sparkles } from 'lucide-react';
import { Language } from '../types';
import { sounds } from '../lib/sounds';

interface QuickActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onActionClick: (screenDetail: string, actionId?: string) => void;
  /** Screens this account's role may open; shortcuts leading elsewhere are not offered. */
  canOpenScreen: (screen: string) => boolean;
}

export default function QuickActionModal({ 
  isOpen, 
  onClose, 
  language, 
  onActionClick,
  canOpenScreen,
}: QuickActionModalProps) {
  const isRtl = language === 'ar';

  const actions = [
    {
      id: 'pos',
      screen: 'pos',
      title: isRtl ? 'نقطة البيع' : 'POS',
      desc: isRtl ? 'حركة خروج بضاعة مبيعات' : 'Log outgoing sale items',
      icon: ShoppingCart,
      color: 'from-emerald-500 to-teal-700',
      textColor: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/35',
    },
    {
      id: 'add-product',
      screen: 'inventory',
      title: isRtl ? 'إضافة منتج' : 'Add Product',
      desc: isRtl ? 'إدخال سلعة جديدة للمخازن' : 'Register a new warehouse item',
      icon: PlusSquare,
      color: 'from-blue-500 to-indigo-600',
      textColor: 'text-blue-500',
      bgColor: 'bg-blue-500/10 border-blue-500/20 hover:border-blue-500/35',
    },
    {
      id: 'debts',
      screen: 'customers',
      title: isRtl ? 'الديون' : 'Debts',
      desc: isRtl ? 'الذمم المستحقة على العملاء' : 'Outstanding customer debts',
      icon: Wallet,
      color: 'from-amber-500 to-orange-600',
      textColor: 'text-amber-500',
      bgColor: 'bg-amber-500/10 border-amber-500/20 hover:border-amber-500/35',
    },
    {
      id: 'reports',
      screen: 'profits-dashboard',
      title: isRtl ? 'التقارير' : 'Reports',
      desc: isRtl ? 'الأرباح والإحصاءات' : 'Profits and statistics',
      icon: BarChart3,
      color: 'from-purple-500 to-indigo-600',
      textColor: 'text-purple-500',
      bgColor: 'bg-purple-500/10 border-purple-500/20 hover:border-purple-500/35',
    }
  ].filter((act) => canOpenScreen(act.screen));

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center p-0 sm:p-4 notranslate">
          {/* Backdrop Blur overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/65 backdrop-blur-md cursor-pointer"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.95 }}
            className="relative w-full max-w-lg bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col focus:outline-none"
            style={{ direction: isRtl ? 'rtl' : 'ltr' }}
          >
            {/* Top Indicator handle for swipe-down-to-close feel on mobile */}
            <div className="w-12 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto mb-4 sm:hidden" />

            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-white/5 mb-5 select-none">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl">
                  <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-white dark:to-slate-300 text-base font-arabic">
                    {isRtl ? 'الإجراءات السريعة' : 'Quick Actions'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold font-arabic">
                    {isRtl ? 'اختصارات للوصول السريع' : 'Shortcuts to common screens'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  sounds.playClick();
                  onClose();
                }}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-white flex items-center justify-center transition-all cursor-pointer"
               aria-label={isRtl ? 'إغلاق' : 'Close'}>
                <X size={15} className="stroke-[2.5]" />
              </button>
            </div>

            {/* List/Grid of Actions in a custom responsive visual layout */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4">
              {actions.map((act) => {
                const IconComp = act.icon;
                return (
                  <button
                    key={act.id}
                    onClick={() => {
                      sounds.playClick();
                      onActionClick(act.id);
                    }}
                    className={`group text-start p-4 rounded-2xl border ${act.bgColor} transition-all duration-200 flex items-center gap-4 cursor-pointer relative overflow-hidden`}
                  >
                    <div className={`p-3 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-slate-800 dark:text-slate-100 group-hover:scale-110 transition-transform ${act.textColor}`}>
                      <IconComp size={20} className="stroke-[2.5]" />
                    </div>
                    
                    <div className="flex-1 text-right select-none" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                      <h4 className="font-extrabold text-sm text-slate-800 dark:text-slate-100 font-arabic">
                        {act.title}
                      </h4>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-semibold leading-relaxed font-arabic">
                        {act.desc}
                      </p>
                    </div>

                    <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-indigo-500/5 to-transparent rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-colors pointer-events-none" />
                  </button>
                );
              })}
            </div>

            {/* Bottom help/support badge */}
            <div className="mt-2 p-3.5 bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 rounded-2xl flex items-center gap-3 select-none">
              <HelpCircle size={15} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-arabic">
                {isRtl 
                  ? 'اختصارات لفتح البيع المباشر، وإضافة منتج، وديون العملاء، وتقرير الأرباح.' 
                  : 'Shortcuts to direct sale, adding a product, customer debts and the profit report.'}
              </p>
            </div>

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
