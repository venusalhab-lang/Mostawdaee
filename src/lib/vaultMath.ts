import type { Currency, Invoice, VaultTransaction } from '../types';
import { roundMoney } from './exchangeRates';
import { purchasePayment } from './suppliers';
import { salePayment } from './salesPayment';

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
  return roundMoney(value, currency);
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
  if (invoice.type === 'return') {
    // Only the cash actually paid back; debt reductions and card refunds never touch the vault.
    const amount = Number(invoice.refund?.vault) || 0;
    if (amount <= 0) return null;
    const currency = (invoice.refund?.vaultCurrency || invoice.currency || 'JOD') as Currency;
    return {
      type: 'expense',
      category: 'sale',
      amount: roundForCurrency(amount, currency),
      currency,
      description: `Sales return #${invoice.invoiceNumber || invoice.id}${invoice.returnOfNumber ? ` (invoice #${invoice.returnOfNumber})` : ''}`,
      source: 'sale_return',
      refId: invoice.id,
    };
  }
  if (invoice.type === 'purchase_return') {
    // Only the cash the supplier paid back; what came off the supplier balance never touches the vault.
    const amount = Number(invoice.refund?.vault) || 0;
    if (amount <= 0) return null;
    const currency = (invoice.refund?.vaultCurrency || invoice.currency || 'JOD') as Currency;
    return {
      type: 'income',
      category: 'purchase',
      amount: roundForCurrency(amount, currency),
      currency,
      description: `Purchase return #${invoice.invoiceNumber || invoice.id}${invoice.returnOfNumber ? ` (purchase #${invoice.returnOfNumber})` : ''}`,
      source: 'purchase_return',
      refId: invoice.id,
    };
  }
  const nonCash = invoice.paymentMethod === 'card' || invoice.paymentMethod === 'wallet';
  if (nonCash && !opts.includeNonCash) return null;

  const currencyRaw = invoice.currency || 'JOD';
  if (!VAULT_CURRENCIES.includes(currencyRaw as Currency)) return null;
  const currency = currencyRaw as Currency;
  const ref = invoice.invoiceNumber || invoice.id;
  const isSale = invoice.type === 'sale';
  const method = invoice.paymentMethod && invoice.paymentMethod !== 'cash' ? ` [${invoice.paymentMethod}]` : '';
  // Credit sale/purchase: vault moves only the paid-now slice; full-آجل paid=0 → no vault row.
  const amount = isSale
    ? (invoice.paymentMethod === 'credit' ? salePayment(invoice).paid : Number(invoice.totalAmount))
    : purchasePayment(invoice).paid;
  // Refuse zero/negative cash posts: a negative "income" would bypass expense cover checks.
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    type: isSale ? 'income' : 'expense',
    category: isSale ? 'sale' : 'purchase',
    amount: roundForCurrency(amount, currency),
    currency,
    description: (isSale ? `Revenue from Invoice #${ref}` : `Purchase Invoice #${ref}`) + method,
    source: isSale ? 'sale_invoice' : 'purchase_invoice',
    refId: invoice.id,
  };
}
