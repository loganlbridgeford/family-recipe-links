# Family Planner — Cursor Operating Brief

You are implementing a merge of two existing vanilla JS apps into ONE product.

Do not introduce React, Next.js, Vite, TypeScript, Tailwind, or a build step.
Stack is locked: vanilla HTML + CSS + JS, Supabase JS v2 CDN, Vercel static deploy.

Repo: `loganlbridgeford/family-recipe-links`
Live URL stays: `https://family-recipe-links.vercel.app`
Local path: `~/projects/family-recipe-links`

Work on branch `planner-merge`. Do not force-push main until Logan says the schema is applied and the family has seen a preview.

---

## Product (v1)

One household app with three tabs:

1. **Plan** — Mon–Sun, Breakfast / Lunch / Dinner. Shared across devices.
2. **Recipes** — existing family library (name, URL, photos, notes, added-by) PLUS structured ingredients, meal types, tags, prep time, servings, steps.
3. **Grocery** — built from the current week’s planned meals + optional snacks. Checkable. Copy list.

A recipe may exist as a photo/URL card with no ingredients.
A recipe **cannot be assigned to the calendar** until it has at least one ingredient.
That rule is the source of truth for grocery lists.

v1 access: open (anon key + public RLS). Do not add Supabase Auth yet.
v1 household: single default household in `js/config.js`. All queries filter by `household_id`.
This is how the app becomes multi-household later without a rewrite.

---

## What already exists (do not throw away)

Live app files at repo root:

- `index.html` — add-recipe form, category chips, recipe cards, family banner
- `app.js` — Supabase client, list/add/delete recipes, photo upload to `recipe-photos`
- `styles.css` — current visual language (cream/green, family banner)
- `family.jpg`, `family.jpeg`, `food-bg.jpg`

Meal planner reference (uploaded separately, not in this repo):

- weekly calendar grid
- generate-week scorer (weekend batch-cook bias, weekday speed)
- grocery grouped by store section
- custom recipe form with ingredient rows
- snack “add to grocery”

Reuse those behaviors. Do not copy localStorage as the source of truth.

Existing `recipes` table columns in use today:

- `id`, `name`, `url`, `category`, `added_by`, `notes`
- `photo_url`, `photo_url_back`, `created_at`

---

## Target file layout after this sprint

Keep it flat enough for Vercel static hosting. Do not nest into `src/`.

```
index.html
styles.css
app.js                 # UI only (render + events)
js/config.js           # supabase url/key, household id, labels
js/db.js               # all Supabase reads/writes
js/seed-meals.js       # optional starter recipes (not auto-inserted)
supabase/001_household_planner.sql
family.jpg
food-bg.jpg
CURSOR.md              # this file
```

`app.js` must not contain raw `.from("recipes")` calls after the split. All data goes through `js/db.js`.

---

## Data rules

### Household

`js/config.js` exports:

```js
export const HOUSEHOLD_ID = "7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01";
```

Vanilla scripts are not modules on this site today. **Do not switch the whole app to ES modules unless you also add `type="module"` on every script and verify Vercel still serves it.** Prefer:

```js
window.APP_CONFIG = { ... };
window.DB = { ... };
```

No build step is more important than prettier imports.

### Recipes

Every recipe row belongs to a household.

New columns (added by SQL, nullable so old rows survive):

- `household_id uuid`
- `ingredients jsonb` default `[]`
  - `{ "item": "Eggs", "qty": "8", "section": "dairy" }`
- `meal_types text[]` default `{}`
- `tags text[]` default `{}`
- `prep_minutes int`
- `servings int`
- `instructions jsonb` default `{}`
  - `{ "prep": [], "steps": [], "tips": "" }`
- `updated_at timestamptz`

`category` stays for backward compatibility with existing cards.
When saving a recipe, also set `meal_types` from the meal-type chips (breakfast/lunch/dinner/snack).
If the user only picks a legacy category, map it:

```
Breakfast → ['breakfast']
Lunch → ['lunch']
Dinner → ['dinner']
Snack → ['snack']
Appetizer / Dessert / Other → [] (library-only until they add a meal type)
```

`canPlan(recipe)` = `Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0`

### Members

Do not hardcode the Added-by list in HTML.

Load `household_members` for `HOUSEHOLD_ID` and render the dropdown.
Seed the current family names in SQL so v1 looks the same.

### Meal plan

One row per household per week:

```
meal_plans (
  household_id,
  week_start date,          -- Monday ISO
  plan jsonb,               -- { mon: { breakfast, lunch, dinner }, ... } values are recipe ids or null
  grocery_checked jsonb,    -- { "eggs": true }
  snack_adds jsonb          -- [recipeId, ...]
)
```

Upsert on `(household_id, week_start)`.

Debounce writes at 500ms like the old planner. Optimistic UI is fine.

---

## UI requirements

Keep the family banner and food background. The product is still this family while we test.

Top nav tabs: **Plan | Recipes | Grocery**
Week nav on Plan and Grocery (prev / today / next). Changing week on one updates both.

### Plan tab

- 3×7 calendar (row labels + 7 day headers with dates)
- Empty cell: “Tap to add”
- Filled cell: name, prep minutes, Batch badge if tagged, Family/photo badge optional
- Tap filled → recipe detail modal
- Tap empty → picker filtered to that slot’s meal type AND `canPlan === true`
- Picker actions: View Recipe, Add to Calendar, Clear slot
- “Fill empty slots” uses the existing scoring idea:
  - Sat/Sun dinner prefers `batch-cook`
  - Mon–Wed dinner prefers leftovers-friendly or batch-cook
  - Weekday breakfast prefers `quick`
  - Avoid reusing the same recipe in the same week when alternatives exist
- Only fill empty slots. Never overwrite a chosen meal unless user clicks Clear Week.

### Recipes tab

Preserve current add flow (URL + front/back photos + notes + added by).
Add a second section on the same form (progressive disclosure is fine):

- Meal types chips
- Tags chips
- Prep minutes / servings
- Ingredient rows (item, qty, store section)
- Prep lines / steps / tips

Recipe cards:

- Keep photo thumbs and outbound URL
- Show “Ready to plan” vs “Add ingredients to use on calendar”
- Edit + Delete
- Assign to calendar (opens day/slot modal) only if `canPlan`

Search must include name, notes, added_by, url, ingredient item names, steps.

### Grocery tab

- Group by section: produce, meat, dairy, pantry, frozen, bakery, other
- Combine duplicate item names; show qty strings joined with ` + `
- Checkbox state persists in `meal_plans.grocery_checked`
- Copy list as plain text
- Snack recipes can be toggled onto the grocery list without putting them on the calendar

### Mobile

This is used on phones in a kitchen. 48px tap targets. Calendar may scroll horizontally on small screens. Do not shrink tap targets to make the grid fit.

---

## Explicit non-goals for this sprint

- Supabase Auth / magic links
- Multi-household switcher UI
- Instacart / store APIs
- Nutrition
- Service worker / PWA (next sprint, not this one)
- App Store / Capacitor
- Hard-deleting photo files from storage when a recipe is deleted (nice-to-have later)
- Rewriting in a framework

---

## Implementation order (follow this)

1. Add `js/config.js` and `js/db.js`. Wire existing list/add/delete through `db.js` with no UI change. Confirm live recipes still load.
2. Logan runs `supabase/001_household_planner.sql` in the Supabase SQL editor. You do not invent a second database.
3. Backfill `household_id` on existing recipes (SQL does this).
4. Rebuild `index.html` with the three tabs. Port Plan + Grocery UI from the meal-planner reference.
5. Extend the recipe form and cards for ingredients / plan-readiness.
6. Connect calendar assign + grocery build to `db.js`.
7. Manual test checklist at the bottom of this file.

If a step fails, stop and fix that step. Do not “finish the UI” against localStorage.

---

## Config values (already in the live app)

```
SUPABASE_URL = https://tthmojfercxemrqghbfm.supabase.co
```

Anon key stays in `js/config.js` (already public in the current `app.js`).
Do not print the key in commit messages or README.

Storage bucket: `recipe-photos` (already working).

---

## Manual test checklist

- [ ] Existing family recipes still appear after deploy
- [ ] Adding a URL-only recipe still works (no ingredients required)
- [ ] URL-only recipe cannot be placed on the calendar
- [ ] Adding ingredients to that recipe, then assigning Mon dinner, works
- [ ] Second browser / phone sees the same week plan
- [ ] Grocery list updates when the plan changes
- [ ] Grocery checkboxes survive a refresh
- [ ] Week next/prev does not destroy the previous week’s plan
- [ ] Delete recipe clears it from any planned slots
- [ ] Family banner and photos still load
- [ ] Mobile: cells and buttons are tappable with a thumb

---

## Voice / copy

Product name on the banner can become **Family Planner** with subtitle **Meals · Recipes · Grocery**.
Do not rename the GitHub repo or Vercel project in this sprint.
Do not write “powered by AI” anywhere in the UI.
