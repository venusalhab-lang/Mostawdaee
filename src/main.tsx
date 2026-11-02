import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/cairo/900.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';
import { FirebaseProvider } from './components/FirebaseProvider.tsx';
import { CurrencyProvider } from './components/CurrencyContext.tsx';
import { AuthProvider } from './components/AuthContext.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { registerSW } from 'virtual:pwa-register';
import { Toaster } from 'sonner';
import { Capacitor } from '@capacitor/core';

// OAuth providers may return to this server-side callback path. Normalize it
// before the SPA starts so static hosts and HashRouter see the application root.
if (window.location.pathname === '/auth/callback' || window.location.pathname === '/auth/callback/') {
  window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`);
}

// Sessions are only ever created by the PKCE code exchange of a sign-in this device started.
// Raw tokens in a link would let anyone sign this device into their own account.
if (/[#&](access_token|refresh_token)=/.test(window.location.hash)) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}
try {
  localStorage.removeItem('mustawdae_supabase_session_override');
} catch { /* storage unavailable */ }

// If the URL contains an OAuth error (e.g., bad_oauth_state), clear stale Supabase session keys
try {
  const params = new URLSearchParams(window.location.search || '');
  const oauthErr = params.get('error') || params.get('error_code');
  if (oauthErr) {
    console.warn('[Auth] Detected OAuth error in URL:', oauthErr);
    try {
      Object.keys(localStorage).forEach(k => {
        if (/^sb-.*-auth-token|^sb-.*-code-verifier/i.test(k)) {
          localStorage.removeItem(k);
        }
      });
    } catch(e) {}
  }
} catch(e) {}

// Automatically unregister stale or active service workers in the development/sandbox preview
// to prevent aggressive caching of API endpoints and stale react assets.
const isSandboxPreview = 
  (import.meta as any).env?.DEV ||
  Capacitor.isNativePlatform() ||
  window.location.hostname.includes('.run.app') || 
  window.location.hostname.includes('localhost') ||
  window.location.hostname.includes('.aistudio.build') ||
  window.location.hostname.includes('.ai.studio');

if (isSandboxPreview) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const registration of registrations) {
        registration.unregister().then(success => {
          if (success) {
            console.log('[PWA] Unregistered active service worker to prevent state conflicts.');
          }
        });
      }
    }).catch(err => {
      console.warn('[PWA] Error unregistering service worker:', err);
    });
  }

  if ('caches' in window) {
    caches.keys().then(keys => {
      for (const key of keys) {
        caches.delete(key).then(() => {
          console.log(`[PWA] Cleared cache: ${key}`);
        });
      }
    }).catch(err => {
      console.warn('[PWA] Error clearing cache storage:', err);
    });
  }
}

// After a deploy, an open tab may request JS chunks that no longer exist. Reload once to fetch the new build;
// the guard stops a reload loop if the chunk is genuinely missing.
const PRELOAD_RELOAD_KEY = 'mostawdaee_preload_reload_at';
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY)) || 0;
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
  } catch { /* storage unavailable: still reload once */ }
  event.preventDefault();
  window.location.reload();
});

// Register the PWA service worker with auto-update (not in previews, and not in the native app, which ships its files in the APK)
if (!isSandboxPreview) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <FirebaseProvider>
        <CurrencyProvider>
          <AuthProvider>
            <ErrorBoundary variant="app">
              <App />
            </ErrorBoundary>
            <Toaster richColors closeButton position="top-center" dir="auto" duration={4000} />
          </AuthProvider>
        </CurrencyProvider>
      </FirebaseProvider>
    </HashRouter>
  </StrictMode>,
);
