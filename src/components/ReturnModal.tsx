import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Undo2, X } from 'lucide-react';
import type { Currency, Invoice } from '../types';
import { useFirebase } from './FirebaseProvider';
import { formatMoney } from '../lib/exchangeRates';
import { isPackLine } from '../lib/packs';
import { roundQty } from '../lib/stock';
import { planSalesReturn, remainingQty, splitRefund, type ReturnLineRequest } from '../lib/salesReturn';
import { planPurchaseReturn, splitPurchaseRefund } from '../lib/purchaseReturn';
import { supplierBalance } from '../lib/suppliers';

interface ReturnModalProps {
  /** A sale (goods come back from the customer) or a purchase (goods go back to the supplier). */
  original: Invoice;
  isRtl: boolean;
  onClose: () => void;
  onSaved: (saved: Invoice) => void;
}

export default function ReturnModal({ original, isRtl, onClose, onSaved }: ReturnModalProps) {
  const { createSalesReturn, createPurchaseReturn, customers, suppliers } = useFirebase();
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const isPurchase = original.type === 'purchase';
  const currency = original.currency as Currency;
  const left = useMemo(() => remainingQty(original), [original]);
  const [quantities, setQuantities] = useState<string[]>(() => original.items.map(() => ''));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const draftIdRef = useRef<string | null>(null);
  useEffect(() => { draftIdRef.current = null; }, [quantities, reason]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const requests: ReturnLineRequest[] = quantities
    .map((value, index) => ({ index, quantity: roundQty(Number(value) || 0) }))
    .filter((r) => r.quantity > 0);
  const planned = requests.length
    ? (isPurchase ? planPurchaseReturn(original, requests) : planSalesReturn(original, requests))
    : null;
  const plan = planned?.plan;
  const owedNow = original.paymentMethod !== 'credit'
    ? 0
    : isPurchase
      ? supplierBalance(suppliers.find((s) => s.id === original.supplierId), currency)
      : Number(customers.find((c) => c.id === original.customerId)?.totalDebt) || 0;
  const refund = plan
    ? (isPurchase ? splitPurchaseRefund(original, plan.figures, owedNow) : splitRefund(original, plan.figures, owedNow))
    : null;

  const lineError = (i: number): string => {
    const q = Number(quantities[i]);
    if (!quantities[i]) return '';
    if (!Number.isFinite(q) || q < 0) return L('كمية غير صالحة', 'Invalid quantity');
    if (roundQty(q) > left[i]) return L(`المتاح للإرجاع ${left[i]} فقط`, `Only ${left[i]} can be returned`);
    return '';
  };
  const hasLineError = original.items.some((_, i) => lineError(i));
  const canSubmit = !!plan && !hasLineError && reason.trim().length > 0 && !saving;

  const setQty = (i: number, value: string) => setQuantities((prev) => prev.map((v, j) => (j === i ? value : v)));
  const returnAll = () => setQuantities(left.map((q) => (q > 0 ? String(q) : '')));

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const input = {
        id: (draftIdRef.current ||= crypto.randomUUID()),
        originalId: original.id,
        lines: requests,
        reason: reason.trim(),
      };
      const saved = await (isPurchase ? createPurchaseReturn(input) : createSalesReturn(input));
      onSaved(saved);
    } catch (e: any) {
      setError(e?.message || L('تعذّر تسجيل المرتجع.', 'Could not record the return.'));
    } finally {
      setSaving(false);
    }
  };

  const money = (v: number, code: string = currency) => formatMoney(v, code);
  const party = isPurchase ? original.supplierName : original.customerName;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm" dir={isRtl ? 'rtl' : 'ltr'} role="dialog" aria-modal="true" aria-labelledby="return-title">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-2xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 id="return-title" className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Undo2 size={18} className="text-rose-600" />
              {isPurchase ? L('مرتجع مشتريات', 'Purchase return') : L('مرتجع مبيعات', 'Sales return')}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {L('عن الفاتورة', 'For invoice')} <span className="font-mono" dir="ltr">#{original.invoiceNumber}</span>
              {party ? ` · ${party}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={L('إغلاق', 'Close')}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('الكميات المرتجعة', 'Quantities returned')}</p>
            <button type="button" onClick={returnAll} className="text-xs font-bold text-indigo-600 hover:underline">
              {L('إرجاع كل المتبقي', 'Return everything left')}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
            {original.items.map((item, i) => {
              const unit = isPackLine(item) ? (item.packName?.trim() || L('عبوة', 'pack')) : '';
              const err = lineError(i);
              return (
                <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[10rem]">
                    <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{item.description}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {isPurchase ? L('المشترى', 'Bought') : L('المباع', 'Sold')} {item.quantity}{unit ? ` ${unit}` : ''}
                      {' · '}
                      {L('المتاح للإرجاع', 'Returnable')} {left[i]}
                      {' · '}
                      <span className="font-mono">{money(Number(item.unitPrice) || 0)}</span>
                    </div>
                    {err && <div className="text-[11px] font-bold text-rose-600 mt-1">{err}</div>}
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={left[i]}
                    step="any"
                    disabled={left[i] <= 0 || saving}
                    value={quantities[i]}
                    onChange={(e) => setQty(i, e.target.value)}
                    placeholder="0"
                    aria-label={L(`الكمية المرتجعة من ${item.description}`, `Quantity returned of ${item.description}`)}
                    className={`w-24 px-3 py-2 rounded-xl border text-center font-mono text-sm bg-slate-50 dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40 ${err ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'}`}
                  />
                </div>
              );
            })}
          </div>

          <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('سبب الإرجاع', 'Reason')}</span>
            <input
              type="text"
              value={reason}
              maxLength={200}
              disabled={saving}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isPurchase
                ? L('مثال: تالف، غير مطابق للطلب، زيادة في التوريد', 'e.g. damaged, not as ordered, over-delivered')
                : L('مثال: تالف، غير مطابق، إلغاء البيع', 'e.g. damaged, wrong item, sale cancelled')}
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {plan && !reason.trim() && (
              <span className="block text-[11px] text-slate-500 mt-1">
                {isPurchase
                  ? L('السبب مطلوب ويظهر على إشعار المدين.', 'Required; it is printed on the debit note.')
                  : L('السبب مطلوب ويظهر على إشعار الدائن.', 'Required; it is printed on the credit note.')}
              </span>
            )}
          </label>

          {plan && refund && (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-slate-500">{L('المجموع الفرعي', 'Subtotal')}</span><span className="font-mono" dir="ltr">{money(plan.figures.subtotal)}</span></div>
              {plan.figures.discount > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">{L('حصة الخصم', 'Discount share')}</span><span className="font-mono" dir="ltr">-{money(plan.figures.discount)}</span></div>
              )}
              {plan.figures.taxAmount > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">{L('الضريبة', 'VAT')}</span><span className="font-mono" dir="ltr">{money(plan.figures.taxAmount)}</span></div>
              )}
              <div className="flex justify-between font-black text-base pt-2 border-t border-slate-200 dark:border-slate-800">
                <span>{L('قيمة المرتجع', 'Return total')}</span><span className="font-mono" dir="ltr">{money(plan.figures.totalAmount)}</span>
              </div>
              <div className="pt-2 space-y-1 text-[13px]">
                {refund.debt > 0 && (
                  <p className="text-slate-700 dark:text-slate-300">
                    {isPurchase ? L('يُخصم من رصيد المورد:', 'Taken off the supplier balance:') : L('يُخصم من دين العميل:', 'Taken off the customer debt:')}{' '}
                    <b className="font-mono" dir="ltr">{money(refund.debt, refund.debtCurrency || currency)}</b>
                  </p>
                )}
                {refund.vault > 0 && (
                  <p className="text-slate-700 dark:text-slate-300">
                    {isPurchase ? L('يردّه المورد نقداً إلى الخزنة:', 'Paid back by the supplier into the vault:') : L('يُردّ نقداً من الخزنة:', 'Refunded in cash from the vault:')}{' '}
                    <b className="font-mono" dir="ltr">{money(refund.vault, refund.vaultCurrency)}</b>
                  </p>
                )}
                {refund.external > 0 && (
                  <p className="text-slate-700 dark:text-slate-300">
                    {isPurchase
                      ? L('يُسوّى مع المورد خارج التطبيق (لم تُسجَّل الفاتورة في الخزنة):', 'Settled with the supplier outside the app (the purchase never hit the vault):')
                      : L('يُردّ للعميل عبر البطاقة/المحفظة خارج التطبيق:', 'Refund to the customer by card/wallet outside the app:')}{' '}
                    <b className="font-mono" dir="ltr">{money(refund.external)}</b>
                  </p>
                )}
                <p className="text-slate-500 text-xs">
                  {isPurchase
                    ? L('تخرج الكميات المرتجعة من المخزون ويُعاد احتساب متوسط التكلفة.', 'The returned quantities leave stock and the average cost is recalculated.')
                    : L('تعود الكميات المرتجعة إلى المخزون.', 'The returned quantities go back into stock.')}
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-sm font-bold text-rose-600" role="alert">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-5 py-2.5 rounded-2xl font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 disabled:opacity-50">
            {L('إلغاء', 'Cancel')}
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit}
            className="px-5 py-2.5 rounded-2xl font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? L('جارٍ التسجيل...', 'Recording...') : L('تسجيل المرتجع', 'Record return')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
