import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canOpenScreen, can, homeScreen } from '../roles';

const OWNER = '11111111-1111-1111-1111-111111111111';
const MEMBER = '22222222-2222-2222-2222-222222222222';
const scopes: string[] = [];
const channels: string[] = [];
let context: { data: unknown; error: unknown } = { data: null, error: null };

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear(),
});

vi.mock('../../supabaseClient', () => {
  const query: any = {
    select: () => query,
    eq: (column: string, value: string) => {
      if (column === 'user_id') scopes.push(value);
      return query;
    },
    order: () => query,
    range: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: MEMBER } } } }) },
      from: () => query,
      rpc: async (fn: string) => (fn === 'team_context' ? context : { data: null, error: null }),
      channel: (name: string) => {
        channels.push(name);
        return { on() { return this; }, subscribe() { return this; }, unsubscribe() {} };
      },
    },
  };
});

const memberContext = {
  owner_id: OWNER,
  role: 'cashier',
  store_name: 'متجر الأمل',
  owner_email: 'owner@shop.com',
  has_access: true,
  subscription: { subscription_status: 'active', expiry_date: '2027-01-01T00:00:00Z', trial_start_date: '2026-01-01T00:00:00Z' },
  invites: [],
};

async function readOnce(name: string) {
  const { collection, onSnapshot } = await import('../supabaseDocs');
  await new Promise<void>((resolve, reject) => {
    const stop = onSnapshot(collection(null, 'users', MEMBER, name), () => { stop(); resolve(); }, reject);
  });
}

describe('store scope', () => {
  beforeEach(async () => {
    scopes.length = 0;
    channels.length = 0;
    localStorage.clear();
    (await import('../supabaseDocs')).resetSync();
  });

  it('a member reads and listens to the owner books, not their own', async () => {
    context = { data: memberContext, error: null };
    await readOnce('inventory');
    expect(scopes).toEqual([OWNER]);
    expect(channels).toEqual([`merchant-documents-${OWNER}`]);
  });

  it('without the team functions the account is its own store', async () => {
    context = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.team_context' } };
    await readOnce('inventory');
    expect(scopes).toEqual([MEMBER]);
  });

  it('offline, the last store seen on this device is kept', async () => {
    context = { data: memberContext, error: null };
    await readOnce('inventory');
    const { resetSync } = await import('../supabaseDocs');
    resetSync();
    scopes.length = 0;
    context = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    await readOnce('customers');
    expect(scopes).toEqual([OWNER]);
  });

  it('a new device that cannot reach the server waits instead of opening an empty store of its own', async () => {
    vi.useFakeTimers();
    try {
      context = { data: null, error: { message: 'TypeError: Failed to fetch' } };
      const read = readOnce('inventory');
      await vi.advanceTimersByTimeAsync(5000);
      expect(scopes).toEqual([]);
      context = { data: memberContext, error: null };
      await vi.advanceTimersByTimeAsync(10000);
      await read;
      expect(scopes).toEqual([OWNER]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('team context', () => {
  it('reads the owner subscription and invitations', async () => {
    const { parseTeamContext } = await import('../workspace');
    const ws = parseTeamContext(MEMBER, {
      ...memberContext,
      invites: [{ owner_id: 'x', role: 'manager', store_name: 'B', owner_email: 'b@b.com' }, { owner_id: 'y', role: 'owner' }],
    })!;
    expect(ws.ownerId).toBe(OWNER);
    expect(ws.role).toBe('cashier');
    expect(ws.subscription).toMatchObject({ user_id: OWNER, subscription_status: 'active' });
    expect(ws.invites).toEqual([{ ownerId: 'x', role: 'manager', storeName: 'B', ownerEmail: 'b@b.com' }]);
  });

  it('refuses a payload whose role and owner disagree', async () => {
    const { parseTeamContext } = await import('../workspace');
    expect(parseTeamContext(MEMBER, { ...memberContext, role: 'owner' })).toBeNull();
    expect(parseTeamContext(OWNER, { ...memberContext, role: 'manager' })).toBeNull();
    expect(parseTeamContext(MEMBER, { ...memberContext, role: 'admin' })).toBeNull();
    expect(parseTeamContext(MEMBER, null)).toBeNull();
  });
});

describe('role permissions', () => {
  it('owners open everything', () => {
    for (const screen of ['employees', 'vault', 'settings', 'google-drive', 'pos']) expect(canOpenScreen('owner', screen)).toBe(true);
    expect(can('owner', 'manage_team')).toBe(true);
  });

  it('managers run the store but not salaries, backups, the team or billing', () => {
    for (const screen of ['dashboard', 'inventory', 'vault', 'purchases-expenses', 'profits-dashboard', 'cheques', 'inventory-audit']) {
      expect(canOpenScreen('manager', screen)).toBe(true);
    }
    for (const screen of ['employees', 'accounting', 'google-drive', 'admin-dashboard']) expect(canOpenScreen('manager', screen)).toBe(false);
    expect(can('manager', 'delete_records')).toBe(true);
    expect(can('manager', 'manage_team')).toBe(false);
    expect(can('manager', 'billing')).toBe(false);
    expect(can('manager', 'business_settings')).toBe(false);
    expect(can('manager', 'store_backup')).toBe(false);
    expect(can('owner', 'store_backup')).toBe(true);
  });

  it('cashiers only sell and look up invoices', () => {
    expect(homeScreen('cashier')).toBe('pos');
    for (const screen of ['pos', 'invoices', 'settings']) expect(canOpenScreen('cashier', screen)).toBe(true);
    for (const screen of ['dashboard', 'inventory', 'vault', 'customers', 'cheques', 'profits-dashboard', 'ai-assistant', 'landed-cost']) {
      expect(canOpenScreen('cashier', screen)).toBe(false);
    }
    for (const action of ['delete_records', 'reverse_invoice', 'manage_customers', 'manage_catalog', 'see_costs', 'back_office'] as const) {
      expect(can('cashier', action)).toBe(false);
    }
  });
});
