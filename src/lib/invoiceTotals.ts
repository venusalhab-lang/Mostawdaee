import type { Currency } from '../types';
import { roundForCurrency } from './vaultMath';

export const DEFAULT_VAT_RATE = 16;

/** A stored 0% is a real rate; only a missing or invalid value falls back. */
export function resolveVatRate(value: unknown, fallback = DEFAULT_VAT_RATE): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  net: number;
  taxAmount: number;
  total: number;
}

/** Tax is charged on the amount after discount; the discount can never exceed the subtotal. */
export function computeInvoiceTotals(input: {
  subtotal: number;
  discount?: number;
  vatRate: number;
  taxEnabled?: boolean;
  currency: Currency;
}): InvoiceTotals {
  const { currency } = input;
  const subtotal = roundForCurrency(Math.max(0, Number(input.subtotal) || 0), currency);
  const discount = roundForCurrency(Math.min(Math.max(Number(input.discount) || 0, 0), subtotal), currency);
  const net = roundForCurrency(subtotal - discount, currency);
  const rate = input.taxEnabled === false ? 0 : resolveVatRate(input.vatRate, 0);
  const taxAmount = roundForCurrency((net * rate) / 100, currency);
  return { subtotal, discount, net, taxAmount, total: roundForCurrency(net + taxAmount, currency) };
}
