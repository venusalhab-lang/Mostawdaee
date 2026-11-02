import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2, Pencil, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import type { Language } from '../types';
import { useFirebase } from './FirebaseProvider';
import {
  type EInvoiceConfig,
  type EInvoiceProvider,
  type JoFotaraSettingsInput,
  type ZatcaSettingsInput,
  disconnectEInvoice,
  disconnectZatca,
  eInvoiceErrorText,
  EInvoiceError,
  fetchEInvoiceConfig,
  saveJoFotaraSettings,
  saveZatcaSettings,
} from '../lib/einvoiceApi';

const input =
  'w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-indigo-500';
const fieldError = 'border-rose-400 dark:border-rose-500/60';

const JO_LABELS: Record<string, [string, string]> = {
  tin: ['الرقم الضريبي', 'Tax number'],
  sellerName: ['الاسم المسجّل', 'Registered name'],
  incomeSource: ['تسلسل مصدر الدخل', 'Income source sequence'],
  family: ['نوع التسجيل', 'Registration type'],
  clientId: ['Client-Id', 'Client-Id'],
  secretKey: ['Secret-Key', 'Secret-Key'],
};

const SA_LABELS: Record<string, [string, string]> = {
  tin: ['الرقم الضريبي (VAT)', 'VAT number'],
  sellerName: ['اسم المنشأة', 'Seller name'],
  crNumber: ['السجل التجاري (اختياري)', 'CR number (optional)'],
};

export default function EInvoiceSettings({ language }: { language: Language }) {
  const ar = language === 'ar';
  const { settings } = useFirebase();
  const [config, setConfig] = useState<EInvoiceConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draftProvider, setDraftProvider] = useState<EInvoiceProvider>('jofotara');
  const [saving, setSaving] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [badFields, setBadFields] = useState<string[]>([]);
  const [joForm, setJoForm] = useState<JoFotaraSettingsInput>({
    tin: '', sellerName: '', incomeSource: '', family: 'income', zeroRateCategory: null, clientId: '', secretKey: '',
  });
  const [saForm, setSaForm] = useState<ZatcaSettingsInput>({ tin: '', sellerName: '', crNumber: '' });

  const load = async () => {
    setLoadError('');
    try {
      setConfig(await fetchEInvoiceConfig());
    } catch (error) {
      setLoadError(eInvoiceErrorText(error, ar));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startEdit = (provider?: EInvoiceProvider) => {
    const s = config?.settings;
    const next = provider || s?.provider || config?.provider || 'jofotara';
    setDraftProvider(next);
    setJoForm({
      tin: next === 'jofotara' ? (s?.tin || (settings?.taxRegistrationNumber || '').replace(/\D/g, '')) : '',
      sellerName: next === 'jofotara' ? (s?.sellerName || settings?.businessName || '') : '',
      incomeSource: s?.incomeSource || '',
      family: s?.family || 'income',
      zeroRateCategory: s?.zeroRateCategory ?? null,
      clientId: '',
      secretKey: '',
    });
    setSaForm({
      tin: next === 'zatca' ? (s?.tin || (settings?.taxRegistrationNumber || '').replace(/\D/g, '')) : '',
      sellerName: next === 'zatca' ? (s?.sellerName || settings?.businessName || '') : '',
      crNumber: s?.crNumber || '',
    });
    setBadFields([]);
    setEditing(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (draftProvider === 'jofotara') {
      if (!/^\d{5,15}$/.test(joForm.tin.trim())) missing.push('tin');
      if (!joForm.sellerName.trim()) missing.push('sellerName');
      if (!/^\d{1,20}$/.test(joForm.incomeSource.trim())) missing.push('incomeSource');
      if (!config?.configured && !joForm.clientId.trim()) missing.push('clientId');
      if (!config?.configured && !joForm.secretKey.trim()) missing.push('secretKey');
    } else {
      if (!/^3\d{14}$/.test(saForm.tin.trim())) missing.push('tin');
      if (!saForm.sellerName.trim()) missing.push('sellerName');
      if (saForm.crNumber && !/^\d{5,20}$/.test(saForm.crNumber.trim())) missing.push('crNumber');
    }
    setBadFields(missing);
    if (missing.length) return;
    setSaving(true);
    try {
      if (draftProvider === 'jofotara') {
        await saveJoFotaraSettings({
          ...joForm,
          zeroRateCategory: joForm.family === 'general_sales' ? joForm.zeroRateCategory : null,
        });
        toast.success(ar ? 'حُفظ الربط مع الفوترة الوطنية الأردنية.' : 'JoFotara link saved.');
      } else {
        await saveZatcaSettings(saForm);
        toast.success(ar ? 'حُفظت إعدادات رمز QR لهيئة الزكاة (المرحلة 1).' : 'ZATCA Phase 1 QR settings saved.');
      }
      setEditing(false);
      await load();
    } catch (error) {
      if (error instanceof EInvoiceError && error.fields.length) setBadFields(error.fields);
      toast.error(eInvoiceErrorText(error, ar));
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      if (config?.provider === 'zatca') await disconnectZatca();
      else await disconnectEInvoice();
      toast.success(ar ? 'أُلغي الربط. السجلات السابقة تبقى إن وُجدت.' : 'Unlinked. Prior records stay on file.');
      setConfirmDisconnect(false);
      await load();
    } catch (error) {
      toast.error(eInvoiceErrorText(error, ar));
    } finally {
      setSaving(false);
    }
  };

  const providerLabel = (p: EInvoiceProvider | null | undefined) => {
    if (p === 'zatca') return ar ? 'السعودية — ZATCA (المرحلة 1)' : 'Saudi Arabia — ZATCA (Phase 1)';
    return ar ? 'الأردن — JoFotara' : 'Jordan — JoFotara';
  };

  const header = (
    <div className="flex items-start gap-3">
      <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
        <FileCheck2 size={22} />
      </div>
      <div>
        <h2 className="text-xl font-black text-slate-900 dark:text-white">
          {ar ? 'الفوترة الوطنية' : 'National e-invoicing'}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {ar
            ? 'الأردن عبر JoFotara، أو رمز QR ضريبي مبسّط للسعودية (ZATCA المرحلة 1). التكامل الكامل مع فاتورة لاحقاً.'
            : 'Jordan via JoFotara, or a Saudi Phase-1 tax QR (ZATCA). Full Fatoora clearance comes later.'}
        </p>
      </div>
    </div>
  );

  if (!config && !loadError) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />{ar ? 'جارٍ التحميل…' : 'Loading…'}</div>
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-rose-600">{loadError}</p>
        <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2 text-sm font-bold">
          {ar ? 'إعادة المحاولة' : 'Retry'}
        </button>
      </div>
    );
  }

  if (!config.available) {
    return (
      <div className="space-y-6">
        {header}
        <p className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 text-sm text-slate-600 dark:text-slate-300">
          {ar ? 'الفوترة الوطنية غير مفعّلة على الخادم حالياً.' : 'National e-invoicing is not enabled on the server yet.'}
        </p>
      </div>
    );
  }

  const owner = config.role === 'owner';
  const s = config.settings;
  const familyLabel = (family: string) =>
    family === 'general_sales'
      ? (ar ? 'مسجّل في ضريبة المبيعات العامة' : 'Registered for general sales tax')
      : (ar ? 'ضريبة دخل فقط' : 'Income tax only');

  if (!editing) {
    return (
      <div className="space-y-6">
        {header}
        {config.configured ? (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 p-4 space-y-3">
            <p className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={18} />
              {config.provider === 'zatca'
                ? (ar ? 'المتجر معدّ لرمز QR لهيئة الزكاة (المرحلة 1)' : 'Store is set up for ZATCA Phase 1 tax QR')
                : (ar ? 'المتجر مربوط بالفوترة الوطنية الأردنية' : 'The store is linked to JoFotara')}
            </p>
            {s && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {([
                  [ar ? 'السوق' : 'Market', providerLabel(s.provider)],
                  [ar ? 'الرقم الضريبي' : 'Tax / VAT number', s.tin],
                  [ar ? 'الاسم' : 'Name', s.sellerName],
                  ...(s.provider === 'zatca'
                    ? (s.crNumber ? [[ar ? 'السجل التجاري' : 'CR number', s.crNumber] as [string, string]] : [])
                    : ([
                        [ar ? 'تسلسل مصدر الدخل' : 'Income source sequence', s.incomeSource],
                        [ar ? 'نوع التسجيل' : 'Registration', familyLabel(s.family)],
                        ['Client-Id', s.clientIdHint],
                      ] as [string, string][])),
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-emerald-100 dark:border-emerald-500/10 py-1">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-100 text-end break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {owner && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => startEdit()} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5">
                  <Pencil size={14} />{ar ? 'تعديل' : 'Edit'}
                </button>
                <button type="button" onClick={() => setConfirmDisconnect(true)} className="rounded-xl border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-600 inline-flex items-center gap-1.5">
                  <Unlink size={14} />{ar ? 'إلغاء الربط' : 'Unlink'}
                </button>
              </div>
            )}
            {confirmDisconnect && (
              <div role="alertdialog" className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-white dark:bg-slate-900 p-3 space-y-2 text-sm">
                <p>{ar ? 'إلغاء الربط يحذف إعدادات الفوترة من الخادم. السجلات السابقة تبقى إن وُجدت.' : 'Unlinking deletes e-invoice settings from the server. Prior records stay on file.'}</p>
                <div className="flex gap-2">
                  <button type="button" disabled={saving} onClick={() => void disconnect()} className="rounded-lg bg-rose-600 text-white px-3 py-1.5 text-xs font-bold disabled:opacity-50">
                    {ar ? 'تأكيد إلغاء الربط' : 'Confirm unlink'}
                  </button>
                  <button type="button" onClick={() => setConfirmDisconnect(false)} className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold">
                    {ar ? 'تراجع' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>{ar ? 'لم يُربَط المتجر بأي نظام فوترة وطنية بعد.' : 'The store is not linked to a national e-invoice system yet.'}</p>
            {owner ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => startEdit('jofotara')} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold">
                  {ar ? 'الأردن (JoFotara)' : 'Jordan (JoFotara)'}
                </button>
                <button type="button" onClick={() => startEdit('zatca')} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold">
                  {ar ? 'السعودية — QR (ZATCA)' : 'Saudi — tax QR (ZATCA)'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">{ar ? 'مالك المتجر هو من يربطه.' : 'Only the store owner can link it.'}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  const bad = (name: string) => badFields.includes(name);
  const labels = draftProvider === 'zatca' ? SA_LABELS : JO_LABELS;

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {header}

      <div className="grid grid-cols-2 gap-2">
        {(['jofotara', 'zatca'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDraftProvider(p)}
            className={`rounded-xl border px-3 py-2.5 text-xs font-bold ${draftProvider === p ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'}`}
          >
            {providerLabel(p)}
          </button>
        ))}
      </div>

      {draftProvider === 'jofotara' ? (
        <>
          <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 space-y-1.5">
            <p className="flex items-center gap-2 font-bold"><AlertTriangle size={16} />{ar ? 'قبل الربط (الأردن)' : 'Before linking (Jordan)'}</p>
            <ul className="list-disc ps-5 space-y-1">
              <li>{ar ? 'لا توجد بيئة تجريبية: كل فاتورة تُرسل تُسجَّل رسمياً.' : 'There is no test environment: every invoice sent is recorded officially.'}</li>
              <li>{ar ? 'تحصل على Client-Id وSecret-Key من بوابة JoFotara.' : 'Get the Client-Id and Secret-Key from the JoFotara portal.'}</li>
            </ul>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">{JO_LABELS.tin[ar ? 0 : 1]}</span>
              <input className={`${input} ${bad('tin') ? fieldError : ''}`} inputMode="numeric" dir="ltr" value={joForm.tin} onChange={(e) => setJoForm((f) => ({ ...f, tin: e.target.value.replace(/\D/g, '') }))} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">{ar ? 'الاسم كما هو مسجّل لدى الضريبة' : 'Name as registered with ISTD'}</span>
              <input className={`${input} ${bad('sellerName') ? fieldError : ''}`} value={joForm.sellerName} maxLength={200} onChange={(e) => setJoForm((f) => ({ ...f, sellerName: e.target.value }))} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">{JO_LABELS.incomeSource[ar ? 0 : 1]}</span>
              <input className={`${input} ${bad('incomeSource') ? fieldError : ''}`} inputMode="numeric" dir="ltr" value={joForm.incomeSource} onChange={(e) => setJoForm((f) => ({ ...f, incomeSource: e.target.value.replace(/\D/g, '') }))} />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">{JO_LABELS.family[ar ? 0 : 1]}</span>
              <div className="grid grid-cols-2 gap-2">
                {(['income', 'general_sales'] as const).map((family) => (
                  <button
                    key={family}
                    type="button"
                    onClick={() => setJoForm((f) => ({ ...f, family }))}
                    className={`rounded-xl border px-3 py-2.5 text-xs font-bold ${joForm.family === family ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'}`}
                  >
                    {familyLabel(family)}
                  </button>
                ))}
              </div>
            </div>
            {joForm.family === 'general_sales' && (
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-bold text-slate-500">{ar ? 'الفواتير بنسبة ضريبة 0% في متجرك' : 'Invoices at 0% tax in your store'}</span>
                <select className={input} value={joForm.zeroRateCategory || ''} onChange={(e) => setJoForm((f) => ({ ...f, zeroRateCategory: (e.target.value || null) as JoFotaraSettingsInput['zeroRateCategory'] }))}>
                  <option value="">{ar ? 'لا أصدر فواتير بنسبة 0%' : 'I do not issue 0% invoices'}</option>
                  <option value="Z">{ar ? 'أصناف معفاة (Z)' : 'Exempt items (Z)'}</option>
                  <option value="O">{ar ? 'أصناف خاضعة بنسبة صفر (O)' : 'Zero-rated items (O)'}</option>
                </select>
              </label>
            )}
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">{JO_LABELS.clientId[ar ? 0 : 1]}</span>
              <input
                className={`${input} ${bad('clientId') ? fieldError : ''}`}
                dir="ltr"
                autoComplete="off"
                value={joForm.clientId}
                placeholder={config.configured && s?.clientIdHint ? `${s.clientIdHint} — ${ar ? 'اتركه فارغاً للإبقاء عليه' : 'leave empty to keep'}` : ''}
                onChange={(e) => setJoForm((f) => ({ ...f, clientId: e.target.value.trim() }))}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">{JO_LABELS.secretKey[ar ? 0 : 1]}</span>
              <input
                className={`${input} ${bad('secretKey') ? fieldError : ''}`}
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={joForm.secretKey}
                placeholder={config.configured ? (ar ? 'اتركه فارغاً للإبقاء على الحالي' : 'Leave empty to keep the current one') : ''}
                onChange={(e) => setJoForm((f) => ({ ...f, secretKey: e.target.value.trim() }))}
              />
            </label>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 space-y-1.5">
            <p className="flex items-center gap-2 font-bold"><AlertTriangle size={16} />{ar ? 'المرحلة 1 (السعودية)' : 'Phase 1 (Saudi)'}</p>
            <ul className="list-disc ps-5 space-y-1">
              <li>{ar ? 'يولَّد رمز QR ضريبي (TLV) لفواتير الريال دون إرسال لبوابة فاتورة بعد.' : 'Generates a TLV tax QR for SAR invoices; no Fatoora API submission yet.'}</li>
              <li>{ar ? 'الرقم الضريبي 15 خانة ويبدأ بـ 3. الإرسال الكامل (CSID) في مرحلة لاحقة.' : 'VAT number is 15 digits starting with 3. Full CSID clearance comes in a later phase.'}</li>
            </ul>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">{SA_LABELS.tin[ar ? 0 : 1]}</span>
              <input className={`${input} ${bad('tin') ? fieldError : ''}`} inputMode="numeric" dir="ltr" value={saForm.tin} maxLength={15} onChange={(e) => setSaForm((f) => ({ ...f, tin: e.target.value.replace(/\D/g, '').slice(0, 15) }))} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-slate-500">{SA_LABELS.sellerName[ar ? 0 : 1]}</span>
              <input className={`${input} ${bad('sellerName') ? fieldError : ''}`} value={saForm.sellerName} maxLength={200} onChange={(e) => setSaForm((f) => ({ ...f, sellerName: e.target.value }))} />
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs font-bold text-slate-500">{SA_LABELS.crNumber[ar ? 0 : 1]}</span>
              <input className={`${input} ${bad('crNumber') ? fieldError : ''}`} inputMode="numeric" dir="ltr" value={saForm.crNumber} onChange={(e) => setSaForm((f) => ({ ...f, crNumber: e.target.value.replace(/\D/g, '') }))} />
            </label>
          </div>
        </>
      )}

      {badFields.length > 0 && (
        <p className="text-sm text-rose-600">
          {ar ? 'راجع الحقول: ' : 'Check: '}
          {badFields.map((f) => labels[f]?.[ar ? 0 : 1] || f).join(ar ? '، ' : ', ')}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
          {saving && <Loader2 size={16} className="animate-spin" />}
          {ar ? 'حفظ' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold">
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}
