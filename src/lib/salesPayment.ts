import type { Currency, Invoice } from '../types';
import { roundMoney } from './exchangeRates';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What a sale took in cash (or card/wallet) now vs what it left on the customer.
 * Cash/card/wallet sales are paid in full. Credit with no `paidAmount` is legacy full-آجل (paid 0).
 * Credit with `paidAmount` is split tender: vault gets `paid`, AR gets `owed`.
 */
export function salePayment(
  inv: Pick<Invoice, 'type' | 'paymentMethod' | 'paidAmount' | 'totalAmount' | 'currency'>,
): { paid: number; owed: number } {
  const total = roundMoney(num(inv.totalAmount), inv.currency);
  if (inv.type !== 'sale' || inv.paymentMethod !== 'credit') return { paid: total, owed: 0 };
  if (inv.paidAmount === undefined || inv.paidAmount === null) {
    return { paid: 0, owed: total };
  }
  const paid = roundMoney(Math.min(Math.max(num(inv.paidAmount), 0), total), inv.currency);
  return { paid, owed: roundMoney(total - paid, inv.currency) };
}

export type SalePaymentError = 'customer_required' | 'paid_invalid' | 'paid_exceeds_total';

/** Validates a credit (or split) sale before save. Cash/card/wallet skip this. */
export function checkSalePayment(
  mode: 'cash' | 'card' | 'wallet' | 'credit',
  total: number,
  paid: number,
  currency: Currency,
  customerId: string | undefined,
): SalePaymentError | null {
  if (mode !== 'credit') return null;
  if (!customerId) return 'customer_required';
  if (!Number.isFinite(paid) || paid < 0) return 'paid_invalid';
  if (roundMoney(paid, currency) > roundMoney(total, currency)) return 'paid_exceeds_total';
  return null;
}
