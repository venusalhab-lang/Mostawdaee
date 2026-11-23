-- Money floors + server restore-incomplete lock.
-- Safe to re-run. Run in Supabase SQL editor after supabase_production_setup.sql.
-- Also mirrored into supabase_production_setup.sql for fresh installs.

-- Owner-only lock while a backup restore did not finish.
CREATE TABLE IF NOT EXISTS public.store_restore_locks (
    owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    incomplete_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mode TEXT NOT NULL CHECK (mode IN ('merge', 'replace'))
);
REVOKE ALL ON TABLE public.store_restore_locks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.begin_store_restore(p_mode TEXT DEFAULT 'merge')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor UUID := auth.uid();
    uid UUID;
    locked_mode TEXT := CASE WHEN p_mode = 'replace' THEN 'replace' ELSE 'merge' END;
BEGIN
    IF actor IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    uid := public.workspace_owner();
    IF public.workspace_role() IS DISTINCT FROM 'owner' OR actor IS DISTINCT FROM uid THEN
        RAISE EXCEPTION 'role not allowed';
    END IF;
    IF NOT public.has_access() THEN
        RAISE EXCEPTION 'subscription required';
    END IF;
    INSERT INTO public.store_restore_locks (owner_id, incomplete_at, mode)
    VALUES (uid, NOW(), locked_mode)
    ON CONFLICT (owner_id) DO UPDATE
       SET incomplete_at = EXCLUDED.incomplete_at,
           mode = EXCLUDED.mode;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_store_restore(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_store_restore(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_store_restore()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor UUID := auth.uid();
    uid UUID;
BEGIN
    IF actor IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    uid := public.workspace_owner();
    IF public.workspace_role() IS DISTINCT FROM 'owner' OR actor IS DISTINCT FROM uid THEN
        RAISE EXCEPTION 'role not allowed';
    END IF;
    DELETE FROM public.store_restore_locks WHERE owner_id = uid;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_store_restore() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_store_restore() TO authenticated;

CREATE OR REPLACE FUNCTION public.store_restore_incomplete()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid UUID;
    row_at TIMESTAMPTZ;
    row_mode TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;
    uid := public.workspace_owner();
    SELECT l.incomplete_at, l.mode INTO row_at, row_mode
      FROM public.store_restore_locks l WHERE l.owner_id = uid;
    IF row_at IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
        'at', (EXTRACT(EPOCH FROM row_at) * 1000)::bigint,
        'mode', row_mode
    );
END;
$$;
REVOKE ALL ON FUNCTION public.store_restore_incomplete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_restore_incomplete() TO authenticated;

-- Replaces merchant_commit with floors + restore mode (drops 2-arg overload).
DROP FUNCTION IF EXISTS public.merchant_commit(JSONB, JSONB);
CREATE OR REPLACE FUNCTION public.merchant_commit(p_expected JSONB, p_ops JSONB, p_mode TEXT DEFAULT 'live')
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
    write_mode TEXT := lower(COALESCE(NULLIF(btrim(p_mode), ''), 'live'));
    restore_locked BOOLEAN := FALSE;
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
    IF write_mode NOT IN ('live', 'restore') THEN
        RAISE EXCEPTION 'invalid commit mode';
    END IF;
    restore_locked := EXISTS (
        SELECT 1 FROM public.store_restore_locks l WHERE l.owner_id = uid
    );
    IF restore_locked AND write_mode <> 'restore' THEN
        RAISE EXCEPTION 'restore incomplete';
    END IF;
    IF write_mode = 'restore' AND member_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'role not allowed';
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
        IF col IN ('audit_logs', 'stock_movements', 'invoice_numbers') AND (op = 'delete' OR existing IS NOT NULL) THEN
            RAISE EXCEPTION 'history is append-only';
        END IF;
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
            IF col = 'store_notes' THEN
                IF existing IS NULL THEN
                    payload := payload || jsonb_build_object('createdBy', actor::text);
                ELSE
                    payload := (payload - 'createdBy')
                        || jsonb_build_object('createdBy', COALESCE(existing->>'createdBy', actor::text));
                END IF;
            END IF;
            IF col = 'shifts' THEN
                payload := payload - 'closedById' - 'closedByEmail';
                IF payload->>'status' = 'closed' THEN
                    payload := payload || jsonb_build_object('closedById', actor::text, 'closedByEmail', COALESCE(actor_email, ''));
                END IF;
            END IF;
            IF col = 'inventory' AND public.jsonb_num(payload, 'quantity') < 0 THEN
                RAISE EXCEPTION 'negative stock';
            END IF;
            IF col = 'settings' AND did = 'vault' THEN
                FOREACH bal_key IN ARRAY ARRAY[
                    'currentBalance', 'balanceJOD', 'balanceILS', 'balanceUSD', 'balanceIQD',
                    'balanceSAR', 'balanceAED', 'balanceLYD', 'balanceEGP'
                ]
                LOOP
                    IF public.jsonb_num(payload, bal_key) < 0 THEN
                        RAISE EXCEPTION 'vault overdrawn';
                    END IF;
                END LOOP;
            END IF;
            INSERT INTO public.merchant_documents (user_id, collection, doc_id, data, updated_at)
            VALUES (uid, col, did, payload, stamp)
            ON CONFLICT (user_id, collection, doc_id)
            DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;
        END IF;

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

REVOKE ALL ON FUNCTION public.merchant_commit(JSONB, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_commit(JSONB, JSONB, TEXT) TO authenticated;
