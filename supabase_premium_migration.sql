-- ====================================================================
-- مَستودعي (Mostawdaee) - SUPABASE PREMIUM UPGRADE MIGRATION SCRIPT
-- ====================================================================
-- This SQL migration script adds the 'is_premium' boolean attribute (defaulting to false)
-- to the profiles table. It also documents the clear procedure needed to synchronize mobile
-- purchases made via Google Play Billing on Android with client sessions on both Desktop/Web and Mobile.
--
-- How to apply this in your Supabase project:
-- 1. Log in to your Supabase Dashboard: https://supabase.com
-- 2. Open your project ("kwvrtsnvadjknioqbbxs").
-- 3. Click on the "SQL Editor" tab in the left side panel.
-- 4. Click "+ New Query", paste this entire script, and click "Run".
-- ====================================================================

-- 1. ADD COLUMN TO 'profiles' TABLE
-- Ensures that the custom attribute 'is_premium' exists in the 'profiles' table with a default value of FALSE.
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;

-- Ensure necessary complementary roles/statuses exist to prevent mismatch
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS user_role TEXT DEFAULT 'user';

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial';

-- ====================================================================
-- DOCUMENTATION: HOW TO SYNCHRONIZE PLAY BILLING WITH SUPABASE
-- ====================================================================
-- When an Android mobile user purchases the Premium license through the Google Play Billing library:
--
-- [1] Verify the purchase token locally or using a secure Node/Express backend endpoint.
-- [2] Upon confirmation of successful payment, execute the following SQL database statement
--     to immediately flag the user's Supabase account:
--
--     UPDATE public.profiles
--     SET 
--         is_premium = TRUE,
--         user_role = 'premium',
--         role = 'premium',
--         subscription_status = 'active',
--         updated_at = NOW()
--     WHERE id = :user_id; -- Replace ':user_id' with the authenticated user ID.
--
-- [3] If you are using a custom User Subscriptions table, also synchronize the active state there:
--
--     INSERT INTO public.user_subscriptions (user_id, subscription_status, expiry_date)
--     VALUES (:user_id, 'active', NOW() + INTERVAL '365 days')
--     ON CONFLICT (user_id) 
--     DO UPDATE SET 
--         subscription_status = 'active', 
--         expiry_date = NOW() + INTERVAL '365 days';
--
-- ====================================================================
-- باللغة العربية: طريقة مزامنة عمليات الشراء عبر جوجل بلاي مع الخادم
-- ====================================================================
-- عند إتمام عملية الشراء من تطبيق الأندرويد والتحقق من صحتها بنجاح:
--
--  نقوم بتحديث صفحة الملف التعريفي في ويسكون أو سوبابيس لتفعيل الاشتراك الكامل:
--
--     UPDATE public.profiles
--     SET 
--         is_premium = TRUE,
--         user_role = 'premium',
--         role = 'premium',
--         subscription_status = 'active',
--         updated_at = NOW()
--     WHERE id = :user_id; -- نقوم باستبدال معرف المستخدم الحالي.
-- ====================================================================
