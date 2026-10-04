import { CURRENCY_SYMBOLS, POS_CURRENCY_CODES, type PosCurrency } from '../lib/exchangeRates';

const NAMES: Record<PosCurrency, { ar: string; en: string }> = {
  JOD: { ar: 'دينار أردني', en: 'Jordanian dinar' },
  ILS: { ar: 'شيكل', en: 'Shekel' },
  USD: { ar: 'دولار أمريكي', en: 'US dollar' },
  IQD: { ar: 'دينار عراقي', en: 'Iraqi dinar' },
  SAR: { ar: 'ريال سعودي', en: 'Saudi riyal' },
  LYD: { ar: 'دينار ليبي', en: 'Libyan dinar' },
  EGP: { ar: 'جنيه مصري', en: 'Egyptian pound' },
};

interface CurrencyPickerProps {
  value: string;
  onChange: (code: PosCurrency) => void;
  isRtl?: boolean;
  label?: string;
}

export default function CurrencyPicker({ value, onChange, isRtl = false, label }: CurrencyPickerProps) {
  const selected = (POS_CURRENCY_CODES as readonly string[]).includes(value) ? (value as PosCurrency) : 'JOD';

  return (
    <div className="space-y-2" dir={isRtl ? 'rtl' : 'ltr'}>
      {label && (
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{label}</p>
      )}
      <p className="text-sm font-bold text-slate-900 dark:text-white">
        {isRtl ? 'العملة المحددة' : 'Selected'}
        {': '}
        <span className="font-mono text-emerald-600 dark:text-emerald-400">
          {selected} ({CURRENCY_SYMBOLS[selected]})
        </span>
        <span className="text-slate-500 font-medium"> — {isRtl ? NAMES[selected].ar : NAMES[selected].en}</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {POS_CURRENCY_CODES.map((code) => {
          const active = code === selected;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onChange(code)}
              className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-start transition-all cursor-pointer ${
                active
                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-emerald-400'
              }`}
            >
              <span className="font-mono text-sm font-black">
                {code} <span className={active ? 'text-white/90' : 'text-slate-400'}>{CURRENCY_SYMBOLS[code]}</span>
              </span>
              <span className={`text-[10px] font-bold ${active ? 'text-white/85' : 'text-slate-400'}`}>
                {isRtl ? NAMES[code].ar : NAMES[code].en}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
