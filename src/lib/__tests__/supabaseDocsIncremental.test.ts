import { describe, expect, it, vi } from 'vitest';

const calls = { ranges: 0, singles: 0 };
const server = new Map<string, Record<string, unknown>>([
  ['a', { name: 'A' }],
  ['b', { name: 'B' }],
]);

vi.mock('../../supabaseClient', () => {
  const query: any = {
    filters: {} as Record<string, any>,
    select: () => query,
    eq: (column: string, value: string) => { query.filters[column] = value; return query; },
    in: (column: string, ids: string[]) => { query.filters.in = { column, ids }; return query; },
    order: () => query,
    range: () => {
      calls.ranges += 1;
      const data = [...server.entries()].map(([doc_id, data]) => ({ doc_id, data, updated_at: 't' }));
      return Promise.resolve({ data, error: null });
    },
    maybeSingle: () => {
      calls.singles += 1;
      const data = server.get(query.filters.doc_id);
      return Promise.resolve({ data: data ? { data, updated_at: 't2' } : null, error: null });
    },
    then: (resolve: any, reject: any) => {
      // Batched post-commit refresh uses `.in('doc_id', …)` then awaits the builder.
      if (query.filters.in) {
        calls.singles += 1;
        const data = query.filters.in.ids
          .filter((id: string) => server.has(id))
          .map((doc_id: string) => ({ doc_id, data: server.get(doc_id), updated_at: 't2' }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: () => { query.filters = {}; return query; },
      rpc: async (name: string, args: { p_ops: Array<{ op: string; id: string; data: Record<string, unknown> }> }) => {
        if (name === 'team_context') {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.team_context' } };
        }
        for (const op of args.p_ops) {
          if (op.op === 'delete') server.delete(op.id);
          else server.set(op.id, op.data);
        }
        return { error: null };
      },
      channel: () => ({ on: function () { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    },
  };
});

describe('incremental collection updates', () => {
  it('applies a write to the open collection without re-reading all of it', async () => {
    const { collection, doc, onSnapshot, setDoc, deleteDoc } = await import('../supabaseDocs');
    const snapshots: string[][] = [];
    const stop = onSnapshot(collection(null, 'users', 'u1', 'inventory'), (snap: any) => {
      const ids: string[] = [];
      snap.forEach((row: { id: string }) => ids.push(row.id));
      snapshots.push(ids);
    });
    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    expect(calls.ranges).toBe(1);

    await setDoc(doc(null, 'users', 'u1', 'inventory', 'c'), { name: 'C' });
    await vi.waitFor(() => expect(snapshots.at(-1)).toEqual(['a', 'b', 'c']));

    await deleteDoc(doc(null, 'users', 'u1', 'inventory', 'a'));
    await vi.waitFor(() => expect(snapshots.at(-1)).toEqual(['b', 'c']));

    expect(calls.ranges).toBe(1);
    expect(calls.singles).toBe(1);
    stop();
  });
});
