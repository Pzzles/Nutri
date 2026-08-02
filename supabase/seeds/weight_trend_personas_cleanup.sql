-- Remove all weight-trend demo data seeded by weight_trend_personas_demo.sql.
-- Run this after testing is complete, then close the private browser window.

DO $$
DECLARE
  v_uid     UUID    := '00000000-0000-0000-0000-000000000000'; -- replace
  v_deleted INTEGER;
BEGIN
  IF v_uid = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION
      'Replace YOUR_FRESH_ANONYMOUS_USER_UUID before running cleanup.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous = true
  ) THEN
    RAISE EXCEPTION
      'User % is not an anonymous user. Refusing cleanup.', v_uid;
  END IF;

  DELETE FROM public.weight_logs
  WHERE user_id = v_uid AND notes LIKE '[DEMO-TREND]%';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'Removed % [DEMO-TREND] weight log(s) for user %', v_deleted, v_uid;
  RAISE NOTICE 'Remaining weight logs for this user: %',
    (SELECT COUNT(*) FROM public.weight_logs WHERE user_id = v_uid);
END $$;
