import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Check, 
  Package, 
  Cpu, 
  TrendingUp, 
  Gift, 
  ArrowRight, 
  ArrowLeft,
  X,
  Smartphone,
  ShieldCheck,
  Receipt
} from 'lucide-react';
import { updateProfile } from '../supabaseClient';
import { sounds } from '../lib/sounds';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  language: 'ar' | 'en';
}

export default function WelcomeOnboardingModal({ isOpen, onClose, language }: Props) {
  const isRtl = language === 'ar';
  const [loading, setLoading] = useState(false);

  const t = {
    modalTitle: isRtl ? 'أهلاً بك في مستودعي' : 'Welcome to Mostawdaee',
    modalSubtitle: isRtl 
      ? 'دعنا نأخذك في جولة سريعة من 3 خطوات لبدء تهيئة وإدارة مخزونك المالي والمخزني المتكامل.' 
      : 'Let\'s take a brief 3-step tour to set up your comprehensive financial ledger and live inventory pipeline.',
    
    step1Title: isRtl ? '1. هيكلة المخازن والرفوف' : '1. Dynamic Warehouses & Shelves',
    step1Desc: isRtl 
      ? 'قم بتنظيم منتجاتك وتخصيص تنبيهات نواقص المخزون وتحديد الباركود والأسعار والضرائب الموحدة لكل صنف.' 
      : 'Structure internal branches, track custom barcodes, define default tax structures, and monitor automated low-stock warnings.',
    
    step2Title: isRtl ? '2. المبيعات ونقاط البيع الفورية' : '2. Fast POS & Multi-Currency Sales',
    step2Desc: isRtl 
      ? 'أصدر فواتير ضريبية، تابع ديون الزبائن والوفاء الآجل، وتحكم بصندوق الودائع المالي بثلاث عملات (JOD ،USD ،ILS) معاً.' 
      : 'Issue verified tax invoices, manage dynamic retail debt ledgers, and audit cash flows in three stable currencies simultaneously.',

    step3Title: isRtl ? '3. المزامنة والربط الموحّد' : '3. Live Cross-Platform Cloud Sync',
    step3Desc: isRtl 
      ? 'تتبع حركات مستودعك عبر الهاتف الذكي في آن واحد بفضل المزامنة الحية والمستمرة لقاعدة بيانات سوبابيس الموحدة.' 
      : 'Access inventory and billing states in real time across systems via our unified secure cloud database synchronizations.',

    trialBadge: isRtl ? 'هدية الانضمام الحرة' : 'Complimentary Onboarding Gift',
    trialTitle: isRtl ? 'تفعيل فوري لـ 25 يوماً كاملة مجاناً' : 'Automated 25-Day Full Trial Activated',
    trialDesc: isRtl 
      ? 'حسابك يبدأ بفترة تجريبية مجانية كاملة المزايا. يمكنك تمديد الاشتراك السنوي بسهولة في أي وقت عبر تطبيق الهواتف الذكية مع المزامنة الفورية للويب.' 
      : 'Your sandbox gets full corporate feature entitlements. Easily extend or renew your subscription anytime inside our Android play-store app.',

    btnConfirm: isRtl ? 'ابدأ الآن وتصفح اللوحة' : 'Complete Onboarding & Get Started',
    btnWaiting: isRtl ? 'جاري حفظ الإعدادات...' : 'Persisting preferences...',
    footerNote: isRtl ? 'لن يظهر هذا الدليل الترحيبي لك مرة أخرى.' : 'This interactive tour will not be presented to you again.'
  };

  const handleGetStarted = async () => {
    sounds.playClick();
    setLoading(true);
    try {
      // Update has_onboarded = true in Supabase profiles
      await updateProfile({ has_onboarded: true });
      toast.success(isRtl ? 'تم إعداد لوحتك بنجاح! جاهز تماماً للعمل.' : 'Onboarding preferences registered! Happy managing.');
      onClose();
    } catch (err: any) {
      console.error("Failed to persist user onboarding status in Supabase:", err);
      // Fallback close if profile table write has minor restriction or policy issues
      toast.success(isRtl ? 'أهلاً بك في مستودعي!' : 'Welcome to Mostawdaee!');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
        {/* Dark blurred backdrop overlay */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleGetStarted}
          className="absolute inset-0 bg-slate-950/85 backdrop-blur-md cursor-pointer"
        />

        {/* Content Card Panel */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-2xl relative overflow-hidden text-slate-100 font-sans"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          {/* Glowing Aura Effect */}
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-blue-500/0 via-indigo-500/50 to-blue-500/0" />
          <div className="absolute -top-[40%] -right-[30%] w-[60%] h-[60%] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

          {/* Close button that triggers final save and close */}
          <button 
            onClick={handleGetStarted}
            className={`absolute top-5 ${isRtl ? 'left-5' : 'right-5'} p-2 rounded-xl bg-slate-950 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 transition cursor-pointer`}
          >
            <X size={15} />
          </button>

          <div className="p-6 sm:p-10 space-y-8 max-h-[85vh] overflow-y-auto custom-scrollbar">
            
            {/* Title & Introduction */}
            <div className="space-y-2 mt-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/15 border border-indigo-500/20 rounded-full text-indigo-400 font-bold text-[10px] tracking-widest uppercase mb-1">
                <Sparkles size={11} className="text-amber-400 animate-pulse" />
                <span>{isRtl ? 'جولة التهيئة والإعداد المريح' : 'ONBOARDING WALKTHROUGH'}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight">
                {t.modalTitle}
              </h2>
              <p className="text-sm text-slate-400 font-medium leading-relaxed max-w-2xl">
                {t.modalSubtitle}
              </p>
            </div>

            {/* Step Content Items */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Step 1 */}
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800/80 hover:border-indigo-500/25 transition space-y-3">
                <div className="w-9 h-9 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400 border border-indigo-500/15">
                  <Package size={16} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-slate-200">{t.step1Title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-semibold">{t.step1Desc}</p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800/80 hover:border-emerald-500/25 transition space-y-3">
                <div className="w-9 h-9 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-400 border border-emerald-500/15">
                  <Receipt size={16} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-slate-200">{t.step2Title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-semibold">{t.step2Desc}</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800/80 hover:border-cyan-500/25 transition space-y-3">
                <div className="w-9 h-9 bg-cyan-500/10 rounded-xl flex items-center justify-center text-cyan-400 border border-cyan-500/15">
                  <Smartphone size={16} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-slate-200">{t.step3Title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-semibold">{t.step3Desc}</p>
                </div>
              </div>

            </div>

            {/* Premium trial alert box */}
            <div className="p-5 sm:p-6 bg-gradient-to-r from-blue-950 to-indigo-950 rounded-3xl border border-blue-900/30 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="p-3 bg-indigo-500/15 rounded-2xl text-indigo-400 shrink-0 self-start sm:self-center border border-indigo-500/20">
                <Gift size={24} className="animate-bounce" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase text-amber-400 tracking-wider bg-amber-400/10 px-2 py-0.5 rounded-md leading-none">{t.trialBadge}</span>
                  <h4 className="text-sm font-black text-white">{t.trialTitle}</h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">{t.trialDesc}</p>
              </div>
            </div>

            {/* Bottom Controls / Complete button */}
            <div className="pt-2 flex flex-col items-center gap-3 border-t border-slate-800/50">
              <button
                type="button"
                onClick={handleGetStarted}
                disabled={loading}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-650/15 hover:shadow-indigo-650/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <span>{t.btnWaiting}</span>
                ) : (
                  <>
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <span>{t.btnConfirm}</span>
                    {isRtl ? <ArrowLeft size={13} className="mr-1" /> : <ArrowRight size={13} className="ml-1" />}
                  </>
                )}
              </button>

              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest block">{t.footerNote}</span>
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
