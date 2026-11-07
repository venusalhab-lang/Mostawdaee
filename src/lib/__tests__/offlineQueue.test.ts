import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyQueuedSalesToProducts,
  applyQueuedSalesToVault,
  belongsToStore,
  canDeferSaleToQueue,
  canQueueOffline,
  enqueueInvoice,
  isOfflineError,
  localSaleShortages,
  mergeQueuedInvoices,
  mergeQueuedVaultRecords,
  readQueue,
  writeQueue,
} from '../offlineQueue';
import { buildVaultDoc } from '../vaultMath';
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
    const offlineNav = typeof navigator !== 'undefined' ? navigator : undefined;
    try {
      Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
      expect(isOfflineError({ code: 'insufficient-stock', message: 'Insufficient stock' })).toBe(false);
      expect(isOfflineError({ code: 'permission-denied', message: 'permission denied' })).toBe(false);
    } finally {
      if (offlineNav) Object.defineProperty(globalThis, 'navigator', { value: offlineNav, configurable: true });
    }
    expect(isOfflineError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isOfflineError({ code: 'offline' })).toBe(true);
    expect(isOfflineError({ message: 'Request timed out' })).toBe(true);
    expect(isOfflineError({ code: 'aborted', message: 'conflict' })).toBe(false);
    expect(isOfflineError({ code: 'permission-denied', message: 'permission denied' })).toBe(false);
  });

  it('defers cash sales when the session cannot refresh without the network', () => {
    expect(canDeferSaleToQueue({ code: 'unauthenticated' })).toBe(true);
    expect(canDeferSaleToQueue({ code: 'offline' })).toBe(true);
    expect(canDeferSaleToQueue({ code: 'aborted' })).toBe(false);
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
    expect(belongsToStore({}, 'u1')).toBe(false);
    expect(belongsToStore({ storeId: '' }, 'u1')).toBe(false);
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

  it('ignores free/service lines in the local stock check', () => {
    const mixed = invoice({
      items: [
        { productId: 'p1', description: 'شاي', quantity: 2, unitPrice: 1, total: 2 },
        { productId: 'adhoc:fee', description: 'خدمة', quantity: 9, unitPrice: 5, total: 45, adhoc: true },
      ],
    });
    expect(localSaleShortages(mixed, [product(2)])).toEqual([]);
    expect(localSaleShortages(invoice({
      items: [{ productId: 'adhoc:only', description: 'خدمة', quantity: 1, unitPrice: 10, total: 10, adhoc: true }],
    }), [])).toEqual([]);
  });

  it('keeps queued sales on top of a server snapshot so stock and invoices stay honest until sync', () => {
    enqueueInvoice('u1', invoice({ id: 'offline-1', invoiceNumber: 'POS-9' }), 'owner-1');
    const queue = readQueue('u1');
    expect(mergeQueuedInvoices([{ ...invoice({ id: 'server-1' }) }], queue, 'owner-1').map((i) => i.id).sort())
      .toEqual(['offline-1', 'server-1']);
    expect(applyQueuedSalesToProducts([product(10)], queue, 'owner-1')[0].quantity).toBe(8);
    const vault = applyQueuedSalesToVault(
      buildVaultDoc({ JOD: 5, ILS: 0, USD: 0, IQD: 0, SAR: 0, AED: 0, LYD: 0, EGP: 0 }),
      queue,
      'owner-1',
    ) as { balanceJOD: number };
    expect(vault.balanceJOD).toBe(7);
    expect(mergeQueuedVaultRecords([], queue, 'owner-1')[0].id).toBe('inv-offline-1');
    const withBalance = mergeQueuedVaultRecords(
      [],
      queue,
      'owner-1',
      buildVaultDoc({ JOD: 5, ILS: 0, USD: 0, IQD: 0, SAR: 0, AED: 0, LYD: 0, EGP: 0 }),
    );
    expect(withBalance[0].balanceAfter).toBe(7);
  });

  it('applies the queue only once on top of a raw server cache (never on an already-merged cache)', () => {
    enqueueInvoice('u1', invoice({ id: 'offline-1' }), 'owner-1');
    const queue = readQueue('u1');
    const server = [product(10)];
    const once = applyQueuedSalesToProducts(server, queue, 'owner-1');
    expect(once[0].quantity).toBe(8);
    // Persisting `once` then applying the queue again would understate stock — cache must stay raw.
    expect(applyQueuedSalesToProducts(once, queue, 'owner-1')[0].quantity).toBe(6);
  });

  it('ignores queued sales from another store when merging snapshots', () => {
    enqueueInvoice('u1', invoice({ id: 'other' }), 'other-owner');
    expect(applyQueuedSalesToProducts([product(10)], readQueue('u1'), 'owner-1')[0].quantity).toBe(10);
    expect(mergeQueuedInvoices([], readQueue('u1'), 'owner-1')).toEqual([]);
  });

  it('skips queue entries already on the server so sync snapshots cannot double-apply stock', () => {
    enqueueInvoice('u1', invoice({ id: 'synced' }), 'owner-1');
    enqueueInvoice('u1', invoice({ id: 'still-offline', items: [{ productId: 'p1', description: 'شاي', quantity: 1, unitPrice: 1, total: 1 }], totalAmount: 1 }), 'owner-1');
    const queue = readQueue('u1');
    // Server already deducted `synced`; exclude it when re-applying the queue.
    expect(applyQueuedSalesToProducts([product(10)], queue, 'owner-1', ['synced'])[0].quantity).toBe(9);
    expect(mergeQueuedInvoices([invoice({ id: 'synced' })], queue, 'owner-1').map((i) => i.id).sort())
      .toEqual(['still-offline', 'synced']);
  });
});
