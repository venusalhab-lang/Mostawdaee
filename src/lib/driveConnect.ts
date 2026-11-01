import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import type { Session } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { supabase } from '../supabaseClient';
import { NATIVE_OAUTH_REDIRECT } from './nativeAuth';
import { setDriveAccessToken } from '../services/googleDrive';

/** Only files this app creates; the full Drive scope is "restricted" and needs a paid Google security review. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_CONNECTED_EVENT = 'drive-connected';

const PENDING_KEY = 'mostawdaee_drive_connect';
const PENDING_TTL_MS = 10 * 60_000;
// Google access tokens last one hour; stop a few minutes early so an upload never starts on a dying token.
const TOKEN_LIFETIME_MS = 55 * 60_000;

interface PendingDriveConnect {
  uid: string;
  at: number;
  /** Lets a different Google account that signs in by mistake be undone without losing the store session. */
  accessToken: string;
  refreshToken: string;
  /** A provider token left from the original Google sign-in has no Drive scope and must not be taken for the new one. */
  priorProviderToken: string | null;
}

export type DriveConnectResult = 'connected' | 'no-token' | 'wrong-account';

function readPending(): PendingDriveConnect | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingDriveConnect;
    if (!pending?.uid || Date.now() - pending.at > PENDING_TTL_MS) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

export function clearDriveConnect(): void {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
}

export function isDriveConnectPending(): boolean {
  return readPending() !== null;
}

/**
 * Sends the merchant to Google to grant Drive access for the account that is signed in now.
 * An account without a Google identity gets one linked, so no second account can be created.
 */
export async function startDriveConnect(uid: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || session.user.id !== uid) {
    throw Object.assign(new Error('Sign in again before connecting Google Drive.'), { code: 'no-session' });
  }

  const googleIdentity = session.user.identities?.find((identity) => identity.provider === 'google');
  const hint = (googleIdentity?.identity_data?.email as string | undefined) || session.user.email;
  const native = Capacitor.isNativePlatform();
  const options = {
    redirectTo: native ? NATIVE_OAUTH_REDIRECT : window.location.origin,
    scopes: DRIVE_SCOPE,
    skipBrowserRedirect: native,
    queryParams: {
      prompt: 'consent',
      include_granted_scopes: 'true',
      ...(hint ? { login_hint: hint } : {}),
    },
  };

  const pending: PendingDriveConnect = {
    uid,
    at: Date.now(),
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    priorProviderToken: session.provider_token ?? null,
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const { data, error } = googleIdentity
    ? await supabase.auth.signInWithOAuth({ provider: 'google', options })
    : await supabase.auth.linkIdentity({ provider: 'google', options });
  if (error) {
    clearDriveConnect();
    throw error;
  }
  if (native) {
    if (!data?.url) {
      clearDriveConnect();
      throw new Error('Google Drive connection could not start. Try again.');
    }
    await Browser.open({ url: data.url, presentationStyle: 'fullscreen' });
  }
}

const isArabic = () => typeof document === 'undefined' || document.documentElement.dir !== 'ltr';

function announce(result: DriveConnectResult): void {
  const ar = isArabic();
  if (result === 'connected') {
    toast.success(ar ? 'تم ربط Google Drive.' : 'Google Drive connected.');
  } else if (result === 'wrong-account') {
    toast.error(ar
      ? 'اخترت حساب Google غير المرتبط بهذا المتجر، فلم يتم الربط. اضغط ربط من جديد واختر حساب المتجر.'
      : 'That Google account does not belong to this store, so nothing was connected. Try again with the store account.',
      { duration: 10000 });
  } else {
    toast.error(ar
      ? 'عاد Google دون إذن الوصول إلى Drive. اضغط ربط مرة أخرى ووافق على إذن Drive.'
      : 'Google returned without Drive access. Connect again and allow Drive.',
      { duration: 10000 });
  }
}

/**
 * Called with every new session. `returnedFromGoogle` is true right after this device exchanged
 * the code Google sent back; other sessions (refreshes, tab focus) are ignored until then.
 */
export async function finishDriveConnect(session: Session | null, returnedFromGoogle = false): Promise<DriveConnectResult | null> {
  const pending = readPending();
  if (!pending || !session?.user) return null;

  let result: DriveConnectResult;
  if (session.user.id !== pending.uid) {
    clearDriveConnect();
    try {
      const { error } = await supabase.auth.setSession({ access_token: pending.accessToken, refresh_token: pending.refreshToken });
      if (error) throw error;
    } catch {
      await supabase.auth.signOut({ scope: 'local' });
    }
    result = 'wrong-account';
  } else {
    const token = session.provider_token;
    if (!token || token === pending.priorProviderToken) {
      if (!returnedFromGoogle) return null;
      clearDriveConnect();
      result = 'no-token';
    } else {
      clearDriveConnect();
      setDriveAccessToken(token, Date.now() + TOKEN_LIFETIME_MS);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DRIVE_CONNECTED_EVENT));
      result = 'connected';
    }
  }
  announce(result);
  return result;
}
