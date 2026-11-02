import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { motion, AnimatePresence } from 'motion/react';
import {
  Globe2,
  Loader2,
  X,
  FileText,
  ShieldCheck,
  Lock,
  Mail,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { sounds } from '../lib/sounds';
import Logo from './Logo';
import { useAuth } from './AuthContext';
import { supabase } from '../supabaseClient';
import { APP_NAME_EN, appName } from '../lib/brand';
import { NATIVE_OAUTH_REDIRECT } from '../lib/nativeAuth';
import { isPasswordRecovery, setPasswordRecovery } from '../lib/passwordRecovery';
import PrivacyPolicyBody from './PrivacyPolicyBody';

interface Props {
  language?: 'en' | 'ar';
  onLanguageToggle?: () => void;
  onLoginSuccess?: (user: any) => void;
  onContinueAsGuest?: () => void;
}


type AuthErrorKey =
  | 'empty'
  | 'invalid'
  | 'unconfirmed'
  | 'registered'
  | 'rate'
  | 'weak'
  | 'email'
  | 'network'
  | 'generic'
  | 'reset_sent'
  | 'reset_need_email'
  | 'mismatch'
  | { raw: string };

function classifyAuthError(err: any): AuthErrorKey {
  const raw = String(err?.message || err || '');
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'invalid';
  if (lower.includes('email not confirmed')) return 'unconfirmed';
  if (lower.includes('user already registered') || lower.includes('already been registered')) return 'registered';
  if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('over_email_send_rate_limit')) return 'rate';
  if (lower.includes('password should be at least') || lower.includes('weak password')) return 'weak';
  if (lower.includes('unable to validate email') || lower.includes('invalid email')) return 'email';
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed') || lower.includes('load failed')) return 'network';
  return raw ? { raw } : 'generic';
}

function authMessage(key: AuthErrorKey, isRtl: boolean): string {
  const t = (ar: string, en: string) => (isRtl ? ar : en);
  if (typeof key === 'object') {
    // Our own messages are already localized; raw server text is not shown to merchants.
    if (/[\u0600-\u06FF]/.test(key.raw)) return key.raw;
    console.warn('[Auth] unclassified error:', key.raw);
    return t('تعذّر إكمال العملية. حاول مرة أخرى، وإن تكرر ذلك تواصل مع الدعم.', 'Something went wrong. Please try again, and contact support if it keeps happening.');
  }
  switch (key) {
    case 'empty': return t('يرجى إدخال البريد الإلكتروني وكلمة المرور.', 'Please enter your email and password.');
    case 'invalid': return t('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'Incorrect email or password.');
    case 'unconfirmed': return t('لم يتم تأكيد البريد بعد. افتح رسالة التفعيل في بريدك ثم أعد المحاولة.', 'Email not confirmed yet. Open the confirmation message and try again.');
    case 'registered': return t('هذا البريد مسجّل مسبقاً. سجّل الدخول بدلاً من إنشاء حساب.', 'This email is already registered. Sign in instead.');
    case 'rate': return t('محاولات كثيرة خلال وقت قصير. انتظر دقائق ثم أعد المحاولة.', 'Too many attempts. Please wait a few minutes and try again.');
    case 'weak': return t('كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.', 'Password is too weak. Use at least 6 characters.');
    case 'email': return t('صيغة البريد الإلكتروني غير صحيحة.', 'Invalid email address.');
    case 'network': return t('تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.', 'Cannot reach the server. Check your internet connection and try again.');
    case 'reset_sent': return t('إن كان البريد مسجّلاً، ستصل رسالة لإعادة تعيين كلمة المرور.', 'If this email is registered, a reset message is on its way.');
    case 'reset_need_email': return t('أدخل بريدك أولاً لإرسال رابط إعادة التعيين.', 'Enter your email first so we can send a reset link.');
    case 'mismatch': return t('كلمتا المرور غير متطابقتين.', 'The two passwords do not match.');
    default: return t('حدث خطأ غير متوقع أثناء تسجيل الدخول.', 'An unexpected sign-in error occurred.');
  }
}

export default function Auth({ language = 'ar', onLanguageToggle = () => {}, onLoginSuccess = () => {}, onContinueAsGuest }: Props) {
  const isRtl = language === 'ar';
  const authObjFromContext = useAuth() || {};
  const safeLoginWithGoogle = authObjFromContext.loginWithGoogle || (async () => {});
  const safeLoginWithEmail = authObjFromContext.loginWithEmail || (async () => {});
  const safeSignUpWithEmail = authObjFromContext.signUpWithEmail || (async () => {});
  const safeContinueAsGuest = onContinueAsGuest || authObjFromContext.continueAsGuest || (() => {});
  
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);

  // New Email/Password auth states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(isPasswordRecovery);
  const [authError, setAuthError] = useState<AuthErrorKey | null>(null);
  const [successKey, setSuccessKey] = useState<'created' | 'reset_sent' | 'password_updated' | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        setForgotMode(false);
        setIsSignUp(false);
        setAuthError(null);
        setSuccessKey(null);
      }
    });
    return () => {
      try { data.subscription.unsubscribe(); } catch { /* ignore */ }
    };
  }, []);

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    sounds.playClick();

    if (recoveryMode) {
      if (password.length < 6) {
        setAuthError('weak');
        return;
      }
      if (password !== confirmPassword) {
        setAuthError('mismatch');
        return;
      }
      setLoading(true);
      setLoadingStage(isRtl ? 'جارٍ حفظ كلمة المرور...' : 'Saving your new password...');
      setAuthError(null);
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setSuccessKey('password_updated');
        setRecoveryMode(false);
        setPassword('');
        setConfirmPassword('');
        toast.success(isRtl ? 'تم تحديث كلمة المرور.' : 'Password updated.');
        setPasswordRecovery(false);
      } catch (err: any) {
        setAuthError(classifyAuthError(err));
      } finally {
        setLoading(false);
        setLoadingStage('');
      }
      return;
    }

    if (forgotMode) {
      if (!email) {
        setAuthError('reset_need_email');
        return;
      }
      setLoading(true);
      setLoadingStage(isRtl ? 'جارٍ إرسال رابط إعادة التعيين...' : 'Sending the reset link...');
      setAuthError(null);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: Capacitor.isNativePlatform() ? NATIVE_OAUTH_REDIRECT : window.location.origin,
        });
        if (error) throw error;
        setSuccessKey('reset_sent');
        setForgotMode(false);
      } catch (err: any) {
        setAuthError(classifyAuthError(err));
      } finally {
        setLoading(false);
        setLoadingStage('');
      }
      return;
    }

    if (!email || !password) {
      setAuthError('empty');
      return;
    }

    setLoading(true);
    setLoadingStage(isSignUp
      ? (isRtl ? 'جارٍ إنشاء الحساب...' : 'Creating your account...')
      : (isRtl ? 'جارٍ تسجيل الدخول...' : 'Signing you in...'));
    setAuthError(null);
    setSuccessKey(null);

    try {
      if (isSignUp) {
        await safeSignUpWithEmail(email, password);
        setSuccessKey('created');
        toast.success(isRtl
          ? 'تم إنشاء الحساب. إن كان التأكيد مطلوباً فستصلك رسالة على بريدك.'
          : 'Account created. If confirmation is required, check your inbox.');
      } else {
        const u = await safeLoginWithEmail(email, password);
        if (u) {
          toast.success(isRtl ? 'تم تسجيل الدخول بنجاح.' : 'Signed in successfully.');
          onLoginSuccess(u);
        } else {
          throw new Error('Could not retrieve user data');
        }
      }
    } catch (err: any) {
      setAuthError(classifyAuthError(err));
    } finally {
      setLoading(false);
      setLoadingStage('');
    }
  };

  const handleGoogleSignIn = async () => {
    sounds.playClick();
    setLoading(true);
    setLoadingStage(isRtl ? 'جارٍ فتح Google...' : 'Opening Google...');
    setAuthError(null);
    try {
      await safeLoginWithGoogle();
    } catch (err: any) {
      setAuthError(classifyAuthError(err));
    } finally {
      setLoading(false);
      setLoadingStage('');
    }
  };

  const handleContinueAsGuest = () => {
    sounds.playClick();
    safeContinueAsGuest();
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 relative font-sans text-gray-800"
    >
      
      {/* Top Header Panel */}
      <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-10 pointer-events-auto">
        <div className="flex items-center gap-2 select-none">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse animate-duration-1000" />
          <span className="text-xs font-black text-gray-400 uppercase tracking-widest leading-none">{APP_NAME_EN}</span>
        </div>

        <button
          type="button"
          onClick={() => { sounds.playClick(); onLanguageToggle(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 rounded-xl text-xs font-semibold text-gray-600 transition shadow-xs cursor-pointer select-none"
        >
          <Globe2 size={13} className="text-gray-400" />
          <span>{isRtl ? 'English' : 'عربي'}</span>
        </button>
      </div>

      {/* Main Minimalist Welcome Box */}
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-sm bg-white border border-gray-100 rounded-[2rem] shadow-sm p-8 sm:p-10 text-center flex flex-col items-center relative overflow-hidden"
      >
        {/* Security token exchange / authentication progress overlay */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 z-[30] space-y-4 select-none pointer-events-auto"
            >
              <div className="relative flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-4 border-indigo-100 animate-pulse" />
                <Loader2 size={32} className="animate-spin text-indigo-600 absolute" />
              </div>
              <div className="space-y-1.5 text-center px-4">
                <p className="text-sm text-gray-600 font-semibold leading-relaxed min-h-[36px] flex items-center justify-center">
                  {loadingStage || (isRtl ? 'يرجى الانتظار...' : 'Please wait...')}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* App Logo */}
        <div className="mb-6 select-none">
          <Logo size={72} className="drop-shadow-sm" />
        </div>

        {/* Welcome titles */}
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">
          {isRtl ? `مرحبًا بك في ${appName(true)}` : `Welcome to ${appName(false)}`}
        </h1>
        
        <p className="text-sm text-gray-500 mt-2.5 mb-5 leading-relaxed font-normal">
          {isRtl 
            ? 'أدر مخزونك ومبيعاتك وفواتيرك ومستودعاتك.' 
            : 'Manage your inventory, payments, invoices, and warehouses efficiently.'}
        </p>

        {/* --- ERROR & SUCCESS CHIPS --- */}
        {authError && (
          <div className="w-full p-4 mb-5 bg-red-50 border border-red-200 rounded-2xl text-start flex items-start gap-2.5">
            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
            <p className="text-xs text-red-800 font-semibold leading-relaxed">
              {authMessage(authError, isRtl)}
            </p>
          </div>
        )}

        {successKey && (
          <div className="w-full p-4 mb-5 bg-emerald-50 border border-emerald-200 rounded-2xl text-start flex items-start gap-2.5">
            <ShieldCheck className="text-emerald-500 shrink-0 mt-0.5" size={16} />
            <p className="text-xs text-emerald-800 font-semibold leading-relaxed">
              {successKey === 'created'
                ? (isRtl ? 'تم إنشاء الحساب. إن كان التأكيد مطلوباً فستصلك رسالة على بريدك.' : 'Account created. If confirmation is required, check your inbox.')
                : successKey === 'reset_sent'
                  ? authMessage('reset_sent', isRtl)
                  : (isRtl ? 'تم تحديث كلمة المرور.' : 'Password updated.')}
            </p>
          </div>
        )}

        {!forgotMode && !recoveryMode && (
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full py-3.5 bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-200 hover:border-gray-300 text-gray-700 rounded-2xl text-sm font-semibold transition-all flex items-center justify-center gap-3 shadow-xs select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 size={18} className="animate-spin text-gray-400" />
          ) : (
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
            </svg>
          )}
          <span>
            {loading
              ? (isRtl ? 'جارٍ الفتح...' : 'Opening...')
              : (isRtl ? 'الدخول عبر Google' : 'Continue with Google')}
          </span>
        </button>
        )}

        {/* Email & Password login form */}
        <form onSubmit={handlePasswordSignIn} className="w-full space-y-3">
          {!recoveryMode && (
            <div className="relative">
              <span className="absolute inset-y-0 start-4 flex items-center text-gray-400">
                <Mail size={16} />
              </span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isRtl ? 'البريد الإلكتروني' : 'Email address'} aria-label={isRtl ? 'البريد الإلكتروني' : 'Email address'}
                className="w-full ps-11 pe-4 py-3 bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-2xl text-sm transition text-gray-800 placeholder-gray-400 outline-none"
                disabled={loading}
                required
              />
            </div>
          )}

          {!forgotMode && (
            <div className="relative">
              <span className="absolute inset-y-0 start-4 flex items-center text-gray-400">
                <Lock size={16} />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={isSignUp || recoveryMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={recoveryMode
                  ? (isRtl ? 'كلمة المرور الجديدة' : 'New password')
                  : (isRtl ? 'كلمة المرور' : 'Password')} aria-label={recoveryMode
                  ? (isRtl ? 'كلمة المرور الجديدة' : 'New password')
                  : (isRtl ? 'كلمة المرور' : 'Password')}
                className="w-full ps-11 pe-12 py-3 bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-2xl text-sm transition text-gray-800 placeholder-gray-400 outline-none"
                disabled={loading}
                minLength={6}
                required={!forgotMode}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 end-3 flex items-center text-gray-400 hover:text-gray-600 cursor-pointer"
                title={showPassword ? (isRtl ? 'إخفاء' : 'Hide') : (isRtl ? 'إظهار' : 'Show')} aria-label={showPassword ? (isRtl ? 'إخفاء' : 'Hide') : (isRtl ? 'إظهار' : 'Show')}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          )}

          {recoveryMode && (
            <div className="relative">
              <span className="absolute inset-y-0 start-4 flex items-center text-gray-400">
                <Lock size={16} />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={isRtl ? 'تأكيد كلمة المرور' : 'Confirm password'} aria-label={isRtl ? 'تأكيد كلمة المرور' : 'Confirm password'}
                className="w-full ps-11 pe-4 py-3 bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-2xl text-sm transition text-gray-800 placeholder-gray-400 outline-none"
                disabled={loading}
                minLength={6}
                required
              />
            </div>
          )}

          {!isSignUp && !forgotMode && !recoveryMode && (
            <div className="text-end">
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setForgotMode(true);
                  setAuthError(null);
                  setSuccessKey(null);
                }}
                className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                {isRtl ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-2xl text-sm font-bold shadow-xs flex items-center justify-center gap-2 transition cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 size={16} className="animate-spin text-white" />}
            <span>
              {recoveryMode
                ? (isRtl ? 'حفظ كلمة المرور' : 'Save new password')
                : forgotMode
                  ? (isRtl ? 'إرسال رابط إعادة التعيين' : 'Send reset link')
                  : isSignUp
                    ? (isRtl ? 'إنشاء حساب' : 'Create account')
                    : (isRtl ? 'تسجيل الدخول' : 'Sign in')}
            </span>
          </button>
        </form>

        {/* Toggle between SignIn and SignUp */}
        <div className="mt-4 text-xs font-semibold text-gray-500">
          <span>
            {forgotMode || recoveryMode
              ? (isRtl ? 'تذكّرت كلمة المرور؟' : 'Remembered your password?')
              : isSignUp
                ? (isRtl ? 'لديك حساب بالفعل؟' : 'Already have an account?')
                : (isRtl ? 'ليس لديك حساب؟' : "Don't have an account?")}
            {' '}
          </span>
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              if (forgotMode || recoveryMode) {
                if (recoveryMode) {
                  // The reset link signed this device in; leaving without a new password ends that session.
                  setPasswordRecovery(false);
                  void supabase.auth.signOut({ scope: 'local' });
                }
                setForgotMode(false);
                setRecoveryMode(false);
                setIsSignUp(false);
              } else {
                setIsSignUp(!isSignUp);
              }
              setAuthError(null);
              setSuccessKey(null);
            }}
            className="text-indigo-600 hover:text-indigo-700 hover:underline transition font-bold focus:outline-none cursor-pointer"
          >
            {forgotMode || recoveryMode
              ? (isRtl ? 'العودة لتسجيل الدخول' : 'Back to sign in')
              : isSignUp
                ? (isRtl ? 'سجّل دخولك' : 'Sign in')
                : (isRtl ? 'أنشئ حساباً' : 'Create an account')}
          </button>
        </div>

        {/* Guest preview is for local development only — production requires a real Google/account session. */}
        {!forgotMode && !recoveryMode && process.env.NODE_ENV !== 'production' && (
        <div className="mt-4 w-full flex flex-col items-center gap-1">
          <div className="w-full h-[1px] bg-gray-100 my-1" />
          <button
            type="button"
            onClick={handleContinueAsGuest}
            className="w-full py-3 border border-dashed border-gray-300 hover:border-indigo-400 bg-white hover:bg-indigo-50/10 text-indigo-600 hover:text-indigo-700 rounded-2xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-[0.98]"
          >
            <span>{isRtl ? 'تجربة سريعة بدون حساب' : 'Try without an account'}</span>
          </button>
        </div>
        )}

        <p className="mt-5 text-[11px] text-gray-400 font-medium leading-relaxed">
          {isRtl
            ? 'الحساب الجديد يحصل على 25 يوماً تجربة مجانية. تفاصيل الاشتراك من الإعدادات بعد الدخول.'
            : 'New accounts include a 25-day free trial. Subscription details are in Settings after you sign in.'}
        </p>


        {/* Minimalist Footnotes */}
        <div className="mt-8 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-medium text-gray-400 select-none">
          <button 
            onClick={() => { sounds.playClick(); setShowPrivacyModal(true); }}
            className="hover:text-gray-600 transition cursor-pointer"
          >
            {isRtl ? 'سياسة الخصوصية' : 'Privacy Policy'}
          </button>
          <span className="text-gray-200">•</span>
          <button 
            onClick={() => { sounds.playClick(); setShowTermsModal(true); }}
            className="hover:text-gray-600 transition cursor-pointer"
          >
            {isRtl ? 'الشروط والأحكام' : 'Terms of Service'}
          </button>
          <span className="text-gray-200">•</span>
          <button 
            onClick={() => { sounds.playClick(); setShowDisclaimerModal(true); }}
            className="hover:text-gray-600 transition cursor-pointer"
          >
            {isRtl ? 'إخلاء المسؤولية' : 'Disclaimer'}
          </button>
        </div>
      </motion.div>

      {/* PRIVACY POLICY MODAL */}
      <AnimatePresence>
        {showPrivacyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir={isRtl ? 'rtl' : 'ltr'}>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPrivacyModal(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-xs"
            />
            {/* Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", duration: 0.3 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden flex flex-col max-h-[85vh]"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                    <ShieldCheck size={18} />
                  </div>
                  <h3 className="text-base font-bold text-gray-900">
                    {isRtl ? "سياسة الخصوصية لتطبيق مستودعي" : "Privacy Policy for Mostawdaee"}
                  </h3>
                </div>
                <button
                  onClick={() => { sounds.playClick(); setShowPrivacyModal(false); }}
                  className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-xl transition cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto">
                <PrivacyPolicyBody ar={isRtl} />
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => { sounds.playClick(); setShowPrivacyModal(false); }}
                  className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {isRtl ? "إغلاق" : "Close"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* TERMS OF SERVICE MODAL */}
      <AnimatePresence>
        {showTermsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir={isRtl ? 'rtl' : 'ltr'}>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTermsModal(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-xs"
            />
            {/* Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", duration: 0.3 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden flex flex-col max-h-[85vh]"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <FileText size={18} />
                  </div>
                  <h3 className="text-base font-bold text-gray-900">
                    {isRtl ? "شروط الخدمة لتطبيق مستودعي" : "Terms of Service for Mostawdaee"}
                  </h3>
                </div>
                <button
                  onClick={() => { sounds.playClick(); setShowTermsModal(false); }}
                  className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-xl transition cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={18} />
                </button>
              </div>

              {/* Content Body */}
              <div className="p-6 overflow-y-auto space-y-6 text-sm text-gray-600 leading-relaxed max-h-[60vh]">
                <p className="text-xs text-gray-400 font-medium">
                  {isRtl ? "تاريخ آخر تحديث: ٨ يونيو ٢٠٢٦" : "Last updated: June 8, 2026"}
                </p>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-gray-900 font-bold text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    <h4>
                      {isRtl ? "١. قبول الشروط" : "1. Acceptance of Terms"}
                    </h4>
                  </div>
                  <p className="ps-3.5 text-gray-600">
                    {isRtl 
                      ? "باستخدامك لتطبيق مستودعي، فإنك توافق على الالتزام بشروط الخدمة هذه وجميع القوانين واللوائح المعمول بها."
                      : "By using the Mostawdaee application, you agree to comply with and be bound by these Terms of Service and all applicable laws and regulations."}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-gray-900 font-bold text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    <h4>
                      {isRtl ? "٢. ترخيص الاستخدام" : "2. Use License"}
                    </h4>
                  </div>
                  <p className="ps-3.5 text-gray-600">
                    {isRtl 
                      ? "يتم منحك ترخيصًا شخصيًا وغير حصري وغير قابل للتحويل لاستخدام التطبيق لإدارة أعمالك التجارية ومخازنك بما يتوافق مع القوانين السارية."
                      : "You are granted a personal, non-exclusive, non-transferable license to use the app for managing your business inventory and warehousing operations in compliance with applicable laws."}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-gray-900 font-bold text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    <h4>
                      {isRtl ? "٣. مسؤولية الحساب" : "3. Account Responsibility"}
                    </h4>
                  </div>
                  <p className="ps-3.5 text-gray-600">
                    {isRtl 
                      ? "أنت مسؤول مسؤولية كاملة عن الحفاظ على سرية معلومات حسابك وأي أنشطة تحدث بموجب حسابك الشخصي."
                      : "You are fully responsible for maintaining the confidentiality of your account information and for any activities that occur under your personal account."}
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => { sounds.playClick(); setShowTermsModal(false); }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {isRtl ? "موافق" : "Accept"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DISCLAIMER OF LIABILITY MODAL */}
      <AnimatePresence>
        {showDisclaimerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir={isRtl ? 'rtl' : 'ltr'}>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDisclaimerModal(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-xs"
            />
            {/* Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", duration: 0.3 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden flex flex-col max-h-[85vh]"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                    <AlertTriangle size={18} />
                  </div>
                  <h3 className="text-base font-bold text-gray-900">
                    {isRtl ? "إخلاء المسؤولية لتطبيق مستودعي" : "Disclaimer of Liability for Mostawdaee"}
                  </h3>
                </div>
                <button
                  onClick={() => { sounds.playClick(); setShowDisclaimerModal(false); }}
                  className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-xl transition cursor-pointer"
                 aria-label={isRtl ? 'إغلاق' : 'Close'}>
                  <X size={18} />
                </button>
              </div>

              {/* Content Body */}
              <div className="p-6 overflow-y-auto space-y-6 text-sm text-gray-600 leading-relaxed max-h-[60vh]">
                <p className="text-xs text-gray-400 font-medium font-mono">
                  {isRtl ? "تاريخ آخر تحديث: ٨ يونيو ٢٠٢٦" : "Last updated: June 8, 2026"}
                </p>

                {/* Section 1 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-gray-900 font-bold text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <h4>
                      {isRtl ? "أخطاء المستخدم وقلة المعرفة" : "User Errors and Lack of Knowledge"}
                    </h4>
                  </div>
                  <p className="ps-3.5 text-gray-600 text-justify text-xs sm:text-sm">
                    {isRtl 
                      ? 'إن تطبيق "مستودعي" هو أداة تقنية مصممة لتسهيل إدارة المستودعات والعمليات المحاسبية. يتحمل المستخدم المسؤولية الكاملة والمطلقة عن صحة ودقة البيانات والمعلومات التي يتم إدخالها، وعن أي أخطاء أو أضرار تنتج عن الاستخدام غير الصحيح للتطبيق أو ناجمة عن عدم المعرفة والدراية الكافية بكيفية تشغيل النظام وإدارته. لا تتحمل إدارة التطبيق أو المطور أي مسؤولية قانونية أو مالية تجاه أي خسائر مالية، أو تلف في البيانات، أو اختلافات محاسبية ناتجة عن هذه القرارات أو الإجراءات.'
                      : '"Mostawdaee" is a technical tool designed to assist with warehouse and accounting management. The user bears full responsibility for the accuracy of the entered data and for any errors resulting from the incorrect use of the application or a lack of knowledge/familiarity with how to operate the system. The application management/developer shall not be held liable for any financial losses, data corruption, or accounting discrepancies resulting from such actions.'}
                  </p>
                </div>

                {/* Section 2 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-gray-900 font-bold text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <h4>
                      {isRtl ? "إساءة استخدام التطبيق" : "Misuse of the Application"}
                    </h4>
                  </div>
                  <p className="ps-3.5 text-gray-600 text-justify text-xs sm:text-sm">
                    {isRtl 
                      ? "يقر المستخدم بموافقته على استخدام التطبيق للأغراض المخصصة والمشروعة والقانونية فقط. وفي حال استخدام التطبيق بشكل مسيء، أو محاولة اختراق النظام وثغراته، أو توظيف التطبيق في أي أعمال غير مشروعة أو احتيالية، فإن المستخدم يتحمل وحده كامل المسؤولية المدنية والجزائية والملاحقة القضائية أمام الجهات والسلطات القضائية المختصة، دون وجود أي مسؤولية تضامنية أو تبعية تقع على المطور أو إدارة التطبيق."
                      : "The user agrees to use the application solely for its intended and lawful purposes. In the event of misuse, attempts to breach the system, or utilization of the app for unlawful or fraudulent activities, the user shall bear full legal and judicial responsibility before the competent authorities, with absolutely no liability attached to the developer or application management."}
                  </p>
                </div>

                {/* Section 3 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-gray-900 font-bold text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <h4>
                      {isRtl ? "مقدم \"كما هو\"" : 'Provided "As Is"'}
                    </h4>
                  </div>
                  <p className="ps-3.5 text-gray-600 text-justify text-xs sm:text-sm">
                    {isRtl 
                      ? 'يتم تقديم التطبيق وجميع ميزاته وخدماته الفنية على أساس "كما هو" و "كما هو متاح" دون أي ضمانات صريحة أو ضمنية من أي نوع. وتحث إدارة التطبيق جميع المستخدمين على اتخاذ التدابير اللازمة والاحتفاظ بنسخ احتياطية دورية ومنتظمة من بياناتهم ومستنداتهم لضمان سلامتها.'
                      : 'The application and its features are provided on an "As Is" and "As Available" basis without any warranties of any kind. Users are highly encouraged to maintain regular backups of their data.'}
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => { sounds.playClick(); setShowDisclaimerModal(false); }}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold float-right transition cursor-pointer"
                >
                  {isRtl ? "فهمت وموافق" : "I Understand & Accept"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* LOGIN PERMISSION TROUBLESHOOTER REMOVED - placeholder kept intentionally */}
    </div>
  );
}
