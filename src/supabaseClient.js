import { createClient } from '@supabase/supabase-js';
import { getSupabaseCredentials } from './lib/supabaseConfig';

const actualSupabaseGetter = () => {
  const { url, key } = getSupabaseCredentials();
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
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

export const getSharedSupabaseClient = () => getClientInstance();

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
      try {
        const { data: newRow, error: insertError } = await supabase
          .from('user_subscriptions')
          .insert({ user_id: targetId, subscription_status: 'trial' })
          .select()
          .maybeSingle();

        if (!insertError && newRow) {
          console.log("[Subscription] Initialized brand-new 25-day free trial row in database for user:", targetId);
          return newRow;
        }
      } catch (e) {
        console.warn("[Subscription] Could not create the trial row:", e);
      }
      return null;
    }
    // Network or server failure: the caller keeps the last verified status instead of treating this as "no subscription".
    throw error;
  }
  return data;
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
