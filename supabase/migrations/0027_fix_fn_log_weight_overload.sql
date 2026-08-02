-- 0027_fix_fn_log_weight_overload.sql
--
-- Migration 0021 added a p_source parameter to fn_log_weight using
-- CREATE OR REPLACE with a new signature. PostgreSQL treats a function
-- with a different parameter list as a separate overload rather than
-- replacing the original, leaving two versions:
--
--   fn_log_weight(uuid, numeric, timestamptz, date, text)            -- 5 params (0001)
--   fn_log_weight(uuid, numeric, timestamptz, date, text, text)      -- 6 params (0021)
--
-- PostgREST returns PGRST203 (function not found / ambiguous) when callers
-- use named-parameter RPC because it cannot choose between the two overloads.
--
-- Fix: drop the original 5-parameter signature. The 6-param version (with
-- p_source TEXT DEFAULT 'manual') is fully backwards-compatible.

DROP FUNCTION IF EXISTS fn_log_weight(uuid, numeric, timestamptz, date, text);
