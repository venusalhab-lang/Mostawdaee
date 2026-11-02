import QRCode from 'qrcode';
import { supabase } from '../supabaseClient';
import { apiUrl } from './apiBase';
import { authHeaders } from './apiAuth';
import { joFotaraIssueText, type JoFotaraFamily, type JoFotaraIssue, type JoFotaraZeroCategory } from './jofotara';
import { zatcaTlvIssueText, type ZatcaTlvIssue } from './zatcaTlv';

export type EInvoiceProvider = 'jofotara' | 'zatca';

export interface EInvoiceSettingsView {
  provider: EInvoiceProvider;
  tin: string;
  sellerName: string;
  incomeSource: string;
  family: JoFotaraFamily;
  zeroRateCategory: JoFotaraZeroCategory | null;
  crNumber: string;
  clientIdHint: string;
  updatedAt: string;
}

export interface EInvoiceConfig {
  /** The server can reach einvoice_settings (service role). */
  available: boolean;
  configured: boolean;
  role: 'owner' | 'manager' | 'cashier';
  provider: EInvoiceProvider | null;
  settings?: EInvoiceSettingsView;
}

export interface JoFotaraSettingsInput {
  tin: string;
  sellerName: string;
  incomeSource: string;
  family: JoFotaraFamily;
  zeroRateCategory: JoFotaraZeroCategory | null;
  clientId: string;
  /** Empty keeps the stored secret. */
  secretKey: string;
}

export interface ZatcaSettingsInput {
  tin: string;
  sellerName: string;
  /** Optional commercial registration number. */
  crNumber: string;
}

/** @deprecated Use JoFotaraSettingsInput — kept for existing imports. */
export type EInvoiceSettingsInput = JoFotaraSettingsInput;

export type EInvoiceStatus = 'sending' | 'accepted' | 'rejected' | 'failed';

export interface EInvoiceSubmission {
  invoice_id: string;
  invoice_number: string;
  uuid: string;
  icv: number;
  status: EInvoiceStatus;
  qr: string | null;
  einv_num: string | null;
  error: string | null;
  attempts: number;
  updated_at: string;
  accepted_at: string | null;
}

export interface EInvoiceSubmitResult {
  outcome: 'accepted' | 'rejected' | 'failed';
  qr: string;
  einvNum: string;
  messages: string[];
  icv: number;
}

export class EInvoiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public issues: Array<JoFotaraIssue | ZatcaTlvIssue> = [],
    public fields: string[] = [],
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: init?.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new EInvoiceError('network', 'network');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new EInvoiceError(String(data?.code || response.status), String(data?.message || ''), data?.issues || [], data?.fields || []);
  }
  if (!data || typeof data !== 'object') throw new EInvoiceError(String(response.status), '');
  return data as T;
}

export const fetchEInvoiceConfig = () => call<EInvoiceConfig>('/api/einvoice');

export const saveJoFotaraSettings = (input: JoFotaraSettingsInput) =>
  call<{ ok: true }>('/api/einvoice/jofotara/settings', { method: 'POST', body: input });

/** @deprecated Prefer saveJoFotaraSettings */
export const saveEInvoiceSettings = saveJoFotaraSettings;

export const saveZatcaSettings = (input: ZatcaSettingsInput) =>
  call<{ ok: true }>('/api/einvoice/zatca/settings', { method: 'POST', body: input });

export const disconnectEInvoice = () => call<{ ok: true }>('/api/einvoice/jofotara/disconnect', { method: 'POST', body: {} });
export const disconnectZatca = () => call<{ ok: true }>('/api/einvoice/zatca/disconnect', { method: 'POST', body: {} });

export const submitEInvoice = (invoiceId: string) =>
  call<EInvoiceSubmitResult>('/api/einvoice/jofotara/submit', { method: 'POST', body: { invoiceId } });

export const generateZatcaQr = (invoiceId: string) =>
  call<EInvoiceSubmitResult>('/api/einvoice/zatca/qr', { method: 'POST', body: { invoiceId } });

const SUBMISSION_COLUMNS = 'invoice_id, invoice_number, uuid, icv, status, qr, einv_num, error, attempts, updated_at, accepted_at';

/** Statuses for the store's invoices (RLS limits rows to the caller's store). Empty when the table is not installed. */
export async function fetchEInvoiceSubmissions(invoiceIds?: string[]): Promise<Record<string, EInvoiceSubmission>> {
  let query = supabase.from('einvoice_submissions').select(SUBMISSION_COLUMNS);
  if (invoiceIds?.length) query = query.in('invoice_id', invoiceIds.slice(0, 200));
  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return {};
    throw new EInvoiceError('read_failed', error.message);
  }
  const map: Record<string, EInvoiceSubmission> = {};
  for (const row of (data || []) as EInvoiceSubmission[]) map[row.invoice_id] = row;
  return map;
}

/** PNG data URL of the QR payload (JoFotara EINV_QR or ZATCA TLV Base64). */
export function eInvoiceQrDataUrl(qr: string): Promise<string> {
  return QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
}

export function eInvoiceErrorText(error: unknown, isRtl: boolean): string {
  const e = error instanceof EInvoiceError ? error : new EInvoiceError('unknown', String((error as Error)?.message || ''));
  if (e.issues.length) {
    return e.issues.map((issue) => {
      if ('code' in issue && ['seller_name', 'vat_number', 'timestamp', 'invoice_total', 'vat_total'].includes(String(issue.code))) {
        return zatcaTlvIssueText(issue as ZatcaTlvIssue, isRtl);
      }
      return joFotaraIssueText(issue as JoFotaraIssue, isRtl);
    }).join('\n');
  }
  const text: Record<string, [string, string]> = {
    network: ['تعذّر الاتصال بالخادم. تحقق من الإنترنت.', 'Could not reach the server. Check the connection.'],
    sign_in_required: ['سجّل الدخول أولاً.', 'Sign in first.'],
    role_not_allowed: ['دورك في المتجر لا يسمح بهذه العملية.', 'Your role in this store cannot do this.'],
    subscription_required: ['يلزم اشتراك فعّال.', 'An active subscription is required.'],
    einvoice_unavailable: ['الفوترة الإلكترونية غير متاحة على الخادم حالياً.', 'E-invoicing is not available on the server right now.'],
    not_configured: ['اربط المتجر بالفوترة الوطنية من الإعدادات أولاً.', 'Link national e-invoicing in Settings first.'],
    secret_unreadable: ['تعذّرت قراءة المفتاح السري المحفوظ؛ أدخله من جديد في الإعدادات.', 'The stored Secret-Key cannot be read; enter it again in Settings.'],
    invoice_not_found: ['الفاتورة لم تُحفظ على السحابة بعد؛ انتظر المزامنة ثم أعد المحاولة.', 'The invoice is not in the cloud yet; wait for sync and retry.'],
    already_accepted: ['هذه الفاتورة مقبولة مسبقاً لدى الفوترة الوطنية.', 'This invoice was already accepted.'],
    in_progress: ['الفاتورة قيد الإرسال الآن من جهاز آخر.', 'This invoice is being sent right now.'],
    original_not_accepted: ['أرسل الفاتورة الأصلية إلى الفوترة الوطنية أولاً؛ إشعار الدائن يُرسل بعد قبولها.', 'Send the original invoice to JoFotara first; the credit note can be sent once it is accepted.'],
    rate_limited: ['طلبات كثيرة؛ انتظر دقيقة.', 'Too many requests; wait a minute.'],
    invalid_settings: ['بعض الحقول غير صحيحة.', 'Some fields are invalid.'],
    build_failed: ['تعذّر تجهيز ملف الفاتورة.', 'The e-invoice file could not be built.'],
    currency_not_sar: ['رمز QR لهيئة الزكاة يقبل فواتير الريال السعودي فقط.', 'ZATCA QR only accepts invoices in Saudi riyals (SAR).'],
  };
  const pair = text[e.code];
  return pair ? (isRtl ? pair[0] : pair[1]) : (isRtl ? 'حدث خطأ غير متوقع.' : 'Unexpected error.') + (e.message && e.message !== e.code ? ` (${e.message})` : '');
}
