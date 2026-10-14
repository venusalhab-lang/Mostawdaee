import type { Currency, Invoice, Shift, ShiftCurrencyTotals } from '../types';
import { roundMoney } from './exchangeRates';
import { planInvoiceVaultEntry } from './vaultMath';

type Method = keyof ShiftCurrencyTotals['byMethod'];

function emptyTotals(currency: Currency): ShiftCurrencyTotals {
  return {
    currency,
    salesCount: 0,
    sales: 0,
    byMethod: { cash: 0, card: 0, wallet: 0, credit: 0 },
    discounts: 0,
    tax: 0,
    returnsCount: 0,
    returns: 0,
    openingFloat: 0,
    cashSales: 0,
    cashRefunds: 0,
    expectedCash: 0,
  };
}

/** Invoices the shift's cashier recorded between opening and closing (or `now` while it is open). */
export function shiftInvoices(shift: Pick<Shift, 'actorId' | 'openedAt' | 'closedAt'>, invoices: Invoice[], now = Date.now()): Invoice[] {
  if (!shift.actorId) return [];
  const end = shift.closedAt ?? now;
  return invoices.filter((inv) =>
    (inv.type === 'sale' || inv.type === 'return')
    && inv.actorId === shift.actorId
    && Number(inv.date) >= shift.openedAt
    && Number(inv.date) <= end);
}

/**
 * Sales, returns and the cash the drawer should hold, one entry per currency.
 * Cash follows the vault: a cash sale adds its total, a return takes out only what was paid back in cash.
 * Card, wallet and credit sales are listed but never counted as drawer cash.
 */
export function summarizeShift(
  shift: Pick<Shift, 'actorId' | 'openedAt' | 'closedAt' | 'currency' | 'openingFloat'>,
  invoices: Invoice[],
  now = Date.now(),
): ShiftCurrencyTotals[] {
  const byCurrency = new Map<Currency, ShiftCurrencyTotals>();
  const totals = (currency: Currency) => {
    let entry = byCurrency.get(currency);
    if (!entry) {
      entry = emptyTotals(currency);
      byCurrency.set(currency, entry);
    }
    return entry;
  };
  totals(shift.currency).openingFloat = Math.max(0, Number(shift.openingFloat) || 0);

  for (const inv of shiftInvoices(shift, invoices, now)) {
    const currency = (inv.currency || shift.currency) as Currency;
    const amount = Number(inv.totalAmount) || 0;
    if (inv.type === 'sale') {
      const t = totals(currency);
      t.salesCount += 1;
      t.sales += amount;
      t.discounts += Number(inv.discount) || 0;
      t.tax += Number(inv.taxAmount) || 0;
      const method: Method = inv.paymentMethod || 'cash';
      t.byMethod[method] += amount;
      const cash = inv.vaultPosted === false ? null : planInvoiceVaultEntry(inv);
      if (cash) totals(cash.currency).cashSales += cash.amount;
    } else {
      const t = totals(currency);
      t.returnsCount += 1;
      t.returns += amount;
      const refunded = Number(inv.refund?.vault) || 0;
      if (refunded > 0) totals((inv.refund?.vaultCurrency || currency) as Currency).cashRefunds += refunded;
    }
  }

  const round = (value: number, currency: Currency) => roundMoney(value, currency);
  return [...byCurrency.values()]
    .map((t) => {
      const c = t.currency;
      const byMethod = {
        cash: round(t.byMethod.cash, c),
        card: round(t.byMethod.card, c),
        wallet: round(t.byMethod.wallet, c),
        credit: round(t.byMethod.credit, c),
      };
      const openingFloat = round(t.openingFloat, c);
      const cashSales = round(t.cashSales, c);
      const cashRefunds = round(t.cashRefunds, c);
      return {
        ...t,
        sales: round(t.sales, c),
        byMethod,
        discounts: round(t.discounts, c),
        tax: round(t.tax, c),
        returns: round(t.returns, c),
        openingFloat,
        cashSales,
        cashRefunds,
        expectedCash: round(openingFloat + cashSales - cashRefunds, c),
      };
    })
    .sort((a, b) => (a.currency === shift.currency ? -1 : b.currency === shift.currency ? 1 : a.currency.localeCompare(b.currency)));
}

/** Counted minus expected: positive is extra cash, negative is a shortage. Null when that currency was not counted. */
export function cashDifference(totals: ShiftCurrencyTotals, counted: Shift['counted']): number | null {
  const value = counted?.[totals.currency];
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return null;
  return roundMoney(Number(value) - totals.expectedCash, totals.currency);
}

/** The open shift of this account, newest first if several were left open on different devices. */
export function openShiftOf(shifts: Shift[], actorId: string | undefined): Shift | null {
  if (!actorId) return null;
  return shifts
    .filter((s) => s.status === 'open' && s.actorId === actorId)
    .sort((a, b) => b.openedAt - a.openedAt)[0] || null;
}
