import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeWindow = new EventTarget();
vi.stubGlobal('window', fakeWindow);
vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));

type Row = { data: Record<string, unknown>; updated_at: string };

const server = new Map<string, Row>();
const log: string[] = [];
let clock = Date.parse('2026-10-01T10:00:00Z');
const stamp = () => new Date((clock += 1000)).toISOString();
const put = (id: string, name: string) => server.set(id, { data: { name }, updated_at: stamp() });

vi.mock('../../supabaseClient', () => {
  const makeQuery = () => {
    const q: any = { cols: '', opts: {} as any, filters: {} as Record<string, any> };
    q.select = (cols: string, opts?: any) => { q.cols = cols; q.opts = opts || {}; return q; };
    q.eq = (c: string, v: string) => { q.filters[c] = v; return q; };
    q.gte = (c: string, v: string) => { q.filters.gte = v; return q; };
    q.in = (c: string, ids: string[]) => { q.filters.in = ids; return q; };
    q.then = (resolve: any, reject: any) => q.run().then(resolve, reject);
    q.order = () => q;
    q.range = (from: number, to: number) => q.run(from, to);
    q.maybeSingle = () => {
      log.push('single');
      const row = server.get(q.filters.doc_id);
      return Promise.resolve({ data: row ? { ...row } : null, error: null });
    };
    q.run = (from = 0, to = Infinity) => {
      let rows = [...server.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      if (q.filters.gte) rows = rows.filter(([, r]) => Date.parse(r.updated_at) >= Date.parse(q.filters.gte));
      if (q.filters.in) rows = rows.filter(([id]) => q.filters.in.includes(id));
      if (q.opts.head) {
        log.push('count');
        return Promise.resolve({ count: rows.length, error: null });
      }
      log.push(q.filters.in ? 'in' : q.filters.gte ? 'changed' : q.cols === 'doc_id' ? 'ids' : 'full');
      const page = rows.slice(from, to + 1);
      return Promise.resolve({
        data: page.map(([doc_id, r]) => (q.cols === 'doc_id' ? { doc_id } : { doc_id, ...r })),
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

describe('catching up a collection after realtime was away', () => {
  beforeEach(() => {
    log.length = 0;
  });

  it('downloads only the changed rows, drops deleted ones and never re-reads the whole collection', async () => {
    for (let i = 0; i < 5; i++) put(`p${i}`, `P${i}`);
    const { collection, onSnapshot } = await import('../supabaseDocs');
    const snapshots: Array<Record<string, string>> = [];
    const stop = onSnapshot(collection(null, 'users', 'u1', 'inventory'), (snap: any) => {
      const view: Record<string, string> = {};
      snap.forEach((row: { id: string; data: () => { name: string } }) => { view[row.id] = row.data().name; });
      snapshots.push(view);
    });
    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    expect(log).toEqual(['full']);

    // While the phone was in the background: one edit, one new product, nothing deleted.
    clock += 10 * 60_000;
    put('p1', 'P1 edited');
    put('p9', 'P9');
    log.length = 0;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(snapshots).toHaveLength(2));
    expect(snapshots[1]).toMatchObject({ p1: 'P1 edited', p9: 'P9', p0: 'P0' });
    expect(Object.keys(snapshots[1])).toHaveLength(6);
    expect(log.sort()).toEqual(['changed', 'count']);

    // A deletion is noticed by the count, then only ids are listed.
    server.delete('p3');
    log.length = 0;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(snapshots).toHaveLength(3));
    expect(snapshots[2]).not.toHaveProperty('p3');
    expect(Object.keys(snapshots[2])).toHaveLength(5);
    expect(log.sort()).toEqual(['changed', 'count', 'ids']);
    expect(log).not.toContain('full');

    stop();
  });
});
