-- National e-invoicing (Jordan JoFotara). Run once in the Supabase SQL editor; safe to run again.
-- Run after supabase_production_setup.sql (needs merchant_documents and workspace_owner).
-- The linking credentials are written and read only by the server (service role); the app never sees the secret.
-- Every submission is logged with the exact XML and the system's answer, which the law requires keeping.

BEGIN;

CREATE TABLE IF NOT EXISTS public.einvoice_settings (
    owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'jofotara' CHECK (provider IN ('jofotara')),
    tin TEXT NOT NULL CHECK (tin ~ '^[0-9]{5,15}$'),
    seller_name TEXT NOT NULL CHECK (length(btrim(seller_name)) BETWEEN 1 AND 200),
    income_source TEXT NOT NULL CHECK (income_source ~ '^[0-9]{1,20}$'),
    family TEXT NOT NULL CHECK (family IN ('income', 'general_sales')),
    zero_rate_category TEXT CHECK (zero_rate_category IN ('Z', 'O')),
    client_id TEXT NOT NULL CHECK (length(btrim(client_id)) BETWEEN 1 AND 200),
    -- AES-256-GCM, sealed by the server with EINVOICE_ENCRYPTION_KEY.
    secret_sealed TEXT NOT NULL,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);
ALTER TABLE public.einvoice_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.einvoice_settings FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.einvoice_submissions (
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invoice_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit')),
    invoice_number TEXT NOT NULL,
    -- Generated once and reused on every resend, so a retry can never create a second tax record.
    uuid UUID NOT NULL DEFAULT gen_random_uuid(),
    icv BIGINT NOT NULL CHECK (icv > 0),
    status TEXT NOT NULL CHECK (status IN ('sending', 'accepted', 'rejected', 'failed')),
    type_code TEXT,
    payable NUMERIC(20, 9),
    request_xml TEXT,
    response JSONB,
    qr TEXT,
    einv_num TEXT,
    error TEXT,
    attempts INT NOT NULL DEFAULT 1,
    sent_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    accepted_at TIMESTAMPTZ,
    PRIMARY KEY (owner_id, invoice_id),
    UNIQUE (owner_id, icv),
    UNIQUE (owner_id, uuid)
);
ALTER TABLE public.einvoice_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.einvoice_submissions FROM anon, authenticated;
-- The whole store sees each invoice's status; only the server writes it.
GRANT SELECT (owner_id, invoice_id, kind, invoice_number, uuid, icv, status, type_code, payable, qr, einv_num, error,
              attempts, created_at, updated_at, accepted_at)
    ON public.einvoice_submissions TO authenticated;
DROP POLICY IF EXISTS einvoice_submissions_select ON public.einvoice_submissions;
CREATE POLICY einvoice_submissions_select ON public.einvoice_submissions
    FOR SELECT USING (owner_id = (SELECT public.workspace_owner()));

-- Reserves the invoice for one sender. A new invoice gets the next counter (ICV) and a fresh UUID;
-- a resend keeps both. Refuses an accepted invoice and one another request is still sending.
CREATE OR REPLACE FUNCTION public.einvoice_claim(p_owner UUID, p_invoice TEXT, p_number TEXT, p_kind TEXT, p_actor UUID)
RETURNS TABLE (claim_uuid UUID, claim_icv BIGINT, claim_attempts INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    r public.einvoice_submissions%ROWTYPE;
    next_icv BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('einvoice:' || p_owner::text)::bigint);
    SELECT * INTO r FROM public.einvoice_submissions WHERE owner_id = p_owner AND invoice_id = p_invoice FOR UPDATE;
    IF FOUND THEN
        IF r.status = 'accepted' THEN
            RAISE EXCEPTION 'EINVOICE_ALREADY_ACCEPTED';
        END IF;
        IF r.status = 'sending' AND r.updated_at > TIMEZONE('utc', NOW()) - INTERVAL '2 minutes' THEN
            RAISE EXCEPTION 'EINVOICE_IN_PROGRESS';
        END IF;
        UPDATE public.einvoice_submissions
           SET status = 'sending', attempts = r.attempts + 1, invoice_number = p_number, sent_by = p_actor,
               error = NULL, updated_at = TIMEZONE('utc', NOW())
         WHERE owner_id = p_owner AND invoice_id = p_invoice;
        RETURN QUERY SELECT r.uuid, r.icv, r.attempts + 1;
        RETURN;
    END IF;
    SELECT COALESCE(MAX(icv), 0) + 1 INTO next_icv FROM public.einvoice_submissions WHERE owner_id = p_owner;
    INSERT INTO public.einvoice_submissions (owner_id, invoice_id, kind, invoice_number, icv, status, sent_by)
    VALUES (p_owner, p_invoice, COALESCE(p_kind, 'invoice'), p_number, next_icv, 'sending', p_actor)
    RETURNING uuid, icv, attempts INTO r.uuid, r.icv, r.attempts;
    RETURN QUERY SELECT r.uuid, r.icv, r.attempts;
END;
$$;

-- Stores the outcome of the claimed attempt. Only a row that is still 'sending' can be closed.
CREATE OR REPLACE FUNCTION public.einvoice_record(
    p_owner UUID, p_invoice TEXT, p_status TEXT, p_type_code TEXT, p_payable NUMERIC,
    p_xml TEXT, p_response JSONB, p_qr TEXT, p_einv_num TEXT, p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF p_status NOT IN ('accepted', 'rejected', 'failed') THEN
        RAISE EXCEPTION 'invalid e-invoice status %', p_status;
    END IF;
    UPDATE public.einvoice_submissions
       SET status = p_status, type_code = p_type_code, payable = p_payable, request_xml = p_xml,
           response = p_response, qr = NULLIF(p_qr, ''), einv_num = NULLIF(p_einv_num, ''),
           error = NULLIF(left(COALESCE(p_error, ''), 2000), ''),
           accepted_at = CASE WHEN p_status = 'accepted' THEN TIMEZONE('utc', NOW()) ELSE NULL END,
           updated_at = TIMEZONE('utc', NOW())
     WHERE owner_id = p_owner AND invoice_id = p_invoice AND status = 'sending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'EINVOICE_NOT_CLAIMED';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.einvoice_claim(UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.einvoice_record(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.einvoice_claim(UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.einvoice_record(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, TEXT) TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.einvoice_settings, public.einvoice_submissions TO service_role;

-- An invoice the tax system accepted (or is receiving right now) cannot be edited or deleted from the app;
-- it is corrected with a return invoice. Removing the whole account (no signed-in user) is not blocked.
-- The quantities already returned (returnedQty) are bookkeeping of the returns, not part of the declared invoice.
CREATE OR REPLACE FUNCTION public.einvoice_lock_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.data - 'returnedQty') IS NOT DISTINCT FROM (OLD.data - 'returnedQty') THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.einvoice_submissions s
         WHERE s.owner_id = OLD.user_id AND s.invoice_id = OLD.doc_id AND s.status IN ('accepted', 'sending')
    ) THEN
        RAISE EXCEPTION 'einvoice locked';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.einvoice_lock_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS einvoice_lock_invoice ON public.merchant_documents;
CREATE TRIGGER einvoice_lock_invoice
    BEFORE UPDATE OR DELETE ON public.merchant_documents
    FOR EACH ROW WHEN (OLD.collection = 'invoices')
    EXECUTE FUNCTION public.einvoice_lock_invoice();

COMMIT;

NOTIFY pgrst, 'reload schema';
