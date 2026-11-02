import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  heldBillFitsStock,
  normalizeHeldBill,
  parkedHeldBills,
  readHeldBills,
  unitsHeldParked,
  writeHeldBills,
  type HeldBill,
} from '../heldBills';
import { clearUserCache, userCacheKey } from '../userStorage';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
}

const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);
vi.stubGlobal('window', { localStorage: storage });

afterEach(() => storage.clear());

const bill = (over: Partial<HeldBill> = {}): HeldBill => ({
  id: 'h1',
  invoiceNumber: 'HLD-1',
  items: [{ productId: 'p1', description: 'Tea', quantity: 3, unitPrice: 1, total: 3 }],
  discount: 0,
  date: 1,
  time: '10:00',
  itemCount: 3,
  totalAmount: 3,
  currency: 'JOD',
  mode: 'sale',
  status: 'parked',
  ...over,
});

describe('held bills', () => {
  it('writes synchronously and survives cache clear', () => {
    expect(writeHeldBills('u1', [bill()])).toBe(true);
    expect(readHeldBills('u1')).toHaveLength(1);
    clearUserCache('u1');
    expect(storage.getItem(userCacheKey('u1', 'held_bills'))).toBeTruthy();
    expect(readHeldBills('u1')[0].id).toBe('h1');
  });

  it('counts only parked holds toward reserved stock', () => {
    const bills = [
      bill({ id: 'a', items: [{ productId: 'p1', description: 'Tea', quantity: 2, unitPrice: 1, total: 2 }] }),
      bill({ id: 'b', status: 'open', items: [{ productId: 'p1', description: 'Tea', quantity: 5, unitPrice: 1, total: 5 }] }),
    ];
    expect(unitsHeldParked(bills, 'p1')).toBe(2);
    expect(unitsHeldParked(bills, 'p1', 'a')).toBe(0);
    expect(parkedHeldBills(bills)).toHaveLength(1);
  });

  it('refuses restore when parked demand exceeds the book', () => {
    const ok = heldBillFitsStock(bill(), { p1: 3 }, () => 0);
    expect(ok).toEqual({ ok: true });
    const blocked = heldBillFitsStock(bill(), { p1: 5 }, () => 3);
    expect(blocked).toMatchObject({ ok: false, productId: 'p1', available: 2, needed: 3 });
  });

  it('normalizes legacy rows without status as parked', () => {
    expect(normalizeHeldBill({ id: 'x', items: [] })?.status).toBe('parked');
    expect(normalizeHeldBill({ id: 'x', items: [], status: 'open' })?.status).toBe('open');
    expect(normalizeHeldBill(null)).toBeNull();
  });
});
