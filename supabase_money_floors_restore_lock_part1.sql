-- PART 1/2: restore-incomplete lock table + RPCs only.
-- Run this first in Supabase SQL Editor. Safe to re-run.

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
