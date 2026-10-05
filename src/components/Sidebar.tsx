import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  Settings, 
  Globe, 
  Package, 
  X, 
  LogOut,
  FileText,
  Users,
  Briefcase,
  Barcode,
  Lock,
  Unlock,
  Zap,
  Shield,
  Building2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  ShoppingBag,
  TrendingUp,
  Calculator,
  ClipboardCheck,
  Banknote
} from 'lucide-react';
import Logo from './Logo';
import CurrencySwitcher from './CurrencySwitcher';
import { Language } from '../types';
import { translations } from '../translations';
import { motion, AnimatePresence } from 'motion/react';
import { useFirebase } from './FirebaseProvider';
import { Search } from 'lucide-react';
import GlobalSearch from './GlobalSearch';
import { useDeviceType } from '../hooks/useDeviceType';
import { sounds } from '../lib/sounds';
interface SidebarProps {
  language: Language;
  onLanguageToggle: () => void;
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
  isOpen: boolean; 
  onClose: () => void;
  userName: string;
  businessName: string;
  onLogout: () => void;
  onExpandedChange?: (expanded: boolean) => void;
}

interface MenuItem {
  id: string;
  icon: React.ComponentType<any>;
  label: string;
}

export default function Sidebar({ 
  language, 
  onLanguageToggle, 
  activeScreen, 
  setActiveScreen,
  isOpen,
  onClose,
  userName,
  businessName,
  onLogout,
  onExpandedChange
}: SidebarProps) {
  const t = translations[language];
  const isRtl = language === 'ar';

  const { isMobile } = useDeviceType();
  const [isHovered, setIsHovered] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [brandHovered, setBrandHovered] = useState(false);
  
  
  // State for Long Press Interactions (تفاعل الضغط المطول)
  const [holdingItemId, setHoldingItemId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState<number>(0);
  const [superChargedItems, setSuperChargedItems] = useState<Record<string, boolean>>({});
  const [clickCount, setClickCount] = useState<number>(0);

  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { user, canOpenScreen } = useFirebase();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Expand criteria: Expanded if mobile view, or if hovered, or if locked by logo toggle
  const isExpanded = isMobile ? true : (isHovered || isLocked);

  // Propagate expanded state to parent layout
  useEffect(() => {
    if (onExpandedChange) {
      onExpandedChange(isExpanded);
    }
  }, [isExpanded, onExpandedChange]);

  const focusSearch = () => {
    setIsLocked(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  useEffect(() => {
    if (isMobile) return;
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (isExpanded) searchInputRef.current?.focus();
        else focusSearch();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [isMobile, isExpanded]);

  const menuItems: MenuItem[] = [
    { id: 'dashboard', icon: LayoutDashboard, label: t.dashboard },
    { id: 'pos', icon: Barcode, label: t.pos },
    { id: 'inventory', icon: Package, label: isRtl ? "إدارة المنتجات" : t.inventory },
    { id: 'inventory-audit', icon: ClipboardCheck, label: isRtl ? "الجرد والتسوية" : "Stocktaking" },
    { id: 'warehouses', icon: Building2, label: isRtl ? "إدارة المستودعات" : "Warehouses System" },
    { id: 'invoices', icon: FileText, label: t.invoices },
    { id: 'customers', icon: Users, label: isRtl ? "العملاء والديون" : "Customers & Debt" },
    { id: 'cheques', icon: Banknote, label: isRtl ? "إدارة الشيكات" : "Cheques" },
    { id: 'employees', icon: Briefcase, label: isRtl ? "الموظفين والرواتب" : "Employees & Payroll" },
    { id: 'vault', icon: Shield, label: t.vault },
    { id: 'purchases-expenses', icon: ShoppingBag, label: isRtl ? "المشتريات والمصاريف" : "Purchases & Expenses" },
    { id: 'profits-dashboard', icon: TrendingUp, label: isRtl ? "سجل الأرباح" : "Profits Log" },
    { id: 'landed-cost', icon: Calculator, label: isRtl ? "تكلفة الاستيراد" : "Landed Cost" },
    { id: 'google-drive', icon: Cloud, label: isRtl ? "النسخ الاحتياطي والأمان" : "Backup & Security" },
    { id: 'admin-dashboard', icon: Shield, label: isRtl ? "لوحة فريق مستودعي" : "Mostawdaee Console" },
    { id: 'settings', icon: Settings, label: t.settings },
  ];

  const filteredMenuItems = menuItems.filter(item => canOpenScreen(item.id));

  // Toggle Lock State
  const handleLogoToggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLocked(!isLocked);
  };

  // Adaptive interactive 3D tilt tracking for mouse controls with responsive limits
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    
    // Calculate fractional mouse coordinates relative to the sidebar center (-0.5 to 0.5)
    const mouseX = (e.clientX - rect.left) / width - 0.5;
    const mouseY = (e.clientY - rect.top) / height - 0.5;
    
    // Smooth 3D tilt angles tailored for a comfortable responsive feel
    setTilt({
      x: mouseY * -14, // Tilt rotation on the X-axis
      y: mouseX * 14,  // Tilt rotation on the Y-axis
    });
  };

  // Reset 3D Tilt on Mouse Leave with smooth fallback transitions
  const handleMouseLeave = () => {
    setIsHovered(false);
    setTilt({ x: 0, y: 0 });
    cancelHold();
  };

  // -- LONG PRESS HANDLERS (تفاعل الضغط المطول الذكي على الأيقونات) --
  const startHold = (itemId: string) => {
    cancelHold();
    setHoldingItemId(itemId);
    setHoldProgress(0);

    // Dynamic incremental timer for progress ring filling up
    let progress = 0;
    progressIntervalRef.current = setInterval(() => {
      progress += 4;
      if (progress >= 100) {
        progress = 100;
        clearInterval(progressIntervalRef.current!);
      }
      setHoldProgress(progress);
    }, 20);

    // Timeout (500ms) to trigger the Phosphorescent Super-Neon Charge!
    holdTimerRef.current = setTimeout(() => {
      setSuperChargedItems(prev => ({
        ...prev,
        [itemId]: !prev[itemId] // Toggle super-charge state on successful hold
      }));
      
      // Reset indicator
      setHoldingItemId(null);
      setHoldProgress(0);
      
      // Interactive haptic vibration simulation or simple flash
      if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(80);
      }
    }, 500);
  };

  const cancelHold = () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setHoldingItemId(null);
    setHoldProgress(0);
  };

  // Pure Interactive 3D transformation matrices adjusted for responsive UX
  const transformStyle = isMobile 
    ? {} 
    : {
        perspective: 1200,
        transformOrigin: 'center center',
        transform: isHovered 
          ? `perspective(1200px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateZ(12px) scale(1.012)` 
          : `perspective(1200px) rotateX(0deg) rotateY(${isRtl ? '0.5deg' : '-0.5deg'}) translateZ(0px)`,
        transition: isHovered 
          ? 'transform 0.1s cubic-bezier(0.25, 0.8, 0.25, 1)' 
          : 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.5s ease',
      };

  return (
    <>
      {/* Embedded CSS for custom phosphorescent animations */}
      <style>{`
        @keyframes phosphorphulse {
          0%, 100% {
            box-shadow: 0 0 16px rgba(6, 182, 212, 0.15), inset 0 0 8px rgba(6, 182, 212, 0.05);
            border-color: rgba(6, 182, 212, 0.25);
          }
          50% {
            box-shadow: 0 0 30px rgba(6, 182, 212, 0.45), 0 0 10px rgba(16, 185, 129, 0.22), inset 0 0 16px rgba(6, 182, 212, 0.15);
            border-color: rgba(6, 182, 212, 0.55);
          }
        }
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes float-particle {
          0% { transform: translateY(0px) scale(0.8) rotate(0deg); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateY(-40px) scale(1.1) rotate(180deg); opacity: 0; }
        }
        .animate-phosphor-breathing {
          animation: phosphorphulse 3s infinite ease-in-out;
        }
        .gradient-text-shimmer {
          background-size: 200% auto;
          animation: gradientShift 4s linear infinite;
        }
        .particle-neon {
          position: absolute;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 8px #22c55e;
          pointer-events: none;
          animation: float-particle 1.2s infinite linear;
        }
      `}</style>

      {/* Floating Sidebar Backdrop with sleek motion fade for Mobile view */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/30 dark:bg-slate-950/60 backdrop-blur-xs z-[200] select-none cursor-pointer"
          />
        )}
      </AnimatePresence>

      {/* Floating Island Sidebar (جزيرة ذكية عائمة منفصلة تماماً عن حواف الشاشة ومتحركة ثلاثية الأبعاد) */}
      <motion.aside 
        id="sidebar"
        onMouseEnter={() => !isMobile && setIsHovered(true)}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        initial={{ x: isRtl ? '110%' : '-110%' }}
        animate={{ 
          x: isOpen ? 0 : (isRtl ? '110%' : '-110%'),
          width: isExpanded ? 285 : 84
        }}
        exit={{ x: isRtl ? '110%' : '-110%' }}
        transition={{ 
          type: 'spring',
          damping: 18,
          stiffness: 420,
          mass: 0.7
        }}
        className={`app-sidebar fixed z-[210] flex flex-col select-none antialiased subpixel-antialiased
          ${isMobile ? 'top-0 bottom-0 h-full rounded-none' : 'top-[124px] bottom-[20px] h-[calc(100vh-144px)]'}
          ${isRtl 
            ? (isMobile ? 'right-0' : 'right-[20px] rounded-[32px]') 
            : (isMobile ? 'left-0' : 'left-[20px] rounded-[32px]')
          } 
          /* Floating high-density glass structure with dual support outlines */
          bg-white/85 dark:bg-[#0b1329]/95 border border-slate-200/50 dark:border-cyan-500/20 
          transition-shadow duration-300
          
          /* Eye-soft phosphorescent glow (توهج مريح وجذاب ذو طابع مستودعي نيون) */
          shadow-[-4px_0_25px_rgba(6,182,212,0.08),inset_0_1px_1px_rgba(255,255,255,0.45)]
          dark:shadow-[-8px_0_25px_rgba(6,182,212,0.15),0_0_20px_rgba(6,182,212,0.08),inset_0_1px_2px_rgba(255,255,255,0.06)]
          
          /* High clarity scale on hover with multiple layered glows */
          hover:bg-white/92 hover:dark:bg-[#0b1329]/98
          hover:border-cyan-400/40 hover:dark:border-cyan-400/50
          hover:shadow-[-6px_0_35px_rgba(6,182,212,0.15),0_0_25px_rgba(6,182,212,0.3),0_0_40px_rgba(16,185,129,0.15),inset_0_1px_2px_rgba(255,255,255,0.55)]
          hover:dark:shadow-[-10px_0_40px_rgba(6,182,212,0.22),0_0_30px_rgba(6,182,212,0.4),0_0_45px_rgba(16,185,129,0.2),inset_0_1px_2px_rgba(255,255,255,0.12)]
          overflow-hidden`}
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{ 
          backdropFilter: 'blur(24px)', 
          WebkitBackdropFilter: 'blur(24px)',
          ...transformStyle,
          willChange: 'transform, box-shadow, width, opacity' 
        }}
      >
        {/* Shimmer reflection outline at the very top */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent pointer-events-none" />

        {/* Brand Area with enhanced clarity and ultra-reactivity (متفاعل وواضح ونقي) */}
        <div 
          onClick={handleLogoToggleLock}
          onMouseEnter={() => setBrandHovered(true)}
          onMouseLeave={() => setBrandHovered(false)}
          className={`px-5 py-5 flex items-center border-b border-slate-200/40 dark:border-white/5 shrink-0 z-20 cursor-pointer group/header select-none relative transition-all duration-300 hover:bg-slate-100/30 hover:dark:bg-white/5 ${
            isExpanded ? 'justify-between' : 'justify-center'
          }`}
          title={isRtl ? "انقر لقفل أو فتح لوحة تمدد الشريط الجانبي" : "Click to lock or unlock sidebar expansion panel"}
        >
          <div className="flex items-center gap-3">
            <div className="relative shrink-0 transition-transform duration-300 group-hover/header:scale-105">
              
              {/* Spherical glass-box logo with active neon pulse breathing outline */}
              <div 
                className={`relative w-[44px] h-[44px] rounded-[14px] bg-slate-100/60 dark:bg-white/5 border border-slate-300 dark:border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.03)] dark:shadow-[0_0_15px_rgba(255,255,255,0.04)] flex items-center justify-center transition-all duration-500 group-hover/header:rotate-6
                  ${brandHovered ? 'animate-phosphor-breathing dark:border-cyan-400/40 border-cyan-400/30' : ''}`}
              >
                <Logo 
                  size={28} 
                  animate3d={true} 
                  className="shrink-0 text-slate-900 dark:text-cyan-400 font-black" 
                />
              </div>
              
              {/* Intelligent glowing lock state micro bubble */}
              <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#0c1221] z-30 transition-all duration-300
                ${isLocked 
                  ? 'bg-cyan-500 dark:bg-cyan-400 shadow-[0_0_12px_rgba(6,182,212,1)] animate-pulse' 
                  : 'bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.8)]'
                }`} 
              />
            </div>
            
            <div
              className={`flex flex-col origin-left overflow-hidden select-none transition-all duration-300 ${
                isExpanded ? 'opacity-100 max-w-[170px] visible ml-2' : 'opacity-0 max-w-0 invisible overflow-hidden'
              }`}
            >
              {/* Super crisp high-definition text with gradient shifting (الكتابة واضحة ونقية وجميلة) */}
              <span 
                className={`font-black text-[20px] tracking-tight leading-none text-slate-950 dark:text-white whitespace-nowrap bg-clip-text bg-gradient-to-r from-slate-950 via-slate-700 to-slate-950 dark:from-white dark:via-cyan-300 dark:to-emerald-100 transition-all duration-500 block ${
                  brandHovered ? 'gradient-text-shimmer drop-shadow-[0_0_10px_rgba(6,182,212,0.3)] scale-[1.01]' : ''
                }`}
              >
                {isRtl ? 'مستودعي' : 'Mostawdaee'}
              </span>
              
            </div>
          </div>
          
          {/* Close Sidebar / Pin Button */}
          <div className="flex items-center gap-1.5 shrink-0 z-50">
            {isExpanded && (
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsLocked(!isLocked);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-400 hover:bg-cyan-50/50 dark:hover:bg-cyan-950/20 cursor-pointer transition-all duration-150 active:scale-90"
                title={isLocked ? "إلغاء تثبيت القائمة" : "تثبيت القائمة الجانبية الحالية"} aria-label={isLocked ? "إلغاء تثبيت القائمة" : "تثبيت القائمة الجانبية الحالية"}
              >
                {isLocked ? <Lock size={13} className="animate-pulse text-cyan-500" /> : <Unlock size={13} />}
              </button>
            )}
            
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-all duration-150 active:scale-95 shrink-0"
              title={isRtl ? "إغلاق القائمة" : "Close Sidebar"} aria-label={isRtl ? "إغلاق القائمة" : "Close Sidebar"}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {!isExpanded ? (
          <div className="px-2 py-2 flex justify-center border-b border-slate-200/40 dark:border-white/5 relative z-40">
            <button
              type="button"
              onClick={focusSearch}
              className="w-[44px] h-[44px] rounded-[14px] bg-slate-100/40 dark:bg-white/5 border border-transparent hover:border-cyan-400/35 flex items-center justify-center text-slate-500 hover:text-cyan-500 dark:hover:text-[#00E5FF] transition-all hover:scale-105"
              title={isRtl ? 'البحث (Ctrl K)' : 'Search (Ctrl K)'}
              aria-label={isRtl ? 'البحث' : 'Search'}
              id="collapsed-sidebar-search-trigger"
            >
              <Search size={16} />
            </button>
          </div>
        ) : (
          <GlobalSearch
            language={language}
            inputRef={searchInputRef}
            showShortcutHint={!isMobile}
            onNavigate={(screen) => {
              setActiveScreen(screen);
              onClose();
            }}
          />
        )}

        {/* Navigation panel options with Long-Press (الضغط المطول) integration and tactile touch targets */}
        <div className="sidebar-icons flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar overflow-x-hidden z-20">
          {filteredMenuItems.map((item) => {
            const isActive = activeScreen === item.id;
            const IconComponent = item.icon;
            
            const isHolding = holdingItemId === item.id;
            const isSuperCharged = superChargedItems[item.id];
            
            return (
              <div 
                key={item.id} 
                className="relative overflow-hidden rounded-xl"
                // Listen to mouse actions for long press activation
                onMouseDown={() => !isMobile && startHold(item.id)}
                onMouseUp={() => !isMobile && cancelHold()}
                onMouseLeave={() => !isMobile && cancelHold()}
                onTouchStart={() => startHold(item.id)}
                onTouchEnd={() => cancelHold()}
              >
                <button
                  onClick={() => {
                    // Prevent immediate switch if hold just triggered or completed
                    setActiveScreen(item.id);
                    onClose();
                  }}
                  className={`w-full flex items-center rounded-[14px] cursor-pointer group transition-all duration-300 relative select-none border text-left
                    ${isExpanded 
                      ? `py-3 px-4.5 gap-[14px] ${isRtl ? 'hover:pr-5 px-4.5' : 'hover:pl-5 px-4.5'}` 
                      : 'justify-center py-3 px-2.5 gap-0'
                    } 
                    ${isActive 
                      /* High contrast crystal premium dark layout design */
                      ? `bg-gradient-to-l from-cyan-950/40 to-blue-950/40 font-semibold text-cyan-600 dark:text-cyan-400 shadow-[2px_0_15px_rgba(34,211,238,0.15)] dark:border-cyan-500/30 ${
                          isRtl ? 'border-r-4 border-cyan-400' : 'border-l-4 border-cyan-400'
                        }`
                      : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-100/40 dark:hover:bg-cyan-950/10 hover:text-slate-950 hover:dark:text-white'
                    }
                    /* Custom double neon border if supercharged via long press */
                    ${isSuperCharged ? 'border-emerald-500/40 dark:border-emerald-400/50 bg-emerald-500/[0.04] dark:bg-emerald-400/[0.06] shadow-[0_0_20px_rgba(16,185,129,0.25)]' : ''}
                    
                    /* Interactive click compression feedback */
                    active:scale-[0.93] active:bg-cyan-500/15 active:dark:bg-cyan-500/20 active:shadow-[inset_0_1px_8px_rgba(6,182,212,0.25)]
                  `}
                  title={!isExpanded ? item.label : undefined} aria-label={!isExpanded ? item.label : undefined}
                >
                  {/* Glowing vertical activation bar */}
                  {isActive && (
                    <span 
                      className={`absolute top-[25%] h-[50%] w-1.5 bg-cyan-500 dark:bg-cyan-400 rounded-full shadow-[0_0_15px_rgba(6,182,212,0.9)]
                        ${isRtl ? 'right-0' : 'left-0'}
                      `} 
                    />
                  )}

                  {/* SVG progress ring overlay visible ONLY when holding / long pressing */}
                  {isHolding && (
                    <div className="absolute inset-0 bg-cyan-500/[0.07] flex items-center justify-center pointer-events-none">
                      <svg className="w-10 h-10 absolute opacity-70">
                        <circle 
                          cx="20" 
                          cy="20" 
                          r="16" 
                          stroke="rgba(6, 182, 212, 0.15)" 
                          strokeWidth="2.5" 
                          fill="transparent" 
                        />
                        <circle 
                          cx="20" 
                          cy="20" 
                          r="16" 
                          stroke="rgb(6, 182, 212)" 
                          strokeWidth="2.5" 
                          fill="transparent" 
                          strokeDasharray={2 * Math.PI * 16}
                          strokeDashoffset={2 * Math.PI * 16 * (1 - holdProgress / 100)}
                        />
                      </svg>
                    </div>
                  )}

                  {/* Supercharged green floating energy particles inside background */}
                  {isSuperCharged && (
                    <>
                      <div className="particle-neon" style={{ left: '10px', animationDelay: '0s' }} />
                      <div className="particle-neon" style={{ right: '12px', animationDelay: '0.4s' }} />
                    </>
                  )}

                  {/* Icon section with double phosphorescent lighting */}
                  <div className="shrink-0 select-none z-10 transition-transform duration-300 group-hover:scale-105">
                    <IconComponent 
                      className={`w-4.5 h-4.5 shrink-0 transition-all duration-300
                        ${isActive 
                          ? 'text-cyan-600 dark:text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.7)]' 
                          : 'text-slate-400 dark:text-slate-300 group-hover:text-cyan-500 dark:group-hover:text-cyan-400'
                        }
                        ${isSuperCharged ? 'text-emerald-500 dark:text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.9)] scale-110' : ''}
                      `} 
                      strokeWidth={isActive || isSuperCharged ? 2.3 : 2}
                    />
                  </div>

                  {/* Clean, high contrast label wording with optimal tracking */}
                  <span
                    className={`text-[15px] tracking-wide whitespace-nowrap overflow-hidden text-ellipsis z-10 font-bold leading-normal duration-300 transition-all ${
                      isExpanded 
                        ? 'opacity-100 max-w-[170px] visible translate-x-0' 
                        : 'opacity-0 max-w-0 invisible' + (isRtl ? ' translate-x-4' : ' -translate-x-4')
                    }
                    ${isActive ? 'text-cyan-600 dark:text-cyan-300' : ''}
                    ${isSuperCharged ? 'text-emerald-700 dark:text-emerald-300 font-black' : ''}`}
                  >
                    {item.label}
                  </span>

                  {isActive && isExpanded && (
                    isRtl ? (
                      <ChevronLeft size={16} className="text-cyan-500 animate-pulse ms-auto shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-cyan-500 animate-pulse ms-auto shrink-0" />
                    )
                  )}

                  {/* Elegant sliding shimmer across unselected buttons when hovered */}
                  {!isActive && isExpanded && (
                    <span className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-cyan-500/[0.03] to-transparent -translate-x-full group-hover:animate-[shimmer_1.8s_infinite] pointer-events-none" />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Shimmering footer section for setting dials and connected status */}
        <div className="p-4 border-t border-slate-200/40 dark:border-white/5 space-y-2.5 shrink-0 z-20 bg-slate-50/45 dark:bg-white/[0.01] relative">
          
          {/* Global Premium Glassmorphism Currency Switcher */}
          <CurrencySwitcher isExpanded={isExpanded} isRtl={isRtl} />

          {/* Quick-toggle language switch with glass card layout */}
          <button
            onClick={onLanguageToggle}
            className={`w-full flex items-center rounded-xl transition-all duration-200 cursor-pointer text-slate-700 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-white/5 hover:text-slate-950 hover:dark:text-white p-2.5 ${
              isExpanded ? 'justify-start gap-4 px-3.5' : 'justify-center px-2'
            }`}
            title={t.switchLanguage} aria-label={t.switchLanguage}
          >
            <Globe className="w-4.5 h-4.5 shrink-0 text-slate-400 group-hover:text-cyan-400 transition-colors" />
            {isExpanded && <span className="text-xs font-black truncate leading-none">{t.switchLanguage}</span>}
          </button>

          {/* Clean crystalline user profile banner */}
          <div className="border-t border-slate-200/40 dark:border-white/5 pt-3">
            {isExpanded ? (
              <div className="flex items-center gap-3 p-2 rounded-2xl bg-white/40 dark:bg-white/5 border border-slate-200/50 dark:border-cyan-500/10 hover:bg-slate-100/70 dark:hover:bg-white/8 transition-all duration-300">
                
                {/* Profile icon bubble */}
                <div className="w-[36px] h-[36px] rounded-full bg-slate-100 dark:bg-cyan-500/10 flex items-center justify-center border border-slate-200 dark:border-cyan-500/25 shadow-xs shrink-0 select-none overflow-hidden">
                  {user && user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt="User Profile" 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs font-black text-slate-800 dark:text-cyan-400">
                      {userName ? userName.trim().charAt(0).toUpperCase() : 'U'}
                    </span>
                  )}
                </div>
                
                {/* Enterprise meta labels */}
                <div className="flex flex-col min-w-0 flex-1 overflow-hidden" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                  <span className="text-xs font-black text-slate-900 dark:text-gray-100 truncate">
                    {userName || (isRtl ? 'حسابي' : 'My account')}
                  </span>
                  {businessName && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold truncate mt-0.5">
                      {businessName}
                    </span>
                  )}
                </div>
                
                {/* Sleek, clickable logout door */}
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-xl text-rose-500 dark:text-rose-400 hover:text-rose-600 hover:bg-rose-500/10 dark:hover:bg-rose-950/20 transition-all cursor-pointer shrink-0 active:scale-90"
                  title={t.logout} aria-label={t.logout}
                >
                  <LogOut className="w-4 h-4 text-rose-500" />
                </button>
              </div>
            ) : (
              <button
                onClick={onLogout}
                className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer transition-all duration-150"
                title={t.logout} aria-label={t.logout}
              >
                <LogOut className="w-4 h-4 text-rose-500 animate-pulse" />
              </button>
            )}
          </div>
        </div>
      </motion.aside>

    </>
  );
}
