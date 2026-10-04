import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Package, 
  ArrowUpRight, 
  Users, 
  ShieldCheck, 
  ChevronRight,
  TrendingUp,
  LayoutDashboard,
  Clock,
  Calendar,
  Lock,
  Globe2,
  Sparkles
} from 'lucide-react';
import Logo from './Logo';
import { Language } from '../types';
import { translations } from '../translations';

interface Props {
  language?: Language;
  onEnter?: () => void;
  darkMode?: boolean;
  onBackToLogin?: () => void;
}

export default function LandingPage({ language = 'ar', onEnter = () => {}, darkMode = false, onBackToLogin }: Props) {
  const t = translations[language];
  const isRtl = language === 'ar';

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [activeModal, setActiveModal] = useState<'eula' | 'privacy' | null>(null);
  
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // Format time: HH:MM:SS
      setCurrentTime(now.toLocaleTimeString(isRtl ? 'ar-JO' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      }));
      // Format date
      setCurrentDate(now.toLocaleDateString(isRtl ? 'ar-JO' : 'en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }));
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [isRtl]);

  // Inspirational greetings that rotate or are beautifully displayed based on localized selection
  const arGreetings = [
    {
      title: "صباح الخير والريادة",
      body: "إنتاجية اليوم تصنع ريادة الغد. طاب يومكم بكل خير وتميز في نظام مستودعي الذكي."
    },
    {
      title: "العمل المنظم أساس النمو",
      body: "التنظيم والاتساق هما مفتاحا الكفاءة التشغيلية والنمو المستدام. نسعد بدعم تميزكم دائماً."
    },
    {
      title: "رؤية شاملة لغد أفضل",
      body: "المستودع الذكي والعمل المنظم يعني قرارات حاسمة وأرباحاً متنامية. تمنياتنا لكم بجلسة عمل مثمرة."
    }
  ];

  const enGreetings = [
    {
      title: "Empower Your Workday",
      body: "Today's productivity shapes tomorrow's leadership. Experience precision asset management."
    },
    {
      title: "Consistency Drives Growth",
      body: "Structured workflows and solid logs are the blueprints for operational excellence. Have a great session."
    },
    {
      title: "Smarter Insights, Better Decisions",
      body: "Our synchronized modules are tuned to help you govern your assets with complete confidence."
    }
  ];

  // Pick a greeting based on the current minute to make it feel fresh and active
  const greetingIndex = new Date().getMinutes() % 3;
  const activeGreeting = isRtl ? arGreetings[greetingIndex] : enGreetings[greetingIndex];

  const containerVariants: any = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1
      }
    }
  };

  const itemVariants: any = {
    hidden: { y: 15, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { type: 'spring', stiffness: 120, damping: 20 }
    }
  };

  const moduleCards = [
    {
      icon: <Package className="w-6 h-6" />,
      title: isRtl ? "إدارة المخازن والمستودعات" : "Inventory & Asset Control",
      desc: isRtl ? "تتبع أصناف المخزون بدقة تامة، والتحكم بحد الأمان ومستويات إعادة الطلب الفورية." : "Precision tracking of live stock levels, low-limit thresholds, and automatic stock alerts.",
      accent: "from-blue-500/10 to-indigo-500/10 dark:from-blue-500/5 dark:to-indigo-500/5",
      iconBg: "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
    },
    {
      icon: <ArrowUpRight className="w-6 h-6" />,
      title: isRtl ? "المبيعات والفواتير الضريبية" : "Invoicing & POS",
      desc: isRtl ? "إصدار وتلقي فواتير المبيعات والمشتريات والبيع السريع عبر الباركود بنقرة واحدة." : "Generate standard sales invoices, log cargo logistics, and conduct direct rapid POS scanning.",
      accent: "from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/5 dark:to-teal-500/5",
      iconBg: "bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
    },
    {
      icon: <ShieldCheck className="w-6 h-6" />,
      title: isRtl ? "الخزنة المركزية وإدارة النقد" : "Treasury & Capital Ledger",
      desc: isRtl ? "مراقبة الصندوق النقدي وتسجيل حركات المقبوضات والمدفوعات والمستندات ببيانات آمنة." : "Audit raw safe deposits, operational disbursements, and real-time cash flow records.",
      accent: "from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/5 dark:to-purple-500/5",
      iconBg: "bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400"
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: isRtl ? "الموارد البشرية وشؤون الموظفين" : "HR & Payroll Module",
      desc: isRtl ? "إدارة كادر العمل وتوزيع الرواتب وصرف المستحقات مع التوثيق التلقائي في الخزنة." : "Record unified employee directory sheets, salaries, and operating payment disbursements.",
      accent: "from-amber-500/10 to-orange-500/10 dark:from-amber-500/5 dark:to-orange-500/5",
      iconBg: "bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
    }
  ];

  return (
    <div className={`min-h-screen flex flex-col justify-between overflow-x-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-blue-950 dark:to-slate-900 text-slate-800 dark:text-slate-100 ${darkMode ? 'dark' : ''} ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* Top clean spacing */}
      <div className="w-full py-4 px-6 border-b border-white/40 dark:border-slate-800/40 bg-white/20 dark:bg-slate-950/20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center transition-all">
          <div className="flex items-center gap-3">
            <Logo size={42} animate className="drop-shadow-sm" />
            <div>
              <h2 className="text-xl font-black bg-gradient-to-r from-blue-700 to-indigo-950 dark:from-indigo-300 dark:to-white bg-clip-text text-transparent">
                {isRtl ? 'مستودعي' : 'Mostawdaee'}
              </h2>
              <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-widest leading-none mt-0.5">
                {isRtl ? 'نظام المستودع الآمن' : 'Secure Warehouse Platform'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 font-mono text-xs text-slate-500 dark:text-slate-400 bg-white/40 dark:bg-slate-900/40 border border-white/60 dark:border-slate-800/60 px-3 pl-4 py-1.5 rounded-xl shadow-inner select-none">
            <Clock size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="font-bold">{currentTime || '--:--:--'}</span>
          </div>
        </div>
      </div>

      {/* Main Welcome Content Grid */}
      <div className="max-w-7xl mx-auto px-6 py-12 flex-1 flex flex-col justify-center w-full">
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center"
        >
          
          {/* Column 1: Formal Authorization & Greeting Message */}
          <div className="lg:col-span-5 space-y-8 flex flex-col justify-center text-center lg:text-right">
            
            <motion.div variants={itemVariants} className="space-y-3">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-blue-100/80 dark:bg-indigo-950/40 border border-blue-200/50 dark:border-indigo-900/40 text-blue-700 dark:text-indigo-400 rounded-full text-xs font-bold uppercase tracking-wider">
                <Globe2 size={13} className="animate-spin-slow" />
                {isRtl ? 'لوحة تسجيل الدخول المباشر' : 'Secure Gateway Terminal'}
              </span>
              
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 dark:text-white leading-tight tracking-tight">
                {isRtl ? 'نظام مستودعي' : "Mostawdaee Tool"}
                <span className="block text-indigo-600 dark:text-indigo-400 text-3xl sm:text-4xl mt-2 font-bold">
                  {isRtl ? 'لإدارة الأصول والموارد' : 'Asset & Growth Platform'}
                </span>
              </h1>
            </motion.div>

            {/* Aesthetically Pleasing Motivational Greeting Card */}
            <motion.div 
              variants={itemVariants}
              whileHover={{ scale: 1.01 }}
              className="p-6 bg-gradient-to-br from-indigo-600 to-indigo-800 text-white rounded-[2rem] shadow-xl text-center relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-white/5 rounded-full blur-xl pointer-events-none" />
              
              <div className="relative space-y-2 mt-1">
                <div className="inline-flex p-2 bg-white/10 rounded-xl mb-1">
                  <Sparkles size={18} className="text-amber-300" />
                </div>
                <h3 className="text-lg font-bold tracking-tight">
                  {activeGreeting.title}
                </h3>
                <p className="text-sm text-indigo-100/90 leading-relaxed font-medium">
                  {activeGreeting.body}
                </p>
              </div>
            </motion.div>

            {/* Systematic Direct Entry & Login Panel */}
            <motion.div 
              variants={itemVariants}
              className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-lg p-8 rounded-3xl border border-white dark:border-slate-800/80 shadow-xl space-y-6"
            >
              <div className="text-center lg:text-right space-y-1">
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {isRtl ? 'البدء الفوري بالجلسة الآمنة' : 'Instant Session Initialization'}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-semibold">
                  {isRtl 
                    ? 'انقر أدناه لتفعيل جلسة المزامنة التلقائية والولوج إلى لوحة قيادة مبيعات ومواد العمل.' 
                    : 'Proceed directly with synchronized secure workspace credentials.'}
                </p>
              </div>

              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={onEnter}
                className="w-full py-4 bg-gradient-to-r from-blue-700 to-indigo-800 text-white rounded-2xl font-black text-base shadow-lg shadow-indigo-600/20 hover:from-blue-800 hover:to-indigo-950 transition-all flex items-center justify-center gap-3 select-none cursor-pointer"
              >
                <LayoutDashboard size={20} />
                <span>{isRtl ? 'الدخول للوحة العمل الذكية' : 'Start Secure Workspace'}</span>
                <ChevronRight className={`w-5 h-5 ${isRtl ? 'rotate-180 font-bold' : ''}`} />
              </motion.button>

              {onBackToLogin && (
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="w-full py-3 border border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-200 rounded-2xl font-bold text-xs sm:text-sm transition flex items-center justify-center gap-2 select-none cursor-pointer"
                >
                  <span>{isRtl ? 'الرجوع لصفحة الدخول' : 'Back to Login Screen'}</span>
                </button>
              )}
              
              <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-bold justify-center pt-1 border-t border-slate-200/40 dark:border-slate-800/40">
                <Lock size={12} className="text-emerald-600 dark:text-emerald-400" />
                <span>{isRtl ? 'إتاحة وصلاحيات معماة بالكامل' : 'Database Connection Secured'}</span>
              </div>
            </motion.div>

          </div>

          {/* Column 2: Broad Systematic Grid showing Core Functionalities */}
          <div className="lg:col-span-7 space-y-6">
            <motion.div variants={itemVariants} className="text-center lg:text-right pb-2">
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {isRtl ? 'أركان البيئة النظامية المتكاملة' : 'Systematic Framework Capabilities'}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
                {isRtl 
                  ? 'تم تصميم مستودعي ليعمل كشبكة أمان وحسابات صلبة ومستقرة تماماً لمعاملات شركتك.'
                  : 'Robust structural components aligned together in a functional single-ledger interface.'}
              </p>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
              {moduleCards.map((card, idx) => (
                <motion.div
                  key={idx}
                  variants={itemVariants}
                  whileHover={{ y: -6, boxShadow: "0 12px 24px -10px rgba(0,0,0,0.06)" }}
                  className={`p-6 bg-gradient-to-br ${card.accent} bg-white dark:bg-slate-900 backdrop-blur-sm border border-white dark:border-slate-800/80 rounded-[2rem] flex flex-col justify-between hover:border-indigo-300 dark:hover:border-slate-700 transition-all duration-300 group`}
                >
                  <div className="space-y-4">
                    <div className={`w-12 h-12 ${card.iconBg} rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-300 shadow-sm`}>
                      {card.icon}
                    </div>
                    
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-base text-slate-900 dark:text-white">
                        {card.title}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-semibold">
                        {card.desc}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

        </motion.div>
      </div>

      {/* Corporate Professional Footer */}
      <div className="w-full py-6 px-6 border-t border-slate-200/40 dark:border-slate-900/40 bg-white/20 dark:bg-slate-950/20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>© 2026 {isRtl ? 'نظام مستودعي الذكي.' : 'Mostawdaee Enterprise Suite.'} {isRtl ? 'جميع الأنظمة نشطة ومعايرة.' : 'All sub-systems ready.'}</span>
          </div>
          <div className="flex gap-4 sm:gap-6 font-bold text-slate-600 dark:text-slate-300 flex-wrap justify-center">
            <button 
              type="button"
              onClick={() => setActiveModal('eula')} 
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer outline-none bg-transparent"
            >
              {isRtl ? 'اتفاقية الترخيص (EULA)' : 'License Agreement (EULA)'}
            </button>
            <span>•</span>
            <button 
              type="button"
              onClick={() => setActiveModal('privacy')} 
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer outline-none bg-transparent"
            >
              {isRtl ? 'سياسة الخصوصية وحماية البيانات' : 'Privacy & Data'}
            </button>
            <span>•</span>
            <button 
              type="button"
              onClick={() => alert(isRtl ? 'دعم مستودعي متاح لكم على مدار الساعة في الواجهة الرئيسية عبر المساعد الذكي!' : 'Mostawdaee operational academy and live support are active via the Smart Assistant.')}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer outline-none bg-transparent"
            >
              {isRtl ? 'دعم المستودعات' : 'Technical Support'}
            </button>
          </div>
        </div>
      </div>

      {/* Exquisite responsive legal document modal presentation */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
            {/* Soft, non-glaring dimmed backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            />

            {/* Modal Body Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 15 }}
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
              className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[2.5rem] border border-gray-100 dark:border-slate-800 shadow-2xl overflow-hidden z-20 flex flex-col max-h-[85vh]"
            >
              {/* Head Section */}
              <div className="p-6 sm:p-8 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-950/20 flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-extrabold uppercase tracking-widest">
                    {activeModal === 'eula' 
                      ? (isRtl ? 'المواثيق القانونية والترخيص' : 'LEGAL REGULATION') 
                      : (isRtl ? 'المعايير التنظيمية وأمان الأصول' : 'DATA SECURITY STANDARD')}
                  </span>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
                    {activeModal === 'eula' 
                      ? (isRtl ? 'اتفاقية ترخيص المستخدم النهائي (EULA)' : 'End-User License Agreement (EULA)')
                      : (isRtl ? 'سياسة الخصوصية وحماية البيانات' : 'Privacy & Data Protection Policy')}
                  </h3>
                </div>
                
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="w-9 h-9 bg-gray-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full flex items-center justify-center hover:bg-indigo-50 dark:hover:bg-indigo-950/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all active:scale-90 cursor-pointer text-xs"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable Document Container (Muted, comfortable read) */}
              <div className="p-6 sm:p-8 overflow-y-auto space-y-6 text-slate-700 dark:text-slate-300 leading-relaxed text-sm sm:text-base selection:bg-indigo-100 dark:selection:bg-indigo-950 select-text">
                {activeModal === 'eula' ? (
                  isRtl ? (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">1. منح الترخيص</h4>
                        <p className="text-gray-600 dark:text-gray-300">يمنحك التطبيق ترخيصاً محدوداً، غير حصري، غير قابل للنقل، وقابلاً للإلغاء لاستخدام البرنامج وواجهاته ثلاثية الأبعاد بدقة وفقاً لشروط هذه الاتفاقية. يُحظر تماماً أي محاولة للهندسة العكسية، فك التشفير، أو استخراج الكود المصدري.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">2. الملكية الفكرية</h4>
                        <p className="text-gray-600 dark:text-gray-300">تظل جميع حقوق الملكية الفكرية في التطبيق، بما في ذلك على سبيل المثال لا الحصر النماذج ثلاثية الأبعاد، وواجهات المستخدم، والعلامة التجارية، والكود المصدري الأساسي، ملكاً حصرياً للمنصة.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">3. تحديد المسؤولية</h4>
                        <p className="text-gray-600 dark:text-gray-300">يتم تقديم التطبيق وميزاته على أساس "كما هو" و "كما هو متاح" دون أي ضمانات، صريحة أو ضمنية. ولا يتحمل المسؤولون عن النظام أي مسؤولية عن أي أضرار مباشرة، غير مباشرة، أو عرضية ناتجة عن استخدام أو عدم القدرة على استخدام النظام.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">4. الإنهاء</h4>
                        <p className="text-gray-600 dark:text-gray-300">هذا الترخيص ساري المفعول حتى يتم إنهاؤه من قبلك أو من قبل المنصة. ستنتهي حقوقك بموجب هذا الترخيص تلقائياً دون إشعار مسبق إذا فشلت في الامتثال لأي من شروط هذه الاتفاقية.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">1. Grant of License</h4>
                        <p className="text-gray-600 dark:text-gray-300">The Application grants you a limited, non-exclusive, non-transferable, and revocable license to use the software and its 3D interfaces strictly in accordance with the terms of this agreement. Any attempt to reverse engineer, decompile, or extract the source code is strictly prohibited.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">2. Intellectual Property</h4>
                        <p className="text-gray-600 dark:text-gray-300">All intellectual property rights in the application, including but not limited to the 3D models, user interfaces, branding, and underlying source code, remain the exclusive property of the platform.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">3. Limitation of Liability</h4>
                        <p className="text-gray-600 dark:text-gray-300">The application and its features are provided on an "AS IS" and "AS AVAILABLE" basis without any warranties, express or implied. The management shall not be held liable for any direct, indirect, or incidental damages resulting from the use or inability to use the system.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">4. Termination</h4>
                        <p className="text-gray-600 dark:text-gray-300">This license is effective until terminated by either you or the platform. Your rights under this license will terminate automatically without notice if you fail to comply with any terms of this agreement.</p>
                      </div>
                    </div>
                  )
                ) : (
                  isRtl ? (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">1. جمع البيانات ومعالجتها</h4>
                        <p className="text-gray-600 dark:text-gray-300">نحن نلتزم بمعايير صارمة لحماية البيانات. يجمع التطبيق فقط البيانات الفنية الأساسية المطلوبة لتحسين العرض ثلاثي الأبعاد وأداء التطبيق (مثل نوع الجهاز، إصدار نظام التشغيل، ومقاييس الأداء). لا يتم جمع أي بيانات شخصية حساسة دون موافقتك الصريحة.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">2. أمن البيانات وتشفيرها</h4>
                        <p className="text-gray-600 dark:text-gray-300">يتم تشفير جميع البيانات المنقولة بين التطبيق وخوادمنا الآمنة بالكامل باستخدام بروتوكولات تشفير متقدمة تتماشى مع معايير الصناعة لمنع أي وصول غير مصرح به.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">3. الامتثال التنظيمي</h4>
                        <p className="text-gray-600 dark:text-gray-300">تم تصميم سياسة الخصوصية هذه لتتوافق مع قوانين حماية البيانات والخصوصية الرقمية المعمول بها. نحن نضمن تخزين معلوماتك بشكل آمن وعدم مشاركتها مع أي أطراف ثالثة دون مسوغ قانوني مبرر.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">1. Data Collection and Processing</h4>
                        <p className="text-gray-600 dark:text-gray-300">We adhere to strict data protection standards. The application only collects essential technical data required to optimize the 3D rendering and application performance (such as device type, OS version, and performance metrics). No sensitive personal data is gathered without your explicit consent.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">2. Data Security & Encryption</h4>
                        <p className="text-gray-600 dark:text-gray-300">All data transmitted between the application and our secure servers is fully encrypted using advanced industry-standard cryptographic protocols to prevent unauthorized access.</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">3. Regulatory Compliance</h4>
                        <p className="text-gray-600 dark:text-gray-300">This Privacy Policy is designed to comply with applicable data protection and digital privacy laws. We ensure that your information is stored securely and is never shared with third parties without legal justification.</p>
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Close footer trigger */}
              <div className="p-6 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-950/20 flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 active:scale-95 transition-all cursor-pointer"
                >
                  {isRtl ? 'إغلاق ومتابعة' : 'Close and Continue'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
