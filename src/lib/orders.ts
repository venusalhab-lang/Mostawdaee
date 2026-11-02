import type { Currency, Invoice, InvoiceItem, OrderKind, OrderLine, Product, TradeOrder } from '../types';
import { computeInvoiceTotals, type InvoiceTotals } from './invoiceTotals';
import { isValidPackSize } from './packs';
import type { ReorderLine } from './reorder';
import { roundForCurrency } from './vaultMath';

/**
 * Purchase orders and price quotations. They are offers, not books: saving, editing or deleting one never
 * touches stock, the vault or a balance. Only the invoice made from an order does, through the normal save path.
 */

export const ORDER_PREFIX: Record<OrderKind, string> = { purchase_order: 'PO', quote: 'QT' };

/** The next number after the highest one already used for this kind; other formats are ignored. */
export function nextOrderNumber(orders: Pick<TradeOrder, 'kind' | 'number'>[], kind: OrderKind): string {
  const prefix = ORDER_PREFIX[kind];
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const o of orders) {
    if (o.kind !== kind) continue;
    const m = pattern.exec(String(o.number || '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export function orderLineTotal(line: Pick<OrderLine, 'quantity' | 'unitPrice'>, currency: Currency): number {
  return roundForCurrency((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), currency);
}

export function orderTotals(order: Pick<TradeOrder, 'items' | 'vatRate' | 'currency'>): InvoiceTotals {
  return computeInvoiceTotals({
    subtotal: order.items.reduce((sum, line) => sum + orderLineTotal(line, order.currency), 0),
    vatRate: order.vatRate,
    currency: order.currency,
  });
}

export function isOpenOrder(order: Pick<TradeOrder, 'status'>): boolean {
  return order.status === 'draft' || order.status === 'sent';
}

/** A quotation past its last valid day that was never turned into a sale. */
export function isExpiredQuote(order: Pick<TradeOrder, 'kind' | 'status' | 'validUntil'>, now = Date.now()): boolean {
  return order.kind === 'quote' && isOpenOrder(order) && !!order.validUntil && now > order.validUntil;
}

export function orderStatusLabel(order: Pick<TradeOrder, 'kind' | 'status' | 'validUntil'>, isRtl: boolean, now = Date.now()): string {
  if (isExpiredQuote(order, now)) return isRtl ? 'منتهي الصلاحية' : 'Expired';
  switch (order.status) {
    case 'draft': return isRtl ? 'مسودة' : 'Draft';
    case 'sent': return isRtl ? 'مُرسل' : 'Sent';
    case 'converted': return order.kind === 'quote' ? (isRtl ? 'تحوّل لفاتورة بيع' : 'Invoiced') : (isRtl ? 'استُلم' : 'Received');
    case 'cancelled': return isRtl ? 'ملغى' : 'Cancelled';
  }
}

export function orderKindLabel(kind: OrderKind, isRtl: boolean): string {
  return kind === 'quote' ? (isRtl ? 'عرض سعر' : 'Quotation') : (isRtl ? 'أمر شراء' : 'Purchase order');
}

const price4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Purchase orders for one supplier from the reorder screen, one per cost currency: an order has a single
 * currency and amounts are never converted on the way. Quantities fill whole packs as packs.
 */
export function purchaseOrdersFromReorder(
  input: {
    supplierId?: string;
    supplierName?: string;
    lines: { line: ReorderLine; units: number }[];
    vatRate: number;
    now: number;
  },
  existing: Pick<TradeOrder, 'kind' | 'number'>[],
  newId: () => string,
): TradeOrder[] {
  const byCurrency = new Map<Currency, OrderLine[]>();
  for (const { line, units } of input.lines) {
    if (!(units > 0)) continue;
    const p = line.product;
    const pack = isValidPackSize(p.packSize) && units % Number(p.packSize) === 0 ? Number(p.packSize) : undefined;
    const items = byCurrency.get(line.costCurrency) || [];
    byCurrency.set(line.costCurrency, items);
    items.push({
      productId: p.id,
      description: p.name,
      sku: p.sku || undefined,
      quantity: pack ? units / pack : units,
      unitPrice: price4(line.unitCost * (pack || 1)),
      ...(pack ? { packSize: pack, packName: p.packName?.trim() || undefined } : {}),
    });
  }
  const taken = [...existing];
  const out: TradeOrder[] = [];
  for (const [currency, items] of byCurrency) {
    const number = nextOrderNumber(taken, 'purchase_order');
    taken.push({ kind: 'purchase_order', number });
    out.push({
      id: newId(),
      kind: 'purchase_order',
      number,
      date: input.now,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      currency,
      vatRate: input.vatRate,
      items,
      status: 'draft',
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
  return out;
}

/** Lines whose product was deleted since the order was written cannot go on an invoice. */
function splitKnown(order: TradeOrder, products: Pick<Product, 'id'>[]) {
  const ids = new Set(products.map((p) => p.id));
  const known = order.items.filter((l) => ids.has(l.productId) && Number(l.quantity) > 0);
  const missing = order.items.filter((l) => !ids.has(l.productId)).map((l) => l.description);
  return { known, missing };
}

/** Draft lines for the purchase form; the form recomputes totals and the save path checks the vault. */
export function orderToPurchaseLines(order: TradeOrder, products: Pick<Product, 'id'>[]) {
  const { known, missing } = splitKnown(order, products);
  const items: Omit<InvoiceItem, 'total'>[] = known.map((l) => ({
    productId: l.productId,
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice) || 0,
    ...(isValidPackSize(l.packSize) ? { packSize: Number(l.packSize), packName: l.packName } : {}),
  }));
  return { items, missing };
}

/** Draft lines for the sale form at the quoted prices; stock is checked again when the sale is saved. */
export function orderToSaleLines(order: TradeOrder, products: Pick<Product, 'id' | 'sku'>[]) {
  const { known, missing } = splitKnown(order, products);
  const items: InvoiceItem[] = known.map((l) => ({
    productId: l.productId,
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice) || 0,
    total: orderLineTotal(l, order.currency),
    sku: l.sku || products.find((p) => p.id === l.productId)?.sku || undefined,
    ...(isValidPackSize(l.packSize) ? { packSize: Number(l.packSize), packName: l.packName } : {}),
  }));
  return { items, missing };
}

/** The order laid out as an invoice so it prints with the same document template. */
export function orderAsPrintable(order: TradeOrder): Invoice {
  const totals = orderTotals(order);
  return {
    id: order.id,
    invoiceNumber: order.number,
    date: order.date,
    customerName: order.customerName,
    supplierName: order.supplierName,
    items: order.items.map((l) => ({ ...l, total: orderLineTotal(l, order.currency) })),
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    vatRate: order.vatRate,
    totalAmount: totals.total,
    type: order.kind === 'quote' ? 'sale' : 'purchase',
    currency: order.currency,
  };
}
