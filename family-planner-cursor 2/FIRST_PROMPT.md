# Paste this into Cursor Composer (Agent mode)

Read `CURSOR.md` all the way through before writing any code. Follow it exactly.

Context: this repo is the live Family Recipe Links site (vanilla HTML/CSS/JS + Supabase). I also have a local meal-planner prototype (calendar, grocery list, generate-week) that saved to localStorage. We are merging them into one household app on this same repo / same Vercel URL.

Do this sprint in order. Stop after each numbered step and summarize what changed.

1. Copy `js/config.js` and `js/db.js` from the Cursor pack I dropped in the repo (or recreate them exactly as specified in CURSOR.md). Load them from `index.html` BEFORE `app.js`:
   - supabase-js CDN
   - js/config.js
   - js/db.js
   - app.js
2. Refactor the current `app.js` so every Supabase call goes through `window.DB`. No UI redesign yet. Existing recipes must still list / add / delete.
3. Remind me to run `supabase/001_household_planner.sql` in the Supabase SQL editor before you depend on new columns. If I have not confirmed it ran, keep new-column writes defensive.
4. After I confirm SQL is applied, rebuild `index.html` into three tabs: Plan, Recipes, Grocery. Keep the family banner and background. Port calendar + grocery + generate-week behavior from the meal-planner prototype. Persist the week plan with `DB.getPlan` / `DB.savePlan`.
5. Extend the recipe form with meal types, tags, ingredient rows, steps. A recipe cannot be assigned to the calendar unless `DB.canPlan(recipe)` is true.
6. Run through the manual test checklist in CURSOR.md and fix anything that fails.

Constraints:
- No React, Next, Vite, TypeScript, Tailwind, or bundler
- No Supabase Auth this sprint
- Every query filters by `APP_CONFIG.HOUSEHOLD_ID`
- Do not delete family.jpg / food-bg.jpg
- Do not invent a second database
- Prefer editing existing files over creating a parallel app folder
