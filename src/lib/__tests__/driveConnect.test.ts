import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => {
  const makeStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => map.clear(),
    };
  };
  const g = globalThis as any;
  g.localStorage = makeStorage();
  g.sessionStorage = makeStorage();
  g.window = Object.assign(new EventTarget(), { location: { origin: 'https://app.example' } });
  g.document = { documentElement: { dir: 'rtl' } };
  return {
    session: null as any,
    signInWithOAuth: null as any,
    linkIdentity: null as any,
    setSession: null as any,
    signOut: null as any,
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }));
vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      signInWithOAuth: (...args: unknown[]) => auth.signInWithOAuth(...args),
      linkIdentity: (...args: unknown[]) => auth.linkIdentity(...args),
      setSession: (...args: unknown[]) => auth.setSession(...args),
      signOut: (...args: unknown[]) => auth.signOut(...args),
    },
  },
}));

import { DRIVE_SCOPE, finishDriveConnect, isDriveConnectPending, startDriveConnect } from '../driveConnect';
import { getDriveAccessToken, setDriveAccessToken } from '../../services/googleDrive';

const storeSession = (over: Record<string, unknown> = {}) => ({
  access_token: 'store-access',
  refresh_token: 'store-refresh',
  provider_token: null,
  user: { id: 'owner-1', email: 'shop@example.com', identities: [] },
  ...over,
});

beforeEach(() => {
  (globalThis as any).sessionStorage.clear();
  setDriveAccessToken('');
  auth.session = storeSession();
  auth.signInWithOAuth = vi.fn(async () => ({ data: { url: 'https://google' }, error: null }));
  auth.linkIdentity = vi.fn(async () => ({ data: { url: 'https://google' }, error: null }));
  auth.setSession = vi.fn(async () => ({ error: null }));
  auth.signOut = vi.fn(async () => ({ error: null }));
});

describe('connecting Google Drive', () => {
  it('links Google to the signed-in account when it has no Google identity, asking only for app files', async () => {
    await startDriveConnect('owner-1');
    expect(auth.linkIdentity).toHaveBeenCalledTimes(1);
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
    const { options } = auth.linkIdentity.mock.calls[0][0];
    expect(options.scopes).toBe(DRIVE_SCOPE);
    expect(options.queryParams.login_hint).toBe('shop@example.com');
    expect(isDriveConnectPending()).toBe(true);
  });

  it('signs in again with the linked Google account when there is one', async () => {
    auth.session = storeSession({
      user: { id: 'owner-1', email: 'shop@example.com', identities: [{ provider: 'google', identity_data: { email: 'owner@gmail.com' } }] },
    });
    await startDriveConnect('owner-1');
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(auth.signInWithOAuth.mock.calls[0][0].options.queryParams.login_hint).toBe('owner@gmail.com');
  });

  it('refuses to start for an account that is not the signed-in one', async () => {
    await expect(startDriveConnect('someone-else')).rejects.toMatchObject({ code: 'no-session' });
    expect(isDriveConnectPending()).toBe(false);
  });

  it('keeps the Drive token Google sends back for the same account', async () => {
    await startDriveConnect('owner-1');
    const result = await finishDriveConnect(storeSession({ provider_token: 'drive-token' }) as any, true);
    expect(result).toBe('connected');
    expect(getDriveAccessToken()).toBe('drive-token');
    expect(isDriveConnectPending()).toBe(false);
  });

  it('does not take the token left from the original Google sign-in, which has no Drive access', async () => {
    auth.session = storeSession({ provider_token: 'login-token' });
    await startDriveConnect('owner-1');
    expect(await finishDriveConnect(storeSession({ provider_token: 'login-token' }) as any)).toBeNull();
    expect(getDriveAccessToken()).toBeNull();
    expect(isDriveConnectPending()).toBe(true);

    expect(await finishDriveConnect(storeSession({ provider_token: 'login-token' }) as any, true)).toBe('no-token');
    expect(isDriveConnectPending()).toBe(false);
  });

  it('puts the store session back when another Google account comes back', async () => {
    await startDriveConnect('owner-1');
    const other = storeSession({ provider_token: 'other-token', user: { id: 'stranger', email: 'x@gmail.com' } });
    expect(await finishDriveConnect(other as any, true)).toBe('wrong-account');
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'store-access', refresh_token: 'store-refresh' });
    expect(getDriveAccessToken()).toBeNull();
  });

  it('signs out rather than staying in the wrong account when the store session cannot be restored', async () => {
    auth.setSession = vi.fn(async () => ({ error: new Error('expired') }));
    await startDriveConnect('owner-1');
    await finishDriveConnect(storeSession({ user: { id: 'stranger' } }) as any, true);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('ignores sessions when no Drive connection was started', async () => {
    expect(await finishDriveConnect(storeSession({ provider_token: 'drive-token' }) as any, true)).toBeNull();
    expect(getDriveAccessToken()).toBeNull();
  });
});

describe('Drive token lifetime', () => {
  it('drops an expired token instead of sending it to Drive', () => {
    setDriveAccessToken('old', Date.now() - 1000);
    expect(getDriveAccessToken()).toBeNull();
    setDriveAccessToken('fresh', Date.now() + 60_000);
    expect(getDriveAccessToken()).toBe('fresh');
  });
});
