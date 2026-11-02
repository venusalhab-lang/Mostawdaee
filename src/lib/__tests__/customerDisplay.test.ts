import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCustomerDisplayLines,
  idleCustomerDisplaySnapshot,
  isCustomerDisplayHash,
  publishCustomerDisplay,
  readCustomerDisplaySnapshot,
} from '../customerDisplay';
import type { InvoiceItem } from '../../types';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);
vi.stubGlobal('window', { localStorage: storage });
vi.stubGlobal(
  'BroadcastChannel',
  class {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage() {}
    close() {}
  },
);

describe('customerDisplay', () => {
  afterEach(() => storage.clear());

  it('detects the customer-display hash route', () => {
    expect(isCustomerDisplayHash('#/customer-display')).toBe(true);
    expect(isCustomerDisplayHash('#/customer-display/')).toBe(true);
    expect(isCustomerDisplayHash('#/pos')).toBe(false);
    expect(isCustomerDisplayHash('')).toBe(false);
  });

  it('builds customer lines without costs', () => {
    const items: InvoiceItem[] = [
      { productId: 'a', description: 'Tea', quantity: 2, unitPrice: 1.5, total: 3, unitCost: 0.4, costCurrency: 'JOD' },
      { productId: 'b', description: 'Box', quantity: 1, unitPrice: 10, total: 10, packSize: 12, packName: 'كرتون' },
    ];
    const lines = buildCustomerDisplayLines(items, 'ar');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: 'Tea', quantityLabel: '2', total: 3 });
    expect(JSON.stringify(lines)).not.toMatch(/unitCost|0\.4/);
    expect(lines[1].quantityLabel).toContain('كرتون');
  });

  it('round-trips a snapshot through storage publish', () => {
    const snap = idleCustomerDisplaySnapshot({
      language: 'ar',
      businessName: 'محل التجربة',
      currency: 'JOD',
      storeKey: 'store-1',
    });
    publishCustomerDisplay(snap);
    const read = readCustomerDisplaySnapshot();
    expect(read?.businessName).toBe('محل التجربة');
    expect(read?.status).toBe('idle');
    expect(read?.v).toBe(1);
  });
});
