-- Inventory reconciliation (الجرد الفعلي والتسوية المخزنية)
-- Run after supabase_production_setup.sql (writes require public.has_access()).
-- Run this once in the Supabase SQL editor for the project that holds `public.products`.
-- Applying an audit sets products.quantity to the counted actual_qty and writes
-- a stock_movements row labelled عجز جرد or زيادة جرد.
-- Products that exist only in the app catalog (Firestore) are listed in
-- missing_products; the app still adjusts those quantities itself.

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
    USING (auth.uid() = user_id);

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

ALTER TABLE public.inventory_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_audits_select_own" ON public.inventory_audits;
CREATE POLICY "inventory_audits_select_own"
    ON public.inventory_audits FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "inventory_audits_insert_draft" ON public.inventory_audits;
CREATE POLICY "inventory_audits_insert_draft"
    ON public.inventory_audits FOR INSERT
    WITH CHECK (auth.uid() = user_id AND auth.uid() = created_by AND status = 'draft' AND public.has_access());

-- A client can edit a draft, but only the apply function may mark it completed.
DROP POLICY IF EXISTS "inventory_audits_update_draft" ON public.inventory_audits;
CREATE POLICY "inventory_audits_update_draft"
    ON public.inventory_audits FOR UPDATE
    USING (auth.uid() = user_id AND status = 'draft')
    WITH CHECK (auth.uid() = user_id AND status = 'draft' AND public.has_access());

DROP POLICY IF EXISTS "inventory_audits_delete_draft" ON public.inventory_audits;
CREATE POLICY "inventory_audits_delete_draft"
    ON public.inventory_audits FOR DELETE
    USING (auth.uid() = user_id AND status = 'draft' AND public.has_access());

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
    CONSTRAINT inventory_audit_items_expected_chk CHECK (expected_qty >= 0),
    CONSTRAINT inventory_audit_items_actual_chk CHECK (actual_qty >= 0),
    CONSTRAINT inventory_audit_items_cost_chk CHECK (unit_cost >= 0),
    CONSTRAINT inventory_audit_items_product_uniq UNIQUE (audit_id, product_id)
);

CREATE INDEX IF NOT EXISTS inventory_audit_items_audit_idx
    ON public.inventory_audit_items (audit_id);

ALTER TABLE public.inventory_audit_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_audit_items_select_own" ON public.inventory_audit_items;
CREATE POLICY "inventory_audit_items_select_own"
    ON public.inventory_audit_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.inventory_audits a
            WHERE a.id = audit_id AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "inventory_audit_items_insert_draft" ON public.inventory_audit_items;
CREATE POLICY "inventory_audit_items_insert_draft"
    ON public.inventory_audit_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.inventory_audits a
            WHERE a.id = audit_id AND a.user_id = auth.uid() AND a.status = 'draft'
        ) AND public.has_access()
    );

DROP POLICY IF EXISTS "inventory_audit_items_update_draft" ON public.inventory_audit_items;
CREATE POLICY "inventory_audit_items_update_draft"
    ON public.inventory_audit_items FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.inventory_audits a
            WHERE a.id = audit_id AND a.user_id = auth.uid() AND a.status = 'draft'
        ) AND public.has_access()
    );

DROP POLICY IF EXISTS "inventory_audit_items_delete_draft" ON public.inventory_audit_items;
CREATE POLICY "inventory_audit_items_delete_draft"
    ON public.inventory_audit_items FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.inventory_audits a
            WHERE a.id = audit_id AND a.user_id = auth.uid() AND a.status = 'draft'
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
-- Apply: set product quantities to the counted actual and log the variance
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_inventory_audit(p_audit_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_audit public.inventory_audits%ROWTYPE;
    v_item public.inventory_audit_items%ROWTYPE;
    v_qty INTEGER;
    v_name TEXT;
    v_threshold INTEGER;
    v_actual INTEGER;
    v_delta NUMERIC;
    v_adjusted INTEGER := 0;
    v_unchanged INTEGER := 0;
    v_missing JSONB := '[]'::JSONB;
    v_updated INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
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

    IF NOT EXISTS (
        SELECT 1 FROM public.inventory_audit_items WHERE audit_id = p_audit_id
    ) THEN
        RAISE EXCEPTION 'AUDIT_EMPTY';
    END IF;

    FOR v_item IN
        SELECT * FROM public.inventory_audit_items
        WHERE audit_id = p_audit_id
        ORDER BY id
        FOR UPDATE
    LOOP
        SELECT quantity, name, COALESCE(low_stock_threshold, 10)
          INTO v_qty, v_name, v_threshold
        FROM public.products
        WHERE id = v_item.product_id AND user_id = v_uid
        FOR UPDATE;

        IF NOT FOUND THEN
            v_missing := v_missing || to_jsonb(v_item.product_id);
            CONTINUE;
        END IF;

        IF v_item.actual_qty <> trunc(v_item.actual_qty) THEN
            RAISE EXCEPTION 'FRACTIONAL_QTY:%', v_item.product_id;
        END IF;

        v_actual := v_item.actual_qty::INTEGER;
        v_delta := v_actual - v_qty;

        UPDATE public.products
        SET quantity = v_actual,
            status = CASE
                WHEN v_actual <= 0 THEN 'Out of Stock'
                WHEN v_actual <= v_threshold THEN 'Low Stock'
                ELSE 'In Stock'
            END
        WHERE id = v_item.product_id AND user_id = v_uid;

        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> 1 THEN
            RAISE EXCEPTION 'PRODUCT_UPDATE_FAILED:%', v_item.product_id;
        END IF;

        IF v_delta = 0 THEN
            v_unchanged := v_unchanged + 1;
        ELSE
            INSERT INTO public.stock_movements (
                user_id, product_id, product_name, movement_type,
                before_qty, after_qty, delta, reason, audit_id
            ) VALUES (
                v_uid,
                v_item.product_id,
                v_name,
                CASE WHEN v_delta < 0 THEN 'عجز جرد' ELSE 'زيادة جرد' END,
                v_qty,
                v_actual,
                v_delta,
                format('جرد %s: المتوقع %s والفعلي %s', v_audit.audit_number, v_item.expected_qty, v_item.actual_qty),
                v_audit.id
            );
            v_adjusted := v_adjusted + 1;
        END IF;
    END LOOP;

    UPDATE public.inventory_audits
    SET status = 'completed'
    WHERE id = v_audit.id AND user_id = v_uid AND status = 'draft';

    RETURN jsonb_build_object(
        'audit_id', v_audit.id,
        'audit_number', v_audit.audit_number,
        'status', 'completed',
        'adjusted', v_adjusted,
        'unchanged', v_unchanged,
        'missing_products', v_missing
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_inventory_audit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_inventory_audit(UUID) TO authenticated;
