import type { Cheque, Currency, Customer, Invoice, Shift, Vault, VaultTransaction } from '../types';
import { roundMoney } from './exchangeRates';
import { localDayEnd, localIsoDate } from './localDate';
import { outstandingDebts, startOfLocalDay } from './homeDesk';
import { isOverdue } from './cheques';
import { planInvoiceVaultEntry, readVaultBalances } from './vaultMath';
import { openShiftOf } from './shifts';

export type DayCloseMethodTotals = {
  cash: number;
  card: number;
  wallet: number;
  credit: number;
};

export type DayCloseCurrencySales = {
  currency: Currency;
  salesCount: number;
  sales: number;
  returnsCount: number;
  returns: number;
  net: number;
  byMethod: DayCloseMethodTotals;
};

export type DayCloseVaultFlow = {
  currency: string;
  income: number;
  expense: number;
};

export type DayCloseSnapshot = {
  dayStart: number;
  asOf: number;
  /** YYYY-MM-DD in the device zone. */
  dayIso: string;
  sales: DayCloseCurrencySales[];
  vaultBalances: Record<string, number>;
  vaultFlows: DayCloseVaultFlow[];
  debts: { count: number; rows: { currency: string; amount: number }[] };
  chequesCashedToday: { count: number; byCurrency: Record<string, number> };
  chequesOverduePending: number;
  openShifts: Array<{ id: string; label: string; openedAt: number }>;
  shiftsClosedToday: number;
};

function emptyMethods(): DayCloseMethodTotals {
  return { cash: 0, card: 0, wallet: 0, credit: 0 };
}

function inDay(ts: number, start: number, end: number): boolean {
  return Number.isFinite(ts) && ts >= start && ts <= end;
}

function chequeChangedAtMs(cheque: Cheque): number | null {
  if (!cheque.statusChangedAt) return null;
  const ms = Date.parse(cheque.statusChangedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Read-only store day close: sales (all cashiers), live vault, today's vault flows,
 * outstanding AR, cheques cashed today, overdue pending cheques, open drawer counts.
 * Never invents an "expected vault" from sales.
 */
export function buildDayCloseSnapshot(input: {
  invoices: Invoice[];
  vault: Vault | null;
  vaultTransactions: VaultTransaction[];
  customers: Customer[];
  cheques: Cheque[];
  shifts: Shift[];
  fallbackCurrency: string;
  now?: number;
}): DayCloseSnapshot {
  const now = input.now ?? Date.now();
  const dayStart = startOfLocalDay(now);
  const dayIso = localIsoDate(now);
  const byCurrency = new Map<Currency, DayCloseCurrencySales>();

  const bucket = (currency: Currency): DayCloseCurrencySales => {
    let row = byCurrency.get(currency);
    if (!row) {
      row = {
        currency,
        salesCount: 0,
        sales: 0,
        returnsCount: 0,
        returns: 0,
        net: 0,
        byMethod: emptyMethods(),
      };
      byCurrency.set(currency, row);
    }
    return row;
  };

  for (const inv of input.invoices) {
    if (inv.type !== 'sale' && inv.type !== 'return') continue;
    const ts = Number(inv.date);
    if (!inDay(ts, dayStart, now)) continue;
    const currency = (inv.currency || input.fallbackCurrency) as Currency;
    const row = bucket(currency);
    const total = roundMoney(Number(inv.totalAmount) || 0, currency);

    if (inv.type === 'return') {
      row.returnsCount += 1;
      row.returns = roundMoney(row.returns + total, currency);
      row.net = roundMoney(row.net - total, currency);
      continue;
    }

    row.salesCount += 1;
    row.sales = roundMoney(row.sales + total, currency);
    row.net = roundMoney(row.net + total, currency);

    const method = (inv.paymentMethod || 'cash') as keyof DayCloseMethodTotals;
    if (method in row.byMethod) {
      // Credit / split: attribute only the cash slice that hit the vault when posted.
      if (method === 'cash' || method === 'card' || method === 'wallet') {
        row.byMethod[method] = roundMoney(row.byMethod[method] + total, currency);
      } else if (method === 'credit') {
        const plan = planInvoiceVaultEntry(inv);
        const cashSlice = plan && plan.currency === currency ? plan.amount : 0;
        const onCredit = roundMoney(Math.max(0, total - cashSlice), currency);
        if (cashSlice > 0) row.byMethod.cash = roundMoney(row.byMethod.cash + cashSlice, currency);
        row.byMethod.credit = roundMoney(row.byMethod.credit + onCredit, currency);
      }
    }
  }

  const balances = readVaultBalances(input.vault);
  const flowMap = new Map<string, DayCloseVaultFlow>();
  for (const tx of input.vaultTransactions) {
    if (!inDay(Number(tx.timestamp), dayStart, now)) continue;
    const currency = tx.currency || input.fallbackCurrency;
    let flow = flowMap.get(currency);
    if (!flow) {
      flow = { currency, income: 0, expense: 0 };
      flowMap.set(currency, flow);
    }
    const amount = roundMoney(Number(tx.amount) || 0, currency);
    if (tx.type === 'income') flow.income = roundMoney(flow.income + amount, currency);
    else flow.expense = roundMoney(flow.expense + amount, currency);
  }

  const debtsRaw = outstandingDebts(
    input.customers.map((c) => ({
      id: c.id,
      name: c.name,
      totalDebt: Number(c.totalDebt) || 0,
      currency: c.currency || input.fallbackCurrency,
    })),
    input.fallbackCurrency,
  );

  const cashedBy: Record<string, number> = {};
  let cashedCount = 0;
  for (const cheque of input.cheques) {
    if (cheque.status !== 'cashed') continue;
    const ms = chequeChangedAtMs(cheque);
    if (ms === null || !inDay(ms, dayStart, now)) continue;
    cashedCount += 1;
    const code = cheque.currency || input.fallbackCurrency;
    cashedBy[code] = roundMoney((cashedBy[code] || 0) + (Number(cheque.amount) || 0), code);
  }

  let overdue = 0;
  for (const cheque of input.cheques) {
    if (isOverdue(cheque, dayIso)) overdue += 1;
  }

  const openShifts = input.shifts
    .filter((s) => s.status === 'open')
    .map((s) => ({
      id: s.id,
      label: s.userName || s.actorEmail || s.actorId || s.id,
      openedAt: s.openedAt,
    }))
    .sort((a, b) => a.openedAt - b.openedAt);

  const dayEndMs = localDayEnd(dayIso) ?? now;
  const shiftsClosedToday = input.shifts.filter(
    (s) => s.status === 'closed' && s.closedAt != null && inDay(s.closedAt, dayStart, Math.min(now, dayEndMs)),
  ).length;

  return {
    dayStart,
    asOf: now,
    dayIso,
    sales: [...byCurrency.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.currency.localeCompare(b.currency)),
    vaultBalances: balances,
    vaultFlows: [...flowMap.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    debts: {
      count: debtsRaw.count,
      rows: debtsRaw.rows.map((r) => ({ currency: r.currency, amount: r.current })),
    },
    chequesCashedToday: { count: cashedCount, byCurrency: cashedBy },
    chequesOverduePending: overdue,
    openShifts,
    shiftsClosedToday,
  };
}

/** Convenience: whether any cashier still has an open drawer count. */
export function hasOpenDrawerCounts(shifts: Shift[], actorId?: string): boolean {
  if (actorId) return !!openShiftOf(shifts, actorId);
  return shifts.some((s) => s.status === 'open');
}
