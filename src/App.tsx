import React, { useState, useEffect, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useFirebase } from './components/FirebaseProvider';
import Sidebar from './components/Sidebar';
import Login from './components/Auth';
import LandingPage from './components/LandingPage';
import Header from './components/Header';
import CurrencyTicker from './components/CurrencyTicker';
import { AuthContext, mockUserObj } from './components/AuthContext';
import { supabase as rawSupabase } from './supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';

// Ensure TypeScript recognizes runtime `supabase` shape for `.auth` usage.
const supabase: SupabaseClient<any, 'public', any> = (rawSupabase as unknown) as SupabaseClient<any, 'public', any>;
import { setDriveAccessToken } from './services/googleDrive';
import { toast } from 'sonner';
import { usePreferredCurrency } from './components/CurrencyContext';
import { sounds } from './lib/sounds';
import { Coins, LayoutDashboard, Package, Users, Sparkles, MessageSquare, Plus, Settings as SettingsIcon } from 'lucide-react';
import QuickActionModal from './components/QuickActionModal';
import CommandPalette from './components/CommandPalette';
import AdminProtectedRoute from './components/AdminProtectedRoute';
import { isAdminEmail } from './lib/adminAccess';
import { NATIVE_OAUTH_REDIRECT } from './lib/nativeAuth';
import { Browser } from '@capacitor/browser';
import { useSubscriptionSync } from './hooks/useSubscriptionSync';
import SubscriptionExpired from './components/SubscriptionExpired';

const Dashboard = lazy(() => import('./components/Dashboard'));
const POSSystem = lazy(() => import('./components/POSSystem'));
const InventoryManagement = lazy(() => import('./components/InventoryManagement'));
const WarehouseManagement = lazy(() => import('./components/WarehouseManagement'));
const InvoiceSystem = lazy(() => import('./components/InvoiceSystem'));
const CustomerManagement = lazy(() => import('./components/CustomerManagement'));
const EmployeeManagement = lazy(() => import('./components/EmployeeManagement'));
const VaultManagement = lazy(() => import('./components/VaultManagement'));
const PurchasesExpenses = lazy(() => import('./components/PurchasesExpenses'));
const GoogleDriveBackup = lazy(() => import('./components/GoogleDriveBackup'));
const BackupManager = lazy(() => import('./components/BackupManager'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const Settings = lazy(() => import('./components/Settings'));
const AIAssistant = lazy(() => import('./components/AIAssistant'));
const LandedCostCalculator = lazy(() => import('./components/LandedCostCalculator'));
const ProfitsDashboard = lazy(() => import('./components/ProfitsDashboard'));

export default function App() {
  const { 
    user, 
    loading: dbLoading, 
    settings, 
    products, 
    invoices,
    saveSettings, 
    saveProduct, 
    deleteProduct,
    saveInvoice,
    saveCustomer,
    vault,
    vaultTransactions,
    logout: firebaseLogout,
  } = useFirebase();

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

  // Complete the Supabase session when the native app receives the OAuth deep link.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let isActive = true;
    let listener: { remove: () => Promise<void> } | null = null;

    const subscribeToDeepLink = async () => {
      listener = await CapApp.addListener('appUrlOpen', async ({ url }) => {
        // Ensure the URL is an authentication/OAuth deep link (contains google-auth, access_token, code or refresh_token)
        const isAuthLink = url.includes('google-auth') || url.includes('access_token') || url.includes('code=') || url.includes('refresh_token');
        const hasOAuthError = /[?#&](error|error_description)=/.test(url);
        if (!isActive || (!isAuthLink && !hasOAuthError)) return;

        // Always dismiss the system browser tab once the app is re-opened by the deep link.
        try { await Browser.close(); } catch (e) { /* not open or unsupported platform */ }

        if (hasOAuthError) {
          const errParams = new URLSearchParams(url.split(/[?#]/).slice(1).join('&'));
          const description = errParams.get('error_description') || errParams.get('error') || '';
          console.error('[Auth] OAuth provider returned an error:', description);
          toast.error(isRtl
            ? `تعذر تسجيل الدخول بواسطة Google${description ? `: ${description}` : ''}`
            : `Google sign-in failed${description ? `: ${description}` : ''}`);
          return;
        }

        try {
          let code: string | null = null;
          let accessToken: string | null = null;
          let refreshToken: string | null = null;

          try {
            // Standard URL parsing (handles standard deep links)
            const parsedUrl = new URL(url);
            code = parsedUrl.searchParams.get('code');
            
            // Extract from hash fragment if present (implicit grant flow or PKCE redirect details)
            const hash = parsedUrl.hash || '';
            const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
            if (!code) {
              code = hashParams.get('code');
            }
            accessToken = hashParams.get('access_token') || parsedUrl.searchParams.get('access_token');
            refreshToken = hashParams.get('refresh_token') || parsedUrl.searchParams.get('refresh_token');
          } catch (e) {
            console.warn('[Auth] standard URL construct parsing failed, trying robust regex/split fallback:', e);
            // Fallback parsing for custom schemes like "com.hamza.mostawdaee://google-auth#access_token=..." where standard URL can fail
            const urlWithoutScheme = url.includes('://') ? url.split('://')[1] : url;
            const parts = urlWithoutScheme.split('#');
            const searchPart = parts[0].split('?')[1] || '';
            const hashPart = parts[1] || '';

            const searchParams = new URLSearchParams(searchPart);
            const hashParams = new URLSearchParams(hashPart);

            code = searchParams.get('code') || hashParams.get('code');
            accessToken = hashParams.get('access_token') || searchParams.get('access_token');
            refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');
          }

          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
            toast.success(isRtl ? 'تم تسجيل الدخول بنجاح!' : 'Logged in successfully!');
            return;
          }

          if (accessToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });
            if (error) throw error;
            toast.success(isRtl ? 'تم تسجيل الدخول بنجاح!' : 'Logged in successfully!');
          } else {
            throw new Error('No code or access_token found in deep link URL.');
          }
        } catch (error) {
          console.error('[Auth] Native OAuth deep-link handling failed:', error);
          toast.error(isRtl ? 'تعذر إكمال تسجيل الدخول: رابط غير صالح أو منتهي الصلاحية' : 'Could not complete sign-in: invalid or expired link');
        }
      });
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

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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

  // Initialize preferred currency to 'USD' (symbol $) if not already configured
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mustawdae_preferred_currency');
      if (!saved) {
        setPreferredCurrency('USD');
      }
    } catch (e) {
      console.warn(e);
    }
  }, [setPreferredCurrency]);

  // Sync dark mode class
  useEffect(() => {
    if (isClassDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme_mode', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme_mode', 'light');
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
    toast.success(!isClassDarkMode ? (isRtl ? 'تم تفعيل الوضع الليلي' : 'Dark mode activated') : (isRtl ? 'تم تفعيل الوضع المضيء' : 'Light mode activated'));
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
        target.closest('[title="Open Sidebar"]') || 
        target.closest('[title="فتح القائمة الجانبية"]')
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
      saveSettings({ ...settings, defaultLanguage: nextLang });
    }
  };

  const isAdmin = isAdminEmail(user?.email);

  const {
    loading: subscriptionLoading,
    isExpired,
    refreshSubscription,
  } = useSubscriptionSync(user, isGuestModeActive || !!user?.isAnonymous);

  // Auth Context actions to support custom Login (Auth.tsx) handlers
  // تسجيل الدخول بواسطة جوجل
const signInWithGoogle = async () => {
  if (Capacitor.isNativePlatform()) {
    // Google blocks OAuth inside embedded WebViews (403 disallowed_useragent), so the flow
    // must run in the system browser (Chrome Custom Tabs / SFSafariViewController) and
    // come back to the app through the deep link handled by the appUrlOpen listener.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: NATIVE_OAUTH_REDIRECT,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error('Google sign-in URL was not returned by Supabase');
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

// تسجيل الدخول بالبريد والكلمة
const signInWithEmail = async (emailVal: string, passwordVal: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailVal,
    password: passwordVal,
  });
  if (error) throw error;
  return data.user;
};

// إنشاء حساب جديد بالبريد
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

// تسجيل الخروج
const handleSignOut = async () => {
  await firebaseLogout();
    setIsGuestModeActive(false);
  setActiveScreen('dashboard');
};

  const handleQuickActionClick = (actionId: string) => {
    setIsQuickActionModalOpen(false);
    sounds.playClick();
    if (actionId === 'pos') {
      setActiveScreen('pos');
    } else if (actionId === 'add-product') {
      setActiveScreen('inventory');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('open-add-product'));
      }, 150);
    } else if (actionId === 'debts') {
      setActiveScreen('customers');
    } else if (actionId === 'reports') {
      setActiveScreen('dashboard');
      setTimeout(() => {
        document.getElementById('bento-analysis-tab')?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
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
      setActiveScreen('inventory');
      setTimeout(() => window.dispatchEvent(new CustomEvent('open-add-product')), 150);
    } else if (action === 'employees') {
      setActiveScreen('employees');
    } else if (action === 'settings') {
      setActiveScreen('settings');
    } else if (action === 'view-product' && payload) {
      setActiveScreen('inventory');
      // If Inventory listens for a view-product event, dispatch it
      setTimeout(() => window.dispatchEvent(new CustomEvent('view-product', { detail: payload })), 180);
    }
  };

  const handleContinueAsGuestEnter = async () => {
    // Supabase does not have a direct anonymous auth equivalent here — use local guest simulation
    setIsGuestModeActive(true);
    toast.success(isRtl ? 'تم تفعيل وضع المعاينة الفورية!' : 'Starting live sandbox guest preview...');
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

  // 1. Loading State Splash
  if (dbLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white font-sans selection:bg-indigo-500/20">
        <div className="relative w-16 h-16 mb-6">
          <div className="absolute inset-0 rounded-2xl border-4 border-indigo-500/10" />
          <div className="absolute inset-0 rounded-2xl border-4 border-t-indigo-500 animate-spin" />
        </div>
        <p className="text-sm font-bold text-slate-300 tracking-wide animate-pulse">
          {isRtl ? 'جاري تحميل مستودعي الفائق...' : 'Loading secure database contents...'}
        </p>
      </div>
    );
  }

  // 2. Authentication routing rules
  if (!user && !isGuestModeActive) {
    return (
      <AuthContext.Provider value={authContextValue}>
        <Login
          language={language}
          onLanguageToggle={toggleLanguage}
          onLoginSuccess={() => setIsGuestModeActive(false)}
          onContinueAsGuest={() => setIsGuestModeActive(true)}
        />
      </AuthContext.Provider>
    );
  }

  if (user && !isAdmin && !isGuestModeActive && !subscriptionLoading && isExpired) {
    return (
      <AuthContext.Provider value={authContextValue}>
        <SubscriptionExpired
          language={language}
          onLanguageToggle={toggleLanguage}
          onRefresh={refreshSubscription}
          onLogout={handleSignOut}
        />
      </AuthContext.Provider>
    );
  }

  // 3. Render screen handler
  const renderScreen = (screenName = activeScreen) => {
    switch (screenName) {
      case 'dashboard':
        return (
          <Dashboard 
            language={language} 
            products={products} 
            settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }} 
            vault={vault} 
            vaultTransactions={vaultTransactions} 
          />
        );
      case 'pos':
        return <POSSystem language={language} />;
      case 'inventory':
        return (
          <InventoryManagement 
            language={language} 
            products={products} 
            settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }} 
            onAddProduct={saveProduct} 
            onUpdateProduct={saveProduct}
            onDeleteProduct={deleteProduct} 
            transactions={invoices as any} 
          />
        );
      case 'warehouses':
        return <WarehouseManagement language={language} settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }} />;
      case 'invoices':
        return <InvoiceSystem language={language} />;
      case 'customers':
        return <CustomerManagement language={language} settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }} />;
      case 'employees':
        return <EmployeeManagement language={language} settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }} />;
      case 'vault':
        return <VaultManagement language={language} settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }} />;
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
                      ? 'bg-indigo-650 text-white shadow-md'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/10'}`}
                >
                  <span className="text-sm">🗄️</span>
                  <span>{language === 'ar' ? 'النسخ المحلي والأمان (JSON)' : 'Local JSON Backup'}</span>
                </button>
                <button
                  onClick={() => {
                    sounds.playClick();
                    setBackupTab('cloud');
                  }}
                  className={`flex-1 py-3 px-4 text-xs font-black uppercase rounded-xl transition-all duration-300 flex items-center justify-center gap-2 select-none cursor-pointer
                    ${backupTab === 'cloud'
                      ? 'bg-indigo-650 text-white shadow-md'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/10'}`}
                >
                  <span className="text-sm">☁️</span>
                  <span>{language === 'ar' ? 'المزامنة السحابية (Google Drive)' : 'Google Drive Sync'}</span>
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
        return (
          <AdminProtectedRoute>
            <AdminDashboard language={language} />
          </AdminProtectedRoute>
        );
      case 'settings':
        return (
          <Settings 
            language={language} 
            onLanguageToggle={toggleLanguage} 
            settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }} 
            onSaveSettings={saveSettings} 
          />
        );
      case 'landed-cost':
        return (
          <LandedCostCalculator 
            language={language} 
            settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }}
            onAddProduct={saveProduct} 
            defaultVat={settings?.defaultVatRate ?? 16} 
            defaultCustoms={settings?.defaultCustomsDuty ?? 5} 
          />
        );
      case 'profits-dashboard':
        return (
          <ProfitsDashboard 
            language={language}
            currency={settings?.currency || 'JOD'}
            onClose={() => setActiveScreen('dashboard')}
          />
        );
      case 'ai-assistant':
        return null;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
            <span className="text-4xl">🏗️</span>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 mt-4">
              {isRtl ? 'تحت الإنشاء' : 'Under Construction'}
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
        
        {/* Toggle Button for Mobile Only */}
        {activeScreen !== 'ai-assistant' && (
          <button 
            id="sidebar-btn" 
            className="sidebar-toggle-btn lg:hidden fixed bottom-6 left-6 z-55 bg-indigo-650 hover:bg-indigo-700 text-white w-14 h-14 rounded-full shadow-2xl flex items-center justify-center font-black active:scale-95 transition-all text-xl cursor-pointer border border-indigo-505/20"
            onClick={(e) => {
              e.stopPropagation();
              setIsSidebarOpen(prev => !prev);
            }}
            title={isRtl ? "تبديل القائمة الجانبية" : "Toggle Sidebar"}
          >
            ☰
          </button>
        )}

        {/* Brand New Modern Integrated Responsive Header Component */}
        <Header 
          isRtl={isRtl}
          language={language}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          isClassDarkMode={isClassDarkMode}
          onToggleDarkMode={handleToggleDarkMode}
          preferredCurrency={preferredCurrency}
          onPreferredCurrencyChange={setPreferredCurrency}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          onChangeScreen={setActiveScreen}
          activeScreen={activeScreen}
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
            className="main-content flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pb-28 lg:pb-8"
            style={sidebarOffsetStyle}
          >


            {/* Render Active Screen Content Stage with premium framer-motion transitions */}
            <div className={activeScreen === 'ai-assistant' ? 'hidden' : 'text-gray-900 dark:text-gray-100 pb-8'}>
              <Suspense
                fallback={
                  <div className="min-h-[40vh] flex items-center justify-center">
                    <div className="inline-flex items-center gap-3 rounded-3xl bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-white/10 px-5 py-4 shadow-lg">
                      <div className="w-10 h-10 rounded-full border-4 border-indigo-500 animate-spin" />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{isRtl ? 'جاري تحميل الصفحة...' : 'Loading screen...'}</span>
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
                    {renderScreen(lastNonAiScreen)}
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            </div>

            {activeScreen === 'ai-assistant' && (
              <div className="relative block">
                <AIAssistant 
                  language={language} 
                  products={products} 
                  settings={settings || {
              userName: '',
              businessName: '',
              defaultVatRate: 16,
              defaultCustomsDuty: 5,
              defaultLanguage: language,
              enableAnimations: true,
              aiVerbosity: 'detailed',
              theme: 'modern',
              darkMode: false,
              currency: 'JOD',
            }} 
                  verbosity={settings?.aiVerbosity || 'detailed'} 
                  onAddProduct={saveProduct} 
                  onDeleteProduct={deleteProduct} 
                  onAddInvoice={saveInvoice} 
                  onAddCustomer={saveCustomer} 
                  onClose={() => setActiveScreen(lastNonAiScreen)}
                />
              </div>
            )}
          </main>
        </div>

        {/* Modern iOS/Android/Capacitor-style Bottom Navigation Bar with CircularNotchedRectangle Notch Dock (lg:hidden) */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 h-20 z-50 pointer-events-none select-none font-arabic">
          
          {/* Physical Notched Backdrop with continuous smooth line */}
          <div className="absolute inset-0 flex pointer-events-auto">
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
          <div className="absolute inset-0 flex items-center justify-between px-2 pb-safe-bottom pointer-events-auto">
            
            {/* Left Navigation Actions (Home, Inventory) */}
            <div className="flex-1 flex justify-around items-center">
              
              {/* Item 1: Home (الرئيسية) */}
              <button
                onClick={() => {
                  sounds.playClick();
                  setActiveScreen('dashboard');
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all cursor-pointer ${
                  activeScreen === 'dashboard' 
                    ? 'text-indigo-650 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/25' 
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
                }`}
              >
                <LayoutDashboard size={20} className={activeScreen === 'dashboard' ? 'scale-110' : ''} />
                <span className="text-[10px] font-black mt-1">
                  {isRtl ? 'الرئيسية' : 'Home'}
                </span>
              </button>

              {/* Item 2: Inventory (المخزون) */}
              <button
                onClick={() => {
                  sounds.playClick();
                  setActiveScreen('inventory');
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all cursor-pointer ${
                  activeScreen === 'inventory' 
                    ? 'text-indigo-650 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/25' 
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
                }`}
              >
                <Package size={20} className={activeScreen === 'inventory' ? 'scale-110' : ''} />
                <span className="text-[10px] font-black mt-1">
                  {isRtl ? 'المخزون' : 'Inventory'}
                </span>
              </button>

            </div>

            {/* Central Floating Action Button (FAB) nested in CircularNotchedRectangle */}
            <div className="relative w-16 h-20 flex items-start justify-center shrink-0">
              <button
                onClick={() => {
                  sounds.playClick();
                  setIsQuickActionModalOpen(true);
                }}
                className="w-14 h-14 bg-gradient-to-tr from-indigo-650 to-indigo-800 hover:from-indigo-750 hover:to-indigo-900 active:scale-90 text-white rounded-full flex items-center justify-center shadow-xl shadow-indigo-600/35 border-4 border-white dark:border-slate-900 -translate-y-5 transition-all cursor-pointer group"
                title={isRtl ? 'الإجراءات السريعة الفائقة' : 'Quick Actions'}
              >
                <Plus size={26} className="text-white group-hover:rotate-90 transition-transform duration-300 stroke-[2.5]" />
              </button>
            </div>

            {/* Right Navigation Actions (Customers, Settings) */}
            <div className="flex-1 flex justify-around items-center">

              {/* Item 3: Customers (العملاء) */}
              <button
                onClick={() => {
                  sounds.playClick();
                  setActiveScreen('customers');
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all cursor-pointer ${
                  activeScreen === 'customers' 
                    ? 'text-indigo-650 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/25' 
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
                }`}
              >
                <Users size={20} className={activeScreen === 'customers' ? 'scale-110' : ''} />
                <span className="text-[10px] font-black mt-1">
                  {isRtl ? 'العملاء' : 'Customers'}
                </span>
              </button>

              {/* Item 4: Settings (الإعدادات) */}
              <button
                onClick={() => {
                  sounds.playClick();
                  setActiveScreen('settings');
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all cursor-pointer ${
                  activeScreen === 'settings' 
                    ? 'text-indigo-650 dark:text-indigo-400 bg-indigo-50/55 dark:bg-indigo-950/25' 
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
        />

        {/* Global Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          language={language}
          products={products}
          onAction={handleCommandAction}
        />
      </div>
    </AuthContext.Provider>
  );
}