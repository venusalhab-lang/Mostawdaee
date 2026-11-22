-- Support staff: surface requester display name (+ keep email) on ticket list/thread.
-- Safe to re-run. Does not change merchant RPCs or tables.

CREATE OR REPLACE FUNCTION public.support_user_label(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (
            SELECT NULLIF(btrim(d.data->>'userName'), '')
              FROM public.merchant_documents d
             WHERE d.user_id = p_user
               AND d.collection = 'settings'
               AND d.doc_id = 'profile'
             LIMIT 1
        ),
        (
            SELECT NULLIF(btrim(d.data->>'businessName'), '')
              FROM public.merchant_documents d
             WHERE d.user_id = p_user
               AND d.collection = 'settings'
               AND d.doc_id = 'profile'
             LIMIT 1
        ),
        (
            SELECT COALESCE(
                NULLIF(btrim(u.raw_user_meta_data->>'full_name'), ''),
                NULLIF(btrim(u.raw_user_meta_data->>'name'), ''),
                NULLIF(split_part(COALESCE(u.email, ''), '@', 1), '')
            )
              FROM auth.users u
             WHERE u.id = p_user
             LIMIT 1
        )
    );
$$;

REVOKE ALL ON FUNCTION public.support_user_label(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_user_label(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.support_staff_list(p_actor UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder', 'operations', 'support']);
    IF p_status NOT IN ('open', 'answered', 'closed', 'all') THEN
        RAISE EXCEPTION 'invalid status';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'category', t.category, 'subject', t.subject, 'status', t.status,
            'assigned_email', t.assigned_email, 'created_at', t.created_at, 'updated_at', t.updated_at,
            'author_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = t.author_id),
            'author_name', public.support_user_label(t.author_id),
            'store_name', public.team_store_name(t.store_owner_id),
            'store_owner_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = t.store_owner_id),
            'store_owner_name', public.support_user_label(t.store_owner_id),
            'store_subscription', (SELECT s.subscription_status FROM public.user_subscriptions s WHERE s.user_id = t.store_owner_id),
            'messages', (SELECT count(*) FROM public.support_messages m WHERE m.ticket_id = t.id)
        ) ORDER BY t.ord, t.wait, t.updated_at DESC)
          FROM (SELECT x.*,
                       CASE x.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END AS ord,
                       CASE WHEN x.status = 'open' THEN x.updated_at END AS wait
                  FROM public.support_tickets x
                 WHERE p_status = 'all' OR x.status = p_status
                 ORDER BY ord, wait, updated_at DESC
                 LIMIT 300) t
    ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.support_staff_thread(p_actor UUID, p_ticket UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    t RECORD;
BEGIN
    PERFORM public.platform_require(p_actor, ARRAY['founder', 'operations', 'support']);
    SELECT * INTO t FROM public.support_tickets WHERE id = p_ticket;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ticket not found';
    END IF;
    RETURN jsonb_build_object(
        'ticket', jsonb_build_object(
            'id', t.id, 'category', t.category, 'subject', t.subject, 'status', t.status,
            'assigned_email', t.assigned_email, 'created_at', t.created_at, 'updated_at', t.updated_at,
            'author_id', t.author_id,
            'author_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = t.author_id),
            'author_name', public.support_user_label(t.author_id),
            'store_owner_id', t.store_owner_id,
            'store_name', public.team_store_name(t.store_owner_id),
            'store_owner_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = t.store_owner_id),
            'store_owner_name', public.support_user_label(t.store_owner_id),
            'store_subscription', (SELECT s.subscription_status FROM public.user_subscriptions s WHERE s.user_id = t.store_owner_id)),
        'messages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', m.id, 'from_staff', m.from_staff, 'staff_email', m.staff_email,
                                                'body', m.body, 'created_at', m.created_at) ORDER BY m.id)
              FROM public.support_messages m WHERE m.ticket_id = t.id
        ), '[]'::jsonb));
END;
$$;
