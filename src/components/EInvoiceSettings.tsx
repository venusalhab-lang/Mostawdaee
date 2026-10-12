import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2, Pencil, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import type { Language } from '../types';
import { useFirebase } from './FirebaseProvider';
import {
  type EInvoiceConfig,
  type EInvoiceSettingsInput,
  disconnectEInvoice,
  eInvoiceErrorText,
  EInvoiceError,
  fetchEInvoiceConfig,
  saveEInvoiceSettings,
} from '../lib/einvoiceApi';

const input =
  'w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-indigo-500';
const fieldError = 'border-rose-400 dark:border-rose-500/60';

const FIELD_LABELS: Record<string, [string, string]> = {
  tin: ['الرقم الضريبي', 'Tax number'],
  sellerName: ['الاسم المسجّل', 'Registered name'],
  incomeSource: ['تسلسل مصدر الدخل', 'Income source sequence'],
  family: ['نوع التسجيل', 'Registration type'],
  clientId: ['Client-Id', 'Client-Id'],
  secretKey: ['Secret-Key', 'Secret-Key'],
};

export default function EInvoiceSettings({ language }: { language: Language }) {
  const ar = language === 'ar';
  const { settings } = useFirebase();
  const [config, setConfig] = useState<EInvoiceConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [badFields, setBadFields] = useState<string[]>([]);
  const [form, setForm] = useState<EInvoiceSettingsInput>({
    tin: '', sellerName: '', incomeSource: '', family: 'income', zeroRateCategory: null, clientId: '', secretKey: '',
  });

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

  const startEdit = () => {
    const s = config?.settings;
    setForm({
      tin: s?.tin || (settings?.taxRegistrationNumber || '').replace(/\D/g, ''),
      sellerName: s?.sellerName || settings?.businessName || '',
      incomeSource: s?.incomeSource || '',
      family: s?.family || 'income',
      zeroRateCategory: s?.zeroRateCategory ?? null,
      clientId: '',
      secretKey: '',
    });
    setBadFields([]);
    setEditing(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (!/^\d{5,15}$/.test(form.tin.trim())) missing.push('tin');
    if (!form.sellerName.trim()) missing.push('sellerName');
    if (!/^\d{1,20}$/.test(form.incomeSource.trim())) missing.push('incomeSource');
    if (!config?.configured && !form.clientId.trim()) missing.push('clientId');
    if (!config?.configured && !form.secretKey.trim()) missing.push('secretKey');
    setBadFields(missing);
    if (missing.length) return;
    setSaving(true);
    try {
      await saveEInvoiceSettings({ ...form, zeroRateCategory: form.family === 'general_sales' ? form.zeroRateCategory : null });
      toast.success(ar ? 'حُفظ الربط مع الفوترة الوطنية.' : 'JoFotara link saved.');
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
      await disconnectEInvoice();
      toast.success(ar ? 'أُلغي الربط. الفواتير المرسلة سابقاً تبقى مسجّلة.' : 'Unlinked. Invoices already sent stay on record.');
      setConfirmDisconnect(false);
      await load();
    } catch (error) {
      toast.error(eInvoiceErrorText(error, ar));
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <div className="flex items-start gap-3">
      <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
        <FileCheck2 size={22} />
      </div>
      <div>
        <h2 className="text-xl font-black text-slate-900 dark:text-white">
          {ar ? 'الفوترة الوطنية (الأردن)' : 'National e-invoicing (Jordan)'}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {ar
            ? 'إرسال فواتير المبيعات بالدينار إلى نظام الفوترة الوطني الأردني (JoFotara) وطباعة رمز QR الصادر عنه.'
            : "Send JOD sale invoices to Jordan's National Invoicing System (JoFotara) and print the QR code it returns."}
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
          {ar ? 'الربط مع الفوترة الوطنية غير مفعّل على الخادم حالياً.' : 'JoFotara linking is not enabled on the server yet.'}
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
              <CheckCircle2 size={18} />{ar ? 'المتجر مربوط بالفوترة الوطنية' : 'The store is linked to JoFotara'}
            </p>
            {s && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {([
                  [ar ? 'الرقم الضريبي' : 'Tax number', s.tin],
                  [ar ? 'الاسم المسجّل' : 'Registered name', s.sellerName],
                  [ar ? 'تسلسل مصدر الدخل' : 'Income source sequence', s.incomeSource],
                  [ar ? 'نوع التسجيل' : 'Registration', familyLabel(s.family)],
                  ...(s.family === 'general_sales'
                    ? [[ar ? 'أصناف 0%' : '0% items', s.zeroRateCategory === 'O' ? (ar ? 'خاضعة بنسبة صفر' : 'Zero-rated') : s.zeroRateCategory === 'Z' ? (ar ? 'معفاة' : 'Exempt') : (ar ? 'غير محدد' : 'Not set')]]
                    : []),
                  ['Client-Id', s.clientIdHint],
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
                <button type="button" onClick={startEdit} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5">
                  <Pencil size={14} />{ar ? 'تعديل' : 'Edit'}
                </button>
                <button type="button" onClick={() => setConfirmDisconnect(true)} className="rounded-xl border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-600 inline-flex items-center gap-1.5">
                  <Unlink size={14} />{ar ? 'إلغاء الربط' : 'Unlink'}
                </button>
              </div>
            )}
            {confirmDisconnect && (
              <div role="alertdialog" className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-white dark:bg-slate-900 p-3 space-y-2 text-sm">
                <p>{ar ? 'إلغاء الربط يحذف بيانات الدخول من الخادم ويوقف الإرسال. الفواتير المقبولة سابقاً تبقى مقفلة ومسجّلة.' : 'Unlinking deletes the credentials from the server and stops sending. Accepted invoices stay locked and on record.'}</p>
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
            <p>{ar ? 'المتجر غير مربوط بالفوترة الوطنية.' : 'The store is not linked to JoFotara.'}</p>
            {owner ? (
              <button type="button" onClick={startEdit} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold">
                {ar ? 'ربط المتجر' : 'Link the store'}
              </button>
            ) : (
              <p className="text-xs text-slate-500">{ar ? 'مالك المتجر هو من يربطه.' : 'Only the store owner can link it.'}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  const bad = (name: string) => badFields.includes(name);
  const set = (patch: Partial<EInvoiceSettingsInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {header}

      <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 space-y-1.5">
        <p className="flex items-center gap-2 font-bold"><AlertTriangle size={16} />{ar ? 'قبل الربط' : 'Before linking'}</p>
        <ul className="list-disc ps-5 space-y-1">
          <li>{ar ? 'لا توجد بيئة تجريبية: كل فاتورة تُرسل تُسجَّل رسمياً لدى دائرة ضريبة الدخل والمبيعات.' : 'There is no test environment: every invoice sent is recorded officially by ISTD.'}</li>
          <li>{ar ? 'بعد ربط برنامج بالنظام لا يستطيع المكلّف إصدار الفواتير من بوابة الفوترة نفسها.' : 'Once a program is linked, the taxpayer can no longer issue invoices from the JoFotara portal itself.'}</li>
          <li>{ar ? 'تحصل على Client-Id وSecret-Key من بوابة الفوترة: ربط الأجهزة ← ربط جديد، مع اختيار تسلسل مصدر الدخل.' : 'Get the Client-Id and Secret-Key from the portal: Device linking → New link, choosing the income source sequence.'}</li>
        </ul>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">{FIELD_LABELS.tin[ar ? 0 : 1]}</span>
          <input className={`${input} ${bad('tin') ? fieldError : ''}`} inputMode="numeric" dir="ltr" value={form.tin} onChange={(e) => set({ tin: e.target.value.replace(/\D/g, '') })} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">{ar ? 'الاسم كما هو مسجّل لدى الضريبة' : 'Name as registered with ISTD'}</span>
          <input className={`${input} ${bad('sellerName') ? fieldError : ''}`} value={form.sellerName} maxLength={200} onChange={(e) => set({ sellerName: e.target.value })} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">{FIELD_LABELS.incomeSource[ar ? 0 : 1]}</span>
          <input className={`${input} ${bad('incomeSource') ? fieldError : ''}`} inputMode="numeric" dir="ltr" value={form.incomeSource} onChange={(e) => set({ incomeSource: e.target.value.replace(/\D/g, '') })} />
        </label>
        <div className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">{FIELD_LABELS.family[ar ? 0 : 1]}</span>
          <div className="grid grid-cols-2 gap-2">
            {(['income', 'general_sales'] as const).map((family) => (
              <button
                key={family}
                type="button"
                onClick={() => set({ family })}
                className={`rounded-xl border px-3 py-2.5 text-xs font-bold ${form.family === family ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'}`}
              >
                {familyLabel(family)}
              </button>
            ))}
          </div>
        </div>
        {form.family === 'general_sales' && (
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-bold text-slate-500">{ar ? 'الفواتير بنسبة ضريبة 0% في متجرك' : 'Invoices at 0% tax in your store'}</span>
            <select className={input} value={form.zeroRateCategory || ''} onChange={(e) => set({ zeroRateCategory: (e.target.value || null) as EInvoiceSettingsInput['zeroRateCategory'] })}>
              <option value="">{ar ? 'لا أصدر فواتير بنسبة 0%' : 'I do not issue 0% invoices'}</option>
              <option value="Z">{ar ? 'أصناف معفاة (Z)' : 'Exempt items (Z)'}</option>
              <option value="O">{ar ? 'أصناف خاضعة بنسبة صفر (O)' : 'Zero-rated items (O)'}</option>
            </select>
          </label>
        )}
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">{ar ? 'رقم المستخدم (Client-Id)' : 'Client-Id'}</span>
          <input
            className={`${input} ${bad('clientId') ? fieldError : ''}`}
            dir="ltr"
            autoComplete="off"
            value={form.clientId}
            placeholder={config.configured && s ? `${s.clientIdHint} — ${ar ? 'اتركه فارغاً للإبقاء عليه' : 'leave empty to keep'}` : ''}
            onChange={(e) => set({ clientId: e.target.value.trim() })}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-bold text-slate-500">{ar ? 'المفتاح السري (Secret-Key)' : 'Secret-Key'}</span>
          <input
            className={`${input} ${bad('secretKey') ? fieldError : ''}`}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={form.secretKey}
            placeholder={config.configured ? (ar ? 'اتركه فارغاً للإبقاء على الحالي' : 'Leave empty to keep the current one') : ''}
            onChange={(e) => set({ secretKey: e.target.value.trim() })}
          />
        </label>
      </div>

      {badFields.length > 0 && (
        <p className="text-sm text-rose-600">
          {ar ? 'راجع الحقول: ' : 'Check: '}
          {badFields.map((f) => FIELD_LABELS[f]?.[ar ? 0 : 1] || f).join(ar ? '، ' : ', ')}
        </p>
      )}
      <p className="text-xs text-slate-500">
        {ar
          ? 'يُحفظ المفتاح السري على الخادم مشفّراً ولا يُعرض بعد الحفظ، ولا يصل إلى أجهزة الموظفين.'
          : 'The Secret-Key is stored encrypted on the server, never shown again and never sent to staff devices.'}
      </p>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
          {saving && <Loader2 size={16} className="animate-spin" />}
          {ar ? 'حفظ الربط' : 'Save link'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold">
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}
