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

export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
