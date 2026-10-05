import type { Currency, Invoice, VaultTransaction } from '../types';
import { currencyDecimals } from './exchangeRates';

/**
 * Single source of truth for vault (الخزنة) arithmetic.
 * The vault keeps one independent balance per currency, so no currency is ever
 * mixed with another one.
 */
export const VAULT_CURRENCIES: Currency[] = ['JOD', 'ILS', 'USD', 'IQD', 'SAR', 'AED', 'LYD', 'EGP'];

/** Error-message prefix used when an expense exceeds the available balance of its currency. */
export const INSUFFICIENT_VAULT_FUNDS = 'Insufficient vault funds';

export type VaultBalances = Record<Currency, number>;

export interface VaultDoc {
  currentBalance: number; // legacy: mirrors the JOD balance
  balanceJOD: number;
  balanceILS: number;
  balanceUSD: number;
  balanceIQD: number;
  balanceSAR: number;
  balanceAED: number;
  balanceLYD: number;
  balanceEGP: number;
  lastUpdated: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Reads balances from any (old or new) vault document shape. */
export function readVaultBalances(data: any): VaultBalances {
  return {
    JOD: data?.balanceJOD !== undefined ? num(data.balanceJOD) : num(data?.currentBalance),
    ILS: num(data?.balanceILS),
    USD: num(data?.balanceUSD),
    IQD: num(data?.balanceIQD),
    SAR: num(data?.balanceSAR),
    AED: num(data?.balanceAED),
    LYD: num(data?.balanceLYD),
    EGP: num(data?.balanceEGP),
  };
}

export function buildVaultDoc(balances: VaultBalances, lastUpdated = Date.now()): VaultDoc {
  return {
    currentBalance: balances.JOD,
    balanceJOD: balances.JOD,
    balanceILS: balances.ILS,
    balanceUSD: balances.USD,
    balanceIQD: balances.IQD,
    balanceSAR: balances.SAR,
    balanceAED: balances.AED,
    balanceLYD: balances.LYD,
    balanceEGP: balances.EGP,
    lastUpdated,
  };
}

/** Rounding that matches each currency's real decimals (see CURRENCY_DECIMALS). */
export function roundForCurrency(value: number, currency: Currency): number {
  const f = Math.pow(10, currencyDecimals(currency));
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Applies a signed delta to one currency and returns the new document + the resulting balance. */
export function applyVaultDelta(
  data: any,
  currency: Currency,
  delta: number,
): { doc: VaultDoc; balanceAfter: number } {
  const balances = readVaultBalances(data);
  const cur = (VAULT_CURRENCIES.includes(currency) ? currency : 'JOD') as Currency;
  const balanceAfter = roundForCurrency(balances[cur] + delta, cur);
  balances[cur] = balanceAfter;
  return { doc: buildVaultDoc(balances), balanceAfter };
}

export type VaultEntryPlan = Omit<VaultTransaction, 'id' | 'timestamp' | 'balanceAfter'>;

/**
 * Describes the cash-vault movement an invoice must generate.
 * - cash sale / purchase       -> income / expense now
 * - card / wallet              -> none: the money is in the bank or wallet, not the cash box
 * - credit (آجل) sale          -> none: cash comes in later as a customer payment
 * `includeNonCash` reproduces invoices saved before card/wallet were excluded, so deleting them reverses what they posted.
 */
export function planInvoiceVaultEntry(invoice: Invoice, opts: { includeNonCash?: boolean } = {}): VaultEntryPlan | null {
  if (invoice.type === 'sale' && invoice.paymentMethod === 'credit') return null;
  const nonCash = invoice.paymentMethod === 'card' || invoice.paymentMethod === 'wallet';
  if (nonCash && !opts.includeNonCash) return null;

  const currency = (invoice.currency || 'JOD') as Currency;
  const ref = invoice.invoiceNumber || invoice.id;
  const isSale = invoice.type === 'sale';
  const method = invoice.paymentMethod && invoice.paymentMethod !== 'cash' ? ` [${invoice.paymentMethod}]` : '';

  return {
    type: isSale ? 'income' : 'expense',
    category: isSale ? 'sale' : 'purchase',
    amount: roundForCurrency(invoice.totalAmount, currency),
    currency,
    description: (isSale ? `Revenue from Invoice #${ref}` : `Purchase Invoice #${ref}`) + method,
    source: isSale ? 'sale_invoice' : 'purchase_invoice',
    refId: invoice.id,
  };
}
