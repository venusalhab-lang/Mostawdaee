import type { Cheque, ChequeFilters, ChequeInput, ChequeStatus, ChequeType } from '../types';
import { isPosCurrency, roundMoney } from './exchangeRates';
import { matchesQuery } from './search';

export const CHEQUE_STATUSES: ChequeStatus[] = ['pending', 'cashed', 'bounced', 'endorsed', 'returned'];

export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, { ar: string; en: string }> = {
  pending: { ar: 'تحت التحصيل', en: 'Pending' },
  cashed: { ar: 'محصّل', en: 'Cashed' },
  bounced: { ar: 'راجع', en: 'Bounced' },
  endorsed: { ar: 'مُجيَّر', en: 'Endorsed' },
  returned: { ar: 'مُعاد للساحب', en: 'Returned' },
};

/**
 * Allowed status changes. Must match public.guard_cheque_writes in supabase_cheques.sql.
 * Only a received cheque can be endorsed over to someone else.
 */
export function allowedTransitions(type: ChequeType, from: ChequeStatus): ChequeStatus[] {
  if (from === 'pending') {
    return type === 'incoming' ? ['cashed', 'bounced', 'endorsed', 'returned'] : ['cashed', 'bounced', 'returned'];
  }
  if (from === 'bounced') return ['pending', 'returned'];
  return [];
}

export function canTransition(type: ChequeType, from: ChequeStatus, to: ChequeStatus): boolean {
  return allowedTransitions(type, from).includes(to);
}

export type ChequeInputError =
  | 'number'
  | 'bank'
  | 'amount'
  | 'currency'
  | 'dueDate'
  | 'type'
  | 'contact';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateChequeInput(input: ChequeInput): ChequeInputError | null {
  if (!input.chequeNumber.trim() || input.chequeNumber.trim().length > 40) return 'number';
  if (!input.bankName.trim() || input.bankName.trim().length > 120) return 'bank';
  if (!isPosCurrency(input.currency)) return 'currency';
  if (!Number.isFinite(input.amount) || roundMoney(input.amount, input.currency) <= 0) return 'amount';
  if (!isValidDate(input.dueDate)) return 'dueDate';
  if (input.type !== 'incoming' && input.type !== 'outgoing') return 'type';
  if (input.contactType === 'customer' && !input.contactId) return 'contact';
  return null;
}

export interface ChequeTotals {
  pending: Map<string, number>;
  cashed: Map<string, number>;
  bounced: Map<string, number>;
  counts: Record<'pending' | 'cashed' | 'bounced', number>;
}

/** Per-currency totals; amounts in different currencies are never added together. */
export function summarizeCheques(cheques: Cheque[]): ChequeTotals {
  const totals: ChequeTotals = {
    pending: new Map(),
    cashed: new Map(),
    bounced: new Map(),
    counts: { pending: 0, cashed: 0, bounced: 0 },
  };
  for (const cheque of cheques) {
    if (cheque.status !== 'pending' && cheque.status !== 'cashed' && cheque.status !== 'bounced') continue;
    const bucket = totals[cheque.status];
    bucket.set(cheque.currency, roundMoney((bucket.get(cheque.currency) || 0) + cheque.amount, cheque.currency));
    totals.counts[cheque.status] += 1;
  }
  return totals;
}

export function filterCheques(cheques: Cheque[], type: ChequeType, filters: ChequeFilters): Cheque[] {
  const bank = filters.bank.trim().toLowerCase();
  return cheques
    .filter((cheque) => cheque.type === type)
    .filter((cheque) => filters.status === 'all' || cheque.status === filters.status)
    .filter((cheque) => !bank || cheque.bankName.trim().toLowerCase() === bank)
    .filter((cheque) => !filters.from || cheque.dueDate >= filters.from)
    .filter((cheque) => !filters.to || cheque.dueDate <= filters.to)
    .filter((cheque) =>
      matchesQuery([cheque.chequeNumber, cheque.bankName, cheque.drawerName, cheque.contactName, cheque.endorsedTo, cheque.notes], filters.search),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.chequeNumber.localeCompare(b.chequeNumber));
}

/** Pending cheques whose due date has passed (dates compared as local YYYY-MM-DD). */
export function isOverdue(cheque: Cheque, today: string): boolean {
  return cheque.status === 'pending' && cheque.dueDate < today;
}

export const BOUNCE_REASONS: Array<{ ar: string; en: string }> = [
  { ar: 'الرصيد غير كافٍ', en: 'Insufficient funds' },
  { ar: 'التوقيع غير مطابق', en: 'Signature mismatch' },
  { ar: 'الحساب مغلق', en: 'Account closed' },
  { ar: 'أوقف الساحب صرفه', en: 'Stopped by the drawer' },
  { ar: 'خطأ في التاريخ أو المبلغ', en: 'Wrong date or amount' },
];

export function appendNote(notes: string, line: string): string {
  const extra = line.trim();
  if (!extra) return notes;
  return notes.trim() ? `${notes.trim()}\n${extra}` : extra;
}

export type ChequePaymentPlan =
  | { ok: true; debtBefore: number; debtAfter: number }
  | { ok: false; reason: 'currency' | 'no_debt' | 'exceeds'; debtBefore: number };

/**
 * Whether cashing an incoming customer cheque can be booked as a payment on that customer's account.
 * Amounts are never converted here: a cheque in another currency must be settled by hand.
 */
export function chequePaymentPlan(cheque: Pick<Cheque, 'amount' | 'currency'>, customer: { totalDebt: number; currency: string }): ChequePaymentPlan {
  const debtBefore = roundMoney(Number(customer.totalDebt) || 0, customer.currency);
  if (customer.currency !== cheque.currency) return { ok: false, reason: 'currency', debtBefore };
  if (debtBefore <= 0) return { ok: false, reason: 'no_debt', debtBefore };
  const amount = roundMoney(cheque.amount, cheque.currency);
  if (amount > debtBefore) return { ok: false, reason: 'exceeds', debtBefore };
  return { ok: true, debtBefore, debtAfter: roundMoney(debtBefore - amount, cheque.currency) };
}

const DAY_MS = 86_400_000;

/** Whole calendar days from `today` to the due date: negative when past due, null for a malformed date. */
export function daysUntilDue(dueDate: string, today: string): number | null {
  if (!isValidDate(dueDate) || !isValidDate(today)) return null;
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function addDaysIso(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export const DUE_SOON_DAYS = 7;

/** Pending cheques that are past due, and those due from today through the next DUE_SOON_DAYS days. */
export function dueCounts(cheques: Cheque[], today: string): { overdue: number; soon: number } {
  const limit = addDaysIso(today, DUE_SOON_DAYS);
  let overdue = 0;
  let soon = 0;
  for (const cheque of cheques) {
    if (cheque.status !== 'pending') continue;
    if (cheque.dueDate < today) overdue += 1;
    else if (cheque.dueDate <= limit) soon += 1;
  }
  return { overdue, soon };
}

export function dueFilters(kind: 'overdue' | 'soon', today: string): ChequeFilters {
  return kind === 'overdue'
    ? { status: 'pending', bank: '', from: '', to: addDaysIso(today, -1), search: '' }
    : { status: 'pending', bank: '', from: today, to: addDaysIso(today, DUE_SOON_DAYS), search: '' };
}

export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
