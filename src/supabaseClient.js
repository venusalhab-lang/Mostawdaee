import { createClient } from '@supabase/supabase-js';

const actualSupabaseGetter = () => {
  let url = '';
  let key = '';
  const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

  // 1. Try to load from Vite environment variables (highest priority)
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL.trim() && !import.meta.env.VITE_SUPABASE_URL.includes('...')) {
        const envUrl = import.meta.env.VITE_SUPABASE_URL.trim();
        if (envUrl.startsWith('http')) {
          url = envUrl;
        }
      }
      if (import.meta.env.VITE_SUPABASE_ANON_KEY && import.meta.env.VITE_SUPABASE_ANON_KEY.trim() && !import.meta.env.VITE_SUPABASE_ANON_KEY.includes('...')) {
        key = import.meta.env.VITE_SUPABASE_ANON_KEY.trim();
      }
    }
  } catch (e) {
    console.warn("[supabaseClient] Failed reading from import.meta.env:", e);
  }

  // 2. Try to load from localStorage (to support user-specific overrides/debugging)
  if (isBrowser) {
    try {
      const storedUrl = window.localStorage.getItem('VITE_SUPABASE_URL');
      const storedKey = window.localStorage.getItem('VITE_SUPABASE_ANON_KEY');
      if (storedUrl && storedUrl.trim() && !storedUrl.includes('...')) {
        const trimmedUrl = storedUrl.trim();
        if (trimmedUrl.startsWith('http')) {
          url = trimmedUrl;
        }
      }
      if (storedKey && storedKey.trim() && !storedKey.includes('...')) {
        key = storedKey.trim();
      }
    } catch (e) {
      console.warn("[supabaseClient] Failed reading from localStorage:", e);
    }
  }

  // 3. Fallback to default hardcoded keys if still empty/invalid
  if (!url || !url.startsWith('http')) {
    url = 'https://kwvrtsnvadjknioqbbxs.supabase.co';
  }
  if (!key) {
    key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3dnJ0c252YWRqa25pb3FiYnhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTk5NTQsImV4cCI6MjA5NTEzNTk1NH0.6YfS8ujoO2yjMQoaFNgptRa70qyUglqhignezpm2d4M';
  }

  console.log("[supabaseClient] Initializing client. URL:", url, "Key Length:", key ? key.length : 0);

  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
};

let _cachedClient = null;
const getClientInstance = () => {
  if (!_cachedClient) {
    _cachedClient = actualSupabaseGetter();
  }
  return _cachedClient;
};

try {
  window.addEventListener('storage', (e) => {
    if (e.key === 'VITE_SUPABASE_URL' || e.key === 'VITE_SUPABASE_ANON_KEY') {
      _cachedClient = null;
    }
  });
} catch(e) {}

export const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getClientInstance();
    const value = client[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  }
});

// Provide a default export for consumers that import the client as default
export default supabase;

// -------------------------------------------------------------
// 2. دوال إدارة الحساب والملف الشخصي (Profiles)
// -------------------------------------------------------------

/**
 * جلب إعدادات الملف الشخصي للمستخدم الحالي
 */
export async function getProfile() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('يرجى تسجيل الدخول أولاً');

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * جلب إعدادات الملف الشخصي للمستخدم بواسطة معرف فريد
 */
export async function getProfileById(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error("[Supabase] Error fetching profile by ID:", error);
    return null;
  }
  return data;
}

/**
 * جلب تفاصيل الاشتراك والمزامنة لتقييد انتهاء الصلاحية
 */
export async function getSubscription(userId) {
  let targetId = userId;
  if (!targetId) {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return null;
    targetId = user.id;
  }

  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', targetId)
    .single();

  if (error) {
    if (error.code === 'PGRST116' || error.message?.includes('no rows')) {
      const trialStart = new Date().toISOString();
      const trialExpiry = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const { data: newRow, error: insertError } = await supabase
          .from('user_subscriptions')
          .insert({
            user_id: targetId,
            trial_start_date: trialStart,
            subscription_status: 'trial',
            expiry_date: trialExpiry,
            updated_at: new Date().toISOString()
          })
          .select()
          .maybeSingle();

        if (!insertError && newRow) {
          console.log("[Subscription] Initialized brand-new 25-day free trial row in database for user:", targetId);
          return newRow;
        }
      } catch (e) {
        console.warn("[Subscription] Could not insert new subscription row, falling back to dynamic client-side trial:", e);
      }
    }

    console.error("Supabase subscription query error:", error);
    return null;
  }
  return data;
}

/**
 * تحديث حالة وتفاصيل اشتراك المستخدم في سوبابيس
 * @param {string} status 'trial' | 'active' | 'expired'
 * @param {number} expiryDays عدد أيام الصلاحية المضافة للترخيص (الافتراضي 365 يوماً للسنوي)
 */
export async function updateSubscription(status, expiryDays = 365) {
  if (status === 'active') {
    throw new Error('Premium activation must be completed through the billing API');
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('يرجى تسجيل الدخول أولاً');

  const expiryDate = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  // 1. Update user_subscriptions table
  const { data, error } = await supabase
    .from('user_subscriptions')
    .upsert({
      user_id: user.id,
      subscription_status: status,
      expiry_date: expiryDate,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select();

  if (error) {
    console.error("Supabase subscription update error:", error);
    throw error;
  }

  // 2. Cascade premium states to profiles table dynamically
  try {
    const isPremium = status === 'active';
    await supabase
      .from('profiles')
      .update({
        is_premium: isPremium,
        role: isPremium ? 'premium' : 'user',
        user_role: isPremium ? 'premium' : 'user',
        subscription_status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);
    console.log('[Supabase] Successfully updated multi-platform profile premium flags.');
  } catch (profileErr) {
    console.warn('[Supabase] Non-blocking warning: profiles custom columns update failed or pending migrations. Retrying with standard subscriber sync:', profileErr);
    // Safe retry with guaranteed subset fields
    try {
      await supabase
        .from('profiles')
        .update({
          subscription_status: status,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);
    } catch (_) {}
  }

  return data && data[0];
}

/**
 * تحديث إعدادات المستودع أو النظام للمستخدم
 * @param {Object} updates الحقول المراد تحديثها (مثل थीम، dark_mode، currency)
 */
export async function updateProfile(updates) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('يرجى تسجيل الدخول أولاً');

  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select();

  if (error) throw error;
  return data && data[0];
}

// -------------------------------------------------------------
// 3. دوال إدارة المستودعات والرفوف (Warehouses)
// -------------------------------------------------------------

/**
 * جلب قائمة كافة المستودعات والمستودعات الفرعية
 */
export async function fetchWarehouses() {
  const { data, error } = await supabase
    .from('warehouses')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * إضافة مستودع جديد أو رف وموقع فرعي
 */
export async function insertWarehouse(warehouse) {
  const { data, error } = await supabase
    .from('warehouses')
    .insert([warehouse])
    .select();

  if (error) throw error;
  return data && data[0];
}

/**
 * حذف مستودع بالكامل
 */
export async function deleteWarehouse(id) {
  const { error } = await supabase
    .from('warehouses')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

// -------------------------------------------------------------
// 4. دوال إدارة مواد ومنتجات وأصول المستودع (Products)
// -------------------------------------------------------------

/**
 * جلب المنتجات المخزنة مع إمكانية الفلترة حسب المستودع أو القسم
 */
export async function fetchProducts(filters = {}) {
  let query = supabase.from('products').select('*, warehouses(name)');

  if (filters.category) {
    query = query.eq('category', filters.category);
  }
  if (filters.warehouse_id) {
    query = query.eq('warehouse_id', filters.warehouse_id);
  }
  if (filters.type) {
    query = query.eq('type', filters.type); // 'product' or 'asset'
  }

  const { data, error } = await query.order('name', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * إضافة منتج جديد إلى البيانات السحابية
 */
export async function insertProduct(product) {
  const { data, error } = await supabase
    .from('products')
    .insert([product])
    .select();

  if (error) throw error;
  return data && data[0];
}

/**
 * تحديث بيانات منتج معين (الأسعار، الكميات، تاريخ الصلاحية)
 */
export async function updateProduct(id, updates) {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select();

  if (error) throw error;
  return data && data[0];
}

/**
 * حذف منتج نهائيا من قاعدة البيانات
 */
export async function deleteProduct(id) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

// -------------------------------------------------------------
// 5. دوال الفواتير والمشتريات والمبيعات وحركات المخزون (Invoices & Transactions)
// -------------------------------------------------------------

/**
 * جلب كافة الفواتير المسجلة (صادرة مبيعات أو واردة مشتريات)
 */
export async function fetchInvoices() {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('date', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * تسجيل فاتورة جديدة كاملة وتحديث مستويات جرد السلع تلقائياً ومزامنة الصندوق
 * @param {Object} invoice البيانات الأساسية للفاتورة
 * @param {Array} items قائمة السلع المشتراة أو المباعة بداخلها
 */
export async function createCompletedInvoice(invoice, items) {
  try {
    const invoiceType = invoice.type || 'sale';

    // Map fields from camelCase to snake_case safely
    const mappedInvoice = {
      id: invoice.id || crypto.randomUUID(),
      invoice_number: String(invoice.invoiceNumber || invoice.invoice_number || `INV-${Math.floor(100000 + Math.random() * 900000)}`).trim(),
      customer_name: invoice.customerName || invoice.customer_name || null,
      supplier_name: invoice.supplierName || invoice.supplier_name || null,
      date: invoice.date ? new Date(invoice.date).toISOString() : new Date().toISOString(),
      items: items.map(it => ({
        product_id: it.product_id || it.productId || '',
        description: it.description || it.name || it.product_name || "صنف غير محدد",
        quantity: parseInt(it.quantity || it.cartQuantity || 0, 10) || 0,
        unitPrice: parseFloat(it.price || it.unitPrice || 0) || 0,
        total: (parseInt(it.quantity || it.cartQuantity || 0, 10) || 0) * (parseFloat(it.price || it.unitPrice || 0) || 0)
      })),
      subtotal: parseFloat(invoice.subtotal) || 0,
      tax_amount: parseFloat(invoice.taxAmount || invoice.tax_amount || 0) || 0,
      total_amount: parseFloat(invoice.totalAmount || invoice.total_amount || 0) || 0,
      type: invoiceType,
      currency: invoice.currency || 'JOD'
    };

    // 1. إدراج رأس الفاتورة
    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .insert([mappedInvoice])
      .select();

    if (invoiceError) throw invoiceError;
    const newInvoice = invoiceData[0];

    // 2. إدراج حركات السلع المفصلة لكل صنف وتحديث كمية المنتج بالمستودع موازياً
    for (const item of items) {
      const parsedQty = parseInt(item.quantity || item.cartQuantity || 0, 10) || 0;
      const parsedPrice = parseFloat(item.price || item.unitPrice || 0) || 0;
      const prodId = item.product_id || item.productId;
      const prodName = item.description || item.name || item.product_name || "صنف غير محدد";

      if (!prodId) continue;

      const { error: txError } = await supabase
        .from('transactions')
        .insert([{
          product_id: prodId,
          product_name: prodName,
          type: invoiceType, // 'sale' | 'purchase'
          quantity: parsedQty,
          price_per_unit: parsedPrice,
          total_amount: parsedQty * parsedPrice,
          invoice_id: newInvoice.id,
          serial_number: item.serial_number || item.serialNumber || null
        }]);

      if (txError) throw txError;

      // تعديل كمية المخزن الفعلي للسلعة (المشتريات تزيد ومبيعات تنقص من المخون)
      const quantityDelta = invoiceType === 'sale' ? -parsedQty : parsedQty;
      
      // جلب الكمية القديمة للتعديل الآمن
      const { data: currentProd, error: prodFetchErr } = await supabase
        .from('products')
        .select('quantity')
        .eq('id', prodId)
        .maybeSingle();

      if (prodFetchErr) {
        console.warn("[Supabase] Failed to fetch product qty:", prodFetchErr);
      }

      if (currentProd) {
        const newQty = Math.max(0, (parseInt(currentProd.quantity, 10) || 0) + quantityDelta);
        const { error: updateProdErr } = await supabase
          .from('products')
          .update({ quantity: newQty })
          .eq('id', prodId);
        
        if (updateProdErr) {
          console.error("[Supabase] Failed to update product quantity:", updateProdErr);
        }
      }
    }

    // 3. تحديث تدفقات صندوق المال (خزينة الأموال) للعملية الفورية
    const amountToVault = parseFloat(newInvoice.total_amount) || 0;
    const isIncome = invoiceType === 'sale';
    
    const { data: currentVault, error: vaultFetchErr } = await supabase
      .from('vaults')
      .select('*')
      .maybeSingle();

    if (vaultFetchErr) {
      console.warn("[Supabase] Failed to fetch vault info:", vaultFetchErr);
    }

    if (currentVault) {
      const amountToVault = parseFloat(newInvoice.total_amount) || 0;
      const isIncome = invoiceType === 'sale';
      const currency = String(newInvoice.currency || 'JOD').toUpperCase();

      const updates = {
        last_updated: new Date().toISOString()
      };

      if (currency === 'JOD') {
        updates.balance_jod = (parseFloat(currentVault.balance_jod) || 0) + (isIncome ? amountToVault : -amountToVault);
      } else if (currency === 'ILS') {
        updates.balance_ils = (parseFloat(currentVault.balance_ils) || 0) + (isIncome ? amountToVault : -amountToVault);
      } else if (currency === 'USD') {
        updates.balance_usd = (parseFloat(currentVault.balance_usd) || 0) + (isIncome ? amountToVault : -amountToVault);
      }

      const nextBal = currency === 'JOD' ? updates.balance_jod 
                    : (currency === 'ILS' ? updates.balance_ils : updates.balance_usd);
      updates.current_balance = nextBal;

      // تحديث الخزينة
      const { error: updateVaultErr } = await supabase
        .from('vaults')
        .update(updates)
        .eq('user_id', currentVault.user_id);

      if (updateVaultErr) {
        console.warn("[Supabase] Failed to update vault:", updateVaultErr);
      }

      // تسجيل حركة بالصندوق
      const { error: insertVaultTxErr } = await supabase
        .from('vault_transactions')
        .insert([{
          type: isIncome ? 'income' : 'expense',
          category: invoiceType,
          amount: amountToVault,
          currency: currency,
          description: `فاتورة ${invoiceType === 'sale' ? 'بيع' : 'شراء'} رقم ${newInvoice.invoice_number}`,
          balance_after: nextBal
        }]);

      if (insertVaultTxErr) {
        console.warn("[Supabase] Failed to insert vault transaction:", insertVaultTxErr);
      }
    }

    return newInvoice;
  } catch (err) {
    console.error("[Supabase] createCompletedInvoice failed:", err);
    throw err;
  }
}

/**
 * تسجيل مصروف عملي جديد وتزيله من الصندوق في سوبابيس
 */
export async function createCompletedExpense(expense) {
  try {
    const amount = parseFloat(expense.amount) || 0;
    const description = String(expense.description || '').trim();
    const currency = String(expense.currency || 'JOD');
    const category = String(expense.category || 'other');

    // 1. جلب رصيد الخزينة الحالي
    const { data: currentVault, error: vaultErr } = await supabase
      .from('vaults')
      .select('*')
      .maybeSingle();

    if (vaultErr) throw vaultErr;

    if (currentVault) {
      const currency = String(expense.currency || 'JOD').toUpperCase();
      const updates = {
        last_updated: new Date().toISOString()
      };

      if (currency === 'JOD') {
        updates.balance_jod = (parseFloat(currentVault.balance_jod) || 0) - amount;
      } else if (currency === 'ILS') {
        updates.balance_ils = (parseFloat(currentVault.balance_ils) || 0) - amount;
      } else if (currency === 'USD') {
        updates.balance_usd = (parseFloat(currentVault.balance_usd) || 0) - amount;
      }

      const nextBal = currency === 'JOD' ? updates.balance_jod 
                    : (currency === 'ILS' ? updates.balance_ils : updates.balance_usd);
      updates.current_balance = nextBal;

      // 2. تحديث الخزينة
      const { error: updateErr } = await supabase
        .from('vaults')
        .update(updates)
        .eq('user_id', currentVault.user_id);

      if (updateErr) throw updateErr;

      // 3. تسجيل معاملة الخزينة
      const { data: tx, error: txErr } = await supabase
        .from('vault_transactions')
        .insert([{
          type: 'expense',
          category: category,
          amount: amount,
          currency: currency,
          description: description,
          balance_after: nextBal
        }])
        .select();

      if (txErr) throw txErr;
      return tx && tx[0];
    }
    return null;
  } catch (err) {
    console.error("[Supabase] createCompletedExpense failed:", err);
    throw err;
  }
}

// -------------------------------------------------------------
// 6. دوال شؤون الموظفين والرواتب (Employees & Payroll)
// -------------------------------------------------------------

export async function fetchEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw error;
  return data;
}

export async function insertEmployee(employee) {
  const { data, error } = await supabase
    .from('employees')
    .insert([employee])
    .select();

  if (error) throw error;
  return data && data[0];
}

export async function updateEmployee(id, updates) {
  const { data, error } = await supabase
    .from('employees')
    .update(updates)
    .eq('id', id)
    .select();

  if (error) throw error;
  return data && data[0];
}

// مسجل الرواتب الشهرية والمدفوعات
export async function paySalary(payrollRecord) {
  const { data, error } = await supabase
    .from('payroll_records')
    .insert([payrollRecord])
    .select();

  if (error) throw error;

  // خصم فوري من الخزينة لصافي الراتب
  const { data: currentVault } = await supabase
    .from('vaults')
    .select('*')
    .single();

  if (currentVault) {
    const amount = payrollRecord.net_salary;
    const currency = String(payrollRecord.currency || 'JOD').toUpperCase();

    const updates = {
      last_updated: new Date().toISOString()
    };

    if (currency === 'JOD') {
      updates.balance_jod = (parseFloat(currentVault.balance_jod) || 0) - amount;
    } else if (currency === 'ILS') {
      updates.balance_ils = (parseFloat(currentVault.balance_ils) || 0) - amount;
    } else if (currency === 'USD') {
      updates.balance_usd = (parseFloat(currentVault.balance_usd) || 0) - amount;
    }

    const nextBal = currency === 'JOD' ? updates.balance_jod 
                  : (currency === 'ILS' ? updates.balance_ils : updates.balance_usd);
    updates.current_balance = nextBal;

    await supabase
      .from('vaults')
      .update(updates)
      .eq('user_id', currentVault.user_id);

    await supabase
      .from('vault_transactions')
      .insert([{
        type: 'expense',
        category: 'salary',
        amount: payrollRecord.net_salary,
        currency: currency,
        description: `صرف راتب الموظف ${payrollRecord.employee_name || 'مسجل'} لشهر ${payrollRecord.month_year}`,
        balance_after: nextBal
      }]);
  }

  return data && data[0];
}

// -------------------------------------------------------------
// 7. دوال العملاء وحساب الديون والذمم المترتبة (Customers & Debts)
// -------------------------------------------------------------

export async function fetchCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * تسجيل عميل جديد
 */
export async function insertCustomer(customer) {
  const { data, error } = await supabase
    .from('customers')
    .insert([customer])
    .select();

  if (error) throw error;
  return data && data[0];
}

/**
 * تسديد جزء من الدين لصالح عميل أو تسجيل دفعة واردة
 */
export async function recordCustomerPayment(customerId, amount, currency, notes = '') {
  // 1. جلب رصيد العميل الحالي لتحديثه
  const { data: customer, error: fetchErr } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (fetchErr) throw fetchErr;

  const currentDebt = Number(customer.total_debt) || 0;
  const nextDebt = Math.max(0, currentDebt - amount);

  // 2. تحديث رصيد الدين للعميل
  await supabase
    .from('customers')
    .update({ total_debt: nextDebt })
    .eq('id', customerId);

  // 3. تسجيل معاملة الدين التفصيلية
  const { data: tx, error: txErr } = await supabase
    .from('customer_transactions')
    .insert([{
      customer_id: customerId,
      type: 'payment',
      amount: amount,
      currency: currency || 'JOD',
      notes: notes || 'دفعة لتسديد جزء من الذمم المالية المترتبة',
      remaining_balance_after: nextDebt
    }])
    .select();

  if (txErr) throw txErr;

  // 4. إغراق النقدية في حقيبة الصندوق السحابية تلقائياً بقيمة الدفعة
  const { data: currentVault } = await supabase
    .from('vaults')
    .select('*')
    .single();

  if (currentVault) {
    const cur = String(currency || 'JOD').toUpperCase();
    const updates = {
      last_updated: new Date().toISOString()
    };

    if (cur === 'JOD') {
      updates.balance_jod = (parseFloat(currentVault.balance_jod) || 0) + amount;
    } else if (cur === 'ILS') {
      updates.balance_ils = (parseFloat(currentVault.balance_ils) || 0) + amount;
    } else if (cur === 'USD') {
      updates.balance_usd = (parseFloat(currentVault.balance_usd) || 0) + amount;
    }

    const nextBal = cur === 'JOD' ? updates.balance_jod 
                  : (cur === 'ILS' ? updates.balance_ils : updates.balance_usd);
    updates.current_balance = nextBal;

    await supabase
      .from('vaults')
      .update(updates)
      .eq('user_id', currentVault.user_id);

    await supabase
      .from('vault_transactions')
      .insert([{
        type: 'income',
        category: 'manual',
        amount: amount,
        currency: cur,
        description: `تسديد ذمة دائنة من العميل: ${customer.name}`,
        balance_after: nextBal
      }]);
  }

  return tx && tx[0];
}

// -------------------------------------------------------------
// 8. دوال حقيبة وخزينة المال والأرصدة (Vaults & Cashflow)
// -------------------------------------------------------------

/**
 * جلب الرصيد الإجمالي للصندوق ومكوناته بالعملات
 */
export async function getVaultBalance() {
  const { data, error } = await supabase
    .from('vaults')
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/**
 * جلب سجل الحركات المالية الواردة والصادرة للصندوق
 */
export async function fetchVaultTransactions() {
  const { data, error } = await supabase
    .from('vault_transactions')
    .select('*')
    .order('timestamp', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * إنشاء فاتورة مشتريات وتحديث جدول المشتريات وكمية الأصناف وبنود المشتريات في سوبابيس مع زيادة المخزون
 */
export async function createCompletedPurchase(purchaseData, itemsData) {
  try {
    // 1. إدراج فاتورة المشتريات في جدول purchases
    const { data: insertedPurchase, error: purchaseError } = await supabase
      .from('purchases')
      .insert([{
        invoice_number: purchaseData.invoiceNumber || purchaseData.invoice_number,
        supplier_name: purchaseData.supplierName || purchaseData.supplier_name,
        purchase_date: purchaseData.purchaseDate || purchaseData.date || new Date().toISOString(),
        subtotal: parseFloat(purchaseData.subtotal) || 0,
        tax_amount: parseFloat(purchaseData.taxAmount || purchaseData.tax_amount) || 0,
        total_amount: parseFloat(purchaseData.totalAmount || purchaseData.total_amount) || 0,
        currency: purchaseData.currency || 'JOD',
        payment_status: purchaseData.paymentStatus || 'paid',
        notes: purchaseData.notes || ''
      }])
      .select();

    if (purchaseError) throw purchaseError;
    const purchase = insertedPurchase[0];

    // 2. إدخال البنود في جدول purchase_items وتحديث جرد المنتجات في products
    for (const item of itemsData) {
      const q = parseInt(item.quantity, 10) || 0;
      const c = parseFloat(item.unitCost || item.price || item.unitPrice) || 0;
      const prodId = item.product_id || item.productId;

      if (!prodId) continue;

      // إدراج بند المشتريات
      const { error: itemError } = await supabase
        .from('purchase_items')
        .insert([{
          purchase_id: purchase.id,
          product_id: prodId,
          product_name: item.product_name || item.name || item.description,
          quantity: q,
          unit_cost: c,
          total_cost: Number((q * c).toFixed(2))
        }]);

      if (itemError) throw itemError;

      // تحديث مخزون المنتجات (Stock Increment) في جدول products
      const { data: currentProd, error: fetchErr } = await supabase
        .from('products')
        .select('quantity')
        .eq('id', prodId)
        .maybeSingle();

      if (fetchErr) {
        console.warn("[Supabase] Failed to fetch product qty:", fetchErr);
      }

      if (currentProd) {
        const newQty = (parseInt(currentProd.quantity, 10) || 0) + q;
        const { error: updateErr } = await supabase
          .from('products')
          .update({ quantity: newQty, status: newQty <= 0 ? 'Out of Stock' : 'In Stock' })
          .eq('id', prodId);

        if (updateErr) {
          console.error("[Supabase] Failed to update product quantity:", updateErr);
        }
      }
    }

    return purchase;
  } catch (err) {
    console.error("[Supabase] createCompletedPurchase failed:", err);
    throw err;
  }
}


