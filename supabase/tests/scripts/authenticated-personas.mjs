import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const fixturePath = resolve(repositoryRoot, "web/src/fixtures/authenticatedProgressPersonas.json");
const personaEnvPath = resolve(repositoryRoot, "web/.env.personas.local");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const SUITE = fixture.suite_version;
const PERSONA_COUNT = fixture.personas.length;
const COMMANDS = new Set(["seed", "reset", "verify", "destroy"]);
const RUN_DAY = new Date();
RUN_DAY.setUTCHours(0, 0, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function usage() {
  console.log(`Usage:
  node scripts/authenticated-personas.mjs seed --project-ref <ref>
  node scripts/authenticated-personas.mjs verify --project-ref <ref>
  node scripts/authenticated-personas.mjs reset --project-ref <ref>
  node scripts/authenticated-personas.mjs destroy --project-ref <ref> --confirm ${SUITE}

Use --local instead of --project-ref to target the running local Supabase stack.`);
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) {
    usage();
    throw new Error("Choose seed, reset, verify, or destroy.");
  }

  const options = { command, local: false, projectRef: null, confirm: null };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--local") {
      options.local = true;
    } else if (argument === "--project-ref") {
      options.projectRef = rest[++index] ?? null;
    } else if (argument === "--confirm") {
      options.confirm = rest[++index] ?? null;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.local === Boolean(options.projectRef)) {
    throw new Error("Choose exactly one target: --local or --project-ref <ref>.");
  }
  if (options.projectRef && !/^[a-z0-9]{20}$/.test(options.projectRef)) {
    throw new Error("The Supabase project ref is invalid.");
  }
  if (command === "destroy" && options.confirm !== SUITE) {
    throw new Error(`Destroy requires --confirm ${SUITE}.`);
  }
  return options;
}

function runSupabaseJson(args) {
  try {
    const executable = process.platform === "win32" ? "cmd.exe" : "supabase";
    const executableArguments = process.platform === "win32"
      ? ["/d", "/s", "/c", "supabase", ...args]
      : args;
    const output = execFileSync(executable, executableArguments, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch {
    throw new Error("Could not read the requested Supabase connection from the authenticated CLI.");
  }
}

function resolveConnection(options) {
  if (options.local) {
    const status = runSupabaseJson(["status", "--output", "json"]);
    return {
      url: status.API_URL,
      anonKey: status.ANON_KEY ?? status.PUBLISHABLE_KEY,
      serviceRoleKey: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
      label: "local Supabase",
    };
  }

  const keys = runSupabaseJson([
    "projects",
    "api-keys",
    "--project-ref",
    options.projectRef,
    "--reveal",
    "--output",
    "json",
  ]);
  const legacyAnon = keys.find((key) => key.name === "anon" && key.type === "legacy")?.api_key;
  const publishable = keys.find((key) => key.type === "publishable")?.api_key;
  const legacyServiceRole = keys.find((key) => key.name === "service_role" && key.type === "legacy")?.api_key;
  const secret = keys.find((key) => key.type === "secret")?.api_key;
  return {
    url: `https://${options.projectRef}.supabase.co`,
    anonKey: legacyAnon ?? publishable,
    serviceRoleKey: legacyServiceRole ?? secret,
    label: `hosted project ${options.projectRef}`,
  };
}

function assertConnection(connection) {
  if (!connection.url || !connection.anonKey || !connection.serviceRoleKey) {
    throw new Error("Supabase URL, anonymous key, or service-role key was unavailable.");
  }
}

function adminClient(connection) {
  return createClient(connection.url, connection.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonymousClient(connection) {
  return createClient(connection.url, connection.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const delimiter = line.indexOf("=");
        return [line.slice(0, delimiter), line.slice(delimiter + 1)];
      }),
  );
}

function generatedEmail(personaId) {
  return `nutri-${personaId}-${randomBytes(5).toString("hex")}@example.invalid`;
}

function generatedPassword() {
  return randomBytes(30).toString("base64url");
}

function credentialFor(persona, index, existingEnv, connection) {
  const position = index + 1;
  const matchesTarget = existingEnv.VITE_SUPABASE_URL === connection.url;
  const email = matchesTarget ? existingEnv[`VITE_TEST_PERSONA_${position}_EMAIL`] : null;
  const password = matchesTarget ? existingEnv[`VITE_TEST_PERSONA_${position}_PASSWORD`] : null;
  return {
    email: email || generatedEmail(persona.id),
    password: password || generatedPassword(),
  };
}

function writePersonaEnv(connection, credentials) {
  const lines = [
    "# Generated by the authenticated persona harness. Do not commit this file.",
    "VITE_ENABLE_TEST_PERSONAS=true",
    `VITE_SUPABASE_URL=${connection.url}`,
    `VITE_SUPABASE_ANON_KEY=${connection.anonKey}`,
  ];
  credentials.forEach((credential, index) => {
    const position = index + 1;
    lines.push(`VITE_TEST_PERSONA_${position}_EMAIL=${credential.email}`);
    lines.push(`VITE_TEST_PERSONA_${position}_PASSWORD=${credential.password}`);
  });
  writeFileSync(personaEnvPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

async function listAllUsers(client) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Admin user listing failed (${error.code ?? "auth error"}).`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

function assertMarkedUser(user, personaId) {
  if (!user || user.app_metadata?.test_suite !== SUITE || user.app_metadata?.persona_id !== personaId) {
    throw new Error(`Persona ${personaId} is not owned by ${SUITE}; refusing to modify it.`);
  }
  if (user.is_anonymous || !user.email?.endsWith("@example.invalid")) {
    throw new Error(`Persona ${personaId} is not a safe non-anonymous test identity.`);
  }
}

async function provisionUsers(client, connection) {
  const existingEnv = parseEnvFile(personaEnvPath);
  const credentials = fixture.personas.map((persona, index) =>
    credentialFor(persona, index, existingEnv, connection));
  const existingUsers = await listAllUsers(client);
  const provisioned = [];

  for (let index = 0; index < fixture.personas.length; index += 1) {
    const persona = fixture.personas[index];
    const credential = credentials[index];
    const markedMatches = existingUsers.filter((user) =>
      user.app_metadata?.test_suite === SUITE && user.app_metadata?.persona_id === persona.id);
    if (markedMatches.length > 1) {
      throw new Error(`More than one marked auth user exists for persona ${persona.id}.`);
    }

    let user = markedMatches[0];
    if (user) {
      assertMarkedUser(user, persona.id);
      const { data, error } = await client.auth.admin.updateUserById(user.id, {
        email: credential.email,
        password: credential.password,
        email_confirm: true,
        app_metadata: { ...user.app_metadata, test_suite: SUITE, persona_id: persona.id },
        user_metadata: { ...user.user_metadata, display_name: persona.profile.display_name },
      });
      if (error) throw new Error(`Updating persona ${persona.id} failed (${error.code ?? "auth error"}).`);
      user = data.user;
    } else {
      const emailCollision = existingUsers.find((candidate) => candidate.email === credential.email);
      if (emailCollision) {
        throw new Error(`The generated identity for ${persona.id} already belongs to an unmarked account.`);
      }
      const { data, error } = await client.auth.admin.createUser({
        email: credential.email,
        password: credential.password,
        email_confirm: true,
        app_metadata: { test_suite: SUITE, persona_id: persona.id },
        user_metadata: { display_name: persona.profile.display_name },
      });
      if (error) throw new Error(`Creating persona ${persona.id} failed (${error.code ?? "auth error"}).`);
      user = data.user;
    }
    assertMarkedUser(user, persona.id);
    provisioned.push({ persona, user, credential });
  }

  writePersonaEnv(connection, credentials);
  return provisioned;
}

function usersFromExistingEnv(existingUsers, existingEnv, connection) {
  if (!existsSync(personaEnvPath) || existingEnv.VITE_SUPABASE_URL !== connection.url) {
    throw new Error("No persona credential file exists for this target. Run seed first.");
  }
  return fixture.personas.map((persona, index) => {
    const position = index + 1;
    const email = existingEnv[`VITE_TEST_PERSONA_${position}_EMAIL`];
    const password = existingEnv[`VITE_TEST_PERSONA_${position}_PASSWORD`];
    if (!email || !password) throw new Error(`Credentials are missing for persona ${persona.id}.`);
    const matches = existingUsers.filter((user) => user.email === email);
    if (matches.length !== 1) throw new Error(`Expected one auth user for persona ${persona.id}.`);
    assertMarkedUser(matches[0], persona.id);
    return { persona, user: matches[0], credential: { email, password } };
  });
}

function isoDateDaysAgo(daysAgo) {
  const date = new Date(RUN_DAY);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function timestampDaysAgo(daysAgo, hour = 6) {
  return `${isoDateDaysAgo(daysAgo)}T${String(hour).padStart(2, "0")}:30:00.000Z`;
}

function buildWeightRows(persona, userId) {
  const rows = [];
  const { starting_weight_kg: start } = persona.phase;
  const { ending_weight_kg: end, cadence_days: cadence, noise_kg: noise, trajectory } = persona.weight;
  const dayOffsets = [];
  for (let daysAgo = fixture.history_days; daysAgo >= 0; daysAgo -= cadence) dayOffsets.push(daysAgo);
  if (dayOffsets.at(-1) !== 0) dayOffsets.push(0);

  dayOffsets.forEach((daysAgo, index) => {
    let progress = (fixture.history_days - daysAgo) / fixture.history_days;
    if (trajectory === "plateau_last_35_days") {
      progress = Math.min(1, (fixture.history_days - daysAgo) / (fixture.history_days - 35));
    }
    const base = start + (end - start) * progress;
    const weight = daysAgo === 0 ? end : base + noise[index % noise.length];
    rows.push({
      user_id: userId,
      weight_kg: Number(weight.toFixed(2)),
      measured_at: timestampDaysAgo(daysAgo),
      logged_date: isoDateDaysAgo(daysAgo),
      is_official: true,
      notes: `${SUITE}:${persona.id}`,
      source: "import",
    });
  });
  return rows;
}

const MEAL_FIXTURES = [
  { type: "breakfast", hour: 6, weightG: 320, share: 0.28 },
  { type: "lunch", hour: 11, weightG: 480, share: 0.34 },
  { type: "dinner", hour: 17, weightG: 520, share: 0.38 },
];

function fixedNutrition(persona, meal) {
  return {
    calories: Number((persona.nutrition.average_daily_kcal * meal.share).toFixed(1)),
    protein_g: Number((persona.phase.target_protein_g * meal.share).toFixed(1)),
    carbs_g: Number((persona.phase.target_carbs_g * meal.share).toFixed(1)),
    fat_g: Number((persona.phase.target_fat_g * meal.share).toFixed(1)),
    fibre_g: Number((persona.phase.target_fibre_g * meal.share).toFixed(1)),
  };
}

async function requireSuccess(result, context) {
  if (result.error) throw new Error(`${context} failed (${result.error.code ?? "database error"}): ${result.error.message}`);
  return result.data;
}

async function clearPersonaData(client, provisioned, recreateProfiles) {
  for (const entry of provisioned) assertMarkedUser(entry.user, entry.persona.id);
  const ids = provisioned.map((entry) => entry.user.id);
  await requireSuccess(await client.from("profiles").delete().in("id", ids), "Persona data reset");
  await requireSuccess(
    await client.from("foods").delete().like("source_identifier", `${SUITE}:%`),
    "Persona food reset",
  );
  if (recreateProfiles) {
    await requireSuccess(await client.from("profiles").upsert(provisioned.map(({ persona, user }) => ({
      id: user.id,
      display_name: `${persona.profile.display_name} (reset)`,
      timezone: persona.profile.timezone,
      preferred_units: { weight: "kg", volume: "ml" },
    }))), "Reset profile creation");
  }
}

async function seedPersonaData(client, provisioned) {
  await clearPersonaData(client, provisioned, false);

  for (const { persona, user } of provisioned) {
    await requireSuccess(await client.from("profiles").upsert({
      id: user.id,
      ...persona.profile,
      current_weight_kg: persona.weight.ending_weight_kg,
      goal_weight_kg: persona.phase.target_weight_kg,
      preferred_units: { weight: "kg", volume: "ml" },
    }), `Profile seed for ${persona.id}`);

    const weightRows = buildWeightRows(persona, user.id);
    const weights = await requireSuccess(
      await client.from("weight_logs").insert(weightRows).select("id, measured_at, logged_date"),
      `Weight seed for ${persona.id}`,
    );
    const startingWeight = weights.find((row) => row.logged_date === isoDateDaysAgo(fixture.history_days));
    if (!startingWeight) throw new Error(`Starting weight fixture missing for ${persona.id}.`);

    const adjustment = persona.phase.target_calories - persona.phase.manual_maintenance_kcal;
    await requireSuccess(await client.rpc("fn_start_goal_phase_v2", {
      p_user_id: user.id,
      p_mode: persona.phase.mode,
      p_started_at: timestampDaysAgo(fixture.history_days),
      p_starting_weight_kg: persona.phase.starting_weight_kg,
      p_starting_weight_source: "latest_weight_log",
      p_target_weight_kg: persona.phase.target_weight_kg,
      p_target_change_kg_per_week: persona.phase.target_change_kg_per_week,
      p_target_calories: persona.phase.target_calories,
      p_target_protein_g: persona.phase.target_protein_g,
      p_target_carbs_g: persona.phase.target_carbs_g,
      p_target_fat_g: persona.phase.target_fat_g,
      p_target_fibre_g: persona.phase.target_fibre_g,
      p_transition: null,
      p_manual_maintenance_kcal: persona.phase.manual_maintenance_kcal,
      p_algorithm_name: "fixture_only_not_an_estimate",
      p_algorithm_version: SUITE,
      p_activity_multiplier_version: "fixture_only_v1",
      p_calculation_timestamp: timestampDaysAgo(fixture.history_days),
      p_profile_birth_date: persona.profile.birth_date,
      p_equation_sex: persona.profile.sex,
      p_height_cm: persona.profile.height_cm,
      p_official_weight_kg: persona.phase.starting_weight_kg,
      p_weight_log_id: startingWeight.id,
      p_age_years: persona.snapshot.age_years,
      p_activity_level: persona.profile.activity_level,
      p_activity_multiplier: persona.snapshot.activity_multiplier,
      p_calculated_bmr_kcal: persona.snapshot.fixture_bmr_kcal,
      p_calculated_tdee_kcal: persona.snapshot.fixture_tdee_kcal,
      p_effective_maintenance_kcal: persona.phase.manual_maintenance_kcal,
      p_maintenance_source: "manual_override",
      p_requested_rate_kg_per_week: persona.phase.target_change_kg_per_week,
      p_daily_adjustment_kcal: adjustment,
      p_raw_target_kcal: persona.phase.target_calories,
      p_final_target_kcal: persona.phase.target_calories,
      p_warning_codes: [],
      p_aggressive_rate_acknowledged: false,
      p_config_versions: { fixture: SUITE },
      p_weight_measured_at: startingWeight.measured_at,
      p_weight_log_source: "import",
      p_input_provenance: {
        fixture: SUITE,
        profile: "fictional_test_fixture",
        maintenance: "fixed_fixture_value_not_calculated",
      },
    }), `Goal phase seed for ${persona.id}`);

    const foodRows = MEAL_FIXTURES.map((meal) => {
      const nutrition = fixedNutrition(persona, meal);
      const scale = 100 / meal.weightG;
      return {
        name: `[TEST] ${persona.id} ${meal.type} composite`,
        normalized_name: `test ${persona.id} ${meal.type} composite`,
        source: "imported",
        source_identifier: `${SUITE}:${persona.id}:${meal.type}`,
        owner_user_id: user.id,
        serving_size_g: meal.weightG,
        calories_100g: Number((nutrition.calories * scale).toFixed(3)),
        protein_100g: Number((nutrition.protein_g * scale).toFixed(3)),
        carbs_100g: Number((nutrition.carbs_g * scale).toFixed(3)),
        fat_100g: Number((nutrition.fat_g * scale).toFixed(3)),
        fibre_100g: Number((nutrition.fibre_g * scale).toFixed(3)),
        verified: false,
      };
    });
    const foods = await requireSuccess(
      await client.from("foods").insert(foodRows).select("id, source_identifier"),
      `Food seed for ${persona.id}`,
    );
    const foodIdByType = Object.fromEntries(foods.map((food) => [food.source_identifier.split(":").at(-1), food.id]));

    const completeOffsets = new Set(persona.nutrition.complete_day_offsets);
    const probablyCompleteOffsets = new Set(persona.nutrition.probably_complete_day_offsets);
    const offsets = [...new Set([...completeOffsets, ...probablyCompleteOffsets])].sort((a, b) => b - a);
    const mealRows = offsets.flatMap((daysAgo) => MEAL_FIXTURES.map((meal) => ({
      user_id: user.id,
      raw_input: `[${SUITE}] explicit ${meal.weightG} g synthetic fixture`,
      parsed_json: { fixture: SUITE, persona_id: persona.id, explicit_weight_g: meal.weightG },
      meal_type: meal.type,
      meal_confidence: "high",
      eaten_at: timestampDaysAgo(daysAgo, meal.hour),
      logged_date: isoDateDaysAgo(daysAgo),
    })));
    const meals = await requireSuccess(
      await client.from("meals").insert(mealRows).select("id, meal_type, logged_date"),
      `Meal seed for ${persona.id}`,
    );
    const mealFixtureByType = Object.fromEntries(MEAL_FIXTURES.map((meal) => [meal.type, meal]));
    await requireSuccess(await client.from("meal_items").insert(meals.map((mealRow) => {
      const meal = mealFixtureByType[mealRow.meal_type];
      const nutrition = fixedNutrition(persona, meal);
      return {
        meal_id: mealRow.id,
        food_id: foodIdByType[meal.type],
        raw_phrases: [`${meal.weightG} g synthetic composite`],
        quantity: meal.weightG,
        unit: "g",
        weight_g: meal.weightG,
        ...nutrition,
        match_confidence: "exact",
        portion_confidence: "exact",
        confidence: "high",
        nutrition_source: `${SUITE}:fixed_fixture`,
      };
    })), `Meal-item seed for ${persona.id}`);

    await requireSuccess(await client.from("daily_log_status").insert(offsets.map((daysAgo) => ({
      user_id: user.id,
      logged_date: isoDateDaysAgo(daysAgo),
      status: completeOffsets.has(daysAgo) ? "complete" : "probably_complete",
      marked_complete_at: completeOffsets.has(daysAgo) ? timestampDaysAgo(daysAgo, 20) : null,
    }))), `Daily-status seed for ${persona.id}`);
  }
}

async function authenticatePersona(connection, entry) {
  const client = anonymousClient(connection);
  const { data, error } = await client.auth.signInWithPassword(entry.credential);
  if (error || !data.session) {
    throw new Error(`Authentication verification failed for ${entry.persona.id} (${error?.code ?? "no session"}).`);
  }
  return { client, session: data.session };
}

async function fetchAuthenticatedFunction(connection, session, functionName) {
  let lastStatus = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${connection.url}/functions/v1/${functionName}`, {
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: connection.anonKey },
        signal: AbortSignal.timeout(30_000),
      });
      lastStatus = response.status;
      if (response.ok) return await response.json();
      if (response.status < 500) break;
    } catch {
      // Retry transient transport failures; persistent failures are reported below.
    }
  }
  throw new Error(`${functionName} returned ${lastStatus ? `HTTP ${lastStatus}` : "a transport error"}.`);
}

async function verifyPersonas(admin, connection, provisioned) {
  const summaries = [];
  for (const entry of provisioned) {
    assertMarkedUser(entry.user, entry.persona.id);
    const { session } = await authenticatePersona(connection, entry);
    const [profile, weights, phases, meals, statuses] = await Promise.all([
      admin.from("profiles").select("id, display_name, birth_date, sex, height_cm, current_weight_kg, activity_level").eq("id", entry.user.id).single(),
      admin.from("weight_logs").select("logged_date", { count: "exact" }).eq("user_id", entry.user.id).eq("source", "import").like("notes", `${SUITE}:%`).order("logged_date"),
      admin.from("goal_phases").select("id, mode, status, snapshot_id", { count: "exact" }).eq("user_id", entry.user.id).eq("status", "active"),
      admin.from("meals").select("id", { count: "exact", head: true }).eq("user_id", entry.user.id),
      admin.from("daily_log_status").select("id", { count: "exact", head: true }).eq("user_id", entry.user.id),
    ]);
    for (const [result, label] of [[profile, "profile"], [weights, "weights"], [phases, "phase"], [meals, "meals"], [statuses, "statuses"]]) {
      if (result.error) throw new Error(`${label} verification failed for ${entry.persona.id} (${result.error.code ?? "database error"}).`);
    }
    if (!profile.data?.birth_date || !profile.data?.sex || !profile.data?.height_cm || !profile.data?.activity_level) {
      throw new Error(`Profile fixture is incomplete for ${entry.persona.id}.`);
    }
    if (phases.data?.length !== 1 || phases.data[0].mode !== entry.persona.phase.mode || !phases.data[0].snapshot_id) {
      throw new Error(`Active phase fixture is invalid for ${entry.persona.id}.`);
    }
    const firstWeight = weights.data?.at(0)?.logged_date;
    const lastWeight = weights.data?.at(-1)?.logged_date;
    const historySpanDays = firstWeight && lastWeight
      ? Math.round((Date.parse(`${lastWeight}T00:00:00Z`) - Date.parse(`${firstWeight}T00:00:00Z`)) / DAY_MS)
      : null;
    const freshnessDays = lastWeight
      ? Math.round((RUN_DAY.getTime() - Date.parse(`${lastWeight}T00:00:00Z`)) / DAY_MS)
      : null;
    if (historySpanDays !== fixture.history_days || freshnessDays === null || freshnessDays < 0 || freshnessDays > 1) {
      throw new Error(`Weight history does not span ${fixture.history_days} days for ${entry.persona.id}.`);
    }

    const maintenanceBody = await fetchAuthenticatedFunction(connection, session, "get-adaptive-maintenance");
    const maintenanceStatus = maintenanceBody?.data?.status ?? maintenanceBody?.status ?? "unknown";
    let goalFeedbackState = "not_checked";
    if (entry.persona.expected_goal_feedback_state) {
      const feedbackBody = await fetchAuthenticatedFunction(connection, session, "get-goal-feedback");
      goalFeedbackState = feedbackBody?.data?.progress_state ?? "unknown";
      const feedbackAction = feedbackBody?.data?.feedback_action ?? "unknown";
      if (goalFeedbackState !== entry.persona.expected_goal_feedback_state) {
        throw new Error(`Goal-feedback state mismatch for ${entry.persona.id}: ${goalFeedbackState}.`);
      }
      if (feedbackAction !== entry.persona.expected_feedback_action) {
        throw new Error(`Goal-feedback action mismatch for ${entry.persona.id}: ${feedbackAction}.`);
      }
    }
    summaries.push({
      id: entry.persona.id,
      mode: entry.persona.phase.mode,
      weights: weights.count,
      meals: meals.count,
      classifiedDays: statuses.count,
      maintenanceStatus,
      goalFeedbackState,
    });
  }
  return summaries;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (PERSONA_COUNT !== 10) throw new Error(`Expected exactly 10 persona fixtures, found ${PERSONA_COUNT}.`);
  const connection = resolveConnection(options);
  assertConnection(connection);
  const admin = adminClient(connection);

  if (options.command === "seed") {
    console.log(`Seeding ${PERSONA_COUNT} marked personas in ${connection.label}...`);
    const provisioned = await provisionUsers(admin, connection);
    await seedPersonaData(admin, provisioned);
    const summaries = await verifyPersonas(admin, connection, provisioned);
    console.table(summaries);
    console.log("Persona credentials were written to ignored web/.env.personas.local.");
    console.log("Run `npm run dev:personas` from web, then choose a persona on the sign-in page.");
    return;
  }

  const existingEnv = parseEnvFile(personaEnvPath);
  const provisioned = usersFromExistingEnv(await listAllUsers(admin), existingEnv, connection);
  if (options.command === "verify") {
    console.log(`Verifying ${PERSONA_COUNT} marked personas in ${connection.label}...`);
    console.table(await verifyPersonas(admin, connection, provisioned));
    return;
  }

  if (options.command === "reset") {
    await clearPersonaData(admin, provisioned, true);
    console.log(`Reset data for ${PERSONA_COUNT} marked personas; auth identities and the ignored credential file were retained.`);
    return;
  }

  await clearPersonaData(admin, provisioned, false);
  for (const entry of provisioned) {
    const { error } = await admin.auth.admin.deleteUser(entry.user.id);
    if (error) throw new Error(`Destroying persona ${entry.persona.id} failed (${error.code ?? "auth error"}).`);
  }
  if (existsSync(personaEnvPath)) unlinkSync(personaEnvPath);
  console.log(`Destroyed ${PERSONA_COUNT} marked personas and removed the ignored credential file.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Persona harness failed.");
  process.exitCode = 1;
});
