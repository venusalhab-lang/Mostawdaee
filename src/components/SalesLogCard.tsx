import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Invoice } from '../types';
import { formatMoney } from '../lib/exchangeRates';
import { periodWindow, type HomeRange } from '../lib/homeDesk';
import { paymentMethodLabel } from '../lib/invoiceDocument';
import { lineQuantityText } from '../lib/packs';
import { saleLogRows, sellerName, sellerSummaries, type SellerContext } from '../lib/salesLog';
import { requestScreenSearch } from '../lib/screenSearch';

const PAGE = 20;
const ITEMS_IN_SUMMARY = 3;

interface Props {
  invoices: Invoice[];
  range: HomeRange;
  now: number;
  isRtl: boolean;
  storeCurrency: string;
  sellers: SellerContext;
}

function openInvoice(invoice: Invoice) {
  requestScreenSearch({ screen: 'invoices', query: invoice.invoiceNumber, recordId: invoice.id });
  window.dispatchEvent(new CustomEvent('change-screen', { detail: 'invoices' }));
}

export default function SalesLogCard({ invoices, range, now, isRtl, storeCurrency, sellers }: Props) {
  const [sellerKey, setSellerKey] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const locale = isRtl ? 'ar' : 'en-US';
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);

  const { start, end } = periodWindow(range, now);
  const rows = useMemo(() => saleLogRows(invoices, start, end, sellers), [invoices, start, end, sellers]);
  const summaries = useMemo(() => sellerSummaries(rows, storeCurrency), [rows, storeCurrency]);
  const activeKey = summaries.some((summary) => summary.seller.key === sellerKey) ? sellerKey : 'all';
  const visible = activeKey === 'all' ? rows : rows.filter((row) => row.seller.key === activeKey);

  const title = range === 'day'
    ? (isRtl ? 'سجل مبيعات اليوم' : "Today's sales log")
    : range === 'week'
      ? (isRtl ? 'سجل مبيعات هذا الأسبوع' : 'Sales log, this week')
      : (isRtl ? 'سجل مبيعات هذا الشهر' : 'Sales log, this month');

  const when = (ts: number) => new Date(ts).toLocaleString(locale, range === 'day'
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const chip = (selected: boolean) => `shrink-0 rounded-2xl border px-3 py-2 text-start ${
    selected
      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-500/10'
      : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
  }`;

  return (
    <section
      className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5"
      aria-label={title}
    >
      <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-3">
        <span>{title}</span>
        <span>{isRtl ? `${rows.length} عملية بيع` : `${rows.length} sales`}</span>
      </div>

      {summaries.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1" role="group" aria-label={isRtl ? 'تصفية حسب البائع' : 'Filter by seller'}>
          <button type="button" aria-pressed={activeKey === 'all'} onClick={() => { setSellerKey('all'); setShown(PAGE); }} className={chip(activeKey === 'all')}>
            <div className="text-sm font-bold">{isRtl ? 'الكل' : 'All'}</div>
            <div className="text-xs text-slate-400">{rows.length}</div>
          </button>
          {summaries.map((summary) => (
            <button
              key={summary.seller.key}
              type="button"
              aria-pressed={activeKey === summary.seller.key}
              onClick={() => { setSellerKey(summary.seller.key); setShown(PAGE); }}
              className={chip(activeKey === summary.seller.key)}
            >
              <div className="text-sm font-bold max-w-[14rem] truncate" dir="auto">{sellerName(summary.seller, isRtl)}</div>
              <div className="text-xs text-slate-400 font-mono">
                {summary.count}
                {' · '}
                {summary.totals.map((total) => money(total.amount, total.currency)).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">{isRtl ? 'لا مبيعات في هذه المدة.' : 'No sales in this period.'}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {visible.slice(0, shown).map(({ invoice, seller }) => {
            const open = openId === invoice.id;
            const items = invoice.items || [];
            const summary = items
              .slice(0, ITEMS_IN_SUMMARY)
              .map((item) => `${item.description} × ${lineQuantityText(item, isRtl)}`)
              .join(isRtl ? '، ' : ', ');
            const more = items.length - ITEMS_IN_SUMMARY;
            const pending = sellers.pendingIds.has(invoice.id);
            const Chevron = open ? ChevronUp : ChevronDown;
            return (
              <li key={invoice.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : invoice.id)}
                  className="w-full py-2.5 flex items-start gap-3 text-start hover:bg-slate-50 dark:hover:bg-white/5 rounded-xl -mx-2 px-2"
                >
                  <span className="w-16 shrink-0 text-sm font-black font-mono text-slate-700 dark:text-slate-200">{when(Number(invoice.date))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold truncate" dir="auto">
                      {summary || (isRtl ? 'بلا أصناف' : 'No items')}
                      {more > 0 && <span className="text-slate-400">{isRtl ? ` و${more} أخرى` : ` +${more} more`}</span>}
                    </span>
                    <span className="block text-xs text-slate-400 truncate">
                      <span dir="auto">{sellerName(seller, isRtl)}</span>
                      {' · '}
                      {paymentMethodLabel(invoice.paymentMethod, isRtl)}
                      {invoice.customerName ? ` · ${invoice.customerName}` : ''}
                      {pending && (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          {isRtl ? ' · لم تُرسل بعد' : ' · Not sent yet'}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm font-bold">{money(Number(invoice.totalAmount) || 0, invoice.currency || storeCurrency)}</span>
                  <Chevron size={16} className="mt-0.5 shrink-0 text-slate-300" aria-hidden="true" />
                </button>

                {open && (
                  <div className="mb-3 rounded-2xl bg-slate-50 dark:bg-white/5 p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 mb-2">
                      <span className="font-mono" dir="ltr">#{invoice.invoiceNumber}</span>
                      <span>
                        {new Date(Number(invoice.date)).toLocaleString(locale, {
                          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </span>
                    </div>
                    <table className="w-full text-start">
                      <thead>
                        <tr className="text-xs text-slate-400">
                          <th className="py-1 text-start font-bold">{isRtl ? 'المنتج' : 'Product'}</th>
                          <th className="py-1 text-start font-bold">{isRtl ? 'الكمية' : 'Qty'}</th>
                          <th className="py-1 text-start font-bold">{isRtl ? 'سعر البيع' : 'Price'}</th>
                          <th className="py-1 text-end font-bold">{isRtl ? 'المجموع' : 'Total'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, index) => (
                          <tr key={`${item.productId}-${index}`} className="border-t border-slate-200/70 dark:border-white/5">
                            <td className="py-1.5 font-bold" dir="auto">{item.description}</td>
                            <td className="py-1.5 font-mono">{lineQuantityText(item, isRtl)}</td>
                            <td className="py-1.5 font-mono">{money(Number(item.unitPrice) || 0, invoice.currency || storeCurrency)}</td>
                            <td className="py-1.5 font-mono text-end">{money(Number(item.total) || 0, invoice.currency || storeCurrency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                      {(Number(invoice.discount) || 0) > 0 && (
                        <div>{isRtl ? 'خصم: ' : 'Discount: '}<span className="font-mono">{money(Number(invoice.discount), invoice.currency || storeCurrency)}</span></div>
                      )}
                      {(Number(invoice.taxAmount) || 0) > 0 && (
                        <div>{isRtl ? 'الضريبة: ' : 'Tax: '}<span className="font-mono">{money(Number(invoice.taxAmount), invoice.currency || storeCurrency)}</span></div>
                      )}
                      <div>
                        {isRtl ? 'البائع: ' : 'Seller: '}
                        <span dir="auto" className="font-bold text-slate-700 dark:text-slate-200">{sellerName(seller, isRtl)}</span>
                        {seller.kind === 'you' && seller.email ? <span dir="ltr"> ({seller.email})</span> : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openInvoice(invoice)}
                      className="mt-3 px-3 py-1.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-black"
                    >
                      {isRtl ? 'فتح الفاتورة' : 'Open invoice'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {visible.length > shown && (
        <button
          type="button"
          onClick={() => setShown((count) => count + PAGE)}
          className="mt-3 w-full py-2 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-bold text-slate-600 dark:text-slate-300"
        >
          {isRtl ? `عرض المزيد (${visible.length - shown})` : `Show more (${visible.length - shown})`}
        </button>
      )}

      {rows.some((row) => row.seller.kind === 'unknown') && (
        <p className="mt-3 text-xs text-slate-400">
          {isRtl
            ? '«غير مسجّل»: مبيعات حُفظت قبل أن يسجّل النظام اسم البائع.'
            : '"Not recorded": sales saved before the seller was recorded.'}
        </p>
      )}
    </section>
  );
}
