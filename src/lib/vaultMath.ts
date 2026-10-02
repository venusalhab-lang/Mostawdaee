import type { Currency, Invoice, VaultTransaction } from '../types';

/**
 * Single source of truth for vault (الخزنة) arithmetic.
 * The vault keeps one independent balance per currency, so no currency is ever
 * mixed with another one.
 */
export const VAULT_CURRENCIES: Currency[] = ['JOD', 'ILS', 'USD', 'IQD', 'SAR', 'LYD'];

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
  balanceLYD: number;
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
    LYD: num(data?.balanceLYD),
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
    balanceLYD: balances.LYD,
    lastUpdated,
  };
}

/** Rounding that matches each currency's real decimals (IQD 0, JOD/LYD 3, others 2). */
export function roundForCurrency(value: number, currency: Currency): number {
  const decimals = currency === 'IQD' ? 0 : currency === 'JOD' || currency === 'LYD' ? 3 : 2;
  const f = Math.pow(10, decimals);
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
 * Describes the vault movement an invoice must generate.
 * - cash / card / wallet sale  -> income now
 * - credit (آجل) sale          -> NO vault movement (cash comes in later as a customer payment)
 * - purchase                   -> expense now
 */
export function planInvoiceVaultEntry(invoice: Invoice): VaultEntryPlan | null {
  if (invoice.type === 'sale' && invoice.paymentMethod === 'credit') return null;

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
