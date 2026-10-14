import { beforeEach, describe, expect, it } from 'vitest';
import { belongsToStore, canQueueOffline, enqueueInvoice, isOfflineError, localSaleShortages, readQueue, writeQueue } from '../offlineQueue';
import type { Invoice, Product } from '../../types';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1', invoiceNumber: 'POS-1', date: 1, type: 'sale', currency: 'JOD',
  items: [{ productId: 'p1', description: 'شاي', quantity: 2, unitPrice: 1, total: 2 }],
  subtotal: 2, taxAmount: 0, totalAmount: 2, paymentMethod: 'cash', ...over,
});

const product = (qty: number): Product => ({
  id: 'p1', name: 'شاي', sku: 'T', category: '', brand: '', quantity: qty, unitCost: 0.5, sellingPrice: 1, status: 'In Stock', dateAdded: 0,
});

describe('offline queue', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
  });

  it('treats only connection failures as offline', () => {
    expect(isOfflineError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isOfflineError({ code: 'offline' })).toBe(true);
    expect(isOfflineError({ code: 'aborted', message: 'conflict' })).toBe(false);
    expect(isOfflineError({ code: 'permission-denied', message: 'permission denied' })).toBe(false);
  });

  it('only lets cash-type sales wait for the network', () => {
    expect(canQueueOffline({ type: 'sale', paymentMethod: 'cash' })).toBe(true);
    expect(canQueueOffline({ type: 'sale', paymentMethod: undefined })).toBe(true);
    expect(canQueueOffline({ type: 'sale', paymentMethod: 'credit' })).toBe(false);
    expect(canQueueOffline({ type: 'purchase', paymentMethod: 'cash' })).toBe(false);
  });

  it('queues an invoice once even if saved twice', () => {
    expect(enqueueInvoice('u1', invoice())).toBe(true);
    expect(enqueueInvoice('u1', invoice())).toBe(true);
    expect(readQueue('u1')).toHaveLength(1);
  });

  it('remembers the store a sale was taken in and sends it only there', () => {
    expect(enqueueInvoice('u1', invoice({ id: 'a' }), 'owner-1')).toBe(true);
    const [entry] = readQueue('u1');
    expect(entry.storeId).toBe('owner-1');
    expect(belongsToStore(entry, 'owner-1')).toBe(true);
    expect(belongsToStore(entry, 'u1')).toBe(false);
    expect(belongsToStore({}, 'u1')).toBe(true);
  });

  it('reads invoices queued by the previous app version', () => {
    localStorage.setItem('mustawdae:u1:offline_invoices', JSON.stringify([invoice({ id: 'old' })]));
    const [entry] = readQueue('u1');
    expect(entry.invoice.id).toBe('old');
    expect(entry.attempts).toBe(0);
  });

  it('reports a failed write instead of pretending the sale was kept', () => {
    (globalThis as any).localStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    expect(writeQueue('u1', [{ invoice: invoice(), queuedAt: 1, attempts: 0 }])).toBe(false);
    expect(enqueueInvoice('u1', invoice())).toBe(false);
  });

  it('checks local stock per product across lines', () => {
    const twoLines = invoice({ items: [
      { productId: 'p1', description: 'شاي', quantity: 2, unitPrice: 1, total: 2 },
      { productId: 'p1', description: 'شاي', quantity: 2, unitPrice: 1, total: 2 },
    ] });
    expect(localSaleShortages(twoLines, [product(3)])).toEqual([{ productId: 'p1', name: 'شاي', available: 3, requested: 4 }]);
    expect(localSaleShortages(twoLines, [product(4)])).toEqual([]);
    expect(localSaleShortages(invoice(), [])).toHaveLength(1);
  });
});
