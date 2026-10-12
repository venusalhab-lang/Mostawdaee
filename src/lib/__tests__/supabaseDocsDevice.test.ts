import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', new EventTarget());
vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));

type Row = { data: Record<string, unknown>; updated_at: string };

const server = new Map<string, Row>();
const log: string[] = [];
let clock = Date.parse('2026-10-01T10:00:00Z');
const stamp = () => new Date((clock += 1000)).toISOString();
const put = (id: string, name: string) => server.set(id, { data: { name }, updated_at: stamp() });

const device = new Map<string, unknown[]>();
vi.mock('../rowCache', () => ({
  readRows: async (key: string) => (device.has(key) ? structuredClone(device.get(key)) : null),
  writeRows: async (key: string, rows: unknown[]) => { device.set(key, structuredClone(rows)); },
  clearRows: async (prefix: string) => { for (const key of [...device.keys()]) if (key.startsWith(prefix)) device.delete(key); },
  allowRows: () => {},
}));

vi.mock('../../supabaseClient', () => {
  const makeQuery = () => {
    const q: any = { cols: '', opts: {} as any, filters: {} as Record<string, any> };
    q.select = (cols: string, opts?: any) => { q.cols = cols; q.opts = opts || {}; return q; };
    q.eq = (c: string, v: string) => { q.filters[c] = v; return q; };
    q.gte = (_c: string, v: string) => { q.filters.gte = v; return q; };
    q.in = (_c: string, ids: string[]) => { q.filters.in = ids; return q; };
    q.then = (resolve: any, reject: any) => q.run().then(resolve, reject);
    q.order = () => q;
    q.range = (from: number, to: number) => q.run(from, to);
    q.run = (from = 0, to = Infinity) => {
      let rows = [...server.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      if (q.filters.gte) rows = rows.filter(([, r]) => Date.parse(r.updated_at) >= Date.parse(q.filters.gte));
      if (q.filters.in) rows = rows.filter(([id]) => q.filters.in.includes(id));
      if (q.opts.head) {
        log.push('count');
        return Promise.resolve({ count: rows.length, error: null });
      }
      log.push(q.filters.in ? 'in' : q.filters.gte ? 'changed' : q.cols === 'doc_id' ? 'ids' : 'full');
      return Promise.resolve({
        data: rows.slice(from, to + 1).map(([doc_id, r]) => (q.cols === 'doc_id' ? { doc_id } : { doc_id, ...r })),
        error: null,
      });
    };
    return q;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: () => makeQuery(),
      rpc: async (name: string) => (name === 'team_context'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.team_context' } }
        : { error: null }),
      channel: () => ({ on: function () { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    },
  };
});

async function open() {
  const { collection, onSnapshot } = await import('../supabaseDocs');
  let view: Record<string, string> | null = null;
  const stop = onSnapshot(collection(null, 'users', 'u1', 'inventory'), (snap: any) => {
    const next: Record<string, string> = {};
    snap.forEach((row: { id: string; data: () => { name: string } }) => { next[row.id] = row.data().name; });
    view = next;
  });
  await vi.waitFor(() => expect(view).not.toBeNull());
  return { view: view as unknown as Record<string, string>, stop };
}

describe('rows saved on the device between sessions', () => {
  it('reopening the app downloads only what changed, and signing out forgets the saved rows', async () => {
    for (let i = 0; i < 5; i++) put(`p${i}`, `P${i}`);
    const first = await open();
    expect(log).toEqual(['full']);
    await vi.waitFor(() => expect([...device.values()][0]).toHaveLength(5), { timeout: 4000 });
    expect([...device.keys()][0].startsWith('u1|')).toBe(true);
    first.stop();

    // App closed; another device edits one product, adds one and deletes one.
    const { resetSync } = await import('../supabaseDocs');
    resetSync();
    clock += 60 * 60_000;
    put('p1', 'P1 edited');
    put('p9', 'P9');
    server.delete('p3');
    log.length = 0;

    const second = await open();
    expect(second.view).toEqual({ p0: 'P0', p1: 'P1 edited', p2: 'P2', p4: 'P4', p9: 'P9' });
    expect(log).not.toContain('full');
    expect(log.sort()).toEqual(['changed', 'count', 'ids']);
    second.stop();

    vi.stubGlobal('localStorage', { length: 0, key: () => null, removeItem: () => {} });
    const { clearUserCache } = await import('../userStorage');
    clearUserCache('u1');
    await vi.waitFor(() => expect(device.size).toBe(0));
  }, 15_000);
});
