import type { CustomerTransaction, Invoice, PayrollRecord, Product, StockMovement, VaultTransaction } from '../types';
import { currencyDecimals, roundMoney } from './exchangeRates';
import { expenseCategoryOf, type ExpenseCategoryId } from './expenseCategories';
import { lineUnits } from './packs';

/**
 * Double-entry books derived from the records the app already keeps (invoices, vault, customer ledger, payroll, stock movements).
 * Nothing here is stored: the journal is rebuilt from the source records, so it can never drift from them.
 * Every currency is its own set of books; amounts are never converted or added across currencies.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export const ACCOUNT_CODES = [
  '1100', '1150', '1200', '1300', '1400', '1500', '1600',
  '2100', '2150', '2200', '2300', '2400',
  '3100', '3200', '3900', '3950',
  '4100', '4900',
  '5100', '5200', '5300', '5400', '5410', '5420', '5430', '5440', '5450', '5900', '5950',
] as const;
export type AccountCode = (typeof ACCOUNT_CODES)[number];

export interface Account {
  code: AccountCode;
  type: AccountType;
  ar: string;
  en: string;
}

const A = (code: AccountCode, type: AccountType, ar: string, en: string): Account => ({ code, type, ar, en });

export const ACCOUNTS: Record<AccountCode, Account> = {
  1100: A('1100', 'asset', 'الصندوق (الخزنة)', 'Cash (vault)'),
  1150: A('1150', 'asset', 'مقبوضات قيد التسوية', 'Receipts pending settlement'),
  1200: A('1200', 'asset', 'ذمم العملاء', 'Customer receivables'),
  1300: A('1300', 'asset', 'المخزون', 'Inventory'),
  1400: A('1400', 'asset', 'ضريبة المشتريات (مدخلات)', 'Input VAT'),
  1500: A('1500', 'asset', 'البنك', 'Bank'),
  1600: A('1600', 'asset', 'أصول ثابتة', 'Fixed assets'),
  2100: A('2100', 'liability', 'مشتريات قيد السداد', 'Purchases pending payment'),
  2150: A('2150', 'liability', 'ذمم الموردين', 'Supplier payables'),
  2200: A('2200', 'liability', 'ضريبة المبيعات (مخرجات)', 'Output VAT'),
  2300: A('2300', 'liability', 'رواتب مستحقة', 'Salaries payable'),
  2400: A('2400', 'liability', 'قروض', 'Loans'),
  3100: A('3100', 'equity', 'رأس المال', 'Owner capital'),
  3200: A('3200', 'equity', 'مسحوبات المالك', 'Owner drawings'),
  3900: A('3900', 'equity', 'أرصدة افتتاحية', 'Opening balances'),
  3950: A('3950', 'equity', 'حركات خزنة بانتظار التصنيف', 'Vault movements awaiting classification'),
  4100: A('4100', 'revenue', 'المبيعات', 'Sales'),
  4900: A('4900', 'revenue', 'إيرادات أخرى', 'Other income'),
  5100: A('5100', 'expense', 'تكلفة البضاعة المباعة', 'Cost of goods sold'),
  5200: A('5200', 'expense', 'الرواتب والأجور', 'Salaries and wages'),
  5300: A('5300', 'expense', 'فروقات المخزون (عجز/زيادة)', 'Inventory shrinkage / surplus'),
  5400: A('5400', 'expense', 'الإيجار', 'Rent'),
  5410: A('5410', 'expense', 'كهرباء ومياه واشتراكات', 'Utilities and subscriptions'),
  5420: A('5420', 'expense', 'نقل وتوصيل وشحن', 'Transport and shipping'),
  5430: A('5430', 'expense', 'تسويق وإعلانات', 'Marketing and advertising'),
  5440: A('5440', 'expense', 'تلف وهدر بضائع', 'Damaged goods'),
  5450: A('5450', 'expense', 'ضرائب ورسوم حكومية', 'Taxes and government fees'),
  5900: A('5900', 'expense', 'مصروفات عامة', 'General expenses'),
  5950: A('5950', 'expense', 'عجز/زيادة الصندوق', 'Cash over / short'),
};

export function accountName(code: AccountCode, isAr: boolean): string {
  return isAr ? ACCOUNTS[code].ar : ACCOUNTS[code].en;
}

/** Debit-normal accounts grow with debits; the others grow with credits. */
export function isDebitNormal(code: AccountCode): boolean {
  const t = ACCOUNTS[code].type;
  return t === 'asset' || t === 'expense';
}

/** How the owner classifies a vault deposit or withdrawal that the app cannot place by itself. */
export const VAULT_CLASSES = ['capital', 'drawings', 'loan', 'opening', 'sales', 'other_income', 'expense', 'cash_diff'] as const;
export type VaultClass = (typeof VAULT_CLASSES)[number];

export const VAULT_CLASS_ACCOUNT: Record<VaultClass, AccountCode> = {
  capital: '3100',
  drawings: '3200',
  loan: '2400',
  opening: '3900',
  sales: '4100',
  other_income: '4900',
  expense: '5900',
  cash_diff: '5950',
};

/** Classes that make sense for each direction of cash. */
export const VAULT_CLASSES_FOR: Record<VaultTransaction['type'], VaultClass[]> = {
  income: ['capital', 'opening', 'loan', 'sales', 'other_income', 'cash_diff'],
  expense: ['drawings', 'expense', 'loan', 'opening', 'cash_diff'],
};

/** A customer debt typed in by hand (not from a credit invoice): a balance from before the app, or a sale made outside it. */
export type DebtClass = 'opening' | 'sales';
export const DEBT_CLASS_ACCOUNT: Record<DebtClass, AccountCode> = { opening: '3900', sales: '4100' };

/**
 * Accounts the owner may give an opening balance, always against 3900. Cash is excluded: the vault balance is the cash book;
 * receivables too: they come from the customers' accounts.
 */
export const OPENING_ACCOUNTS: AccountCode[] = ['1300', '1500', '1600', '1400', '2150', '2400', '2200', '3100'];

/** Opening balance of `account`, as a journal pair against opening balances (3900). */
export function openingEntrySides(account: AccountCode): { debit: AccountCode; credit: AccountCode } {
  return isDebitNormal(account) ? { debit: account, credit: '3900' } : { debit: '3900', credit: account };
}

/**
 * Books the gap between the inventory account and the stock actually on hand at today's cost.
 * Against 3900 when the stock predates the books, against 5300 when it is a real shrinkage or surplus. Null when there is no gap.
 */
export function inventoryAdjustmentSides(
  bookMinor: number,
  actualMinor: number,
  counter: '3900' | '5300',
): { debit: AccountCode; credit: AccountCode; amountMinor: number } | null {
  const gap = actualMinor - bookMinor;
  if (!gap) return null;
  return gap > 0 ? { debit: '1300', credit: counter, amountMinor: gap } : { debit: counter, credit: '1300', amountMinor: -gap };
}

export interface ManualEntry {
  id: string;
  /** Epoch ms. */
  date: number;
  currency: string;
  debit: AccountCode;
  credit: AccountCode;
  amount: number;
  memo: string;
  kind: 'opening' | 'inventory_adjustment';
}

/** Stored in settings/accounting (owner only). */
export interface AccountingConfig {
  vaultClasses: Record<string, VaultClass>;
  debtClasses: Record<string, DebtClass>;
  entries: ManualEntry[];
  updatedAt?: number;
}

export const EMPTY_ACCOUNTING_CONFIG: AccountingConfig = { vaultClasses: {}, debtClasses: {}, entries: [] };

const isAccountCode = (v: unknown): v is AccountCode => typeof v === 'string' && (ACCOUNT_CODES as readonly string[]).includes(v);

/** Drops anything malformed so a damaged or older document can never break the books. */
export function normalizeAccountingConfig(raw: unknown): AccountingConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const vaultClasses: Record<string, VaultClass> = {};
  for (const [id, cls] of Object.entries(src.vaultClasses || {})) {
    if ((VAULT_CLASSES as readonly string[]).includes(cls as string)) vaultClasses[id] = cls as VaultClass;
  }
  const debtClasses: Record<string, DebtClass> = {};
  for (const [id, cls] of Object.entries(src.debtClasses || {})) {
    if (cls === 'opening' || cls === 'sales') debtClasses[id] = cls;
  }
  const entries: ManualEntry[] = [];
  for (const e of Array.isArray(src.entries) ? src.entries : []) {
    if (!e || typeof e.id !== 'string' || typeof e.currency !== 'string') continue;
    const amount = Number(e.amount);
    const date = Number(e.date);
    if (!isAccountCode(e.debit) || !isAccountCode(e.credit) || e.debit === e.credit) continue;
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(date)) continue;
    entries.push({
      id: e.id,
      date,
      currency: e.currency,
      debit: e.debit,
      credit: e.credit,
      amount,
      memo: typeof e.memo === 'string' ? e.memo : '',
      kind: e.kind === 'inventory_adjustment' ? 'inventory_adjustment' : 'opening',
    });
  }
  return { vaultClasses, debtClasses, entries, updatedAt: Number(src.updatedAt) || undefined };
}

// ---------------------------------------------------------------- amounts

const scale = (code: string) => 10 ** currencyDecimals(code);

/** Whole minor units (fils, agorot, cents). Books are summed in these so a debit total equals a credit total exactly. */
export function toMinor(value: number, code: string): number {
  return Math.round(roundMoney(Number(value) || 0, code) * scale(code));
}

export function fromMinor(minor: number, code: string): number {
  return roundMoney(minor / scale(code), code);
}

// ---------------------------------------------------------------- journal

export type EntrySource = 'sale' | 'cogs' | 'purchase' | 'vault' | 'customer' | 'payroll' | 'stock' | 'manual';

export interface JournalLine {
  account: AccountCode;
  /** Minor units, never negative; exactly one of debit / credit is non-zero. */
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  date: number;
  currency: string;
  source: EntrySource;
  /** Id of the record the entry comes from. */
  refId: string;
  /** Invoice number, employee name, description... */
  memo: string;
  lines: JournalLine[];
  /** Valued at today's product cost because no cost was recorded at the time. */
  estimate?: boolean;
  /** Posted to the suspense account until the owner classifies it. */
  needsReview?: boolean;
}

/** Builds balanced lines from signed minor amounts (+ debit, − credit). Zero lines are dropped. */
function lines(parts: [AccountCode, number][]): JournalLine[] {
  const byAccount = new Map<AccountCode, number>();
  for (const [account, amount] of parts) byAccount.set(account, (byAccount.get(account) || 0) + amount);
  const out: JournalLine[] = [];
  for (const [account, amount] of byAccount) {
    if (amount > 0) out.push({ account, debit: amount, credit: 0 });
    else if (amount < 0) out.push({ account, debit: 0, credit: -amount });
  }
  return out;
}

export function entryIsBalanced(entry: Pick<JournalEntry, 'lines'>): boolean {
  let d = 0;
  let c = 0;
  for (const l of entry.lines) {
    d += l.debit;
    c += l.credit;
  }
  return d === c;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const normalizeLabel = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const EXPENSE_CATEGORY_ACCOUNT: Record<ExpenseCategoryId, AccountCode> = {
  rent: '5400',
  utilities: '5410',
  shipping: '5420',
  salary: '5200',
  damaged: '5440',
  marketing: '5430',
  general: '5900',
};

/** Vault screen expense labels. They are saved as the whole description, or as a "[label] note" prefix. */
const VAULT_EXPENSE_LABELS: [string, AccountCode][] = [
  ['إيجار', '5400'], ['rent', '5400'],
  ['كهرباء ومياه واشتراكات', '5410'], ['utilities', '5410'],
  ['نقل ولوجستيك داخلي', '5420'], ['transport', '5420'],
  ['ضرائب ورسوم حكومية', '5450'], ['taxes', '5450'],
  ['مصروف عام', '5900'], ['general expense', '5900'],
];
const VAULT_EXPENSE_BY_LABEL = new Map(VAULT_EXPENSE_LABELS.map(([label, code]) => [normalizeLabel(label), code]));

/** Expense account of a vault expense, from the category it was saved with. Unknown categories go to general expenses. */
export function expenseAccountOf(tx: Pick<VaultTransaction, 'category' | 'description'>): AccountCode {
  const id = expenseCategoryOf(tx);
  if (id) return EXPENSE_CATEGORY_ACCOUNT[id];
  return VAULT_EXPENSE_BY_LABEL.get(savedLabel(tx.description)) || '5900';
}

const CAPITAL_LABELS = new Set(['إيداع رأس مال', 'capital deposit'].map(normalizeLabel));

/** The category label a vault record was saved with: its whole description, or a "[label] note" prefix. */
function savedLabel(description: string | undefined): string {
  const desc = description || '';
  const bracket = /^\s*\[([^\]]+)\]/.exec(desc);
  return normalizeLabel(bracket ? bracket[1] : desc);
}

/** What a manual vault movement most likely is, when the record itself says so. Null means the owner must decide. */
export function inferVaultClass(tx: Pick<VaultTransaction, 'type' | 'category' | 'description'>): VaultClass | null {
  if (tx.type === 'income' && tx.category === 'sale') return 'sales';
  if (tx.type === 'income' && CAPITAL_LABELS.has(savedLabel(tx.description))) return 'capital';
  return null;
}

type VaultSourceResolved = NonNullable<VaultTransaction['source']>;

/** Records saved before `source` existed are placed by their category. */
export function vaultSourceOf(tx: Pick<VaultTransaction, 'source' | 'category' | 'type' | 'refId'>): VaultSourceResolved {
  if (tx.source) return tx.source;
  switch (tx.category) {
    case 'sale': return tx.refId ? 'sale_invoice' : 'manual';
    case 'purchase': return 'purchase_invoice';
    case 'salary': return 'payroll';
    case 'other': return tx.type === 'expense' ? 'expense' : 'manual';
    default: return 'manual';
  }
}

/** Manual vault movements the owner still has to classify. */
export function vaultNeedsClass(tx: VaultTransaction, config: AccountingConfig): boolean {
  return vaultSourceOf(tx) === 'manual' && !config.vaultClasses[tx.id] && !inferVaultClass(tx);
}

/** The account a vault movement moves cash against. */
function vaultCounterAccount(tx: VaultTransaction, config: AccountingConfig): { account: AccountCode; needsReview: boolean } {
  const source = vaultSourceOf(tx);
  const manual = (): { account: AccountCode; needsReview: boolean } => {
    const cls = config.vaultClasses[tx.id] || inferVaultClass(tx);
    return cls ? { account: VAULT_CLASS_ACCOUNT[cls], needsReview: false } : { account: '3950', needsReview: true };
  };
  switch (source) {
    case 'sale_invoice':
    case 'customer_payment':
      return { account: '1150', needsReview: false };
    case 'purchase_invoice':
      return { account: '2100', needsReview: false };
    case 'payroll':
      return { account: tx.refId ? '2300' : '5200', needsReview: false };
    case 'expense':
      return { account: expenseAccountOf(tx), needsReview: false };
    case 'reversal':
      if (tx.category === 'sale') return { account: '1150', needsReview: false };
      if (tx.category === 'purchase') return { account: '2100', needsReview: false };
      if (tx.category === 'salary') return { account: tx.refId ? '2300' : '5200', needsReview: false };
      if (tx.category === 'other') return { account: expenseAccountOf(tx), needsReview: false };
      return manual();
    default:
      return manual();
  }
}

/** Customer ledger debits that belong to a credit invoice, matched the same way deleting the invoice finds them. */
function invoiceLinkedDebts(invoices: Invoice[], txs: CustomerTransaction[]): Set<string> {
  const linked = new Set<string>();
  const debits = txs.filter((t) => t.type === 'invoice');
  const byId = new Map(debits.map((t) => [t.id, t]));
  const byCustomer = new Map<string, CustomerTransaction[]>();
  for (const t of debits) {
    const list = byCustomer.get(t.customerId);
    if (list) list.push(t);
    else byCustomer.set(t.customerId, [t]);
  }
  for (const inv of invoices) {
    if (inv.type !== 'sale' || inv.paymentMethod !== 'credit' || !inv.customerId) continue;
    const direct = byId.get(`inv-${inv.id}`);
    if (direct) {
      linked.add(direct.id);
      continue;
    }
    const legacy = byCustomer.get(inv.customerId)?.find((t) => !linked.has(t.id)
      && (t.invoiceId === inv.id || (!!inv.invoiceNumber && (t.notes || '').includes(`#${inv.invoiceNumber}`))));
    if (legacy) linked.add(legacy.id);
  }
  return linked;
}

/** Customer debts typed in by hand. */
export function manualDebts(invoices: Invoice[], txs: CustomerTransaction[]): CustomerTransaction[] {
  const linked = invoiceLinkedDebts(invoices, txs);
  return txs.filter((t) => t.type === 'invoice' && !linked.has(t.id));
}

const isTransfer = (m: StockMovement) =>
  !!m.transfer || /^(نقل بين المستودعات|Warehouse transfer)/.test(m.reason || '');

const txDate = (value: string | number | undefined) => {
  const n = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(n) ? n : 0;
};

export interface JournalInput {
  invoices: Invoice[];
  products: Product[];
  vaultTransactions: VaultTransaction[];
  customerTransactions: CustomerTransaction[];
  payrollRecords: PayrollRecord[];
  stockMovements: StockMovement[];
  config: AccountingConfig;
  defaultCurrency: string;
}

export interface JournalIssues {
  /** Sold lines with no recorded cost: their cost of goods is missing from the books. */
  unknownCostLines: number;
  /** Entries valued at today's product cost. */
  estimatedEntries: number;
  /** Stock changes of products that no longer exist or have no cost. */
  unvaluedStockMovements: number;
  /** Manual vault movements waiting for a classification. */
  unclassifiedVault: number;
}

export interface Journal {
  entries: JournalEntry[];
  issues: JournalIssues;
}

export function buildJournal(input: JournalInput): Journal {
  const { config, defaultCurrency } = input;
  const productsById = new Map(input.products.map((p) => [p.id, p]));
  const entries: JournalEntry[] = [];
  const issues: JournalIssues = { unknownCostLines: 0, estimatedEntries: 0, unvaluedStockMovements: 0, unclassifiedVault: 0 };
  const push = (e: Omit<JournalEntry, 'lines'> & { parts: [AccountCode, number][] }) => {
    const { parts, ...rest } = e;
    const built = lines(parts);
    if (built.length) entries.push({ ...rest, lines: built });
  };

  for (const inv of input.invoices) {
    const currency = inv.currency || defaultCurrency;
    const total = toMinor(num(inv.totalAmount), currency);
    const tax = toMinor(num(inv.taxAmount), currency);
    const date = num(inv.date);
    const memo = inv.invoiceNumber ? `#${inv.invoiceNumber}` : inv.id;
    if (inv.type === 'sale') {
      push({ id: `sale-${inv.id}`, date, currency, source: 'sale', refId: inv.id, memo,
        parts: [['1150', total], ['4100', -(total - tax)], ['2200', -tax]] });

      const costByCurrency = new Map<string, { minorValue: number; estimate: boolean }>();
      for (const item of inv.items || []) {
        const units = lineUnits(item);
        let unitCost: number | null = null;
        let costCurrency = currency;
        let estimate = false;
        if (typeof item.unitCost === 'number' && Number.isFinite(item.unitCost) && item.unitCost >= 0) {
          unitCost = item.unitCost;
          costCurrency = item.costCurrency || currency;
        } else {
          const product = productsById.get(item.productId);
          const current = num(product?.unitCost ?? product?.costPrice);
          if (product && current > 0) {
            unitCost = current;
            costCurrency = product.currency || defaultCurrency;
            estimate = true;
          }
        }
        if (unitCost === null) {
          issues.unknownCostLines += 1;
          continue;
        }
        const bucket = costByCurrency.get(costCurrency) || { minorValue: 0, estimate: false };
        bucket.minorValue += unitCost * units * scale(costCurrency);
        bucket.estimate ||= estimate;
        costByCurrency.set(costCurrency, bucket);
      }
      for (const [costCurrency, { minorValue, estimate }] of costByCurrency) {
        const cost = Math.round(minorValue);
        if (estimate) issues.estimatedEntries += 1;
        push({ id: `cogs-${inv.id}-${costCurrency}`, date, currency: costCurrency, source: 'cogs', refId: inv.id, memo, estimate,
          parts: [['5100', cost], ['1300', -cost]] });
      }
    } else if (inv.type === 'purchase') {
      push({ id: `purchase-${inv.id}`, date, currency, source: 'purchase', refId: inv.id, memo,
        parts: [['1300', total - tax], ['1400', tax], ['2100', -total]] });
    }
  }

  for (const tx of input.vaultTransactions) {
    const currency = tx.currency || defaultCurrency;
    const amount = toMinor(num(tx.amount), currency);
    if (!amount) continue;
    const { account, needsReview } = vaultCounterAccount(tx, config);
    if (needsReview) issues.unclassifiedVault += 1;
    const cash = tx.type === 'income' ? amount : -amount;
    push({ id: `vault-${tx.id}`, date: num(tx.timestamp), currency, source: 'vault', refId: tx.id, memo: tx.description || '',
      needsReview: needsReview || undefined, parts: [['1100', cash], [account, -cash]] });
  }

  const linked = invoiceLinkedDebts(input.invoices, input.customerTransactions);
  for (const t of input.customerTransactions) {
    const currency = t.currency || defaultCurrency;
    const amount = toMinor(num(t.amount), currency);
    if (!amount) continue;
    const date = txDate(t.date);
    const memo = t.notes || t.transactionId || '';
    if (t.type === 'payment') {
      push({ id: `customer-${t.id}`, date, currency, source: 'customer', refId: t.id, memo, parts: [['1150', amount], ['1200', -amount]] });
    } else {
      const counter: AccountCode = linked.has(t.id) ? '1150' : DEBT_CLASS_ACCOUNT[config.debtClasses[t.id] || 'opening'];
      push({ id: `customer-${t.id}`, date, currency, source: 'customer', refId: t.id, memo, parts: [['1200', amount], [counter, -amount]] });
    }
  }

  for (const r of input.payrollRecords) {
    const currency = r.currency || defaultCurrency;
    const amount = toMinor(num(r.netSalary), currency);
    if (!amount) continue;
    push({ id: `payroll-${r.id}`, date: num(r.paymentDate), currency, source: 'payroll', refId: r.id,
      memo: [r.employeeName, r.monthYear].filter(Boolean).join(' · '), parts: [['5200', amount], ['2300', -amount]] });
  }

  for (const m of input.stockMovements) {
    if (isTransfer(m)) continue;
    const delta = num(m.delta);
    if (!delta) continue;
    let unitCost: number | null = null;
    let currency = defaultCurrency;
    let estimate = false;
    if (typeof m.unitCost === 'number' && Number.isFinite(m.unitCost) && m.unitCost >= 0) {
      unitCost = m.unitCost;
      currency = m.costCurrency || defaultCurrency;
    } else {
      const product = productsById.get(m.productId);
      const current = num(product?.unitCost ?? product?.costPrice);
      if (product && current > 0) {
        unitCost = current;
        currency = product.currency || defaultCurrency;
        estimate = true;
      }
    }
    if (unitCost === null) {
      issues.unvaluedStockMovements += 1;
      continue;
    }
    const value = Math.round(unitCost * delta * scale(currency));
    if (!value) continue;
    if (estimate) issues.estimatedEntries += 1;
    const counter: AccountCode = m.type === 'initial' ? '3900' : '5300';
    push({ id: `stock-${m.id}`, date: num(m.timestamp), currency, source: 'stock', refId: m.id,
      memo: [m.productName, m.reason].filter(Boolean).join(' · '), estimate: estimate || undefined,
      parts: [['1300', value], [counter, -value]] });
  }

  for (const e of config.entries) {
    const amount = toMinor(e.amount, e.currency);
    push({ id: `manual-${e.id}`, date: e.date, currency: e.currency, source: 'manual', refId: e.id, memo: e.memo,
      parts: [[e.debit, amount], [e.credit, -amount]] });
  }

  entries.sort((a, b) => a.date - b.date || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries, issues };
}

// ---------------------------------------------------------------- reports

export interface Period {
  /** Inclusive epoch ms; omitted = from the beginning. */
  from?: number;
  /** Inclusive epoch ms; omitted = up to now. */
  to?: number;
}

const inPeriod = (date: number, p: Period) => (p.from === undefined || date >= p.from) && (p.to === undefined || date <= p.to);

export function journalCurrencies(entries: JournalEntry[]): string[] {
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.currency, (count.get(e.currency) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/** Debit minus credit per account, in minor units, for one currency's books. */
export function accountBalances(entries: JournalEntry[], currency: string, period: Period = {}): Map<AccountCode, number> {
  const out = new Map<AccountCode, number>();
  for (const e of entries) {
    if (e.currency !== currency || !inPeriod(e.date, period)) continue;
    for (const l of e.lines) out.set(l.account, (out.get(l.account) || 0) + l.debit - l.credit);
  }
  return out;
}

export interface TrialBalanceRow {
  code: AccountCode;
  debit: number;
  credit: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
}

/** Closing balance of every account with a balance up to `asOf`, debit balances on the left. Minor units. */
export function trialBalance(entries: JournalEntry[], currency: string, asOf?: number): TrialBalance {
  const balances = accountBalances(entries, currency, { to: asOf });
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const code of ACCOUNT_CODES) {
    const b = balances.get(code) || 0;
    if (!b) continue;
    rows.push({ code, debit: b > 0 ? b : 0, credit: b < 0 ? -b : 0 });
    if (b > 0) totalDebit += b;
    else totalCredit -= b;
  }
  return { rows, totalDebit, totalCredit };
}

export interface StatementLine {
  code: AccountCode;
  /** Minor units, signed so that the normal side is positive. */
  amount: number;
}

export interface IncomeStatement {
  revenue: StatementLine[];
  totalRevenue: number;
  cogs: number;
  grossProfit: number;
  expenses: StatementLine[];
  totalExpenses: number;
  netProfit: number;
}

export function incomeStatement(entries: JournalEntry[], currency: string, period: Period): IncomeStatement {
  const balances = accountBalances(entries, currency, period);
  const revenue: StatementLine[] = [];
  const expenses: StatementLine[] = [];
  let totalRevenue = 0;
  let cogs = 0;
  let totalExpenses = 0;
  for (const code of ACCOUNT_CODES) {
    const b = balances.get(code) || 0;
    if (!b) continue;
    const type = ACCOUNTS[code].type;
    if (type === 'revenue') {
      revenue.push({ code, amount: -b });
      totalRevenue -= b;
    } else if (code === '5100') {
      cogs = b;
    } else if (type === 'expense') {
      expenses.push({ code, amount: b });
      totalExpenses += b;
    }
  }
  const grossProfit = totalRevenue - cogs;
  return { revenue, totalRevenue, cogs, grossProfit, expenses, totalExpenses, netProfit: grossProfit - totalExpenses };
}

export interface BalanceSheet {
  assets: StatementLine[];
  totalAssets: number;
  liabilities: StatementLine[];
  totalLiabilities: number;
  equity: StatementLine[];
  /** Revenue minus expenses of every period up to the date (no closing entries are posted). */
  retainedEarnings: number;
  totalEquity: number;
  /** Balance of the suspense account: vault movements still to classify. */
  unclassified: number;
  balanced: boolean;
}

export function balanceSheet(entries: JournalEntry[], currency: string, asOf?: number): BalanceSheet {
  const balances = accountBalances(entries, currency, { to: asOf });
  const assets: StatementLine[] = [];
  const liabilities: StatementLine[] = [];
  const equity: StatementLine[] = [];
  let totalAssets = 0;
  let totalLiabilities = 0;
  let equityAccounts = 0;
  let retainedEarnings = 0;
  for (const code of ACCOUNT_CODES) {
    const b = balances.get(code) || 0;
    if (!b) continue;
    const type = ACCOUNTS[code].type;
    if (type === 'asset') {
      assets.push({ code, amount: b });
      totalAssets += b;
    } else if (type === 'liability') {
      liabilities.push({ code, amount: -b });
      totalLiabilities -= b;
    } else if (type === 'equity') {
      equity.push({ code, amount: -b });
      equityAccounts -= b;
    } else {
      retainedEarnings -= b;
    }
  }
  const totalEquity = equityAccounts + retainedEarnings;
  return {
    assets, totalAssets, liabilities, totalLiabilities, equity, retainedEarnings, totalEquity,
    unclassified: -(balances.get('3950') || 0) || 0,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

export interface LedgerRow {
  entry: JournalEntry;
  debit: number;
  credit: number;
  /** Running balance on the account's normal side, minor units. */
  balance: number;
}

export interface Ledger {
  opening: number;
  rows: LedgerRow[];
  closing: number;
}

export function accountLedger(entries: JournalEntry[], currency: string, account: AccountCode, period: Period): Ledger {
  const sign = isDebitNormal(account) ? 1 : -1;
  let opening = 0;
  const rows: LedgerRow[] = [];
  let running = 0;
  for (const e of entries) {
    if (e.currency !== currency) continue;
    if (period.to !== undefined && e.date > period.to) continue;
    let debit = 0;
    let credit = 0;
    for (const l of e.lines) {
      if (l.account !== account) continue;
      debit += l.debit;
      credit += l.credit;
    }
    if (!debit && !credit) continue;
    const delta = sign * (debit - credit);
    if (period.from !== undefined && e.date < period.from) {
      opening += delta;
      continue;
    }
    running += delta;
    rows.push({ entry: e, debit, credit, balance: opening + running });
  }
  return { opening, rows, closing: opening + running };
}

export interface Reconciliation {
  /** Cash account against the live vault balance. */
  cash: { book: number; actual: number };
  /** Inventory account against quantity × current cost of the products. */
  inventory: { book: number; actual: number };
  /** Receivables account against the customers' recorded debts. */
  receivables: { book: number; actual: number };
}

/** Book balances (all time) next to what the app shows elsewhere. Amounts in minor units. */
export function reconcile(
  entries: JournalEntry[],
  currency: string,
  actual: { vault: number; stockValue: number; customerDebt: number },
): Reconciliation {
  const b = accountBalances(entries, currency);
  return {
    cash: { book: b.get('1100') || 0, actual: toMinor(actual.vault, currency) },
    inventory: { book: b.get('1300') || 0, actual: toMinor(actual.stockValue, currency) },
    receivables: { book: b.get('1200') || 0, actual: toMinor(actual.customerDebt, currency) },
  };
}

// ---------------------------------------------------------------- export

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

const SOURCE_LABELS: Record<EntrySource, { ar: string; en: string }> = {
  sale: { ar: 'فاتورة بيع', en: 'Sale invoice' },
  cogs: { ar: 'تكلفة مبيعات', en: 'Cost of sale' },
  purchase: { ar: 'فاتورة شراء', en: 'Purchase invoice' },
  vault: { ar: 'حركة خزنة', en: 'Vault movement' },
  customer: { ar: 'حساب عميل', en: 'Customer account' },
  payroll: { ar: 'رواتب', en: 'Payroll' },
  stock: { ar: 'حركة مخزون', en: 'Stock movement' },
  manual: { ar: 'قيد افتتاحي/تسوية', en: 'Opening / adjustment' },
};

export function entrySourceLabel(source: EntrySource, isAr: boolean): string {
  return isAr ? SOURCE_LABELS[source].ar : SOURCE_LABELS[source].en;
}

/** One row per journal line; amounts plain (no grouping) in the books' currency. */
export function buildJournalCsv(entries: JournalEntry[], currency: string, isAr: boolean, dateOf: (ms: number) => string): string {
  const header = isAr
    ? ['رقم القيد', 'التاريخ', 'المصدر', 'البيان', 'رمز الحساب', 'الحساب', 'مدين', 'دائن', 'العملة']
    : ['Entry', 'Date', 'Source', 'Memo', 'Account code', 'Account', 'Debit', 'Credit', 'Currency'];
  const d = currencyDecimals(currency);
  const amount = (minor: number) => (minor ? fromMinor(minor, currency).toFixed(d) : '');
  const rows = [header.map(csvCell).join(',')];
  for (const e of entries) {
    if (e.currency !== currency) continue;
    for (const l of e.lines) {
      rows.push([
        e.id, dateOf(e.date), entrySourceLabel(e.source, isAr), e.memo, l.account, accountName(l.account, isAr),
        amount(l.debit), amount(l.credit), currency,
      ].map(csvCell).join(','));
    }
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
