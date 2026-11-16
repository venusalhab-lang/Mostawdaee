import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import { isOfflineError } from './offlineQueue';

/** Supabase auth keys that can leave a browser unable to sign in until storage is cleared by hand. */
const AUTH_STORAGE_KEY = /^(sb-.*-(auth-token|auth-token-code-verifier)|supabase\.auth\.token)/i;

export function isSupabaseAuthStorageKey(key: string): boolean {
  return AUTH_STORAGE_KEY.test(key);
}

/** Remove persisted Supabase auth artifacts from Web Storage (session stays in memory until signOut). */
export function clearSupabaseAuthStorage(storage: Storage | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null): string[] {
  if (!storage) return [];
  const removed: string[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      if (!isSupabaseAuthStorageKey(key)) continue;
      storage.removeItem(key);
      removed.push(key);
    }
  } catch {
    /* private mode / blocked storage */
  }
  return removed;
}

/**
 * Refresh/session failures that leave a dead token in localStorage.
 * Wrong password / unconfirmed email are NOT stale — do not classify those as recoverable storage corruption.
 */
export function isStaleAuthError(error: unknown): boolean {
  if (!error || isOfflineError(error)) return false;
  const e = error as { code?: string; message?: string; name?: string; status?: number };
  const code = String(e.code || '').toLowerCase();
  const text = `${e.name || ''} ${e.message || ''} ${code}`.toLowerCase();
  if (/invalid.?login.?credentials|email not confirmed|user already registered|weak password|rate limit|over_email_send_rate_limit|unable to validate email|invalid email/.test(text)) {
    return false;
  }
  return (
    code === 'invalid_grant' ||
    code === 'session_not_found' ||
    code === 'refresh_token_not_found' ||
    code === 'bad_jwt' ||
    /invalid jwt|jwt expired|refresh.?token|session.?expired|session_not_found|invalid.?claim|authsessionmissingerror|invalid.?refresh|token.?not.?found|user.?not.?found|invalid.?token/.test(text)
  );
}

/** Drop the local session and wipe auth storage so the next sign-in is not blocked by a dead token. */
export async function recoverFromStaleAuthSession(
  client: Pick<SupabaseClient, 'auth'>,
  storage: Storage | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null,
): Promise<void> {
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    /* ignore — storage clear below is the fail-safe */
  }
  clearSupabaseAuthStorage(storage);
}

/**
 * When online, confirm the stored session with the Auth API (refreshes if needed).
 * Dead refresh tokens are cleared so the merchant sees login instead of a stuck shell.
 * Offline: keep the stored session so queued sales remain attributable.
 */
export async function resolveBootSession(
  client: Pick<SupabaseClient, 'auth'>,
  options: { online?: boolean } = {},
): Promise<{ session: Session | null; clearedStale: boolean }> {
  const online = options.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false);
  const { data, error } = await client.auth.getSession();
  let session = data.session ?? null;

  if (!session?.access_token) {
    if (error && isStaleAuthError(error)) {
      await recoverFromStaleAuthSession(client);
      return { session: null, clearedStale: true };
    }
    return { session: null, clearedStale: false };
  }

  if (!online) return { session, clearedStale: false };

  try {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      if (isOfflineError(userError)) return { session, clearedStale: false };
      await recoverFromStaleAuthSession(client);
      return { session: null, clearedStale: true };
    }
    // Prefer the post-refresh session when getUser succeeded.
    const again = await client.auth.getSession();
    return { session: again.data.session ?? session, clearedStale: false };
  } catch (error) {
    if (isOfflineError(error)) return { session, clearedStale: false };
    if (isStaleAuthError(error)) {
      await recoverFromStaleAuthSession(client);
      return { session: null, clearedStale: true };
    }
    throw error;
  }
}

type PasswordSignIn = SupabaseClient['auth']['signInWithPassword'];

/**
 * Password sign-in that clears corrupted auth storage on failure.
 * Stale-token failures retry once after a local recover so merchants need not clear site data by hand.
 */
export async function signInWithPasswordRecovering(
  client: Pick<SupabaseClient, 'auth'>,
  credentials: Parameters<PasswordSignIn>[0],
): Promise<Awaited<ReturnType<PasswordSignIn>>> {
  const first = await client.auth.signInWithPassword(credentials);
  if (!first.error) return first;

  const stale = isStaleAuthError(first.error);
  await recoverFromStaleAuthSession(client);

  if (!stale) return first;

  const second = await client.auth.signInWithPassword(credentials);
  return second;
}

/** OAuth start: clear dead local sessions first so PKCE verifier / token keys cannot block the redirect. */
export async function prepareOAuthSignIn(client: Pick<SupabaseClient, 'auth'>): Promise<void> {
  const { data } = await client.auth.getSession();
  if (!data.session?.access_token) {
    // Leftover code-verifier / half-written tokens with no usable session.
    clearSupabaseAuthStorage();
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    const { error } = await client.auth.getUser();
    if (error && isStaleAuthError(error)) await recoverFromStaleAuthSession(client);
  } catch (error) {
    if (isStaleAuthError(error)) await recoverFromStaleAuthSession(client);
  }
}

export function authErrorMessage(error: AuthError | Error | null | undefined): string {
  return String((error as AuthError | undefined)?.message || error || '');
}
