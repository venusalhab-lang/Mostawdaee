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
    due_date DATE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('incoming', 'outgoing')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cashed', 'bounced', 'endorsed', 'returned')),
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
