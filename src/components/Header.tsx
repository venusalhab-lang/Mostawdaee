import React, { useState, useRef, useEffect } from 'react';
import { Coins, Menu, ChevronDown, Check, ShoppingCart } from 'lucide-react';
import { sounds } from '../lib/sounds';
import { toast } from 'sonner';
import Logo from './Logo';
import NotificationCenter from './NotificationCenter';
import { useFirebase } from './FirebaseProvider';
import { OFFLINE_QUEUE_EVENT, belongsToStore, readQueue } from '../lib/offlineQueue';

interface HeaderProps {
  isRtl: boolean;
  language: 'ar' | 'en';
  isMuted: boolean;
  onToggleMute: () => void;
  isClassDarkMode: boolean;
  onToggleDarkMode: () => void;
  preferredCurrency: string;
  onPreferredCurrencyChange: (currency: any) => void;
  onOpenSidebar: () => void;
  onChangeScreen?: (screen: string) => void;
  activeScreen?: string;
  /** Screen to restore when closing the AI assistant via the logo toggle. */
  assistantReturnScreen?: string;
  /** Days left on active trial/premium; null skips the subscription notice. */
  subscriptionDaysRemaining?: number | null;
  style?: React.CSSProperties;
}

const CURRENCIES = [
  { code: 'JOD', symbol: 'د.أ', label: 'دينار أردني', sub: 'Jordanian Dinar', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/20' },
  { code: 'USD', symbol: '$', label: 'دولار أمريكي', sub: 'US Dollar', color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/20' },
  { code: 'ILS', symbol: '₪', label: 'شيكل', sub: 'Shekel', color: 'text-sky-500 bg-sky-50 dark:bg-sky-950/40 border border-sky-200/20' },
  { code: 'SAR', symbol: 'ر.س', label: 'ريال سعودي', sub: 'Saudi Riyal', color: 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 border border-teal-200/20' },
  { code: 'IQD', symbol: 'د.ع', label: 'دينار عراقي', sub: 'Iraqi Dinar', color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/20' },
  { code: 'AED', symbol: 'د.إ', label: 'درهم إماراتي', sub: 'UAE Dirham', color: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200/20' },
  { code: 'LYD', symbol: 'د.ل', label: 'دينار ليبي', sub: 'Libyan Dinar', color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 border border-purple-200/20' },
  { code: 'EGP', symbol: 'ج.م', label: 'جنيه مصري', sub: 'Egyptian Pound', color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/20' },
  { code: 'DEFAULT', symbol: '⚙️', label: 'افتراضي النظام', sub: 'System Default', color: 'text-slate-500 bg-slate-50 dark:bg-slate-900 border border-slate-200' }
];

export default function Header({
  isRtl,
  language,
  isMuted,
  onToggleMute,
  isClassDarkMode,
  onToggleDarkMode,
  preferredCurrency,
  onPreferredCurrencyChange,
  onOpenSidebar,
  onChangeScreen,
  activeScreen,
  assistantReturnScreen = 'dashboard',
  subscriptionDaysRemaining = null,
  style
}: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasLongPressedRef = useRef(false);
  const { canOpenScreen, user, workspace } = useFirebase();
  const assistantAllowed = canOpenScreen('ai-assistant');

  // Long press on Logo state
  const [isPressing, setIsPressing] = useState(false);
  const [pressProgress, setPressProgress] = useState(0);
  const longPressTimerRef = useRef<any>(null);
  const progressIntervalRef = useRef<any>(null);

  // Connection status tracking with navigator.onLine API
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [pendingOffline, setPendingOffline] = useState(0);

  useEffect(() => {
    const refreshPending = () => {
      const uid = user?.uid;
      if (!uid) {
        setPendingOffline(0);
        return;
      }
      const ownerId = workspace?.ownerId;
      const queue = readQueue(uid);
      setPendingOffline(ownerId ? queue.filter((entry) => belongsToStore(entry, ownerId)).length : queue.length);
    };
    refreshPending();
    const onQueue = (event: Event) => {
      const detailUid = (event as CustomEvent<{ uid?: string }>).detail?.uid;
      if (!detailUid || detailUid === user?.uid) refreshPending();
    };
    window.addEventListener(OFFLINE_QUEUE_EVENT, onQueue);
    window.addEventListener('storage', refreshPending);
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, onQueue);
      window.removeEventListener('storage', refreshPending);
    };
  }, [user?.uid, workspace?.ownerId]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success(isRtl ? "عاد الاتصال." : "Back online.", {
        id: 'conn-status-toast'
      });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.error(isRtl ? "لا يوجد اتصال. البيع غير الآجل يُحفظ على الجهاز ويُرسل لاحقاً؛ باقي العمليات تحتاج اتصالاً" : "No connection. Non-credit sales are saved on this device and sent later; other actions need a connection", {
        id: 'conn-status-toast'
      });
    };

    const handleQuotaExceeded = () => {
      setIsQuotaExceeded(true);
      toast.error(isRtl
        ? 'امتلأت ذاكرة الجهاز. أفرغ مساحة أو احذف نسخاً قديمة حتى لا تُفقد مبيعات الأوفلاين.'
        : 'This device is out of storage. Free space or remove old backups so offline sales are not lost.',
        { id: 'quota-exceeded', duration: 10000 });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('firestore-quota-exceeded', handleQuotaExceeded);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('firestore-quota-exceeded', handleQuotaExceeded);
    };
  }, [isRtl]);

  const startPress = (e: React.MouseEvent | React.TouchEvent) => {
    if (!assistantAllowed) return;
    // Left-click only for mouse events
    if ('button' in e && e.button !== 0) return;
    
    setIsPressing(true);
    setPressProgress(0);
    hasLongPressedRef.current = false;
    
    const duration = 750; // hold duration
    const startTime = Date.now();
    
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);
      setPressProgress(progress);
      if (progress >= 100) {
        clearInterval(progressInterval);
      }
    }, 16);
    progressIntervalRef.current = progressInterval;

    longPressTimerRef.current = setTimeout(() => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      sounds.playSuccess();
      hasLongPressedRef.current = true;
      if (onChangeScreen) {
        onChangeScreen('ai-assistant');
      }
      setIsPressing(false);
      setPressProgress(0);
    }, duration);
  };

  const endPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setIsPressing(false);
    setPressProgress(0);
  };

  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  }, []);

  const handleLogoClick = () => {
    if (!assistantAllowed) return;
    if (hasLongPressedRef.current) {
      hasLongPressedRef.current = false;
      return;
    }
    sounds.playClick();
    if (onChangeScreen) {
      onChangeScreen(activeScreen === 'ai-assistant' ? (assistantReturnScreen || 'dashboard') : 'ai-assistant');
    }
  };

  const handleQuickPOSClick = () => {
    sounds.playClick();
    onChangeScreen?.('pos');
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const currentCurrencyObj = CURRENCIES.find(c => c.code === preferredCurrency) || CURRENCIES.find(c => c.code === 'DEFAULT') || CURRENCIES[0];

  const handleCurrencySelect = (code: string) => {
    sounds.playClick();
    onPreferredCurrencyChange(code);
    setDropdownOpen(false);
  };

  return (
    <>
      <div 
        className="app-header bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-2.5 sm:px-6 py-2.5 sm:py-3.5 pt-[max(0.625rem,env(safe-area-inset-top))] flex items-center justify-between gap-2 sm:gap-4 z-30 sticky top-0 shadow-sm min-w-0"
        id="top-navigation-row"
        dir={isRtl ? 'rtl' : 'ltr'}
        style={style}
      >
      {/* 1. Left Section: Hamburger Menu (for smaller screens) & Branding */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        {/* Hamburger Trigger Button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            sounds.playClick();
            onOpenSidebar();
          }}
          className="p-2 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer active:scale-95 shrink-0 flex items-center justify-center mentoring-open-sidebar"
          data-sidebar-toggle=""
          title={isRtl ? 'فتح القائمة الجانبية' : 'Open Sidebar'} aria-label={isRtl ? 'فتح القائمة الجانبية' : 'Open Sidebar'}
        >
          <Menu className="w-5.5 h-5.5" />
        </button>

        {/* Brand Logo & Title */}
        <div className="flex items-center gap-2.5">
          <div 
            onMouseDown={startPress}
            onMouseUp={endPress}
            onMouseLeave={endPress}
            onTouchStart={startPress}
            onTouchEnd={endPress}
            onClick={handleLogoClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLogoClick(); } }}
            role={assistantAllowed ? 'button' : undefined}
            tabIndex={assistantAllowed ? 0 : undefined}
            aria-label={assistantAllowed ? (isRtl ? 'المساعد' : 'Assistant') : undefined}
            aria-pressed={assistantAllowed ? activeScreen === 'ai-assistant' : undefined}
            className={`relative w-10 h-10 rounded-[12px] bg-slate-100/60 dark:bg-white/5 border border-slate-300 dark:border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.03)] dark:shadow-[0_0_15px_rgba(255,255,255,0.04)] flex items-center justify-center transition-all duration-300 shrink-0 select-none overflow-hidden ${assistantAllowed ? 'cursor-pointer' : ''} ${isPressing ? 'scale-90 bg-indigo-50 dark:bg-indigo-950/20' : assistantAllowed ? 'hover:scale-105 active:scale-95' : ''}`}
            title={assistantAllowed ? (isRtl ? 'المساعد' : 'Assistant') : undefined}
          >
            {/* Visual Long-Press Progress Bar Overlay representing fill-up */}
            {isPressing && (
              <div 
                className="absolute left-0 right-0 bottom-0 bg-gradient-to-t from-indigo-500/20 to-cyan-500/10 transition-all duration-75"
                style={{ height: `${pressProgress}%` }}
              />
            )}
            
            <Logo 
              size={26} 
              animate3d={!isPressing} 
              className={`shrink-0 text-slate-900 dark:text-cyan-400 font-black transition-transform ${isPressing ? 'scale-95 rotate-12' : ''}`} 
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm md:text-base lg:text-lg font-extrabold text-slate-900 dark:text-white tracking-normal leading-relaxed [padding-inline:0.08em] truncate max-w-[6.5rem] min-[380px]:max-w-[9rem] sm:max-w-none">
              <span className="font-arabic">{isRtl ? 'مستودعي' : 'Mostawdaee'}</span>
            </h1>
            {/* Visual synchronization status indicator */}
            <div className={`flex items-center gap-1 mt-0.5 select-none flex-wrap`}>
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                {isOnline && pendingOffline === 0 && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400"></span>
                )}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                  !isOnline ? 'bg-rose-600' : pendingOffline > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}></span>
              </span>
              <span className={`text-[9px] font-extrabold tracking-tight font-arabic ${
                !isOnline
                  ? 'text-rose-600 dark:text-rose-500'
                  : pendingOffline > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
              }`}>
                {!isOnline
                  ? (isRtl ? 'أوفلاين' : 'Offline')
                  : pendingOffline > 0
                    ? (isRtl ? `${pendingOffline} بانتظار الإرسال` : `${pendingOffline} pending`)
                    : (isRtl ? 'متصل' : 'Online')}
              </span>
              {isQuotaExceeded && (
                <span className="text-[9px] font-extrabold text-rose-600 dark:text-rose-400 font-arabic">
                  {isRtl ? '· الذاكرة ممتلئة' : '· Storage full'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Right Section: keep mute + dark mode visible on narrow phones */}
      <div className="flex items-center gap-1 sm:gap-2.5 shrink-0 max-w-[62%] sm:max-w-none flex-wrap justify-end">
        {/* Direct Quick POS Launcher Action (As requested by Scaffold actions) */}
        <button
          type="button"
          onClick={handleQuickPOSClick}
          className="flex items-center justify-center gap-1 sm:gap-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-full w-8 h-8 sm:w-auto sm:pl-3.5 sm:pr-4 sm:py-2 transition-all shadow-md shadow-indigo-600/10 hover:shadow-indigo-600/20 cursor-pointer select-none shrink-0 border border-indigo-500/20 text-xs font-black font-arabic"
          title={isRtl ? 'بيع' : 'Sell'} aria-label={isRtl ? 'بيع' : 'Sell'}
        >
          <ShoppingCart className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 stroke-[2.5]" />
          <span className="hidden sm:inline">
            {isRtl ? 'بيع' : 'Sell'}
          </span>
        </button>

        <NotificationCenter
          isRtl={isRtl}
          subscriptionDaysRemaining={subscriptionDaysRemaining}
          onNavigate={onChangeScreen}
        />

        {/* Mute + dark first on the trailing edge so they are never clipped off-screen */}
        <button
          type="button"
          onClick={onToggleMute}
          className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border transition-all active:scale-95 cursor-pointer shrink-0 order-10 sm:order-none ${
            isMuted 
              ? 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-600' 
              : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400'
          }`}
          title={isRtl ? 'كتم/تفعيل صوت التنبيهات' : 'Toggle Audio System'} aria-label={isRtl ? 'كتم/تفعيل صوت التنبيهات' : 'Toggle Audio System'}
        >
          {isMuted ? (
            <svg className="w-4 h-4 sm:w-4.5 sm:h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg className="w-4 h-4 sm:w-4.5 sm:h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 18.75V5.25L7.75 9.5H4.5v5h3.25L12 18.75z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleDarkMode}
          className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border transition-all active:scale-95 cursor-pointer shrink-0 order-11 sm:order-none ${
            isClassDarkMode 
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20' 
              : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-500 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-500'
          }`}
          title={isRtl ? 'الوضع الداكن' : 'Night Mode'} aria-label={isRtl ? 'الوضع الداكن' : 'Night Mode'}
        >
          {isClassDarkMode ? (
            <svg className="w-4 h-4 sm:w-4.5 sm:h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 sm:w-4.5 sm:h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

        {/* Control 2: currency — icon-only on phones to free space for mute/dark */}
        <div className="relative order-5 sm:order-none" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              setDropdownOpen(!dropdownOpen);
            }}
            className="flex items-center gap-1 sm:gap-1.5 bg-slate-100 hover:bg-slate-100 active:scale-95 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/85 rounded-full w-8 h-8 sm:w-auto justify-center sm:pl-3.5 sm:pr-4 sm:py-1.5 transition-all shadow-sm cursor-pointer select-none"
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            title={isRtl ? 'تبديل العملة المعروضة' : 'Switch Preferred Currency'} aria-label={isRtl ? 'تبديل العملة المعروضة' : 'Switch Preferred Currency'}
          >
            {/* Custom Visual Concept: Stylized Credit Cards & Dynamic Trans-Currency 3D Exchange Asset */}
            <div className="relative w-4 h-4 sm:w-[22px] sm:h-[22px] flex items-center justify-center shrink-0">
              {/* Glowing ambient background circle */}
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 to-amber-500/10 rounded-full blur-[4px] animate-pulse" />
              
              <svg 
                viewBox="0 0 32 32" 
                fill="none" 
                className="w-full h-full relative z-10 transition-transform duration-500 hover:scale-110 select-none"
              >
                <defs>
                  <linearGradient id="artCardGradPrimary" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4f46e5" />
                    <stop offset="100%" stopColor="#3730a3" />
                  </linearGradient>
                  <linearGradient id="artCardGradSecondary" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#b45309" />
                  </linearGradient>
                  <linearGradient id="artGlowHighlight" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00e5ff" />
                    <stop offset="100%" stopColor="#818cf8" />
                  </linearGradient>
                </defs>

                {/* Back slanted card (Indigo premium global stock style) */}
                <rect 
                  x="3" 
                  y="7" 
                  width="18" 
                  height="12" 
                  rx="2.5" 
                  transform="rotate(-15 12 13)" 
                  fill="url(#artCardGradPrimary)" 
                  stroke="#ffffff" 
                  strokeWidth="0.75"
                  strokeOpacity="0.4"
                  opacity="0.9"
                />
                <path 
                  d="M2 11 L17 7" 
                  stroke="#fef08a" 
                  strokeWidth="1.2" 
                  strokeOpacity="0.75" 
                />
                
                {/* Front slanted card overlapping (Exchange & gold theme) */}
                <rect 
                  x="11" 
                  y="12" 
                  width="18" 
                  height="12" 
                  rx="2.5" 
                  transform="rotate(10 20 18)" 
                  fill="url(#artCardGradSecondary)" 
                  stroke="#ffffff" 
                  strokeWidth="1.2"
                  strokeOpacity="0.7"
                />
                
                {/* Simulating micro hardware chip */}
                <rect 
                  x="14" 
                  y="16" 
                  width="3.5" 
                  height="3" 
                  rx="0.6" 
                  fill="#fff" 
                  transform="rotate(10 15.5 17.5)" 
                  opacity="0.9"
                />

                {/* Overlapping dynamic exchange loops / glowing arrowheads */}
                <path 
                  d="M6 24 C11 29, 21 29, 26 24" 
                  stroke="url(#artGlowHighlight)" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                />
                <path 
                  d="M26 24 L21 24.5 M26 24 L25.5 20" 
                  stroke="url(#artGlowHighlight)" 
                  strokeWidth="1.75" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />

                <path 
                  d="M26 8 C21 3, 11 3, 6 8" 
                  stroke="#10b981" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                />
                <path 
                  d="M6 8 L11 7.5 M6 8 L6.5 12" 
                  stroke="#10b981" 
                  strokeWidth="1.75" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <span className="hidden sm:inline text-[10px] sm:text-xs font-black text-slate-800 dark:text-slate-100 font-sans tracking-tight">
              {currentCurrencyObj.code} <span className="opacity-85 font-normal">{currentCurrencyObj.symbol}</span>
            </span>
            <ChevronDown className={`hidden sm:block w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-slate-400 dark:text-slate-500 transition-transform duration-300 ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <div 
              className={`fixed sm:absolute z-[70] inset-x-3 top-[calc(env(safe-area-inset-top)+3.75rem)] sm:inset-x-auto sm:top-full sm:mt-2 w-auto sm:w-52 md:w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden py-1.5 animate-in fade-in slide-in-from-top-2 duration-200 ${
                isRtl ? 'sm:left-0' : 'sm:right-0'
              }`}
            >
              <div className="px-3 py-1.5 text-[10px] font-extrabold text-slate-400 dark:text-slate-500 tracking-wider uppercase border-b border-slate-100 dark:border-slate-800 mb-1 font-sans">
                {isRtl ? 'اختر عملة النظام' : 'Select system currency'}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {CURRENCIES.map((curr) => {
                  const isSelected = curr.code === preferredCurrency;
                  return (
                    <button
                      key={curr.code}
                      type="button"
                      onClick={() => handleCurrencySelect(curr.code)}
                      className={`w-full px-3 py-2 flex items-center justify-between text-right hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all font-sans cursor-pointer ${
                        isSelected ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-6.5 h-6.5 rounded-lg flex items-center justify-center font-extrabold text-xs shrink-0 ${curr.color}`}>
                          {curr.symbol}
                        </span>
                        <div className="text-left">
                          <span className="block text-xs font-black text-slate-800 dark:text-slate-100 leading-none">
                            {curr.code}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 block leading-none mt-0.5 font-normal">
                            {curr.sub}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold font-arabic text-slate-700 dark:text-slate-300">
                          {curr.label}
                        </span>
                        {isSelected && (
                          <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
