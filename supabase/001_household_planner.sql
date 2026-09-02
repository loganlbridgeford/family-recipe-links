-- Family Planner v1 schema
-- Run this once in the Supabase SQL editor for project tthmojfercxemrqghbfm
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Households
-- ---------------------------------------------------------------------------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_at timestamptz not null default now()
);

insert into public.households (id, name, slug)
values (
  '7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01',
  'Bridgeford Household',
  'bridgeford'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Members (display names only — auth comes later)
-- ---------------------------------------------------------------------------
create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null,
  role text not null default 'adult',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, display_name)
);

insert into public.household_members (household_id, display_name, role, sort_order)
values
  ('7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01', 'Logan',   'owner', 1),
  ('7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01', 'Nadine',  'adult', 2),
  ('7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01', 'John C.', 'adult', 3),
  ('7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01', 'Neileen', 'adult', 4),
  ('7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01', 'John A.', 'adult', 5),
  ('7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01', 'Abbie',   'adult', 6),
  ('7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01', 'Tyler',   'adult', 7),
  ('7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01', 'Monica',  'adult', 8)
on conflict (household_id, display_name) do nothing;

-- ---------------------------------------------------------------------------
-- Extend existing recipes table (do not drop / recreate)
-- ---------------------------------------------------------------------------
alter table public.recipes
  add column if not exists household_id uuid references public.households(id),
  add column if not exists ingredients jsonb not null default '[]'::jsonb,
  add column if not exists meal_types text[] not null default '{}',
  add column if not exists tags text[] not null default '{}',
  add column if not exists prep_minutes int,
  add column if not exists servings int,
  add column if not exists instructions jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.recipes
set household_id = '7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01'
where household_id is null;

-- Best-effort backfill of meal_types from the old category string
update public.recipes
set meal_types = array[lower(category)]
where coalesce(array_length(meal_types, 1), 0) = 0
  and lower(coalesce(category, '')) in ('breakfast', 'lunch', 'dinner', 'snack');

create index if not exists recipes_household_idx on public.recipes (household_id);
create index if not exists recipes_household_name_idx on public.recipes (household_id, name);

-- ---------------------------------------------------------------------------
-- Weekly plans
-- ---------------------------------------------------------------------------
create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  plan jsonb not null default '{}'::jsonb,
  grocery_checked jsonb not null default '{}'::jsonb,
  snack_adds jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (household_id, week_start)
);

create index if not exists meal_plans_household_week_idx
  on public.meal_plans (household_id, week_start);

-- ---------------------------------------------------------------------------
-- RLS — open access for v1 build/test. Replace before public distribution.
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.recipes enable row level security;
alter table public.meal_plans enable row level security;

drop policy if exists "households_public_all" on public.households;
create policy "households_public_all"
  on public.households for all
  using (true) with check (true);

drop policy if exists "members_public_all" on public.household_members;
create policy "members_public_all"
  on public.household_members for all
  using (true) with check (true);

drop policy if exists "recipes_public_all" on public.recipes;
create policy "recipes_public_all"
  on public.recipes for all
  using (true) with check (true);

drop policy if exists "meal_plans_public_all" on public.meal_plans;
create policy "meal_plans_public_all"
  on public.meal_plans for all
  using (true) with check (true);

-- If older recipe policies already exist, leave them. Duplicate permissive
-- policies are OK for v1. Tighten when Auth lands.
