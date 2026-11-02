import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Pencil, Plus, Search, Trash2, Truck, UserPlus, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Currency, Supplier, SupplierTransaction } from '../types';
import { useFirebase } from './FirebaseProvider';
import { CurrencySelect } from './CurrencyPicker';
import { currencyDecimals, formatMoney } from '../lib/exchangeRates';
import { readVaultBalances, roundForCurrency } from '../lib/vaultMath';
import { owedBalances, runningBalances, supplierBalance, supplierStatement, supplierSuggestions, totalOwed } from '../lib/suppliers';

interface SuppliersPanelProps {
  isRtl: boolean;
  defaultCurrency: Currency;
}

const INPUT = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500';

function Modal({ title, isRtl, onClose, busy, children, footer }: {
  title: React.ReactNode; isRtl: boolean; onClose: () => void; busy?: boolean; children: React.ReactNode; footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" dir={isRtl ? 'rtl' : 'ltr'} role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-black text-slate-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label={isRtl ? 'إغلاق' : 'Close'}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

const amountStep = (currency: Currency) => (currencyDecimals(currency) > 0 ? String(10 ** -currencyDecimals(currency)) : '1');

function SupplierFormModal({ isRtl, supplier, initialName, defaultCurrency, onClose }: {
  isRtl: boolean; supplier: Supplier | null; initialName?: string; defaultCurrency: Currency; onClose: () => void;
}) {
  const { saveSupplier } = useFirebase();
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const [name, setName] = useState(supplier?.name || initialName || '');
  const [phone, setPhone] = useState(supplier?.phone || '');
  const [notes, setNotes] = useState(supplier?.notes || '');
  const [openings, setOpenings] = useState<Array<{ currency: Currency; amount: string }>>([{ currency: defaultCurrency, amount: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const idRef = useRef(supplier?.id || crypto.randomUUID());

  const parsed = openings.map((o) => ({ currency: o.currency, amount: Number(o.amount) }));
  const openingError = parsed.some((o, i) => openings[i].amount !== '' && (!Number.isFinite(o.amount) || o.amount < 0));
  const duplicateCurrency = new Set(openings.map((o) => o.currency)).size !== openings.length;
  const canSave = name.trim().length > 0 && !openingError && !duplicateCurrency && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await saveSupplier(
        { id: idRef.current, name, phone, notes },
        supplier ? [] : parsed.filter((o) => o.amount > 0),
      );
      toast.success(supplier ? L('حُفظت بيانات المورد', 'Supplier updated') : L('أُضيف المورد', 'Supplier added'));
      onClose();
    } catch (e: any) {
      if (!e?.notified) setError(e?.message || L('تعذّر حفظ المورد.', 'Could not save the supplier.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isRtl={isRtl}
      busy={saving}
      onClose={onClose}
      title={supplier ? L('تعديل مورد', 'Edit supplier') : L('إضافة مورد', 'Add supplier')}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving}
            className="px-5 py-2.5 rounded-2xl font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 disabled:opacity-50">
            {L('إلغاء', 'Cancel')}
          </button>
          <button type="button" onClick={submit} disabled={!canSave}
            className="px-5 py-2.5 rounded-2xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? L('جارٍ الحفظ...', 'Saving...') : L('حفظ', 'Save')}
          </button>
        </>
      )}
    >
      <label className="block">
        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('اسم المورد', 'Supplier name')}</span>
        <input className={`${INPUT} mt-1`} value={name} maxLength={120} disabled={saving} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="block">
        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('الهاتف', 'Phone')}</span>
        <input className={`${INPUT} mt-1`} value={phone} maxLength={40} dir="ltr" disabled={saving} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('ملاحظات', 'Notes')}</span>
        <input className={`${INPUT} mt-1`} value={notes} maxLength={300} disabled={saving} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {!supplier && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('مستحق له قبل استخدام التطبيق (اختياري)', 'Owed before using the app (optional)')}</p>
          {openings.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <CurrencySelect
                value={o.currency}
                isRtl={isRtl}
                disabled={saving}
                aria-label={L('العملة', 'Currency')}
                onChange={(code) => setOpenings((prev) => prev.map((row, j) => (j === i ? { ...row, currency: code } : row)))}
              />
              <input
                type="number" inputMode="decimal" min={0} step={amountStep(o.currency)} placeholder="0"
                className={`${INPUT} font-mono`} value={o.amount} disabled={saving}
                aria-label={L('المبلغ المستحق', 'Amount owed')}
                onChange={(e) => setOpenings((prev) => prev.map((row, j) => (j === i ? { ...row, amount: e.target.value } : row)))}
              />
              {openings.length > 1 && (
                <button type="button" disabled={saving} aria-label={L('حذف السطر', 'Remove row')}
                  onClick={() => setOpenings((prev) => prev.filter((_, j) => j !== i))}
                  className="p-2 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <button type="button" disabled={saving}
            onClick={() => setOpenings((prev) => [...prev, { currency: defaultCurrency === 'USD' ? 'JOD' : 'USD', amount: '' }])}
            className="text-xs font-bold text-indigo-600 hover:underline">
            {L('+ عملة أخرى', '+ Another currency')}
          </button>
          {duplicateCurrency && <p className="text-[11px] font-bold text-rose-600">{L('كل عملة تُكتب مرة واحدة.', 'Each currency once.')}</p>}
          {openingError && <p className="text-[11px] font-bold text-rose-600">{L('مبلغ غير صالح.', 'Invalid amount.')}</p>}
          <p className="text-[11px] text-slate-500">{L('يُسجَّل كرصيد افتتاحي في حساب المورد، ولا يمسّ الخزنة. كل عملة رصيد مستقل.', 'Recorded as an opening balance on the supplier account; the vault is not touched. Each currency is a separate balance.')}</p>
        </div>
      )}
      {error && <p className="text-sm font-bold text-rose-600" role="alert">{error}</p>}
    </Modal>
  );
}

function PayModal({ isRtl, supplier, onClose }: { isRtl: boolean; supplier: Supplier; onClose: () => void }) {
  const { recordSupplierPayment, vault } = useFirebase();
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const owed = owedBalances(supplier).filter((b) => b.amount > 0);
  const [currency, setCurrency] = useState<Currency>(owed[0]?.currency || 'JOD');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const idRef = useRef<string | null>(null);
  useEffect(() => { idRef.current = null; }, [currency, amount, notes]);

  const balance = supplierBalance(supplier, currency);
  const available = readVaultBalances(vault)[currency] || 0;
  const value = roundForCurrency(Number(amount) || 0, currency);
  const problem = !amount ? ''
    : !(value > 0) ? L('اكتب مبلغاً أكبر من صفر.', 'Enter an amount above zero.')
      : value > balance ? L(`المستحق للمورد بهذه العملة ${formatMoney(balance, currency)} فقط.`, `Only ${formatMoney(balance, currency)} is owed in this currency.`)
        : value > available ? L(`رصيد الخزنة بهذه العملة ${formatMoney(available, currency)} لا يكفي.`, `The vault holds only ${formatMoney(available, currency)} in this currency.`)
          : '';
  const canPay = value > 0 && !problem && !saving;

  const submit = async () => {
    if (!canPay) return;
    setSaving(true);
    setError('');
    try {
      await recordSupplierPayment({ id: (idRef.current ||= crypto.randomUUID()), supplierId: supplier.id, amount: value, currency, notes });
      toast.success(L(`دُفع ${formatMoney(value, currency)} للمورد ${supplier.name}`, `Paid ${formatMoney(value, currency)} to ${supplier.name}`));
      onClose();
    } catch (e: any) {
      if (!e?.notified) setError(e?.message || L('تعذّر تسجيل الدفعة.', 'Could not record the payment.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isRtl={isRtl}
      busy={saving}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Wallet size={18} className="text-emerald-600" />{L('دفعة للمورد', 'Pay supplier')} · {supplier.name}</span>}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving}
            className="px-5 py-2.5 rounded-2xl font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 disabled:opacity-50">
            {L('إلغاء', 'Cancel')}
          </button>
          <button type="button" onClick={submit} disabled={!canPay}
            className="px-5 py-2.5 rounded-2xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? L('جارٍ الدفع...', 'Paying...') : L('دفع من الخزنة', 'Pay from the vault')}
          </button>
        </>
      )}
    >
      {owed.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">{L('لا يوجد مبلغ مستحق لهذا المورد.', 'Nothing is owed to this supplier.')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label={L('العملة', 'Currency')}>
            {owed.map((b) => (
              <button key={b.currency} type="button" disabled={saving} aria-pressed={currency === b.currency}
                onClick={() => { setCurrency(b.currency); setAmount(''); }}
                className={`px-3 py-2 rounded-xl border text-sm font-bold ${currency === b.currency ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                <span className="font-mono" dir="ltr">{formatMoney(b.amount, b.currency)}</span>
              </button>
            ))}
          </div>
          <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('المبلغ', 'Amount')} ({currency})</span>
            <div className="flex gap-2 mt-1">
              <input type="number" inputMode="decimal" min={0} step={amountStep(currency)} className={`${INPUT} font-mono`}
                value={amount} disabled={saving} onChange={(e) => setAmount(e.target.value)} autoFocus />
              <button type="button" disabled={saving} onClick={() => setAmount(String(Math.min(balance, available)))}
                className="px-3 rounded-xl text-xs font-bold text-indigo-600 border border-slate-200 dark:border-slate-700 whitespace-nowrap">
                {L('المستحق كاملاً', 'Full amount')}
              </button>
            </div>
          </label>
          <p className="text-xs text-slate-500">
            {L('المتاح في الخزنة:', 'In the vault:')} <span className="font-mono" dir="ltr">{formatMoney(available, currency)}</span>
          </p>
          <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('ملاحظة (اختياري)', 'Note (optional)')}</span>
            <input className={`${INPUT} mt-1`} value={notes} maxLength={200} disabled={saving} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {problem && <p className="text-[12px] font-bold text-rose-600">{problem}</p>}
        </>
      )}
      {error && <p className="text-sm font-bold text-rose-600" role="alert">{error}</p>}
    </Modal>
  );
}

function StatementModal({ isRtl, supplier, onClose }: { isRtl: boolean; supplier: Supplier; onClose: () => void }) {
  const { supplierTransactions, invoices, deleteSupplierTransaction, can } = useFirebase();
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const rows = useMemo(() => supplierStatement(supplierTransactions, supplier.id), [supplierTransactions, supplier.id]);
  const invoiceNumbers = useMemo(() => new Map(invoices.map((i) => [i.id, i.invoiceNumber])), [invoices]);
  const cashPurchases = useMemo(
    () => invoices.filter((i) => i.type === 'purchase' && i.supplierId === supplier.id && i.paymentMethod !== 'credit').length,
    [invoices, supplier.id],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const balances = owedBalances(supplier);
  const running = useMemo(() => runningBalances(rows), [rows]);

  const typeLabel = (t: SupplierTransaction) => t.type === 'purchase'
    ? L('شراء آجل', 'Credit purchase')
    : t.type === 'payment' ? L('دفعة', 'Payment')
    : t.type === 'return' ? L('مرتجع مشتريات', 'Purchase return') : L('رصيد افتتاحي', 'Opening balance');

  const remove = async (t: SupplierTransaction) => {
    const message = t.type === 'payment'
      ? L(`حذف هذه الدفعة؟ يعود ${formatMoney(t.amount, t.currency)} إلى الخزنة ويرتفع المستحق للمورد.`, `Delete this payment? ${formatMoney(t.amount, t.currency)} goes back into the vault and the amount owed rises.`)
      : L('حذف الرصيد الافتتاحي؟ ينخفض المستحق للمورد بقيمته.', 'Delete the opening balance? The amount owed drops by it.');
    if (!window.confirm(message)) return;
    setBusyId(t.id);
    try {
      await deleteSupplierTransaction(t.id);
      toast.success(L('حُذف القيد', 'Entry deleted'));
    } catch (e: any) {
      if (!e?.notified) toast.error(e?.message || L('تعذّر حذف القيد.', 'Could not delete the entry.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal isRtl={isRtl} onClose={onClose} title={<span className="flex items-center gap-2"><BookOpen size={18} className="text-indigo-600" />{L('كشف حساب', 'Statement')} · {supplier.name}</span>}>
      <div className="flex flex-wrap gap-2">
        {balances.length === 0
          ? <span className="text-sm text-slate-500">{L('لا يوجد رصيد مستحق.', 'Nothing owed.')}</span>
          : balances.map((b) => (
            <span key={b.currency} className={`px-3 py-1.5 rounded-xl text-sm font-black font-mono ${b.amount > 0 ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700'}`} dir="ltr">
              {formatMoney(b.amount, b.currency)}
            </span>
          ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{L('لا توجد حركات بعد. الشراء الآجل والدفعات تظهر هنا.', 'No entries yet. Credit purchases and payments appear here.')}</p>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((t) => {
            const linked = t.invoiceId ? invoiceNumbers.get(t.invoiceId) : undefined;
            const removable = (t.type === 'payment' || t.type === 'opening') && can('delete_records');
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {typeLabel(t)}
                    {linked && <span className="font-mono text-xs text-slate-500" dir="ltr"> #{linked}</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {new Date(Number(t.date) || 0).toLocaleString(isRtl ? 'ar-JO' : 'en-US')}
                    {t.notes && t.type !== 'purchase' && t.type !== 'return' ? ` · ${t.notes}` : ''}
                  </div>
                </div>
                <div className="text-end">
                  <div className={`font-mono font-black text-sm ${t.type === 'payment' || t.type === 'return' ? 'text-emerald-600' : 'text-amber-700 dark:text-amber-300'}`} dir="ltr">
                    {t.type === 'payment' || t.type === 'return' ? '-' : '+'}{formatMoney(t.amount, t.currency)}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono" dir="ltr">{L('الرصيد', 'Balance')} {formatMoney(running.get(t.id) ?? t.balanceAfter, t.currency)}</div>
                </div>
                {removable && (
                  <button type="button" disabled={busyId !== null} onClick={() => remove(t)} aria-label={L('حذف القيد', 'Delete entry')}
                    className="p-2 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-40">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {cashPurchases > 0 && (
        <p className="text-[11px] text-slate-500">{L(`و${cashPurchases} فاتورة شراء نقدية من هذا المورد (مدفوعة كاملة، لا تغيّر الرصيد).`, `Plus ${cashPurchases} cash purchase(s) from this supplier (paid in full, no balance change).`)}</p>
      )}
    </Modal>
  );
}

export default function SuppliersPanel({ isRtl, defaultCurrency }: SuppliersPanelProps) {
  const { suppliers, invoices, saveSupplier, deleteSupplier, can } = useFirebase();
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ supplier: Supplier | null; name?: string } | null>(null);
  const [paying, setPaying] = useState<Supplier | null>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const totals = useMemo(() => totalOwed(suppliers), [suppliers]);
  const suggestions = useMemo(() => supplierSuggestions(invoices, suppliers), [invoices, suppliers]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? suppliers.filter((s) => s.name.toLowerCase().includes(term) || (s.phone || '').includes(term)) : suppliers;
  }, [suppliers, query]);
  const byId = (id: string | undefined) => suppliers.find((s) => s.id === id) || null;

  const addSuggested = async (name: string) => {
    setAdding(name);
    try {
      await saveSupplier({ id: crypto.randomUUID(), name });
      toast.success(L(`أُضيف «${name}» إلى الموردين`, `“${name}” added to suppliers`));
    } catch (e: any) {
      if (!e?.notified) toast.error(e?.message || L('تعذّر إضافة المورد.', 'Could not add the supplier.'));
    } finally {
      setAdding(null);
    }
  };

  const remove = async (s: Supplier) => {
    if (!window.confirm(L(`حذف المورد «${s.name}»؟ تبقى فواتيره السابقة كما هي.`, `Delete supplier “${s.name}”? Past invoices stay as they are.`))) return;
    try {
      await deleteSupplier(s.id);
      toast.success(L('حُذف المورد', 'Supplier deleted'));
    } catch (e: any) {
      if (!e?.notified) toast.error(e?.message || L('تعذّر حذف المورد.', 'Could not delete the supplier.'));
    }
  };

  const totalEntries = Object.entries(totals).filter(([, v]) => v !== 0) as [Currency, number][];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800">
        <div className="text-sm">
          <span className="font-bold text-slate-500">{L('المستحق للموردين:', 'Owed to suppliers:')}</span>{' '}
          {totalEntries.length === 0
            ? <span className="font-bold text-slate-700 dark:text-slate-200">{L('لا شيء', 'Nothing')}</span>
            : totalEntries.map(([c, v]) => (
              <span key={c} className="inline-block ms-2 font-black font-mono text-amber-700 dark:text-amber-300" dir="ltr">{formatMoney(v, c)}</span>
            ))}
        </div>
        <button type="button" onClick={() => setEditing({ supplier: null })}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold flex items-center justify-center gap-2">
          <Plus size={16} />{L('إضافة مورد', 'Add supplier')}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-2">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('أسماء من فواتير شراء سابقة', 'Names from past purchases')}</p>
          <p className="text-[11px] text-slate-500">{L('أضفها كموردين لتتمكن من الشراء الآجل منهم. الفواتير القديمة لا تتغيّر.', 'Add them as suppliers to buy on credit from them. Old invoices do not change.')}</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 12).map((s) => (
              <button key={s.name} type="button" disabled={adding !== null} onClick={() => addSuggested(s.name)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 hover:border-indigo-400 flex items-center gap-1.5 disabled:opacity-50">
                <UserPlus size={13} className="text-indigo-600" />
                {s.name}
                <span className="text-[10px] text-slate-400">({s.purchases})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" size={16} />
        <input className={`${INPUT} ps-9`} placeholder={L('بحث باسم المورد أو الهاتف', 'Search by name or phone')}
          aria-label={L('بحث باسم المورد أو الهاتف', 'Search by name or phone')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-14 text-slate-400">
            <Truck size={40} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{suppliers.length ? L('لا نتائج', 'No matches') : L('لا يوجد موردون بعد', 'No suppliers yet')}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {filtered.map((s) => {
              const owed = owedBalances(s);
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[10rem]">
                    <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                    {s.phone && <div className="text-[11px] text-slate-500 font-mono" dir="ltr">{s.phone}</div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {owed.length === 0
                      ? <span className="text-xs text-slate-400">{L('لا رصيد', 'Settled')}</span>
                      : owed.map((b) => (
                        <span key={b.currency} className="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-xs font-black font-mono" dir="ltr">
                          {formatMoney(b.amount, b.currency)}
                        </span>
                      ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setViewing(s)} title={L('كشف حساب', 'Statement')} aria-label={L('كشف حساب', 'Statement')}
                      className="p-2 rounded-xl text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"><BookOpen size={15} /></button>
                    <button type="button" onClick={() => setPaying(s)} disabled={!owed.some((b) => b.amount > 0)}
                      title={L('دفعة', 'Pay')} aria-label={L('دفعة', 'Pay')}
                      className="p-2 rounded-xl text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-30 disabled:cursor-not-allowed"><Wallet size={15} /></button>
                    <button type="button" onClick={() => setEditing({ supplier: s })} title={L('تعديل', 'Edit')} aria-label={L('تعديل', 'Edit')}
                      className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"><Pencil size={15} /></button>
                    {can('delete_records') && (
                      <button type="button" onClick={() => remove(s)} title={L('حذف', 'Delete')} aria-label={L('حذف', 'Delete')}
                        className="p-2 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"><Trash2 size={15} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <SupplierFormModal isRtl={isRtl} supplier={editing.supplier} initialName={editing.name} defaultCurrency={defaultCurrency} onClose={() => setEditing(null)} />
      )}
      {paying && byId(paying.id) && <PayModal isRtl={isRtl} supplier={byId(paying.id)!} onClose={() => setPaying(null)} />}
      {viewing && byId(viewing.id) && <StatementModal isRtl={isRtl} supplier={byId(viewing.id)!} onClose={() => setViewing(null)} />}
    </div>
  );
}
