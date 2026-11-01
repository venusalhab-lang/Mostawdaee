import { useEffect, useMemo, useState } from 'react';
import { Barcode, ChevronLeft, ChevronRight, ClipboardCheck, ShoppingBag, Users } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AppSettings, Cheque, Currency, Customer, CustomerTransaction, Invoice, Language, PayrollRecord, Product, StockMovement, Vault, VaultTransaction,
} from '../types';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { formatMoney, POS_CURRENCY_CODES, roundMoney } from '../lib/exchangeRates';
import { readVaultBalances } from '../lib/vaultMath';
import { loadCheques } from '../lib/chequesStore';
import { OFFLINE_QUEUE_EVENT, belongsToStore, readQueue, type QueuedInvoice } from '../lib/offlineQueue';
import { requestInventoryIntent } from '../lib/inventoryIntent';
import type { Workspace } from '../lib/workspace';
import type { SellerContext } from '../lib/salesLog';
import SalesLogCard from './SalesLogCard';
import { CHEQUE_HORIZON_DAYS, EXPIRY_HORIZON_DAYS, STALE_DEBT_DAYS, type HomeTask, homeTasks } from '../lib/homeTasks';
import {
  amountInCurrency,
  asideMoney,
  compareAmounts,
  creditRows,
  outstandingDebts,
  periodWindow,
  recentActivity,
  salesChartSeries,
  salesCount,
  salesPulse,
  salesRows,
  startOfLocalDay,
  stockSnapshot,
  systemMoneyRow,
  vaultIncomeRows,
  type DeskActivity,
  type HomeRange,
  type MoneyRow,
  type SalesChartPoint,
  type SalesPulseTone,
} from '../lib/homeDesk';

const CURRENCY_NAMES: Record<string, { ar: string; en: string }> = {
  JOD: { ar: 'دينار أردني', en: 'Jordanian dinar' },
  ILS: { ar: 'شيكل', en: 'Shekel' },
  USD: { ar: 'دولار أمريكي', en: 'US dollar' },
  IQD: { ar: 'دينار عراقي', en: 'Iraqi dinar' },
  SAR: { ar: 'ريال سعودي', en: 'Saudi riyal' },
  AED: { ar: 'درهم إماراتي', en: 'UAE dirham' },
  LYD: { ar: 'دينار ليبي', en: 'Libyan dinar' },
  EGP: { ar: 'جنيه مصري', en: 'Egyptian pound' },
};

interface Props {
  language: Language;
  settings: AppSettings;
}

function openScreen(screen: string) {
  window.dispatchEvent(new CustomEvent('change-screen', { detail: screen }));
}

function openAddProduct() {
  requestInventoryIntent({ type: 'add' });
  openScreen('inventory');
}

function money(amount: number, currency: string, isRtl: boolean) {
  return formatMoney(amount, currency, isRtl ? 'ar' : 'en-US');
}

function Delta({ current, previous, isRtl }: { current: number; previous: number; isRtl: boolean }) {
  const comparison = compareAmounts(current, previous);
  const tone = comparison.tone === 'up'
    ? 'text-emerald-600'
    : comparison.tone === 'down'
      ? 'text-rose-600'
      : 'text-slate-400';
  const label = comparison.tone === 'new'
    ? (isRtl ? 'جديد' : 'New')
    : comparison.tone === 'flat'
      ? (isRtl ? 'بلا تغيّر' : 'No change')
      : `${comparison.percent! > 0 ? '+' : ''}${comparison.percent}%`;
  return <span className={`text-xs font-bold ${tone}`}>{label}</span>;
}

const PULSE_STYLE: Record<SalesPulseTone, { bar: string; text: string }> = {
  'strong-up': { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
  up: { bar: 'bg-emerald-400', text: 'text-emerald-700 dark:text-emerald-300' },
  flat: { bar: 'bg-slate-300 dark:bg-slate-600', text: 'text-slate-600 dark:text-slate-300' },
  down: { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  'strong-down': { bar: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300' },
  idle: { bar: 'bg-slate-200 dark:bg-slate-700', text: 'text-slate-500 dark:text-slate-400' },
  new: { bar: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300' },
};

function pulseWord(tone: SalesPulseTone, isRtl: boolean): string {
  const ar: Record<SalesPulseTone, string> = {
    'strong-up': 'ارتفاع واضح',
    up: 'ارتفاع',
    flat: 'ثابت',
    down: 'تراجع محدود',
    'strong-down': 'تراجع واضح',
    idle: 'لا مبيعات',
    new: 'بلا مدة مقابلة',
  };
  const en: Record<SalesPulseTone, string> = {
    'strong-up': 'Clear rise',
    up: 'Up',
    flat: 'Flat',
    down: 'Limited drop',
    'strong-down': 'Clear drop',
    idle: 'No sales',
    new: 'No baseline',
  };
  return (isRtl ? ar : en)[tone];
}

function PulseDelta({ tone, percent, isRtl }: { tone: SalesPulseTone; percent: number | null; isRtl: boolean }) {
  const label = percent === null
    ? pulseWord(tone, isRtl)
    : `${percent > 0 ? '+' : ''}${percent}% · ${pulseWord(tone, isRtl)}`;
  return <span className={`text-xs font-bold ${PULSE_STYLE[tone].text}`}>{label}</span>;
}

function QuickActions({
  actions,
  isRtl,
}: {
  actions: { id: string; icon: typeof Barcode; title: string; text: string }[];
  isRtl: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label={isRtl ? 'اختصارات' : 'Shortcuts'}>
      {actions.map((action) => {
        const Icon = action.icon;
        const primary = action.id === 'pos';
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => openScreen(action.id)}
            className={`rounded-3xl px-4 py-4 text-start transition-colors ${
              primary
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 col-span-2 lg:col-span-1'
                : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-indigo-700 dark:hover:bg-indigo-50'
            }`}
          >
            <Icon size={18} />
            <div className="mt-3 font-black">{action.title}</div>
            <div className="text-xs opacity-70">{action.text}</div>
          </button>
        );
      })}
    </div>
  );
}

function MoneyLines({ rows, isRtl, pulse }: { rows: MoneyRow[]; isRtl: boolean; pulse?: { tone: SalesPulseTone; percent: number | null } }) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={row.currency} className="flex items-baseline gap-3">
          <div className={index === 0 ? 'text-2xl font-black font-mono tracking-tight' : 'text-sm font-bold font-mono'}>
            {money(row.current, row.currency, isRtl)}
          </div>
          {pulse
            ? <PulseDelta tone={pulse.tone} percent={pulse.percent} isRtl={isRtl} />
            : <Delta current={row.current} previous={row.previous} isRtl={isRtl} />}
        </div>
      ))}
    </div>
  );
}

function SalesChart({
  points,
  currency,
  locale,
  today,
  isRtl,
  currentLabel,
  previousLabel,
}: {
  points: SalesChartPoint[];
  currency: string;
  locale: string;
  today: number;
  isRtl: boolean;
  currentLabel: string;
  previousLabel: string;
}) {
  const todayStart = startOfLocalDay(today);
  const byWeekday = points.length <= 8;
  const data = points.map((point) => ({
    ...point,
    tick: new Date(point.day).toLocaleDateString(locale, byWeekday
      ? { weekday: 'short' }
      : { day: 'numeric', month: 'short' }),
    full: new Date(point.day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' }),
    isToday: point.day === todayStart,
  }));
  const periodTotal = roundMoney(points.reduce((sum, point) => sum + point.amount, 0), currency);
  const hasSales = points.some((point) => point.amount > 0);
  const hasPrevious = points.some((point) => point.previous > 0);

  return (
    <div className="space-y-3" dir="ltr">
      <div className="h-56 w-full" role="img" aria-label={currentLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="homeSalesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="tick"
              tickLine={false}
              axisLine={false}
              minTickGap={12}
              tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              tickFormatter={(value: number) => (value === 0 ? '0' : String(value))}
            />
            <Tooltip
              cursor={{ stroke: '#818cf8', strokeWidth: 1, strokeDasharray: '4 4' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as typeof data[number] | undefined;
                if (!row) return null;
                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-lg text-xs space-y-1.5">
                    <div className="font-bold text-slate-700 dark:text-slate-200">
                      {row.full}{row.isToday ? (isRtl ? ' · اليوم' : ' · Today') : ''}
                    </div>
                    <div className="flex items-center justify-between gap-6 font-mono font-bold text-indigo-700 dark:text-indigo-300">
                      <span className="font-sans font-semibold text-slate-500">{currentLabel}</span>
                      <span dir="auto">{row.amount > 0 ? money(row.amount, currency, isRtl) : (isRtl ? 'لا مبيعات' : 'No sales')}</span>
                    </div>
                    {hasPrevious && (
                      <div className="flex items-center justify-between gap-6 font-mono text-slate-500">
                        <span className="font-sans font-semibold">{previousLabel}</span>
                        <span dir="auto">{row.previous > 0 ? money(row.previous, currency, isRtl) : (isRtl ? 'لا مبيعات' : 'No sales')}</span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {hasPrevious && (
              <Line
                type="monotone"
                dataKey="previous"
                name={previousLabel}
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 3, fill: '#94a3b8' }}
                isAnimationActive={false}
              />
            )}
            <Area
              type="monotone"
              dataKey="amount"
              name={currentLabel}
              stroke="#4f46e5"
              strokeWidth={2.25}
              fill="url(#homeSalesFill)"
              activeDot={{ r: 5, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="flex flex-wrap items-center gap-3 text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-600" />
            {currentLabel}
          </span>
          {hasPrevious && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed border-slate-400" />
              {previousLabel}
            </span>
          )}
        </div>
        <div className="font-mono font-bold text-slate-700 dark:text-slate-200">
          {hasSales
            ? money(periodTotal, currency, isRtl)
            : (isRtl ? 'لا مبيعات بهذه العملة في الرسم.' : 'No sales in this currency for the chart.')}
        </div>
      </div>
    </div>
  );
}

const TASKS_SHOWN = 6;

function taskTitle(task: HomeTask, isRtl: boolean): string {
  switch (task.kind) {
    case 'pending_uploads': return isRtl ? 'مبيعات على هذا الجهاز لم تُرسل بعد' : 'Sales on this device not sent yet';
    case 'cheques_in': return isRtl ? `شيكات واردة مستحقة خلال ${CHEQUE_HORIZON_DAYS} أيام` : `Incoming cheques due within ${CHEQUE_HORIZON_DAYS} days`;
    case 'cheques_out': return isRtl ? `شيكات صادرة مستحقة خلال ${CHEQUE_HORIZON_DAYS} أيام` : `Outgoing cheques due within ${CHEQUE_HORIZON_DAYS} days`;
    case 'out_of_stock': return isRtl ? 'أصناف نافدة' : 'Out of stock';
    case 'expiring': return isRtl ? `صلاحية تنتهي خلال ${EXPIRY_HORIZON_DAYS} أيام` : `Expiring within ${EXPIRY_HORIZON_DAYS} days`;
    case 'payroll_due': return isRtl ? 'رواتب مستحقة لم تُدفع' : 'Salaries due, not paid';
    case 'stale_debts': return isRtl ? `ديون بلا دفعة منذ ${STALE_DEBT_DAYS} يوماً أو أكثر` : `Debts with no payment for ${STALE_DEBT_DAYS}+ days`;
    case 'low_stock': return isRtl ? 'أصناف تحت الحد' : 'Low stock';
  }
}

function taskNote(task: HomeTask, isRtl: boolean): string {
  if (task.kind === 'pending_uploads') {
    return isRtl ? 'تُرسل وحدها عند عودة الاتصال. لا تسجّل الخروج قبل ذلك.' : 'They send on their own once online. Do not sign out before then.';
  }
  if (task.overdue === 0) return '';
  if (task.kind === 'expiring') return isRtl ? `${task.overdue} منتهية الصلاحية` : `${task.overdue} already expired`;
  return isRtl ? `${task.overdue} متأخر` : `${task.overdue} overdue`;
}

function TodayTasks({ tasks, isRtl }: { tasks: HomeTask[]; isRtl: boolean }) {
  const shown = tasks.slice(0, TASKS_SHOWN);
  const Chevron = isRtl ? ChevronLeft : ChevronRight;
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5" aria-label={isRtl ? 'مهام اليوم' : "Today's tasks"}>
      <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-2">
        <span>{isRtl ? 'مهام اليوم' : "Today's tasks"}</span>
        {tasks.length > shown.length && (
          <span>{isRtl ? `${shown.length} من ${tasks.length}` : `${shown.length} of ${tasks.length}`}</span>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">
          {isRtl ? 'لا شيء يحتاج تدخلك اليوم.' : 'Nothing needs your attention today.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {shown.map((task) => {
            const note = taskNote(task, isRtl);
            const detail = [
              ...task.money.map((row) => money(row.amount, row.currency, isRtl)),
              task.names.join(isRtl ? '، ' : ', '),
            ].filter(Boolean).join(' · ');
            const body = (
              <>
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${task.severity === 'urgent' ? 'bg-rose-500' : 'bg-amber-400'}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{taskTitle(task, isRtl)}</span>
                    <span className="text-sm font-black font-mono text-slate-500">{task.count}</span>
                  </span>
                  {detail && <span className="block text-xs text-slate-500 mt-0.5 truncate font-mono">{detail}</span>}
                  {note && (
                    <span className={`block text-xs mt-0.5 ${task.overdue > 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-400'}`}>
                      {note}
                    </span>
                  )}
                </span>
                {task.screen && <Chevron size={16} className="mt-1 shrink-0 text-slate-300" aria-hidden="true" />}
              </>
            );
            return (
              <li key={task.kind}>
                {task.screen ? (
                  <button
                    type="button"
                    onClick={() => openScreen(task.screen!)}
                    className="w-full py-2.5 flex items-start gap-3 text-start hover:bg-slate-50 dark:hover:bg-white/5 rounded-xl -mx-2 px-2"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="py-2.5 flex items-start gap-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FirstSteps({ isRtl }: { isRtl: boolean }) {
  const action = 'px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm font-black';
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5" aria-label={isRtl ? 'البداية' : 'Getting started'}>
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
        {isRtl ? 'أضف صنفاً، ثم سجّل أول عملية بيع.' : 'Add a product, then record the first sale.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={openAddProduct} className={action}>
          {isRtl ? 'إضافة صنف' : 'Add a product'}
        </button>
        <button type="button" onClick={() => openScreen('pos')} className={action}>
          {isRtl ? 'أول عملية بيع' : 'First sale'}
        </button>
      </div>
    </section>
  );
}

export default function HomeDesk({ language, settings }: Props) {
  const isRtl = language === 'ar';
  const [range, setRange] = useState<HomeRange>('day');
  const [cheques, setCheques] = useState<Cheque[] | null>(null);
  const {
    user,
    products = [],
    transactions = [],
    customers = [],
    customerTransactions = [],
    payrollRecords = [],
    vault,
    vaultTransactions = [],
    stockMovements = [],
    canOpenScreen,
    workspace,
  } = useFirebase() as unknown as {
    user: { uid?: string; email?: string } | null;
    workspace: Workspace | null;
    products: Product[];
    transactions: Invoice[];
    customers: Customer[];
    customerTransactions: CustomerTransaction[];
    payrollRecords: PayrollRecord[];
    vault: Vault | null;
    vaultTransactions: VaultTransaction[];
    stockMovements: StockMovement[];
    canOpenScreen: (screen: string) => boolean;
  };

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setCheques([]);
      return;
    }
    let cancelled = false;
    setCheques(null);
    loadCheques(uid).then((rows) => {
      if (!cancelled) setCheques(rows);
    }).catch(() => {
      if (!cancelled) setCheques(null);
    });
    return () => { cancelled = true; };
  }, [user?.uid]);

  const [pendingSales, setPendingSales] = useState<QueuedInvoice[]>([]);
  useEffect(() => {
    const refresh = () => {
      const uid = user?.uid;
      if (!uid) {
        setPendingSales([]);
        return;
      }
      const queue = readQueue(uid);
      const ownerId = workspace?.ownerId;
      setPendingSales(ownerId ? queue.filter((entry) => belongsToStore(entry, ownerId)) : queue);
    };
    refresh();
    const onQueue = (event: Event) => {
      const detailUid = (event as CustomEvent<{ uid?: string }>).detail?.uid;
      if (!detailUid || detailUid === user?.uid) refresh();
    };
    window.addEventListener(OFFLINE_QUEUE_EVENT, onQueue);
    window.addEventListener('storage', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, onQueue);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [user?.uid, workspace?.ownerId]);

  const { preferredCurrency } = usePreferredCurrency();
  const activeCode = preferredCurrency !== 'DEFAULT' && (POS_CURRENCY_CODES as readonly string[]).includes(preferredCurrency)
    ? preferredCurrency
    : settings.currency;
  const storeCurrency = (POS_CURRENCY_CODES as readonly string[]).includes(activeCode)
    ? activeCode
    : 'JOD';
  const currencyName = CURRENCY_NAMES[storeCurrency]?.[isRtl ? 'ar' : 'en'] || storeCurrency;
  const now = Date.now();
  const locale = isRtl ? 'ar' : 'en-US';

  const desk = (() => {
    const window = periodWindow(range, now);
    const sales = salesRows(transactions, storeCurrency);
    const credit = creditRows(transactions, storeCurrency);
    const income = vaultIncomeRows(vaultTransactions, storeCurrency);
    const saleRow = systemMoneyRow(sales, storeCurrency, window.start, window.end, window.previousStart, window.previousEnd);
    const pulse = salesPulse(saleRow.current, saleRow.previous);
    const saleCount = salesCount(sales, storeCurrency, window.start, window.end);
    const previousSaleCount = salesCount(sales, storeCurrency, window.previousStart, window.previousEnd);
    const incomeRow = systemMoneyRow(income, storeCurrency, window.start, window.end, window.previousStart, window.previousEnd);
    const creditInSystem = amountInCurrency(credit, storeCurrency, window.start, window.end);
    const saleAside = asideMoney(sales, storeCurrency, window.start, window.end, storeCurrency);
    const incomeAside = asideMoney(income, storeCurrency, window.start, window.end, storeCurrency);
    const balances = readVaultBalances(vault || {});
    const balanceRows = (Object.entries(balances) as [Currency, number][])
      .filter(([code, amount]) => amount !== 0 || code === storeCurrency)
      .map(([code, amount]) => ({ currency: code, amount }));
    return {
      saleRow,
      pulse,
      saleCount,
      previousSaleCount,
      incomeRow,
      creditInSystem,
      saleAside,
      incomeAside,
      points: salesChartSeries(sales, storeCurrency, range, now),
      stock: stockSnapshot(products, settings.lowStockThreshold, now),
      debts: outstandingDebts(customers, storeCurrency),
      activity: recentActivity(transactions, vaultTransactions, stockMovements, storeCurrency),
      balanceRows,
    };
  })();

  const pendingKey = pendingSales.map((entry) => entry.invoice.id).join('|');
  const sellers = useMemo<SellerContext>(() => ({
    userId: user?.uid || '',
    userEmail: user?.email || '',
    ownerId: workspace?.ownerId || user?.uid || '',
    ownerEmail: workspace?.ownerEmail || (workspace?.role === 'owner' ? user?.email : '') || '',
    pendingIds: new Set(pendingKey ? pendingKey.split('|') : []),
  }), [user?.uid, user?.email, workspace?.ownerId, workspace?.ownerEmail, workspace?.role, pendingKey]);

  const tasks = homeTasks({
    now,
    storeCurrency,
    products,
    globalLowStock: settings.lowStockThreshold,
    cheques: cheques === null ? null : cheques.map((cheque) => ({
      type: cheque.type,
      status: cheque.status,
      amount: cheque.amount,
      currency: cheque.currency,
      dueDate: cheque.dueDate,
      contactName: cheque.contactName,
      drawerName: cheque.drawerName,
    })),
    customers: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      totalDebt: customer.totalDebt,
      currency: customer.currency,
      createdAt: customer.createdAt,
    })),
    customerTransactions: customerTransactions.map((tx) => ({
      customerId: tx.customerId,
      type: tx.type,
      date: tx.date,
    })),
    payroll: canOpenScreen('employees')
      ? payrollRecords.map((record) => ({
        employeeName: record.employeeName,
        netSalary: record.netSalary,
        currency: record.currency,
        paymentStatus: record.paymentStatus,
        paymentDate: record.paymentDate,
      }))
      : null,
    pendingUploads: pendingSales.length,
  });
  const isNewStore = products.length === 0;

  const copy = {
    day: isRtl ? 'اليوم' : 'Today',
    week: isRtl ? 'الأسبوع' : 'Week',
    month: isRtl ? 'الشهر' : 'Month',
    sales: range === 'day'
      ? (isRtl ? 'مبيعات اليوم' : 'Sales today')
      : range === 'week'
        ? (isRtl ? 'مبيعات هذا الأسبوع' : 'Sales this week')
        : (isRtl ? 'مبيعات هذا الشهر' : 'Sales this month'),
    compare: range === 'day'
      ? (isRtl ? 'مقارنة بنفس الساعة أمس' : 'Same time yesterday')
      : range === 'week'
        ? (isRtl ? 'مقارنة بنفس المدة من الأسبوع الماضي' : 'Same span last week')
        : (isRtl ? 'مقارنة بنفس المدة من الشهر الماضي' : 'Same span last month'),
    vault: range === 'day'
      ? (isRtl ? 'دخل الخزنة اليوم' : 'Vault in today')
      : range === 'week'
        ? (isRtl ? 'دخل الخزنة هذا الأسبوع' : 'Vault in this week')
        : (isRtl ? 'دخل الخزنة هذا الشهر' : 'Vault in this month'),
    credit: isRtl ? 'مبيعات آجلة في هذه الفترة (لم تدخل الخزنة عند البيع)' : 'Credit sales in this period (not cash at the time of sale)',
    balances: isRtl ? 'الأرصدة الآن' : 'Balances now',
    stock: isRtl ? 'استثناءات المخزون' : 'Stock exceptions',
    nowLabel: isRtl ? 'الآن' : 'Now',
    out: isRtl ? 'نافد' : 'Out',
    low: isRtl ? 'تحت الحد' : 'Low',
    expiring: isRtl ? `ينتهي خلال ${EXPIRY_HORIZON_DAYS} أيام` : `Expiring in ${EXPIRY_HORIZON_DAYS} days`,
    stockOk: isRtl
      ? `المخزون ضمن الحد، ولا أصناف تنتهي صلاحيتها خلال ${EXPIRY_HORIZON_DAYS} أيام.`
      : `Stock is within limits, and nothing expires within ${EXPIRY_HORIZON_DAYS} days.`,
    debts: isRtl ? 'ديون قائمة' : 'Outstanding debts',
    noDebts: isRtl ? 'لا ديون قائمة.' : 'No outstanding debts.',
    customers: isRtl ? 'عملاء' : 'customers',
    activity: isRtl ? 'آخر الحركات' : 'Recent activity',
    noActivity: isRtl ? 'لا حركات بعد.' : 'No activity yet.',
    chart: range === 'day'
      ? (isRtl ? `نشاط المبيعات · ${currencyName} · آخر 7 أيام` : `Sales activity · ${currencyName} · last 7 days`)
      : range === 'week'
        ? (isRtl ? `نشاط المبيعات · ${currencyName} · هذا الأسبوع` : `Sales activity · ${currencyName} · this week`)
        : (isRtl ? `نشاط المبيعات · ${currencyName} · هذا الشهر` : `Sales activity · ${currencyName} · this month`),
    chartCurrent: isRtl ? 'هذه الفترة' : 'This period',
    chartPrevious: range === 'day'
      ? (isRtl ? 'الـ 7 أيام السابقة' : 'Prior 7 days')
      : (isRtl ? 'المدة المقابلة' : 'Matching prior period'),
  };

  const actions = [
    { id: 'pos', icon: Barcode, title: isRtl ? 'البيع' : 'Sell', text: isRtl ? 'نقطة البيع والباركود' : 'POS and barcode' },
    { id: 'inventory-audit', icon: ClipboardCheck, title: isRtl ? 'الجرد' : 'Count', text: isRtl ? 'الجرد والتسوية' : 'Stocktaking' },
    { id: 'customers', icon: Users, title: isRtl ? 'تحصيل' : 'Collect', text: isRtl ? 'ديون العملاء' : 'Customer debts' },
    { id: 'purchases-expenses', icon: ShoppingBag, title: isRtl ? 'شراء' : 'Buy', text: isRtl ? 'مشتريات ومصروف' : 'Purchases and expenses' },
  ].filter((action) => canOpenScreen(action.id));

  const activityLabel = (item: DeskActivity) => {
    if (item.kind === 'sale') return isRtl ? 'بيع' : 'Sale';
    if (item.kind === 'purchase') return isRtl ? 'شراء' : 'Purchase';
    if (item.kind === 'return') return isRtl ? 'مرتجع' : 'Return';
    if (item.kind === 'stocktake') return isRtl ? 'جرد' : 'Count';
    if (item.detail === 'collection') return isRtl ? 'تحصيل' : 'Collection';
    if (item.detail === 'payroll') return isRtl ? 'راتب' : 'Payroll';
    if (item.detail === 'expense') return isRtl ? 'مصروف' : 'Expense';
    if (item.detail === 'reversal') return isRtl ? 'عكس' : 'Reversal';
    return isRtl ? 'خزنة' : 'Vault';
  };

  const stockProblems = [
    ...desk.stock.out.map((item) => item.name),
    ...desk.stock.low.map((item) => item.name),
    ...desk.stock.expiring.map((item) => item.name),
  ].slice(0, 3);
  const stockClear = desk.stock.out.length + desk.stock.low.length + desk.stock.expiring.length === 0;
  const owing = customers.filter((customer) => (Number(customer.totalDebt) || 0) > 0).slice(0, 3);

  return (
    <div className="max-w-6xl mx-auto space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
            {settings.businessName || (isRtl ? 'مستودعي' : 'Mostawdaee')}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {new Date(now).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            {isRtl ? `عملة النظام: ${currencyName}` : `System currency: ${currencyName}`}
          </p>
        </div>
        <div className="inline-flex rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-1">
          {(['day', 'week', 'month'] as HomeRange[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={`px-4 py-2 rounded-xl text-sm font-bold ${range === key ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
            >
              {copy[key]}
            </button>
          ))}
        </div>
      </div>

      {isNewStore && <FirstSteps isRtl={isRtl} />}
      {!isNewStore && <QuickActions actions={actions} isRtl={isRtl} />}
      {(tasks.length > 0 || !isNewStore) && <TodayTasks tasks={tasks} isRtl={isRtl} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5">
          <div className="text-xs font-bold text-slate-400 mb-3">{copy.sales}</div>
          <MoneyLines rows={[desk.saleRow]} isRtl={isRtl} pulse={desk.pulse} />
          <p className="text-xs text-slate-400 mt-3">{copy.compare}</p>
          {(desk.saleCount > 0 || desk.previousSaleCount > 0) && (
            <p className="text-xs text-slate-400 mt-1">
              {isRtl
                ? `${desk.saleCount} عملية · ${desk.previousSaleCount} في المدة المقابلة`
                : `${desk.saleCount} sales · ${desk.previousSaleCount} in the matching period`}
            </p>
          )}
          {desk.saleAside.length > 0 && (
            <p className="text-xs text-slate-400 mt-2">
              {isRtl ? 'بعملات أخرى، غير داخلة في المجموع: ' : 'Other currencies, not included: '}
              {desk.saleAside.map((row) => money(row.current, row.currency, isRtl)).join(' · ')}
            </p>
          )}
        </section>

        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5 space-y-3">
          <div className="text-xs font-bold text-slate-400">{copy.vault}</div>
          <MoneyLines rows={[desk.incomeRow]} isRtl={isRtl} />
          {desk.incomeAside.length > 0 && (
            <p className="text-xs text-slate-400">
              {isRtl ? 'دخل بعملات أخرى، غير داخل في المجموع: ' : 'Income in other currencies, not included: '}
              {desk.incomeAside.map((row) => money(row.current, row.currency, isRtl)).join(' · ')}
            </p>
          )}
          {desk.creditInSystem > 0 && (
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
              <div className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-1">{copy.credit}</div>
              <div className="font-mono font-bold text-amber-800 dark:text-amber-200">
                {money(desk.creditInSystem, storeCurrency, isRtl)}
              </div>
            </div>
          )}
          <div>
            <div className="text-xs font-bold text-slate-400 mb-1">{copy.balances}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-mono text-slate-600 dark:text-slate-300">
              {desk.balanceRows.map((row) => (
                <span key={row.currency}>{money(row.amount, row.currency, isRtl)}</span>
              ))}
            </div>
          </div>
        </section>

        <button
          type="button"
          onClick={() => openScreen('inventory')}
          className="text-start rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5"
        >
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-3">
            <span>{copy.stock}</span>
            <span>{copy.nowLabel}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-2xl font-black text-rose-600">{desk.stock.out.length}</div>
              <div className="text-xs text-slate-500">{copy.out}</div>
            </div>
            <div>
              <div className="text-2xl font-black text-amber-600">{desk.stock.low.length}</div>
              <div className="text-xs text-slate-500">{copy.low}</div>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800 dark:text-slate-100">{desk.stock.expiring.length}</div>
              <div className="text-xs text-slate-500">{copy.expiring}</div>
            </div>
          </div>
          <p className="text-sm text-slate-500 mt-3">
            {products.length === 0
              ? (isRtl ? 'لا أصناف بعد.' : 'No products yet.')
              : stockClear ? copy.stockOk : stockProblems.join(' · ')}
          </p>
        </button>

        <button
          type="button"
          onClick={() => openScreen('customers')}
          className="text-start rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5"
        >
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-3">
            <span>{copy.debts}</span>
            <span>{copy.nowLabel}</span>
          </div>
          {desk.debts.count === 0 ? (
            <p className="text-sm text-slate-500">{copy.noDebts}</p>
          ) : (
            <>
              <div className="text-2xl font-black">{desk.debts.count} <span className="text-sm font-bold text-slate-400">{copy.customers}</span></div>
              <div className="mt-2 space-y-1">
                {desk.debts.rows.filter((row) => row.current !== 0).map((row) => (
                  <div key={row.currency} className="font-mono font-bold">{money(row.current, row.currency, isRtl)}</div>
                ))}
              </div>
              <p className="text-sm text-slate-500 mt-2">{owing.map((customer) => customer.name).join(' · ')}</p>
            </>
          )}
        </button>
      </div>

      {!isNewStore && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5">
          <div className="text-xs font-bold text-slate-400 mb-3">{copy.chart}</div>
          <SalesChart
            points={desk.points}
            currency={storeCurrency}
            locale={locale}
            today={now}
            isRtl={isRtl}
            currentLabel={copy.chartCurrent}
            previousLabel={copy.chartPrevious}
          />
        </section>
      )}

      {!isNewStore && (
        <SalesLogCard
          invoices={transactions}
          range={range}
          now={now}
          isRtl={isRtl}
          storeCurrency={storeCurrency}
          sellers={sellers}
        />
      )}

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5">
        <div className="text-xs font-bold text-slate-400 mb-3">{copy.activity}</div>
        {desk.activity.length === 0 ? (
          <p className="text-sm text-slate-500">{copy.noActivity}</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {desk.activity.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openScreen(item.screen)}
                className="w-full py-2.5 flex items-center justify-between gap-3 text-start"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{item.title}</div>
                  <div className="text-xs text-slate-400">
                    {activityLabel(item)}
                    {' · '}
                    {new Date(item.timestamp).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="font-mono text-sm font-bold shrink-0">
                  {item.kind === 'stocktake'
                    ? `${(item.amount || 0) > 0 ? '+' : ''}${item.amount}`
                    : money(item.amount || 0, item.currency, isRtl)}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
