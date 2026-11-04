import { describe, expect, it } from 'vitest';
import { ADHOC_ID_PREFIX, buildAdhocInvoiceItem, isAdhocLine, validateAdhocDraft } from '../adhocLine';
import { quantitiesByProduct } from '../invoiceReversal';
import { heldBillFitsStock } from '../heldBills';

describe('adhocLine', () => {
  it('builds a free line that never looks like inventory stock', () => {
    const line = buildAdhocInvoiceItem({
      description: '  Delivery fee ',
      quantity: 2,
      unitPrice: 1.5,
      currency: 'JOD',
      unitCost: 0.25,
    });
    expect(line.adhoc).toBe(true);
    expect(line.productId.startsWith(ADHOC_ID_PREFIX)).toBe(true);
    expect(line.description).toBe('Delivery fee');
    expect(line.total).toBe(3);
    expect(isAdhocLine(line)).toBe(true);
  });

  it('validates drafts day-first for the cashier', () => {
    expect(validateAdhocDraft({ description: '', quantity: 1, unitPrice: 2 }).ok).toBe(false);
    expect(validateAdhocDraft({ description: 'X', quantity: 0, unitPrice: 2 }).ok).toBe(false);
    expect(validateAdhocDraft({ description: 'X', quantity: 1, unitPrice: -1 }).ok).toBe(false);
    expect(validateAdhocDraft({ description: 'X', quantity: 1, unitPrice: 0 })).toEqual({
      ok: true,
      description: 'X',
      quantity: 1,
      unitPrice: 0,
    });
  });

  it('excludes free lines from stock movements and held-bill stock checks', () => {
    const stock = { productId: 'p1', description: 'Tea', quantity: 2, unitPrice: 1, total: 2 };
    const free = buildAdhocInvoiceItem({ description: 'Fee', quantity: 5, unitPrice: 10, currency: 'JOD' });
    expect(quantitiesByProduct([stock, free]).get('p1')?.qty).toBe(2);
    expect(quantitiesByProduct([stock, free]).has(free.productId)).toBe(false);

    const fit = heldBillFitsStock(
      { items: [stock, free] },
      { p1: 2 },
      () => 0,
    );
    expect(fit).toEqual({ ok: true });
  });
});
