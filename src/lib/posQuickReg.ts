/**
 * Quick product registration from the POS (unknown barcode / F7).
 * Opening stock must be entered by the cashier — never invent a phantom quantity.
 */
export const QUICK_REG_DEFAULT_QUANTITY = 0;

export type QuickRegForm = {
  sku: string;
  name: string;
  category: string;
  brand: string;
  quantity: number;
  unitCost: number;
  sellingPrice: number;
  warehouseId: string;
  lowStockThreshold: number;
};

/** Empty form for a new product; `warehouseId` is the store's first warehouse when one exists. */
export function emptyQuickRegForm(warehouseId = ''): QuickRegForm {
  return {
    sku: '',
    name: '',
    category: '',
    brand: '',
    quantity: QUICK_REG_DEFAULT_QUANTITY,
    unitCost: 0,
    sellingPrice: 0,
    warehouseId,
    lowStockThreshold: 5,
  };
}

/** Opening stock from the form: finite and not negative, else null (refuse save). */
export function parseQuickRegQuantity(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
