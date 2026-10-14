import { describe, expect, it } from 'vitest';
import type { Product, TradeOrder } from '../../types';
import {
  isExpiredQuote, nextOrderNumber, orderAsPrintable, orderStatusLabel, orderToPurchaseLines, orderToSaleLines, orderTotals,
  purchaseOrdersFromReorder,
} from '../orders';
import type { ReorderLine } from '../reorder';

const order = (over: Partial<TradeOrder> = {}): TradeOrder => ({
  id: 'o1', kind: 'quote', number: 'QT-0001', date: 1, currency: 'JOD', vatRate: 16, status: 'draft',
  items: [{ productId: 'p1', description: 'Rice', quantity: 3, unitPrice: 1.5 }], createdAt: 1, updatedAt: 1, ...over,
});

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'Rice', sku: 'R1', category: '', brand: '', quantity: 0, unitCost: 2, sellingPrice: 3,
  status: 'Out of Stock', dateAdded: 0, ...over,
});

const reorderLine = (over: Partial<ReorderLine> = {}): ReorderLine => ({
  product: product(), threshold: 5, onHand: 0, soldUnits: 10, rateDays: 30, perDay: 1, daysLeft: 0,
  suggestedUnits: 20, unitCost: 2, costCurrency: 'JOD', ...over,
});

describe('orders', () => {
  it('numbers each kind on its own, after the highest number used', () => {
    const list = [order({ number: 'QT-0009' }), order({ number: 'QT-0002' }), order({ kind: 'purchase_order', number: 'PO-0041' }), order({ number: 'custom' })];
    expect(nextOrderNumber(list, 'quote')).toBe('QT-0010');
    expect(nextOrderNumber(list, 'purchase_order')).toBe('PO-0042');
    expect(nextOrderNumber([], 'purchase_order')).toBe('PO-0001');
  });

  it('totals with VAT on the net, rounded in the order currency', () => {
    expect(orderTotals(order())).toEqual({ subtotal: 4.5, discount: 0, net: 4.5, taxAmount: 0.72, total: 5.22 });
  });

  it('marks an open quotation expired after its last valid day, never a converted one', () => {
    expect(isExpiredQuote(order({ validUntil: 100 }), 101)).toBe(true);
    expect(isExpiredQuote(order({ validUntil: 100 }), 100)).toBe(false);
    expect(isExpiredQuote(order({ validUntil: 100, status: 'converted' }), 500)).toBe(false);
    expect(isExpiredQuote(order({ kind: 'purchase_order', validUntil: 100 }), 500)).toBe(false);
    expect(orderStatusLabel(order({ validUntil: 100 }), true, 500)).toBe('منتهي الصلاحية');
    expect(orderStatusLabel(order({ kind: 'purchase_order', status: 'converted' }), false)).toBe('Received');
  });

  it('builds one purchase order per cost currency, whole packs as packs', () => {
    let n = 0;
    const out = purchaseOrdersFromReorder({
      supplierId: 's1', supplierName: 'Nour', vatRate: 16, now: 5,
      lines: [
        { line: reorderLine({ product: product({ packSize: 12, packName: 'كرتونة' }), unitCost: 2.5 }), units: 24 },
        { line: reorderLine({ product: product({ id: 'p2', name: 'Oil', packSize: 12 }) }), units: 5 },
        { line: reorderLine({ product: product({ id: 'p3', name: 'Tea' }), unitCost: 4, costCurrency: 'USD' }), units: 2 },
        { line: reorderLine({ product: product({ id: 'p4' }) }), units: 0 },
      ],
    }, [order({ kind: 'purchase_order', number: 'PO-0007' })], () => `id${++n}`);
    expect(out.map((o) => [o.number, o.currency, o.items.length])).toEqual([['PO-0008', 'JOD', 2], ['PO-0009', 'USD', 1]]);
    expect(out[0].items[0]).toMatchObject({ quantity: 2, unitPrice: 30, packSize: 12, packName: 'كرتونة' });
    expect(out[0].items[1]).toMatchObject({ quantity: 5, unitPrice: 2 });
    expect(out[0].items[1].packSize).toBeUndefined();
    expect(out[0]).toMatchObject({ supplierId: 's1', supplierName: 'Nour', status: 'draft', vatRate: 16 });
  });

  it('drops lines whose product was deleted when turning an order into an invoice', () => {
    const o = order({ items: [
      { productId: 'p1', description: 'Rice', quantity: 2, unitPrice: 30, packSize: 12, packName: 'Box' },
      { productId: 'gone', description: 'Old item', quantity: 1, unitPrice: 1 },
    ] });
    const purchase = orderToPurchaseLines(o, [product()]);
    expect(purchase.items).toEqual([{ productId: 'p1', description: 'Rice', quantity: 2, unitPrice: 30, packSize: 12, packName: 'Box' }]);
    expect(purchase.missing).toEqual(['Old item']);
    const sale = orderToSaleLines(o, [product()]);
    expect(sale.items[0]).toMatchObject({ total: 60, sku: 'R1', packSize: 12 });
  });

  it('prints as a document of the right side', () => {
    const printable = orderAsPrintable(order({ kind: 'purchase_order', supplierName: 'Nour' }));
    expect(printable).toMatchObject({ type: 'purchase', supplierName: 'Nour', totalAmount: 5.22, invoiceNumber: 'QT-0001' });
    expect(printable.items[0].total).toBe(4.5);
  });
});
