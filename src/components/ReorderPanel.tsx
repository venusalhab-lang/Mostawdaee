import { useMemo, useState } from 'react';
import { ClipboardList, Download, Search, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import type { Currency } from '../types';
import { formatMoney } from '../lib/exchangeRates';
import { resolveVatRate } from '../lib/invoiceTotals';
import { formatPackStock } from '../lib/packs';
import { estimateCost, groupBySupplier, planReorder, type ReorderLine, type SupplierGroup } from '../lib/reorder';
import { purchaseOrdersFromReorder } from '../lib/orders';
import { matchesQuery } from '../lib/search';
import { downloadCsv, toCsv } from '../lib/csv';

interface Props {
  isRtl: boolean;
  defaultCurrency: Currency;
  /** Called after purchase orders were saved, to show them. */
  onOrdersCreated: () => void;
}

const WINDOWS = [14, 30, 60, 90];
const COVERS = [7, 14, 30, 60];

export default function ReorderPanel({ isRtl, defaultCurrency, onOrdersCreated }: Props) {
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  const { products, invoices, warehouses, suppliers, orders, settings, saveOrder, can } = useFirebase();
  const canWrite = can('back_office');
  const [windowDays, setWindowDays] = useState(30);
  const [coverDays, setCoverDays] = useState(14);
  const [warehouseId, setWarehouseId] = useState('all');
  const [query, setQuery] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [supplierFor, setSupplierFor] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState<string | null>(null);

  const lines = useMemo(() => planReorder(
    warehouseId === 'all' ? products : products.filter((p) => p.warehouseId === warehouseId),
    invoices,
    { now: Date.now(), windowDays, coverDays, globalThreshold: settings?.lowStockThreshold, defaultCurrency },
  ), [products, invoices, windowDays, coverDays, warehouseId, settings?.lowStockThreshold, defaultCurrency]);

  const groups = useMemo(
    () => groupBySupplier(lines.filter((l) => matchesQuery([l.product.name, l.product.sku, l.last?.supplierName], query))),
    [lines, query],
  );

  const unitsOf = (line: ReorderLine) => qty[line.product.id] ?? line.suggestedUnits;
  const warehouseName = (id?: string) => warehouses.find((w) => w.id === id)?.name;
  const fmtDays = (d: number | null) => d === null ? L('لا مبيعات', 'No sales') : d < 1 ? L('أقل من يوم', '< 1 day') : L(`${Math.floor(d)} يوم`, `${Math.floor(d)} days`);
  const dayTone = (d: number | null) => d === null ? 'text-slate-500' : d <= 3 ? 'text-rose-600' : d <= 7 ? 'text-amber-600' : 'text-slate-700 dark:text-slate-200';

  const createOrders = async (group: SupplierGroup) => {
    const chosenId = supplierFor[group.key];
    const chosen = chosenId ? suppliers.find((s) => s.id === chosenId) : undefined;
    const supplierId = chosen?.id ?? group.supplierId;
    const supplierName = chosen?.name ?? group.supplierName;
    if (!supplierName) {
      toast.error(L('اختر المورد لهذه المجموعة أولاً.', 'Choose the supplier for this group first.'));
      return;
    }
    const picked = group.lines.map((line) => ({ line, units: unitsOf(line) })).filter((x) => x.units > 0);
    if (!picked.length) {
      toast.error(L('لا توجد كميات للطلب. اكتب كمية لصنف واحد على الأقل.', 'Nothing to order. Enter a quantity for at least one item.'));
      return;
    }
    setCreating(group.key);
    try {
      const made = purchaseOrdersFromReorder(
        { supplierId, supplierName, lines: picked, vatRate: resolveVatRate(settings?.defaultVatRate), now: Date.now() },
        orders,
        () => crypto.randomUUID(),
      );
      for (const order of made) await saveOrder(order);
      toast.success(made.length === 1
        ? L(`أُنشئ أمر الشراء ${made[0].number} كمسودة.`, `Purchase order ${made[0].number} created as a draft.`)
        : L(`أُنشئت ${made.length} أوامر شراء، واحد لكل عملة: ${made.map((o) => o.number).join('، ')}`, `${made.length} purchase orders created, one per currency: ${made.map((o) => o.number).join(', ')}`));
      onOrdersCreated();
    } catch (err: any) {
      if (!err?.notified) toast.error(err?.message || L('تعذّر إنشاء أمر الشراء.', 'Could not create the purchase order.'));
    } finally {
      setCreating(null);
    }
  };

  const exportCsv = () => {
    const head = isRtl
      ? ['الصنف', 'الرمز', 'المستودع', 'المتوفر', 'حد النقص', `المباع (${windowDays} يوم)`, 'المعدل اليومي', 'يكفي (يوم)', 'الكمية المقترحة', 'آخر مورد', 'تكلفة الوحدة', 'العملة']
      : ['Item', 'SKU', 'Warehouse', 'On hand', 'Low level', `Sold (${windowDays} d)`, 'Per day', 'Days left', 'Suggested', 'Last supplier', 'Unit cost', 'Currency'];
    const rows = lines.map((l) => [
      l.product.name, l.product.sku, warehouseName(l.product.warehouseId) || '', l.onHand, l.threshold, l.soldUnits,
      Math.round(l.perDay * 100) / 100, l.daysLeft === null ? '' : Math.floor(l.daysLeft), unitsOf(l), l.last?.supplierName || '',
      l.unitCost, l.costCurrency,
    ]);
    downloadCsv(toCsv([head, ...rows]), `reorder-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const select = 'py-2 px-3 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white';

  return (
    <div className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <p className="text-xs text-slate-500 leading-relaxed">
          {L('الكمية المقترحة = معدل البيع اليومي × أيام التغطية + حد نقص المخزون − المتوفر، مقرّبة لعبوات كاملة. المعدل من المبيعات الفعلية بعد خصم المرتجعات. الأصناف الناقصة التي لم تُبع في الفترة تظهر بلا اقتراح لتحدد كميتها بنفسك.',
            'Suggested = daily sales rate × days of cover + low-stock level − on hand, rounded up to whole packs. The rate comes from actual sales net of returns. Low items with no sales in the period are listed without a suggestion so you set the quantity.')}
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs font-bold text-slate-500 flex items-center gap-2">
            {L('حسب مبيعات آخر', 'Sales of the last')}
            <select className={select} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
              {WINDOWS.map((d) => <option key={d} value={d}>{L(`${d} يوم`, `${d} days`)}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-500 flex items-center gap-2">
            {L('اطلب ما يكفي', 'Order enough for')}
            <select className={select} value={coverDays} onChange={(e) => setCoverDays(Number(e.target.value))}>
              {COVERS.map((d) => <option key={d} value={d}>{L(`${d} يوم`, `${d} days`)}</option>)}
            </select>
          </label>
          {warehouses.length > 1 && (
            <select className={select} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label={L('المستودع', 'Warehouse')}>
              <option value="all">{L('كل المستودعات', 'All warehouses')}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L('بحث بالصنف أو المورد', 'Search item or supplier')} aria-label={L('بحث', 'Search')}
              className={`w-full ${select} ${isRtl ? 'pr-9' : 'pl-9'}`} />
          </div>
          {lines.length > 0 && (
            <button type="button" onClick={exportCsv} className="px-3 py-2 rounded-xl text-sm font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 inline-flex items-center gap-2">
              <Download size={15} /> CSV
            </button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center text-sm text-slate-500">
          <ClipboardList size={24} className="mx-auto mb-2 text-slate-400" />
          {L('لا شيء يحتاج إعادة طلب الآن: كل الأصناف فوق حد النقص وتكفي لفترة التغطية.', 'Nothing to reorder now: every item is above its low level and covers the period.')}
        </div>
      ) : groups.map((group) => {
        const cost = estimateCost(group.lines, (i) => unitsOf(group.lines[i]));
        const costText = Object.entries(cost).map(([c, v]) => formatMoney(v as number, c)).join(' · ');
        return (
          <section key={group.key} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                <Truck size={16} className="text-amber-600 shrink-0" />
                {group.supplierName && !supplierFor[group.key]
                  ? <span className="font-black text-slate-900 dark:text-white truncate">{group.supplierName}</span>
                  : null}
                {canWrite && (
                  <select className={`${select} py-1.5 text-xs`} value={supplierFor[group.key] || ''} aria-label={L('المورد', 'Supplier')}
                    onChange={(e) => setSupplierFor((m) => ({ ...m, [group.key]: e.target.value }))}>
                    <option value="">{group.supplierName ? L('تغيير المورد…', 'Change supplier…') : L('اختر المورد…', 'Choose supplier…')}</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {!group.supplierName && !canWrite && <span className="font-bold text-slate-500">{L('بلا مورد سابق', 'No previous supplier')}</span>}
              </div>
              <div className="flex items-center gap-3">
                {costText && <span className="text-xs text-slate-500">{L('التكلفة التقديرية', 'Estimated cost')}: <b className="font-mono text-slate-800 dark:text-slate-100" dir="ltr">{costText}</b></span>}
                {canWrite && (
                  <button type="button" disabled={creating === group.key} onClick={() => createOrders(group)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black inline-flex items-center gap-1.5 disabled:opacity-50">
                    <ClipboardList size={14} /> {creating === group.key ? L('جارٍ الإنشاء...', 'Creating...') : L('إنشاء أمر شراء', 'Create purchase order')}
                  </button>
                )}
              </div>
            </header>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {group.lines.map((line) => {
                const p = line.product;
                const packText = formatPackStock(line.onHand, p, isRtl);
                const units = unitsOf(line);
                const packs = line.packSize && units > 0 ? units / line.packSize : null;
                return (
                  <div key={p.id} className="px-4 py-3 grid grid-cols-2 md:grid-cols-12 gap-x-3 gap-y-1 items-center text-sm">
                    <div className="col-span-2 md:col-span-4 min-w-0">
                      <div className="font-bold text-slate-900 dark:text-white truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{[p.sku, warehouseName(p.warehouseId)].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="md:col-span-2 text-xs">
                      <span className="text-slate-500">{L('المتوفر', 'On hand')}: </span>
                      <b className={line.onHand <= line.threshold ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'}>{packText ?? line.onHand}</b>
                      <span className="text-slate-400"> / {line.threshold}</span>
                    </div>
                    <div className="md:col-span-2 text-xs text-slate-500">
                      {L(`باع ${line.soldUnits} في ${line.rateDays} يوم`, `Sold ${line.soldUnits} in ${line.rateDays} d`)}
                    </div>
                    <div className={`md:col-span-1 text-xs font-bold ${dayTone(line.daysLeft)}`}>{fmtDays(line.daysLeft)}</div>
                    <label className="md:col-span-2 flex items-center gap-2">
                      <span className="text-xs text-slate-500 md:sr-only">{L('اطلب', 'Order')}</span>
                      <input type="number" min={0} step={line.packSize || 1} value={units} disabled={!canWrite}
                        onChange={(e) => setQty((m) => ({ ...m, [p.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        aria-label={L(`كمية الطلب: ${p.name}`, `Order quantity: ${p.name}`)}
                        className="w-24 py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-white text-sm font-bold" />
                      {packs !== null && Number.isInteger(packs) && <span className="text-[11px] text-slate-500">= {packs} {p.packName || L('عبوة', 'pack')}</span>}
                    </label>
                    <div className="md:col-span-1 text-[11px] text-slate-500 font-mono text-end" dir="ltr">
                      {line.unitCost > 0 ? formatMoney(line.unitCost, line.costCurrency) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
