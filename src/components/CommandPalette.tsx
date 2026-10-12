import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, ShoppingCart, Package, Settings, X, Command, Users } from 'lucide-react';
import { Language, Product } from '../types';
import { translations } from '../translations';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  products: Product[];
  onAction: (action: string, payload?: any) => void;
  /** Screens this account's role may open; actions leading elsewhere are not offered. */
  canOpenScreen: (screen: string) => boolean;
}

const ACTION_SCREEN: Record<string, string> = {
  'new-sale': 'pos',
  'new-purchase': 'purchases-expenses',
  'add-product': 'inventory',
  employees: 'employees',
  settings: 'settings',
};

export default function CommandPalette({ isOpen, onClose, language, products, onAction, canOpenScreen }: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredActions = [
    { id: 'new-sale', icon: <ShoppingCart size={18} />, label: t.newSale, category: t.quickActions },
    { id: 'new-purchase', icon: <Plus size={18} />, label: t.newPurchase, category: t.quickActions },
    { id: 'add-product', icon: <Package size={18} />, label: t.addNewProduct, category: t.quickActions },
    { id: 'employees', icon: <Users size={18} />, label: t.employees, category: t.quickActions },
    { id: 'settings', icon: <Settings size={18} />, label: t.settings, category: t.appPreferences },
  ].filter(a => canOpenScreen(ACTION_SCREEN[a.id]) && a.label.toLowerCase().includes(query.toLowerCase()));

  const filteredProducts = !canOpenScreen('inventory') ? [] : products.filter(p => 
    p.name.toLowerCase().includes(query.toLowerCase()) || 
    p.sku.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 5);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          className="relative w-full max-w-2xl bg-white dark:bg-gray-800 rounded-3xl shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-700 flex flex-col"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <div className="relative p-6 border-b border-gray-50 dark:border-gray-700 flex items-center gap-4">
            <Search className="text-gray-400" size={24} />
            <input
              ref={inputRef}
              type="text"
              placeholder={t.commandSearchPlaceholder} aria-label={t.commandSearchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-xl text-gray-900 dark:text-white placeholder-gray-400"
            />
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-900 rounded-lg text-[10px] font-bold text-gray-400">
              <Command size={10} /> K
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors" aria-label={isRtl ? 'إغلاق' : 'Close'}>
              <X size={20} className="text-gray-400" />
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4 custom-scrollbar">
            {filteredActions.length > 0 && (
              <div className="mb-6">
                <p className="px-4 text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">{t.quickActions}</p>
                <div className="space-y-1">
                  {filteredActions.map(action => (
                    <button
                      key={action.id}
                      onClick={() => { onAction(action.id); onClose(); }}
                      className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all text-gray-700 dark:text-gray-300 hover:text-indigo-700 dark:hover:text-indigo-400 group"
                    >
                      <div className="w-10 h-10 bg-gray-50 dark:bg-gray-900 rounded-xl flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/40 transition-colors">
                        {action.icon}
                      </div>
                      <span className="font-bold">{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filteredProducts.length > 0 && (
              <div>
                <p className="px-4 text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">{t.inventory}</p>
                <div className="space-y-1">
                  {filteredProducts.map(product => (
                    <button
                      key={product.id}
                      onClick={() => { onAction('view-product', product); onClose(); }}
                      className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-900 transition-all text-gray-700 dark:text-gray-300 group"
                    >
                      <div className="w-10 h-10 bg-gray-50 dark:bg-gray-900 rounded-xl flex items-center justify-center group-hover:bg-gray-100 dark:group-hover:bg-gray-700">
                        <Package size={18} />
                      </div>
                      <div className="flex-1 text-right">
                        <p className="font-bold">{product.name}</p>
                        <p className="text-xs text-gray-400 font-mono tracking-tighter">SKU: {product.sku}</p>
                      </div>
                      <div className="text-left">
                        <p className={`text-xs font-black px-2 py-1 rounded-full ${
                          product.status === 'In Stock' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' :
                          product.status === 'Low Stock' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400'
                        }`}>
                          {product.quantity} {t.unitsPlural}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filteredActions.length === 0 && filteredProducts.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-gray-400 font-bold">{isRtl ? 'لا توجد نتائج مطابقة' : 'No results found'}</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
