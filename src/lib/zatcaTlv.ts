/**
 * ZATCA Phase 1 (simplified e-invoice) QR payload: TLV tags 1–5, Base64-encoded.
 * Not a Phase 2 clearance/reporting submission — no CSID or XML signing here.
 */

export type ZatcaTlvFields = {
  sellerName: string;
  vatNumber: string;
  /** ISO-8601 timestamp, e.g. 2022-04-25T15:30:00Z */
  timestamp: string;
  /** Invoice total with VAT, decimal string */
  invoiceTotal: string;
  /** VAT amount, decimal string */
  vatTotal: string;
};

export type ZatcaTlvIssue =
  | { code: 'seller_name' }
  | { code: 'vat_number' }
  | { code: 'timestamp' }
  | { code: 'invoice_total' }
  | { code: 'vat_total' };

/** Saudi VAT registration: 15 digits, typically starting with 3. */
export function isZatcaVatNumber(value: string): boolean {
  return /^3\d{14}$/.test(value.trim());
}

export function formatZatcaAmount(n: number): string | null {
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function encodeTag(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 255) throw new Error(`TLV tag ${tag} value too long`);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = tag;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function validateZatcaTlvFields(fields: ZatcaTlvFields): ZatcaTlvIssue[] {
  const issues: ZatcaTlvIssue[] = [];
  if (!fields.sellerName.trim() || fields.sellerName.trim().length > 200) issues.push({ code: 'seller_name' });
  if (!isZatcaVatNumber(fields.vatNumber)) issues.push({ code: 'vat_number' });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(fields.timestamp.trim())) issues.push({ code: 'timestamp' });
  if (!/^\d+(\.\d{1,2})?$/.test(fields.invoiceTotal.trim())) issues.push({ code: 'invoice_total' });
  if (!/^\d+(\.\d{1,2})?$/.test(fields.vatTotal.trim())) issues.push({ code: 'vat_total' });
  return issues;
}

/** Encode Phase-1 QR content (tags 1–5) as Base64. */
export function encodeZatcaTlv(fields: ZatcaTlvFields): { ok: true; qr: string } | { ok: false; issues: ZatcaTlvIssue[] } {
  const issues = validateZatcaTlvFields(fields);
  if (issues.length) return { ok: false, issues };
  const payload = concat([
    encodeTag(1, fields.sellerName.trim()),
    encodeTag(2, fields.vatNumber.trim()),
    encodeTag(3, fields.timestamp.trim()),
    encodeTag(4, fields.invoiceTotal.trim()),
    encodeTag(5, fields.vatTotal.trim()),
  ]);
  return { ok: true, qr: toBase64(payload) };
}

export function zatcaTlvIssueText(issue: ZatcaTlvIssue, isRtl: boolean): string {
  const map: Record<ZatcaTlvIssue['code'], [string, string]> = {
    seller_name: ['اسم المنشأة مطلوب.', 'Seller name is required.'],
    vat_number: ['الرقم الضريبي يجب أن يكون 15 رقماً ويبدأ بـ 3.', 'VAT number must be 15 digits starting with 3.'],
    timestamp: ['تاريخ/وقت الفاتورة غير صالح.', 'Invoice timestamp is invalid.'],
    invoice_total: ['إجمالي الفاتورة غير صالح.', 'Invoice total is invalid.'],
    vat_total: ['مبلغ الضريبة غير صالح.', 'VAT amount is invalid.'],
  };
  const pair = map[issue.code];
  return isRtl ? pair[0] : pair[1];
}
