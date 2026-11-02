import type { Product } from '../types';
import { isValidPackSize } from './packs';

export const DEFAULT_CATEGORY_AR = 'عام';
export const DEFAULT_CATEGORY_EN = 'General';

/** Shared default category for a fast desk path (inventory + POS). */
export function defaultProductCategory(isRtl: boolean): string {
  return isRtl ? DEFAULT_CATEGORY_AR : DEFAULT_CATEGORY_EN;
}

/** Stable internal SKU when the merchant has no barcode yet. Never invents stock. */
export function generateProductSku(id: string = crypto.randomUUID()): string {
  return `SKU-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function resolveProductSku(raw: string | undefined | null, id?: string): string {
  const trimmed = String(raw ?? '').trim();
  return trimmed || generateProductSku(id ?? crypto.randomUUID());
}

export function resolveProductCategory(raw: string | undefined | null, isRtl: boolean): string {
  const trimmed = String(raw ?? '').trim();
  return trimmed || defaultProductCategory(isRtl);
}

/** True when optional / advanced fields warrant expanding the details panel on edit. */
export function productHasAdvancedDetails(
  product: Partial<Product> | null | undefined,
  sellByPack = false,
): boolean {
  if (!product) return false;
  if (sellByPack || isValidPackSize(product.packSize)) return true;
  if (String(product.brand ?? '').trim()) return true;
  if (String(product.serialNumber ?? '').trim()) return true;
  if (product.expiryDate) return true;
  if (product.lowStockThreshold !== undefined && product.lowStockThreshold !== null) return true;
  if (String(product.warehouseId ?? '').trim()) return true;
  if (Number(product.baseCostPrice) > 0 || Number(product.additionalCosts) > 0) return true;
  if (product.taxRate !== undefined && product.taxRate !== null && Number.isFinite(Number(product.taxRate))) {
    return true;
  }
  return false;
}
