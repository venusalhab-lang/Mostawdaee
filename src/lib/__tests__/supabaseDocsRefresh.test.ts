import { afterAll, describe, expect, it, vi } from 'vitest';

const win = new EventTarget();
const page = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
vi.stubGlobal('window', win);
vi.stubGlobal('document', page);

const calls = { ranges: 0 };
let channelStatus: ((status: string) => void) | null = null;

vi.mock('../../supabaseClient', () => {
  const query: any = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: () => {
      calls.ranges += 1;
      return new Promise((resolve) => setTimeout(() => resolve({ data: [{ doc_id: 'a', data: { name: 'A' }, updated_at: 't' }], error: null }), 5));
    },
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: () => query,
      channel: () => ({
        on() { return this; },
        subscribe(cb: (status: string) => void) { channelStatus = cb; return this; },
        unsubscribe() {},
      }),
    },
  };
});

vi.mock('../workspace', () => ({
  ensureWorkspace: async (uid: string) => ({ ownerId: uid }),
  resetWorkspace: () => {},
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const visibility = (state: 'visible' | 'hidden') => {
  page.visibilityState = state;
  page.dispatchEvent(new Event('visibilitychange'));
};

afterAll(() => vi.unstubAllGlobals());

describe('refreshing open collections', () => {
  it('downloads only when realtime may have missed changes, once per collection', async () => {
    const { collection, onSnapshot, STALE_AFTER_HIDDEN_MS } = await import('../supabaseDocs');
    const ref = collection(null, 'users', 'u1', 'inventory');
    const seen = { a: 0, b: 0 };
    const stopA = onSnapshot(ref, () => { seen.a += 1; });
    const stopB = onSnapshot(ref, () => { seen.b += 1; });
    await settle();
    expect(calls.ranges).toBe(1);
    expect(seen).toEqual({ a: 1, b: 1 });

    channelStatus!('SUBSCRIBED');
    win.dispatchEvent(new Event('focus'));
    visibility('hidden');
    visibility('visible');
    await settle();
    expect(calls.ranges).toBe(1);

    const now = Date.now();
    visibility('hidden');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + STALE_AFTER_HIDDEN_MS + 1000);
    visibility('visible');
    clock.mockRestore();
    await settle();
    expect(calls.ranges).toBe(2);
    expect(seen).toEqual({ a: 2, b: 2 });

    channelStatus!('CHANNEL_ERROR');
    win.dispatchEvent(new Event('focus'));
    await settle();
    expect(calls.ranges).toBe(3);

    channelStatus!('SUBSCRIBED');
    await settle();
    expect(calls.ranges).toBe(4);

    const stopC = onSnapshot(ref, () => {});
    await settle();
    expect(calls.ranges).toBe(4);

    win.dispatchEvent(new Event('online'));
    await settle();
    expect(calls.ranges).toBe(5);

    stopA(); stopB(); stopC();
    win.dispatchEvent(new Event('online'));
    await settle();
    expect(calls.ranges).toBe(5);
  });
});
