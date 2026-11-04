import type { Currency, InvoiceItem } from '../types';
import { roundMoney } from './exchangeRates';

/** Stable prefix so ad-hoc line ids never collide with real inventory product ids. */
export const ADHOC_ID_PREFIX = 'adhoc:';

/** True when the line is a free/service item: no catalog product and no stock movement. */
export function isAdhocLine(item: Pick<InvoiceItem, 'adhoc' | 'productId'> | null | undefined): boolean {
  if (!item) return false;
  if (item.adhoc === true) return true;
  return typeof item.productId === 'string' && item.productId.startsWith(ADHOC_ID_PREFIX);
}

export function newAdhocProductId(): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${ADHOC_ID_PREFIX}${id}`;
}

/** Build a cart/invoice line that never touches inventory. */
export function buildAdhocInvoiceItem(input: {
  description: string;
  quantity: number;
  unitPrice: number;
  currency: Currency;
  /** Optional cost for profit reports; defaults to 0 (full margin as revenue). */
  unitCost?: number;
}): InvoiceItem {
  const quantity = Number(input.quantity);
  const unitPrice = Number(input.unitPrice);
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  const price = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
  const unitCost =
    typeof input.unitCost === 'number' && Number.isFinite(input.unitCost) && input.unitCost >= 0
      ? input.unitCost
      : 0;
  return {
    productId: newAdhocProductId(),
    description: input.description.trim(),
    quantity: qty,
    unitPrice: price,
    total: roundMoney(qty * price, input.currency),
    adhoc: true,
    unitCost,
    costCurrency: input.currency,
  };
}

export function validateAdhocDraft(input: {
  description: string;
  quantity: unknown;
  unitPrice: unknown;
}): { ok: true; quantity: number; unitPrice: number; description: string } | { ok: false; reason: 'description' | 'quantity' | 'price' } {
  const description = String(input.description || '').trim();
  if (!description) return { ok: false, reason: 'description' };
  const quantity = typeof input.quantity === 'number' ? input.quantity : Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: 'quantity' };
  const unitPrice = typeof input.unitPrice === 'number' ? input.unitPrice : Number(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { ok: false, reason: 'price' };
  return { ok: true, description, quantity, unitPrice };
}
