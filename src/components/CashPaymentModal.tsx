import React, { useState, useEffect, useRef } from 'react';

// واجهة خصائص النافذة
interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalAmount: number; // إجمالي الفاتورة المطلوب
  currency?: string;
  onConfirm: (received: number) => void; // تأكيد وحفظ الدفع مع المبلغ المستلم
  decimals?: number;
  quickAmounts?: number[];
  language?: 'ar' | 'en';
  isSubmitting?: boolean;
}

const LABELS = {
  ar: {
    title: 'الدفع النقدي',
    close: 'إغلاق',
    due: 'المبلغ المطلوب',
    received: 'المبلغ المستلم من الزبون',
    full: 'المبلغ كاملاً',
    change: 'الباقي للزبون',
    short: 'المبلغ المدخل غير كافٍ',
    confirm: 'تأكيد وإصدار الفاتورة',
    confirming: 'جارٍ تأكيد البيع…',
  },
  en: {
    title: 'Cash payment',
    close: 'Close',
    due: 'Amount due',
    received: 'Amount received from the customer',
    full: 'Exact amount',
    change: 'Change due',
    short: 'Amount entered is not enough',
    confirm: 'Confirm and issue invoice',
    confirming: 'Confirming sale…',
  },
};

const FULL_AMOUNT = 'full';

export default function CashPaymentModal({ isOpen, onClose, totalAmount, currency = '₪', onConfirm, decimals = 2, quickAmounts: quickList = [50, 100, 200], language = 'ar', isSubmitting = false }: PaymentModalProps) {
  const l = LABELS[language];
  const [receivedAmount, setReceivedAmount] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 1. تفعيل حقل الإدخال تلقائياً عند فتح النافذة (بدون ماوس)
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setReceivedAmount(''); // تصفير الحقل لعملية جديدة
    }
  }, [isOpen]);

  // 2. حسابيات الباقي والتحقق
  const received = parseFloat(receivedAmount) || 0;
  const change = received - totalAmount;
  const isSufficient = received >= totalAmount - 1e-6; // هل المبلغ المدخل يغطي الفاتورة؟

  // 3. أزرار المبالغ النقدية السريعة لتسريع عمل الكاشير
  const quickAmounts: (number | typeof FULL_AMOUNT)[] = [...quickList.slice(0, 3), FULL_AMOUNT];

  const handleQuickAmount = (val: number | typeof FULL_AMOUNT) => {
    if (val === FULL_AMOUNT) {
      setReceivedAmount(totalAmount.toFixed(decimals));
    } else {
      setReceivedAmount(val.toString());
    }
    inputRef.current?.focus(); // إعادة التركيز للحقل بعد الضغط
  };

  // إذا كانت النافذة مغلقة، لا ترندر أي شيء
  if (!isOpen) return null;

  return (
    // تأثير الزجاج الخلفي (Glassmorphism) مع تغميق الشاشة
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-opacity" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      
      {/* حاوية النافذة المنبثقة مع حركة دخول سلسة متوافقة مع شاشات 90Hz */}
      <div className="bg-white dark:bg-[#0f172a] rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-md overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-200">
        
        {/* رأس النافذة */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/[0.02]">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            💵 {l.title}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-rose-500 transition-colors cursor-pointer" aria-label={l.close} title={l.close}>
            {/* أيقونة إغلاق X */}
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {/* محتوى النافذة */}
        <div className="p-6 space-y-6">
          
          {/* بطاقة الإجمالي المطلوب */}
          <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl p-4 text-center">
            <div className="text-sm font-medium text-emerald-800 dark:text-emerald-400 mb-1">{l.due}</div>
            <div className="text-4xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {totalAmount.toFixed(decimals)} {currency}
            </div>
          </div>

          {/* حقل إدخال المبلغ المستلم */}
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 text-center">
              {l.received}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="number"
                step="any"
                value={receivedAmount}
                onChange={(e) => setReceivedAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isSufficient && received > 0 && !isSubmitting) {
                    onConfirm(received);
                  }
                }}
                disabled={isSubmitting}
                className="w-full text-center text-3xl font-mono font-bold bg-slate-100 dark:bg-white/5 border-2 border-slate-200 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-500 rounded-xl px-4 py-3 outline-none transition-all text-slate-900 dark:text-white disabled:opacity-60"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* أزرار الكاش السريعة */}
          <div className="grid grid-cols-4 gap-2">
            {quickAmounts.map((amt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleQuickAmount(amt)}
                className="py-2 px-1 text-xs sm:text-sm font-bold rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-500/20 hover:border-blue-400 dark:hover:border-blue-500/50 transition-all active:scale-95 cursor-pointer"
              >
                {amt === FULL_AMOUNT ? l.full : `${amt} ${currency}`}
              </button>
            ))}
          </div>

          {/* بطاقة حساب الباقي (تتغير ألوانها ديناميكياً) */}
          <div className={`rounded-2xl p-4 text-center transition-colors duration-300 ${received > 0 ? (isSufficient ? 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10' : 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20') : 'opacity-50 grayscale border border-slate-200 dark:border-white/5'}`}>
            <div className={`text-sm font-bold mb-1 ${isSufficient || received === 0 ? 'text-slate-600 dark:text-slate-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {received === 0 ? l.change : isSufficient ? l.change : l.short}
            </div>
            <div className={`text-3xl font-black font-mono ${isSufficient || received === 0 ? 'text-slate-900 dark:text-white' : 'text-rose-600 dark:text-rose-400'}`}>
              {(received === 0 ? 0 : isSufficient ? Math.max(0, change) : Math.abs(change)).toFixed(decimals)} {currency}
            </div>
          </div>
        </div>

        {/* زر التأكيد (لا يعمل إلا إذا كان المبلغ كافياً) */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02]">
          <button
            type="button"
            onClick={() => { if (!isSubmitting) onConfirm(received); }}
            disabled={!isSufficient || received === 0 || isSubmitting}
            className="w-full py-4 rounded-xl font-bold text-lg text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700/50 disabled:text-slate-500 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 disabled:shadow-none active:scale-[0.98] cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <span className="inline-block w-5 h-5 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                {l.confirming}
              </>
            ) : (
              <>🖨️ {l.confirm}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
