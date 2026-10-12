import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileCheck2, Loader2, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { Invoice } from '../types';
import { useFirebase } from './FirebaseProvider';
import {
  type EInvoiceConfig,
  type EInvoiceSubmission,
  eInvoiceErrorText,
  eInvoiceQrDataUrl,
  fetchEInvoiceConfig,
  fetchEInvoiceSubmissions,
  submitEInvoice,
} from '../lib/einvoiceApi';

const TONE = {
  accepted: 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  rejected: 'border-rose-200 bg-rose-50/60 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
  failed: 'border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  sending: 'border-sky-200 bg-sky-50/60 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
  none: 'border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200',
};

/** E-invoicing status of one sale. Renders nothing unless the store is linked or the invoice was already sent. */
export default function EInvoicePanel({ invoice, isRtl }: { invoice: Invoice; isRtl: boolean }) {
  const { user } = useFirebase();
  const [config, setConfig] = useState<EInvoiceConfig | null>(null);
  const [submission, setSubmission] = useState<EInvoiceSubmission | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);

  const isSale = invoice.type === 'sale';

  useEffect(() => {
    if (!user || !isSale) return;
    let alive = true;
    setReady(false);
    setSubmission(null);
    setQrImage('');
    Promise.allSettled([fetchEInvoiceConfig(), fetchEInvoiceSubmissions([invoice.id])]).then(([cfg, subs]) => {
      if (!alive) return;
      setConfig(cfg.status === 'fulfilled' ? cfg.value : null);
      setSubmission(subs.status === 'fulfilled' ? subs.value[invoice.id] || null : null);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [user, isSale, invoice.id]);

  useEffect(() => {
    if (submission?.status === 'accepted' && submission.qr) {
      eInvoiceQrDataUrl(submission.qr).then(setQrImage).catch(() => setQrImage(''));
    } else {
      setQrImage('');
    }
  }, [submission?.status, submission?.qr]);

  if (!user || !isSale || !ready) return null;
  const linked = !!config?.available && !!config.configured;
  if (!linked && !submission) return null;

  const canSend = linked && (config!.role === 'owner' || config!.role === 'manager');
  const status = submission?.status;
  const jod = invoice.currency === 'JOD';
  const sendable = canSend && jod && status !== 'accepted' && status !== 'sending';

  const send = async () => {
    setSending(true);
    try {
      const result = await submitEInvoice(invoice.id);
      const subs = await fetchEInvoiceSubmissions([invoice.id]).catch(() => ({} as Record<string, EInvoiceSubmission>));
      setSubmission(subs[invoice.id] || null);
      if (result.outcome === 'accepted') {
        toast.success(isRtl ? 'قُبلت الفاتورة في نظام الفوترة الوطني.' : 'The invoice was accepted by JoFotara.');
      } else if (result.outcome === 'rejected') {
        toast.error(isRtl ? 'رفض النظام الفاتورة. راجع السبب أدناه.' : 'JoFotara rejected the invoice. See the reason below.');
      } else {
        toast.error(isRtl ? 'لم يكتمل الإرسال. أعد المحاولة لاحقاً بنفس المعرّف.' : 'Sending did not complete. Retry later with the same identifier.');
      }
    } catch (error) {
      toast.error(eInvoiceErrorText(error, isRtl), { duration: 10_000 });
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  const label = {
    accepted: isRtl ? 'مقبولة في نظام الفوترة الوطني' : 'Accepted by JoFotara',
    rejected: isRtl ? 'رفضها نظام الفوترة' : 'Rejected by JoFotara',
    failed: isRtl ? 'لم يكتمل الإرسال' : 'Sending did not complete',
    sending: isRtl ? 'قيد الإرسال' : 'Sending',
  };
  const Icon = status === 'accepted' ? CheckCircle2 : status === 'rejected' ? XCircle : status === 'failed' ? AlertTriangle : status === 'sending' ? Clock : FileCheck2;

  return (
    <div className={`w-full max-w-3xl rounded-2xl border p-4 space-y-3 no-print ${TONE[status || 'none']}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Icon size={18} />
            {status ? label[status] : isRtl ? 'لم تُرسل إلى الفوترة الوطنية' : 'Not sent to JoFotara'}
          </p>
          {submission && (
            <p className="text-xs opacity-80 font-mono" dir="ltr">
              ICV {submission.icv}
              {submission.einv_num ? ` · ${submission.einv_num}` : ''}
              {submission.attempts > 1 ? ` · ${isRtl ? 'محاولات' : 'attempts'}: ${submission.attempts}` : ''}
            </p>
          )}
          {submission?.error && status !== 'accepted' && (
            <p className="text-xs whitespace-pre-line" dir="auto">{submission.error}</p>
          )}
          {status === 'failed' && (
            <p className="text-xs opacity-80">
              {isRtl ? 'إعادة الإرسال تستخدم نفس المعرّف، فلن تُسجَّل الفاتورة مرتين.' : 'A resend uses the same identifier, so the invoice cannot be recorded twice.'}
            </p>
          )}
          {linked && !jod && !status && (
            <p className="text-xs opacity-80">{isRtl ? 'الفوترة الوطنية تقبل الفواتير بالدينار الأردني فقط.' : 'JoFotara only accepts invoices in Jordanian dinars.'}</p>
          )}
        </div>
        {qrImage && <img src={qrImage} alt="QR" className="w-24 h-24 rounded-lg bg-white p-1" />}
        {sendable && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-bold inline-flex items-center gap-2"
          >
            <Send size={16} />
            {status ? (isRtl ? 'إعادة الإرسال' : 'Resend') : isRtl ? 'إرسال إلى الفوترة الوطنية' : 'Send to JoFotara'}
          </button>
        )}
      </div>
      {confirming && (
        <div role="alertdialog" className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <p>
            {isRtl
              ? 'ستُسجَّل هذه الفاتورة رسمياً لدى دائرة ضريبة الدخل والمبيعات. بعد القبول لا يمكن تعديلها أو حذفها، وتُصحَّح بفاتورة إرجاع.'
              : 'This invoice will be recorded officially by ISTD. Once accepted it cannot be edited or deleted; it is corrected with a return invoice.'}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={sending} onClick={() => void send()} className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
              {sending && <Loader2 size={14} className="animate-spin" />}
              {isRtl ? 'تأكيد الإرسال' : 'Confirm and send'}
            </button>
            <button type="button" disabled={sending} onClick={() => setConfirming(false)} className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold">
              {isRtl ? 'تراجع' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
