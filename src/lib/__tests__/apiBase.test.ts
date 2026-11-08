import { beforeEach, describe, expect, it, vi } from 'vitest';

const isNative = vi.fn(() => false);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative() },
}));

describe('apiBase', () => {
  beforeEach(() => {
    isNative.mockReturnValue(false);
    vi.resetModules();
  });

  it('uses same-origin paths in the browser when env is empty', async () => {
    const { resolveApiBase, getApiBase, apiUrl } = await import('../apiBase');
    expect(resolveApiBase({ envBase: '', native: false })).toBe('');
    expect(getApiBase()).toBe('');
    expect(apiUrl('/api/admin/me')).toBe('/api/admin/me');
  });

  it('falls back to production on Capacitor when env is empty', async () => {
    isNative.mockReturnValue(true);
    const { resolveApiBase, getApiBase, apiUrl, DEFAULT_NATIVE_API_BASE } = await import('../apiBase');
    expect(resolveApiBase({ envBase: '', native: true })).toBe(DEFAULT_NATIVE_API_BASE);
    expect(getApiBase()).toBe(DEFAULT_NATIVE_API_BASE);
    expect(apiUrl('/api/admin/me')).toBe(`${DEFAULT_NATIVE_API_BASE}/api/admin/me`);
  });

  it('prefers an explicit env base over the native default', async () => {
    const { resolveApiBase } = await import('../apiBase');
    expect(resolveApiBase({ envBase: 'https://app.example.com/', native: true })).toBe('https://app.example.com');
  });
});
