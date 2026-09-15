-- ============================================================
-- GZCI Job Costing — Bid Sheet + Daily Actuals + Final Summary
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hvxxcqddqdtbllzrzeqf/sql
-- ============================================================

-- 1. Bid items (one row per line: subs, labour, machines,
--    fuel, materials, consumables, accommodations/meals,
--    meetings, overhead, contingency)
create table if not exists bid_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  category text not null default 'Labour',
  item text not null default '',
  qty numeric not null default 0,
  unit text not null default '',
  unit_cost numeric not null default 0,
  unit_billable numeric not null default 0,
  contingency_pct numeric not null default 0,
  pct_complete numeric not null default 0,
  notes text default '',
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create index if not exists bid_items_project_idx on bid_items(project_id);

-- 2. Daily actual cost entries (Mon–Fri data entry:
--    guys, consumables, material in/out, fuel, meals, etc.)
create table if not exists cost_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  date date not null,
  bid_item_id uuid references bid_items(id) on delete set null,
  category text not null default 'Labour',
  description text not null default '',
  qty numeric not null default 0,
  unit text not null default '',
  unit_actual numeric not null default 0,
  hours numeric not null default 0,
  receipt_notes text default '',
  created_at timestamptz default now()
);
create index if not exists cost_entries_project_idx on cost_entries(project_id);
create index if not exists cost_entries_date_idx on cost_entries(project_id, date);

-- 3. Relax RLS for authenticated app users (same pattern as rest of app)
alter table bid_items enable row level security;
alter table cost_entries enable row level security;

drop policy if exists "Authenticated full access bid_items" on bid_items;
create policy "Authenticated full access bid_items"
  on bid_items for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated full access cost_entries" on cost_entries;
create policy "Authenticated full access cost_entries"
  on cost_entries for all to authenticated using (true) with check (true);
