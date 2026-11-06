import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../types';
import { DRAWER_PULSE, buildRasterJob, bytesToBase64, paperDots, toMonochrome, trimBottom } from '../escpos';
import { formatReceiptMoney } from '../exchangeRates';
import { buildReceiptHtml, buildTestPageHtml, formatReceiptAmount, printableMm, receiptFigures } from '../receipt';

function rgba(width: number, height: number, black: (x: number, y: number) => boolean, alpha = 255): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = black(x, y) ? 0 : 255;
      px.set([v, v, v, alpha], (y * width + x) * 4);
    }
  }
  return px;
}

describe('toMonochrome', () => {
  it('packs pixels most significant bit first with black as 1, padding the last byte', () => {
    const bmp = toMonochrome(rgba(10, 2, (x, y) => (y === 0 ? x === 0 || x === 9 : x === 7)), 10, 2);
    expect(bmp.rowBytes).toBe(2);
    expect(Array.from(bmp.data)).toEqual([0b10000000, 0b01000000, 0b00000001, 0b00000000]);
  });

  it('treats transparent pixels as paper and splits grey at the threshold', () => {
    expect(toMonochrome(rgba(8, 1, () => true, 0), 8, 1).data[0]).toBe(0);
    const grey = new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255]);
    expect(toMonochrome(grey, 2, 1).data[0]).toBe(0b10000000);
  });

  it('trims blank rows at the bottom only', () => {
    const bmp = trimBottom(toMonochrome(rgba(8, 5, (_x, y) => y === 1), 8, 5));
    expect(bmp.height).toBe(2);
    expect(Array.from(bmp.data)).toEqual([0, 0xff]);
    expect(trimBottom(toMonochrome(rgba(8, 3, () => false), 8, 3)).height).toBe(0);
  });
});

describe('buildRasterJob', () => {
  const bmp = toMonochrome(rgba(16, 300, (x) => x < 8), 16, 300);

  it('initializes, sends the image in GS v 0 bands, feeds and cuts', () => {
    const job = buildRasterJob(bmp, { bandRows: 128, feedLines: 3 });
    expect(Array.from(job.subarray(0, 2))).toEqual([0x1b, 0x40]);
    const header = (at: number) => Array.from(job.subarray(at, at + 8));
    expect(header(2)).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 128, 0]);
    const second = 2 + 8 + 2 * 128;
    expect(header(second)).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 128, 0]);
    const third = second + 8 + 2 * 128;
    expect(header(third)).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 44, 0]);
    const tail = Array.from(job.subarray(job.length - 7));
    expect(tail).toEqual([0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00]);
    expect(job.length).toBe(2 + 3 * 8 + 2 * 300 + 7);
    expect(job[10]).toBe(0xff);
    expect(job[11]).toBe(0x00);
  });

  it('pulses the cash drawer after the cut only when asked', () => {
    const plain = buildRasterJob(bmp);
    const kicked = buildRasterJob(bmp, { openDrawer: true });
    expect(kicked.length).toBe(plain.length + 5);
    expect(Array.from(kicked.subarray(kicked.length - 9))).toEqual([0x1d, 0x56, 0x42, 0x00, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect(Array.from(DRAWER_PULSE)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect(Array.from(plain).join(',')).not.toContain('27,112,0,25,250');
  });

  it('can skip the cut', () => {
    const job = buildRasterJob(bmp, { cut: false });
    expect(Array.from(job.subarray(job.length - 3))).toEqual([0x1b, 0x64, 4]);
  });

  it('matches the print head width of each paper', () => {
    expect(paperDots(58)).toBe(384);
    expect(paperDots(80)).toBe(576);
    expect(printableMm(58)).toBe(48);
    expect(printableMm(80)).toBe(72);
  });

  it('encodes bytes to base64 for the native bridge', () => {
    expect(bytesToBase64(new Uint8Array([0x1b, 0x40, 0xff]))).toBe('G0D/');
    const big = new Uint8Array(70_000).fill(65);
    expect(atob(bytesToBase64(big))).toHaveLength(70_000);
  });
});

describe('receipt html', () => {
  const sale: Invoice = {
    id: 's1', invoiceNumber: 'POS-1', date: 0, type: 'sale', currency: 'JOD',
    items: [{ productId: 'p', description: 'Tea <script>', quantity: 2, unitPrice: 1.5, total: 3 }],
    subtotal: 9, discount: 0.5, taxAmount: 0, totalAmount: 99, paymentMethod: 'cash', cashReceived: 5, changeDue: 0,
    vatRate: 0,
  };
  const base = {
    invoice: sale, isRtl: true, businessName: 'Shop & Co', formatDate: () => 'today',
  };

  it('sizes the page to the paper and escapes user text', () => {
    const html = buildReceiptHtml({ ...base, paper: 58 });
    expect(html).toContain('size: 58mm auto');
    expect(html).toContain('width: 48mm');
    expect(html).toContain('Tea &lt;script&gt;');
    expect(html).toContain('Shop &amp; Co');
    expect(html).toContain('مستودعي · mostawdaee.com');
    expect(html).toContain('table class="sums"');
    expect(html).not.toContain('<script>');
    expect(buildReceiptHtml({ ...base, paper: 80 })).toContain('width: 72mm');
  });

  it('prints bare ASCII amounts and recomputes subtotal/total from lines', () => {
    expect(formatReceiptAmount(12.5, 'JOD')).toBe('12.500');
    expect(formatReceiptMoney(12.5, 'JOD')).toBe('12.500 JOD');
    expect(formatReceiptMoney(1234.5, 'AED')).toBe('1234.50 AED');
    expect(receiptFigures(sale)).toMatchObject({
      subtotal: 3, discount: 0.5, taxAmount: 0, totalAmount: 2.5, cashReceived: 5, changeDue: 2.5,
    });
    const html = buildReceiptHtml({ ...base, paper: 80 });
    expect(html).toContain('العملة');
    expect(html).toContain('JOD');
    expect(html).toMatch(/المجموع الفرعي[\s\S]*?>3\.000</);
    expect(html).toMatch(/الإجمالي[\s\S]*?>2\.500</);
    expect(html).toContain('-0.500');
    expect(html).toContain('2 x 1.500');
    expect(html).not.toContain('الضريبة');
    expect(html).not.toContain('د.أ');
    expect(html).not.toContain('٩');
    const ret = buildReceiptHtml({ ...base, paper: 80, invoice: { ...sale, type: 'return', returnOfNumber: 'POS-0' } });
    expect(ret).toContain('مرتجع مبيعات');
    expect(ret).toContain('-2.500');
    expect(ret).toContain('#POS-0');
  });

  it('charges VAT on the net after discount when printing', () => {
    const taxed: Invoice = {
      ...sale,
      currency: 'USD',
      items: [{ productId: 'p', description: 'Tea', quantity: 1, unitPrice: 10, total: 10 }],
      discount: 1,
      vatRate: 16,
      subtotal: 0,
      taxAmount: 0,
      totalAmount: 0,
      cashReceived: 20,
      changeDue: 0,
    };
    expect(receiptFigures(taxed)).toMatchObject({
      subtotal: 10, discount: 1, taxAmount: 1.44, totalAmount: 10.44, changeDue: 9.56,
    });
  });

  it('builds a test page for the chosen width', () => {
    const html = buildTestPageHtml(58, false, 'BT-58 <x>');
    expect(html).toContain('size: 58mm auto');
    expect(html).toContain('BT-58 &lt;x&gt;');
    expect(html).toContain('12.500 JOD');
  });
});
