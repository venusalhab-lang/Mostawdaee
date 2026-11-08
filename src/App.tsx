import React, { useState, useEffect, useRef, Suspense } from 'react';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { motion, AnimatePresence } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useFirebase } from './components/FirebaseProvider';
import Sidebar from './components/Sidebar';
import Login from './components/Auth';
import ErrorBoundary from './components/ErrorBoundary';
import { decideBack, hasUnsavedWork } from './lib/backNavigation';
import { requestInventoryIntent } from './lib/inventoryIntent';
import Header from './components/Header';
import CurrencyTicker from './components/CurrencyTicker';
import { AuthContext } from './components/AuthContext';
import { supabase as rawSupabase } from './supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DRIVE_CONNECTED_EVENT, clearDriveConnect, finishDriveConnect, isDriveConnectPending } from './lib/driveConnect';
import { toast } from 'sonner';
import { usePreferredCurrency, type UserPreferredCurrency } from './components/CurrencyContext';
import { POS_CURRENCY_CODES, type PosCurrency } from './lib/exchangeRates';
import type { AppSettings, Currency } from './types';
import { sounds } from './lib/sounds';
import { LayoutDashboard, Package, Users, Plus, Settings as SettingsIcon } from 'lucide-react';
import QuickActionModal from './components/QuickActionModal';
import CommandPalette from './components/CommandPalette';
import { isVerifiedAdmin } from './lib/adminAccess';
import { NATIVE_OAUTH_REDIRECT } from './lib/nativeAuth';
import { usePasswordRecovery } from './lib/passwordRecovery';
import { claimOAuthCallback, oauthProviderError, readOAuthCallbackParams, urlLooksLikeOAuthCallback } from './lib/completeOAuthSession';
import { Browser } from '@capacitor/browser';
import { useSubscriptionSync } from './hooks/useSubscriptionSync';
import { usePlayBillingSync } from './hooks/usePlayBillingSync';
import SubscriptionExpired from './components/SubscriptionExpired';
import { MembershipSettings, PendingInvites } from './components/TeamSettings';
import { homeScreen } from './lib/roles';
import { leaveStore, teamErrorMessage } from './lib/workspace';
import { deviceLocalWorkMessage, switchStore } from './lib/storeSwitch';
import { needsOnboarding } from './lib/onboarding';
import { isCustomerDisplayHash } from './lib/customerDisplay';

// Ensure TypeScript recognizes runtime `supabase` shape for `.auth` usage.
const supabase: SupabaseClient<any, 'public', any> = (rawSupabase as unknown) as SupabaseClient<any, 'public', any>;

const OnboardingWizard = lazyWithRetry(() => import('./components/OnboardingWizard'));
const HomeDesk = lazyWithRetry(() => import('./components/HomeDesk'));
const CustomerDisplay = lazyWithRetry(() => import('./components/CustomerDisplay'));
const POSSystem = lazyWithRetry(() => import('./components/POSSystem'));
const InventoryManagement = lazyWithRetry(() => import('./components/InventoryManagement'));
const InventoryAudit = lazyWithRetry(() => import('./components/InventoryAudit'));
const WarehouseManagement = lazyWithRetry(() => import('./components/WarehouseManagement'));
const InvoiceSystem = lazyWithRetry(() => import('./components/InvoiceSystem'));
const CustomerManagement = lazyWithRetry(() => import('./components/CustomerManagement'));
const ChequesManagement = lazyWithRetry(() => import('./components/ChequesManagement'));
const EmployeeManagement = lazyWithRetry(() => import('./components/EmployeeManagement'));
const VaultManagement = lazyWithRetry(() => import('./components/VaultManagement'));
const PurchasesExpenses = lazyWithRetry(() => import('./components/PurchasesExpenses'));
const GoogleDriveBackup = lazyWithRetry(() => import('./components/GoogleDriveBackup'));
const BackupManager = lazyWithRetry(() => import('./components/BackupManager'));
const AdminDashboard = lazyWithRetry(() => import('./components/AdminDashboard'));
const Settings = lazyWithRetry(() => import('./components/Settings'));
const AIAssistant = lazyWithRetry(() => import('./components/AIAssistant'));
const LandedCostCalculator = lazyWithRetry(() => import('./components/LandedCostCalculator'));
const ProfitsDashboard = lazyWithRetry(() => import('./components/ProfitsDashboard'));
const AccountingDashboard = lazyWithRetry(() => import('./components/AccountingDashboard'));

export default function App() {
  const { 
    user, 
    loading: dbLoading, 
    settings, 
    products,
    warehouses,
    invoices,
    saveSettings, 
    saveProduct,
    saveWarehouse,
    deleteProduct,
    saveInvoice,
    saveCustomer,
    logout: firebaseLogout,
    workspace,
    isStoreOwner,
    canOpenScreen,
    platformRole,
    platformRoleReady,
  } = useFirebase();
  const recoveringPassword = usePasswordRecovery();

  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const isRtl = language === 'ar';
  const [isGuestModeActive, setIsGuestModeActive] = useState(false);
  const [backupTab, setBackupTab] = useState<'local' | 'cloud'>('local');

  const [activeScreen, setActiveScreen] = useState('dashboard');
  const [lastNonAiScreen, setLastNonAiScreen] = useState('dashboard');
  const [isQuickActionModalOpen, setIsQuickActionModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Global change-screen event listener to coordinate seamless transitions between screens
  useEffect(() => {
    const handleScreenChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        setActiveScreen(customEvent.detail);
      }
    };
    window.addEventListener('change-screen', handleScreenChange);
    return () => {
      window.removeEventListener('change-screen', handleScreenChange);
    };
  }, []);

  // On the web, connecting Drive reloads the app; bring the merchant back to the cloud backup tab.
  useEffect(() => {
    const showDriveBackups = () => {
      setBackupTab('cloud');
      setActiveScreen('google-drive');
    };
    window.addEventListener(DRIVE_CONNECTED_EVENT, showDriveBackups);
    return () => window.removeEventListener(DRIVE_CONNECTED_EVENT, showDriveBackups);
  }, []);

  // Complete the Supabase session when the native app receives the OAuth deep link.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let isActive = true;
    let listener: { remove: () => Promise<void> } | null = null;

    const finishNativeOAuth = async (url: string) => {
      const providerError = oauthProviderError(url);
      const isAuthLink = urlLooksLikeOAuthCallback(url) || url.includes('google-auth');
      if (!isActive || (!isAuthLink && !providerError)) return;
      if (!claimOAuthCallback(url)) return;

      try { await Browser.close(); } catch { /* browser already closed */ }

      if (providerError) {
        console.error('[Auth] OAuth provider returned an error:', providerError);
        const forDrive = isDriveConnectPending();
        clearDriveConnect();
        toast.error(forDrive
          ? (isRtl ? `لم يتم ربط Google Drive: ${providerError}` : `Google Drive was not connected: ${providerError}`)
          : (isRtl ? `تعذر تسجيل الدخول بواسطة Google: ${providerError}` : `Google sign-in failed: ${providerError}`));
        return;
      }

      try {
        const { code } = readOAuthCallbackParams(url);

        if (code) {
          const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            const { data } = await supabase.auth.getSession();
            if (data.session?.access_token) return;
            throw error;
          }
          await finishDriveConnect(exchanged.session, true);
          return;
        }

        throw new Error('No PKCE code found in deep link URL.');
      } catch (error) {
        console.error('[Auth] Native OAuth deep-link handling failed:', error);
        toast.error(isRtl ? 'تعذر إكمال تسجيل الدخول: رابط غير صالح أو منتهي الصلاحية' : 'Could not complete sign-in: invalid or expired link');
      }
    };

    const subscribeToDeepLink = async () => {
      listener = await CapApp.addListener('appUrlOpen', async ({ url }) => {
        await finishNativeOAuth(url);
      });

      // Cold start: the first deep link arrives as the launch URL, not as appUrlOpen.
      try {
        const launch = await CapApp.getLaunchUrl();
        if (launch?.url) await finishNativeOAuth(launch.url);
      } catch { /* unsupported on this platform */ }
    };

    void subscribeToDeepLink();

    return () => {
      isActive = false;
      void listener?.remove();
    };
  }, [isRtl]);

  useEffect(() => {
    if (activeScreen && activeScreen !== 'ai-assistant') {
      setLastNonAiScreen(activeScreen);
    }
  }, [activeScreen]);

  // Every way of changing screens (menu, search, shortcuts, back button) lands here.
  const storeRole = workspace?.role ?? 'owner';
  useEffect(() => {
    if (!canOpenScreen(activeScreen)) setActiveScreen(homeScreen(storeRole));
  }, [activeScreen, storeRole]); // eslint-disable-line react-hooks/exhaustive-deps

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Screen history for the Android back button.
  const screenHistoryRef = useRef<string[]>([]);
  const navigatingBackRef = useRef(false);
  const exitArmedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (navigatingBackRef.current) {
      navigatingBackRef.current = false;
      return;
    }
    const history = screenHistoryRef.current;
    if (history[history.length - 1] !== activeScreen) history.push(activeScreen);
    if (history.length > 30) history.shift();
  }, [activeScreen]);

  const home = homeScreen(storeRole);
  const backStateRef = useRef({ isCommandPaletteOpen, isSidebarOpen, isQuickActionModalOpen, activeScreen, isRtl, home });
  backStateRef.current = { isCommandPaletteOpen, isSidebarOpen, isQuickActionModalOpen, activeScreen, isRtl, home };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const visibleOverlay = () => [...document.querySelectorAll<HTMLElement>('.fixed.inset-0')]
      .find((el) => el.getClientRects().length > 0 && getComputedStyle(el).pointerEvents !== 'none');

    const handle = CapApp.addListener('backButton', () => {
      const st = backStateRef.current;
      if (st.isCommandPaletteOpen) return setIsCommandPaletteOpen(false);
      if (st.isQuickActionModalOpen) return setIsQuickActionModalOpen(false);
      if (st.isSidebarOpen) return setIsSidebarOpen(false);

      const history = screenHistoryRef.current;
      const action = decideBack({
        overlayOpen: !!visibleOverlay(),
        unsavedWork: hasUnsavedWork(),
        screen: st.activeScreen,
        homeScreen: st.home,
        previousScreen: history.length > 1 ? history[history.length - 2] : null,
        exitArmedAt: exitArmedAtRef.current,
        now: Date.now(),
      });

      switch (action) {
        case 'close-overlay': {
          // Same as tapping outside the window; if it stays open it needs an explicit choice.
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const overlay = visibleOverlay();
          overlay?.click();
          setTimeout(() => {
            if (visibleOverlay()) {
              toast.info(st.isRtl ? 'أغلق النافذة المفتوحة أولاً' : 'Close the open window first', { id: 'back-overlay' });
            }
          }, 150);
          return;
        }
        case 'blocked-unsaved':
          toast.warning(st.isRtl
            ? 'لديك عمل غير محفوظ (مثل سلة بيع). أكمله أو أفرغه قبل مغادرة الشاشة.'
            : 'You have unsaved work (such as a sale cart). Finish or clear it before leaving.', { id: 'back-unsaved' });
          return;
        case 'previous-screen':
          history.pop();
          navigatingBackRef.current = true;
          setActiveScreen(history[history.length - 1]);
          return;
        case 'home':
          setActiveScreen(st.home);
          return;
        case 'arm-exit':
          exitArmedAtRef.current = Date.now();
          toast.info(st.isRtl ? 'اضغط رجوع مرة أخرى للخروج' : 'Press back again to exit', { id: 'back-exit', duration: 2000 });
          return;
        case 'exit':
          void CapApp.exitApp();
      }
    });
    return () => { void handle.then((h) => h.remove()); };
  }, []);

  // Global keyboard shortcut for Command Palette (Ctrl/Cmd+K)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const { preferredCurrency, setPreferredCurrency } = usePreferredCurrency();

  const [isClassDarkMode, setIsClassDarkMode] = useState(() => {
    return localStorage.getItem('theme_mode') === 'dark' || document.documentElement.classList.contains('dark');
  });

  const [isMuted, setIsMuted] = useState(sounds.isMuted);

  // The saved store currency is the system currency. Keep the header on it.
  useEffect(() => {
    if (!settings?.currency) return;
    setPreferredCurrency(settings.currency);
  }, [settings?.currency, setPreferredCurrency]);

  const selectSystemCurrency = (code: UserPreferredCurrency) => {
    if (code === 'DEFAULT') {
      if (settings?.currency) setPreferredCurrency(settings.currency);
      return;
    }
    if (!(POS_CURRENCY_CODES as readonly string[]).includes(code)) return;
    const next = code as PosCurrency;
    if (!isStoreOwner) {
      if (settings?.currency && next !== settings.currency) {
        toast.info(isRtl ? 'عملة النظام يحددها مالك المتجر.' : 'The store owner sets the system currency.', { id: 'member-currency' });
      }
      return;
    }
    if (settings?.currency === next) {
      setPreferredCurrency(next);
      return;
    }
    const previous = settings?.currency;
    setPreferredCurrency(next);
    const base: AppSettings = settings ?? {
      userName: '',
      businessName: '',
      defaultVatRate: 16,
      defaultCustomsDuty: 5,
      defaultLanguage: language,
      enableAnimations: true,
      aiVerbosity: 'detailed',
      theme: 'modern',
      darkMode: false,
      currency: next,
    };
    saveSettings({ ...base, currency: next as Currency }).then(
      () => toast.success(isRtl ? `عملة النظام الآن ${next}` : `System currency is now ${next}`, { id: 'system-currency' }),
      () => {
        if (previous) setPreferredCurrency(previous);
        toast.error(isRtl ? 'تعذّر حفظ عملة النظام؛ بقيت كما كانت. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not save the system currency; it was not changed. Check your connection and try again.', { id: 'system-currency' });
      },
    );
  };

  // Sync dark mode class (UI class always applies; storage write must not crash the shell)
  useEffect(() => {
    if (isClassDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme_mode', isClassDarkMode ? 'dark' : 'light');
    } catch {
      // Quota / private mode — theme still works for this session.
    }
  }, [isClassDarkMode]);

  const handleToggleMute = () => {
    const nextMute = sounds.toggleMute();
    setIsMuted(nextMute);
    toast.success(nextMute ? (isRtl ? 'تم كتم الصوت' : 'Sound muted') : (isRtl ? 'تم تفعيل الصوت' : 'Sound activated'));
  };

  const handleToggleDarkMode = () => {
    sounds.playClick();
    setIsClassDarkMode(!isClassDarkMode);
    toast.success(!isClassDarkMode ? (isRtl ? 'تم تفعيل الوضع الداكن' : 'Dark mode activated') : (isRtl ? 'تم تفعيل الوضع الفاتح' : 'Light mode activated'));
  };

  // Sync language with default settings on mount
  useEffect(() => {
    if (settings?.defaultLanguage) {
      setLanguage(settings.defaultLanguage as 'ar' | 'en');
    }
  }, [settings?.defaultLanguage]);

  // Must run on the login screen too (the same assignment used to sit after the auth early-return).
  useEffect(() => {
    const rtl = language === 'ar';
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    document.documentElement.classList.toggle('font-arabic', rtl);
    document.documentElement.classList.toggle('font-sans', !rtl);
    document.title = rtl
      ? 'مستودعي — إدارة المنتجات والمحاسبة'
      : 'Mostawdaee — Inventory and accounting';
  }, [language]);

  // Sync Sidebar active class with state reactivity (aligns with .app-sidebar.active and user custom CSS styling)
  useEffect(() => {
    const sidebar = document.getElementById("appSidebar") || document.getElementById("sidebar");
    const mainContent = document.querySelector(".main-content") || document.getElementById("main-content");
    
    if (sidebar) {
      if (isSidebarOpen) {
        sidebar.classList.add("active");
        sidebar.classList.add("sidebar-active");
        sidebar.setAttribute("aria-hidden", "false");
        if (mainContent) {
          mainContent.classList.add("content-shifted");
        }
      } else {
        sidebar.classList.remove("active");
        sidebar.classList.remove("sidebar-active");
        sidebar.setAttribute("aria-hidden", "true");
        if (mainContent) {
          mainContent.classList.remove("content-shifted");
        }
      }
    }
  }, [isSidebarOpen]);

  // Close sidebar on outer document body container clicks when activated on mobile
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const sidebar = document.getElementById("appSidebar") || document.getElementById("sidebar");
      const target = e.target as HTMLElement;
      
      if (!sidebar) return;

      // If clicking inside the sidebar container, keep it open
      if (sidebar.contains(target)) {
        return;
      }

      // If clicking a structural element of the mobile open toggles (floating button, hamburger menu) or their children, ignore and let onClick event resolve it
      if (
        target.closest('#sidebar-btn') || 
        target.closest('#sidebarToggle') || 
        target.closest('.sidebar-toggle-btn') || 
        target.closest('[data-sidebar-toggle]')
      ) {
        return;
      }

      setIsSidebarOpen(false);
    };

    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, []);

  const toggleLanguage = () => {
    const nextLang = language === 'en' ? 'ar' : 'en';
    setLanguage(nextLang);
    if (settings) {
      saveSettings({ ...settings, defaultLanguage: nextLang }).catch(() => {
        setLanguage(language);
        toast.error(nextLang === 'ar' ? 'تعذّر حفظ اللغة. حاول مرة أخرى.' : 'Could not save the language. Try again.');
      });
    }
  };

  const isAdmin = isVerifiedAdmin(user as any);
  const hasRealSession = !!user && !user.isAnonymous;

  useEffect(() => {
    if (hasRealSession && isGuestModeActive) setIsGuestModeActive(false);
  }, [hasRealSession, isGuestModeActive]);

  const {
    loading: subscriptionLoading,
    isExpired,
    lockReason,
    subscription,
    daysRemaining: subscriptionDaysRemaining,
    refreshSubscription,
  } = useSubscriptionSync(user, !hasRealSession);
  usePlayBillingSync(hasRealSession ? user?.uid : null, refreshSubscription);

  // Auth Context actions for Login (Auth.tsx)
  const signInWithGoogle = async () => {
    if (Capacitor.isNativePlatform()) {
      // Google blocks OAuth inside embedded WebViews (403 disallowed_useragent), so the flow
      // must run in the system browser and return via the appUrlOpen deep link.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: NATIVE_OAUTH_REDIRECT,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Google sign-in could not start. Try again.');
      await Browser.open({ url: data.url, presentationStyle: 'fullscreen' });
      return data;
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    return data;
  };

  const signInWithEmail = async (emailVal: string, passwordVal: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailVal,
      password: passwordVal,
    });
    if (error) throw error;
    return data.user;
  };

  const signUpWithEmail = async (emailVal: string, passwordVal: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: emailVal,
      password: passwordVal,
    });
    if (error) throw error;
    // Supabase returns an obfuscated user with no identities (and no error) when the email already exists.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('User already registered');
    }
    return data.user;
  };

  const handleSignOut = async () => {
    try {
      await firebaseLogout();
    } catch (error: any) {
      if (!error?.notified) toast.error(isRtl ? 'تعذّر تسجيل الخروج' : 'Could not sign out');
      return;
    }
    setIsGuestModeActive(false);
    setActiveScreen('dashboard');
  };

  const handleQuickActionClick = (actionId: string) => {
    setIsQuickActionModalOpen(false);
    sounds.playClick();
    if (actionId === 'pos') {
      setActiveScreen('pos');
    } else if (actionId === 'add-product') {
      requestInventoryIntent({ type: 'add' });
      setActiveScreen('inventory');
    } else if (actionId === 'debts') {
      setActiveScreen('customers');
    } else if (actionId === 'reports') {
      setActiveScreen('profits-dashboard');
    }
  };

  const handleCommandAction = (action: string, payload?: any) => {
    // Map command palette actions to app navigation/actions
    setIsCommandPaletteOpen(false);
    sounds.playClick();
    if (action === 'new-sale') {
      setActiveScreen('pos');
    } else if (action === 'new-purchase') {
      setActiveScreen('purchases-expenses');
    } else if (action === 'add-product') {
      requestInventoryIntent({ type: 'add' });
      setActiveScreen('inventory');
    } else if (action === 'employees') {
      setActiveScreen('employees');
    } else if (action === 'settings') {
      setActiveScreen('settings');
    } else if (action === 'view-product' && payload) {
      requestInventoryIntent({ type: 'view', product: payload });
      setActiveScreen('inventory');
    }
  };

  // Expose context value matching AuthContext expectations
  const authContextValue = {
    user,
    session: user ? { user } : null,
    loading: dbLoading,
    isAdmin,
    isGuest: isGuestModeActive || !!user?.isAnonymous,
    loginWithGoogle: signInWithGoogle,
    loginWithEmail: signInWithEmail,
    signUpWithEmail: signUpWithEmail,
    logout: handleSignOut,
    continueAsGuest: () => {
      setIsGuestModeActive(true);
    },
    refreshToken: async () => {},
  };

  const loginScreen = (
    <AuthContext.Provider value={authContextValue}>
      <Login
        language={language}
        onLanguageToggle={toggleLanguage}
        onLoginSuccess={() => setIsGuestModeActive(false)}
        onContinueAsGuest={() => setIsGuestModeActive(true)}
      />
    </AuthContext.Provider>
  );

  // Second-monitor customer display: no chrome, no login gate — cart arrives via BroadcastChannel.
  if (isCustomerDisplayHash()) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#0b1220] flex items-center justify-center text-slate-400 text-sm font-bold">
            …
          </div>
        }
      >
        <CustomerDisplay />
      </Suspense>
    );
  }

  // A reset link signs in; the new password is asked for before anything else opens.
  if (recoveringPassword) return loginScreen;

  // 1. Loading State Splash (members must not glimpse owner screens before their role is known)
  if (dbLoading || (hasRealSession && !workspace)) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white font-sans selection:bg-indigo-500/20">
        <div className="relative w-16 h-16 mb-6">
          <div className="absolute inset-0 rounded-2xl border-4 border-indigo-500/10" />
          <div className="absolute inset-0 rounded-2xl border-4 border-t-indigo-500 animate-spin" />
        </div>
        <p className="text-sm font-bold text-slate-300 tracking-wide animate-pulse">
          {isRtl ? 'جارٍ تحميل مستودعي...' : 'Loading Mostawdaee...'}
        </p>
      </div>
    );
  }

  // 2. Sign-in (or guest trial) before the store opens
  if (!user && !isGuestModeActive) {
    return loginScreen;
  }

  // Platform staff must reach the Mostawdaee console even when their personal store trial/paid window ended.
  // Wait for the role check before locking so ops/support are not flashed the expired screen.
  if (hasRealSession && !subscriptionLoading && isExpired && !isAdmin) {
    if (!platformRoleReady) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white font-sans">
          <div className="relative w-16 h-16 mb-6">
            <div className="absolute inset-0 rounded-2xl border-4 border-indigo-500/10" />
            <div className="absolute inset-0 rounded-2xl border-4 border-t-indigo-500 animate-spin" />
          </div>
          <p className="text-sm font-bold text-slate-300 tracking-wide animate-pulse">
            {isRtl ? 'جارٍ التحقق من صلاحيات الفريق...' : 'Checking team access...'}
          </p>
        </div>
      );
    }
    if (!platformRole) {
    return (
      <AuthContext.Provider value={authContextValue}>
        <SubscriptionExpired
          language={language}
          onLanguageToggle={toggleLanguage}
          reason={lockReason}
          expiryDate={lockReason === 'trial' ? null : subscription?.expiry_date}
          onRefresh={refreshSubscription}
          onLogout={handleSignOut}
          member={workspace && workspace.role !== 'owner' ? {
            storeName: workspace.storeName,
            ownerEmail: workspace.ownerEmail,
            onLeave: async () => {
              if (!user) return;
              const blocked = deviceLocalWorkMessage(user.uid, isRtl);
              if (blocked) {
                toast.error(blocked);
                return;
              }
              try {
                await switchStore(user.uid, leaveStore);
              } catch (error) {
                toast.error(teamErrorMessage(error, isRtl));
              }
            },
          } : null}
        />
      </AuthContext.Provider>
    );
    }
  }

  // First-run setup for a new store owner (empty books, never completed).
  const showOnboarding = needsOnboarding({
    isOwner: isStoreOwner,
    isGuest: !hasRealSession,
    settings,
    warehouses,
    products,
  });
  if (showOnboarding && settings) {
    return (
      <AuthContext.Provider value={authContextValue}>
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
              <p className="text-sm font-bold text-slate-500">
                {isRtl ? 'جارٍ تحضير الإعداد…' : 'Preparing setup…'}
              </p>
            </div>
          }
        >
          <OnboardingWizard
            settings={settings}
            language={language}
            onLanguageChange={(lang) => setLanguage(lang)}
            onCurrencyPrefer={(code) => setPreferredCurrency(code)}
            saveSettings={saveSettings}
            saveWarehouse={saveWarehouse}
            saveProduct={saveProduct}
            onFinished={(goToPos) => {
              setActiveScreen(goToPos ? 'pos' : 'dashboard');
            }}
          />
        </Suspense>
      </AuthContext.Provider>
    );
  }

  const screenSettings: AppSettings = settings ?? {
    userName: '',
    businessName: '',
    defaultVatRate: 16,
    defaultCustomsDuty: 5,
    defaultLanguage: language,
    enableAnimations: true,
    aiVerbosity: 'detailed',
    theme: 'modern',
    darkMode: false,
    currency: ((POS_CURRENCY_CODES as readonly string[]).includes(preferredCurrency) ? preferredCurrency : 'JOD') as Currency,
  };

  // 3. Render screen handler
  const renderScreen = (screenName = activeScreen) => {
    if (!canOpenScreen(screenName)) return null;
    switch (screenName) {
      case 'dashboard':
        return (
          <HomeDesk
            language={language}
            settings={screenSettings}
          />
        );
      case 'pos':
        return <POSSystem language={language} />;
      case 'inventory':
        return (
          <InventoryManagement 
            language={language} 
            products={products} 
            settings={screenSettings} 
            onAddProduct={saveProduct} 
            onUpdateProduct={saveProduct}
            onDeleteProduct={deleteProduct} 
            transactions={invoices as any} 
          />
        );
      case 'inventory-audit':
        return (
          <InventoryAudit
            language={language}
            settings={screenSettings}
          />
        );
      case 'warehouses':
        return <WarehouseManagement language={language} settings={screenSettings} />;
      case 'invoices':
        return <InvoiceSystem language={language} />;
      case 'customers':
        return <CustomerManagement language={language} settings={screenSettings} />;
      case 'cheques':
        return <ChequesManagement language={language} settings={screenSettings} />;
      case 'employees':
        return <EmployeeManagement language={language} settings={screenSettings} />;
      case 'vault':
        return <VaultManagement language={language} settings={screenSettings} />;
      case 'purchases-expenses':
        return <PurchasesExpenses language={language} />;
      case 'google-drive':
        return (
          <div className="space-y-2">
            {/* Unified Backup Hub Switcher Tabs */}
            <div className="max-w-4xl mx-auto px-4 md:px-8 pt-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-white/5 p-1.5 rounded-2xl flex items-center justify-between gap-2 shadow-sm">
                <button
                  onClick={() => {
                    sounds.playClick();
                    setBackupTab('local');
                  }}
                  className={`flex-1 py-3 px-4 text-xs font-black uppercase rounded-xl transition-all duration-300 flex items-center justify-center gap-2 select-none cursor-pointer
                    ${backupTab === 'local'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/10'}`}
                >
                  <span>{language === 'ar' ? 'نسخة على الجهاز' : 'On this device'}</span>
                </button>
                <button
                  onClick={() => {
                    sounds.playClick();
                    setBackupTab('cloud');
                  }}
                  className={`flex-1 py-3 px-4 text-xs font-black uppercase rounded-xl transition-all duration-300 flex items-center justify-center gap-2 select-none cursor-pointer
                    ${backupTab === 'cloud'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/10'}`}
                >
                  <span>{language === 'ar' ? 'Google Drive' : 'Google Drive'}</span>
                </button>
              </div>
            </div>

            {backupTab === 'local' ? (
              <BackupManager language={language} />
            ) : (
              <GoogleDriveBackup language={language} />
            )}
          </div>
        );
      case 'admin-dashboard':
        return <AdminDashboard language={language} />;
      case 'settings':
        if (!isStoreOwner) return <MembershipSettings language={language} onLanguageToggle={toggleLanguage} />;
        return (
          <Settings 
            language={language} 
            onLanguageToggle={toggleLanguage} 
            settings={screenSettings} 
            onSaveSettings={saveSettings} 
          />
        );
      case 'landed-cost':
        return (
          <LandedCostCalculator 
            language={language} 
            settings={screenSettings}
            onAddProduct={saveProduct} 
            defaultVat={settings?.defaultVatRate ?? 16} 
            defaultCustoms={settings?.defaultCustomsDuty ?? 5} 
          />
        );
      case 'profits-dashboard':
        return (
          <ProfitsDashboard 
            language={language}
            currency={(POS_CURRENCY_CODES as readonly string[]).includes(preferredCurrency) ? preferredCurrency : settings?.currency || 'JOD'}
            onClose={() => setActiveScreen('dashboard')}
          />
        );
      case 'accounting':
        return (
          <AccountingDashboard
            language={language}
            currency={(POS_CURRENCY_CODES as readonly string[]).includes(preferredCurrency) ? preferredCurrency : settings?.currency || 'JOD'}
            onClose={() => setActiveScreen('dashboard')}
          />
        );
      case 'ai-assistant':
        return null;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {isRtl ? 'هذه الشاشة غير متاحة بعد' : 'This screen is not available yet'}
            </h2>
          </div>
        );
    }
  };

  const resolvedUserName = settings?.userName || user?.displayName || user?.email?.split('@')[0] || (isGuestModeActive || user?.isAnonymous ? (isRtl ? 'زائر تجريبي' : 'Visitor') : '');
  const resolvedBusinessName = settings?.businessName || (isRtl ? 'مستودعي' : 'Mostawdaee');

  // Unified desktop responsive layout: sidebar is a beautiful sliding overlay so no structural margin offsets are needed, maximizing viewport coverage
  const sidebarOffsetStyle = undefined;

  // 4. Main ERP App Canvas Shell
  return (
    <AuthContext.Provider value={authContextValue}>
      <div className="app-container min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950" dir={isRtl ? 'rtl' : 'ltr'}>
        

        {/* Brand New Modern Integrated Responsive Header Component */}
        <Header 
          isRtl={isRtl}
          language={language}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          isClassDarkMode={isClassDarkMode}
          onToggleDarkMode={handleToggleDarkMode}
          preferredCurrency={preferredCurrency}
          onPreferredCurrencyChange={selectSystemCurrency}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          onChangeScreen={setActiveScreen}
          activeScreen={activeScreen}
          assistantReturnScreen={lastNonAiScreen}
          subscriptionDaysRemaining={hasRealSession ? subscriptionDaysRemaining : null}
        />

        {/* Global Live scrolling news and exchange rates ticker */}
        <CurrencyTicker isRtl={isRtl} />

        {/* Master Flex Body Area containing sidebar on left/right and content stage */}
        <div className={`flex-1 flex flex-col lg:flex-row ${isRtl ? 'lg:flex-row-reverse' : ''}`}>

          {/* Navigation Sidebar Drawer */}
          <Sidebar 
            language={language}
            onLanguageToggle={toggleLanguage}
            activeScreen={activeScreen}
            setActiveScreen={setActiveScreen}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            userName={resolvedUserName}
            businessName={resolvedBusinessName}
            onLogout={handleSignOut}
          />

          {/* Screen Stage Container - Main Content Area */}
          <main 
            className={`main-content flex-1 overflow-y-auto overflow-x-hidden min-w-0 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-8 ${
              activeScreen === 'admin-dashboard'
                ? 'p-2 sm:p-4 lg:p-6'
                : 'p-4 sm:p-6 lg:p-8'
            }`}
            style={sidebarOffsetStyle}
          >


            <PendingInvites language={language} />

            {/* Render Active Screen Content Stage with premium framer-motion transitions */}
            <div className={activeScreen === 'ai-assistant' ? 'hidden' : 'text-gray-900 dark:text-gray-100 pb-8'}>
              <Suspense
                fallback={
                  <div className="min-h-[40vh] flex items-center justify-center">
                    <div className="inline-flex items-center gap-3 rounded-3xl bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-white/10 px-5 py-4 shadow-lg">
                      <div className="w-10 h-10 rounded-full border-4 border-indigo-500 animate-spin" />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{isRtl ? 'جارٍ تحميل الصفحة...' : 'Loading screen...'}</span>
                    </div>
                  </div>
                }
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={lastNonAiScreen}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <ErrorBoundary variant="screen" isRtl={isRtl} resetKey={lastNonAiScreen}>
                      {renderScreen(lastNonAiScreen)}
                    </ErrorBoundary>
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            </div>

            {activeScreen === 'ai-assistant' && canOpenScreen('ai-assistant') && (
              <div className="relative block">
                <ErrorBoundary variant="screen" isRtl={isRtl} resetKey="ai-assistant">
                <Suspense
                  fallback={
                    <div className="max-w-4xl mx-auto h-[calc(100vh-10rem)] flex flex-col items-center justify-center rounded-[2rem] border border-teal-900/40 bg-[#0F2027]">
                      <div className="w-10 h-10 rounded-full border-4 border-cyan-400/70 border-t-transparent animate-spin" />
                      <span className="mt-3 text-sm font-bold text-teal-200/90">
                        {isRtl ? 'جارٍ فتح المساعد…' : 'Opening assistant…'}
                      </span>
                    </div>
                  }
                >
                <AIAssistant 
                  language={language} 
                  products={products} 
                  settings={screenSettings} 
                  verbosity={settings?.aiVerbosity || 'detailed'} 
                  onAddProduct={saveProduct} 
                  onDeleteProduct={deleteProduct} 
                  onAddCustomer={saveCustomer} 
                  onClose={() => setActiveScreen(lastNonAiScreen)}
                />
                </Suspense>
                </ErrorBoundary>
              </div>
            )}
          </main>
        </div>

        {/* Modern iOS/Android/Capacitor-style Bottom Navigation Bar with CircularNotchedRectangle Notch Dock (lg:hidden) */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 h-[calc(5rem+env(safe-area-inset-bottom))] z-40 pointer-events-none select-none font-arabic">
          <div className="absolute inset-x-0 bottom-0 h-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-slate-900/95 pointer-events-auto" />

          {/* Physical Notched Backdrop with continuous smooth line */}
          <div className="absolute inset-x-0 top-0 h-20 flex pointer-events-auto">
            {/* Left Wing */}
            <div className="flex-1 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/50 dark:border-white/10 rounded-tl-[22px] shadow-[0_-8px_30px_rgba(0,0,0,0.03)]" />
            
            {/* The SVG scoop notch */}
            <div className="relative w-28 h-20 bg-transparent shrink-0">
              {/* Notched Fill */}
              <svg viewBox="0 0 112 80" className="absolute top-0 left-0 w-full h-full fill-white/95 dark:fill-slate-900/95 backdrop-blur-xl drop-shadow-[0_-8px_30px_rgba(0,0,0,0.03)]">
                <path d="M0,-0.5 H16 A40,40 0 0,0 96,-0.5 H112 V80 H0 Z" className="transition-colors duration-300" />
              </svg>
              {/* Notched Lip Stroke */}
              <svg viewBox="0 0 112 80" className="absolute top-0 left-0 w-full h-full fill-none stroke-slate-200/50 dark:stroke-white/10 stroke-[1.5]">
                <path d="M0,0 H16 A40,40 0 0,0 96,0 H112" />
              </svg>
            </div>
            
            {/* Right Wing */}
            <div className="flex-1 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/50 dark:border-white/10 rounded-tr-[22px] shadow-[0_-8px_30px_rgba(0,0,0,0.03)]" />
          </div>

          {/* Interactive Nav Content */}
          <div className="absolute inset-x-0 top-0 h-20 flex items-center justify-between px-2 pointer-events-auto">
            
            {/* Left Navigation Actions (Home, Inventory) */}
            <div className="flex-1 flex justify-around items-center">
              
              {/* Item 1: Home (الرئيسية) */}
              {canOpenScreen('dashboard') && <button
                onClick={() => {
                  sounds.playClick();
                  setActiveScreen('dashboard');
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all cursor-pointer ${
                  activeScreen === 'dashboard' 
                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/25' 
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
                }`}
              >
                <LayoutDashboard size={20} className={activeScreen === 'dashboard' ? 'scale-110' : ''} />
                <span className="text-[10px] font-black mt-1">
                  {isRtl ? 'الرئيسية' : 'Home'}
                </span>
              </button>}

              {/* Item 2: Inventory (المخزون) */}
              {canOpenScreen('inventory') && <button
                onClick={() => {
                  sounds.playClick();
                  setActiveScreen('inventory');
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all cursor-pointer ${
                  activeScreen === 'inventory' 
                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/25' 
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
                }`}
              >
                <Package size={20} className={activeScreen === 'inventory' ? 'scale-110' : ''} />
                <span className="text-[10px] font-black mt-1">
                  {isRtl ? 'المخزون' : 'Inventory'}
                </span>
              </button>}

            </div>

            {/* Central Floating Action Button (FAB) nested in CircularNotchedRectangle */}
            <div className="relative w-16 h-20 flex items-start justify-center shrink-0">
              <button
                onClick={() => {
                  sounds.playClick();
                  setIsQuickActionModalOpen(true);
                }}
                className="w-14 h-14 bg-gradient-to-tr from-indigo-600 to-indigo-800 hover:from-indigo-700 hover:to-indigo-900 active:scale-90 text-white rounded-full flex items-center justify-center shadow-xl shadow-indigo-600/35 border-4 border-white dark:border-slate-900 -translate-y-5 transition-all cursor-pointer group"
                title={isRtl ? 'الإجراءات السريعة' : 'Quick Actions'}
              >
                <Plus size={26} className="text-white group-hover:rotate-90 transition-transform duration-300 stroke-[2.5]" />
              </button>
            </div>

            {/* Right Navigation Actions (Customers, Settings) */}
            <div className="flex-1 flex justify-around items-center">

              {/* Item 3: Customers (العملاء) */}
              {canOpenScreen('customers') && <button
                onClick={() => {
                  sounds.playClick();
                  setActiveScreen('customers');
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all cursor-pointer ${
                  activeScreen === 'customers' 
                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/25' 
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
                }`}
              >
                <Users size={20} className={activeScreen === 'customers' ? 'scale-110' : ''} />
                <span className="text-[10px] font-black mt-1">
                  {isRtl ? 'العملاء' : 'Customers'}
                </span>
              </button>}

              {/* Item 4: Settings (الإعدادات) */}
              <button
                onClick={() => {
                  sounds.playClick();
                  setActiveScreen('settings');
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all cursor-pointer ${
                  activeScreen === 'settings' 
                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/25' 
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
                }`}
              >
                <SettingsIcon size={20} className={activeScreen === 'settings' ? 'scale-110' : ''} />
                <span className="text-[10px] font-black mt-1">
                  {isRtl ? 'الإعدادات' : 'Settings'}
                </span>
              </button>

            </div>
          </div>
        </div>

        {/* Global Floating Quick Action Overlay Modal */}
        <QuickActionModal 
          isOpen={isQuickActionModalOpen}
          onClose={() => setIsQuickActionModalOpen(false)}
          language={language}
          onActionClick={handleQuickActionClick}
          canOpenScreen={canOpenScreen}
        />

        {/* Global Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          language={language}
          products={products}
          onAction={handleCommandAction}
          canOpenScreen={canOpenScreen}
        />
      </div>
    </AuthContext.Provider>
  );
}