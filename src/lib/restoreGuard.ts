import { userCacheKey } from './userStorage';

const FLAG = 'restore_incomplete';

export interface IncompleteRestore {
  at: number;
  mode: 'merge' | 'replace';
}

/** True while a restore stopped mid-write — books may be inconsistent until a full restore succeeds. */
export function readIncompleteRestore(uid: string): IncompleteRestore | null {
  if (typeof localStorage === 'undefined' || !uid) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(userCacheKey(uid, FLAG)) || 'null') as IncompleteRestore | null;
    if (!raw || typeof raw.at !== 'number') return null;
    return { at: raw.at, mode: raw.mode === 'replace' ? 'replace' : 'merge' };
  } catch {
    return null;
  }
}

export function markRestoreIncomplete(uid: string, mode: 'merge' | 'replace', at = Date.now()): void {
  if (typeof localStorage === 'undefined' || !uid) return;
  try {
    localStorage.setItem(userCacheKey(uid, FLAG), JSON.stringify({ at, mode }));
  } catch { /* quota */ }
}

export function clearIncompleteRestore(uid: string): void {
  if (typeof localStorage === 'undefined' || !uid) return;
  try {
    localStorage.removeItem(userCacheKey(uid, FLAG));
  } catch { /* ignore */ }
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
