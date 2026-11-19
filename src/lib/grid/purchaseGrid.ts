import type { InvoiceItem, Product } from '../../types';
import { productsForCode, pickForPurchase } from '../productLookup';
import { parseGridNumber, lineTotal, roundMoney } from './gridMath';

export type PurchaseGridRow = {
  id: string;
  code: string;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  /** Set when lookup failed or was ambiguous. */
  errorKey?: PurchaseGridErrorKey | null;
};

export type PurchaseGridErrorKey =
  | 'empty_product'
  | 'unmatched'
  | 'ambiguous'
  | 'bad_qty'
  | 'bad_cost'
  | 'duplicate';

export function createEmptyPurchaseRows(count: number): PurchaseGridRow[] {
  return Array.from({ length: Math.max(0, count) }, () => ({
    id: crypto.randomUUID(),
    code: '',
    productId: '',
    description: '',
    quantity: '1',
    unitPrice: '',
    errorKey: null,
  }));
}

export function resolvePurchaseCode(
  products: Product[],
  code: string,
): { product: Product | null; errorKey: PurchaseGridErrorKey | null } {
  const trimmed = code.trim();
  if (!trimmed) return { product: null, errorKey: null };
  const matches = productsForCode(products, trimmed);
  if (matches.length === 0) return { product: null, errorKey: 'unmatched' };
  // Multiple warehouse splits: pick the original catalogue row for receiving.
  if (matches.length > 1) {
    const originals = matches.filter((p) => !String(p.id).startsWith('PROD_SPLIT_'));
    if (originals.length > 1) {
      // Distinct products sharing a barcode — merchant must disambiguate.
      const uniqueIds = new Set(originals.map((p) => p.id));
      if (uniqueIds.size > 1) return { product: null, errorKey: 'ambiguous' };
    }
  }
  const product = pickForPurchase(matches) || null;
  if (!product) return { product: null, errorKey: 'unmatched' };
  return { product, errorKey: null };
}

export function applyCodeToRow(row: PurchaseGridRow, products: Product[]): PurchaseGridRow {
  const { product, errorKey } = resolvePurchaseCode(products, row.code);
  if (!product) {
    return {
      ...row,
      productId: '',
      description: '',
      errorKey: row.code.trim() ? errorKey : null,
    };
  }
  const cost = Number(product.unitCost);
  return {
    ...row,
    productId: product.id,
    description: product.name,
    unitPrice: row.unitPrice.trim() !== '' ? row.unitPrice : (Number.isFinite(cost) ? String(cost) : ''),
    errorKey: null,
  };
}

export function purchaseGridErrorMessage(key: PurchaseGridErrorKey, isRtl: boolean): string {
  const t = (ar: string, en: string) => (isRtl ? ar : en);
  switch (key) {
    case 'empty_product':
      return t('أدخل رمز الصنف أو الباركود لكل بند.', 'Enter a product code or barcode on every line.');
    case 'unmatched':
      return t('لم يُعثر على صنف بهذا الرمز في المخزون.', 'No product matches this code in inventory.');
    case 'ambiguous':
      return t('هذا الرمز يطابق أكثر من صنف. افتح النموذج الكلاسيكي لاختيار الصنف.', 'This code matches more than one product. Use the classic form to pick one.');
    case 'bad_qty':
      return t('الكمية يجب أن تكون رقماً أكبر من صفر.', 'Quantity must be a number greater than zero.');
    case 'bad_cost':
      return t('سعر التكلفة غير صالح.', 'Cost price is not valid.');
    case 'duplicate':
      return t('الصنف مكرر في الجدول بنفس سعر التكلفة. ادمج الكميات أو غيّر السعر.', 'Duplicate product at the same cost. Merge quantities or change the cost.');
    default:
      return t('تعذّر التحقق من البنود.', 'Could not validate the lines.');
  }
}

export type PurchaseGridValidation = {
  ok: boolean;
  rows: PurchaseGridRow[];
  items: Omit<InvoiceItem, 'total'>[];
  errors: Array<{ rowIndex: number; key: PurchaseGridErrorKey }>;
};

/** Validate grid rows and build invoice line items (empty trailing rows ignored). */
export function validatePurchaseGrid(
  rows: PurchaseGridRow[],
  products: Product[],
): PurchaseGridValidation {
  const active = rows
    .map((row, rowIndex) => ({ row: applyCodeToRow(row, products), rowIndex }))
    .filter(({ row }) => row.code.trim() || row.productId || row.quantity.trim() !== '1' || row.unitPrice.trim());

  const annotated: PurchaseGridRow[] = rows.map((r) => ({ ...r, errorKey: null }));
  const errors: Array<{ rowIndex: number; key: PurchaseGridErrorKey }> = [];
  const items: Omit<InvoiceItem, 'total'>[] = [];
  const seen = new Map<string, number>();

  for (const { row, rowIndex } of active) {
    const resolved = applyCodeToRow(row, products);
    annotated[rowIndex] = { ...resolved };

    if (!resolved.productId) {
      const key: PurchaseGridErrorKey = resolved.errorKey === 'ambiguous' ? 'ambiguous'
        : resolved.errorKey === 'unmatched' ? 'unmatched'
          : 'empty_product';
      annotated[rowIndex] = { ...resolved, errorKey: key };
      errors.push({ rowIndex, key });
      continue;
    }

    const qty = parseGridNumber(resolved.quantity);
    if (qty === null || Number.isNaN(qty) || qty <= 0) {
      annotated[rowIndex] = { ...resolved, errorKey: 'bad_qty' };
      errors.push({ rowIndex, key: 'bad_qty' });
      continue;
    }

    const cost = parseGridNumber(resolved.unitPrice);
    if (cost === null || Number.isNaN(cost) || cost < 0) {
      annotated[rowIndex] = { ...resolved, errorKey: 'bad_cost' };
      errors.push({ rowIndex, key: 'bad_cost' });
      continue;
    }

    const dupKey = `${resolved.productId}|${cost}`;
    if (seen.has(dupKey)) {
      annotated[rowIndex] = { ...resolved, errorKey: 'duplicate' };
      errors.push({ rowIndex, key: 'duplicate' });
      continue;
    }
    seen.set(dupKey, rowIndex);

    items.push({
      productId: resolved.productId,
      description: resolved.description,
      quantity: qty,
      unitPrice: cost,
    });
  }

  return { ok: errors.length === 0 && items.length > 0, rows: annotated, items, errors };
}

export function purchaseGridRowTotal(row: PurchaseGridRow): number {
  return roundMoney(lineTotal(parseGridNumber(row.quantity), parseGridNumber(row.unitPrice)));
}

export function purchaseGridGrandTotal(rows: PurchaseGridRow[]): number {
  return roundMoney(rows.reduce((sum, row) => sum + purchaseGridRowTotal(row), 0));
}
