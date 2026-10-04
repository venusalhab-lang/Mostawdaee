-- Mostawdaee production setup. Run once in the Supabase SQL editor; safe to run again.
-- Order: this file, then supabase_cheques.sql and supabase_inventory_audit.sql. Never run supabase/archive/*.
-- 1. Brings profiles and user_subscriptions up to the columns the app and server use.
-- 2. Replaces their row-level security with owner-only policies.
-- 3. Stops browsers from granting themselves premium, admin, or a longer trial.
-- 4. Creates play_purchases (server-only) and the merchant_documents sync store.
-- 5. Enforces the subscription in the database: only merchant_commit writes, and only with access.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_role TEXT DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS default_language TEXT DEFAULT 'ar';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW());

-- Added without defaults first so existing merchants keep their real trial start, not today's date.
ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ;
ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ;
ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

DO $$
DECLARE
    has_created_at BOOLEAN;
    has_status BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'user_subscriptions' AND column_name = 'created_at')
      INTO has_created_at;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'user_subscriptions' AND column_name = 'status')
      INTO has_status;

    IF has_created_at THEN
        EXECUTE 'UPDATE public.user_subscriptions SET trial_start_date = created_at WHERE trial_start_date IS NULL';
    END IF;
    UPDATE public.user_subscriptions s
       SET trial_start_date = COALESCE(u.created_at, TIMEZONE('utc', NOW()))
      FROM auth.users u
     WHERE s.trial_start_date IS NULL AND u.id = s.user_id;
    UPDATE public.user_subscriptions SET trial_start_date = TIMEZONE('utc', NOW()) WHERE trial_start_date IS NULL;

    IF has_status THEN
        EXECUTE 'ALTER TABLE public.user_subscriptions ALTER COLUMN status DROP NOT NULL';
        EXECUTE $q$UPDATE public.user_subscriptions
                   SET subscription_status = CASE WHEN status::text IN ('trial', 'active', 'expired') THEN status::text ELSE 'trial' END
                   WHERE subscription_status IS NULL$q$;
    END IF;
    UPDATE public.user_subscriptions SET subscription_status = 'trial' WHERE subscription_status IS NULL;
    UPDATE public.user_subscriptions SET updated_at = TIMEZONE('utc', NOW()) WHERE updated_at IS NULL;
END $$;

ALTER TABLE public.user_subscriptions ALTER COLUMN trial_start_date SET DEFAULT TIMEZONE('utc', NOW());
ALTER TABLE public.user_subscriptions ALTER COLUMN subscription_status SET DEFAULT 'trial';
ALTER TABLE public.user_subscriptions ALTER COLUMN subscription_status SET NOT NULL;
ALTER TABLE public.user_subscriptions ALTER COLUMN updated_at SET DEFAULT TIMEZONE('utc', NOW());

ALTER TABLE public.user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_subscription_status_check;
ALTER TABLE public.user_subscriptions ADD CONSTRAINT user_subscriptions_subscription_status_check
    CHECK (subscription_status IN ('trial', 'active', 'expired'));

-- One subscription row per account (the server upserts on user_id).
-- If duplicates exist, keep a paid row first, otherwise the oldest trial.
DELETE FROM public.user_subscriptions a
 USING (
    SELECT ctid AS row_ctid,
           ROW_NUMBER() OVER (
               PARTITION BY user_id
               ORDER BY (subscription_status = 'active') DESC, trial_start_date ASC
           ) AS rn
      FROM public.user_subscriptions
 ) d
 WHERE a.ctid = d.row_ctid AND d.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_user_id_key ON public.user_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- 2. Owner-only row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname, tablename FROM pg_policies
              WHERE schemaname = 'public' AND tablename IN ('profiles', 'user_subscriptions')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
    END LOOP;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY subscriptions_select_own ON public.user_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY subscriptions_insert_own ON public.user_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY subscriptions_update_own ON public.user_subscriptions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Server-owned fields
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_subscription_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(auth.role(), '') = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.subscription_status := 'trial';
        NEW.trial_start_date := TIMEZONE('utc', NOW());
        NEW.expiry_date := TIMEZONE('utc', NOW()) + INTERVAL '25 days';
        RETURN NEW;
    END IF;

    NEW.user_id := OLD.user_id;
    NEW.trial_start_date := OLD.trial_start_date;
    NEW.expiry_date := OLD.expiry_date;
    NEW.subscription_status := OLD.subscription_status;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_subscription_writes ON public.user_subscriptions;
CREATE TRIGGER guard_subscription_writes
    BEFORE INSERT OR UPDATE ON public.user_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_writes();

CREATE OR REPLACE FUNCTION public.guard_profile_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(auth.role(), '') = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.role := 'user';
        NEW.user_role := 'user';
        NEW.is_premium := FALSE;
        NEW.subscription_status := 'trial';
        RETURN NEW;
    END IF;

    NEW.id := OLD.id;
    NEW.role := OLD.role;
    NEW.user_role := OLD.user_role;
    NEW.is_premium := OLD.is_premium;
    NEW.subscription_status := OLD.subscription_status;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_writes ON public.profiles;
CREATE TRIGGER guard_profile_writes
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_writes();

-- profiles.role used to be writable by its owner, which made this check self-grantable.
-- Owner tools run on the server with the service role, so no browser session is a database admin.
CREATE OR REPLACE FUNCTION public.check_is_super_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT FALSE;
$$;

DROP FUNCTION IF EXISTS public.get_auth_users();

-- ---------------------------------------------------------------------------
-- 4a. Google Play purchases: one token, one account. Service role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.play_purchases (
    purchase_token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.play_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.play_purchases FROM anon, authenticated;
ALTER TABLE public.play_purchases ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE public.play_purchases ADD COLUMN IF NOT EXISTS expiry_time TIMESTAMPTZ;
ALTER TABLE public.play_purchases ADD COLUMN IF NOT EXISTS linked_purchase_token TEXT;
ALTER TABLE public.play_purchases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS play_purchases_user_id_idx ON public.play_purchases (user_id);

-- ---------------------------------------------------------------------------
-- 4b. Access check on the database clock (same rule as src/lib/subscriptionAccess.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_subscriptions s
         WHERE s.user_id = auth.uid()
           AND (
                (s.subscription_status = 'active' AND s.expiry_date > NOW())
             OR (s.subscription_status = 'trial'
                 AND s.trial_start_date IS NOT NULL
                 AND s.trial_start_date + INTERVAL '25 days' > NOW())
           )
    ) OR EXISTS (
        SELECT 1 FROM auth.users u
         WHERE u.id = auth.uid()
           AND lower(u.email) = 'venusalhab@gmail.com'
           AND u.email_confirmed_at IS NOT NULL
    );
$$;
REVOKE ALL ON FUNCTION public.has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_access() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4c. Merchant sync store
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_documents (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    collection TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    PRIMARY KEY (user_id, collection, doc_id),
    CONSTRAINT merchant_documents_collection_check CHECK (collection IN (
        'settings', 'inventory', 'invoices', 'employees', 'payroll', 'customers',
        'customer_transactions', 'stock_movements', 'vault_records', 'warehouses', 'audit_logs',
        'invoice_numbers'
    ))
);

-- CREATE TABLE IF NOT EXISTS leaves an older constraint in place; replace it so new collections are accepted.
ALTER TABLE public.merchant_documents DROP CONSTRAINT IF EXISTS merchant_documents_collection_check;
ALTER TABLE public.merchant_documents ADD CONSTRAINT merchant_documents_collection_check CHECK (collection IN (
    'settings', 'inventory', 'invoices', 'employees', 'payroll', 'customers',
    'customer_transactions', 'stock_movements', 'vault_records', 'warehouses', 'audit_logs',
    'invoice_numbers'
));

ALTER TABLE public.merchant_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_documents REPLICA IDENTITY FULL;
REVOKE ALL ON public.merchant_documents FROM anon, authenticated;
-- Reading stays open to the owner (an expired merchant can still see and export the books).
-- Every write goes through merchant_commit, which checks the subscription on the server clock.
GRANT SELECT ON public.merchant_documents TO authenticated;

DROP POLICY IF EXISTS merchant_documents_select ON public.merchant_documents;
CREATE POLICY merchant_documents_select ON public.merchant_documents
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS merchant_documents_insert ON public.merchant_documents;
DROP POLICY IF EXISTS merchant_documents_update ON public.merchant_documents;
DROP POLICY IF EXISTS merchant_documents_delete ON public.merchant_documents;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_documents;
EXCEPTION
    WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

-- Applies a batch atomically. Fails with 'conflict' if any document changed since the caller read it,
-- so a sale cannot oversell stock or overdraw the vault when two devices write at once.
-- SECURITY DEFINER because authenticated users have no direct write grant; every row is scoped to auth.uid().
CREATE OR REPLACE FUNCTION public.merchant_commit(p_expected JSONB, p_ops JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid UUID := auth.uid();
    item JSONB;
    col TEXT;
    did TEXT;
    current_at TIMESTAMPTZ;
    op TEXT;
    payload JSONB;
    existing JSONB;
    stamp TIMESTAMPTZ;
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    IF NOT public.has_access() THEN
        RAISE EXCEPTION 'subscription required';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(uid::text)::bigint);
    stamp := clock_timestamp();

    FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_expected, '[]'::jsonb))
    LOOP
        col := item->>'collection';
        did := item->>'id';
        current_at := NULL;
        SELECT updated_at INTO current_at
          FROM public.merchant_documents
         WHERE user_id = uid AND collection = col AND doc_id = did;

        IF item->>'updated_at' IS NULL OR item->>'updated_at' = '' THEN
            IF current_at IS NOT NULL THEN
                RAISE EXCEPTION 'conflict';
            END IF;
        ELSIF current_at IS DISTINCT FROM (item->>'updated_at')::timestamptz THEN
            RAISE EXCEPTION 'conflict';
        END IF;
    END LOOP;

    FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_ops, '[]'::jsonb))
    LOOP
        op := item->>'op';
        col := item->>'collection';
        did := item->>'id';
        IF col IS NULL OR did IS NULL OR did = '' THEN
            RAISE EXCEPTION 'invalid document path';
        END IF;
        -- The activity log, stock movements and claimed invoice numbers are append-only: added, never edited or removed.
        IF col IN ('audit_logs', 'stock_movements', 'invoice_numbers') AND (
            op = 'delete'
            OR EXISTS (SELECT 1 FROM public.merchant_documents
                        WHERE user_id = uid AND collection = col AND doc_id = did)
        ) THEN
            RAISE EXCEPTION 'history is append-only';
        END IF;
        IF op = 'delete' THEN
            DELETE FROM public.merchant_documents
             WHERE user_id = uid AND collection = col AND doc_id = did;
        ELSIF op = 'set' THEN
            payload := item->'data';
            IF COALESCE((item->>'merge')::boolean, FALSE) THEN
                existing := NULL;
                SELECT data INTO existing
                  FROM public.merchant_documents
                 WHERE user_id = uid AND collection = col AND doc_id = did;
                payload := COALESCE(existing, '{}'::jsonb) || COALESCE(payload, '{}'::jsonb);
            END IF;
            INSERT INTO public.merchant_documents (user_id, collection, doc_id, data, updated_at)
            VALUES (uid, col, did, COALESCE(payload, '{}'::jsonb), stamp)
            ON CONFLICT (user_id, collection, doc_id)
            DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;
        ELSE
            RAISE EXCEPTION 'unknown op';
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_commit(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_commit(JSONB, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
