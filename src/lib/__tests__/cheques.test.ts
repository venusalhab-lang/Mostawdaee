import { describe, expect, it } from 'vitest';
import type { Cheque, ChequeInput } from '../../types';
import {
  allowedTransitions,
  appendNote,
  canTransition,
  chequePaymentPlan,
  daysUntilDue,
  dueCounts,
  dueFilters,
  filterCheques,
  isOverdue,
  isValidDate,
  summarizeCheques,
  validateChequeInput,
} from '../cheques';

function cheque(overrides: Partial<Cheque>): Cheque {
  return {
    id: overrides.id || 'c1',
    chequeNumber: '1001',
    bankName: 'Bank of Palestine',
    amount: 100,
    currency: 'ILS',
    dueDate: '2026-10-10',
    type: 'incoming',
    status: 'pending',
    drawerName: 'Ahmad',
    contactType: 'customer',
    contactId: 'CUST_2026_1',
    contactName: 'Ahmad',
    endorsedTo: '',
    notes: '',
    statusChangedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const input: ChequeInput = {
  chequeNumber: '1001',
  bankName: 'Arab Bank',
  amount: 250.5,
  currency: 'JOD',
  dueDate: '2026-11-01',
  type: 'incoming',
  drawerName: 'Ahmad',
  contactType: 'customer',
  contactId: 'CUST_2026_1',
  contactName: 'Ahmad',
  notes: '',
};

describe('cheque status rules', () => {
  it('lets a received cheque be cashed, bounced, endorsed or returned', () => {
    expect(allowedTransitions('incoming', 'pending')).toEqual(['cashed', 'bounced', 'endorsed', 'returned']);
  });

  it('never endorses an outgoing cheque', () => {
    expect(canTransition('outgoing', 'pending', 'endorsed')).toBe(false);
    expect(allowedTransitions('outgoing', 'pending')).toEqual(['cashed', 'bounced', 'returned']);
  });

  it('allows a bounced cheque to be re-deposited or returned only', () => {
    expect(allowedTransitions('incoming', 'bounced')).toEqual(['pending', 'returned']);
  });

  it('treats cashed, endorsed and returned as final', () => {
    for (const status of ['cashed', 'endorsed', 'returned'] as const) {
      expect(allowedTransitions('incoming', status)).toEqual([]);
    }
  });
});

describe('validateChequeInput', () => {
  it('accepts a complete cheque', () => {
    expect(validateChequeInput(input)).toBeNull();
  });

  it('rejects zero, negative and amounts that round to zero', () => {
    expect(validateChequeInput({ ...input, amount: 0 })).toBe('amount');
    expect(validateChequeInput({ ...input, amount: -5 })).toBe('amount');
    expect(validateChequeInput({ ...input, amount: Number.NaN })).toBe('amount');
    expect(validateChequeInput({ ...input, currency: 'IQD', amount: 0.4 })).toBe('amount');
  });

  it('rejects impossible dates and unknown currencies', () => {
    expect(validateChequeInput({ ...input, dueDate: '2026-02-30' })).toBe('dueDate');
    expect(validateChequeInput({ ...input, currency: 'EUR' as never })).toBe('currency');
    expect(isValidDate('2028-02-29')).toBe(true);
  });

  it('requires a picked customer when the contact is a customer', () => {
    expect(validateChequeInput({ ...input, contactId: null })).toBe('contact');
    expect(validateChequeInput({ ...input, contactType: 'supplier', contactId: null, contactName: 'Supplier' })).toBeNull();
  });
});

describe('summarizeCheques', () => {
  it('keeps each currency separate and rounds to its minor unit', () => {
    const totals = summarizeCheques([
      cheque({ id: 'a', amount: 0.1, currency: 'JOD' }),
      cheque({ id: 'b', amount: 0.2, currency: 'JOD' }),
      cheque({ id: 'c', amount: 50, currency: 'ILS' }),
      cheque({ id: 'd', amount: 70, currency: 'ILS', status: 'cashed' }),
      cheque({ id: 'e', amount: 30, currency: 'USD', status: 'bounced' }),
      cheque({ id: 'f', amount: 999, currency: 'USD', status: 'endorsed' }),
    ]);
    expect(totals.pending.get('JOD')).toBe(0.3);
    expect(totals.pending.get('ILS')).toBe(50);
    expect(totals.cashed.get('ILS')).toBe(70);
    expect(totals.bounced.get('USD')).toBe(30);
    expect(totals.counts).toEqual({ pending: 3, cashed: 1, bounced: 1 });
  });
});

describe('filterCheques', () => {
  const rows = [
    cheque({ id: 'a', chequeNumber: '1', bankName: 'Arab Bank', dueDate: '2026-10-05' }),
    cheque({ id: 'b', chequeNumber: '2', bankName: 'arab bank ', dueDate: '2026-10-20', status: 'cashed' }),
    cheque({ id: 'c', chequeNumber: '3', bankName: 'Cairo Amman', dueDate: '2026-11-01' }),
    cheque({ id: 'd', chequeNumber: '4', type: 'outgoing', dueDate: '2026-10-01' }),
  ];
  const none = { status: 'all' as const, bank: '', from: '', to: '', search: '' };

  it('shows only the active tab, sorted by due date', () => {
    expect(filterCheques(rows, 'incoming', none).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by status, bank (case-insensitive) and an inclusive date range', () => {
    expect(filterCheques(rows, 'incoming', { ...none, status: 'cashed' }).map((row) => row.id)).toEqual(['b']);
    expect(filterCheques(rows, 'incoming', { ...none, bank: 'Arab Bank' }).map((row) => row.id)).toEqual(['a', 'b']);
    expect(filterCheques(rows, 'incoming', { ...none, from: '2026-10-05', to: '2026-10-20' }).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('flags only pending cheques past their due date', () => {
    expect(isOverdue(rows[0], '2026-10-06')).toBe(true);
    expect(isOverdue(rows[1], '2026-12-01')).toBe(false);
    expect(isOverdue(rows[0], '2026-10-05')).toBe(false);
  });
});

describe('booking a cashed cheque on the customer account', () => {
  it('reduces the debt in the same currency', () => {
    expect(chequePaymentPlan({ amount: 250.5, currency: 'JOD' }, { totalDebt: 1000, currency: 'JOD' }))
      .toEqual({ ok: true, debtBefore: 1000, debtAfter: 749.5 });
  });

  it('refuses another currency instead of guessing a rate', () => {
    expect(chequePaymentPlan({ amount: 100, currency: 'ILS' }, { totalDebt: 1000, currency: 'JOD' }))
      .toEqual({ ok: false, reason: 'currency', debtBefore: 1000 });
  });

  it('refuses a cheque larger than the debt or a customer with nothing owed', () => {
    expect(chequePaymentPlan({ amount: 1000.001, currency: 'JOD' }, { totalDebt: 1000, currency: 'JOD' })).toMatchObject({ ok: false, reason: 'exceeds' });
    expect(chequePaymentPlan({ amount: 10, currency: 'JOD' }, { totalDebt: 0, currency: 'JOD' })).toMatchObject({ ok: false, reason: 'no_debt' });
  });

  it('appends a line to existing notes', () => {
    expect(appendNote('', 'سبب الرجوع: الرصيد غير كافٍ')).toBe('سبب الرجوع: الرصيد غير كافٍ');
    expect(appendNote('دفعة أولى ', 'سبب')).toBe('دفعة أولى\nسبب');
    expect(appendNote('ملاحظة', '  ')).toBe('ملاحظة');
  });
});

describe('due dates', () => {
  it('counts calendar days across month ends and leap days', () => {
    expect(daysUntilDue('2026-10-12', '2026-10-09')).toBe(3);
    expect(daysUntilDue('2026-10-09', '2026-10-09')).toBe(0);
    expect(daysUntilDue('2026-09-30', '2026-10-02')).toBe(-2);
    expect(daysUntilDue('2028-03-01', '2028-02-28')).toBe(2);
    expect(daysUntilDue('2026-02-30', '2026-02-01')).toBeNull();
  });

  it('counts overdue and due-within-a-week pending cheques only', () => {
    const list = [
      cheque({ id: 'late', dueDate: '2026-10-08' }),
      cheque({ id: 'today', dueDate: '2026-10-09' }),
      cheque({ id: 'week', dueDate: '2026-10-16' }),
      cheque({ id: 'later', dueDate: '2026-10-17' }),
      cheque({ id: 'cashed', dueDate: '2026-10-01', status: 'cashed' }),
    ];
    expect(dueCounts(list, '2026-10-09')).toEqual({ overdue: 1, soon: 2 });
  });

  it('builds filters that select exactly those cheques', () => {
    const list = [
      cheque({ id: 'late', dueDate: '2026-10-08' }),
      cheque({ id: 'today', dueDate: '2026-10-09' }),
      cheque({ id: 'week', dueDate: '2026-10-16' }),
      cheque({ id: 'later', dueDate: '2026-10-17' }),
    ];
    expect(filterCheques(list, 'incoming', dueFilters('overdue', '2026-10-09')).map((row) => row.id)).toEqual(['late']);
    expect(filterCheques(list, 'incoming', dueFilters('soon', '2026-10-09')).map((row) => row.id)).toEqual(['today', 'week']);
  });
});
