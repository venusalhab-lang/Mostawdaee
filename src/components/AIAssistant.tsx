import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, User, MessageSquare, Loader2, HelpCircle, X } from 'lucide-react';
import { Language, Product, AppSettings, Customer, CustomerTransaction, Invoice } from '../types';
import { useFirebase } from './FirebaseProvider';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { computeStockStatus } from '../lib/stock';
import { readVaultBalances } from '../lib/vaultMath';
import { POS_CURRENCY_CODES } from '../lib/exchangeRates';

interface Props {
  language: Language;
  products: Product[];
  settings: AppSettings | null;
  verbosity?: 'concise' | 'detailed';
  onAddProduct?: (product: Product) => Promise<void>;
  onDeleteProduct?: (id: string) => Promise<void>;
  onAddInvoice?: (invoice: Invoice) => Promise<void>;
  onAddCustomer?: (customer: Customer) => Promise<void>;
  onClose?: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Custom inline Markdown/Markdown list parser for AI responses to convert raw markdown to elegant tags
function parseCustomMessage(rawText: string) {
  const lines = rawText.split('\n');
  return lines.map((line, idx) => {
    if (!line.trim()) {
      return <div key={idx} className="h-2.5" />;
    }

    const isBullet = line.trim().startsWith('-') || line.trim().startsWith('*');
    let lineContent = line.trim();
    if (isBullet) {
      lineContent = lineContent.replace(/^[\s-*]+/, '');
    }

    const parts = lineContent.split(/(\*\*[^*]+\*\*)/g);
    const parsedLine = parts.map((part, pIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const cleanText = part.slice(2, -2);
        return (
          <strong 
            key={pIdx} 
            className="font-black text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-900/40 font-mono text-xs md:text-sm inline-block"
          >
            {cleanText}
          </strong>
        );
      }
      return <span key={pIdx}>{part}</span>;
    });

    if (isBullet) {
      return (
        <div 
          key={idx} 
          className="flex items-start gap-2.5 my-2 pl-1 pr-1 transition-all duration-200 animate-fade-in"
        >
          <div className="w-2 h-2 rounded-full bg-cyan-500 mt-2 flex-shrink-0 shadow-sm shadow-cyan-500/50" />
          <div className="text-slate-100 leading-relaxed text-sm md:text-base flex-1">
            {parsedLine}
          </div>
        </div>
      );
    }

    return (
      <p key={idx} className="text-slate-200 leading-relaxed text-sm md:text-base my-1">
        {parsedLine}
      </p>
    );
  });
}

// Word-by-word typewriter reveal animation to simulate live thinking (speed-optimized)
function TypingText({ text, onComplete }: { text: string; onComplete?: () => void }) {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    if (!text) return;
    const words = text.split(/(\s+)/);
    let index = 0;
    setDisplayedText('');

    const totalWords = words.length;
    let delay = 15;
    let wordsPerTick = 2; // Default 2 words at a time for high responsiveness

    if (totalWords > 100) {
      delay = 10;
      wordsPerTick = 3;
    }
    if (totalWords > 200) {
      delay = 5;
      wordsPerTick = 5;
    }

    const interval = setInterval(() => {
      if (index < words.length) {
        setDisplayedText(prev => {
          let next = prev;
          for (let i = 0; i < wordsPerTick; i++) {
            if (index + i < words.length) {
              next += words[index + i];
            }
          }
          return next;
        });
        index += wordsPerTick;
      } else {
        clearInterval(interval);
        onComplete?.();
      }
    }, delay);

    return () => clearInterval(interval);
  }, [text]);

  return (
    <div className="transition-opacity duration-300">
      {parseCustomMessage(displayedText)}
    </div>
  );
}

// Highly analytical client-side smart fallback engine to guarantee zero downtime
function generateOfflineAssistantResponse(
  query: string, 
  data: { products: Product[], customers: Customer[], vault: any, recentTransactions?: CustomerTransaction[] }, 
  lang: 'ar' | 'en',
  userCurrency: string
): string {
  const isAr = lang === 'ar';
  const text = query.toLowerCase();

  const fmtMoney = (val: number, cur?: string) => {
    const c = cur || userCurrency || 'JOD';
    const num = (val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (c === 'JOD') return isAr ? `${num} دينار أردني` : `${num} JOD`;
    if (c === 'USD') return isAr ? `${num} دولار أمريكي` : `$${num}`;
    return isAr ? `${num} شيكل` : `₪${num}`;
  };

  // 1. DEBTS / CUSTOMERS ANALYSIS
  const isDebtQuery = text.includes('دين') || text.includes('ديون') || text.includes('عملا') || text.includes('مديوني') || text.includes('مدان') ||
                      text.includes('debt') || text.includes('customer') || text.includes('owe') || text.includes('collect');

  if (isDebtQuery) {
    const debtors = (data.customers || []).filter(c => (c.totalDebt || 0) > 0);
    debtors.sort((a, b) => b.totalDebt - a.totalDebt);
    
    const currencyTotals: Record<string, number> = {};
    debtors.forEach(d => {
      const cur = d.currency || userCurrency || 'JOD';
      currencyTotals[cur] = (currencyTotals[cur] || 0) + d.totalDebt;
    });

    const sumSummary = Object.entries(currencyTotals)
      .map(([cur, sum]) => `**${fmtMoney(sum, cur)}**`)
      .join(isAr ? ' و ' : ' and ');

    if (debtors.length === 0) {
      return isAr 
        ? `*(تحليل ذكي فوري ومباشر)*\n\n**لا وجود لأي مديونيات معلقة حالياً على العملاء!**\n\nتم مراجعة سجلات حسابات العملاء وتبين أن جميع الذمم المالية مصفرة والتحصيل مكتمل 100%. هذا مؤشر صحي ممتاز للسيولة النقدية في مستودعك.`
        : `*(Real-time Intelligent Audit)*\n\n**No active customer debts outstanding!**\n\nAll client accounts have been reviewed, and all balances are fully settled (0.00). This indicates exceptional liquidity and credit collection efficiency in your warehouse.`;
    }

    let report = isAr
      ? `*(تحليل ذكي فوري بالاعتماد على بياناتك المباشرة)*\n\n**تقرير الذمم والديون المستحقة للعملاء:**\n\nبلغ إجمالي المستحقات والديون المتراكمة على العملاء ما قيمته: ${sumSummary || '**0.00**'} موزعة على **${debtors.length} عملاء مدينين**:\n\n`
      : `*(Real-time Intelligent Audit)*\n\n**Client Outstanding Debt Audit Report:**\n\nTotal customer accounts receivable stands at: ${sumSummary || '**0.00**'} across **${debtors.length} active debtors**:\n\n`;

    debtors.slice(0, 10).forEach((d) => {
      report += isAr
        ? `- **${d.name}**: مدين بمبلغ **${fmtMoney(d.totalDebt, d.currency)}**\n  *هاتف:* ${d.phone || 'غير مسجل'}\n\n`
        : `- **${d.name}**: owes **${fmtMoney(d.totalDebt, d.currency)}**\n  *Phone:* ${d.phone || 'N/A'}\n\n`;
    });

    if (debtors.length > 10) {
      report += isAr 
        ? `* وهناك **${debtors.length - 10} عملاء آخرين** مسجلين بمديونيات أقل.\n\n`
        : `* Plus **${debtors.length - 10} other clients** with minor outstanding balances.\n\n`;
    }

    report += isAr
      ? `**توصية المستشار المالي:** يُوصى بالتحرك الفوري لتحصيل المبالغ الكبرى المذكورة أعلاه لزيادة السيولة بصندوق المخزون وتعليق التجديد التلقائي للعميل **${debtors[0]?.name || ''}** لحين السداد المالي.`
      : `**Advisory Action Plan:** Initiate immediate communication with **${debtors[0]?.name || 'top debtors'}** to finalize collection. Secure cash reserves before issuing further credit.`;

    return report;
  }

  // 2. STOCK / LOW STOCK / INVENTORY
  const isStockQuery = text.includes('جرد') || text.includes('مخزون') || text.includes('نواقص') || text.includes('نفاد') || text.includes('ناقص') || text.includes('بضاع') ||
                       text.includes('stock') || text.includes('low') || text.includes('out') || text.includes('inventory') || text.includes('product') || text.includes('item');

  if (isStockQuery) {
    const lowStock = (data.products || []).filter(p => {
      const threshold = p.lowStockThreshold || 5;
      return p.quantity <= threshold || p.status === 'Low Stock' || p.status === 'Out of Stock';
    });

    if (lowStock.length === 0) {
      return isAr
        ? `*(تحليل ذكي فوري ومباشر)*\n\n**حالة المخزون ممتازة!**\n\nتم فحص جميع المستلزمات والبنود في المستودع. لا توجد أي نواقص أو أصناف كميتها مهددة بالنفاد حالياً. يتوفر لديك إمداد كاف من السلع لتلبية طلبات التوزيع للعملاء مئة بالمئة.`
        : `*(Real-time Intelligent Audit)*\n\n**Stock health is exceptional!**\n\nAll catalog lines and products are fully supplied. No items are currently at risk of exhaustion or below critical threshold. Your warehouse holds healthy margin levels across your inventory.`;
    }

    let report = isAr
      ? `*(تحليل ذكي فوري بالاعتماد على بياناتك المباشرة)*\n\n**تقرير الأصناف منخفضة المخزون والنواقص بالمستودع:**\n\nتم رصد **${lowStock.length} أصناف** تقترب كميتها من النفاد أو نفدت كلياً وتحتاج للتجديد الفوري:\n\n`
      : `*(Real-time Intelligent Audit)*\n\n**Low Stock and Inventory Depletion Report:**\n\nDetected **${lowStock.length} items** close to exhaustion or completely out of stock:\n\n`;

    lowStock.slice(0, 10).forEach((p) => {
      const isOut = p.quantity === 0 || p.status === 'Out of Stock';
      const qtyLabel = isOut 
        ? (isAr ? `**منتهية تماماً (0 وحدة)**` : `**OUT OF STOCK (0 units)**`)
        : (isAr ? `**شبه نافدة (فقط ${p.quantity} قطع)**` : `**LOW STOCK (${p.quantity} units left)**`);

      report += isAr
        ? `- **${p.name}** [رمز:${p.sku || 'N/A'}]: ${qtyLabel}\n  *تكلفة الشراء:* ${fmtMoney(p.unitCost)}\n\n`
        : `- **${p.name}** [SKU:${p.sku || 'N/A'}]: ${qtyLabel}\n  *Cost price:* ${fmtMoney(p.unitCost)}\n\n`;
    });

    if (lowStock.length > 10) {
      report += isAr
        ? `* وهناك **${lowStock.length - 10} منتجات أخرى** في حالة نقص.\n\n`
        : `* Plus **${lowStock.length - 10} other product lines** currently flagged as critical.\n\n`;
    }

    report += isAr
      ? `**توصية جرد المستودع:** يرجى مراجعة المورد لإعادة تزويد المستودع بصنف **${lowStock[0]?.name || ''}** تفادياً لوقف الاستدعاء والطلب من الموزعين وسد النقص فوراً.`
      : `**Actionable Logistics Advice:** Contact suppliers immediately to replenish **${lowStock[0]?.name || 'critical items'}** to maintain shipment continuity and bypass client service interruptions.`;

    return report;
  }

  // 3. VAULT / CASH ANALYSIS
  const isVaultQuery = text.includes('خزنة') || text.includes('خزينة') || text.includes('نقد') || text.includes('كاش') || text.includes('صندوق') || text.includes('فلوس') ||
                       text.includes('vault') || text.includes('cash') || text.includes('safe') || text.includes('money') || text.includes('balance');

  if (isVaultQuery) {
    // Real per-currency balances (all 6 vault currencies). No cross-currency "estimate": rates are not guaranteed.
    const balances = readVaultBalances(data.vault || {});
    const names: Record<string, [string, string]> = {
      JOD: ['الدينار الأردني', 'Jordanian Dinar'],
      ILS: ['الشيكل', 'Israeli Shekel'],
      USD: ['الدولار الأمريكي', 'US Dollar'],
      IQD: ['الدينار العراقي', 'Iraqi Dinar'],
      SAR: ['الريال السعودي', 'Saudi Riyal'],
      LYD: ['الدينار الليبي', 'Libyan Dinar'],
    };
    const lines = POS_CURRENCY_CODES
      .map(code => `- **${names[code][isAr ? 0 : 1]} (${code}):** ${fmtMoney(balances[code], code)}${balances[code] < 0 ? (isAr ? ' ⚠️ رصيد سالب' : ' ⚠️ negative balance') : ''}`)
      .join('\n\n');
    const allZero = POS_CURRENCY_CODES.every(code => balances[code] === 0);

    return isAr
      ? `*(تحليل ذكي فوري لصالح الصندوق والخزينة)*\n\n**أرصدة الخزنة الحالية لكل عملة على حدة:**\n\n${lines}\n\n${allZero ? 'لا توجد أرصدة مسجلة بعد. أضف إيداعاً أو سجّل مبيعات لتظهر الأرصدة.' : 'كل عملة محسوبة بشكل مستقل ولا يتم خلطها أو تحويلها.'}`
      : `*(Real-time Intelligent Audit)*\n\n**Current vault balance per currency (kept separate):**\n\n${lines}\n\n${allZero ? 'No balances recorded yet. Make a deposit or record sales to see balances.' : 'Each currency is tracked independently and never mixed or converted.'}`;
  }

  // 4. PROFITS / BOOST MARGINS
  const isProfitQuery = text.includes('ربح') || text.includes('أرباح') || text.includes('زيادة') || text.includes('هوامش') || text.includes('توصية') ||
                        text.includes('margin') || text.includes('profit') || text.includes('boost') || text.includes('advice') || text.includes('optimize');

  if (isProfitQuery) {
    return isAr
      ? `*(توصيات استشارية ذكية لترقية الأداء)*\n\n**توصيات تعظيم هوامش أرباح المستودع لعام 2026:**\n\n- **تحسين شروط الموردين:** استغل النقدية المتوفرة بالخزنة للحصول على خصومات شراء كمية (Bulk discounts) للأصناف سريعة النفاد.\n\n- **تعديل استراتيجية التسعير:** قم بمراجعة المنتجات ذات الهوامش الأقل من 15% وزد سعر مبيعات التجزئة تدريجياً تماشياً مع كلفة الأرض الواصلة (Landed Cost).\n\n- **معالجة مديونية العملاء:** لا تقدم تسهيلات ائتمانية جديدة للعملاء الذين يتجاوز دينهم 1,000 دينار دون جدول سداد نقدي لتسريع معدل تدوير كلف الشراء.\n\n- **دمج أصناف مكملة:** وفر صفقات وعروض ترويجية لحزم السلع لزيادة متوسط الفاتورة الصادرة للعملاء الاستراتيجيين وبقاء المستودع ريادياً.`
      : `*(Real-time Advisory Recommendation)*\n\n**Core strategies to maximize warehouse profitability:**\n\n- **Negotiate supplier terms:** Leverage available vault cash to pay in advance, securing better volume discount terms on popular lines.\n\n- **Landed Cost Optimization:** Review margin ratios. Increase retail values on items having profit metrics lower than 15% to cushion freight and duties cost additions.\n\n- **Recalibrate Debt Collection:** Avoid extending terms for clients with outstanding tabs until at least 50% of outstanding receivables are cleared.\n\n- **Cross-selling Bundles:** Pair slow-moving assets with quick-consuming supply stock to push overall customer ticket sizes up.`;
  }

  // 5. GREETING FALLBACK
  const userGreeting = data.customers && data.customers.length > 0 
    ? (isAr ? 'مديرنا العزيز' : 'Boss') 
    : '';

  return isAr
    ? `*(مساعد مستودعي الذكي الاستشاري)*\n\nأهلاً بك يا ${userGreeting || 'كبير'} مرحباً بك في المستودع.\n\nلقد قمت بتحليل قاعدة بيانات النظام المحلي الخاص بك بنجاح، وأنا جاهز لإجابتك عن أي استفسار:\n\n- **جرد المخزون:** اسألني عن "الأصناف الناقصة" أو كميات المنتجات.\n- **الحسابات والديون:** اطلب مني تحليل "ديون العملاء" وكشف المدانين.\n- **السيولة الفورية:** ناقش معي "أرصدة الخزنة والصندوق" وعملات الشركاء.\n\nأي كشف حسابي أو مالي ترغب فيه الآن؟`
    : `*(Mostawdaee Smart Assistant - Audit Engine)*\n\nHello ${userGreeting || 'sir'}! Welcome back to your dashboard.\n\nI have successfully scanned your active database and am synchronized to deliver fast analytical answers directly:\n\n- **Inventory & Stock Analysis:** Ask me about "depleted items" or "low products".\n- **Finances & Receivables:** Ask for a comprehensive "debt checklist" on active customers.\n- **Cash and Liquidity:** Discuss "vault allocations" across JOD, ILS, and USD.\n\nHow can I help you manage your business right now?`;
}

export default function AIAssistant({ 
  language, 
  products, 
  settings, 
  verbosity = 'detailed',
  onAddProduct,
  onDeleteProduct,
  onAddInvoice,
  onAddCustomer,
  onClose
}: Props) {
  const isRtl = language === 'ar';
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Connect extra database states from Firebase safely for richer context
  const { customers, customerTransactions, vault } = useFirebase();

  const welcomeMessage = isRtl
    ? 'مرحباً يا كبير! أنا مساعدك الذكي في *مستودعي*. كيف يمكنني مساعدتك في جرد الحسابات أو تحليل مبيعاتك اليوم؟'
    : 'Hello big boss! I am your intelligent assistant in *Mostawdaee*. How can I help you audit accounts or analyze your sales today?';

  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = sessionStorage.getItem('mostawdae_ai_chat');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load chat history from sessionStorage', e);
    }
    return [{ role: 'assistant', content: welcomeMessage }];
  });

  // Save conversation automatically to sessionStorage whenever it changes
  useEffect(() => {
    try {
      sessionStorage.setItem('mostawdae_ai_chat', JSON.stringify(messages));
    } catch (e) {
      console.warn('Failed to save chat history to sessionStorage', e);
    }
  }, [messages]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (customText?: string) => {
    const textToSend = customText || input;
    if (!textToSend.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: textToSend };
    const fullHistory = [...messages, userMessage];
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Build an ultimate financial summary of products, customers and debts as contextual helper
      const productContext = products ? products.map(p => ({
        name: p.name,
        quantity: p.quantity,
        cost: p.unitCost,
        status: p.status
      })) : [];

      const customerContext = customers ? customers.map(c => ({
        name: c.name,
        totalDebt: c.totalDebt,
        phone: c.phone,
        currency: c.currency
      })) : [];

      const transactionContext = customerTransactions ? customerTransactions.slice(0, 10).map(t => ({
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        date: t.date,
        notes: t.notes
      })) : [];

      // Self-healing fetch client with automatic retry on server startup or HTML response
      const fetchWithRetry = async (url: string, options: RequestInit, retries = 3, delay = 1500): Promise<Response> => {
        try {
          const res = await fetch(url, options);
          const contentType = res.headers.get('content-type') || '';
          const isHtml = contentType.includes('text/html');
          const isStartupStatus = [502, 503, 504].includes(res.status);
          
          if (isStartupStatus && retries > 0) {
            console.warn(`Server returned status ${res.status}. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, retries - 1, delay * 1.5);
          }
          
          if (res.ok && isHtml && retries > 0) {
            const clonedRes = res.clone();
            const textCheck = await clonedRes.text();
            if (textCheck.trim().startsWith('<!DOCTYPE html>') || textCheck.includes('<html')) {
              console.warn(`Server returned an HTML page instead of JSON. Retrying in ${delay}ms... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, delay));
              return fetchWithRetry(url, options, retries - 1, delay * 1.5);
            }
          }
          
          return res;
        } catch (err) {
          if (retries > 0) {
            console.warn(`Network error fetching from server: ${err}. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, options, retries - 1, delay * 1.5);
          }
          throw err;
        }
      };

      const response = await fetchWithRetry(`/api/chat?t=${Date.now()}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        body: JSON.stringify({
          message: textToSend,
          history: fullHistory,
          verbosity,
          currency: settings?.currency || 'JOD',
          context: {
            products: productContext,
            customers: customerContext,
            recentLedgerTransactions: transactionContext,
            vault: vault || {}
          }
        })
      });

      if (!response.ok) {
        let errMsg = `Server responded with ${response.status}`;
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errData = await response.json();
            errMsg = errData.message || errData.error || errMsg;
          } else {
            const errText = await response.text();
            if (errText && errText.length < 150) {
              errMsg = errText;
            }
          }
        } catch (_) {
          // Fallback to generic error message
        }
        throw new Error(errMsg);
      }

      let data;
      const rawText = await response.text();
      try {
        data = JSON.parse(rawText);
      } catch (jsonErr) {
        console.warn('Failed to parse AI response as JSON. Content received:', rawText);
        if (rawText.trim().startsWith('<!DOCTYPE html>') || rawText.includes('<html')) {
          throw new Error('The server is currently starting up or returned a temporary HTML page. Please try again.');
        }
        throw new Error('Received unparseable response from the server.');
      }

      if (data && data.text) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
        
        // Execute real database actions parsed from the AI assistant response
        if (data.action && data.action.type) {
          const action = data.action;
          const isAr = language === 'ar';
          
          try {
            if (action.type === 'add_product' && action.product) {
              const prod = action.product;
              const threshold = prod.lowStockThreshold || 10;
              const status = computeStockStatus(prod.quantity, prod.lowStockThreshold);
              const productId = Math.random().toString(36).substr(2, 9);
              
              const productToSave: Product = {
                id: productId,
                name: prod.name,
                sku: prod.sku || `SKU-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
                category: prod.category || 'General',
                brand: prod.brand || 'Generic',
                quantity: prod.quantity || 0,
                unitCost: prod.unitCost || 0,
                sellingPrice: prod.sellingPrice || 0,
                status: status as any,
                lowStockThreshold: threshold,
                dateAdded: Date.now()
              };
              
              if (onAddProduct) {
                await onAddProduct(productToSave);
                toast.success(isAr ? `تمت إضافة الصنف: ${prod.name} بنجاح ✅` : `Added product: ${prod.name} successfully ✅`);
              }
            } else if (action.type === 'delete_product' && action.productId) {
              if (onDeleteProduct) {
                await onDeleteProduct(action.productId);
                toast.success(isAr ? `تم حذف الصنف بنجاح ✅` : `Deleted product successfully ✅`);
              }
            } else if (action.type === 'add_customer' && action.customer) {
              const cust = action.customer;
              const newCust: Customer = {
                id: Math.random().toString(36).substr(2, 9),
                customerId: `C-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
                name: cust.name,
                phone: cust.phone || '',
                createdAt: new Date().toISOString(),
                totalDebt: 0,
                currency: (cust.currency || settings?.currency || 'JOD') as any
              };
              if (onAddCustomer) {
                await onAddCustomer(newCust);
                toast.success(isAr ? `تمت إضافة العميل: ${cust.name} بنجاح ✅` : `Added customer: ${cust.name} successfully ✅`);
              }
            } else if (action.type === 'add_invoice' && action.invoice) {
              const inv = action.invoice;
              const invoiceItems = inv.items.map((item: any) => ({
                productId: item.productId,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total
              }));
              const newInvoice: Invoice = {
                id: Math.random().toString(36).substr(2, 9),
                invoiceNumber: inv.invoiceNumber,
                date: Date.now(),
                items: invoiceItems,
                subtotal: inv.subtotal || inv.totalAmount,
                taxAmount: inv.taxAmount || 0,
                totalAmount: inv.totalAmount,
                type: inv.type,
                currency: (settings?.currency || 'JOD') as any
              };
              if (onAddInvoice) {
                await onAddInvoice(newInvoice);
                toast.success(isAr ? `تم تسجيل فاتورة جديدة بنجاح ✅` : `Registered invoice successfully ✅`);
              }
            }
          } catch (execErr) {
            console.error("Action execution failed:", execErr);
            toast.error(isAr ? `فشل تنفيذ الإجراء: ${execErr}` : `Failed to execute action: ${execErr}`);
          }
        }
      } else if (data && data.error) {
        throw new Error(data.message || data.error);
      } else {
        throw new Error('Empty response from AI');
      }
    } catch (error) {
      console.warn('AI Assistant backend call failed, falling back to real-time client-side analytical model:', error);
      try {
        const fallbackText = generateOfflineAssistantResponse(
          textToSend,
          { products, customers, vault, recentTransactions: customerTransactions },
          isRtl ? 'ar' : 'en',
          settings?.currency || 'JOD'
        );
        setMessages(prev => [...prev, { role: 'assistant', content: fallbackText }]);
      } catch (fallbackErr) {
        console.error('Fallback generation also failed:', fallbackErr);
        const errMsg = error instanceof Error ? error.message : String(error);
        const errText = isRtl 
          ? `عذراً يا كبير! واجهنا مشكلة في التواصل مع خوادم الذكاء الاصطناعي.\n\n**السبب:** ${errMsg}`
          : `Oops! We encountered an error communicating with the AI servers.\n\n**Reason:** ${errMsg}`;
        setMessages(prev => [...prev, { role: 'assistant', content: errText }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Quick replies contextually relevant to the items matching the mock
  const quickReplies = [
    { 
      label: isRtl ? 'تحليل الديون والعملاء' : 'Analysis of Debts', 
      prompt: isRtl ? 'أعطني ملخصاً عن الديون المتراكمة على العملاء مع بيان بأسماء المدانين؟' : 'Give me a summary of total customer debts outstanding with debtor client details.' 
    },
    { 
      label: isRtl ? 'جرد أصناف المخزون' : 'Active Stock Audit', 
      prompt: isRtl ? 'ما هي الأصناف الحالية الموجودة في المستودع والتي تقترب كميتها من النفاد؟' : 'Which active items in the inventory are close to running out or low?' 
    },
    { 
      label: isRtl ? 'حركات الصندوق والخزينة' : 'Safe cashflows status', 
      prompt: isRtl ? 'ما هو تقرير النقد الحالي المسجل بالصندوق والخزينة؟' : 'What is the current cash and vault status recorded in the safe?' 
    },
    { 
      label: isRtl ? 'زيادة هوامش الربح' : 'Boost Trade Profits', 
      prompt: isRtl ? 'أعطني نصائح سريعة لزيادة الهوامش وتحسين مبيعات المستودع.' : 'Give me prompt tips to boost gross margins and optimize warehouse sales.' 
    }
  ];

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-10rem)] flex flex-col rounded-[2.5rem] overflow-hidden border border-teal-900/40 shadow-2xl bg-[#0F2027]" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* 1. Header with glowing orb status */}
      <div className="bg-[#0b181c]/90 border-b border-teal-950/70 p-5 flex items-center justify-between animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="relative">
            {/* Glowing active AI logo */}
            <div className="w-10 h-10 rounded-xl bg-transparent flex items-center justify-center relative overflow-hidden shadow-[0_0_15px_rgba(79,70,229,0.3)] animate-pulse">
              <img 
                src="/icon.svg" 
                alt="Mostawdaee AI" 
                className="w-8 h-8 object-contain" 
                referrerPolicy="no-referrer"
              />
            </div>
            {/* Outer spinning ring decoration */}
            <div className="absolute -inset-1 border border-cyan-500/20 rounded-2xl animate-spin-slow pointer-events-none" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              {/* Pulsing indicator light */}
              <div className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00D2FF] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00D2FF]" style={{ boxShadow: '0 0 10px #00D2FF' }}></span>
              </div>
              <h1 className="text-base font-black text-white leading-tight">
                {isRtl ? 'مساعد مستودعي الذكي' : 'Mostawdaee Smart Assistant'}
              </h1>
            </div>
            <p className="text-[10px] text-teal-400 font-bold uppercase tracking-widest font-mono mt-0.5">
              💡 {isRtl ? 'التدبيج والتحصيل اللحظي' : 'Realtime intelligent collector'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <span className="px-3 py-1 bg-[#1a343e] text-teal-300 rounded-full text-[10px] font-black uppercase tracking-wider border border-teal-900/30">
              GPT-4o & Gemini Grounded
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              type="button"
              className="w-10 h-10 rounded-xl bg-red-400/10 hover:bg-red-400/20 text-red-400 hover:text-red-300 flex items-center justify-center transition-all active:scale-95 border border-red-500/20 cursor-pointer"
              aria-label="Close Assistant"
              id="close_ai_assistant_btn"
            >
              <X size={20} className="stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Messages lists with custom styles matching the requested screen */}
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-[#0F2027] to-[#152a32] p-6 space-y-5 custom-scrollbar">
        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          const isLastAssistantMsg = msg.role === 'assistant' && idx === messages.length - 1;

          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex ${isUser ? 'justify-start' : 'justify-end'}`} // User aligns to Left (isUser in Dart is Alignment.centerLeft), Bot to Right (Alignment.centerRight)
            >
              <div className={`flex gap-3 max-w-[80%] ${isUser ? 'flex-row' : 'flex-row-reverse'}`}>
                {/* User/Bot Avatars */}
                <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center font-bold text-xs ${
                  isUser 
                    ? 'bg-[#2c5364]/20 border border-[#2c5364]/30 text-teal-300' 
                    : 'bg-white/5 border border-white/5'
                }`}>
                  {isUser ? <User size={14} /> : <img src="/icon.svg" alt="Mostawdaee AI" className="w-5.5 h-5.5 object-contain" referrerPolicy="no-referrer" />}
                </div>

                {/* Bubble Container */}
                <div className={`p-4 rounded-2.5xl leading-relaxed text-sm shadow-md transition-all ${
                  isUser 
                    ? 'bg-[#2C5364] text-white rounded-tr-none rounded-tl-2.5xl rounded-br-2.5xl rounded-bl-2.5xl border border-[#305e71]' 
                    : 'bg-white/5 text-slate-100 rounded-tl-none rounded-tr-2.5xl rounded-br-2.5xl rounded-bl-2.5xl border border-white/5'
                }`}>
                  {isLastAssistantMsg && idx > 0 ? (
                    <TypingText text={msg.content} onComplete={scrollToBottom} />
                  ) : (
                    <div className="transition-opacity duration-300">
                      {parseCustomMessage(msg.content)}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}

        {isLoading && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="flex justify-end"
          >
            <div className="flex gap-3 max-w-[80%] flex-row-reverse">
              <div className="w-8 h-8 bg-white/5 border border-white/5 rounded-lg flex items-center justify-center shrink-0">
                <Loader2 size={14} className="animate-spin text-cyan-400" />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 p-4 bg-white/5 border border-white/5 rounded-2.5xl rounded-tr-none">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse delay-75" />
                  <span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse delay-150" />
                </div>
                <span className="text-[10px] text-teal-500 font-bold px-1">
                  {isRtl ? 'جاري تحليل الأرقام والبيانات الصندوقية...' : 'Calculating ledger statistics...'}
                </span>
              </div>
            </div>
          </motion.div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* 3. Input & Shortcut rows */}
      <div className="bg-[#15262C] p-5 border-t border-teal-950/70 flex flex-col gap-4">
        {/* Shortcut Quick replies */}
        <div className="flex flex-col gap-1.5 animate-fade-in">
          <div className="flex items-center gap-2 opacity-80 pl-1 pr-1">
            <HelpCircle size={11} className="text-teal-400" />
            <span className="text-[10px] text-teal-400 font-bold uppercase tracking-wider">
              {isRtl ? 'تعليمات سريعة لمدير المستودع' : 'System Quick Audits'}
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1.5 custom-scrollbar scrollbar-thin scrollbar-thumb-teal-900 scrollbar-track-transparent">
            {quickReplies.map((qr, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(qr.prompt)}
                disabled={isLoading}
                className="px-3 py-1.5 bg-[#0b181c]/60 hover:bg-[#203a43]/50 border border-teal-900/25 hover:border-cyan-500/30 rounded-xl text-xs font-bold text-slate-300 hover:text-cyan-400 transition-all active:scale-95 whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <MessageSquare size={12} className="text-cyan-500" />
                {qr.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input form */}
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="relative flex items-center"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRtl ? 'اسأل عن المبيعات، الديون، أو جرد صنف...' : 'Ask about sales, debts, or track an item...'}
            className="w-full h-12 bg-[#0b181c] border border-teal-900/35 rounded-2xl pl-12 pr-12 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/80 focus:border-cyan-500/80 transition-all text-sm font-semibold"
          />
          
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={`absolute ${isRtl ? 'left-2.5' : 'right-2.5'} w-8 h-8 rounded-xl bg-[#00D2FF]/10 text-[#00D2FF] hover:bg-[#00D2FF]/20 flex items-center justify-center transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer`}
          >
            {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} className={isRtl ? 'scale-x-[-1]' : ''} />}
          </button>
        </form>
      </div>
    </div>
  );
}
