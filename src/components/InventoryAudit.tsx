import React, { useEffect, useMemo, useState } from 'react';
import { Barcode, ClipboardCheck, History, ScanLine, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AppSettings, InventoryAudit, InventoryAuditLine, Language, Product } from '../types';
import { useFirebase } from './FirebaseProvider';
import BarcodeScannerScanner from './ui/BarcodeScannerScanner';
import { formatMoney } from '../lib/exchangeRates';
import { productsForCode } from '../lib/productLookup';
import { formatPackStock, productPack, productsForPackCode, splitPacks } from '../lib/packs';
import {
  auditDifference,
  auditVarianceValue,
  countBarcode,
  newAuditNumber,
  planAuditApply,
  refreshExpectedFromBook,
  stocktakeClaimAllowsStock,
  stocktakeClaimedOnServer,
  stocktakeMovement,
} from '../lib/inventoryAudit';
import {
  completeAuditCloudWithRetry,
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
  const { products, warehouses, applyStocktake, user } = useFirebase();
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
        console.error('[InventoryAudit] load failed:', error);
        if (!cancelled) toast.error(isRtl ? 'تعذر تحميل سجل الجرد. تحقق من الاتصال.' : 'Could not load stocktakes. Check your connection.');
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
          varianceValue: auditVarianceValue(difference, line.unitCost, line.currency || settings.currency),
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
    const unitMatches = productsForCode(catalog, code);
    const matches = unitMatches.length ? unitMatches : productsForPackCode(catalog, code);
    const product = matches.length === 1 ? matches[0] : undefined;
    const step = !unitMatches.length && product ? productPack(product)?.size ?? 1 : 1;
    if (matches.length > 1) {
      // Counting one shelf into another warehouse's row would show a false surplus and a false shortage.
      toast.error(isRtl
        ? 'هذا الباركود موجود في أكثر من مستودع. أضف الصنف من البحث واختر صف المستودع الذي تعدّه، ثم أدخل العدد.'
        : 'This barcode exists in more than one warehouse. Add the product from search, pick the warehouse row you are counting, then enter the count.');
      return;
    }
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
        step,
      ).lines,
    );
    setBarcode('');
  };

  const setActual = (productId: string, value: string) => {
    const actualQty = value === '' ? Number.NaN : Number(value);
    setLines((prev) =>
      prev.map((line) => {
        if (line.productId !== productId) return line;
        return { ...line, actualQty, difference: auditDifference(line.expectedQty, actualQty) };
      }),
    );
  };

  const blankCount = () => {
    const blank = lines.find((line) => !Number.isFinite(line.actualQty));
    if (!blank) return false;
    toast.error(isRtl ? `أدخل العدد الفعلي للصنف «${blank.productName}».` : `Enter the counted quantity for “${blank.productName}”.`);
    return true;
  };

  const bookMap = () => Object.fromEntries(catalog.map((product) => [product.id, Number(product.quantity) || 0]));

  const refreshBookQuantities = () => {
    if (!lines.length) return;
    const next = refreshExpectedFromBook(lines, bookMap());
    setLines(next);
    setConfirmApply(false);
    toast.success(isRtl ? 'حُدّثت الكميات المسجّلة من المخزون الحالي.' : 'Book quantities refreshed from current stock.');
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
    if (busy || blankCount()) return;
    setBusy(true);
    try {
      const cloud = await persist();
      if (cloud.cloud) toast.success(isRtl ? 'حُفظت المسودة' : 'Draft saved');
      else if (cloud.reason === 'failed') {
        console.error('[InventoryAudit] draft save failed:', cloud.message);
        toast.error(isRtl ? 'تعذر حفظ المسودة في السحابة. حاول مرة أخرى.' : 'Could not save the draft to the cloud. Try again.');
      }
      else toast.success(isRtl ? 'حُفظت المسودة على هذا الجهاز' : 'Draft saved on this device');
    } catch {
      toast.error(isRtl ? 'تعذّر حفظ المسودة. حاول مرة أخرى.' : 'Could not save the draft. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const applyAudit = async () => {
    if (busy) return;
    if (blankCount()) {
      setConfirmApply(false);
      return;
    }
    const plan = planAuditApply(lines, bookMap());
    if (!plan.ok) {
      const blocked = plan.lines.find((line) => line.block);
      const name = blocked?.productName || '';
      toast.error(
        blocked?.block === 'STOCK_CHANGED'
          ? (isRtl
            ? `كمية «${name}» تغيّرت بعد بدء الجرد. اضغط «تحديث المسجّل» ثم أعد الاعتماد.`
            : `Quantity for “${name}” changed after the count started. Tap “Refresh book” then apply again.`)
          : (isRtl ? `الكمية أو التكلفة غير صالحة للصنف «${name}».` : `Quantity or cost is invalid for “${name}”.`),
      );
      setConfirmApply(false);
      return;
    }

    setBusy(true);
    let claimedOnServer = false;
    try {
      const draftCloud = await persist();
      if (!draftCloud.cloud && draftCloud.reason === 'failed') {
        console.error('[InventoryAudit] save before apply failed:', draftCloud.message);
        toast.error(isRtl ? 'تعذر حفظ الجرد قبل الاعتماد؛ لم يتغيّر المخزون.' : 'Could not save the count before applying; stock was not changed.');
        return;
      }

      const missingLine = plan.lines.find(
        (line) => line.action === 'update' && line.movement && !catalog.some((item) => item.id === line.productId),
      );
      if (missingLine) {
        toast.error(isRtl ? `الصنف «${missingLine.productName}» لم يعد في المخزون` : `“${missingLine.productName}” is no longer in stock`);
        return;
      }

      const stockLines = plan.lines
        .filter((line) => line.action === 'update' && line.movement)
        .map((line) => ({
          productId: line.productId,
          productName: line.productName,
          expectedQty: line.expectedQty,
          actualQty: line.actualQty,
          movementLabel: `${line.movement} ${audit.auditNumber}`,
        }));

      // Claim/seal first so a second device cannot also apply the same draft.
      const cloud = await completeAuditCloudWithRetry(audit.id);
      if (!stocktakeClaimAllowsStock(cloud)) {
        toast.error(isRtl
          ? 'تعذّر إغلاق الجرد على الخادم؛ لم يتغيّر المخزون. أعد المحاولة بعد استقرار الاتصال.'
          : 'Could not close the stocktake on the server; stock was not changed. Retry when the connection is stable.');
        return;
      }
      claimedOnServer = stocktakeClaimedOnServer(cloud);
      if (claimedOnServer) {
        markLocalCompleted(userId, audit.id);
      }

      try {
        if (stockLines.length) {
          await applyStocktake({ auditNumber: audit.auditNumber, lines: stockLines });
        }
      } catch (stockErr: any) {
        if (claimedOnServer) {
          setArchive(await loadAuditArchive(userId));
          setOpenReportId(audit.id);
          setTab('archive');
          setConfirmApply(false);
          setLines([]);
          setAudit(freshAudit(userId));
          toast.error(isRtl
            ? 'أُغلق الجرد على الخادم لكن تعذّر تحديث المخزون. راجع الكميات يدوياً أو أنشئ جرداً جديداً للفروقات.'
            : 'The stocktake was closed on the server, but stock could not be updated. Review quantities manually or start a new count for the gaps.',
            { duration: 12000 });
          return;
        }
        throw stockErr;
      }

      if (!claimedOnServer) {
        const sealed = markLocalCompleted(userId, audit.id);
        if (!sealed) {
          toast.error(isRtl
            ? 'اعتُمد المخزون، لكن تعذّر ختم الجرد على هذا الجهاز (الذاكرة ممتلئة؟). راجع السجل قبل أي إعادة تطبيق.'
            : 'Stock was applied, but this device could not seal the stocktake (storage full?). Review the archive before any re-apply.');
        } else {
          toast.success(isRtl ? 'اعتُمد الجرد وحُدّث المخزون' : 'Stocktake applied and stock was updated');
        }
      } else {
        toast.success(isRtl ? 'اعتُمد الجرد وحُدّث المخزون' : 'Stocktake applied and stock was updated');
      }
      setArchive(await loadAuditArchive(userId));
      setOpenReportId(audit.id);
      setTab('archive');
      setConfirmApply(false);
      setLines([]);
      setAudit(freshAudit(userId));
    } catch (err: any) {
      if (err?.code === 'stock-changed') {
        toast.error(err.message || (isRtl
          ? 'تغيّر المخزون بعد بدء الجرد؛ لم يُعتمد أي تعديل. حدّث المسجّل ثم أعد المحاولة.'
          : 'Stock changed after the count started; nothing was applied. Refresh the book and try again.'));
      } else if (err?.code === 'product-missing') {
        toast.error(err.message || (isRtl ? 'صنف في الجرد لم يعد موجوداً؛ لم يُعتمد أي تعديل.' : 'A counted product is gone; nothing was applied.'));
      } else if (!err?.notified) {
        toast.error(isRtl
          ? 'تعذّر اعتماد الجرد؛ لم يتغيّر المخزون. يمكنك إعادة المحاولة بأمان.'
          : 'Could not apply the stocktake; stock was not changed. You can safely retry.');
      }
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
    if (busy) return;
    if (!window.confirm(isRtl ? 'حذف مسودة الجرد هذه نهائياً؟' : 'Delete this stocktake draft permanently?')) return;
    setBusy(true);
    try {
      await deleteAuditDraft(userId, auditId);
      setArchive(await loadAuditArchive(userId));
      if (audit.id === auditId) {
        setAudit(freshAudit(userId));
        setLines([]);
      }
    } catch {
      toast.error(isRtl ? 'تعذّر حذف المسودة. حاول مرة أخرى.' : 'Could not delete the draft. Try again.');
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
                      <span className="font-bold">
                        {product.name}
                        {product.warehouseId && (
                          <span className="ms-2 text-[11px] font-semibold text-slate-400">
                            {warehouses.find((w) => w.id === product.warehouseId)?.name || ''}
                          </span>
                        )}
                      </span>
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
                  const product = catalog.find((p) => p.id === line.productId);
                  const pack = product ? productPack(product) : null;
                  const counted = Number.isFinite(line.actualQty) ? splitPacks(line.actualQty, pack?.size ?? 0) : null;
                  const countInput = 'rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-2 py-1 text-end font-mono font-bold';
                  return (
                    <tr key={line.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="px-3 py-3">
                        <div className="font-bold">{line.productName}</div>
                        <div className="text-xs text-slate-400 font-mono">{line.sku}</div>
                      </td>
                      <td className="px-3 py-3 text-end font-mono">
                        {line.expectedQty}
                        {product && pack && (
                          <div className="text-[10px] font-bold text-slate-400 whitespace-nowrap">{formatPackStock(line.expectedQty, product, isRtl)}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-end">
                        {product && pack ? (
                          <div className="flex flex-col items-end gap-1">
                            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={counted ? counted.packs : ''}
                                onChange={(event) => {
                                  const packs = Math.max(0, Math.floor(Number(event.target.value) || 0));
                                  setActual(line.productId, String(packs * pack.size + (counted?.loose ?? 0)));
                                }}
                                className={`w-14 ${countInput}`}
                              />
                              {pack.name || (isRtl ? 'عبوة' : 'pack')}
                            </label>
                            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={counted ? counted.loose : ''}
                                onChange={(event) => {
                                  const loose = Math.max(0, Number(event.target.value) || 0);
                                  setActual(line.productId, String((counted?.packs ?? 0) * pack.size + loose));
                                }}
                                className={`w-14 ${countInput}`}
                              />
                              {product.unitName?.trim() || (isRtl ? 'وحدة' : 'unit')}
                            </label>
                            <span className="text-[10px] font-mono text-slate-400">= {Number.isFinite(line.actualQty) ? line.actualQty : '—'}</span>
                          </div>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={Number.isFinite(line.actualQty) ? line.actualQty : ''}
                            onChange={(event) => setActual(line.productId, event.target.value)}
                            className={`w-16 ${countInput}`}
                          />
                        )}
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
                disabled={busy || lines.length === 0}
                onClick={refreshBookQuantities}
                className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3 text-sm font-bold disabled:opacity-50"
                title={isRtl ? 'مزامنة عمود المسجّل مع كميات المخزون الحالية' : 'Sync the book column with current stock quantities'}
              >
                {isRtl ? 'تحديث المسجّل' : 'Refresh book'}
              </button>
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
                                  {formatMoney(auditVarianceValue(difference, line.unitCost, line.currency || settings.currency), line.currency || settings.currency, isRtl ? 'ar' : 'en-US')}
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
                        <button type="button" disabled={busy} onClick={() => removeDraft(stored.audit.id)} className="rounded-xl px-4 py-2 text-sm font-bold text-rose-600 disabled:opacity-50">
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
