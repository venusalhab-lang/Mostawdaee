import type { InvoiceItem, Product } from '../types';
import { roundMoney } from './exchangeRates';
import { roundQty } from './stock';
import { sameSku } from './productLookup';

/**
 * Selling by the pack (box, carton) next to the single unit.
 * Stock, cost and the unit selling price always stay per single unit; a pack is only a way to sell or buy
 * `size` units at once, so no box ever has to be "opened" and stock can never disagree between the two.
 */

export const MAX_PACK_SIZE = 10_000;

export interface ProductPack {
  name: string;
  size: number;
  /** Price of one whole pack. */
  price: number;
  barcode?: string;
}

/** Pack prices are stored with the product; use JOD's 3 decimals as a safe max for POS currencies. */
const money = (n: number) => roundMoney(n, 'JOD');

export function isValidPackSize(size: unknown): size is number {
  const n = Number(size);
  return Number.isInteger(n) && n >= 2 && n <= MAX_PACK_SIZE;
}

/** The product's pack, or null when it is sold by the unit only. Without a pack price, the pack costs size × unit price. */
export function productPack(product: Pick<Product, 'packName' | 'packSize' | 'packPrice' | 'packBarcode' | 'sellingPrice'>): ProductPack | null {
  if (!isValidPackSize(product.packSize)) return null;
  const size = Number(product.packSize);
  const stated = Number(product.packPrice);
  return {
    name: product.packName?.trim() || '',
    size,
    price: Number.isFinite(stated) && stated > 0 ? stated : suggestedPackPrice(Number(product.sellingPrice) || 0, size),
    barcode: product.packBarcode?.trim() || undefined,
  };
}

export function suggestedPackPrice(unitPrice: number, size: number): number {
  return money(Math.max(0, unitPrice) * size);
}

/** Effective price of one unit when bought inside the pack. */
export function unitPriceInPack(packPrice: number, size: number): number {
  return size > 0 ? packPrice / size : 0;
}

/** Units of stock a line moves: quantity × packSize on pack lines, quantity otherwise. */
export function lineUnits(item: Pick<InvoiceItem, 'quantity' | 'packSize'>): number {
  const qty = Number(item.quantity) || 0;
  return roundQty(isValidPackSize(item.packSize) ? qty * Number(item.packSize) : qty);
}

export function isPackLine(item: Pick<InvoiceItem, 'packSize'>): boolean {
  return isValidPackSize(item.packSize);
}

/** A cart can hold the same product twice: once by the unit and once by the pack. */
export function lineKey(item: Pick<InvoiceItem, 'productId' | 'packSize'>): string {
  return isPackLine(item) ? `${item.productId}#pack` : item.productId;
}

/** Stock units of one product already in the cart, optionally leaving one line out. */
export function unitsInCart(items: Pick<InvoiceItem, 'productId' | 'packSize' | 'quantity'>[], productId: string, exceptKey?: string): number {
  return roundQty(
    items
      .filter((i) => i.productId === productId && lineKey(i) !== exceptKey)
      .reduce((sum, i) => sum + lineUnits(i), 0),
  );
}

/** Whole packs and the loose units left over. Negative or fractional stock is shown as loose units only. */
export function splitPacks(units: number, size: number): { packs: number; loose: number } {
  const u = roundQty(Number(units) || 0);
  if (!isValidPackSize(size) || u <= 0) return { packs: 0, loose: u };
  const packs = Math.floor(u / size + 1e-9);
  return { packs, loose: roundQty(u - packs * size) };
}

export function unitLabel(product: Pick<Product, 'unitName'>, isRtl: boolean): string {
  return product.unitName?.trim() || (isRtl ? 'وحدة' : 'unit');
}

export function packLabel(pack: Pick<ProductPack, 'name'>, isRtl: boolean): string {
  return pack.name || (isRtl ? 'عبوة' : 'pack');
}

/** "9 صندوق + 12 علبة" for a product with a pack; null for a product sold by the unit only. */
export function formatPackStock(
  units: number,
  product: Pick<Product, 'packName' | 'packSize' | 'packPrice' | 'packBarcode' | 'sellingPrice' | 'unitName'>,
  isRtl: boolean,
  fmt: (n: number) => string = String,
): string | null {
  const pack = productPack(product);
  if (!pack) return null;
  const { packs, loose } = splitPacks(units, pack.size);
  const unit = unitLabel(product, isRtl);
  const name = packLabel(pack, isRtl);
  if (packs === 0) return `${fmt(loose)} ${unit}`;
  return loose === 0 ? `${fmt(packs)} ${name}` : `${fmt(packs)} ${name} + ${fmt(loose)} ${unit}`;
}

/** Quantity column text for a printed or listed line: "2 صندوق (40)" on pack lines, the plain quantity otherwise. */
export function lineQuantityText(item: Pick<InvoiceItem, 'quantity' | 'packSize' | 'packName'>, isRtl: boolean): string {
  if (!isPackLine(item)) return String(item.quantity);
  return `${item.quantity} ${item.packName?.trim() || (isRtl ? 'عبوة' : 'pack')} (${lineUnits(item)})`;
}

/** Fields that make a line a pack line for this product, or a unit line again. */
export function lineAsPack(pack: ProductPack): Pick<InvoiceItem, 'packSize' | 'packName' | 'unitPrice'> {
  return { packSize: pack.size, packName: pack.name || undefined, unitPrice: pack.price };
}

export function lineAsUnit(product: Product): Pick<InvoiceItem, 'packSize' | 'packName' | 'unitPrice'> {
  return { packSize: undefined, packName: undefined, unitPrice: Number(product.sellingPrice) || 0 };
}

/** Rows whose pack barcode equals the scanned code (only products with an active pack). */
export function productsForPackCode<T extends Pick<Product, 'packBarcode' | 'packSize'>>(products: T[], code: string): T[] {
  const c = code.trim();
  if (!c) return [];
  return products.filter((p) => isValidPackSize(p.packSize) && sameSku(p.packBarcode, c));
}

export type PackIssue = 'pack_size' | 'pack_price' | 'pack_barcode_same' | 'pack_barcode_taken';

/**
 * Checks the pack part of the product form. `others` are the other products (rows of this same product in other
 * warehouses share its barcode and are not a conflict).
 */
export function packIssues(
  input: Pick<Product, 'sku' | 'packSize' | 'packPrice' | 'packBarcode'>,
  others: Pick<Product, 'sku' | 'packBarcode'>[],
): PackIssue[] {
  const issues: PackIssue[] = [];
  if (!isValidPackSize(input.packSize)) issues.push('pack_size');
  const price = Number(input.packPrice);
  if (!(Number.isFinite(price) && price > 0)) issues.push('pack_price');
  const code = input.packBarcode?.trim();
  if (code) {
    if (sameSku(code, input.sku)) issues.push('pack_barcode_same');
    else if (others.some((p) => !sameSku(p.sku, input.sku) && (sameSku(p.sku, code) || sameSku(p.packBarcode, code)))) {
      issues.push('pack_barcode_taken');
    }
  }
  return issues;
}

/** Pack fields to store on the product: all set, or all cleared when the product is sold by the unit only. */
export function packFields(
  enabled: boolean,
  input: Pick<Product, 'unitName' | 'packName' | 'packSize' | 'packPrice' | 'packBarcode'>,
): Pick<Product, 'unitName' | 'packName' | 'packSize' | 'packPrice' | 'packBarcode'> {
  const unitName = input.unitName?.trim() || undefined;
  if (!enabled) return { unitName, packName: undefined, packSize: undefined, packPrice: undefined, packBarcode: undefined };
  return {
    unitName,
    packName: input.packName?.trim() || undefined,
    packSize: Number(input.packSize),
    packPrice: money(Number(input.packPrice)),
    packBarcode: input.packBarcode?.trim() || undefined,
  };
}
