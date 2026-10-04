import type { InventoryAuditLine } from '../types';

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
  return Math.round(value * 1000) / 1000;
}

export function auditDifference(expectedQty: number, actualQty: number): number {
  return roundQty(roundQty(actualQty) - roundQty(expectedQty));
}

export function auditVarianceValue(difference: number, unitCost: number): number {
  if (!Number.isFinite(difference) || !Number.isFinite(unitCost)) return Number.NaN;
  return Math.round(difference * unitCost * 1000) / 1000;
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
      varianceValue: auditVarianceValue(difference, unitCost),
      movement: stocktakeMovement(difference),
    };

    if (!Number.isFinite(expectedQty) || expectedQty < 0 || !Number.isFinite(actualQty) || actualQty < 0 || !Number.isFinite(unitCost) || unitCost < 0) {
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

/** Each scan of a known product adds one unit to the counted quantity. */
export function countBarcode(
  lines: InventoryAuditLine[],
  product: { id: string; name: string; sku: string; quantity: number; unitCost: number; currency: string },
  auditId: string,
): { lines: InventoryAuditLine[]; unknown: false } | { lines: InventoryAuditLine[]; unknown: true } {
  const sku = product.sku.trim().toLowerCase();
  const match = lines.find(
    (line) => line.productId === product.id || (sku && line.sku.trim().toLowerCase() === sku),
  );
  if (match) {
    return {
      unknown: false,
      lines: lines.map((line) =>
        line.id === match.id
          ? { ...line, actualQty: roundQty(line.actualQty + 1), difference: auditDifference(line.expectedQty, line.actualQty + 1) }
          : line,
      ),
    };
  }
  const expectedQty = roundQty(product.quantity);
  const actualQty = 1;
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
