-- Enable store_notes for Mostawdaee (idempotent pieces).
-- Run in Supabase SQL Editor on the production project.

ALTER TABLE public.merchant_documents DROP CONSTRAINT IF EXISTS merchant_documents_collection_check;
ALTER TABLE public.merchant_documents ADD CONSTRAINT merchant_documents_collection_check CHECK (collection IN (
    'settings', 'inventory', 'invoices', 'employees', 'payroll', 'customers',
    'customer_transactions', 'stock_movements', 'vault_records', 'warehouses', 'audit_logs',
    'invoice_numbers', 'suppliers', 'supplier_transactions', 'shifts', 'orders', 'store_notes'
));

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

    -- Free-form store notes: cashiers may create, and may edit/delete only their own.
    IF p_col = 'store_notes' THEN
        IF p_op = 'set' AND p_old IS NULL THEN
            RETURN;
        END IF;
        IF COALESCE(p_old->>'createdBy', '') = COALESCE(auth.uid()::text, '') THEN
            IF p_op = 'delete' THEN
                RETURN;
            END IF;
            IF p_op = 'set'
               AND COALESCE(p_new->>'createdBy', p_old->>'createdBy') IS NOT DISTINCT FROM p_old->>'createdBy' THEN
                RETURN;
            END IF;
        END IF;
        RAISE EXCEPTION 'role not allowed';
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
            -- Store notes: authorship is server-stamped so a cashier cannot claim another writer's note.
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

