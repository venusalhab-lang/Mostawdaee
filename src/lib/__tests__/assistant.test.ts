import { describe, expect, it } from 'vitest';
import type { Customer, Invoice, Product } from '../../types';
import { buildSystemInstruction, sanitizeAssistantAction, sanitizeContext, sanitizeHistory } from '../assistantContext';
import { answerLocally, buildAssistantContext, detectIntent, summarizeSales, type AssistantData } from '../assistantLocal';

const product = (over: Partial<Product>): Product => ({
  id: 'p1', name: 'قهوة عربية', sku: '6291041500213', category: 'مشروبات', brand: '', quantity: 12,
  unitCost: 4.5, sellingPrice: 6, currency: 'JOD', status: 'In Stock', dateAdded: 0, ...over,
});

const customer = (over: Partial<Customer>): Customer => ({
  id: 'c1', customerId: 'c1', name: 'أبو أحمد', phone: '0599123456', createdAt: '', totalDebt: 0, currency: 'ILS', ...over,
});

const NOW = new Date(2026, 9, 3, 15, 0, 0).getTime();
const invoice = (over: Partial<Invoice>): Invoice => ({
  id: 'i1', invoiceNumber: '1', date: NOW - 60_000, items: [], subtotal: 0, taxAmount: 0, totalAmount: 100, type: 'sale', currency: 'ILS', ...over,
});

const data = (over: Partial<AssistantData> = {}): AssistantData => ({
  products: [], customers: [], invoices: [], vault: {}, defaultCurrency: 'JOD', ...over,
});

describe('buildSystemInstruction', () => {
  it('embeds the real store data and default currency, not template placeholders', () => {
    const context = buildAssistantContext(data({ products: [product({})], customers: [customer({ totalDebt: 250 })] }), NOW);
    const prompt = buildSystemInstruction({ context, verbosity: 'concise', language: 'ar' });
    expect(prompt).not.toContain('${');
    expect(prompt).toContain('6291041500213');
    expect(prompt).toContain('"totalDebt":250');
    expect(prompt).toContain('default currency JOD');
    expect(prompt).toContain('Reply in Arabic');
  });
});

describe('buildAssistantContext', () => {
  it('does not send customer phone numbers', () => {
    const context = buildAssistantContext(data({ customers: [customer({ totalDebt: 10 })] }), NOW);
    expect(JSON.stringify(context)).not.toContain('0599123456');
  });

  it('keeps vault balances per currency and drops zeros', () => {
    const context = buildAssistantContext(data({ vault: { balanceJOD: 0, balanceILS: 320.5, balanceUSD: -10 } }), NOW);
    expect(context.vault).toEqual({ ILS: 320.5, USD: -10 });
  });
});

describe('sanitizeContext', () => {
  it('drops unknown currencies, bad numbers and rows without ids', () => {
    const ctx = sanitizeContext({
      defaultCurrency: 'XXX',
      products: [{ id: 'a', name: 'A', quantity: 'abc', currency: 'BTC' }, { name: 'no id' }],
      vault: { ILS: 5, BTC: 9 },
    });
    expect(ctx.defaultCurrency).toBe('JOD');
    expect(ctx.products).toHaveLength(1);
    expect(ctx.products[0]).toMatchObject({ quantity: 0, currency: 'JOD' });
    expect(ctx.vault).toEqual({ ILS: 5 });
  });
});

describe('sanitizeHistory', () => {
  it('drops the leading assistant turn and ends with the new message', () => {
    const turns = sanitizeHistory([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], 'c');
    expect(turns.map((t) => t.content)).toEqual(['a', 'b', 'c']);
  });

  it('keeps at most 12 turns', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
    expect(sanitizeHistory(history, 'last')).toHaveLength(12);
  });
});

describe('sanitizeAssistantAction', () => {
  const ctx = { products: [{ id: 'p1' } as any] };

  it('never fills numbers the user did not state', () => {
    const action = sanitizeAssistantAction({ type: 'add_product', product: { name: 'شاي', quantity: null, unitCost: -3 } }, ctx);
    expect(action).toEqual({ type: 'add_product', product: { name: 'شاي' } });
  });

  it('keeps a stated zero', () => {
    const action = sanitizeAssistantAction({ type: 'add_product', product: { name: 'شاي', quantity: 0 } }, ctx);
    expect(action).toEqual({ type: 'add_product', product: { name: 'شاي', quantity: 0 } });
  });

  it('rejects deletes of products that were not in the context', () => {
    expect(sanitizeAssistantAction({ type: 'delete_product', productId: 'ghost' }, ctx)).toBeNull();
    expect(sanitizeAssistantAction({ type: 'delete_product', productId: 'p1' }, ctx)).toEqual({ type: 'delete_product', productId: 'p1' });
  });

  it('rejects invoices and unknown actions', () => {
    expect(sanitizeAssistantAction({ type: 'add_invoice', invoice: { totalAmount: 10 } }, ctx)).toBeNull();
    expect(sanitizeAssistantAction({ type: 'add_customer', customer: { name: '' } }, ctx)).toBeNull();
  });

  it('drops an unsupported customer currency', () => {
    expect(sanitizeAssistantAction({ type: 'add_customer', customer: { name: 'سامي', currency: 'BTC' } }, ctx))
      .toEqual({ type: 'add_customer', customer: { name: 'سامي' } });
  });
});

describe('summarizeSales', () => {
  it('splits today and month per currency and ignores purchases and other months', () => {
    const rows = summarizeSales([
      invoice({ totalAmount: 100 }),
      invoice({ id: '2', totalAmount: 50, date: new Date(2026, 9, 1).getTime() }),
      invoice({ id: '3', totalAmount: 7, currency: 'JOD' }),
      invoice({ id: '4', totalAmount: 999, type: 'purchase' }),
      invoice({ id: '5', totalAmount: 999, date: new Date(2026, 8, 30).getTime() }),
    ], NOW);
    expect(rows).toEqual([
      { currency: 'JOD', todayTotal: 7, todayCount: 1, monthTotal: 7, monthCount: 1 },
      { currency: 'ILS', todayTotal: 100, todayCount: 1, monthTotal: 150, monthCount: 2 },
    ]);
  });
});

describe('answerLocally', () => {
  it('detects intents with Arabic spelling variants', () => {
    expect(detectIntent('اعطني الديون')).toBe('debts');
    expect(detectIntent('ما رصيد الخزينة')).toBe('vault');
    expect(detectIntent('أضف منتج شاي')).toBe('command');
    expect(detectIntent('كم مبيعات اليوم')).toBe('sales');
  });

  it('totals debts per currency without mixing them', () => {
    const text = answerLocally('ديون الزبائن', data({
      customers: [customer({ totalDebt: 100 }), customer({ id: 'c2', name: 'سامي', totalDebt: 50, currency: 'JOD' })],
    }), 'ar', NOW);
    expect(text).toContain('100.00 ₪');
    expect(text).toContain('50.000 د.أ');
    expect(text).toContain('2 من الزبائن');
  });

  it('formats every currency with its own symbol', () => {
    const text = answerLocally('رصيد الخزنة', data({ vault: { balanceIQD: 250000, balanceEGP: 75 } }), 'ar', NOW);
    expect(text).toContain('د.ع');
    expect(text).toContain('ج.م');
    expect(text).not.toContain('شيكل');
  });

  it('lists out-of-stock before low stock', () => {
    const text = answerLocally('النواقص', data({
      products: [product({ id: 'a', name: 'سكر', quantity: 2 }), product({ id: 'b', name: 'أرز', quantity: 0 })],
    }), 'ar', NOW);
    expect(text.indexOf('أرز')).toBeLessThan(text.indexOf('سكر'));
    expect(text).toContain('1 نافد');
  });

  it('says so when there are no products instead of reporting zero shortages', () => {
    expect(answerLocally('النواقص', data(), 'ar', NOW)).toContain('لا توجد أصناف');
  });

  it('finds a product by barcode for a free-form question', () => {
    const text = answerLocally('كم الكمية من 6291041500213', data({ products: [product({})] }), 'ar', NOW);
    expect(text).toContain('قهوة عربية');
    expect(text).toContain('**12**');
  });

  it('flags products sold below cost', () => {
    const text = answerLocally('هوامش الربح', data({ products: [product({ unitCost: 8, sellingPrice: 6 })] }), 'ar', NOW);
    expect(text).toContain('يُباع بخسارة');
  });

  it('refuses commands instead of pretending to run them', () => {
    const text = answerLocally('أضف منتج شاي', data(), 'ar', NOW);
    expect(text).toContain('غير متاح');
    expect(text).not.toContain('تمت');
  });
});
