export function getApiBase(): string {
  const fromEnv = String((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return '';
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
