import type { StockStatus } from '../types';

/** Used when neither the product nor the global settings define a low-stock alert level. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * Quantities are stored to 3 decimals (grams for kg, ml for litres).
 * Without it, ten purchases of 0.1 kg leave 0.9999999999999999 and a sale of 1 kg is refused.
 */
export const QTY_DECIMALS = 3;

export function roundQty(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** QTY_DECIMALS;
  const rounded = Math.round(Math.abs(n) * f + 1e-9) / f;
  return rounded === 0 ? 0 : Math.sign(n) * rounded;
}

/** Product level wins, then the global setting, then the default. 0 is a valid explicit value. */
export function resolveLowStockThreshold(productThreshold?: number | null, globalThreshold?: number | null): number {
  const p = Number(productThreshold);
  if (productThreshold !== undefined && productThreshold !== null && Number.isFinite(p) && p >= 0) return p;
  const g = Number(globalThreshold);
  if (globalThreshold !== undefined && globalThreshold !== null && Number.isFinite(g) && g >= 0) return g;
  return DEFAULT_LOW_STOCK_THRESHOLD;
}

/** Single definition used by every screen: out at <= 0, low at <= threshold. */
export function computeStockStatus(
  quantity: number,
  productThreshold?: number | null,
  globalThreshold?: number | null,
): StockStatus {
  const q = roundQty(Number(quantity) || 0);
  if (q <= 0) return 'Out of Stock';
  return q <= resolveLowStockThreshold(productThreshold, globalThreshold) ? 'Low Stock' : 'In Stock';
}

export function isLowStock(quantity: number, productThreshold?: number | null, globalThreshold?: number | null): boolean {
  return computeStockStatus(quantity, productThreshold, globalThreshold) !== 'In Stock';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until expiry (negative = already expired). */
export function daysUntilExpiry(expiry: number | undefined | null, now = Date.now()): number | null {
  if (!expiry) return null;
  return Math.ceil((expiry - now) / DAY_MS);
}

/** Critical = expires within 180 days or already expired. */
export function isExpiryCritical(expiry: number | undefined | null, now = Date.now()): boolean {
  const d = daysUntilExpiry(expiry, now);
  return d !== null && d < 180;
}

export function isExpired(expiry: number | undefined | null, now = Date.now()): boolean {
  const d = daysUntilExpiry(expiry, now);
  return d !== null && d < 0;
}
