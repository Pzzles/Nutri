-- Auto-create a profiles row when a new user signs up.
-- Without this, FK constraints on meals/meal_items fail for new users.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Back-fill profiles for any users who signed up before this trigger existed.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
