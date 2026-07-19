-- =====================================================================
-- Nutrition Tracker — Initial Schema
-- Generated from docs/05-database-design.md v2.0
-- See docs/decisions/ for the ADRs that shaped these choices.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists fuzzystrmatch;

-- ---------------------------------------------------------------------
-- Shared trigger: keep updated_at current on every row update
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =====================================================================
-- profiles
-- =====================================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  birth_date date,
  sex text,
  height_cm numeric,
  current_weight_kg numeric,
  goal_weight_kg numeric,
  activity_level text check (activity_level in ('sedentary','light','moderate','active','very_active')),
  timezone text not null default 'UTC',
  preferred_units jsonb not null default '{"weight":"kg","volume":"ml"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

alter table profiles enable row level security;
create policy "profiles_select_own" on profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = id);

-- =====================================================================
-- user_goals  (FR-041 — effective-dated, never mutated in place)
-- =====================================================================
create table user_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  target_calories numeric,
  target_protein_g numeric,
  target_carbs_g numeric,
  target_fat_g numeric,
  effective_from date not null,
  created_at timestamptz not null default now(),
  constraint chk_at_least_one_target check (
    target_calories is not null or target_protein_g is not null
    or target_carbs_g is not null or target_fat_g is not null
  )
);
create index idx_user_goals_user_effective on user_goals(user_id, effective_from desc);

alter table user_goals enable row level security;
create policy "user_goals_all_own" on user_goals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- foods  (canonical definitions — ADR-007 split from saved/preference data)
-- =====================================================================
create table foods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  brand text,
  barcode text unique,
  source text not null check (source in ('usda_fdc','open_food_facts','user_manual','imported')),
  source_identifier text,
  owner_user_id uuid references profiles(id) on delete set null,
  serving_size_g numeric,
  calories_100g numeric not null,
  protein_100g numeric not null,
  carbs_100g numeric not null,
  fat_100g numeric not null,
  fibre_100g numeric,
  verified boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_foods_normalized_name_trgm on foods using gin (normalized_name gin_trgm_ops);
create index idx_foods_brand on foods(brand);
create index idx_foods_barcode on foods(barcode);
create index idx_foods_source_identifier on foods(source_identifier);

create trigger trg_foods_updated_at before update on foods
  for each row execute function set_updated_at();

alter table foods enable row level security;
create policy "foods_select_active_or_own" on foods for select
  using (status = 'active' or owner_user_id = auth.uid());
create policy "foods_insert_own" on foods for insert
  with check (owner_user_id = auth.uid() or owner_user_id is null);
create policy "foods_update_own" on foods for update
  using (owner_user_id = auth.uid());
-- Non-owned canonical foods (USDA/OFF/global) are written only via the service
-- role in Edge Functions, which bypasses RLS entirely.

-- Fuzzy search helper — ADR-005 (trigram >= 0.75, OR levenshtein <= 2 for short strings)
create or replace function fn_fuzzy_food_search(search_query text, min_similarity float default 0.75)
returns table (food_id uuid, name text, normalized_name text, similarity float)
language sql stable
as $$
  select id, name, normalized_name, similarity(normalized_name, search_query) as similarity
  from foods
  where status = 'active'
    and (
      similarity(normalized_name, search_query) >= min_similarity
      or (
        length(search_query) < 8
        and levenshtein(normalized_name, search_query) <= 2
      )
    )
  order by similarity desc
  limit 5;
$$;

-- =====================================================================
-- user_saved_foods  (favorites + preferences — ADR-007, resolves domain-model C1)
-- =====================================================================
create table user_saved_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  food_id uuid not null references foods(id) on delete cascade,
  nickname text,
  is_favorite boolean not null default false,
  default_serving_size numeric,
  default_serving_unit text,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, food_id)
);

create trigger trg_user_saved_foods_updated_at before update on user_saved_foods
  for each row execute function set_updated_at();

alter table user_saved_foods enable row level security;
create policy "user_saved_foods_all_own" on user_saved_foods for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- meals  (event — mutable in place, ADR-001; never versioned)
-- =====================================================================
create table meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  raw_input text,
  parsed_json jsonb,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  meal_confidence text not null check (meal_confidence in ('high','medium','low')),
  eaten_at timestamptz not null,
  -- Derived from eaten_at + profile.timezone AT INSERT TIME. Never recomputed
  -- if the user later changes their timezone — FR-040 AC3.
  logged_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_meals_user_logged_date on meals(user_id, logged_date);

create trigger trg_meals_updated_at before update on meals
  for each row execute function set_updated_at();

alter table meals enable row level security;
create policy "meals_all_own" on meals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- meal_edit_log  (ADR-001 / ADR-009 — append-only audit trail)
-- =====================================================================
create table meal_edit_log (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals(id) on delete cascade,
  field_name text not null,
  old_value jsonb,
  new_value jsonb,
  edited_at timestamptz not null default now(),
  edited_by uuid not null references profiles(id)
);

alter table meal_edit_log enable row level security;
create policy "meal_edit_log_select_own" on meal_edit_log for select
  using (exists (select 1 from meals m where m.id = meal_edit_log.meal_id and m.user_id = auth.uid()));
create policy "meal_edit_log_insert_own" on meal_edit_log for insert
  with check (edited_by = auth.uid());

-- =====================================================================
-- meal_items  (immutable nutrition snapshot — Domain Rule 2)
-- =====================================================================
create table meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals(id) on delete cascade,
  food_id uuid not null references foods(id),
  raw_phrases jsonb not null default '[]'::jsonb,
  quantity numeric,
  unit text,
  weight_g numeric,
  calories numeric not null,
  protein_g numeric not null,
  carbs_g numeric not null,
  fat_g numeric not null,
  fibre_g numeric,
  match_confidence text not null check (match_confidence in ('exact','partial','none')),
  portion_confidence text not null check (portion_confidence in ('exact','estimated','assumed_default')),
  -- item_confidence, per the FR-020 table. Computed once at log time, stored — never
  -- recomputed on read.
  confidence text not null check (confidence in ('high','medium','low')),
  nutrition_source text not null,
  created_at timestamptz not null default now()
);

create index idx_meal_items_meal_id on meal_items(meal_id);

alter table meal_items enable row level security;
create policy "meal_items_all_via_meal" on meal_items for all
  using (exists (select 1 from meals m where m.id = meal_items.meal_id and m.user_id = auth.uid()))
  with check (exists (select 1 from meals m where m.id = meal_items.meal_id and m.user_id = auth.uid()));

-- =====================================================================
-- saved_meals  (template — totals NEVER stored, ADR-006)
-- =====================================================================
create table saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  is_favorite boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_saved_meals_updated_at before update on saved_meals
  for each row execute function set_updated_at();

alter table saved_meals enable row level security;
create policy "saved_meals_all_own" on saved_meals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- saved_meal_items  (default portions only — no nutrition snapshot)
-- =====================================================================
create table saved_meal_items (
  id uuid primary key default gen_random_uuid(),
  saved_meal_id uuid not null references saved_meals(id) on delete cascade,
  food_id uuid not null references foods(id),
  default_quantity numeric,
  default_unit text
);

alter table saved_meal_items enable row level security;
create policy "saved_meal_items_all_via_parent" on saved_meal_items for all
  using (exists (select 1 from saved_meals sm where sm.id = saved_meal_items.saved_meal_id and sm.user_id = auth.uid()))
  with check (exists (select 1 from saved_meals sm where sm.id = saved_meal_items.saved_meal_id and sm.user_id = auth.uid()));

-- =====================================================================
-- weight_logs  (FR-042 — multiple same-day entries retained, latest is_official)
-- =====================================================================
create table weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  weight_kg numeric not null check (weight_kg >= 20 and weight_kg <= 300),
  measured_at timestamptz not null,
  logged_date date not null,
  is_official boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_weight_logs_user_date on weight_logs(user_id, logged_date desc);

alter table weight_logs enable row level security;
create policy "weight_logs_all_own" on weight_logs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- user_food_cache  (ADR-008 tier 2)
-- =====================================================================
create table user_food_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  normalized_query text not null,
  matched_food_id uuid not null references foods(id),
  lookup_source text not null,
  confidence text not null check (confidence in ('exact','partial','none')),
  use_count integer not null default 1,
  last_used_at timestamptz not null default now(),
  unique (user_id, normalized_query)
);

alter table user_food_cache enable row level security;
create policy "user_food_cache_all_own" on user_food_cache for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- global_food_cache  (ADR-008 tier 3 — service-role write only)
-- =====================================================================
create table global_food_cache (
  id uuid primary key default gen_random_uuid(),
  normalized_query text not null unique,
  matched_food_id uuid not null references foods(id),
  lookup_source text not null,
  confidence text not null check (confidence in ('exact','partial','none')),
  use_count integer not null default 0,
  last_used_at timestamptz not null default now()
);

alter table global_food_cache enable row level security;
create policy "global_food_cache_select_all" on global_food_cache for select using (true);
-- No insert/update policy for regular users — writes happen via service role only.

-- =====================================================================
-- global_cache_promotion_votes  (FR-011 AC2/AC3 — distinct-user counting)
-- =====================================================================
create table global_cache_promotion_votes (
  id uuid primary key default gen_random_uuid(),
  normalized_query text not null,
  matched_food_id uuid not null references foods(id),
  confirming_user_id uuid not null references profiles(id),
  confirmed_at timestamptz not null default now(),
  unique (normalized_query, matched_food_id, confirming_user_id)
);

alter table global_cache_promotion_votes enable row level security;
create policy "promotion_votes_insert_own" on global_cache_promotion_votes for insert
  with check (confirming_user_id = auth.uid());
create policy "promotion_votes_select_own" on global_cache_promotion_votes for select
  using (confirming_user_id = auth.uid());

-- =====================================================================
-- api_cache  (raw USDA/OFF responses — service-role only)
-- =====================================================================
create table api_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null,
  provider text not null check (provider in ('usda_fdc','open_food_facts')),
  payload_json jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (cache_key, provider)
);

alter table api_cache enable row level security;
-- RLS enabled with no policies for anon/authenticated — service role bypasses RLS.

-- =====================================================================
-- food_synonyms  (FR-074, ADR-011 — shared table for V1, user-correctable)
-- =====================================================================
create table food_synonyms (
  id uuid primary key default gen_random_uuid(),
  raw_term text not null unique,
  canonical_term text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table food_synonyms enable row level security;
create policy "food_synonyms_select_all" on food_synonyms for select using (true);

-- Seed a handful of common synonyms so the app isn't starting from zero.
insert into food_synonyms (raw_term, canonical_term) values
  ('avo', 'avocado'),
  ('bbq sauce', 'barbecue sauce'),
  ('coke zero', 'coca-cola zero sugar'),
  ('pb', 'peanut butter'),
  ('chips', 'french fries')
on conflict (raw_term) do nothing;

-- =====================================================================
-- system_settings  (FR-011 AC3 — configurable without a deploy)
-- =====================================================================
create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into system_settings (key, value) values
  ('global_cache_promotion_threshold', '3')
on conflict (key) do nothing;

alter table system_settings enable row level security;
create policy "system_settings_select_all" on system_settings for select using (true);

-- =====================================================================
-- ai_parse_requests  (FR-073 — one row per AI call, result XOR error)
-- =====================================================================
create table ai_parse_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  meal_id uuid references meals(id) on delete set null,
  raw_text text not null,
  raw_response text,
  parsed_result jsonb,
  duration_ms integer,
  token_usage jsonb,
  error text,
  created_at timestamptz not null default now(),
  constraint chk_result_xor_error check (
    (parsed_result is null) <> (error is null)
  )
);

alter table ai_parse_requests enable row level security;
create policy "ai_parse_requests_all_own" on ai_parse_requests for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- idempotency_keys  (ADR-012)
-- =====================================================================
create table idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  idempotency_key uuid not null,
  function_name text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key, function_name)
);

alter table idempotency_keys enable row level security;
create policy "idempotency_keys_all_own" on idempotency_keys for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- fn_log_meal  — atomic meal + meal_items insert (called via RPC from log-meal)
-- =====================================================================
create or replace function fn_log_meal(
  p_user_id uuid,
  p_meal_type text,
  p_eaten_at timestamptz,
  p_logged_date date,
  p_meal_confidence text,
  p_raw_input text,
  p_parsed_json jsonb,
  p_items jsonb
) returns uuid
language plpgsql
security definer
as $$
declare
  v_meal_id uuid;
begin
  if p_user_id <> auth.uid() then
    raise exception 'Cannot log meal for another user';
  end if;

  insert into meals (user_id, raw_input, parsed_json, meal_type, meal_confidence, eaten_at, logged_date)
  values (p_user_id, p_raw_input, p_parsed_json, p_meal_type, p_meal_confidence, p_eaten_at, p_logged_date)
  returning id into v_meal_id;

  insert into meal_items (
    meal_id, food_id, raw_phrases, quantity, unit, weight_g,
    calories, protein_g, carbs_g, fat_g, fibre_g,
    match_confidence, portion_confidence, confidence, nutrition_source
  )
  select
    v_meal_id,
    (item->>'food_id')::uuid,
    coalesce(item->'raw_phrases', '[]'::jsonb),
    (item->>'quantity')::numeric,
    item->>'unit',
    (item->>'weight_g')::numeric,
    (item->>'calories')::numeric,
    (item->>'protein_g')::numeric,
    (item->>'carbs_g')::numeric,
    (item->>'fat_g')::numeric,
    (item->>'fibre_g')::numeric,
    item->>'match_confidence',
    item->>'portion_confidence',
    item->>'confidence',
    item->>'nutrition_source'
  from jsonb_array_elements(p_items) as item;

  return v_meal_id;
end;
$$;

-- =====================================================================
-- fn_log_weight  — atomic is_official flip + insert (FR-042 AC2)
-- =====================================================================
create or replace function fn_log_weight(
  p_user_id uuid,
  p_weight_kg numeric,
  p_measured_at timestamptz,
  p_logged_date date,
  p_notes text
) returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  if p_user_id <> auth.uid() then
    raise exception 'Cannot log weight for another user';
  end if;

  update weight_logs
  set is_official = false
  where user_id = p_user_id and logged_date = p_logged_date;

  insert into weight_logs (user_id, weight_kg, measured_at, logged_date, is_official, notes)
  values (p_user_id, p_weight_kg, p_measured_at, p_logged_date, true, p_notes)
  returning id into v_id;

  return v_id;
end;
$$;

-- =====================================================================
-- fn_recalculate_frequency_rankings  — scheduled daily (FR-031 AC2 / OI-4)
-- =====================================================================
create or replace function fn_recalculate_frequency_rankings(since_ts timestamptz)
returns void
language plpgsql
security definer
as $$
begin
  with usage as (
    select m.user_id, mi.food_id, count(*) as cnt
    from meal_items mi
    join meals m on m.id = mi.meal_id
    where m.eaten_at >= since_ts
    group by m.user_id, mi.food_id
  )
  update user_saved_foods usf
  set usage_count = usage.cnt
  from usage
  where usf.user_id = usage.user_id and usf.food_id = usage.food_id;

  insert into user_saved_foods (user_id, food_id, usage_count)
  select usage.user_id, usage.food_id, usage.cnt
  from (
    select m.user_id, mi.food_id, count(*) as cnt
    from meal_items mi
    join meals m on m.id = mi.meal_id
    where m.eaten_at >= since_ts
    group by m.user_id, mi.food_id
  ) usage
  left join user_saved_foods usf
    on usf.user_id = usage.user_id and usf.food_id = usage.food_id
  where usf.id is null;
end;
$$;

-- =====================================================================
-- End of initial schema
-- =====================================================================
