import { getSupabaseClient } from '../services/supabase';
import { userCacheKey } from './userStorage';

const FLAG = 'restore_incomplete';

export interface IncompleteRestore {
  at: number;
  mode: 'merge' | 'replace';
}

function writeLocal(uid: string, value: IncompleteRestore | null): void {
  if (typeof localStorage === 'undefined' || !uid) return;
  try {
    const key = userCacheKey(uid, FLAG);
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota */ }
}

function readLocal(uid: string): IncompleteRestore | null {
  if (typeof localStorage === 'undefined' || !uid) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(userCacheKey(uid, FLAG)) || 'null') as IncompleteRestore | null;
    if (!raw || typeof raw.at !== 'number') return null;
    return { at: raw.at, mode: raw.mode === 'replace' ? 'replace' : 'merge' };
  } catch {
    return null;
  }
}

/** True while a restore stopped mid-write — books may be inconsistent until a full restore succeeds. */
export function readIncompleteRestore(uid: string): IncompleteRestore | null {
  return readLocal(uid);
}

/**
 * Marks restore incomplete on the server (authoritative) and mirrors locally for fast UI.
 * Server lock blocks live merchant_commit until clear_store_restore succeeds.
 */
export async function markRestoreIncomplete(uid: string, mode: 'merge' | 'replace', at = Date.now()): Promise<void> {
  const next: IncompleteRestore = { at, mode: mode === 'replace' ? 'replace' : 'merge' };
  writeLocal(uid, next);
  const client = getSupabaseClient();
  if (!client || !uid) return;
  const { error } = await client.rpc('begin_store_restore', { p_mode: next.mode });
  if (error) {
    throw Object.assign(new Error(error.message || 'Could not lock the store for restore'), {
      code: 'restore-lock-failed',
    });
  }
}

/** Clears the server lock after a successful restore; then clears the local mirror. */
export async function clearIncompleteRestore(uid: string): Promise<void> {
  const client = getSupabaseClient();
  if (client && uid) {
    const { error } = await client.rpc('clear_store_restore');
    if (error) {
      throw Object.assign(new Error(error.message || 'Could not clear the restore lock'), {
        code: 'restore-unlock-failed',
      });
    }
  }
  writeLocal(uid, null);
}

/** Sync local mirror from the server flag (other device / cleared storage). */
export async function refreshIncompleteRestore(uid: string): Promise<IncompleteRestore | null> {
  const client = getSupabaseClient();
  if (!client || !uid) return readLocal(uid);
  const { data, error } = await client.rpc('store_restore_incomplete');
  if (error) return readLocal(uid);
  if (!data || typeof data !== 'object') {
    writeLocal(uid, null);
    return null;
  }
  const at = Number((data as { at?: unknown }).at);
  const mode = (data as { mode?: unknown }).mode === 'replace' ? 'replace' as const : 'merge' as const;
  if (!Number.isFinite(at)) {
    writeLocal(uid, null);
    return null;
  }
  const next = { at, mode };
  writeLocal(uid, next);
  return next;
}

/** Fail closed: refuse new sales/purchases while a prior restore did not finish. */
export function assertRestoreIdle(uid: string): void {
  const flag = readIncompleteRestore(uid);
  if (!flag) return;
  throw Object.assign(new Error('A previous restore did not finish'), {
    code: 'restore-incomplete',
    at: flag.at,
    mode: flag.mode,
  });
}
