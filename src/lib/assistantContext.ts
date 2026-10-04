import type { Currency } from '../types';

/**
 * Shared by the browser (builds the request) and server.ts (builds the Gemini prompt and
 * validates the model's proposed action). Keep this file free of browser-only imports.
 */

export const ASSISTANT_CURRENCIES: readonly Currency[] = ['JOD', 'ILS', 'USD', 'IQD', 'SAR', 'LYD', 'EGP'];

export const ASSISTANT_LIMITS = {
  products: 300,
  customers: 200,
  historyTurns: 12,
  messageChars: 2000,
  text: 120,
} as const;

export interface AssistantProductRow {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitCost: number;
  sellingPrice: number;
  currency: Currency;
  status: string;
}

export interface AssistantCustomerRow {
  name: string;
  totalDebt: number;
  currency: Currency;
}

export interface AssistantSalesRow {
  currency: Currency;
  todayTotal: number;
  todayCount: number;
  monthTotal: number;
  monthCount: number;
}

export interface AssistantContext {
  defaultCurrency: Currency;
  products: AssistantProductRow[];
  productsTotal: number;
  customers: AssistantCustomerRow[];
  customersTotal: number;
  vault: Partial<Record<Currency, number>>;
  sales: AssistantSalesRow[];
}

export type AssistantAction =
  | {
      type: 'add_product';
      product: { name: string; sku?: string; quantity?: number; unitCost?: number; sellingPrice?: number };
    }
  | { type: 'delete_product'; productId: string }
  | { type: 'add_customer'; customer: { name: string; phone?: string; currency?: Currency } };

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

const isCurrency = (value: unknown): value is Currency =>
  typeof value === 'string' && (ASSISTANT_CURRENCIES as readonly string[]).includes(value);

const text = (value: unknown, max: number = ASSISTANT_LIMITS.text): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const amount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** A user-stated, non-negative number, or undefined. Never substitutes a default. */
const optionalAmount = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function sanitizeContext(raw: any): AssistantContext {
  const defaultCurrency = isCurrency(raw?.defaultCurrency) ? raw.defaultCurrency : 'JOD';
  const products = (Array.isArray(raw?.products) ? raw.products : [])
    .slice(0, ASSISTANT_LIMITS.products)
    .map((p: any): AssistantProductRow => ({
      id: text(p?.id, 64),
      name: text(p?.name),
      sku: text(p?.sku, 64),
      quantity: amount(p?.quantity),
      unitCost: amount(p?.unitCost),
      sellingPrice: amount(p?.sellingPrice),
      currency: isCurrency(p?.currency) ? p.currency : defaultCurrency,
      status: text(p?.status, 20),
    }))
    .filter((p: AssistantProductRow) => p.id && p.name);
  const customers = (Array.isArray(raw?.customers) ? raw.customers : [])
    .slice(0, ASSISTANT_LIMITS.customers)
    .map((c: any): AssistantCustomerRow => ({
      name: text(c?.name),
      totalDebt: amount(c?.totalDebt),
      currency: isCurrency(c?.currency) ? c.currency : defaultCurrency,
    }))
    .filter((c: AssistantCustomerRow) => c.name);
  const vault: Partial<Record<Currency, number>> = {};
  for (const code of ASSISTANT_CURRENCIES) {
    const v = amount(raw?.vault?.[code]);
    if (v !== 0) vault[code] = v;
  }
  const sales = (Array.isArray(raw?.sales) ? raw.sales : [])
    .filter((s: any) => isCurrency(s?.currency))
    .map((s: any): AssistantSalesRow => ({
      currency: s.currency,
      todayTotal: amount(s.todayTotal),
      todayCount: Math.max(0, Math.floor(amount(s.todayCount))),
      monthTotal: amount(s.monthTotal),
      monthCount: Math.max(0, Math.floor(amount(s.monthCount))),
    }));
  return {
    defaultCurrency,
    products,
    productsTotal: Math.max(products.length, Math.floor(amount(raw?.productsTotal))),
    customers,
    customersTotal: Math.max(customers.length, Math.floor(amount(raw?.customersTotal))),
    vault,
    sales,
  };
}

/** Last N turns, trimmed, ending with the new user message. The welcome bubble is dropped. */
export function sanitizeHistory(history: unknown, message: string): AssistantTurn[] {
  const turns: AssistantTurn[] = (Array.isArray(history) ? history : [])
    .filter((h: any) => (h?.role === 'user' || h?.role === 'assistant') && typeof h?.content === 'string' && h.content.trim())
    .map((h: any) => ({ role: h.role, content: h.content.slice(0, ASSISTANT_LIMITS.messageChars) }));
  while (turns.length && turns[0].role === 'assistant') turns.shift();
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'user' || last.content !== message) turns.push({ role: 'user', content: message });
  return turns.slice(-ASSISTANT_LIMITS.historyTurns);
}

export function buildSystemInstruction(input: {
  context: AssistantContext;
  verbosity: 'concise' | 'detailed';
  language: 'ar' | 'en';
}): string {
  const { context, verbosity, language } = input;
  const style = verbosity === 'concise'
    ? 'Answer in a few short bullet points. No introduction or closing.'
    : 'Answer clearly with short bullet points and a one-line explanation where it helps.';
  return [
    'You are the assistant inside Mostawdaee, a warehouse and point-of-sale app used by merchants.',
    `Reply in ${language === 'ar' ? 'Arabic' : 'English'} unless the user writes in another language.`,
    style,
    '',
    'Rules:',
    '- Use only the numbers in STORE_DATA below. Never estimate, round up, or invent figures, names or trends.',
    '- If the data needed is missing or truncated, say so plainly.',
    '- Every amount has its own currency code. Show it next to the amount. Never add or compare amounts in different currencies and never convert between currencies.',
    `- productsTotal and customersTotal give the real counts; the lists may be truncated to ${ASSISTANT_LIMITS.products} products and ${ASSISTANT_LIMITS.customers} customers.`,
    '- Use **bold** for key terms. Do not use headings or tables.',
    '',
    'Actions: only when the user explicitly asks to add a product, delete a product, or add a customer, include "action".',
    '- add_product: copy only values the user stated (name, sku, quantity, unitCost, sellingPrice). Leave the others out. Never make up a barcode, quantity or price.',
    '- delete_product: set productId to the id of an existing product from STORE_DATA. If several match or none match, ask instead of acting.',
    '- add_customer: name, and phone/currency only if stated.',
    '- The app shows the user a confirmation card; nothing is saved until they confirm. Say that it is waiting for confirmation, not that it is done.',
    '- Invoices, payments, stock changes and vault movements cannot be done from the assistant. Point the user to the matching screen.',
    '',
    `STORE_DATA (default currency ${context.defaultCurrency}):`,
    JSON.stringify(context),
  ].join('\n');
}

/**
 * Accepts only well-formed actions. Numbers the user did not state stay undefined, and a
 * delete must point at a product that exists in the context that was sent.
 */
export function sanitizeAssistantAction(raw: any, context: Pick<AssistantContext, 'products'>): AssistantAction | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'add_product') {
    const name = text(raw.product?.name, 200);
    if (!name) return null;
    const sku = text(raw.product?.sku, 64);
    return {
      type: 'add_product',
      product: {
        name,
        ...(sku ? { sku } : {}),
        ...(optionalAmount(raw.product?.quantity) !== undefined ? { quantity: optionalAmount(raw.product.quantity) } : {}),
        ...(optionalAmount(raw.product?.unitCost) !== undefined ? { unitCost: optionalAmount(raw.product.unitCost) } : {}),
        ...(optionalAmount(raw.product?.sellingPrice) !== undefined ? { sellingPrice: optionalAmount(raw.product.sellingPrice) } : {}),
      },
    };
  }
  if (raw.type === 'delete_product') {
    const productId = text(raw.productId, 64);
    if (!productId || !context.products.some((p) => p.id === productId)) return null;
    return { type: 'delete_product', productId };
  }
  if (raw.type === 'add_customer') {
    const name = text(raw.customer?.name);
    if (!name) return null;
    const phone = text(raw.customer?.phone, 32);
    return {
      type: 'add_customer',
      customer: {
        name,
        ...(phone ? { phone } : {}),
        ...(isCurrency(raw.customer?.currency) ? { currency: raw.customer.currency } : {}),
      },
    };
  }
  return null;
}
