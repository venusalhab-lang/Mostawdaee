import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../types';
import { saleLogRows, sellerName, sellerOf, sellerSummaries, type SellerContext } from '../salesLog';

const OWNER = 'owner-id';
const CASHIER = 'cashier-id';

const ctx = (userId: string, pending: string[] = []): SellerContext => ({
  userId,
  userEmail: userId === OWNER ? 'Owner@Shop.com' : 'manager@shop.com',
  ownerId: OWNER,
  ownerEmail: 'owner@shop.com',
  pendingIds: new Set(pending),
});

const sale = (id: string, date: number, extra: Partial<Invoice> = {}): Invoice => ({
  id,
  invoiceNumber: id,
  date,
  items: [],
  subtotal: 0,
  taxAmount: 0,
  totalAmount: 10,
  type: 'sale',
  currency: 'JOD',
  ...extra,
});

describe('sellerOf', () => {
  it('names the stamped seller, and the viewer as "you"', () => {
    const byCashier = sale('a', 1, { actorId: CASHIER, actorEmail: 'cashier@shop.com' });
    expect(sellerOf(byCashier, ctx(OWNER))).toEqual({ key: CASHIER, kind: 'member', email: 'cashier@shop.com' });
    expect(sellerOf(sale('b', 1, { actorId: OWNER }), ctx(OWNER)).kind).toBe('you');
  });

  it('a manager sees the owner by the store owner email when the sale predates the email stamp', () => {
    expect(sellerOf(sale('c', 1, { actorId: OWNER }), ctx('manager-id'))).toEqual({ key: OWNER, kind: 'owner', email: 'owner@shop.com' });
  });

  it('a sale still waiting on this device is the viewer\'s own; an unstamped old sale is "not recorded"', () => {
    expect(sellerOf(sale('d', 1), ctx(OWNER, ['d'])).kind).toBe('you');
    expect(sellerOf(sale('e', 1), ctx(OWNER)).kind).toBe('unknown');
    expect(sellerName(sellerOf(sale('e', 1), ctx(OWNER)), true)).toBe('غير مسجّل');
  });
});

describe('saleLogRows and sellerSummaries', () => {
  const invoices = [
    sale('old', 50, { actorId: CASHIER }),
    sale('buy', 150, { type: 'purchase', actorId: OWNER }),
    sale('s1', 120, { actorId: CASHIER, actorEmail: 'cashier@shop.com', totalAmount: 2.5 }),
    sale('s2', 180, { actorId: CASHIER, actorEmail: 'cashier@shop.com', totalAmount: 1.25, currency: 'USD' }),
    sale('s3', 160, { actorId: OWNER, totalAmount: 7 }),
    sale('s4', 140, { actorId: CASHIER, actorEmail: 'cashier@shop.com', totalAmount: 0.1 }),
  ];

  it('keeps sales of the period only, newest first', () => {
    expect(saleLogRows(invoices, 100, 200, ctx(OWNER)).map((row) => row.invoice.id)).toEqual(['s2', 's3', 's4', 's1']);
  });

  it('counts each seller and totals each currency on its own', () => {
    const summaries = sellerSummaries(saleLogRows(invoices, 100, 200, ctx(OWNER)), 'JOD');
    expect(summaries).toEqual([
      { seller: { key: CASHIER, kind: 'member', email: 'cashier@shop.com' }, count: 3, totals: [{ currency: 'USD', amount: 1.25 }, { currency: 'JOD', amount: 2.6 }] },
      { seller: { key: OWNER, kind: 'you', email: 'owner@shop.com' }, count: 1, totals: [{ currency: 'JOD', amount: 7 }] },
    ]);
  });
});
