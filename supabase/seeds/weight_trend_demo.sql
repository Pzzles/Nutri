-- Weight trend demo seed — 28 days of realistic daily weigh-ins.
--
-- Paste into: Supabase dashboard → SQL Editor → New query
-- To clean up: run the DELETE at the bottom.
--
-- Pattern: starts ~105 kg, drifts down ~0.5 kg/week with realistic noise.
-- Skips a few days (realistic). Two days have an earlier non-official entry.
-- All rows use source='demo_seed' for easy cleanup.

DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'tshehlap@gmail.com';
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'User tshehlap@gmail.com not found in auth.users';
  END IF;

  -- Guard: do not double-insert
  IF EXISTS (SELECT 1 FROM weight_logs WHERE user_id = v_uid AND source = 'demo_seed') THEN
    RAISE NOTICE 'Demo seed already present — nothing to do. Run the DELETE block to reset.';
    RETURN;
  END IF;

  INSERT INTO weight_logs (user_id, weight_kg, measured_at, logged_date, is_official, source) VALUES

  -- Week 1 (28–22 days ago) — ~105 kg range
  (v_uid, 105.4, (NOW() - INTERVAL '28 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '28 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 104.9, (NOW() - INTERVAL '27 days')::date + TIME '07:30:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '27 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 105.6, (NOW() - INTERVAL '26 days')::date + TIME '08:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '26 days')::date)::text::date, true,  'demo_seed'),
  -- day 25 skipped
  (v_uid, 105.1, (NOW() - INTERVAL '24 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '24 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 104.7, (NOW() - INTERVAL '23 days')::date + TIME '07:15:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '23 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 105.2, (NOW() - INTERVAL '22 days')::date + TIME '06:45:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '22 days')::date)::text::date, true,  'demo_seed'),

  -- Week 2 (21–15 days ago) — ~104.5 kg, plateau
  -- Day 21: evening non-official entry, then official morning entry
  (v_uid, 105.0, (NOW() - INTERVAL '21 days')::date + TIME '19:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '21 days')::date)::text::date, false, 'demo_seed'),
  (v_uid, 104.3, (NOW() - INTERVAL '21 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '21 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 104.8, (NOW() - INTERVAL '20 days')::date + TIME '07:30:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '20 days')::date)::text::date, true,  'demo_seed'),
  -- day 19 skipped
  (v_uid, 104.2, (NOW() - INTERVAL '18 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '18 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 104.6, (NOW() - INTERVAL '17 days')::date + TIME '08:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '17 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 103.9, (NOW() - INTERVAL '16 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '16 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 104.4, (NOW() - INTERVAL '15 days')::date + TIME '07:15:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '15 days')::date)::text::date, true,  'demo_seed'),

  -- Week 3 (14–8 days ago) — ~103.5 kg, trend clearer
  (v_uid, 103.7, (NOW() - INTERVAL '14 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '14 days')::date)::text::date, true,  'demo_seed'),
  -- day 13 skipped
  (v_uid, 104.1, (NOW() - INTERVAL '12 days')::date + TIME '07:30:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '12 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 103.5, (NOW() - INTERVAL '11 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '11 days')::date)::text::date, true,  'demo_seed'),
  -- Day 10: evening non-official entry, then official morning entry
  (v_uid, 103.8, (NOW() - INTERVAL '10 days')::date + TIME '20:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '10 days')::date)::text::date, false, 'demo_seed'),
  (v_uid, 103.3, (NOW() - INTERVAL '10 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL '10 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 103.6, (NOW() - INTERVAL  '9 days')::date + TIME '08:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL  '9 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 103.2, (NOW() - INTERVAL  '8 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL  '8 days')::date)::text::date, true,  'demo_seed'),

  -- Week 4 (7–1 days ago) — ~103 kg, continued decline
  (v_uid, 103.5, (NOW() - INTERVAL  '7 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL  '7 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 102.9, (NOW() - INTERVAL  '6 days')::date + TIME '07:15:00' + INTERVAL '2 hours', ((NOW() - INTERVAL  '6 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 103.1, (NOW() - INTERVAL  '5 days')::date + TIME '08:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL  '5 days')::date)::text::date, true,  'demo_seed'),
  -- day 4 skipped
  (v_uid, 102.7, (NOW() - INTERVAL  '3 days')::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL  '3 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 103.0, (NOW() - INTERVAL  '2 days')::date + TIME '07:30:00' + INTERVAL '2 hours', ((NOW() - INTERVAL  '2 days')::date)::text::date, true,  'demo_seed'),
  (v_uid, 102.6, (NOW() - INTERVAL  '1 day' )::date + TIME '07:00:00' + INTERVAL '2 hours', ((NOW() - INTERVAL  '1 day' )::date)::text::date, true,  'demo_seed');

  RAISE NOTICE 'Inserted demo weight seed for user %', v_uid;
END $$;


-- ── To delete the demo data ───────────────────────────────────────────────────
-- Uncomment and run this block when done:
--
-- DELETE FROM weight_logs
-- WHERE source = 'demo_seed'
--   AND user_id = (SELECT id FROM auth.users WHERE email = 'tshehlap@gmail.com');
