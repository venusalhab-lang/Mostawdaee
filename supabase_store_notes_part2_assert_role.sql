-- PART 2/3: assert_role_can_write (store_notes permissions)
-- Run after Part 1 succeeds.

CREATE OR REPLACE FUNCTION public.assert_role_can_write(
    p_role TEXT, p_op TEXT, p_col TEXT, p_id TEXT, p_old JSONB, p_new JSONB
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $assert_role$
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
$assert_role$;

REVOKE ALL ON FUNCTION public.assert_role_can_write(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
