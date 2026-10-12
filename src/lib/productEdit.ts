import type { Product } from '../types';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Three-way merge for the product form: fields the user left untouched keep the stored value,
 * so a purchase that re-averaged the cost or a transfer that moved the product while the form was open is not reverted.
 * Quantity is not merged here; the caller applies the quantity difference separately.
 */
export function mergeProductEdit(base: Product, edited: Product, stored: Product): Product {
  const merged: Record<string, unknown> = { ...stored };
  const keys = new Set([...Object.keys(edited), ...Object.keys(base)]);
  for (const key of keys) {
    if (key === 'id' || key === 'quantity' || key === 'status') continue;
    const value = (edited as unknown as Record<string, unknown>)[key];
    if (!same(value, (base as unknown as Record<string, unknown>)[key])) merged[key] = value;
  }
  return { ...(merged as unknown as Product), id: stored.id };
}
