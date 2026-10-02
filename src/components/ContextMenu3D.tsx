import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Eye, 
  Edit2, 
  Trash2, 
  Share2, 
  Printer,
  ChevronRight,
  Info
} from 'lucide-react';
import { Language } from '../types';
import { translations } from '../translations';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions: {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    color?: string;
  }[];
  details?: {
    label: string;
    value: string;
  }[];
  language: Language;
}

export default function ContextMenu3D({ 
  isOpen, 
  onClose, 
  title, 
  subtitle, 
  actions, 
  details, 
  language 
}: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-gray-900/60 backdrop-blur-md"
          />
          
          <motion.div
            initial={{ 
              opacity: 0, 
              scale: 0.8, 
              rotateX: -20, 
              rotateY: isRtl ? 20 : -20,
              y: 20
            }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              rotateX: 0, 
              rotateY: 0,
              y: 0
            }}
            exit={{ 
              opacity: 0, 
              scale: 0.8, 
              rotateX: 20, 
              rotateY: isRtl ? -20 : 20,
              y: 20
            }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.25)] dark:shadow-[0_50px_100px_-20px_rgba(0,0,0,0.6)] overflow-hidden border border-white/20 dark:border-gray-700 p-8"
            style={{ perspective: '1000px' }}
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">{title}</h3>
                {subtitle && <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">{subtitle}</p>}
              </div>
              <button 
                onClick={onClose}
                className="p-3 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-2xl text-gray-400 dark:text-gray-500 transition-all active:scale-90"
              >
                <X size={20} />
              </button>
            </div>

            {/* Details Section */}
            {details && details.length > 0 && (
              <div className="grid grid-cols-2 gap-4 mb-8">
                {details.map((detail, idx) => (
                  <div key={idx} className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-700">
                    <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">{detail.label}</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{detail.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Actions Grid */}
            <div className="space-y-3">
              <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-1">{t.actions3d}</p>
              <div className="grid grid-cols-2 gap-3">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => { action.onClick(); onClose(); }}
                    className={`flex flex-col items-center justify-center gap-3 p-4 rounded-3xl transition-all active:scale-95 group border border-gray-50 dark:border-gray-700 hover:border-indigo-100 dark:hover:border-indigo-500/30 ${
                      action.color === 'rose' 
                        ? 'bg-rose-50/50 dark:bg-rose-900/10 hover:bg-rose-50 dark:hover:bg-rose-900/20' 
                        : 'bg-indigo-50/50 dark:bg-indigo-900/10 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                    }`}
                  >
                    <div className={`p-3 rounded-2xl shadow-sm group-hover:scale-110 transition-transform ${
                      action.color === 'rose'
                        ? 'bg-white dark:bg-gray-800 text-rose-600'
                        : 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400'
                    }`}>
                      {action.icon}
                    </div>
                    <span className={`text-xs font-bold ${
                      action.color === 'rose' ? 'text-rose-600' : 'text-gray-700 dark:text-gray-300'
                    }`}>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Bottom Insight */}
            <div className="mt-8 pt-6 border-t border-gray-50 dark:border-gray-700 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Info size={14} />
              </div>
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 leading-tight">
                {isRtl 
                  ? 'يتم تحديث البيانات لحظياً عبر قاعدة بيانات مستودعي.'
                  : 'Data is synchronized in real-time via Mostawdaee systems.'}
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
