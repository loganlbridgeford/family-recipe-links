-- One public row so a scheduled anon read can keep the free project awake
-- without the family invite code. Safe to re-run.

create table if not exists public.keep_alive (
  id int primary key,
  pinged_at timestamptz not null default now()
);

insert into public.keep_alive (id)
values (1)
on conflict (id) do nothing;

alter table public.keep_alive enable row level security;

drop policy if exists "keep_alive_select" on public.keep_alive;
create policy "keep_alive_select"
  on public.keep_alive
  for select
  to anon, authenticated
  using (true);

revoke all on table public.keep_alive from public, anon, authenticated;
grant select on table public.keep_alive to anon, authenticated;
