import { describe, it, expect } from 'vitest';
import {
  EXPENSE_ENTRY_CATEGORY_IDS,
  expenseCategoryOf,
  expenseDescription,
  topExpenseCategory,
} from '../expenseCategories';

describe('expenseCategories', () => {
  it('does not offer salary when logging a new operating expense', () => {
    expect(EXPENSE_ENTRY_CATEGORY_IDS).not.toContain('salary');
    expect(EXPENSE_ENTRY_CATEGORY_IDS).toContain('general');
  });

  it('reads the category from current and older saved labels in both languages', () => {
    expect(expenseCategoryOf({ category: 'other', description: '[مصرف تشغيلي عام] قرطاسية' })).toBe('general');
    expect(expenseCategoryOf({ category: 'other', description: '[مصروف تشغيلي عام] قرطاسية' })).toBe('general');
    expect(expenseCategoryOf({ category: 'other', description: '[Shipping & Logistics] courier' })).toBe('shipping');
    expect(expenseCategoryOf({ category: 'other', description: '[تسويق وإيرادات إعلانات] إعلان' })).toBe('marketing');
    expect(expenseCategoryOf({ category: 'other', description: expenseDescription('rent', true, 'أكتوبر') })).toBe('rent');
  });

  it('falls back to the salary flag and returns null when unknown', () => {
    expect(expenseCategoryOf({ category: 'salary', description: 'Salary paid to Ali' })).toBe('salary');
    expect(expenseCategoryOf({ category: 'other', description: 'no prefix' })).toBeNull();
  });

  it('picks the largest category by amount, not by count', () => {
    const top = topExpenseCategory([
      { category: 'other', description: '[إيجار] أكتوبر', amount: 500 },
      { category: 'other', description: '[توصيل وشحن] 1', amount: 20 },
      { category: 'other', description: '[توصيل وشحن] 2', amount: 30 },
      { category: 'other', description: 'unknown', amount: 450 },
    ]);
    expect(top).toEqual({ id: 'rent', amount: 500, share: 0.5 });
  });

  it('returns null without expenses', () => {
    expect(topExpenseCategory([])).toBeNull();
  });
});
