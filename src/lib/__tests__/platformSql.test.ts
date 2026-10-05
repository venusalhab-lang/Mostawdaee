import { beforeAll, describe, expect, it } from 'vitest';
import { createSqlHarness, type SqlHarness } from './sqlHarness';

const FOUNDER = '10000000-0000-4000-8000-000000000001';
const OPS = '10000000-0000-4000-8000-000000000002';
const SUPPORT = '10000000-0000-4000-8000-000000000003';
const MERCHANT = '10000000-0000-4000-8000-000000000004';
const OTHER_MERCHANT = '10000000-0000-4000-8000-000000000005';
const FAKE_FOUNDER = '10000000-0000-4000-8000-000000000006';
const CASHIER = '10000000-0000-4000-8000-000000000007';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

let h: SqlHarness;

/** Runs as the server does: PostgREST with the service-role key. */
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

const one = async (sql: string, params: unknown[] = []) => (await service<{ v: any }>(sql, params))[0]?.v;

const apply = (actor: string, action: string, target: string, status: string, trialStart: string, expiry: string) =>
  service('SELECT public.admin_apply_subscription($1, $2, $3, $4, $5, $6, $7)',
    [actor, action, target, status, trialStart, expiry, JSON.stringify({ via: 'test' })]);

const subscription = async (userId: string) =>
  (await h.admin<any>('SELECT subscription_status, trial_start_date, expiry_date FROM public.user_subscriptions WHERE user_id = $1', [userId]))[0];

const audit = () => h.admin<any>('SELECT actor_email, actor_role, action, target_email, details FROM public.admin_audit_log ORDER BY id');

beforeAll(async () => {
  h = await createSqlHarness();
  await h.addUser(FOUNDER, 'venusalhab@gmail.com');
  await h.addUser(OPS, 'ops@mostawdaee.com');
  await h.addUser(SUPPORT, 'Help@Mostawdaee.com');
  await h.addUser(MERCHANT, 'merchant@shop.com');
  await h.addUser(OTHER_MERCHANT, 'other@shop.com');
  await h.addUser(FAKE_FOUNDER, 'venusalhab@gmail.com', false);
  await h.addUser(CASHIER, 'cashier@shop.com');
  await h.admin('INSERT INTO public.profiles (id) VALUES ($1)', [MERCHANT]);
  await h.setSubscription(MERCHANT, 'active', '2099-01-01T00:00:00Z');

  await h.as(MERCHANT, `SELECT public.merchant_commit('[]'::jsonb, $1::jsonb)`, [JSON.stringify([
    { op: 'set', collection: 'settings', id: 'profile', data: { businessName: 'متجر النور' } },
  ])]);
  await h.as(MERCHANT, `SELECT public.team_invite('cashier@shop.com', 'cashier')`);
  await h.as(CASHIER, 'SELECT public.team_accept($1)', [MERCHANT]);
});

describe('platform roles', () => {
  it('the founder is the confirmed address only, and nobody else has a role yet', async () => {
    expect(await one('SELECT public.platform_role_of($1) AS v', [FOUNDER])).toBe('founder');
    expect(await one('SELECT public.platform_role_of($1) AS v', [FAKE_FOUNDER])).toBeNull();
    expect(await one('SELECT public.platform_role_of($1) AS v', [OPS])).toBeNull();
    expect((await h.as<any>(MERCHANT, 'SELECT public.platform_role() AS v'))[0].v).toBeNull();
  });

  it('only the founder adds, changes and removes staff, and every change is audited', async () => {
    await expect(service('SELECT public.admin_staff_set($1, $2, $3)', [OPS, 'ops@mostawdaee.com', 'operations']))
      .rejects.toThrow(/not platform staff/);
    await service('SELECT public.admin_staff_set($1, $2, $3)', [FOUNDER, ' OPS@mostawdaee.com ', 'operations']);
    await service('SELECT public.admin_staff_set($1, $2, $3)', [FOUNDER, 'help@mostawdaee.com', 'support']);
    expect(await one('SELECT public.platform_role_of($1) AS v', [OPS])).toBeNull();
    expect((await h.as<any>(SUPPORT, 'SELECT public.platform_role() AS v'))[0].v).toBeNull();

    const pending = '10000000-0000-4000-8000-000000000008';
    await h.addUser(pending, 'pending@mostawdaee.com', false);
    await service('SELECT public.admin_staff_set($1, $2, $3)', [FOUNDER, 'pending@mostawdaee.com', 'support']);
    await expect(service('SELECT public.admin_staff_confirm($1, $2)', [FOUNDER, 'pending@mostawdaee.com'])).rejects.toThrow(/account not confirmed/);
    expect(await one('SELECT public.platform_role_of($1) AS v', [pending])).toBeNull();
    await h.admin('UPDATE auth.users SET email_confirmed_at = NOW() WHERE id = $1', [pending]);
    await service('SELECT public.admin_staff_confirm($1, $2)', [FOUNDER, 'pending@mostawdaee.com']);
    expect(await one('SELECT public.platform_role_of($1) AS v', [pending])).toBe('support');

    await service('SELECT public.admin_staff_confirm($1, $2)', [FOUNDER, 'ops@mostawdaee.com']);
    await service('SELECT public.admin_staff_confirm($1, $2)', [FOUNDER, 'help@mostawdaee.com']);
    await service('SELECT public.admin_staff_confirm($1, $2)', [FOUNDER, 'ops@mostawdaee.com']);
    expect(await one('SELECT public.platform_role_of($1) AS v', [OPS])).toBe('operations');
    expect((await h.as<any>(SUPPORT, 'SELECT public.platform_role() AS v'))[0].v).toBe('support');
    await expect(service('SELECT public.admin_staff_confirm($1, $2)', [OPS, 'help@mostawdaee.com'])).rejects.toThrow(/role not allowed/);

    await expect(service('SELECT public.admin_staff_set($1, $2, $3)', [OPS, 'x@y.com', 'support'])).rejects.toThrow(/role not allowed/);
    await expect(service('SELECT public.admin_staff_set($1, $2, $3)', [FOUNDER, 'venusalhab@gmail.com', 'support'])).rejects.toThrow(/cannot change the founder/);
    await expect(service('SELECT public.admin_staff_set($1, $2, $3)', [FOUNDER, 'a@b.com', 'founder'])).rejects.toThrow(/invalid role/);

    await service('SELECT public.admin_staff_set($1, $2, $3)', [FOUNDER, 'temp@mostawdaee.com', 'support']);
    await service('SELECT public.admin_staff_remove($1, $2)', [FOUNDER, 'temp@mostawdaee.com']);
    await expect(service('SELECT public.admin_staff_remove($1, $2)', [FOUNDER, 'temp@mostawdaee.com'])).rejects.toThrow(/staff not found/);

    const staff = await one('SELECT public.admin_staff_list($1) AS v', [FOUNDER]);
    expect(staff.map((s: any) => [s.email, s.role, s.status, s.has_account])).toEqual([
      ['ops@mostawdaee.com', 'operations', 'active', true],
      ['help@mostawdaee.com', 'support', 'active', true],
      ['pending@mostawdaee.com', 'support', 'active', true],
    ]);
    const log = await audit();
    expect(log.map((e: any) => e.action)).toEqual([
      'staff.set', 'staff.set', 'staff.set',
      'staff.confirm', 'staff.confirm', 'staff.confirm',
      'staff.set', 'staff.remove',
    ]);
    expect(log[0]).toMatchObject({ actor_email: 'venusalhab@gmail.com', actor_role: 'founder', target_email: 'ops@mostawdaee.com' });
    expect(log.at(-1).details).toEqual({ email: 'temp@mostawdaee.com', before: 'support' });
  });
});

describe('subscription changes from the console', () => {
  it('operations can mark an account paid; the change and the before/after are audited', async () => {
    const expiry = iso(Date.now() + 30 * DAY);
    await apply(OPS, 'mark_paid', OTHER_MERCHANT, 'active', iso(Date.now()), expiry);
    expect((await subscription(OTHER_MERCHANT)).subscription_status).toBe('active');
    const entry = (await audit()).at(-1);
    expect(entry).toMatchObject({ actor_role: 'operations', action: 'subscription.mark_paid', target_email: 'other@shop.com' });
    expect(entry.details.via).toBe('test');
    expect(entry.details.before).toBeNull();
    expect(entry.details.after.status).toBe('active');
  });

  it('support may lengthen an expired account by up to 7 days, and nothing more', async () => {
    await h.setSubscription(OTHER_MERCHANT, 'expired', '2000-01-01T00:00:00Z');
    const end = Date.now() + 7 * DAY;
    const trialStart = iso(end - 25 * DAY);

    await expect(apply(SUPPORT, 'mark_paid', OTHER_MERCHANT, 'active', trialStart, iso(end))).rejects.toThrow(/role not allowed/);
    await expect(apply(SUPPORT, 'extend', OTHER_MERCHANT, 'active', trialStart, iso(end))).rejects.toThrow(/role not allowed/);
    await expect(apply(SUPPORT, 'expire', OTHER_MERCHANT, 'expired', trialStart, iso(Date.now()))).rejects.toThrow(/role not allowed/);
    await expect(apply(SUPPORT, 'extend', OTHER_MERCHANT, 'trial', iso(end + DAY - 25 * DAY), iso(end + DAY))).rejects.toThrow(/role not allowed/);

    await apply(SUPPORT, 'extend', OTHER_MERCHANT, 'trial', trialStart, iso(end));
    expect((await subscription(OTHER_MERCHANT)).subscription_status).toBe('trial');
    expect((await audit()).at(-1)).toMatchObject({ actor_email: 'help@mostawdaee.com', actor_role: 'support', action: 'subscription.extend' });
  });

  it('support cannot shorten an account or touch a paid one beyond 7 days', async () => {
    const short = Date.now() + 2 * DAY;
    await expect(apply(SUPPORT, 'extend', OTHER_MERCHANT, 'trial', iso(short - 25 * DAY), iso(short))).rejects.toThrow(/role not allowed/);
    // MERCHANT is paid until 2099.
    await expect(apply(SUPPORT, 'extend', MERCHANT, 'active', iso(Date.now()), iso(Date.now() + 7 * DAY))).rejects.toThrow(/role not allowed/);
    expect((await subscription(MERCHANT)).expiry_date.toISOString()).toBe('2099-01-01T00:00:00.000Z');
  });

  it('keeps a support grace visible to the founder until they acknowledge it', async () => {
    const notices = await one('SELECT public.admin_open_notices($1) AS v', [FOUNDER]);
    const grace = notices.find((n: any) => n.action === 'subscription.extend' && n.actor_email === 'help@mostawdaee.com');
    expect(grace?.target_email).toBe('other@shop.com');
    expect(notices.every((n: any) => n.actor_email === 'help@mostawdaee.com')).toBe(true);
    await expect(service('SELECT public.admin_open_notices($1)', [OPS])).rejects.toThrow(/role not allowed/);
    await expect(service('SELECT public.admin_open_notices($1)', [SUPPORT])).rejects.toThrow(/role not allowed/);
    await expect(service('SELECT public.admin_notice_ack($1, $2)', [OPS, grace.id])).rejects.toThrow(/role not allowed/);
    await expect(service('SELECT public.admin_notice_ack($1, $2)', [FOUNDER, 999999])).rejects.toThrow(/notice not found/);
    await service('SELECT public.admin_notice_ack($1, $2)', [FOUNDER, grace.id]);
    await service('SELECT public.admin_notice_ack($1, $2)', [FOUNDER, grace.id]);
    const left = await one('SELECT public.admin_open_notices($1) AS v', [FOUNDER]);
    expect(left.find((n: any) => n.id === grace.id)).toBeUndefined();
    expect((await h.admin<any>('SELECT action FROM public.admin_audit_log WHERE id = $1', [grace.id]))[0].action).toBe('subscription.extend');
  });

  it('keeps profiles.is_premium in step and refuses non-staff and unknown accounts', async () => {
    const expiry = iso(Date.now() + 365 * DAY);
    await apply(FOUNDER, 'set_expiry', MERCHANT, 'active', iso(Date.now()), expiry);
    expect((await h.admin<any>('SELECT is_premium FROM public.profiles WHERE id = $1', [MERCHANT]))[0].is_premium).toBe(true);
    await apply(FOUNDER, 'expire', MERCHANT, 'expired', iso(Date.now()), iso(Date.now()));
    expect((await h.admin<any>('SELECT is_premium, subscription_status FROM public.profiles WHERE id = $1', [MERCHANT]))[0])
      .toEqual({ is_premium: false, subscription_status: 'expired' });
    await apply(FOUNDER, 'mark_paid', MERCHANT, 'active', iso(Date.now()), iso(Date.now() + 30 * DAY));

    await expect(apply(MERCHANT, 'mark_paid', MERCHANT, 'active', iso(Date.now()), expiry)).rejects.toThrow(/not platform staff/);
    await expect(apply(FAKE_FOUNDER, 'mark_paid', MERCHANT, 'active', iso(Date.now()), expiry)).rejects.toThrow(/not platform staff/);
    await expect(apply(FOUNDER, 'mark_paid', '10000000-0000-4000-8000-0000000000ff', 'active', iso(Date.now()), expiry))
      .rejects.toThrow(/account not found/);
  });
});

describe('audit log', () => {
  it('is append-only, even for the database owner', async () => {
    await expect(h.admin('UPDATE public.admin_audit_log SET action = $1', ['x'])).rejects.toThrow(/append-only/);
    await expect(h.admin('DELETE FROM public.admin_audit_log')).rejects.toThrow(/append-only/);
    await expect(h.admin('TRUNCATE public.admin_audit_log')).rejects.toThrow(/append-only/);
  });

  it('only the founder reads it, newest first', async () => {
    const entries = await one('SELECT public.admin_audit_list($1, 2) AS v', [FOUNDER]);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBeGreaterThan(entries[1].id);
    await expect(service('SELECT public.admin_audit_list($1, 10)', [OPS])).rejects.toThrow(/role not allowed/);
    await expect(service('SELECT public.admin_audit_list($1, 10)', [SUPPORT])).rejects.toThrow(/role not allowed/);
  });
});

describe('AI usage summary', () => {
  it('reports questions per store to staff', async () => {
    await service('SELECT public.claim_ai_request($1, 20)', [MERCHANT]);
    await service('SELECT public.claim_ai_request($1, 20)', [MERCHANT]);
    const usage = await one('SELECT public.admin_ai_usage($1, 30) AS v', [SUPPORT]);
    const row = usage.find((u: any) => u.owner_id === MERCHANT);
    expect(row).toMatchObject({ today: 2, period: 2 });
    await expect(service('SELECT public.admin_ai_usage($1, 30)', [MERCHANT])).rejects.toThrow(/not platform staff/);
  });
});

describe('support tickets', () => {
  let ticket: string;

  it('a merchant opens a ticket and sees it; another merchant cannot', async () => {
    ticket = (await h.as<any>(MERCHANT, `SELECT public.support_open('problem', '  الطابعة لا تطبع  ', 'جربت إعادة التشغيل') AS v`))[0].v;
    const mine = (await h.as<any>(MERCHANT, 'SELECT public.support_my_tickets() AS v'))[0].v;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ subject: 'الطابعة لا تطبع', status: 'open', category: 'problem' });
    expect((await h.as<any>(OTHER_MERCHANT, 'SELECT public.support_my_tickets() AS v'))[0].v).toEqual([]);
    await expect(h.as(OTHER_MERCHANT, 'SELECT public.support_thread($1)', [ticket])).rejects.toThrow(/ticket not found/);
    await expect(h.as(OTHER_MERCHANT, `SELECT public.support_reply($1, 'hi')`, [ticket])).rejects.toThrow(/ticket not found/);
  });

  it('staff see the store name and subscription, reply, and the merchant sees the team, not the staff address', async () => {
    const inbox = await one(`SELECT public.support_staff_list($1, 'open') AS v`, [SUPPORT]);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ author_email: 'merchant@shop.com', store_name: 'متجر النور', store_subscription: 'active', messages: 1 });

    await service('SELECT public.support_staff_reply($1, $2, $3, false)', [SUPPORT, ticket, 'من الإعدادات > الطابعة']);
    const thread = (await h.as<any>(MERCHANT, 'SELECT public.support_thread($1) AS v', [ticket]))[0].v;
    expect(thread.ticket.status).toBe('answered');
    expect(thread.messages.map((m: any) => m.from_staff)).toEqual([false, true]);
    expect(thread.messages[1]).not.toHaveProperty('staff_email');

    const staffThread = await one('SELECT public.support_staff_thread($1, $2) AS v', [OPS, ticket]);
    expect(staffThread.messages[1].staff_email).toBe('help@mostawdaee.com');
    expect(staffThread.ticket.assigned_email).toBe('help@mostawdaee.com');
  });

  it('a merchant reply reopens the ticket; closing works for both sides', async () => {
    await h.as(MERCHANT, `SELECT public.support_reply($1, 'ما زالت لا تعمل')`, [ticket]);
    expect((await one(`SELECT public.support_staff_list($1, 'open') AS v`, [OPS]))).toHaveLength(1);
    await service(`SELECT public.support_staff_set_status($1, $2, 'closed')`, [OPS, ticket]);
    expect((await one(`SELECT public.support_staff_list($1, 'open') AS v`, [OPS]))).toEqual([]);
    await h.as(MERCHANT, `SELECT public.support_reply($1, 'عادت المشكلة')`, [ticket]);
    await h.as(MERCHANT, 'SELECT public.support_close($1)', [ticket]);
    expect((await h.as<any>(MERCHANT, 'SELECT public.support_thread($1) AS v', [ticket]))[0].v.ticket.status).toBe('closed');
  });

  it('a store member writes as themselves, filed under the store', async () => {
    const id = (await h.as<any>(CASHIER, `SELECT public.support_open('question', 'كيف أطبع فاتورة؟', 'من نقطة البيع') AS v`))[0].v;
    const staffThread = await one('SELECT public.support_staff_thread($1, $2) AS v', [SUPPORT, id]);
    expect(staffThread.ticket).toMatchObject({ author_email: 'cashier@shop.com', store_owner_email: 'merchant@shop.com', store_name: 'متجر النور' });
    expect((await h.as<any>(MERCHANT, 'SELECT public.support_my_tickets() AS v'))[0].v).toHaveLength(1);
  });

  it('rejects empty, oversized and runaway input', async () => {
    await expect(h.as(OTHER_MERCHANT, `SELECT public.support_open('question', 'ab', 'x')`)).rejects.toThrow(/invalid subject/);
    await expect(h.as(OTHER_MERCHANT, `SELECT public.support_open('question', 'subject', '   ')`)).rejects.toThrow(/invalid message/);
    await expect(h.as(OTHER_MERCHANT, `SELECT public.support_open('spam', 'subject', 'x')`)).rejects.toThrow(/invalid category/);
    await expect(h.as(OTHER_MERCHANT, 'SELECT public.support_open($1, $2, $3)', ['question', 'subject', 'x'.repeat(4001)]))
      .rejects.toThrow(/invalid message/);
    for (let i = 0; i < 5; i += 1) {
      await h.as(OTHER_MERCHANT, 'SELECT public.support_open($1, $2, $3)', ['question', `سؤال ${i}`, 'نص']);
    }
    await expect(h.as(OTHER_MERCHANT, 'SELECT public.support_open($1, $2, $3)', ['question', 'سؤال 6', 'نص']))
      .rejects.toThrow(/too many open tickets/);
  });

  it('non-staff cannot use the staff side', async () => {
    await expect(service(`SELECT public.support_staff_list($1, 'all')`, [MERCHANT])).rejects.toThrow(/not platform staff/);
    await expect(service('SELECT public.support_staff_reply($1, $2, $3, false)', [MERCHANT, ticket, 'x'])).rejects.toThrow(/not platform staff/);
  });
});

describe('browser sessions', () => {
  it('cannot reach any console function or platform table', async () => {
    const calls = [
      ['SELECT public.platform_role_of($1)', [FOUNDER]],
      ['SELECT public.admin_staff_set($1, $2, $3)', [FOUNDER, 'me@x.com', 'operations']],
      ['SELECT public.admin_apply_subscription($1, $2, $3, $4, $5, $6, $7)', [FOUNDER, 'mark_paid', MERCHANT, 'active', iso(Date.now()), iso(Date.now() + DAY), '{}']],
      ['SELECT public.admin_audit_list($1, 10)', [FOUNDER]],
      ['SELECT public.admin_ai_usage($1, 30)', [FOUNDER]],
      [`SELECT public.support_staff_list($1, 'all')`, [FOUNDER]],
      ['SELECT * FROM public.platform_staff', []],
      ['SELECT * FROM public.admin_audit_log', []],
      ['SELECT * FROM public.support_tickets', []],
      ['SELECT * FROM public.support_messages', []],
    ] as const;
    for (const [sql, params] of calls) {
      await expect(h.as(FOUNDER, sql, [...params])).rejects.toThrow(/permission denied/);
    }
  });

  it('re-running the setup keeps staff, tickets and the audit log', async () => {
    const { readFileSync } = await import('node:fs');
    const { SQL_FILES } = await import('./sqlHarness');
    const before = (await audit()).length;
    for (const file of SQL_FILES) await h.db.exec(readFileSync(file, 'utf8'));
    expect(await one('SELECT public.platform_role_of($1) AS v', [SUPPORT])).toBe('support');
    expect((await audit()).length).toBe(before);
    expect((await h.as<any>(MERCHANT, 'SELECT public.support_my_tickets() AS v'))[0].v).toHaveLength(1);
  });
});
