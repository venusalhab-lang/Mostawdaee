import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchLiveUsdRates } from '../lib/exchangeRates';

interface TickerItem {
  pair: string;
  rate: number;
  /** Real move since the first reading of the day; null when there is no baseline yet (never invented). */
  change: number | null;
}

const BASELINE_KEY = 'mustawdae_ticker_baseline';

/** Baseline = first live reading of the current day, stored locally so the arrows reflect real movement. */
function loadBaseline(current: Record<string, number>): Record<string, number> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null');
    if (raw && raw.day === today && raw.rates) return raw.rates;
  } catch (e) { /* ignore corrupt baseline */ }
  try { localStorage.setItem(BASELINE_KEY, JSON.stringify({ day: today, rates: current })); } catch (e) { /* storage full/unavailable */ }
  return current;
}

interface CurrencyTickerProps {
  isRtl: boolean;
  style?: React.CSSProperties;
}

const FALLBACK_RATES: TickerItem[] = [
  { pair: 'USD/JOD', rate: 0.7090, change: null },
  { pair: 'JOD/USD', rate: 1.4104, change: null },
  { pair: 'USD/ILS', rate: 3.6950, change: null },
  { pair: 'ILS/USD', rate: 0.2706, change: null },
  { pair: 'JOD/ILS', rate: 5.2116, change: null },
  { pair: 'ILS/JOD', rate: 0.1919, change: null },
  { pair: 'USD/SAR', rate: 3.7512, change: null },
  { pair: 'SAR/JOD', rate: 0.1890, change: null },
  { pair: 'USD/AED', rate: 3.6730, change: null },
  { pair: 'USD/EGP', rate: 47.4500, change: null },
  { pair: 'JOD/EGP', rate: 66.9200, change: null }
];

export default function CurrencyTicker({ isRtl, style }: CurrencyTickerProps) {
  const [rates, setRates] = useState<TickerItem[]>(FALLBACK_RATES);
  const [loading, setLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>(() => (typeof navigator !== 'undefined' && navigator.language?.startsWith('ar') ? 'أسعار مخزّنة (غير محدّثة)' : 'Cached rates (not live)'));

  const fetchRates = async () => {
    try {
      const newRates = await fetchLiveUsdRates();
      if (!newRates) throw new Error('rates unavailable');
      if (newRates) {
        // Calculate cross rates based on standard USD base
        const jod = newRates.JOD || 0.709;
        const ils = newRates.ILS || 3.695;
        const sar = newRates.SAR || 3.751;
        const aed = newRates.AED || 3.673;
        const egp = newRates.EGP || 47.45;

        const base: Array<{ pair: string; rate: number }> = [
          { pair: 'USD/JOD', rate: Number(jod.toFixed(4)) },
          { pair: 'JOD/USD', rate: Number((1 / jod).toFixed(4)) },
          { pair: 'USD/ILS', rate: Number(ils.toFixed(4)) },
          { pair: 'ILS/USD', rate: Number((1 / ils).toFixed(4)) },
          { pair: 'JOD/ILS', rate: Number((ils / jod).toFixed(4)) },
          { pair: 'ILS/JOD', rate: Number((jod / ils).toFixed(4)) },
          { pair: 'USD/SAR', rate: Number(sar.toFixed(4)) },
          { pair: 'SAR/JOD', rate: Number((jod / sar).toFixed(4)) },
          { pair: 'USD/AED', rate: Number(aed.toFixed(4)) },
          { pair: 'USD/EGP', rate: Number(egp.toFixed(3)) },
          { pair: 'JOD/EGP', rate: Number((egp / jod).toFixed(3)) },
        ];
        const baseline = loadBaseline(Object.fromEntries(base.map(b => [b.pair, b.rate])));
        const liveItems: TickerItem[] = base.map(b => ({
          pair: b.pair,
          rate: b.rate,
          change: baseline[b.pair] !== undefined ? Number((b.rate - baseline[b.pair]).toFixed(4)) : null,
        }));

        setRates(liveItems);
        setIsLive(true);
        const formatTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastUpdated(formatTime);
      }
    } catch (error) {
      console.warn('Currency ticker API error, employing fallback rates:', error);
      setIsLive(false);
    }
  };

  useEffect(() => {
    fetchRates();
    // Update rates automatically every 5 minutes (300,000 ms) as requested
    const interval = setInterval(fetchRates, 300000);
    // Cleanup active timer upon component unmount
    return () => clearInterval(interval);
  }, []);

  const TickerList = ({ isClone = false }: { isClone?: boolean }) => (
    <div 
      className="flex items-center gap-10 shrink-0 min-w-full justify-around animate-[marquee_40s_linear_infinite]"
      style={{
        contentVisibility: 'auto'
      }}
      aria-hidden={isClone ? "true" : undefined}
    >
      {rates.map((item, idx) => (
        <div 
          key={`${item.pair}-${isClone ? 'clone' : 'main'}-${idx}`} 
          className="inline-flex items-center gap-2.5 font-mono"
        >
          {/* Visual Exchange Pair Badge */}
          <span className="text-slate-200 font-extrabold text-[11px] uppercase tracking-wider bg-slate-800/65 px-2 py-0.5 rounded-lg border border-slate-700/30">
            {item.pair}
          </span>

          {/* Exchange Rate */}
          <span className="text-white font-black text-xs leading-none">
            {item.rate.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 4 })}
          </span>

          {/* Real movement since today's first reading (hidden when unknown or unchanged) */}
          {item.change !== null && item.change !== 0 && (
            <span
              title={isRtl ? 'التغير منذ أول قراءة اليوم' : 'Change since the first reading today'}
              className={`inline-flex items-center gap-0.5 font-extrabold text-[10px] ${
                item.change > 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {item.change > 0 ? '▲' : '▼'}
              <span>{item.change > 0 ? '+' : '-'}{Math.abs(item.change).toFixed(4)}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div 
      style={style}
      className="w-full bg-[#070d1d] text-white border-b border-indigo-950/40 py-2 px-4 flex items-center justify-between text-xs font-sans relative overflow-hidden select-none z-20 h-9 sm:h-10 shadow-[inset_0_-1px_3px_rgba(0,0,0,0.4)]"
      id="live-currency-exchange-ticker"
    >
      {/* 1. Source label: live only when the last fetch succeeded */}
      <div 
        className={`flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-600 text-white rounded-lg font-black text-[10px] tracking-wider z-10 shadow-md relative shrink-0 ${
          isRtl ? 'ml-4' : 'mr-4'
        }`}
      >
        <div className="relative flex h-1.5 w-1.5">
          {isLive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>}
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isLive ? 'bg-cyan-400' : 'bg-amber-400'}`}></span>
        </div>
        <span className="font-arabic uppercase leading-none">
          {isLive ? (isRtl ? 'أسعار مباشرة' : 'LIVE RATES') : (isRtl ? 'أسعار تقريبية' : 'APPROX. RATES')}
        </span>
      </div>

      {/* 2. Absolute Seamless Double-Buffering Marquee Loop */}
      <div className="flex-1 overflow-hidden relative flex items-center h-full" dir="ltr">
        {loading ? (
          <div className="text-[10px] text-slate-400 font-medium animate-pulse flex items-center gap-1 w-full justify-center">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            <span>{isRtl ? 'جارٍ مزامنة أسعار الصرف العالمية...' : 'Synchronizing live global exchange rates...'}</span>
          </div>
        ) : (
          <div className="flex w-full overflow-hidden relative">
            <TickerList isClone={false} />
            <TickerList isClone={true} />
          </div>
        )}
      </div>

      {/* 3. Timestamp update badge */}
      {lastUpdated && !loading && (
        <div className={`hidden lg:flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 font-bold shrink-0 z-10 bg-[#070d1d] px-2.5 ${
          isRtl ? 'pr-4 border-r border-slate-800' : 'pl-4 border-l border-slate-800'
        }`}>
          <RefreshCw className="w-2.5 h-2.5 text-cyan-400 hover:rotate-180 transition-all cursor-pointer mr-0.5" onClick={fetchRates} />
          <span className="font-sans font-normal opacity-85 text-[9px] uppercase tracking-wider">{isRtl ? 'محدّث ' : 'REFRESHED: '}{lastUpdated}</span>
        </div>
      )}

      {/* Inject precise smooth linear transition style to keep animation flawlessly fluid */}
      <style>{`
        @keyframes marquee {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(-100%, 0, 0);
          }
        }
      `}</style>
    </div>
  );
}
