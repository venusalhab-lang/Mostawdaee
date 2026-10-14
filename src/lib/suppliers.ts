import type { Currency, Invoice, Supplier, SupplierTransaction } from '../types';
import { roundMoney } from './exchangeRates';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** What a purchase paid from the vault and what it left owed to the supplier, in the purchase currency. */
export function purchasePayment(inv: Pick<Invoice, 'type' | 'paymentMethod' | 'paidAmount' | 'totalAmount' | 'currency'>): { paid: number; owed: number } {
  const total = roundMoney(num(inv.totalAmount), inv.currency);
  if (inv.type !== 'purchase' || inv.paymentMethod !== 'credit') return { paid: total, owed: 0 };
  const paid = roundMoney(Math.min(Math.max(num(inv.paidAmount), 0), total), inv.currency);
  return { paid, owed: roundMoney(total - paid, inv.currency) };
}

export type PurchasePaymentError = 'supplier_required' | 'paid_invalid' | 'paid_exceeds_total';

/** Checks what is paid now on a credit purchase. Cash purchases are always paid in full. */
export function checkPurchasePayment(
  mode: 'cash' | 'credit',
  total: number,
  paid: number,
  currency: Currency,
  supplierId: string | undefined,
): PurchasePaymentError | null {
  if (mode === 'cash') return null;
  if (!supplierId) return 'supplier_required';
  if (!Number.isFinite(paid) || paid < 0) return 'paid_invalid';
  if (roundMoney(paid, currency) > roundMoney(total, currency)) return 'paid_exceeds_total';
  return null;
}

export function supplierBalance(supplier: Pick<Supplier, 'balances'> | undefined, currency: Currency): number {
  return roundMoney(num(supplier?.balances?.[currency]), currency);
}

/** New balances after a signed change in one currency; other currencies are untouched. */
export function withBalance(balances: Supplier['balances'] | undefined, currency: Currency, delta: number): Supplier['balances'] {
  const next = { ...(balances || {}) };
  next[currency] = roundMoney(num(next[currency]) + delta, currency);
  return next;
}

/** Currencies with something owed, largest first. */
export function owedBalances(supplier: Pick<Supplier, 'balances'>): Array<{ currency: Currency; amount: number }> {
  return (Object.entries(supplier.balances || {}) as [Currency, number][])
    .map(([currency, amount]) => ({ currency, amount: roundMoney(num(amount), currency) }))
    .filter((b) => b.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Total owed to all suppliers, one figure per currency. */
export function totalOwed(suppliers: Pick<Supplier, 'balances'>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of suppliers) {
    for (const { currency, amount } of owedBalances(s)) totals[currency] = roundMoney((totals[currency] || 0) + amount, currency);
  }
  return totals;
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Supplier names typed on past purchases that have no supplier record yet, most used first. */
export function supplierSuggestions(invoices: Invoice[], suppliers: Pick<Supplier, 'name'>[]): Array<{ name: string; purchases: number }> {
  const known = new Set(suppliers.map((s) => normalizeName(s.name)));
  const found = new Map<string, { name: string; purchases: number }>();
  for (const inv of invoices) {
    if (inv.type !== 'purchase' || inv.supplierId || typeof inv.supplierName !== 'string') continue;
    const key = normalizeName(inv.supplierName);
    if (!key || known.has(key)) continue;
    const entry = found.get(key) || { name: inv.supplierName.trim().replace(/\s+/g, ' '), purchases: 0 };
    entry.purchases += 1;
    found.set(key, entry);
  }
  return [...found.values()].sort((a, b) => b.purchases - a.purchases || a.name.localeCompare(b.name));
}

export function findSupplierByName<T extends Pick<Supplier, 'name'>>(suppliers: T[], name: string): T | undefined {
  const key = normalizeName(name);
  return key ? suppliers.find((s) => normalizeName(s.name) === key) : undefined;
}

/**
 * Balance after each entry, per currency, recomputed from the entries themselves
 * so that deleting an older entry never leaves stale running balances behind.
 */
export function runningBalances(txs: SupplierTransaction[]): Map<string, number> {
  const out = new Map<string, number>();
  const totals: Partial<Record<string, number>> = {};
  const ordered = [...txs].sort((a, b) => num(a.date) - num(b.date) || String(a.id).localeCompare(String(b.id)));
  for (const t of ordered) {
    const sign = t.type === 'payment' || t.type === 'return' ? -1 : 1;
    const next = roundMoney((totals[t.currency] || 0) + sign * num(t.amount), t.currency);
    totals[t.currency] = next;
    out.set(t.id, next);
  }
  return out;
}

/** A supplier's statement, newest first. */
export function supplierStatement(txs: SupplierTransaction[], supplierId: string): SupplierTransaction[] {
  return txs.filter((t) => t.supplierId === supplierId).sort((a, b) => num(b.date) - num(a.date));
}
