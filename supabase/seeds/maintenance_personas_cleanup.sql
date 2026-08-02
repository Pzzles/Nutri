-- Permanently remove the temporary observed-maintenance demo account.
--
-- Replace the UUID below with the same fresh anonymous UUID used in
-- maintenance_personas_demo.sql. This script refuses real accounts and refuses
-- anonymous accounts that are not labelled as maintenance demo personas.
-- After running it, close the private/incognito browser window.

DO $$
DECLARE
  v_uid       UUID := '00000000-0000-0000-0000-000000000000'; -- replace
  v_demo_root TEXT;
BEGIN
  IF v_uid = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Replace the UUID with the anonymous demo user UUID.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous = true
  ) THEN
    RAISE EXCEPTION
      'User % is not an anonymous auth user. Refusing to delete it.', v_uid;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_uid AND display_name LIKE '[DEMO]%'
  ) THEN
    RAISE EXCEPTION
      'User % is not labelled as a maintenance demo account. Refusing to delete it.', v_uid;
  END IF;

  v_demo_root := 'maintenance-persona-demo:' || v_uid::text;

  -- auth.users -> profiles cascades through all user-owned records. Foods use
  -- ON DELETE SET NULL, so their uniquely tagged rows are deleted afterward.
  DELETE FROM auth.users WHERE id = v_uid;
  DELETE FROM public.foods
  WHERE source_identifier LIKE v_demo_root || ':%';

  RAISE NOTICE 'Deleted maintenance demo user % and all tagged demo foods.', v_uid;
END $$;
