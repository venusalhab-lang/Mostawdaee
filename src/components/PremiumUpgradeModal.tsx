import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, ShieldCheck, RotateCw, Crown, Smartphone } from 'lucide-react';
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
    titleAr: 'سعة غير محدودة للتخزين والمخازن',
    titleEn: 'Unlimited Inventory & Storage Capacity',
    descAr: 'أضف ما تشاء من المنتجات والمستودعات الفرعية بدون قيود.',
    descEn: 'Store unlimited products and sub-warehouses without barriers.',
    color: 'from-blue-500 to-cyan-400',
  },
  {
    titleAr: 'مزامنة ونسخ احتياطي سحابي',
    titleEn: 'Cloud Sync & Backups',
    descAr: 'بياناتك محفوظة على السحابة ومتاحة من أي جهاز بنفس الحساب.',
    descEn: 'Your data is stored in the cloud and available on any device with the same account.',
    color: 'from-indigo-500 to-purple-400',
  },
  {
    titleAr: 'تطبيق الهاتف',
    titleEn: 'Mobile Companion App',
    descAr: 'إدارة المبيعات ومسح الباركود من هاتفك عبر تطبيق أندرويد.',
    descEn: 'Manage sales and scan barcodes from your phone with the Android app.',
    color: 'from-pink-500 to-rose-400',
  },
  {
    titleAr: 'دعم متعدد العملات',
    titleEn: 'Multi-Currency Support',
    descAr: 'خزنة وديون ومبيعات منفصلة لكل عملة: JOD، ILS، USD، IQD، SAR، AED، LYD، EGP.',
    descEn: 'Separate vault, debts and sales per currency: JOD, ILS, USD, IQD, SAR, AED, LYD and EGP.',
    color: 'from-emerald-500 to-teal-400',
  },
  {
    titleAr: 'التحليلات والأرباح',
    titleEn: 'Analytics & Profits',
    descAr: 'رسوم بيانية وتقارير أرباح وهوامش تفصيلية.',
    descEn: 'Charts, profit reports and detailed margins.',
    color: 'from-amber-500 to-orange-400',
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
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md cursor-pointer"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -15 }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="w-full max-w-2xl bg-slate-900 border border-indigo-950/40 rounded-[2.5rem] shadow-2xl relative overflow-hidden z-10 flex flex-col max-h-[90vh]"
          >
            <div className="p-6 pb-4 border-b border-slate-800/60 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/10">
                  <Crown className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white leading-none">
                    {isRenewal
                      ? (isRtl ? 'تجديد الاشتراك' : 'Renew Subscription')
                      : (isRtl ? 'الترقية للنسخة الكاملة' : 'Upgrade to Premium License')}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 font-medium">
                    {isRtl ? 'اشتراك سنوي عبر Google Play' : 'Annual plan billed through Google Play'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={processing}
                className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
                title={isRtl ? 'إغلاق' : 'Close'} aria-label={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
              <div className="space-y-3">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block">
                  {isRtl ? 'ما الذي ستحصل عليه؟' : 'What you get:'}
                </span>
                {premiumFeatures.map((feat, index) => (
                  <div key={index} className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 flex gap-4">
                    <div className={`mt-0.5 p-2 rounded-xl text-white bg-gradient-to-br ${feat.color} shadow-sm shrink-0 h-fit`}>
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-white leading-snug">{isRtl ? feat.titleAr : feat.titleEn}</h4>
                      <p className="text-xs text-slate-400 leading-relaxed font-medium">{isRtl ? feat.descAr : feat.descEn}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-5 rounded-2xl bg-gradient-to-br from-[#0a1228] to-[#121c3d] border border-cyan-500/10 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="space-y-1 text-center sm:text-right">
                  <span className="text-[10px] text-cyan-400 font-black tracking-widest uppercase block">
                    {isRtl ? 'الاشتراك السنوي' : 'ANNUAL PLAN'}
                  </span>
                  <span className="text-sm text-slate-300 block font-semibold">
                    {isRtl ? 'يشمل المزامنة السحابية والتحديثات والصيانة.' : 'Includes cloud sync, updates, and maintenance.'}
                  </span>
                </div>
                <div className="flex flex-col items-center sm:items-end gap-0.5">
                  <div className="flex items-baseline gap-1" dir="ltr">
                    <span className="text-3xl font-black text-white">{playPrice || PLAY_PREMIUM_FALLBACK_PRICE}</span>
                    <span className="text-xs text-slate-400 font-bold">/{isRtl ? 'سنوياً' : 'yr'}</span>
                  </div>
                  {!playPrice && (
                    <span className="text-[10px] text-slate-400 font-semibold">
                      {isRtl ? 'السعر النهائي بعملتك تعرضه Google Play قبل التأكيد' : 'Google Play shows the final price in your currency before you confirm'}
                    </span>
                  )}
                </div>
              </div>

              {isNative ? (
                <button
                  type="button"
                  onClick={handlePurchase}
                  disabled={processing}
                  className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-black text-sm shadow-xl active:scale-[0.99] transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  {processing ? (
                    <>
                      <RotateCw className="w-4 h-4 animate-spin" />
                      <span>{isRtl ? 'جارٍ المعالجة...' : 'Processing...'}</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-5 h-5" />
                      <span>
                        {isRenewal
                          ? (isRtl ? 'التجديد عبر Google Play' : 'Renew with Google Play')
                          : (isRtl ? 'الاشتراك عبر Google Play' : 'Subscribe with Google Play')}
                      </span>
                    </>
                  )}
                </button>
              ) : null}
              {isNative ? (
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={processing}
                  className="w-full py-3 rounded-2xl bg-slate-950 border border-slate-800 hover:bg-slate-800 disabled:opacity-60 text-slate-200 font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>{isRtl ? 'استعادة مشترياتي' : 'Restore purchases'}</span>
                </button>
              ) : (
                <div className="p-4 rounded-2xl bg-slate-950 border border-amber-500/20 flex items-start gap-3">
                  <Smartphone className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-300 leading-relaxed font-semibold">
                    {isRtl
                      ? 'الدفع متاح من تطبيق مستودعي على أندرويد فقط عبر Google Play. افتح التطبيق على هاتفك بنفس الحساب وسيظهر الاشتراك مفعّلاً هنا.'
                      : 'Payment is available only in the Mostawdaee Android app through Google Play. Open the app with the same account and the subscription will show as active here.'}
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-950/70 border-t border-slate-800/60 text-center shrink-0 flex items-center justify-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span className="text-[10px] sm:text-xs text-slate-500 font-bold">
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
