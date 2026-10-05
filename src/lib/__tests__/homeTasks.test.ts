import { describe, expect, it } from 'vitest';
import { type HomeTaskInput, homeTasks } from '../homeTasks';

const DAY = 24 * 60 * 60 * 1000;
// Monday 5 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 5, 10, 0, 0).getTime();
const ymd = (offsetDays: number) => {
  const d = new Date(NOW + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const base = (patch: Partial<HomeTaskInput> = {}): HomeTaskInput => ({
  now: NOW,
  storeCurrency: 'JOD',
  products: [],
  globalLowStock: 5,
  cheques: [],
  customers: [],
  customerTransactions: [],
  payroll: [],
  pendingUploads: 0,
  ...patch,
});

describe('home tasks', () => {
  it('a quiet store has nothing to do', () => {
    expect(homeTasks(base({ products: [{ name: 'Tea', quantity: 50 }] }))).toEqual([]);
  });

  it('cheques due within 7 days, overdue first, totals kept per currency', () => {
    const tasks = homeTasks(base({
      cheques: [
        { type: 'incoming', status: 'pending', amount: 300, currency: 'JOD', dueDate: ymd(5), contactName: 'Ali' },
        { type: 'incoming', status: 'pending', amount: 100.5, currency: 'JOD', dueDate: ymd(-2), contactName: 'Sami' },
        { type: 'incoming', status: 'pending', amount: 1000, currency: 'ILS', dueDate: ymd(1), drawerName: 'Bank client' },
        { type: 'incoming', status: 'pending', amount: 999, currency: 'JOD', dueDate: ymd(8) },
        { type: 'incoming', status: 'cashed', amount: 999, currency: 'JOD', dueDate: ymd(0) },
        { type: 'outgoing', status: 'pending', amount: 250, currency: 'JOD', dueDate: ymd(3), contactName: 'Supplier' },
      ],
    }));
    const incoming = tasks.find((t) => t.kind === 'cheques_in')!;
    expect(incoming).toMatchObject({ severity: 'urgent', count: 3, overdue: 1, names: ['Sami', 'Bank client', 'Ali'] });
    expect(incoming.money).toEqual([{ currency: 'JOD', amount: 400.5 }, { currency: 'ILS', amount: 1000 }]);
    expect(tasks.find((t) => t.kind === 'cheques_out')).toMatchObject({ severity: 'soon', count: 1, overdue: 0 });
  });

  it('shows no cheque task when cheques could not be read', () => {
    expect(homeTasks(base({ cheques: null })).some((t) => t.kind.startsWith('cheques'))).toBe(false);
  });

  it('stock: out of stock and expiring within 7 days are urgent, low stock can wait; assets are ignored', () => {
    const tasks = homeTasks(base({
      products: [
        { name: 'Milk', quantity: 4, expiryDate: NOW + 2 * DAY },
        { name: 'Yogurt', quantity: 10, expiryDate: NOW - DAY },
        { name: 'Cheese', quantity: 10, expiryDate: NOW + 20 * DAY },
        { name: 'Rice', quantity: 0 },
        { name: 'Shelf', quantity: 0, type: 'asset' },
        { name: 'Sugar', quantity: 3 },
      ],
    }));
    expect(tasks.map((t) => t.kind)).toEqual(['out_of_stock', 'expiring', 'low_stock']);
    expect(tasks[0].names).toEqual(['Rice']);
    expect(tasks[1]).toMatchObject({ count: 2, overdue: 1, names: ['Yogurt', 'Milk'] });
    expect(tasks[2].names).toEqual(['Milk', 'Sugar']);
  });

  it('debts with no payment for 30 days, oldest first', () => {
    const tasks = homeTasks(base({
      customers: [
        { id: 'a', name: 'Paid recently', totalDebt: 50, currency: 'JOD' },
        { id: 'b', name: 'Never paid', totalDebt: 80, currency: 'JOD' },
        { id: 'c', name: 'Old payer', totalDebt: 200, currency: 'ILS' },
        { id: 'd', name: 'Settled', totalDebt: 0, currency: 'JOD' },
        { id: 'e', name: 'New account', totalDebt: 10, currency: 'JOD', createdAt: new Date(NOW - 3 * DAY).toISOString() },
      ],
      customerTransactions: [
        { customerId: 'a', type: 'invoice', date: new Date(NOW - 90 * DAY).toISOString() },
        { customerId: 'a', type: 'payment', date: new Date(NOW - 5 * DAY).toISOString() },
        { customerId: 'b', type: 'invoice', date: new Date(NOW - 45 * DAY).toISOString() },
        { customerId: 'c', type: 'payment', date: new Date(NOW - 60 * DAY).toISOString() },
        { customerId: 'd', type: 'invoice', date: new Date(NOW - 99 * DAY).toISOString() },
      ],
    }));
    const debts = tasks.find((t) => t.kind === 'stale_debts')!;
    expect(debts.names).toEqual(['Old payer', 'Never paid']);
    expect(debts.money).toEqual([{ currency: 'JOD', amount: 80 }, { currency: 'ILS', amount: 200 }]);
  });

  it('payroll due by today, hidden when the role cannot see salaries', () => {
    const payroll = [
      { employeeName: 'Omar', netSalary: 400, currency: 'JOD' as const, paymentStatus: 'pending', paymentDate: NOW - 3 * DAY },
      { employeeName: 'Huda', netSalary: 350, paymentStatus: 'pending', paymentDate: NOW + 2 * 60 * 60 * 1000 },
      { employeeName: 'Later', netSalary: 999, paymentStatus: 'pending', paymentDate: NOW + 3 * DAY },
      { employeeName: 'Done', netSalary: 999, paymentStatus: 'paid', paymentDate: NOW - DAY },
    ];
    expect(homeTasks(base({ payroll })).find((t) => t.kind === 'payroll_due'))
      .toMatchObject({ count: 2, overdue: 1, names: ['Omar', 'Huda'], money: [{ currency: 'JOD', amount: 750 }] });
    expect(homeTasks(base({ payroll: null })).some((t) => t.kind === 'payroll_due')).toBe(false);
  });

  it('unsent offline sales come first', () => {
    const tasks = homeTasks(base({ pendingUploads: 2, products: [{ name: 'Rice', quantity: 0 }] }));
    expect(tasks.map((t) => t.kind)).toEqual(['pending_uploads', 'out_of_stock']);
  });
});
