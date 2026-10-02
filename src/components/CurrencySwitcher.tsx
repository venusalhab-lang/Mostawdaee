import React, { useState, useRef, useEffect } from 'react';
import { Coins, ChevronDown, Check, Sparkles } from 'lucide-react';
import { usePreferredCurrency, AVAILABLE_PRESCNT_CURRENCIES, UserPreferredCurrency } from './CurrencyContext';

interface CurrencySwitcherProps {
  isExpanded?: boolean;
  isRtl?: boolean;
}

export default function CurrencySwitcher({ isExpanded = true, isRtl = false }: CurrencySwitcherProps) {
  const { preferredCurrency, setPreferredCurrency } = usePreferredCurrency();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const activeCurrencyConfig = AVAILABLE_PRESCNT_CURRENCIES.find(c => c.code === preferredCurrency) 
    || AVAILABLE_PRESCNT_CURRENCIES[0];

  const handleSelect = (code: UserPreferredCurrency) => {
    try {
      setPreferredCurrency(code);
      setIsOpen(false);
    } catch (e) {
      console.error('[CurrencySwitcher Error]:', e);
    }
  };

  const getLabel = (currency: typeof AVAILABLE_PRESCNT_CURRENCIES[number]) => {
    if (currency.code === 'DEFAULT') {
      return isRtl ? 'العملة الافتراضية' : 'Default Base Currency';
    }
    return isRtl 
      ? `${currency.nameAr} (${currency.intCode} - ${currency.symbol})`
      : `${currency.nameEn} (${currency.intCode} - ${currency.symbol})`;
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      {/* Trigger Button with premium Glassmorphism */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        dir={isRtl ? 'rtl' : 'ltr'}
        className={`w-full flex items-center justify-between rounded-xl transition-all duration-300 cursor-pointer 
          text-slate-705 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-white/5 hover:text-slate-950 hover:dark:text-white p-2.5 
          ${isRtl ? 'flex-row-reverse text-right' : 'flex-row text-left'}
          ${isOpen ? 'bg-slate-100/70 dark:bg-white/5 ring-1 ring-indigo-500/30' : ''}
          ${isExpanded ? 'px-3.5' : 'justify-center px-2'}`}
        title={isRtl ? 'تغيير العملة المفضلة' : 'Select preferred currency'}
      >
        <div className={`flex items-center gap-4 min-w-0 ${isRtl ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className="relative">
            <Coins className="w-4.5 h-4.5 shrink-0 text-amber-500 dark:text-amber-400 transition-colors animate-pulse" />
            {preferredCurrency !== 'DEFAULT' && (
              <span className={`absolute -top-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse ${isRtl ? '-left-1' : '-right-1'}`} />
            )}
          </div>
          {isExpanded && (
            <div className={`min-w-0 flex flex-col leading-none gap-1 ${isRtl ? 'items-end text-right' : 'items-start text-left'}`}>
              <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                {isRtl ? 'العملة المعروضة' : 'Preferred Currency'}
              </span>
              <span className="text-xs font-black truncate max-w-[130px] text-slate-800 dark:text-slate-100 font-mono">
                {preferredCurrency === 'DEFAULT' 
                  ? (isRtl ? 'العملة المحلية' : 'Local Currency')
                  : `${activeCurrencyConfig.intCode} (${activeCurrencyConfig.symbol})`}
              </span>
            </div>
          )}
        </div>
        {isExpanded && (
          <ChevronDown 
            size={14} 
            className={`text-slate-400 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180' : ''}`} 
          />
        )}
      </button>

      {/* Elegant inline vertical accordion element to prevent clipping under overflow-hidden constraints */}
      {isOpen && (
        <div 
          dir={isRtl ? 'rtl' : 'ltr'}
          className="mt-2 p-1.5 w-full rounded-xl bg-slate-100/30 dark:bg-slate-950/40 border border-slate-200/40 dark:border-white/5 space-y-1 max-h-[180px] overflow-y-auto custom-scrollbar transition-all duration-300"
        >
          <div className={`p-1 px-2 pb-1.5 border-b border-slate-100/40 dark:border-white/5 flex items-center justify-between ${isRtl ? 'flex-row-reverse' : 'flex-row'}`}>
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
              {isRtl ? 'اختر العملة المفضلة' : 'Select Currency'}
            </span>
            <Sparkles size={11} className="text-amber-500 dark:text-amber-400 animate-pulse shrink-0" />
          </div>
          <div className="mt-1 space-y-1">
            {AVAILABLE_PRESCNT_CURRENCIES.map((currency) => {
              const isActive = preferredCurrency === currency.code;
              return (
                <button
                  key={currency.code}
                  type="button"
                  onClick={() => handleSelect(currency.code)}
                  dir={isRtl ? 'rtl' : 'ltr'}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-200 cursor-pointer
                    ${isRtl ? 'text-right flex-row-reverse' : 'text-left flex-row'}
                    ${isActive 
                      ? 'bg-indigo-650 text-white shadow-xs' 
                      : 'text-slate-705 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-white/5'}`}
                >
                  <div className={`flex items-center gap-1.5 min-w-0 ${isRtl ? 'flex-row-reverse' : 'flex-row'}`}>
                    {currency.code !== 'DEFAULT' && (
                      <span className={`w-4.5 h-4.5 shrink-0 rounded-md font-mono flex items-center justify-center text-[9px] font-black border transition
                        ${isActive 
                          ? 'bg-white/20 text-white border-white/20' 
                          : 'bg-slate-100 dark:bg-white/5 text-indigo-600 dark:text-indigo-400 border-slate-200/50 dark:border-white/5'}`}
                      >
                        {currency.symbol}
                      </span>
                    )}
                    {currency.code === 'DEFAULT' && (
                      <span className={`w-4.5 h-4.5 shrink-0 rounded-md text-[9px] font-serif flex items-center justify-center border transition
                        ${isActive 
                          ? 'bg-white/20 text-white border-white/20' 
                          : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-200/50 dark:border-white/5'}`}
                      >
                        ⚙️
                      </span>
                    )}
                    <span className="truncate text-left select-none max-w-[120px] font-medium">{getLabel(currency)}</span>
                  </div>
                  {isActive && <Check size={11} className="shrink-0 text-white ml-1" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
