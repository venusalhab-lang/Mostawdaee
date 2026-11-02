-- ZATCA Phase 1 (Saudi simplified tax QR). Run after supabase_einvoicing.sql; safe to run again.
-- Adds provider 'zatca' and optional Saudi fields. Jordan JoFotara columns stay; credentials may be null for zatca.

BEGIN;

ALTER TABLE public.einvoice_settings DROP CONSTRAINT IF EXISTS einvoice_settings_provider_check;
ALTER TABLE public.einvoice_settings ADD CONSTRAINT einvoice_settings_provider_check
    CHECK (provider IN ('jofotara', 'zatca'));

ALTER TABLE public.einvoice_settings ADD COLUMN IF NOT EXISTS cr_number TEXT;
ALTER TABLE public.einvoice_settings ADD COLUMN IF NOT EXISTS provider_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Phase 1 zatca stores public seller identity only; JoFotara still uses client_id / secret_sealed.
ALTER TABLE public.einvoice_settings ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.einvoice_settings ALTER COLUMN secret_sealed DROP NOT NULL;
ALTER TABLE public.einvoice_settings ALTER COLUMN income_source DROP NOT NULL;
ALTER TABLE public.einvoice_settings ALTER COLUMN family DROP NOT NULL;

-- Reject rows that claim JoFotara without credentials, or zatca without a VAT tin + seller name.
ALTER TABLE public.einvoice_settings DROP CONSTRAINT IF EXISTS einvoice_settings_provider_fields_chk;
ALTER TABLE public.einvoice_settings ADD CONSTRAINT einvoice_settings_provider_fields_chk CHECK (
    (provider = 'jofotara'
        AND client_id IS NOT NULL AND length(btrim(client_id)) > 0
        AND secret_sealed IS NOT NULL AND length(btrim(secret_sealed)) > 0
        AND income_source IS NOT NULL AND family IS NOT NULL)
    OR (provider = 'zatca'
        AND length(btrim(tin)) BETWEEN 15 AND 15
        AND length(btrim(seller_name)) BETWEEN 1 AND 200)
);

COMMIT;

NOTIFY pgrst, 'reload schema';
