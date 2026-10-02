import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check } from 'lucide-react';

interface SuccessVisualProps {
  show: boolean;
  onComplete?: () => void;
}

export default function SuccessVisual({ show, onComplete }: SuccessVisualProps) {
  return (
    <AnimatePresence onExitComplete={onComplete}>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
        >
          {/* Subtle Glow Backdrop */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1.5, opacity: 1 }}
            exit={{ scale: 2, opacity: 0 }}
            className="absolute w-64 h-64 bg-emerald-500/20 rounded-full blur-[80px]"
          />
          
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 1.2, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="relative bg-white dark:bg-gray-800 p-8 rounded-[2.5rem] shadow-2xl border border-emerald-100 dark:border-emerald-800 flex flex-col items-center gap-4"
          >
            <div className="relative">
              {/* Spinning Ring */}
              <motion.div
                initial={{ rotate: 0 }}
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 border-4 border-dashed border-emerald-200 dark:border-emerald-800 rounded-full"
              />
              
              <div className="w-20 h-20 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30">
                <Check size={40} strokeWidth={4} />
              </div>
            </div>
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-emerald-600 dark:text-emerald-400 font-black text-xl tracking-tight"
            >
              SUCCESS
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
