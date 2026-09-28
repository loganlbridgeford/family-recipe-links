-- Kid chore board. Names only — not logins, not recipe authors.
-- Run after 004_rls_family_code.sql. Safe to re-run.

create table if not exists public.kids (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null,
  points_reset_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, display_name)
);

create table if not exists public.chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kid_id uuid not null references public.kids(id) on delete cascade,
  title text not null,
  points int not null default 1 check (points >= 1 and points <= 5),
  cadence text not null default 'daily' check (cadence in ('daily', 'weekdays', 'weekends', 'once')),
  created_at timestamptz not null default now()
);

create table if not exists public.chore_checks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  chore_id uuid not null references public.chores(id) on delete cascade,
  kid_id uuid not null references public.kids(id) on delete cascade,
  on_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  completed_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (chore_id, on_date)
);

alter table public.households
  add column if not exists chore_reward text;

alter table public.kids enable row level security;
alter table public.chores enable row level security;
alter table public.chore_checks enable row level security;

drop policy if exists "kids_all_own" on public.kids;
create policy "kids_all_own"
  on public.kids for all
  using (household_id = private.current_family_id())
  with check (household_id = private.current_family_id());

drop policy if exists "chores_all_own" on public.chores;
create policy "chores_all_own"
  on public.chores for all
  using (household_id = private.current_family_id())
  with check (household_id = private.current_family_id());

drop policy if exists "chore_checks_all_own" on public.chore_checks;
create policy "chore_checks_all_own"
  on public.chore_checks for all
  using (household_id = private.current_family_id())
  with check (household_id = private.current_family_id());
