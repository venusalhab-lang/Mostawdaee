import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertRestoreIdle,
  clearIncompleteRestore,
  markRestoreIncomplete,
  readIncompleteRestore,
} from '../restoreGuard';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

describe('restore guard', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
  });

  it('blocks sales while a restore is incomplete and clears after success', () => {
    expect(readIncompleteRestore('u1')).toBeNull();
    expect(() => assertRestoreIdle('u1')).not.toThrow();
    markRestoreIncomplete('u1', 'replace', 42);
    expect(readIncompleteRestore('u1')).toEqual({ at: 42, mode: 'replace' });
    expect(() => assertRestoreIdle('u1')).toThrowError(/did not finish/);
    try {
      assertRestoreIdle('u1');
    } catch (error: any) {
      expect(error.code).toBe('restore-incomplete');
    }
    clearIncompleteRestore('u1');
    expect(readIncompleteRestore('u1')).toBeNull();
    expect(() => assertRestoreIdle('u1')).not.toThrow();
  });
});
