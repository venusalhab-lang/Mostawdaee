import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Sparkles, Check, CreditCard, 
  ShieldCheck, Smartphone, HelpCircle, Landmark, RotateCw, Crown, ShieldAlert
} from 'lucide-react';
import { toast } from 'sonner';
import { sounds } from '../lib/sounds';

interface PremiumUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: 'ar' | 'en';
  onUpgradeSuccess: () => void;
}

export default function PremiumUpgradeModal({ 
  isOpen, 
  onClose, 
  language, 
  onUpgradeSuccess 
}: PremiumUpgradeModalProps) {
  const isRtl = language === 'ar';
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [processing, setProcessing] = useState(false);

  // Google Pay States
  const [gpayAvailable, setGpayAvailable] = useState(false);
  const [gpayLoading, setGpayLoading] = useState(false);
  const [paymentsClient, setPaymentsClient] = useState<any>(null);

  // Dynamically load Google Pay API
  useEffect(() => {
    if (!isOpen) return;

    const loadGpayScript = () => {
      if ((window as any).google?.payments?.api?.PaymentsClient) {
        initPaymentsClient();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://pay.google.com/gp/p/js/pay.js';
      script.async = true;
      script.onload = () => {
        initPaymentsClient();
      };
      script.onerror = () => {
        console.warn('Failed to load Google Pay API script.');
      };
      document.body.appendChild(script);
    };

    const initPaymentsClient = () => {
      try {
        const client = new (window as any).google.payments.api.PaymentsClient({
          environment: 'TEST', // Use 'TEST' for simulation / sandboxed checks
        });
        setPaymentsClient(client);

        const isReadyToPayRequest = {
          apiVersion: 2,
          apiVersionMinor: 0,
          allowedPaymentMethods: [{
            type: 'CARD',
            parameters: {
              allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
              allowedCardNetworks: ['AMEX', 'DISCOVER', 'INTERAC', 'JCB', 'MASTERCARD', 'VISA']
            }
          }]
        };

        client.isReadyToPay(isReadyToPayRequest)
          .then((response: any) => {
            if (response.result) {
              setGpayAvailable(true);
            } else {
              // Enable fallback simulation if Google Pay isn't supported locally
              setGpayAvailable(true); 
            }
          })
          .catch((err: any) => {
            console.error('[GPay] error checking ready state:', err);
            setGpayAvailable(true); // Always enable for sandbox capability
          });
      } catch (e) {
        console.error('[GPay] error initializing:', e);
        setGpayAvailable(true); // Dynamic fallback
      }
    };

    loadGpayScript();
  }, [isOpen]);

  const handleGooglePayClick = async () => {
    sounds?.playClick();
    setGpayLoading(true);

    if (!paymentsClient) {
      // Simulation mode
      await new Promise(resolve => setTimeout(resolve, 1500));
      simulatePremiumUpgrade();
      return;
    }

    const paymentDataRequest = {
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [{
        type: 'CARD',
        parameters: {
          allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
          allowedCardNetworks: ['AMEX', 'DISCOVER', 'INTERAC', 'JCB', 'MASTERCARD', 'VISA']
        },
        tokenizationSpecification: {
          type: 'PAYMENT_GATEWAY',
          parameters: {
            gateway: 'example',
            gatewayMerchantId: 'exampleGatewayMerchantId'
          }
        }
      }],
      transactionInfo: {
        totalPriceStatus: 'FINAL',
        totalPrice: '100.00',
        currencyCode: 'USD',
        countryCode: 'US'
      },
      merchantInfo: {
        merchantName: 'Mostawdaee System Upgrade'
      }
    };

    try {
      const paymentData = await paymentsClient.loadPaymentData(paymentDataRequest);
      console.log('[GPay] Payment succeeded:', paymentData);
      
      // Update database structures
      await upgradeUserDatabase();
    } catch (err: any) {
      if (err.statusCode === 'CANCELED') {
         toast.info(isRtl ? 'تم إلغاء عملية الدفع بـ Google Pay.' : 'Google Pay checkout was canceled.');
      } else {
         console.warn('[GPay] Failed / Bypassed.');
         toast.error(isRtl
           ? 'تعذر إكمال Google Pay. استخدم تطبيق أندرويد وGoogle Play.'
           : 'Google Pay could not complete. Use the Android app and Google Play.');
      }
    } finally {
      setGpayLoading(false);
    }
  };

  const simulatePremiumUpgrade = async () => {
    toast.error(isRtl
      ? 'لا يمكن تفعيل الاشتراك تجريبياً من المتصفح.'
      : 'Premium cannot be activated from a simulated browser checkout.');
  };

  const upgradeUserDatabase = async () => {
    throw new Error('Client-side premium activation is disabled');
  };

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    return parts.length > 0 ? parts.join(' ') : v;
  };

  const formatExpiry = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (v.length >= 2) {
      return `${v.substring(0, 2)}/${v.substring(2, 4)}`;
    }
    return v;
  };

  const handleManualCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    sounds?.playClick();

    if (!cardName.trim() || cardNumber.replace(/\s/g, '').length < 16 || cardExpiry.length < 5 || cardCvv.length < 3) {
      toast.error(isRtl ? 'يرجى إدخال بيانات بطاقة ائتمانية صحيحة وكاملة.' : 'Please enter valid credit card Details.');
      return;
    }

    setProcessing(true);
    try {
      toast.error(isRtl
        ? 'دفع البطاقة غير مدعوم. فعّل الاشتراك عبر Google Play من التطبيق.'
        : 'Card payments are not supported. Activate via Google Play in the app.');
    } catch (err) {
      toast.error(isRtl ? 'فشلت معالجة عملية البطاقة الائتمانية.' : 'Credit card processing failed.');
    } finally {
      setProcessing(false);
    }
  };

  const premiumFeatures = [
    {
      titleAr: 'سعة غير محدودة للتخزين والمخازن',
      titleEn: 'Unlimited Inventory & Storage Capacity',
      descAr: 'أضف ما تشاء من المنتجات، المستودعات الفرعية والرفوف بدون أي قيود برمجية.',
      descEn: 'Store endless rows of articles, sub-warehouses and bins without barriers.',
      color: 'from-blue-500 to-cyan-400'
    },
    {
      titleAr: 'مزامنة ونسخ احتياطي سحابي تلقائي',
      titleEn: 'Real-time Autonomous Cloud Backups',
      descAr: 'حماية كاملة فورتسجيل الفواتير مع تخزين سحابي فوري ومشفر لكافة حركات المستودع.',
      descEn: 'Automatic database ledger replication with SSL encryption for high availability.',
      color: 'from-indigo-500 to-purple-400'
    },
    {
      titleAr: 'الوصول لتطبيق الهواتف واللوحات المحمولة',
      titleEn: 'Mobile Companion & Dashboard Apps',
      descAr: 'وفرنا لك إمكانية متابعة وإدارة المبيعات فوري عبر تطبيقات Android و iOS المخصصة.',
      descEn: 'Unlock the native companion utility on phones for barcode scanning at anytime.',
      color: 'from-pink-500 to-rose-400'
    },
    {
      titleAr: 'دعم متعدد العملات المتقدم والتسوية',
      titleEn: 'Multi-Currency Financial Automation',
      descAr: 'دعم متزامن وحي لتحويلات العملات بأسعار الصرف الرسمية (JOD, ILS, USD) وبحسب السوق.',
      descEn: 'Dual ledger capabilities with automatic spot rate conversions for seamless balancing.',
      color: 'from-emerald-500 to-teal-400'
    },
    {
      titleAr: 'التحليلات والمحاسبة وبطاقات الأرباح',
      titleEn: 'Advanced Analytics & Profit Forecasting',
      descAr: 'رسوم بيانية ذكية (D3 / Recharts) لإدارة الخزينة وحساب صافي وهوامش الأرباح التفصيلية.',
      descEn: 'Access bespoke predictive financial charts, sales trends and cost of goods calculations.',
      color: 'from-amber-500 to-orange-400'
    }
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          
          {/* Backdrop blur overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md cursor-pointer"
            id="gpay-overlay"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -15 }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="w-full max-w-2xl bg-slate-900 border border-indigo-950/40 rounded-[2.5rem] shadow-2xl relative overflow-hidden z-10 flex flex-col max-h-[90vh]"
            id="gpay-modal-box"
          >
            {/* Top glowing slide */}
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-[shimmer_3s_infinite]" />

            {/* Sticky Header */}
            <div className="p-6 pb-4 border-b border-slate-800/60 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/10">
                  <Crown className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white leading-none">
                    {isRtl ? 'الترقية للنسخة الكاملة (Premium)' : 'Upgrade to Premium License'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 font-medium">
                    {isRtl ? 'صمم ميزات حصرية لتنمية نطاق أعمالك' : 'Unlock premium administrative modules'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
                title={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable features and buy options */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
              
              {!showCardForm ? (
                /* VIEW 1: Premium features list with GPay action buttons */
                <div className="space-y-6">
                  
                  {/* Features Stack */}
                  <div className="space-y-3">
                    <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold block">
                      {isRtl ? 'ما الذي ستحصل عليه في باقة مستودعي للمحترفين؟' : 'Premium Package Privileges:'}
                    </span>
                    
                    <div className="space-y-3">
                      {premiumFeatures.map((feat, index) => (
                        <div 
                          key={index} 
                          className="p-4 rounded-2xl bg-slate-950/70 border border-slate-850 hover:border-indigo-950/40 transition flex gap-4"
                        >
                          <div className={`mt-0.5 p-2 rounded-xl text-white bg-gradient-to-br ${feat.color} shadow-sm shrink-0 h-fit`}>
                            <Sparkles className="w-4 h-4 animate-spin-slow" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-sm font-bold text-white leading-snug">
                              {isRtl ? feat.titleAr : feat.titleEn}
                            </h4>
                            <p className="text-xs text-slate-400 leading-relaxed font-medium">
                              {isRtl ? feat.descAr : feat.descEn}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pricing Overview Row */}
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-[#0a1228] to-[#121c3d] border border-cyan-500/10 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="space-y-1 text-center sm:text-right">
                      <span className="text-[10px] text-cyan-400 font-black tracking-widest uppercase block">
                        {isRtl ? 'اشتراك الترخيص السنوي' : 'ANNUAL COMPREHENSIVE PLAN'}
                      </span>
                      <span className="text-sm text-slate-350 block font-semibold">
                        {isRtl 
                          ? 'تغطية شاملة لكامل خدمات النظام والمزامنة السحابية للشركات.' 
                          : 'Full access including cloud operations, updates, and maintenance.'}
                      </span>
                    </div>
                    <div className="text-center sm:text-left">
                      <div className="flex items-baseline gap-1 justify-center sm:justify-start">
                        <span className="text-3xl font-black text-white">$100.00</span>
                        <span className="text-xs text-slate-400 font-bold">/{isRtl ? 'سنوياً' : 'yr'}</span>
                      </div>
                      <span className="text-[11px] text-amber-500 font-bold mt-0.5 block">
                        {isRtl ? 'حوالي 71 دينار أردني فقط' : 'Approx 71.00 JOD'}
                      </span>
                    </div>
                  </div>

                  {/* Payment Methods and Gateways */}
                  <div className="space-y-3 pt-2">
                    {/* Google Pay Main Button */}
                    <button
                      type="button"
                      onClick={handleGooglePayClick}
                      disabled={gpayLoading}
                      className="w-full py-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-950 font-black text-sm relative shadow-xl active:scale-[0.99] transition flex items-center justify-center gap-2 cursor-pointer border border-slate-200"
                    >
                      {gpayLoading ? (
                        <>
                          <RotateCw className="w-4 h-4 animate-spin text-slate-800" />
                          <span>{isRtl ? 'برجاء الانتظار...' : 'Processing secure Google Pay...'}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-white bg-black px-2 py-0.5 rounded text-[10px] font-black tracking-wider shadow-inner">GPay</span>
                          <span>{isRtl ? 'الدفع السريع والشري للأعضاء بـ Google Pay' : 'Pay Safely with Google Pay'}</span>
                        </>
                      )}
                    </button>

                    {/* Alternative Credit Card Switcher */}
                    <button
                      type="button"
                      onClick={() => { sounds?.playClick(); setShowCardForm(true); }}
                      className="w-full py-3 rounded-2xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <CreditCard className="w-4 h-4 text-indigo-400" />
                      <span>{isRtl ? 'الدفع كبديل ببطاقة الدفع والائتمان المباشر' : 'Pay with Credit or Debit Card instead'}</span>
                    </button>
                  </div>

                </div>
              ) : (
                /* VIEW 2: Credit/Debit Card Form (Interactive & Animated) */
                <div className="space-y-6">
                  
                  {/* Card mockup */}
                  <div className="p-6 bg-gradient-to-br from-indigo-900 via-slate-950 to-[#0e172e] rounded-3xl border border-indigo-500/20 shadow-xl relative overflow-hidden text-white font-mono aspect-[1.58/1] flex flex-col justify-between max-w-sm mx-auto">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400 block leading-none">Mostawdaee Premium</span>
                        <div className="inline-flex items-center gap-1 mt-1 bg-amber-500/10 px-1.5 py-0.5 rounded leading-none border border-amber-500/10">
                          <Crown className="w-3 h-3 text-amber-400" />
                          <span className="text-[9px] uppercase font-black tracking-widest text-amber-400 leading-none">Pro Plan</span>
                        </div>
                      </div>
                      <div className="text-xs font-black px-2 py-1 rounded bg-slate-900 border border-slate-800 leading-none">VISA</div>
                    </div>

                    <div className="space-y-0.5 my-3">
                      <span className="text-[8px] uppercase tracking-wider text-slate-500 block">Card Number</span>
                      <span className="text-sm sm:text-base tracking-widest block font-bold text-slate-100">
                        {cardNumber || '•••• •••• •••• ••••'}
                      </span>
                    </div>

                    <div className="flex justify-between items-end">
                      <div className="space-y-0.5">
                        <span className="text-[8px] uppercase tracking-wider text-slate-500 block">Card Holder</span>
                        <span className="text-xs tracking-wide block uppercase font-bold text-slate-300 truncate max-w-[170px]">
                          {cardName || 'YOUR FULL NAME'}
                        </span>
                      </div>
                      <div className="flex gap-4">
                        <div className="space-y-0.5 text-right">
                          <span className="text-[8px] uppercase tracking-wider text-slate-500 block">Expires</span>
                          <span className="text-xs font-bold block">{cardExpiry || 'MM/YY'}</span>
                        </div>
                        <div className="space-y-0.5 text-right">
                          <span className="text-[8px] uppercase tracking-wider text-slate-500 block">CVV</span>
                          <span className="text-xs font-bold block">{cardCvv || '•••'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Form Inputs */}
                  <form onSubmit={handleManualCardSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300 block">
                        {isRtl ? 'اسم حامل البطاقة الائتمانية' : 'Cardholder Full Name'}
                      </label>
                      <input
                        type="text"
                        required
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        placeholder={isRtl ? 'مثال: أحمد الهاشمي' : 'e.g. Ahmad Al-Hashemi'}
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl text-xs placeholder:text-slate-650 focus:ring-1 focus:ring-indigo-500/20 font-semibold text-slate-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300 block">
                        {isRtl ? 'رقم البطاقة الائتمانية' : 'Credit Card Number'}
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={19}
                        value={cardNumber}
                        onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                        placeholder="4000 1234 5678 9010"
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl text-xs placeholder:text-slate-650 focus:ring-1 focus:ring-indigo-500/20 font-mono font-bold tracking-widest text-slate-200"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300 block">
                          {isRtl ? 'تاريخ انتهاء الصلاحية' : 'Expiry Date'}
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={5}
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                          placeholder="MM/YY"
                          className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl text-xs placeholder:text-slate-650 focus:ring-1 focus:ring-indigo-500/20 font-mono font-bold text-center text-slate-200"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300 block">
                          {isRtl ? 'الرمز السري (CVV)' : 'Security Card (CVV)'}
                        </label>
                        <input
                          type="password"
                          required
                          maxLength={3}
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="•••"
                          className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl text-xs placeholder:text-slate-650 focus:ring-1 focus:ring-indigo-500/20 font-mono font-bold text-center text-slate-200"
                        />
                      </div>
                    </div>

                    <div className="pt-2 space-y-3">
                      <button
                        type="submit"
                        disabled={processing}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-850 text-white font-black text-sm rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-600/10 hover:shadow-emerald-600/20"
                      >
                        {processing ? (
                          <>
                            <RotateCw className="w-4 h-4 animate-spin" />
                            <span>{isRtl ? 'جاري التحقق الآمن مـن البطاقة...' : 'Authorizing and routing transaction...'}</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="w-5 h-5 text-emerald-300" />
                            <span>{isRtl ? 'تأكيد ودفع قيمة الاشتراك ($100.00)' : 'Submit Payment ($100.00)'}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => { sounds?.playClick(); setShowCardForm(false); }}
                        disabled={processing}
                        className="w-full py-3 bg-slate-950 hover:bg-slate-905 border border-slate-850 hover:bg-slate-800 text-slate-400 font-bold text-xs rounded-xl transition cursor-pointer"
                      >
                        {isRtl ? 'العودة لخيارات الدفع السريع' : 'Back to Google Pay / Dashboard'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

            </div>

            {/* Sticky Footer Security disclaimer */}
            <div className="p-4 bg-slate-950/70 border-t border-slate-800/60 text-center shrink-0 flex items-center justify-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span className="text-[10px] sm:text-xs text-slate-500 font-bold">
                {isRtl 
                  ? 'رابط مشفر بالكامل وآمن ٢٥٦-بت متوافق تماماً مع معايير الأمان العالمية PCI-DSS.' 
                  : 'Fully encrypted SSL connection compliant with PCI-DSS server standards.'}
              </span>
            </div>

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
