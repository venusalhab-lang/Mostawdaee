import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Repeat2,
  XCircle,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AppSettings,
  Cheque,
  ChequeContactType,
  ChequeFilters,
  ChequeInput,
  ChequeStatus,
  ChequeType,
  Currency,
  Language,
} from '../types';
import { useFirebase } from './FirebaseProvider';
import { CURRENCY_SYMBOLS, POS_CURRENCY_CODES, formatMoney, isPosCurrency } from '../lib/exchangeRates';
import {
  CHEQUE_STATUSES,
  CHEQUE_STATUS_LABELS,
  allowedTransitions,
  filterCheques,
  isOverdue,
  localToday,
  summarizeCheques,
  validateChequeInput,
  type ChequeInputError,
} from '../lib/cheques';
import { ChequeStoreError, changeChequeStatus, createCheque, deleteCheque, loadCheques } from '../lib/chequesStore';
import { useScreenSearch } from '../lib/screenSearch';

interface Props {
  language: Language;
  settings: AppSettings;
}

const EMPTY_FILTERS: ChequeFilters = { status: 'all', bank: '', from: '', to: '', search: '' };

const STATUS_TONE: Record<ChequeStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  cashed: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
  bounced: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20',
  endorsed: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20',
  returned: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-slate-300 dark:border-white/10',
};

const ACTION_ICON: Record<ChequeStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  cashed: CheckCircle2,
  bounced: XCircle,
  endorsed: Repeat2,
  returned: Undo2,
  pending: RotateCcw,
};

const inputClass =
  'w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-indigo-500';

function blankForm(type: ChequeType, currency: Currency, businessName: string, hasCustomers: boolean): ChequeInput {
  return {
    chequeNumber: '',
    bankName: '',
    amount: Number.NaN,
    currency,
    dueDate: localToday(),
    type,
    drawerName: type === 'outgoing' ? businessName : '',
    contactType: type === 'outgoing' ? 'supplier' : hasCustomers ? 'customer' : null,
    contactId: null,
    contactName: '',
    notes: '',
  };
}

export default function ChequesManagement({ language, settings }: Props) {
  const isRtl = language === 'ar';
  const locale = isRtl ? 'ar' : 'en-US';
  const { user, customers, invoices } = useFirebase();
  const userId = user?.uid || 'guest';
  const defaultCurrency: Currency = isPosCurrency(settings.currency) ? settings.currency : 'ILS';

  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<ChequeType>('incoming');
  const [filters, setFilters] = useState<ChequeFilters>(EMPTY_FILTERS);

  useScreenSearch('cheques', ({ query, chequeType }) => {
    if (chequeType) setTab(chequeType);
    setFilters({ ...EMPTY_FILTERS, search: query });
  });

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ChequeInput>(() => blankForm('incoming', defaultCurrency, settings.businessName, customers.length > 0));
  const [formError, setFormError] = useState<ChequeInputError | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ cheque: Cheque; next: ChequeStatus | 'delete' } | null>(null);
  const [endorsedTo, setEndorsedTo] = useState('');
  const [busy, setBusy] = useState(false);
  const today = localToday();

  const errorText = useCallback((error: unknown): string => {
    const code = error instanceof ChequeStoreError ? error.code : 'failed';
    const messages: Record<string, [string, string]> = {
      schema_missing: ['سجل الشيكات غير مفعّل على الخادم بعد. تواصل مع الدعم.', 'The cheques register is not enabled on the server yet. Contact support.'],
      no_session: ['انتهت جلسة الدخول. سجّل الدخول مرة أخرى.', 'Your session has ended. Sign in again.'],
      duplicate: ['هذا الشيك مسجّل مسبقاً لنفس البنك.', 'This cheque is already registered for this bank.'],
      invalid: ['بيانات الشيك غير صالحة.', 'The cheque details are not valid.'],
      invalid_transition: ['تغيّرت حالة هذا الشيك أو لا يمكن نقله إلى هذه الحالة. حدّث القائمة.', 'This cheque changed or cannot move to that status. Refresh the list.'],
      not_found: ['لم يعد هذا الشيك موجوداً.', 'This cheque no longer exists.'],
      failed: ['تعذّر الاتصال بالخادم. لم يُحفظ التغيير.', 'Could not reach the server. Nothing was saved.'],
    };
    const [ar, en] = messages[code] || messages.failed;
    return isRtl ? ar : en;
  }, [isRtl]);

  const refresh = useCallback(async () => {
    try {
      setCheques(await loadCheques(userId));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [userId, errorText]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const supplierNames = useMemo(() => {
    const names = new Set<string>();
    for (const invoice of invoices) {
      if (invoice.type === 'purchase' && invoice.supplierName?.trim()) names.add(invoice.supplierName.trim());
    }
    for (const cheque of cheques) {
      if (cheque.contactType === 'supplier' && cheque.contactName) names.add(cheque.contactName);
      if (cheque.endorsedTo) names.add(cheque.endorsedTo);
    }
    return [...names].sort((a, b) => a.localeCompare(b, locale));
  }, [invoices, cheques, locale]);

  const bankNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const cheque of cheques) names.set(cheque.bankName.trim().toLowerCase(), cheque.bankName.trim());
    return [...names.values()].sort((a, b) => a.localeCompare(b, locale));
  }, [cheques, locale]);

  const tabCheques = useMemo(() => cheques.filter((cheque) => cheque.type === tab), [cheques, tab]);
  const totals = useMemo(() => summarizeCheques(tabCheques), [tabCheques]);
  const visible = useMemo(() => filterCheques(cheques, tab, filters), [cheques, tab, filters]);
  const tabBanks = useMemo(() => {
    const names = new Map<string, string>();
    for (const cheque of tabCheques) names.set(cheque.bankName.trim().toLowerCase(), cheque.bankName.trim());
    return [...names.values()].sort((a, b) => a.localeCompare(b, locale));
  }, [tabCheques, locale]);
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  const statusLabel = (status: ChequeStatus) => (isRtl ? CHEQUE_STATUS_LABELS[status].ar : CHEQUE_STATUS_LABELS[status].en);

  const actionLabel = (cheque: Cheque, next: ChequeStatus): string => {
    const labels: Record<ChequeStatus, [string, string]> = {
      cashed: cheque.type === 'incoming' ? ['تحصيل', 'Mark cashed'] : ['تم صرفه', 'Mark paid'],
      bounced: ['تسجيل كراجع', 'Mark bounced'],
      endorsed: ['تجيير', 'Endorse'],
      returned: ['إرجاع للساحب', 'Return to drawer'],
      pending: ['إعادة إيداع', 'Re-deposit'],
    };
    return isRtl ? labels[next][0] : labels[next][1];
  };

  const openForm = () => {
    setForm(blankForm(tab, defaultCurrency, settings.businessName, customers.length > 0));
    setFormError(null);
    setFormOpen(true);
  };

  const setContactType = (contactType: ChequeContactType | null) => {
    setForm((current) => ({ ...current, contactType, contactId: null, contactName: '' }));
  };

  const pickCustomer = (id: string) => {
    const customer = customers.find((row) => row.id === id);
    setForm((current) => ({
      ...current,
      contactId: customer?.id || null,
      contactName: customer?.name || '',
      drawerName: current.type === 'incoming' && !current.drawerName.trim() ? customer?.name || '' : current.drawerName,
    }));
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateChequeInput(form);
    setFormError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const saved = await createCheque(userId, form);
      setCheques((current) => [...current, saved]);
      setFormOpen(false);
      toast.success(isRtl ? `سُجّل الشيك رقم ${saved.chequeNumber}` : `Cheque ${saved.chequeNumber} recorded`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.next === 'delete') {
        await deleteCheque(userId, pending.cheque);
        setCheques((current) => current.filter((row) => row.id !== pending.cheque.id));
        toast.success(isRtl ? 'حُذف الشيك' : 'Cheque deleted');
      } else {
        const updated = await changeChequeStatus(userId, pending.cheque, pending.next, endorsedTo);
        setCheques((current) => current.map((row) => (row.id === updated.id ? updated : row)));
        toast.success(isRtl ? `الشيك ${updated.chequeNumber}: ${statusLabel(updated.status)}` : `Cheque ${updated.chequeNumber}: ${statusLabel(updated.status)}`);
      }
      setPending(null);
    } catch (error) {
      toast.error(errorText(error));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const formErrorText: Record<ChequeInputError, string> = {
    number: isRtl ? 'أدخل رقم الشيك (حتى 40 حرفاً).' : 'Enter the cheque number (up to 40 characters).',
    bank: isRtl ? 'أدخل اسم البنك.' : 'Enter the bank name.',
    amount: isRtl ? 'أدخل مبلغاً أكبر من صفر.' : 'Enter an amount above zero.',
    currency: isRtl ? 'اختر العملة.' : 'Choose a currency.',
    dueDate: isRtl ? 'أدخل تاريخ استحقاق صحيحاً.' : 'Enter a valid due date.',
    type: isRtl ? 'اختر نوع الشيك.' : 'Choose the cheque type.',
    contact: isRtl ? 'اختر الزبون من القائمة.' : 'Choose the customer from the list.',
  };

  const renderTotals = (bucket: Map<string, number>) =>
    bucket.size === 0 ? (
      <div className="text-lg font-black text-slate-300 dark:text-slate-600">—</div>
    ) : (
      [...bucket.entries()].map(([code, amount]) => (
        <div key={code} className="text-lg font-black font-mono text-slate-900 dark:text-white">
          {formatMoney(amount, code, locale)}
        </div>
      ))
    );

  const renderParty = (cheque: Cheque) => {
    const party = cheque.type === 'incoming' ? cheque.drawerName || cheque.contactName : cheque.contactName;
    return (
      <>
        <div className="font-bold">{party || '—'}</div>
        {cheque.type === 'incoming' && cheque.contactName && cheque.contactName !== party && (
          <div className="text-xs text-slate-400">{cheque.contactName}</div>
        )}
        {cheque.status === 'endorsed' && cheque.endorsedTo && (
          <div className="text-xs text-indigo-600">{isRtl ? 'مُجيَّر إلى' : 'Endorsed to'}: {cheque.endorsedTo}</div>
        )}
        {cheque.notes && <div className="text-xs text-slate-400 mt-0.5">{cheque.notes}</div>}
      </>
    );
  };

  const renderActions = (cheque: Cheque) => {
    const actions = allowedTransitions(cheque.type, cheque.status);
    if (actions.length === 0 && cheque.status !== 'pending') return null;
    return (
      <>
        <button
          type="button"
          onClick={() => setMenuId((open) => (open === cheque.id ? null : cheque.id))}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
          aria-label={isRtl ? 'إجراءات الشيك' : 'Cheque actions'}
          aria-expanded={menuId === cheque.id}
        >
          <MoreVertical size={16} />
        </button>
        {menuId === cheque.id && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuId(null)} />
            <div className="absolute z-40 end-0 top-9 w-52 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-lg py-1 text-start">
              {actions.map((next) => {
                const Icon = ACTION_ICON[next];
                return (
                  <button
                    key={next}
                    type="button"
                    onClick={() => {
                      setMenuId(null);
                      setEndorsedTo('');
                      setPending({ cheque, next });
                    }}
                    className="w-full px-3 py-2.5 text-sm font-bold flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <Icon size={15} className="text-slate-400" />
                    {actionLabel(cheque, next)}
                  </button>
                );
              })}
              {cheque.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuId(null);
                    setPending({ cheque, next: 'delete' });
                  }}
                  className="w-full px-3 py-2.5 text-sm font-bold flex items-center gap-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 border-t border-slate-100 dark:border-white/5"
                >
                  <Trash2 size={15} />
                  {isRtl ? 'حذف (أُدخل بالخطأ)' : 'Delete (entered by mistake)'}
                </button>
              )}
            </div>
          </>
        )}
      </>
    );
  };

  const summaryCards: Array<{ key: 'pending' | 'cashed' | 'bounced'; title: string; tone: string }> = [
    { key: 'pending', title: isRtl ? 'تحت التحصيل' : 'Pending', tone: 'text-amber-600' },
    { key: 'cashed', title: tab === 'incoming' ? (isRtl ? 'المحصّلة' : 'Cashed') : (isRtl ? 'المصروفة' : 'Paid'), tone: 'text-emerald-600' },
    { key: 'bounced', title: isRtl ? 'الراجعة' : 'Bounced', tone: 'text-rose-600' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Banknote className="text-indigo-600" size={26} />
            {isRtl ? 'إدارة الشيكات' : 'Cheques'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {isRtl
              ? 'سجل الشيكات الواردة والصادرة وحالة كل شيك. المبالغ تُجمع لكل عملة على حدة.'
              : 'Register incoming and outgoing cheques and track each one. Totals are kept per currency.'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {isRtl
              ? 'هذا سجل متابعة فقط: صرف الشيك لا يغيّر رصيد الخزنة ولا دين الزبون. عند تحصيله سجّل الدفعة من شاشة الزبائن أو الخزنة.'
              : 'This is a tracking register only: clearing a cheque does not change the vault or customer debt. When it clears, record the payment from Customers or the Vault.'}
          </p>
          {userId === 'guest' && (
            <p className="text-xs text-amber-600 mt-1">
              {isRtl ? 'وضع التجربة: الشيكات تُحفظ على هذا الجهاز فقط.' : 'Trial mode: cheques are saved on this device only.'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={openForm}
          disabled={!!loadError}
          className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Plus size={16} />
          {isRtl ? 'شيك جديد' : 'New cheque'}
        </button>
      </div>

      <div className="flex gap-2">
        {(['incoming', 'outgoing'] as ChequeType[]).map((type) => {
          const Icon = type === 'incoming' ? ArrowDownLeft : ArrowUpRight;
          const count = cheques.filter((cheque) => cheque.type === type).length;
          return (
            <button
              key={type}
              type="button"
              onClick={() => {
                setTab(type);
                setFilters(EMPTY_FILTERS);
                setMenuId(null);
              }}
              className={`px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 ${
                tab === type
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10'
              }`}
            >
              <Icon size={16} />
              {type === 'incoming' ? (isRtl ? 'شيكات واردة' : 'Incoming') : (isRtl ? 'شيكات صادرة' : 'Outgoing')}
              <span className={`text-xs font-mono ${tab === type ? 'text-white/80' : 'text-slate-400'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {summaryCards.map((card) => (
          <div key={card.key} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold ${card.tone}`}>{card.title}</span>
              <span className="text-xs font-mono text-slate-400">
                {totals.counts[card.key]} {isRtl ? 'شيك' : totals.counts[card.key] === 1 ? 'cheque' : 'cheques'}
              </span>
            </div>
            <div className="mt-2 space-y-0.5">{renderTotals(totals[card.key])}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] items-end">
        <label className="space-y-1">
          <span className="text-xs font-bold text-slate-400">{isRtl ? 'بحث' : 'Search'}</span>
          <div className="relative">
            <Search size={16} className="absolute top-1/2 -translate-y-1/2 text-slate-400 start-3" />
            <input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder={isRtl ? 'رقم الشيك، الساحب، الجهة' : 'Number, drawer, contact'} aria-label={isRtl ? 'رقم الشيك، الساحب، الجهة' : 'Number, drawer, contact'}
              className={`${inputClass} ps-9`}
            />
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-slate-400">{isRtl ? 'الحالة' : 'Status'}</span>
          <select
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as ChequeFilters['status'] }))}
            className={inputClass}
          >
            <option value="all">{isRtl ? 'كل الحالات' : 'All statuses'}</option>
            {CHEQUE_STATUSES.filter((status) => tab === 'incoming' || status !== 'endorsed').map((status) => (
              <option key={status} value={status}>{statusLabel(status)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-slate-400">{isRtl ? 'البنك' : 'Bank'}</span>
          <select
            value={filters.bank}
            onChange={(event) => setFilters((current) => ({ ...current, bank: event.target.value }))}
            className={inputClass}
          >
            <option value="">{isRtl ? 'كل البنوك' : 'All banks'}</option>
            {tabBanks.map((bank) => (
              <option key={bank} value={bank}>{bank}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-slate-400">{isRtl ? 'استحقاق من' : 'Due from'}</span>
          <input
            type="date"
            dir="ltr"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-slate-400">{isRtl ? 'إلى' : 'To'}</span>
          <input
            type="date"
            dir="ltr"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            className={inputClass}
          />
        </label>
        <button
          type="button"
          disabled={!filtersActive}
          onClick={() => setFilters(EMPTY_FILTERS)}
          className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 disabled:opacity-40"
        >
          {isRtl ? 'مسح' : 'Clear'}
        </button>
      </div>

      {(loading || loadError || visible.length === 0) && (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-4 py-10 text-center">
          {loading && <p className="text-slate-400">{isRtl ? 'جارٍ التحميل…' : 'Loading…'}</p>}
          {!loading && loadError && (
            <>
              <p className="text-rose-600 font-bold">{loadError}</p>
              <button type="button" onClick={() => { setLoading(true); void refresh(); }} className="mt-3 text-sm font-bold text-indigo-600">
                {isRtl ? 'إعادة المحاولة' : 'Try again'}
              </button>
            </>
          )}
          {!loading && !loadError && (
            <p className="text-slate-400">
              {tabCheques.length === 0
                ? (isRtl ? 'لا توجد شيكات بعد. أضف أول شيك من زر «شيك جديد».' : 'No cheques yet. Add one with “New cheque”.')
                : (isRtl ? 'لا توجد شيكات تطابق الفلترة.' : 'No cheques match these filters.')}
            </p>
          )}
        </div>
      )}

      {!loading && !loadError && visible.length > 0 && (
        <div className="space-y-2 md:hidden">
          {visible.map((cheque) => (
            <div key={cheque.id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono font-bold">{cheque.chequeNumber}</div>
                  <div className="text-xs text-slate-500">{cheque.bankName}</div>
                </div>
                <div className="flex items-start gap-1 relative">
                  <span className={`inline-block rounded-lg border px-2 py-0.5 text-xs font-bold whitespace-nowrap ${STATUS_TONE[cheque.status]}`}>
                    {statusLabel(cheque.status)}
                  </span>
                  {renderActions(cheque)}
                </div>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div className="min-w-0 text-sm">{renderParty(cheque)}</div>
                <div className="text-end shrink-0">
                  <div className="font-mono font-black">{formatMoney(cheque.amount, cheque.currency, locale)}</div>
                  <div className="text-xs font-mono text-slate-500">{cheque.dueDate}</div>
                  {isOverdue(cheque, today) && <div className="text-[11px] font-bold text-rose-600">{isRtl ? 'تجاوز الاستحقاق' : 'Past due'}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 overflow-x-auto ${!loading && !loadError && visible.length > 0 ? 'hidden md:block' : 'hidden'}`}>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 border-b border-slate-100 dark:border-white/10">
            <tr>
              <th className="px-3 py-3 text-start font-bold">{isRtl ? 'رقم الشيك' : 'Cheque'}</th>
              <th className="px-3 py-3 text-start font-bold">{isRtl ? 'البنك' : 'Bank'}</th>
              <th className="px-3 py-3 text-start font-bold">
                {tab === 'incoming' ? (isRtl ? 'الساحب / الزبون' : 'Drawer / customer') : (isRtl ? 'المستفيد' : 'Payee')}
              </th>
              <th className="px-3 py-3 text-start font-bold">{isRtl ? 'الاستحقاق' : 'Due'}</th>
              <th className="px-3 py-3 text-end font-bold">{isRtl ? 'المبلغ' : 'Amount'}</th>
              <th className="px-3 py-3 text-start font-bold">{isRtl ? 'الحالة' : 'Status'}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {visible.map((cheque) => {
              const overdue = isOverdue(cheque, today);
              return (
                <tr key={cheque.id} className="border-t border-slate-100 dark:border-white/5 align-top">
                  <td className="px-3 py-3 font-mono font-bold">{cheque.chequeNumber}</td>
                  <td className="px-3 py-3">{cheque.bankName}</td>
                  <td className="px-3 py-3">{renderParty(cheque)}</td>
                  <td className="px-3 py-3 font-mono">
                    {cheque.dueDate}
                    {overdue && <div className="text-[11px] font-bold text-rose-600">{isRtl ? 'تجاوز الاستحقاق' : 'Past due'}</div>}
                  </td>
                  <td className="px-3 py-3 text-end font-mono font-black whitespace-nowrap">
                    {formatMoney(cheque.amount, cheque.currency, locale)}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-block rounded-lg border px-2 py-0.5 text-xs font-bold ${STATUS_TONE[cheque.status]}`}>
                      {statusLabel(cheque.status)}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-end relative">{renderActions(cheque)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {formOpen && createPortal(
        <div className="fixed inset-0 z-[300] bg-slate-950/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !busy && setFormOpen(false)}>
          <form
            onSubmit={submitForm}
            onClick={(event) => event.stopPropagation()}
            dir={isRtl ? 'rtl' : 'ltr'}
            className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-900 dark:text-white">{isRtl ? 'تسجيل شيك جديد' : 'Record a cheque'}</h2>
              <button type="button" onClick={() => setFormOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5" aria-label={isRtl ? 'إغلاق' : 'Close'}>
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['incoming', 'outgoing'] as ChequeType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm((current) => ({
                    ...blankForm(type, current.currency, settings.businessName, customers.length > 0),
                    chequeNumber: current.chequeNumber,
                    bankName: current.bankName,
                    amount: current.amount,
                    dueDate: current.dueDate,
                    notes: current.notes,
                  }))}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-bold ${
                    form.type === type ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {type === 'incoming' ? (isRtl ? 'وارد (استلمناه)' : 'Incoming (received)') : (isRtl ? 'صادر (حرّرناه)' : 'Outgoing (issued)')}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">{isRtl ? 'رقم الشيك' : 'Cheque number'}</span>
                <input value={form.chequeNumber} onChange={(event) => setForm((current) => ({ ...current, chequeNumber: event.target.value }))} className={`${inputClass} font-mono`} inputMode="numeric" maxLength={40} required />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">{isRtl ? 'البنك' : 'Bank'}</span>
                <input value={form.bankName} onChange={(event) => setForm((current) => ({ ...current, bankName: event.target.value }))} list="cheque-banks" className={inputClass} maxLength={120} required />
                <datalist id="cheque-banks">
                  {bankNames.map((bank) => <option key={bank} value={bank} />)}
                </datalist>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">{isRtl ? 'المبلغ' : 'Amount'}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={Number.isFinite(form.amount) ? form.amount : ''}
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value === '' ? Number.NaN : Number(event.target.value) }))}
                  className={`${inputClass} font-mono`}
                  required
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-slate-500">{isRtl ? 'العملة' : 'Currency'}</span>
                <select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value as Currency }))} className={inputClass}>
                  {POS_CURRENCY_CODES.map((code) => (
                    <option key={code} value={code}>{code} ({CURRENCY_SYMBOLS[code]})</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-xs font-bold text-slate-500">{isRtl ? 'تاريخ الاستحقاق' : 'Due date'}</span>
                <input type="date" dir="ltr" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} className={inputClass} required />
              </label>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-500">
                {form.type === 'incoming' ? (isRtl ? 'الجهة التي سلّمت الشيك' : 'Received from') : (isRtl ? 'المستفيد' : 'Payee')}
              </span>
              <div className="flex gap-2">
                {([['customer', isRtl ? 'زبون' : 'Customer'], ['supplier', isRtl ? 'مورّد' : 'Supplier'], [null, isRtl ? 'بدون' : 'None']] as Array<[ChequeContactType | null, string]>).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setContactType(value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                      form.contactType === value ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:text-slate-900' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {form.contactType === 'customer' && (
                customers.length === 0 ? (
                  <p className="text-xs text-slate-400">{isRtl ? 'لا يوجد زبائن مسجّلون بعد. أضفهم من شاشة العملاء والديون.' : 'No customers yet. Add them from Customers & Debt.'}</p>
                ) : (
                  <select value={form.contactId || ''} onChange={(event) => pickCustomer(event.target.value)} className={inputClass}>
                    <option value="">{isRtl ? 'اختر الزبون' : 'Choose a customer'}</option>
                    {[...customers].sort((a, b) => a.name.localeCompare(b.name, locale)).map((customer) => (
                      <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` — ${customer.phone}` : ''}</option>
                    ))}
                  </select>
                )
              )}
              {form.contactType === 'supplier' && (
                <>
                  <input
                    value={form.contactName}
                    onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))}
                    list="cheque-suppliers"
                    placeholder={isRtl ? 'اسم المورّد' : 'Supplier name'} aria-label={isRtl ? 'اسم المورّد' : 'Supplier name'}
                    className={inputClass}
                    maxLength={160}
                  />
                  <datalist id="cheque-suppliers">
                    {supplierNames.map((name) => <option key={name} value={name} />)}
                  </datalist>
                </>
              )}
            </div>

            <label className="space-y-1 block">
              <span className="text-xs font-bold text-slate-500">{isRtl ? 'اسم الساحب' : 'Drawer name'}</span>
              <input value={form.drawerName} onChange={(event) => setForm((current) => ({ ...current, drawerName: event.target.value }))} className={inputClass} maxLength={160} />
            </label>

            <label className="space-y-1 block">
              <span className="text-xs font-bold text-slate-500">{isRtl ? 'ملاحظات' : 'Notes'}</span>
              <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={2} className={inputClass} maxLength={500} />
            </label>

            {formError && <p className="text-sm font-bold text-rose-600">{formErrorText[formError]}</p>}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold">
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="submit" disabled={busy} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50">
                {busy ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…') : (isRtl ? 'حفظ الشيك' : 'Save cheque')}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      )}

      {pending && createPortal(
        <div className="fixed inset-0 z-[300] bg-slate-950/40 flex items-center justify-center p-4" onClick={() => !busy && setPending(null)}>
          <div onClick={(event) => event.stopPropagation()} dir={isRtl ? 'rtl' : 'ltr'} className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-lg font-black text-slate-900 dark:text-white">
              {pending.next === 'delete' ? (isRtl ? 'حذف الشيك؟' : 'Delete this cheque?') : actionLabel(pending.cheque, pending.next)}
            </h2>
            <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3 text-sm space-y-1">
              <div className="flex justify-between gap-3"><span className="text-slate-400">{isRtl ? 'رقم الشيك' : 'Cheque'}</span><span className="font-mono font-bold">{pending.cheque.chequeNumber}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-400">{isRtl ? 'البنك' : 'Bank'}</span><span className="font-bold">{pending.cheque.bankName}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-400">{isRtl ? 'المبلغ' : 'Amount'}</span><span className="font-mono font-black">{formatMoney(pending.cheque.amount, pending.cheque.currency, locale)}</span></div>
              {pending.next !== 'delete' && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">{isRtl ? 'الحالة' : 'Status'}</span>
                  <span className="font-bold">{statusLabel(pending.cheque.status)} {isRtl ? '←' : '→'} {statusLabel(pending.next)}</span>
                </div>
              )}
            </div>
            {pending.next === 'endorsed' && (
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-500">{isRtl ? 'جُيِّر إلى' : 'Endorsed to'}</span>
                <input value={endorsedTo} onChange={(event) => setEndorsedTo(event.target.value)} list="cheque-endorse" className={inputClass} maxLength={160} autoFocus />
                <datalist id="cheque-endorse">
                  {supplierNames.map((name) => <option key={name} value={name} />)}
                </datalist>
              </label>
            )}
            {pending.next !== 'delete' && pending.next !== 'pending' && (
              <p className="text-xs text-slate-400">
                {isRtl ? 'لا يمكن تعديل مبلغ الشيك أو بياناته بعد هذه الخطوة.' : 'The cheque details cannot be edited after this step.'}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setPending(null)} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold">
                {isRtl ? 'رجوع' : 'Back'}
              </button>
              <button
                type="button"
                onClick={confirmAction}
                disabled={busy || (pending.next === 'endorsed' && !endorsedTo.trim())}
                className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${pending.next === 'delete' || pending.next === 'bounced' ? 'bg-rose-600' : 'bg-indigo-600'}`}
              >
                {busy ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…') : (isRtl ? 'تأكيد' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
