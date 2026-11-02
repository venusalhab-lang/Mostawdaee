import type { Invoice } from '../types';
import { isPackLine } from './packs';

/**
 * Jordan's National Invoicing System (JoFotara), per ISTD's API integration guide v1.5.
 * Builds the UBL 2.1 document for income and general-sales-tax invoices and their returns.
 * Special sales tax (third digit 3) is not supported: the app does not record special tax per item.
 */

export const JOFOTARA_ENDPOINT = 'https://backend.jofotara.gov.jo/core/invoices/';
/** Buyer name is mandatory on cash invoices above this amount (JOD). */
export const JOFOTARA_NAMED_BUYER_ABOVE = 10_000;
/** General sales tax rates the system accepts (percent). */
export const JOFOTARA_VAT_RATES: readonly number[] = [0, 1, 2, 3, 4, 5, 7, 8, 10, 16];

export type JoFotaraFamily = 'income' | 'general_sales';
/** Tax category for a 0% line on a general-sales invoice: Z = exempt, O = zero-rated. */
export type JoFotaraZeroCategory = 'Z' | 'O';
export type JoFotaraBuyerIdType = 'NIN' | 'PN' | 'TN';

export interface JoFotaraSeller {
  tin: string;
  name: string;
  incomeSource: string;
  family: JoFotaraFamily;
  zeroRateCategory?: JoFotaraZeroCategory | null;
}

export interface JoFotaraBuyer {
  name?: string;
  idType?: JoFotaraBuyerIdType;
  id?: string;
  phone?: string;
}

export interface JoFotaraLine {
  /** Line number; on a return it must be the line number of the original invoice. */
  id: number;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface JoFotaraDocument {
  kind: 'invoice' | 'credit';
  number: string;
  uuid: string;
  icv: number;
  /** yyyy-mm-dd */
  issueDate: string;
  payment: 'cash' | 'receivable';
  note?: string;
  seller: JoFotaraSeller;
  buyer: JoFotaraBuyer;
  lines: JoFotaraLine[];
  /** VAT percent applied to every line. Must be 0 on income invoices. */
  taxRate: number;
  original?: { number: string; uuid: string; total: number };
  returnReason?: string;
}

export type JoFotaraIssueCode =
  | 'seller_tin'
  | 'seller_name'
  | 'income_source'
  | 'number'
  | 'uuid'
  | 'icv'
  | 'issue_date'
  | 'no_lines'
  | 'line_name'
  | 'line_quantity'
  | 'line_price'
  | 'line_discount'
  | 'line_id'
  | 'tax_rate'
  | 'zero_category'
  | 'income_has_tax'
  | 'buyer_name'
  | 'buyer_id'
  | 'buyer_phone'
  | 'original'
  | 'return_reason'
  | 'not_sale'
  | 'currency'
  | 'totals_mismatch';

export interface JoFotaraIssue {
  code: JoFotaraIssueCode;
  /** 1-based line number when the issue belongs to a line. */
  line?: number;
}

export interface JoFotaraTotals {
  taxExclusive: string;
  discount: string;
  tax: string;
  payable: string;
}

export type JoFotaraBuild =
  | { ok: true; xml: string; typeCode: string; totals: JoFotaraTotals }
  | { ok: false; issues: JoFotaraIssue[] };

// ---------------------------------------------------------------------------
// Fixed-point money with 9 decimals (the guide allows up to 9), so no float drift reaches the totals.
// ---------------------------------------------------------------------------
const SCALE = 1_000_000_000n;

function toNano(value: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const fixed = Math.abs(value).toFixed(9);
  const [whole, frac = ''] = fixed.split('.');
  const nano = BigInt(whole) * SCALE + BigInt(frac.padEnd(9, '0').slice(0, 9));
  return value < 0 ? -nano : nano;
}

function mulNano(a: bigint, b: bigint): bigint {
  const product = a * b;
  const half = SCALE / 2n;
  return product >= 0n ? (product + half) / SCALE : -((-product + half) / SCALE);
}

function formatNano(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const text = `${abs / SCALE}.${(abs % SCALE).toString().padStart(9, '0')}`;
  return negative ? `-${text}` : text;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isJoFotaraTin(value: string): boolean {
  return /^\d{5,15}$/.test(value.trim());
}

export function isJoFotaraIncomeSource(value: string): boolean {
  return /^\d{1,20}$/.test(value.trim());
}

/** Digits only, 9 to 14 of them, as the guide requires; anything else is left out of the file. */
export function joFotaraPhone(value: string | undefined | null): string | undefined {
  const digits = String(value ?? '').replace(/[\s\-()+]/g, '');
  return /^\d{9,14}$/.test(digits) ? digits : undefined;
}

/** Name attribute of InvoiceTypeCode: local (0), cash 1 / receivable 2, income 1 / general sales 2. */
export function joFotaraTypeCode(payment: JoFotaraDocument['payment'], family: JoFotaraFamily): string {
  return `0${payment === 'receivable' ? 2 : 1}${family === 'income' ? 1 : 2}`;
}

interface LineMath {
  line: JoFotaraLine;
  gross: bigint;
  discount: bigint;
  net: bigint;
  tax: bigint;
}

function checkDocument(doc: JoFotaraDocument): JoFotaraIssue[] {
  const issues: JoFotaraIssue[] = [];
  const { seller, buyer } = doc;
  if (!isJoFotaraTin(seller.tin || '')) issues.push({ code: 'seller_tin' });
  if (!seller.name?.trim() || seller.name.trim().length > 200) issues.push({ code: 'seller_name' });
  if (!isJoFotaraIncomeSource(seller.incomeSource || '')) issues.push({ code: 'income_source' });
  if (!doc.number?.trim() || doc.number.trim().length > 50) issues.push({ code: 'number' });
  if (!UUID_PATTERN.test(doc.uuid || '')) issues.push({ code: 'uuid' });
  if (!Number.isSafeInteger(doc.icv) || doc.icv < 1) issues.push({ code: 'icv' });
  if (!DATE_PATTERN.test(doc.issueDate || '')) issues.push({ code: 'issue_date' });

  if (!doc.lines.length) issues.push({ code: 'no_lines' });
  const ids = new Set<number>();
  doc.lines.forEach((line, index) => {
    const at = index + 1;
    if (!Number.isSafeInteger(line.id) || line.id < 1 || ids.has(line.id)) issues.push({ code: 'line_id', line: at });
    ids.add(line.id);
    if (!line.name?.trim()) issues.push({ code: 'line_name', line: at });
    if (!(line.quantity > 0)) issues.push({ code: 'line_quantity', line: at });
    if (!(line.unitPrice > 0)) issues.push({ code: 'line_price', line: at });
    const gross = mulNano(toNano(line.quantity), toNano(line.unitPrice));
    if (!(line.discount >= 0) || toNano(line.discount) > gross) issues.push({ code: 'line_discount', line: at });
  });

  if (seller.family === 'income') {
    if (doc.taxRate !== 0) issues.push({ code: 'income_has_tax' });
  } else if (!JOFOTARA_VAT_RATES.includes(doc.taxRate)) {
    issues.push({ code: 'tax_rate' });
  } else if (doc.taxRate === 0 && seller.zeroRateCategory !== 'Z' && seller.zeroRateCategory !== 'O') {
    issues.push({ code: 'zero_category' });
  }

  if (buyer.id && !/^\d{1,20}$/.test(buyer.id)) issues.push({ code: 'buyer_id' });
  if (buyer.phone && !/^\d{9,14}$/.test(buyer.phone)) issues.push({ code: 'buyer_phone' });

  if (doc.kind === 'credit') {
    const o = doc.original;
    if (!o || !o.number?.trim() || !UUID_PATTERN.test(o.uuid || '') || !(o.total > 0)) issues.push({ code: 'original' });
    if (!doc.returnReason?.trim()) issues.push({ code: 'return_reason' });
  }
  return issues;
}

function lineMath(doc: JoFotaraDocument): LineMath[] {
  const rate = toNano(doc.taxRate);
  return doc.lines.map((line) => {
    const gross = mulNano(toNano(line.quantity), toNano(line.unitPrice));
    const discount = toNano(line.discount);
    const net = gross - discount;
    const tax = doc.seller.family === 'income' ? 0n : mulNano(net, rate) / 100n;
    return { line, gross, discount, net, tax };
  });
}

export function joFotaraTotals(doc: JoFotaraDocument): JoFotaraTotals {
  const rows = lineMath(doc);
  const sum = (pick: (row: LineMath) => bigint) => rows.reduce((acc, row) => acc + pick(row), 0n);
  return {
    taxExclusive: formatNano(sum((r) => r.gross)),
    discount: formatNano(sum((r) => r.discount)),
    tax: formatNano(sum((r) => r.tax)),
    payable: formatNano(sum((r) => r.net + r.tax)),
  };
}

const AMOUNT = (tag: string, value: bigint) => `<cbc:${tag} currencyID="JO">${formatNano(value)}</cbc:${tag}>`;

export function buildJoFotaraXml(doc: JoFotaraDocument): JoFotaraBuild {
  const issues = checkDocument(doc);
  const rows = issues.length ? [] : lineMath(doc);
  const payable = rows.reduce((acc, r) => acc + r.net + r.tax, 0n);
  if (!issues.length && doc.payment === 'cash' && !doc.buyer.name?.trim() && payable > toNano(JOFOTARA_NAMED_BUYER_ABOVE)) {
    issues.push({ code: 'buyer_name' });
  }
  if (doc.payment === 'receivable' && !doc.buyer.name?.trim()) issues.push({ code: 'buyer_name' });
  if (issues.length) return { ok: false, issues };

  const { seller, buyer } = doc;
  const general = seller.family === 'general_sales';
  const credit = doc.kind === 'credit';
  const typeCode = joFotaraTypeCode(doc.payment, seller.family);
  const category = doc.taxRate > 0 ? 'S' : seller.zeroRateCategory || 'Z';
  const t = joFotaraTotals(doc);
  const totalDiscount = rows.reduce((acc, r) => acc + r.discount, 0n);
  const totalTax = rows.reduce((acc, r) => acc + r.tax, 0n);
  const taxExclusive = rows.reduce((acc, r) => acc + r.gross, 0n);
  const percent = doc.taxRate.toFixed(2);
  const note = doc.note?.trim();

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">',
  );
  parts.push('<cbc:ProfileID>reporting:1.0</cbc:ProfileID>');
  parts.push(`<cbc:ID>${escapeXml(doc.number.trim())}</cbc:ID>`);
  parts.push(`<cbc:UUID>${doc.uuid.toLowerCase()}</cbc:UUID>`);
  parts.push(`<cbc:IssueDate>${doc.issueDate}</cbc:IssueDate>`);
  parts.push(`<cbc:InvoiceTypeCode name="${typeCode}">${credit ? 381 : 388}</cbc:InvoiceTypeCode>`);
  // General-sales returns carry no note in the guide's template; income returns keep it optional.
  if (note && !(credit && general)) parts.push(`<cbc:Note>${escapeXml(note.slice(0, 1000))}</cbc:Note>`);
  parts.push('<cbc:DocumentCurrencyCode>JOD</cbc:DocumentCurrencyCode>');
  parts.push('<cbc:TaxCurrencyCode>JOD</cbc:TaxCurrencyCode>');
  if (credit && doc.original) {
    parts.push(
      '<cac:BillingReference><cac:InvoiceDocumentReference>' +
        `<cbc:ID>${escapeXml(doc.original.number.trim())}</cbc:ID>` +
        `<cbc:UUID>${doc.original.uuid.toLowerCase()}</cbc:UUID>` +
        `<cbc:DocumentDescription>${formatNano(toNano(doc.original.total))}</cbc:DocumentDescription>` +
        '</cac:InvoiceDocumentReference></cac:BillingReference>',
    );
  }
  parts.push(`<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${doc.icv}</cbc:UUID></cac:AdditionalDocumentReference>`);

  parts.push(
    '<cac:AccountingSupplierParty><cac:Party>' +
      '<cac:PostalAddress><cac:Country><cbc:IdentificationCode>JO</cbc:IdentificationCode></cac:Country></cac:PostalAddress>' +
      `<cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(seller.tin.trim())}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` +
      `<cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(seller.name.trim())}</cbc:RegistrationName></cac:PartyLegalEntity>` +
      '</cac:Party></cac:AccountingSupplierParty>',
  );

  parts.push(
    '<cac:AccountingCustomerParty><cac:Party>' +
      `<cac:PartyIdentification><cbc:ID schemeID="${buyer.idType || 'NIN'}">${escapeXml(buyer.id || '')}</cbc:ID></cac:PartyIdentification>` +
      '<cac:PostalAddress><cac:Country><cbc:IdentificationCode>JO</cbc:IdentificationCode></cac:Country></cac:PostalAddress>' +
      `<cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(buyer.name?.trim() || '')}</cbc:RegistrationName></cac:PartyLegalEntity>` +
      '</cac:Party>' +
      (buyer.phone ? `<cac:AccountingContact><cbc:Telephone>${buyer.phone}</cbc:Telephone></cac:AccountingContact>` : '') +
      '</cac:AccountingCustomerParty>',
  );

  parts.push(
    `<cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>${escapeXml(seller.incomeSource.trim())}</cbc:ID></cac:PartyIdentification></cac:Party></cac:SellerSupplierParty>`,
  );

  if (credit) {
    parts.push(
      `<cac:PaymentMeans><cbc:PaymentMeansCode listID="UN/ECE 4461">10</cbc:PaymentMeansCode><cbc:InstructionNote>${escapeXml(doc.returnReason!.trim().slice(0, 1000))}</cbc:InstructionNote></cac:PaymentMeans>`,
    );
  }

  // The system only accepts line discounts; the header carries their sum.
  parts.push(
    `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>${AMOUNT('Amount', totalDiscount)}</cac:AllowanceCharge>`,
  );
  // General-sales returns (012/022) carry extra elements in the guide: taxable amounts per subtotal,
  // a document-level subtotal, BaseQuantity on prices and PrepaidAmount.
  const salesReturn = credit && general;
  const taxCategory =
    `<cac:TaxCategory><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${category}</cbc:ID><cbc:Percent>${percent}</cbc:Percent>` +
    '<cac:TaxScheme><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>';
  const totalNet = rows.reduce((acc, r) => acc + r.net, 0n);
  if (general) {
    parts.push(
      '<cac:TaxTotal>' +
        AMOUNT('TaxAmount', totalTax) +
        (salesReturn ? `<cac:TaxSubtotal>${AMOUNT('TaxableAmount', totalNet)}${AMOUNT('TaxAmount', totalTax)}${taxCategory}</cac:TaxSubtotal>` : '') +
        '</cac:TaxTotal>',
    );
  }
  parts.push(
    '<cac:LegalMonetaryTotal>' +
      AMOUNT('TaxExclusiveAmount', taxExclusive) +
      AMOUNT('TaxInclusiveAmount', payable) +
      AMOUNT('AllowanceTotalAmount', totalDiscount) +
      (salesReturn ? AMOUNT('PrepaidAmount', 0n) : '') +
      AMOUNT('PayableAmount', payable) +
      '</cac:LegalMonetaryTotal>',
  );

  for (const r of rows) {
    const taxBlock = general
      ? '<cac:TaxTotal>' +
        AMOUNT('TaxAmount', r.tax) +
        AMOUNT('RoundingAmount', r.net + r.tax) +
        '<cac:TaxSubtotal>' +
        (salesReturn ? AMOUNT('TaxableAmount', r.net) : '') +
        AMOUNT('TaxAmount', r.tax) +
        taxCategory +
        '</cac:TaxSubtotal></cac:TaxTotal>'
      : '';
    parts.push(
      '<cac:InvoiceLine>' +
        `<cbc:ID>${r.line.id}</cbc:ID>` +
        `<cbc:InvoicedQuantity unitCode="PCE">${formatNano(toNano(r.line.quantity))}</cbc:InvoicedQuantity>` +
        AMOUNT('LineExtensionAmount', r.net) +
        taxBlock +
        `<cac:Item><cbc:Name>${escapeXml(r.line.name.trim().slice(0, 500))}</cbc:Name></cac:Item>` +
        '<cac:Price>' +
        AMOUNT('PriceAmount', toNano(r.line.unitPrice)) +
        (salesReturn ? '<cbc:BaseQuantity unitCode="C62">1</cbc:BaseQuantity>' : '') +
        `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>DISCOUNT</cbc:AllowanceChargeReason>${AMOUNT('Amount', r.discount)}</cac:AllowanceCharge>` +
        '</cac:Price>' +
        '</cac:InvoiceLine>',
    );
  }
  parts.push('</Invoice>');

  return { ok: true, xml: parts.join(''), typeCode, totals: t };
}

/** Request body for POST /core/invoices/: the XML, Base64-encoded, under "invoice". */
export function joFotaraRequestBody(xml: string): string {
  const bytes = new TextEncoder().encode(xml);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return JSON.stringify({ invoice: btoa(binary) });
}

// ---------------------------------------------------------------------------
// From an app invoice
// ---------------------------------------------------------------------------

/** Spreads an invoice-level discount over the lines in proportion to their value, in whole fils. */
export function spreadDiscount(lineValues: number[], discount: number): number[] {
  const fils = (n: number) => BigInt(Math.round(n * 1000));
  const values = lineValues.map(fils);
  const total = values.reduce((a, b) => a + b, 0n);
  const target = fils(Math.max(0, discount));
  if (total <= 0n || target <= 0n) return lineValues.map(() => 0);
  const shares = values.map((v) => (target * v) / total);
  let left = target - shares.reduce((a, b) => a + b, 0n);
  const order = values
    .map((v, i) => ({ i, rest: (target * v) % total }))
    .sort((a, b) => (b.rest > a.rest ? 1 : b.rest < a.rest ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    shares[i] += 1n;
    left -= 1n;
  }
  return shares.map((s) => Number(s) / 1000);
}

/** Calendar date in Jordan, which is what the tax system means by the issue date. */
export function joFotaraDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(timestamp),
  );
}

function storedRate(inv: Pick<Invoice, 'vatRate' | 'taxAmount' | 'subtotal' | 'discount'>): number {
  if (typeof inv.vatRate === 'number' && Number.isFinite(inv.vatRate)) return inv.vatRate;
  const net = (Number(inv.subtotal) || 0) - (Number(inv.discount) || 0);
  const tax = Number(inv.taxAmount) || 0;
  if (!(net > 0 && tax > 0)) return 0;
  const derived = (tax / net) * 100;
  const nearest = JOFOTARA_VAT_RATES.reduce((best, rate) => (Math.abs(rate - derived) < Math.abs(best - derived) ? rate : best));
  return Math.abs(nearest - derived) < 0.05 ? nearest : Number(derived.toFixed(4));
}

export interface JoFotaraFromInvoiceOptions {
  seller: JoFotaraSeller;
  uuid: string;
  icv: number;
  buyer?: JoFotaraBuyer;
  /** Returns only: the original sale as JoFotara accepted it (its number, UUID and declared total). */
  original?: { number: string; uuid: string; total: number };
}

export type JoFotaraFromInvoice = { ok: true; doc: JoFotaraDocument } | { ok: false; issues: JoFotaraIssue[] };

/**
 * Turns a saved sale, or a sales return as a credit note, into the document sent to JoFotara. Refuses rather than guessing:
 * the amount sent must be the amount the customer was charged or refunded.
 */
export function joFotaraFromInvoice(inv: Invoice, opts: JoFotaraFromInvoiceOptions): JoFotaraFromInvoice {
  if (inv.type !== 'sale' && inv.type !== 'return') return { ok: false, issues: [{ code: 'not_sale' }] };
  if (inv.currency !== 'JOD') return { ok: false, issues: [{ code: 'currency' }] };
  const credit = inv.type === 'return';
  if (credit && !opts.original) return { ok: false, issues: [{ code: 'original' }] };

  const items = Array.isArray(inv.items) ? inv.items : [];
  const broken = items.findIndex((item) => !item || typeof item !== 'object' || typeof item.description !== 'string');
  if (broken >= 0) return { ok: false, issues: [{ code: 'line_name', line: broken + 1 }] };
  const gross = items.map((item) => (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0));
  const discounts = spreadDiscount(gross, Number(inv.discount) || 0);
  const taxCharged = (Number(inv.taxAmount) || 0) > 0;
  const income = opts.seller.family === 'income';
  if (income && taxCharged) return { ok: false, issues: [{ code: 'income_has_tax' }] };

  const doc: JoFotaraDocument = {
    kind: credit ? 'credit' : 'invoice',
    number: inv.invoiceNumber,
    uuid: opts.uuid,
    icv: opts.icv,
    issueDate: joFotaraDate(inv.date),
    payment: inv.paymentMethod === 'credit' ? 'receivable' : 'cash',
    seller: opts.seller,
    buyer: {
      ...opts.buyer,
      name: opts.buyer?.name?.trim() || (typeof inv.customerName === 'string' ? inv.customerName.trim() : ''),
      phone: joFotaraPhone(opts.buyer?.phone),
    },
    lines: items.map((item, i) => ({
      // A credit note line carries the line number it had on the original sale.
      id: credit ? Number(item.sourceLine) + 1 : i + 1,
      name: isPackLine(item) ? `${item.description} - ${item.packName?.trim() || 'pack'} × ${item.packSize}` : item.description,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      discount: discounts[i],
    })),
    taxRate: income ? 0 : storedRate(inv),
    ...(credit ? { original: opts.original, returnReason: inv.returnReason || '' } : {}),
  };

  const built = buildJoFotaraXml(doc);
  if (built.ok === false) return { ok: false, issues: built.issues };
  // JoFotara is always JOD (fils = 0.001). Do not grow tolerance with line count — that hid payable ≠ charged total.
  if (Math.abs(Number(built.totals.payable) - (Number(inv.totalAmount) || 0)) > 0.001 + 1e-9) {
    return { ok: false, issues: [{ code: 'totals_mismatch' }] };
  }
  return { ok: true, doc };
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type JoFotaraOutcome = 'accepted' | 'rejected' | 'failed';

export interface JoFotaraResult {
  outcome: JoFotaraOutcome;
  /** EINV_STATUS as returned (SUBMITTED, ALREADY_SUBMITTED, NOT_SUBMITTED...). */
  status: string;
  qr: string;
  einvNum: string;
  messages: string[];
}

function collectMessages(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry: any) => String(entry?.EINV_MESSAGE ?? entry?.message ?? '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Accepted only on HTTP 200 with SUBMITTED or ALREADY_SUBMITTED and no ERROR result.
 * 400 or NOT_SUBMITTED is a rejection of this file; anything else (403, 5xx, no answer) may be retried with the same UUID.
 */
export function readJoFotaraResponse(httpStatus: number, body: unknown): JoFotaraResult {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const results = data.EINV_RESULTS && typeof data.EINV_RESULTS === 'object' ? data.EINV_RESULTS : {};
  const status = String(data.EINV_STATUS ?? '').toUpperCase();
  const messages = collectMessages(results.ERRORS);
  const base = {
    status,
    qr: typeof data.EINV_QR === 'string' ? data.EINV_QR : '',
    einvNum: data.EINV_NUM == null ? '' : String(data.EINV_NUM),
    messages,
  };
  if (httpStatus === 200 && (status === 'SUBMITTED' || status === 'ALREADY_SUBMITTED') && results.status !== 'ERROR') {
    return { ...base, outcome: 'accepted' };
  }
  if (httpStatus === 400 || status === 'NOT_SUBMITTED') {
    return { ...base, outcome: 'rejected' };
  }
  if (httpStatus === 403 && !messages.length) messages.push('Client-Id / Secret-Key were not accepted');
  return { ...base, outcome: 'failed' };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const ISSUE_TEXT: Record<JoFotaraIssueCode, [string, string]> = {
  seller_tin: ['الرقم الضريبي للبائع غير صحيح (أرقام فقط).', 'The seller tax number is invalid (digits only).'],
  seller_name: ['اسم البائع كما هو مسجل في الضريبة مطلوب.', 'The seller registered name is required.'],
  income_source: ['تسلسل مصدر الدخل غير صحيح (أرقام فقط).', 'The income source sequence is invalid (digits only).'],
  number: ['رقم الفاتورة مفقود أو طويل جداً.', 'The invoice number is missing or too long.'],
  uuid: ['المعرّف الفريد للفاتورة غير صالح.', 'The invoice UUID is invalid.'],
  icv: ['عدّاد الفواتير غير صالح.', 'The invoice counter is invalid.'],
  issue_date: ['تاريخ الفاتورة غير صالح.', 'The invoice date is invalid.'],
  no_lines: ['الفاتورة بلا أصناف.', 'The invoice has no lines.'],
  line_name: ['صنف بلا اسم.', 'A line has no name.'],
  line_quantity: ['الكمية يجب أن تكون أكبر من صفر.', 'Quantity must be greater than zero.'],
  line_price: ['سعر الوحدة يجب أن يكون أكبر من صفر (الأصناف المجانية لا تُقبل).', 'Unit price must be greater than zero (free items are not accepted).'],
  line_discount: ['خصم الصنف أكبر من قيمته.', 'A line discount exceeds the line value.'],
  line_id: ['أرقام الأسطر مكررة أو غير صالحة.', 'Line numbers are repeated or invalid.'],
  tax_rate: [
    'نسبة ضريبة المبيعات غير مقبولة في الفوترة الوطنية. النسب المقبولة: 0، 1، 2، 3، 4، 5، 7، 8، 10، 16%.',
    'This sales tax rate is not accepted by JoFotara. Accepted rates: 0, 1, 2, 3, 4, 5, 7, 8, 10, 16%.',
  ],
  zero_category: [
    'الفاتورة بنسبة ضريبة 0%: حدّد في إعدادات الفوترة إن كانت أصنافك معفاة أو خاضعة بنسبة صفر.',
    'This invoice is at 0% tax: choose in e-invoicing settings whether such items are exempt or zero-rated.',
  ],
  income_has_tax: [
    'المتجر مسجّل كمكلّف ضريبة دخل فقط، لكن الفاتورة تحمل ضريبة مبيعات. صحّح التسجيل أو الفاتورة.',
    'The store is registered for income tax only, but this invoice charges sales tax. Fix the registration or the invoice.',
  ],
  buyer_name: [
    'اسم المشتري مطلوب في الفاتورة الآجلة وفي النقدية التي تتجاوز 10,000 دينار.',
    'The buyer name is required on credit invoices and on cash invoices above JOD 10,000.',
  ],
  buyer_id: ['رقم هوية المشتري يجب أن يكون أرقاماً فقط.', 'The buyer ID must be digits only.'],
  buyer_phone: ['هاتف المشتري يجب أن يكون من 9 إلى 14 رقماً.', 'The buyer phone must be 9 to 14 digits.'],
  original: ['بيانات الفاتورة الأصلية للإرجاع ناقصة.', 'The original invoice reference is incomplete.'],
  return_reason: ['سبب الإرجاع مطلوب.', 'A return reason is required.'],
  not_sale: ['فواتير المبيعات ومرتجعاتها فقط تُرسل إلى الفوترة الوطنية.', 'Only sale invoices and their returns are sent to JoFotara.'],
  currency: ['الفوترة الوطنية تقبل الفواتير بالدينار الأردني فقط.', 'JoFotara only accepts invoices in Jordanian dinars.'],
  totals_mismatch: [
    'مجموع الأسطر لا يطابق إجمالي الفاتورة المحفوظ؛ لن تُرسل حتى لا يختلف المبلغ المصرّح به عمّا دفعه الزبون.',
    'The line totals do not match the saved invoice total; it will not be sent so the declared amount cannot differ from what was charged.',
  ],
};

export function joFotaraIssueText(issue: JoFotaraIssue, isRtl: boolean): string {
  const [ar, en] = ISSUE_TEXT[issue.code] ?? ['خطأ غير معروف.', 'Unknown error.'];
  const text = isRtl ? ar : en;
  return issue.line ? `${isRtl ? `السطر ${issue.line}` : `Line ${issue.line}`}: ${text}` : text;
}
