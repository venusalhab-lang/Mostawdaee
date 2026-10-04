import { describe, expect, it } from 'vitest';
import {
  auditDifference,
  auditVarianceValue,
  countBarcode,
  newAuditNumber,
  planAuditApply,
  stocktakeMovement,
} from '../inventoryAudit';
import type { InventoryAuditLine } from '../../types';

function line(partial: Partial<InventoryAuditLine> & Pick<InventoryAuditLine, 'productId' | 'expectedQty' | 'actualQty'>): InventoryAuditLine {
  return {
    id: partial.id || partial.productId,
    auditId: 'audit-1',
    productName: partial.productName || partial.productId,
    sku: partial.sku || partial.productId,
    currency: partial.currency || 'JOD',
    difference: partial.actualQty - partial.expectedQty,
    unitCost: partial.unitCost ?? 2,
    ...partial,
  };
}

describe('inventory audit math', () => {
  it('computes shortage, surplus, and costed variance', () => {
    expect(auditDifference(10, 7)).toBe(-3);
    expect(auditDifference(10, 12)).toBe(2);
    expect(stocktakeMovement(-3)).toBe('عجز جرد');
    expect(stocktakeMovement(2)).toBe('زيادة جرد');
    expect(stocktakeMovement(0)).toBeNull();
    expect(auditVarianceValue(-3, 1.5)).toBe(-4.5);
  });

  it('numbers an audit without inventing a sequence from the clock only', () => {
    expect(newAuditNumber(new Date('2026-10-02T10:00:00Z'))).toMatch(/^AUD-20261002-[A-Z0-9]{4}$/);
  });

  it('increments the counted quantity on every barcode scan', () => {
    const first = countBarcode([], {
      id: 'p1', name: 'حليب', sku: 'MIL-1', quantity: 10, unitCost: 1.25, currency: 'JOD',
    }, 'audit-1');
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0].actualQty).toBe(1);
    expect(first.lines[0].expectedQty).toBe(10);
    expect(first.lines[0].difference).toBe(-9);

    const second = countBarcode(first.lines, {
      id: 'p1', name: 'حليب', sku: 'MIL-1', quantity: 10, unitCost: 1.25, currency: 'JOD',
    }, 'audit-1');
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0].actualQty).toBe(2);
    expect(second.lines[0].difference).toBe(-8);
  });

  it('updates only listed lines and refuses a book that moved', () => {
    const lines = [
      line({ productId: 'p1', expectedQty: 10, actualQty: 8, unitCost: 2 }),
      line({ productId: 'p2', expectedQty: 4, actualQty: 4, unitCost: 3 }),
    ];
    const ready = planAuditApply(lines, { p1: 10, p2: 4 });
    expect(ready.ok).toBe(true);
    expect(ready.lines.find((row) => row.productId === 'p1')?.action).toBe('update');
    expect(ready.lines.find((row) => row.productId === 'p1')?.movement).toBe('عجز جرد');
    expect(ready.lines.find((row) => row.productId === 'p2')?.action).toBe('unchanged');

    const drifted = planAuditApply(lines, { p1: 9, p2: 4 });
    expect(drifted.ok).toBe(false);
    expect(drifted.lines.find((row) => row.productId === 'p1')?.block).toBe('STOCK_CHANGED');
  });

  it('treats a book that already matches the count as already applied', () => {
    const lines = [line({ productId: 'p1', expectedQty: 10, actualQty: 8 })];
    const plan = planAuditApply(lines, { p1: 8 });
    expect(plan.ok).toBe(true);
    expect(plan.lines[0].action).toBe('already_applied');
    expect(plan.lines[0].difference).toBe(-2);
  });

  it('rejects a negative count', () => {
    const plan = planAuditApply([line({ productId: 'p1', expectedQty: 10, actualQty: -1 })], { p1: 10 });
    expect(plan.ok).toBe(false);
    expect(plan.lines[0].block).toBe('INVALID_QTY');
  });
});
