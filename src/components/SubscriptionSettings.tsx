import React, { useEffect, useState } from 'react';
import { Crown, Sparkles, CalendarClock, ExternalLink, UserRound, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { useSubscriptionSync } from '../hooks/useSubscriptionSync';
import { useAuth } from './AuthContext';
import PremiumUpgradeModal from './PremiumUpgradeModal';
import { sounds } from '../lib/sounds';

interface Props {
  language: 'ar' | 'en';
}

const PLAY_SUBSCRIPTIONS_URL =
  'https://play.google.com/store/account/subscriptions?sku=mostawdaee_premium_100&package=com.mostawdaee.app';

/** Subscription status + upgrade/renew entry point (lives in Settings, not in the sidebar). */
export default function SubscriptionSettings({ language }: Props) {
  const isRtl = language === 'ar';
  const { isGuest } = useAuth();
  const { loading, isPremiumActive, isTrialActive, daysRemaining, subscription, refreshSubscription } = useSubscriptionSync();
  const [modalOpen, setModalOpen] = useState(false);
  const [showExpiryNotice, setShowExpiryNotice] = useState(false);

  const noticeKey = subscription?.user_id
    ? `mustawdae:${subscription.user_id}:sub_notice_${subscription.expiry_date || 'none'}`
    : '';

  useEffect(() => {
    if (isGuest || loading || !noticeKey) {
      setShowExpiryNotice(false);
      return;
    }
    const shouldWarn = (!isPremiumActive && isTrialActive && daysRemaining <= 5)
      || (isPremiumActive && daysRemaining <= 7);
    if (!shouldWarn) {
      setShowExpiryNotice(false);
      return;
    }
    try {
      setShowExpiryNotice(localStorage.getItem(noticeKey) !== 'dismissed');
    } catch {
      setShowExpiryNotice(true);
    }
  }, [isGuest, loading, noticeKey, isPremiumActive, isTrialActive, daysRemaining]);

  const dismissNotice = () => {
    setShowExpiryNotice(false);
    try {
      if (noticeKey) localStorage.setItem(noticeKey, 'dismissed');
    } catch {
      /* ignore */
    }
  };

  const expiryLabel = subscription?.expiry_date
    ? new Date(subscription.expiry_date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const renewalDue = isPremiumActive && daysRemaining <= 30;

  const status = isGuest
    ? { label: isRtl ? 'وضع الضيف' : 'Guest mode', tone: 'slate' }
    : isPremiumActive
      ? { label: isRtl ? 'النسخة الكاملة (Premium)' : 'Premium', tone: 'emerald' }
      : isTrialActive
        ? { label: isRtl ? 'فترة تجريبية' : 'Free trial', tone: 'cyan' }
        : { label: isRtl ? 'غير مفعّل' : 'Inactive', tone: 'rose' };

  const toneClasses: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
    cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-400',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400',
  };

  const openManage = async () => {
    sounds?.playClick();
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: PLAY_SUBSCRIPTIONS_URL });
    } else {
      window.open(PLAY_SUBSCRIPTIONS_URL, '_blank', 'noopener');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Crown className="text-amber-500" />
        <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-wider">
          {isRtl ? 'الاشتراك' : 'Subscription'}
        </h2>
      </div>

      {showExpiryNotice && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 flex items-start gap-3">
          <CalendarClock size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="flex-1 text-sm font-semibold text-amber-900 dark:text-amber-200 leading-relaxed">
            {isPremiumActive
              ? (isRtl
                  ? `ينتهي اشتراكك خلال ${daysRemaining} أيام. جدّده الآن حتى لا يتوقف العمل.`
                  : `Your subscription ends in ${daysRemaining} days. Renew now so work is not interrupted.`)
              : (isRtl
                  ? `تنتهي الفترة التجريبية خلال ${daysRemaining} أيام. رقِّ الحساب من هنا قبل أن تُقفل الشاشات.`
                  : `Your free trial ends in ${daysRemaining} days. Upgrade here before the app locks.`)}
          </p>
          <button
            type="button"
            onClick={dismissNotice}
            className="p-1 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer"
            title={isRtl ? 'إخفاء' : 'Dismiss'}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="p-8 bg-gray-50 dark:bg-gray-800/50 rounded-[2.5rem] border border-gray-200 dark:border-gray-700/50 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1.5 rounded-xl text-xs font-black ${toneClasses[status.tone]}`}>{status.label}</span>
            {loading && <span className="text-xs text-gray-400">{isRtl ? 'جاري التحقق...' : 'Checking...'}</span>}
          </div>
          {!isGuest && (isPremiumActive || isTrialActive) && (
            <div className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <CalendarClock size={16} className="text-indigo-500" />
              <span>
                {isRtl ? `${daysRemaining} يوماً متبقية` : `${daysRemaining} days left`}
                {expiryLabel ? ` · ${expiryLabel}` : ''}
              </span>
            </div>
          )}
        </div>

        {isGuest ? (
          <div className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400 font-medium">
            <UserRound size={18} className="mt-0.5 shrink-0" />
            <p>
              {isRtl
                ? 'أنت تستخدم النظام بدون حساب. سجّل الدخول بحساب لحفظ بياناتك على السحابة وبدء فترة التجربة المجانية (25 يوماً).'
                : 'You are using the app without an account. Sign in to save your data in the cloud and start the 25-day free trial.'}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400 font-medium leading-relaxed">
            {isPremiumActive
              ? (isRtl
                  ? 'اشتراكك السنوي فعّال. يتجدد تلقائياً عبر Google Play ما لم تلغِه.'
                  : 'Your annual subscription is active. It renews automatically through Google Play unless you cancel it.')
              : (isRtl
                  ? 'الاشتراك السنوي بقيمة 100$ يفتح كامل المزايا: المزامنة السحابية، تطبيق الهاتف، تعدد العملات والتقارير.'
                  : 'The $100/year plan unlocks everything: cloud sync, the mobile app, multi-currency and reports.')}
          </p>
        )}

        {!isGuest && (
          <div className="flex flex-wrap gap-3">
            {(!isPremiumActive || renewalDue) && (
              <button
                type="button"
                onClick={() => { sounds?.playClick(); setModalOpen(true); }}
                className="px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-sm flex items-center gap-2 cursor-pointer shadow-lg"
              >
                <Sparkles size={16} />
                {isPremiumActive
                  ? (isRtl ? 'تجديد الاشتراك' : 'Renew subscription')
                  : (isRtl ? 'ترقية للنسخة الكاملة' : 'Upgrade to Premium')}
              </button>
            )}
            {isPremiumActive && (
              <button
                type="button"
                onClick={openManage}
                className="px-5 py-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold text-sm flex items-center gap-2 cursor-pointer"
              >
                <ExternalLink size={16} />
                {isRtl ? 'إدارة الاشتراك في Google Play' : 'Manage in Google Play'}
              </button>
            )}
          </div>
        )}
      </div>

      <PremiumUpgradeModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        language={language}
        isRenewal={isPremiumActive}
        onUpgradeSuccess={() => { refreshSubscription(); }}
      />
    </div>
  );
}
