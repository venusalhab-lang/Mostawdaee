import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('../../services/supabase', () => ({
  getSupabaseClient: () => ({ rpc }),
}));

import {
  assertRestoreIdle,
  clearIncompleteRestore,
  markRestoreIncomplete,
  readIncompleteRestore,
  refreshIncompleteRestore,
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
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('blocks sales while a restore is incomplete and clears after success', async () => {
    expect(readIncompleteRestore('u1')).toBeNull();
    expect(() => assertRestoreIdle('u1')).not.toThrow();
    await markRestoreIncomplete('u1', 'replace', 42);
    expect(rpc).toHaveBeenCalledWith('begin_store_restore', { p_mode: 'replace' });
    expect(readIncompleteRestore('u1')).toEqual({ at: 42, mode: 'replace' });
    expect(() => assertRestoreIdle('u1')).toThrowError(/did not finish/);
    try {
      assertRestoreIdle('u1');
    } catch (error: any) {
      expect(error.code).toBe('restore-incomplete');
    }
    await clearIncompleteRestore('u1');
    expect(rpc).toHaveBeenCalledWith('clear_store_restore');
    expect(readIncompleteRestore('u1')).toBeNull();
    expect(() => assertRestoreIdle('u1')).not.toThrow();
  });

  it('refreshes the local mirror from the server lock so another device cannot leave sales open', async () => {
    rpc.mockResolvedValueOnce({ data: { at: 99, mode: 'merge' }, error: null });
    const next = await refreshIncompleteRestore('u1');
    expect(next).toEqual({ at: 99, mode: 'merge' });
    expect(readIncompleteRestore('u1')).toEqual({ at: 99, mode: 'merge' });
    expect(() => assertRestoreIdle('u1')).toThrowError(/did not finish/);

    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await refreshIncompleteRestore('u1')).toBeNull();
    expect(readIncompleteRestore('u1')).toBeNull();
  });

  it('keeps the local mirror when the server refresh fails', async () => {
    await markRestoreIncomplete('u1', 'merge', 7);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    expect(await refreshIncompleteRestore('u1')).toEqual({ at: 7, mode: 'merge' });
    expect(readIncompleteRestore('u1')).toEqual({ at: 7, mode: 'merge' });
  });
});
