import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { data: Record<string, unknown>; updated_at: string };

const server = new Map<string, Row>();
const log: string[] = [];
let sessionCalls = 0;
let clock = Date.parse('2026-11-04T12:00:00Z');
const stamp = () => new Date((clock += 1000)).toISOString();

vi.stubGlobal('window', new EventTarget());
vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));

vi.mock('../rowCache', () => ({
  readRows: async () => null,
  writeRows: async () => {},
  clearRows: async () => {},
  allowRows: () => {},
}));

vi.mock('../workspace', () => ({
  ensureWorkspace: async (uid: string) => ({ ownerId: uid, role: 'owner' }),
  resetWorkspace: () => {},
}));

vi.mock('../../supabaseClient', () => {
  const makeQuery = () => {
    const q: any = { cols: '', filters: {} as Record<string, any> };
    q.select = (cols: string) => { q.cols = cols; return q; };
    q.eq = (c: string, v: string) => { q.filters[c] = v; return q; };
    q.in = (_c: string, ids: string[]) => { q.filters.in = ids; return q; };
    q.maybeSingle = async () => {
      log.push(`single:${q.filters.collection}/${q.filters.doc_id}`);
      const key = `${q.filters.collection}/${q.filters.doc_id}`;
      const row = server.get(key);
      return { data: row ? { data: row.data, updated_at: row.updated_at } : null, error: null };
    };
    q.then = (resolve: any, reject: any) => {
      if (q.filters.in) {
        log.push(`in:${q.filters.collection}:${q.filters.in.length}`);
        const data = q.filters.in
          .map((id: string) => {
            const row = server.get(`${q.filters.collection}/${id}`);
            return row ? { doc_id: id, data: row.data, updated_at: row.updated_at } : null;
          })
          .filter(Boolean);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    };
    return q;
  };
  return {
    supabase: {
      auth: {
        getSession: async () => {
          sessionCalls += 1;
          return { data: { session: { user: { id: 'u1' } } } };
        },
      },
      from: () => makeQuery(),
      rpc: async (name: string, args: { p_ops: Array<{ op: string; collection: string; id: string; data?: Record<string, unknown>; merge?: boolean }> }) => {
        if (name === 'team_context') {
          return { data: null, error: { code: 'PGRST202', message: 'missing' } };
        }
        for (const op of args.p_ops) {
          const key = `${op.collection}/${op.id}`;
          if (op.op === 'delete') server.delete(key);
          else {
            const prev = server.get(key)?.data || {};
            const next = op.merge ? { ...prev, ...(op.data || {}) } : { ...(op.data || {}) };
            server.set(key, { data: next, updated_at: stamp() });
          }
        }
        log.push(`rpc:${args.p_ops.length}`);
        return { error: null };
      },
      channel: () => ({ on: function () { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    },
  };
});

function seed(collection: string, id: string, data: Record<string, unknown>) {
  server.set(`${collection}/${id}`, { data, updated_at: stamp() });
}

describe('runTransaction checkout path', () => {
  beforeEach(async () => {
    server.clear();
    log.length = 0;
    sessionCalls = 0;
    clock = Date.parse('2026-11-04T12:00:00Z');
    vi.resetModules();
    const { resetSync } = await import('../supabaseDocs');
    resetSync();
  });

  it('reads many inventory docs in one batched query and refreshes writes with .in, not N singles', async () => {
    seed('inventory', 'p1', { name: 'A', quantity: 10 });
    seed('inventory', 'p2', { name: 'B', quantity: 5 });
    seed('inventory', 'p3', { name: 'C', quantity: 2 });
    seed('settings', 'vault', { balances: { JOD: 100 } });

    const { doc, runTransaction } = await import('../supabaseDocs');
    const sessionsBeforeWork = sessionCalls;

    await runTransaction(null, async (tx) => {
      const vault = await tx.get(doc(null, 'users', 'u1', 'settings', 'vault'));
      expect(vault.exists()).toBe(true);

      const refs = ['p1', 'p2', 'p3'].map((id) => doc(null, 'users', 'u1', 'inventory', id));
      const snaps = await tx.getMany(refs);
      expect(snaps.map((s: { data: () => { quantity: number } }) => s.data().quantity)).toEqual([10, 5, 2]);

      for (let i = 0; i < refs.length; i += 1) {
        tx.update(refs[i], { quantity: snaps[i].data().quantity - 1 });
      }
      tx.set(doc(null, 'users', 'u1', 'invoices', 'inv1'), { totalAmount: 3, type: 'sale' });
    });

    // One session resolve for the attempt (not one per document read).
    expect(sessionCalls - sessionsBeforeWork).toBeLessThanOrEqual(2);

    expect(log.some((line) => line === 'in:inventory:3')).toBe(true);
    expect(log.filter((line) => line.startsWith('single:inventory/')).length).toBe(0);
    // Post-commit refresh is batched per collection (inventory + invoices at least).
    expect(log.filter((line) => line.startsWith('in:')).length).toBeGreaterThanOrEqual(2);
    expect(server.get('inventory/p1')?.data.quantity).toBe(9);
    expect(server.get('inventory/p3')?.data.quantity).toBe(1);
    expect(server.get('invoices/inv1')?.data.type).toBe('sale');
  });

  it('keeps OCC expected rows for every product read via getMany', async () => {
    seed('inventory', 'p1', { quantity: 1 });
    seed('inventory', 'p2', { quantity: 1 });

    const { doc, runTransaction } = await import('../supabaseDocs');
    let expectedCount = 0;

    const { supabase } = await import('../../supabaseClient');
    const originalRpc = supabase.rpc.bind(supabase);
    (supabase as { rpc: (...args: any[]) => any }).rpc = async (name: string, args: any) => {
      if (name === 'merchant_commit') expectedCount = (args.p_expected || []).length;
      return originalRpc(name, args);
    };

    await runTransaction(null, async (tx) => {
      const refs = ['p1', 'p2'].map((id) => doc(null, 'users', 'u1', 'inventory', id));
      await tx.getMany(refs);
      tx.update(refs[0], { quantity: 0 });
      tx.update(refs[1], { quantity: 0 });
    });

    expect(expectedCount).toBe(2);
  });
});
