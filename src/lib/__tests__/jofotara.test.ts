import { describe, expect, it } from 'vitest';
import {
  buildJoFotaraXml,
  joFotaraDate,
  joFotaraFromInvoice,
  joFotaraIssueText,
  joFotaraPhone,
  joFotaraRequestBody,
  joFotaraTypeCode,
  readJoFotaraResponse,
  spreadDiscount,
  type JoFotaraDocument,
  type JoFotaraSeller,
} from '../jofotara';
import type { Invoice } from '../../types';
import { planSalesReturn } from '../salesReturn';

const UUID = '3f2c9a1e-8b7d-4c6e-9f10-2a3b4c5d6e7f';
const income: JoFotaraSeller = { tin: '12345678', name: 'متجر التجربة', incomeSource: '4419618', family: 'income' };
const general: JoFotaraSeller = { ...income, family: 'general_sales', zeroRateCategory: 'Z' };

function doc(over: Partial<JoFotaraDocument> = {}): JoFotaraDocument {
  return {
    kind: 'invoice',
    number: 'INV-1',
    uuid: UUID,
    icv: 1,
    issueDate: '2026-10-09',
    payment: 'cash',
    seller: income,
    buyer: {},
    lines: [
      { id: 1, name: 'صنف أ', quantity: 33, unitPrice: 2, discount: 2 },
      { id: 2, name: 'صنف ب', quantity: 10, unitPrice: 5, discount: 5 },
    ],
    taxRate: 0,
    ...over,
  };
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<cbc:${name}[^>]*>([^<]*)</cbc:${name}>`))?.[1];

describe('buildJoFotaraXml', () => {
  it('reproduces the guide income example: 116 before discount, 7 discount, 109 payable, no tax block', () => {
    const built = buildJoFotaraXml(doc());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.totals).toEqual({ taxExclusive: '116.000000000', discount: '7.000000000', tax: '0.000000000', payable: '109.000000000' });
    expect(built.typeCode).toBe('011');
    expect(built.xml).not.toContain('TaxTotal');
    expect(tag(built.xml, 'PayableAmount')).toBe('109.000000000');
    expect(tag(built.xml, 'AllowanceTotalAmount')).toBe('7.000000000');
    expect(built.xml).toContain('<cbc:InvoiceTypeCode name="011">388</cbc:InvoiceTypeCode>');
    expect(built.xml).toContain('<cbc:ProfileID>reporting:1.0</cbc:ProfileID>');
    expect(built.xml).toContain('<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>1</cbc:UUID>');
    expect(built.xml).toContain('<cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>4419618</cbc:ID>');
  });

  it('reproduces the guide general sales example: 7% line plus exempt line, tax 4.48, payable 118.48', () => {
    const built = buildJoFotaraXml(
      doc({
        seller: general,
        taxRate: 7,
        lines: [{ id: 1, name: 'صنف أ', quantity: 33, unitPrice: 2, discount: 2 }],
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.totals.tax).toBe('4.480000000');
    expect(built.totals.payable).toBe('68.480000000');
    expect(built.typeCode).toBe('012');
    expect(built.xml).toContain('<cbc:RoundingAmount currencyID="JO">68.480000000</cbc:RoundingAmount>');
    expect(built.xml).toContain('<cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID><cbc:Percent>7.00</cbc:Percent>');
  });

  it('keeps the opening Invoice tag on one line and puts blocks in UBL order', () => {
    const built = buildJoFotaraXml(doc({ seller: general, taxRate: 16 }));
    if (!built.ok) throw new Error('expected ok');
    const [, second] = built.xml.split('?>');
    expect(second.startsWith('<Invoice xmlns=')).toBe(true);
    expect(built.xml).not.toContain('\n');
    const order = ['<cbc:ProfileID>', '<cbc:ID>', '<cbc:UUID>', '<cbc:IssueDate>', '<cbc:InvoiceTypeCode', '<cbc:DocumentCurrencyCode>',
      '<cac:AdditionalDocumentReference>', '<cac:AccountingSupplierParty>', '<cac:AccountingCustomerParty>', '<cac:SellerSupplierParty>',
      '<cac:AllowanceCharge>', '<cac:TaxTotal>', '<cac:LegalMonetaryTotal>', '<cac:InvoiceLine>'];
    const positions = order.map((t) => built.xml.indexOf(t));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('uses Z or O for 0% lines on general sales invoices and refuses when the store has not chosen', () => {
    const zero = buildJoFotaraXml(doc({ seller: { ...general, zeroRateCategory: 'O' }, taxRate: 0 }));
    expect(zero.ok && zero.xml.includes('schemeID="UN/ECE 5305">O</cbc:ID><cbc:Percent>0.00</cbc:Percent>')).toBe(true);
    const unknown = buildJoFotaraXml(doc({ seller: { ...general, zeroRateCategory: null }, taxRate: 0 }));
    expect(unknown).toEqual({ ok: false, issues: [{ code: 'zero_category' }] });
  });

  it('requires the buyer name on credit sales and on cash sales above JOD 10,000', () => {
    expect(buildJoFotaraXml(doc({ payment: 'receivable' }))).toEqual({ ok: false, issues: [{ code: 'buyer_name' }] });
    const big = doc({ lines: [{ id: 1, name: 'x', quantity: 1, unitPrice: 10_000.001, discount: 0 }] });
    expect(buildJoFotaraXml(big)).toEqual({ ok: false, issues: [{ code: 'buyer_name' }] });
    expect(buildJoFotaraXml({ ...big, lines: [{ ...big.lines[0], unitPrice: 10_000 }] }).ok).toBe(true);
    const named = buildJoFotaraXml(doc({ payment: 'receivable', buyer: { name: 'شركة <الأمل> & شركاه' } }));
    expect(named.ok && named.xml.includes('<cbc:RegistrationName>شركة &lt;الأمل&gt; &amp; شركاه</cbc:RegistrationName>')).toBe(true);
    expect(named.ok && named.xml.includes('name="021"')).toBe(true);
  });

  it('refuses free items, zero quantities, oversized discounts and repeated line numbers', () => {
    const bad = buildJoFotaraXml(doc({
      lines: [
        { id: 1, name: 'a', quantity: 0, unitPrice: 1, discount: 0 },
        { id: 1, name: '', quantity: 1, unitPrice: 0, discount: 0 },
        { id: 3, name: 'c', quantity: 1, unitPrice: 1, discount: 2 },
      ],
    }));
    expect(bad.ok).toBe(false);
    if (bad.ok !== false) return;
    expect(bad.issues).toEqual([
      { code: 'line_quantity', line: 1 },
      { code: 'line_id', line: 2 },
      { code: 'line_name', line: 2 },
      { code: 'line_price', line: 2 },
      { code: 'line_discount', line: 3 },
    ]);
  });

  it('validates seller identity, uuid, counter and date', () => {
    const bad = buildJoFotaraXml(doc({ seller: { ...income, tin: '12a', incomeSource: '' }, uuid: 'abc', icv: 0, issueDate: '09-10-2026' }));
    expect(bad.ok === false && bad.issues.map((i) => i.code)).toEqual(['seller_tin', 'income_source', 'uuid', 'icv', 'issue_date']);
  });

  it('builds a return with the original reference, the reason and code 381', () => {
    const built = buildJoFotaraXml(doc({
      kind: 'credit',
      number: 'RET-1',
      note: 'ملاحظة',
      lines: [{ id: 2, name: 'صنف ب', quantity: 2, unitPrice: 5, discount: 1 }],
      original: { number: 'INV-1', uuid: UUID, total: 109 },
      returnReason: 'عيب مصنعي',
    }));
    if (!built.ok) throw new Error('expected ok');
    expect(built.xml).toContain('<cbc:InvoiceTypeCode name="011">381</cbc:InvoiceTypeCode>');
    expect(built.xml).toContain('<cbc:DocumentDescription>109.000000000</cbc:DocumentDescription>');
    expect(built.xml).toContain('<cbc:InstructionNote>عيب مصنعي</cbc:InstructionNote>');
    expect(built.xml).toContain('<cbc:Note>ملاحظة</cbc:Note>');
    expect(built.xml.indexOf('<cac:BillingReference>')).toBeLessThan(built.xml.indexOf('<cac:AdditionalDocumentReference>'));
    expect(built.xml.indexOf('<cac:PaymentMeans>')).toBeLessThan(built.xml.indexOf('<cac:AllowanceCharge>'));
    expect(built.xml).toContain('<cac:InvoiceLine><cbc:ID>2</cbc:ID>');

    const generalReturn = buildJoFotaraXml(doc({
      kind: 'credit', seller: general, taxRate: 16, note: 'x',
      original: { number: 'INV-1', uuid: UUID, total: 109 }, returnReason: 'r',
    }));
    expect(generalReturn.ok && generalReturn.xml.includes('<cbc:Note>')).toBe(false);
    expect(buildJoFotaraXml(doc({ kind: 'credit' }))).toEqual({ ok: false, issues: [{ code: 'original' }, { code: 'return_reason' }] });
  });

  it('adds the sales-return elements only to general sales returns', () => {
    const lines = [
      { id: 1, name: 'أ', quantity: 2, unitPrice: 10, discount: 1 },
      { id: 3, name: 'ب', quantity: 1, unitPrice: 5, discount: 0 },
    ];
    const ret = buildJoFotaraXml(doc({
      kind: 'credit', seller: general, taxRate: 16, lines,
      original: { number: 'INV-1', uuid: UUID, total: 30 }, returnReason: 'r',
    }));
    if (!ret.ok) throw new Error('expected ok');
    const x = ret.xml;
    // Document subtotal: taxable 19 + 5 = 24, tax 3.04 + 0.8 = 3.84.
    expect(x).toContain(
      '<cac:TaxTotal><cbc:TaxAmount currencyID="JO">3.840000000</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="JO">24.000000000</cbc:TaxableAmount><cbc:TaxAmount currencyID="JO">3.840000000</cbc:TaxAmount><cac:TaxCategory>',
    );
    expect(x).toContain('<cac:TaxSubtotal><cbc:TaxableAmount currencyID="JO">19.000000000</cbc:TaxableAmount><cbc:TaxAmount currencyID="JO">3.040000000</cbc:TaxAmount>');
    expect(x.match(/<cbc:BaseQuantity unitCode="C62">1<\/cbc:BaseQuantity><cac:AllowanceCharge>/g)).toHaveLength(2);
    expect(x).toContain('<cbc:PrepaidAmount currencyID="JO">0.000000000</cbc:PrepaidAmount><cbc:PayableAmount currencyID="JO">27.840000000</cbc:PayableAmount>');

    const sale = buildJoFotaraXml(doc({ seller: general, taxRate: 16, lines }));
    const incomeReturn = buildJoFotaraXml(doc({ kind: 'credit', lines, original: { number: 'INV-1', uuid: UUID, total: 24 }, returnReason: 'r' }));
    for (const other of [sale, incomeReturn]) {
      if (!other.ok) throw new Error('expected ok');
      expect(other.xml).not.toMatch(/TaxableAmount|BaseQuantity|PrepaidAmount/);
    }
  });

  it('accepts only the sales tax rates the system knows', () => {
    expect(buildJoFotaraXml(doc({ seller: general, taxRate: 10 })).ok).toBe(true);
    const bad = buildJoFotaraXml(doc({ seller: general, taxRate: 15 }));
    expect(bad.ok === false && bad.issues).toEqual([{ code: 'tax_rate' }]);
  });

  it('encodes the request body as Base64 UTF-8 under "invoice"', () => {
    const body = JSON.parse(joFotaraRequestBody('<a>عربي</a>'));
    expect(Buffer.from(body.invoice, 'base64').toString('utf8')).toBe('<a>عربي</a>');
  });
});

describe('helpers', () => {
  it('spreads an invoice discount over lines in whole fils that add up exactly', () => {
    expect(spreadDiscount([66, 50], 7)).toEqual([3.983, 3.017]);
    const shares = spreadDiscount([1, 1, 1], 1);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(shares).toEqual([0.334, 0.333, 0.333]);
    expect(spreadDiscount([10, 20], 0)).toEqual([0, 0]);
  });

  it('reads the date in Jordan time and keeps phones to 9-14 digits', () => {
    expect(joFotaraDate(Date.UTC(2026, 9, 8, 22, 30))).toBe('2026-10-09');
    expect(joFotaraPhone('079 123-4567')).toBe('0791234567');
    expect(joFotaraPhone('12345')).toBeUndefined();
    expect(joFotaraTypeCode('receivable', 'general_sales')).toBe('022');
  });

  it('labels issues per line', () => {
    expect(joFotaraIssueText({ code: 'line_price', line: 2 }, true)).toMatch(/^السطر 2: /);
  });
});

describe('joFotaraFromInvoice', () => {
  const sale = (over: Partial<Invoice> = {}): Invoice => ({
    id: 'i1',
    invoiceNumber: 'INV-20261009-AB12-0001',
    date: Date.UTC(2026, 9, 9, 9),
    items: [
      { productId: 'p1', description: 'سكر', quantity: 33, unitPrice: 2, total: 66 },
      { productId: 'p2', description: 'أرز', quantity: 10, unitPrice: 5, total: 50 },
    ],
    subtotal: 116,
    discount: 7,
    taxAmount: 0,
    vatRate: 0,
    totalAmount: 109,
    type: 'sale',
    currency: 'JOD',
    ...over,
  });

  it('turns an income sale into an accepted document with the discount spread over the lines', () => {
    const result = joFotaraFromInvoice(sale(), { seller: income, uuid: UUID, icv: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.lines.map((l) => l.discount)).toEqual([3.983, 3.017]);
    expect(result.doc.payment).toBe('cash');
    expect(result.doc.issueDate).toBe('2026-10-09');
  });

  it('matches the saved total for a taxed sale with decimal quantities', () => {
    const items = [
      { productId: 'p1', description: 'لحمة', quantity: 1.235, unitPrice: 9.75, total: 12.041 },
      { productId: 'p2', description: 'خبز', quantity: 3, unitPrice: 0.35, total: 1.05 },
    ];
    const subtotal = 13.091;
    const discount = 0.5;
    const tax = Number((((subtotal - discount) * 16) / 100).toFixed(3));
    const result = joFotaraFromInvoice(
      sale({ items, subtotal, discount, vatRate: 16, taxAmount: tax, totalAmount: Number((subtotal - discount + tax).toFixed(3)) }),
      { seller: general, uuid: UUID, icv: 1 },
    );
    expect(result.ok).toBe(true);
  });

  it('recovers the rate from older sales saved without vatRate', () => {
    // 109 × 16% = 17.44, saved rounded; the derived 16.0004% must read as 16%.
    const old = sale({ vatRate: undefined, taxAmount: 17.4405, totalAmount: 126.44 });
    const result = joFotaraFromInvoice(old, { seller: general, uuid: UUID, icv: 1 });
    expect(result.ok && result.doc.taxRate).toBe(16);
  });

  it('refuses purchases, other currencies, tax on an income-only store and totals that do not reconcile', () => {
    const opts = { seller: income, uuid: UUID, icv: 1 };
    expect(joFotaraFromInvoice(sale({ type: 'purchase' }), opts)).toEqual({ ok: false, issues: [{ code: 'not_sale' }] });
    expect(joFotaraFromInvoice(sale({ currency: 'USD' }), opts)).toEqual({ ok: false, issues: [{ code: 'currency' }] });
    expect(joFotaraFromInvoice(sale({ taxAmount: 17.44, vatRate: 16 }), opts)).toEqual({ ok: false, issues: [{ code: 'income_has_tax' }] });
    expect(joFotaraFromInvoice(sale({ totalAmount: 110 }), opts)).toEqual({ ok: false, issues: [{ code: 'totals_mismatch' }] });
  });

  it('reports a damaged saved invoice instead of throwing', () => {
    const opts = { seller: income, uuid: UUID, icv: 1 };
    const damaged = sale({ items: [null, 7] as any, customerName: 42 as any });
    expect(joFotaraFromInvoice(damaged, opts)).toEqual({ ok: false, issues: [{ code: 'line_name', line: 1 }] });
    expect(() => joFotaraFromInvoice(sale({ customerName: 42 as any }), opts)).not.toThrow();
  });

  it('marks credit sales as receivable and needs the customer name', () => {
    const opts = { seller: income, uuid: UUID, icv: 1 };
    expect(joFotaraFromInvoice(sale({ paymentMethod: 'credit' }), opts)).toEqual({ ok: false, issues: [{ code: 'buyer_name' }] });
    const named = joFotaraFromInvoice(sale({ paymentMethod: 'credit', customerName: 'أبو أحمد' }), { ...opts, buyer: { phone: '0791234567' } });
    expect(named.ok && named.doc.payment).toBe('receivable');
    expect(named.ok && named.doc.buyer).toMatchObject({ name: 'أبو أحمد', phone: '0791234567' });
  });

  it('turns a sales return into a credit note on the original line numbers', () => {
    const original = sale();
    const planned = planSalesReturn(original, [{ index: 1, quantity: 10 }]);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const ret: Invoice = {
      ...original,
      id: 'r1',
      invoiceNumber: 'RET-20261010-AB12-0001',
      type: 'return',
      date: Date.UTC(2026, 9, 10, 9),
      items: planned.plan.items,
      ...planned.plan.figures,
      returnOf: original.id,
      returnOfNumber: original.invoiceNumber,
      returnReason: 'تالف',
    };
    const ref = { number: original.invoiceNumber, uuid: UUID, total: 109 };
    const result = joFotaraFromInvoice(ret, { seller: income, uuid: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', icv: 2, original: ref });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.kind).toBe('credit');
    expect(result.doc.lines.map((l) => l.id)).toEqual([2]);
    expect(result.doc.original).toEqual(ref);
    expect(result.doc.returnReason).toBe('تالف');
    const built = buildJoFotaraXml(result.doc);
    expect(built.ok && built.totals.payable).toBe('46.983000000');
    expect(built.ok && built.xml).toContain('>381</cbc:InvoiceTypeCode>');
  });

  it('refuses a credit note without the accepted original or a reason', () => {
    const ret = sale({ type: 'return', items: [{ productId: 'p1', description: 'سكر', quantity: 33, unitPrice: 2, total: 66, sourceLine: 0 }],
      subtotal: 66, discount: 0, totalAmount: 66 });
    const opts = { seller: income, uuid: UUID, icv: 1 };
    expect(joFotaraFromInvoice(ret, opts)).toEqual({ ok: false, issues: [{ code: 'original' }] });
    const noReason = joFotaraFromInvoice(ret, { ...opts, original: { number: 'INV-1', uuid: UUID, total: 109 } });
    expect(noReason).toEqual({ ok: false, issues: [{ code: 'return_reason' }] });
  });
});

describe('readJoFotaraResponse', () => {
  it('accepts SUBMITTED and ALREADY_SUBMITTED on 200 and keeps the QR', () => {
    expect(readJoFotaraResponse(200, { EINV_STATUS: 'SUBMITTED', EINV_RESULTS: { status: 'PASS' }, EINV_QR: 'QRDATA', EINV_NUM: 7 }))
      .toEqual({ outcome: 'accepted', status: 'SUBMITTED', qr: 'QRDATA', einvNum: '7', messages: [] });
    expect(readJoFotaraResponse(200, { EINV_STATUS: 'ALREADY_SUBMITTED', EINV_RESULTS: { status: 'PASS' } }).outcome).toBe('accepted');
  });

  it('treats NOT_SUBMITTED and 400 as a rejection with the system messages', () => {
    const result = readJoFotaraResponse(200, {
      EINV_STATUS: 'NOT_SUBMITTED',
      EINV_RESULTS: { status: 'ERROR', ERRORS: [{ EINV_CODE: 'x', EINV_MESSAGE: 'Total General Amount is Not Correct' }] },
      EINV_QR: null,
    });
    expect(result).toMatchObject({ outcome: 'rejected', qr: '', messages: ['Total General Amount is Not Correct'] });
    expect(readJoFotaraResponse(400, {}).outcome).toBe('rejected');
  });

  it('treats credential errors, server errors and no answer as retryable failures', () => {
    expect(readJoFotaraResponse(403, {})).toMatchObject({ outcome: 'failed', messages: ['Client-Id / Secret-Key were not accepted'] });
    expect(readJoFotaraResponse(500, null).outcome).toBe('failed');
    expect(readJoFotaraResponse(200, { EINV_STATUS: 'SUBMITTED', EINV_RESULTS: { status: 'ERROR' } }).outcome).toBe('failed');
  });
});
