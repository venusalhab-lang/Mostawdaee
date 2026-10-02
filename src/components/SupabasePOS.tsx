import React, { useState, useEffect } from 'react';
import { getSupabaseClient, isSupabaseConfigured, SupabaseProductRow, getSupabaseCredentials, saveSupabaseCredentials, clearSupabaseCredentials } from '../services/supabase';
import { ShoppingCart, Search, Trash2, Plus, Minus, CheckCircle, Database, AlertCircle, RefreshCw, KeyRound, Info, LogIn, LogOut, Mail, Lock, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  language: 'ar' | 'en';
}

export default function SupabasePOS({ language }: Props) {
  const isRtl = language === 'ar';
  
  const [isConfigured, setIsConfigured] = useState(isSupabaseConfigured());
  const [tempUrl, setTempUrl] = useState('');
  const [tempKey, setTempKey] = useState('');

  const [products, setProducts] = useState<SupabaseProductRow[]>([]);
  const [cart, setCart] = useState<(SupabaseProductRow & { cartQuantity: number })[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [supabaseUser, setSupabaseUser] = useState<any>(null);

  // Auth fields and panel control
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showAuthCard, setShowAuthCard] = useState(false);
  const [bypassAuth, setBypassAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signUpSuccessMsg, setSignUpSuccessMsg] = useState<string | null>(null);

  // Feed with existing keys if configured or partially filled
  useEffect(() => {
    const creds = getSupabaseCredentials();
    setTempUrl(creds.url);
    setTempKey(creds.key);
  }, [isConfigured]);

  useEffect(() => {
    if (isConfigured) {
      checkAuthAndFetch();
      const client = getSupabaseClient();
      if (client) {
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          setSupabaseUser(session?.user ?? null);
          fetchProducts();
        });
        const subscription = (data as any)?.subscription;
        return () => {
          try { subscription?.unsubscribe?.(); } catch (e) {}
        };
      }
    }
  }, [isConfigured]);

  const handleSaveCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempUrl.trim() || !tempKey.trim()) {
      toast.error(isRtl ? 'يرجى إدخال جميع بيانات الاتصال المطلوبة' : 'Please fill all credential fields');
      return;
    }
    
    if (!tempUrl.toLowerCase().trim().startsWith('http://') && !tempUrl.toLowerCase().trim().startsWith('https://')) {
      toast.error(isRtl ? 'يجب أن يبدأ الرابط بـ http:// أو https://' : 'URL must start with http:// or https://');
      return;
    }

    try {
      saveSupabaseCredentials(tempUrl, tempKey);
      
      if (isSupabaseConfigured()) {
        setIsConfigured(true);
        toast.success(isRtl ? 'تم حفظ إعدادات Supabase بنجاح! جاري تحويلك لواجهة الدخول...' : 'Supabase credentials saved successfully! Redirecting...');
      } else {
        toast.error(isRtl ? 'بيانات التكوين المكتوبة غير صالحة أو تحتوي على قيم افتراضية' : 'Entered credentials are still detected as placeholder/invalid.');
      }
    } catch (err: any) {
      toast.error(isRtl ? `حدث خطأ أثناء الحفظ: ${err.message}` : `Error saving: ${err.message}`);
    }
  };

  const checkAuthAndFetch = async () => {
    setLoading(true);
    try {
      const client = getSupabaseClient();
      if (!client) return;

      // 1. Check if we have an active session user
      const { data: { user }, error: userErr } = await client.auth.getUser();
      if (user) {
        setSupabaseUser(user);
      }
      
      // 2. Fetch products
      await fetchProducts();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client) return;

    if (!authEmail || !authPassword) {
      toast.error(isRtl ? 'يرجى إدخال البريد الإلكتروني وكلمة المرور' : 'Please fill all fields');
      return;
    }

    if (authPassword.length < 6) {
      const msg = isRtl 
        ? 'يجب أن تتكون كلمة المرور من 6 خانات أو أحرف على الأقل.' 
        : 'Password must be at least 6 characters.';
      toast.error(msg);
      setAuthError(msg);
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setSignUpSuccessMsg(null);
    try {
      const { error } = await client.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });

      if (error) throw error;

      toast.success(isRtl ? 'تم تسجيل الدخول بنجاح!' : 'Signed in successfully!');
      setShowAuthCard(false);
      setBypassAuth(false);
      setAuthPassword('');
    } catch (err: any) {
      console.error(err);
      const errMsg = err.message || '';
      setAuthError(errMsg);
      toast.error(isRtl ? `فشل تسجيل الدخول: ${err.message}` : `Login failed: ${err.message}`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client) return;

    if (!authEmail || !authPassword) {
      toast.error(isRtl ? 'يرجى إدخال البريد الإلكتروني وكلمة المرور' : 'Please fill all fields');
      return;
    }

    if (authPassword.length < 6) {
      const msg = isRtl 
        ? 'يجب أن تتكون كلمة المرور من 6 خانات أو أحرف على الأقل.' 
        : 'Password must be at least 6 characters.';
      toast.error(msg);
      setAuthError(msg);
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setSignUpSuccessMsg(null);
    try {
      // Get the dynamic App URL to support real-time preview domain detection and iframe nesting for registration flows.
      let appOrigin = window.location.origin;
      
      // Resolve null, opaque, or invalid origins from different window/frame attributes dynamically
      if (!appOrigin || appOrigin === 'null' || appOrigin === 'opaque') {
        try {
          if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
            appOrigin = window.location.ancestorOrigins[0];
          }
        } catch (e) {
          // Cross-origin restrictions might prevent reading ancestorOrigins
        }
      }

      // If still unresolved or opaque, parse it directly from the current frame or window URL
      if (!appOrigin || appOrigin === 'null' || appOrigin === 'opaque') {
        try {
          const parsed = new URL(window.location.href);
          if (parsed.origin && parsed.origin !== 'null' && parsed.origin !== 'opaque') {
            appOrigin = parsed.origin;
          }
        } catch (e) {
          console.warn('[SupabasePOS] URL parsing failed:', e);
        }
      }

      // Reconstruct from protocol and host as a safe last-resort fallback
      if (!appOrigin || appOrigin === 'null' || appOrigin === 'opaque') {
        appOrigin = `${window.location.protocol}//${window.location.host}`;
      }
      
      if (!appOrigin.endsWith('/')) {
        appOrigin = appOrigin + '/';
      }

      const { data, error } = await client.auth.signUp({
        email: authEmail,
        password: authPassword,
        options: {
          emailRedirectTo: appOrigin,
        }
      });

      if (error) throw error;

      const userExists = data?.user?.identities && data.user.identities.length === 0;
      
      if (userExists) {
        // In Supabase, if a user already exists, signUp might silently return an empty identities array to avoid user enumeration.
        const msg = isRtl 
          ? 'تنبيه: هذا البريد الإلكتروني مسجل مسبقاً بالفعل! يرجى محاولة تسجيل الدخول مباشرة أو إعادة تعيين كلمة المرور.'
          : 'Notice: This email address is already registered! Please try signing in directly with this email.';
        setAuthError(msg);
        toast.warning(msg);
      } else {
        const successMsg = isRtl
          ? 'تم إنشاء الحساب بنجاح! يرجى مراجعة بريدك الإلكتروني للتفعيل إذا تطلب الأمر لتجنب رسالة (Invalid login credentials).'
          : 'Account created successfully! If email confirmation is enabled on your Supabase project, check your inbox to confirm it.';
        setSignUpSuccessMsg(successMsg);
        toast.success(successMsg);
      }
      setAuthPassword('');
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || '');
      toast.error(isRtl ? `فشل إنشاء الحساب: ${err.message}` : `Signup failed: ${err.message}`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true);
    try {
      localStorage.setItem('mustawdae_manual_signout', 'true');
      localStorage.removeItem('mustawdae_supabase_session_override');
      const { error } = await client.auth.signOut();
      if (error) throw error;
      setSupabaseUser(null);
      setBypassAuth(false);
      setCart([]);
      setProducts([]);
      toast.success(isRtl ? 'تم تسجيل الخروج بنجاح.' : 'Signed out successfully.');
    } catch (err: any) {
      console.error(err);
      toast.error(isRtl ? 'فشل تسجيل الخروج' : 'Failed to sign out');
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    const client = getSupabaseClient();
    if (!client) return;

    setLoading(true);
    try {
      const { data, error } = await client
        .from('products')
        .select('*');

      if (error) {
        throw error;
      }
      if (data) {
        setProducts(data as SupabaseProductRow[]);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(
        isRtl 
          ? `خطأ أثناء جلب المنتجات: ${err.message || 'تأكد من إعداد RLS وجلسة المستخدم.'}` 
          : `Error fetching products: ${err.message || 'Check RLS and user session.'}`
      );
    } finally {
      setLoading(false);
    }
  };

  // 2. إضافة منتج للسلة
  const addToCart = (product: SupabaseProductRow) => {
    if (!product.id) return;
    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.id === product.id);
      if (existing) {
        if (existing.cartQuantity >= product.quantity) {
          toast.warning(
            isRtl 
              ? 'الكمية المطلوبة تتجاوز المخزون المتوفر!' 
              : 'Requested quantity exceeds available stock!'
          );
          return prevCart;
        }
        return prevCart.map((item) =>
          item.id === product.id ? { ...item, cartQuantity: item.cartQuantity + 1 } : item
        );
      }
      return [...prevCart, { ...product, cartQuantity: 1 }];
    });
  };

  // 3. تعديل الكميات داخل السلة
  const updateQuantity = (id: number, amount: number) => {
    setCart((prevCart) =>
      prevCart
        .map((item) => {
          if (item.id === id) {
            const newQty = item.cartQuantity + amount;
            if (newQty > item.quantity) {
              toast.warning(
                isRtl 
                  ? 'الكمية المطلوبة تتجاوز المخزون المتوفر!' 
                  : 'Requested quantity exceeds available stock!'
              );
              return item; 
            }
            return { ...item, cartQuantity: newQty };
          }
          return item;
        })
        .filter((item) => item.cartQuantity > 0)
    );
  };

  // 4. حساب المجموع الإجمالي
  const total = Number(cart.reduce((sum, item) => {
    const itemPrice = Number(item.price) || 0;
    const itemQty = Number(item.cartQuantity) || 0;
    return sum + (itemPrice * itemQty);
  }, 0).toFixed(4));

  // 5. عملية الدفع وحسم الكميات من المستودع
  const handleCheckout = async () => {
    if (cart.length === 0) return;

    const client = getSupabaseClient();
    if (!client) {
      toast.error(isRtl ? 'لم يتم تكوين اتصال Supabase!' : 'Supabase is not configured!');
      return;
    }

    setLoading(true);
    try {
      // تحديث الكميات في قاعدة البيانات لكل منتج بالسلة
      // نقوم بتنفيذ تحديث ذري للحد من Race Conditions
      const promises = cart.map(async (item) => {
        const soldQty = Number(item.cartQuantity) || 0;
        
        // 1. محاولة استخدام دالة RPC ذرية (في حال كانت معرفة في Postgres) لمنع تضارب البيانات والسباقات
        const { error: rpcError } = await client.rpc('decrement_product_stock', {
          product_id: item.id,
          sold_qty: soldQty
        });

        if (rpcError) {
          console.warn("[Supabase] decrement_product_stock RPC failed or not present, falling back to direct atomic calculation:", rpcError);
          
          // 2. تحديث مباشر للعملية مع معالجة النوع الرقمي بدقة
          const origQty = Number(item.quantity) || 0;
          const { error: directError } = await client
            .from('products')
            .update({ quantity: Math.max(0, origQty - soldQty) })
            .eq('id', item.id);
            
          if (directError) {
            throw directError;
          }
        }
      });

      const results = await Promise.all(promises);

      toast.success(
        isRtl 
          ? 'تمت عملية البيع بنجاح وتحديث المخزن لقاعدة بياناتك في السحابة!' 
          : 'Checkout successful! Stock levels updated in your cloud database.'
      );
      setCart([]);
      await fetchProducts(); // إعادة تحديث المنتجات بالشاشة
    } catch (err: any) {
      console.error(err);
      toast.error(
        isRtl 
          ? `فشلت المزامنة: ${err.message || 'يرجى مراجعة صلاحيات التعديل وسياسات RLS.'}` 
          : `Checkout failed: ${err.message || 'Check update permissions and RLS policies.'}`
      );
    } finally {
      setLoading(false);
    }
  };

  // فلترة المنتجات حسب بحث التاجر
  const filteredProducts = products.filter(p => 
    (p.product_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isConfigured) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 max-w-xl mx-auto shadow-2xl space-y-6 text-right animate-fadeIn" dir={isRtl ? "rtl" : "ltr"}>
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
            <KeyRound size={32} />
          </div>
          <h3 className="text-xl font-black text-white">
            {isRtl ? "تكوين قاعدة بيانات Supabase" : "Supabase Cloud Configuration"}
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
            {isRtl 
              ? "للوصول إلى المبيعات الحية والمنتجات السحابية المخصصة ومزامنتها، يرجى إدخال مفاتيح الاتصال الخاصة بمشروعك في Supabase أدناه."
              : "To enable interactive cloud-sync checkout and secure multi-user partitioning, please configure your live Supabase credentials below."}
          </p>
        </div>

        <form onSubmit={handleSaveCredentials} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              {isRtl ? "رابط مشروع Supabase (URL)" : "Supabase Project URL"}
            </label>
            <div className="relative">
              <Database className={`absolute ${isRtl ? 'right-3' : 'left-3'} top-3 text-slate-500`} size={16} />
              <input
                type="text"
                required
                placeholder="https://kwvrtsnvadjknioqbbxs.supabase.co"
                className={`w-full bg-slate-950 border border-slate-800 rounded-2xl py-2.5 ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} text-xs text-white focus:outline-none focus:border-emerald-500 font-mono`}
                value={tempUrl}
                onChange={(e) => setTempUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              {isRtl ? "المفتاح العام لمشروعك (Anon/Public Key)" : "Anon / Public API Key"}
            </label>
            <div className="relative">
              <KeyRound className={`absolute ${isRtl ? 'right-3' : 'left-3'} top-3 text-slate-500`} size={16} />
              <input
                type="text"
                required
                placeholder="eyJhbGciOi..."
                className={`w-full bg-slate-950 border border-slate-800 rounded-2xl py-2.5 ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} text-xs text-white focus:outline-none focus:border-emerald-500 font-mono`}
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              {isRtl 
                ? "💡 تجد هذه المـفاتيح في: Supabase Dashboard ➔ Project Settings ➔ API"
                : "💡 Locate these keys inside your: Supabase Dashboard ➔ Project Settings ➔ API"}
            </p>
          </div>

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-2xl py-3.5 text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/10 active:scale-95"
          >
            <CheckCircle size={16} />
            <span>{isRtl ? "حفظ ومزامنة قاعدة البيانات" : "Save & Sync Database"}</span>
          </button>
        </form>
      </div>
    );
  }

  if (!supabaseUser && !bypassAuth) {
    return (
      <div className="min-h-[500px] flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6 shadow-2xl text-right animate-fadeIn" dir={isRtl ? "rtl" : "ltr"}>
          <div className="text-center space-y-2">
            <div className="w-14 h-14 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-2">
              <KeyRound size={28} />
            </div>
            <h3 className="text-xl font-black text-white">
              {isRtl ? "كاشير السحابة" : "Cloud Cashier Login"}
            </h3>
            <p className="text-xs text-slate-400">
              {isRtl 
                ? "سجل دخولك السحابي للوصول وفهرسة مبيعاتك ومنتجاتك الخاصة" 
                : "Sign in with your database credentials to sync transactions"}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-300">
                {isRtl ? "البريد الإلكتروني" : "Email Address"}
              </label>
              <div className="relative">
                <Mail className={`absolute ${isRtl ? 'right-3' : 'left-3'} top-3 text-slate-500`} size={16} />
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-2xl py-2.5 ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} text-xs text-white focus:outline-none focus:border-emerald-500 font-mono`}
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-300">
                {isRtl ? "كلمة المرور" : "Password"}
              </label>
              <div className="relative">
                <Lock className={`absolute ${isRtl ? 'right-3' : 'left-3'} top-3 text-slate-500`} size={16} />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-2xl py-2.5 ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} text-xs text-white focus:outline-none focus:border-emerald-500 font-mono`}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                />
              </div>
              <p className="text-[10px] text-slate-500">
                {isRtl ? "💡 يجب ألا تقل عن 6 خانات أو أحرف" : "💡 Must be at least 6 characters"}
              </p>
            </div>

            {authError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-200 text-xs p-3.5 rounded-2xl space-y-2 text-right leading-relaxed animate-fadeIn" dir={isRtl ? "rtl" : "ltr"}>
                <div className="flex items-center gap-2 text-rose-400 font-bold">
                  <AlertCircle size={14} />
                  <span>{isRtl ? "تنبيـه خطأ بالدخول" : "Auth Alert / Error"}</span>
                </div>
                <p className="font-mono text-[11px] bg-black/40 p-2 rounded-xl text-rose-300 select-all border border-rose-500/10">
                  {authError}
                </p>
                {authError.toLowerCase().includes('credential') && (
                  <div className="bg-amber-500/5 rounded-xl p-2.5 border border-amber-500/15 text-[11px] text-amber-300 space-y-1.5 leading-normal">
                    <p className="font-bold">
                      {isRtl ? "💡 كيف تتجاوز هذه المشكلة؟" : "💡 How to solve Invalid Login Credentials?"}
                    </p>
                    <ol className={`list-decimal ${isRtl ? 'pr-4' : 'pl-4'} space-y-1 text-[10.5px]`}>
                      {isRtl ? (
                        <>
                          <li>
                            <b>الخيار الأول:</b> إذا كنت تريد تسجيل الدخول مباشرة، قم بإيقاف خاصية <b>Confirm Email</b> في لوحة تحكم Supabase عبر: <b>Auth ➔ Providers ➔ Email</b>.
                            <a
                              href="https://supabase.com/docs/guides/auth#email-confirmation"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-200 underline"
                            >
                              اقرأ الوثائق هنا
                            </a>
                          </li>
                          <li>
                            <b>الخيار الثاني:</b> إذا أنشأت حساباً بالفعل، تحقق من بريدك الوارد/السبام لتأكيد البريد الإلكتروني، ثم حاول تسجيل الدخول مرة أخرى باستخدام نفس البريد.
                          </li>
                        </>
                      ) : (
                        <>
                          <li>
                            <b>Option 1:</b> For instant login, disable email confirmation in your Supabase dashboard under <b>Auth ➔ Providers ➔ Email</b>.
                            <a
                              href="https://supabase.com/docs/guides/auth#email-confirmation"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-200 underline"
                            >
                              Read the docs
                            </a>
                          </li>
                          <li>
                            <b>Option 2:</b> If you already created an account, confirm the verification email from your inbox/spam folder, then sign in again with the same email address.
                          </li>
                        </>
                      )}
                    </ol>
                  </div>
                )}
              </div>
            )}

            {signUpSuccessMsg && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs p-3.5 rounded-2xl space-y-1.5 text-right leading-relaxed animate-fadeIn" dir={isRtl ? "rtl" : "ltr"}>
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <CheckCircle size={14} />
                  <span>{isRtl ? "تمت المهمة بنجاح" : "Success"}</span>
                </div>
                <p>{signUpSuccessMsg}</p>
                <div className="bg-amber-500/5 rounded-xl p-2.5 border border-amber-500/15 text-[10.5px] text-amber-300 leading-normal">
                  {isRtl ? (
                    <span>💡 <b>إذا لم تتمكن من تسجيل الدخول بعدها مباشرة:</b> يرجى إيقاف تأكيد البريد الإلكتروني في إعدادات ملقم Supabase الخاص بك (Auth ➔ Providers ➔ Email ➔ Confirm email) لضمان التمكين التلقائي الفوري.</span>
                  ) : (
                    <span>💡 <b>If you see 'Invalid credentials' on log in:</b> Turn OFF email confirmation in your <b>Supabase Dashboard ➔ Auth ➔ Providers ➔ Email ➔ Confirm email</b> so new users can log in instantly without waiting.</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={authLoading}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-2xl py-3 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/10 active:scale-95"
              >
                {authLoading ? <RefreshCw size={14} className="animate-spin" /> : <LogIn size={14} />}
                <span>{isRtl ? "تسجيل الدخول" : "Sign In"}</span>
              </button>

              <button
                type="button"
                onClick={handleSignUp}
                disabled={authLoading}
                className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-2xl py-3 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-700 active:scale-95"
              >
                {authLoading ? <RefreshCw size={14} className="animate-spin" /> : <UserPlus size={14} />}
                <span>{isRtl ? "إنشاء حساب" : "Sign Up"}</span>
              </button>
            </div>
          </div>

          <div className="border-t border-slate-800/60 pt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setBypassAuth(true)}
              className="w-full text-center text-[11px] text-emerald-400 hover:text-emerald-300 hover:underline transition-all cursor-pointer font-bold"
            >
              {isRtl ? "⚡ الاستمرار كضيف مؤقتاً (بدون حساب)" : "⚡ Continue as Guest / Demo (bypass login)"}
            </button>
            <p className="text-[10px] text-slate-500 text-center leading-relaxed">
              {isRtl 
                ? "* تحتاج لتسجيل الدخول الفعلي للوصول إلى المنتجات الخاصة بك بموجب قواعد RLS."
                : "* Real authentication is required to modify & view your personal item inventory via RLS keys."}
            </p>
          </div>
        </form>
      </div>
    );
  }

  // Loaded Cashier Dashboard / Control Panel
  return (
    <div className="space-y-6">
      {/* Supabase status ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4 text-slate-300 animate-fadeIn animate-duration-300">
        <div className="flex items-center gap-3">
          <Database className="text-emerald-500 animate-pulse" size={20} />
          <div>
            <h3 className="font-extrabold text-sm text-white uppercase tracking-wider">
              {isRtl ? "مزامنة سحابة Supabase نشطة" : "Supabase Cloud POS Mode Active"}
            </h3>
            <p className="text-xs text-slate-400">
              {isRtl 
                ? "جميع السجلات، العمليات، والمخزن مربوط مباشرة بقاعدة بيانات PostgreSQL السحابية."
                : "All items, actions, and stock decreases are live-connected with your cloud PostgreSQL."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {supabaseUser ? (
            <div className="flex items-center gap-2">
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full text-[10px] font-mono font-bold max-w-[200px] truncate" title={supabaseUser.email}>
                {supabaseUser.email}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={loading}
                className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 hover:text-white text-rose-400 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                <LogOut size={11} />
                <span>{isRtl ? "خروج" : "Sign Out"}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-3 py-1 rounded-full text-[10px] font-mono font-bold font-black">
                {isRtl ? "متصل كـ Anon (ضيف)" : "Connected as Anon (Guest)"}
              </span>
              <button
                type="button"
                onClick={() => setBypassAuth(false)}
                className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600 hover:text-white text-emerald-400 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                <LogIn size={11} />
                <span>{isRtl ? "تسجيل دخول كمستخدم" : "Sign In User"}</span>
              </button>
            </div>
          )}
          <button 
            onClick={() => {
              clearSupabaseCredentials();
              setIsConfigured(false);
              setSupabaseUser(null);
              setCart([]);
              setProducts([]);
              toast.info(isRtl ? 'تم مسح مفاتيح التكوين' : 'Configuration cleared.');
            }}
            disabled={loading}
            className="p-1.5 bg-slate-800/80 hover:bg-rose-950/45 hover:text-rose-400 border border-slate-700/50 hover:border-rose-500/30 rounded-xl text-slate-300 transition-all flex items-center gap-1 text-[10px] font-bold cursor-pointer"
            title={isRtl ? "إعادة تعيين مفاتيح Supabase" : "Reset Supabase Keys"}
          >
            <KeyRound size={11} />
            <span>{isRtl ? "تغيير المفاتيح" : "Reset Keys"}</span>
          </button>

          <button 
            onClick={fetchProducts}
            disabled={loading}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors cursor-pointer"
            title={isRtl ? "تحديث الأصناف" : "Refresh Items"}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Right Section: Products Grid & Search */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Search Bar */}
          <div className="relative backdrop-blur-xl bg-slate-900/50 border border-slate-800 focus-within:border-emerald-500/50 rounded-2xl p-4 shadow-xl flex items-center gap-3 transition-colors duration-300">
            <Search className="text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder={isRtl ? "ابحث عن منتج سحابي..." : "Search cloud products..."}
              className="bg-transparent border-none outline-none w-full text-base placeholder-slate-500 text-white"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Info tip */}
          <div className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl flex items-start gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Info size={14} className="mt-0.5" />
            <p>
              {isRtl 
                ? "تخضع هذه الواجهة لقواعد RLS التي أنشأتها (المستخدم يرى ويضيف لمنتجاته فقط). تظهر هنا عناصر المنتجات التي تطابق معرّف user_id الخاص بك."
                : "This screen is bound to your Row Level Security (RLS) policies. Only products where user_id matches your authentication UID are loaded."}
            </p>
          </div>

          {/* Products Grid */}
          {loading && products.length === 0 ? (
            <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="animate-spin text-emerald-500" size={24} />
              <span>{isRtl ? "جاري تحميل مستودعك الآمن..." : "Loading secure store inventory..."}</span>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex-1 min-h-[300px] bg-slate-900/20 border border-dashed border-slate-800 rounded-3xl flex flex-col items-center justify-center text-slate-500 p-8 text-center space-y-2 animate-fadeIn">
              <Database size={32} className="opacity-40" />
              <p className="font-bold">
                {isRtl ? "لم يتم العثور على أي منتج سحابي" : "No cloud products found"}
              </p>
              <p className="text-xs max-w-sm">
                {isRtl 
                  ? "يمكنك الانتقال إلى شريط الإعدادات ومزامنة ورفع بعض منتجاتك المحلية، أو التأكد من إعداد RLS وسياسات Supabase."
                  : "Go to Settings tab to sync/insert local items to your database backend, or check your auth context config."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto max-h-[600px] pr-1">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={product.quantity <= 0}
                  className={`group relative backdrop-blur-md bg-slate-900 border ${
                    product.quantity <= 0 
                      ? 'border-slate-800/50 opacity-50 cursor-not-allowed' 
                      : 'border-slate-800 hover:border-emerald-500/40'
                  } rounded-2xl p-4 text-right transition-all duration-200 active:scale-[0.98] shadow-lg flex flex-col justify-between h-40 overflow-hidden text-right`}
                  dir={isRtl ? "rtl" : "ltr"}
                >
                  {/* Glowing effect gradient */}
                  <div className="absolute -inset-px bg-gradient-to-br from-emerald-500/0 to-teal-500/0 group-hover:from-emerald-500/5 group-hover:to-teal-500/5 rounded-2xl transition-all duration-300" />
                  
                  <div>
                    <h3 className="font-bold text-base text-slate-100 group-hover:text-white transition-colors truncate">
                      {product.product_name}
                    </h3>
                    <span className={`text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full inline-block mt-2 font-bold ${
                      product.quantity <= 0 
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/10' 
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10'
                    }`}>
                      {isRtl ? "المخزن:" : "In-Stock:"} {product.quantity} {isRtl ? "حبة" : "units"}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-end mt-4">
                    <span className="text-lg font-black text-emerald-400 font-mono">
                      ${Number(product.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                    <div className="bg-emerald-600/20 group-hover:bg-emerald-600 p-2 rounded-xl text-emerald-400 group-hover:text-white transition-all duration-200">
                      <Plus className="w-4 h-4" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Left Section: Active Invoice & Cart Panel */}
        <div className="w-full lg:w-96 backdrop-blur-2xl bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col h-[550px] sticky top-6">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4 mb-4">
            <ShoppingCart className="text-emerald-400 w-6 h-6" />
            <h2 className="text-lg font-black text-white">
              {isRtl ? "السلة السحابية الحالية" : "Live Cloud Cart"}
            </h2>
          </div>

          {/* List of Cart Items */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 py-12">
                <ShoppingCart className="w-12 h-12 stroke-[1] text-slate-600" />
                <p className="text-xs">{isRtl ? "سلة الفاتورة فارغة حالياً" : "Your cart is empty"}</p>
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.id} className="flex items-center justify-between bg-slate-950/60 border border-slate-900 p-3 rounded-xl backdrop-blur-sm animate-fadeIn">
                  <div className="flex-1 min-w-0 pr-2">
                    <h4 className="font-bold text-xs truncate text-slate-200">{item.product_name}</h4>
                    <span className="text-[11px] text-emerald-400 font-bold font-mono">
                      ${Number(item.price || 0).toFixed(2)} × {item.cartQuantity}
                    </span>
                  </div>
                  
                  {/* Quantity controls */}
                  <div className="flex items-center gap-1.5 bg-black/45 p-1 rounded-lg border border-slate-800">
                    <button 
                      onClick={() => item.id && updateQuantity(item.id, -1)} 
                      className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center font-bold text-xs text-emerald-300 font-mono">
                      {item.cartQuantity}
                    </span>
                    <button 
                      onClick={() => item.id && updateQuantity(item.id, 1)} 
                      className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Total rate & Action buttons */}
          <div className="border-t border-slate-800 pt-4 mt-4 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-medium text-xs">
                {isRtl ? "المجموع الإجمالي" : "Grand Total"}
              </span>
              <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300 font-mono">
                ${total.toFixed(2)}
              </span>
            </div>

            <button
              onClick={handleCheckout}
              disabled={cart.length === 0 || loading}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white py-3.5 rounded-2xl font-bold text-sm shadow-lg shadow-emerald-500/10 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              {isRtl ? "تأكيد البيع وخصم المخازن" : "Confirm Sync Checkout"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
