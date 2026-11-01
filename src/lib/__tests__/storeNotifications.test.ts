import { describe, expect, it } from 'vitest';
import type { Cheque, Product } from '../../types';
import {
  buildStoreNotices,
  EXPIRY_NOTICE_DAYS,
  noticesBadgeCount,
  SUBSCRIPTION_NOTICE_DAYS,
} from '../storeNotifications';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 2, 12, 0, 0); // 2026-11-02

function product(overrides: Partial<Product> & Pick<Product, 'id' | 'name' | 'quantity'>): Product {
  return {
    type: 'product',
    currency: 'JOD',
    unitCost: 1,
    sellingPrice: 2,
    category: '',
    barcode: '',
    ...overrides,
  } as Product;
}

function cheque(overrides: Partial<Cheque>): Cheque {
  return {
    id: overrides.id || 'c1',
    chequeNumber: '1001',
    bankName: 'Arab Bank',
    amount: 100,
    currency: 'JOD',
    dueDate: '2026-11-02',
    type: 'incoming',
    status: 'pending',
    drawerName: 'Ahmad',
    contactType: 'customer',
    contactId: 'CUST_1',
    contactName: 'Ahmad',
    endorsedTo: '',
    notes: '',
    statusChangedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const empty = {
  products: [] as Product[],
  cheques: [] as Cheque[],
  today: '2026-11-02',
  now,
  offlinePending: 0,
  heldParked: 0,
  subscriptionDaysRemaining: null as number | null,
};

describe('buildStoreNotices', () => {
  it('returns nothing when books are quiet', () => {
    expect(buildStoreNotices(empty)).toEqual([]);
    expect(noticesBadgeCount([])).toBe(0);
  });

  it('aggregates stock out and low stock without inventing lines', () => {
    const notices = buildStoreNotices({
      ...empty,
      products: [
        product({ id: '1', name: 'A', quantity: 0 }),
        product({ id: '2', name: 'B', quantity: 0 }),
        product({ id: '3', name: 'C', quantity: 2, lowStockThreshold: 5 }),
        product({ id: '4', name: 'Asset', quantity: 0, type: 'asset' }),
      ],
      lowStockDefault: 3,
    });
    expect(notices.map((n) => n.kind)).toEqual(['stock_out', 'stock_low']);
    expect(notices[0].count).toBe(2);
    expect(notices[0].screen).toBe('inventory');
    expect(notices[1].count).toBe(1);
  });

  it('reports expired and soon-expiring items within the formal window', () => {
    const notices = buildStoreNotices({
      ...empty,
      products: [
        product({ id: '1', name: 'Old', quantity: 5, expiryDate: now - DAY_MS }),
        product({ id: '2', name: 'Soon', quantity: 5, expiryDate: now + 10 * DAY_MS }),
        product({ id: '3', name: 'Far', quantity: 5, expiryDate: now + (EXPIRY_NOTICE_DAYS + 5) * DAY_MS }),
      ],
    });
    const kinds = notices.map((n) => n.kind);
    expect(kinds).toContain('expiry_past');
    expect(kinds).toContain('expiry_soon');
    expect(notices.find((n) => n.kind === 'expiry_past')?.count).toBe(1);
    expect(notices.find((n) => n.kind === 'expiry_soon')?.count).toBe(1);
  });

  it('surfaces overdue and soon cheques from pending rows only', () => {
    const notices = buildStoreNotices({
      ...empty,
      cheques: [
        cheque({ id: 'a', dueDate: '2026-10-20' }),
        cheque({ id: 'b', dueDate: '2026-11-05' }),
        cheque({ id: 'c', dueDate: '2026-10-01', status: 'cashed' }),
      ],
    });
    expect(notices.find((n) => n.kind === 'cheque_overdue')?.count).toBe(1);
    expect(notices.find((n) => n.kind === 'cheque_soon')?.count).toBe(1);
    expect(notices.find((n) => n.kind === 'cheque_overdue')?.screen).toBe('cheques');
  });

  it('lists offline sales and held bills as device facts', () => {
    const notices = buildStoreNotices({
      ...empty,
      offlinePending: 3,
      heldParked: 2,
    });
    expect(notices.find((n) => n.kind === 'offline_sales')).toMatchObject({
      severity: 'critical',
      count: 3,
      screen: 'pos',
    });
    expect(notices.find((n) => n.kind === 'held_bills')).toMatchObject({
      severity: 'info',
      count: 2,
      screen: 'pos',
    });
  });

  it('reminds about subscription only inside the notice window', () => {
    expect(buildStoreNotices({ ...empty, subscriptionDaysRemaining: SUBSCRIPTION_NOTICE_DAYS + 1 })).toEqual([]);
    expect(buildStoreNotices({ ...empty, subscriptionDaysRemaining: 0 })).toEqual([]);
    expect(buildStoreNotices({ ...empty, subscriptionDaysRemaining: null })).toEqual([]);

    const soon = buildStoreNotices({ ...empty, subscriptionDaysRemaining: 5 });
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({
      kind: 'subscription_soon',
      severity: 'info',
      screen: 'settings',
      count: 5,
    });

    const urgent = buildStoreNotices({ ...empty, subscriptionDaysRemaining: 2 });
    expect(urgent[0].severity).toBe('attention');
  });

  it('orders critical notices before attention and info', () => {
    const notices = buildStoreNotices({
      ...empty,
      products: [product({ id: '1', name: 'A', quantity: 0 })],
      heldParked: 1,
      subscriptionDaysRemaining: 6,
    });
    expect(notices[0].severity).toBe('critical');
    expect(notices.map((n) => n.severity)).toEqual(['critical', 'info', 'info']);
  });

  it('badge equals distinct notice kinds, not raw item totals', () => {
    const notices = buildStoreNotices({
      ...empty,
      products: [
        product({ id: '1', name: 'A', quantity: 0 }),
        product({ id: '2', name: 'B', quantity: 0 }),
      ],
      offlinePending: 4,
    });
    expect(notices.reduce((sum, n) => sum + n.count, 0)).toBe(6);
    expect(noticesBadgeCount(notices)).toBe(2);
  });
});
