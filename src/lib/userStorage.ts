const LEGACY_PREFIX = 'mustawdae_';

export const USER_CACHE_KEYS = [
  'settings',
  'products',
  'invoices',
  'employees',
  'payroll',
  'customers',
  'customer_transactions',
  'vault_records',
  'warehouses',
  'vault',
  'audit_logs',
  'offline_invoices',
  'held_bills',
] as const;

export type UserCacheKey = (typeof USER_CACHE_KEYS)[number];

export function userCacheKey(uid: string, key: UserCacheKey | string): string {
  return `mustawdae:${uid}:${key}`;
}

export function readUserCache<T>(uid: string, key: UserCacheKey | string, fallback: T): T {
  if (typeof window === 'undefined' || !uid) return fallback;
  try {
    const raw = localStorage.getItem(userCacheKey(uid, key));
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeUserCache(uid: string, key: UserCacheKey | string, value: unknown): void {
  if (typeof window === 'undefined' || !uid) return;
  try {
    localStorage.setItem(userCacheKey(uid, key), JSON.stringify(value));
  } catch (error) {
    console.warn('[userStorage] Failed to persist', key, error);
  }
}

export function removeUserCache(uid: string, key: UserCacheKey | string): void {
  if (typeof window === 'undefined' || !uid) return;
  try {
    localStorage.removeItem(userCacheKey(uid, key));
  } catch {
    // ignore
  }
}

export function migrateLegacyUserCache(uid: string): void {
  if (typeof window === 'undefined' || !uid) return;
  for (const key of USER_CACHE_KEYS) {
    const namespaced = userCacheKey(uid, key);
    if (localStorage.getItem(namespaced)) continue;
    const legacy = localStorage.getItem(`${LEGACY_PREFIX}${key}`);
    if (!legacy) continue;
    try {
      localStorage.setItem(namespaced, legacy);
      localStorage.removeItem(`${LEGACY_PREFIX}${key}`);
    } catch {
      // ignore
    }
  }
}

export function clearUserCache(uid: string | null | undefined): void {
  if (typeof window === 'undefined' || !uid) return;
  const prefix = `mustawdae:${uid}:`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
