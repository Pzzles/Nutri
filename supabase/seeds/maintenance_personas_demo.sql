-- Observed-maintenance UI demo data: three switchable personas.
--
-- IMPORTANT
--   Use this only with a fresh anonymous user created in a private/incognito
--   browser window. The script intentionally replaces all data owned by that
--   demo user each time it runs. It refuses non-anonymous accounts and refuses
--   anonymous accounts that already contain non-demo data.
--
-- HOW TO USE
--   1. Open the app in a private/incognito window and wait for Dashboard to load.
--      The app creates a new anonymous Supabase user for that browser session.
--   2. In Supabase SQL Editor, find the new user:
--
--        SELECT id, created_at
--        FROM auth.users
--        WHERE is_anonymous = true
--        ORDER BY created_at DESC
--        LIMIT 5;
--
--   3. Replace YOUR_FRESH_ANONYMOUS_USER_UUID below.
--   4. Set v_persona to one of:
--        consistent_cut       - usable estimate, steady weight loss, 24/28 days
--        steady_maintenance   - usable estimate, stable weight, 21/28 days
--        provisional_bulk     - provisional estimate, weight gain, 18/28 days
--   5. Run the entire file, refresh the private window, and inspect Dashboard,
--      Log, Progress > Weight, and Progress > Maintenance.
--   6. Change v_persona and rerun this file to switch examples.
--   7. Run maintenance_personas_cleanup.sql when finished, then close the
--      private window.
--
-- All food amounts below are explicit gram weights. These are fictional demo
-- records for interface review, not portion guidance or nutrition advice.

DO $$
DECLARE
  v_uid       UUID := '00000000-0000-0000-0000-000000000000'; -- replace
  v_persona   TEXT := 'consistent_cut'; -- change to switch persona
  v_today     DATE := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_prefix    TEXT;
  v_demo_root TEXT;

  v_name       TEXT;
  v_birth_date DATE;
  v_sex        TEXT;
  v_height_cm  NUMERIC;
  v_activity   TEXT;
  v_mode       TEXT;
  v_start_kg   NUMERIC;
  v_target_kg  NUMERIC;
  v_rate       NUMERIC;
  v_target_kcal NUMERIC;
  v_protein     NUMERIC;
  v_carbs       NUMERIC;
  v_fat         NUMERIC;
  v_fibre       NUMERIC;
BEGIN
  IF v_uid = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION
      'Replace YOUR_FRESH_ANONYMOUS_USER_UUID with the UUID from the private browser session.';
  END IF;

  IF v_persona NOT IN ('consistent_cut', 'steady_maintenance', 'provisional_bulk') THEN
    RAISE EXCEPTION 'Unknown persona: %', v_persona;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous = true
  ) THEN
    RAISE EXCEPTION
      'User % is not an anonymous auth user. Refusing to alter a real account.', v_uid;
  END IF;

  -- A fresh anonymous account has only an empty profile. A previously seeded
  -- account is also safe to replace because its display name starts with [DEMO].
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_uid
      AND display_name NOT LIKE '[DEMO]%'
  ) OR (
    NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = v_uid AND display_name LIKE '[DEMO]%'
    )
    AND (
      EXISTS (SELECT 1 FROM public.meals WHERE user_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.weight_logs WHERE user_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.goal_phases WHERE user_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.daily_log_status WHERE user_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.user_goals WHERE user_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.saved_meals WHERE user_id = v_uid)
    )
  ) THEN
    RAISE EXCEPTION
      'Anonymous user % already has non-demo data. Create a fresh private browser session.', v_uid;
  END IF;

  v_demo_root := 'maintenance-persona-demo:' || v_uid::text;
  v_prefix    := v_demo_root || ':' || v_persona;

  -- Re-running this file switches personas. Removing the demo profile cascades
  -- through all user-owned demo rows. Demo foods are removed separately because
  -- their owner FK uses ON DELETE SET NULL.
  DELETE FROM public.profiles WHERE id = v_uid;
  DELETE FROM public.foods
  WHERE source_identifier LIKE v_demo_root || ':%';

  IF v_persona = 'consistent_cut' THEN
    v_name        := '[DEMO] Alex - consistent cut';
    v_birth_date  := DATE '1990-04-18';
    v_sex         := 'male';
    v_height_cm   := 178;
    v_activity    := 'moderate';
    v_mode        := 'cut';
    v_start_kg    := 92.0;
    v_target_kg   := 86.0;
    v_rate        := -0.50;
    v_target_kcal := 1850;
    v_protein     := 160;
    v_carbs       := 175;
    v_fat         := 55;
    v_fibre       := 30;
  ELSIF v_persona = 'steady_maintenance' THEN
    v_name        := '[DEMO] Sam - steady maintenance';
    v_birth_date  := DATE '1985-09-07';
    v_sex         := 'female';
    v_height_cm   := 165;
    v_activity    := 'light';
    v_mode        := 'maintenance';
    v_start_kg    := 72.4;
    v_target_kg   := 72.4;
    v_rate        := 0;
    v_target_kcal := 2050;
    v_protein     := 110;
    v_carbs       := 245;
    v_fat         := 65;
    v_fibre       := 28;
  ELSE
    v_name        := '[DEMO] Jordan - provisional bulk';
    v_birth_date  := DATE '1998-01-22';
    v_sex         := 'male';
    v_height_cm   := 183;
    v_activity    := 'active';
    v_mode        := 'bulk';
    v_start_kg    := 78.0;
    v_target_kg   := 82.0;
    v_rate        := 0.30;
    v_target_kcal := 3000;
    v_protein     := 175;
    v_carbs       := 390;
    v_fat         := 85;
    v_fibre       := 32;
  END IF;

  INSERT INTO public.profiles (
    id, display_name, birth_date, sex, height_cm, current_weight_kg,
    goal_weight_kg, activity_level, timezone
  ) VALUES (
    v_uid, v_name, v_birth_date, v_sex, v_height_cm, v_start_kg,
    v_target_kg, v_activity, 'Africa/Johannesburg'
  );

  INSERT INTO public.goal_phases (
    user_id, mode, status, started_at,
    starting_weight_kg, starting_weight_source,
    target_weight_kg, target_change_kg_per_week,
    target_calories, target_protein_g, target_carbs_g,
    target_fat_g, target_fibre_g
  ) VALUES (
    v_uid,
    v_mode,
    'active',
    ((v_today - 30) + TIME '00:00') AT TIME ZONE 'Africa/Johannesburg',
    v_start_kg,
    'manual',
    v_target_kg,
    v_rate,
    v_target_kcal,
    v_protein,
    v_carbs,
    v_fat,
    v_fibre
  );

  -- Persona-specific foods. Nutrition fields are per 100 g; meal-item snapshots
  -- below are calculated from explicit gram weights.
  IF v_persona = 'consistent_cut' THEN
    INSERT INTO public.foods (
      name, normalized_name, source, source_identifier, owner_user_id,
      calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g,
      verified, status
    ) VALUES
      ('Rolled oats',             'rolled oats '             || v_uid, 'user_manual', v_prefix || ':oats',          v_uid, 370, 13.0, 58.0,  7.0, 10.0, false, 'active'),
      ('Low-fat Greek yogurt',    'low fat greek yogurt '    || v_uid, 'user_manual', v_prefix || ':yogurt',        v_uid,  73,  9.9,  3.9,  2.0,  0.0, false, 'active'),
      ('Banana, peeled',          'banana peeled '           || v_uid, 'user_manual', v_prefix || ':banana',        v_uid,  89,  1.1, 23.0,  0.3,  2.6, false, 'active'),
      ('Chicken breast, cooked',  'chicken breast cooked '   || v_uid, 'user_manual', v_prefix || ':chicken',       v_uid, 165, 31.0,  0.0,  3.6,  0.0, false, 'active'),
      ('Brown rice, cooked',      'brown rice cooked '       || v_uid, 'user_manual', v_prefix || ':brown_rice',    v_uid, 111,  2.6, 23.0,  0.9,  1.8, false, 'active'),
      ('Broccoli, steamed',       'broccoli steamed '        || v_uid, 'user_manual', v_prefix || ':broccoli',      v_uid,  35,  2.4,  7.2,  0.4,  3.3, false, 'active'),
      ('Salmon, baked',           'salmon baked '            || v_uid, 'user_manual', v_prefix || ':salmon',        v_uid, 208, 20.0,  0.0, 13.0,  0.0, false, 'active'),
      ('Sweet potato, baked',     'sweet potato baked '      || v_uid, 'user_manual', v_prefix || ':sweet_potato',  v_uid,  90,  2.0, 20.7,  0.2,  3.3, false, 'active');
  ELSIF v_persona = 'steady_maintenance' THEN
    INSERT INTO public.foods (
      name, normalized_name, source, source_identifier, owner_user_id,
      calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g,
      verified, status
    ) VALUES
      ('Eggs, cooked',             'eggs cooked '             || v_uid, 'user_manual', v_prefix || ':eggs',        v_uid, 155, 13.0,  1.1, 11.0,  0.0, false, 'active'),
      ('Rye bread',                'rye bread '                || v_uid, 'user_manual', v_prefix || ':rye',         v_uid, 259,  8.5, 48.3,  3.3,  5.8, false, 'active'),
      ('Avocado',                  'avocado '                  || v_uid, 'user_manual', v_prefix || ':avocado',     v_uid, 160,  2.0,  8.5, 14.7,  6.7, false, 'active'),
      ('Lentils, cooked',          'lentils cooked '          || v_uid, 'user_manual', v_prefix || ':lentils',     v_uid, 116,  9.0, 20.1,  0.4,  7.9, false, 'active'),
      ('Quinoa, cooked',           'quinoa cooked '           || v_uid, 'user_manual', v_prefix || ':quinoa',      v_uid, 120,  4.4, 21.3,  1.9,  2.8, false, 'active'),
      ('Mixed vegetables, cooked', 'mixed vegetables cooked ' || v_uid, 'user_manual', v_prefix || ':vegetables',  v_uid,  50,  2.5, 10.0,  0.5,  3.5, false, 'active'),
      ('Olive oil',                'olive oil '                || v_uid, 'user_manual', v_prefix || ':olive_oil',   v_uid, 884,  0.0,  0.0,100.0,  0.0, false, 'active'),
      ('Firm tofu',                'firm tofu '                || v_uid, 'user_manual', v_prefix || ':tofu',        v_uid, 144, 17.3,  2.8,  8.7,  2.3, false, 'active'),
      ('Brown rice, cooked',       'brown rice cooked '       || v_uid, 'user_manual', v_prefix || ':brown_rice',  v_uid, 111,  2.6, 23.0,  0.9,  1.8, false, 'active');
  ELSE
    INSERT INTO public.foods (
      name, normalized_name, source, source_identifier, owner_user_id,
      calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g,
      verified, status
    ) VALUES
      ('Rolled oats',              'rolled oats '           || v_uid, 'user_manual', v_prefix || ':oats',         v_uid, 370, 13.0, 58.0,  7.0, 10.0, false, 'active'),
      ('Whole milk',               'whole milk '            || v_uid, 'user_manual', v_prefix || ':milk',         v_uid,  61,  3.2,  4.8,  3.3,  0.0, false, 'active'),
      ('Peanut butter',            'peanut butter '         || v_uid, 'user_manual', v_prefix || ':peanut',       v_uid, 588, 25.0, 20.0, 50.0,  6.0, false, 'active'),
      ('Banana, peeled',           'banana peeled '         || v_uid, 'user_manual', v_prefix || ':banana',       v_uid,  89,  1.1, 23.0,  0.3,  2.6, false, 'active'),
      ('Beef mince, cooked',       'beef mince cooked '     || v_uid, 'user_manual', v_prefix || ':beef',         v_uid, 250, 26.0,  0.0, 17.0,  0.0, false, 'active'),
      ('Pasta, cooked',            'pasta cooked '          || v_uid, 'user_manual', v_prefix || ':pasta',        v_uid, 158,  5.8, 30.9,  0.9,  1.8, false, 'active'),
      ('Tomato pasta sauce',       'tomato pasta sauce '    || v_uid, 'user_manual', v_prefix || ':sauce',        v_uid,  40,  1.5,  7.5,  0.8,  1.8, false, 'active'),
      ('Cheddar cheese',           'cheddar cheese '        || v_uid, 'user_manual', v_prefix || ':cheddar',      v_uid, 403, 24.9,  1.3, 33.1,  0.0, false, 'active'),
      ('Chicken breast, cooked',   'chicken breast cooked ' || v_uid, 'user_manual', v_prefix || ':chicken',      v_uid, 165, 31.0,  0.0,  3.6,  0.0, false, 'active'),
      ('White rice, cooked',       'white rice cooked '     || v_uid, 'user_manual', v_prefix || ':white_rice',   v_uid, 130,  2.7, 28.2,  0.3,  0.4, false, 'active'),
      ('Avocado',                  'avocado '                || v_uid, 'user_manual', v_prefix || ':avocado',      v_uid, 160,  2.0,  8.5, 14.7,  6.7, false, 'active');
  END IF;

  -- Twenty-eight exact daily weights. Small deterministic oscillations make the
  -- chart realistic while preserving the persona's overall direction.
  INSERT INTO public.weight_logs (
    user_id, weight_kg, measured_at, logged_date,
    is_official, notes, source
  )
  SELECT
    v_uid,
    ROUND((
      CASE v_persona
        WHEN 'consistent_cut' THEN 89.80 + (d * 0.075)
        WHEN 'steady_maintenance' THEN 72.40
        ELSE 79.20 - (d * 0.043)
      END
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
    v_prefix,
    'manual'
  FROM generate_series(1, 28) AS days(d);

  -- Insert breakfast, lunch, and dinner for each logged day. The maintenance
  -- persona intentionally skips every fourth day. The bulk persona has 18
  -- complete days plus two partially logged days.
  INSERT INTO public.meals (
    user_id, raw_input, parsed_json, meal_type,
    meal_confidence, eaten_at, logged_date
  )
  SELECT
    v_uid,
    v_prefix,
    jsonb_build_object('demo_persona', v_persona),
    meal_type,
    'high',
    ((v_today - d::INTEGER) + meal_time) AT TIME ZONE 'Africa/Johannesburg',
    v_today - d::INTEGER
  FROM generate_series(1, 28) AS days(d)
  CROSS JOIN (
    VALUES
      ('breakfast'::TEXT, TIME '08:00'),
      ('lunch'::TEXT,     TIME '13:00'),
      ('dinner'::TEXT,    TIME '19:00')
  ) AS meal_slots(meal_type, meal_time)
  WHERE
    (v_persona = 'consistent_cut' AND d <= 24)
    OR (v_persona = 'steady_maintenance' AND d % 4 <> 0)
    OR (v_persona = 'provisional_bulk' AND d <= 20);

  -- Exact menu composition for each meal. meal_items retain immutable nutrition
  -- snapshots calculated directly from each food's per-100-g values.
  WITH menu(persona, meal_type, food_key, weight_g) AS (
    VALUES
      ('consistent_cut',     'breakfast', 'oats',          80::NUMERIC),
      ('consistent_cut',     'breakfast', 'yogurt',       200::NUMERIC),
      ('consistent_cut',     'breakfast', 'banana',       120::NUMERIC),
      ('consistent_cut',     'lunch',     'chicken',      180::NUMERIC),
      ('consistent_cut',     'lunch',     'brown_rice',   250::NUMERIC),
      ('consistent_cut',     'lunch',     'broccoli',     150::NUMERIC),
      ('consistent_cut',     'dinner',    'salmon',       170::NUMERIC),
      ('consistent_cut',     'dinner',    'sweet_potato', 250::NUMERIC),
      ('consistent_cut',     'dinner',    'broccoli',     150::NUMERIC),

      ('steady_maintenance', 'breakfast', 'eggs',         120::NUMERIC),
      ('steady_maintenance', 'breakfast', 'rye',          100::NUMERIC),
      ('steady_maintenance', 'breakfast', 'avocado',       80::NUMERIC),
      ('steady_maintenance', 'lunch',     'lentils',      250::NUMERIC),
      ('steady_maintenance', 'lunch',     'quinoa',       200::NUMERIC),
      ('steady_maintenance', 'lunch',     'vegetables',   200::NUMERIC),
      ('steady_maintenance', 'lunch',     'olive_oil',     15::NUMERIC),
      ('steady_maintenance', 'dinner',    'tofu',         200::NUMERIC),
      ('steady_maintenance', 'dinner',    'brown_rice',   200::NUMERIC),
      ('steady_maintenance', 'dinner',    'vegetables',   200::NUMERIC),
      ('steady_maintenance', 'dinner',    'olive_oil',     10::NUMERIC),

      ('provisional_bulk',   'breakfast', 'oats',         100::NUMERIC),
      ('provisional_bulk',   'breakfast', 'milk',         400::NUMERIC),
      ('provisional_bulk',   'breakfast', 'peanut',        50::NUMERIC),
      ('provisional_bulk',   'breakfast', 'banana',       120::NUMERIC),
      ('provisional_bulk',   'lunch',     'beef',         200::NUMERIC),
      ('provisional_bulk',   'lunch',     'pasta',        300::NUMERIC),
      ('provisional_bulk',   'lunch',     'sauce',        150::NUMERIC),
      ('provisional_bulk',   'lunch',     'cheddar',       40::NUMERIC),
      ('provisional_bulk',   'dinner',    'chicken',      200::NUMERIC),
      ('provisional_bulk',   'dinner',    'white_rice',   300::NUMERIC),
      ('provisional_bulk',   'dinner',    'avocado',      100::NUMERIC)
  )
  INSERT INTO public.meal_items (
    meal_id, food_id, raw_phrases, quantity, unit, weight_g,
    calories, protein_g, carbs_g, fat_g, fibre_g,
    match_confidence, portion_confidence, confidence, nutrition_source
  )
  SELECT
    m.id,
    f.id,
    jsonb_build_array(f.name),
    menu.weight_g,
    'g',
    menu.weight_g,
    ROUND((f.calories_100g * menu.weight_g / 100)::NUMERIC, 1),
    ROUND((f.protein_100g  * menu.weight_g / 100)::NUMERIC, 1),
    ROUND((f.carbs_100g    * menu.weight_g / 100)::NUMERIC, 1),
    ROUND((f.fat_100g      * menu.weight_g / 100)::NUMERIC, 1),
    ROUND((COALESCE(f.fibre_100g, 0) * menu.weight_g / 100)::NUMERIC, 1),
    'exact',
    'exact',
    'high',
    'user_manual'
  FROM public.meals m
  JOIN menu
    ON menu.persona = v_persona
   AND menu.meal_type = m.meal_type
  JOIN public.foods f
    ON f.source_identifier = v_prefix || ':' || menu.food_key
  WHERE m.user_id = v_uid
    AND m.raw_input = v_prefix;

  -- Meal insertion reopens an already-complete day, so completeness is written
  -- last. Only explicit complete days contribute to observed maintenance.
  INSERT INTO public.daily_log_status (
    user_id, logged_date, status, marked_complete_at
  )
  SELECT
    v_uid,
    v_today - d::INTEGER,
    CASE
      WHEN v_persona = 'provisional_bulk' AND d IN (19, 20)
        THEN 'probably_complete'
      ELSE 'complete'
    END,
    CASE
      WHEN v_persona = 'provisional_bulk' AND d IN (19, 20)
        THEN NULL
      ELSE now()
    END
  FROM generate_series(1, 28) AS days(d)
  WHERE
    (v_persona = 'consistent_cut' AND d <= 24)
    OR (v_persona = 'steady_maintenance' AND d % 4 <> 0)
    OR (v_persona = 'provisional_bulk' AND d <= 20);

  RAISE NOTICE 'Loaded persona % for anonymous user %', v_persona, v_uid;
  RAISE NOTICE 'Refresh the private browser window, then open Progress > Maintenance.';
END $$;

-- Compact verification summary for the persona just loaded.
SELECT
  p.id AS demo_user_id,
  p.display_name,
  gp.mode,
  gp.started_at::date AS phase_started,
  COUNT(DISTINCT wl.logged_date) AS weight_days,
  COUNT(DISTINCT CASE WHEN dls.status = 'complete' THEN dls.logged_date END) AS complete_food_days,
  COUNT(DISTINCT CASE WHEN dls.status = 'probably_complete' THEN dls.logged_date END) AS partial_food_days,
  COUNT(DISTINCT m.id) AS meals
FROM public.profiles p
JOIN public.goal_phases gp
  ON gp.user_id = p.id AND gp.status = 'active'
LEFT JOIN public.weight_logs wl ON wl.user_id = p.id
LEFT JOIN public.daily_log_status dls ON dls.user_id = p.id
LEFT JOIN public.meals m ON m.user_id = p.id
WHERE p.display_name LIKE '[DEMO]%'
GROUP BY p.id, p.display_name, gp.mode, gp.started_at
ORDER BY gp.started_at DESC;
