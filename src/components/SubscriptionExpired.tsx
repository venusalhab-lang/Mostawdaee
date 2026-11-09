import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Globe2, HelpCircle, Lock, LogOut, RotateCw, ShieldCheck, Smartphone, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { sounds } from '../lib/sounds';
import { initializeBilling, makePurchase, PLAY_PREMIUM_PRODUCT_ID } from '../services/billing';
import { activatePaidSubscription, restoreOwnedPurchases, syncPaidSubscription } from '../lib/activateSubscription';

export type LockReason = 'trial' | 'paid' | 'unverified';

interface Props {
  language: 'en' | 'ar';
  onLanguageToggle: () => void;
  reason: LockReason;
  expiryDate?: string | null;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  /** Set when this account works in someone else's store: only the owner can renew. */
  member?: { storeName: string; ownerEmail: string; onLeave: () => Promise<void> } | null;
}

const PRODUCT_ID = PLAY_PREMIUM_PRODUCT_ID;

export default function SubscriptionExpired({ language, onLanguageToggle, reason, expiryDate, onRefresh, onLogout, member }: Props) {
  const isRtl = language === 'ar';
  const isNative = Capacitor.isNativePlatform();
  const [busy, setBusy] = useState<null | 'buy' | 'restore' | 'check' | 'leave'>(null);

  const title = reason === 'unverified'
    ? (isRtl ? 'تعذّر التحقق من الاشتراك' : 'Subscription could not be verified')
    : reason === 'trial'
      ? (isRtl ? 'انتهت الفترة التجريبية' : 'Your free trial has ended')
      : (isRtl ? 'انتهى الاشتراك' : 'Your subscription has ended');

  const storeLabel = member?.storeName || (isRtl ? 'المتجر' : 'the store');
  const subtitle = member && reason !== 'unverified'
    ? (isRtl
      ? `اشتراك «${storeLabel}» غير فعّال، فتوقف العمل فيه مؤقتاً. تواصل مع مالك المتجر${member.ownerEmail ? ` (${member.ownerEmail})` : ''} لتجديده، ثم اضغط «إعادة التحقق».`
      : `The subscription of "${storeLabel}" is not active, so work there is paused. Ask the store owner${member.ownerEmail ? ` (${member.ownerEmail})` : ''} to renew, then press "Check again".`)
    : reason === 'unverified'
    ? (isRtl
      ? 'لم نتمكن من الوصول إلى الخادم للتأكد من حالة اشتراكك. تحقق من الاتصال ثم أعد المحاولة. بياناتك محفوظة ولم يُحذف شيء.'
      : 'We could not reach the server to confirm your subscription. Check your connection and try again. Your data is safe.')
    : (isRtl
      ? 'بياناتك محفوظة كما هي. جدّد الاشتراك لمتابعة البيع وإدارة المخزون.'
      : 'Your data is kept as it is. Renew to continue selling and managing stock.');

  const recheck = async () => {
    sounds.playClick();
    setBusy('check');
    try {
      if (!member) await syncPaidSubscription().catch(() => {});
      await onRefresh();
    } catch {
      toast.error(isRtl ? 'تعذّر الاتصال بالخادم.' : 'Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const buy = async () => {
    sounds.playClick();
    setBusy('buy');
    try {
      await initializeBilling(
        async (tx) => {
          setBusy('buy');
          try {
            await activatePaidSubscription(tx);
            toast.success(isRtl ? 'تم تفعيل اشتراكك.' : 'Your subscription is active.');
            sounds.playSuccess();
            await onRefresh();
          } catch (err) {
            toast.error((isRtl ? 'لم يُفعَّل الاشتراك بعد: ' : 'Subscription not activated yet: ') + (err instanceof Error ? err.message : ''));
            throw err; // keeps the Google Play purchase pending so activation is retried
          } finally {
            setBusy(null);
          }
        },
        (message) => {
          toast.error((isRtl ? 'خطأ Google Play: ' : 'Google Play error: ') + message);
          setBusy(null);
        },
      );
      await makePurchase(PRODUCT_ID);
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذّر بدء الشراء' : 'Could not start the purchase'));
    } finally {
      // Google Play reports the approved purchase later; the screen must not stay locked if it never comes (cancelled or pending payment).
      setBusy(null);
    }
  };

  const restore = async () => {
    sounds.playClick();
    setBusy('restore');
    try {
      const result = await restoreOwnedPurchases();
      await onRefresh();
      if (result.found === 0) {
        toast.info(isRtl
          ? 'لا توجد مشتريات لهذا التطبيق على حساب Google في هذا الهاتف.'
          : 'No purchases for this app were found on this phone\'s Google account.');
      } else if (result.linked === 0) {
        toast.error(result.errors[0] || (isRtl ? 'تعذّرت استعادة الاشتراك.' : 'Could not restore the subscription.'));
      }
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذّرت استعادة المشتريات.' : 'Could not restore purchases.'));
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    if (!member) return;
    sounds.playClick();
    setBusy('leave');
    try {
      await member.onLeave();
    } finally {
      setBusy(null);
    }
  };

  const formattedExpiry = expiryDate && Number.isFinite(Date.parse(expiryDate))
    ? new Date(expiryDate).toLocaleDateString(isRtl ? 'ar' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const secondary = 'py-3 bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-slate-200 font-semibold text-xs rounded-2xl border border-slate-800 transition flex items-center justify-center gap-2 cursor-pointer';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 text-slate-100" dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="absolute top-4 inset-x-4 sm:inset-x-6 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-300 tracking-tight">{isRtl ? 'مستودعي' : 'Mostawdaee'}</span>
        </div>
        <button
          type="button"
          onClick={onLanguageToggle}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs font-medium transition cursor-pointer"
        >
          <Globe2 size={13} className="text-slate-400" />
          <span>{isRtl ? 'English' : 'العربية'}</span>
        </button>
      </header>

      <main className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
        <div className="text-center space-y-3">
          <div className="inline-flex p-3.5 bg-slate-950 rounded-2xl border border-slate-800 text-slate-400">
            {reason === 'unverified' ? <WifiOff size={26} /> : <Lock size={26} />}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h1>
          <p className="text-sm text-slate-400 leading-relaxed">{subtitle}</p>
          {formattedExpiry && reason !== 'unverified' && (
            <p className="text-xs text-slate-500">
              {isRtl ? 'تاريخ الانتهاء: ' : 'Ended on: '}<span className="font-semibold text-slate-300">{formattedExpiry}</span>
            </p>
          )}
        </div>

        {reason !== 'unverified' && !member && (
          isNative ? (
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={buy}
                disabled={busy !== null}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-sm rounded-2xl transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Smartphone size={16} />
                <span>{busy === 'buy' ? (isRtl ? 'جارٍ الاتصال بـ Google Play...' : 'Connecting to Google Play...') : (isRtl ? 'الاشتراك السنوي عبر Google Play' : 'Annual subscription via Google Play')}</span>
              </button>
              <button type="button" onClick={restore} disabled={busy !== null} className={`w-full ${secondary}`}>
                <RotateCw size={13} className={busy === 'restore' ? 'animate-spin' : ''} />
                <span>{isRtl ? 'استعادة مشترياتي' : 'Restore purchases'}</span>
              </button>
              <p className="text-[11px] text-slate-500 text-center leading-relaxed pt-1">
                {isRtl
                  ? 'السعر النهائي بعملتك يظهر في Google Play قبل التأكيد. الدفع عبر Google ولا نخزّن بيانات بطاقة.'
                  : 'Google Play shows the final price before you confirm. Payment is via Google; we never store card details.'}
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-start gap-3">
              <Smartphone className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-400 leading-relaxed">
                {isRtl
                  ? 'الاشتراك يتم من تطبيق مستودعي على أندرويد عبر Google Play بنفس الحساب. بعد الاشتراك اضغط «إعادة التحقق».'
                  : 'Subscribe in the Mostawdaee Android app through Google Play with the same account, then press "Check again".'}
              </p>
            </div>
          )
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button type="button" onClick={recheck} disabled={busy !== null} className={secondary}>
            <RotateCw size={13} className={busy === 'check' ? 'animate-spin' : ''} />
            <span>{busy === 'check' ? (isRtl ? 'جارٍ التحقق...' : 'Checking...') : (isRtl ? 'إعادة التحقق' : 'Check again')}</span>
          </button>
          <button
            type="button"
            onClick={() => { sounds.playClick(); onLogout(); }}
            className={secondary}
          >
            <LogOut size={13} />
            <span>{isRtl ? 'تسجيل الخروج' : 'Sign out'}</span>
          </button>
        </div>

        {member && (
          <button type="button" onClick={leave} disabled={busy !== null} className={`w-full ${secondary}`}>
            <span>{busy === 'leave' ? (isRtl ? 'جارٍ المغادرة...' : 'Leaving...') : (isRtl ? `مغادرة «${storeLabel}» والعودة إلى حسابي` : `Leave "${storeLabel}" and return to my account`)}</span>
          </button>
        )}

        <div className="text-center pt-1 border-t border-slate-800/80">
          <a
            href="mailto:venusalhab@gmail.com?subject=Subscription"
            className="text-[11px] text-slate-400 hover:text-slate-200 transition inline-flex items-center gap-1.5 pt-4 font-medium"
          >
            <HelpCircle size={12} />
            <span>{isRtl ? 'التواصل مع الدعم' : 'Contact support'}</span>
          </a>
        </div>
      </main>
    </div>
  );
}
