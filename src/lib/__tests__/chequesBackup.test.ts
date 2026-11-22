import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/supabase', () => ({
  getSupabaseClient: () => null,
}));

import { ChequeStoreError, loadChequesForBackup } from '../chequesStore';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

describe('loadChequesForBackup', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
  });

  it('fails closed when there is no user id', async () => {
    await expect(loadChequesForBackup(undefined)).rejects.toBeInstanceOf(ChequeStoreError);
    await expect(loadChequesForBackup(null)).rejects.toMatchObject({ code: 'no_session' });
    await expect(loadChequesForBackup('')).rejects.toMatchObject({ code: 'no_session' });
  });

  it('returns guest cheques for the trial account', async () => {
    localStorage.setItem('mustawdae_cheques_v1_guest', JSON.stringify([
      { id: 'c1', type: 'incoming', status: 'pending', bankName: 'B', chequeNumber: '1', amount: 1, currency: 'JOD', dueDate: '2026-01-01', drawerName: 'D', contactType: 'other', notes: '', endorsedTo: '', createdAt: '2026-01-01T00:00:00.000Z', statusChangedAt: null },
    ]));
    const rows = await loadChequesForBackup('guest');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c1');
  });
});
