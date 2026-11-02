import { describe, expect, it } from 'vitest';
import type { Cheque, Customer, Invoice, Shift, Vault, VaultTransaction } from '../../types';
import { buildDayCloseSnapshot } from '../dayClose';

const day = new Date(2026, 10, 3, 15, 0, 0); // 3 Nov 2026 local
const now = day.getTime();
const morning = new Date(2026, 10, 3, 9, 0, 0).getTime();
const yesterday = new Date(2026, 10, 2, 18, 0, 0).getTime();

const sale = (id: string, extra: Partial<Invoice> = {}): Invoice => ({
  id,
  invoiceNumber: id,
  date: morning,
  items: [],
  subtotal: 10,
  taxAmount: 0,
  totalAmount: 10,
  type: 'sale',
  currency: 'JOD',
  paymentMethod: 'cash',
  vaultPosted: true,
  actorId: 'c1',
  ...extra,
});

describe('buildDayCloseSnapshot', () => {
  it('sums today’s sales across cashiers and ignores other days', () => {
    const snap = buildDayCloseSnapshot({
      invoices: [
        sale('a'),
        sale('b', { actorId: 'c2', totalAmount: 5, subtotal: 5, paymentMethod: 'card' }),
        sale('old', { date: yesterday }),
      ],
      vault: { currentBalance: 100, balanceJOD: 100, lastUpdated: now } as Vault,
      vaultTransactions: [],
      customers: [],
      cheques: [],
      shifts: [],
      fallbackCurrency: 'JOD',
      now,
    });
    expect(snap.dayIso).toBe('2026-11-03');
    expect(snap.sales).toHaveLength(1);
    expect(snap.sales[0].salesCount).toBe(2);
    expect(snap.sales[0].sales).toBe(15);
    expect(snap.sales[0].byMethod.cash).toBe(10);
    expect(snap.sales[0].byMethod.card).toBe(5);
  });

  it('lists vault flows and cashed cheques for the local day only', () => {
    const txs: VaultTransaction[] = [
      {
        id: 'v1',
        type: 'income',
        category: 'sale',
        amount: 10,
        currency: 'JOD',
        timestamp: morning,
        balanceAfter: 110,
      },
      {
        id: 'v2',
        type: 'expense',
        category: 'other',
        amount: 3,
        currency: 'JOD',
        timestamp: yesterday,
        balanceAfter: 100,
      },
    ];
    const cheques: Cheque[] = [
      {
        id: 'ch1',
        chequeNumber: '1',
        bankName: 'Bank',
        amount: 40,
        currency: 'JOD',
        dueDate: '2026-11-01',
        type: 'incoming',
        status: 'cashed',
        drawerName: 'A',
        contactType: null,
        contactId: null,
        contactName: '',
        endorsedTo: '',
        notes: '',
        statusChangedAt: new Date(morning).toISOString(),
        createdAt: new Date(yesterday).toISOString(),
      },
      {
        id: 'ch2',
        chequeNumber: '2',
        bankName: 'Bank',
        amount: 9,
        currency: 'JOD',
        dueDate: '2026-10-01',
        type: 'incoming',
        status: 'pending',
        drawerName: 'B',
        contactType: null,
        contactId: null,
        contactName: '',
        endorsedTo: '',
        notes: '',
        statusChangedAt: null,
        createdAt: new Date(yesterday).toISOString(),
      },
    ];
    const customers: Customer[] = [
      { id: 'cu1', name: 'Ali', phone: '', totalDebt: 20, currency: 'JOD' } as Customer,
    ];
    const shifts: Shift[] = [
      { id: 's1', status: 'open', openedAt: morning, currency: 'JOD', openingFloat: 0, actorId: 'c1', userName: 'Cashier' },
    ];

    const snap = buildDayCloseSnapshot({
      invoices: [],
      vault: { currentBalance: 100, balanceJOD: 100, lastUpdated: now } as Vault,
      vaultTransactions: txs,
      customers,
      cheques,
      shifts,
      fallbackCurrency: 'JOD',
      now,
    });

    expect(snap.vaultFlows).toEqual([{ currency: 'JOD', income: 10, expense: 0 }]);
    expect(snap.chequesCashedToday.count).toBe(1);
    expect(snap.chequesCashedToday.byCurrency.JOD).toBe(40);
    expect(snap.chequesOverduePending).toBe(1);
    expect(snap.debts.count).toBe(1);
    expect(snap.openShifts).toHaveLength(1);
  });
});
