-- Cheques register. Run once in the Supabase SQL editor; safe to run again.
-- Run after supabase_production_setup.sql (needs public.has_access / workspace_*).
-- Each store sees only its own cheques; owners and managers work on them, cashiers do not. Status changes follow the same rules as src/lib/cheques.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cheques (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    cheque_number TEXT NOT NULL CHECK (length(btrim(cheque_number)) BETWEEN 1 AND 40),
    bank_name TEXT NOT NULL CHECK (length(btrim(bank_name)) BETWEEN 1 AND 120),
    amount NUMERIC(18, 3) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'ILS' CHECK (currency IN ('JOD', 'ILS', 'USD', 'IQD', 'SAR', 'AED', 'LYD', 'EGP')),
    -- issue_date / payee_or_drawer are kept for stores that first created this table with an older shape.
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('incoming', 'outgoing')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cashed', 'bounced', 'endorsed', 'returned')),
    payee_or_drawer TEXT NOT NULL DEFAULT '',
    drawer_name TEXT NOT NULL DEFAULT '',
    -- Customers live in the app's sync store (ids like CUST_2026_1234) and suppliers are names only,
    -- so the contact is a reference plus a name snapshot rather than a foreign key.
    contact_type TEXT CHECK (contact_type IN ('customer', 'supplier')),
    contact_id TEXT,
    contact_name TEXT NOT NULL DEFAULT '',
    endorsed_to TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status_changed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT cheques_endorsed_needs_party CHECK (status <> 'endorsed' OR length(btrim(endorsed_to)) > 0),
    CONSTRAINT cheques_endorse_incoming_only CHECK (status <> 'endorsed' OR type = 'incoming')
);

-- CREATE TABLE IF NOT EXISTS keeps a legacy shape; add missing columns before indexes/policies.
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS cheque_number TEXT;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS amount NUMERIC(18, 3);
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'ILS';
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS issue_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS payee_or_drawer TEXT DEFAULT '';
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS drawer_name TEXT DEFAULT '';
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS contact_type TEXT;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS contact_id TEXT;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS contact_name TEXT DEFAULT '';
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS endorsed_to TEXT DEFAULT '';
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW());
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW());

-- Older installs required issue_date / payee_or_drawer; the app now uses due_date + drawer_name.
-- Keep the legacy columns filled so NOT NULL constraints (if still present) do not block writes.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'cheques' AND column_name = 'issue_date'
    ) THEN
        EXECUTE $sql$
            UPDATE public.cheques
               SET issue_date = COALESCE(issue_date, due_date, (created_at AT TIME ZONE 'utc')::date, CURRENT_DATE)
             WHERE issue_date IS NULL
        $sql$;
        EXECUTE 'ALTER TABLE public.cheques ALTER COLUMN issue_date SET DEFAULT CURRENT_DATE';
        BEGIN
            EXECUTE 'ALTER TABLE public.cheques ALTER COLUMN issue_date SET NOT NULL';
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'cheques' AND column_name = 'payee_or_drawer'
    ) THEN
        EXECUTE $sql$
            UPDATE public.cheques
               SET payee_or_drawer = COALESCE(
                    NULLIF(btrim(payee_or_drawer), ''),
                    NULLIF(btrim(drawer_name), ''),
                    NULLIF(btrim(contact_name), ''),
                    '—'
               )
             WHERE payee_or_drawer IS NULL OR btrim(payee_or_drawer) = ''
        $sql$;
        EXECUTE $sql$
            ALTER TABLE public.cheques ALTER COLUMN payee_or_drawer SET DEFAULT ''
        $sql$;
        BEGIN
            EXECUTE 'ALTER TABLE public.cheques ALTER COLUMN payee_or_drawer SET NOT NULL';
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END IF;

    -- Prefer drawer_name going forward; copy from the legacy label when empty.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'cheques' AND column_name = 'drawer_name'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'cheques' AND column_name = 'payee_or_drawer'
    ) THEN
        EXECUTE $sql$
            UPDATE public.cheques
               SET drawer_name = btrim(payee_or_drawer)
             WHERE (drawer_name IS NULL OR btrim(drawer_name) = '')
               AND payee_or_drawer IS NOT NULL
               AND btrim(payee_or_drawer) <> ''
        $sql$;
    END IF;
END $$;

-- Legacy tables sometimes used owner_id instead of user_id.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'cheques' AND column_name = 'owner_id'
    ) THEN
        EXECUTE 'UPDATE public.cheques SET user_id = owner_id WHERE user_id IS NULL AND owner_id IS NOT NULL';
    END IF;
END $$;

ALTER TABLE public.cheques ALTER COLUMN user_id SET DEFAULT auth.uid();

DO $$
DECLARE
    orphans BIGINT;
BEGIN
    SELECT count(*) INTO orphans FROM public.cheques WHERE user_id IS NULL;
    IF orphans > 0 THEN
        RAISE EXCEPTION
            'cheques has % row(s) with no user_id/owner_id — assign an owner or delete those rows, then re-run',
            orphans;
    END IF;
    ALTER TABLE public.cheques ALTER COLUMN user_id SET NOT NULL;
END $$;

-- CREATE TABLE IF NOT EXISTS keeps an older currency list; replace it so new currencies are accepted.
ALTER TABLE public.cheques DROP CONSTRAINT IF EXISTS cheques_currency_check;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_currency_check
    CHECK (currency IN ('JOD', 'ILS', 'USD', 'IQD', 'SAR', 'AED', 'LYD', 'EGP'));

-- The same cheque cannot be registered twice for one account.
CREATE UNIQUE INDEX IF NOT EXISTS cheques_unique_per_bank
    ON public.cheques (user_id, type, lower(btrim(bank_name)), btrim(cheque_number));
CREATE INDEX IF NOT EXISTS cheques_user_due ON public.cheques (user_id, due_date);

ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cheques FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cheques TO authenticated;

DROP POLICY IF EXISTS cheques_select_own ON public.cheques;
CREATE POLICY cheques_select_own ON public.cheques FOR SELECT USING ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()));
DROP POLICY IF EXISTS cheques_insert_own ON public.cheques;
CREATE POLICY cheques_insert_own ON public.cheques FOR INSERT WITH CHECK ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()) AND public.has_access());
DROP POLICY IF EXISTS cheques_update_own ON public.cheques;
CREATE POLICY cheques_update_own ON public.cheques FOR UPDATE USING ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage())) WITH CHECK ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()) AND public.has_access());
DROP POLICY IF EXISTS cheques_delete_pending_own ON public.cheques;
CREATE POLICY cheques_delete_pending_own ON public.cheques FOR DELETE USING ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()) AND status = 'pending' AND public.has_access());

CREATE OR REPLACE FUNCTION public.guard_cheque_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.status := 'pending';
        NEW.endorsed_to := '';
        NEW.status_changed_at := NULL;
        NEW.created_at := TIMEZONE('utc', NOW());
        NEW.updated_at := NEW.created_at;
        IF NEW.issue_date IS NULL THEN
            NEW.issue_date := COALESCE(NEW.due_date, (NEW.created_at AT TIME ZONE 'utc')::date, CURRENT_DATE);
        END IF;
        IF NEW.payee_or_drawer IS NULL OR btrim(NEW.payee_or_drawer) = '' THEN
            NEW.payee_or_drawer := COALESCE(NULLIF(btrim(NEW.drawer_name), ''), NULLIF(btrim(NEW.contact_name), ''), '—');
        END IF;
        IF NEW.drawer_name IS NULL OR btrim(NEW.drawer_name) = '' THEN
            NEW.drawer_name := COALESCE(NULLIF(btrim(NEW.payee_or_drawer), ''), '');
        END IF;
        RETURN NEW;
    END IF;

    NEW.id := OLD.id;
    NEW.user_id := OLD.user_id;
    NEW.created_at := OLD.created_at;

    -- The cheque itself (who, how much, when) is locked once it has left the pending state.
    IF OLD.status <> 'pending' AND (
        NEW.cheque_number IS DISTINCT FROM OLD.cheque_number OR
        NEW.bank_name IS DISTINCT FROM OLD.bank_name OR
        NEW.amount IS DISTINCT FROM OLD.amount OR
        NEW.currency IS DISTINCT FROM OLD.currency OR
        NEW.due_date IS DISTINCT FROM OLD.due_date OR
        NEW.type IS DISTINCT FROM OLD.type
    ) THEN
        RAISE EXCEPTION 'cheque is locked after leaving pending';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'pending' AND NEW.status IN ('cashed', 'bounced', 'returned')) OR
            (OLD.status = 'pending' AND NEW.status = 'endorsed' AND OLD.type = 'incoming') OR
            (OLD.status = 'bounced' AND NEW.status IN ('pending', 'returned'))
        ) THEN
            RAISE EXCEPTION 'invalid cheque status change: % -> %', OLD.status, NEW.status;
        END IF;
        NEW.status_changed_at := TIMEZONE('utc', NOW());
    ELSE
        NEW.status_changed_at := OLD.status_changed_at;
    END IF;

    IF NOT (OLD.status = 'pending' AND NEW.status = 'endorsed') THEN
        NEW.endorsed_to := OLD.endorsed_to;
    END IF;

    NEW.updated_at := TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_cheque_writes ON public.cheques;
CREATE TRIGGER guard_cheque_writes
    BEFORE INSERT OR UPDATE ON public.cheques
    FOR EACH ROW EXECUTE FUNCTION public.guard_cheque_writes();

COMMIT;

NOTIFY pgrst, 'reload schema';
