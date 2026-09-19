# Cursor steps — do these in order

How to use this file:

- Work in repo `~/projects/family-recipe-links` on branch `planner-merge`.
- Open Cursor Composer in **Agent** mode.
- Copy **only the step you are on** (the “Paste into Cursor” box).
- After Cursor finishes, do the “You check” list yourself on a phone or browser.
- Only then copy the next step.

If Cursor starts rewriting `js/db.js` from scratch or adding React, stop it and paste:

> Stop. Edit the existing vanilla files only. No React, no Vite, no TypeScript.

---

## Step 0 — Confirm you are on the merged app

**You do this, not Cursor.**

1. Open the preview URL or local `index.html`.
2. Confirm you see three tabs: Plan, Recipes, Grocery.
3. Confirm household recipes load on the Recipes tab.
4. Confirm the family banner photo still shows.

If recipes do not load, the SQL from `001_household_planner.sql` is not on this Supabase project. Run it again, then come back.

---

## Step 1 — Let ANY recipe go on the Plan tab

### Why
Right now the picker hides recipes that have no ingredients. That is why the Plan tab looks empty.

### Paste into Cursor

```
Read js/db.js, js/config.js, and app.js.

Change ONLY the Plan picker and Assign button rules:

1. DB.canPlan(recipe) must no longer be required to show a recipe in the picker, to show an Assign button, or to put a recipe on a calendar cell.
2. Keep DB.canPlan as a helper. Use it only to decide whether that recipe contributes ingredients to the grocery list.
3. In renderPickerList, list every household recipe. If a recipe has no ingredients, still show it, with a small note: “No ingredients — won’t add to grocery.”
4. On recipe cards, always show Assign. If it has no ingredients, the button label can stay “Assign”.
5. Fill-empty-slots (generate) should still prefer recipes that have ingredients AND a matching meal type. If none exist, skip that slot rather than inventing data.
6. Do not change the database.
7. Do not add a framework.

When done, tell me every function you changed.
```

### You check
- [ x] Recipes tab: a URL-only recipe has an Assign button.
- [ x] Plan tab: tap an empty cell → that same recipe is in the list.
- [ x] Assign it to Monday dinner. Cell shows the name.
- [ x] Grocery tab: that meal does **not** invent fake ingredients.
- [ x] Refresh the phone. Monday dinner is still there.

---

## Step 2 — One-off meals (not in the library)

### Why
“Leftovers” and “eating out” are real plan items. They should not require a full recipe form.

### Paste into Cursor

```
Read app.js picker UI and js/db.js savePlan.

Add a one-off meal option in the Plan picker.

Data rule:
- A calendar slot may store either a recipe id (as today) OR an object:
  { "type": "custom", "name": "Leftovers" }
- When reading an old plan, if a slot value is a string/uuid, treat it as a recipe id (backward compatible).
- Helper: function slotValue(plan, day, slot) that returns { type:'recipe', id, recipe } or { type:'custom', name } or null.

UI:
- At the top of the picker, add a short form: text field “Or type a meal name” and button “Add to Calendar.
- Optional checkbox: “Also save to Recipes” (off by default). If checked, create a minimal recipe (name, category Other, added_by first member or current dropdown if present) then assign that id.
- Calendar cell for a custom meal shows the typed name and no prep badge.
- Grocery ignores custom meals.
- Clear slot still works.
- Add function to click and drag recipes from one meal slot to the next on Plan tab
- Meal select filter when selecting a meal in plan tab should match the categories in the recipe tab. 

Do not migrate old rows in SQL. Handle both shapes in JS.
Do not add React.
```

### You check
- [x ] Tap Tuesday lunch → type `Leftovers` → cell says Leftovers.
- [ x] Refresh. Still says Leftovers.
- [ x] Grocery did not add a “Leftovers” ingredient.
- [ x] A normal library recipe still assigns the old way.
- [ x] drag and drop
- [ x] meal filters changed to categories
---

## Step 3 — Manual grocery items

### Why
Not everything on a grocery list comes from dinner.

### Paste into Cursor

```
Read js/db.js savePlan / getPlan and the Grocery tab in app.js and index.html.

Add manual grocery items onto the existing meal_plans row. Do not create a new table yet.

Shape:
meal_plans.manual_items jsonb, default []
Each item: { "id": "manual-173...", "item": "Paper towels", "qty": "", "section": "other", "checked": false }

SQL I will run myself after you write it. Create a file supabase/002_manual_grocery.sql that only does:

  alter table public.meal_plans
    add column if not exists manual_items jsonb not null default '[]'::jsonb;

JS:
- getPlan / savePlan must read and write manual_items.
- Grocery tab: input at the top, placeholder “Add anything — bananas, foil, toothpaste”, button Add.
- Pressing Enter in that field also adds.
- Manual rows appear in the matching store section, marked with a small “Added” label so they are distinct from recipe ingredients.
- Checkbox state for manual items lives on the item.checked field, not in grocery_checked.
- Recipe-generated rows stay as they are.
- Clearing the week: prompt “Also clear extra grocery items?” Default No.
- assign to calendar from recipe shows a calendar not a drop down menu date selection
- add remove meal button when clicking on recipe in the plan tab
- fill empty slots button on plan tab needs to have the filters replaced with the categories

Update index.html with the input. Match existing CSS. No new frameworks.
```

### You do after Cursor finishes
1. Open Supabase SQL editor.
2. Paste and run `supabase/002_manual_grocery.sql`.
3. Reload the app.

### You check
- [ x] Grocery tab: type `Paper towels`, Enter. It appears under Other.
- [ x] Check it off. Refresh. Still checked.
- [ ] Plan a recipe that has ingredients. Both the recipe items and paper towels show.
- [ x] Clear week. Choose **not** to clear extras. Paper towels remain.

---

## Step 4 — Import ingredients from a recipe URL

This step has two parts. Do A, test, then B.

### 4A — Server function that reads a recipe page

Vercel static sites can add one serverless function.

Create `api/import-recipe.js` (Vercel serverless).

### Paste into Cursor

```
Create api/import-recipe.js for Vercel.

It is a POST endpoint. Body: { "url": "https://..." }.

Rules:
- Only allow http and https URLs.
- Fetch the page server-side with a normal browser User-Agent.
- Timeout 8 seconds.
- Parse JSON-LD blocks for schema.org Recipe (also @graph arrays).
- Return JSON:
  {
    ok: true,
    name, description, image,
    ingredients: ["2 cups flour", ...],   // raw strings
    steps: ["...", ...],
    prepMinutes, cookMinutes, servings, sourceUrl
  }
- If no Recipe JSON-LD is found, return { ok: false, reason: "no_schema", hint: "Paste ingredients instead." } with status 200.
- Never return HTML error pages.
- Do not use a paid third-party scraper API.
- Add a short comment at the top: user-initiated fetch only, no crawling.
- if adding a grocery item from a recipe added to calendar, put the recipe in () on the grocery list. Example: Heavy Cream (Alfredo Sauce.) This will allow people to see duplicates

Also add a tiny client helper in js/db.js:

  async function importRecipeFromUrl(url) {
    const res = await fetch('/api/import-recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    return res.json();
  }

Expose it on window.DB.
```

### You check 4A

You want `ok: true` and an ingredients array. If Allrecipes blocks you, try Budget Bytes or Simply Recipes. If every site fails, stop and send me the JSON error before 4B.

### 4B — Wire it to the Add Recipe form

### Paste into Cursor

```
On the Recipes form, under Recipe URL, add a button “Pull ingredients from link”.

Flow:
1. User pastes URL.
2. Taps the button.
3. Button shows “Reading page…”.
4. Call DB.importRecipeFromUrl(url).
5. If ok:
   - Fill name if empty.
   - Fill servings / prep if present.
   - Replace ingredient rows with parsed lines.
     Parse each raw line into { item, qty, section }.
     Simple parse is fine: leading qty tokens (numbers, fractions, cups/tbsp/lb) go to qty, the rest to item.
     Default section pantry. Guess produce/meat/dairy with a small keyword list.
   - Put steps into the steps textarea, one per line.
   - Open the Cook details <details> so they can see what was pulled.
   - Toast “Check the ingredients, then save.”
6. If not ok:
   - Toast the hint.
   - Focus a new textarea “Paste ingredients (one per line)” and a button “Use pasted list” that fills rows.
7. User still has to tap Save Recipe. Never auto-save an import.
8. After save they can Assign that recipe from the card.

Keep photo upload working. Import does not remove photos.
```

### You check 4B
- [ ] Paste a real family recipe URL you use. Pull ingredients. Rows appear.
- [ ] You can edit a wrong line before Save.
- [ ] Save. Recipe shows “Ready” or at least has ingredients.
- [ ] Assign it to a night. Grocery lists those ingredients.
- [ ] A garbage URL shows a friendly failure, not a blank screen.

---

## Step 5 — Share list + add week to Calendar

### Paste into Cursor

```
Grocery tab:
- Keep Copy list.
- Add “Share list” button. If navigator.share exists, share the same plain-text grocery list (title “Family grocery list”). If not, fall back to copy + toast “Copied — paste into Reminders”.

Plan tab toolbar:
- Add “Add week to Calendar” button.
- Build a simple .ics file in the browser:
  - One VEVENT per filled slot
  - SUMMARY = meal name
  - DTSTART = that day’s breakfast 07:30, lunch 12:00, or dinner 18:00 local
  - DURATION 1 hour
  - DESCRIPTION = “From Family Planner”
- Trigger a file download named family-plan-YYYY-MM-DD.ics
- Do not call any Apple or Google API.

Add one line of helper text under the grocery buttons:
“On iPhone: Share list → Reminders. Calendar file imports into the Calendar app.”

No new dependencies.
```

### You check
- [ ] iPhone Safari: Share list → Reminders appears as a target (or at least Messages).
- [ ] Add week to Calendar downloads a file. Opening it on iPhone offers Calendar.
- [ ] Events show the meal names on the right days.

---

## Step 6 — Stop and use it for one week

Do not start Auth, Instacart, TikTok import, or Capacitor.

You and Nadine use Plan + Grocery for seven days. Write down every time someone says “why can’t I just…”

Bring that list here. That is the real product research.

---

## If Cursor gets lost

Paste this and nothing else:

```
You are editing a vanilla HTML/CSS/JS app on Vercel with Supabase.
Do not add React, Vue, Next, Vite, Tailwind, or TypeScript.
Do not create a new repo.
Do not change SUPABASE_URL or HOUSEHOLD_ID.
Show a diff of the files you will change before you change them.
```
