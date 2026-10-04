import React, { useEffect, useMemo, useState } from 'react';
import { Barcode, ClipboardCheck, History, ScanLine, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AppSettings, InventoryAudit, InventoryAuditLine, Language, Product } from '../types';
import { useFirebase } from './FirebaseProvider';
import BarcodeScannerScanner from './ui/BarcodeScannerScanner';
import { formatMoney, roundMoney } from '../lib/exchangeRates';
import { computeStockStatus } from '../lib/stock';
import {
  auditDifference,
  auditVarianceValue,
  countBarcode,
  newAuditNumber,
  planAuditApply,
  stocktakeMovement,
} from '../lib/inventoryAudit';
import {
  completeAuditCloud,
  deleteAuditDraft,
  loadAuditArchive,
  markLocalCompleted,
  saveAuditDraft,
  type StoredInventoryAudit,
} from '../lib/inventoryAuditStore';

interface Props {
  language: Language;
  settings: AppSettings;
}

function freshAudit(createdBy: string): InventoryAudit {
  return {
    id: crypto.randomUUID(),
    auditNumber: newAuditNumber(),
    status: 'draft' as const,
    notes: '',
    createdAt: new Date().toISOString(),
    createdBy,
  };
}

function productCost(product: Product): number {
  const cost = Number(product.unitCost ?? product.costPrice ?? 0);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

export default function InventoryAudit({ language, settings }: Props) {
  const isRtl = language === 'ar';
  const { products, saveProduct, user } = useFirebase();
  const userId = user?.uid || 'guest';
  const [tab, setTab] = useState<'count' | 'archive'>('count');
  const [audit, setAudit] = useState<InventoryAudit>(() => freshAudit(userId));
  const [lines, setLines] = useState<InventoryAuditLine[]>([]);
  const [barcode, setBarcode] = useState('');
  const [query, setQuery] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [archive, setArchive] = useState<StoredInventoryAudit[]>([]);
  const [openReportId, setOpenReportId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAuditArchive(userId)
      .then((rows) => {
        if (!cancelled) setArchive(rows);
      })
      .catch((error: Error) => {
        if (!cancelled) toast.error(error.message || (isRtl ? 'تعذر تحميل سجل الجرد' : 'Could not load stocktakes'));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isRtl]);

  const catalog = useMemo(
    () => products.filter((product) => product.type !== 'asset'),
    [products],
  );

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return catalog
      .filter((product) => {
        const haystack = `${product.name} ${product.sku}`.toLowerCase();
        return haystack.includes(term) && !lines.some((line) => line.productId === product.id);
      })
      .slice(0, 8);
  }, [catalog, query, lines]);

  const pricedLines = useMemo(
    () =>
      lines.map((line) => {
        const difference = auditDifference(line.expectedQty, line.actualQty);
        return {
          ...line,
          difference,
          varianceValue: roundMoney(auditVarianceValue(difference, line.unitCost), line.currency || settings.currency),
          movement: stocktakeMovement(difference),
        };
      }),
    [lines, settings.currency],
  );

  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    let shortage = 0;
    let surplus = 0;
    for (const line of pricedLines) {
      if (line.difference < 0) shortage += 1;
      if (line.difference > 0) surplus += 1;
      const code = line.currency || settings.currency;
      byCurrency.set(code, (byCurrency.get(code) || 0) + line.varianceValue);
    }
    return { shortage, surplus, byCurrency };
  }, [pricedLines, settings.currency]);

  const addManual = (product: Product) => {
    if (lines.some((line) => line.productId === product.id)) {
      toast.message(isRtl ? 'الصنف موجود في الجدول' : 'This product is already on the sheet');
      return;
    }
    const expectedQty = Number(product.quantity) || 0;
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        auditId: audit.id,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        currency: product.currency || settings.currency,
        expectedQty,
        actualQty: expectedQty,
        difference: 0,
        unitCost: productCost(product),
      },
    ]);
    setQuery('');
  };

  const scanCode = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const product = catalog.find(
      (item) => item.sku.trim().toLowerCase() === code.toLowerCase() || item.id === code,
    );
    if (!product) {
      toast.error(isRtl ? 'لا يوجد صنف بهذا الباركود' : 'No product matches this barcode');
      return;
    }
    setLines((prev) =>
      countBarcode(
        prev,
        {
          id: product.id,
          name: product.name,
          sku: product.sku,
          quantity: Number(product.quantity) || 0,
          unitCost: productCost(product),
          currency: product.currency || settings.currency,
        },
        audit.id,
      ).lines,
    );
    setBarcode('');
  };

  const setActual = (productId: string, value: string) => {
    const actualQty = value === '' ? Number.NaN : Number(value);
    setLines((prev) =>
      prev.map((line) => {
        if (line.productId !== productId) return line;
        const nextActual = Number.isFinite(actualQty) ? actualQty : line.actualQty;
        return { ...line, actualQty: nextActual, difference: auditDifference(line.expectedQty, nextActual) };
      }),
    );
  };

  const persist = async () => {
    const stamped = lines.map((line) => ({
      ...line,
      difference: auditDifference(line.expectedQty, line.actualQty),
    }));
    const cloud = await saveAuditDraft(userId, { ...audit, status: 'draft' }, stamped);
    setArchive(await loadAuditArchive(userId));
    return cloud;
  };

  const saveDraft = async () => {
    if (!lines.length) {
      toast.error(isRtl ? 'أضف صنفاً واحداً على الأقل' : 'Add at least one product');
      return;
    }
    setBusy(true);
    try {
      const cloud = await persist();
      if (cloud.cloud) toast.success(isRtl ? 'حُفظت المسودة' : 'Draft saved');
      else if (cloud.reason === 'failed') toast.error(cloud.message || (isRtl ? 'تعذر حفظ المسودة في السحابة' : 'Could not save the draft'));
      else toast.success(isRtl ? 'حُفظت المسودة على هذا الجهاز' : 'Draft saved on this device');
    } finally {
      setBusy(false);
    }
  };

  const applyAudit = async () => {
    const book = Object.fromEntries(catalog.map((product) => [product.id, Number(product.quantity) || 0]));
    const plan = planAuditApply(lines, book);
    if (!plan.ok) {
      const blocked = plan.lines.find((line) => line.block);
      const name = blocked?.productName || '';
      toast.error(
        blocked?.block === 'STOCK_CHANGED'
          ? (isRtl ? `كمية «${name}» تغيّرت بعد بدء الجرد. حدّث السطر قبل الاعتماد.` : `Quantity for “${name}” changed after the count started. Refresh that line before applying.`)
          : (isRtl ? `الكمية أو التكلفة غير صالحة للصنف «${name}».` : `Quantity or cost is invalid for “${name}”.`),
      );
      setConfirmApply(false);
      return;
    }

    setBusy(true);
    try {
      const draftCloud = await persist();
      if (!draftCloud.cloud && draftCloud.reason === 'failed') {
        toast.error(draftCloud.message || (isRtl ? 'تعذر حفظ الجرد قبل الاعتماد' : 'Could not save the count before applying'));
        return;
      }

      for (const line of plan.lines) {
        if (line.action !== 'update' || !line.movement) continue;
        const product = catalog.find((item) => item.id === line.productId);
        if (!product) {
          toast.error(isRtl ? `الصنف «${line.productName}» لم يعد في المخزون` : `“${line.productName}” is no longer in stock`);
          return;
        }
        await saveProduct(
          {
            ...product,
            quantity: line.actualQty,
            status: computeStockStatus(line.actualQty, product.lowStockThreshold, settings.lowStockThreshold),
          },
          { reason: `${line.movement} ${audit.auditNumber}` },
        );
      }

      const cloud = await completeAuditCloud(audit.id);
      if (!cloud.cloud && cloud.reason === 'failed') {
        toast.error(cloud.message || (isRtl ? 'تحدّث مخزون التطبيق، وبقي الجرد مسودة على الخادم. أعد الاعتماد لإغلاقه.' : 'App stock was updated, but the stocktake is still a draft on the server. Apply again to close it.'));
        setArchive(await loadAuditArchive(userId));
        setConfirmApply(false);
        return;
      }
      markLocalCompleted(userId, audit.id);
      setArchive(await loadAuditArchive(userId));
      if (cloud.cloud) {
        const missing = cloud.missingProducts?.length || 0;
        toast.success(
          missing
            ? (isRtl
              ? `اعتُمد الجرد وحدّث مخزون التطبيق. ${missing} أصناف غير موجودة في سجل الجرد على الخادم فلم تُحدَّث هناك.`
              : `Stocktake applied and the app stock was updated. ${missing} products are not in the server stocktake records, so they were left unchanged there.`)
            : (isRtl ? 'اعتُمد الجرد وحدّث المخزون' : 'Stocktake applied and stock was updated'),
        );
      } else {
        toast.success(isRtl ? 'اعتُمد الجرد وحدّث مخزون هذه الجلسة' : 'Stocktake applied to this session’s stock');
      }
      setOpenReportId(audit.id);
      setTab('archive');
      setConfirmApply(false);
      setLines([]);
      setAudit(freshAudit(userId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.error(message || (isRtl ? 'توقف الاعتماد قبل إنهاء كل الأصناف' : 'Apply stopped before every product was updated'));
    } finally {
      setBusy(false);
    }
  };

  const resume = (stored: StoredInventoryAudit) => {
    if (stored.audit.status !== 'draft') return;
    setAudit(stored.audit);
    setLines(stored.lines);
    setTab('count');
    setConfirmApply(false);
  };

  const removeDraft = async (auditId: string) => {
    setBusy(true);
    try {
      await deleteAuditDraft(userId, auditId);
      setArchive(await loadAuditArchive(userId));
      if (audit.id === auditId) {
        setAudit(freshAudit(userId));
        setLines([]);
      }
    } finally {
      setBusy(false);
    }
  };

  const text = {
    title: isRtl ? 'الجرد الفعلي والتسوية المخزنية' : 'Inventory reconciliation',
    subtitle: isRtl
      ? 'عدّ الكمية الفعلية. الاعتماد يطابق المخزون على الأصناف الموجودة في الجدول فقط.'
      : 'Count the physical quantity. Applying changes stock only for products on this sheet.',
    count: isRtl ? 'الجرد الحالي' : 'Current count',
    archive: isRtl ? 'سجل الجرد' : 'Previous counts',
    barcode: isRtl ? 'باركود الصنف' : 'Product barcode',
    search: isRtl ? 'ابحث بالاسم أو الرمز' : 'Search by name or SKU',
    draft: isRtl ? 'حفظ كمسودة' : 'Save draft',
    apply: isRtl ? 'اعتماد الجرد وتحديث المخزون' : 'Apply adjustment',
    confirm: isRtl ? 'تأكيد الاعتماد' : 'Confirm apply',
    cancel: isRtl ? 'رجوع' : 'Back',
    empty: isRtl ? 'لا توجد منتجات في المخزون بعد.' : 'There are no products in stock yet.',
    sheetEmpty: isRtl ? 'امسح باركوداً أو اختر صنفاً لبدء المطابقة.' : 'Scan a barcode or pick a product to start matching.',
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <ClipboardCheck className="text-indigo-600" size={26} />
            {text.title}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{text.subtitle}</p>
        </div>
        <div className="text-xs font-bold text-slate-400">{audit.auditNumber}</div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('count')}
          className={`px-4 py-2 rounded-xl text-sm font-bold ${tab === 'count' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 border border-slate-200 dark:border-white/10'}`}
        >
          {text.count}
        </button>
        <button
          type="button"
          onClick={() => setTab('archive')}
          className={`px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 ${tab === 'archive' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 border border-slate-200 dark:border-white/10'}`}
        >
          <History size={16} />
          {text.archive}
        </button>
      </div>

      {tab === 'count' ? (
        <div className="space-y-4">
          {catalog.length === 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 text-sm text-slate-500">
              {text.empty}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <form
              className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const field = event.currentTarget.querySelector('input');
                scanCode(field?.value || '');
              }}
            >
              <label className="text-xs font-bold text-slate-400 uppercase">{text.barcode}</label>
              <div className="flex gap-2">
                <input
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  placeholder={isRtl ? 'امسح أو اكتب الباركود ثم Enter' : 'Scan or type a barcode, then Enter'} aria-label={isRtl ? 'امسح أو اكتب الباركود ثم Enter' : 'Scan or type a barcode, then Enter'}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-3 font-mono font-bold outline-none focus:border-indigo-500"
                />
                <button type="submit" className="rounded-xl bg-indigo-600 text-white px-3" aria-label={isRtl ? 'إضافة بالمسح' : 'Add scan'}>
                  <Barcode size={18} />
                </button>
                <button type="button" onClick={() => setCameraOpen((open) => !open)} className="rounded-xl border border-slate-200 dark:border-white/10 px-3" aria-label={isRtl ? 'كاميرا' : 'Camera'}>
                  <ScanLine size={18} />
                </button>
              </div>
              <p className="text-xs text-slate-400">
                {isRtl ? 'كل مسحة لنفس الصنف تزيد الكمية الفعلية بمقدار 1.' : 'Each scan of the same product adds 1 to the counted quantity.'}
              </p>
              {cameraOpen && (
                <BarcodeScannerScanner
                  isRtl={isRtl}
                  onScan={(code) => {
                    scanCode(code);
                    setCameraOpen(false);
                  }}
                  onClose={() => setCameraOpen(false)}
                />
              )}
            </form>

            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 space-y-2 relative">
              <label className="text-xs font-bold text-slate-400 uppercase">{text.search}</label>
              <div className="relative">
                <Search size={16} className="absolute top-1/2 -translate-y-1/2 text-slate-400 start-3" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={text.search} aria-label={text.search}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 py-3 ps-9 pe-3 outline-none focus:border-indigo-500"
                />
              </div>
              {matches.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
                  {matches.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addManual(product)}
                      className="w-full text-start px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-white/5 flex justify-between gap-3"
                    >
                      <span className="font-bold">{product.name}</span>
                      <span className="text-slate-400 font-mono">{product.sku} · {product.quantity}</span>
                    </button>
                  ))}
                </div>
              )}
              <label className="text-xs font-bold text-slate-400 uppercase block pt-2">{isRtl ? 'ملاحظات' : 'Notes'}</label>
              <textarea
                value={audit.notes}
                onChange={(event) => setAudit((current) => ({ ...current, notes: event.target.value }))}
                rows={2}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-400 border-b border-slate-100 dark:border-white/10">
                <tr>
                  <th className="px-3 py-3 text-start font-bold">{isRtl ? 'الاسم' : 'Name'}</th>
                  <th className="px-3 py-3 text-end font-bold">{isRtl ? 'المسجلة' : 'Book'}</th>
                  <th className="px-3 py-3 text-end font-bold">{isRtl ? 'الفعلية' : 'Counted'}</th>
                  <th className="px-3 py-3 text-end font-bold">{isRtl ? 'الفارق' : 'Diff'}</th>
                  <th className="px-3 py-3 text-end font-bold">{isRtl ? 'القيمة' : 'Value'}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {pricedLines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">{text.sheetEmpty}</td>
                  </tr>
                )}
                {pricedLines.map((line) => {
                  const tone = line.difference < 0 ? 'text-rose-600' : line.difference > 0 ? 'text-emerald-600' : 'text-slate-500';
                  return (
                    <tr key={line.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="px-3 py-3">
                        <div className="font-bold">{line.productName}</div>
                        <div className="text-xs text-slate-400 font-mono">{line.sku}</div>
                      </td>
                      <td className="px-3 py-3 text-end font-mono">{line.expectedQty}</td>
                      <td className="px-3 py-3 text-end">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={Number.isFinite(line.actualQty) ? line.actualQty : ''}
                          onChange={(event) => setActual(line.productId, event.target.value)}
                          className="w-16 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-2 py-1 text-end font-mono font-bold"
                        />
                      </td>
                      <td className={`px-3 py-3 text-end font-mono font-black ${tone}`}>
                        {line.difference > 0 ? `+${line.difference}` : line.difference}
                        <div className="text-[11px] font-bold">{line.movement || (isRtl ? 'مطابق' : 'Match')}</div>
                      </td>
                      <td className={`px-3 py-3 text-end font-mono font-bold ${tone}`}>
                        {formatMoney(line.varianceValue, line.currency || settings.currency, isRtl ? 'ar' : 'en-US')}
                      </td>
                      <td className="px-2 py-3 text-end">
                        <button
                          type="button"
                          onClick={() => setLines((prev) => prev.filter((item) => item.id !== line.id))}
                          className="text-slate-400 hover:text-rose-600"
                          aria-label={isRtl ? 'حذف السطر' : 'Remove line'}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              <span className="text-rose-600 font-bold">{isRtl ? `عجز: ${totals.shortage}` : `Shortage: ${totals.shortage}`}</span>
              <span className="mx-2">·</span>
              <span className="text-emerald-600 font-bold">{isRtl ? `زيادة: ${totals.surplus}` : `Surplus: ${totals.surplus}`}</span>
              <span className="mx-2">·</span>
              {[...totals.byCurrency.entries()].map(([code, value]) => (
                <span key={code} className="ms-2 font-mono">{formatMoney(value, code, isRtl ? 'ar' : 'en-US')}</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={saveDraft}
                className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3 text-sm font-bold disabled:opacity-50"
              >
                {text.draft}
              </button>
              {!confirmApply ? (
                <button
                  type="button"
                  disabled={busy || lines.length === 0}
                  onClick={() => setConfirmApply(true)}
                  className="rounded-xl bg-emerald-600 text-white px-4 py-3 text-sm font-bold disabled:opacity-50"
                >
                  {text.apply}
                </button>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => setConfirmApply(false)} className="rounded-xl px-4 py-3 text-sm font-bold">
                    {text.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={applyAudit}
                    className="rounded-xl bg-emerald-700 text-white px-4 py-3 text-sm font-bold disabled:opacity-50"
                  >
                    {text.confirm}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {archive.length === 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500">
              {isRtl ? 'لا توجد عمليات جرد محفوظة.' : 'No stocktakes saved yet.'}
            </div>
          )}
          {archive.map((stored) => {
            const open = openReportId === stored.audit.id;
            const when = new Date(stored.audit.createdAt);
            const whenLabel = Number.isNaN(when.getTime())
              ? stored.audit.createdAt
              : when.toLocaleString(isRtl ? 'ar' : 'en-US');
            return (
              <article key={stored.audit.id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 space-y-3">
                <button type="button" onClick={() => setOpenReportId(open ? null : stored.audit.id)} className="w-full text-start flex items-center justify-between gap-3">
                  <div>
                    <div className="font-black">{stored.audit.auditNumber}</div>
                    <div className="text-xs text-slate-400">{whenLabel}</div>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${stored.audit.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {stored.audit.status === 'completed' ? (isRtl ? 'معتمد' : 'Completed') : (isRtl ? 'مسودة' : 'Draft')}
                  </span>
                </button>
                {open && (
                  <div className="space-y-3">
                    {stored.audit.notes && <p className="text-sm text-slate-500">{stored.audit.notes}</p>}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[640px]">
                        <thead className="text-xs uppercase text-slate-400">
                          <tr>
                            <th className="py-2 text-start">{isRtl ? 'الاسم' : 'Name'}</th>
                            <th className="py-2 text-end">{isRtl ? 'مسجّل' : 'Book'}</th>
                            <th className="py-2 text-end">{isRtl ? 'فعلي' : 'Counted'}</th>
                            <th className="py-2 text-end">{isRtl ? 'الفارق' : 'Diff'}</th>
                            <th className="py-2 text-end">{isRtl ? 'القيمة' : 'Value'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stored.lines.map((line) => {
                            const difference = auditDifference(line.expectedQty, line.actualQty);
                            const tone = difference < 0 ? 'text-rose-600' : difference > 0 ? 'text-emerald-600' : 'text-slate-500';
                            return (
                              <tr key={line.id} className="border-t border-slate-100 dark:border-white/5">
                                <td className="py-2">{line.productName}</td>
                                <td className="py-2 text-end font-mono">{line.expectedQty}</td>
                                <td className="py-2 text-end font-mono">{line.actualQty}</td>
                                <td className={`py-2 text-end font-mono font-bold ${tone}`}>{difference > 0 ? `+${difference}` : difference}</td>
                                <td className={`py-2 text-end font-mono ${tone}`}>
                                  {formatMoney(auditVarianceValue(difference, line.unitCost), line.currency || settings.currency, isRtl ? 'ar' : 'en-US')}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {stored.audit.status === 'draft' && (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => resume(stored)} className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-bold">
                          {isRtl ? 'استكمال الجرد' : 'Resume'}
                        </button>
                        <button type="button" onClick={() => removeDraft(stored.audit.id)} className="rounded-xl px-4 py-2 text-sm font-bold text-rose-600">
                          {isRtl ? 'حذف المسودة' : 'Delete draft'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
