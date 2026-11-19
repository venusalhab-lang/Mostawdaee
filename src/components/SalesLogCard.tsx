import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Printer } from 'lucide-react';
import type { Invoice } from '../types';
import { formatMoney } from '../lib/exchangeRates';
import { periodWindow, type HomeRange } from '../lib/homeDesk';
import { invoicePaymentLabel, invoiceOwed, invoicePaidNow, isSplitTender } from '../lib/invoiceList';
import { lineQuantityText } from '../lib/packs';
import {
  buildSaleLinesPrintHtml,
  saleLineRows,
  saleLinesToCsv,
  saleLogRows,
  sellerName,
  sellerSummaries,
  type SellerContext,
} from '../lib/salesLog';
import { downloadCsv } from '../lib/csv';
import { localDayEnd, localDayStart, localIsoDate } from '../lib/localDate';
import { printHtmlDocument } from '../lib/printHtml';
import { requestScreenSearch } from '../lib/screenSearch';
import DateField from './ui/DateField';
import { toast } from 'sonner';

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
  const [viewMode, setViewMode] = useState<'invoices' | 'lines'>('invoices');
  const [customRange, setCustomRange] = useState(false);
  const [fromDate, setFromDate] = useState(() => localIsoDate(now));
  const [toDate, setToDate] = useState(() => localIsoDate(now));
  const locale = isRtl ? 'ar' : 'en-US';
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);

  const period = periodWindow(range, now);
  const customStart = customRange ? localDayStart(fromDate) : null;
  const customEnd = customRange ? localDayEnd(toDate) : null;
  // Guard inverted typed ranges so the filter never silently returns nothing for that reason alone.
  const start = customRange && customStart != null && customEnd != null
    ? Math.min(customStart, customEnd)
    : period.start;
  const end = customRange && customStart != null && customEnd != null
    ? Math.max(customStart, customEnd)
    : period.end;

  const rows = useMemo(() => saleLogRows(invoices, start, end, sellers), [invoices, start, end, sellers]);
  const summaries = useMemo(() => sellerSummaries(rows, storeCurrency), [rows, storeCurrency]);
  const activeKey = summaries.some((summary) => summary.seller.key === sellerKey) ? sellerKey : 'all';
  const visible = activeKey === 'all' ? rows : rows.filter((row) => row.seller.key === activeKey);
  const lineRows = useMemo(() => saleLineRows(visible, storeCurrency), [visible, storeCurrency]);

  const title = customRange
    ? (isRtl ? 'سجل مبيعات مخصص' : 'Custom sales log')
    : range === 'day'
      ? (isRtl ? 'سجل مبيعات اليوم' : "Today's sales log")
      : range === 'week'
        ? (isRtl ? 'سجل مبيعات هذا الأسبوع' : 'Sales log, this week')
        : (isRtl ? 'سجل مبيعات هذا الشهر' : 'Sales log, this month');

  const when = (ts: number) => new Date(ts).toLocaleString(locale, customRange || range !== 'day'
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });

  const whenExact = (ts: number) => new Date(ts).toLocaleString(locale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const chip = (selected: boolean) => `shrink-0 rounded-2xl border px-3 py-2 text-start ${
    selected
      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-500/10'
      : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
  }`;

  const exportLines = () => {
    if (!lineRows.length) {
      toast.error(isRtl ? 'لا بنود لتصديرها في هذا الفلتر.' : 'No line items to export for this filter.');
      return;
    }
    downloadCsv(saleLinesToCsv(lineRows, isRtl), isRtl ? 'مبيعات-الموظفين.csv' : 'cashier-sales-lines.csv');
    toast.success(isRtl ? 'تم تنزيل ملف CSV.' : 'CSV downloaded.');
  };

  const printLines = () => {
    if (!lineRows.length) {
      toast.error(isRtl ? 'لا بنود لطباعتها في هذا الفلتر.' : 'No line items to print for this filter.');
      return;
    }
    const html = buildSaleLinesPrintHtml({
      title: isRtl ? 'تقرير مبيعات الموظفين (بنود)' : 'Cashier sales report (line items)',
      lines: lineRows,
      isRtl,
      formatMoney: money,
      formatWhen: whenExact,
    });
    printHtmlDocument(html, isRtl ? 'مبيعات-الموظفين' : 'cashier-sales');
  };

  return (
    <section
      className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5"
      aria-label={title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-400 mb-3">
        <span>{title}</span>
        <span>
          {viewMode === 'lines'
            ? (isRtl ? `${lineRows.length} بند` : `${lineRows.length} lines`)
            : (isRtl ? `${rows.length} عملية بيع` : `${rows.length} sales`)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden text-[11px] font-bold" role="group">
          <button
            type="button"
            aria-pressed={viewMode === 'invoices'}
            onClick={() => { setViewMode('invoices'); setShown(PAGE); }}
            className={`px-3 py-1.5 ${viewMode === 'invoices' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5'}`}
          >
            {isRtl ? 'فواتير' : 'Invoices'}
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'lines'}
            onClick={() => { setViewMode('lines'); setShown(PAGE); }}
            className={`px-3 py-1.5 ${viewMode === 'lines' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5'}`}
          >
            {isRtl ? 'بنود الأصناف' : 'Line items'}
          </button>
        </div>

        <button
          type="button"
          aria-pressed={customRange}
          onClick={() => {
            setCustomRange((on) => !on);
            setShown(PAGE);
          }}
          className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border ${
            customRange
              ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
              : 'border-slate-200 dark:border-white/10 text-slate-500'
          }`}
        >
          {isRtl ? 'تاريخ مخصص' : 'Custom dates'}
        </button>

        <button
          type="button"
          onClick={exportLines}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"
        >
          <Download size={12} /> {isRtl ? 'CSV' : 'CSV'}
        </button>
        <button
          type="button"
          onClick={printLines}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"
        >
          <Printer size={12} /> {isRtl ? 'طباعة' : 'Print'}
        </button>
      </div>

      {customRange && (
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase">{isRtl ? 'من' : 'From'}</label>
            <DateField
              compact
              value={fromDate}
              onChange={(iso) => { setFromDate(iso); setShown(PAGE); }}
              max={toDate}
              aria-label={isRtl ? 'من تاريخ' : 'From date'}
              className="w-40 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase">{isRtl ? 'إلى' : 'To'}</label>
            <DateField
              compact
              value={toDate}
              onChange={(iso) => { setToDate(iso); setShown(PAGE); }}
              min={fromDate}
              aria-label={isRtl ? 'إلى تاريخ' : 'To date'}
              className="w-40 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs"
            />
          </div>
        </div>
      )}

      {(summaries.length > 1 || activeKey !== 'all') && (
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

      {viewMode === 'lines' ? (
        lineRows.length === 0 ? (
          <p className="text-sm text-slate-500">{isRtl ? 'لا بنود في هذه المدة.' : 'No line items in this period.'}</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-100 dark:border-white/10">
                  <th className="py-2 text-start font-bold">{isRtl ? 'الوقت' : 'When'}</th>
                  <th className="py-2 text-start font-bold">{isRtl ? 'البائع' : 'Seller'}</th>
                  <th className="py-2 text-start font-bold">{isRtl ? 'الصنف' : 'Item'}</th>
                  <th className="py-2 text-start font-bold">{isRtl ? 'الكمية' : 'Qty'}</th>
                  <th className="py-2 text-start font-bold">{isRtl ? 'السعر' : 'Price'}</th>
                  <th className="py-2 text-end font-bold">{isRtl ? 'الإجمالي' : 'Total'}</th>
                  <th className="py-2 text-start font-bold">{isRtl ? 'الفاتورة' : 'Invoice'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {lineRows.slice(0, shown).map((line, index) => (
                  <tr key={`${line.invoiceId}-${index}`}>
                    <td className="py-2 font-mono text-xs whitespace-nowrap">{whenExact(line.date)}</td>
                    <td className="py-2 font-bold text-xs" dir="auto">{sellerName(line.seller, isRtl)}</td>
                    <td className="py-2 font-bold" dir="auto">{line.description}</td>
                    <td className="py-2 font-mono">{lineQuantityText(line.item, isRtl)}</td>
                    <td className="py-2 font-mono">{money(line.unitPrice, line.currency)}</td>
                    <td className="py-2 font-mono text-end font-bold">{money(line.lineTotal, line.currency)}</td>
                    <td className="py-2 font-mono text-xs" dir="ltr">#{line.invoiceNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : visible.length === 0 ? (
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
                      {invoicePaymentLabel(invoice, isRtl)}
                      {isSplitTender(invoice)
                        ? ` · ${money(invoicePaidNow(invoice), invoice.currency || storeCurrency)} / ${money(Number(invoice.debtAmount) || invoiceOwed(invoice), invoice.debtCurrency || invoice.currency || storeCurrency)}`
                        : ''}
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
                      <span>{whenExact(Number(invoice.date))}</span>
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

      {(viewMode === 'lines' ? lineRows.length : visible.length) > shown && (
        <button
          type="button"
          onClick={() => setShown((count) => count + PAGE)}
          className="mt-3 w-full py-2 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-bold text-slate-600 dark:text-slate-300"
        >
          {isRtl
            ? `عرض المزيد (${(viewMode === 'lines' ? lineRows.length : visible.length) - shown})`
            : `Show more (${(viewMode === 'lines' ? lineRows.length : visible.length) - shown})`}
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
