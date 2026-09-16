-- ============================================================
-- GZCI Job Costing — Billed ledger (client invoices + holdback)
-- Run this in Supabase SQL Editor (one time):
-- https://supabase.com/dashboard/project/hvxxcqddqdtbllzrzeqf/sql
-- ============================================================

-- What we billed the client: invoice #, date, amount, holdback held,
-- holdback released back to us, paid status. Drives profit = billed − cost
-- and the holdback-still-outstanding figure.
create table if not exists billed_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  invoice_no text not null default '',
  date date not null,
  description text not null default '',
  amount numeric not null default 0,
  holdback_held numeric not null default 0,
  holdback_released numeric not null default 0,
  paid boolean not null default false,
  notes text default '',
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create index if not exists billed_invoices_project_idx on billed_invoices(project_id);

alter table billed_invoices enable row level security;

drop policy if exists "Authenticated full access billed_invoices" on billed_invoices;
create policy "Authenticated full access billed_invoices"
  on billed_invoices for all to authenticated using (true) with check (true);
