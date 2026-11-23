import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqlHarness, type SqlHarness } from './sqlHarness';

const OWNER = '11111111-1111-4111-8111-111111111111';
const MANAGER = '22222222-2222-4222-8222-222222222222';
const FUTURE = '2099-01-01T00:00:00Z';

const set = (collection: string, id: string, data: Record<string, unknown>, merge = false) => ({
  op: 'set', collection, id, data, merge,
});

describe('money floors and restore lock', () => {
  let h: SqlHarness;

  const commit = (uid: string, ops: unknown[], mode = 'live') =>
    h.as(uid, 'SELECT public.merchant_commit($1::jsonb, $2::jsonb, $3::text)', [
      '[]',
      JSON.stringify(ops),
      mode,
    ]);

  beforeAll(async () => {
    h = await createSqlHarness();
    await h.addUser(OWNER, 'owner-floors@shop.com');
    await h.addUser(MANAGER, 'manager-floors@shop.com');
    await h.setSubscription(OWNER, 'active', FUTURE);

    await commit(OWNER, [
      set('settings', 'profile', { businessName: 'Floor Shop', currency: 'JOD' }),
      set('settings', 'vault', {
        currentBalance: 100, balanceJOD: 100, lastUpdated: Date.now(),
      }),
      set('inventory', 'p1', { id: 'p1', name: 'Tea', quantity: 10, sellingPrice: 1, currency: 'JOD', status: 'in_stock' }),
    ]);

    await h.as(OWNER, `SELECT public.team_invite('manager-floors@shop.com', 'manager')`);
    await h.as(MANAGER, `SELECT public.team_accept($1)`, [OWNER]);
  }, 120_000);

  afterAll(async () => {
    await h?.db?.close?.();
  });

  it('refuses negative inventory quantity for the owner', async () => {
    await expect(commit(OWNER, [
      set('inventory', 'p1', { id: 'p1', name: 'Tea', quantity: -1, sellingPrice: 1, currency: 'JOD', status: 'in_stock' }),
    ])).rejects.toThrow(/negative stock/i);
  });

  it('refuses negative vault balances for the owner', async () => {
    await expect(commit(OWNER, [
      set('settings', 'vault', {
        currentBalance: -5, balanceJOD: -5, lastUpdated: Date.now(),
      }, true),
    ])).rejects.toThrow(/vault overdrawn/i);
  });

  it('allows zero stock and zero vault', async () => {
    await commit(OWNER, [
      set('inventory', 'p1', { id: 'p1', name: 'Tea', quantity: 0, sellingPrice: 1, currency: 'JOD', status: 'in_stock' }),
      set('settings', 'vault', {
        currentBalance: 0, balanceJOD: 0, lastUpdated: Date.now(),
      }, true),
    ]);
  });

  it('blocks live writes while restore is incomplete and allows owner restore mode', async () => {
    await h.as(OWNER, `SELECT public.begin_store_restore('merge')`);
    const locked = (await h.as<{ j: any }>(OWNER, 'SELECT public.store_restore_incomplete() AS j'))[0].j;
    expect(locked.mode).toBe('merge');

    await expect(commit(OWNER, [
      set('inventory', 'p1', { id: 'p1', name: 'Tea', quantity: 3, sellingPrice: 1, currency: 'JOD', status: 'in_stock' }),
    ], 'live')).rejects.toThrow(/restore incomplete/i);

    await commit(OWNER, [
      set('inventory', 'p1', { id: 'p1', name: 'Tea', quantity: 3, sellingPrice: 1, currency: 'JOD', status: 'in_stock' }),
    ], 'restore');

    await expect(commit(MANAGER, [
      set('inventory', 'p1', { id: 'p1', name: 'Tea', quantity: 4, sellingPrice: 1, currency: 'JOD', status: 'in_stock' }),
    ], 'restore')).rejects.toThrow(/role not allowed/i);

    await h.as(OWNER, `SELECT public.clear_store_restore()`);
    expect((await h.as<{ j: any }>(OWNER, 'SELECT public.store_restore_incomplete() AS j'))[0].j).toBeNull();

    await commit(OWNER, [
      set('inventory', 'p1', { id: 'p1', name: 'Tea', quantity: 5, sellingPrice: 1, currency: 'JOD', status: 'in_stock' }),
    ], 'live');
  });
});
