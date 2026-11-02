import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import { CurrencySelect } from './CurrencyPicker';
import type { Currency, OrderLine, Product, TradeOrder } from '../types';
import { formatMoney } from '../lib/exchangeRates';
import { localDayEnd, localDayStart, localIsoDate } from '../lib/localDate';
import DateField from './ui/DateField';
import { orderKindLabel, orderLineTotal, orderTotals } from '../lib/orders';
import { buildOrderPrintHtml } from '../lib/orderDocument';
import { printHtmlDocument } from '../lib/printHtml';
import { isPackLine, productPack } from '../lib/packs';
import { lastPurchases } from '../lib/reorder';
import { matchesQuery } from '../lib/search';
import { findSupplierByName } from '../lib/suppliers';

interface Props {
  isRtl: boolean;
  initial: TradeOrder;
  onClose: () => void;
}

const price4 = (n: number) => Math.round(n * 10_000) / 10_000;

export default function OrderEditor({ isRtl, initial, onClose }: Props) {
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const { products, invoices, suppliers, customers, warehouses, settings, saveOrder } = useFirebase();
  const isQuote = initial.kind === 'quote';
  const [draft, setDraft] = useState<TradeOrder>(initial);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const lastCost = useMemo(() => lastPurchases(invoices), [invoices]);

  const party = (isQuote ? draft.customerName : draft.supplierName) || '';
  const setParty = (name: string) => {
    if (isQuote) {
      const matches = customers.filter((c) => c.name.trim() === name.trim());
      setDraft((d) => ({ ...d, customerName: name, customerId: matches.length === 1 ? matches[0].id : undefined }));
    } else {
      setDraft((d) => ({ ...d, supplierName: name, supplierId: findSupplierByName(suppliers, name)?.id }));
    }
  };

  const warehouseName = (id?: string) => warehouses.find((w) => w.id === id)?.name;

  /** Prices are offered only in the currency they were set in; anything else starts at 0 for the user to fill. */
  const unitPriceFor = (p: Product, asPack: boolean): number => {
    const pack = asPack ? productPack(p) : null;
    if (isQuote) {
      if ((p.currency || settings?.currency) !== draft.currency) return 0;
      return pack ? pack.price : Number(p.sellingPrice) || 0;
    }
    const lp = lastCost.get(p.id);
    const unit = lp && lp.unitCost > 0 && lp.currency === draft.currency
      ? lp.unitCost
      : (p.currency || settings?.currency) === draft.currency ? Number(p.unitCost) || 0 : 0;
    return price4(unit * (pack ? pack.size : 1));
  };

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    return products.filter((p) => p.type !== 'asset' && matchesQuery([p.name, p.sku, p.packBarcode, p.brand], query)).slice(0, 8);
  }, [products, query]);

  const addProduct = (p: Product) => {
    setDraft((d) => {
      const at = d.items.findIndex((l) => l.productId === p.id && !isPackLine(l));
      if (at >= 0) {
        const items = [...d.items];
        items[at] = { ...items[at], quantity: (Number(items[at].quantity) || 0) + 1 };
        return { ...d, items };
      }
      return { ...d, items: [...d.items, { productId: p.id, description: p.name, sku: p.sku || undefined, quantity: 1, unitPrice: unitPriceFor(p, false) }] };
    });
    setQuery('');
  };

  const updateLine = (i: number, patch: Partial<OrderLine>) =>
    setDraft((d) => ({ ...d, items: d.items.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const togglePack = (i: number) => {
    const line = draft.items[i];
    const p = products.find((x) => x.id === line.productId);
    const pack = p ? productPack(p) : null;
    if (!p || !pack) return;
    const toPack = !isPackLine(line);
    updateLine(i, {
      packSize: toPack ? pack.size : undefined,
      packName: toPack ? pack.name || undefined : undefined,
      unitPrice: unitPriceFor(p, toPack),
    });
  };

  const totals = orderTotals(draft);
  const money = (n: number) => formatMoney(n, draft.currency);

  const save = async (print: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveOrder(draft);
      toast.success(L(`حُفظ ${orderKindLabel(draft.kind, true)} ${draft.number}`, `${orderKindLabel(draft.kind, false)} ${draft.number} saved`));
      if (print) printHtmlDocument(buildOrderPrintHtml(draft, settings, products, isRtl), draft.number);
      onClose();
    } catch (err: any) {
      if (!err?.notified) toast.error(err?.message || L('تعذّر حفظ الطلب.', 'Could not save the order.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const input = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm dark:text-white focus:outline-none focus:border-indigo-500';
  const label = 'block text-xs font-bold text-slate-500 mb-1';
  const dateField = isQuote ? draft.validUntil : draft.expectedDate;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm" dir={isRtl ? 'rtl' : 'ltr'} role="dialog" aria-modal="true" aria-labelledby="order-title">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-3xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 id="order-title" className="font-black text-lg text-slate-900 dark:text-white">{orderKindLabel(draft.kind, isRtl)}</h2>
            <p className="text-xs font-mono text-slate-500" dir="ltr">{draft.number}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={L('إغلاق', 'Close')}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={label} htmlFor="order-party">{isQuote ? L('العميل', 'Customer') : L('المورد', 'Supplier')}</label>
              <input id="order-party" list="order-party-list" className={input} value={party} onChange={(e) => setParty(e.target.value)}
                placeholder={isQuote ? L('اسم العميل أو الشركة', 'Customer or company name') : L('اختر مورداً مسجلاً أو اكتب الاسم', 'Pick a registered supplier or type a name')} />
              <datalist id="order-party-list">
                {(isQuote ? customers.map((c) => c.name) : suppliers.map((s) => s.name)).map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div>
              <label className={label} htmlFor="order-date">{L('التاريخ', 'Date')}</label>
              <DateField
                id="order-date"
                className={input}
                value={localIsoDate(draft.date)}
                onChange={(iso) => {
                  const t = localDayStart(iso);
                  if (t !== null) setDraft((d) => ({ ...d, date: t }));
                }}
                aria-label={L('التاريخ', 'Date')}
              />
            </div>
            <div>
              <label className={label} htmlFor="order-until">{isQuote ? L('صالح حتى', 'Valid until') : L('موعد التسليم المطلوب', 'Requested delivery')}</label>
              <DateField
                id="order-until"
                className={input}
                value={dateField ? localIsoDate(dateField) : ''}
                onChange={(iso) => {
                  const t = iso ? (isQuote ? localDayEnd(iso) : localDayStart(iso)) : null;
                  setDraft((d) => (isQuote ? { ...d, validUntil: t ?? undefined } : { ...d, expectedDate: t ?? undefined }));
                }}
                aria-label={isQuote ? L('صالح حتى', 'Valid until') : L('موعد التسليم المطلوب', 'Requested delivery')}
              />
            </div>
            <div>
              <label className={label} htmlFor="order-currency">{L('العملة', 'Currency')}</label>
              <CurrencySelect id="order-currency" value={draft.currency} isRtl={isRtl} className={input}
                disabled={draft.items.length > 0}
                onChange={(c) => setDraft((d) => ({ ...d, currency: c as Currency }))} />
              {draft.items.length > 0 && <p className="text-[11px] text-slate-500 mt-1">{L('احذف الأصناف لتغيير العملة؛ الأسعار لا تُحوَّل تلقائياً.', 'Remove the items to change the currency; prices are not converted.')}</p>}
            </div>
            <div>
              <label className={label} htmlFor="order-vat">{L('نسبة الضريبة %', 'VAT %')}</label>
              <input id="order-vat" type="number" min={0} max={100} step="0.01" className={input} value={draft.vatRate}
                onChange={(e) => setDraft((d) => ({ ...d, vatRate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Search size={16} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
              <input className={`${input} ${isRtl ? 'pr-9' : 'pl-9'}`} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={L('ابحث عن صنف بالاسم أو الباركود لإضافته', 'Search an item by name or barcode to add it')}
                aria-label={L('إضافة صنف', 'Add item')} />
              {matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl max-h-64 overflow-y-auto">
                  {matches.map((p) => (
                    <button key={p.id} type="button" onClick={() => addProduct(p)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-slate-50 dark:hover:bg-slate-800 text-sm">
                      <span>
                        <span className="font-bold text-slate-900 dark:text-white">{p.name}</span>
                        <span className="block text-[11px] text-slate-500">{[p.sku, warehouseName(p.warehouseId)].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="text-xs text-slate-500 whitespace-nowrap">{L('المتوفر', 'On hand')}: {p.quantity}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {draft.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
                <Package size={22} className="mx-auto mb-2 text-slate-400" />
                {L('لم تُضف أصناف بعد.', 'No items yet.')}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {draft.items.map((line, i) => {
                  const p = products.find((x) => x.id === line.productId);
                  const pack = p ? productPack(p) : null;
                  return (
                    <div key={`${line.productId}-${i}`} className="p-3 grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-12 sm:col-span-5">
                        <div className="font-bold text-sm text-slate-900 dark:text-white">{line.description}</div>
                        <div className="text-[11px] text-slate-500">
                          {!p ? L('الصنف لم يعد موجوداً', 'Item no longer exists') : [line.sku, warehouseName(p.warehouseId)].filter(Boolean).join(' · ')}
                        </div>
                        {pack && (
                          <button type="button" onClick={() => togglePack(i)} className="mt-1 text-[11px] font-bold text-indigo-600 hover:underline">
                            {isPackLine(line)
                              ? L(`بالعبوة (${pack.size}) — التبديل للوحدة`, `By pack (${pack.size}) — switch to unit`)
                              : L(`بالوحدة — التبديل للعبوة (${pack.size})`, `By unit — switch to pack (${pack.size})`)}
                          </button>
                        )}
                      </div>
                      <label className="col-span-4 sm:col-span-2">
                        <span className="sr-only">{L('الكمية', 'Quantity')}</span>
                        <input type="number" min={0} step="any" className={input} value={line.quantity}
                          onChange={(e) => updateLine(i, { quantity: Math.max(0, Number(e.target.value) || 0) })} />
                      </label>
                      <label className="col-span-4 sm:col-span-2">
                        <span className="sr-only">{L('السعر', 'Price')}</span>
                        <input type="number" min={0} step="any" className={input} value={line.unitPrice}
                          onChange={(e) => updateLine(i, { unitPrice: Math.max(0, Number(e.target.value) || 0) })} />
                      </label>
                      <div className="col-span-3 sm:col-span-2 text-sm font-bold text-end font-mono" dir="ltr">{money(orderLineTotal(line, draft.currency))}</div>
                      <button type="button" onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}
                        className="col-span-1 p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg justify-self-end" aria-label={L('حذف السطر', 'Remove line')}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className={label} htmlFor="order-notes">{L('ملاحظات تظهر في المطبوع', 'Notes shown on the printout')}</label>
            <textarea id="order-notes" rows={2} className={input} value={draft.notes || ''} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          </div>

          <div className="ms-auto w-full sm:w-72 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">{L('المجموع', 'Subtotal')}</span><span className="font-mono" dir="ltr">{money(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{L('الضريبة', 'VAT')} ({draft.vatRate}%)</span><span className="font-mono" dir="ltr">{money(totals.taxAmount)}</span></div>
            <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 font-black text-base"><span>{L('الإجمالي', 'Total')}</span><span className="font-mono" dir="ltr">{money(totals.total)}</span></div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end px-5 py-4 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            {L('إلغاء', 'Cancel')}
          </button>
          <button type="button" disabled={saving} onClick={() => save(true)} className="px-4 py-2.5 rounded-xl text-sm font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 inline-flex items-center gap-2 disabled:opacity-50">
            <Printer size={16} /> {L('حفظ وطباعة', 'Save and print')}
          </button>
          <button type="button" disabled={saving} onClick={() => save(false)} className="px-5 py-2.5 rounded-xl text-sm font-black bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-2 disabled:opacity-50">
            <Plus size={16} /> {saving ? L('جارٍ الحفظ...', 'Saving...') : L('حفظ', 'Save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
