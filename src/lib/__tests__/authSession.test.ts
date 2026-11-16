import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSupabaseAuthStorage,
  isStaleAuthError,
  isSupabaseAuthStorageKey,
  prepareOAuthSignIn,
  recoverFromStaleAuthSession,
  resolveBootSession,
  signInWithPasswordRecovering,
} from '../authSession';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: Storage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => { map.delete(key); },
    setItem: (key, value) => { map.set(key, String(value)); },
  };
  return { storage, map };
}

describe('authSession storage hygiene', () => {
  it('recognizes Supabase auth persistence keys', () => {
    expect(isSupabaseAuthStorageKey('sb-kwvrtsnvadjknioqbbxs-auth-token')).toBe(true);
    expect(isSupabaseAuthStorageKey('sb-abc-auth-token-code-verifier')).toBe(true);
    expect(isSupabaseAuthStorageKey('mustawdae:uid:products')).toBe(false);
  });

  it('clears only auth keys from storage', () => {
    const { storage, map } = memoryStorage({
      'sb-proj-auth-token': '{"access_token":"x"}',
      'sb-proj-auth-token-code-verifier': 'pkce',
      'mustawdae:u1:products': '[]',
    });
    expect(clearSupabaseAuthStorage(storage).sort()).toEqual([
      'sb-proj-auth-token',
      'sb-proj-auth-token-code-verifier',
    ]);
    expect(map.has('mustawdae:u1:products')).toBe(true);
    expect(map.size).toBe(1);
  });
});

describe('isStaleAuthError', () => {
  it('treats refresh/JWT failures as stale, not wrong passwords', () => {
    expect(isStaleAuthError({ message: 'Invalid Refresh Token: Refresh Token Not Found' })).toBe(true);
    expect(isStaleAuthError({ code: 'refresh_token_not_found', message: 'x' })).toBe(true);
    expect(isStaleAuthError({ message: 'invalid JWT: unable to parse or verify' })).toBe(true);
    expect(isStaleAuthError({ message: 'Invalid login credentials' })).toBe(false);
    expect(isStaleAuthError({ message: 'Email not confirmed' })).toBe(false);
    expect(isStaleAuthError({ message: 'Failed to fetch', name: 'AuthRetryableFetchError' })).toBe(false);
  });
});

describe('resolveBootSession', () => {
  it('keeps a valid online session after getUser succeeds', async () => {
    const session = { access_token: 'a', user: { id: 'u1' } };
    const client = {
      auth: {
        getSession: vi.fn()
          .mockResolvedValueOnce({ data: { session }, error: null })
          .mockResolvedValueOnce({ data: { session }, error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
        signOut: vi.fn(),
      },
    };
    const result = await resolveBootSession(client as any, { online: true });
    expect(result).toEqual({ session, clearedStale: false });
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('clears a stored session when getUser reports a dead refresh token', async () => {
    const { storage } = memoryStorage({ 'sb-proj-auth-token': '{}' });
    vi.stubGlobal('localStorage', storage);
    const session = { access_token: 'dead', user: { id: 'u1' } };
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'Invalid Refresh Token: Refresh Token Not Found' },
        }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    };
    const result = await resolveBootSession(client as any, { online: true });
    expect(result.session).toBeNull();
    expect(result.clearedStale).toBe(true);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(storage.getItem('sb-proj-auth-token')).toBeNull();
  });

  it('does not clear while offline', async () => {
    const session = { access_token: 'a', user: { id: 'u1' } };
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        getUser: vi.fn(),
        signOut: vi.fn(),
      },
    };
    const result = await resolveBootSession(client as any, { online: false });
    expect(result).toEqual({ session, clearedStale: false });
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });
});

describe('signInWithPasswordRecovering', () => {
  beforeEach(() => {
    clearSupabaseAuthStorage();
  });

  it('clears storage on login failure and retries once for stale errors', async () => {
    const { storage } = memoryStorage({ 'sb-proj-auth-token': 'stale' });
    vi.stubGlobal('localStorage', storage);
    const ok = { data: { user: { id: 'u1' }, session: { access_token: 'ok' } }, error: null };
    const client = {
      auth: {
        signInWithPassword: vi.fn()
          .mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'Invalid Refresh Token' } })
          .mockResolvedValueOnce(ok),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    };
    const result = await signInWithPasswordRecovering(client as any, { email: 'a@b.com', password: 'x' });
    expect(result).toEqual(ok);
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(storage.getItem('sb-proj-auth-token')).toBeNull();
  });

  it('clears storage on wrong-password failure without retrying credentials', async () => {
    const failure = { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue(failure),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    };
    const result = await signInWithPasswordRecovering(client as any, { email: 'a@b.com', password: 'bad' });
    expect(result).toEqual(failure);
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('prepareOAuthSignIn / recoverFromStaleAuthSession', () => {
  it('clears leftover verifier when there is no session', async () => {
    const { storage } = memoryStorage({ 'sb-proj-auth-token-code-verifier': 'abc' });
    vi.stubGlobal('localStorage', storage);
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        getUser: vi.fn(),
        signOut: vi.fn(),
      },
    };
    await prepareOAuthSignIn(client as any);
    expect(storage.getItem('sb-proj-auth-token-code-verifier')).toBeNull();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it('recover signs out locally then clears storage', async () => {
    const { storage } = memoryStorage({ 'sb-proj-auth-token': 'x' });
    const client = { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } };
    await recoverFromStaleAuthSession(client as any, storage);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(storage.getItem('sb-proj-auth-token')).toBeNull();
  });
});
