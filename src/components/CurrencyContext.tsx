import React, { createContext, useContext, useState } from 'react';
import { CURRENCY_SYMBOLS, formatMoney } from '../lib/exchangeRates';

export type UserPreferredCurrency = 'DEFAULT' | 'ILS' | 'USD' | 'JOD' | 'SAR' | 'AED' | 'IQD' | 'LYD' | 'EGP';

export interface CurrencyConfig {
  code: UserPreferredCurrency;
  symbol: string;
  nameEn: string;
  nameAr: string;
  intCode: string;
}

export const AVAILABLE_PRESCNT_CURRENCIES: CurrencyConfig[] = [
  { code: 'DEFAULT', symbol: '⚙️', nameEn: 'Local Currency', nameAr: 'العملة الافتراضية', intCode: 'DEFAULT' },
  { code: 'ILS', symbol: '₪', nameEn: 'Shekel', nameAr: 'شيكل', intCode: 'ILS' },
  { code: 'USD', symbol: '$', nameEn: 'US Dollar', nameAr: 'دولار أمريكي', intCode: 'USD' },
  { code: 'JOD', symbol: 'د.أ', nameEn: 'Jordanian Dinar', nameAr: 'دينار أردني', intCode: 'JOD' },
  { code: 'SAR', symbol: 'ر.س', nameEn: 'Saudi Riyal', nameAr: 'ريال سعودي', intCode: 'SAR' },
  { code: 'AED', symbol: 'د.إ', nameEn: 'UAE Dirham', nameAr: 'درهم إماراتي', intCode: 'AED' },
  { code: 'IQD', symbol: 'د.ع', nameEn: 'Iraqi Dinar', nameAr: 'دينار عراقي', intCode: 'IQD' },
  { code: 'LYD', symbol: 'د.ل', nameEn: 'Libyan Dinar', nameAr: 'دينار ليبي', intCode: 'LYD' },
  { code: 'EGP', symbol: 'ج.م', nameEn: 'Egyptian Pound', nameAr: 'جنيه مصري', intCode: 'EGP' },
];

interface CurrencyContextType {
  preferredCurrency: UserPreferredCurrency;
  setPreferredCurrency: (cur: UserPreferredCurrency) => void;
  currentCurrency: UserPreferredCurrency;
  setCurrentCurrency: (cur: UserPreferredCurrency) => void;
  formatCurrencySymbol: (originalSymbol: string) => string;
  formatPrice: (amount: number, originalSymbol?: string) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preferredCurrency, setPreferredCurrencyState] = useState<UserPreferredCurrency>(() => {
    try {
      const saved = localStorage.getItem('mustawdae_preferred_currency');
      const validCodes = ['DEFAULT', 'ILS', 'USD', 'JOD', 'SAR', 'AED', 'IQD', 'LYD', 'EGP'];
      if (saved && validCodes.includes(saved)) {
        return saved as UserPreferredCurrency;
      }
    } catch (e) {
      console.error('[CurrencyContext] Error reading preferred currency:', e);
    }
    return 'DEFAULT';
  });

  const setPreferredCurrency = (cur: UserPreferredCurrency) => {
    try {
      if (!cur) return;
      setPreferredCurrencyState(cur);
      try {
        localStorage.setItem('mustawdae_preferred_currency', cur);
      } catch (e) {
        console.error('[CurrencyContext] Error saving preferred currency in localStorage:', e);
      }
    } catch (error) {
      console.error('[CurrencyContext] Critical error switching currency:', error);
    }
  };

  const currentCurrency = preferredCurrency;
  const setCurrentCurrency = setPreferredCurrency;

  const formatCurrencySymbol = (originalSymbol: string): string => {
    if (preferredCurrency === 'DEFAULT') {
      return originalSymbol;
    }
    const matching = AVAILABLE_PRESCNT_CURRENCIES.find(c => c.code === preferredCurrency);
    return matching ? matching.symbol : originalSymbol;
  };

  /**
   * Formats an amount in ITS OWN currency. The preferred currency selects which currency a screen
   * shows/filters, but must never relabel an amount that is stored in another currency
   * (that would show e.g. 100 JOD as "100 $").
   */
  const formatPrice = (amount: number, originalSymbol: string = '₪'): string => {
    const val = Number(amount) || 0;
    const knownCode = Object.keys(CURRENCY_SYMBOLS).find(code => CURRENCY_SYMBOLS[code] === originalSymbol);
    if (knownCode) return formatMoney(val, knownCode);

    const formattedNum = val.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return originalSymbol === '$' ? `$${formattedNum}` : `${formattedNum} ${originalSymbol}`;
  };

  return (
    <CurrencyContext.Provider value={{ preferredCurrency, setPreferredCurrency, currentCurrency, setCurrentCurrency, formatCurrencySymbol, formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const usePreferredCurrency = () => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('usePreferredCurrency must be used within a CurrencyProvider');
  }
  return context;
};
