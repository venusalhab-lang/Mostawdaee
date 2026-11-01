import { roundMoney } from './exchangeRates';
import { daysUntilExpiry, isLowStock } from './stock';
import { EXPIRY_HORIZON_DAYS, startOfLocalDay } from './homeDesk';

// What the merchant should act on today, built only from the store's own records.
// Money stays per currency: tasks carry one total per currency, never a mixed sum.

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHEQUE_HORIZON_DAYS = 7;
export { EXPIRY_HORIZON_DAYS };
export const STALE_DEBT_DAYS = 30;

export type TaskSeverity = 'urgent' | 'soon';

export type TaskKind =
  | 'pending_uploads'
  | 'cheques_in'
  | 'cheques_out'
  | 'out_of_stock'
  | 'expiring'
  | 'stale_debts'
  | 'payroll_due'
  | 'low_stock';

export interface TaskMoney {
  currency: string;
  amount: number;
}

export interface HomeTask {
  kind: TaskKind;
  severity: TaskSeverity;
  count: number;
  /** Up to three names, most pressing first. */
  names: string[];
  money: TaskMoney[];
  /** Overdue items inside the count (cheques past due, expired goods). */
  overdue: number;
  /** Screen that resolves the task; null when there is nothing to open (offline sales send themselves). */
  screen: string | null;
}

export interface TaskProduct {
  name: string;
  quantity: number;
  lowStockThreshold?: number;
  expiryDate?: number;
  type?: string;
}

export interface TaskCheque {
  type: 'incoming' | 'outgoing';
  status: string;
  amount: number;
  currency: string;
  /** YYYY-MM-DD */
  dueDate: string;
  contactName?: string;
  drawerName?: string;
}

export interface TaskCustomer {
  id: string;
  name: string;
  totalDebt: number;
  currency?: string;
  createdAt?: string;
}

export interface TaskCustomerTransaction {
  customerId: string;
  type: 'invoice' | 'payment' | string;
  date: string;
}

export interface TaskPayroll {
  employeeName?: string;
  netSalary: number;
  currency?: string;
  paymentStatus: 'pending' | 'paid' | string;
  paymentDate: number;
}

export interface HomeTaskInput {
  now: number;
  storeCurrency: string;
  products: TaskProduct[];
  globalLowStock?: number | null;
  /** null when cheques could not be read (no access, or not installed): no cheque task is shown. */
  cheques: TaskCheque[] | null;
  customers: TaskCustomer[];
  customerTransactions: TaskCustomerTransaction[];
  /** null when this role does not see salaries. */
  payroll: TaskPayroll[] | null;
  pendingUploads: number;
}

function addMoney(totals: Map<string, number>, currency: string, amount: number) {
  totals.set(currency, roundMoney((totals.get(currency) || 0) + amount, currency));
}

function moneyList(totals: Map<string, number>, storeCurrency: string): TaskMoney[] {
  return [...totals.entries()]
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => (a === storeCurrency ? -1 : b === storeCurrency ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => ({ currency, amount }));
}

/** Local midnight of a YYYY-MM-DD date, or NaN. */
function localDay(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return Number.NaN;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

function chequeTask(kind: 'cheques_in' | 'cheques_out', cheques: TaskCheque[], input: HomeTaskInput): HomeTask | null {
  const today = startOfLocalDay(input.now);
  const horizon = today + CHEQUE_HORIZON_DAYS * DAY_MS;
  const due = cheques
    .filter((c) => c.status === 'pending' && c.type === (kind === 'cheques_in' ? 'incoming' : 'outgoing'))
    .map((c) => ({ c, day: localDay(c.dueDate) }))
    .filter(({ day }) => Number.isFinite(day) && day <= horizon)
    .sort((a, b) => a.day - b.day);
  if (due.length === 0) return null;
  const totals = new Map<string, number>();
  for (const { c } of due) addMoney(totals, c.currency || input.storeCurrency, Number(c.amount) || 0);
  const overdue = due.filter(({ day }) => day < today).length;
  const dueToday = due.filter(({ day }) => day <= today).length;
  return {
    kind,
    severity: dueToday > 0 ? 'urgent' : 'soon',
    count: due.length,
    names: due.slice(0, 3).map(({ c }) => c.contactName || c.drawerName || '').filter(Boolean),
    money: moneyList(totals, input.storeCurrency),
    overdue,
    screen: 'cheques',
  };
}

function staleDebts(input: HomeTaskInput): HomeTask | null {
  const lastPayment = new Map<string, number>();
  const firstCharge = new Map<string, number>();
  for (const tx of input.customerTransactions) {
    const at = Date.parse(tx.date);
    if (!Number.isFinite(at)) continue;
    if (tx.type === 'payment') {
      lastPayment.set(tx.customerId, Math.max(lastPayment.get(tx.customerId) ?? 0, at));
    } else {
      firstCharge.set(tx.customerId, Math.min(firstCharge.get(tx.customerId) ?? Infinity, at));
    }
  }
  const cutoff = input.now - STALE_DEBT_DAYS * DAY_MS;
  const stale = input.customers
    .filter((customer) => (Number(customer.totalDebt) || 0) > 0)
    .map((customer) => {
      const createdAt = Date.parse(customer.createdAt || '');
      const since = lastPayment.get(customer.id)
        ?? firstCharge.get(customer.id)
        ?? (Number.isFinite(createdAt) ? createdAt : null);
      return { customer, since };
    })
    .filter((row): row is { customer: TaskCustomer; since: number } => row.since !== null && row.since <= cutoff)
    .sort((a, b) => a.since - b.since);
  if (stale.length === 0) return null;
  const totals = new Map<string, number>();
  for (const { customer } of stale) addMoney(totals, customer.currency || input.storeCurrency, Number(customer.totalDebt) || 0);
  return {
    kind: 'stale_debts',
    severity: 'soon',
    count: stale.length,
    names: stale.slice(0, 3).map(({ customer }) => customer.name),
    money: moneyList(totals, input.storeCurrency),
    overdue: 0,
    screen: 'customers',
  };
}

function payrollDue(input: HomeTaskInput): HomeTask | null {
  if (!input.payroll) return null;
  const endOfToday = startOfLocalDay(input.now) + DAY_MS;
  const due = input.payroll
    .filter((p) => p.paymentStatus === 'pending' && Number(p.paymentDate) < endOfToday)
    .sort((a, b) => a.paymentDate - b.paymentDate);
  if (due.length === 0) return null;
  const totals = new Map<string, number>();
  for (const p of due) addMoney(totals, p.currency || input.storeCurrency, Number(p.netSalary) || 0);
  return {
    kind: 'payroll_due',
    severity: 'soon',
    count: due.length,
    names: due.slice(0, 3).map((p) => p.employeeName || '').filter(Boolean),
    money: moneyList(totals, input.storeCurrency),
    overdue: due.filter((p) => p.paymentDate < startOfLocalDay(input.now)).length,
    screen: 'employees',
  };
}

const ORDER: TaskKind[] = [
  'pending_uploads', 'cheques_in', 'cheques_out', 'out_of_stock', 'expiring', 'payroll_due', 'stale_debts', 'low_stock',
];

export function homeTasks(input: HomeTaskInput): HomeTask[] {
  const tasks: HomeTask[] = [];
  const goods = input.products.filter((p) => p.type !== 'asset');

  if (input.pendingUploads > 0) {
    tasks.push({ kind: 'pending_uploads', severity: 'urgent', count: input.pendingUploads, names: [], money: [], overdue: 0, screen: null });
  }

  if (input.cheques) {
    for (const kind of ['cheques_in', 'cheques_out'] as const) {
      const task = chequeTask(kind, input.cheques, input);
      if (task) tasks.push(task);
    }
  }

  const out = goods.filter((p) => (Number(p.quantity) || 0) <= 0);
  if (out.length > 0) {
    tasks.push({ kind: 'out_of_stock', severity: 'urgent', count: out.length, names: out.slice(0, 3).map((p) => p.name), money: [], overdue: 0, screen: 'inventory' });
  }

  const expiring = goods
    .map((p) => ({ p, days: daysUntilExpiry(p.expiryDate, input.now) }))
    .filter((row): row is { p: TaskProduct; days: number } =>
      row.days !== null && row.days <= EXPIRY_HORIZON_DAYS && (Number(row.p.quantity) || 0) > 0)
    .sort((a, b) => a.days - b.days);
  if (expiring.length > 0) {
    tasks.push({
      kind: 'expiring',
      severity: 'urgent',
      count: expiring.length,
      names: expiring.slice(0, 3).map(({ p }) => p.name),
      money: [],
      overdue: expiring.filter(({ days }) => days <= 0).length,
      screen: 'inventory',
    });
  }

  const payroll = payrollDue(input);
  if (payroll) tasks.push(payroll);

  const debts = staleDebts(input);
  if (debts) tasks.push(debts);

  const low = goods.filter((p) => {
    const quantity = Number(p.quantity) || 0;
    return quantity > 0 && isLowStock(quantity, p.lowStockThreshold, input.globalLowStock);
  });
  if (low.length > 0) {
    tasks.push({ kind: 'low_stock', severity: 'soon', count: low.length, names: low.slice(0, 3).map((p) => p.name), money: [], overdue: 0, screen: 'inventory' });
  }

  return tasks.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'urgent' ? -1 : 1) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
