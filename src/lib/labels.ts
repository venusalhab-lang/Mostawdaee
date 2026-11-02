import { barcodeSvg, encodeBarcode } from './barcode';
import { escapeHtml } from './invoiceDocument';

export type LabelSizeId = 'roll-50x30' | 'roll-40x25' | 'roll-38x25' | 'roll-58x40' | 'a4-3x8';

export interface LabelSize {
  id: LabelSizeId;
  widthMm: number;
  heightMm: number;
  /** Labels on an A4 sheet in a grid; otherwise one label per page of a label-printer roll. */
  sheet?: { columns: number; rows: number };
  ar: string;
  en: string;
}

export const LABEL_SIZES: LabelSize[] = [
  { id: 'roll-50x30', widthMm: 50, heightMm: 30, ar: 'لفة ملصقات 50×30 مم', en: 'Label roll 50×30 mm' },
  { id: 'roll-40x25', widthMm: 40, heightMm: 25, ar: 'لفة ملصقات 40×25 مم', en: 'Label roll 40×25 mm' },
  { id: 'roll-38x25', widthMm: 38, heightMm: 25, ar: 'لفة ملصقات 38×25 مم', en: 'Label roll 38×25 mm' },
  { id: 'roll-58x40', widthMm: 58, heightMm: 40, ar: 'لفة ملصقات 58×40 مم', en: 'Label roll 58×40 mm' },
  { id: 'a4-3x8', widthMm: 70, heightMm: 37, sheet: { columns: 3, rows: 8 }, ar: 'ورقة A4 (24 ملصقاً 70×37 مم)', en: 'A4 sheet (24 labels, 70×37 mm)' },
];

/** Enough for a full delivery; beyond this the print preview becomes unusably slow on phones. */
export const MAX_LABELS = 1000;

export interface LabelRow {
  name: string;
  code: string;
  /** Already formatted in the product's own currency. */
  price?: string;
  copies: number;
}

export interface LabelOptions {
  size: LabelSizeId;
  showName: boolean;
  showPrice: boolean;
  businessName?: string;
  isRtl: boolean;
}

export function labelSize(id: LabelSizeId): LabelSize {
  return LABEL_SIZES.find((s) => s.id === id) || LABEL_SIZES[0];
}

export function canPrintCode(code: string): boolean {
  return !!encodeBarcode(code);
}

/** Narrowest bar on this label size, in mm (label padding and quiet zones included). Null when not printable. */
export function moduleWidthMm(code: string, id: LabelSizeId): number | null {
  const barcode = encodeBarcode(code);
  if (!barcode) return null;
  return (labelSize(id).widthMm - 4) / (barcode.modules.length + 20);
}

/** Below this, 203 dpi label printers smear the bars and scanners start to miss. */
export const MIN_MODULE_MM = 0.25;

export function totalLabels(rows: Pick<LabelRow, 'copies'>[]): number {
  return rows.reduce((sum, r) => sum + Math.max(0, Math.floor(Number(r.copies) || 0)), 0);
}

function labelHtml(row: LabelRow, size: LabelSize, opts: LabelOptions): string {
  const barcode = encodeBarcode(row.code);
  if (!barcode) return '';
  const small = size.heightMm < 30;
  const nameSize = small ? 2.6 : 3;
  const priceSize = small ? 3.6 : 4.4;
  return `<div class="label">
    ${opts.businessName ? `<div class="store">${escapeHtml(opts.businessName)}</div>` : ''}
    ${opts.showName ? `<div class="name" style="font-size:${nameSize}mm;-webkit-line-clamp:${size.heightMm >= 37 ? 2 : 1}">${escapeHtml(row.name)}</div>` : ''}
    <div class="bars">${barcodeSvg(barcode)}</div>
    <div class="code" dir="ltr">${escapeHtml(barcode.text)}</div>
    ${opts.showPrice && row.price ? `<div class="price" dir="ltr" style="font-size:${priceSize}mm">${escapeHtml(row.price)}</div>` : ''}
  </div>`;
}

/** A print-ready HTML document of all labels; rows whose code cannot be drawn as a barcode are left out. */
export function buildLabelsHtml(rows: LabelRow[], opts: LabelOptions): string {
  const size = labelSize(opts.size);
  const labels: string[] = [];
  for (const row of rows) {
    const copies = Math.max(0, Math.floor(Number(row.copies) || 0));
    if (!copies) continue;
    const one = labelHtml(row, size, opts);
    if (!one) continue;
    for (let i = 0; i < copies && labels.length < MAX_LABELS; i++) labels.push(one);
  }
  const { widthMm: w, heightMm: h } = size;
  const page = size.sheet
    ? `@page { size: A4; margin: 0; }
       .sheet { display: grid; grid-template-columns: repeat(${size.sheet.columns}, ${w}mm); grid-auto-rows: ${h}mm; justify-content: center; padding-top: ${(297 - size.sheet.rows * h) / 2}mm; }
       .label { break-inside: avoid; }`
    : `@page { size: ${w}mm ${h}mm; margin: 0; }
       .label { break-after: page; page-break-after: always; }
       .label:last-child { break-after: auto; page-break-after: auto; }`;
  return `<!doctype html>
<html lang="${opts.isRtl ? 'ar' : 'en'}" dir="${opts.isRtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${opts.isRtl ? 'ملصقات الباركود' : 'Barcode labels'}</title>
<style>
  ${page}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; color: #000; font-family: Tahoma, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label { width: ${w}mm; height: ${h}mm; padding: 1.2mm 2mm; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.4mm; text-align: center; }
  .store { font-size: 2.2mm; font-weight: 700; line-height: 1.45; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-weight: 700; line-height: 1.4; max-width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .label > * { flex-shrink: 0; }
  .bars { width: 100%; flex: 1 1 auto; min-height: 6mm; max-height: ${Math.round(h * 0.45)}mm; }
  .bars svg { display: block; width: 100%; height: 100%; }
  .code { font-family: 'Courier New', monospace; font-size: 2.4mm; letter-spacing: 0.3mm; line-height: 1.2; }
  .price { font-weight: 800; line-height: 1.25; }
</style>
</head>
<body>
<div class="${size.sheet ? 'sheet' : 'roll'}">
${labels.join('\n')}
</div>
</body>
</html>`;
}
