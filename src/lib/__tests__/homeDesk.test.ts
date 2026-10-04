import { describe, expect, it } from 'vitest';
import {
  amountInCurrency,
  asideMoney,
  chartCurrency,
  compareAmounts,
  creditRows,
  dailyTotals,
  mergeCurrencyTotals,
  outstandingDebts,
  periodWindow,
  recentActivity,
  salesCount,
  salesPulse,
  salesPulseGauge,
  salesRows,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  stockSnapshot,
  sumByCurrency,
  systemMoneyRow,
} from '../homeDesk';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe('home desk periods', () => {
  it('compares today with the same clock time yesterday', () => {
    const now = at(2026, 10, 7, 15, 30);
    const window = periodWindow('day', now);
    expect(window.start).toBe(startOfLocalDay(now));
    expect(window.end).toBe(now);
    expect(window.previousEnd).toBe(at(2026, 10, 6, 15, 30));
  });

  it('starts the week on Saturday and compares the same elapsed time', () => {
    const wednesday = at(2026, 10, 7, 15, 0);
    expect(startOfLocalWeek(wednesday)).toBe(at(2026, 10, 3, 0, 0));
    const window = periodWindow('week', wednesday);
    expect(window.previousStart).toBe(at(2026, 9, 26, 0, 0));
    expect(window.previousEnd - window.previousStart).toBe(window.end - window.start);
  });

  it('compares the month with the same elapsed time last month', () => {
    const now = at(2026, 10, 2, 15, 0);
    const window = periodWindow('month', now);
    expect(window.start).toBe(startOfLocalMonth(now));
    expect(window.previousStart).toBe(at(2026, 9, 1, 0, 0));
    expect(window.previousEnd).toBe(at(2026, 9, 2, 15, 0));
  });
});

describe('home desk money', () => {
  it('keeps sale currencies apart and ignores purchases', () => {
    const invoices = [
      { id: '1', type: 'sale', totalAmount: 10, currency: 'JOD', date: at(2026, 10, 2, 10) },
      { id: '2', type: 'sale', totalAmount: 4, currency: 'ILS', date: at(2026, 10, 2, 11) },
      { id: '3', type: 'purchase', totalAmount: 99, currency: 'JOD', date: at(2026, 10, 2, 12) },
      { id: '4', type: 'sale', totalAmount: 3, currency: 'JOD', date: at(2026, 10, 1, 10), paymentMethod: 'credit' },
    ];
    const day = periodWindow('day', at(2026, 10, 2, 18));
    const sales = sumByCurrency(salesRows(invoices, 'JOD'), day.start, day.end, 'JOD');
    expect(sales).toEqual({ JOD: 10, ILS: 4 });
    const credit = sumByCurrency(creditRows(invoices, 'JOD'), day.previousStart, day.previousEnd, 'JOD');
    expect(credit.JOD).toBe(3);
  });

  it('follows the system currency and leaves other currencies beside it', () => {
    const invoices = [
      { id: '1', type: 'sale', totalAmount: 10, currency: 'JOD', date: at(2026, 10, 2, 10) },
      { id: '2', type: 'sale', totalAmount: 4, currency: 'ILS', date: at(2026, 10, 2, 11) },
      { id: '3', type: 'sale', totalAmount: 7, currency: 'EGP', date: at(2026, 10, 2, 12) },
    ];
    const day = periodWindow('day', at(2026, 10, 2, 18));
    const rows = salesRows(invoices, 'JOD');
    expect(amountInCurrency(rows, 'EGP', day.start, day.end)).toBe(7);
    expect(systemMoneyRow(rows, 'ILS', day.start, day.end, day.previousStart, day.previousEnd)).toEqual({
      currency: 'ILS',
      current: 4,
      previous: 0,
    });
    expect(asideMoney(rows, 'JOD', day.start, day.end, 'JOD').map((row) => row.currency).sort()).toEqual(['EGP', 'ILS']);
  });

  it('does not invent a percent when the previous period was zero', () => {
    expect(compareAmounts(12, 0)).toEqual({ tone: 'new', percent: null });
    expect(compareAmounts(8, 10).tone).toBe('down');
    expect(compareAmounts(8, 10).percent).toBe(-20);
  });

  it('colors the sales pulse from the same rounded ratio, without a baseline percent', () => {
    expect(salesPulse(0, 0)).toEqual({ tone: 'idle', percent: null });
    expect(salesPulse(12, 0)).toEqual({ tone: 'new', percent: null });
    expect(salesPulse(Number.NaN, Number.NaN)).toEqual({ tone: 'idle', percent: null });
    expect(salesPulse(100, 100)).toEqual({ tone: 'flat', percent: 0 });
    expect(salesPulse(109.4, 100)).toEqual({ tone: 'up', percent: 9 });
    expect(salesPulse(110, 100)).toEqual({ tone: 'strong-up', percent: 10 });
    expect(salesPulse(95, 100)).toEqual({ tone: 'down', percent: -5 });
    expect(salesPulse(90, 100)).toEqual({ tone: 'strong-down', percent: -10 });
    expect(salesPulse(8, 10)).toEqual({ tone: 'strong-down', percent: -20 });
    expect(salesPulse(90.5, 100).percent).toBe(Math.round(-9.5));
    expect(salesPulse(90.5, 100).tone).toBe('down');
  });

  it('places the dial from −100% at the lower left to +100% at the lower right', () => {
    expect(salesPulseGauge(null)).toEqual({ placed: false, clamped: null, angleDeg: null });
    expect(salesPulseGauge(Number.NaN).placed).toBe(false);
    expect(salesPulseGauge(0)).toEqual({ placed: true, clamped: 0, angleDeg: 270 });
    expect(salesPulseGauge(10).angleDeg).toBeCloseTo(283.5);
    expect(salesPulseGauge(-10).angleDeg).toBeCloseTo(256.5);
    expect(salesPulseGauge(100).angleDeg).toBe(405);
    expect(salesPulseGauge(-100).angleDeg).toBe(135);
    expect(salesPulseGauge(180)).toEqual({ placed: true, clamped: 100, angleDeg: 405 });
    expect(salesPulseGauge(-150)).toEqual({ placed: true, clamped: -100, angleDeg: 135 });
  });

  it('counts only non-zero sales in the system currency and window', () => {
    const rows = [
      { currency: 'JOD', amount: 10, ts: at(2026, 10, 2, 10) },
      { currency: 'JOD', amount: 0, ts: at(2026, 10, 2, 11) },
      { currency: 'ILS', amount: 4, ts: at(2026, 10, 2, 12) },
      { currency: 'JOD', amount: 3, ts: at(2026, 10, 1, 10) },
    ];
    const day = periodWindow('day', at(2026, 10, 2, 18));
    expect(salesCount(rows, 'JOD', day.start, day.end)).toBe(1);
    expect(salesCount(rows, 'ILS', day.start, day.end)).toBe(1);
    expect(salesCount(rows, 'JOD', day.previousStart, day.previousEnd)).toBe(1);
  });

  it('shows the store currency when the period has no sales', () => {
    expect(mergeCurrencyTotals({}, {}, 'EGP')).toEqual([{ currency: 'EGP', current: 0, previous: 0 }]);
    expect(chartCurrency([{ currency: 'ILS', current: 5, previous: 0 }], 'JOD')).toBe('ILS');
  });

  it('buckets one currency per day', () => {
    const rows = [
      { currency: 'JOD', amount: 2, ts: at(2026, 10, 2, 9) },
      { currency: 'JOD', amount: 3, ts: at(2026, 10, 2, 18) },
      { currency: 'USD', amount: 9, ts: at(2026, 10, 2, 18) },
    ];
    const points = dailyTotals(rows, 'JOD', at(2026, 10, 2, 0), at(2026, 10, 2, 20));
    expect(points).toHaveLength(1);
    expect(points[0].amount).toBe(5);
  });
});

describe('home desk exceptions', () => {
  it('separates out, low, and expiring goods', () => {
    const now = at(2026, 10, 2, 12);
    const snap = stockSnapshot([
      { id: 'a', name: 'نافد', quantity: 0 },
      { id: 'b', name: 'قليل', quantity: 2, lowStockThreshold: 5 },
      { id: 'c', name: 'قريب', quantity: 20, expiryDate: now + 5 * 86400000 },
      { id: 'd', name: 'أصل', quantity: 0, type: 'asset' },
      { id: 'e', name: 'سليم', quantity: 40, lowStockThreshold: 5 },
    ], 5, now);
    expect(snap.out.map((item) => item.id)).toEqual(['a']);
    expect(snap.low.map((item) => item.id)).toEqual(['b']);
    expect(snap.expiring.map((item) => item.id)).toEqual(['c']);
  });

  it('sums debts per currency and lists real movements only', () => {
    const debts = outstandingDebts([
      { id: '1', name: 'أحمد', totalDebt: 15, currency: 'JOD' },
      { id: '2', name: 'سارة', totalDebt: 0, currency: 'JOD' },
      { id: '3', name: 'ليلى', totalDebt: 4, currency: 'ILS' },
    ], 'JOD');
    expect(debts.count).toBe(2);
    expect(debts.rows.map((row) => row.currency).sort()).toEqual(['ILS', 'JOD']);

    const feed = recentActivity(
      [{ id: 'i1', type: 'sale', totalAmount: 10, currency: 'JOD', date: at(2026, 10, 2, 9), invoiceNumber: 'S-1' }],
      [{ id: 'v1', type: 'income', category: 'sale', source: 'sale_invoice', amount: 10, currency: 'JOD', timestamp: at(2026, 10, 2, 9) },
       { id: 'v2', type: 'expense', category: 'other', source: 'expense', amount: 3, currency: 'JOD', description: 'كهرباء', timestamp: at(2026, 10, 2, 11) }],
      [{ id: 's1', productName: 'حليب', delta: -2, reason: 'عجز جرد AUD', timestamp: at(2026, 10, 2, 12) },
       { id: 's2', productName: 'تعديل', delta: 1, reason: 'تالف', timestamp: at(2026, 10, 2, 13) }],
      'JOD',
    );
    expect(feed.map((item) => item.kind)).toEqual(['stocktake', 'vault', 'sale']);
    expect(feed[1].amount).toBe(-3);
  });
});
