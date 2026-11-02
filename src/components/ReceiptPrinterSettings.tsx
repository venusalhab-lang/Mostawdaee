import { useState } from 'react';
import { Bluetooth, Printer, RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import type { Language } from '../types';
import { buildTestPageHtml, type PaperWidth } from '../lib/receipt';
import {
  bluetoothPrintingAvailable,
  listPairedPrinters,
  printReceipt,
  printerErrorMessage,
  readReceiptPrinter,
  saveReceiptPrinter,
  type PairedPrinter,
  type ReceiptPrinterPrefs,
} from '../lib/receiptPrinter';

export default function ReceiptPrinterSettings({ language }: { language: Language }) {
  const isRtl = language === 'ar';
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const native = bluetoothPrintingAvailable();
  const [prefs, setPrefs] = useState<ReceiptPrinterPrefs>(readReceiptPrinter);
  const [devices, setDevices] = useState<PairedPrinter[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const update = (next: ReceiptPrinterPrefs) => {
    setPrefs(next);
    saveReceiptPrinter(next);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      setDevices(await listPairedPrinters());
    } catch (err) {
      toast.error(printerErrorMessage(err, isRtl));
    } finally {
      setLoading(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const via = await printReceipt(buildTestPageHtml(prefs.paper, isRtl, prefs.name), 'Test print');
      if (via === 'bluetooth') toast.success(L('أُرسلت الصفحة التجريبية إلى الطابعة.', 'Test page sent to the printer.'));
    } catch (err) {
      toast.error(printerErrorMessage(err, isRtl));
    } finally {
      setTesting(false);
    }
  };

  const paperButton = (paper: PaperWidth) => (
    <button
      type="button"
      onClick={() => update({ ...prefs, paper })}
      aria-pressed={prefs.paper === paper}
      className={`flex-1 py-3 rounded-2xl border-2 font-black text-sm transition ${prefs.paper === paper ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
    >
      {paper} {L('مم', 'mm')}
    </button>
  );

  return (
    <div className="space-y-8" dir={isRtl ? 'rtl' : 'ltr'}>
      <div>
        <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-wider">{L('الطباعة', 'Printing')}</h2>
        <p className="text-sm text-slate-500 mt-1">{L('إعدادات هذا الجهاز فقط: إيصالات البيع وتقارير الوردية.', 'This device only: sales receipts and shift reports.')}</p>
      </div>

      <section className="space-y-3">
        <h3 className="font-black text-slate-800 dark:text-slate-100">{L('عرض ورق الإيصالات', 'Receipt paper width')}</h3>
        <div className="flex gap-3 max-w-sm">
          {paperButton(58)}
          {paperButton(80)}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Bluetooth size={18} className="text-indigo-600" />
          {L('طابعة إيصالات بلوتوث', 'Bluetooth receipt printer')}
        </h3>

        {!native ? (
          <p className="text-sm text-slate-500">
            {L('الطباعة المباشرة عبر البلوتوث متاحة في تطبيق أندرويد. هنا تُطبع الإيصالات عبر نافذة الطباعة بالعرض المختار أعلاه.',
              'Direct Bluetooth printing is available in the Android app. Here receipts print through the print dialog at the width chosen above.')}
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              {L('اقرن الطابعة أولاً من إعدادات البلوتوث في الهاتف، ثم اخترها هنا. تُطبع الإيصالات عليها مباشرة دون نافذة الطباعة.',
                'Pair the printer in the phone\'s Bluetooth settings first, then pick it here. Receipts then print on it directly, without the print dialog.')}
            </p>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="text-slate-500">{L('الطابعة الحالية:', 'Current printer:')} </span>
                <b className="text-slate-900 dark:text-white">{prefs.address ? (prefs.name || prefs.address) : L('لا يوجد (نافذة الطباعة)', 'None (print dialog)')}</b>
              </div>
              {prefs.address && (
                <button type="button" onClick={() => update({ paper: prefs.paper })} className="text-xs font-bold text-rose-600 hover:underline">
                  {L('إلغاء الاختيار', 'Remove')}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-sm disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              {L('عرض الأجهزة المقترنة', 'Show paired devices')}
            </button>

            {prefs.address && (
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(prefs.openDrawer)}
                  onChange={(e) => update({ ...prefs, openDrawer: e.target.checked })}
                  className="mt-1 h-4 w-4 accent-indigo-600"
                />
                <span className="text-sm">
                  <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                    <Wallet size={16} className="text-indigo-600" />
                    {L('فتح درج النقد مع إيصال البيع النقدي', 'Open the cash drawer with cash-sale receipts')}
                  </span>
                  <span className="block text-slate-500 mt-1">
                    {L('للدرج الموصول بمنفذ الطابعة. يُفتح فقط عند حفظ بيع نقدي، لا عند إعادة الطباعة.',
                      'For a drawer plugged into the printer. It opens only when a cash sale is saved, never on a reprint.')}
                  </span>
                </span>
              </label>
            )}

            {devices && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {devices.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">{L('لا توجد أجهزة مقترنة. اقرن الطابعة من إعدادات البلوتوث ثم حدّث القائمة.', 'No paired devices. Pair the printer in Bluetooth settings, then refresh.')}</p>
                )}
                {devices.map((d) => (
                  <button
                    key={d.address}
                    type="button"
                    onClick={() => update({ ...prefs, address: d.address, name: d.name })}
                    className={`w-full flex items-center justify-between gap-3 p-4 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50 ${prefs.address === d.address ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : ''}`}
                  >
                    <span>
                      <span className="block font-bold text-slate-900 dark:text-white">{d.name}</span>
                      <span className="block text-[11px] font-mono text-slate-500" dir="ltr">{d.address}</span>
                    </span>
                    {prefs.address === d.address
                      ? <span className="text-xs font-black text-indigo-600">{L('مختارة', 'Selected')}</span>
                      : d.printer ? <span className="text-xs font-bold text-slate-500">{L('طابعة', 'Printer')}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <button
        type="button"
        onClick={test}
        disabled={testing}
        className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 disabled:opacity-50"
      >
        <Printer size={16} />
        {testing ? L('جارٍ الإرسال...', 'Sending...') : L('طباعة صفحة تجريبية', 'Print a test page')}
      </button>
    </div>
  );
}
