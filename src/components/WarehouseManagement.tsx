import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  Building2,
  Calendar,
  Coins,
  Edit2,
  FileBox,
  GitBranch,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AppSettings, Language, Product, Warehouse } from '../types';
import { useFirebase } from './FirebaseProvider';
import { matchesQuery } from '../lib/search';
import { formatCurrencyTotals } from '../lib/invoiceDocument';
import { formatMoney } from '../lib/exchangeRates';
import { arCount } from '../lib/arabicPlural';
import { roundQty } from '../lib/stock';
import {
  NO_WAREHOUSE,
  canDeleteWarehouse,
  deleteBlockers,
  isMainWarehouse,
  locationOf,
  orderWarehouses,
  transferCandidates,
  validateTransfer,
  validateWarehouse,
  warehouseStats,
  type TransferError,
  type WarehouseInputError,
} from '../lib/warehouses';

interface Props {
  language: Language;
  settings: AppSettings;
}

type TypeFilter = 'ALL' | 'MAIN' | 'SUB';

interface FormState {
  editing: Warehouse | null;
  name: string;
  location: string;
  parentId: string | null;
  error: WarehouseInputError | null;
}

interface TransferState {
  from: string;
  productId: string;
  to: string | null;
  qty: string;
  error: TransferError | null;
}

const inputClass =
  'w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/50 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-950 outline-none rounded-2xl px-4 py-3 text-sm font-bold transition placeholder:font-medium placeholder:text-slate-400';
const labelClass = 'text-xs font-extrabold text-slate-500 dark:text-slate-400 block';

const errorMessage = (error: unknown, fallback: string) =>
  error && typeof error === 'object' && 'notified' in error ? null : (error as Error)?.message || fallback;

export default function WarehouseManagement({ language, settings }: Props) {
  const isRtl = language === 'ar';
  const locale = isRtl ? 'ar' : 'en';
  const { warehouses = [], products = [], saveWarehouse, deleteWarehouse, transferStock } = useFirebase();
  const defaultCurrency = settings.currency || 'JOD';

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<Warehouse | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [busy, setBusy] = useState(false);

  const qtyText = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(roundQty(n));
  const itemCount = (n: number) =>
    isRtl
      ? arCount(n, { zero: 'لا أصناف', one: 'صنف واحد', two: 'صنفان', few: '{n} أصناف', many: '{n} صنفاً', other: '{n} صنف' })
      : `${n} ${n === 1 ? 'item' : 'items'}`;
  const branchCount = (n: number) =>
    isRtl
      ? arCount(n, { one: 'فرع واحد', two: 'فرعان', few: '{n} فروع', many: '{n} فرعاً', other: '{n} فرع' })
      : `${n} ${n === 1 ? 'branch' : 'branches'}`;
  const dateText = (at: number) =>
    Number.isFinite(at) && at > 0
      ? new Intl.DateTimeFormat(isRtl ? 'ar-u-nu-latn' : 'en-GB', { dateStyle: 'medium' }).format(at)
      : '—';

  const generalName = isRtl ? 'المخزون العام (بدون مستودع)' : 'General stock (no warehouse)';
  const nameOf = (id: string) => (id === NO_WAREHOUSE ? generalName : warehouses.find((w) => w.id === id)?.name || '—');

  const ordered = useMemo(() => orderWarehouses(warehouses, locale), [warehouses, locale]);
  const statsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof warehouseStats>>();
    for (const w of warehouses) map.set(w.id, warehouseStats(products, w.id, defaultCurrency));
    map.set(NO_WAREHOUSE, warehouseStats(products, NO_WAREHOUSE, defaultCurrency));
    return map;
  }, [warehouses, products, defaultCurrency]);

  const mainCount = warehouses.filter((w) => isMainWarehouse(w, warehouses)).length;
  const assignedStocked = products.filter((p) => locationOf(p) !== NO_WAREHOUSE && Number(p.quantity) > 0).length;
  const general = statsById.get(NO_WAREHOUSE)!;

  const visible = ordered.filter((w) => {
    if (!matchesQuery([w.name, w.location], searchQuery)) return false;
    const main = isMainWarehouse(w, warehouses);
    return typeFilter === 'ALL' || (typeFilter === 'MAIN' ? main : !main);
  });

  // ----- Warehouse form -----
  const openForm = (wh: Warehouse | null) => {
    const parentExists = !!wh?.parentId && warehouses.some((w) => w.id === wh.parentId);
    setForm({
      editing: wh,
      name: wh?.name || '',
      location: wh?.location || '',
      parentId: parentExists ? wh!.parentId : null,
      error: null,
    });
  };

  const parentOptions = form
    ? ordered.filter((w) => isMainWarehouse(w, warehouses) && w.id !== form.editing?.id)
    : [];
  const editingHasBranches = !!form?.editing && warehouses.some((w) => w.parentId === form.editing!.id);

  const formErrorText: Record<WarehouseInputError, string> = {
    name: isRtl ? 'أدخل اسم المستودع (حتى 80 حرفاً).' : 'Enter the warehouse name (up to 80 characters).',
    duplicate: isRtl ? 'يوجد مستودع بهذا الاسم مسبقاً.' : 'A warehouse with this name already exists.',
    parent: isRtl ? 'اختر مستودعاً رئيسياً موجوداً.' : 'Choose an existing main warehouse.',
    has_children: isRtl ? 'لهذا المستودع فروع، فلا يمكن جعله فرعاً. انقل فروعه أولاً.' : 'This warehouse has branches, so it cannot become a branch. Move its branches first.',
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const error = validateWarehouse({ name: form.name, parentId: form.parentId }, warehouses, form.editing?.id || null);
    if (error) {
      setForm({ ...form, error });
      return;
    }
    setBusy(true);
    try {
      await saveWarehouse({
        id: form.editing?.id || `WH_${crypto.randomUUID()}`,
        name: form.name.trim(),
        location: form.location.trim(),
        parentId: form.parentId,
        createdAt: form.editing?.createdAt || Date.now(),
      });
      toast.success(isRtl ? `حُفظ المستودع «${form.name.trim()}»` : `Saved “${form.name.trim()}”`);
      setForm(null);
    } catch (err) {
      const message = errorMessage(err, isRtl ? 'تعذّر حفظ المستودع.' : 'Could not save the warehouse.');
      if (message) toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  // ----- Delete -----
  const confirmDelete = async () => {
    if (!deleting) return;
    if (!canDeleteWarehouse(deleteBlockers(deleting.id, warehouses, products))) return;
    setBusy(true);
    try {
      await deleteWarehouse(deleting.id);
      toast.success(isRtl ? `حُذف المستودع «${deleting.name}»` : `Deleted “${deleting.name}”`);
      if (detailId === deleting.id) setDetailId(null);
      setDeleting(null);
    } catch (err) {
      const message = errorMessage(err, isRtl ? 'تعذّر حذف المستودع.' : 'Could not delete the warehouse.');
      if (message) toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  // ----- Transfer -----
  const openTransfer = (from: string = NO_WAREHOUSE, productId = '') =>
    setTransfer({ from, productId, to: null, qty: '', error: null });

  const transferProduct = transfer ? products.find((p) => p.id === transfer.productId) : undefined;
  const candidates = useMemo(() => (transfer ? transferCandidates(products, transfer.from, locale) : []), [products, transfer?.from, locale]);
  const transferQty = transfer && transfer.qty.trim() !== '' ? Number(transfer.qty) : Number.NaN;

  const transferErrorText: Record<TransferError, string> = {
    product: isRtl ? 'اختر الصنف.' : 'Choose the item.',
    same: isRtl ? 'اختر وجهة مختلفة عن المصدر.' : 'Choose a destination other than the source.',
    quantity: isRtl ? 'أدخل كمية أكبر من صفر.' : 'Enter a quantity above zero.',
    exceeds: isRtl ? 'الكمية أكبر من المتوفر في المصدر.' : 'More than is available at the source.',
  };

  const submitTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!transfer) return;
    if (transfer.to === null) {
      setTransfer({ ...transfer, error: 'same' });
      return;
    }
    const error = validateTransfer(transferProduct, transfer.to, transferQty);
    if (error) {
      setTransfer({ ...transfer, error });
      return;
    }
    setBusy(true);
    try {
      await transferStock(transferProduct!.id, transfer.to, roundQty(transferQty));
      toast.success(
        isRtl
          ? `نُقل ${qtyText(transferQty)} من «${transferProduct!.name}» إلى ${nameOf(transfer.to)}`
          : `Moved ${qtyText(transferQty)} of “${transferProduct!.name}” to ${nameOf(transfer.to)}`,
      );
      setTransfer(null);
    } catch (err) {
      const message = errorMessage(err, isRtl ? 'تعذّر نقل المخزون.' : 'Could not transfer stock.');
      if (message) toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const locationOptions = (exclude?: string) => (
    <>
      {exclude !== NO_WAREHOUSE && <option value={NO_WAREHOUSE}>{generalName}</option>}
      {ordered
        .filter((w) => w.id !== exclude)
        .map((w) => (
          <option key={w.id} value={w.id}>
            {isMainWarehouse(w, warehouses) ? '' : '— '}
            {w.name}
          </option>
        ))}
    </>
  );

  // ----- Rendering helpers -----
  const statTile = (icon: React.ReactNode, value: React.ReactNode, label: string) => (
    <div className="min-w-0 text-center space-y-0.5">
      <div className="text-slate-400 flex justify-center">{icon}</div>
      <div className="text-xs font-bold text-slate-900 dark:text-white tabular-nums break-words">{value}</div>
      <div className="text-[10px] font-medium text-slate-400">{label}</div>
    </div>
  );

  const modal = (onClose: () => void, children: React.ReactNode, label: string) =>
    createPortal(
      <div className="fixed inset-0 z-[300] bg-slate-950/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !busy && onClose()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          dir={isRtl ? 'rtl' : 'ltr'}
          onClick={(event) => event.stopPropagation()}
          className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5 text-sm"
        >
          {children}
        </div>
      </div>,
      document.body,
    );

  const modalHeader = (title: React.ReactNode, onClose: () => void) => (
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-lg font-black text-slate-900 dark:text-white">{title}</h2>
      <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5" aria-label={isRtl ? 'إغلاق' : 'Close'}>
        <X size={18} />
      </button>
    </div>
  );

  const detailWarehouse = detailId && detailId !== NO_WAREHOUSE ? warehouses.find((w) => w.id === detailId) || null : null;
  const detailProducts = useMemo(() => {
    if (detailId === null) return [];
    return products
      .filter((p) => locationOf(p) === detailId)
      .filter((p) => matchesQuery([p.name, p.sku, p.category, p.brand], detailSearch))
      .sort((a, b) => Number(b.quantity > 0) - Number(a.quantity > 0) || a.name.localeCompare(b.name, locale));
  }, [products, detailId, detailSearch, locale]);

  const openDetail = (id: string) => {
    setDetailSearch('');
    setDetailId(id);
  };

  return (
    <div className="space-y-6 animate-fade-in" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl text-indigo-600 dark:text-indigo-400">
            <Building2 size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">{isRtl ? 'إدارة المستودعات' : 'Warehouses'}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {isRtl ? 'المستودعات الرئيسية وفروعها، والبضاعة في كل مستودع، والنقل بينها.' : 'Main warehouses and their branches, the stock in each, and transfers between them.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={() => openTransfer()}
            className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200"
          >
            <ArrowRightLeft size={17} />
            {isRtl ? 'نقل مخزون' : 'Transfer stock'}
          </button>
          <button
            type="button"
            onClick={() => openForm(null)}
            className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white"
          >
            <Plus size={17} />
            {isRtl ? 'مستودع جديد' : 'New warehouse'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900 p-3 sm:p-5">
          <div className="text-[11px] sm:text-xs font-bold text-slate-400">{isRtl ? 'المستودعات' : 'Warehouses'}</div>
          <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white tabular-nums mt-1">{warehouses.length}</div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5">
            {isRtl ? `${mainCount} رئيسي · ${warehouses.length - mainCount} فرعي` : `${mainCount} main · ${warehouses.length - mainCount} branch`}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900 p-3 sm:p-5">
          <div className="text-[11px] sm:text-xs font-bold text-slate-400">{isRtl ? 'أصناف في المستودعات' : 'Items in warehouses'}</div>
          <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white tabular-nums mt-1">{assignedStocked}</div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5">{isRtl ? 'برصيد أكبر من صفر' : 'with stock on hand'}</div>
        </div>
        <button
          type="button"
          onClick={() => openDetail(NO_WAREHOUSE)}
          className="text-start rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900 p-3 sm:p-5 hover:border-indigo-300"
        >
          <div className="text-[11px] sm:text-xs font-bold text-slate-400">{isRtl ? 'بدون مستودع' : 'No warehouse'}</div>
          <div className={`text-xl sm:text-3xl font-black tabular-nums mt-1 ${general.stocked > 0 ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>{general.stocked}</div>
          <div className="text-[10px] sm:text-xs text-indigo-600 mt-0.5">{isRtl ? 'عرض الأصناف' : 'View items'}</div>
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900 p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={isRtl ? 'ابحث باسم المستودع أو موقعه' : 'Search by name or location'}
            aria-label={isRtl ? 'ابحث باسم المستودع أو موقعه' : 'Search by name or location'}
            className={`${inputClass} ps-10 py-2.5`}
          />
        </div>
        <div className="flex gap-2">
          {(['ALL', 'MAIN', 'SUB'] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={typeFilter === type}
              onClick={() => setTypeFilter(type)}
              className={`flex-1 sm:flex-initial text-xs font-bold px-4 py-2.5 rounded-xl ${
                typeFilter === type ? 'bg-indigo-600 text-white' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {type === 'ALL' ? (isRtl ? 'الكل' : 'All') : type === 'MAIN' ? (isRtl ? 'الرئيسية' : 'Main') : (isRtl ? 'الفرعية' : 'Branches')}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-10 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
          <Building2 size={40} className="text-indigo-400 mb-3" />
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
            {warehouses.length === 0 ? (isRtl ? 'لا توجد مستودعات بعد' : 'No warehouses yet') : (isRtl ? 'لا توجد مستودعات مطابقة' : 'No matching warehouses')}
          </h3>
          <p className="text-sm text-slate-500 max-w-md">
            {warehouses.length === 0
              ? (isRtl ? 'أضف مستودعك الأول من زر «مستودع جديد»، ثم حدّد مستودع كل صنف من شاشة المخزون أو انقل إليه البضاعة.' : 'Add your first warehouse, then set each item’s warehouse from Inventory or transfer stock into it.')
              : (isRtl ? 'غيّر البحث أو التصفية.' : 'Change the search or filter.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((wh) => {
            const stats = statsById.get(wh.id)!;
            const main = isMainWarehouse(wh, warehouses);
            const orphan = !!wh.parentId && main;
            const parent = !main ? warehouses.find((w) => w.id === wh.parentId) : undefined;
            const branches = main ? warehouses.filter((w) => w.parentId === wh.id).length : 0;
            return (
              <div
                key={wh.id}
                onClick={() => openDetail(wh.id)}
                className={`group relative cursor-pointer rounded-3xl border bg-white dark:bg-slate-900 p-5 flex flex-col gap-4 hover:shadow-md transition-shadow ${
                  main ? 'border-slate-200/70 dark:border-white/10' : 'border-amber-200/70 dark:border-amber-500/20 md:ms-4'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${
                      main ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                    }`}
                  >
                    {main ? <Building2 size={12} /> : <GitBranch size={12} />}
                    {main
                      ? (isRtl ? 'رئيسي' : 'Main') + (branches ? ` · ${branchCount(branches)}` : '')
                      : (isRtl ? `فرع من ${parent?.name}` : `Branch of ${parent?.name}`)}
                  </span>
                  <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openForm(wh)}
                      className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"
                      aria-label={isRtl ? `تعديل ${wh.name}` : `Edit ${wh.name}`}
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(wh)}
                      className="p-2 rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                      aria-label={isRtl ? `حذف ${wh.name}` : `Delete ${wh.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1 min-w-0">
                  <h3 className="text-base font-black text-slate-900 dark:text-white break-words">{wh.name}</h3>
                  {wh.location && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <MapPin size={13} className="shrink-0" />
                      <span className="truncate">{wh.location}</span>
                    </div>
                  )}
                  {orphan && (
                    <div className="text-[11px] font-bold text-amber-600">{isRtl ? 'مستودعه الرئيسي حُذف؛ يُعامل كمستودع رئيسي.' : 'Its main warehouse was deleted; shown as main.'}</div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 dark:border-white/5">
                  {statTile(<Boxes size={16} />, stats.stocked, isRtl ? 'أصناف برصيد' : 'stocked items')}
                  {statTile(<FileBox size={16} />, qtyText(stats.quantity), isRtl ? 'مجموع الكميات' : 'total quantity')}
                  {statTile(
                    <Coins size={16} />,
                    formatCurrencyTotals(stats.valueAtCost, '—'),
                    isRtl ? `القيمة بالتكلفة${stats.missingCost ? ' *' : ''}` : `value at cost${stats.missingCost ? ' *' : ''}`,
                  )}
                </div>
                {stats.missingCost > 0 && (
                  <div className="text-[11px] text-amber-600 -mt-2">
                    * {isRtl ? `${itemCount(stats.missingCost)} بلا تكلفة، فالقيمة أقل من الحقيقة.` : `${itemCount(stats.missingCost)} without cost; value is understated.`}
                  </div>
                )}

                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-auto">
                  <Calendar size={12} />
                  {isRtl ? 'أُنشئ' : 'Created'} {dateText(wh.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailId !== null && modal(() => setDetailId(null), (() => {
        const stats = statsById.get(detailId) || warehouseStats(products, detailId, defaultCurrency);
        const main = detailWarehouse ? isMainWarehouse(detailWarehouse, warehouses) : true;
        const parent = detailWarehouse && !main ? warehouses.find((w) => w.id === detailWarehouse.parentId) : undefined;
        const branches = detailWarehouse && main ? ordered.filter((w) => w.parentId === detailWarehouse.id) : [];
        return (
          <>
            {modalHeader(
              <>
                {detailWarehouse ? detailWarehouse.name : generalName}
                <span className="block text-xs font-bold text-slate-400 mt-1">
                  {detailWarehouse
                    ? main ? (isRtl ? 'مستودع رئيسي' : 'Main warehouse') : (isRtl ? `فرع من ${parent?.name}` : `Branch of ${parent?.name}`)
                    : (isRtl ? 'أصناف لم يُحدَّد لها مستودع' : 'Items with no warehouse set')}
                  {detailWarehouse?.location ? ` · ${detailWarehouse.location}` : ''}
                </span>
              </>,
              () => setDetailId(null),
            )}

            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 dark:bg-white/5 p-3">
              {statTile(<Boxes size={16} />, stats.stocked, isRtl ? 'أصناف برصيد' : 'stocked items')}
              {statTile(<FileBox size={16} />, qtyText(stats.quantity), isRtl ? 'مجموع الكميات' : 'total quantity')}
              {statTile(<Coins size={16} />, formatCurrencyTotals(stats.valueAtCost, '—'), isRtl ? 'القيمة بالتكلفة' : 'value at cost')}
            </div>
            {(stats.missingCost > 0 || stats.empty > 0) && (
              <div className="space-y-1 text-xs text-amber-600">
                {stats.missingCost > 0 && <div>{isRtl ? `${itemCount(stats.missingCost)} بلا تكلفة، فالقيمة أقل من الحقيقة.` : `${itemCount(stats.missingCost)} without cost; value is understated.`}</div>}
                {stats.empty > 0 && <div className="text-slate-400">{isRtl ? `${itemCount(stats.empty)} برصيد صفر مسجّلة هنا.` : `${itemCount(stats.empty)} with zero stock are assigned here.`}</div>}
              </div>
            )}

            {branches.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-bold text-slate-500">{isRtl ? 'الفروع' : 'Branches'}</h3>
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => (
                    <button key={b.id} type="button" onClick={() => openDetail(b.id)} className="rounded-xl border border-amber-200 dark:border-amber-500/30 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                      <GitBranch size={12} />
                      {b.name} · {itemCount(statsById.get(b.id)?.stocked ?? 0)}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-500">{isRtl ? 'البضاعة' : 'Stock'}</h3>
                {stats.stocked > 0 && (
                  <button
                    type="button"
                    onClick={() => openTransfer(detailId)}
                    className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <ArrowRightLeft size={13} />
                    {isRtl ? 'نقل من هنا' : 'Move out'}
                  </button>
                )}
              </div>
              {stats.stocked + stats.empty > 6 && (
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    value={detailSearch}
                    onChange={(event) => setDetailSearch(event.target.value)}
                    placeholder={isRtl ? 'ابحث بالاسم أو الباركود' : 'Search by name or barcode'}
                    aria-label={isRtl ? 'ابحث بالاسم أو الباركود' : 'Search by name or barcode'}
                    className={`${inputClass} ps-9 py-2`}
                  />
                </div>
              )}
              {detailProducts.length === 0 ? (
                <p className="text-center text-slate-400 py-6">{isRtl ? 'لا توجد أصناف هنا.' : 'No items here.'}</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-2xl border border-slate-100 dark:border-white/5">
                  {detailProducts.map((p: Product) => {
                    const qty = Number(p.quantity) || 0;
                    const cost = Number(p.unitCost ?? p.costPrice) || 0;
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="font-bold truncate">{p.name}</div>
                          <div className="text-[11px] font-mono text-slate-400 truncate" dir="ltr">{p.sku || '—'}</div>
                        </div>
                        <div className="text-end shrink-0">
                          <div className={`font-black tabular-nums ${qty > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-300 dark:text-slate-600'}`}>{qtyText(qty)}</div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            {qty > 0 && cost > 0 ? formatMoney(roundQty(qty) * cost, p.currency || defaultCurrency) : qty > 0 ? (isRtl ? 'بلا تكلفة' : 'no cost') : ''}
                          </div>
                        </div>
                        {qty > 0 && (
                          <button
                            type="button"
                            onClick={() => openTransfer(detailId, p.id)}
                            className="shrink-0 p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-white/5"
                            aria-label={isRtl ? `نقل ${p.name}` : `Move ${p.name}`}
                          >
                            <ArrowRightLeft size={15} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {detailWarehouse && (
              <div className="flex gap-2">
                <button type="button" onClick={() => openForm(detailWarehouse)} className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5">
                  <Edit2 size={13} />
                  {isRtl ? 'تعديل البيانات' : 'Edit details'}
                </button>
                <button type="button" onClick={() => setDeleting(detailWarehouse)} className="rounded-xl border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-600 inline-flex items-center gap-1.5">
                  <Trash2 size={13} />
                  {isRtl ? 'حذف المستودع' : 'Delete warehouse'}
                </button>
              </div>
            )}
          </>
        );
      })(), isRtl ? 'تفاصيل المستودع' : 'Warehouse details')}

      {form && modal(() => setForm(null), (
        <form onSubmit={submitForm} className="space-y-5">
          {modalHeader(form.editing ? (isRtl ? `تعديل «${form.editing.name}»` : `Edit “${form.editing.name}”`) : (isRtl ? 'مستودع جديد' : 'New warehouse'), () => setForm(null))}
          <label className="space-y-1.5 block">
            <span className={labelClass}>{isRtl ? 'اسم المستودع' : 'Warehouse name'} *</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value, error: null })}
              placeholder={isRtl ? 'مثال: المخزن الرئيسي' : 'e.g. Main store'}
              className={inputClass}
              maxLength={80}
              autoFocus
            />
          </label>
          <label className="space-y-1.5 block">
            <span className={labelClass}>{isRtl ? 'الموقع أو العنوان (اختياري)' : 'Location (optional)'}</span>
            <input
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
              placeholder={isRtl ? 'مثال: المنطقة الصناعية، نابلس' : 'e.g. Industrial zone'}
              className={`${inputClass} font-medium`}
              maxLength={160}
            />
          </label>
          <div className="space-y-1.5">
            <span className={labelClass}>{isRtl ? 'النوع' : 'Type'}</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, parentId: null, error: null })}
                className={`rounded-2xl border-2 px-3 py-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 ${
                  form.parentId === null ? 'border-indigo-600 bg-indigo-50/60 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300' : 'border-slate-200 dark:border-white/10 text-slate-500'
                }`}
              >
                <Building2 size={15} />
                {isRtl ? 'رئيسي' : 'Main'}
              </button>
              <button
                type="button"
                disabled={parentOptions.length === 0 || editingHasBranches}
                onClick={() => setForm({ ...form, parentId: form.parentId ?? parentOptions[0]?.id ?? null, error: null })}
                className={`rounded-2xl border-2 px-3 py-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-40 ${
                  form.parentId !== null ? 'border-indigo-600 bg-indigo-50/60 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300' : 'border-slate-200 dark:border-white/10 text-slate-500'
                }`}
              >
                <GitBranch size={15} />
                {isRtl ? 'فرع من مستودع رئيسي' : 'Branch of a main warehouse'}
              </button>
            </div>
            {parentOptions.length === 0 && <p className="text-xs text-slate-400">{isRtl ? 'أضف مستودعاً رئيسياً أولاً لتتمكن من إنشاء فروع.' : 'Add a main warehouse first to create branches.'}</p>}
            {editingHasBranches && <p className="text-xs text-slate-400">{isRtl ? 'لهذا المستودع فروع، فيبقى رئيسياً.' : 'This warehouse has branches, so it stays main.'}</p>}
          </div>
          {form.parentId !== null && (
            <label className="space-y-1.5 block">
              <span className={labelClass}>{isRtl ? 'يتبع المستودع' : 'Belongs to'}</span>
              <select value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value, error: null })} className={inputClass}>
                {parentOptions.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}{w.location ? ` (${w.location})` : ''}</option>
                ))}
              </select>
            </label>
          )}
          {form.error && <p className="text-sm font-bold text-rose-600">{formErrorText[form.error]}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setForm(null)} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold">
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" disabled={busy} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50">
              {busy ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…') : (isRtl ? 'حفظ' : 'Save')}
            </button>
          </div>
        </form>
      ), isRtl ? 'بيانات المستودع' : 'Warehouse form')}

      {deleting && modal(() => setDeleting(null), (() => {
        const blockers = deleteBlockers(deleting.id, warehouses, products);
        const allowed = canDeleteWarehouse(blockers);
        return (
          <>
            {modalHeader(isRtl ? `حذف «${deleting.name}»؟` : `Delete “${deleting.name}”?`, () => setDeleting(null))}
            {allowed ? (
              <p className="text-slate-600 dark:text-slate-300">{isRtl ? 'المستودع فارغ وليس له فروع. لن يتأثر أي صنف.' : 'The warehouse is empty and has no branches. No item is affected.'}</p>
            ) : (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 p-4 space-y-2">
                <div className="font-bold text-amber-800 dark:text-amber-200 inline-flex items-center gap-1.5">
                  <AlertTriangle size={16} />
                  {isRtl ? 'لا يمكن حذفه الآن' : 'It cannot be deleted yet'}
                </div>
                <ul className="list-disc ps-5 space-y-1 text-amber-900 dark:text-amber-100 text-xs">
                  {blockers.children > 0 && <li>{isRtl ? `له ${branchCount(blockers.children)}: اجعلها رئيسية أو انقلها لمستودع آخر من زر التعديل.` : `It has ${branchCount(blockers.children)}: make them main or move them under another warehouse.`}</li>}
                  {blockers.stocked > 0 && <li>{isRtl ? `فيه ${itemCount(blockers.stocked)} برصيد: انقلها إلى مستودع آخر أولاً.` : `It holds ${itemCount(blockers.stocked)} with stock: transfer them out first.`}</li>}
                  {blockers.empty > 0 && <li>{isRtl ? `مسجّل عليه ${itemCount(blockers.empty)} برصيد صفر: غيّر مستودعها أو احذفها من شاشة المخزون.` : `${itemCount(blockers.empty)} with zero stock are assigned here: change their warehouse or delete them in Inventory.`}</li>}
                </ul>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setDeleting(null)} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold">
                {isRtl ? 'رجوع' : 'Back'}
              </button>
              {allowed ? (
                <button type="button" onClick={confirmDelete} disabled={busy} className="rounded-xl bg-rose-600 text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50">
                  {busy ? (isRtl ? 'جارٍ الحذف…' : 'Deleting…') : (isRtl ? 'حذف' : 'Delete')}
                </button>
              ) : (blockers.stocked > 0 || blockers.empty > 0) && (
                <button type="button" onClick={() => { const id = deleting.id; setDeleting(null); openDetail(id); }} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold">
                  {isRtl ? 'عرض الأصناف' : 'View items'}
                </button>
              )}
            </div>
          </>
        );
      })(), isRtl ? 'حذف مستودع' : 'Delete warehouse')}

      {transfer && modal(() => setTransfer(null), (
        <form onSubmit={submitTransfer} className="space-y-5">
          {modalHeader(
            <span className="inline-flex items-center gap-2">
              <ArrowRightLeft size={19} className="text-indigo-600" />
              {isRtl ? 'نقل مخزون بين المستودعات' : 'Transfer stock'}
            </span>,
            () => setTransfer(null),
          )}
          <label className="space-y-1.5 block">
            <span className={labelClass}>{isRtl ? 'من' : 'From'}</span>
            <select
              value={transfer.from}
              onChange={(event) => setTransfer({ from: event.target.value, productId: '', to: null, qty: '', error: null })}
              className={inputClass}
            >
              {locationOptions()}
            </select>
          </label>
          <label className="space-y-1.5 block">
            <span className={labelClass}>{isRtl ? 'الصنف' : 'Item'}</span>
            {candidates.length === 0 ? (
              <p className="text-xs text-slate-400 rounded-2xl bg-slate-50 dark:bg-white/5 px-4 py-3">{isRtl ? 'لا توجد أصناف برصيد في هذا المكان.' : 'No stocked items at this location.'}</p>
            ) : (
              <select
                value={transfer.productId}
                onChange={(event) => setTransfer({ ...transfer, productId: event.target.value, qty: '', error: null })}
                className={inputClass}
              >
                <option value="">{isRtl ? 'اختر الصنف' : 'Choose the item'}</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.sku ? ` · ${p.sku}` : ''} — {isRtl ? 'المتوفر' : 'available'} {qtyText(Number(p.quantity))}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="space-y-1.5 block">
            <span className={labelClass}>{isRtl ? 'إلى' : 'To'}</span>
            <select
              value={transfer.to ?? '__unset__'}
              onChange={(event) => setTransfer({ ...transfer, to: event.target.value === '__unset__' ? null : event.target.value, error: null })}
              className={inputClass}
            >
              <option value="__unset__" disabled>{isRtl ? 'اختر الوجهة' : 'Choose the destination'}</option>
              {locationOptions(transfer.from)}
            </select>
          </label>
          <label className="space-y-1.5 block">
            <span className={`${labelClass} flex justify-between`}>
              <span>{isRtl ? 'الكمية' : 'Quantity'}</span>
              {transferProduct && (
                <span className="text-indigo-600 tabular-nums">{isRtl ? 'المتوفر' : 'Available'}: {qtyText(Number(transferProduct.quantity))}</span>
              )}
            </span>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={transfer.qty}
                onChange={(event) => setTransfer({ ...transfer, qty: event.target.value, error: null })}
                disabled={!transferProduct}
                className={`${inputClass} tabular-nums`}
                aria-label={isRtl ? 'الكمية المراد نقلها' : 'Quantity to move'}
              />
              {transferProduct && (
                <button
                  type="button"
                  onClick={() => setTransfer({ ...transfer, qty: String(roundQty(Number(transferProduct.quantity))), error: null })}
                  className="shrink-0 rounded-2xl border border-slate-200 dark:border-white/10 px-3 text-xs font-bold"
                >
                  {isRtl ? 'الكل' : 'All'}
                </button>
              )}
            </div>
            {transferProduct && Number.isFinite(transferQty) && transferQty > 0 && transferQty <= Number(transferProduct.quantity) && (
              <p className="text-xs text-slate-500 tabular-nums">
                {isRtl
                  ? `يبقى في ${nameOf(transfer.from)}: ${qtyText(Number(transferProduct.quantity) - transferQty)}`
                  : `Left at ${nameOf(transfer.from)}: ${qtyText(Number(transferProduct.quantity) - transferQty)}`}
              </p>
            )}
          </label>
          {transfer.error && <p className="text-sm font-bold text-rose-600">{transferErrorText[transfer.error]}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setTransfer(null)} className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold">
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" disabled={busy || !transferProduct} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50">
              {busy ? (isRtl ? 'جارٍ النقل…' : 'Moving…') : (isRtl ? 'نقل' : 'Move')}
            </button>
          </div>
        </form>
      ), isRtl ? 'نقل مخزون' : 'Transfer stock')}
    </div>
  );
}
