-- Inventory reconciliation (الجرد الفعلي والتسوية المخزنية). Safe to run again.
-- Run after supabase_production_setup.sql (needs public.has_access / workspace_*).
-- Product quantities live in merchant_documents and are changed by the app through merchant_commit.
-- Applying an audit here only closes it, so the same count can never be applied twice.

-- ---------------------------------------------------------
-- stock_movements (created here if the project does not have one yet)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT,
    movement_type TEXT NOT NULL,
    before_qty NUMERIC NOT NULL,
    after_qty NUMERIC NOT NULL,
    delta NUMERIC NOT NULL,
    reason TEXT,
    audit_id UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS movement_type TEXT;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS before_qty NUMERIC;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS after_qty NUMERIC;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS delta NUMERIC;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS audit_id UUID;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW());

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_select_own" ON public.stock_movements;
CREATE POLICY "stock_movements_select_own"
    ON public.stock_movements FOR SELECT
    USING ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()));

-- Inserts are done by apply_inventory_audit (security definer), not by the client.
DROP POLICY IF EXISTS "stock_movements_no_client_insert" ON public.stock_movements;
REVOKE INSERT, UPDATE, DELETE ON public.stock_movements FROM authenticated, anon;
GRANT SELECT ON public.stock_movements TO authenticated;

-- ---------------------------------------------------------
-- inventory_audits
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    audit_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    CONSTRAINT inventory_audits_status_chk CHECK (status IN ('draft', 'completed')),
    CONSTRAINT inventory_audits_number_user_uniq UNIQUE (user_id, audit_number)
);

-- A manager who started an audit can still delete their account; the store keeps the audit.
ALTER TABLE public.inventory_audits DROP CONSTRAINT IF EXISTS inventory_audits_created_by_fkey;
ALTER TABLE public.inventory_audits ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.inventory_audits ADD CONSTRAINT inventory_audits_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_audits_select_own" ON public.inventory_audits;
CREATE POLICY "inventory_audits_select_own"
    ON public.inventory_audits FOR SELECT
    USING ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()));

DROP POLICY IF EXISTS "inventory_audits_insert_draft" ON public.inventory_audits;
CREATE POLICY "inventory_audits_insert_draft"
    ON public.inventory_audits FOR INSERT
    WITH CHECK ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()) AND auth.uid() = created_by AND status = 'draft' AND public.has_access());

-- A client can edit a draft, but only the apply function may mark it completed.
DROP POLICY IF EXISTS "inventory_audits_update_draft" ON public.inventory_audits;
CREATE POLICY "inventory_audits_update_draft"
    ON public.inventory_audits FOR UPDATE
    USING ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()) AND status = 'draft')
    WITH CHECK ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()) AND status = 'draft' AND public.has_access());

DROP POLICY IF EXISTS "inventory_audits_delete_draft" ON public.inventory_audits;
CREATE POLICY "inventory_audits_delete_draft"
    ON public.inventory_audits FOR DELETE
    USING ((SELECT public.workspace_owner()) = user_id AND (SELECT public.workspace_can_manage()) AND status = 'draft' AND public.has_access());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_audits TO authenticated;

-- ---------------------------------------------------------
-- inventory_audit_items
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_audit_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.inventory_audits(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    expected_qty NUMERIC NOT NULL,
    actual_qty NUMERIC NOT NULL,
    difference NUMERIC GENERATED ALWAYS AS (actual_qty - expected_qty) STORED,
    unit_cost NUMERIC NOT NULL DEFAULT 0,
    -- expected_qty may be negative when offline sales oversold the book; the count (actual) must still be >= 0.
    CONSTRAINT inventory_audit_items_actual_chk CHECK (actual_qty >= 0),
    CONSTRAINT inventory_audit_items_cost_chk CHECK (unit_cost >= 0),
    CONSTRAINT inventory_audit_items_product_uniq UNIQUE (audit_id, product_id)
);

-- Existing projects created with expected_qty >= 0: drop that check so a negative book can be reconciled.
ALTER TABLE public.inventory_audit_items DROP CONSTRAINT IF EXISTS inventory_audit_items_expected_chk;

CREATE INDEX IF NOT EXISTS inventory_audit_items_audit_idx
    ON public.inventory_audit_items (audit_id);

ALTER TABLE public.inventory_audit_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_audit_items_select_own" ON public.inventory_audit_items;
CREATE POLICY "inventory_audit_items_select_own"
    ON public.inventory_audit_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.inventory_audits a
            WHERE a.id = audit_id AND a.user_id = (SELECT public.workspace_owner()) AND (SELECT public.workspace_can_manage())
        )
    );

DROP POLICY IF EXISTS "inventory_audit_items_insert_draft" ON public.inventory_audit_items;
CREATE POLICY "inventory_audit_items_insert_draft"
    ON public.inventory_audit_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.inventory_audits a
            WHERE a.id = audit_id AND a.user_id = (SELECT public.workspace_owner()) AND (SELECT public.workspace_can_manage()) AND a.status = 'draft'
        ) AND public.has_access()
    );

DROP POLICY IF EXISTS "inventory_audit_items_update_draft" ON public.inventory_audit_items;
CREATE POLICY "inventory_audit_items_update_draft"
    ON public.inventory_audit_items FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.inventory_audits a
            WHERE a.id = audit_id AND a.user_id = (SELECT public.workspace_owner()) AND (SELECT public.workspace_can_manage()) AND a.status = 'draft'
        ) AND public.has_access()
    );

DROP POLICY IF EXISTS "inventory_audit_items_delete_draft" ON public.inventory_audit_items;
CREATE POLICY "inventory_audit_items_delete_draft"
    ON public.inventory_audit_items FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.inventory_audits a
            WHERE a.id = audit_id AND a.user_id = (SELECT public.workspace_owner()) AND (SELECT public.workspace_can_manage()) AND a.status = 'draft'
        ) AND public.has_access()
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_audit_items TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_audit_id_fkey'
    ) THEN
        ALTER TABLE public.stock_movements
            ADD CONSTRAINT stock_movements_audit_id_fkey
            FOREIGN KEY (audit_id) REFERENCES public.inventory_audits(id) ON DELETE SET NULL;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------
-- Apply: close the stocktake. The app has already set each product to its counted
-- quantity through merchant_commit (one stock movement per line); this records that
-- the count is final so it can never be resumed or applied a second time.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_inventory_audit(p_audit_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.workspace_owner();
    v_audit public.inventory_audits%ROWTYPE;
    v_adjusted INTEGER;
    v_unchanged INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;
    IF NOT public.workspace_can_manage() THEN
        RAISE EXCEPTION 'role not allowed';
    END IF;
    IF NOT public.has_access() THEN
        RAISE EXCEPTION 'subscription required';
    END IF;

    SELECT * INTO v_audit
    FROM public.inventory_audits
    WHERE id = p_audit_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'AUDIT_NOT_FOUND';
    END IF;
    IF v_audit.user_id <> v_uid THEN
        RAISE EXCEPTION 'AUDIT_FORBIDDEN';
    END IF;
    IF v_audit.status <> 'draft' THEN
        RAISE EXCEPTION 'AUDIT_ALREADY_COMPLETED';
    END IF;

    SELECT COUNT(*) FILTER (WHERE actual_qty <> expected_qty),
           COUNT(*) FILTER (WHERE actual_qty = expected_qty)
      INTO v_adjusted, v_unchanged
    FROM public.inventory_audit_items
    WHERE audit_id = p_audit_id;

    IF COALESCE(v_adjusted, 0) + COALESCE(v_unchanged, 0) = 0 THEN
        RAISE EXCEPTION 'AUDIT_EMPTY';
    END IF;

    UPDATE public.inventory_audits
    SET status = 'completed'
    WHERE id = v_audit.id AND user_id = v_uid AND status = 'draft';

    RETURN jsonb_build_object(
        'audit_id', v_audit.id,
        'audit_number', v_audit.audit_number,
        'status', 'completed',
        'adjusted', v_adjusted,
        'unchanged', v_unchanged,
        'missing_products', '[]'::JSONB
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_inventory_audit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_inventory_audit(UUID) TO authenticated;
