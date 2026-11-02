import type { InventoryAuditLine } from '../types';
import { roundMoney } from './exchangeRates';
import { roundQty as roundStockQty } from './stock';

export type StocktakeMovement = 'عجز جرد' | 'زيادة جرد';

export interface AuditApplyLine {
  productId: string;
  productName: string;
  expectedQty: number;
  actualQty: number;
  bookQty: number;
  /** Count variance: actual − expected. This is the figure shown on the sheet. */
  difference: number;
  unitCost: number;
  varianceValue: number;
  movement: StocktakeMovement | null;
  /** update = write actual qty; unchanged = count matched the book; already_applied = book is already the counted qty. */
  action: 'update' | 'unchanged' | 'already_applied';
  block?: 'STOCK_CHANGED' | 'INVALID_QTY';
}

export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return roundStockQty(value);
}

export function auditDifference(expectedQty: number, actualQty: number): number {
  return roundQty(roundQty(actualQty) - roundQty(expectedQty));
}

export function auditVarianceValue(difference: number, unitCost: number, currency = 'JOD'): number {
  if (!Number.isFinite(difference) || !Number.isFinite(unitCost)) return Number.NaN;
  return roundMoney(difference * unitCost, currency);
}

export function stocktakeMovement(difference: number): StocktakeMovement | null {
  if (difference < 0) return 'عجز جرد';
  if (difference > 0) return 'زيادة جرد';
  return null;
}

export function newAuditNumber(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
  return `AUD-${y}${m}${d}-${suffix}`;
}

export function planAuditApply(
  lines: InventoryAuditLine[],
  bookQtyByProduct: Record<string, number>,
): { ok: boolean; lines: AuditApplyLine[] } {
  const planned: AuditApplyLine[] = lines.map((line) => {
    const expectedQty = roundQty(line.expectedQty);
    const actualQty = roundQty(line.actualQty);
    const bookQty = roundQty(bookQtyByProduct[line.productId] ?? Number.NaN);
    const difference = auditDifference(expectedQty, actualQty);
    const unitCost = Number(line.unitCost);
    const base = {
      productId: line.productId,
      productName: line.productName,
      expectedQty,
      actualQty,
      bookQty,
      difference,
      unitCost,
      varianceValue: auditVarianceValue(difference, unitCost, line.currency),
      movement: stocktakeMovement(difference),
    };

    // The book may be below zero (sales taken offline); a count is how that gets corrected, so only the count must be >= 0.
    if (!Number.isFinite(expectedQty) || !Number.isFinite(actualQty) || actualQty < 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      return { ...base, action: 'unchanged' as const, block: 'INVALID_QTY' as const };
    }
    if (!Number.isFinite(bookQty)) {
      return { ...base, action: 'unchanged' as const, block: 'STOCK_CHANGED' as const };
    }
    if (bookQty === actualQty) {
      return { ...base, action: difference === 0 ? 'unchanged' as const : 'already_applied' as const };
    }
    if (bookQty !== expectedQty) {
      return { ...base, action: 'unchanged' as const, block: 'STOCK_CHANGED' as const };
    }
    return { ...base, action: difference === 0 ? 'unchanged' as const : 'update' as const };
  });

  return { ok: planned.length > 0 && planned.every((line) => !line.block), lines: planned };
}

/**
 * Re-pins each line's book quantity to what is on the shelf now, keeping the counted qty.
 * Use after STOCK_CHANGED so the merchant can re-apply without deleting lines.
 */
export function refreshExpectedFromBook(
  lines: InventoryAuditLine[],
  bookQtyByProduct: Record<string, number>,
): InventoryAuditLine[] {
  return lines.map((line) => {
    const book = roundQty(bookQtyByProduct[line.productId] ?? Number.NaN);
    if (!Number.isFinite(book)) return line;
    return {
      ...line,
      expectedQty: book,
      difference: auditDifference(book, line.actualQty),
    };
  });
}

/** True when the post-stock close step is acceptable (ok, offline, or schema not deployed). */
export function stocktakeCloseAccepted(result: {
  cloud: boolean;
  reason?: 'no_session' | 'schema_missing' | 'failed';
}): boolean {
  return result.cloud || result.reason === 'schema_missing' || result.reason === 'no_session';
}

/**
 * Claim-before-stock: only apply inventory when the cloud seal/claim succeeded,
 * or when we are intentionally offline / missing the audits schema (local seal only).
 * A hard cloud failure must not change stock.
 */
export function stocktakeClaimAllowsStock(result: {
  cloud: boolean;
  reason?: 'no_session' | 'schema_missing' | 'failed';
}): boolean {
  return stocktakeCloseAccepted(result);
}

/** Cloud seal already took the draft — stock apply runs after claim. */
export function stocktakeClaimedOnServer(result: {
  cloud: boolean;
  reason?: 'no_session' | 'schema_missing' | 'failed';
}): boolean {
  return result.cloud === true;
}

/** Each scan of a known product adds one unit to the counted quantity. */
export function countBarcode(
  lines: InventoryAuditLine[],
  product: { id: string; name: string; sku: string; quantity: number; unitCost: number; currency: string },
  auditId: string,
  /** Units one scan counts: 1 for a unit barcode, the pack size for a pack barcode. */
  step = 1,
): { lines: InventoryAuditLine[]; unknown: false } | { lines: InventoryAuditLine[]; unknown: true } {
  const sku = product.sku.trim().toLowerCase();
  const match = lines.find(
    (line) => line.productId === product.id || (sku && line.sku.trim().toLowerCase() === sku),
  );
  if (match) {
    const counted = roundQty(match.actualQty + step);
    return {
      unknown: false,
      lines: lines.map((line) =>
        line.id === match.id
          ? { ...line, actualQty: counted, difference: auditDifference(line.expectedQty, counted) }
          : line,
      ),
    };
  }
  const expectedQty = roundQty(product.quantity);
  const actualQty = roundQty(step);
  const line: InventoryAuditLine = {
    id: crypto.randomUUID(),
    auditId,
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    currency: product.currency,
    expectedQty,
    actualQty,
    difference: auditDifference(expectedQty, actualQty),
    unitCost: Math.max(0, Number(product.unitCost) || 0),
  };
  return { unknown: false, lines: [...lines, line] };
}
