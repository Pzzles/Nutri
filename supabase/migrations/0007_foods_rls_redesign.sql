-- Security gap 1: foods_insert_own allowed `owner_user_id IS NULL` from a user
-- client, letting any user create globally-visible foods with verified=true.
-- Fix: restrict insert to own ID only and block verified=true at insert time.
--
-- Security gap 2: foods_select_active_or_own exposed every active food —
-- including other users' private (owner_user_id IS NOT NULL) foods — as long
-- as status='active'. A private food should only be visible to its owner.
-- Fix: replace with foods_select_public_or_own — public foods have no owner
-- (owner_user_id IS NULL) and must be active; own foods are always visible
-- regardless of status so archived items stay resolvable in history.

-- Drop the two policies being replaced.
drop policy if exists "foods_insert_own"           on foods;
drop policy if exists "foods_select_active_or_own" on foods;

-- Verified foods and global foods (owner_user_id IS NULL) may only be
-- inserted by the service role (Edge Functions). User clients may only insert
-- their own unverified foods.
create policy "foods_insert_own" on foods for insert
  with check (owner_user_id = auth.uid() and verified = false);

-- Public foods (owner_user_id IS NULL, status = 'active') are visible to
-- everyone. Private foods (owner_user_id IS NOT NULL) are only visible to
-- their owner, at any status (so archived personal foods stay in history).
create policy "foods_select_public_or_own" on foods for select
  using (
    (owner_user_id is null and status = 'active')
    or owner_user_id = auth.uid()
  );
