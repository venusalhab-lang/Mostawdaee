import { describe, expect, it } from 'vitest';
import type { Invoice, Product } from '../../types';
import {
  formatPackStock,
  lineAsPack,
  lineAsUnit,
  lineQuantityText,
  lineUnits,
  packFields,
  packIssues,
  productPack,
  productsForPackCode,
  splitPacks,
  suggestedPackPrice,
} from '../packs';
import { planStockReversal, quantitiesByProduct } from '../invoiceReversal';
import { localSaleShortages } from '../offlineQueue';
import { saleInvoiceProfit, weightedAverageCost } from '../profits';
import { joFotaraFromInvoice } from '../jofotara';
import { countBarcode } from '../inventoryAudit';

const juice: Product = {
  id: 'p1',
  name: 'عصير',
  sku: '6251001',
  category: '',
  brand: '',
  quantity: 200,
  unitCost: 0.4,
  sellingPrice: 0.5,
  status: 'In Stock',
  dateAdded: 0,
  currency: 'JOD',
  unitName: 'علبة',
  packName: 'صندوق',
  packSize: 20,
  packPrice: 9,
  packBarcode: '6251001-BOX',
};

describe('product pack', () => {
  it('is active only with a whole pack size of 2 or more', () => {
    expect(productPack(juice)).toEqual({ name: 'صندوق', size: 20, price: 9, barcode: '6251001-BOX' });
    expect(productPack({ ...juice, packSize: 1 })).toBeNull();
    expect(productPack({ ...juice, packSize: 2.5 })).toBeNull();
    expect(productPack({ ...juice, packSize: undefined })).toBeNull();
  });

  it('prices a pack at size × unit price when no pack price is stored', () => {
    expect(productPack({ ...juice, packPrice: undefined })?.price).toBe(10);
    expect(suggestedPackPrice(0.35, 24)).toBe(8.4);
  });

  it('shows stock as whole packs plus loose units', () => {
    expect(splitPacks(200, 20)).toEqual({ packs: 10, loose: 0 });
    expect(splitPacks(192, 20)).toEqual({ packs: 9, loose: 12 });
    expect(splitPacks(-3, 20)).toEqual({ packs: 0, loose: -3 });
    expect(formatPackStock(192, juice, true)).toBe('9 صندوق + 12 علبة');
    expect(formatPackStock(200, juice, true)).toBe('10 صندوق');
    expect(formatPackStock(7, juice, true)).toBe('7 علبة');
    expect(formatPackStock(7, { ...juice, packSize: undefined }, true)).toBeNull();
    expect(formatPackStock(25, { ...juice, unitName: '', packName: '' }, false)).toBe('1 pack + 5 unit');
  });

  it('switches a line between the pack and the unit', () => {
    const pack = productPack(juice)!;
    expect(lineAsPack(pack)).toEqual({ packSize: 20, packName: 'صندوق', unitPrice: 9 });
    expect(lineAsUnit(juice)).toEqual({ packSize: undefined, packName: undefined, unitPrice: 0.5 });
  });

  it('finds a product by its pack barcode only when the pack is active', () => {
    expect(productsForPackCode([juice], ' 6251001-box ')).toEqual([juice]);
    expect(productsForPackCode([{ ...juice, packSize: undefined }], '6251001-BOX')).toEqual([]);
  });

  it('validates the pack part of the product form', () => {
    expect(packIssues(juice, [])).toEqual([]);
    expect(packIssues({ ...juice, packSize: 1, packPrice: 0 }, [])).toEqual(['pack_size', 'pack_price']);
    expect(packIssues({ ...juice, packBarcode: '6251001' }, [])).toEqual(['pack_barcode_same']);
    expect(packIssues(juice, [{ sku: '6251001-BOX' }])).toEqual(['pack_barcode_taken']);
    expect(packIssues(juice, [{ sku: '999', packBarcode: '6251001-box' }])).toEqual(['pack_barcode_taken']);
    // The same product in another warehouse shares both barcodes.
    expect(packIssues(juice, [{ sku: '6251001', packBarcode: '6251001-BOX' }])).toEqual([]);
  });

  it('stores all pack fields, or clears them all', () => {
    expect(packFields(true, { ...juice, packName: ' صندوق ', packPrice: 9.00049 })).toEqual({
      unitName: 'علبة', packName: 'صندوق', packSize: 20, packPrice: 9, packBarcode: '6251001-BOX',
    });
    expect(packFields(false, juice)).toEqual({
      unitName: 'علبة', packName: undefined, packSize: undefined, packPrice: undefined, packBarcode: undefined,
    });
  });
});

describe('pack lines move stock in units', () => {
  const sale: Invoice = {
    id: 'i1',
    invoiceNumber: 'INV-1',
    date: Date.UTC(2026, 9, 11, 9),
    items: [
      { productId: 'p1', description: 'عصير', quantity: 2, unitPrice: 9, total: 18, packSize: 20, packName: 'صندوق', unitCost: 0.4, costCurrency: 'JOD' },
      { productId: 'p1', description: 'عصير', quantity: 3, unitPrice: 0.5, total: 1.5, unitCost: 0.4, costCurrency: 'JOD' },
    ],
    subtotal: 19.5,
    taxAmount: 0,
    totalAmount: 19.5,
    type: 'sale',
    currency: 'JOD',
  };

  it('counts quantity × pack size', () => {
    expect(lineUnits(sale.items[0])).toBe(40);
    expect(lineUnits({ quantity: 2, packSize: 1 })).toBe(2);
    expect(quantitiesByProduct(sale.items).get('p1')?.qty).toBe(43);
    expect(lineQuantityText(sale.items[0], true)).toBe('2 صندوق (40)');
    expect(lineQuantityText(sale.items[1], true)).toBe('3');
  });

  it('refuses an offline sale beyond stock and gives the units back when deleted', () => {
    expect(localSaleShortages(sale, [{ ...juice, quantity: 42 }])).toEqual([
      { productId: 'p1', name: 'عصير', available: 42, requested: 43 },
    ]);
    expect(planStockReversal(sale, new Map([['p1', { quantity: 157 }]])).updates).toEqual([{ productId: 'p1', quantity: 200 }]);
  });

  it('costs pack lines per unit, so profit is the same however the goods were sold', () => {
    const profit = saleInvoiceProfit(sale, new Map(), {}, 'JOD');
    expect(profit.cost).toBeCloseTo(43 * 0.4, 9);
    expect(profit.profit).toBeCloseTo(19.5 - 17.2, 9);
  });

  it('a purchase by the pack averages the cost per unit', () => {
    // 10 boxes of 20 at 6 per box = 0.3 per unit, onto 200 units at 0.4.
    expect(weightedAverageCost(juice, 200, 60, 'JOD', 'JOD')).toBe(0.35);
  });

  it('a stocktake scan of the pack barcode counts a whole pack', () => {
    const product = { id: 'p1', name: 'عصير', sku: '6251001', quantity: 200, unitCost: 0.4, currency: 'JOD' };
    const first = countBarcode([], product, 'a1', 20).lines;
    expect(first[0].actualQty).toBe(20);
    const second = countBarcode(first, product, 'a1').lines;
    expect([second[0].actualQty, second[0].difference]).toEqual([21, -179]);
  });

  it('names the pack on the e-invoice line', () => {
    const r = joFotaraFromInvoice(sale, {
      seller: { tin: '12345678', name: 'متجر', incomeSource: '1234', family: 'income' },
      uuid: '3f2b8c1e-4d5a-4b6c-9e7f-1a2b3c4d5e6f',
      icv: 1,
    });
    expect(r.ok && r.doc.lines.map((l) => [l.name, l.quantity, l.unitPrice])).toEqual([
      ['عصير - صندوق × 20', 2, 9],
      ['عصير', 3, 0.5],
    ]);
  });
});
