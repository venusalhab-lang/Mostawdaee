import { describe, expect, it, vi } from 'vitest';

const TOTAL = 2350;
const ranges: Array<[number, number]> = [];

vi.mock('../../supabaseClient', () => {
  const query: any = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      const end = Math.min(to + 1, TOTAL);
      const data = Array.from({ length: Math.max(0, end - from) }, (_, i) => ({
        doc_id: `p${from + i}`,
        data: { n: from + i },
        updated_at: '2026-10-01T00:00:00Z',
      }));
      return Promise.resolve({ data, error: null });
    },
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: () => query,
      channel: () => ({ on: function () { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    },
  };
});

describe('collection reads', () => {
  it('reads every page instead of stopping at the server row cap', async () => {
    const { collection, onSnapshot } = await import('../supabaseDocs');
    const ids = await new Promise<string[]>((resolve, reject) => {
      const stop = onSnapshot(
        collection(null, 'users', 'u1', 'inventory'),
        (snap: any) => {
          const seen: string[] = [];
          snap.forEach((row: { id: string }) => seen.push(row.id));
          stop();
          resolve(seen);
        },
        reject,
      );
    });
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
