# Start here (you, not Cursor)

Goal tonight: schema + Cursor working against the real repo, no framework, same Vercel URL.

## 1. Copy the pack into the repo

```bash
cd ~/projects/family-recipe-links
git checkout -b planner-merge
# copy the four files from the Cursor pack:
#   CURSOR.md
#   FIRST_PROMPT.md
#   supabase/001_household_planner.sql
#   js/config.js
#   js/db.js
```

Keep `index.html`, `app.js`, `styles.css`, and the family photos. Do not replace them until Cursor step 4.

## 2. Run the SQL once

Supabase dashboard → project `tthmojfercxemrqghbfm` → SQL Editor → paste `supabase/001_household_planner.sql` → Run.

You should see the Bridgeford household row and 8 members. Existing recipes get `household_id` filled in. Nothing is deleted.

## 3. Open Cursor on that repo

Composer → Agent → paste the entire contents of `FIRST_PROMPT.md`.

Stay on the call for step 1–2 of the prompt (refactor only). Confirm recipes still load locally or via `vercel --prod` only after you have looked at the page.

## 4. Deploy rule

Preview deploy is fine anytime.
Production (`main` → family-recipe-links.vercel.app) only after:

- existing recipe cards still show
- you can add a recipe
- Plan tab saves and a second device sees it

## Why this order

The live site is already the family library. If we redesign the UI before the data layer exists, we ship a pretty empty calendar and hide the recipes people already added.
