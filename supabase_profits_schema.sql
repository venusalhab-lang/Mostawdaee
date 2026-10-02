-- ─── SUPABASE SCHEMA DEFINITIONS FOR MULTI-CURRENCY & PROFITS ─────────────────
-- This SQL file configures the database schema on Supabase to enable robust multi-currency transactions.
-- Put these statements inside the Supabase Query Editor and run them.

-- 1. Ensure dynamic exchange_rates exist (Optional cache table)
CREATE TABLE IF NOT EXISTS public.exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency_code TEXT NOT NULL UNIQUE, -- 'USD', 'ILS', 'JOD', 'SAR', 'LYD', etc.
    rate_to_usd NUMERIC NOT NULL,       -- Conversion factor where USD is 1.0
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Seed defaults to exchange_rates
INSERT INTO public.exchange_rates (currency_code, rate_to_usd)
VALUES 
    ('USD', 1.0000),
    ('ILS', 3.7000),
    ('JOD', 0.7090),
    ('SAR', 3.7500),
    ('LYD', 4.8000)
ON CONFLICT (currency_code) 
DO UPDATE SET rate_to_usd = EXCLUDED.rate_to_usd, last_updated = NOW();

-- 2. Enable row level security (RLS)
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

-- 3. Anonymous and authenticated read policy
CREATE POLICY "Allow public read-only access to exchange rates"
    ON public.exchange_rates FOR SELECT
    USING (true);

-- 4. Invoices modification schema query guidance
-- If you want to log real dynamic profit vectors directly on your 'invoices' table:
-- ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cost_amount NUMERIC DEFAULT 0.0;
-- ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC DEFAULT 1.0;

-- 5. Helper function to automate USD calculations dynamically
CREATE OR REPLACE FUNCTION convert_currency_func(
    amount NUMERIC,
    from_curr TEXT,
    to_curr TEXT,
    rates_json JSONB
) RETURNS NUMERIC AS $$
DECLARE
    from_rate NUMERIC;
    to_rate NUMERIC;
    amount_usd NUMERIC;
BEGIN
    from_rate := (rates_json->>from_curr)::NUMERIC;
    to_rate := (rates_json->>to_curr)::NUMERIC;
    
    IF from_rate IS NULL OR to_rate IS NULL THEN
        RETURN amount; -- Fallback
    END IF;
    
    amount_usd := amount / from_rate;
    RETURN amount_usd * to_rate;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
