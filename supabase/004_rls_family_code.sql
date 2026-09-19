-- Lock household data to the invite code sent as header x-family-code.
-- Deploy the JS that sets that header BEFORE or WITH this migration.
-- Safe to re-run.

alter table public.households
  add column if not exists invite_code text;

update public.households
set invite_code = upper(slug)
where invite_code is null
  and slug is not null
  and char_length(slug) <= 12;

create unique index if not exists households_invite_code_idx
  on public.households (invite_code)
  where invite_code is not null;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.family_code_from_request()
returns text
language sql
stable
as $$
  select nullif(
    upper(trim(coalesce(current_setting('request.headers', true)::json->>'x-family-code', ''))),
    ''
  );
$$;

create or replace function private.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select h.id
  from public.households h
  where private.family_code_from_request() is not null
    and (
      upper(coalesce(h.invite_code, '')) = private.family_code_from_request()
      or upper(coalesce(h.slug, '')) = private.family_code_from_request()
    )
  limit 1;
$$;

revoke all on function private.family_code_from_request() from public;
revoke all on function private.current_family_id() from public;
grant execute on function private.family_code_from_request() to anon, authenticated;
grant execute on function private.current_family_id() to anon, authenticated;

do $$
declare r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('households', 'household_members', 'recipes', 'meal_plans')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "households_select_own"
  on public.households for select
  using (id = private.current_family_id());

create policy "households_insert"
  on public.households for insert
  with check (true);

create policy "households_update_own"
  on public.households for update
  using (id = private.current_family_id())
  with check (id = private.current_family_id());

create policy "households_delete_own"
  on public.households for delete
  using (id = private.current_family_id());

create policy "members_all_own"
  on public.household_members for all
  using (household_id = private.current_family_id())
  with check (household_id = private.current_family_id());

create policy "recipes_all_own"
  on public.recipes for all
  using (household_id = private.current_family_id())
  with check (household_id = private.current_family_id());

create policy "meal_plans_all_own"
  on public.meal_plans for all
  using (household_id = private.current_family_id())
  with check (household_id = private.current_family_id());
