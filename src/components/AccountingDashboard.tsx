import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Download, Printer, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import { CURRENCY_NAMES } from './CurrencyPicker';
import type { Currency, VaultTransaction } from '../types';
import { formatMoney, isPosCurrency } from '../lib/exchangeRates';
import { localDayEnd, localDayStart, localIsoDate } from '../lib/localDate';
import DateField from './ui/DateField';
import { printHtmlDocument } from '../lib/printHtml';
import { stockValueByCurrency } from '../lib/profits';
import { readVaultBalances } from '../lib/vaultMath';
import { useAccountingConfig } from '../hooks/useAccountingConfig';
import {
  ACCOUNTS,
  OPENING_ACCOUNTS,
  VAULT_CLASSES_FOR,
  accountBalances,
  accountLedger,
  accountName,
  balanceSheet,
  buildJournal,
  buildJournalCsv,
  entrySourceLabel,
  fromMinor,
  incomeStatement,
  inferVaultClass,
  inventoryAdjustmentSides,
  journalCurrencies,
  manualDebts,
  openingEntrySides,
  reconcile,
  toMinor,
  trialBalance,
  vaultNeedsClass,
  vaultSourceOf,
  type AccountCode,
  type DebtClass,
  type ManualEntry,
  type Period,
  type VaultClass,
} from '../lib/accounting';
import { buildAccountingReportCsv, buildAccountingReportHtml, type AccountingReport, type ReportRow } from '../lib/accountingReport';

interface AccountingDashboardProps {
  language?: 'ar' | 'en';
  /** Books shown first when they have entries (the currency the merchant works in). */
  currency?: string;
  onClose?: () => void;
}

type Tab = 'summary' | 'journal' | 'ledger' | 'trial' | 'income' | 'balance' | 'setup';
type PeriodPreset = 'month' | 'last_month' | 'year' | 'all' | 'custom';

const PAGE_SIZE = 50;

const VAULT_CLASS_LABELS: Record<VaultClass, { ar: string; en: string }> = {
  capital: { ar: 'رأس مال من المالك', en: 'Owner capital' },
  drawings: { ar: 'مسحوبات شخصية للمالك', en: 'Owner drawings' },
  loan: { ar: 'قرض (استلام أو سداد)', en: 'Loan (received or repaid)' },
  opening: { ar: 'رصيد افتتاحي', en: 'Opening balance' },
  sales: { ar: 'مبيعات بدون فاتورة', en: 'Sales without invoice' },
  other_income: { ar: 'إيراد آخر', en: 'Other income' },
  expense: { ar: 'مصروف عام', en: 'General expense' },
  cash_diff: { ar: 'عجز/زيادة صندوق', en: 'Cash over / short' },
};

function periodFor(preset: PeriodPreset, customFrom: string, customTo: string, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'month': return { from: new Date(y, m, 1).getTime() };
    case 'last_month': return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() - 1 };
    case 'year': return { from: new Date(y, 0, 1).getTime() };
    case 'custom': return { from: localDayStart(customFrom) ?? undefined, to: localDayEnd(customTo) ?? undefined };
    default: return {};
  }
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CARD = 'bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-4';
const TH = 'px-3 py-2 text-xs font-semibold text-slate-500 dark:text-gray-400 text-start whitespace-nowrap';
const TD = 'px-3 py-2 text-sm';
const TD_NUM = 'px-3 py-2 text-sm text-end tabular-nums whitespace-nowrap';
const SELECT = 'px-3 py-2 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-lg text-sm';

export default function AccountingDashboard({ language = 'ar', currency: preferred, onClose }: AccountingDashboardProps) {
  const {
    user, settings, invoices = [], products = [], vaultTransactions = [], customerTransactions = [], supplierTransactions = [],
    payrollRecords = [], stockMovements = [], customers = [], vault,
  } = useFirebase();
  const isAr = language === 'ar';
  const locale = isAr ? 'ar' : 'en-US';
  const L = (ar: string, en: string) => (isAr ? ar : en);
  const defaultCurrency = settings?.currency || 'JOD';
  const firstCurrency = preferred || defaultCurrency;
  const { config, loading: configLoading, update } = useAccountingConfig(user?.uid ?? null);

  const [tab, setTab] = useState<Tab>('summary');
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [customFrom, setCustomFrom] = useState(() => localIsoDate(new Date(new Date().getFullYear(), 0, 1)));
  const [customTo, setCustomTo] = useState(() => localIsoDate());
  const [currency, setCurrency] = useState<string>(firstCurrency);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [ledgerAccount, setLedgerAccount] = useState<AccountCode>('1100');
  const [onlyPending, setOnlyPending] = useState(true);
  const [saving, setSaving] = useState(false);

  const journal = useMemo(() => buildJournal({
    invoices, products, vaultTransactions, customerTransactions, supplierTransactions, payrollRecords, stockMovements, config, defaultCurrency,
  }), [invoices, products, vaultTransactions, customerTransactions, supplierTransactions, payrollRecords, stockMovements, config, defaultCurrency]);

  const currencies = useMemo(() => {
    const list = journalCurrencies(journal.entries);
    return list.length ? list : [firstCurrency];
  }, [journal.entries, firstCurrency]);
  useEffect(() => {
    if (!currencies.includes(currency)) setCurrency(currencies.includes(firstCurrency) ? firstCurrency : currencies[0]);
  }, [currencies, currency, firstCurrency]);

  const period = useMemo(() => periodFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const asOf = period.to;
  useEffect(() => setVisible(PAGE_SIZE), [tab, period, currency]);

  const money = (minor: number) => formatMoney(fromMinor(minor, currency), currency, locale);
  const dateLabel = (ms: number) => new Date(ms).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  const presetLabels: Record<PeriodPreset, string> = {
    month: L('هذا الشهر', 'This month'),
    last_month: L('الشهر الماضي', 'Last month'),
    year: L('هذه السنة', 'This year'),
    all: L('كل الفترات', 'All time'),
    custom: L('فترة محددة', 'Custom'),
  };
  const periodText = preset === 'custom' ? `${customFrom} → ${customTo}` : presetLabels[preset];
  const asOfText = asOf === undefined ? L('حتى اليوم', 'As of today') : `${L('حتى', 'As of')} ${dateLabel(asOf)}`;
  const currencyName = (code: string) => (isPosCurrency(code) ? (isAr ? CURRENCY_NAMES[code].ar : code) : code);

  const income = useMemo(() => incomeStatement(journal.entries, currency, period), [journal.entries, currency, period]);
  const balance = useMemo(() => balanceSheet(journal.entries, currency, asOf), [journal.entries, currency, asOf]);
  const trial = useMemo(() => trialBalance(journal.entries, currency, asOf), [journal.entries, currency, asOf]);
  const position = useMemo(() => accountBalances(journal.entries, currency, { to: asOf }), [journal.entries, currency, asOf]);

  const recon = useMemo(() => {
    const balances = readVaultBalances(vault);
    const stock = stockValueByCurrency(products, defaultCurrency);
    const debt = customers.reduce((sum, c) => ((c.currency || defaultCurrency) === currency ? sum + (Number(c.totalDebt) || 0) : sum), 0);
    return reconcile(journal.entries, currency, {
      vault: balances[currency as Currency] ?? 0,
      stockValue: stock[currency] || 0,
      customerDebt: debt,
    });
  }, [journal.entries, currency, vault, products, customers, defaultCurrency]);

  const manualVault = useMemo(
    () => vaultTransactions
      .filter((t) => vaultSourceOf(t) === 'manual')
      .sort((a, b) => b.timestamp - a.timestamp),
    [vaultTransactions],
  );
  const pendingVault = manualVault.filter((t) => vaultNeedsClass(t, config));
  const debts = useMemo(() => manualDebts(invoices, customerTransactions), [invoices, customerTransactions]);
  const customerName = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

  const save = async (change: Parameters<typeof update>[0], success: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await update(change);
      toast.success(success);
    } catch (err: any) {
      toast.error(err?.code === 'guest'
        ? L('وضع المعاينة لا يحفظ أي بيانات.', 'Preview mode does not save anything.')
        : L('تعذّر الحفظ. تحقّق من الاتصال وأن حسابك هو مالك المتجر.', 'Could not save. Check the connection and that you are the store owner.'));
    } finally {
      setSaving(false);
    }
  };

  const classifyVault = (tx: VaultTransaction, cls: VaultClass | '') => save((c) => {
    const vaultClasses = { ...c.vaultClasses };
    if (cls) vaultClasses[tx.id] = cls;
    else delete vaultClasses[tx.id];
    return { ...c, vaultClasses };
  }, L('حُفظ التصنيف.', 'Classification saved.'));

  const classifyDebt = (id: string, cls: DebtClass) => save(
    (c) => ({ ...c, debtClasses: { ...c.debtClasses, [id]: cls } }),
    L('حُفظ التصنيف.', 'Classification saved.'),
  );

  const removeEntry = (id: string) => save(
    (c) => ({ ...c, entries: c.entries.filter((e) => e.id !== id) }),
    L('حُذف القيد.', 'Entry removed.'),
  );

  // ---------------------------------------------------------------- opening balance form
  const [openAccount, setOpenAccount] = useState<AccountCode>('1500');
  const [openAmount, setOpenAmount] = useState('');
  const [openDate, setOpenDate] = useState(() => localIsoDate());
  const [openMemo, setOpenMemo] = useState('');

  const addOpening = () => {
    const amount = Number(openAmount);
    const date = localDayStart(openDate);
    if (!Number.isFinite(amount) || toMinor(amount, currency) <= 0 || date === null) {
      toast.error(L('أدخل مبلغاً أكبر من صفر وتاريخاً صحيحاً.', 'Enter an amount above zero and a valid date.'));
      return;
    }
    const sides = openingEntrySides(openAccount);
    const entry: ManualEntry = {
      id: crypto.randomUUID(), date, currency, ...sides, amount: fromMinor(toMinor(amount, currency), currency),
      memo: openMemo.trim() || `${L('رصيد افتتاحي', 'Opening balance')}: ${accountName(openAccount, isAr)}`, kind: 'opening',
    };
    void save((c) => ({ ...c, entries: [...c.entries, entry] }), L('أُضيف الرصيد الافتتاحي.', 'Opening balance added.'))
      .then(() => { setOpenAmount(''); setOpenMemo(''); });
  };

  const inventoryGap = recon.inventory.actual - recon.inventory.book;
  const bookInventoryGap = (counter: '3900' | '5300') => {
    const sides = inventoryAdjustmentSides(recon.inventory.book, recon.inventory.actual, counter);
    if (!sides) return;
    const entry: ManualEntry = {
      id: crypto.randomUUID(), date: Date.now(), currency, debit: sides.debit, credit: sides.credit,
      amount: fromMinor(sides.amountMinor, currency),
      memo: counter === '3900'
        ? L('مخزون سابق لم يُسجَّل بفاتورة شراء', 'Stock held before the books started')
        : L('تسوية فرق المخزون الفعلي', 'Inventory count adjustment'),
      kind: 'inventory_adjustment',
    };
    void save((c) => ({ ...c, entries: [...c.entries, entry] }), L('سُجّلت تسوية المخزون.', 'Inventory adjustment recorded.'));
  };

  // ---------------------------------------------------------------- reports for print / CSV
  const statementRows = (): { title: string; subtitle: string; columns: string[]; rows: ReportRow[]; notes?: string[] } | null => {
    const name = (code: AccountCode) => accountName(code, isAr);
    if (tab === 'trial') {
      return {
        title: L('ميزان المراجعة', 'Trial balance'), subtitle: asOfText, columns: [L('مدين', 'Debit'), L('دائن', 'Credit')],
        rows: [
          ...trial.rows.map((r) => ({ code: r.code, label: name(r.code), amounts: [r.debit || null, r.credit || null] })),
          { label: L('الإجمالي', 'Total'), amounts: [trial.totalDebit, trial.totalCredit], kind: 'total' as const },
        ],
      };
    }
    if (tab === 'income') {
      return {
        title: L('قائمة الدخل', 'Income statement'), subtitle: periodText, columns: [L('المبلغ', 'Amount')],
        rows: [
          { label: L('الإيرادات', 'Revenue'), amounts: [], kind: 'section' },
          ...income.revenue.map((l) => ({ code: l.code, label: name(l.code), amounts: [l.amount] })),
          { label: L('إجمالي الإيرادات', 'Total revenue'), amounts: [income.totalRevenue], kind: 'total' },
          { code: '5100', label: name('5100'), amounts: [-income.cogs] },
          { label: L('مجمل الربح', 'Gross profit'), amounts: [income.grossProfit], kind: 'total' },
          { label: L('المصروفات', 'Expenses'), amounts: [], kind: 'section' },
          ...income.expenses.map((l) => ({ code: l.code, label: name(l.code), amounts: [-l.amount] })),
          { label: L('إجمالي المصروفات', 'Total expenses'), amounts: [-income.totalExpenses], kind: 'total' },
          { label: L('صافي الربح', 'Net profit'), amounts: [income.netProfit], kind: 'total' },
        ],
      };
    }
    if (tab === 'balance') {
      return {
        title: L('الميزانية العمومية', 'Balance sheet'), subtitle: asOfText, columns: [L('المبلغ', 'Amount')],
        rows: [
          { label: L('الأصول', 'Assets'), amounts: [], kind: 'section' },
          ...balance.assets.map((l) => ({ code: l.code, label: name(l.code), amounts: [l.amount] })),
          { label: L('إجمالي الأصول', 'Total assets'), amounts: [balance.totalAssets], kind: 'total' },
          { label: L('الالتزامات', 'Liabilities'), amounts: [], kind: 'section' },
          ...balance.liabilities.map((l) => ({ code: l.code, label: name(l.code), amounts: [l.amount] })),
          { label: L('إجمالي الالتزامات', 'Total liabilities'), amounts: [balance.totalLiabilities], kind: 'total' },
          { label: L('حقوق الملكية', 'Equity'), amounts: [], kind: 'section' },
          ...balance.equity.map((l) => ({ code: l.code, label: name(l.code), amounts: [l.amount] })),
          { label: L('الأرباح المتراكمة', 'Retained earnings'), amounts: [balance.retainedEarnings] },
          { label: L('إجمالي حقوق الملكية', 'Total equity'), amounts: [balance.totalEquity], kind: 'total' },
          { label: L('الالتزامات وحقوق الملكية', 'Liabilities and equity'), amounts: [balance.totalLiabilities + balance.totalEquity], kind: 'total' },
        ],
        notes: balance.unclassified
          ? [L('يتضمن حركات خزنة بانتظار التصنيف؛ صنّفها ليصبح التقرير نهائياً.', 'Includes vault movements awaiting classification; classify them to finalize this report.')]
          : undefined,
      };
    }
    return null;
  };

  const statementEmpty = tab === 'trial'
    ? trial.rows.length === 0
    : tab === 'income'
      ? !income.revenue.length && !income.expenses.length && !income.cogs
      : !balance.assets.length && !balance.liabilities.length && !balance.equity.length && !balance.retainedEarnings;

  const report = (): AccountingReport | null => {
    const s = statementRows();
    if (!s) return null;
    if (statementEmpty) {
      toast.error(L('لا توجد حركات في هذه الفترة.', 'No activity in this period.'));
      return null;
    }
    return { isAr, businessName: settings?.businessName || '', currency, ...s };
  };

  const handlePrint = () => {
    const r = report();
    if (!r) return;
    if (!printHtmlDocument(buildAccountingReportHtml(r, locale), r.title)) {
      toast.error(L('تعذّر فتح نافذة الطباعة.', 'Could not open the print dialog.'));
    }
  };

  const handleCsv = () => {
    if (tab === 'journal') {
      const rows = periodEntries;
      if (!rows.length) {
        toast.error(L('لا توجد قيود في هذه الفترة.', 'No entries in this period.'));
        return;
      }
      downloadText(buildJournalCsv(rows, currency, isAr, (ms) => localIsoDate(ms)), `journal-${currency}-${localIsoDate()}.csv`);
      return;
    }
    const r = report();
    if (r) downloadText(buildAccountingReportCsv(r), `${tab}-${currency}-${localIsoDate()}.csv`);
  };

  const periodEntries = useMemo(
    () => journal.entries
      .filter((e) => e.currency === currency
        && (period.from === undefined || e.date >= period.from) && (period.to === undefined || e.date <= period.to))
      .reverse(),
    [journal.entries, currency, period],
  );

  const ledgerAccounts = useMemo(() => {
    const used = new Set<AccountCode>();
    for (const e of journal.entries) if (e.currency === currency) for (const l of e.lines) used.add(l.account);
    return (Object.keys(ACCOUNTS) as AccountCode[]).filter((c) => used.has(c));
  }, [journal.entries, currency]);
  useEffect(() => {
    if (ledgerAccounts.length && !ledgerAccounts.includes(ledgerAccount)) setLedgerAccount(ledgerAccounts[0]);
  }, [ledgerAccounts, ledgerAccount]);
  const ledger = useMemo(() => accountLedger(journal.entries, currency, ledgerAccount, period), [journal.entries, currency, ledgerAccount, period]);

  // ---------------------------------------------------------------- alerts
  const vatDue = -(position.get('2200') || 0) - (position.get('1400') || 0);
  const pendingSettlement = position.get('1150') || 0;
  const alerts: { text: string; action?: () => void; actionLabel?: string }[] = [];
  if (pendingVault.length) {
    alerts.push({
      text: L(`${pendingVault.length} حركة خزنة يدوية تحتاج تصنيفاً (رأس مال، مسحوبات، قرض...). حتى تُصنَّف تبقى في حساب معلّق.`,
        `${pendingVault.length} manual vault movements need a classification (capital, drawings, loan...). Until then they sit in a suspense account.`),
      action: () => setTab('setup'), actionLabel: L('تصنيف', 'Classify'),
    });
  }
  if (journal.issues.unknownCostLines) {
    alerts.push({ text: L(`${journal.issues.unknownCostLines} سطر مبيعات بلا تكلفة مسجّلة، فتكلفة البضاعة المباعة أقل من الحقيقة. أدخل تكلفة المنتجات.`,
      `${journal.issues.unknownCostLines} sold lines have no recorded cost, so cost of goods sold is understated. Enter product costs.`) });
  }
  if (journal.issues.estimatedEntries) {
    alerts.push({ text: L(`${journal.issues.estimatedEntries} قيد مقيَّم بتكلفة المنتج الحالية لأن العملية القديمة لم تحفظ تكلفتها.`,
      `${journal.issues.estimatedEntries} entries are valued at today's product cost because the old record kept no cost.`) });
  }
  if (journal.issues.unvaluedStockMovements) {
    alerts.push({ text: L(`${journal.issues.unvaluedStockMovements} حركة مخزون لمنتج محذوف أو بلا تكلفة لم تدخل الدفاتر.`,
      `${journal.issues.unvaluedStockMovements} stock movements of deleted or cost-less products are not in the books.`) });
  }
  if (recon.cash.book !== recon.cash.actual) {
    alerts.push({ text: L(`رصيد الصندوق في الدفاتر (${money(recon.cash.book)}) لا يطابق رصيد الخزنة (${money(recon.cash.actual)}). السبب عادةً حركات قديمة حُذفت من سجل الخزنة.`,
      `Cash in the books (${money(recon.cash.book)}) differs from the vault (${money(recon.cash.actual)}), usually because old vault records were removed.`) });
  }
  if (inventoryGap) {
    alerts.push({ text: L(`المخزون في الدفاتر ${money(recon.inventory.book)} والمخزون الفعلي بالتكلفة ${money(recon.inventory.actual)}.`,
      `Inventory in the books is ${money(recon.inventory.book)}; stock on hand at cost is ${money(recon.inventory.actual)}.`),
      action: () => setTab('setup'), actionLabel: L('معالجة', 'Resolve') });
  }
  if (recon.receivables.book !== recon.receivables.actual) {
    alerts.push({ text: L(`ذمم العملاء في الدفاتر ${money(recon.receivables.book)} ومجموع ديون العملاء ${money(recon.receivables.actual)}.`,
      `Receivables in the books are ${money(recon.receivables.book)}; customers owe ${money(recon.receivables.actual)}.`) });
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'summary', label: L('الملخص', 'Summary') },
    { id: 'income', label: L('قائمة الدخل', 'Income statement') },
    { id: 'balance', label: L('الميزانية', 'Balance sheet') },
    { id: 'trial', label: L('ميزان المراجعة', 'Trial balance') },
    { id: 'journal', label: L('القيود اليومية', 'Journal') },
    { id: 'ledger', label: L('دفتر الأستاذ', 'Ledger') },
    { id: 'setup', label: L('التصنيف والأرصدة الافتتاحية', 'Classification & opening'), badge: pendingVault.length || undefined },
  ];
  const canExport = tab === 'journal' || tab === 'trial' || tab === 'income' || tab === 'balance';
  const canPrint = tab === 'trial' || tab === 'income' || tab === 'balance';
  const usesAsOf = tab === 'trial' || tab === 'balance';

  const amountCell = (minor: number) => (
    <span className={minor < 0 ? 'text-rose-600 dark:text-rose-400' : ''}>{money(minor)}</span>
  );

  const statementTable = (rows: ReportRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px]">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row.kind === 'section' ? 'bg-slate-50 dark:bg-gray-900/40' : row.kind === 'total' ? 'border-t-2 border-slate-800 dark:border-gray-300 font-bold' : 'border-b border-slate-100 dark:border-gray-700'}>
              <td className={`${TD} w-14 text-slate-400`}>{row.code || ''}</td>
              <td className={`${TD} ${row.kind === 'section' ? 'font-bold' : ''}`}>{row.label}</td>
              {row.amounts.length ? row.amounts.map((a, j) => <td key={j} className={TD_NUM}>{a === null ? '' : amountCell(a)}</td>) : <td />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const kpi = (label: string, minor: number, tone: 'plain' | 'good' = 'plain') => (
    <div className={CARD}>
      <div className="text-xs font-semibold text-slate-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-lg sm:text-xl font-bold tabular-nums ${minor < 0 ? 'text-rose-600 dark:text-rose-400' : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
        {money(minor)}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 md:p-8" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 shadow-xl overflow-hidden text-slate-800 dark:text-gray-100">

        <div className="bg-slate-900 text-white px-5 sm:px-6 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-blue-600 rounded-lg shrink-0">
              <BookOpen className="w-5 h-5 text-cyan-100" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight">{L('المحاسبة', 'Accounting')}</h1>
              <p className="text-xs text-slate-400">{L('قيود تلقائية من عملياتك، وقوائم مالية لكل عملة على حدة', 'Automatic entries from your operations, statements per currency')}</p>
            </div>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg shrink-0" aria-label={L('إغلاق', 'Close')}>
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        <div className="p-4 sm:p-6 bg-slate-50 dark:bg-gray-900/40 border-b border-slate-100 dark:border-gray-700 space-y-3">
          <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label={L('التقارير', 'Reports')}>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 ${
                  tab === t.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-white dark:bg-gray-800 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-gray-700 hover:bg-slate-100 dark:hover:bg-gray-700'
                }`}
              >
                {t.label}
                {t.badge ? <span className="min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[11px] leading-5 text-center">{t.badge}</span> : null}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currencies.length > 1 && (
              <div className="flex gap-1 bg-white dark:bg-gray-800 p-1 rounded-xl border border-slate-200 dark:border-gray-700" role="tablist" aria-label={L('العملة', 'Currency')}>
                {currencies.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="tab"
                    aria-selected={currency === c}
                    onClick={() => setCurrency(c)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap ${currency === c ? 'bg-slate-800 text-white' : 'text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700'}`}
                  >
                    {currencyName(c)}
                  </button>
                ))}
              </div>
            )}
            <label className="sr-only" htmlFor="acc-period">{L('الفترة', 'Period')}</label>
            <select id="acc-period" value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} className={SELECT}>
              {(Object.keys(presetLabels) as PeriodPreset[]).map((p) => <option key={p} value={p}>{presetLabels[p]}</option>)}
            </select>
            {preset === 'custom' && (
              <>
                <DateField aria-label={L('من', 'From')} value={customFrom} onChange={setCustomFrom} className={SELECT} compact />
                <DateField aria-label={L('إلى', 'To')} value={customTo} onChange={setCustomTo} className={SELECT} compact />
              </>
            )}
            <span className="text-xs text-slate-500 dark:text-gray-400">
              {usesAsOf ? asOfText : periodText} · {currencyName(currency)}
            </span>
            <div className="flex gap-2 ms-auto">
              {canPrint && (
                <button type="button" onClick={handlePrint} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap">
                  <Printer className="w-4 h-4" />
                  {L('طباعة / PDF', 'Print / PDF')}
                </button>
              )}
              {canExport && (
                <button type="button" onClick={handleCsv} className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap">
                  <Download className="w-4 h-4" />
                  {L('تصدير CSV', 'Export CSV')}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          {tab === 'summary' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {kpi(L('المبيعات (بدون ضريبة)', 'Sales (excl. VAT)'), income.totalRevenue)}
                {kpi(L('مجمل الربح', 'Gross profit'), income.grossProfit)}
                {kpi(L('المصروفات والرواتب', 'Expenses and salaries'), income.totalExpenses)}
                {kpi(L('صافي الربح', 'Net profit'), income.netProfit, 'good')}
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400">{L(`أرقام الربح عن ${periodText}. الأرصدة أدناه ${asOfText}.`, `Profit figures for ${periodText}. Balances below ${asOfText.toLowerCase()}.`)}</p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {kpi(L('النقد في الخزنة', 'Cash in the vault'), position.get('1100') || 0)}
                {kpi(L('ديون العملاء', 'Customer receivables'), position.get('1200') || 0)}
                {kpi(L('المخزون بالتكلفة', 'Inventory at cost'), position.get('1300') || 0)}
                {kpi(L('ضريبة مستحقة للدولة', 'VAT payable'), vatDue)}
                {kpi(L('رواتب مستحقة غير مدفوعة', 'Unpaid salaries'), -(position.get('2300') || 0))}
                {pendingSettlement !== 0 && kpi(L('مقبوضات بطاقة/محفظة قيد التسوية', 'Card / wallet receipts pending'), pendingSettlement)}
              </div>
              {pendingSettlement !== 0 && (
                <p className="text-xs text-slate-500 dark:text-gray-400">
                  {L('مقبوضات قيد التسوية: مبيعات بالبطاقة أو المحفظة لم تدخل الخزنة، أو دفعات عملاء لم تُسجَّل في الخزنة، أو فرق عملة بين الفاتورة وحساب العميل.',
                    'Pending receipts: card or wallet sales that did not enter the vault, customer payments not recorded in the vault, or a currency difference between an invoice and the customer account.')}
                </p>
              )}
              <div className={CARD}>
                <h2 className="font-bold mb-3 flex items-center gap-2">
                  {alerts.length || !journal.entries.length ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  {L('مراجعة الدفاتر', 'Books review')}
                </h2>
                {journal.entries.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-gray-300">{L('لا توجد عمليات بعد. تظهر القيود تلقائياً مع أول بيع أو شراء أو حركة خزنة.', 'No operations yet. Entries appear automatically with the first sale, purchase or vault movement.')}</p>
                ) : alerts.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-gray-300">{L('الدفاتر متوازنة ومطابقة للخزنة والمخزون وديون العملاء.', 'The books balance and match the vault, the stock and customer debts.')}</p>
                ) : (
                  <ul className="space-y-2">
                    {alerts.map((a, i) => (
                      <li key={i} className="flex items-start justify-between gap-3 text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100 rounded-xl px-3 py-2">
                        <span>{a.text}</span>
                        {a.action && (
                          <button type="button" onClick={a.action} className="shrink-0 px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold">
                            {a.actionLabel}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {(tab === 'income' || tab === 'balance' || tab === 'trial') && (() => {
            const s = statementRows();
            if (!s) return null;
            return (
              <div className={CARD}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h2 className="font-bold">{s.title}</h2>
                  {tab === 'trial' && (
                    <span className={`text-xs font-semibold ${trial.totalDebit === trial.totalCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {trial.totalDebit === trial.totalCredit ? L('متوازن', 'Balanced') : L('غير متوازن', 'Not balanced')}
                    </span>
                  )}
                  {tab === 'balance' && (
                    <span className={`text-xs font-semibold ${balance.balanced ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {balance.balanced ? L('الأصول = الالتزامات + حقوق الملكية', 'Assets = liabilities + equity') : L('غير متوازنة', 'Not balanced')}
                    </span>
                  )}
                </div>
                {statementEmpty ? (
                  <p className="text-sm text-slate-500 dark:text-gray-400">{L('لا توجد حركات في هذه الفترة.', 'No activity in this period.')}</p>
                ) : tab === 'trial' ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px]">
                      <thead><tr className="border-b border-slate-200 dark:border-gray-700">
                        <th className={TH}>{L('رمز', 'Code')}</th><th className={TH}>{L('الحساب', 'Account')}</th>
                        <th className={`${TH} text-end`}>{L('مدين', 'Debit')}</th><th className={`${TH} text-end`}>{L('دائن', 'Credit')}</th>
                      </tr></thead>
                      <tbody>
                        {trial.rows.map((r) => (
                          <tr key={r.code} className="border-b border-slate-100 dark:border-gray-700">
                            <td className={`${TD} text-slate-400`}>{r.code}</td>
                            <td className={TD}>
                              <button type="button" className="hover:underline text-start" onClick={() => { setLedgerAccount(r.code); setTab('ledger'); }}>{accountName(r.code, isAr)}</button>
                            </td>
                            <td className={TD_NUM}>{r.debit ? money(r.debit) : ''}</td>
                            <td className={TD_NUM}>{r.credit ? money(r.credit) : ''}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-800 dark:border-gray-300 font-bold">
                          <td /><td className={TD}>{L('الإجمالي', 'Total')}</td>
                          <td className={TD_NUM}>{money(trial.totalDebit)}</td><td className={TD_NUM}>{money(trial.totalCredit)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : statementTable(s.rows)}
                {s.notes?.map((n) => <p key={n} className="mt-3 text-xs text-amber-700 dark:text-amber-300">{n}</p>)}
              </div>
            );
          })()}

          {tab === 'journal' && (
            <div className="space-y-3">
              {periodEntries.length === 0 && <p className="text-sm text-slate-500 dark:text-gray-400">{L('لا توجد قيود في هذه الفترة.', 'No entries in this period.')}</p>}
              {periodEntries.slice(0, visible).map((e) => (
                <div key={e.id} className={`${CARD} p-0 overflow-hidden`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-slate-50 dark:bg-gray-900/40 text-xs">
                    <span className="font-semibold">{dateLabel(e.date)}</span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-gray-700">{entrySourceLabel(e.source, isAr)}</span>
                    {e.memo && <span className="text-slate-600 dark:text-gray-300 truncate max-w-[60ch]">{e.memo}</span>}
                    {e.estimate && <span className="text-amber-600">{L('تقدير بالتكلفة الحالية', 'Estimated at current cost')}</span>}
                    {e.needsReview && <span className="text-amber-600">{L('بانتظار التصنيف', 'Awaiting classification')}</span>}
                  </div>
                  <table className="w-full">
                    <tbody>
                      {e.lines.map((l, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-gray-700">
                          <td className={`${TD} w-14 text-slate-400`}>{l.account}</td>
                          <td className={`${TD} ${l.credit ? (isAr ? 'pr-8' : 'pl-8') : ''}`}>{accountName(l.account, isAr)}</td>
                          <td className={`${TD_NUM} w-36`}>{l.debit ? money(l.debit) : ''}</td>
                          <td className={`${TD_NUM} w-36`}>{l.credit ? money(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {periodEntries.length > visible && (
                <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)} className="w-full py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded-lg">
                  {L('عرض المزيد', 'Show more')}
                </button>
              )}
            </div>
          )}

          {tab === 'ledger' && (
            <div className={CARD}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <label htmlFor="acc-ledger" className="text-sm font-semibold">{L('الحساب', 'Account')}</label>
                <select id="acc-ledger" value={ledgerAccount} onChange={(e) => setLedgerAccount(e.target.value as AccountCode)} className={SELECT}>
                  {(ledgerAccounts.length ? ledgerAccounts : [ledgerAccount]).map((c) => <option key={c} value={c}>{c} · {accountName(c, isAr)}</option>)}
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead><tr className="border-b border-slate-200 dark:border-gray-700">
                    <th className={TH}>{L('التاريخ', 'Date')}</th><th className={TH}>{L('البيان', 'Memo')}</th>
                    <th className={`${TH} text-end`}>{L('مدين', 'Debit')}</th><th className={`${TH} text-end`}>{L('دائن', 'Credit')}</th>
                    <th className={`${TH} text-end`}>{L('الرصيد', 'Balance')}</th>
                  </tr></thead>
                  <tbody>
                    <tr className="border-b border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-900/40">
                      <td className={TD} colSpan={4}>{L('رصيد أول المدة', 'Opening balance')}</td>
                      <td className={TD_NUM}>{amountCell(ledger.opening)}</td>
                    </tr>
                    {ledger.rows.slice(0, visible).map((r) => (
                      <tr key={r.entry.id} className="border-b border-slate-100 dark:border-gray-700">
                        <td className={`${TD} whitespace-nowrap`}>{dateLabel(r.entry.date)}</td>
                        <td className={TD}>{entrySourceLabel(r.entry.source, isAr)}{r.entry.memo ? ` · ${r.entry.memo}` : ''}</td>
                        <td className={TD_NUM}>{r.debit ? money(r.debit) : ''}</td>
                        <td className={TD_NUM}>{r.credit ? money(r.credit) : ''}</td>
                        <td className={TD_NUM}>{amountCell(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-800 dark:border-gray-300 font-bold">
                      <td className={TD} colSpan={4}>{L('رصيد آخر المدة', 'Closing balance')}</td>
                      <td className={TD_NUM}>{amountCell(ledger.closing)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {ledger.rows.length > visible && (
                <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)} className="mt-2 w-full py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded-lg">
                  {L('عرض المزيد', 'Show more')}
                </button>
              )}
            </div>
          )}

          {tab === 'setup' && (
            <>
              {!user && (
                <p className="text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100 rounded-xl px-3 py-2">
                  {L('وضع المعاينة لا يحفظ أي بيانات.', 'Preview mode does not save anything.')}
                </p>
              )}
              <div className={CARD}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <h2 className="font-bold">{L('حركات الخزنة اليدوية', 'Manual vault movements')}</h2>
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-gray-300">
                    <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
                    {L('غير المصنّفة فقط', 'Unclassified only')}
                  </label>
                </div>
                <p className="text-xs text-slate-500 dark:text-gray-400 mb-3">
                  {L('إيداعات وسحوبات وتسويات أُدخلت يدوياً في الخزنة. حدّد طبيعة كل منها لتظهر في الحساب الصحيح.',
                    'Deposits, withdrawals and adjustments typed into the vault. Say what each one is so it lands in the right account.')}
                </p>
                {configLoading ? (
                  <p className="text-sm text-slate-500">{L('جارٍ التحميل...', 'Loading...')}</p>
                ) : (onlyPending ? pendingVault : manualVault).length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-gray-400">{L('لا توجد حركات تحتاج تصنيفاً.', 'Nothing to classify.')}</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-gray-700">
                    {(onlyPending ? pendingVault : manualVault).slice(0, visible).map((tx) => {
                      const current = config.vaultClasses[tx.id] || '';
                      const inferred = inferVaultClass(tx);
                      return (
                        <li key={tx.id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">
                              <span className={tx.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}>{tx.type === 'income' ? '+' : '−'}</span>{' '}
                              {formatMoney(tx.amount, tx.currency, locale)}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-gray-400 truncate max-w-[50ch]">{dateLabel(tx.timestamp)} · {tx.description || '—'}</div>
                          </div>
                          <select
                            aria-label={L('التصنيف', 'Classification')}
                            value={current}
                            disabled={saving || !user}
                            onChange={(e) => void classifyVault(tx, e.target.value as VaultClass | '')}
                            className={`${SELECT} w-56`}
                          >
                            <option value="">{inferred ? `${L('تلقائي', 'Automatic')}: ${isAr ? VAULT_CLASS_LABELS[inferred].ar : VAULT_CLASS_LABELS[inferred].en}` : L('— اختر —', '— Choose —')}</option>
                            {VAULT_CLASSES_FOR[tx.type].map((c) => <option key={c} value={c}>{isAr ? VAULT_CLASS_LABELS[c].ar : VAULT_CLASS_LABELS[c].en}</option>)}
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {debts.length > 0 && (
                <div className={CARD}>
                  <h2 className="font-bold mb-1">{L('ديون عملاء مُدخلة يدوياً', 'Customer debts typed in by hand')}</h2>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mb-3">
                    {L('ديون لم تأتِ من فاتورة آجلة. الافتراضي: رصيد افتتاحي من قبل استخدام التطبيق.', 'Debts not created by a credit invoice. Default: an opening balance from before the app.')}
                  </p>
                  <ul className="divide-y divide-slate-100 dark:divide-gray-700">
                    {debts.slice(0, visible).map((t) => (
                      <li key={t.id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{customerName.get(t.customerId) || t.customerId} · {formatMoney(t.amount, t.currency, locale)}</div>
                          <div className="text-xs text-slate-500 dark:text-gray-400 truncate max-w-[50ch]">{t.date ? dateLabel(Date.parse(t.date)) : ''} {t.notes ? `· ${t.notes}` : ''}</div>
                        </div>
                        <select
                          aria-label={L('التصنيف', 'Classification')}
                          value={config.debtClasses[t.id] || 'opening'}
                          disabled={saving || !user}
                          onChange={(e) => void classifyDebt(t.id, e.target.value as DebtClass)}
                          className={`${SELECT} w-56`}
                        >
                          <option value="opening">{L('رصيد افتتاحي', 'Opening balance')}</option>
                          <option value="sales">{L('مبيعات بدون فاتورة', 'Sale without invoice')}</option>
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={CARD}>
                <h2 className="font-bold mb-1">{L('مطابقة المخزون', 'Inventory reconciliation')} · {currencyName(currency)}</h2>
                <p className="text-xs text-slate-500 dark:text-gray-400 mb-3">
                  {L('المخزون في الدفاتر يأتي من المشتريات والمبيعات وحركات الكمية. المخزون الفعلي = الكمية × التكلفة الحالية لكل منتج.',
                    'Book inventory comes from purchases, sales and quantity changes. Stock on hand = quantity × current cost of each product.')}
                </p>
                <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                  <div><div className="text-xs text-slate-500">{L('في الدفاتر', 'In the books')}</div><div className="font-bold tabular-nums">{money(recon.inventory.book)}</div></div>
                  <div><div className="text-xs text-slate-500">{L('الفعلي بالتكلفة', 'On hand at cost')}</div><div className="font-bold tabular-nums">{money(recon.inventory.actual)}</div></div>
                  <div><div className="text-xs text-slate-500">{L('الفرق', 'Difference')}</div><div className="font-bold tabular-nums">{amountCell(inventoryGap)}</div></div>
                </div>
                {inventoryGap === 0 ? (
                  <p className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{L('مطابق.', 'Matches.')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={saving || !user} onClick={() => bookInventoryGap('3900')} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold">
                      {L('مخزون سابق لبدء الدفاتر (رصيد افتتاحي)', 'Stock from before the books (opening balance)')}
                    </button>
                    <button type="button" disabled={saving || !user} onClick={() => bookInventoryGap('5300')} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-semibold">
                      {L('عجز/زيادة جرد', 'Count shrinkage / surplus')}
                    </button>
                  </div>
                )}
              </div>

              <div className={CARD}>
                <h2 className="font-bold mb-1">{L('أرصدة افتتاحية', 'Opening balances')} · {currencyName(currency)}</h2>
                <p className="text-xs text-slate-500 dark:text-gray-400 mb-3">
                  {L('ما كان لديك قبل بدء استخدام التطبيق: رصيد البنك، أصول، قروض، ذمم موردين. رصيد الخزنة يُضبط من شاشة الخزنة، وديون العملاء من شاشة العملاء.',
                    'What you had before using the app: bank balance, assets, loans, supplier payables. Cash is set from the vault screen and customer debts from the customers screen.')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
                  <select aria-label={L('الحساب', 'Account')} value={openAccount} onChange={(e) => setOpenAccount(e.target.value as AccountCode)} className={SELECT}>
                    {OPENING_ACCOUNTS.map((c) => <option key={c} value={c}>{accountName(c, isAr)}</option>)}
                  </select>
                  <input type="number" inputMode="decimal" min="0" step="any" placeholder={L('المبلغ', 'Amount')} aria-label={L('المبلغ', 'Amount')} value={openAmount} onChange={(e) => setOpenAmount(e.target.value)} className={SELECT} />
                  <DateField aria-label={L('التاريخ', 'Date')} value={openDate} onChange={setOpenDate} className={SELECT} />
                  <input type="text" placeholder={L('ملاحظة (اختياري)', 'Note (optional)')} aria-label={L('ملاحظة', 'Note')} value={openMemo} onChange={(e) => setOpenMemo(e.target.value)} className={SELECT} />
                </div>
                <button type="button" disabled={saving || !user} onClick={addOpening} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold">
                  {L('إضافة رصيد افتتاحي', 'Add opening balance')}
                </button>

                {config.entries.length > 0 && (
                  <ul className="mt-4 divide-y divide-slate-100 dark:divide-gray-700">
                    {config.entries.map((e) => (
                      <li key={e.id} className="py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 text-sm">
                          <div className="font-semibold">{formatMoney(e.amount, e.currency, locale)} · {accountName(e.debit, isAr)} / {accountName(e.credit, isAr)}</div>
                          <div className="text-xs text-slate-500 dark:text-gray-400 truncate">{dateLabel(e.date)} · {e.memo}</div>
                        </div>
                        <button type="button" disabled={saving || !user} onClick={() => void removeEntry(e.id)} className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50" aria-label={L('حذف', 'Delete')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
