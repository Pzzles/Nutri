-- Visual seed data — fake meals and weight logs for chart demos.
-- Idempotent: guarded by raw_input = 'VISUAL_SEED' on meals and
-- notes = 'VISUAL_SEED' on weight_logs. Run twice → no duplicates.

DO $$
DECLARE
  v_uid uuid;
  -- food ids
  f_oats      uuid;  f_egg        uuid;  f_chicken    uuid;
  f_rice      uuid;  f_banana     uuid;  f_broccoli   uuid;
  f_yogurt    uuid;  f_peanut     uuid;  f_milk       uuid;
  f_potato    uuid;  f_salmon     uuid;  f_almonds    uuid;
  f_bread     uuid;  f_avocado    uuid;
  -- meal id reused
  m           uuid;
BEGIN
  -- ── locate user ──────────────────────────────────────────────────────────
  SELECT id INTO v_uid FROM auth.users WHERE email = 'tshehlap@gmail.com';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'User pule.tshetlha@tyme.com not found'; END IF;

  -- ── ensure profile exists ────────────────────────────────────────────────
  INSERT INTO profiles (id, timezone)
  VALUES (v_uid, 'Africa/Johannesburg')
  ON CONFLICT (id) DO NOTHING;

  -- ── idempotency guard ────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM meals WHERE user_id = v_uid AND raw_input = 'VISUAL_SEED') THEN
    RAISE NOTICE 'Visual seed already present — nothing to do.';
    RETURN;
  END IF;

  -- ── seed foods ───────────────────────────────────────────────────────────
  -- Each uses WHERE NOT EXISTS so running the script twice won't duplicate foods.

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Rolled Oats','rolled oats','user_manual',80,370,13,58,7,10,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='rolled oats' AND source='user_manual');
  SELECT id INTO f_oats FROM foods WHERE normalized_name='rolled oats' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Egg (large)','egg large','user_manual',60,155,13,1.1,11,0,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='egg large' AND source='user_manual');
  SELECT id INTO f_egg FROM foods WHERE normalized_name='egg large' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Chicken Breast','chicken breast','user_manual',150,165,31,0,3.6,0,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='chicken breast' AND source='user_manual');
  SELECT id INTO f_chicken FROM foods WHERE normalized_name='chicken breast' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Brown Rice (cooked)','brown rice cooked','user_manual',180,111,2.6,23,0.9,1.8,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='brown rice cooked' AND source='user_manual');
  SELECT id INTO f_rice FROM foods WHERE normalized_name='brown rice cooked' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Banana','banana','user_manual',120,89,1.1,23,0.3,2.6,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='banana' AND source='user_manual');
  SELECT id INTO f_banana FROM foods WHERE normalized_name='banana' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Broccoli','broccoli','user_manual',150,34,2.8,7,0.4,2.6,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='broccoli' AND source='user_manual');
  SELECT id INTO f_broccoli FROM foods WHERE normalized_name='broccoli' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Greek Yogurt','greek yogurt','user_manual',170,59,10,3.6,0.4,0,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='greek yogurt' AND source='user_manual');
  SELECT id INTO f_yogurt FROM foods WHERE normalized_name='greek yogurt' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Peanut Butter','peanut butter','user_manual',32,588,25,20,50,6,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='peanut butter' AND source='user_manual');
  SELECT id INTO f_peanut FROM foods WHERE normalized_name='peanut butter' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Whole Milk','whole milk','user_manual',240,61,3.2,4.8,3.3,0,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='whole milk' AND source='user_manual');
  SELECT id INTO f_milk FROM foods WHERE normalized_name='whole milk' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Sweet Potato','sweet potato','user_manual',130,86,1.6,20,0.1,3,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='sweet potato' AND source='user_manual');
  SELECT id INTO f_potato FROM foods WHERE normalized_name='sweet potato' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Salmon','salmon','user_manual',150,208,20,0,13,0,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='salmon' AND source='user_manual');
  SELECT id INTO f_salmon FROM foods WHERE normalized_name='salmon' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Almonds','almonds','user_manual',28,579,21,22,50,12.5,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='almonds' AND source='user_manual');
  SELECT id INTO f_almonds FROM foods WHERE normalized_name='almonds' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Whole Wheat Bread','whole wheat bread','user_manual',30,247,9,48,3.3,6.4,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='whole wheat bread' AND source='user_manual');
  SELECT id INTO f_bread FROM foods WHERE normalized_name='whole wheat bread' AND source='user_manual' LIMIT 1;

  INSERT INTO foods (name, normalized_name, source, serving_size_g, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, verified)
  SELECT 'Avocado','avocado','user_manual',80,160,2,9,15,6.7,false
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE normalized_name='avocado' AND source='user_manual');
  SELECT id INTO f_avocado FROM foods WHERE normalized_name='avocado' AND source='user_manual' LIMIT 1;

  -- ── weight logs (9 weeks trending down: 87.2 → 84.1 kg) ─────────────────
  IF NOT EXISTS (SELECT 1 FROM weight_logs WHERE user_id = v_uid AND notes = 'VISUAL_SEED') THEN
    INSERT INTO weight_logs (user_id, weight_kg, measured_at, logged_date, is_official, notes) VALUES
      (v_uid, 87.2, '2026-06-03 07:30:00+02', '2026-06-03', true, 'VISUAL_SEED'),
      (v_uid, 86.9, '2026-06-10 07:30:00+02', '2026-06-10', true, 'VISUAL_SEED'),
      (v_uid, 86.4, '2026-06-17 07:30:00+02', '2026-06-17', true, 'VISUAL_SEED'),
      (v_uid, 86.0, '2026-06-24 07:30:00+02', '2026-06-24', true, 'VISUAL_SEED'),
      (v_uid, 85.6, '2026-07-01 07:30:00+02', '2026-07-01', true, 'VISUAL_SEED'),
      (v_uid, 85.1, '2026-07-08 07:30:00+02', '2026-07-08', true, 'VISUAL_SEED'),
      (v_uid, 84.8, '2026-07-15 07:30:00+02', '2026-07-15', true, 'VISUAL_SEED'),
      (v_uid, 84.4, '2026-07-22 07:30:00+02', '2026-07-22', true, 'VISUAL_SEED'),
      (v_uid, 84.1, '2026-07-29 07:30:00+02', '2026-07-29', true, 'VISUAL_SEED');
  END IF;

  -- ── helper macro: inserts one meal_item and returns nothing ───────────────
  -- (inline calculation: calories = ROUND(cal100 * g / 100, 1))

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2026-07-23  ~1800 kcal
  -- ══════════════════════════════════════════════════════════════════════════

  -- Breakfast
  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'breakfast', 'high', '2026-07-23 08:00:00+02', '2026-07-23')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_oats,   '["oatmeal"]',   1, 'serving', 80,  ROUND((370*80/100)::numeric,1),  ROUND((13*80/100)::numeric,1),  ROUND((58*80/100)::numeric,1),  ROUND((7*80/100)::numeric,1),  ROUND((10*80/100)::numeric,1),  'exact','exact','high','user_manual'),
    (m, f_milk,   '["milk"]',      1, 'cup',    200,  ROUND((61*200/100)::numeric,1),  ROUND((3.2*200/100)::numeric,1),ROUND((4.8*200/100)::numeric,1),ROUND((3.3*200/100)::numeric,1),null,                           'exact','exact','high','user_manual'),
    (m, f_banana, '["banana"]',    1, null,     120,  ROUND((89*120/100)::numeric,1),  ROUND((1.1*120/100)::numeric,1),ROUND((23*120/100)::numeric,1), ROUND((0.3*120/100)::numeric,1),ROUND((2.6*120/100)::numeric,1),'exact','exact','high','user_manual');

  -- Lunch
  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'lunch', 'high', '2026-07-23 13:00:00+02', '2026-07-23')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_chicken,  '["chicken"]', 1, null, 180, ROUND((165*180/100)::numeric,1), ROUND((31*180/100)::numeric,1),  ROUND((0*180/100)::numeric,1),  ROUND((3.6*180/100)::numeric,1), null,                           'exact','exact','high','user_manual'),
    (m, f_rice,     '["rice"]',    1, null, 200, ROUND((111*200/100)::numeric,1), ROUND((2.6*200/100)::numeric,1), ROUND((23*200/100)::numeric,1),  ROUND((0.9*200/100)::numeric,1), ROUND((1.8*200/100)::numeric,1),'exact','exact','high','user_manual'),
    (m, f_broccoli, '["broccoli"]',1, null, 150, ROUND((34*150/100)::numeric,1),  ROUND((2.8*150/100)::numeric,1), ROUND((7*150/100)::numeric,1),   ROUND((0.4*150/100)::numeric,1), ROUND((2.6*150/100)::numeric,1),'exact','exact','high','user_manual');

  -- Dinner
  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'dinner', 'high', '2026-07-23 19:00:00+02', '2026-07-23')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_salmon,  '["salmon"]',       1, null, 160, ROUND((208*160/100)::numeric,1), ROUND((20*160/100)::numeric,1), 0,                              ROUND((13*160/100)::numeric,1), null,                           'exact','exact','high','user_manual'),
    (m, f_potato,  '["sweet potato"]', 1, null, 150, ROUND((86*150/100)::numeric,1),  ROUND((1.6*150/100)::numeric,1),ROUND((20*150/100)::numeric,1), ROUND((0.1*150/100)::numeric,1),ROUND((3*150/100)::numeric,1),  'exact','exact','high','user_manual'),
    (m, f_broccoli,'["broccoli"]',     1, null, 100, ROUND((34*100/100)::numeric,1),  ROUND((2.8*100/100)::numeric,1),ROUND((7*100/100)::numeric,1),  ROUND((0.4*100/100)::numeric,1),ROUND((2.6*100/100)::numeric,1),'exact','exact','high','user_manual');

  -- Snack
  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'snack', 'high', '2026-07-23 21:30:00+02', '2026-07-23')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_almonds, '["almonds"]', 1, null, 30, ROUND((579*30/100)::numeric,1), ROUND((21*30/100)::numeric,1), ROUND((22*30/100)::numeric,1), ROUND((50*30/100)::numeric,1), ROUND((12.5*30/100)::numeric,1), 'exact','exact','high','user_manual');

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2026-07-24  ~2160 kcal
  -- ══════════════════════════════════════════════════════════════════════════

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'breakfast', 'high', '2026-07-24 07:30:00+02', '2026-07-24')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_oats,   '["oatmeal"]', 1, 'serving', 100, ROUND((370*100/100)::numeric,1), ROUND((13*100/100)::numeric,1), ROUND((58*100/100)::numeric,1), ROUND((7*100/100)::numeric,1),  ROUND((10*100/100)::numeric,1), 'exact','exact','high','user_manual'),
    (m, f_yogurt, '["yogurt"]',  1, null,       170, ROUND((59*170/100)::numeric,1),  ROUND((10*170/100)::numeric,1), ROUND((3.6*170/100)::numeric,1),ROUND((0.4*170/100)::numeric,1),null,                           'exact','exact','high','user_manual'),
    (m, f_banana, '["banana"]',  1, null,       120, ROUND((89*120/100)::numeric,1),  ROUND((1.1*120/100)::numeric,1),ROUND((23*120/100)::numeric,1), ROUND((0.3*120/100)::numeric,1),ROUND((2.6*120/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'lunch', 'high', '2026-07-24 13:00:00+02', '2026-07-24')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_chicken,  '["chicken"]', 1, null, 220, ROUND((165*220/100)::numeric,1), ROUND((31*220/100)::numeric,1),  ROUND((0*220/100)::numeric,1),  ROUND((3.6*220/100)::numeric,1),null,                           'exact','exact','high','user_manual'),
    (m, f_rice,     '["rice"]',    1, null, 220, ROUND((111*220/100)::numeric,1), ROUND((2.6*220/100)::numeric,1), ROUND((23*220/100)::numeric,1),  ROUND((0.9*220/100)::numeric,1),ROUND((1.8*220/100)::numeric,1),'exact','exact','high','user_manual'),
    (m, f_avocado,  '["avocado"]', 1, null,  80, ROUND((160*80/100)::numeric,1),  ROUND((2*80/100)::numeric,1),    ROUND((9*80/100)::numeric,1),    ROUND((15*80/100)::numeric,1),  ROUND((6.7*80/100)::numeric,1), 'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'dinner', 'high', '2026-07-24 19:30:00+02', '2026-07-24')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_salmon,  '["salmon"]',       1, null, 200, ROUND((208*200/100)::numeric,1), ROUND((20*200/100)::numeric,1), 0,                              ROUND((13*200/100)::numeric,1), null,                           'exact','exact','high','user_manual'),
    (m, f_potato,  '["sweet potato"]', 1, null, 200, ROUND((86*200/100)::numeric,1),  ROUND((1.6*200/100)::numeric,1),ROUND((20*200/100)::numeric,1), ROUND((0.1*200/100)::numeric,1),ROUND((3*200/100)::numeric,1),  'exact','exact','high','user_manual'),
    (m, f_broccoli,'["broccoli"]',     1, null, 120, ROUND((34*120/100)::numeric,1),  ROUND((2.8*120/100)::numeric,1),ROUND((7*120/100)::numeric,1),  ROUND((0.4*120/100)::numeric,1),ROUND((2.6*120/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'snack', 'high', '2026-07-24 22:00:00+02', '2026-07-24')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_yogurt, '["yogurt"]',       1, null, 100, ROUND((59*100/100)::numeric,1),  ROUND((10*100/100)::numeric,1), ROUND((3.6*100/100)::numeric,1),ROUND((0.4*100/100)::numeric,1),null,                           'exact','exact','high','user_manual'),
    (m, f_peanut, '["peanut butter"]',1, null,  32, ROUND((588*32/100)::numeric,1),  ROUND((25*32/100)::numeric,1),  ROUND((20*32/100)::numeric,1),  ROUND((50*32/100)::numeric,1),  ROUND((6*32/100)::numeric,1),   'exact','exact','high','user_manual');

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2026-07-25  ~1530 kcal  (lighter day)
  -- ══════════════════════════════════════════════════════════════════════════

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'breakfast', 'high', '2026-07-25 08:30:00+02', '2026-07-25')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_egg,    '["eggs"]',    2, null,  120, ROUND((155*120/100)::numeric,1), ROUND((13*120/100)::numeric,1),  ROUND((1.1*120/100)::numeric,1),ROUND((11*120/100)::numeric,1), null,                           'exact','exact','high','user_manual'),
    (m, f_bread,  '["toast"]',   2, null,   60, ROUND((247*60/100)::numeric,1),  ROUND((9*60/100)::numeric,1),    ROUND((48*60/100)::numeric,1),  ROUND((3.3*60/100)::numeric,1), ROUND((6.4*60/100)::numeric,1), 'exact','exact','high','user_manual'),
    (m, f_avocado,'["avocado"]', 1, null,   60, ROUND((160*60/100)::numeric,1),  ROUND((2*60/100)::numeric,1),    ROUND((9*60/100)::numeric,1),   ROUND((15*60/100)::numeric,1),  ROUND((6.7*60/100)::numeric,1), 'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'lunch', 'high', '2026-07-25 13:30:00+02', '2026-07-25')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_chicken,  '["chicken"]', 1, null, 150, ROUND((165*150/100)::numeric,1), ROUND((31*150/100)::numeric,1),  ROUND((0*150/100)::numeric,1),  ROUND((3.6*150/100)::numeric,1),null,                           'exact','exact','high','user_manual'),
    (m, f_rice,     '["rice"]',    1, null, 160, ROUND((111*160/100)::numeric,1), ROUND((2.6*160/100)::numeric,1), ROUND((23*160/100)::numeric,1), ROUND((0.9*160/100)::numeric,1),ROUND((1.8*160/100)::numeric,1),'exact','exact','high','user_manual'),
    (m, f_broccoli, '["broccoli"]',1, null, 120, ROUND((34*120/100)::numeric,1),  ROUND((2.8*120/100)::numeric,1), ROUND((7*120/100)::numeric,1),  ROUND((0.4*120/100)::numeric,1),ROUND((2.6*120/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'dinner', 'medium', '2026-07-25 19:00:00+02', '2026-07-25')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_yogurt, '["yogurt"]',  1, null, 200, ROUND((59*200/100)::numeric,1),  ROUND((10*200/100)::numeric,1), ROUND((3.6*200/100)::numeric,1),ROUND((0.4*200/100)::numeric,1),null,                          'exact','exact','high','user_manual'),
    (m, f_banana, '["banana"]',  1, null, 120, ROUND((89*120/100)::numeric,1),  ROUND((1.1*120/100)::numeric,1),ROUND((23*120/100)::numeric,1), ROUND((0.3*120/100)::numeric,1),ROUND((2.6*120/100)::numeric,1),'exact','exact','high','user_manual');

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2026-07-26  ~2270 kcal  (bigger day)
  -- ══════════════════════════════════════════════════════════════════════════

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'breakfast', 'high', '2026-07-26 08:00:00+02', '2026-07-26')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_oats,   '["oatmeal"]', 1, 'serving', 100, ROUND((370*100/100)::numeric,1), ROUND((13*100/100)::numeric,1), ROUND((58*100/100)::numeric,1), ROUND((7*100/100)::numeric,1),  ROUND((10*100/100)::numeric,1),'exact','exact','high','user_manual'),
    (m, f_egg,    '["eggs"]',    2, null,       120, ROUND((155*120/100)::numeric,1), ROUND((13*120/100)::numeric,1), ROUND((1.1*120/100)::numeric,1),ROUND((11*120/100)::numeric,1), null,                          'exact','exact','high','user_manual'),
    (m, f_milk,   '["milk"]',    1, 'cup',      200, ROUND((61*200/100)::numeric,1),  ROUND((3.2*200/100)::numeric,1),ROUND((4.8*200/100)::numeric,1),ROUND((3.3*200/100)::numeric,1),null,                          'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'lunch', 'high', '2026-07-26 13:00:00+02', '2026-07-26')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_chicken,  '["chicken"]', 1, null, 250, ROUND((165*250/100)::numeric,1), ROUND((31*250/100)::numeric,1),  ROUND((0*250/100)::numeric,1),  ROUND((3.6*250/100)::numeric,1),null,                           'exact','exact','high','user_manual'),
    (m, f_rice,     '["rice"]',    1, null, 240, ROUND((111*240/100)::numeric,1), ROUND((2.6*240/100)::numeric,1), ROUND((23*240/100)::numeric,1), ROUND((0.9*240/100)::numeric,1),ROUND((1.8*240/100)::numeric,1),'exact','exact','high','user_manual'),
    (m, f_avocado,  '["avocado"]', 1, null,  80, ROUND((160*80/100)::numeric,1),  ROUND((2*80/100)::numeric,1),    ROUND((9*80/100)::numeric,1),   ROUND((15*80/100)::numeric,1),  ROUND((6.7*80/100)::numeric,1), 'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'snack', 'high', '2026-07-26 15:30:00+02', '2026-07-26')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_peanut, '["peanut butter"]',1, null, 32, ROUND((588*32/100)::numeric,1), ROUND((25*32/100)::numeric,1), ROUND((20*32/100)::numeric,1), ROUND((50*32/100)::numeric,1), ROUND((6*32/100)::numeric,1),  'exact','exact','high','user_manual'),
    (m, f_bread,  '["bread"]',        2, null, 60, ROUND((247*60/100)::numeric,1), ROUND((9*60/100)::numeric,1),  ROUND((48*60/100)::numeric,1), ROUND((3.3*60/100)::numeric,1),ROUND((6.4*60/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'dinner', 'high', '2026-07-26 19:30:00+02', '2026-07-26')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_salmon,   '["salmon"]',       1, null, 180, ROUND((208*180/100)::numeric,1), ROUND((20*180/100)::numeric,1), 0,                              ROUND((13*180/100)::numeric,1), null,                           'exact','exact','high','user_manual'),
    (m, f_potato,   '["sweet potato"]', 1, null, 200, ROUND((86*200/100)::numeric,1),  ROUND((1.6*200/100)::numeric,1),ROUND((20*200/100)::numeric,1), ROUND((0.1*200/100)::numeric,1),ROUND((3*200/100)::numeric,1),  'exact','exact','high','user_manual'),
    (m, f_broccoli, '["broccoli"]',     1, null, 150, ROUND((34*150/100)::numeric,1),  ROUND((2.8*150/100)::numeric,1),ROUND((7*150/100)::numeric,1),  ROUND((0.4*150/100)::numeric,1),ROUND((2.6*150/100)::numeric,1),'exact','exact','high','user_manual');

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2026-07-27  ~1990 kcal
  -- ══════════════════════════════════════════════════════════════════════════

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'breakfast', 'high', '2026-07-27 08:00:00+02', '2026-07-27')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_oats,   '["oatmeal"]', 1, 'serving',  80, ROUND((370*80/100)::numeric,1),  ROUND((13*80/100)::numeric,1),  ROUND((58*80/100)::numeric,1),  ROUND((7*80/100)::numeric,1),  ROUND((10*80/100)::numeric,1), 'exact','exact','high','user_manual'),
    (m, f_yogurt, '["yogurt"]',  1, null,       170, ROUND((59*170/100)::numeric,1),  ROUND((10*170/100)::numeric,1), ROUND((3.6*170/100)::numeric,1),ROUND((0.4*170/100)::numeric,1),null,                          'exact','exact','high','user_manual'),
    (m, f_banana, '["banana"]',  1, null,       120, ROUND((89*120/100)::numeric,1),  ROUND((1.1*120/100)::numeric,1),ROUND((23*120/100)::numeric,1), ROUND((0.3*120/100)::numeric,1),ROUND((2.6*120/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'lunch', 'high', '2026-07-27 13:00:00+02', '2026-07-27')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_chicken,  '["chicken"]', 1, null, 200, ROUND((165*200/100)::numeric,1), ROUND((31*200/100)::numeric,1),  ROUND((0*200/100)::numeric,1),  ROUND((3.6*200/100)::numeric,1),null,                           'exact','exact','high','user_manual'),
    (m, f_rice,     '["rice"]',    1, null, 200, ROUND((111*200/100)::numeric,1), ROUND((2.6*200/100)::numeric,1), ROUND((23*200/100)::numeric,1), ROUND((0.9*200/100)::numeric,1),ROUND((1.8*200/100)::numeric,1),'exact','exact','high','user_manual'),
    (m, f_broccoli, '["broccoli"]',1, null, 150, ROUND((34*150/100)::numeric,1),  ROUND((2.8*150/100)::numeric,1), ROUND((7*150/100)::numeric,1),  ROUND((0.4*150/100)::numeric,1),ROUND((2.6*150/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'dinner', 'high', '2026-07-27 19:00:00+02', '2026-07-27')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_salmon,   '["salmon"]',       1, null, 170, ROUND((208*170/100)::numeric,1), ROUND((20*170/100)::numeric,1), 0,                              ROUND((13*170/100)::numeric,1), null,                           'exact','exact','high','user_manual'),
    (m, f_potato,   '["sweet potato"]', 1, null, 150, ROUND((86*150/100)::numeric,1),  ROUND((1.6*150/100)::numeric,1),ROUND((20*150/100)::numeric,1), ROUND((0.1*150/100)::numeric,1),ROUND((3*150/100)::numeric,1),  'exact','exact','high','user_manual'),
    (m, f_broccoli, '["broccoli"]',     1, null, 100, ROUND((34*100/100)::numeric,1),  ROUND((2.8*100/100)::numeric,1),ROUND((7*100/100)::numeric,1),  ROUND((0.4*100/100)::numeric,1),ROUND((2.6*100/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'snack', 'high', '2026-07-27 21:00:00+02', '2026-07-27')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_almonds, '["almonds"]', 1, null, 28, ROUND((579*28/100)::numeric,1), ROUND((21*28/100)::numeric,1), ROUND((22*28/100)::numeric,1), ROUND((50*28/100)::numeric,1), ROUND((12.5*28/100)::numeric,1), 'exact','exact','high','user_manual');

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2026-07-28  ~2060 kcal
  -- ══════════════════════════════════════════════════════════════════════════

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'breakfast', 'high', '2026-07-28 08:00:00+02', '2026-07-28')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_egg,    '["eggs"]',    3, null,  180, ROUND((155*180/100)::numeric,1), ROUND((13*180/100)::numeric,1),  ROUND((1.1*180/100)::numeric,1),ROUND((11*180/100)::numeric,1), null,                           'exact','exact','high','user_manual'),
    (m, f_bread,  '["toast"]',   2, null,   60, ROUND((247*60/100)::numeric,1),  ROUND((9*60/100)::numeric,1),    ROUND((48*60/100)::numeric,1),  ROUND((3.3*60/100)::numeric,1), ROUND((6.4*60/100)::numeric,1), 'exact','exact','high','user_manual'),
    (m, f_avocado,'["avocado"]', 1, null,   80, ROUND((160*80/100)::numeric,1),  ROUND((2*80/100)::numeric,1),    ROUND((9*80/100)::numeric,1),   ROUND((15*80/100)::numeric,1),  ROUND((6.7*80/100)::numeric,1), 'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'lunch', 'high', '2026-07-28 13:00:00+02', '2026-07-28')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_chicken,  '["chicken"]', 1, null, 200, ROUND((165*200/100)::numeric,1), ROUND((31*200/100)::numeric,1),  ROUND((0*200/100)::numeric,1),  ROUND((3.6*200/100)::numeric,1),null,                           'exact','exact','high','user_manual'),
    (m, f_rice,     '["rice"]',    1, null, 200, ROUND((111*200/100)::numeric,1), ROUND((2.6*200/100)::numeric,1), ROUND((23*200/100)::numeric,1), ROUND((0.9*200/100)::numeric,1),ROUND((1.8*200/100)::numeric,1),'exact','exact','high','user_manual'),
    (m, f_broccoli, '["broccoli"]',1, null, 150, ROUND((34*150/100)::numeric,1),  ROUND((2.8*150/100)::numeric,1), ROUND((7*150/100)::numeric,1),  ROUND((0.4*150/100)::numeric,1),ROUND((2.6*150/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'dinner', 'high', '2026-07-28 19:00:00+02', '2026-07-28')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_salmon,   '["salmon"]',       1, null, 180, ROUND((208*180/100)::numeric,1), ROUND((20*180/100)::numeric,1), 0,                              ROUND((13*180/100)::numeric,1), null,                           'exact','exact','high','user_manual'),
    (m, f_potato,   '["sweet potato"]', 1, null, 180, ROUND((86*180/100)::numeric,1),  ROUND((1.6*180/100)::numeric,1),ROUND((20*180/100)::numeric,1), ROUND((0.1*180/100)::numeric,1),ROUND((3*180/100)::numeric,1),  'exact','exact','high','user_manual'),
    (m, f_broccoli, '["broccoli"]',     1, null, 100, ROUND((34*100/100)::numeric,1),  ROUND((2.8*100/100)::numeric,1),ROUND((7*100/100)::numeric,1),  ROUND((0.4*100/100)::numeric,1),ROUND((2.6*100/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'snack', 'high', '2026-07-28 21:30:00+02', '2026-07-28')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_yogurt, '["yogurt"]',  1, null, 170, ROUND((59*170/100)::numeric,1),  ROUND((10*170/100)::numeric,1), ROUND((3.6*170/100)::numeric,1),ROUND((0.4*170/100)::numeric,1),null,                          'exact','exact','high','user_manual'),
    (m, f_almonds,'["almonds"]', 1, null,  28, ROUND((579*28/100)::numeric,1),  ROUND((21*28/100)::numeric,1),  ROUND((22*28/100)::numeric,1),  ROUND((50*28/100)::numeric,1),  ROUND((12.5*28/100)::numeric,1),'exact','exact','high','user_manual');

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2026-07-29  today — breakfast + snack only (~830 kcal, day in progress)
  -- ══════════════════════════════════════════════════════════════════════════

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'breakfast', 'high', '2026-07-29 08:00:00+02', '2026-07-29')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_oats,   '["oatmeal"]', 1, 'serving',  80, ROUND((370*80/100)::numeric,1),  ROUND((13*80/100)::numeric,1),  ROUND((58*80/100)::numeric,1),  ROUND((7*80/100)::numeric,1),  ROUND((10*80/100)::numeric,1), 'exact','exact','high','user_manual'),
    (m, f_milk,   '["milk"]',    1, 'cup',      200, ROUND((61*200/100)::numeric,1),  ROUND((3.2*200/100)::numeric,1),ROUND((4.8*200/100)::numeric,1),ROUND((3.3*200/100)::numeric,1),null,                          'exact','exact','high','user_manual'),
    (m, f_banana, '["banana"]',  1, null,       120, ROUND((89*120/100)::numeric,1),  ROUND((1.1*120/100)::numeric,1),ROUND((23*120/100)::numeric,1), ROUND((0.3*120/100)::numeric,1),ROUND((2.6*120/100)::numeric,1),'exact','exact','high','user_manual');

  INSERT INTO meals (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
  VALUES (v_uid, 'VISUAL_SEED', 'snack', 'high', '2026-07-29 10:30:00+02', '2026-07-29')
  RETURNING id INTO m;
  INSERT INTO meal_items (meal_id, food_id, raw_phrases, quantity, unit, weight_g, calories, protein_g, carbs_g, fat_g, fibre_g, match_confidence, portion_confidence, confidence, nutrition_source) VALUES
    (m, f_yogurt, '["yogurt"]',  1, null, 170, ROUND((59*170/100)::numeric,1),  ROUND((10*170/100)::numeric,1), ROUND((3.6*170/100)::numeric,1),ROUND((0.4*170/100)::numeric,1),null,                          'exact','exact','high','user_manual'),
    (m, f_almonds,'["almonds"]', 1, null,  28, ROUND((579*28/100)::numeric,1),  ROUND((21*28/100)::numeric,1),  ROUND((22*28/100)::numeric,1),  ROUND((50*28/100)::numeric,1),  ROUND((12.5*28/100)::numeric,1),'exact','exact','high','user_manual');

  RAISE NOTICE 'Visual seed inserted successfully.';
END $$;
