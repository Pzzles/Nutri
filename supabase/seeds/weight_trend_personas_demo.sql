-- Weight-trend graph demo data: three switchable personas.
--
-- IMPORTANT
--   Use this only with a fresh anonymous user created in a private/incognito
--   browser window. The script inserts weight log entries tagged [DEMO-TREND]
--   and refuses non-anonymous accounts and accounts with non-demo weight logs.
--
-- HOW TO USE
--   1. Open the app in a private/incognito window and wait for Dashboard to load.
--      The app creates a new anonymous Supabase user for that browser session.
--   2. In the Supabase SQL Editor, find the new user:
--
--        SELECT id, created_at
--        FROM auth.users
--        WHERE is_anonymous = true
--        ORDER BY created_at DESC
--        LIMIT 5;
--
--   3. Replace YOUR_FRESH_ANONYMOUS_USER_UUID below.
--   4. Set v_persona to one of:
--        usable_trend       — 21 daily measurements (past 21 days):  status=usable, confidence=high
--        provisional_trend  — 9 daily measurements  (past 9 days):   status=provisional
--        stale_trend        — 20 measurements ending 15 days ago:     status=stale
--   5. Run the file. Retrieve the session JWT from the private browser (DevTools →
--      Application → Local Storage → look for access_token), then call:
--
--        curl "https://ipdrzvqhprboqqjhjldj.functions.supabase.co/get-weight-trend" \
--          -H "Authorization: Bearer <JWT>"
--
--      Expected: { "ok": true, "data": { "status": "<expected_status>", ... } }
--
--   6. Change v_persona and rerun to switch examples.
--   7. Run weight_trend_personas_cleanup.sql when finished.

DO $$
DECLARE
  v_uid     UUID := '00000000-0000-0000-0000-000000000000'; -- replace
  v_persona TEXT := 'usable_trend';
  v_today   DATE := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_tag     TEXT;
BEGIN
  IF v_uid = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION
      'Replace YOUR_FRESH_ANONYMOUS_USER_UUID with the UUID from the private browser session.';
  END IF;

  IF v_persona NOT IN ('usable_trend', 'provisional_trend', 'stale_trend') THEN
    RAISE EXCEPTION
      'Unknown persona: %. Must be usable_trend, provisional_trend, or stale_trend.', v_persona;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous = true
  ) THEN
    RAISE EXCEPTION
      'User % is not an anonymous auth user. Refusing to alter a real account.', v_uid;
  END IF;

  -- Refuse if this user has any weight logs not tagged as demo data.
  IF EXISTS (
    SELECT 1 FROM public.weight_logs
    WHERE user_id = v_uid
      AND (notes IS NULL OR notes NOT LIKE '[DEMO-TREND]%')
  ) THEN
    RAISE EXCEPTION
      'User % already has non-demo weight logs. Create a fresh private browser session.', v_uid;
  END IF;

  -- Clear any previously seeded demo weight logs so re-runs are idempotent.
  DELETE FROM public.weight_logs
  WHERE user_id = v_uid AND notes LIKE '[DEMO-TREND]%';

  v_tag := '[DEMO-TREND]:' || v_persona;

  IF v_persona = 'usable_trend' THEN
    -- 21 daily measurements over the past 21 days.
    -- Rate window (28d): all 21 reps in window → distinct=21, rateElapsed=20d ≥ 14 → status=usable.
    INSERT INTO public.weight_logs (
      user_id, weight_kg, measured_at, logged_date, is_official, notes, source
    )
    SELECT
      v_uid,
      ROUND((
        98.3 + (d - 1) * 0.11
        + CASE d % 5
            WHEN 0 THEN  0.00
            WHEN 1 THEN -0.10
            WHEN 2 THEN  0.08
            WHEN 3 THEN  0.15
            ELSE         -0.06
          END
      )::NUMERIC, 2),
      ((v_today - d::INTEGER) + TIME '07:00') AT TIME ZONE 'Africa/Johannesburg',
      v_today - d::INTEGER,
      true,
      v_tag,
      'manual'
    FROM generate_series(1, 21) AS days(d);

  ELSIF v_persona = 'provisional_trend' THEN
    -- 9 daily measurements over the past 9 days.
    -- Rate window (28d): all 9 reps in window → distinct=9, rateElapsed=8d → 7 ≤ 8 < 14 → status=provisional.
    INSERT INTO public.weight_logs (
      user_id, weight_kg, measured_at, logged_date, is_official, notes, source
    )
    SELECT
      v_uid,
      ROUND((
        74.8 + (d - 1) * 0.09
        + CASE d % 5
            WHEN 0 THEN  0.00
            WHEN 1 THEN -0.10
            WHEN 2 THEN  0.08
            WHEN 3 THEN  0.15
            ELSE         -0.06
          END
      )::NUMERIC, 2),
      ((v_today - d::INTEGER) + TIME '07:00') AT TIME ZONE 'Africa/Johannesburg',
      v_today - d::INTEGER,
      true,
      v_tag,
      'manual'
    FROM generate_series(1, 9) AS days(d);

  ELSE
    -- 20 daily measurements from 34 to 15 days ago (most recent = 15 days ago).
    -- Rate window (28d): d=15..28 → 14 reps, rateElapsed=13d; recency=15 > 14 → status=stale.
    INSERT INTO public.weight_logs (
      user_id, weight_kg, measured_at, logged_date, is_official, notes, source
    )
    SELECT
      v_uid,
      ROUND((
        84.0 + (d - 15) * 0.08
        + CASE d % 5
            WHEN 0 THEN  0.00
            WHEN 1 THEN -0.10
            WHEN 2 THEN  0.08
            WHEN 3 THEN  0.15
            ELSE         -0.06
          END
      )::NUMERIC, 2),
      ((v_today - d::INTEGER) + TIME '07:00') AT TIME ZONE 'Africa/Johannesburg',
      v_today - d::INTEGER,
      true,
      v_tag,
      'manual'
    FROM generate_series(15, 34) AS days(d);
  END IF;

  RAISE NOTICE 'Loaded persona % for user %', v_persona, v_uid;
  RAISE NOTICE 'Expected status: %',
    CASE v_persona
      WHEN 'usable_trend'      THEN 'usable'
      WHEN 'provisional_trend' THEN 'provisional'
      ELSE                          'stale'
    END;
END $$;

-- Verification: counts and date range for the seeded demo user.
SELECT
  COUNT(*)                                      AS total_logs,
  MIN(logged_date)                              AS oldest_date,
  MAX(logged_date)                              AS newest_date,
  (MAX(logged_date) - MIN(logged_date))         AS span_days,
  ((now() AT TIME ZONE 'Africa/Johannesburg')::date - MAX(logged_date)) AS recency_days,
  COUNT(DISTINCT logged_date)                   AS distinct_days,
  MIN(weight_kg)                                AS min_weight_kg,
  MAX(weight_kg)                                AS max_weight_kg
FROM public.weight_logs
WHERE notes LIKE '[DEMO-TREND]%';
