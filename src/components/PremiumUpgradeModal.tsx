import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldCheck, RotateCw, Smartphone, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { sounds } from '../lib/sounds';
import { initializeBilling, makePurchase, PLAY_PREMIUM_FALLBACK_PRICE, PLAY_PREMIUM_PRODUCT_ID } from '../services/billing';
import { activatePaidSubscription, restoreOwnedPurchases } from '../lib/activateSubscription';
import { usePlayPrice } from '../hooks/usePlayPrice';

interface PremiumUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: 'ar' | 'en';
  onUpgradeSuccess: () => void;
  /** True when the account already has an active premium license (renewal wording). */
  isRenewal?: boolean;
}

const premiumFeatures = [
  {
    titleAr: 'بيع ومخزون وخزنة بلا انقطاع',
    titleEn: 'Sales, stock and vault without interruption',
    descAr: 'متابعة العمل اليومي بعد انتهاء الفترة التجريبية دون قفل الشاشات.',
    descEn: 'Keep day-to-day work running after the trial ends, without locked screens.',
  },
  {
    titleAr: 'مزامنة ونسخ احتياطي سحابي',
    titleEn: 'Cloud sync and backups',
    descAr: 'بياناتك محفوظة على السحابة ومتاحة من أي جهاز بنفس الحساب.',
    descEn: 'Your data stays in the cloud and is available on any device with the same account.',
  },
  {
    titleAr: 'تطبيق الهاتف وإدارة الفريق',
    titleEn: 'Mobile app and team access',
    descAr: 'مبيعات ومسح باركود من أندرويد، مع عمل أعضاء الفريق على نفس المتجر.',
    descEn: 'Sales and barcode scanning on Android, with team members on the same store.',
  },
  {
    titleAr: 'عملات متعددة وتقارير أرباح',
    titleEn: 'Multi-currency and profit reports',
    descAr: 'خزنة وديون ومبيعات منفصلة لكل عملة، مع تقارير هوامش واضحة.',
    descEn: 'Separate vault, debts and sales per currency, with clear margin reports.',
  },
];

export default function PremiumUpgradeModal({
  isOpen,
  onClose,
  language,
  onUpgradeSuccess,
  isRenewal = false,
}: PremiumUpgradeModalProps) {
  const isRtl = language === 'ar';
  const isNative = Capacitor.isNativePlatform();
  const [processing, setProcessing] = useState(false);
  const playPrice = usePlayPrice(PLAY_PREMIUM_PRODUCT_ID, isNative && isOpen);

  const handleRestore = async () => {
    sounds?.playClick();
    setProcessing(true);
    try {
      const result = await restoreOwnedPurchases();
      onUpgradeSuccess();
      if (result.found === 0) {
        toast.info(isRtl ? 'لا توجد مشتريات لهذا التطبيق على حساب Google في هذا الهاتف.' : 'No purchases for this app were found on this phone\'s Google account.');
      } else if (result.linked === 0) {
        toast.error(result.errors[0] || (isRtl ? 'تعذّرت استعادة الاشتراك.' : 'Could not restore the subscription.'));
      } else {
        toast.success(isRtl ? 'تمت استعادة الاشتراك.' : 'Subscription restored.');
        onClose();
      }
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذّرت استعادة المشتريات.' : 'Could not restore purchases.'));
    } finally {
      setProcessing(false);
    }
  };

  // The only supported payment method is Google Play Billing (verified server-side).
  // The old card form / browser "Google Pay" could never activate a license, so they were removed.
  const handlePurchase = async () => {
    sounds?.playClick();
    if (!isNative) {
      toast.info(isRtl
        ? 'الاشتراك يتم عبر تطبيق مستودعي على أندرويد (Google Play).'
        : 'Subscriptions are purchased from the Mostawdaee Android app (Google Play).');
      return;
    }

    setProcessing(true);
    try {
      initializeBilling(
        async (tx) => {
          setProcessing(true);
          try {
            await activatePaidSubscription(tx);
            sounds?.playSuccess();
            toast.success(isRtl ? 'تم تفعيل اشتراكك بنجاح!' : 'Your subscription is now active!');
            onUpgradeSuccess();
            onClose();
          } catch (err) {
            toast.error((isRtl ? 'فشل تفعيل الاشتراك: ' : 'Could not activate the subscription: ') + (err instanceof Error ? err.message : ''));
            throw err; // keep the Google Play purchase pending so it is retried
          } finally {
            setProcessing(false);
          }
        },
        (message) => {
          toast.error((isRtl ? 'خطأ Google Play: ' : 'Google Play error: ') + message);
          setProcessing(false);
        }
      );
      await makePurchase(PLAY_PREMIUM_PRODUCT_ID);
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر بدء عملية الشراء' : 'Could not start the purchase'));
    } finally {
      // The approved purchase arrives later through the billing callback; a cancelled or pending one never does.
      setProcessing(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={processing ? undefined : onClose}
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm cursor-pointer"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl relative overflow-hidden z-10 flex flex-col max-h-[90vh]"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3 shrink-0">
              <div className="space-y-1 min-w-0">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  {isRenewal
                    ? (isRtl ? 'تجديد الاشتراك' : 'Renew subscription')
                    : (isRtl ? 'تفعيل الاشتراك السنوي' : 'Activate annual subscription')}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  {isRtl
                    ? 'اشتراك سنوي يُدار عبر Google Play. يتجدد تلقائياً ما لم تلغِه من حسابك.'
                    : 'Annual plan managed through Google Play. Renews automatically unless you cancel in your account.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={processing}
                className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white flex items-center justify-center transition cursor-pointer shrink-0"
                title={isRtl ? 'إغلاق' : 'Close'}
                aria-label={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto space-y-5 flex-1 custom-scrollbar">
              <ul className="space-y-3">
                {premiumFeatures.map((feat, index) => (
                  <li key={index} className="flex gap-3 items-start">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                    <div className="space-y-0.5 min-w-0">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                        {isRtl ? feat.titleAr : feat.titleEn}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {isRtl ? feat.descAr : feat.descEn}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                    {isRtl ? 'الاشتراك السنوي' : 'Annual subscription'}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 block leading-relaxed">
                    {isRtl
                      ? 'يشمل المزامنة السحابية والتحديثات. الإلغاء من Google Play.'
                      : 'Includes cloud sync and updates. Cancel anytime in Google Play.'}
                  </span>
                </div>
                <div className="flex flex-col items-start sm:items-end gap-0.5 shrink-0">
                  <div className="flex items-baseline gap-1" dir="ltr">
                    <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                      {playPrice || PLAY_PREMIUM_FALLBACK_PRICE}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">/{isRtl ? 'سنة' : 'year'}</span>
                  </div>
                  {!playPrice && (
                    <span className="text-[11px] text-slate-500 leading-snug max-w-[14rem] sm:text-end">
                      {isRtl
                        ? 'السعر النهائي بعملتك يظهر في Google Play قبل التأكيد'
                        : 'Google Play shows the final price in your currency before you confirm'}
                    </span>
                  )}
                </div>
              </div>

              {isNative ? (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={handlePurchase}
                    disabled={processing}
                    className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {processing ? (
                      <>
                        <RotateCw className="w-4 h-4 animate-spin" />
                        <span>{isRtl ? 'جارٍ المعالجة...' : 'Processing...'}</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>
                          {isRenewal
                            ? (isRtl ? 'التجديد عبر Google Play' : 'Renew with Google Play')
                            : (isRtl ? 'الاشتراك عبر Google Play' : 'Subscribe with Google Play')}
                        </span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleRestore}
                    disabled={processing}
                    className="w-full py-3 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 text-slate-700 dark:text-slate-200 font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>{isRtl ? 'استعادة مشترياتي' : 'Restore purchases'}</span>
                  </button>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-start gap-3">
                  <Smartphone className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {isRtl
                      ? 'الدفع متاح من تطبيق مستودعي على أندرويد فقط عبر Google Play. افتح التطبيق على هاتفك بنفس الحساب وسيظهر الاشتراك مفعّلاً هنا.'
                      : 'Payment is available only in the Mostawdaee Android app through Google Play. Open the app with the same account and the subscription will show as active here.'}
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950/80 border-t border-slate-100 dark:border-slate-800 text-center shrink-0 flex items-center justify-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                {isRtl
                  ? 'الدفع تتولاه Google Play بالكامل، ولا نخزّن أي بيانات بطاقة.'
                  : 'Payments are handled entirely by Google Play. We never store card details.'}
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
