-- 0024_fix_daily_log_status_constraint.sql
--
-- Migration 0023 added daily_log_status_status_check with the extended values
-- but did not drop the pre-existing chk_daily_log_status_value constraint that
-- still only allows ('unknown', 'partial', 'complete').
--
-- This migration drops the old constraint so that 'fasting' and
-- 'probably_complete' are accepted by the table.

ALTER TABLE public.daily_log_status
  DROP CONSTRAINT IF EXISTS chk_daily_log_status_value;
