-- BUG-002: log-meal/index.ts updatePortionHistory() used a read-then-write
-- (SELECT use_count, then INSERT … ON CONFLICT DO UPDATE SET use_count = read + 1).
-- Concurrent saves of the same food by the same user could both read use_count=0
-- and both write use_count=1, losing one increment.
-- This function replaces the read-then-write with a single atomic SQL statement.

create or replace function fn_upsert_portion_history(
  p_user_id uuid,
  p_food_id uuid,
  p_usual_g numeric
) returns void
language sql
security definer
as $$
  insert into user_food_portions (user_id, food_id, usual_g, use_count, last_used_at)
  values (p_user_id, p_food_id, p_usual_g, 1, now())
  on conflict (user_id, food_id)
  do update set
    usual_g      = excluded.usual_g,
    use_count    = user_food_portions.use_count + 1,
    last_used_at = excluded.last_used_at;
$$;
