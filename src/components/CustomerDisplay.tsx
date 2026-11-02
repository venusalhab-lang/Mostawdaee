import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Logo from './Logo';
import {
  formatCustomerMoney,
  idleCustomerDisplaySnapshot,
  readCustomerDisplaySnapshot,
  subscribeCustomerDisplay,
  type CustomerDisplaySnapshot,
} from '../lib/customerDisplay';

/**
 * Read-only customer-facing display. Receives cart snapshots from the cashier POS
 * on the same device (BroadcastChannel + localStorage). No stock, costs, or controls.
 */
export default function CustomerDisplay() {
  const [snapshot, setSnapshot] = useState<CustomerDisplaySnapshot | null>(() => readCustomerDisplaySnapshot());

  useEffect(() => {
    document.title = snapshot?.businessName
      ? `${snapshot.businessName} · Customer`
      : 'Customer display · Mostawdaee';
    document.documentElement.classList.add('customer-display-root');
    return () => {
      document.documentElement.classList.remove('customer-display-root');
    };
  }, [snapshot?.businessName]);

  useEffect(() => subscribeCustomerDisplay(setSnapshot), []);

  const view =
    snapshot ||
    idleCustomerDisplaySnapshot({
      language: 'ar',
      businessName: 'مستودعي',
      currency: 'JOD',
    });

  const isRtl = view.language === 'ar';
  const money = (n: number) => formatCustomerMoney(n, view.currency, view.language);

  return (
    <div
      className="min-h-screen w-full bg-[#0b1220] text-white flex flex-col overflow-hidden select-none"
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-live="polite"
    >
      <header className="px-8 pt-8 pb-4 flex items-center justify-between gap-4 border-b border-white/10">
        <div className="flex items-center gap-4 min-w-0">
          <Logo size={48} animate />
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight truncate">
              {view.businessName || (isRtl ? 'مستودعي' : 'Mostawdaee')}
            </h1>
            <p className="text-sm text-slate-400 font-semibold">
              {isRtl ? 'شاشة العميل' : 'Customer display'}
            </p>
          </div>
        </div>
        <div className="text-end shrink-0">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-bold">
            {new Date(view.updatedAt || Date.now()).toLocaleTimeString(isRtl ? 'ar-EG' : 'en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-h-0 px-6 sm:px-10 py-6">
        <AnimatePresence mode="wait">
          {view.status === 'paid' ? (
            <motion.div
              key="paid"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center text-center gap-4"
            >
              <p className="text-4xl sm:text-5xl font-black text-emerald-300">
                {isRtl ? 'شكراً لتسوقكم' : 'Thank you'}
              </p>
              <p className="text-xl text-slate-300 font-semibold">
                {isRtl ? 'تمت عملية الدفع' : 'Payment complete'}
              </p>
              {typeof view.changeDue === 'number' && view.changeDue > 0 && (
                <div className="mt-4 rounded-3xl border border-emerald-400/30 bg-emerald-500/10 px-10 py-6">
                  <p className="text-sm font-bold text-emerald-200/80 uppercase tracking-wider">
                    {isRtl ? 'الباقي' : 'Change'}
                  </p>
                  <p className="text-4xl sm:text-5xl font-black text-emerald-200 tabular-nums mt-2">
                    {money(view.changeDue)}
                  </p>
                </div>
              )}
              <p className="text-3xl font-black tabular-nums text-white/90 mt-2">{money(view.total)}</p>
            </motion.div>
          ) : view.status === 'cart' && view.lines.length > 0 ? (
            <motion.div
              key="cart"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col min-h-0 gap-6"
            >
              <div className="flex-1 min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.03]">
                <table className="w-full text-start">
                  <thead className="sticky top-0 bg-[#121a2b]/95 backdrop-blur border-b border-white/10">
                    <tr className="text-xs uppercase tracking-wider text-slate-400">
                      <th className="px-5 py-4 font-bold">{isRtl ? 'الصنف' : 'Item'}</th>
                      <th className="px-4 py-4 font-bold text-center w-28">{isRtl ? 'الكمية' : 'Qty'}</th>
                      <th className="px-4 py-4 font-bold text-end w-36">{isRtl ? 'السعر' : 'Price'}</th>
                      <th className="px-5 py-4 font-bold text-end w-40">{isRtl ? 'المجموع' : 'Total'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.lines.map((line) => (
                      <tr key={line.key} className="border-b border-white/5 last:border-0">
                        <td className="px-5 py-4 text-lg sm:text-xl font-bold text-white">{line.description}</td>
                        <td className="px-4 py-4 text-center text-base font-semibold text-slate-300 tabular-nums">
                          {line.quantityLabel}
                        </td>
                        <td className="px-4 py-4 text-end text-base text-slate-300 tabular-nums">
                          {money(line.unitPrice)}
                        </td>
                        <td className="px-5 py-4 text-end text-lg sm:text-xl font-black tabular-nums text-cyan-200">
                          {money(line.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent px-6 sm:px-8 py-5 space-y-2">
                <Row label={isRtl ? 'المجموع الفرعي' : 'Subtotal'} value={money(view.subtotal)} muted />
                {view.discount > 0 && (
                  <Row label={isRtl ? 'الخصم' : 'Discount'} value={`− ${money(view.discount)}`} accent="rose" />
                )}
                {view.taxAmount > 0 && (
                  <Row label={isRtl ? 'الضريبة' : 'Tax'} value={money(view.taxAmount)} muted />
                )}
                <div className="flex items-end justify-between gap-4 pt-3 border-t border-white/10">
                  <div>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                      {isRtl ? 'الإجمالي' : 'Total'}
                    </p>
                    <p className="text-xs text-slate-500 font-semibold mt-1">
                      {view.itemCount} {isRtl ? 'قطعة' : 'units'}
                    </p>
                  </div>
                  <p className="text-4xl sm:text-5xl font-black tabular-nums text-white tracking-tight">
                    {money(view.total)}
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center text-center gap-5"
            >
              <Logo size={88} animate animate3d />
              <p className="text-3xl sm:text-4xl font-black tracking-tight">
                {isRtl ? 'أهلاً بكم' : 'Welcome'}
              </p>
              <p className="text-lg text-slate-400 font-semibold max-w-md">
                {isRtl
                  ? 'ستظهر هنا أصناف فاتورتك أثناء المسح عند الكاشير.'
                  : 'Your items will appear here as the cashier scans them.'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="px-8 py-4 border-t border-white/10 text-center text-[11px] text-slate-600 font-semibold tracking-wide">
        Mostawdaee
      </footer>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: 'rose';
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-base sm:text-lg">
      <span className={`font-bold ${muted ? 'text-slate-400' : accent === 'rose' ? 'text-rose-300' : 'text-slate-200'}`}>
        {label}
      </span>
      <span
        className={`font-black tabular-nums ${
          accent === 'rose' ? 'text-rose-300' : muted ? 'text-slate-300' : 'text-white'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
