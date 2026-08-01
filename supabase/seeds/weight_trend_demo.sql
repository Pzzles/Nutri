-- Weight trend demo seed — 28 days of realistic daily weigh-ins.
--
-- Paste into: Supabase dashboard → SQL Editor → New query, then Run.
-- To clean up: run the DELETE block at the bottom.
--
-- Target user: whoever has the most recent weight log entry.
-- If no logs exist yet, falls back to the most recently signed-in user.
--
-- Pattern: starts ~105 kg, drifts down ~0.5 kg/week with realistic noise.
-- Two days have a non-official entry alongside the official morning weigh-in.
-- All rows use source='demo_seed' for easy cleanup.

DO $$
DECLARE
  v_uid uuid;
BEGIN
  -- Prefer the user who last logged a weight (that's the active tester).
  SELECT user_id INTO v_uid
  FROM weight_logs
  ORDER BY measured_at DESC
  LIMIT 1;

  -- No weight logs yet — fall back to the most recently active auth user.
  IF v_uid IS NULL THEN
    SELECT id INTO v_uid
    FROM auth.users
    ORDER BY last_sign_in_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No users found in auth.users. Open the app first so a session is created.';
  END IF;

  RAISE NOTICE 'Seeding user %', v_uid;

  -- Guard: do not double-insert.
  IF EXISTS (SELECT 1 FROM weight_logs WHERE user_id = v_uid AND source = 'demo_seed') THEN
    RAISE NOTICE 'Demo seed already present for this user — nothing inserted. Run the DELETE block first to reset.';
    RETURN;
  END IF;

  INSERT INTO weight_logs (user_id, weight_kg, measured_at, logged_date, is_official, source) VALUES

  -- Week 1 (28–22 days ago) — ~105 kg range
  (v_uid, 105.4, (NOW() - INTERVAL '28 days')::date + TIME '07:00:00', (NOW() - INTERVAL '28 days')::date, true,  'demo_seed'),
  (v_uid, 104.9, (NOW() - INTERVAL '27 days')::date + TIME '07:30:00', (NOW() - INTERVAL '27 days')::date, true,  'demo_seed'),
  (v_uid, 105.6, (NOW() - INTERVAL '26 days')::date + TIME '08:00:00', (NOW() - INTERVAL '26 days')::date, true,  'demo_seed'),
  -- day 25 skipped
  (v_uid, 105.1, (NOW() - INTERVAL '24 days')::date + TIME '07:00:00', (NOW() - INTERVAL '24 days')::date, true,  'demo_seed'),
  (v_uid, 104.7, (NOW() - INTERVAL '23 days')::date + TIME '07:15:00', (NOW() - INTERVAL '23 days')::date, true,  'demo_seed'),
  (v_uid, 105.2, (NOW() - INTERVAL '22 days')::date + TIME '06:45:00', (NOW() - INTERVAL '22 days')::date, true,  'demo_seed'),

  -- Week 2 (21–15 days ago) — ~104.5 kg, plateau
  (v_uid, 105.0, (NOW() - INTERVAL '21 days')::date + TIME '19:00:00', (NOW() - INTERVAL '21 days')::date, false, 'demo_seed'),
  (v_uid, 104.3, (NOW() - INTERVAL '21 days')::date + TIME '07:00:00', (NOW() - INTERVAL '21 days')::date, true,  'demo_seed'),
  (v_uid, 104.8, (NOW() - INTERVAL '20 days')::date + TIME '07:30:00', (NOW() - INTERVAL '20 days')::date, true,  'demo_seed'),
  -- day 19 skipped
  (v_uid, 104.2, (NOW() - INTERVAL '18 days')::date + TIME '07:00:00', (NOW() - INTERVAL '18 days')::date, true,  'demo_seed'),
  (v_uid, 104.6, (NOW() - INTERVAL '17 days')::date + TIME '08:00:00', (NOW() - INTERVAL '17 days')::date, true,  'demo_seed'),
  (v_uid, 103.9, (NOW() - INTERVAL '16 days')::date + TIME '07:00:00', (NOW() - INTERVAL '16 days')::date, true,  'demo_seed'),
  (v_uid, 104.4, (NOW() - INTERVAL '15 days')::date + TIME '07:15:00', (NOW() - INTERVAL '15 days')::date, true,  'demo_seed'),

  -- Week 3 (14–8 days ago) — ~103.5 kg, trend clearer
  (v_uid, 103.7, (NOW() - INTERVAL '14 days')::date + TIME '07:00:00', (NOW() - INTERVAL '14 days')::date, true,  'demo_seed'),
  -- day 13 skipped
  (v_uid, 104.1, (NOW() - INTERVAL '12 days')::date + TIME '07:30:00', (NOW() - INTERVAL '12 days')::date, true,  'demo_seed'),
  (v_uid, 103.5, (NOW() - INTERVAL '11 days')::date + TIME '07:00:00', (NOW() - INTERVAL '11 days')::date, true,  'demo_seed'),
  (v_uid, 103.8, (NOW() - INTERVAL '10 days')::date + TIME '20:00:00', (NOW() - INTERVAL '10 days')::date, false, 'demo_seed'),
  (v_uid, 103.3, (NOW() - INTERVAL '10 days')::date + TIME '07:00:00', (NOW() - INTERVAL '10 days')::date, true,  'demo_seed'),
  (v_uid, 103.6, (NOW() - INTERVAL  '9 days')::date + TIME '08:00:00', (NOW() - INTERVAL  '9 days')::date, true,  'demo_seed'),
  (v_uid, 103.2, (NOW() - INTERVAL  '8 days')::date + TIME '07:00:00', (NOW() - INTERVAL  '8 days')::date, true,  'demo_seed'),

  -- Week 4 (7–1 days ago) — ~103 kg, continued decline
  (v_uid, 103.5, (NOW() - INTERVAL  '7 days')::date + TIME '07:00:00', (NOW() - INTERVAL  '7 days')::date, true,  'demo_seed'),
  (v_uid, 102.9, (NOW() - INTERVAL  '6 days')::date + TIME '07:15:00', (NOW() - INTERVAL  '6 days')::date, true,  'demo_seed'),
  (v_uid, 103.1, (NOW() - INTERVAL  '5 days')::date + TIME '08:00:00', (NOW() - INTERVAL  '5 days')::date, true,  'demo_seed'),
  -- day 4 skipped
  (v_uid, 102.7, (NOW() - INTERVAL  '3 days')::date + TIME '07:00:00', (NOW() - INTERVAL  '3 days')::date, true,  'demo_seed'),
  (v_uid, 103.0, (NOW() - INTERVAL  '2 days')::date + TIME '07:30:00', (NOW() - INTERVAL  '2 days')::date, true,  'demo_seed'),
  (v_uid, 102.6, (NOW() - INTERVAL  '1 day' )::date + TIME '07:00:00', (NOW() - INTERVAL  '1 day' )::date, true,  'demo_seed');

  RAISE NOTICE 'Inserted 26 demo weight entries for user %', v_uid;
END $$;


-- ── To delete the demo data ───────────────────────────────────────────────────
-- Replace the DO block above with this, or run it separately:
--
-- DO $$
-- DECLARE v_uid uuid;
-- BEGIN
--   SELECT user_id INTO v_uid FROM weight_logs ORDER BY measured_at DESC LIMIT 1;
--   DELETE FROM weight_logs WHERE user_id = v_uid AND source = 'demo_seed';
--   RAISE NOTICE 'Deleted demo rows for user %', v_uid;
-- END $$;
