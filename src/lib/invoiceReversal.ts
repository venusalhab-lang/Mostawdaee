import type { Invoice } from '../types';

export function quantitiesByProduct(items: Invoice['items']): Map<string, { qty: number; description: string }> {
  const totals = new Map<string, { qty: number; description: string }>();
  for (const item of items) {
    const entry = totals.get(item.productId) || { qty: 0, description: item.description };
    entry.qty += Number(item.quantity) || 0;
    totals.set(item.productId, entry);
  }
  return totals;
}

export interface StockReversal {
  updates: Array<{ productId: string; quantity: number }>;
  /** Products deleted since the invoice: nothing to restock or remove. */
  missing: string[];
  /** A purchase whose goods were already sold cannot be taken back out of stock. */
  shortages: Array<{ name: string; available: number; needed: number }>;
}

/** Stock changes that undo an invoice: a sale returns goods to stock, a purchase removes them. */
export function planStockReversal(
  invoice: Pick<Invoice, 'type' | 'items'>,
  current: Map<string, { quantity?: number; name?: string } | undefined>,
): StockReversal {
  const result: StockReversal = { updates: [], missing: [], shortages: [] };
  for (const [productId, { qty, description }] of quantitiesByProduct(invoice.items)) {
    const product = current.get(productId);
    if (!product) {
      result.missing.push(description || productId);
      continue;
    }
    const available = Number(product.quantity) || 0;
    if (invoice.type === 'purchase' && available < qty) {
      result.shortages.push({ name: product.name || description || productId, available, needed: qty });
      continue;
    }
    result.updates.push({ productId, quantity: invoice.type === 'sale' ? available + qty : available - qty });
  }
  return result;
}
