import { afterAll, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let quota = Infinity;
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (v.length > quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
    store.set(k, v);
  },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
const page = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
vi.stubGlobal('localStorage', localStorageStub);
vi.stubGlobal('window', new EventTarget());
vi.stubGlobal('document', page);

afterAll(() => vi.unstubAllGlobals());

const hide = () => {
  page.visibilityState = 'hidden';
  page.dispatchEvent(new Event('visibilitychange'));
};

describe('device copy of the books', () => {
  it('reads back pending writes and saves them when the app is hidden', async () => {
    const { readUserCache, userCacheKey, writeUserCache } = await import('../userStorage');
    writeUserCache('u1', 'products', [{ id: 'p1' }]);
    expect(readUserCache('u1', 'products', [])).toEqual([{ id: 'p1' }]);
    expect(store.has(userCacheKey('u1', 'products'))).toBe(false);
    hide();
    expect(JSON.parse(store.get(userCacheKey('u1', 'products'))!)).toEqual([{ id: 'p1' }]);
  });

  it('drops an outdated server copy that no longer fits, but never held bills', async () => {
    const { userCacheKey, writeUserCache } = await import('../userStorage');
    store.set(userCacheKey('u1', 'invoices'), '[{"id":"old"}]');
    store.set(userCacheKey('u1', 'held_bills'), '[{"id":"cart"}]');
    quota = 20;
    writeUserCache('u1', 'invoices', Array.from({ length: 50 }, (_, i) => ({ id: `i${i}` })));
    writeUserCache('u1', 'held_bills', Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` })));
    hide();
    quota = Infinity;
    expect(store.has(userCacheKey('u1', 'invoices'))).toBe(false);
    expect(store.get(userCacheKey('u1', 'held_bills'))).toBe('[{"id":"cart"}]');
  });
});
