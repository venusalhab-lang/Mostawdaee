import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Clock, Lock, Printer, Unlock, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import { CurrencySelect } from './CurrencyPicker';
import type { Cheque, Currency, Shift, ShiftCurrencyTotals } from '../types';
import { formatMoney, formatReceiptDate, formatReceiptMoney, isPosCurrency, roundMoney } from '../lib/exchangeRates';
import { cashDifference, openShiftOf, summarizeShift } from '../lib/shifts';
import { buildShiftReportHtml } from '../lib/shiftReport';
import { buildDayCloseSnapshot } from '../lib/dayClose';
import { buildDayCloseReportHtml } from '../lib/dayCloseReport';
import { loadCheques } from '../lib/chequesStore';
import { printHtmlDocument } from '../lib/printHtml';
import { printReceipt, printerErrorMessage, readReceiptPrinter } from '../lib/receiptPrinter';

interface ShiftPanelProps {
  isOpen: boolean;
  onClose: () => void;
  language: 'ar' | 'en';
  defaultCurrency: string;
  /** Prefer the store-day close tab when the panel opens (back-office). */
  initialTab?: 'drawer' | 'day';
}

const HISTORY_LIMIT = 30;

export default function ShiftPanel({ isOpen, onClose, language, defaultCurrency, initialTab = 'drawer' }: ShiftPanelProps) {
  const isRtl = language === 'ar';
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const { user, settings, invoices, shifts, openShift, closeShift, can, vault, vaultTransactions, customers } = useFirebase();
  const uid = user?.uid;
  const seesStore = can('back_office');

  const mine = openShiftOf(shifts, uid);
  const [panelTab, setPanelTab] = useState<'drawer' | 'day'>(initialTab);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closedLocal, setClosedLocal] = useState<Shift | null>(null);
  const listed = selectedId ? shifts.find((s) => s.id === selectedId) : undefined;
  const selected = selectedId
    ? (closedLocal?.id === selectedId && listed?.status !== 'closed' ? closedLocal : listed || null)
    : mine;

  const [currency, setCurrency] = useState<Currency>(isPosCurrency(defaultCurrency) ? defaultCurrency : 'JOD');
  const [floatInput, setFloatInput] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  const [counted, setCounted] = useState<Partial<Record<Currency, string>>>({});
  const [closeNotes, setCloseNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const openDraftRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPanelTab(seesStore ? initialTab : 'drawer');
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [isOpen, invoices, initialTab, seesStore]);

  useEffect(() => {
    if (!isOpen || !seesStore || !uid || panelTab !== 'day') return;
    let cancelled = false;
    loadCheques(uid)
      .then((rows) => {
        if (!cancelled) setCheques(rows);
      })
      .catch(() => {
        if (!cancelled) setCheques([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, seesStore, uid, panelTab, now]);

  useEffect(() => {
    openDraftRef.current = null;
  }, [currency, floatInput, openNotes, isOpen]);

  useEffect(() => {
    setCounted({});
    setCloseNotes('');
  }, [selected?.id]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedId(null);
      setClosedLocal(null);
    }
  }, [isOpen]);

  const live: ShiftCurrencyTotals[] = useMemo(() => {
    if (!selected) return [];
    if (selected.status === 'closed') return selected.summary || [];
    return summarizeShift(selected, invoices, now, shifts);
  }, [selected, invoices, now, shifts]);

  const daySnap = useMemo(() => {
    if (!seesStore) return null;
    return buildDayCloseSnapshot({
      invoices,
      vault,
      vaultTransactions,
      customers,
      cheques,
      shifts,
      fallbackCurrency: isPosCurrency(defaultCurrency) ? defaultCurrency : 'JOD',
      now,
    });
  }, [seesStore, invoices, vault, vaultTransactions, customers, cheques, shifts, defaultCurrency, now]);

  const history = useMemo(
    () => shifts.filter((s) => s.id !== selected?.id && (seesStore || s.actorId === uid)).slice(0, HISTORY_LIMIT),
    [shifts, selected?.id, seesStore, uid],
  );

  if (!isOpen) return null;

  const money = (value: number, code: string) => formatMoney(value, code);
  const formatDate = (time: number) => new Date(time).toLocaleString(isRtl ? 'ar-EG' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const who = (s: Shift) => s.userName || s.actorEmail || L('مستخدم', 'User');

  const goScreen = (screen: string) => {
    onClose();
    window.dispatchEvent(new CustomEvent('change-screen', { detail: screen }));
  };

  const printDay = () => {
    if (!daySnap) return;
    const html = buildDayCloseReportHtml({
      isAr: isRtl,
      businessName: settings?.businessName || '',
      snapshot: daySnap,
      money,
      formatDate,
    });
    printHtmlDocument(html, L('إقفال-اليوم', 'day-close'));
  };

  const print = (shift: Shift, totals: ShiftCurrencyTotals[]) => {
    const html = buildShiftReportHtml({
      isAr: isRtl,
      businessName: settings?.businessName || '',
      shift,
      totals,
      money: (value, code) => formatReceiptMoney(value, code),
      formatDate: (time) => formatReceiptDate(time, isRtl),
      paper: readReceiptPrinter().paper,
    });
    const job = shift.status === 'closed' ? 'Z-report' : 'X-report';
    printReceipt(html, job).catch((err) => {
      toast.error(printerErrorMessage(err, isRtl), {
        id: 'shift-print',
        action: { label: L('طباعة عبر النظام', 'Use system print'), onClick: () => printHtmlDocument(html, job) },
      });
    });
  };

  const fail = (error: any) => {
    if (!error?.notified) toast.error(error?.message || L('تعذّر الحفظ.', 'Could not save.'));
  };

  const handleOpen = async () => {
    if (busy) return;
    const amount = floatInput.trim() === '' ? 0 : Number(floatInput);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(L('أدخل رصيد افتتاح صحيحاً (صفر أو أكثر).', 'Enter a valid opening float (zero or more).'));
      return;
    }
    setBusy(true);
    try {
      await openShift({ id: (openDraftRef.current ||= crypto.randomUUID()), currency, openingFloat: amount, notes: openNotes });
      toast.success(L('بدأ عدّ الدرج.', 'Drawer count started.'));
      setFloatInput('');
      setOpenNotes('');
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const required = (t: ShiftCurrencyTotals) => !!selected && (t.currency === selected.currency || t.expectedCash !== 0);

  const handleClose = async () => {
    if (!selected || busy) return;
    const values: Partial<Record<Currency, number>> = {};
    for (const t of live) {
      const raw = counted[t.currency]?.trim();
      if (raw === undefined || raw === '') {
        if (required(t)) {
          toast.error(L(`أدخل النقد المعدود بعملة ${t.currency}.`, `Enter the counted ${t.currency} cash.`));
          return;
        }
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(L(`النقد المعدود بعملة ${t.currency} غير صحيح.`, `The counted ${t.currency} cash is not valid.`));
        return;
      }
      values[t.currency] = n;
    }
    setBusy(true);
    try {
      const closed = await closeShift({ id: selected.id, counted: values, notes: closeNotes });
      toast.success(L('انتهى العدّ. يمكنك طباعة تقرير الإغلاق (Z).', 'Count ended. You can print the Z-report.'));
      setClosedLocal(closed);
      setSelectedId(closed.id);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const countedNumber = (code: Currency) => {
    const raw = counted[code]?.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  const diffBadge = (diff: number | null, code: string) => {
    if (diff === null) return null;
    const cls = diff === 0
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
      : diff > 0
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
        : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300';
    const label = diff === 0 ? L('مطابق', 'Balanced') : diff > 0 ? L('زيادة', 'Over') : L('عجز', 'Short');
    return (
      <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black ${cls}`}>
        {label}{diff !== 0 && <span className="tabular-nums" dir="ltr">{money(Math.abs(diff), code)}</span>}
      </span>
    );
  };

  const row = (label: string, value: number, code: string, strong = false) => (
    <div className={`flex items-center justify-between gap-3 py-1 ${strong ? 'font-black text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
      <span>{label}</span>
      <span className="tabular-nums" dir="ltr">{money(value, code)}</span>
    </div>
  );

  const isClosed = selected?.status === 'closed';
  const canCloseSelected = !!selected && !isClosed && (selected.actorId === uid || seesStore);

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-sm p-0 sm:p-4" dir={isRtl ? 'rtl' : 'ltr'} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-panel-title"
        className="w-full sm:max-w-2xl max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 font-arabic"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200"><Clock size={18} /></span>
            <div>
              <h2 id="shift-panel-title" className="text-base font-black text-slate-900 dark:text-white">
                {panelTab === 'day' ? L('إقفال يوم المتجر', 'Store day close') : L('عدّ درج الكاشير', 'Cash drawer count')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {panelTab === 'day'
                  ? L(
                      'ملخص يومي للمطابقة: مبيعات كل الكاشيرات، الخزنة، الديون، الشيكات. لا يحرّك المال.',
                      'Daily reconciliation: all-cashier sales, vault, debts, cheques. Does not move money.',
                    )
                  : L(
                      'ورقة درج اختيارية: رصيد افتتاح وعدّ عند الإغلاق وتقرير Z. لا تحرّك الخزنة ولا تمنع البيع.',
                      'Optional drawer worksheet: opening float, closing count and Z-report. Does not move the vault or block sales.',
                    )}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={L('إغلاق', 'Close')} className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {seesStore && (
          <div className="px-5 pt-3 flex gap-1 shrink-0" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === 'drawer'}
              onClick={() => setPanelTab('drawer')}
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-black cursor-pointer ${
                panelTab === 'drawer'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-1.5"><Clock size={13} />{L('عدّ الدرج', 'Drawer')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === 'day'}
              onClick={() => setPanelTab('day')}
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-black cursor-pointer ${
                panelTab === 'day'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-1.5"><CalendarDays size={13} />{L('إقفال اليوم', 'Day close')}</span>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {panelTab === 'day' && seesStore && daySnap && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 dark:bg-white/5 p-3 text-sm">
                <div>
                  <div className="font-black text-slate-900 dark:text-white">{daySnap.dayIso}</div>
                  <div className="text-xs text-slate-500">{L('حتى', 'As of')} {formatDate(daySnap.asOf)}</div>
                </div>
                <button
                  type="button"
                  onClick={printDay}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-2 text-xs font-black cursor-pointer"
                >
                  <Printer size={14} />{L('طباعة الملخص', 'Print summary')}
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-3">
                <h3 className="text-sm font-black text-slate-900 dark:text-white">{L('مبيعات اليوم (كل الكاشيرات)', 'Today’s sales (all cashiers)')}</h3>
                {daySnap.sales.length === 0 ? (
                  <p className="text-xs text-slate-500">{L('لا مبيعات اليوم بعد.', 'No sales yet today.')}</p>
                ) : (
                  daySnap.sales.map((s) => (
                    <div key={s.currency} className="text-sm border-t border-slate-100 dark:border-white/10 pt-2 first:border-0 first:pt-0">
                      <div className="flex justify-between font-black text-slate-900 dark:text-white mb-1">
                        <span>{s.currency}</span>
                        <span className="tabular-nums" dir="ltr">{money(s.net, s.currency)}</span>
                      </div>
                      {row(L('إجمالي', 'Gross'), s.sales, s.currency)}
                      {row(L('مرتجعات', 'Returns'), s.returns, s.currency)}
                      {row(L('نقدي', 'Cash'), s.byMethod.cash, s.currency)}
                      {row(L('بطاقة', 'Card'), s.byMethod.card, s.currency)}
                      {row(L('محفظة', 'Wallet'), s.byMethod.wallet, s.currency)}
                      {row(L('آجل', 'Credit'), s.byMethod.credit, s.currency)}
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">{L('الخزنة الآن', 'Vault now')}</h3>
                  <button type="button" onClick={() => goScreen('vault')} className="text-[11px] font-bold text-indigo-600 cursor-pointer">
                    {L('فتح الخزنة', 'Open vault')}
                  </button>
                </div>
                {Object.entries(daySnap.vaultBalances).filter(([, v]) => v !== 0).length === 0 ? (
                  <p className="text-xs text-slate-500">—</p>
                ) : (
                  Object.entries(daySnap.vaultBalances)
                    .filter(([, v]) => v !== 0)
                    .map(([code, value]) => row(code, value, code, true))
                )}
                {daySnap.vaultFlows.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-white/10 space-y-1">
                    <p className="text-[11px] font-bold text-slate-500">{L('حركة اليوم', 'Today’s movement')}</p>
                    {daySnap.vaultFlows.map((f) => (
                      <div key={f.currency} className="flex justify-between text-xs text-slate-600 dark:text-slate-300 gap-2">
                        <span>{f.currency}</span>
                        <span className="tabular-nums" dir="ltr">
                          +{money(f.income, f.currency)} / −{money(f.expense, f.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {L(`ديون (${daySnap.debts.count})`, `Debts (${daySnap.debts.count})`)}
                    </h3>
                    <button type="button" onClick={() => goScreen('customers')} className="text-[11px] font-bold text-indigo-600 cursor-pointer">
                      {L('العملاء', 'Customers')}
                    </button>
                  </div>
                  {daySnap.debts.rows.length === 0
                    ? <p className="text-xs text-slate-500">—</p>
                    : daySnap.debts.rows.map((r) => row(r.currency, r.amount, r.currency))}
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {L(`شيكات صُرفت (${daySnap.chequesCashedToday.count})`, `Cashed (${daySnap.chequesCashedToday.count})`)}
                    </h3>
                    <button type="button" onClick={() => goScreen('cheques')} className="text-[11px] font-bold text-indigo-600 cursor-pointer">
                      {L('الشيكات', 'Cheques')}
                    </button>
                  </div>
                  {Object.keys(daySnap.chequesCashedToday.byCurrency).length === 0
                    ? <p className="text-xs text-slate-500">—</p>
                    : Object.entries(daySnap.chequesCashedToday.byCurrency).map(([code, value]) => row(code, value, code))}
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 font-bold">
                    {L(`معلّقة متأخرة: ${daySnap.chequesOverduePending}`, `Overdue pending: ${daySnap.chequesOverduePending}`)}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-2">
                <h3 className="text-sm font-black text-slate-900 dark:text-white">{L('عدّ الأدراج', 'Drawer counts')}</h3>
                <p className="text-xs text-slate-500">
                  {L(`ورديات أُغلقت اليوم: ${daySnap.shiftsClosedToday}`, `Shifts closed today: ${daySnap.shiftsClosedToday}`)}
                </p>
                {daySnap.openShifts.length === 0 ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold">{L('لا عدّ درج مفتوح.', 'No open drawer counts.')}</p>
                ) : (
                  <ul className="text-xs space-y-1 text-slate-700 dark:text-slate-300">
                    {daySnap.openShifts.map((s) => (
                      <li key={s.id}>{s.label} · {formatDate(s.openedAt)}</li>
                    ))}
                  </ul>
                )}
                <button type="button" onClick={() => setPanelTab('drawer')} className="text-[11px] font-bold text-indigo-600 cursor-pointer">
                  {L('الانتقال لعدّ الدرج', 'Go to drawer count')}
                </button>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {L(
                  'قائمة تحقق فقط. عدّل الخزنة يدوياً من شاشة الخزنة إن لزم، مع سبب واضح.',
                  'Checklist only. Adjust the vault from the vault screen if needed, with a clear reason.',
                )}
              </p>
            </section>
          )}

          {panelTab === 'drawer' && (
          <>
          {!user && (
            <p className="rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm p-3">
              {L('وضع المعاينة لا يحفظ الورديات. سجّل الدخول لاستخدامها.', 'Preview mode does not save shifts. Sign in to use them.')}
            </p>
          )}

          {!selected && (
            <section className="space-y-3">
              <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Unlock size={16} />{L('بدء عدّ الدرج', 'Start a drawer count')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {L(
                  'اختياري للمطابقة مع درج النقد. فرق الإقفال يُسجَّل في التقرير فقط ولا يُرحَّل إلى الخزنة.',
                  'Optional for matching the cash drawer. Closing variance is recorded on the report only and is not posted to the vault.',
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="sm:col-span-2 block">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{L('النقد في الدرج عند البدء (رصيد الافتتاح)', 'Cash in the drawer at start (opening float)')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={floatInput}
                    onChange={(e) => setFloatInput(e.target.value)}
                    placeholder="0"
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-base font-bold tabular-nums outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{L('العملة', 'Currency')}</span>
                  <CurrencySelect value={currency} onChange={setCurrency} isRtl={isRtl} aria-label={L('عملة رصيد الافتتاح', 'Opening float currency')} className="mt-1 w-full" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{L('ملاحظات (اختياري)', 'Notes (optional)')}</span>
                <input
                  type="text"
                  value={openNotes}
                  onChange={(e) => setOpenNotes(e.target.value)}
                  maxLength={200}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
                />
              </label>
              <button
                type="button"
                onClick={handleOpen}
                disabled={busy || !user}
                className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-3 cursor-pointer"
              >
                {busy ? L('جارٍ الفتح…', 'Opening…') : L('بدء العدّ', 'Start count')}
              </button>
            </section>
          )}

          {selected && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 dark:bg-white/5 p-3 text-sm">
                <div className="space-y-0.5">
                  <div className="font-black text-slate-900 dark:text-white">
                    {isClosed ? L('وردية مغلقة', 'Closed shift') : L('وردية مفتوحة', 'Open shift')} · {who(selected)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {L('من', 'From')} {formatDate(selected.openedAt)}
                    {selected.closedAt ? ` ${L('إلى', 'to')} ${formatDate(selected.closedAt)}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  {selectedId && selectedId !== mine?.id && (
                    <button type="button" onClick={() => setSelectedId(null)} className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-xs font-bold cursor-pointer">
                      {mine ? L('ورديتي', 'My shift') : L('وردية جديدة', 'New shift')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => print(selected, live)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-2 text-xs font-black cursor-pointer"
                  >
                    <Printer size={14} />{isClosed ? L('طباعة تقرير Z', 'Print Z-report') : L('طباعة تقرير X', 'Print X-report')}
                  </button>
                </div>
              </div>

              {live.map((t) => {
                const diff = isClosed
                  ? cashDifference(t, selected.counted)
                  : (countedNumber(t.currency) === undefined ? null : roundMoney((countedNumber(t.currency) as number) - t.expectedCash, t.currency));
                return (
                  <div key={t.currency} className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 text-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-black text-slate-900 dark:text-white">{t.currency}</span>
                      <span className="text-xs text-slate-500">{L(`${t.salesCount} مبيعات · ${t.returnsCount} مرتجعات`, `${t.salesCount} sales · ${t.returnsCount} returns`)}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                      <div>
                        {row(L('إجمالي المبيعات', 'Total sales'), t.sales, t.currency, true)}
                        {row(L('نقدي', 'Cash'), t.byMethod.cash, t.currency)}
                        {row(L('بطاقة', 'Card'), t.byMethod.card, t.currency)}
                        {row(L('محفظة', 'Wallet'), t.byMethod.wallet, t.currency)}
                        {row(L('آجل', 'On credit'), t.byMethod.credit, t.currency)}
                        {row(L('المرتجعات', 'Returns'), t.returns, t.currency)}
                      </div>
                      <div className="sm:border-s sm:ps-6 border-slate-100 dark:border-white/10 mt-2 sm:mt-0">
                        {row(L('رصيد الافتتاح', 'Opening float'), t.openingFloat, t.currency)}
                        {row(L('+ مبيعات نقدية', '+ Cash sales'), t.cashSales, t.currency)}
                        {row(L('− مرتجعات نقدية', '− Cash refunds'), t.cashRefunds, t.currency)}
                        {row(L('النقد المتوقع في الدرج', 'Expected cash in drawer'), t.expectedCash, t.currency, true)}
                        {isClosed && selected.counted?.[t.currency] !== undefined && row(L('النقد المعدود', 'Counted cash'), Number(selected.counted[t.currency]), t.currency, true)}
                      </div>
                    </div>
                    {canCloseSelected && (
                      <label className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                          {L(`النقد المعدود (${t.currency})`, `Counted cash (${t.currency})`)}{required(t) ? ' *' : ''}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={counted[t.currency] ?? ''}
                          onChange={(e) => setCounted((prev) => ({ ...prev, [t.currency]: e.target.value }))}
                          className="w-40 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2 text-base font-bold tabular-nums outline-none focus:border-indigo-500"
                        />
                        {diffBadge(diff, t.currency)}
                      </label>
                    )}
                    {isClosed && <div className="mt-2">{diffBadge(diff, t.currency)}</div>}
                  </div>
                );
              })}

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {L(
                  'النقد المتوقع = رصيد الافتتاح + المبيعات النقدية − المبالغ المردودة نقداً، لمبيعات هذا المستخدم خلال العدّ. البطاقة والمحفظة والآجل لا تدخل الدرج. الخزنة تبقى المصدر الرسمي للنقد.',
                  'Expected cash = opening float + cash sales − cash refunds for this user’s sales during the count. Card, wallet and credit do not enter the drawer. The vault remains the official cash ledger.',
                )}
              </p>

              {canCloseSelected && (
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{L('ملاحظات الإغلاق (اختياري)', 'Closing notes (optional)')}</span>
                    <input
                      type="text"
                      value={closeNotes}
                      onChange={(e) => setCloseNotes(e.target.value)}
                      maxLength={300}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-black py-3 cursor-pointer"
                  >
                    <Lock size={16} />{busy ? L('جارٍ الإغلاق…', 'Closing…') : L('إنهاء العدّ واعتماد الفروقات في التقرير', 'End count and lock the variance on the report')}
                  </button>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {L(
                      'بعد الإنهاء لا يمكن تعديل هذا العدّ. الفرق لا يُعدَّل في الخزنة تلقائياً.',
                      'After ending, this count cannot be edited. The variance is not applied to the vault automatically.',
                    )}
                  </p>
                </div>
              )}
            </section>
          )}

          {history.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">{L('سجل الورديات', 'Shift history')}</h3>
              <ul className="divide-y divide-slate-100 dark:divide-white/10 rounded-2xl border border-slate-200 dark:border-white/10">
                {history.map((s) => {
                  const main = s.summary?.find((t) => t.currency === s.currency);
                  const diff = main ? cashDifference(main, s.counted) : null;
                  return (
                    <li key={s.id}>
                      <button type="button" onClick={() => setSelectedId(s.id)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                            {who(s)} · {s.status === 'open' ? L('مفتوحة', 'Open') : L('مغلقة', 'Closed')}
                          </div>
                          <div className="text-xs text-slate-500">{formatDate(s.openedAt)}{s.closedAt ? ` → ${formatDate(s.closedAt)}` : ''}</div>
                        </div>
                        {s.status === 'closed' && diffBadge(diff, s.currency)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
