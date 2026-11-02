import { roundMoney } from './exchangeRates';
import { daysUntilExpiry, isLowStock } from './stock';

export type HomeRange = 'day' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MoneyRow {
  currency: string;
  current: number;
  previous: number;
}

export interface AmountComparison {
  tone: 'up' | 'down' | 'flat' | 'new';
  percent: number | null;
}

export interface DeskInvoice {
  id: string;
  invoiceNumber?: string;
  type: 'sale' | 'purchase' | string;
  totalAmount: number;
  currency?: string;
  date: number;
  paymentMethod?: string;
  customerName?: string;
  supplierName?: string;
}

export interface DeskVaultMovement {
  id: string;
  type: 'income' | 'expense' | string;
  category?: string;
  amount: number;
  currency?: string;
  description?: string;
  timestamp: number;
  source?: string;
}

export interface DeskStockMovement {
  id: string;
  productName: string;
  delta: number;
  reason?: string;
  timestamp: number;
}

export interface DeskProduct {
  id: string;
  name: string;
  quantity: number;
  lowStockThreshold?: number;
  expiryDate?: number;
  type?: string;
}

export interface DeskCustomer {
  id: string;
  name: string;
  totalDebt: number;
  currency?: string;
}

export interface DeskActivity {
  id: string;
  kind: 'sale' | 'purchase' | 'return' | 'stocktake' | 'vault';
  title: string;
  detail: string;
  amount: number | null;
  currency: string;
  timestamp: number;
  screen: 'invoices' | 'inventory-audit' | 'vault';
}

export function startOfLocalDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Levant merchant week: Saturday 00:00 through Friday. */
export function startOfLocalWeek(ts: number): number {
  const start = startOfLocalDay(ts);
  const weekday = new Date(start).getDay();
  const daysSinceSaturday = (weekday + 1) % 7;
  return start - daysSinceSaturday * DAY_MS;
}

export function startOfLocalMonth(ts: number): number {
  const date = new Date(startOfLocalDay(ts));
  date.setDate(1);
  return date.getTime();
}

export interface PeriodWindow {
  start: number;
  end: number;
  previousStart: number;
  previousEnd: number;
}

/** Current period against the same elapsed length of the previous period. */
export function periodWindow(range: HomeRange, now: number): PeriodWindow {
  if (range === 'day') {
    const start = startOfLocalDay(now);
    return { start, end: now, previousStart: start - DAY_MS, previousEnd: now - DAY_MS };
  }
  if (range === 'week') {
    const start = startOfLocalWeek(now);
    const length = Math.max(0, now - start);
    const previousStart = start - 7 * DAY_MS;
    return { start, end: now, previousStart, previousEnd: previousStart + length };
  }
  const start = startOfLocalMonth(now);
  const previousStart = startOfLocalMonth(start - DAY_MS);
  const length = Math.max(0, now - start);
  const previousLength = start - previousStart;
  return {
    start,
    end: now,
    previousStart,
    previousEnd: previousStart + Math.min(length, Math.max(0, previousLength - 1)),
  };
}

export function compareAmounts(current: number, previous: number): AmountComparison {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (c === 0 && p === 0) return { tone: 'flat', percent: 0 };
  if (p === 0) return { tone: 'new', percent: null };
  const percent = Math.round(((c - p) / Math.abs(p)) * 100);
  if (percent === 0) return { tone: 'flat', percent: 0 };
  return { tone: percent > 0 ? 'up' : 'down', percent };
}

/**
 * A drop or rise of this size is a material move on the sales pulse.
 * The percent itself stays the rounded ratio; this constant only chooses the color band.
 */
export const SALES_PULSE_MATERIAL_PERCENT = 10;

export type SalesPulseTone = 'strong-up' | 'up' | 'flat' | 'down' | 'strong-down' | 'idle' | 'new';

export interface SalesPulse {
  tone: SalesPulseTone;
  /** Null when there is no comparable baseline. Otherwise the rounded percent change. */
  percent: number | null;
}

/**
 * Like-for-like sales pulse for one currency.
 * Percent is round((current - previous) / |previous| × 100), the same ratio as compareAmounts.
 * Idle (both zero) and new (previous zero) do not invent a percent.
 * Color bands: rise, limited drop under 10%, clear drop of 10% or more.
 */
/** The dial shows −100% to +100%. A larger ratio stays in the center label and the needle rests at the rim. */
export const SALES_GAUGE_LIMIT_PERCENT = 100;
export const SALES_GAUGE_START_DEG = 135;
export const SALES_GAUGE_SWEEP_DEG = 270;

export interface SalesGauge {
  /** False when there is no percent, so the dial must not pretend to point somewhere. */
  placed: boolean;
  /** Percent limited to ±100 for the dial only. */
  clamped: number | null;
  /** SVG angle: 0° is to the right, clockwise. Null when the needle is hidden. */
  angleDeg: number | null;
}

/**
 * Maps a sales-pulse percent onto a 270° dial.
 * −100% sits at 135° (lower left), 0% at the top, +100% at 45° (lower right).
 */
export function salesPulseGauge(percent: number | null): SalesGauge {
  if (percent === null || !Number.isFinite(percent)) {
    return { placed: false, clamped: null, angleDeg: null };
  }
  const clamped = Math.max(-SALES_GAUGE_LIMIT_PERCENT, Math.min(SALES_GAUGE_LIMIT_PERCENT, percent));
  const angleDeg = SALES_GAUGE_START_DEG
    + ((clamped + SALES_GAUGE_LIMIT_PERCENT) / (SALES_GAUGE_LIMIT_PERCENT * 2)) * SALES_GAUGE_SWEEP_DEG;
  return { placed: true, clamped, angleDeg };
}

export function salesPulse(current: number, previous: number): SalesPulse {
  const c = Number.isFinite(Number(current)) ? Number(current) : 0;
  const p = Number.isFinite(Number(previous)) ? Number(previous) : 0;
  if (c === 0 && p === 0) return { tone: 'idle', percent: null };
  if (p === 0) return { tone: 'new', percent: null };
  const percent = Math.round(((c - p) / Math.abs(p)) * 100);
  if (percent === 0) return { tone: 'flat', percent: 0 };
  if (percent >= SALES_PULSE_MATERIAL_PERCENT) return { tone: 'strong-up', percent };
  if (percent > 0) return { tone: 'up', percent };
  if (percent <= -SALES_PULSE_MATERIAL_PERCENT) return { tone: 'strong-down', percent };
  return { tone: 'down', percent };
}

/** Non-zero sale rows already denominated in one currency. */
export function salesCount(
  rows: { currency?: string; amount: number; ts: number }[],
  currency: string,
  start: number,
  end: number,
): number {
  let count = 0;
  for (const row of rows) {
    if ((row.currency || currency) !== currency || !inWindow(row.ts, start, end)) continue;
    if ((Number(row.amount) || 0) === 0) continue;
    count += 1;
  }
  return count;
}

function inWindow(ts: number, start: number, end: number): boolean {
  return Number.isFinite(ts) && ts >= start && ts <= end;
}

export function sumByCurrency(
  rows: { currency?: string; amount: number; ts: number }[],
  start: number,
  end: number,
  fallbackCurrency: string,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    if (!inWindow(row.ts, start, end)) continue;
    const amount = Number(row.amount) || 0;
    if (amount === 0) continue;
    const currency = row.currency || fallbackCurrency;
    totals[currency] = roundMoney((totals[currency] || 0) + amount, currency);
  }
  return totals;
}

/** Sum of amounts already denominated in one currency. Other currencies are not converted. */
export function amountInCurrency(
  rows: { currency?: string; amount: number; ts: number }[],
  currency: string,
  start: number,
  end: number,
): number {
  return rows.reduce((sum, row) => {
    if ((row.currency || currency) !== currency || !inWindow(row.ts, start, end)) return sum;
    return roundMoney(sum + (Number(row.amount) || 0), currency);
  }, 0);
}

export function systemMoneyRow(
  rows: { currency?: string; amount: number; ts: number }[],
  currency: string,
  start: number,
  end: number,
  previousStart: number,
  previousEnd: number,
): MoneyRow {
  return {
    currency,
    current: amountInCurrency(rows, currency, start, end),
    previous: amountInCurrency(rows, currency, previousStart, previousEnd),
  };
}

/** Amounts in the window that are not in the system currency, kept in their own currency. */
export function asideMoney(
  rows: { currency?: string; amount: number; ts: number }[],
  systemCurrency: string,
  start: number,
  end: number,
  fallbackCurrency: string,
): MoneyRow[] {
  return mergeCurrencyTotals(sumByCurrency(rows, start, end, fallbackCurrency), {}, fallbackCurrency)
    .filter((row) => row.currency !== systemCurrency && row.current !== 0);
}

export function mergeCurrencyTotals(
  current: Record<string, number>,
  previous: Record<string, number>,
  fallbackCurrency: string,
): MoneyRow[] {
  const codes = new Set([...Object.keys(current), ...Object.keys(previous)]);
  if (codes.size === 0) codes.add(fallbackCurrency);
  return [...codes]
    .map((currency) => ({
      currency,
      current: current[currency] || 0,
      previous: previous[currency] || 0,
    }))
    .sort((a, b) => Math.abs(b.current) - Math.abs(a.current) || a.currency.localeCompare(b.currency));
}

/** Net sales: a return counts against the day it was recorded. */
export function salesRows(invoices: DeskInvoice[], fallbackCurrency: string) {
  return invoices
    .filter((invoice) => invoice.type === 'sale' || invoice.type === 'return')
    .map((invoice) => ({
      currency: invoice.currency || fallbackCurrency,
      amount: (invoice.type === 'return' ? -1 : 1) * (Number(invoice.totalAmount) || 0),
      ts: Number(invoice.date),
    }));
}

export function creditRows(invoices: DeskInvoice[], fallbackCurrency: string) {
  return invoices
    .filter((invoice) => (invoice.type === 'sale' || invoice.type === 'return') && invoice.paymentMethod === 'credit')
    .map((invoice) => ({
      currency: invoice.currency || fallbackCurrency,
      amount: (invoice.type === 'return' ? -1 : 1) * (Number(invoice.totalAmount) || 0),
      ts: Number(invoice.date),
    }));
}

export function vaultIncomeRows(movements: DeskVaultMovement[], fallbackCurrency: string) {
  return movements
    .filter((movement) => movement.type === 'income')
    .map((movement) => ({
      currency: movement.currency || fallbackCurrency,
      amount: Number(movement.amount) || 0,
      ts: Number(movement.timestamp),
    }));
}

export function dailyTotals(
  rows: { currency?: string; amount: number; ts: number }[],
  currency: string,
  start: number,
  end: number,
): { day: number; amount: number }[] {
  const points: { day: number; amount: number }[] = [];
  for (let day = startOfLocalDay(start); day <= end; day += DAY_MS) {
    const sliceEnd = Math.min(day + DAY_MS - 1, end);
    const amount = rows
      .filter((row) => (row.currency || currency) === currency && inWindow(row.ts, day, sliceEnd))
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    points.push({ day, amount: roundMoney(amount, currency) });
  }
  return points;
}

export interface SalesChartPoint {
  day: number;
  amount: number;
  /** Same index in the matching prior window (0 when that day had no sales). */
  previous: number;
}

/**
 * System-currency daily sales for the home chart, plus an aligned prior series.
 * Day view: last 7 local days vs the 7 days before them.
 * Week/month: current period window vs the matching previous window (same elapsed days).
 */
export function salesChartSeries(
  rows: { currency?: string; amount: number; ts: number }[],
  currency: string,
  range: HomeRange,
  now: number,
): SalesChartPoint[] {
  const window = periodWindow(range, now);
  const chartStart = range === 'day' ? startOfLocalDay(now) - 6 * DAY_MS : window.start;
  const current = dailyTotals(rows, currency, chartStart, now);
  const previous = range === 'day'
    ? dailyTotals(rows, currency, chartStart - current.length * DAY_MS, chartStart - 1)
    : dailyTotals(rows, currency, window.previousStart, window.previousEnd);
  return current.map((point, index) => ({
    day: point.day,
    amount: point.amount,
    previous: previous[index]?.amount ?? 0,
  }));
}

export function chartCurrency(rows: MoneyRow[], fallbackCurrency: string): string {
  const withSales = rows.find((row) => row.current !== 0);
  return withSales?.currency || fallbackCurrency;
}

export interface StockSnapshot {
  out: DeskProduct[];
  low: DeskProduct[];
  expiring: DeskProduct[];
}

/** Same horizon as today's expiry tasks — one meaning on the home desk. */
export const EXPIRY_HORIZON_DAYS = 7;

export function stockSnapshot(products: DeskProduct[], globalThreshold?: number | null, now = Date.now()): StockSnapshot {
  const goods = products.filter((product) => product.type !== 'asset');
  const out = goods.filter((product) => (Number(product.quantity) || 0) <= 0);
  const low = goods.filter((product) => {
    const quantity = Number(product.quantity) || 0;
    return quantity > 0 && isLowStock(quantity, product.lowStockThreshold, globalThreshold);
  });
  const expiring = goods.filter((product) => {
    const days = daysUntilExpiry(product.expiryDate, now);
    return days !== null && days <= EXPIRY_HORIZON_DAYS && (Number(product.quantity) || 0) > 0;
  });
  return { out, low, expiring };
}

export function outstandingDebts(customers: DeskCustomer[], fallbackCurrency: string): { count: number; rows: MoneyRow[] } {
  const owing = customers.filter((customer) => (Number(customer.totalDebt) || 0) > 0);
  const totals: Record<string, number> = {};
  for (const customer of owing) {
    const currency = customer.currency || fallbackCurrency;
    totals[currency] = roundMoney((totals[currency] || 0) + (Number(customer.totalDebt) || 0), currency);
  }
  return {
    count: owing.length,
    rows: mergeCurrencyTotals(totals, {}, fallbackCurrency).filter((row) => row.current !== 0 || owing.length === 0),
  };
}

function isStocktake(reason?: string): boolean {
  const text = (reason || '').toLowerCase();
  return text.includes('جرد') || text.includes('stocktake');
}

function vaultKind(movement: DeskVaultMovement): string {
  if (movement.source === 'customer_payment') return 'collection';
  if (movement.source === 'payroll' || movement.category === 'salary') return 'payroll';
  if (movement.source === 'expense' || movement.category === 'other') return 'expense';
  if (movement.source === 'reversal') return 'reversal';
  if (movement.source === 'manual' || movement.category === 'manual') return 'manual';
  return '';
}

export function recentActivity(
  invoices: DeskInvoice[],
  vault: DeskVaultMovement[],
  stock: DeskStockMovement[],
  fallbackCurrency: string,
  limit = 8,
): DeskActivity[] {
  const fromInvoices: DeskActivity[] = invoices.map((invoice) => ({
    id: `invoice:${invoice.id}`,
    kind: invoice.type === 'purchase' || invoice.type === 'purchase_return' ? 'purchase' : invoice.type === 'return' ? 'return' : 'sale',
    title: invoice.type === 'purchase' || invoice.type === 'purchase_return'
      ? (invoice.supplierName || invoice.invoiceNumber || invoice.id)
      : (invoice.customerName || invoice.invoiceNumber || invoice.id),
    detail: invoice.invoiceNumber || '',
    amount: (invoice.type === 'return' || invoice.type === 'purchase_return' ? -1 : 1) * (Number(invoice.totalAmount) || 0),
    currency: invoice.currency || fallbackCurrency,
    timestamp: Number(invoice.date) || 0,
    screen: 'invoices',
  }));

  const fromVault: DeskActivity[] = vault
    .filter((movement) => vaultKind(movement))
    .map((movement) => ({
      id: `vault:${movement.id}`,
      kind: 'vault' as const,
      title: movement.description || movement.id,
      detail: vaultKind(movement),
      amount: movement.type === 'expense' ? -Math.abs(Number(movement.amount) || 0) : Math.abs(Number(movement.amount) || 0),
      currency: movement.currency || fallbackCurrency,
      timestamp: Number(movement.timestamp) || 0,
      screen: 'vault' as const,
    }));

  const fromStock: DeskActivity[] = stock
    .filter((movement) => isStocktake(movement.reason))
    .map((movement) => ({
      id: `stock:${movement.id}`,
      kind: 'stocktake' as const,
      title: movement.productName,
      detail: movement.reason || '',
      amount: Number(movement.delta) || 0,
      currency: '',
      timestamp: Number(movement.timestamp) || 0,
      screen: 'inventory-audit' as const,
    }));

  return [...fromInvoices, ...fromVault, ...fromStock]
    .filter((item) => item.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}
