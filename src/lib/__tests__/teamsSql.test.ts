import { beforeAll, describe, expect, it } from 'vitest';
import { createSqlHarness, type SqlHarness } from './sqlHarness';

const OWNER = '00000000-0000-4000-8000-000000000001';
const MANAGER = '00000000-0000-4000-8000-000000000002';
const CASHIER = '00000000-0000-4000-8000-000000000003';
const STRANGER = '00000000-0000-4000-8000-000000000004';
const UNCONFIRMED = '00000000-0000-4000-8000-000000000005';
const OTHER_OWNER = '00000000-0000-4000-8000-000000000006';

const FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';

type Op = { op: 'set' | 'delete'; collection: string; id: string; data?: Record<string, unknown>; merge?: boolean };

let h: SqlHarness;

const commit = (uid: string, ops: Op[]) =>
  h.as(uid, 'SELECT public.merchant_commit($1::jsonb, $2::jsonb)', ['[]', JSON.stringify(ops)]);

const read = async (uid: string, collection: string) =>
  (await h.as<{ doc_id: string; data: any }>(uid,
    'SELECT doc_id, data FROM public.merchant_documents WHERE collection = $1 ORDER BY doc_id', [collection]));

const stored = async (collection: string, id: string) =>
  (await h.admin<{ data: any }>(
    'SELECT data FROM public.merchant_documents WHERE user_id = $1 AND collection = $2 AND doc_id = $3',
    [OWNER, collection, id]))[0]?.data;

const context = async (uid: string) =>
  (await h.as<{ c: any }>(uid, 'SELECT public.team_context() AS c'))[0].c;

const set = (collection: string, id: string, data: Record<string, unknown>, merge = false): Op =>
  ({ op: 'set', collection, id, data, merge });

/** What one cash sale of 2 units writes, the same shape src/components/FirebaseProvider.tsx commits. */
const cashSale = (n: number): Op[] => [
  set('invoice_numbers', `S-${n}`, { invoiceId: `inv${n}` }),
  set('inventory', 'p1', { quantity: 10 - 2 * n, status: 'in_stock' }, true),
  set('settings', 'vault', { balanceAED: 100 + 50 * n, balanceJOD: 0, currentBalance: 0, lastUpdated: n }, true),
  set('vault_records', `inv-inv${n}`, { type: 'income', amount: 50, currency: 'AED' }),
  set('invoices', `inv${n}`, { type: 'sale', totalAmount: 50, currency: 'AED', paymentMethod: 'cash', items: [{ productId: 'p1', quantity: 2 }] }),
  set('audit_logs', `log${n}`, { action: 'sale' }),
];

beforeAll(async () => {
  h = await createSqlHarness();
  await h.addUser(OWNER, 'owner@shop.com');
  await h.addUser(MANAGER, 'manager@shop.com');
  await h.addUser(CASHIER, 'Cashier@Shop.com');
  await h.addUser(STRANGER, 'stranger@else.com');
  await h.addUser(UNCONFIRMED, 'late@shop.com', false);
  await h.addUser(OTHER_OWNER, 'other@store.com');
  await h.setSubscription(OWNER, 'active', FUTURE);
  await h.setSubscription(OTHER_OWNER, 'active', FUTURE);

  await commit(OWNER, [
    set('settings', 'profile', { businessName: 'متجر الأمل', currency: 'AED' }),
    set('settings', 'vault', { balanceAED: 100, balanceJOD: 0, currentBalance: 0, lastUpdated: 0 }),
    set('inventory', 'p1', { name: 'Tea', quantity: 10, sellingPrice: 25, unitCost: 15, status: 'in_stock' }),
    set('customers', 'c1', { name: 'Ali', totalDebt: 20, currency: 'AED' }),
    set('employees', 'e1', { name: 'Sara', salary: 3000 }),
    set('payroll', 'e1_2026-10', { amount: 3000 }),
    set('invoices', 'old1', { type: 'sale', totalAmount: 5, currency: 'AED' }),
  ]);
}, 60_000);

describe('invitations', () => {
  it('only the owner invites, and an address is normalised', async () => {
    await h.as(OWNER, `SELECT public.team_invite('manager@shop.com', 'manager')`);
    await h.as(OWNER, `SELECT public.team_invite('  CASHIER@shop.com ', 'cashier')`);
    await h.as(OWNER, `SELECT public.team_invite('late@shop.com', 'cashier')`);
    const list = (await h.as<{ l: any[] }>(OWNER, 'SELECT public.team_list() AS l'))[0].l;
    expect(list.map((m) => [m.email, m.role, m.status])).toEqual([
      ['manager@shop.com', 'manager', 'invited'],
      ['cashier@shop.com', 'cashier', 'invited'],
      ['late@shop.com', 'cashier', 'invited'],
    ]);
  });

  it('rejects bad roles, bad addresses and self-invites', async () => {
    await expect(h.as(OWNER, `SELECT public.team_invite('x@shop.com', 'owner')`)).rejects.toThrow(/invalid role/);
    await expect(h.as(OWNER, `SELECT public.team_invite('not-an-email', 'cashier')`)).rejects.toThrow(/invalid email/);
    await expect(h.as(OWNER, `SELECT public.team_invite('OWNER@shop.com', 'cashier')`)).rejects.toThrow(/yourself/);
  });

  it('an invitation gives no access until it is accepted', async () => {
    const ctx = await context(MANAGER);
    expect(ctx.role).toBe('owner');
    expect(ctx.owner_id).toBe(MANAGER);
    expect(ctx.invites).toEqual([{ owner_id: OWNER, role: 'manager', store_name: 'متجر الأمل', owner_email: 'owner@shop.com' }]);
    expect(await read(MANAGER, 'inventory')).toEqual([]);
  });

  it('nobody can claim an invitation sent to another or an unconfirmed address', async () => {
    await expect(h.as(STRANGER, 'SELECT public.team_accept($1)', [OWNER])).rejects.toThrow(/invitation not found/);
    await expect(h.as(UNCONFIRMED, 'SELECT public.team_accept($1)', [OWNER])).rejects.toThrow(/email not confirmed/);
  });

  it('accepting moves the member into the owner store with its role and subscription', async () => {
    await h.as(MANAGER, 'SELECT public.team_accept($1)', [OWNER]);
    await h.as(CASHIER, 'SELECT public.team_accept($1)', [OWNER]);
    const ctx = await context(CASHIER);
    expect(ctx.role).toBe('cashier');
    expect(ctx.owner_id).toBe(OWNER);
    expect(ctx.store_name).toBe('متجر الأمل');
    expect(ctx.has_access).toBe(true);
    expect(ctx.subscription.subscription_status).toBe('active');
  });

  it('a member cannot invite or list the team, and cannot join a second store', async () => {
    await expect(h.as(MANAGER, `SELECT public.team_invite('x@shop.com', 'cashier')`)).rejects.toThrow(/role not allowed/);
    await expect(h.as(CASHIER, 'SELECT public.team_list()')).rejects.toThrow(/role not allowed/);
    await h.as(OTHER_OWNER, `SELECT public.team_invite('manager@shop.com', 'cashier')`);
    await expect(h.as(MANAGER, 'SELECT public.team_accept($1)', [OTHER_OWNER])).rejects.toThrow(/already in a store/);
  });

  it('an owner with staff cannot join another store', async () => {
    await h.as(OTHER_OWNER, `SELECT public.team_invite('owner@shop.com', 'cashier')`);
    await expect(h.as(OWNER, 'SELECT public.team_accept($1)', [OTHER_OWNER])).rejects.toThrow(/has own team/);
  });

  it('the team table is not readable or writable directly', async () => {
    await expect(h.as(STRANGER, 'SELECT * FROM public.workspace_members')).rejects.toThrow(/permission denied/);
    await expect(h.as(CASHIER, `UPDATE public.workspace_members SET role = 'manager'`)).rejects.toThrow(/permission denied/);
  });
});

describe('reading the store', () => {
  it('strangers see nothing of the store', async () => {
    expect(await read(STRANGER, 'inventory')).toEqual([]);
    expect(await read(STRANGER, 'settings')).toEqual([]);
  });

  it('managers see the books but not salaries', async () => {
    expect((await read(MANAGER, 'inventory')).map((r) => r.doc_id)).toEqual(['p1']);
    expect(await read(MANAGER, 'employees')).toEqual([]);
    expect(await read(MANAGER, 'payroll')).toEqual([]);
  });

  it('cashiers do not see salaries, the vault history or the activity log', async () => {
    await commit(OWNER, [set('vault_records', 'v0', { type: 'expense' }), set('audit_logs', 'l0', { action: 'x' })]);
    expect(await read(CASHIER, 'employees')).toEqual([]);
    expect(await read(CASHIER, 'vault_records')).toEqual([]);
    expect(await read(CASHIER, 'audit_logs')).toEqual([]);
    expect((await read(CASHIER, 'inventory')).length).toBe(1);
  });

  it('the owner still sees everything', async () => {
    expect((await read(OWNER, 'employees')).length).toBe(1);
    expect((await read(OWNER, 'vault_records')).length).toBe(1);
  });

  it('managers do not see salaries through the vault history or the activity log either', async () => {
    await commit(OWNER, [
      set('vault_records', 'pay1', { type: 'expense', category: 'salary', source: 'payroll', amount: 3000, description: 'Salary: Sara' }),
      set('vault_records', 'payback1', { type: 'income', category: 'salary', source: 'reversal', amount: 3000 }),
      set('vault_records', 'rent1', { type: 'expense', category: 'other', source: 'expense', amount: 500 }),
      set('audit_logs', 'paylog1', { action: 'pay', category: 'payroll', details: 'Sara 3000' }),
      set('audit_logs', 'emplog1', { action: 'add', category: 'employee', details: 'Sara salary 3000' }),
      set('audit_logs', 'salelog1', { action: 'sale', category: 'invoice' }),
    ]);
    const vault = (await read(MANAGER, 'vault_records')).map((r) => r.doc_id);
    expect(vault).toContain('rent1');
    expect(vault).not.toContain('pay1');
    expect(vault).not.toContain('payback1');
    const logs = (await read(MANAGER, 'audit_logs')).map((r) => r.doc_id);
    expect(logs).toContain('salelog1');
    expect(logs).not.toContain('paylog1');
    expect(logs).not.toContain('emplog1');
    const ownerVault = (await read(OWNER, 'vault_records')).map((r) => r.doc_id);
    expect(ownerVault).toEqual(expect.arrayContaining(['pay1', 'payback1', 'rent1']));
    expect((await read(OWNER, 'audit_logs')).map((r) => r.doc_id)).toEqual(expect.arrayContaining(['paylog1', 'emplog1']));
  });
});

describe('cashier writes', () => {
  it('a full cash sale goes through and is stamped with the cashier', async () => {
    await commit(CASHIER, cashSale(1));
    expect((await stored('inventory', 'p1')).quantity).toBe(8);
    expect((await stored('inventory', 'p1')).sellingPrice).toBe(25);
    expect((await stored('settings', 'vault')).balanceAED).toBe(150);
    expect((await stored('invoices', 'inv1')).actorId).toBe(CASHIER);
    expect((await stored('vault_records', 'inv-inv1')).actorId).toBe(CASHIER);
  });

  it('a credit sale raises the customer debt', async () => {
    await commit(CASHIER, [
      set('customers', 'c1', { totalDebt: 70 }, true),
      set('customer_transactions', 'inv-inv9', { type: 'invoice', amount: 50 }),
      set('invoices', 'inv9', { type: 'sale', paymentMethod: 'credit', customerId: 'c1', totalAmount: 50, items: [] }),
    ]);
    expect((await stored('customers', 'c1')).totalDebt).toBe(70);
  });

  it('cannot lower stock beyond what the sale invoice sold', async () => {
    const before = (await stored('inventory', 'p1')).quantity;
    await expect(commit(CASHIER, [
      set('inventory', 'p1', { quantity: before - 5 }, true),
      set('invoices', 'inv-short', { type: 'sale', totalAmount: 25, paymentMethod: 'cash', items: [{ productId: 'p1', quantity: 1 }] }),
    ])).rejects.toThrow(/role not allowed/);
    await expect(commit(CASHIER, [set('inventory', 'p1', { quantity: before - 1 }, true)])).rejects.toThrow(/role not allowed/);
    expect((await stored('inventory', 'p1')).quantity).toBe(before);
  });

  it('a sale by the pack lowers stock by pack size, and only by the stored pack size', async () => {
    await commit(OWNER, [set('inventory', 'box1', { name: 'Juice', quantity: 200, packSize: 20, packName: 'صندوق', status: 'in_stock' })]);
    const boxSale = (id: string, packSize: number, left: number): Op[] => [
      set('inventory', 'box1', { quantity: left }, true),
      set('invoices', id, { type: 'sale', totalAmount: 30, currency: 'AED', paymentMethod: 'cash', items: [{ productId: 'box1', quantity: 2, packSize }] }),
    ];
    await expect(commit(CASHIER, boxSale('inv-box-forged', 50, 100))).rejects.toThrow(/role not allowed/);
    await commit(CASHIER, boxSale('inv-box', 20, 160));
    expect((await stored('inventory', 'box1')).quantity).toBe(160);
    await expect(commit(CASHIER, boxSale('inv-box-more', 20, 100))).rejects.toThrow(/role not allowed/);
  });

  it('cannot raise a debt beyond the credit sale, or without one', async () => {
    const debt = (await stored('customers', 'c1')).totalDebt;
    await expect(commit(CASHIER, [
      set('customers', 'c1', { totalDebt: debt + 500 }, true),
      set('invoices', 'inv-big', { type: 'sale', paymentMethod: 'credit', customerId: 'c1', totalAmount: 5, items: [] }),
    ])).rejects.toThrow(/role not allowed/);
    await expect(commit(CASHIER, [set('customers', 'c1', { totalDebt: debt + 1 }, true)])).rejects.toThrow(/role not allowed/);
    expect((await stored('customers', 'c1')).totalDebt).toBe(debt);
  });

  it('a credit sale in another currency uses the converted debt amount', async () => {
    const debt = (await stored('customers', 'c1')).totalDebt;
    await commit(CASHIER, [
      set('customers', 'c1', { totalDebt: debt + 36.7 }, true),
      set('invoices', 'inv-usd', { type: 'sale', paymentMethod: 'credit', customerId: 'c1', totalAmount: 10, currency: 'USD', debtAmount: 36.7, debtCurrency: 'AED', items: [] }),
    ]);
    expect((await stored('customers', 'c1')).totalDebt).toBeCloseTo(debt + 36.7, 6);
  });

  it.each([
    ['raise stock', [set('inventory', 'p1', { quantity: 50 }, true)]],
    ['change a price', [set('inventory', 'p1', { sellingPrice: 1 }, true)]],
    ['add a product', [set('inventory', 'p2', { name: 'New', quantity: 1 })]],
    ['take cash out of the vault', [set('settings', 'vault', { balanceAED: 0 }, true)]],
    ['add a field to the vault', [set('settings', 'vault', { note: 'x' }, true)]],
    ['change the store profile', [set('settings', 'profile', { businessName: 'x' }, true)]],
    ['edit an existing invoice', [set('invoices', 'old1', { totalAmount: 0 }, true)]],
    ['delete an invoice', [{ op: 'delete', collection: 'invoices', id: 'old1' } as Op]],
    ['record a purchase', [set('invoices', 'buy1', { type: 'purchase' })]],
    ['record a vault expense', [set('vault_records', 'v9', { type: 'expense' })]],
    ['record a customer payment', [set('customer_transactions', 't9', { type: 'payment' })]],
    ['lower a customer debt', [set('customers', 'c1', { totalDebt: 0 }, true)]],
    ['rename a customer', [set('customers', 'c1', { name: 'Bob' }, true)]],
    ['add a customer', [set('customers', 'c2', { name: 'New' })]],
    ['pay a salary', [set('payroll', 'e1_2026-11', { amount: 1 })]],
    ['add a warehouse', [set('warehouses', 'w1', { name: 'W' })]],
  ])('cannot %s', async (_label, ops) => {
    await expect(commit(CASHIER, ops as Op[])).rejects.toThrow(/role not allowed/);
  });

  it('one forbidden change rolls back the whole sale', async () => {
    await expect(commit(CASHIER, [...cashSale(2), set('inventory', 'p1', { sellingPrice: 1 }, true)])).rejects.toThrow(/role not allowed/);
    expect((await stored('inventory', 'p1')).quantity).toBe(8);
    expect(await stored('invoices', 'inv2')).toBeUndefined();
  });

  it('a device cannot forge who created a record', async () => {
    await commit(CASHIER, [set('invoices', 'inv3', { type: 'sale', actorId: OWNER, actorEmail: 'owner@shop.com' })]);
    expect(await stored('invoices', 'inv3')).toMatchObject({ actorId: CASHIER, actorEmail: 'cashier@shop.com' });
  });
});

describe('who sold', () => {
  it('editing an invoice keeps its seller, even when the edit drops or changes it', async () => {
    await commit(OWNER, [set('invoices', 'inv3', { type: 'sale', totalAmount: 9, actorId: OWNER, actorEmail: 'x@y.com' })]);
    expect(await stored('invoices', 'inv3')).toMatchObject({ totalAmount: 9, actorId: CASHIER, actorEmail: 'cashier@shop.com' });
    await commit(OWNER, [set('invoices', 'inv3', { status: 'sent' }, true)]);
    expect(await stored('invoices', 'inv3')).toMatchObject({ status: 'sent', actorId: CASHIER, actorEmail: 'cashier@shop.com' });
  });

  it('an invoice saved before sellers were stamped does not gain one on edit', async () => {
    await h.admin(
      `INSERT INTO public.merchant_documents (user_id, collection, doc_id, data) VALUES ($1, 'invoices', 'legacy1', '{"type":"sale"}'::jsonb)`,
      [OWNER]);
    await commit(OWNER, [set('invoices', 'legacy1', { note: 'x', actorId: OWNER, actorEmail: 'owner@shop.com' }, true)]);
    const old = await stored('invoices', 'legacy1');
    expect(old.note).toBe('x');
    expect(old.actorId).toBeUndefined();
    expect(old.actorEmail).toBeUndefined();
  });
});

describe('manager writes', () => {
  it('manages stock, purchases, customers and deletes', async () => {
    await commit(MANAGER, [
      set('inventory', 'p2', { name: 'Coffee', quantity: 5 }),
      set('inventory', 'p1', { sellingPrice: 30 }, true),
      set('invoices', 'buy1', { type: 'purchase' }),
      set('customers', 'c2', { name: 'Huda', totalDebt: 0 }),
      set('settings', 'vault', { balanceAED: 10 }, true),
    ]);
    await commit(MANAGER, [{ op: 'delete', collection: 'invoices', id: 'old1' }]);
    expect((await stored('inventory', 'p1')).sellingPrice).toBe(30);
    expect(await stored('invoices', 'old1')).toBeUndefined();
  });

  it('cannot touch salaries or the store profile', async () => {
    await expect(commit(MANAGER, [set('employees', 'e2', { name: 'x' })])).rejects.toThrow(/role not allowed/);
    await expect(commit(MANAGER, [set('payroll', 'e1_2026-12', { amount: 1 })])).rejects.toThrow(/role not allowed/);
    await expect(commit(MANAGER, [set('settings', 'profile', { businessName: 'x' }, true)])).rejects.toThrow(/role not allowed/);
  });

  it('still cannot rewrite history', async () => {
    await expect(commit(MANAGER, [{ op: 'delete', collection: 'audit_logs', id: 'l0' }])).rejects.toThrow(/append-only/);
  });

  it('records one system row when a manager deletes, withdraws, or posts an expense', async () => {
    const systemLogs = () => h.admin<{ data: any }>(
      `SELECT data FROM public.merchant_documents
        WHERE user_id = $1 AND collection = 'audit_logs' AND (data->>'system') = 'true'
        ORDER BY (data->>'timestamp')::bigint, doc_id`,
      [OWNER]);
    const before = (await systemLogs()).length;

    await commit(MANAGER, [{ op: 'delete', collection: 'customers', id: 'c2' }]);
    let logs = await systemLogs();
    expect(logs).toHaveLength(before + 1);
    expect(logs.at(-1)?.data).toMatchObject({ action: 'manager_sensitive', actorId: MANAGER, email: 'manager@shop.com', system: true });
    expect(logs.at(-1)?.data.details).toMatch(/delete customers\/c2/);

    const live = await stored('settings', 'vault');
    await commit(MANAGER, [set('settings', 'vault', { balanceAED: Number(live.balanceAED) - 1 }, true)]);
    logs = await systemLogs();
    expect(logs).toHaveLength(before + 2);
    expect(logs.at(-1)?.data.details).toMatch(/vault down balanceAED/);

    await commit(MANAGER, [set('vault_records', 'exp-mgr', { type: 'expense', amount: 1, currency: 'AED' })]);
    logs = await systemLogs();
    expect(logs).toHaveLength(before + 3);
    expect(logs.at(-1)?.data.details).toMatch(/expense exp-mgr/);

    await commit(MANAGER, [
      { op: 'delete', collection: 'warehouses', id: 'missing-wh' },
      set('vault_records', 'exp-mgr-2', { type: 'expense', amount: 1, currency: 'AED' }),
    ]);
    logs = await systemLogs();
    expect(logs).toHaveLength(before + 4);
    expect(logs.at(-1)?.data.details).toMatch(/delete warehouses\/missing-wh/);
    expect(logs.at(-1)?.data.details).toMatch(/expense exp-mgr-2/);

    await commit(OWNER, [{ op: 'delete', collection: 'warehouses', id: 'still-missing' }]);
    expect(await systemLogs()).toHaveLength(before + 4);

    const raised = (await systemLogs()).length;
    await commit(MANAGER, [set('settings', 'vault', { balanceAED: Number((await stored('settings', 'vault')).balanceAED) + 5 }, true)]);
    expect(await systemLogs()).toHaveLength(raised);
  });
});

describe('cheques and stocktakes', () => {
  const insertCheque = (uid: string, no: string) => h.as(uid,
    `INSERT INTO public.cheques (user_id, cheque_number, bank_name, amount, currency, due_date, type)
     VALUES ($1, $2, 'Bank', 100, 'AED', '2026-12-01', 'incoming')`, [OWNER, no]);
  const cheques = (uid: string) => h.as(uid, 'SELECT cheque_number FROM public.cheques ORDER BY cheque_number');

  it('managers keep the store cheque register', async () => {
    await insertCheque(OWNER, '1001');
    await insertCheque(MANAGER, '1002');
    expect((await cheques(MANAGER)).map((r: any) => r.cheque_number)).toEqual(['1001', '1002']);
    await h.as(MANAGER, `UPDATE public.cheques SET status = 'cashed' WHERE cheque_number = '1001'`);
  });

  it('cashiers and strangers neither see nor add cheques', async () => {
    expect(await cheques(CASHIER)).toEqual([]);
    expect(await cheques(STRANGER)).toEqual([]);
    await expect(insertCheque(CASHIER, '2001')).rejects.toThrow(/row-level security/);
    await expect(insertCheque(STRANGER, '2002')).rejects.toThrow(/row-level security/);
  });

  it('a manager can open a stocktake for the store; a cashier cannot', async () => {
    const [audit] = await h.as<{ id: string; created_by: string }>(MANAGER,
      `INSERT INTO public.inventory_audits (user_id, audit_number) VALUES ($1, 'A-1') RETURNING id, created_by`, [OWNER]);
    expect(audit.created_by).toBe(MANAGER);
    await expect(h.as(CASHIER,
      `INSERT INTO public.inventory_audits (user_id, audit_number) VALUES ($1, 'A-2')`, [OWNER])).rejects.toThrow(/row-level security/);
    await expect(h.as(CASHIER, 'SELECT public.apply_inventory_audit($1)', [audit.id])).rejects.toThrow(/role not allowed/);
    expect(await h.as(CASHIER, 'SELECT id FROM public.inventory_audits')).toEqual([]);
  });
});

describe('changing a role', () => {
  it('takes effect at once and keeps the member in the store', async () => {
    await h.as(OWNER, `SELECT public.team_invite('cashier@shop.com', 'manager')`);
    expect((await context(CASHIER)).role).toBe('manager');
    expect((await read(CASHIER, 'vault_records')).length).toBeGreaterThan(0);
    await h.as(OWNER, `SELECT public.team_invite('cashier@shop.com', 'cashier')`);
    expect((await context(CASHIER)).role).toBe('cashier');
    expect(await read(CASHIER, 'vault_records')).toEqual([]);
  });
});

describe('subscription and leaving', () => {
  it('staff stop writing when the owner subscription ends, whatever their own account says', async () => {
    await h.setSubscription(CASHIER, 'active', FUTURE);
    await h.setSubscription(OWNER, 'expired', PAST);
    await expect(commit(CASHIER, cashSale(4))).rejects.toThrow(/subscription required/);
    expect((await context(CASHIER)).has_access).toBe(false);
    await h.setSubscription(OWNER, 'active', FUTURE);
  });

  it('removing a member cuts their access immediately', async () => {
    await h.as(OWNER, `SELECT public.team_remove('cashier@shop.com')`);
    expect(await read(CASHIER, 'inventory')).toEqual([]);
    expect((await context(CASHIER)).owner_id).toBe(CASHIER);
    await commit(CASHIER, [set('inventory', 'own1', { name: 'Mine', quantity: 1 })]);
    expect(await stored('inventory', 'own1')).toBeUndefined();
  });

  it('a member who leaves is back in their own store', async () => {
    await h.as(MANAGER, 'SELECT public.team_leave()');
    const ctx = await context(MANAGER);
    expect(ctx.role).toBe('owner');
    expect(ctx.owner_id).toBe(MANAGER);
    expect(await read(MANAGER, 'inventory')).toEqual([]);
  });

  it('the owner books are unchanged by all of the above', async () => {
    expect((await read(OWNER, 'employees')).length).toBe(1);
    expect((await stored('settings', 'profile')).businessName).toBe('متجر الأمل');
  });
});

describe('vault restore', () => {
  const replace = (data: Record<string, unknown>, withExpected: boolean) => {
    if (!withExpected) return commit(OWNER, [set('settings', 'vault', data)]);
    return h.as(OWNER,
      `SELECT public.merchant_commit(
         jsonb_build_array(jsonb_build_object(
           'collection', 'settings', 'id', 'vault', 'updated_at',
           (SELECT updated_at FROM public.merchant_documents
             WHERE user_id = $1 AND collection = 'settings' AND doc_id = 'vault'))),
         $2::jsonb)`,
      [OWNER, JSON.stringify([set('settings', 'vault', data)])]);
  };

  it('keeps a vault that is newer than the backup, and still allows a sale to merge', async () => {
    const before = await stored('settings', 'vault');
    const balance = before.balanceAED;
    const seen = Number(before.lastUpdated);

    await expect(replace({ ...before, balanceAED: 1, lastUpdated: seen + 1000 }, false)).rejects.toThrow(/vault is newer/);
    expect((await stored('settings', 'vault')).balanceAED).toBe(balance);

    await expect(replace({ ...before, balanceAED: 1, lastUpdated: seen - 1 }, true)).rejects.toThrow(/vault is newer/);
    const withoutTime = { ...before };
    delete withoutTime.lastUpdated;
    await expect(replace(withoutTime, true)).rejects.toThrow(/vault is newer/);
    expect((await stored('settings', 'vault')).balanceAED).toBe(balance);

    await replace({ ...before, lastUpdated: seen }, true);
    expect((await stored('settings', 'vault')).balanceAED).toBe(balance);

    await replace({ ...before, lastUpdated: seen + 1000 }, true);
    expect((await stored('settings', 'vault')).lastUpdated).toBe(seen + 1000);

    await commit(OWNER, [set('settings', 'vault', { balanceAED: balance, lastUpdated: 1 }, true)]);
    expect((await stored('settings', 'vault')).balanceAED).toBe(balance);
    expect((await stored('settings', 'vault')).lastUpdated).toBe(1);
  });
});

describe('re-running the setup on a live database', () => {
  it('succeeds and keeps the books and the team', async () => {
    const { readFileSync } = await import('node:fs');
    const { SQL_FILES } = await import('./sqlHarness');
    for (const file of SQL_FILES) await h.db.exec(readFileSync(file, 'utf8'));
    expect((await stored('settings', 'profile')).businessName).toBe('متجر الأمل');
    expect((await stored('inventory', 'p1')).sellingPrice).toBe(30);
    const list = (await h.as<{ l: any[] }>(OWNER, 'SELECT public.team_list() AS l'))[0].l;
    expect(list.map((m) => m.email)).toEqual(['late@shop.com']);
  });
});

describe('AI assistant usage', () => {
  const asService = async (sql: string, params: unknown[]) => {
    await h.db.exec('BEGIN');
    try {
      await h.db.exec('SET LOCAL ROLE service_role');
      await h.db.query(sql, params);
      await h.db.exec('COMMIT');
    } catch (error) {
      await h.db.exec('ROLLBACK');
      throw error;
    }
  };
  const record = 'SELECT public.record_ai_usage($1, $2, $3, $4, $5)';

  const claim = async (owner: string, limit: number) => {
    await h.db.exec('BEGIN');
    try {
      await h.db.exec('SET LOCAL ROLE service_role');
      const { rows } = await h.db.query<{ ok: boolean }>('SELECT public.claim_ai_request($1, $2) AS ok', [owner, limit]);
      await h.db.exec('COMMIT');
      return rows[0].ok;
    } catch (error) {
      await h.db.exec('ROLLBACK');
      throw error;
    }
  };

  it('counts questions up to the daily cap and adds up their tokens', async () => {
    expect(await claim(OWNER, 3)).toBe(true);
    await asService(record, [OWNER, 21000, 400, 900, 0]);
    expect(await claim(OWNER, 3)).toBe(true);
    await asService(record, [OWNER, 23000, 350, -5, 0]);
    expect(await claim(OWNER, 3)).toBe(true);
    expect(await claim(OWNER, 3)).toBe(false);
    expect(await claim(OWNER, 3)).toBe(false);
    const [row] = await h.admin<any>('SELECT requests, prompt_tokens, output_tokens, thought_tokens FROM public.ai_usage WHERE owner_id = $1', [OWNER]);
    expect(row).toEqual({ requests: 3, prompt_tokens: 44000, output_tokens: 750, thought_tokens: 900 });
  });

  it('a cap of zero turns the assistant off, and other stores keep their own allowance', async () => {
    expect(await claim(OTHER_OWNER, 0)).toBe(false);
    expect(await claim(OTHER_OWNER, 1)).toBe(true);
    expect(await claim(OTHER_OWNER, 1)).toBe(false);
  });

  it('a failed answer gives the question back, never below zero', async () => {
    const release = 'SELECT public.release_ai_request($1)';
    expect(await claim(OWNER, 3)).toBe(false);
    await asService(release, [OWNER]);
    expect(await claim(OWNER, 3)).toBe(true);
    expect(await claim(OWNER, 3)).toBe(false);

    for (let i = 0; i < 3; i++) await asService(release, [OTHER_OWNER]);
    const [row] = await h.admin<any>('SELECT requests FROM public.ai_usage WHERE owner_id = $1', [OTHER_OWNER]);
    expect(row.requests).toBe(0);
  });

  it('cannot be claimed, written or read from the browser', async () => {
    await expect(h.as(OWNER, 'SELECT public.release_ai_request($1)', [OWNER])).rejects.toThrow(/permission denied/);
    await expect(h.as(OWNER, 'SELECT public.claim_ai_request($1, 1000)', [OWNER])).rejects.toThrow(/permission denied/);
    await expect(h.as(OWNER, record, [OWNER, 0, 0, 0, 0])).rejects.toThrow(/permission denied/);
    await expect(h.as(OWNER, 'SELECT * FROM public.ai_usage')).rejects.toThrow(/permission denied/);
  });
});
