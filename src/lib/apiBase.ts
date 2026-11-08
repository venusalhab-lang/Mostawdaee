import { Capacitor } from '@capacitor/core';

/**
 * API origin for fetch().
 * - Local Express / same-origin Vercel rewrite: empty → `/api/...`
 * - Phone builds: must be absolute — the WebView has no Vercel `/api` rewrite.
 *   Prefer `VITE_API_BASE_URL` at build time; otherwise fall back to production.
 */
export const DEFAULT_NATIVE_API_BASE = 'https://mostawdaee.com';

/** Pure resolver — used by getApiBase and unit tests. */
export function resolveApiBase(opts: { envBase?: string | null; native?: boolean }): string {
  const fromEnv = String(opts.envBase || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (opts.native) return DEFAULT_NATIVE_API_BASE;
  return '';
}

export function getApiBase(): string {
  return resolveApiBase({
    envBase: (import.meta as any).env?.VITE_API_BASE_URL,
    native: Capacitor.isNativePlatform(),
  });
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

/**
 * The reply body when it really is JSON from our server, otherwise null.
 * The app's bundled web server answers unknown paths with index.html and status 200,
 * so a 200 alone never proves that the server did anything.
 */
export async function readApiJson(response: Response): Promise<any | null> {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  const body = await response.json().catch(() => null);
  return body && typeof body === 'object' ? body : null;
}

export const API_UNREACHABLE_AR = 'تعذّر الوصول إلى خادم التطبيق. تحقق من الاتصال أو راسل الدعم.';
