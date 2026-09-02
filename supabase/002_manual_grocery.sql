alter table public.meal_plans
  add column if not exists manual_items jsonb not null default '[]'::jsonb;
