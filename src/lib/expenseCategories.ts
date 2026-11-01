import type { VaultTransaction } from '../types';

export const EXPENSE_CATEGORY_IDS = ['rent', 'utilities', 'shipping', 'salary', 'damaged', 'marketing', 'general'] as const;
export type ExpenseCategoryId = (typeof EXPENSE_CATEGORY_IDS)[number];

/**
 * Categories offered when logging a new OpEx from Purchases/Expenses.
 * Staff pay must go through Employees → Pay salary (real payroll + vault), never as a free-form “salary” expense.
 * `salary` stays in EXPENSE_CATEGORY_IDS so historical rows and filters still classify correctly.
 */
export const EXPENSE_ENTRY_CATEGORY_IDS = ['rent', 'utilities', 'shipping', 'damaged', 'marketing', 'general'] as const;
export type ExpenseEntryCategoryId = (typeof EXPENSE_ENTRY_CATEGORY_IDS)[number];

const LABELS: Record<ExpenseCategoryId, { ar: string; en: string }> = {
  rent: { ar: 'إيجار', en: 'Rent' },
  utilities: { ar: 'كهرباء ومياه واشتراكات', en: 'Utilities and subscriptions' },
  shipping: { ar: 'توصيل وشحن', en: 'Shipping and delivery' },
  salary: { ar: 'رواتب الموظفين', en: 'Staff salaries' },
  damaged: { ar: 'تلف وهدر بضائع', en: 'Damaged goods' },
  marketing: { ar: 'تسويق وإعلانات', en: 'Marketing and advertising' },
  general: { ar: 'مصروف تشغيلي عام', en: 'General operating expense' },
};

/**
 * Expenses store their category only as a "[label] note" prefix in the description, in whatever language
 * and wording was current when they were saved. Every label ever shipped must stay here so old records keep their category.
 */
const SAVED_LABELS: Record<ExpenseCategoryId, string[]> = {
  rent: ['إيجار مقار عمل', 'إيجار مقار العمل', 'Workplace Rent'],
  utilities: ['Electricity & Utilities'],
  shipping: ['توصيل وشحن لوجستي', 'Shipping & Logistics'],
  salary: ['Staff Salaries'],
  damaged: ['Damaged Goods Waste'],
  marketing: ['تسويق وإيرادات إعلانات', 'Marketing & Advertising'],
  general: ['مصرف تشغيلي عام', 'General Operational Expense'],
};

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const BY_LABEL = new Map<string, ExpenseCategoryId>();
for (const id of EXPENSE_CATEGORY_IDS) {
  for (const label of [LABELS[id].ar, LABELS[id].en, ...SAVED_LABELS[id]]) BY_LABEL.set(normalize(label), id);
}

export function expenseCategoryLabel(id: ExpenseCategoryId, ar: boolean): string {
  return ar ? LABELS[id].ar : LABELS[id].en;
}

/** The "[label] note" description an expense is saved with. */
export function expenseDescription(id: ExpenseCategoryId, ar: boolean, note: string): string {
  return `[${expenseCategoryLabel(id, ar)}] ${note.trim()}`;
}

/** Category of a saved expense, whatever language or label version it was written with. Null when unknown. */
export function expenseCategoryOf(tx: Pick<VaultTransaction, 'category' | 'description'>): ExpenseCategoryId | null {
  const m = /^\s*\[([^\]]+)\]/.exec(tx.description || '');
  const fromLabel = m ? BY_LABEL.get(normalize(m[1])) : undefined;
  if (fromLabel) return fromLabel;
  return tx.category === 'salary' ? 'salary' : null;
}

/** Largest category by amount. The caller passes expenses of one currency only. */
export function topExpenseCategory(
  txs: Pick<VaultTransaction, 'category' | 'description' | 'amount'>[],
): { id: ExpenseCategoryId; amount: number; share: number } | null {
  const totals = new Map<ExpenseCategoryId, number>();
  let all = 0;
  for (const tx of txs) {
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    all += amount;
    const id = expenseCategoryOf(tx);
    if (id) totals.set(id, (totals.get(id) || 0) + amount);
  }
  let best: { id: ExpenseCategoryId; amount: number } | null = null;
  for (const [id, amount] of totals) if (!best || amount > best.amount) best = { id, amount };
  return best && all > 0 ? { ...best, share: best.amount / all } : null;
}
