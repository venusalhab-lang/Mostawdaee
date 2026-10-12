import type { Product } from '../types';

/**
 * A partial warehouse transfer keeps the barcode on a second product row in the destination warehouse,
 * so one barcode can match several rows (one per warehouse). Every lookup by barcode goes through here.
 */

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function sameSku(a: unknown, b: unknown): boolean {
  const x = norm(a);
  return x !== '' && x === norm(b);
}

/** Rows whose id or barcode equals the scanned code. */
export function productsForCode<T extends Pick<Product, 'id' | 'sku'>>(products: T[], code: string): T[] {
  const c = code.trim();
  if (!c) return [];
  const byId = products.filter((p) => p.id === c);
  return byId.length ? byId : products.filter((p) => sameSku(p.sku, c));
}

/** For a sale: the row that has stock (most first), so a sold-out warehouse doesn't block the scan. */
export function pickForSale<T extends Pick<Product, 'quantity'>>(matches: T[]): T | undefined {
  if (matches.length <= 1) return matches[0];
  const stocked = matches.filter((p) => (Number(p.quantity) || 0) > 0);
  if (!stocked.length) return matches[0];
  return stocked.reduce((best, p) => ((Number(p.quantity) || 0) > (Number(best.quantity) || 0) ? p : best));
}

/** For receiving stock: the original row, not a copy created by a transfer. */
export function pickForPurchase<T extends Pick<Product, 'id'>>(matches: T[]): T | undefined {
  return matches.find((p) => !p.id.startsWith('PROD_SPLIT_')) || matches[0];
}

/**
 * Another product that already owns this barcode. Rows of the same product in other warehouses are not a conflict
 * as long as the edit keeps the product's own barcode and doesn't put two rows in one warehouse.
 */
export function skuOwner<T extends Pick<Product, 'id' | 'sku' | 'warehouseId'>>(
  products: T[],
  sku: string,
  editing: Pick<Product, 'id' | 'sku'> | null | undefined,
  warehouseId: string | undefined,
): T | undefined {
  const others = products.filter((p) => p.id !== editing?.id && sameSku(p.sku, sku));
  if (!others.length) return undefined;
  const keepsOwnSku = !!editing && sameSku(editing.sku, sku);
  const sameWarehouse = others.find((p) => (p.warehouseId || '') === (warehouseId || ''));
  if (keepsOwnSku && !sameWarehouse) return undefined;
  return sameWarehouse || others[0];
}
