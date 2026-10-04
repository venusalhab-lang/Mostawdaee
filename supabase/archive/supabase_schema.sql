-- ARCHIVED. Do not run: grants wider access than supabase_production_setup.sql and would reopen fixed holes.
-- ====================================================================
-- مَستودعي (Mostawdaee) - SUPABASE COMPLETE DDL & RLS SCHEMA SCRIPT
-- ====================================================================
-- This file contains the complete SQL setup code for your Supabase database.
-- It matches all components (Products, Invoices, Customers, Warehouses, Employees, Payroll, and Vault).
-- Row Level Security (RLS) is automatically configured to isolate each user's data securely.
--
-- How to apply this in Supabase:
-- 1. Go to your Supabase Dashboard: https://supabase.com
-- 2. Select your project ("kwvrtsnvadjknioqbbx").
-- 3. Click on "SQL Editor" in the left sidebar.
-- 4. Click "New Query", paste this entire script, and click "Run".
-- ====================================================================

-- ---------------------------------------------------------
-- 0. CLEANUP (OPTIONAL - uncomment if you want a fresh restart)
-- ---------------------------------------------------------
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP FUNCTION IF EXISTS public.handle_new_user();
-- DROP TABLE IF EXISTS public.vault_transactions CASCADE;
-- DROP TABLE IF EXISTS public.vaults CASCADE;
-- DROP TABLE IF EXISTS public.transactions CASCADE;
-- DROP TABLE IF EXISTS public.invoices CASCADE;
-- DROP TABLE IF EXISTS public.customer_transactions CASCADE;
-- DROP TABLE IF EXISTS public.customers CASCADE;
-- DROP TABLE IF EXISTS public.payroll_records CASCADE;
-- DROP TABLE IF EXISTS public.employees CASCADE;
-- DROP TABLE IF EXISTS public.product_logs CASCADE;
-- DROP TABLE IF EXISTS public.products CASCADE;
-- DROP TABLE IF EXISTS public.warehouses CASCADE;
-- DROP TABLE IF EXISTS public.profiles CASCADE;


-- ---------------------------------------------------------
-- 1. PROFILES & USER SETTINGS (ملفات المستخدمين الإعدادية)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    user_name TEXT,
    business_name TEXT,
    default_vat_rate NUMERIC DEFAULT 16.0,
    default_customs_duty NUMERIC DEFAULT 0.0,
    default_language TEXT DEFAULT 'ar',
    enable_animations BOOLEAN DEFAULT TRUE,
    ai_verbosity TEXT DEFAULT 'concise',
    theme TEXT DEFAULT 'modern',
    dark_mode BOOLEAN DEFAULT FALSE,
    currency TEXT DEFAULT 'JOD',
    primary_color TEXT DEFAULT '#0f172a',
    font_size INTEGER DEFAULT 14,
    mandatory_serial BOOLEAN DEFAULT FALSE,
    low_stock_threshold INTEGER DEFAULT 10,
    sound_effects BOOLEAN DEFAULT TRUE,
    toast_notifications BOOLEAN DEFAULT TRUE,
    has_onboarded BOOLEAN DEFAULT FALSE,
    use_manual_exchange_rates BOOLEAN DEFAULT FALSE,
    exchange_rate_usd_ils NUMERIC DEFAULT 3.65,
    exchange_rate_jod_ils NUMERIC DEFAULT 5.15,
    exchange_rate_jod_usd NUMERIC DEFAULT 1.41,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 1. Security Definer Function to avoid RLS policy recursion on profiles
CREATE OR REPLACE FUNCTION public.check_is_super_admin(user_id UUID)
RETURNS BOOLEAN 
SECURITY DEFINER
SET search_path = public -- حماية الدالة من اختراق مسار البحث
AS $$
DECLARE
    is_admin BOOLEAN;
BEGIN
    -- Check if current authenticated user belongs to our master admin email directly
    IF auth.jwt() ->> 'email' = 'venusalhab@gmail.com' THEN
        RETURN TRUE;
    END IF;

    -- قراءة مباشرة لتجنب التعقيد
    SELECT (role = 'super_admin') INTO is_admin 
    FROM public.profiles 
    WHERE id = user_id;
    RETURN COALESCE(is_admin, FALSE);
END;
$$ LANGUAGE plpgsql;

-- Ensure profiles table has role column explicitly
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;

-- DOCUMENTATION NOTE (ملاحظة التوثيق): 
-- When an Android mobile user purchases the Premium Subscription via Google Play Billing:
-- 1. Perform subscription validation in Android/Billing validation service.
-- 2. Once validated, update the user session in Supabase:
--    UPDATE public.profiles 
--    SET is_premium = TRUE, role = 'premium', subscription_status = 'active', updated_at = NOW() 
--    WHERE id = :user_id;
-- 3. Also update user_subscriptions to ensure full tracking:
--    INSERT INTO public.user_subscriptions (user_id, subscription_status, expiry_date)
--    VALUES (:user_id, 'active', NOW() + INTERVAL '365 days')
--    ON CONFLICT (user_id) DO UPDATE SET subscription_status = 'active', expiry_date = NOW() + INTERVAL '365 days';

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Creating RLS Policies for Profiles
-- تنويه: لمنع التداخل الدائري في SELECT، يسمح للمستخدم برؤية نفسه مباشرة دون استدعاء الدالة
DROP POLICY IF EXISTS "Users can view their own profile settings." ON public.profiles;
CREATE POLICY "Users can view their own profile settings." 
    ON public.profiles FOR SELECT 
    USING (
        (auth.uid() = id) OR 
        public.check_is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Users can update their own profile settings." ON public.profiles;
CREATE POLICY "Users can update their own profile settings." 
    ON public.profiles FOR UPDATE 
    USING (
        (auth.uid() = id) OR 
        public.check_is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Users can insert their own profile settings." ON public.profiles;
CREATE POLICY "Users can insert their own profile settings." 
    ON public.profiles FOR INSERT 
    WITH CHECK (
        (auth.uid() = id) OR 
        public.check_is_super_admin(auth.uid())
    );


-- ---------------------------------------------------------
-- 2. WAREHOUSES & SUB-WAREHOUSES (المستودعات والمستودعات الفرعية)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warehouses (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    name TEXT NOT NULL,
    location TEXT,
    parent_id TEXT REFERENCES public.warehouses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own warehouses." 
    ON public.warehouses FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own warehouses." 
    ON public.warehouses FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own warehouses." 
    ON public.warehouses FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own warehouses." 
    ON public.warehouses FOR DELETE 
    USING (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 3. PRODUCTS (الأصناف والمنتجات والأصول)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    category TEXT NOT NULL,
    brand TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit_cost NUMERIC NOT NULL DEFAULT 0.0,
    selling_price NUMERIC NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'In Stock',
    serial_number TEXT,
    low_stock_threshold INTEGER DEFAULT 10,
    date_added TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    expiry_date TIMESTAMP WITH TIME ZONE,
    type TEXT DEFAULT 'product', -- 'product' or 'asset'
    warehouse_id TEXT REFERENCES public.warehouses(id) ON DELETE SET NULL,
    CONSTRAINT chk_qty CHECK (quantity >= 0),
    CONSTRAINT chk_cost CHECK (unit_cost >= 0),
    CONSTRAINT chk_price CHECK (selling_price >= 0)
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own products." 
    ON public.products FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own products." 
    ON public.products FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own products." 
    ON public.products FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own products." 
    ON public.products FOR DELETE 
    USING (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 4. PRODUCT LOGS (سجل عمليات وحركات المنتجات)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- 'create' | 'update_stock' | 'update_info' | 'delete' | 'sale' | 'purchase'
    change_type TEXT NOT NULL, -- 'increment' | 'decrement' | 'set'
    quantity_delta INTEGER,
    previous_value JSONB,
    new_value JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    user_name TEXT
);

ALTER TABLE public.product_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own product logs." 
    ON public.product_logs FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own product logs." 
    ON public.product_logs FOR INSERT 
    WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 5. EMPLOYEES (شؤون الموظفين)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    name TEXT NOT NULL,
    role TEXT,
    contact TEXT,
    salary NUMERIC NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'on-leave' | 'terminated'
    hired_date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own employees." 
    ON public.employees FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own employees." 
    ON public.employees FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own employees." 
    ON public.employees FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own employees." 
    ON public.employees FOR DELETE 
    USING (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 6. PAYROLL RECORDS (رواتب ومستحقات الموظفين)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE NOT NULL,
    employee_name TEXT,
    month_year TEXT NOT NULL, -- format e.g., '06-2026'
    allowances NUMERIC DEFAULT 0.0,
    deductions NUMERIC DEFAULT 0.0,
    net_salary NUMERIC NOT NULL DEFAULT 0.0,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    payment_status TEXT NOT NULL DEFAULT 'pending' -- 'pending' | 'paid'
);

ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own payroll records." 
    ON public.payroll_records FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own payroll records." 
    ON public.payroll_records FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own payroll records." 
    ON public.payroll_records FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own payroll records." 
    ON public.payroll_records FOR DELETE 
    USING (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 7. CUSTOMERS & SUPPLIERS DEBTS (العملاء والديون والذمم المالية)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    customer_id TEXT, -- Custom external business code
    name TEXT NOT NULL,
    phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    total_debt NUMERIC NOT NULL DEFAULT 0.0,
    currency TEXT NOT NULL DEFAULT 'JOD'
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own customers." 
    ON public.customers FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own customers." 
    ON public.customers FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own customers." 
    ON public.customers FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own customers." 
    ON public.customers FOR DELETE 
    USING (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 8. CUSTOMER DEBT TRANSACTIONS (حركات تسديد الديون والذمم المترتبة)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    transaction_id TEXT,
    customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
    type TEXT NOT NULL, -- 'invoice' | 'payment'
    invoice_id UUID,
    amount NUMERIC NOT NULL DEFAULT 0.0,
    currency TEXT NOT NULL DEFAULT 'JOD',
    exchange_rate NUMERIC DEFAULT 1.0,
    date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    notes TEXT,
    remaining_balance_after NUMERIC NOT NULL
);

ALTER TABLE public.customer_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own customer transactions." 
    ON public.customer_transactions FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own customer transactions." 
    ON public.customer_transactions FOR INSERT 
    WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 9. INVOICES (الفواتير - مبيعات ومشتريات)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    invoice_number TEXT NOT NULL,
    customer_name TEXT,
    supplier_name TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    items JSONB NOT NULL DEFAULT '[]'::jsonb, -- dynamic structure array of items (product_id, quantity, unitPrice, total)
    subtotal NUMERIC NOT NULL DEFAULT 0.0,
    tax_amount NUMERIC NOT NULL DEFAULT 0.0,
    total_amount NUMERIC NOT NULL DEFAULT 0.0,
    type TEXT NOT NULL DEFAULT 'sale', -- 'sale' | 'purchase'
    currency TEXT NOT NULL DEFAULT 'JOD'
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own invoices." 
    ON public.invoices FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own invoices." 
    ON public.invoices FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own invoices." 
    ON public.invoices FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own invoices." 
    ON public.invoices FOR DELETE 
    USING (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 10. PRODUCT TRANSACTIONS (حركات المبيعات والمشتريات التفصيلية لكل صنف)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    product_name TEXT,
    type TEXT NOT NULL, -- 'sale' | 'purchase'
    quantity INTEGER NOT NULL,
    price_per_unit NUMERIC NOT NULL,
    total_amount NUMERIC NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    serial_number TEXT
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own item transactions." 
    ON public.transactions FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own item transactions." 
    ON public.transactions FOR INSERT 
    WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 11. VAULTS (حقيبة وخزينة الأموال)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vaults (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    current_balance NUMERIC NOT NULL DEFAULT 0.0,
    balance_jod NUMERIC NOT NULL DEFAULT 0.0,
    balance_ils NUMERIC NOT NULL DEFAULT 0.0,
    balance_usd NUMERIC NOT NULL DEFAULT 0.0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

ALTER TABLE public.vaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own vault balance." 
    ON public.vaults FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own vault." 
    ON public.vaults FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vault balance." 
    ON public.vaults FOR UPDATE 
    USING (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 12. VAULT TRANSACTIONS (سجلات الصندوق التفصيلية للتدفقات النقدية)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vault_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT null DEFAULT auth.uid(),
    type TEXT NOT NULL, -- 'income' | 'expense'
    category TEXT NOT NULL, -- 'sale' | 'purchase' | 'salary' | 'manual' | 'other'
    amount NUMERIC NOT NULL DEFAULT 0.0,
    currency TEXT NOT NULL DEFAULT 'JOD',
    description TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    balance_after NUMERIC NOT NULL DEFAULT 0.0
);

ALTER TABLE public.vault_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own vault transactions." 
    ON public.vault_transactions FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own vault transactions." 
    ON public.vault_transactions FOR INSERT 
    WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 14. AUTOMATIC HANDLERS / TRIGGERS (أتمتة إنشاء حسابات لجميع المشتركين الجدد)
-- ---------------------------------------------------------
-- These database functions automatically create a complete matching profile setting row,
-- an empty financial vault, and an active 25-day trial subscription record
-- whenever a new signup registers in auth.users!
-- This ensures they don't crash on initial login.

-- Extend profiles or check/create User Subscriptions table
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    trial_start_date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    subscription_status TEXT DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'expired')),
    expiry_date TIMESTAMP WITH TIME ZONE DEFAULT (TIMEZONE('utc'::text, NOW()) + INTERVAL '25 days'),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Enable Row Level Security
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Creating RLS policies for User Subscriptions
DROP POLICY IF EXISTS "Users can view their own subscription status" ON public.user_subscriptions;
CREATE POLICY "Users can view their own subscription status"
    ON public.user_subscriptions FOR SELECT
    USING (
        (auth.uid() = user_id) OR 
        public.check_is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Users can update their own subscription" ON public.user_subscriptions;
CREATE POLICY "Users can update their own subscription"
    ON public.user_subscriptions FOR UPDATE
    USING (
        (auth.uid() = user_id) OR 
        public.check_is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Users can insert their own subscription" ON public.user_subscriptions;
CREATE POLICY "Users can insert their own subscription"
    ON public.user_subscriptions FOR INSERT
    WITH CHECK (
        (auth.uid() = user_id) OR 
        public.check_is_super_admin(auth.uid())
    );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
AS $$
BEGIN
    -- 1. Create Profile Row for user
    INSERT INTO public.profiles (id, user_name, business_name, default_language)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'full_name', 'مستخدم جديد'),
        COALESCE(new.raw_user_meta_data->>'business_name', 'مستودع جديد'),
        'ar'
    )
    ON CONFLICT (id) DO NOTHING;

    -- 2. Create Vault for user
    INSERT INTO public.vaults (user_id, current_balance, balance_jod, balance_ils, balance_usd)
    VALUES (new.id, 0.0, 0.0, 0.0, 0.0)
    ON CONFLICT (user_id) DO NOTHING;

    -- 3. Create initial Subscription Trial record (25 Days)
    INSERT INTO public.user_subscriptions (user_id, trial_start_date, subscription_status, expiry_date)
    VALUES (
        new.id,
        TIMEZONE('utc'::text, NOW()),
        'trial',
        TIMEZONE('utc'::text, NOW()) + INTERVAL '25 days'
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Hook Trigger onto auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ---------------------------------------------------------
-- 15. ADMINISTRATIVE HELPERS (دوال لتمكين المشرفين من إدارة النظام بأمان)
-- ---------------------------------------------------------
-- دالة مفعلة بصلاحيات SECURITY DEFINER لاسترجاع كافة الحسابات المسجلة من جدول auth.users
CREATE OR REPLACE FUNCTION public.get_auth_users()
RETURNS TABLE (
    id UUID,
    email TEXT,
    raw_user_meta_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE
)
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- التحقق من صلاحية المشرف الخارق
    IF auth.jwt() ->> 'email' = 'venusalhab@gmail.com' OR public.check_is_super_admin(auth.uid()) THEN
        RETURN QUERY 
        SELECT u.id, u.email::text, u.raw_user_meta_data, u.created_at
        FROM auth.users u;
    ELSE
        RAISE EXCEPTION 'Not authorized';
    END IF;
END;
$$ LANGUAGE plpgsql;

