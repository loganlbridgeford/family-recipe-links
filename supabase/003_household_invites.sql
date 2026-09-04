-- Family invite codes
-- Optional. The live app currently stores the code in households.slug
-- (Bridgeford slug was rotated to an unguessable code). Run this when you
-- want a dedicated invite_code column. Safe to re-run.

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
