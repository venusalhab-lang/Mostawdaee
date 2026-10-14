import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Barcode, Printer, X } from 'lucide-react';
import type { Product } from '../types';
import { formatMoney } from '../lib/exchangeRates';
import { productPack } from '../lib/packs';
import { printHtmlDocument } from '../lib/printHtml';
import {
  LABEL_SIZES,
  MAX_LABELS,
  MIN_MODULE_MM,
  buildLabelsHtml,
  canPrintCode,
  moduleWidthMm,
  totalLabels,
  type LabelSizeId,
} from '../lib/labels';

interface LabelPrintModalProps {
  products: Product[];
  isRtl: boolean;
  defaultCurrency: string;
  businessName?: string;
  onClose: () => void;
}

interface Row {
  key: string;
  name: string;
  detail: string;
  code: string;
  price: string;
  stockCopies: number;
  copies: string;
}

const PREFS_KEY = 'mustawdae_label_prefs';

function readPrefs(): { size: LabelSizeId; showName: boolean; showPrice: boolean; showStore: boolean } {
  const fallback = { size: 'roll-50x30' as LabelSizeId, showName: true, showPrice: true, showStore: false };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      size: LABEL_SIZES.some((s) => s.id === saved.size) ? saved.size : fallback.size,
      showName: typeof saved.showName === 'boolean' ? saved.showName : fallback.showName,
      showPrice: typeof saved.showPrice === 'boolean' ? saved.showPrice : fallback.showPrice,
      showStore: typeof saved.showStore === 'boolean' ? saved.showStore : fallback.showStore,
    };
  } catch {
    return fallback;
  }
}

export default function LabelPrintModal({ products, isRtl, defaultCurrency, businessName, onClose }: LabelPrintModalProps) {
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  }, [prefs]);

  const [rows, setRows] = useState<Row[]>(() => products.flatMap((p) => {
    const currency = p.currency || defaultCurrency;
    const unit: Row = {
      key: `${p.id}:unit`,
      name: p.name,
      detail: p.unitName?.trim() || '',
      code: (p.sku || '').trim(),
      price: formatMoney(Number(p.sellingPrice) || 0, currency),
      stockCopies: Math.max(0, Math.floor(Number(p.quantity) || 0)),
      copies: '1',
    };
    const pack = productPack(p);
    if (!pack?.barcode) return [unit];
    return [unit, {
      key: `${p.id}:pack`,
      name: p.name,
      detail: `${pack.name || L('عبوة', 'Pack')} × ${pack.size}`,
      code: pack.barcode,
      price: formatMoney(pack.price, currency),
      stockCopies: Math.max(0, Math.floor((Number(p.quantity) || 0) / pack.size)),
      copies: '0',
    }];
  }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const printable = useMemo(() => rows.filter((r) => canPrintCode(r.code)), [rows]);
  const total = totalLabels(printable.map((r) => ({ copies: Number(r.copies) })));
  const narrow = printable.filter((r) => Number(r.copies) > 0 && (moduleWidthMm(r.code, prefs.size) ?? 1) < MIN_MODULE_MM);

  const setCopies = (key: string, value: string) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, copies: value } : r)));
  const setAll = (pick: (r: Row) => number) => setRows((prev) => prev.map((r) => ({ ...r, copies: String(pick(r)) })));

  const print = () => {
    if (!total) return;
    printHtmlDocument(buildLabelsHtml(
      printable.map((r) => ({
        name: r.detail ? `${r.name} · ${r.detail}` : r.name,
        code: r.code,
        price: r.price,
        copies: Number(r.copies) || 0,
      })),
      { size: prefs.size, showName: prefs.showName, showPrice: prefs.showPrice, businessName: prefs.showStore ? businessName : undefined, isRtl },
    ), 'Mostawdaee labels');
  };

  const toggle = (key: 'showName' | 'showPrice' | 'showStore', label: string) => (
    <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
      <input type="checkbox" checked={prefs[key]} onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))} className="w-4 h-4 accent-cyan-600" />
      {label}
    </label>
  );

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm" dir={isRtl ? 'rtl' : 'ltr'} role="dialog" aria-modal="true" aria-labelledby="labels-title">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-2xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 id="labels-title" className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Barcode size={18} className="text-cyan-600" />
            {L('طباعة ملصقات الباركود', 'Print barcode labels')}
          </h3>
          <button type="button" onClick={onClose} aria-label={L('إغلاق', 'Close')} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('مقاس الملصق', 'Label size')}</span>
            <select
              value={prefs.size}
              onChange={(e) => setPrefs((p) => ({ ...p, size: e.target.value as LabelSizeId }))}
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-500"
            >
              {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{isRtl ? s.ar : s.en}</option>)}
            </select>
          </label>

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {toggle('showName', L('اسم الصنف', 'Product name'))}
            {toggle('showPrice', L('السعر', 'Price'))}
            {businessName ? toggle('showStore', L('اسم المتجر', 'Store name')) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{L('عدد النسخ لكل صنف', 'Copies per item')}</p>
            <div className="flex gap-3 text-xs font-bold">
              <button type="button" onClick={() => setAll((r) => r.stockCopies)} className="text-cyan-700 dark:text-cyan-400 hover:underline">{L('بعدد الكمية في المخزون', 'Match stock on hand')}</button>
              <button type="button" onClick={() => setAll(() => 1)} className="text-cyan-700 dark:text-cyan-400 hover:underline">{L('نسخة لكل صنف', 'One each')}</button>
              <button type="button" onClick={() => setAll(() => 0)} className="text-slate-500 hover:underline">{L('تصفير', 'Clear')}</button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{L('لا توجد أصناف في القائمة الحالية.', 'No products in the current list.')}</p>
            )}
            {rows.map((r) => {
              const ok = canPrintCode(r.code);
              return (
                <div key={r.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[10rem]">
                    <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{r.name}{r.detail ? <span className="text-slate-500 font-semibold"> · {r.detail}</span> : null}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      <span className="font-mono" dir="ltr">{r.code || '—'}</span>
                      {' · '}
                      <span className="font-mono" dir="ltr">{r.price}</span>
                    </div>
                    {!ok && (
                      <div className="text-[11px] font-bold text-rose-600 mt-1">
                        {r.code
                          ? L('هذا الرمز يحتوي أحرفاً لا تُطبع كباركود (أرقام وحروف إنجليزية فقط).', 'This code has characters a barcode cannot carry (digits and English letters only).')
                          : L('لا يوجد باركود لهذا الصنف.', 'This product has no barcode.')}
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    disabled={!ok}
                    value={ok ? r.copies : ''}
                    onChange={(e) => setCopies(r.key, e.target.value)}
                    aria-label={L(`عدد نسخ ${r.name}`, `Copies of ${r.name}`)}
                    className="w-20 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-center font-mono text-sm bg-slate-50 dark:bg-slate-950 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>

          {narrow.length > 0 && (
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
              {L(
                `${narrow.length === 1 ? 'باركود واحد طويل' : `${narrow.length} باركودات طويلة`} على هذا المقاس وقد يصعب مسحه؛ اختر ملصقاً أعرض.`,
                `${narrow.length} barcode(s) are long for this size and may not scan reliably; pick a wider label.`,
              )}
            </p>
          )}
          {total > MAX_LABELS && (
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
              {L(`تُطبع أول ${MAX_LABELS} ملصق فقط في المرة الواحدة.`, `Only the first ${MAX_LABELS} labels print in one go.`)}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
          <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
            {L('المجموع:', 'Total:')} <span className="font-mono">{Math.min(total, MAX_LABELS)}</span> {L('ملصق', 'labels')}
          </span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-2xl font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200">
              {L('إغلاق', 'Close')}
            </button>
            <button type="button" onClick={print} disabled={!total}
              className="px-5 py-2.5 rounded-2xl font-bold bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
              <Printer size={16} />
              {L('طباعة', 'Print')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
