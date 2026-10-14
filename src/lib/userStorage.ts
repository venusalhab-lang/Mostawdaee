import { clearRows } from './rowCache';

const LEGACY_PREFIX = 'mustawdae_';

export const USER_CACHE_KEYS = [
  'settings',
  'products',
  'invoices',
  'employees',
  'payroll',
  'customers',
  'customer_transactions',
  'suppliers',
  'supplier_transactions',
  'shifts',
  'orders',
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

// Writes are coalesced: Firestore snapshots can fire many times a second and serialising
// whole collections (invoices, products...) synchronously on each one blocks the UI thread.
const pendingWrites = new Map<string, unknown>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY_MS = 800;

/** Copies of server data; the app downloads them again, so they may be dropped. Held bills may not. */
const SERVER_COPY_KEYS = new Set<string>([
  'settings', 'products', 'invoices', 'employees', 'payroll', 'customers',
  'customer_transactions', 'suppliers', 'supplier_transactions', 'shifts', 'orders', 'vault_records', 'warehouses', 'vault', 'audit_logs',
]);

function persist(storageKey: string, value: unknown): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (error) {
    console.warn('[userStorage] Failed to persist', storageKey, error);
    // Too big for this device: an older copy left behind would show outdated stock and balances offline.
    // Removing it also frees room for the offline sales queue.
    if (SERVER_COPY_KEYS.has(storageKey.slice(storageKey.lastIndexOf(':') + 1))) {
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
  }
}

/** Writes everything now; used when the app is hidden or closing. */
function flushPendingWrites(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const entries = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  for (const [storageKey, value] of entries) persist(storageKey, value);
}

/** Writes one collection per tick so a sale that touches several large ones never freezes the screen. */
function flushNextPendingWrite(): void {
  flushTimer = null;
  const next = pendingWrites.entries().next();
  if (next.done) return;
  const [storageKey, value] = next.value;
  pendingWrites.delete(storageKey);
  persist(storageKey, value);
  if (pendingWrites.size > 0) flushTimer = setTimeout(flushNextPendingWrite, 0);
}

if (typeof window !== 'undefined') {
  // Never lose the latest data when the tab/app goes to the background or closes
  window.addEventListener('pagehide', flushPendingWrites);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingWrites();
  });
}

export function readUserCache<T>(uid: string, key: UserCacheKey | string, fallback: T): T {
  if (typeof window === 'undefined' || !uid) return fallback;
  const storageKey = userCacheKey(uid, key);
  if (pendingWrites.has(storageKey)) return pendingWrites.get(storageKey) as T;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeUserCache(uid: string, key: UserCacheKey | string, value: unknown): void {
  if (typeof window === 'undefined' || !uid) return;
  pendingWrites.set(userCacheKey(uid, key), value);
  if (!flushTimer) flushTimer = setTimeout(flushNextPendingWrite, FLUSH_DELAY_MS);
}

export function removeUserCache(uid: string, key: UserCacheKey | string): void {
  if (typeof window === 'undefined' || !uid) return;
  pendingWrites.delete(userCacheKey(uid, key));
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
  void clearRows(`${uid}|`);
  const prefix = `mustawdae:${uid}:`;
  for (const k of Array.from(pendingWrites.keys())) if (k.startsWith(prefix) && k !== `${prefix}offline_invoices`) pendingWrites.delete(k);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // Sales taken offline are kept until they are sent, even across a forced sign-out.
      if (key && key.startsWith(prefix) && key !== `${prefix}offline_invoices`) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
