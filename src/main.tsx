import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { FirebaseProvider } from './components/FirebaseProvider.tsx';
import { CurrencyProvider } from './components/CurrencyContext.tsx';
import { AuthProvider } from './components/AuthContext.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { registerSW } from 'virtual:pwa-register';
import { supabase } from './supabaseClient';
import { Toaster } from 'sonner';

// OAuth providers may return to this server-side callback path. Normalize it
// before the SPA starts so static hosts and HashRouter see the application root.
if (window.location.pathname === '/auth/callback' || window.location.pathname === '/auth/callback/') {
  window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`);
}

// Helper functions to parse and decode tokens for early robust session sync
function parseHashParams(hashString: string) {
  const hash = hashString.startsWith('#') ? hashString.substring(1) : hashString;
  const params: Record<string, string> = {};
  hash.split('&').forEach(pair => {
    const [key, val] = pair.split('=');
    if (key && val) {
      params[decodeURIComponent(key)] = decodeURIComponent(val);
    }
  });
  return params;
}

function decodeUserFromToken(token: string) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      user_metadata: payload.user_metadata || {},
      aud: payload.aud
    };
  } catch (error) {
    console.error('[Auth Early Intercept] Error decoding JWT token:', error);
    return null;
  }
}

// Early intercept and write tokens to localStorage to guarantee persistent state immediately
try {
  const hashParams = parseHashParams(window.location.hash);
  if (hashParams.access_token) {
    const decodedUser = decodeUserFromToken(hashParams.access_token);
    if (decodedUser) {
      console.log('[Auth Early Intercept] Decoded and saved user session:', decodedUser.email);
      localStorage.setItem('mustawdae_supabase_session_override', JSON.stringify(decodedUser));
      
      const sessionObj = {
        access_token: hashParams.access_token,
        token_type: hashParams.token_type || 'bearer',
        expires_in: parseInt(hashParams.expires_in || '3600', 10),
        refresh_token: hashParams.refresh_token || '',
        user: decodedUser,
        expires_at: Math.floor(Date.now() / 1000) + parseInt(hashParams.expires_in || '3600', 10)
      };
      
      localStorage.setItem('sb-kwvrtsnvadjknioqbbxs-auth-token', JSON.stringify(sessionObj));

      // Also let Supabase SDK attempt to parse and persist the session from URL if possible
      try {
        if ((supabase as any)?.auth?.getSessionFromUrl) {
          // getSessionFromUrl helps the SDK parse code/token responses and persist session
          (supabase as any).auth.getSessionFromUrl?.().catch(()=>{});
        }
      } catch (e) {}

      // Dynamically write custom project reference key if we are configured for a different Supabase project
      try {
        const storedUrl = localStorage.getItem('VITE_SUPABASE_URL');
        if (storedUrl && storedUrl.trim()) {
          const match = storedUrl.match(/https?:\/\/([^.]+)\.supabase\.co/);
          if (match && match[1]) {
            const dynamicKey = `sb-${match[1]}-auth-token`;
            localStorage.setItem(dynamicKey, JSON.stringify(sessionObj));
            console.log('[Auth Early Intercept] Saved to custom project storage key:', dynamicKey);
          }
        }
      } catch (err) {
        console.warn('[Auth Early Intercept] Ignored custom storage reference write warning:', err);
      }
    }
  }
} catch (e) {
  console.error('[Auth Early Intercept] Process error:', e);
}

// إغلاق النافذة المنبثقة لتسجيل الدخول تلقائياً بعد نجاح العملية وحفظ الجلسة
// If this window is an OAuth popup or contains OAuth fragments, notify opener and close.
if (window.opener && (window.name === 'supabase_oauth_popup' || window.location.hash.includes('access_token') || window.location.search.includes('code='))) {
  console.log('[Auth] Detected OAuth callback popup. Syncing session and closing window.');
  try {
    const hashParams = parseHashParams(window.location.hash);
    const decodedUser = hashParams.access_token ? decodeUserFromToken(hashParams.access_token) : null;
    
    const oauthPayload = {
      type: 'supabse_oauth_success',
      access_token: hashParams.access_token || null,
      refresh_token: hashParams.refresh_token || null,
      expires_in: hashParams.expires_in || null,
      token_type: hashParams.token_type || null,
      user: decodedUser
    };

    // Post both formats to opener for extreme resilience:
    window.opener.postMessage(oauthPayload, window.location.origin);
    window.opener.postMessage('supabse_oauth_success', window.location.origin);
  } catch (e) {
    console.error('Error postMessage to opener:', e);
  }
  setTimeout(() => {
    try {
      window.close();
    } catch (e) {
      console.error('Error closing popup:', e);
    }
  }, 1200);
}

// If the URL contains an OAuth error (e.g., bad_oauth_state), clear stale Supabase session keys
try {
  const params = new URLSearchParams(window.location.search || '');
  const oauthErr = params.get('error') || params.get('error_code');
  if (oauthErr) {
    console.warn('[Auth] Detected OAuth error in URL:', oauthErr);
    try {
      Object.keys(localStorage).forEach(k => {
        if (/^sb-|supabase|mustawdae_supabase_session_override|sb-.*-auth-token/i.test(k)) {
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

// Register the PWA service worker with auto-update (only if not loaded inside the sandbox web preview)
if (!isSandboxPreview) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <FirebaseProvider>
        <CurrencyProvider>
          <AuthProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
            <Toaster richColors closeButton position="top-center" dir="auto" duration={4000} />
          </AuthProvider>
        </CurrencyProvider>
      </FirebaseProvider>
    </HashRouter>
  </StrictMode>,
);
