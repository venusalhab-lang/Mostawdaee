import React, { useState } from 'react';
import { Calculator, X, Minus, Plus, Divide, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function FloatingCalculator() {
  const [isOpen, setIsOpen] = useState(false);
  const [display, setDisplay] = useState('0');
  const [equation, setEquation] = useState('');

  const calculate = (expr: string) => {
    try {
      // Basic safe eval for calculator
      return Function(`'use strict'; return (${expr})`)();
    } catch {
      return 'Error';
    }
  };

  const handleInput = (val: string) => {
    if (display === '0' && val !== '.') {
      setDisplay(val);
    } else {
      setDisplay(display + val);
    }
  };

  const handleOperator = (op: string) => {
    setEquation(display + ' ' + op + ' ');
    setDisplay('0');
  };

  const handleEqual = () => {
    const result = calculate(equation + display);
    setDisplay(String(result));
    setEquation('');
  };

  const clear = () => {
    setDisplay('0');
    setEquation('');
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="mb-4 bg-white dark:bg-gray-800 rounded-[2rem] shadow-2xl border border-gray-100 dark:border-gray-700 w-72 overflow-hidden"
          >
            <div className="p-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
              <div className="flex items-center gap-2 text-gray-500">
                <Calculator size={16} />
                <span className="text-xs font-black uppercase tracking-widest">Calculator</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={16} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="text-right">
                <div className="text-[10px] text-gray-400 font-mono h-4">{equation}</div>
                <div className="text-3xl font-black font-mono text-gray-900 dark:text-white truncate">{display}</div>
              </div>
              
              <div className="grid grid-cols-4 gap-2">
                {['7', '8', '9', '/'].map(btn => (
                  <button 
                    key={btn}
                    onClick={() => btn === '/' ? handleOperator('/') : handleInput(btn)}
                    className="h-12 rounded-xl bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-black hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 transition-all active:scale-95"
                  >
                    {btn === '/' ? <Divide size={16} className="mx-auto" /> : btn}
                  </button>
                ))}
                {['4', '5', '6', '*'].map(btn => (
                  <button 
                    key={btn}
                    onClick={() => btn === '*' ? handleOperator('*') : handleInput(btn)}
                    className="h-12 rounded-xl bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-black hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 transition-all active:scale-95"
                  >
                    {btn === '*' ? <X size={14} className="mx-auto" /> : btn}
                  </button>
                ))}
                {['1', '2', '3', '-'].map(btn => (
                  <button 
                    key={btn}
                    onClick={() => btn === '-' ? handleOperator('-') : handleInput(btn)}
                    className="h-12 rounded-xl bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-black hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 transition-all active:scale-95"
                  >
                    {btn === '-' ? <Minus size={16} className="mx-auto" /> : btn}
                  </button>
                ))}
                {['0', 'C', '=', '+'].map(btn => (
                  <button 
                    key={btn}
                    onClick={() => {
                      if (btn === 'C') clear();
                      else if (btn === '=') handleEqual();
                      else if (btn === '+') handleOperator('+');
                      else handleInput(btn);
                    }}
                    className={`h-12 rounded-xl font-black transition-all active:scale-95 ${
                      btn === '=' 
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20' 
                        : 'bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600'
                    }`}
                  >
                    {btn === '+' ? <Plus size={16} className="mx-auto" /> : btn}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-indigo-600 text-white rounded-2xl shadow-xl shadow-indigo-100 dark:shadow-indigo-900/30 flex items-center justify-center hover:bg-indigo-700 transition-all"
      >
        <Calculator size={24} />
      </motion.button>
    </div>
  );
}
