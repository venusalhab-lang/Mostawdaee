import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AlertTriangle, 
  RotateCw, 
  LogOut, 
  Smartphone, 
  HelpCircle,
  Globe2,
  CalendarDays,
  CreditCard,
  Lock,
  ShieldCheck,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Gift,
  Building,
  User,
  Hash
} from 'lucide-react';
import { supabase as rawSupabase } from '../supabaseClient';
const supabase = rawSupabase as any;
import { sounds } from '../lib/sounds';
import { toast } from 'sonner';
import { initializeBilling, makePurchase } from '../services/billing';
import { activatePaidSubscription } from '../lib/activateSubscription';

interface Props {
  language: 'en' | 'ar';
  onLanguageToggle: () => void;
  expiryDate?: string;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}

export default function SubscriptionExpired({ 
  language, 
  onLanguageToggle, 
  expiryDate, 
  onRefresh, 
  onLogout 
}: Props) {
  const isRtl = language === 'ar';
  const [recalculating, setRecalculating] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [processing, setProcessing] = useState(false);
  const [gplayProcessing, setGplayProcessing] = useState(false);

  const handleGooglePlayPurchase = async () => {
    sounds.playClick();
    setGplayProcessing(true);
    
    try {
      initializeBilling(
        async (tx) => {
          try {
            await activatePaidSubscription(tx);
            toast.success(isRtl ? 'تم تفعيل اشتراكك السنوي بنجاح عبر جوجل بلاي!' : 'Your annual subscription has been activated via Google Play!');
            sounds.playSuccess();
            await onRefresh();
          } catch (err) {
            toast.error((isRtl ? 'فشل تفعيل الاشتراك: ' : 'Could not activate the subscription: ') + (err instanceof Error ? err.message : ''));
          } finally {
            setGplayProcessing(false);
          }
        },
        (errMsg) => {
          toast.error(isRtl ? `خطأ سداد جوجل: ${errMsg}` : `Google Play Error: ${errMsg}`);
          setGplayProcessing(false);
        }
      );

      const started = await makePurchase('mostawdaee_premium_100', async (simulatedTx) => {
        try {
          await activatePaidSubscription(simulatedTx);
          toast.success(isRtl ? 'تم تفعيل ترخيصك السنوي بنجاح عبر بوابة جوجل بلاي!' : 'Your annual license has been successfully activated via Google Play!');
          sounds.playSuccess();
          await onRefresh();
        } catch (err) {
          toast.error((isRtl ? 'فشل تفعيل الاشتراك: ' : 'Could not activate the subscription: ') + (err instanceof Error ? err.message : ''));
        } finally {
          setGplayProcessing(false);
        }
      });

      if (!started) {
        setGplayProcessing(false);
      }
    } catch (err: any) {
      toast.error(err.message || 'IAP Launch failed');
      setGplayProcessing(false);
    }
  };

  const t = {
    title: isRtl ? 'انتهت صلاحية تفعيل الحساب' : 'Subscription Term Expired',
    subtitle: isRtl ? 'حسابك التجاري مغلق مؤقتاً لانتهاء صلاحية فترة الاستخدام التجريبي المحددة بـ 25 يوماً.' : 'Your administrative access has been suspended due to the expiration of your 25-day free trial.',
    syncAlert: isRtl ? 'الاشتراك السنوي المطلوب:' : 'Required Annual Subscription:',
    syncText: isRtl 
      ? 'قم بتفعيل الترخيص السنوي الشامل بقيمة 100 دولارٍ فقط (حوالي 71 دينار أردني) لفتح لوحتك فوراً وبشكل دائم مع نسخ احتياطي وتطبيقات الهواتف المحمولة.'
      : 'Activate the secure annual comprehensive license for only $100.00 USD to instantly unlock your dashboard, backup pipelines, and mobile apps.',
    
    detailsTitle: isRtl ? 'مؤشرات حالة الاشتراك' : 'Subscription Identity Details',
    lblStatus: isRtl ? 'حالة التراخيص الحالية' : 'Current License State',
    valExpired: isRtl ? 'منتهي الصلاحية ⚠️' : 'Expired ⚠️',
    lblExpiry: isRtl ? 'تاريخ نهاية الصلاحية المسجل' : 'Registered Expiration Date',
    lblPrice: isRtl ? 'قيمة الاشتراك السنوي' : 'Annual Plan Price',
    valPrice: isRtl ? '$100 دولاراً سنوياً (شامل الضريبة)' : '$100.00 USD/Year (Tax Included)',

    actionPay: isRtl ? 'دفع الاشتراك والتفعيل الآن ($100)' : 'Pay & Activate Premium License ($100)',
    actionRefresh: isRtl ? 'إعادة التحقق من المزامنة' : 'Check Synchronized Payments',
    actionLogout: isRtl ? 'تسجيل الخروج من الحساب' : 'Switch Authorized Account',
    actionSupport: isRtl ? 'التواصل مع الدعم الفني لمستودعي' : 'Contant Technical Support',
    checking: isRtl ? 'جاري الفحص...' : 'Polling servers...',
    syncSuccess: isRtl ? 'تم تحديث حالة الاشتراك بنجاح!' : 'Subscription status updated successfully!',

    // Payment Form Translation
    payTitle: isRtl ? 'بوابة الدفع الآمنة والمشفرة' : 'Secure Encrypted Checkout',
    paySubtitle: isRtl ? 'أدخل تفاصيل بطاقتك الائتمانية لإتمام الاشتراك السنوي بقيمة 100 دولارٍ أمريكي لمرة واحدة سنوياً.' : 'Enter your credit card details below to activate flat annual subscription of $100.00 USD recursively.',
    cardHolder: isRtl ? 'اسم صاحب البطاقة المطبوعة' : 'Cardholder Full Name',
    cardHolderPlaceholder: isRtl ? 'أحمد محمد' : 'e.g. John Doe',
    cardNumber: isRtl ? 'رقم البطاقة الائتمانية' : 'Credit Card Number',
    cardExpiry: isRtl ? 'تاريخ انتهاء الصلاحية' : 'Expiry Date',
    cardCvv: isRtl ? 'الرمز السري (CVV)' : 'Security Code (CVV)',
    payButton: isRtl ? 'تأكيد ودفع 100.00 دولاراً بأمان' : 'Authorize & Pay $100.00 Securly',
    payingState: isRtl ? 'جاري معالجة الدفع والتشفير...' : 'Processing secure payment API...',
    cancelButton: isRtl ? 'رجوع وإلغاء' : 'Cancel & Go Back',
    secureBadge: isRtl ? 'تشفير 256-بت آمن ومتوافق مع معايير PCI-DSS' : 'Encrypted 256-bit safe and certified with PCI-DSS',
    paymentSuccessToast: isRtl ? 'تمت معالجة الدفع بنجاح وترقية اشتراكك لـ 365 يوماً!' : 'Payment processed successfully! Subscription upgraded for 365 days.'
  };

  const handleManualRecheck = async () => {
    sounds.playClick();
    setRecalculating(true);
    try {
      await onRefresh();
      toast.info(isRtl ? 'تم فحص تحديثات المزامنة في سوبابيس.' : 'Polled database servers for payment sync.');
    } catch (e) {
      toast.error(isRtl ? 'فشل الاتصال بالخادم.' : 'Could not contact database backend.');
    } finally {
      setRecalculating(false);
    }
  };

  const handleSignOut = async () => {
    sounds.playClick();
    localStorage.setItem('mustawdae_manual_signout', 'true');
    localStorage.removeItem('mustawdae_supabase_session_override');
    await supabase.auth.signOut();
    onLogout();
  };

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];

    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }

    if (parts.length > 0) {
      return parts.join(' ');
    } else {
      return v;
    }
  };

  const formatExpiry = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (v.length >= 2) {
      return `${v.substring(0, 2)}/${v.substring(2, 4)}`;
    }
    return v;
  };

  const handleSecureCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    sounds.playClick();

    if (!cardName.trim() || cardNumber.replace(/\s/g, '').length < 16 || cardExpiry.length < 5 || cardCvv.length < 3) {
      toast.error(isRtl ? 'يرجى إدخال تفاصيل بطاقة كاملة وصحيحة للفواتير.' : 'Please provide complete and valid credit card credentials.');
      return;
    }

    setProcessing(true);
    try {
      toast.error(isRtl
        ? 'دفع البطاقة غير مدعوم هنا. استخدم Google Play من تطبيق أندرويد.'
        : 'Card checkout is not available here. Use Google Play in the Android app.');
    } catch (err) {
      console.error("Critical: subscription payment propagation failed", err);
      toast.error(isRtl ? 'حدث خطأ أثناء ترقية الحساب، يرجى المحاولة لاحقاً.' : 'Secure payment failed to store on server, please check connection.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 text-slate-100 font-sans relative overflow-hidden">
      
      {/* Decorative dangerous warning backgrounds */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] right-[-20%] w-[80vw] h-[80vw] bg-blue-950/20 rounded-full blur-[180px]" />
        <div className="absolute bottom-[-30%] left-[-20%] w-[70vw] h-[70vw] bg-indigo-950/35 rounded-full blur-[140px]" />
      </div>

      {/* Language toggle at head */}
      <header className="absolute top-4 sm:top-6 left-4 sm:left-6 right-4 sm:right-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-indigo-600/10 border border-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400">
            <ShieldCheck size={20} className="text-blue-400 animate-pulse" />
          </div>
          <div>
            <span className="text-xs font-black uppercase text-slate-450 tracking-widest leading-none block">Mostawdaee</span>
            <span className="text-[10px] text-indigo-400 font-bold block mt-0.5">{isRtl ? 'بوابة الاشتراك وإدارة التراخيص' : 'Billing & Subscriptions'}</span>
          </div>
        </div>

        <button
          onClick={onLanguageToggle}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-705 hover:bg-slate-800 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
        >
          <Globe2 size={13} className="text-indigo-400" />
          <span>{isRtl ? 'English' : 'عربي (الأردن)'}</span>
        </button>
      </header>

      {/* Switching Views with Animation */}
      <AnimatePresence mode="wait">
        {!showCheckout ? (
          /* State 1: Locked Subscription Warning Screen */
          <motion.div 
            key="lock-screen"
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -15 }}
            className="w-full max-w-2xl bg-slate-905 bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-[2.5rem] shadow-2xl p-6 sm:p-10 space-y-8 relative z-10"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-blue-500/0 via-indigo-550/40 to-blue-500/0" />

            {/* Warning Icon & Title Block */}
            <div className="text-center space-y-3">
              <div className="inline-flex p-4 bg-indigo-500/10 rounded-3xl border border-indigo-500/20 text-indigo-400 shadow-inner mb-2">
                <Lock size={36} className="text-blue-450" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight">
                {t.title}
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed font-semibold max-w-xl mx-auto">
                {t.subtitle}
              </p>
            </div>

            {/* Sync Explanation Block */}
            <div className="p-5 bg-slate-950/90 rounded-2xl border border-indigo-950/30 flex gap-4">
              <div className="p-2 text-indigo-400 bg-indigo-500/10 rounded-xl h-fit shrink-0 border border-indigo-500/15">
                <Gift size={20} className="text-blue-400 animate-bounce" />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-black text-slate-200 block leading-tight">{t.syncAlert}</span>
                <span className="text-[11px] text-slate-400 leading-relaxed block font-medium">{t.syncText}</span>
              </div>
            </div>

            {/* Table representation showing subscriber info */}
            <div className="p-5 bg-slate-950/70 rounded-2xl border border-slate-800/60 space-y-3">
              <span className="text-[10px] font-black tracking-widest text-slate-500 uppercase block">{t.detailsTitle}</span>
              
              <div className="space-y-2 text-xs divide-y divide-slate-800/30">
                <div className="flex justify-between items-center py-2 first:pt-0">
                  <span className="text-slate-400 font-medium">{t.lblStatus}</span>
                  <span className="font-extrabold text-blue-400">{t.valExpired}</span>
                </div>
                {expiryDate && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-slate-400 font-medium">{t.lblExpiry}</span>
                    <span className="font-mono text-slate-300 font-bold">{new Date(expiryDate).toLocaleDateString(isRtl ? 'ar-JO' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 last:pb-0">
                  <span className="text-slate-400 font-medium">{t.lblPrice}</span>
                  <span className="font-bold text-amber-400">{t.valPrice}</span>
                </div>
              </div>
            </div>

            {/* Action buttons stack */}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleGooglePlayPurchase}
                disabled={gplayProcessing}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-800 text-white font-black text-xs rounded-xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/25 transition flex items-center justify-center gap-2 cursor-pointer border border-emerald-500/20"
              >
                <Smartphone size={14} className={gplayProcessing ? "animate-bounce" : ""} />
                <span>{gplayProcessing ? (isRtl ? 'جاري الاتصال بـ Google Play...' : 'Connecting to Google Play...') : (isRtl ? 'ترقية فورية ترخيص مستودعي عبر Google Play ($100.00)' : 'Instant Upgrade via Google Play ($100.00)')}</span>
              </button>

              <button
                type="button"
                onClick={() => { sounds.playClick(); setShowCheckout(true); }}
                className="w-full py-4 bg-slate-900 border border-slate-850 hover:bg-slate-800 text-slate-350 hover:text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <CreditCard size={14} />
                <span>{isRtl ? 'دفع بديل بالبطاقة الائتمانية' : 'Alternative Credit / Debit Card'}</span>
              </button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleManualRecheck}
                  disabled={recalculating}
                  className="py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-950 text-slate-300 font-bold text-xs rounded-xl border border-slate-800 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCw size={13} className={recalculating ? "animate-spin" : ""} />
                  <span>{recalculating ? t.checking : t.actionRefresh}</span>
                </button>

                <button
                  onClick={handleSignOut}
                  className="py-3 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-xs rounded-xl border border-slate-800 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut size={13} />
                  <span>{t.actionLogout}</span>
                </button>
              </div>
            </div>

            {/* Support option */}
            <div className="text-center">
              <button
                onClick={() => { sounds.playClick(); window.open('mailto:support@mostawdaee.com?subject=Subscription%20Issue', '_blank'); }}
                className="text-[11px] text-indigo-400 hover:underline cursor-pointer font-bold inline-flex items-center gap-1"
              >
                <HelpCircle size={12} />
                <span>{t.actionSupport}</span>
              </button>
            </div>

          </motion.div>
        ) : (
          /* State 2: Interactive Secure Credit Card Checkout Form */
          <motion.div 
            key="payment-screen"
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -15 }}
            className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-2xl p-6 sm:p-10 space-y-6 relative z-10 text-slate-100"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-emerald-500/0 via-emerald-555/40 to-emerald-500/0" />

            {/* Header checkout block */}
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-400 font-bold text-[10px] tracking-wider uppercase">
                <Lock size={10} />
                <span>{t.secureBadge}</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white pt-2.5">
                {t.payTitle}
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed font-semibold">
                {t.paySubtitle}
              </p>
            </div>

            {/* Live Interactive Card Visualization Mock */}
            <div className="p-6 bg-gradient-to-br from-indigo-900 via-slate-950 to-blue-900 rounded-3xl border border-indigo-500/20 shadow-xl relative overflow-hidden text-white font-mono aspect-[1.58/1] flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400 leading-none">Mastawdaee Premium</span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Sparkles size={11} className="text-amber-400 animate-pulse" />
                    <span className="text-[10px] uppercase font-black tracking-widest text-indigo-350 bg-indigo-500/20 px-1.5 py-0.5 rounded leading-none">Yearly Plan</span>
                  </div>
                </div>
                <div className="h-6 w-9 rounded bg-slate-800/80 flex items-center justify-center text-[10px] font-black border border-slate-700">VISA</div>
              </div>

              {/* Card Number display */}
              <div className="space-y-0.5 my-3">
                <span className="text-[8px] uppercase tracking-wider text-slate-500 block">Card Number</span>
                <span className="text-sm sm:text-base tracking-widest block font-bold text-slate-100">
                  {cardNumber || '•••• •••• •••• ••••'}
                </span>
              </div>

              <div className="flex justify-between items-end">
                <div className="space-y-0.5">
                  <span className="text-[8px] uppercase tracking-wider text-slate-500 block">Card Holder</span>
                  <span className="text-xs tracking-wide block uppercase font-bold text-slate-350 truncate max-w-[180px]">
                    {cardName || 'YOUR FULL NAME'}
                  </span>
                </div>
                <div className="flex gap-4">
                  <div className="space-y-0.5 text-right">
                    <span className="text-[8px] uppercase tracking-wider text-slate-500 block">Expires</span>
                    <span className="text-xs font-bold block">{cardExpiry || 'MM/YY'}</span>
                  </div>
                  <div className="space-y-0.5 text-right">
                    <span className="text-[8px] uppercase tracking-wider text-slate-500 block">CVV</span>
                    <span className="text-xs font-bold block">{cardCvv || '•••'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Form Fields Inputs */}
            <form onSubmit={handleSecureCheckout} className="space-y-4">
              
              {/* Cardholder Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block flex items-center gap-1.5">
                  <User size={12} className="text-slate-400" />
                  <span>{t.cardHolder}</span>
                </label>
                <input
                  type="text"
                  required
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder={t.cardHolderPlaceholder}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-850 border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl text-xs placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500/20 font-semibold"
                />
              </div>

              {/* Card Number */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block flex items-center gap-1.5">
                  <Hash size={12} className="text-slate-400" />
                  <span>{t.cardNumber}</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={19}
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                  placeholder="4000 1234 5678 9010"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-850 border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl text-xs placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500/20 font-mono font-bold tracking-widest"
                />
              </div>

              {/* Expiry & CVV */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 block">
                    {t.cardExpiry}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={5}
                    value={cardExpiry}
                    onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                    placeholder="MM/YY"
                    className="w-full px-4 py-3 bg-slate-950 border border-slate-850 border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl text-xs placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500/20 font-mono font-bold text-center"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 block">
                    {t.cardCvv}
                  </label>
                  <input
                    type="password"
                    required
                    maxLength={4}
                    value={cardCvv}
                    onChange={(e) => setCardCvv(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="•••"
                    className="w-full px-4 py-3 bg-slate-950 border border-slate-850 border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl text-xs placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500/20 font-mono font-bold text-center"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 flex flex-col gap-3">
                <button
                  type="submit"
                  disabled={processing}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-850 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-600/15 hover:shadow-emerald-650/30 transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {processing ? (
                    <div className="flex items-center gap-2">
                      <RotateCw size={13} className="animate-spin" />
                      <span>{t.payingState}</span>
                    </div>
                  ) : (
                    <>
                      <ShieldCheck size={14} className="text-emerald-300" />
                      <span>{t.payButton}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => { sounds.playClick(); setShowCheckout(false); }}
                  disabled={processing}
                  className="w-full py-3 bg-slate-950 hover:bg-slate-900 disabled:opacity-50 text-slate-450 text-xs font-semibold rounded-xl border border-slate-850 border-slate-800 transition flex items-center justify-center gap-1 cursor-pointer"
                >
                  {isRtl ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                  <span>{t.cancelButton}</span>
                </button>
              </div>

            </form>

          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
