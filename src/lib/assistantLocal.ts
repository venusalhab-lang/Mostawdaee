import type { Currency, Customer, Invoice, Product } from '../types';
import { ASSISTANT_CURRENCIES, ASSISTANT_LIMITS, type AssistantContext, type AssistantSalesRow } from './assistantContext';
import { formatMoney } from './exchangeRates';
import { computeStockStatus } from './stock';
import { normalizeSearchText, rankMatches } from './search';
import { readVaultBalances } from './vaultMath';
import { arCount } from './arabicPlural';

const AR_INVOICES = { one: 'فاتورة واحدة', two: 'فاتورتان', few: '{n} فواتير', many: '{n} فاتورة', other: '{n} فاتورة' };

export interface AssistantData {
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
  vault: unknown;
  defaultCurrency: Currency;
  lowStockThreshold?: number;
}

const isCurrency = (value: unknown): value is Currency =>
  typeof value === 'string' && (ASSISTANT_CURRENCIES as readonly string[]).includes(value);

const productCurrency = (p: Product, fallback: Currency): Currency => (isCurrency(p.currency) ? p.currency : fallback);

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

/** Sale totals per currency for today and the current calendar month. Currencies are never mixed. */
export function summarizeSales(invoices: Invoice[], now = Date.now()): AssistantSalesRow[] {
  const day = startOfDay(now);
  const month = startOfMonth(now);
  const rows = new Map<Currency, AssistantSalesRow>();
  for (const inv of invoices || []) {
    if ((inv?.type !== 'sale' && inv?.type !== 'return') || !isCurrency(inv.currency)) continue;
    const date = Number(inv.date) || 0;
    if (date < month || date > now) continue;
    // Totals are net of returns; counts are sales only.
    const isSale = inv.type === 'sale';
    const total = (isSale ? 1 : -1) * (Number(inv.totalAmount) || 0);
    const row = rows.get(inv.currency) || { currency: inv.currency, todayTotal: 0, todayCount: 0, monthTotal: 0, monthCount: 0 };
    row.monthTotal += total;
    if (isSale) row.monthCount += 1;
    if (date >= day) {
      row.todayTotal += total;
      if (isSale) row.todayCount += 1;
    }
    rows.set(inv.currency, row);
  }
  return ASSISTANT_CURRENCIES.filter((c) => rows.has(c)).map((c) => rows.get(c)!);
}

/** What the server prompt sees. No phone numbers, ids only for products (needed to propose a delete). */
export function buildAssistantContext(data: AssistantData, now = Date.now()): AssistantContext {
  const balances = readVaultBalances(data.vault || {});
  const vault: Partial<Record<Currency, number>> = {};
  for (const code of ASSISTANT_CURRENCIES) if (balances[code]) vault[code] = balances[code];
  const products = data.products || [];
  const customers = data.customers || [];
  return {
    defaultCurrency: data.defaultCurrency,
    products: products.slice(0, ASSISTANT_LIMITS.products).map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku || '',
      quantity: Number(p.quantity) || 0,
      unitCost: Number(p.unitCost) || 0,
      sellingPrice: Number(p.sellingPrice) || 0,
      currency: productCurrency(p, data.defaultCurrency),
      status: computeStockStatus(p.quantity, p.lowStockThreshold, data.lowStockThreshold),
    })),
    productsTotal: products.length,
    customers: [...customers]
      .sort((a, b) => (Number(b.totalDebt) || 0) - (Number(a.totalDebt) || 0))
      .slice(0, ASSISTANT_LIMITS.customers)
      .map((c) => ({
        name: c.name,
        totalDebt: Number(c.totalDebt) || 0,
        currency: isCurrency(c.currency) ? c.currency : data.defaultCurrency,
      })),
    customersTotal: customers.length,
    vault,
    sales: summarizeSales(data.invoices, now),
  };
}

type Intent = 'command' | 'debts' | 'stock' | 'vault' | 'sales' | 'margins';

const INTENT_WORDS: [Intent, string[]][] = [
  ['command', ['اضف', 'ضيف', 'احذف', 'امسح الصنف', 'سجل فاتوره', 'انشئ', 'add product', 'add customer', 'delete', 'remove', 'create']],
  ['debts', ['دين', 'ديون', 'مدين', 'مديون', 'ذمم', 'مستحق', 'تحصيل', 'debt', 'owe', 'receivable']],
  ['stock', ['نواقص', 'ناقص', 'نفد', 'نفاد', 'نافد', 'منخفض', 'قارب', 'جرد', 'low stock', 'out of stock', 'reorder', 'running out']],
  ['vault', ['خزنه', 'خزينه', 'صندوق', 'نقد', 'كاش', 'سيوله', 'vault', 'cash', 'safe']],
  ['sales', ['مبيعات', 'ايراد', 'دخل اليوم', 'sales', 'revenue', 'sold']],
  ['margins', ['ربح', 'ارباح', 'هامش', 'هوامش', 'margin', 'profit']],
].map(([intent, words]) => [intent as Intent, (words as string[]).map(normalizeSearchText)]);

const LOOKUP_STOPWORDS = new Set(
  ['كم', 'كميه', 'الكميه', 'سعر', 'السعر', 'المتوفر', 'متوفر', 'عندي', 'لدي', 'يوجد', 'في', 'من', 'عن', 'المخزون', 'صنف', 'الصنف', 'منتج', 'المنتج', 'هل', 'ما', 'هو', 'هي', 'how', 'many', 'much', 'price', 'of', 'the', 'is', 'stock', 'do', 'i', 'have']
    .map(normalizeSearchText),
);

export function detectIntent(query: string): Intent | null {
  const q = normalizeSearchText(query);
  for (const [intent, words] of INTENT_WORDS) if (words.some((w) => q.includes(w))) return intent;
  return null;
}

export function answerLocally(query: string, data: AssistantData, lang: 'ar' | 'en', now = Date.now()): string {
  const ar = lang === 'ar';
  const locale = ar ? 'ar' : 'en-US';
  const money = (value: number, code: string) => formatMoney(value, code, locale);
  const intent = detectIntent(query);

  if (intent === 'command') {
    return ar
      ? 'إضافة الأصناف والزبائن من المحادثة تحتاج المساعد الذكي، وهو غير متاح الآن.\n\n- لإضافة صنف أو حذفه: شاشة **إدارة المنتجات**.\n- لإضافة زبون: شاشة **العملاء والديون**.\n- للفواتير: **سجل الفواتير** أو **البيع المباشر**.'
      : 'Adding products or customers from chat needs the smart assistant, which is not available right now.\n\n- Products: **Products** screen.\n- Customers: **Customers & Debts** screen.\n- Invoices: **Invoices** or **Point of Sale**.';
  }

  if (intent === 'debts') {
    const debtors = (data.customers || []).filter((c) => (Number(c.totalDebt) || 0) > 0)
      .sort((a, b) => b.totalDebt - a.totalDebt);
    if (!debtors.length) return ar ? '**لا توجد ديون قائمة على الزبائن.**' : '**No outstanding customer debts.**';
    const totals = new Map<string, number>();
    for (const c of debtors) {
      const code = isCurrency(c.currency) ? c.currency : data.defaultCurrency;
      totals.set(code, (totals.get(code) || 0) + c.totalDebt);
    }
    const lines = [...totals].map(([code, sum]) => `- **${money(sum, code)}**`);
    const top = debtors.slice(0, 10).map((c) => `- ${c.name}: **${money(c.totalDebt, isCurrency(c.currency) ? c.currency : data.defaultCurrency)}**`);
    const more = debtors.length > 10 ? [ar ? `و${arCount(debtors.length - 10, { one: 'زبون آخر', two: 'زبونان آخران', few: '{n} زبائن آخرون', many: '{n} زبوناً آخر', other: '{n} زبون آخر' })}.` : `Plus ${debtors.length - 10} more.`] : [];
    return [
      ar ? `**ديون قائمة على ${debtors.length} من الزبائن**، مجموعها لكل عملة:` : `**${debtors.length} customers owe money**, totals per currency:`,
      ...lines,
      '',
      ar ? '**الأعلى ديناً:**' : '**Largest balances:**',
      ...top,
      ...more,
    ].join('\n');
  }

  if (intent === 'stock') {
    if (!data.products?.length) return ar ? '**لا توجد أصناف مسجلة بعد.**' : '**No products recorded yet.**';
    const flagged = (data.products || [])
      .map((p) => ({ p, status: computeStockStatus(p.quantity, p.lowStockThreshold, data.lowStockThreshold) }))
      .filter((x) => x.status !== 'In Stock')
      .sort((a, b) => (a.status === b.status ? a.p.quantity - b.p.quantity : a.status === 'Out of Stock' ? -1 : 1));
    if (!flagged.length) {
      return ar
        ? `**لا نواقص.** كل الأصناف (${data.products.length}) فوق حد التنبيه.`
        : `**Nothing is low.** All ${data.products.length} products are above their alert level.`;
    }
    const out = flagged.filter((x) => x.status === 'Out of Stock').length;
    const rows = flagged.slice(0, 12).map(({ p, status }) => {
      const label = status === 'Out of Stock' ? (ar ? 'نافد' : 'out') : (ar ? `متبقٍ ${p.quantity}` : `${p.quantity} left`);
      return `- ${p.name}${p.sku ? ` (${p.sku})` : ''}: **${label}**`;
    });
    return [
      ar ? `**${arCount(flagged.length, { one: 'صنف واحد يحتاج متابعة', two: 'صنفان يحتاجان متابعة', few: '{n} أصناف تحتاج متابعة', many: '{n} صنفاً تحتاج متابعة', other: '{n} صنف تحتاج متابعة' })}:** ${out} نافد، و${flagged.length - out} تحت حد التنبيه.` : `**${flagged.length} products need attention:** ${out} out, ${flagged.length - out} below alert level.`,
      ...rows,
      ...(flagged.length > 12 ? [ar ? `و${arCount(flagged.length - 12, { one: 'صنف آخر', two: 'صنفان آخران', few: '{n} أصناف أخرى', many: '{n} صنفاً آخر', other: '{n} صنف آخر' })} في شاشة المنتجات.` : `Plus ${flagged.length - 12} more on the Products screen.`] : []),
    ].join('\n');
  }

  if (intent === 'vault') {
    const balances = readVaultBalances(data.vault || {});
    const rows = ASSISTANT_CURRENCIES.filter((c) => balances[c] !== 0)
      .map((c) => `- **${money(balances[c], c)}**${balances[c] < 0 ? (ar ? ' (رصيد سالب)' : ' (negative)') : ''}`);
    if (!rows.length) return ar ? '**الخزنة فارغة.** لا أرصدة مسجلة بأي عملة.' : '**The vault is empty.** No balance in any currency.';
    return [ar ? '**رصيد الخزنة لكل عملة على حدة:**' : '**Vault balance per currency:**', ...rows].join('\n');
  }

  if (intent === 'sales') {
    const rows = summarizeSales(data.invoices, now);
    if (!rows.length) return ar ? '**لا مبيعات مسجلة هذا الشهر.**' : '**No sales recorded this month.**';
    const today = rows.filter((r) => r.todayCount > 0)
      .map((r) => `- **${money(r.todayTotal, r.currency)}** (${ar ? arCount(r.todayCount, AR_INVOICES) : `${r.todayCount} invoices`})`);
    const month = rows.map((r) => `- **${money(r.monthTotal, r.currency)}** (${ar ? arCount(r.monthCount, AR_INVOICES) : `${r.monthCount} invoices`})`);
    return [
      ar ? '**مبيعات اليوم:**' : '**Today:**',
      ...(today.length ? today : [ar ? '- لا مبيعات اليوم بعد.' : '- No sales yet today.']),
      '',
      ar ? '**مبيعات هذا الشهر:**' : '**This month:**',
      ...month,
    ].join('\n');
  }

  if (intent === 'margins') {
    const priced = (data.products || []).filter((p) => p.sellingPrice > 0 && p.unitCost > 0);
    const unpriced = (data.products || []).filter((p) => !(p.sellingPrice > 0));
    const thin = priced
      .map((p) => ({ p, margin: (p.sellingPrice - p.unitCost) / p.sellingPrice }))
      .filter((x) => x.margin < 0.15)
      .sort((a, b) => a.margin - b.margin);
    const lines: string[] = [];
    if (thin.length) {
      lines.push(ar ? `**${arCount(thin.length, { one: 'صنف واحد هامش ربحه', two: 'صنفان هامش ربحهما', few: '{n} أصناف هامش ربحها', many: '{n} صنفاً هامش ربحها', other: '{n} صنف هامش ربحها' })} أقل من 15%:**` : `**${thin.length} products have a margin under 15%:**`);
      for (const { p, margin } of thin.slice(0, 10)) {
        const code = productCurrency(p, data.defaultCurrency);
        lines.push(`- ${p.name}: ${ar ? 'تكلفة' : 'cost'} ${money(p.unitCost, code)}، ${ar ? 'بيع' : 'price'} ${money(p.sellingPrice, code)} — **${(margin * 100).toFixed(1)}%**${margin < 0 ? (ar ? ' (يُباع بخسارة)' : ' (sold at a loss)') : ''}`);
      }
    } else if (priced.length) {
      lines.push(ar ? `**كل الأصناف المسعّرة (${priced.length}) هامشها 15% أو أكثر.**` : `**All ${priced.length} priced products have a margin of 15% or more.**`);
    }
    if (unpriced.length) {
      lines.push('', ar ? `**${arCount(unpriced.length, { one: 'صنف واحد', two: 'صنفان', few: '{n} أصناف', many: '{n} صنفاً', other: '{n} صنف' })} بلا سعر بيع**، لا يمكن حساب ربحها.` : `**${unpriced.length} products have no selling price**, so their margin is unknown.`);
    }
    return lines.length ? lines.join('\n') : (ar ? 'لا توجد أصناف لحساب الهوامش.' : 'No products to compute margins.');
  }

  const terms = normalizeSearchText(query).split(' ').filter((t) => t && !LOOKUP_STOPWORDS.has(t)).join(' ');
  if (terms) {
    const { items, total } = rankMatches(data.products || [], terms, (p) => ({ primary: p.name, codes: [p.sku, p.serialNumber], extra: [p.category, p.brand] }), 5);
    if (items.length) {
      const rows = items.map((p) => {
        const code = productCurrency(p, data.defaultCurrency);
        return `- **${p.name}**${p.sku ? ` (${p.sku})` : ''}: ${ar ? 'الكمية' : 'qty'} **${p.quantity}**، ${ar ? 'سعر البيع' : 'price'} ${p.sellingPrice > 0 ? money(p.sellingPrice, code) : (ar ? 'غير محدد' : 'not set')}`;
      });
      return [...rows, ...(total > items.length ? [ar ? `و${arCount(total - items.length, { one: 'نتيجة أخرى', two: 'نتيجتان أخريان', few: '{n} نتائج أخرى', many: '{n} نتيجة أخرى', other: '{n} نتيجة أخرى' })}.` : `Plus ${total - items.length} more.`] : [])].join('\n');
    }
  }

  return ar
    ? 'لم أجد ما يطابق سؤالك في بياناتك. يمكنني الإجابة عن:\n\n- **النواقص** والأصناف النافدة\n- **ديون الزبائن**\n- **رصيد الخزنة** لكل عملة\n- **مبيعات اليوم والشهر**\n- **هوامش الربح**\n- كمية وسعر صنف معيّن بكتابة اسمه أو باركوده'
    : 'Nothing in your data matches that. I can answer about:\n\n- **Low and out-of-stock** products\n- **Customer debts**\n- **Vault balance** per currency\n- **Sales** today and this month\n- **Profit margins**\n- Quantity and price of a product by name or barcode';
}
