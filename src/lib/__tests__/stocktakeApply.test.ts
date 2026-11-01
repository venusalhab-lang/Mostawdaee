import { describe, expect, it } from 'vitest';
import { planAuditApply, refreshExpectedFromBook, stocktakeCloseAccepted } from '../inventoryAudit';
import type { InventoryAuditLine } from '../../types';

const line = (over: Partial<InventoryAuditLine> = {}): InventoryAuditLine => ({
  id: 'l1',
  auditId: 'a1',
  productId: 'p1',
  productName: 'Tea',
  sku: 'T1',
  currency: 'JOD',
  expectedQty: 10,
  actualQty: 8,
  difference: -2,
  unitCost: 1,
  ...over,
});

describe('stocktake apply planning (atomic contract)', () => {
  it('blocks the whole apply when any line drifted', () => {
    const plan = planAuditApply(
      [line(), line({ id: 'l2', productId: 'p2', expectedQty: 5, actualQty: 5, difference: 0 })],
      { p1: 9, p2: 5 },
    );
    expect(plan.ok).toBe(false);
    expect(plan.lines.some((l) => l.block === 'STOCK_CHANGED')).toBe(true);
  });

  it('only marks differing lines as updates when the book still matches', () => {
    const plan = planAuditApply(
      [
        line(),
        line({ id: 'l2', productId: 'p2', expectedQty: 5, actualQty: 5, difference: 0 }),
      ],
      { p1: 10, p2: 5 },
    );
    expect(plan.ok).toBe(true);
    const updates = plan.lines.filter((l) => l.action === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].productId).toBe('p1');
    expect(updates[0].actualQty).toBe(8);
  });

  it('after refresh, a drifted sheet can apply against the live book', () => {
    const drifted = [line(), line({ id: 'l2', productId: 'p2', expectedQty: 5, actualQty: 5, difference: 0 })];
    const live = { p1: 9, p2: 5 };
    expect(planAuditApply(drifted, live).ok).toBe(false);
    const refreshed = refreshExpectedFromBook(drifted, live);
    const plan = planAuditApply(refreshed, live);
    expect(plan.ok).toBe(true);
    expect(plan.lines.find((l) => l.productId === 'p1')?.action).toBe('update');
    expect(plan.lines.find((l) => l.productId === 'p1')?.expectedQty).toBe(9);
  });
});

describe('stocktake close acceptance', () => {
  it('accepts cloud success and offline/schema gaps, rejects hard failures', () => {
    expect(stocktakeCloseAccepted({ cloud: true })).toBe(true);
    expect(stocktakeCloseAccepted({ cloud: false, reason: 'no_session' })).toBe(true);
    expect(stocktakeCloseAccepted({ cloud: false, reason: 'schema_missing' })).toBe(true);
    expect(stocktakeCloseAccepted({ cloud: false, reason: 'failed' })).toBe(false);
  });
});
