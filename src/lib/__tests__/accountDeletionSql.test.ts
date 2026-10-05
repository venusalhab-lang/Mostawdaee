import { beforeAll, describe, expect, it } from 'vitest';
import { createSqlHarness, type SqlHarness } from './sqlHarness';

const FOUNDER = '20000000-0000-4000-8000-000000000001';
const OWNER = '20000000-0000-4000-8000-000000000002';
const MANAGER = '20000000-0000-4000-8000-000000000003';
const STAFF = '20000000-0000-4000-8000-000000000004';
const NEW_OWNER = '20000000-0000-4000-8000-000000000005';
const FRESH = '20000000-0000-4000-8000-000000000006';

let h: SqlHarness;

async function service<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  await h.db.exec('BEGIN');
  try {
    await h.db.query(`SELECT set_config('request.jwt.claim.role', 'service_role', true)`);
    await h.db.exec('SET LOCAL ROLE service_role');
    const rows = (await h.db.query<T>(sql, params)).rows;
    await h.db.exec('COMMIT');
    return rows;
  } catch (error) {
    await h.db.exec('ROLLBACK');
    throw error;
  }
}

/** What the server does: prepare with the service role, then delete the auth user. */
const deleteAccount = async (uid: string) => {
  await service('SELECT public.account_delete_prepare($1)', [uid]);
  await h.admin('DELETE FROM auth.users WHERE id = $1', [uid]);
};

const count = async (sql: string, params: unknown[]) => Number((await h.admin<{ n: number }>(sql, params))[0].n);

beforeAll(async () => {
  h = await createSqlHarness();
  // Supabase grants table privileges to the API roles by default; row-level security does the rest.
  await h.admin('GRANT SELECT, INSERT ON public.user_subscriptions TO authenticated');
  await h.admin('GRANT USAGE ON SEQUENCE public.user_subscriptions_id_seq TO authenticated');

  await h.addUser(FOUNDER, 'venusalhab@gmail.com');
  await h.addUser(OWNER, 'owner@shop.com');
  await h.addUser(MANAGER, 'manager@shop.com');
  await h.addUser(STAFF, 'help@mostawdaee.com');
  await h.setSubscription(OWNER, 'trial', '2099-01-01T00:00:00Z');
  await h.db.exec('BEGIN');
  await h.db.query(`SELECT set_config('request.jwt.claim.role', 'service_role', true)`);
  await h.db.query(`UPDATE public.user_subscriptions SET trial_start_date = NOW() - INTERVAL '3 days' WHERE user_id = $1`, [OWNER]);
  await h.db.exec('COMMIT');

  await h.as(OWNER, `SELECT public.merchant_commit('[]'::jsonb, $1::jsonb)`, [JSON.stringify([
    { op: 'set', collection: 'settings', id: 'profile', data: { businessName: 'Shop' } },
    { op: 'set', collection: 'inventory', id: 'p1', data: { name: 'Rice', quantity: 3 } },
  ])]);
  await h.as(OWNER, `SELECT public.team_invite('manager@shop.com', 'manager')`);
  await h.as(MANAGER, 'SELECT public.team_accept($1)', [OWNER]);
  await h.as(MANAGER, `INSERT INTO public.inventory_audits (user_id, audit_number) VALUES ($1, 'A-1')`, [OWNER]);

  await service('SELECT public.admin_staff_set($1, $2, $3)', [FOUNDER, 'help@mostawdaee.com', 'support']);
  await service('SELECT public.admin_staff_confirm($1, $2)', [FOUNDER, 'help@mostawdaee.com']);
});

describe('account deletion', () => {
  it('is only prepared by the server, and never for the founder', async () => {
    await expect(h.as(OWNER, 'SELECT public.account_delete_prepare($1)', [OWNER])).rejects.toThrow(/permission denied/);
    await expect(service('SELECT public.account_delete_prepare($1)', [FOUNDER])).rejects.toThrow(/cannot delete the founder/);
    await expect(service('SELECT public.account_delete_prepare($1)', ['20000000-0000-4000-8000-0000000000ff'])).rejects.toThrow(/account not found/);
  });

  it('a manager leaves the store; the store keeps its stocktake', async () => {
    await deleteAccount(MANAGER);
    expect(await count('SELECT count(*) AS n FROM public.workspace_members WHERE email = $1', ['manager@shop.com'])).toBe(0);
    const [audit] = await h.admin<any>('SELECT created_by FROM public.inventory_audits WHERE user_id = $1', [OWNER]);
    expect(audit.created_by).toBeNull();
    expect(await count('SELECT count(*) AS n FROM public.merchant_documents WHERE user_id = $1', [OWNER])).toBe(2);
  });

  it('a staff member loses the platform role and the deletion is audited', async () => {
    await deleteAccount(STAFF);
    expect(await count('SELECT count(*) AS n FROM public.platform_staff WHERE email = $1', ['help@mostawdaee.com'])).toBe(0);
    const actions = (await h.admin<any>('SELECT action FROM public.admin_audit_log ORDER BY id')).map((r) => r.action);
    expect(actions.at(-1)).toBe('staff.account_deleted');
  });

  it('an owner takes the whole store with them', async () => {
    await deleteAccount(OWNER);
    expect(await count('SELECT count(*) AS n FROM public.merchant_documents WHERE user_id = $1', [OWNER])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.user_subscriptions WHERE user_id = $1', [OWNER])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.inventory_audits WHERE user_id = $1', [OWNER])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.workspace_members WHERE owner_id = $1', [OWNER])).toBe(0);
    const [kept] = await h.admin<any>('SELECT email_hash FROM public.used_trials');
    expect(kept.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await h.admin('SELECT * FROM public.used_trials'))).not.toContain('owner@shop.com');
  });

  it('signing up again with the same email continues the old trial instead of starting a new one', async () => {
    await h.addUser(NEW_OWNER, ' Owner@Shop.com ');
    await h.addUser(FRESH, 'fresh@shop.com');
    await h.as(NEW_OWNER, 'INSERT INTO public.user_subscriptions (user_id) VALUES ($1)', [NEW_OWNER]);
    await h.as(FRESH, 'INSERT INTO public.user_subscriptions (user_id) VALUES ($1)', [FRESH]);

    const [again] = await h.admin<any>(
      `SELECT EXTRACT(EPOCH FROM NOW() - trial_start_date) / 86400 AS days_ago,
              EXTRACT(EPOCH FROM expiry_date - trial_start_date) / 86400 AS length
         FROM public.user_subscriptions WHERE user_id = $1`, [NEW_OWNER]);
    expect(Math.round(Number(again.days_ago))).toBe(3);
    expect(Math.round(Number(again.length))).toBe(25);

    const [fresh] = await h.admin<any>(
      'SELECT EXTRACT(EPOCH FROM NOW() - trial_start_date) AS seconds_ago FROM public.user_subscriptions WHERE user_id = $1', [FRESH]);
    expect(Number(fresh.seconds_ago)).toBeLessThan(60);
  });

  it('nobody can look up another account in the used-trial list', async () => {
    const rows = await h.as<any>(FRESH, 'SELECT public.prior_trial_start($1) AS v', [NEW_OWNER]);
    expect(rows[0].v).toBeNull();
    await expect(h.as(FRESH, 'SELECT * FROM public.used_trials')).rejects.toThrow(/permission denied/);
  });
});
