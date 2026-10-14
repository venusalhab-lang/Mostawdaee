-- Mostawdaee production setup. Run once in the Supabase SQL editor; safe to run again.
-- Order: this file, then supabase_cheques.sql and supabase_inventory_audit.sql. Never run supabase/archive/*.
-- 1. Brings profiles and user_subscriptions up to the columns the app and server use.
-- 2. Replaces their row-level security with owner-only policies.
-- 3. Stops browsers from granting themselves premium, admin, or a longer trial.
-- 4. Creates play_purchases (server-only) and the merchant_documents sync store.
-- 5. Enforces the subscription in the database: only merchant_commit writes, and only with access.
-- 6. Teams: an owner invites staff by email as manager or cashier. Members work in the owner's books
--    under the owner's subscription; merchant_commit and row-level security enforce what each role may do.
-- 7. Platform staff (the founder's operations and support team), an append-only audit log of console
--    actions, and support tickets between merchants and that team. A staff role stays pending until the
--    founder confirms the signed-in account. Support graces stay visible until the founder acknowledges them.
-- 8. Account deletion support: the founder cannot be deleted, staff roles are removed, and a deleted
--    email does not get a second free trial.

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
        -- An email that already used its trial on a deleted account continues that trial (section 8).
        NEW.trial_start_date := COALESCE(public.prior_trial_start(NEW.user_id), NOW());
        NEW.expiry_date := NEW.trial_start_date + INTERVAL '25 days';
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
-- 4b. Teams: staff work inside the owner's store with a role (manager or cashier).
-- A member belongs to one store at a time; everyone else is the owner of their own store.
-- No direct table access: every read and change goes through the team_* functions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_members (
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%._%'),
    role TEXT NOT NULL CHECK (role IN ('manager', 'cashier')),
    member_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active')),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    joined_at TIMESTAMPTZ,
    PRIMARY KEY (owner_id, email),
    CONSTRAINT workspace_members_active_has_member CHECK (status = 'invited' OR member_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_one_store
    ON public.workspace_members (member_id) WHERE status = 'active';
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_members FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.workspace_owner()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT m.owner_id FROM public.workspace_members m
          WHERE m.member_id = auth.uid() AND m.status = 'active'),
        auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.workspace_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT m.role FROM public.workspace_members m
          WHERE m.member_id = auth.uid() AND m.status = 'active'),
        'owner'
    );
$$;

-- Only a confirmed address can claim an invitation sent to it.
CREATE OR REPLACE FUNCTION public.confirmed_email()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT lower(btrim(u.email)) FROM auth.users u
     WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL;
$$;

-- Owners and managers run the back office (cheques, stocktakes); cashiers only sell.
CREATE OR REPLACE FUNCTION public.workspace_can_manage()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND public.workspace_role() IN ('owner', 'manager');
$$;

REVOKE ALL ON FUNCTION public.workspace_owner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workspace_can_manage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_can_manage() TO authenticated;
REVOKE ALL ON FUNCTION public.workspace_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirmed_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmed_email() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4c. Access check on the database clock (same rule as src/lib/subscriptionAccess.ts).
-- Staff use the owner's subscription.
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
         WHERE s.user_id = public.workspace_owner()
           AND (
                (s.subscription_status = 'active' AND s.expiry_date > NOW())
             OR (s.subscription_status = 'trial'
                 AND s.trial_start_date IS NOT NULL
                 AND s.trial_start_date + INTERVAL '25 days' > NOW())
           )
    ) OR EXISTS (
        SELECT 1 FROM auth.users u
         WHERE u.id = public.workspace_owner()
           AND lower(u.email) = 'venusalhab@gmail.com'
           AND u.email_confirmed_at IS NOT NULL
    );
$$;
REVOKE ALL ON FUNCTION public.has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_access() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4d. Merchant sync store
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
        'invoice_numbers', 'suppliers', 'supplier_transactions', 'shifts', 'orders'
    ))
);

-- CREATE TABLE IF NOT EXISTS leaves an older constraint in place; replace it so new collections are accepted.
ALTER TABLE public.merchant_documents DROP CONSTRAINT IF EXISTS merchant_documents_collection_check;
ALTER TABLE public.merchant_documents ADD CONSTRAINT merchant_documents_collection_check CHECK (collection IN (
    'settings', 'inventory', 'invoices', 'employees', 'payroll', 'customers',
    'customer_transactions', 'stock_movements', 'vault_records', 'warehouses', 'audit_logs',
    'invoice_numbers', 'suppliers', 'supplier_transactions', 'shifts', 'orders'
));

ALTER TABLE public.merchant_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_documents REPLICA IDENTITY FULL;
-- Catch-up sync asks only for rows changed since the last pull; keep that a range scan, not a full collection read.
CREATE INDEX IF NOT EXISTS merchant_documents_updated_idx ON public.merchant_documents (user_id, collection, updated_at);
REVOKE ALL ON public.merchant_documents FROM anon, authenticated;
-- Reading stays open to the store (an expired merchant can still see and export the books).
-- Salaries are owner-only; the vault history and the activity log are hidden from cashiers.
-- Every write goes through merchant_commit, which checks the subscription on the server clock.
GRANT SELECT ON public.merchant_documents TO authenticated;

DROP POLICY IF EXISTS merchant_documents_select ON public.merchant_documents;
CREATE POLICY merchant_documents_select ON public.merchant_documents
    FOR SELECT USING (
        user_id = (SELECT public.workspace_owner())
        AND ((SELECT public.workspace_role()) = 'owner' OR collection NOT IN ('employees', 'payroll'))
        AND ((SELECT public.workspace_role()) <> 'cashier' OR collection NOT IN ('vault_records', 'audit_logs'))
        -- A paid salary also leaves a vault movement and an activity entry naming the employee and the amount.
        AND ((SELECT public.workspace_role()) = 'owner' OR NOT (
            (collection = 'vault_records' AND (
                COALESCE(data->>'source', '') = 'payroll'
                OR (COALESCE(data->>'source', '') = 'reversal' AND COALESCE(data->>'category', '') = 'salary')))
            OR (collection = 'audit_logs' AND COALESCE(data->>'category', '') IN ('payroll', 'employee'))
        ))
    );
DROP POLICY IF EXISTS merchant_documents_insert ON public.merchant_documents;
DROP POLICY IF EXISTS merchant_documents_update ON public.merchant_documents;
DROP POLICY IF EXISTS merchant_documents_delete ON public.merchant_documents;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_documents;
EXCEPTION
    WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

-- A JSON number, or 0 when the key is missing or not a number.
CREATE OR REPLACE FUNCTION public.jsonb_num(j JSONB, k TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN jsonb_typeof(j->k) = 'number' THEN (j->>k)::numeric ELSE 0 END;
$$;

-- What a role may write. Owners: everything. Managers: everything except salaries and the store profile.
-- Cashiers: only what a sale writes - new sale records, lower stock, higher vault balances, higher customer debt.
CREATE OR REPLACE FUNCTION public.assert_role_can_write(
    p_role TEXT, p_op TEXT, p_col TEXT, p_id TEXT, p_old JSONB, p_new JSONB
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    k TEXT;
BEGIN
    IF p_role = 'owner' THEN
        RETURN;
    END IF;
    IF p_role NOT IN ('manager', 'cashier') THEN
        RAISE EXCEPTION 'role not allowed';
    END IF;
    IF p_col IN ('employees', 'payroll') OR (p_col = 'settings' AND p_id <> 'vault') THEN
        RAISE EXCEPTION 'role not allowed';
    END IF;
    IF p_role = 'manager' THEN
        RETURN;
    END IF;

    IF p_op <> 'set' THEN
        RAISE EXCEPTION 'role not allowed';
    END IF;

    IF p_col IN ('invoices', 'vault_records', 'customer_transactions', 'stock_movements', 'audit_logs', 'invoice_numbers') THEN
        IF p_old IS NOT NULL THEN
            RAISE EXCEPTION 'role not allowed';
        END IF;
        IF (p_col = 'invoices' AND p_new->>'type' IS DISTINCT FROM 'sale')
           OR (p_col = 'vault_records' AND p_new->>'type' IS DISTINCT FROM 'income')
           OR (p_col = 'customer_transactions' AND p_new->>'type' IS DISTINCT FROM 'invoice') THEN
            RAISE EXCEPTION 'role not allowed';
        END IF;
        RETURN;
    END IF;

    -- A cashier opens a shift and later closes it; the opening float and time cannot change afterwards.
    IF p_col = 'shifts' THEN
        IF p_old IS NULL THEN
            IF p_new->>'status' IS DISTINCT FROM 'open' THEN
                RAISE EXCEPTION 'role not allowed';
            END IF;
            RETURN;
        END IF;
        IF p_new->>'status' IS DISTINCT FROM 'closed'
           OR (p_new - 'status' - 'closedAt' - 'counted' - 'summary' - 'closingNotes'
                     - 'actorId' - 'actorEmail' - 'closedById' - 'closedByEmail')
              IS DISTINCT FROM
              (p_old - 'status' - 'closedAt' - 'counted' - 'summary' - 'closingNotes'
                     - 'actorId' - 'actorEmail' - 'closedById' - 'closedByEmail') THEN
            RAISE EXCEPTION 'role not allowed';
        END IF;
        RETURN;
    END IF;

    IF p_col = 'inventory' THEN
        IF p_old IS NULL
           OR (p_new - 'quantity' - 'status') IS DISTINCT FROM (p_old - 'quantity' - 'status')
           OR public.jsonb_num(p_new, 'quantity') > public.jsonb_num(p_old, 'quantity') THEN
            RAISE EXCEPTION 'role not allowed';
        END IF;
        RETURN;
    END IF;

    IF p_col = 'customers' THEN
        IF p_old IS NULL
           OR (p_new - 'totalDebt') IS DISTINCT FROM (p_old - 'totalDebt')
           OR public.jsonb_num(p_new, 'totalDebt') < public.jsonb_num(p_old, 'totalDebt') THEN
            RAISE EXCEPTION 'role not allowed';
        END IF;
        RETURN;
    END IF;

    IF p_col = 'settings' THEN
        FOR k IN
            SELECT key FROM jsonb_object_keys(COALESCE(p_new, '{}'::jsonb)) AS key
            UNION
            SELECT key FROM jsonb_object_keys(COALESCE(p_old, '{}'::jsonb)) AS key
        LOOP
            IF k = 'lastUpdated' THEN
                CONTINUE;
            ELSIF k = 'currentBalance' OR k LIKE 'balance%' THEN
                IF public.jsonb_num(p_new, k) < public.jsonb_num(p_old, k) THEN
                    RAISE EXCEPTION 'role not allowed';
                END IF;
            ELSIF (p_new->k) IS DISTINCT FROM (p_old->k) THEN
                RAISE EXCEPTION 'role not allowed';
            END IF;
        END LOOP;
        RETURN;
    END IF;

    RAISE EXCEPTION 'role not allowed';
END;
$$;
REVOKE ALL ON FUNCTION public.assert_role_can_write(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- Applies a batch atomically. Fails with 'conflict' if any document changed since the caller read it,
-- so a sale cannot oversell stock or overdraw the vault when two devices write at once.
-- SECURITY DEFINER because authenticated users have no direct write grant; every row is scoped to the
-- caller's store (their own, or the owner's for staff) and checked against the caller's role.
CREATE OR REPLACE FUNCTION public.merchant_commit(p_expected JSONB, p_ops JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor UUID := auth.uid();
    uid UUID;
    member_role TEXT;
    item JSONB;
    col TEXT;
    did TEXT;
    current_at TIMESTAMPTZ;
    op TEXT;
    payload JSONB;
    existing JSONB;
    stamp TIMESTAMPTZ;
    sensitive BOOLEAN := FALSE;
    reason TEXT := '';
    bal_key TEXT;
    audit_id TEXT;
    actor_email TEXT;
    -- A cashier may lower stock or raise a debt only as far as the sale invoices in the same batch account for.
    cut_qty JSONB := '{}'::jsonb;
    sold_qty JSONB := '{}'::jsonb;
    debt_up JSONB := '{}'::jsonb;
    sold_debt JSONB := '{}'::jsonb;
    line JSONB;
    ref_id TEXT;
    delta NUMERIC;
    pack NUMERIC;
BEGIN
    IF actor IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    uid := public.workspace_owner();
    member_role := public.workspace_role();
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
        IF op NOT IN ('set', 'delete') THEN
            RAISE EXCEPTION 'unknown op';
        END IF;
        existing := NULL;
        SELECT data INTO existing
          FROM public.merchant_documents
         WHERE user_id = uid AND collection = col AND doc_id = did;
        -- The activity log, stock movements and claimed invoice numbers are append-only: added, never edited or removed.
        IF col IN ('audit_logs', 'stock_movements', 'invoice_numbers') AND (op = 'delete' OR existing IS NOT NULL) THEN
            RAISE EXCEPTION 'history is append-only';
        END IF;
        -- A closed shift is a signed-off cash count: nobody edits or deletes it.
        IF col = 'shifts' AND existing IS NOT NULL AND existing->>'status' = 'closed' THEN
            RAISE EXCEPTION 'shift is closed';
        END IF;
        IF col = 'shifts' AND member_role = 'cashier' AND existing IS NOT NULL
           AND existing->>'actorId' IS DISTINCT FROM actor::text THEN
            RAISE EXCEPTION 'role not allowed';
        END IF;

        IF op = 'delete' THEN
            PERFORM public.assert_role_can_write(member_role, op, col, did, existing, NULL);
            DELETE FROM public.merchant_documents
             WHERE user_id = uid AND collection = col AND doc_id = did;
        ELSE
            payload := COALESCE(item->'data', '{}'::jsonb);
            IF jsonb_typeof(payload) <> 'object' THEN
                RAISE EXCEPTION 'invalid document data';
            END IF;
            -- A backup restore replaces the whole vault. Refuse it unless the caller read the live row
            -- and the backup is at least as new as that row, so a newer sale cannot be wiped.
            IF col = 'settings' AND did = 'vault' AND existing IS NOT NULL
               AND NOT COALESCE((item->>'merge')::boolean, FALSE) THEN
                IF NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements(COALESCE(p_expected, '[]'::jsonb)) e
                     WHERE e->>'collection' = 'settings' AND e->>'id' = 'vault'
                       AND COALESCE(e->>'updated_at', '') <> ''
                ) OR jsonb_typeof(payload->'lastUpdated') IS DISTINCT FROM 'number'
                  OR public.jsonb_num(existing, 'lastUpdated') > public.jsonb_num(payload, 'lastUpdated') THEN
                    RAISE EXCEPTION 'vault is newer';
                END IF;
            END IF;
            IF COALESCE((item->>'merge')::boolean, FALSE) THEN
                payload := COALESCE(existing, '{}'::jsonb) || payload;
            END IF;
            PERFORM public.assert_role_can_write(member_role, op, col, did, existing, payload);
            IF member_role = 'cashier' THEN
                IF col = 'inventory' THEN
                    delta := public.jsonb_num(existing, 'quantity') - public.jsonb_num(payload, 'quantity');
                    IF delta > 0 THEN
                        cut_qty := cut_qty || jsonb_build_object(did, public.jsonb_num(cut_qty, did) + delta);
                    END IF;
                ELSIF col = 'customers' THEN
                    delta := public.jsonb_num(payload, 'totalDebt') - public.jsonb_num(existing, 'totalDebt');
                    IF delta > 0 THEN
                        debt_up := debt_up || jsonb_build_object(did, public.jsonb_num(debt_up, did) + delta);
                    END IF;
                ELSIF col = 'invoices' AND existing IS NULL AND payload->>'type' = 'sale' THEN
                    IF jsonb_typeof(payload->'items') = 'array' THEN
                        FOR line IN SELECT * FROM jsonb_array_elements(payload->'items')
                        LOOP
                            ref_id := line->>'productId';
                            IF COALESCE(ref_id, '') <> '' THEN
                                -- A line sold by the pack moves quantity x packSize units; the pack size must be
                                -- the one stored on the product, so a device cannot inflate it.
                                pack := 1;
                                IF line ? 'packSize' AND jsonb_typeof(line->'packSize') <> 'null' THEN
                                    pack := public.jsonb_num(line, 'packSize');
                                    IF pack <> 1 AND pack IS DISTINCT FROM (
                                        SELECT public.jsonb_num(d.data, 'packSize')
                                          FROM public.merchant_documents d
                                         WHERE d.user_id = uid AND d.collection = 'inventory' AND d.doc_id = ref_id
                                    ) THEN
                                        RAISE EXCEPTION 'role not allowed';
                                    END IF;
                                END IF;
                                sold_qty := sold_qty || jsonb_build_object(ref_id,
                                    public.jsonb_num(sold_qty, ref_id) + GREATEST(public.jsonb_num(line, 'quantity'), 0) * pack);
                            END IF;
                        END LOOP;
                    END IF;
                    ref_id := payload->>'customerId';
                    IF payload->>'paymentMethod' = 'credit' AND COALESCE(ref_id, '') <> '' THEN
                        delta := CASE WHEN jsonb_typeof(payload->'debtAmount') = 'number'
                                      THEN public.jsonb_num(payload, 'debtAmount')
                                      ELSE public.jsonb_num(payload, 'totalAmount') END;
                        sold_debt := sold_debt || jsonb_build_object(ref_id, public.jsonb_num(sold_debt, ref_id) + GREATEST(delta, 0));
                    END IF;
                END IF;
            END IF;
            -- Who created a record is set here, never trusted from the device, and an edit keeps it.
            IF col IN ('invoices', 'vault_records', 'customer_transactions', 'supplier_transactions', 'stock_movements', 'audit_logs', 'shifts', 'orders') THEN
                IF actor_email IS NULL THEN
                    SELECT lower(u.email) INTO actor_email FROM auth.users u WHERE u.id = actor;
                END IF;
                IF existing IS NULL THEN
                    payload := payload || jsonb_build_object('actorId', actor::text, 'actorEmail', COALESCE(actor_email, ''));
                ELSE
                    payload := (payload - 'actorId' - 'actorEmail')
                        || jsonb_strip_nulls(jsonb_build_object('actorId', existing->'actorId', 'actorEmail', existing->'actorEmail'));
                END IF;
            END IF;
            IF col = 'shifts' THEN
                payload := payload - 'closedById' - 'closedByEmail';
                IF payload->>'status' = 'closed' THEN
                    payload := payload || jsonb_build_object('closedById', actor::text, 'closedByEmail', COALESCE(actor_email, ''));
                END IF;
            END IF;
            INSERT INTO public.merchant_documents (user_id, collection, doc_id, data, updated_at)
            VALUES (uid, col, did, payload, stamp)
            ON CONFLICT (user_id, collection, doc_id)
            DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;
        END IF;

        -- A manager's withdrawal or deletion is recorded here, in the same transaction, so skipping the
        -- screen's activity button cannot hide it. Owners are not auto-logged.
        IF member_role = 'manager' THEN
            IF op = 'delete' THEN
                sensitive := TRUE;
                reason := left(reason || 'delete ' || col || '/' || did || '; ', 500);
            ELSIF col = 'vault_records' AND existing IS NULL AND lower(COALESCE(payload->>'type', '')) = 'expense' THEN
                sensitive := TRUE;
                reason := left(reason || 'expense ' || did || '; ', 500);
            ELSIF col = 'settings' AND did = 'vault' AND op = 'set' THEN
                FOREACH bal_key IN ARRAY ARRAY[
                    'currentBalance', 'balanceJOD', 'balanceILS', 'balanceUSD', 'balanceIQD',
                    'balanceSAR', 'balanceAED', 'balanceLYD', 'balanceEGP'
                ]
                LOOP
                    IF public.jsonb_num(payload, bal_key) < public.jsonb_num(COALESCE(existing, '{}'::jsonb), bal_key) THEN
                        sensitive := TRUE;
                        reason := left(reason || 'vault down ' || bal_key || '; ', 500);
                    END IF;
                END LOOP;
            END IF;
        END IF;
    END LOOP;

    IF member_role = 'cashier' THEN
        FOR ref_id IN SELECT key FROM jsonb_object_keys(cut_qty) AS key
        LOOP
            IF public.jsonb_num(cut_qty, ref_id) > public.jsonb_num(sold_qty, ref_id) + 0.0005 THEN
                RAISE EXCEPTION 'role not allowed';
            END IF;
        END LOOP;
        FOR ref_id IN SELECT key FROM jsonb_object_keys(debt_up) AS key
        LOOP
            IF public.jsonb_num(debt_up, ref_id) > public.jsonb_num(sold_debt, ref_id) + 0.01 THEN
                RAISE EXCEPTION 'role not allowed';
            END IF;
        END LOOP;
    END IF;

    IF sensitive THEN
        SELECT lower(u.email) INTO actor_email FROM auth.users u WHERE u.id = actor;
        audit_id := gen_random_uuid()::text;
        INSERT INTO public.merchant_documents (user_id, collection, doc_id, data, updated_at)
        VALUES (uid, 'audit_logs', audit_id, jsonb_build_object(
            'id', audit_id,
            'action', 'manager_sensitive',
            'details', btrim(reason),
            'timestamp', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
            'category', 'security',
            'userName', 'system',
            'email', COALESCE(actor_email, ''),
            'actorId', actor::text,
            'system', TRUE
        ), stamp);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_commit(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_commit(JSONB, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4e. Team functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_store_name(p_owner UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT NULLIF(btrim(d.data->>'businessName'), '')
      FROM public.merchant_documents d
     WHERE d.user_id = p_owner AND d.collection = 'settings' AND d.doc_id = 'profile';
$$;
REVOKE ALL ON FUNCTION public.team_store_name(UUID) FROM PUBLIC, anon, authenticated;

-- Everything the app needs at sign-in: which store, which role, the store's subscription and open invitations.
CREATE OR REPLACE FUNCTION public.team_context()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    me UUID := auth.uid();
    owner UUID;
    sub RECORD;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    owner := public.workspace_owner();
    SELECT s.subscription_status, s.expiry_date, s.trial_start_date INTO sub
      FROM public.user_subscriptions s WHERE s.user_id = owner;
    RETURN jsonb_build_object(
        'owner_id', owner,
        'role', public.workspace_role(),
        'store_name', public.team_store_name(owner),
        'owner_email', (SELECT u.email FROM auth.users u WHERE u.id = owner),
        'has_access', public.has_access(),
        'subscription', CASE WHEN sub IS NULL THEN NULL ELSE jsonb_build_object(
            'subscription_status', sub.subscription_status,
            'expiry_date', sub.expiry_date,
            'trial_start_date', sub.trial_start_date) END,
        'invites', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'owner_id', m.owner_id,
                'role', m.role,
                'store_name', public.team_store_name(m.owner_id),
                'owner_email', (SELECT u.email FROM auth.users u WHERE u.id = m.owner_id)
            ) ORDER BY m.invited_at)
              FROM public.workspace_members m
             WHERE m.status = 'invited' AND m.email = public.confirmed_email()
               AND m.owner_id <> me
        ), '[]'::jsonb)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.team_require_owner()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    IF public.workspace_role() <> 'owner' THEN
        RAISE EXCEPTION 'role not allowed';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.team_require_owner() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.team_list()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.team_require_owner();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'email', m.email, 'role', m.role, 'status', m.status,
            'invited_at', m.invited_at, 'joined_at', m.joined_at
        ) ORDER BY m.invited_at)
          FROM public.workspace_members m WHERE m.owner_id = auth.uid()
    ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.team_invite(p_email TEXT, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    addr TEXT := lower(btrim(COALESCE(p_email, '')));
BEGIN
    PERFORM public.team_require_owner();
    IF NOT public.has_access() THEN
        RAISE EXCEPTION 'subscription required';
    END IF;
    IF p_role NOT IN ('manager', 'cashier') THEN
        RAISE EXCEPTION 'invalid role';
    END IF;
    IF addr NOT LIKE '%_@_%._%' THEN
        RAISE EXCEPTION 'invalid email';
    END IF;
    IF addr = (SELECT lower(u.email) FROM auth.users u WHERE u.id = auth.uid()) THEN
        RAISE EXCEPTION 'cannot invite yourself';
    END IF;
    IF (SELECT count(*) FROM public.workspace_members WHERE owner_id = auth.uid()) >= 25
       AND NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE owner_id = auth.uid() AND email = addr) THEN
        RAISE EXCEPTION 'team is full';
    END IF;
    INSERT INTO public.workspace_members (owner_id, email, role)
    VALUES (auth.uid(), addr, p_role)
    ON CONFLICT (owner_id, email) DO UPDATE SET role = EXCLUDED.role;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_remove(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.team_require_owner();
    DELETE FROM public.workspace_members
     WHERE owner_id = auth.uid() AND email = lower(btrim(COALESCE(p_email, '')));
END;
$$;

CREATE OR REPLACE FUNCTION public.team_accept(p_owner UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    me UUID := auth.uid();
    addr TEXT := public.confirmed_email();
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    IF addr IS NULL THEN
        RAISE EXCEPTION 'email not confirmed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.workspace_members WHERE member_id = me AND status = 'active') THEN
        RAISE EXCEPTION 'already in a store';
    END IF;
    -- Their own staff would be left working in a store nobody can see.
    IF EXISTS (SELECT 1 FROM public.workspace_members WHERE owner_id = me) THEN
        RAISE EXCEPTION 'has own team';
    END IF;
    UPDATE public.workspace_members
       SET member_id = me, status = 'active', joined_at = NOW()
     WHERE owner_id = p_owner AND email = addr AND status = 'invited' AND owner_id <> me;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'invitation not found';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_decline(p_owner UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    DELETE FROM public.workspace_members
     WHERE owner_id = p_owner AND email = public.confirmed_email() AND status = 'invited';
END;
$$;

CREATE OR REPLACE FUNCTION public.team_leave()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    DELETE FROM public.workspace_members WHERE member_id = auth.uid() AND status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.team_context() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_invite(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_remove(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_accept(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_decline(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_leave() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_invite(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_remove(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_accept(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_decline(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_leave() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4f. AI assistant usage: questions and tokens per store per day, written only by the server.
--     claim_ai_request counts a question before Gemini is called, so the daily cap holds under load;
--     release_ai_request gives it back when Gemini fails without answering.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage (
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    prompt_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    thought_tokens BIGINT NOT NULL DEFAULT 0,
    cached_tokens BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_id, day)
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_ai_usage(
    p_owner UUID, p_prompt BIGINT, p_output BIGINT, p_thoughts BIGINT, p_cached BIGINT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.ai_usage AS u (owner_id, day, prompt_tokens, output_tokens, thought_tokens, cached_tokens)
    VALUES (p_owner, (NOW() AT TIME ZONE 'utc')::date,
            GREATEST(p_prompt, 0), GREATEST(p_output, 0), GREATEST(p_thoughts, 0), GREATEST(p_cached, 0))
    ON CONFLICT (owner_id, day) DO UPDATE SET
        prompt_tokens = u.prompt_tokens + EXCLUDED.prompt_tokens,
        output_tokens = u.output_tokens + EXCLUDED.output_tokens,
        thought_tokens = u.thought_tokens + EXCLUDED.thought_tokens,
        cached_tokens = u.cached_tokens + EXCLUDED.cached_tokens;
$$;

CREATE OR REPLACE FUNCTION public.claim_ai_request(p_owner UUID, p_limit INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claimed INTEGER;
BEGIN
    IF p_owner IS NULL OR COALESCE(p_limit, 0) <= 0 THEN
        RETURN FALSE;
    END IF;
    INSERT INTO public.ai_usage AS u (owner_id, day, requests)
    VALUES (p_owner, (NOW() AT TIME ZONE 'utc')::date, 1)
    ON CONFLICT (owner_id, day) DO UPDATE SET requests = u.requests + 1
        WHERE u.requests < p_limit
    RETURNING u.requests INTO claimed;
    RETURN claimed IS NOT NULL;
END;
$$;

-- Gives back a claimed question when Gemini never answered. Never goes below zero.
CREATE OR REPLACE FUNCTION public.release_ai_request(p_owner UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.ai_usage
       SET requests = requests - 1
     WHERE owner_id = p_owner
       AND day = (NOW() AT TIME ZONE 'utc')::date
       AND requests > 0;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_request(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_request(UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.release_ai_request(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_request(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.record_ai_usage(UUID, BIGINT, BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage(UUID, BIGINT, BIGINT, BIGINT, BIGINT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4g. Platform staff: the founder's own team, separate from store teams.
--     founder    - the confirmed venusalhab@gmail.com account (not stored in the table).
--     operations - changes subscriptions and answers tickets.
--     support    - sees subscribers, answers tickets, and may give a short grace of up to 7 days.
--     The console runs on the server with the service role. Every admin_* function re-checks the
--     caller's role and writes the change together with its audit entry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_staff (
    email TEXT PRIMARY KEY CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%._%'),
    role TEXT NOT NULL CHECK (role IN ('operations', 'support')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
    added_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Re-runs: people who already had access stay active. A new row waits for the founder to confirm it.
ALTER TABLE public.platform_staff ADD COLUMN IF NOT EXISTS status TEXT;
UPDATE public.platform_staff SET status = 'active' WHERE status IS NULL;
ALTER TABLE public.platform_staff ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.platform_staff ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.platform_staff DROP CONSTRAINT IF EXISTS platform_staff_status_check;
ALTER TABLE public.platform_staff ADD CONSTRAINT platform_staff_status_check CHECK (status IN ('pending', 'active'));
ALTER TABLE public.platform_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_staff FROM PUBLIC, anon, authenticated;

-- No foreign keys: entries outlive the accounts they mention.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID,
    actor_email TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id UUID,
    target_email TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit log is append-only';
END;
$$;
DROP TRIGGER IF EXISTS admin_audit_log_append_only ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_append_only
    BEFORE UPDATE OR DELETE ON public.admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_append_only();
DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_truncate
    BEFORE TRUNCATE ON public.admin_audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.admin_audit_log_append_only();

CREATE OR REPLACE FUNCTION public.platform_role_of(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        WHEN lower(btrim(u.email)) = 'venusalhab@gmail.com' THEN 'founder'
        ELSE (SELECT s.role FROM public.platform_staff s
               WHERE s.email = lower(btrim(u.email)) AND s.status = 'active')
    END
      FROM auth.users u
     WHERE u.id = p_user AND u.email_confirmed_at IS NOT NULL;
$$;

-- Lets the app show the console to staff; the server checks again on every request.
CREATE OR REPLACE FUNCTION public.platform_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.platform_role_of(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.platform_require(p_actor UUID, p_roles TEXT[])
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r TEXT := public.platform_role_of(p_actor);
BEGIN
    IF r IS NULL THEN
        RAISE EXCEPTION 'not platform staff';
    END IF;
    IF NOT (r = ANY (p_roles)) THEN
        RAISE EXCEPTION 'role not allowed';
    END IF;
    RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_audit(p_actor UUID, p_role TEXT, p_action TEXT, p_target UUID, p_details JSONB)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.admin_audit_log (actor_id, actor_email, actor_role, action, target_id, target_email, details)
    SELECT p_actor, lower(a.email), p_role, p_action, p_target,
           (SELECT lower(t.email) FROM auth.users t WHERE t.id = p_target),
           COALESCE(p_details, '{}'::jsonb)
      FROM auth.users a
     WHERE a.id = p_actor;
$$;

-- The server works out the new dates (src/lib/subscriptionAccess.ts); this applies them with the audit entry.
-- Support may only lengthen an account, never mark it paid, and never past 7 days from now.
CREATE OR REPLACE FUNCTION public.admin_apply_subscription(
    p_actor UUID, p_action TEXT, p_target UUID, p_status TEXT,
    p_trial_start TIMESTAMPTZ, p_expiry TIMESTAMPTZ, p_details JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor_role TEXT := public.platform_require(p_actor, ARRAY['founder', 'operations', 'support']);
    had_row BOOLEAN;
    b_status TEXT;
    b_trial TIMESTAMPTZ;
    b_expiry TIMESTAMPTZ;
    old_end TIMESTAMPTZ;
    new_end TIMESTAMPTZ;
BEGIN
    IF p_status NOT IN ('trial', 'active', 'expired') OR p_trial_start IS NULL OR p_expiry IS NULL THEN
        RAISE EXCEPTION 'invalid subscription';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target) THEN
        RAISE EXCEPTION 'account not found';
    END IF;
    SELECT s.subscription_status, s.trial_start_date, s.expiry_date INTO b_status, b_trial, b_expiry
      FROM public.user_subscriptions s WHERE s.user_id = p_target FOR UPDATE;
    had_row := FOUND;

    IF actor_role = 'support' THEN
        old_end := CASE
            WHEN b_status = 'active' THEN b_expiry
            WHEN b_status = 'trial' THEN b_trial + INTERVAL '25 days'
            WHEN NOT had_row THEN (SELECT u.created_at + INTERVAL '25 days' FROM auth.users u WHERE u.id = p_target)
            ELSE NULL
        END;
        new_end := CASE WHEN p_status = 'trial' THEN p_trial_start + INTERVAL '25 days' ELSE p_expiry END;
        IF p_action <> 'extend'
           OR p_status = 'expired'
           OR (p_status = 'active' AND b_status IS DISTINCT FROM 'active')
           OR new_end > NOW() + INTERVAL '7 days 1 minute'
           OR (old_end IS NOT NULL AND new_end < old_end) THEN
            RAISE EXCEPTION 'role not allowed';
        END IF;
    END IF;

    INSERT INTO public.user_subscriptions (user_id, subscription_status, trial_start_date, expiry_date, updated_at)
    VALUES (p_target, p_status, p_trial_start, p_expiry, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        subscription_status = EXCLUDED.subscription_status,
        trial_start_date = EXCLUDED.trial_start_date,
        expiry_date = EXCLUDED.expiry_date,
        updated_at = EXCLUDED.updated_at;
    UPDATE public.profiles
       SET is_premium = (p_status = 'active'), subscription_status = p_status, updated_at = NOW()
     WHERE id = p_target;

    PERFORM public.platform_audit(p_actor, actor_role, 'subscription.' || p_action, p_target,
        COALESCE(p_details, '{}'::jsonb) || jsonb_build_object(
            'before', CASE WHEN had_row THEN jsonb_build_object(
                'status', b_status, 'trial_start', b_trial, 'expiry', b_expiry) ELSE NULL END,
            'after', jsonb_build_object('status', p_status, 'trial_start', p_trial_start, 'expiry', p_expiry)));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_staff_list(p_actor UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder']);
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'email', s.email, 'role', s.role, 'status', s.status,
            'created_at', s.created_at, 'updated_at', s.updated_at,
            'has_account', EXISTS (SELECT 1 FROM auth.users u
                                    WHERE lower(btrim(u.email)) = s.email AND u.email_confirmed_at IS NOT NULL)
        ) ORDER BY s.created_at)
          FROM public.platform_staff s
    ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_staff_set(p_actor UUID, p_email TEXT, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor_role TEXT := public.platform_require(p_actor, ARRAY['founder']);
    addr TEXT := lower(btrim(COALESCE(p_email, '')));
    previous TEXT;
BEGIN
    IF p_role NOT IN ('operations', 'support') THEN
        RAISE EXCEPTION 'invalid role';
    END IF;
    IF addr NOT LIKE '%_@_%._%' THEN
        RAISE EXCEPTION 'invalid email';
    END IF;
    IF addr = 'venusalhab@gmail.com' THEN
        RAISE EXCEPTION 'cannot change the founder';
    END IF;
    IF (SELECT count(*) FROM public.platform_staff) >= 50
       AND NOT EXISTS (SELECT 1 FROM public.platform_staff WHERE email = addr) THEN
        RAISE EXCEPTION 'staff is full';
    END IF;
    SELECT s.role INTO previous FROM public.platform_staff s WHERE s.email = addr;
    INSERT INTO public.platform_staff (email, role, status, added_by)
    VALUES (addr, p_role, 'pending', p_actor)
    ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW();
    PERFORM public.platform_audit(p_actor, actor_role, 'staff.set',
        (SELECT u.id FROM auth.users u WHERE lower(btrim(u.email)) = addr LIMIT 1),
        jsonb_build_object('email', addr, 'role', p_role, 'before', previous));
END;
$$;

-- The founder confirms the role only after that email has a confirmed Mostawdaee account.
CREATE OR REPLACE FUNCTION public.admin_staff_confirm(p_actor UUID, p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor_role TEXT := public.platform_require(p_actor, ARRAY['founder']);
    addr TEXT := lower(btrim(COALESCE(p_email, '')));
    prev_role TEXT;
    prev_status TEXT;
BEGIN
    SELECT s.role, s.status INTO prev_role, prev_status FROM public.platform_staff s WHERE s.email = addr;
    IF prev_role IS NULL THEN
        RAISE EXCEPTION 'staff not found';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM auth.users u
         WHERE lower(btrim(u.email)) = addr AND u.email_confirmed_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'account not confirmed';
    END IF;
    IF prev_status = 'active' THEN
        RETURN;
    END IF;
    UPDATE public.platform_staff SET status = 'active', updated_at = NOW() WHERE email = addr;
    PERFORM public.platform_audit(p_actor, actor_role, 'staff.confirm',
        (SELECT u.id FROM auth.users u WHERE lower(btrim(u.email)) = addr AND u.email_confirmed_at IS NOT NULL LIMIT 1),
        jsonb_build_object('email', addr, 'role', prev_role));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_staff_remove(p_actor UUID, p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor_role TEXT := public.platform_require(p_actor, ARRAY['founder']);
    addr TEXT := lower(btrim(COALESCE(p_email, '')));
    previous TEXT;
BEGIN
    DELETE FROM public.platform_staff WHERE email = addr RETURNING role INTO previous;
    IF previous IS NULL THEN
        RAISE EXCEPTION 'staff not found';
    END IF;
    PERFORM public.platform_audit(p_actor, actor_role, 'staff.remove',
        (SELECT u.id FROM auth.users u WHERE lower(btrim(u.email)) = addr LIMIT 1),
        jsonb_build_object('email', addr, 'before', previous));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_audit_list(p_actor UUID, p_limit INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder']);
    RETURN COALESCE((
        SELECT jsonb_agg(row_to_json(e)::jsonb ORDER BY e.id DESC)
          FROM (SELECT l.id, l.actor_email, l.actor_role, l.action, l.target_email, l.details, l.created_at
                  FROM public.admin_audit_log l
                 ORDER BY l.id DESC
                 LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) e
    ), '[]'::jsonb);
END;
$$;

-- The audit log cannot be updated, so acknowledgement of a support grace lives in its own table.
CREATE TABLE IF NOT EXISTS public.admin_notice_acks (
    audit_id BIGINT PRIMARY KEY,
    seen_by UUID,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.admin_notice_acks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_notice_acks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_open_notices(p_actor UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder']);
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', l.id, 'actor_email', l.actor_email, 'action', l.action,
            'target_email', l.target_email, 'details', l.details, 'created_at', l.created_at
        ) ORDER BY l.id DESC)
          FROM public.admin_audit_log l
         WHERE l.actor_role = 'support' AND l.action = 'subscription.extend'
           AND NOT EXISTS (SELECT 1 FROM public.admin_notice_acks a WHERE a.audit_id = l.id)
    ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_notice_ack(p_actor UUID, p_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder']);
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log l
         WHERE l.id = p_id AND l.actor_role = 'support' AND l.action = 'subscription.extend'
    ) THEN
        RAISE EXCEPTION 'notice not found';
    END IF;
    INSERT INTO public.admin_notice_acks (audit_id, seen_by)
    VALUES (p_id, p_actor)
    ON CONFLICT (audit_id) DO NOTHING;
END;
$$;

-- Questions per store: today and over the last p_days days (UTC).
CREATE OR REPLACE FUNCTION public.admin_ai_usage(p_actor UUID, p_days INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today DATE := (NOW() AT TIME ZONE 'utc')::date;
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder', 'operations', 'support']);
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'owner_id', a.owner_id, 'today', a.today, 'period', a.period,
            'prompt_tokens', a.prompt_tokens, 'output_tokens', a.output_tokens, 'thought_tokens', a.thought_tokens))
          FROM (SELECT u.owner_id,
                       COALESCE(SUM(u.requests) FILTER (WHERE u.day = today), 0) AS today,
                       SUM(u.requests) AS period,
                       SUM(u.prompt_tokens) AS prompt_tokens,
                       SUM(u.output_tokens) AS output_tokens,
                       SUM(u.thought_tokens) AS thought_tokens
                  FROM public.ai_usage u
                 WHERE u.day > today - LEAST(GREATEST(COALESCE(p_days, 30), 1), 366)
                 GROUP BY u.owner_id) a
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_audit_log_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_role_of(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_role_of(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.platform_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_role() TO authenticated;
REVOKE ALL ON FUNCTION public.platform_require(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_audit(UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_apply_subscription(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_apply_subscription(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.admin_staff_list(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_staff_list(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.admin_staff_set(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_staff_set(UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.admin_staff_confirm(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_staff_confirm(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.admin_staff_remove(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_staff_remove(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.admin_open_notices(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_open_notices(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.admin_notice_ack(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_notice_ack(UUID, BIGINT) TO service_role;
REVOKE ALL ON FUNCTION public.admin_audit_list(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_list(UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.admin_ai_usage(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_usage(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 4h. Support tickets: any signed-in account (owner or store member) writes to the platform team.
--     Staff see the conversation and the store's name and subscription, never the store's books.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    store_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    category TEXT NOT NULL CHECK (category IN ('question', 'problem', 'billing', 'suggestion')),
    subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
    assigned_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_tickets_author_idx ON public.support_tickets (author_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON public.support_tickets (status, updated_at);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.support_messages (
    id BIGSERIAL PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    from_staff BOOLEAN NOT NULL,
    staff_email TEXT,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON public.support_messages (ticket_id, id);
CREATE INDEX IF NOT EXISTS support_messages_author_idx ON public.support_messages (author_id, created_at);
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_messages FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.support_check_body(p_body TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    b TEXT := btrim(COALESCE(p_body, ''));
BEGIN
    IF char_length(b) < 1 OR char_length(b) > 4000 THEN
        RAISE EXCEPTION 'invalid message';
    END IF;
    RETURN b;
END;
$$;

-- 30 messages a day per account across all tickets keeps the inbox usable.
CREATE OR REPLACE FUNCTION public.support_check_merchant_quota()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT count(*) FROM public.support_messages
         WHERE author_id = auth.uid() AND NOT from_staff AND created_at > NOW() - INTERVAL '1 day') >= 30 THEN
        RAISE EXCEPTION 'too many messages';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_open(p_category TEXT, p_subject TEXT, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    me UUID := auth.uid();
    subj TEXT := btrim(COALESCE(p_subject, ''));
    msg TEXT;
    ticket UUID;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    IF p_category NOT IN ('question', 'problem', 'billing', 'suggestion') THEN
        RAISE EXCEPTION 'invalid category';
    END IF;
    IF char_length(subj) < 3 OR char_length(subj) > 120 THEN
        RAISE EXCEPTION 'invalid subject';
    END IF;
    msg := public.support_check_body(p_body);
    IF (SELECT count(*) FROM public.support_tickets WHERE author_id = me AND status <> 'closed') >= 5 THEN
        RAISE EXCEPTION 'too many open tickets';
    END IF;
    PERFORM public.support_check_merchant_quota();
    INSERT INTO public.support_tickets (author_id, store_owner_id, category, subject)
    VALUES (me, public.workspace_owner(), p_category, subj)
    RETURNING id INTO ticket;
    INSERT INTO public.support_messages (ticket_id, author_id, from_staff, body) VALUES (ticket, me, FALSE, msg);
    RETURN ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_my_tickets()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'category', t.category, 'subject', t.subject, 'status', t.status,
            'created_at', t.created_at, 'updated_at', t.updated_at
        ) ORDER BY t.updated_at DESC)
          FROM (SELECT * FROM public.support_tickets
                 WHERE author_id = auth.uid() ORDER BY updated_at DESC LIMIT 50) t
    ), '[]'::jsonb);
END;
$$;

-- Merchants see that the team answered, not which staff member did.
CREATE OR REPLACE FUNCTION public.support_thread(p_ticket UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    t RECORD;
BEGIN
    SELECT * INTO t FROM public.support_tickets WHERE id = p_ticket AND author_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ticket not found';
    END IF;
    RETURN jsonb_build_object(
        'ticket', jsonb_build_object('id', t.id, 'category', t.category, 'subject', t.subject,
                                     'status', t.status, 'created_at', t.created_at, 'updated_at', t.updated_at),
        'messages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', m.id, 'from_staff', m.from_staff, 'body', m.body,
                                                'created_at', m.created_at) ORDER BY m.id)
              FROM public.support_messages m WHERE m.ticket_id = t.id
        ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.support_reply(p_ticket UUID, p_body TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    msg TEXT := public.support_check_body(p_body);
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_ticket AND author_id = auth.uid()) THEN
        RAISE EXCEPTION 'ticket not found';
    END IF;
    IF (SELECT count(*) FROM public.support_messages WHERE ticket_id = p_ticket) >= 200 THEN
        RAISE EXCEPTION 'ticket is full';
    END IF;
    PERFORM public.support_check_merchant_quota();
    INSERT INTO public.support_messages (ticket_id, author_id, from_staff, body) VALUES (p_ticket, auth.uid(), FALSE, msg);
    UPDATE public.support_tickets SET status = 'open', updated_at = NOW() WHERE id = p_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_close(p_ticket UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.support_tickets SET status = 'closed', updated_at = NOW()
     WHERE id = p_ticket AND author_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ticket not found';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_staff_list(p_actor UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder', 'operations', 'support']);
    IF p_status NOT IN ('open', 'answered', 'closed', 'all') THEN
        RAISE EXCEPTION 'invalid status';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'category', t.category, 'subject', t.subject, 'status', t.status,
            'assigned_email', t.assigned_email, 'created_at', t.created_at, 'updated_at', t.updated_at,
            'author_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = t.author_id),
            'store_name', public.team_store_name(t.store_owner_id),
            'store_owner_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = t.store_owner_id),
            'store_subscription', (SELECT s.subscription_status FROM public.user_subscriptions s WHERE s.user_id = t.store_owner_id),
            'messages', (SELECT count(*) FROM public.support_messages m WHERE m.ticket_id = t.id)
        ) ORDER BY t.ord, t.wait, t.updated_at DESC)
          FROM (SELECT x.*,
                       CASE x.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END AS ord,
                       CASE WHEN x.status = 'open' THEN x.updated_at END AS wait
                  FROM public.support_tickets x
                 WHERE p_status = 'all' OR x.status = p_status
                 ORDER BY ord, wait, updated_at DESC
                 LIMIT 300) t
    ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.support_staff_thread(p_actor UUID, p_ticket UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    t RECORD;
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder', 'operations', 'support']);
    SELECT * INTO t FROM public.support_tickets WHERE id = p_ticket;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ticket not found';
    END IF;
    RETURN jsonb_build_object(
        'ticket', jsonb_build_object(
            'id', t.id, 'category', t.category, 'subject', t.subject, 'status', t.status,
            'assigned_email', t.assigned_email, 'created_at', t.created_at, 'updated_at', t.updated_at,
            'author_id', t.author_id,
            'author_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = t.author_id),
            'store_owner_id', t.store_owner_id,
            'store_name', public.team_store_name(t.store_owner_id),
            'store_owner_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = t.store_owner_id),
            'store_subscription', (SELECT s.subscription_status FROM public.user_subscriptions s WHERE s.user_id = t.store_owner_id)),
        'messages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', m.id, 'from_staff', m.from_staff, 'staff_email', m.staff_email,
                                                'body', m.body, 'created_at', m.created_at) ORDER BY m.id)
              FROM public.support_messages m WHERE m.ticket_id = t.id
        ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.support_staff_reply(p_actor UUID, p_ticket UUID, p_body TEXT, p_close BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    staff TEXT;
    msg TEXT := public.support_check_body(p_body);
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder', 'operations', 'support']);
    SELECT lower(u.email) INTO staff FROM auth.users u WHERE u.id = p_actor;
    IF NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_ticket) THEN
        RAISE EXCEPTION 'ticket not found';
    END IF;
    INSERT INTO public.support_messages (ticket_id, author_id, from_staff, staff_email, body)
    VALUES (p_ticket, p_actor, TRUE, staff, msg);
    UPDATE public.support_tickets
       SET status = CASE WHEN COALESCE(p_close, FALSE) THEN 'closed' ELSE 'answered' END,
           assigned_email = COALESCE(assigned_email, staff),
           updated_at = NOW()
     WHERE id = p_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_staff_set_status(p_actor UUID, p_ticket UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder', 'operations', 'support']);
    IF p_status NOT IN ('open', 'answered', 'closed') THEN
        RAISE EXCEPTION 'invalid status';
    END IF;
    UPDATE public.support_tickets SET status = p_status, updated_at = NOW() WHERE id = p_ticket;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ticket not found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.support_check_body(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_check_merchant_quota() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_open(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_open(TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.support_my_tickets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_my_tickets() TO authenticated;
REVOKE ALL ON FUNCTION public.support_thread(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_thread(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.support_reply(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_reply(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.support_close(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_close(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.support_staff_list(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_staff_list(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.support_staff_thread(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_staff_thread(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.support_staff_reply(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_staff_reply(UUID, UUID, TEXT, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.support_staff_set_status(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_staff_set_status(UUID, UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Account deletion. The server deletes the auth user with the service role and every store table
--    cascades from it. account_delete_prepare runs first: it refuses the founder, removes any platform
--    staff role, and keeps only a hash of the email with the trial start, so signing up again with the
--    same email does not restart the free trial.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.used_trials (
    email_hash TEXT PRIMARY KEY,
    trial_start TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.used_trials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.used_trials FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.email_hash(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$$;

-- Read by guard_subscription_writes when an account creates its subscription row; only for itself.
CREATE OR REPLACE FUNCTION public.prior_trial_start(p_user UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.trial_start
      FROM public.used_trials t
      JOIN auth.users u ON t.email_hash = public.email_hash(u.email)
     WHERE u.id = p_user
       AND (p_user = auth.uid() OR COALESCE(auth.role(), '') = 'service_role');
$$;

CREATE OR REPLACE FUNCTION public.account_delete_prepare(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    addr TEXT;
    started TIMESTAMPTZ;
    staff_role TEXT;
BEGIN
    SELECT lower(btrim(COALESCE(u.email, ''))), COALESCE(s.trial_start_date, u.created_at, NOW())
      INTO addr, started
      FROM auth.users u
      LEFT JOIN public.user_subscriptions s ON s.user_id = u.id
     WHERE u.id = p_user;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'account not found';
    END IF;
    IF addr = 'venusalhab@gmail.com' THEN
        RAISE EXCEPTION 'cannot delete the founder';
    END IF;
    IF addr <> '' THEN
        INSERT INTO public.used_trials AS t (email_hash, trial_start)
        VALUES (public.email_hash(addr), started)
        ON CONFLICT (email_hash) DO UPDATE
            SET trial_start = LEAST(t.trial_start, EXCLUDED.trial_start), recorded_at = NOW();
        DELETE FROM public.platform_staff WHERE email = addr RETURNING role INTO staff_role;
        IF staff_role IS NOT NULL THEN
            PERFORM public.platform_audit(p_user, staff_role, 'staff.account_deleted', p_user, '{}'::jsonb);
        END IF;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.email_hash(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_hash(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.prior_trial_start(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prior_trial_start(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.account_delete_prepare(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_delete_prepare(UUID) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
