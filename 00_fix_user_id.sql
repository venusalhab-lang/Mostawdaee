-- Run FIRST. Adds user_id to legacy tables before the main scripts.
-- Safe to run again.

-- user_subscriptions
ALTER TABLE IF EXISTS public.user_subscriptions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_subscriptions'
       AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    UPDATE public.user_subscriptions s
       SET user_id = s.id
     WHERE s.user_id IS NULL
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.id);
  END IF;
END $$;

-- cheques
CREATE TABLE IF NOT EXISTS public.cheques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public.cheques
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cheques' AND column_name = 'owner_id'
  ) THEN
    EXECUTE 'UPDATE public.cheques SET user_id = owner_id WHERE user_id IS NULL AND owner_id IS NOT NULL';
  END IF;
END $$;

ALTER TABLE public.cheques ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Show what we have (so you can see if orphans remain)
SELECT 'user_subscriptions' AS tbl,
       count(*) AS rows,
       count(*) FILTER (WHERE user_id IS NULL) AS missing_user_id
  FROM public.user_subscriptions
UNION ALL
SELECT 'cheques',
       count(*),
       count(*) FILTER (WHERE user_id IS NULL)
  FROM public.cheques;
