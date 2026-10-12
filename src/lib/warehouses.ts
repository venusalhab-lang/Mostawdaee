import type { Product, Warehouse } from '../types';
import { roundQty } from './stock';
import { stockValueByCurrency } from './profits';

/** Products without a warehouse live in the general store; '' is how that location is stored. */
export const NO_WAREHOUSE = '';

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const locationOf = (product: Pick<Product, 'warehouseId'>) => product.warehouseId || NO_WAREHOUSE;

/** A sub-warehouse whose parent was removed is shown as a main one rather than disappearing. */
export function isMainWarehouse(warehouse: Warehouse, all: Warehouse[]): boolean {
  return !warehouse.parentId || !all.some((w) => w.id === warehouse.parentId);
}

/** Main warehouses by name, each followed by its own sub-warehouses. */
export function orderWarehouses(all: Warehouse[], locale = 'ar'): Warehouse[] {
  const byName = (a: Warehouse, b: Warehouse) => a.name.localeCompare(b.name, locale);
  const mains = all.filter((w) => isMainWarehouse(w, all)).sort(byName);
  const ordered: Warehouse[] = [];
  for (const main of mains) {
    ordered.push(main);
    ordered.push(...all.filter((w) => w.parentId === main.id && w.id !== main.id).sort(byName));
  }
  return ordered;
}

export interface WarehouseStats {
  /** Product rows holding stock here. */
  stocked: number;
  /** Rows assigned here with nothing left (for example after the whole quantity was moved out). */
  empty: number;
  quantity: number;
  /** Stock at cost, per currency; currencies are never added together. */
  valueAtCost: Record<string, number>;
  /** Stocked rows with no cost, so the value above is understated. */
  missingCost: number;
}

export function warehouseStats(products: Product[], warehouseId: string, defaultCurrency: string): WarehouseStats {
  const here = products.filter((p) => locationOf(p) === warehouseId);
  const stocked = here.filter((p) => num(p.quantity) > 0);
  return {
    stocked: stocked.length,
    empty: here.length - stocked.length,
    quantity: roundQty(stocked.reduce((sum, p) => sum + num(p.quantity), 0)),
    valueAtCost: stockValueByCurrency(stocked, defaultCurrency),
    missingCost: stocked.filter((p) => num(p.unitCost ?? p.costPrice) <= 0).length,
  };
}

export interface DeleteBlockers {
  children: number;
  stocked: number;
  empty: number;
}

/**
 * A warehouse can only be removed once nothing points at it. Moving its goods automatically would
 * rewrite product rows from a local snapshot and could undo sales recorded on another device.
 */
export function deleteBlockers(warehouseId: string, all: Warehouse[], products: Product[]): DeleteBlockers {
  const here = products.filter((p) => p.warehouseId === warehouseId);
  return {
    children: all.filter((w) => w.parentId === warehouseId && w.id !== warehouseId).length,
    stocked: here.filter((p) => num(p.quantity) > 0).length,
    empty: here.filter((p) => num(p.quantity) <= 0).length,
  };
}

export const canDeleteWarehouse = (b: DeleteBlockers) => b.children === 0 && b.stocked === 0 && b.empty === 0;

export type WarehouseInputError = 'name' | 'duplicate' | 'parent' | 'has_children';

export function validateWarehouse(
  input: { name: string; parentId: string | null },
  all: Warehouse[],
  editingId: string | null,
): WarehouseInputError | null {
  const name = input.name.trim();
  if (!name || name.length > 80) return 'name';
  const key = name.toLocaleLowerCase();
  if (all.some((w) => w.id !== editingId && w.name.trim().toLocaleLowerCase() === key)) return 'duplicate';
  if (input.parentId) {
    const parent = all.find((w) => w.id === input.parentId);
    if (!parent || parent.id === editingId || !isMainWarehouse(parent, all)) return 'parent';
    // Only one level of nesting: a warehouse that has its own branches cannot become a branch.
    if (editingId && all.some((w) => w.parentId === editingId)) return 'has_children';
  }
  return null;
}

/** Rows that can be moved out of a location: stocked only, by name. */
export function transferCandidates(products: Product[], fromId: string, locale = 'ar'): Product[] {
  return products
    .filter((p) => locationOf(p) === fromId && num(p.quantity) > 0)
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

export type TransferError = 'product' | 'same' | 'quantity' | 'exceeds';

export function validateTransfer(
  product: Pick<Product, 'quantity' | 'warehouseId'> | undefined,
  toId: string,
  quantity: number,
): TransferError | null {
  if (!product) return 'product';
  if (locationOf(product) === toId) return 'same';
  const qty = roundQty(quantity);
  if (!Number.isFinite(quantity) || qty <= 0) return 'quantity';
  if (qty > roundQty(num(product.quantity))) return 'exceeds';
  return null;
}
