-- ARCHIVED. Do not run: grants wider access than supabase_production_setup.sql and would reopen fixed holes.
-- Prevent clients from self-granting premium. Apply in the Supabase SQL editor.
-- Users may insert/update only trial rows for themselves. Active status is service-role only.

DROP POLICY IF EXISTS "Users can update their own subscription" ON public.user_subscriptions;
CREATE POLICY "Users can update trial fields only"
    ON public.user_subscriptions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND subscription_status IN ('trial', 'expired')
    );

DROP POLICY IF EXISTS "Users can insert their own subscription" ON public.user_subscriptions;
CREATE POLICY "Users can insert trial subscription only"
    ON public.user_subscriptions FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND subscription_status = 'trial'
    );

DROP POLICY IF EXISTS "Super admins manage subscriptions" ON public.user_subscriptions;
CREATE POLICY "Super admins manage subscriptions"
    ON public.user_subscriptions FOR ALL
    USING (public.check_is_super_admin(auth.uid()))
    WITH CHECK (public.check_is_super_admin(auth.uid()));


-- ---------------------------------------------------------------------------
-- Google Play purchases: one purchase token can only be linked to ONE account.
-- Written only by the server (service role); clients have no access.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.play_purchases (
    purchase_token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.play_purchases ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service role (which bypasses RLS) can read/write.
