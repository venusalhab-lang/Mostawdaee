import { describe, expect, it } from 'vitest';
import type { Invoice, Shift } from '../../types';
import { canOpenShift, cashDifference, openShiftOf, shiftInvoices, summarizeShift } from '../shifts';
import { buildShiftReportHtml } from '../shiftReport';

const CASHIER = 'u-cashier';
const shift: Shift = { id: 's1', status: 'open', openedAt: 1000, currency: 'JOD', openingFloat: 50, actorId: CASHIER };

const sale = (id: string, extra: Partial<Invoice> = {}): Invoice => ({
  id,
  invoiceNumber: id,
  date: 2000,
  items: [],
  subtotal: 10,
  taxAmount: 0,
  totalAmount: 10,
  type: 'sale',
  currency: 'JOD',
  paymentMethod: 'cash',
  vaultPosted: true,
  actorId: CASHIER,
  ...extra,
});

describe('shiftInvoices', () => {
  it('keeps only this cashier’s sales and returns inside the shift window', () => {
    const list = [
      sale('in'),
      sale('before', { date: 999 }),
      sale('after', { date: 5001 }),
      sale('other-user', { actorId: 'u-other' }),
      sale('purchase', { type: 'purchase' }),
    ];
    expect(shiftInvoices({ ...shift, closedAt: 5000 }, list).map((i) => i.id)).toEqual(['in']);
  });

  it('includes everything up to now while the shift is open', () => {
    expect(shiftInvoices(shift, [sale('late', { date: 9000 })], 10_000)).toHaveLength(1);
    expect(shiftInvoices(shift, [sale('late', { date: 9000 })], 8000)).toHaveLength(0);
  });

  it('a shift without its opener matches nothing', () => {
    expect(shiftInvoices({ ...shift, actorId: undefined }, [sale('a')])).toEqual([]);
  });
});

describe('summarizeShift', () => {
  it('counts only cash into the drawer, and lists every payment method', () => {
    const [jod] = summarizeShift(shift, [
      sale('cash', { totalAmount: 12.5, discount: 1, taxAmount: 0.5 }),
      sale('card', { paymentMethod: 'card', totalAmount: 20, vaultPosted: false }),
      sale('wallet', { paymentMethod: 'wallet', totalAmount: 7, vaultPosted: false }),
      sale('credit', { paymentMethod: 'credit', totalAmount: 30, vaultPosted: false }),
    ], 9000);
    expect(jod).toMatchObject({
      currency: 'JOD',
      salesCount: 4,
      sales: 69.5,
      byMethod: { cash: 12.5, card: 20, wallet: 7, credit: 30 },
      discounts: 1,
      tax: 0.5,
      openingFloat: 50,
      cashSales: 12.5,
      cashRefunds: 0,
      expectedCash: 62.5,
    });
  });

  it('takes out only the cash paid back on returns', () => {
    const [jod] = summarizeShift(shift, [
      sale('s', { totalAmount: 40 }),
      sale('r-cash', { type: 'return', totalAmount: 15, refund: { vault: 15, vaultCurrency: 'JOD', debt: 0, external: 0 } }),
      sale('r-debt', { type: 'return', totalAmount: 5, refund: { vault: 0, vaultCurrency: 'JOD', debt: 5, external: 0 } }),
    ], 9000);
    expect(jod).toMatchObject({ returnsCount: 2, returns: 20, cashSales: 40, cashRefunds: 15, expectedCash: 75 });
  });

  it('keeps each currency apart and puts the shift currency first', () => {
    const totals = summarizeShift(shift, [
      sale('usd', { currency: 'USD', totalAmount: 9.99 }),
      sale('jod', { totalAmount: 1.234 }),
    ], 9000);
    expect(totals.map((t) => [t.currency, t.openingFloat, t.expectedCash])).toEqual([
      ['JOD', 50, 51.234],
      ['USD', 0, 9.99],
    ]);
  });

  it('a cash sale that did not reach the vault is not drawer cash', () => {
    const [jod] = summarizeShift(shift, [sale('x', { vaultPosted: false })], 9000);
    expect(jod.byMethod.cash).toBe(10);
    expect(jod.cashSales).toBe(0);
    expect(jod.expectedCash).toBe(50);
  });

  it('an empty shift still reports the opening float', () => {
    expect(summarizeShift(shift, [], 9000)).toEqual([expect.objectContaining({ currency: 'JOD', salesCount: 0, expectedCash: 50 })]);
  });
});

describe('cashDifference', () => {
  const [jod] = summarizeShift(shift, [sale('a', { totalAmount: 25 })], 9000);

  it('is counted minus expected', () => {
    expect(cashDifference(jod, { JOD: 75 })).toBe(0);
    expect(cashDifference(jod, { JOD: 70.5 })).toBe(-4.5);
    expect(cashDifference(jod, { JOD: 80 })).toBe(5);
  });

  it('is null when that currency was not counted', () => {
    expect(cashDifference(jod, { USD: 1 })).toBeNull();
    expect(cashDifference(jod, undefined)).toBeNull();
  });
});

describe('buildShiftReportHtml', () => {
  const money = (v: number, c: string) => `${v.toFixed(3)} ${c}`;
  const formatDate = (t: number) => `T${t}`;

  it('a closed shift prints a Z-report with the count and the shortage', () => {
    const closed: Shift = { ...shift, status: 'closed', closedAt: 5000, counted: { JOD: 58 }, userName: '<b>Ali</b>' };
    const totals = summarizeShift(closed, [sale('a')], 9000);
    const html = buildShiftReportHtml({ isAr: true, businessName: 'متجر', shift: closed, totals, money, formatDate });
    expect(html).toContain('تقرير إغلاق الوردية (Z)');
    expect(html).toContain('60.000 JOD');
    expect(html).toContain('58.000 JOD');
    expect(html).toContain('عجز');
    expect(html).toContain('2.000 JOD');
    expect(html).toContain('&lt;b&gt;Ali&lt;/b&gt;');
    expect(html).not.toContain('<b>Ali</b>');
  });

  it('an open shift prints an X-report without a count', () => {
    const html = buildShiftReportHtml({ isAr: false, businessName: 'Shop', shift, totals: summarizeShift(shift, [], 9000), money, formatDate });
    expect(html).toContain('Open shift report (X)');
    expect(html).not.toContain('Counted cash');
  });
});

describe('openShiftOf', () => {
  it('finds the newest open shift of this account only', () => {
    const list: Shift[] = [
      { ...shift, id: 'old', openedAt: 1 },
      { ...shift, id: 'new', openedAt: 5 },
      { ...shift, id: 'closed', status: 'closed', openedAt: 9 },
      { ...shift, id: 'theirs', actorId: 'u-other', openedAt: 10 },
    ];
    expect(openShiftOf(list, CASHIER)?.id).toBe('new');
    expect(openShiftOf(list, 'nobody')).toBeNull();
    expect(openShiftOf(list, undefined)).toBeNull();
  });
});

describe('canOpenShift', () => {
  it('blocks a second open shift for the same cashier', () => {
    const list: Shift[] = [{ ...shift, id: 'open-1' }];
    expect(canOpenShift(list, CASHIER, 'open-1')).toBe(true);
    expect(canOpenShift(list, CASHIER, 'open-2')).toBe(false);
    expect(canOpenShift([{ ...shift, id: 'open-1', status: 'closed' }], CASHIER, 'open-2')).toBe(true);
    expect(canOpenShift(list, undefined, 'open-2')).toBe(false);
  });
});

describe('legacy dual-open window', () => {
  it('stops an older open shift before the newer one starts so sales are not double-counted', () => {
    const older = { ...shift, id: 'old', openedAt: 1000 };
    const newer = { ...shift, id: 'new', openedAt: 5000 };
    const all = [older, newer];
    const mid = sale('mid', { date: 3000, totalAmount: 20 });
    const late = sale('late', { date: 6000, totalAmount: 30 });
    expect(shiftInvoices(older, [mid, late], 10_000, all).map((i) => i.id)).toEqual(['mid']);
    expect(shiftInvoices(newer, [mid, late], 10_000, all).map((i) => i.id)).toEqual(['late']);
    const [oldSum] = summarizeShift(older, [mid, late], 10_000, all);
    expect(oldSum.cashSales).toBe(20);
    const [newSum] = summarizeShift(newer, [mid, late], 10_000, all);
    expect(newSum.cashSales).toBe(30);
  });
});
