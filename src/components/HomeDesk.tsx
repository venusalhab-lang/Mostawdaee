import { useEffect, useMemo, useState } from 'react';
import { Barcode, ChevronLeft, ChevronRight, ClipboardCheck, ShoppingBag, Users } from 'lucide-react';
import type {
  AppSettings, Cheque, Currency, Customer, CustomerTransaction, Invoice, Language, PayrollRecord, Product, StockMovement, Vault, VaultTransaction,
} from '../types';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { formatMoney, POS_CURRENCY_CODES } from '../lib/exchangeRates';
import { readVaultBalances } from '../lib/vaultMath';
import { loadCheques } from '../lib/chequesStore';
import { readQueue } from '../lib/offlineQueue';
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
  dailyTotals,
  outstandingDebts,
  periodWindow,
  recentActivity,
  salesCount,
  salesPulse,
  salesPulseGauge,
  salesRows,
  startOfLocalDay,
  stockSnapshot,
  systemMoneyRow,
  vaultIncomeRows,
  type DeskActivity,
  type HomeRange,
  type MoneyRow,
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

const DAY_MS = 24 * 60 * 60 * 1000;

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

const PULSE_STROKE: Record<SalesPulseTone, string> = {
  'strong-up': 'stroke-emerald-500',
  up: 'stroke-emerald-400',
  flat: 'stroke-slate-400',
  down: 'stroke-amber-500',
  'strong-down': 'stroke-rose-500',
  idle: 'stroke-slate-300',
  new: 'stroke-sky-500',
};

const PULSE_FILL: Record<SalesPulseTone, string> = {
  'strong-up': 'fill-emerald-500',
  up: 'fill-emerald-400',
  flat: 'fill-slate-400',
  down: 'fill-amber-500',
  'strong-down': 'fill-rose-500',
  idle: 'fill-slate-300',
  new: 'fill-sky-500',
};

const GAUGE_CX = 60;
const GAUGE_CY = 60;
const GAUGE_R = 42;

function gaugePoint(angleDeg: number, radius = GAUGE_R) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: GAUGE_CX + radius * Math.cos(rad), y: GAUGE_CY + radius * Math.sin(rad) };
}

function gaugeArc(fromDeg: number, toDeg: number) {
  const start = gaugePoint(fromDeg);
  const end = gaugePoint(toDeg);
  const delta = toDeg - fromDeg;
  const large = Math.abs(delta) > 180 ? 1 : 0;
  const sweep = delta >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${GAUGE_R} ${GAUGE_R} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

function SalesDial({
  tone,
  percent,
  label,
}: {
  tone: SalesPulseTone;
  percent: number | null;
  label: string;
}) {
  const gauge = salesPulseGauge(percent);
  const zero = 270;
  const track = gaugeArc(135, 405);
  const value = gauge.placed && gauge.angleDeg !== null && gauge.angleDeg !== zero
    ? gaugeArc(zero, gauge.angleDeg)
    : '';
  const tip = gauge.placed && gauge.angleDeg !== null ? gauge.angleDeg - zero : 0;
  const minus = gaugePoint(135, 54);
  const plus = gaugePoint(45, 54);
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
        <path
          d={track}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={gauge.placed ? 'stroke-slate-200 dark:stroke-slate-700' : 'stroke-slate-300 dark:stroke-slate-600'}
          strokeDasharray={gauge.placed ? undefined : '3 7'}
        />
        {value && (
          <path d={value} fill="none" strokeWidth="8" strokeLinecap="round" className={PULSE_STROKE[tone]} />
        )}
        {gauge.placed && (
          <g style={{ transform: `rotate(${tip}deg)`, transformOrigin: '60px 60px', transition: 'transform 480ms ease' }}>
            <line x1="60" y1="60" x2="60" y2="18" strokeWidth="3" strokeLinecap="round" className={PULSE_STROKE[tone]} />
            <circle cx="60" cy="18" r="4" className={PULSE_FILL[tone]} />
          </g>
        )}
        <circle cx="60" cy="60" r="26" className="fill-white dark:fill-slate-900" />
        <text x={minus.x} y={minus.y} textAnchor="middle" dominantBaseline="middle" className="fill-slate-400 text-[10px] font-bold">−</text>
        <text x={plus.x} y={plus.y} textAnchor="middle" dominantBaseline="middle" className="fill-slate-400 text-[10px] font-bold">+</text>
      </svg>
      <div className={`pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-black font-mono ${PULSE_STYLE[tone].text}`}>
        {label}
      </div>
    </div>
  );
}

function SalesPulseBar({
  tone,
  percent,
  current,
  previous,
  currentCount,
  previousCount,
  currency,
  compare,
  isRtl,
}: {
  tone: SalesPulseTone;
  percent: number | null;
  current: number;
  previous: number;
  currentCount: number;
  previousCount: number;
  currency: string;
  compare: string;
  isRtl: boolean;
}) {
  const [open, setOpen] = useState(false);
  const style = PULSE_STYLE[tone];
  const gauge = salesPulseGauge(percent);
  const figure = percent === null ? '—' : `${percent > 0 ? '+' : ''}${percent}%`;
  const word = pulseWord(tone, isRtl);
  const basis = tone === 'idle'
    ? (isRtl
      ? 'لا مبيعات بعملة النظام في هذه المدة ولا في المدة المقابلة، لذلك لا تُحسب نسبة ولا يتحرك المؤشر.'
      : 'No system-currency sales in this period or the matching one, so there is no percent and the needle stays hidden.')
    : tone === 'new'
      ? (isRtl
        ? 'توجد مبيعات الآن ولم توجد مبيعات مقابلة، لذلك لا تُعرض نسبة ولا يتحرك المؤشر.'
        : 'There are sales now and none in the matching period, so no percent is shown and the needle stays hidden.')
      : (isRtl
        ? `${compare}. القرص من \u2066−100٪\u2069 إلى \u2066+100٪\u2069، والصفر في الأعلى. اللون يتبع النسبة، والتراجع من 10٪ فأكثر أحمر.`
        : `${compare}. The dial runs from −100% to +100%, with zero at the top. Color follows the percent. A drop of 10% or more is red.`);
  const counts = currentCount + previousCount > 0
    ? (isRtl
      ? `${currentCount} عملية بيع · ${previousCount} في المدة المقابلة`
      : `${currentCount} sales · ${previousCount} in the matching period`)
    : '';
  const beyondDial = gauge.placed && percent !== null && gauge.clamped !== null && percent !== gauge.clamped;
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5" aria-label={isRtl ? 'مؤشر المبيعات' : 'Sales pulse'}>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <button
          type="button"
          aria-expanded={open}
          aria-label={isRtl ? `${word}، ${figure}. اضغط للتفاصيل` : `${word}, ${figure}. Press for details`}
          onClick={() => setOpen((value) => !value)}
          className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"
        >
          <SalesDial tone={tone} percent={percent} label={figure} />
        </button>
        <div className="min-w-0 sm:flex-1 text-center sm:text-start">
          <div className="text-xs font-bold text-slate-400">{isRtl ? 'مؤشر المبيعات' : 'Sales pulse'}</div>
          <div className={`text-lg font-black mt-1 ${style.text}`}>{word}</div>
          <p className="text-xs text-slate-400 mt-2">
            {open
              ? basis
              : (isRtl ? 'اضغط القرص لترى المقارنة.' : 'Press the dial to see the comparison.')}
          </p>
          {open && (
            <div className="mt-3 space-y-1 text-xs text-slate-500">
              <div className="font-mono">
                {money(current, currency, isRtl)}
                {isRtl ? ' الآن · ' : ' now · '}
                {money(previous, currency, isRtl)}
                {isRtl ? ' في المدة المقابلة' : ' matching'}
              </div>
              {counts && <div>{counts}</div>}
              {beyondDial && (
                <div>
                  {isRtl
                    ? `النسبة ${figure} خارج حد القرص، لذلك وقف المؤشر عند الطرف.`
                    : `${figure} is past the dial limit, so the needle rests at the rim.`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PulseDelta({ tone, percent, isRtl }: { tone: SalesPulseTone; percent: number | null; isRtl: boolean }) {
  const label = percent === null
    ? pulseWord(tone, isRtl)
    : `${percent > 0 ? '+' : ''}${percent}%`;
  return <span className={`text-xs font-bold ${PULSE_STYLE[tone].text}`}>{label}</span>;
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
}: {
  points: { day: number; amount: number }[];
  currency: string;
  locale: string;
  today: number;
  isRtl: boolean;
}) {
  const max = Math.max(...points.map((point) => point.amount), 0);
  const todayStart = startOfLocalDay(today);
  const byWeekday = points.length <= 8;
  return (
    <div className="flex items-end gap-1.5" dir="ltr" role="img" aria-label={currency}>
      {points.map((point) => {
        const isToday = point.day === todayStart;
        const ratio = max > 0 ? point.amount / max : 0;
        const label = new Date(point.day).toLocaleDateString(locale, byWeekday ? { weekday: 'short' } : { day: 'numeric' });
        const full = new Date(point.day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' });
        const amountLabel = point.amount > 0 ? money(point.amount, currency, isRtl) : (isRtl ? 'لا مبيعات' : 'No sales');
        return (
          <div key={point.day} className="flex-1 min-w-0 flex flex-col items-center gap-1.5" title={`${full}: ${amountLabel}`}>
            <div className="h-24 w-full flex items-end">
              <div
                className={`w-full rounded-md ${
                  point.amount <= 0
                    ? 'bg-slate-200 dark:bg-slate-700'
                    : isToday
                      ? 'bg-indigo-600'
                      : 'bg-indigo-300 dark:bg-indigo-400/70'
                }`}
                style={point.amount > 0 ? { height: `${Math.max(12, ratio * 100)}%` } : { height: '4px' }}
              />
            </div>
            <span className={`w-full truncate text-center text-[10px] leading-none ${
              isToday ? 'font-black text-indigo-700 dark:text-indigo-300' : 'font-bold text-slate-400'
            }`}>
              {label}
            </span>
          </div>
        );
      })}
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
    const chartStart = range === 'day' ? startOfLocalDay(now) - 6 * DAY_MS : window.start;
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
      points: dailyTotals(sales, storeCurrency, chartStart, now),
      stock: stockSnapshot(products, settings.lowStockThreshold, now),
      debts: outstandingDebts(customers, storeCurrency),
      activity: recentActivity(transactions, vaultTransactions, stockMovements, storeCurrency),
      balanceRows,
    };
  })();

  const pendingSales = user?.uid ? readQueue(user.uid) : [];
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
    credit: isRtl ? 'آجل لم يُحصَّل' : 'Credit not collected',
    balances: isRtl ? 'الأرصدة الآن' : 'Balances now',
    stock: isRtl ? 'استثناءات المخزون' : 'Stock exceptions',
    nowLabel: isRtl ? 'الآن' : 'Now',
    out: isRtl ? 'نافد' : 'Out',
    low: isRtl ? 'تحت الحد' : 'Low',
    expiring: isRtl ? 'ينتهي خلال 30 يوماً' : 'Expiring in 30 days',
    stockOk: isRtl ? 'المخزون ضمن الحد، ولا أصناف قاربت انتهاء الصلاحية.' : 'Stock is within limits, and nothing expires within 30 days.',
    debts: isRtl ? 'ديون قائمة' : 'Outstanding debts',
    noDebts: isRtl ? 'لا ديون قائمة.' : 'No outstanding debts.',
    customers: isRtl ? 'عملاء' : 'customers',
    activity: isRtl ? 'آخر الحركات' : 'Recent activity',
    noActivity: isRtl ? 'لا حركات بعد.' : 'No activity yet.',
    chart: range === 'day'
      ? (isRtl ? `مبيعات ${currencyName} خلال 7 أيام` : `${currencyName} sales, last 7 days`)
      : (isRtl ? `مبيعات ${currencyName} في هذه الفترة` : `${currencyName} sales in this period`),
    noChart: isRtl ? 'لا مبيعات بهذه العملة في الرسم.' : 'No sales in this currency for the chart.',
  };

  const actions = [
    { id: 'pos', icon: Barcode, title: isRtl ? 'البيع' : 'Sell', text: isRtl ? 'نقطة البيع والباركود' : 'POS and barcode' },
    { id: 'inventory-audit', icon: ClipboardCheck, title: isRtl ? 'الجرد' : 'Count', text: isRtl ? 'الجرد والتسوية' : 'Stocktaking' },
    { id: 'customers', icon: Users, title: isRtl ? 'تحصيل' : 'Collect', text: isRtl ? 'ديون العملاء' : 'Customer debts' },
    { id: 'purchases-expenses', icon: ShoppingBag, title: isRtl ? 'شراء' : 'Buy', text: isRtl ? 'مشتريات ومصروف' : 'Purchases and expenses' },
  ];

  const activityLabel = (item: DeskActivity) => {
    if (item.kind === 'sale') return isRtl ? 'بيع' : 'Sale';
    if (item.kind === 'purchase') return isRtl ? 'شراء' : 'Purchase';
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
      {(tasks.length > 0 || !isNewStore) && <TodayTasks tasks={tasks} isRtl={isRtl} />}

      <SalesPulseBar
        tone={desk.pulse.tone}
        percent={desk.pulse.percent}
        current={desk.saleRow.current}
        previous={desk.saleRow.previous}
        currentCount={desk.saleCount}
        previousCount={desk.previousSaleCount}
        currency={storeCurrency}
        compare={copy.compare}
        isRtl={isRtl}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5">
          <div className="text-xs font-bold text-slate-400 mb-3">{copy.sales}</div>
          <MoneyLines rows={[desk.saleRow]} isRtl={isRtl} pulse={desk.pulse} />
          <p className="text-xs text-slate-400 mt-3">{copy.compare}</p>
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
        <SalesLogCard
          invoices={transactions}
          range={range}
          now={now}
          isRtl={isRtl}
          storeCurrency={storeCurrency}
          sellers={sellers}
        />
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => openScreen(action.id)}
              className="rounded-3xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-4 text-start hover:bg-indigo-700 dark:hover:bg-indigo-50 transition-colors"
            >
              <Icon size={18} />
              <div className="mt-3 font-black">{action.title}</div>
              <div className="text-xs opacity-70">{action.text}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <section className="lg:col-span-3 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5">
          <div className="text-xs font-bold text-slate-400 mb-3">{copy.chart}</div>
          <SalesChart points={desk.points} currency={storeCurrency} locale={locale} today={now} isRtl={isRtl} />
          {desk.points.every((point) => point.amount === 0) && (
            <p className="text-sm text-slate-500">{copy.noChart}</p>
          )}
        </section>

        <section className="lg:col-span-2 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-5">
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
    </div>
  );
}
