import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, User, Loader2, X, Trash2, Check, AlertTriangle, MessageSquare } from 'lucide-react';
import { motion } from 'motion/react';
import { Language, Product, AppSettings, Customer, Currency } from '../types';
import { useFirebase } from './FirebaseProvider';
import { computeStockStatus } from '../lib/stock';
import { apiUrl } from '../lib/apiBase';
import { authHeaders } from '../lib/apiAuth';
import { CURRENCY_SYMBOLS } from '../lib/exchangeRates';
import { digitsOnly } from '../lib/search';
import { ASSISTANT_CURRENCIES, ASSISTANT_LIMITS, type AssistantAction } from '../lib/assistantContext';
import { answerLocally, buildAssistantContext, type AssistantData } from '../lib/assistantLocal';

interface Props {
  language: Language;
  products: Product[];
  settings: AppSettings | null;
  verbosity?: 'concise' | 'detailed';
  onAddProduct?: (product: Product, options?: { reason?: string }) => Promise<void>;
  onDeleteProduct?: (id: string) => Promise<void>;
  onAddCustomer?: (customer: Customer) => Promise<void>;
  onClose?: () => void;
}

type ActionState = 'pending' | 'done' | 'cancelled';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source?: 'ai' | 'local';
  notice?: string;
  action?: AssistantAction;
  actionState?: ActionState;
  actionResult?: string;
}

type AiStatus = 'checking' | 'configured' | 'missing';

const HISTORY_LIMIT = 40;
const REQUEST_TIMEOUT_MS = 30_000;
const LEGACY_CHAT_KEY = 'mostawdae_ai_chat';
const chatKey = (owner: string) => `mostawdaee:ai_chat:${owner}`;

function loadChat(owner: string): Message[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(chatKey(owner)) || '[]');
    return Array.isArray(saved) ? saved.filter((m) => m && typeof m.content === 'string' && m.id) : [];
  } catch {
    return [];
  }
}

const NOTICES: Record<string, [string, string]> = {
  ai_not_configured: ['المساعد الذكي غير مفعّل على الخادم.', 'The smart assistant is not enabled on the server.'],
  sign_in_required: ['سجّل الدخول لاستخدام المساعد الذكي.', 'Sign in to use the smart assistant.'],
  subscription_required: ['المساعد الذكي يتطلب اشتراكاً فعّالاً.', 'The smart assistant needs an active subscription.'],
  subscription_check_unavailable: ['تعذّر التحقق من الاشتراك على الخادم.', 'The server could not check the subscription.'],
  rate_limited: ['طلبات كثيرة، انتظر دقيقة ثم أعد المحاولة.', 'Too many requests, wait a minute.'],
  unavailable: ['تعذّر الوصول إلى المساعد الذكي.', 'Could not reach the smart assistant.'],
};

function renderInline(line: string): React.ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="font-mono text-cyan-300 text-[0.85em]">{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    return <span key={i}>{part}</span>;
  });
}

function MessageBody({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((raw, idx) => {
        const line = raw.trim();
        if (!line) return <div key={idx} className="h-2" />;
        const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (bullet) {
          return (
            <div key={idx} className="flex items-start gap-2 my-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 shrink-0" />
              <div className="leading-relaxed flex-1">{renderInline(bullet[1])}</div>
            </div>
          );
        }
        return <p key={idx} className="leading-relaxed my-0.5">{renderInline(line)}</p>;
      })}
    </>
  );
}

function TypingText({ text, onDone }: { text: string; onDone: () => void }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    const words = text.split(/(\s+)/);
    const step = words.length > 200 ? 6 : words.length > 80 ? 4 : 2;
    let index = 0;
    setShown('');
    const timer = setInterval(() => {
      index += step;
      setShown(words.slice(0, index).join(''));
      if (index >= words.length) {
        clearInterval(timer);
        onDone();
      }
    }, 16);
    return () => clearInterval(timer);
  }, [text]);
  return <MessageBody text={shown} />;
}

const fieldClass = 'w-full !p-2 !text-xs !rounded-lg font-semibold';
const labelClass = 'text-[10px] font-bold text-teal-300/80 mb-1 block';

function AddProductCard({ action, isRtl, products, defaultCurrency, onConfirm }: {
  action: Extract<AssistantAction, { type: 'add_product' }>;
  isRtl: boolean;
  products: Product[];
  defaultCurrency: Currency;
  onConfirm: (draft: { name: string; sku: string; quantity: number; unitCost: number; sellingPrice: number; currency: Currency }) => Promise<void>;
}) {
  const p = action.product;
  const [name, setName] = useState(p.name);
  const [sku, setSku] = useState(p.sku || '');
  const [quantity, setQuantity] = useState(p.quantity !== undefined ? String(p.quantity) : '');
  const [unitCost, setUnitCost] = useState(p.unitCost !== undefined ? String(p.unitCost) : '');
  const [sellingPrice, setSellingPrice] = useState(p.sellingPrice !== undefined ? String(p.sellingPrice) : '');
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const t = (ar: string, en: string) => (isRtl ? ar : en);
    const cleanName = name.trim();
    const cleanSku = sku.trim();
    if (!cleanName || !cleanSku) return setError(t('الاسم والباركود مطلوبان.', 'Name and barcode are required.'));
    if (cleanName.length > 200 || cleanSku.length > 64) return setError(t('الاسم أو الباركود طويل جداً.', 'Name or barcode is too long.'));
    if ([quantity, unitCost, sellingPrice].some((v) => v.trim() === '')) {
      return setError(t('حدد الكمية والتكلفة وسعر البيع (اكتب 0 إن لم يوجد).', 'Enter quantity, cost and price (0 if none).'));
    }
    const numbers = [quantity, unitCost, sellingPrice].map(Number);
    if (!numbers.every((n) => Number.isFinite(n) && n >= 0)) return setError(t('القيم يجب أن تكون أرقاماً غير سالبة.', 'Values must be non-negative numbers.'));
    const duplicate = products.find((x) => (x.sku || '').trim().toLowerCase() === cleanSku.toLowerCase());
    if (duplicate) return setError(t(`الباركود مستخدم للصنف: ${duplicate.name}`, `Barcode already used by: ${duplicate.name}`));
    setError('');
    setSaving(true);
    try {
      await onConfirm({ name: cleanName, sku: cleanSku, quantity: numbers[0], unitCost: numbers[1], sellingPrice: numbers[2], currency });
    } catch (e) {
      setError(t('تعذّر الحفظ. حاول مرة أخرى.', 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CardShell title={isRtl ? 'إضافة صنف — راجع البيانات ثم أكّد' : 'Add product — review, then confirm'} error={error}
      confirmLabel={isRtl ? 'إضافة الصنف' : 'Add product'} saving={saving} onConfirm={submit}>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2"><span className={labelClass}>{isRtl ? 'الاسم' : 'Name'}</span>
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="col-span-2"><span className={labelClass}>{isRtl ? 'الباركود / SKU' : 'Barcode / SKU'}</span>
          <input className={fieldClass} value={sku} onChange={(e) => setSku(e.target.value)} dir="ltr" /></label>
        <label><span className={labelClass}>{isRtl ? 'الكمية' : 'Quantity'}</span>
          <input className={fieldClass} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} dir="ltr" /></label>
        <label><span className={labelClass}>{isRtl ? 'العملة' : 'Currency'}</span>
          <select className={fieldClass} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {ASSISTANT_CURRENCIES.map((c) => <option key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</option>)}
          </select></label>
        <label><span className={labelClass}>{isRtl ? 'تكلفة الوحدة' : 'Unit cost'}</span>
          <input className={fieldClass} inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} dir="ltr" /></label>
        <label><span className={labelClass}>{isRtl ? 'سعر البيع' : 'Selling price'}</span>
          <input className={fieldClass} inputMode="decimal" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} dir="ltr" /></label>
      </div>
    </CardShell>
  );
}

function DeleteProductCard({ product, isRtl, onConfirm }: { product: Product | undefined; isRtl: boolean; onConfirm: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  if (!product) {
    return <CardShell title={isRtl ? 'حذف صنف' : 'Delete product'} error={isRtl ? 'هذا الصنف لم يعد موجوداً.' : 'This product no longer exists.'} />;
  }
  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm();
    } catch {
      setError(isRtl ? 'تعذّر الحذف. حاول مرة أخرى.' : 'Could not delete. Try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <CardShell title={isRtl ? 'حذف صنف — هذا الإجراء لا يمكن التراجع عنه' : 'Delete product — this cannot be undone'} error={error}
      confirmLabel={isRtl ? 'حذف الصنف' : 'Delete product'} danger saving={saving} onConfirm={submit}>
      <div className="text-sm text-white font-bold">{product.name}</div>
      <div className="text-xs text-slate-400 font-mono" dir="ltr">{product.sku}</div>
      {product.quantity > 0 && (
        <div className="mt-2 text-xs text-amber-300 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {isRtl ? `في المخزون ${product.quantity} وحدة من هذا الصنف.` : `${product.quantity} units of this product are in stock.`}
        </div>
      )}
    </CardShell>
  );
}

function AddCustomerCard({ action, isRtl, customers, defaultCurrency, signedIn, onConfirm }: {
  action: Extract<AssistantAction, { type: 'add_customer' }>;
  isRtl: boolean;
  customers: Customer[];
  defaultCurrency: Currency;
  signedIn: boolean;
  onConfirm: (draft: { name: string; phone: string; currency: Currency }) => Promise<void>;
}) {
  const [name, setName] = useState(action.customer.name);
  const [phone, setPhone] = useState(action.customer.phone || '');
  const [currency, setCurrency] = useState<Currency>(action.customer.currency || defaultCurrency);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const t = (ar: string, en: string) => (isRtl ? ar : en);
    if (!name.trim() || !phone.trim()) return setError(t('الاسم ورقم الهاتف مطلوبان.', 'Name and phone are required.'));
    const digits = digitsOnly(phone);
    const duplicate = digits && customers.find((c) => digitsOnly(c.phone) === digits);
    if (duplicate) return setError(t(`الرقم مسجل للزبون: ${duplicate.name}`, `Phone already belongs to: ${duplicate.name}`));
    setError('');
    setSaving(true);
    try {
      await onConfirm({ name: name.trim(), phone: phone.trim(), currency });
    } catch {
      setError(t('تعذّر الحفظ. حاول مرة أخرى.', 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CardShell title={isRtl ? 'إضافة زبون — راجع البيانات ثم أكّد' : 'Add customer — review, then confirm'}
      error={error || (!signedIn ? (isRtl ? 'إضافة الزبائن تتطلب حساباً مسجلاً؛ وضع التجربة لا يحفظ الزبائن.' : 'Adding customers needs a signed-in account; trial mode does not save customers.') : '')}
      confirmLabel={isRtl ? 'إضافة الزبون' : 'Add customer'} saving={saving} onConfirm={signedIn ? submit : undefined}>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2"><span className={labelClass}>{isRtl ? 'الاسم' : 'Name'}</span>
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label><span className={labelClass}>{isRtl ? 'الهاتف' : 'Phone'}</span>
          <input className={fieldClass} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" /></label>
        <label><span className={labelClass}>{isRtl ? 'عملة الحساب' : 'Account currency'}</span>
          <select className={fieldClass} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {ASSISTANT_CURRENCIES.map((c) => <option key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</option>)}
          </select></label>
      </div>
    </CardShell>
  );
}

const CardContext = React.createContext<{ isRtl: boolean; onCancel: () => void }>({ isRtl: true, onCancel: () => {} });

function CardShell({ title, error, confirmLabel, danger, saving, onConfirm, children }: {
  title: string;
  error?: string;
  confirmLabel?: string;
  danger?: boolean;
  saving?: boolean;
  onConfirm?: () => void;
  children?: React.ReactNode;
}) {
  const { isRtl, onCancel } = React.useContext(CardContext);
  return (
    <div className="mt-3 rounded-2xl border border-cyan-900/50 bg-[#0b181c]/80 p-3 space-y-2">
      <div className="text-xs font-black text-cyan-300">{title}</div>
      {children}
      {error && <div className="text-xs text-rose-300 font-bold">{error}</div>}
      <div className="flex gap-2 pt-1">
        {onConfirm && confirmLabel && (
          <button type="button" onClick={onConfirm} disabled={saving}
            className={`flex-1 h-9 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50 ${danger ? 'bg-rose-500/90 hover:bg-rose-500 text-white' : 'bg-cyan-500/90 hover:bg-cyan-500 text-slate-950'}`}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {confirmLabel}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={saving}
          className="flex-1 h-9 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-50">
          {isRtl ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

export default function AIAssistant({
  language,
  products,
  settings,
  verbosity = 'detailed',
  onAddProduct,
  onDeleteProduct,
  onAddCustomer,
  onClose,
}: Props) {
  const isRtl = language === 'ar';
  const lang: 'ar' | 'en' = isRtl ? 'ar' : 'en';
  const { customers, invoices, vault, user } = useFirebase();
  const owner = user?.uid || 'guest';
  const defaultCurrency: Currency = settings?.currency || 'JOD';
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [chat, setChat] = useState(() => ({ owner, messages: loadChat(owner) }));
  if (chat.owner !== owner) setChat({ owner, messages: loadChat(owner) });
  const messages = chat.owner === owner ? chat.messages : [];
  const updateMessages = (fn: (prev: Message[]) => Message[]) =>
    setChat((c) => ({ owner: c.owner, messages: fn(c.messages).slice(-HISTORY_LIMIT) }));

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [animateId, setAnimateId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>('checking');
  const [lastNotice, setLastNotice] = useState('');

  useEffect(() => {
    sessionStorage.removeItem(LEGACY_CHAT_KEY);
  }, []);

  useEffect(() => {
    if (chat.owner !== owner) return;
    try {
      sessionStorage.setItem(chatKey(owner), JSON.stringify(chat.messages));
    } catch {
      // Storage full or disabled: the chat simply isn't kept across reloads.
    }
  }, [chat, owner]);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/ai-status'))
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (!cancelled) setAiStatus(s?.status === 'configured' ? 'configured' : 'missing'); })
      .catch(() => { if (!cancelled) setAiStatus('missing'); });
    return () => { cancelled = true; };
  }, []);

  const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  useEffect(scrollToBottom, [messages.length, isLoading]);

  const data: AssistantData = useMemo(() => ({
    products: products || [],
    customers: customers || [],
    invoices: invoices || [],
    vault,
    defaultCurrency,
    lowStockThreshold: settings?.lowStockThreshold,
  }), [products, customers, invoices, vault, defaultCurrency, settings?.lowStockThreshold]);

  const noticeFor = (code?: string) => (NOTICES[code || ''] || NOTICES.unavailable)[isRtl ? 0 : 1];

  const pushAssistant = (message: Omit<Message, 'id' | 'role'>) => {
    const id = crypto.randomUUID();
    updateMessages((prev) => [...prev, { id, role: 'assistant', ...message }]);
    if (settings?.enableAnimations !== false) setAnimateId(id);
  };

  const handleSend = async (preset?: string) => {
    const text = (preset ?? input).trim().slice(0, ASSISTANT_LIMITS.messageChars);
    if (!text || isLoading) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    const history = [...messages, userMessage];
    updateMessages(() => history);
    setInput('');
    setIsLoading(true);

    const answerFromDevice = (code?: string) => {
      const notice = noticeFor(code);
      setLastNotice(notice);
      pushAssistant({ content: answerLocally(text, data, lang), source: 'local', notice });
    };

    try {
      if (aiStatus === 'missing') return answerFromDevice('ai_not_configured');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(apiUrl('/api/chat'), {
          method: 'POST',
          headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: history.filter((m) => m.role === 'user' || m.source === 'ai').map(({ role, content }) => ({ role, content })),
            verbosity,
            language: lang,
            context: buildAssistantContext(data),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.text !== 'string' || !body.text.trim()) return answerFromDevice(body?.code);
      setLastNotice('');
      pushAssistant({
        content: body.text,
        source: 'ai',
        ...(body.action ? { action: body.action as AssistantAction, actionState: 'pending' as const } : {}),
      });
    } catch {
      answerFromDevice('unavailable');
    } finally {
      setIsLoading(false);
    }
  };

  const resolveAction = (id: string, actionState: ActionState, actionResult?: string) =>
    updateMessages((prev) => prev.map((m) => (m.id === id ? { ...m, actionState, actionResult } : m)));

  const renderAction = (message: Message) => {
    const action = message.action;
    if (!action) return null;
    if (message.actionState === 'done' || message.actionState === 'cancelled') {
      return (
        <div className={`mt-3 text-xs font-bold flex items-center gap-1.5 ${message.actionState === 'done' ? 'text-emerald-300' : 'text-slate-400'}`}>
          {message.actionState === 'done' ? <Check size={14} /> : <X size={14} />}
          {message.actionResult || (isRtl ? 'أُلغي الإجراء.' : 'Action cancelled.')}
        </div>
      );
    }
    const cancel = () => resolveAction(message.id, 'cancelled');
    let card: React.ReactNode = null;
    if (action.type === 'add_product') {
      card = (
        <AddProductCard action={action} isRtl={isRtl} products={products} defaultCurrency={defaultCurrency}
          onConfirm={async (draft) => {
            if (!onAddProduct) throw new Error('unavailable');
            const product: Product = {
              id: crypto.randomUUID(),
              name: draft.name,
              sku: draft.sku,
              category: '',
              brand: '',
              quantity: draft.quantity,
              unitCost: draft.unitCost,
              costPrice: draft.unitCost,
              sellingPrice: draft.sellingPrice,
              currency: draft.currency,
              status: computeStockStatus(draft.quantity, undefined, settings?.lowStockThreshold),
              dateAdded: Date.now(),
              warehouseId: '',
            };
            await onAddProduct(product, { reason: isRtl ? 'رصيد افتتاحي (من المساعد)' : 'Opening stock (assistant)' });
            resolveAction(message.id, 'done', isRtl ? `أُضيف الصنف «${draft.name}».` : `Added “${draft.name}”.`);
          }} />
      );
    } else if (action.type === 'delete_product') {
      const product = products.find((p) => p.id === action.productId);
      card = (
        <DeleteProductCard product={product} isRtl={isRtl}
          onConfirm={async () => {
            if (!onDeleteProduct || !product) throw new Error('unavailable');
            await onDeleteProduct(product.id);
            resolveAction(message.id, 'done', isRtl ? `حُذف الصنف «${product.name}».` : `Deleted “${product.name}”.`);
          }} />
      );
    } else if (action.type === 'add_customer') {
      card = (
        <AddCustomerCard action={action} isRtl={isRtl} customers={customers || []} defaultCurrency={defaultCurrency} signedIn={!!user}
          onConfirm={async (draft) => {
            if (!onAddCustomer || !user) throw new Error('unavailable');
            const id = crypto.randomUUID();
            await onAddCustomer({ id, customerId: id, name: draft.name, phone: draft.phone, currency: draft.currency, totalDebt: 0, createdAt: new Date().toISOString() });
            resolveAction(message.id, 'done', isRtl ? `أُضيف الزبون «${draft.name}».` : `Added customer “${draft.name}”.`);
          }} />
      );
    }
    return <CardContext.Provider value={{ isRtl, onCancel: cancel }}>{card}</CardContext.Provider>;
  };

  const quickReplies = isRtl
    ? [
        ['النواقص', 'ما الأصناف النافدة أو التي تحت حد التنبيه؟'],
        ['ديون الزبائن', 'كم مجموع ديون الزبائن ومن الأعلى ديناً؟'],
        ['رصيد الخزنة', 'ما رصيد الخزنة لكل عملة؟'],
        ['مبيعات اليوم', 'كم مبيعات اليوم وهذا الشهر؟'],
        ['هوامش الربح', 'ما الأصناف ذات هامش الربح المنخفض؟'],
      ]
    : [
        ['Low stock', 'Which products are out of stock or below their alert level?'],
        ['Customer debts', 'What do customers owe in total and who owes the most?'],
        ['Vault', 'What is the vault balance per currency?'],
        ['Sales today', 'What are sales today and this month?'],
        ['Margins', 'Which products have a low profit margin?'],
      ];

  const modeLabel = aiStatus === 'configured' && !lastNotice
    ? (isRtl ? 'ذكاء اصطناعي · لا يُحفظ أي تعديل قبل تأكيدك' : 'AI · nothing is saved until you confirm')
    : aiStatus === 'checking'
      ? (isRtl ? 'جارٍ التحقق…' : 'Checking…')
      : (isRtl ? 'تحليل محلي من بياناتك، دون ذكاء اصطناعي' : 'Local analysis of your data, no AI');

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-10rem)] flex flex-col rounded-[2rem] overflow-hidden border border-teal-900/40 shadow-2xl bg-[#0F2027]" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="bg-[#0b181c]/90 border-b border-teal-950/70 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
            <img src="/icon.svg" alt="" className="w-7 h-7 object-contain" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-black text-white leading-tight">{isRtl ? 'مساعد مستودعي' : 'Mostawdaee Assistant'}</h1>
            <p className="text-[11px] text-teal-300/80 font-bold mt-0.5 truncate">{modeLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button type="button" onClick={() => { updateMessages(() => []); setLastNotice(''); }}
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center border border-white/10"
              aria-label={isRtl ? 'مسح المحادثة' : 'Clear chat'} title={isRtl ? 'مسح المحادثة' : 'Clear chat'}>
              <Trash2 size={17} />
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} id="close_ai_assistant_btn"
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center border border-white/10"
              aria-label={isRtl ? 'إغلاق المساعد' : 'Close assistant'}>
              <X size={19} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-[#0F2027] to-[#152a32] p-5 space-y-4 custom-scrollbar" aria-live="polite">
        <div className="flex justify-end">
          <div className="max-w-[85%] p-4 rounded-2xl rounded-tl-none bg-white/5 border border-white/5 text-sm text-slate-100">
            <MessageBody text={isRtl
              ? 'أهلاً. اسألني عن **النواقص** و**ديون الزبائن** و**رصيد الخزنة** و**المبيعات** و**هوامش الربح**، أو اكتب اسم صنف أو باركوده.\n\nأجيب من بيانات متجرك فقط، ولا أعدّل شيئاً قبل أن تؤكد.'
              : 'Hi. Ask me about **low stock**, **customer debts**, the **vault**, **sales** or **margins**, or type a product name or barcode.\n\nI answer from your store data only and change nothing until you confirm.'} />
          </div>
        </div>

        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
              className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
              <div className={`flex gap-2.5 max-w-[88%] ${isUser ? 'flex-row' : 'flex-row-reverse'}`}>
                <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center ${isUser ? 'bg-[#2c5364]/30 border border-[#2c5364]/40 text-teal-300' : 'bg-white/5 border border-white/5'}`}>
                  {isUser ? <User size={14} /> : <img src="/icon.svg" alt="" className="w-5 h-5 object-contain" />}
                </div>
                <div className="min-w-0">
                  <div className={`p-4 text-sm shadow-md ${isUser
                    ? 'bg-[#2C5364] text-white rounded-2xl rounded-tr-none border border-[#305e71]'
                    : 'bg-white/5 text-slate-100 rounded-2xl rounded-tl-none border border-white/5'}`}>
                    {msg.id === animateId
                      ? <TypingText text={msg.content} onDone={() => { setAnimateId(null); scrollToBottom(); }} />
                      : <MessageBody text={msg.content} />}
                    {msg.id !== animateId && renderAction(msg)}
                  </div>
                  {msg.notice && (
                    <p className="text-[10px] text-slate-400 font-semibold mt-1 px-1">
                      {isRtl ? 'إجابة محسوبة من بياناتك على هذا الجهاز. ' : 'Computed from your data on this device. '}{msg.notice}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}

        {isLoading && (
          <div className="flex justify-end">
            <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/5 rounded-2xl rounded-tl-none text-xs text-teal-300 font-bold">
              <Loader2 size={14} className="animate-spin" />
              {isRtl ? 'جارٍ التحليل…' : 'Analyzing…'}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="bg-[#15262C] p-4 border-t border-teal-950/70 flex flex-col gap-3">
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {quickReplies.map(([label, prompt]) => (
            <button key={label} type="button" onClick={() => handleSend(prompt)} disabled={isLoading}
              className="px-3 py-1.5 bg-[#0b181c]/60 hover:bg-[#203a43]/50 border border-teal-900/30 rounded-xl text-xs font-bold text-slate-300 hover:text-cyan-300 whitespace-nowrap shrink-0 flex items-center gap-1.5 disabled:opacity-40">
              <MessageSquare size={12} className="text-cyan-500" />
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative flex items-center">
          <input
            type="text"
            value={input}
            maxLength={ASSISTANT_LIMITS.messageChars}
            onChange={(e) => setInput(e.target.value)}
            enterKeyHint="send"
            aria-label={isRtl ? 'سؤالك للمساعد' : 'Your question'}
            placeholder={isRtl ? 'اسأل عن صنف، النواقص، الديون، الخزنة…' : 'Ask about a product, stock, debts, the vault…'}
            className={`w-full h-12 !rounded-2xl ${isRtl ? '!pl-12 !pr-4' : '!pr-12 !pl-4'} text-sm font-semibold placeholder-slate-500 focus:outline-none`}
          />
          <button type="submit" disabled={!input.trim() || isLoading}
            aria-label={isRtl ? 'إرسال' : 'Send'}
            className={`absolute ${isRtl ? 'left-2.5' : 'right-2.5'} w-8 h-8 rounded-xl bg-[#00D2FF]/10 text-[#00D2FF] hover:bg-[#00D2FF]/20 flex items-center justify-center disabled:opacity-30`}>
            {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} className={isRtl ? 'scale-x-[-1]' : ''} />}
          </button>
        </form>
      </div>
    </div>
  );
}
