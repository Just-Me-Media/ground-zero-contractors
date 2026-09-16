-- ============================================================
-- GZCI Job Costing — Step 2: payroll export columns
-- Run this in Supabase SQL Editor (one time):
-- https://supabase.com/dashboard/project/hvxxcqddqdtbllzrzeqf/sql
-- ============================================================

-- Who did the work (free-text name today, worker roster in Step 2+)
alter table cost_entries
  add column if not exists worker text not null default '';

-- Overtime hours, split from regular hours for payroll exports
alter table cost_entries
  add column if not exists hours_ot numeric not null default 0;
