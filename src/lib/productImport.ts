import { POS_CURRENCY_CODES } from './exchangeRates';

export type ImportField = 'name' | 'sku' | 'category' | 'brand' | 'quantity' | 'currency' | 'unitCost' | 'sellingPrice' | 'expiryDate';

export interface ParsedProductRow {
  line: number; // 1-based spreadsheet line (header = 1)
  name: string;
  sku: string;
  category: string;
  brand: string;
  quantity?: number;
  currency?: string;
  unitCost?: number;
  sellingPrice?: number;
  expiryDate?: number;
}

export interface ParseResult {
  rows: ParsedProductRow[];
  errors: string[];
  detectedFields: ImportField[];
  missingRequired: ImportField[];
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalizeDigits(v: string): string {
  return v.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, '');
}

/** Maps a spreadsheet header (Arabic or English, including the app's own export headers) to a field. */
export function detectField(header: string): ImportField | null {
  const h = String(header || '').trim().toLowerCase();
  if (!h) return null;
  if (/حالة|status|قيمة|valuation|total|الكلية/.test(h)) return null;
  if (/sku|باركود|barcode/.test(h)) return 'sku';
  if (/صلاحية|expiry|expire/.test(h)) return 'expiryDate';
  if (/عملة|currency/.test(h)) return 'currency';
  if (/تصنيف|category/.test(h)) return 'category';
  if (/علامة|ماركة|brand/.test(h)) return 'brand';
  if (/سعر البيع|selling|sale price|^price$|^سعر$/.test(h)) return 'sellingPrice';
  if (/تكلفة|سعر الشراء|cost|purchase/.test(h)) return 'unitCost';
  if (/كمية|quantity|qty/.test(h)) return 'quantity';
  if (/اسم|name/.test(h)) return 'name';
  return null;
}

function toNumber(raw: unknown): number | undefined | typeof NaN {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  if (typeof raw === 'number') return raw;
  const cleaned = normalizeDigits(String(raw)).replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  return Number(cleaned);
}

function toTimestamp(raw: unknown): number | undefined | typeof NaN {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? NaN : raw.getTime();
  const t = new Date(normalizeDigits(String(raw)).trim()).getTime();
  return Number.isNaN(t) ? NaN : t;
}

/** Pure function: turns sheet rows (objects keyed by header) into validated product rows. */
export function parseProductRows(
  sheetRows: Record<string, unknown>[],
  defaultCurrency: string,
  isRtl = true,
): ParseResult {
  const errors: string[] = [];
  const rows: ParsedProductRow[] = [];
  const seen = new Map<string, number>();

  const headers = sheetRows.length ? Object.keys(sheetRows[0]) : [];
  const fieldByHeader = new Map<string, ImportField>();
  const detected = new Set<ImportField>();
  headers.forEach((h) => {
    const f = detectField(h);
    if (f && !detected.has(f)) {
      fieldByHeader.set(h, f);
      detected.add(f);
    }
  });

  const missingRequired = (['name', 'sku'] as ImportField[]).filter((f) => !detected.has(f));
  if (missingRequired.length) {
    errors.push(isRtl
      ? `أعمدة مطلوبة غير موجودة: ${missingRequired.map((f) => (f === 'name' ? 'اسم المنتج' : 'SKU / الباركود')).join('، ')}`
      : `Missing required columns: ${missingRequired.join(', ')}`);
    return { rows, errors, detectedFields: [...detected], missingRequired };
  }

  const err = (line: number, ar: string, en: string) => errors.push(isRtl ? `سطر ${line}: ${ar}` : `Line ${line}: ${en}`);

  sheetRows.forEach((raw, i) => {
    const line = i + 2;
    const get = (f: ImportField) => {
      for (const [h, field] of fieldByHeader) if (field === f) return raw[h];
      return undefined;
    };

    const name = String(get('name') ?? '').trim();
    const sku = String(get('sku') ?? '').trim();
    if (!name && !sku) return; // blank line
    if (!name) return err(line, 'اسم المنتج فارغ', 'name is empty');
    if (!sku) return err(line, 'الباركود فارغ', 'SKU is empty');
    if (name.length > 200) return err(line, 'الاسم أطول من 200 حرف', 'name longer than 200 chars');
    if (sku.length > 64) return err(line, 'الباركود أطول من 64 حرفاً', 'SKU longer than 64 chars');

    const key = sku.toLowerCase();
    if (seen.has(key)) return err(line, `الباركود "${sku}" مكرر داخل الملف (أول ظهور في سطر ${seen.get(key)})`, `SKU "${sku}" is duplicated in the file (first on line ${seen.get(key)})`);

    const quantity = toNumber(get('quantity'));
    const unitCost = toNumber(get('unitCost'));
    const sellingPrice = toNumber(get('sellingPrice'));
    const expiry = toTimestamp(get('expiryDate'));

    for (const [label, value] of [['الكمية', quantity], ['سعر التكلفة', unitCost], ['سعر البيع', sellingPrice]] as const) {
      if (value !== undefined && (Number.isNaN(value) || value < 0)) {
        return err(line, `${label} غير صالحة`, `invalid ${label}`);
      }
    }
    if (expiry !== undefined && Number.isNaN(expiry)) return err(line, 'تاريخ الصلاحية غير صالح (استخدم YYYY-MM-DD)', 'invalid expiry date (use YYYY-MM-DD)');

    let currency = String(get('currency') ?? '').trim().toUpperCase();
    if (currency && !(POS_CURRENCY_CODES as readonly string[]).includes(currency)) {
      return err(line, `عملة غير مدعومة "${currency}"`, `unsupported currency "${currency}"`);
    }
    if (!currency) currency = defaultCurrency;

    seen.set(key, line);
    rows.push({
      line,
      name,
      sku,
      category: String(get('category') ?? '').trim(),
      brand: String(get('brand') ?? '').trim(),
      quantity: quantity as number | undefined,
      currency,
      unitCost: unitCost as number | undefined,
      sellingPrice: sellingPrice as number | undefined,
      expiryDate: expiry as number | undefined,
    });
  });

  return { rows, errors, detectedFields: [...detected], missingRequired };
}
