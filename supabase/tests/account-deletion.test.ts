import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  ANON_KEY,
  SUPABASE_URL,
  createTestUser,
  deleteTestUser,
  signInAs,
  svcClient,
  testEmail,
} from "./helpers.js";

const DB_URL = process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const { Client } = pg;
const createdUsers = new Set<string>();

type DeletionResponse = {
  status: number;
  body: {
    success: boolean;
    data: { status: string; deleted: boolean } | null;
    error: { code: string; message: string } | null;
  };
};

async function createUser(label: string): Promise<{ userId: string; token: string }> {
  const email = testEmail(label);
  const userId = await createTestUser(email);
  createdUsers.add(userId);
  const { client } = await signInAs(email);
  const token = (await client.auth.getSession()).data.session!.access_token;
  return { userId, token };
}

async function deleteAccount(token: string, extra: Record<string, unknown> = {}): Promise<DeletionResponse> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirm: "DELETE MY ACCOUNT", ...extra }),
  });
  return { status: response.status, body: await response.json() } as DeletionResponse;
}

async function seedEverySubsystem(userId: string, token: string): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const suffix = userId.slice(0, 8);
  try {
    await db.query("BEGIN");
    const food = await db.query(
      `INSERT INTO public.foods
        (name, normalized_name, source, owner_user_id, calories_100g,
         protein_100g, carbs_100g, fat_100g, verified)
       VALUES ($1, $2, 'user_manual', $3, 100, 10, 20, 5, false)
       RETURNING id`,
      [`Deletion food ${suffix}`, `deletion food ${suffix}`, userId],
    );
    const foodId = food.rows[0].id;
    const weight = await db.query(
      `INSERT INTO public.weight_logs
        (user_id, weight_kg, measured_at, logged_date, is_official, source)
       VALUES ($1, 80, '2026-07-01T06:00:00Z', '2026-07-01', true, 'manual')
       RETURNING id`,
      [userId],
    );
    const goal = await db.query(
      `INSERT INTO public.goal_phases
        (user_id, mode, status, started_at, starting_weight_kg,
         starting_weight_source, target_change_kg_per_week, target_calories)
       VALUES ($1, 'maintenance', 'active', '2026-07-01T06:00:00Z',
         80, 'latest_weight_log', 0, 2000)
       RETURNING id`,
      [userId],
    );
    const goalId = goal.rows[0].id;
    await db.query(
      `INSERT INTO public.calorie_target_snapshots
        (user_id, goal_phase_id, algorithm_name, algorithm_version,
         activity_multiplier_version, profile_birth_date, equation_sex,
         height_cm, official_weight_kg, weight_log_id, age_years,
         activity_level, activity_multiplier, calculated_bmr_kcal,
         calculated_tdee_kcal, effective_maintenance_kcal, maintenance_source,
         goal_mode, raw_target_kcal, final_target_kcal)
       VALUES ($1, $2, 'mifflin_st_jeor', 'v1', 'v1', '1990-01-01',
         'female', 170, 80, $3, 36, 'moderate', 1.55, 1500, 2325,
         2325, 'equation_estimate', 'maintenance', 2325, 2325)`,
      [userId, goalId, weight.rows[0].id],
    );
    await db.query(
      `INSERT INTO public.maintenance_estimate_snapshots
        (user_id, goal_phase_id, goal_mode, goal_phase_started_at,
         analysis_window_start, analysis_window_end, analysis_calendar_days,
         selected_weight_window_days, timezone, eligible_nutrition_day_count,
         probably_complete_day_count, incomplete_day_count, not_logged_day_count,
         eligible_nutrition_coverage, average_intake_kcal, weekly_rate_kg,
         weight_trend_confidence, observed_maintenance_kcal, status, confidence)
       VALUES ($1, $2, 'maintenance', '2026-07-01T06:00:00Z',
         '2026-07-01', '2026-07-14', 14, 14, 'UTC', 1, 1, 0, 13,
         0.0714, 2000, 0, 'low', 2000, 'provisional', 'low')`,
      [userId, goalId],
    );
    await db.query(
      `INSERT INTO public.goal_feedback_assessments
        (user_id, goal_phase_id, goal_mode, goal_phase_started_at,
         assessed_at, progress_state, feedback_action,
         current_p6_status, current_p6_confidence)
       VALUES ($1, $2, 'maintenance', '2026-07-01T06:00:00Z',
         '2026-07-14T06:00:00Z', 'insufficient_data',
         'collect_more_data', 'insufficient_data', 'low')`,
      [userId, goalId],
    );
    const meal = await db.query(
      `INSERT INTO public.meals
        (user_id, raw_input, meal_type, meal_confidence, eaten_at, logged_date)
       VALUES ($1, 'deletion meal', 'breakfast', 'high',
         '2026-07-02T07:00:00Z', '2026-07-02') RETURNING id`,
      [userId],
    );
    const mealId = meal.rows[0].id;
    await db.query(
      `INSERT INTO public.meal_items
        (meal_id, food_id, calories, protein_g, carbs_g, fat_g,
         match_confidence, portion_confidence, confidence, nutrition_source)
       VALUES ($1, $2, 100, 10, 20, 5, 'exact', 'exact', 'high', 'user_manual')`,
      [mealId, foodId],
    );
    await db.query(
      `INSERT INTO public.meal_edit_log
        (meal_id, field_name, old_value, new_value, edited_by)
       VALUES ($1, 'raw_input', '"old"'::jsonb, '"new"'::jsonb, $2)`,
      [mealId, userId],
    );
    const savedMeal = await db.query(
      `INSERT INTO public.saved_meals (user_id, name, idempotency_key)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, `Saved ${suffix}`, `saved-${suffix}`],
    );
    await db.query(
      `INSERT INTO public.saved_meal_items (saved_meal_id, food_id, default_quantity, default_unit)
       VALUES ($1, $2, 100, 'g')`,
      [savedMeal.rows[0].id, foodId],
    );
    await db.query(
      `INSERT INTO public.user_saved_foods (user_id, food_id, is_favorite)
       VALUES ($1, $2, true)`,
      [userId, foodId],
    );
    await db.query(
      `INSERT INTO public.user_food_cache
        (user_id, normalized_query, matched_food_id, lookup_source, confidence)
       VALUES ($1, $2, $3, 'user_manual', 'exact')`,
      [userId, `cache ${suffix}`, foodId],
    );
    await db.query(
      `INSERT INTO public.user_food_portions (user_id, food_id, usual_g)
       VALUES ($1, $2, 100)`,
      [userId, foodId],
    );
    await db.query(
      `INSERT INTO public.global_cache_promotion_votes
        (normalized_query, matched_food_id, confirming_user_id)
       VALUES ($1, $2, $3)`,
      [`vote ${suffix}`, foodId, userId],
    );
    await db.query(
      `INSERT INTO public.food_synonyms (raw_term, canonical_term, created_by)
       VALUES ($1, $2, $3)`,
      [`raw ${suffix}`, `canonical ${suffix}`, userId],
    );
    await db.query(
      `INSERT INTO public.user_goals (user_id, target_calories, effective_from)
       VALUES ($1, 2000, '2026-07-01')`,
      [userId],
    );
    await db.query(
      `INSERT INTO public.daily_log_status (user_id, logged_date, status)
       VALUES ($1, '2026-07-02', 'partial')`,
      [userId],
    );
    await db.query(
      `INSERT INTO public.ai_parse_requests (user_id, meal_id, raw_text, parsed_result)
       VALUES ($1, $2, 'deletion parse', '{}'::jsonb)`,
      [userId, mealId],
    );
    await db.query(
      `INSERT INTO public.idempotency_keys
        (user_id, idempotency_key, function_name, response_json)
       VALUES ($1, $2, 'test', '{}'::jsonb)`,
      [userId, crypto.randomUUID()],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }

  const anthropometry = await fetch(
    `${SUPABASE_URL}/functions/v1/finalize-anthropometric-session`,
    {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        measured_at: "2026-07-10T06:00:00Z",
        protocol_version: "anthropometry_protocol_v1",
        idempotency_key: `account-delete-${suffix}`,
        sites: [{ site_code: "waist", readings_cm: [80, 80.4] }],
      }),
    },
  );
  if (anthropometry.status !== 201) {
    throw new Error(`Anthropometry seed failed: ${anthropometry.status}`);
  }
}

async function ownedCounts(userId: string): Promise<Record<string, number>> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const result = await db.query(
      `SELECT jsonb_build_object(
        'profiles', (SELECT count(*) FROM public.profiles WHERE id = $1),
        'foods', (SELECT count(*) FROM public.foods WHERE owner_user_id = $1),
        'user_saved_foods', (SELECT count(*) FROM public.user_saved_foods WHERE user_id = $1),
        'meals', (SELECT count(*) FROM public.meals WHERE user_id = $1),
        'meal_items', (SELECT count(*) FROM public.meal_items i JOIN public.meals m ON m.id=i.meal_id WHERE m.user_id = $1),
        'meal_edit_log', (SELECT count(*) FROM public.meal_edit_log WHERE edited_by = $1),
        'saved_meals', (SELECT count(*) FROM public.saved_meals WHERE user_id = $1),
        'saved_meal_items', (SELECT count(*) FROM public.saved_meal_items i JOIN public.saved_meals m ON m.id=i.saved_meal_id WHERE m.user_id = $1),
        'weight_logs', (SELECT count(*) FROM public.weight_logs WHERE user_id = $1),
        'user_food_cache', (SELECT count(*) FROM public.user_food_cache WHERE user_id = $1),
        'user_food_portions', (SELECT count(*) FROM public.user_food_portions WHERE user_id = $1),
        'global_cache_promotion_votes', (SELECT count(*) FROM public.global_cache_promotion_votes WHERE confirming_user_id = $1),
        'food_synonyms', (SELECT count(*) FROM public.food_synonyms WHERE created_by = $1),
        'user_goals', (SELECT count(*) FROM public.user_goals WHERE user_id = $1),
        'daily_log_status', (SELECT count(*) FROM public.daily_log_status WHERE user_id = $1),
        'ai_parse_requests', (SELECT count(*) FROM public.ai_parse_requests WHERE user_id = $1),
        'idempotency_keys', (SELECT count(*) FROM public.idempotency_keys WHERE user_id = $1),
        'goal_phases', (SELECT count(*) FROM public.goal_phases WHERE user_id = $1),
        'calorie_target_snapshots', (SELECT count(*) FROM public.calorie_target_snapshots WHERE user_id = $1),
        'maintenance_estimate_snapshots', (SELECT count(*) FROM public.maintenance_estimate_snapshots WHERE user_id = $1),
        'goal_feedback_assessments', (SELECT count(*) FROM public.goal_feedback_assessments WHERE user_id = $1),
        'anthropometric_sessions', (SELECT count(*) FROM public.anthropometric_sessions WHERE user_id = $1),
        'anthropometric_readings', (SELECT count(*) FROM public.anthropometric_readings WHERE user_id = $1),
        'anthropometric_representatives', (SELECT count(*) FROM public.anthropometric_representatives WHERE user_id = $1)
      ) AS counts`,
      [userId],
    );
    return result.rows[0].counts as Record<string, number>;
  } finally {
    await db.end();
  }
}

function expectAllPresent(counts: Record<string, number>): void {
  for (const [table, count] of Object.entries(counts)) {
    expect(count, `${table} should be populated`).toBeGreaterThan(0);
  }
}

function expectAllGone(counts: Record<string, number>): void {
  for (const [table, count] of Object.entries(counts)) {
    expect(count, `${table} should be erased`).toBe(0);
  }
}

async function authUserExists(userId: string): Promise<boolean> {
  const { data, error } = await svcClient().auth.admin.getUserById(userId);
  return !error && data.user.id === userId;
}

afterAll(async () => {
  for (const userId of createdUsers) {
    if (await authUserExists(userId)) await deleteTestUser(userId);
  }
});

describe("transactional Auth-cascade account deletion", () => {
  it("deletes a populated account across every owned subsystem and preserves another user", async () => {
    const subject = await createUser("account-delete-populated");
    const other = await createUser("account-delete-other");
    await seedEverySubsystem(subject.userId, subject.token);
    await seedEverySubsystem(other.userId, other.token);
    const beforeSubject = await ownedCounts(subject.userId);
    const beforeOther = await ownedCounts(other.userId);
    expectAllPresent(beforeSubject);
    expectAllPresent(beforeOther);

    const response = await deleteAccount(subject.token);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: "ACCOUNT_DELETION_COMPLETE",
      deleted: true,
    });
    expect(await authUserExists(subject.userId)).toBe(false);
    expectAllGone(await ownedCounts(subject.userId));
    expect(await authUserExists(other.userId)).toBe(true);
    expect(await ownedCounts(other.userId)).toEqual(beforeOther);
    createdUsers.delete(subject.userId);
  });

  it("deletes an empty account", async () => {
    const subject = await createUser("account-delete-empty");
    const response = await deleteAccount(subject.token);
    expect(response.status).toBe(200);
    expect(response.body.data?.status).toBe("ACCOUNT_DELETION_COMPLETE");
    expect(await authUserExists(subject.userId)).toBe(false);
    expectAllGone(await ownedCounts(subject.userId));
    createdUsers.delete(subject.userId);
  });

  it("never accepts a caller-supplied target user ID", async () => {
    const caller = await createUser("account-delete-caller");
    const target = await createUser("account-delete-target");
    await seedEverySubsystem(target.userId, target.token);
    const targetBefore = await ownedCounts(target.userId);
    const response = await deleteAccount(caller.token, { user_id: target.userId });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("FORBIDDEN_FIELD");
    expect(await authUserExists(caller.userId)).toBe(true);
    expect(await authUserExists(target.userId)).toBe(true);
    expect(await ownedCounts(target.userId)).toEqual(targetBefore);
  });

  it("handles double-click and post-completion retry without a server error", async () => {
    const subject = await createUser("account-delete-retry");
    const [left, right] = await Promise.all([
      deleteAccount(subject.token),
      deleteAccount(subject.token),
    ]);
    expect([left.status, right.status]).toContain(200);
    expect(left.status).toBeLessThan(500);
    expect(right.status).toBeLessThan(500);
    const postCompletion = await deleteAccount(subject.token);
    expect(postCompletion.status).toBe(401);
    expect(postCompletion.body.error?.code).toBe("UNAUTHENTICATED");
    expect(await authUserExists(subject.userId)).toBe(false);
    createdUsers.delete(subject.userId);
  });

  it("rolls back every cascade on database failure, returns retryable, then retries safely", async () => {
    const subject = await createUser("account-delete-failure");
    await seedEverySubsystem(subject.userId, subject.token);
    const before = await ownedCounts(subject.userId);
    expectAllPresent(before);

    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    try {
      await db.query("CREATE SCHEMA IF NOT EXISTS test_harness");
      await db.query(
        `CREATE TABLE IF NOT EXISTS test_harness.account_deletion_block (
          user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT
        )`,
      );
      await db.query(
        "INSERT INTO test_harness.account_deletion_block(user_id) VALUES ($1)",
        [subject.userId],
      );

      const failed = await deleteAccount(subject.token);
      expect(failed.status).toBe(503);
      expect(failed.body.error?.code).toBe("ACCOUNT_DELETION_RETRY_REQUIRED");
      expect(await authUserExists(subject.userId)).toBe(true);
      expect(await ownedCounts(subject.userId)).toEqual(before);

      await db.query(
        "DELETE FROM test_harness.account_deletion_block WHERE user_id = $1",
        [subject.userId],
      );
      await db.query("DROP SCHEMA test_harness CASCADE");
    } finally {
      await db.end();
    }

    const retry = await deleteAccount(subject.token);
    expect(retry.status).toBe(200);
    expect(retry.body.data?.status).toBe("ACCOUNT_DELETION_COMPLETE");
    expect(await authUserExists(subject.userId)).toBe(false);
    expectAllGone(await ownedCounts(subject.userId));
    createdUsers.delete(subject.userId);
  });
});
