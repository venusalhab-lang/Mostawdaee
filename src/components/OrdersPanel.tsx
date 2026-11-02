import { useMemo, useState } from 'react';
import { ArrowLeftRight, Ban, FileText, Pencil, Plus, Printer, Search, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import OrderEditor from './OrderEditor';
import type { Currency, OrderKind, TradeOrder } from '../types';
import { formatMoney } from '../lib/exchangeRates';
import { localDayEnd, localIsoDate } from '../lib/localDate';
import { resolveVatRate } from '../lib/invoiceTotals';
import { isExpiredQuote, isOpenOrder, nextOrderNumber, orderKindLabel, orderStatusLabel, orderTotals } from '../lib/orders';
import { buildOrderPrintHtml } from '../lib/orderDocument';
import { printHtmlDocument } from '../lib/printHtml';
import { matchesQuery } from '../lib/search';

interface Props {
  kind: OrderKind;
  isRtl: boolean;
  defaultCurrency: Currency;
  /** Opens the purchase or sale form filled from this order. */
  onConvert: (order: TradeOrder) => void;
}

type Filter = 'open' | 'converted' | 'cancelled' | 'all';
const DAY_MS = 24 * 60 * 60 * 1000;

export function newOrder(kind: OrderKind, orders: TradeOrder[], currency: Currency, vatRate: number, now = Date.now()): TradeOrder {
  return {
    id: crypto.randomUUID(),
    kind,
    number: nextOrderNumber(orders, kind),
    date: now,
    ...(kind === 'quote' ? { validUntil: localDayEnd(localIsoDate(now + 14 * DAY_MS)) ?? undefined } : {}),
    currency,
    vatRate,
    items: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  sent: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  converted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  cancelled: 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300',
  expired: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

export default function OrdersPanel({ kind, isRtl, defaultCurrency, onConvert }: Props) {
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const { orders, products, settings, saveOrder, deleteOrder, can } = useFirebase();
  const canWrite = can('back_office');
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<TradeOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const isQuote = kind === 'quote';
  const now = Date.now();

  const list = useMemo(() => orders.filter((o) => {
    if (o.kind !== kind) return false;
    if (filter === 'open' && !isOpenOrder(o)) return false;
    if (filter === 'converted' && o.status !== 'converted') return false;
    if (filter === 'cancelled' && o.status !== 'cancelled') return false;
    return matchesQuery([o.number, o.supplierName, o.customerName, o.invoiceNumber, ...o.items.map((l) => l.description)], query);
  }), [orders, kind, filter, query]);

  const setStatus = async (order: TradeOrder, status: TradeOrder['status']) => {
    setBusyId(order.id);
    try {
      await saveOrder({ ...order, status });
    } catch (err: any) {
      if (!err?.notified) toast.error(err?.message || L('تعذّر تحديث الطلب.', 'Could not update the order.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (order: TradeOrder) => {
    if (!confirm(L(`حذف ${orderKindLabel(order.kind, true)} ${order.number}؟ لا يؤثر ذلك على المخزون أو الخزنة.`, `Delete ${orderKindLabel(order.kind, false)} ${order.number}? Stock and the vault are not affected.`))) return;
    setBusyId(order.id);
    try {
      await deleteOrder(order.id);
    } catch (err: any) {
      if (!err?.notified) toast.error(err?.message || L('تعذّر حذف الطلب.', 'Could not delete the order.'));
    } finally {
      setBusyId(null);
    }
  };

  const print = (order: TradeOrder) => printHtmlDocument(buildOrderPrintHtml(order, settings, products, isRtl), order.number);

  const filters: { id: Filter; label: string }[] = [
    { id: 'open', label: L('المفتوحة', 'Open') },
    { id: 'converted', label: isQuote ? L('تحوّلت لفواتير', 'Invoiced') : L('المستلمة', 'Received') },
    { id: 'cancelled', label: L('الملغاة', 'Cancelled') },
    { id: 'all', label: L('الكل', 'All') },
  ];

  const iconBtn = 'p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40';

  return (
    <div className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="flex gap-1.5 overflow-x-auto">
          {filters.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${filter === f.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-60">
            <Search size={15} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L('بحث بالرقم أو الاسم أو الصنف', 'Search number, name or item')}
              aria-label={L('بحث', 'Search')}
              className={`w-full py-2.5 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'}`} />
          </div>
          {canWrite && (
            <button type="button" onClick={() => setEditing(newOrder(kind, orders, defaultCurrency, resolveVatRate(settings?.defaultVatRate)))}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black inline-flex items-center gap-2 whitespace-nowrap">
              <Plus size={16} /> {isQuote ? L('عرض سعر جديد', 'New quotation') : L('أمر شراء جديد', 'New purchase order')}
            </button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center text-sm text-slate-500">
          <FileText size={24} className="mx-auto mb-2 text-slate-400" />
          {filter === 'open'
            ? (isQuote ? L('لا توجد عروض أسعار مفتوحة.', 'No open quotations.') : L('لا توجد أوامر شراء مفتوحة.', 'No open purchase orders.'))
            : L('لا شيء هنا.', 'Nothing here.')}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((o) => {
            const totals = orderTotals(o);
            const expired = isExpiredQuote(o, now);
            const tone = STATUS_TONE[expired ? 'expired' : o.status];
            const open = isOpenOrder(o);
            const busy = busyId === o.id;
            return (
              <div key={o.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-black text-slate-900 dark:text-white" dir="ltr">{o.number}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${tone}`}>{orderStatusLabel(o, isRtl, now)}</span>
                    {o.status === 'converted' && o.invoiceNumber && (
                      <span className="text-[11px] text-slate-500">{L('الفاتورة', 'Invoice')} <b dir="ltr">#{o.invoiceNumber}</b></span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate mt-0.5">{(isQuote ? o.customerName : o.supplierName) || '—'}</div>
                  <div className="text-[11px] text-slate-500">
                    {new Date(o.date).toLocaleDateString(isRtl ? 'ar' : 'en')} · {L(`${o.items.length} صنف`, `${o.items.length} items`)}
                    {isQuote && o.validUntil ? ` · ${L('صالح حتى', 'valid until')} ${new Date(o.validUntil).toLocaleDateString(isRtl ? 'ar' : 'en')}` : ''}
                    {!isQuote && o.expectedDate ? ` · ${L('التسليم', 'delivery')} ${new Date(o.expectedDate).toLocaleDateString(isRtl ? 'ar' : 'en')}` : ''}
                  </div>
                </div>
                <div className="font-black font-mono text-slate-900 dark:text-white" dir="ltr">{formatMoney(totals.total, o.currency)}</div>
                <div className="flex items-center gap-1 flex-wrap">
                  {canWrite && open && (
                    <button type="button" disabled={busy} onClick={() => onConvert(o)}
                      className="px-3 py-2 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50">
                      <ArrowLeftRight size={14} /> {isQuote ? L('تحويل لفاتورة بيع', 'Turn into a sale') : L('استلام كفاتورة شراء', 'Receive as purchase')}
                    </button>
                  )}
                  <button type="button" className={iconBtn} onClick={() => print(o)} title={L('طباعة', 'Print')} aria-label={L('طباعة', 'Print')}><Printer size={16} /></button>
                  {canWrite && open && (
                    <>
                      <button type="button" className={iconBtn} disabled={busy} onClick={() => setEditing(o)} title={L('تعديل', 'Edit')} aria-label={L('تعديل', 'Edit')}><Pencil size={16} /></button>
                      {o.status === 'draft' && (
                        <button type="button" className={iconBtn} disabled={busy} onClick={() => setStatus(o, 'sent')} title={L('تعليم كمُرسل', 'Mark as sent')} aria-label={L('تعليم كمُرسل', 'Mark as sent')}><Send size={16} /></button>
                      )}
                      <button type="button" className={iconBtn} disabled={busy} onClick={() => setStatus(o, 'cancelled')} title={L('إلغاء الطلب', 'Cancel order')} aria-label={L('إلغاء الطلب', 'Cancel order')}><Ban size={16} /></button>
                    </>
                  )}
                  {canWrite && o.status !== 'converted' && (
                    <button type="button" className={`${iconBtn} hover:text-rose-600`} disabled={busy} onClick={() => remove(o)} title={L('حذف', 'Delete')} aria-label={L('حذف', 'Delete')}><Trash2 size={16} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <OrderEditor isRtl={isRtl} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
