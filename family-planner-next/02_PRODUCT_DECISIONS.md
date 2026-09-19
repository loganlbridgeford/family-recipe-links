# Decisions on your four requests

## 1. Recipes must appear on the Plan tab — including ones not in the app

**You are right. The current gate is wrong.**

I blocked calendar assign unless a recipe had ingredients so grocery lists would be complete. That made the Plan tab feel empty and punished the exact recipes your family already saved (URL + photo cards).

New rules:

- Any household recipe can be dropped on any breakfast / lunch / dinner cell.
- The picker shows **all** recipes, not only “Ready to plan.”
- A recipe with no ingredients still belongs on the week. Grocery simply skips it and shows a small note: “3 planned meals have no ingredients yet.”
- The Plan tab also needs **one-off meals that are not in the library**:
  - Leftovers
  - Eating out
  - “Nadine’s soup” typed in the moment
  - A recipe URL pasted straight onto a day (save into the library in the background)

How the cell should work after this change:

1. Tap empty cell.
2. Three choices at the top of the picker:
   - **Pick a household recipe**
   - **Type a one-off** (name only, checkbox “also save to Recipes”)
   - **Paste a recipe link** (imports, then assigns — see #2)
3. Tap a filled cell → view / change / clear.

Do not require meal type to match the slot. If they want leftover chili for lunch, let them.

---

## 2. Ingredients should pull from the website

This is the #1 “less think” feature in the whole category. Paprika, Plan to Eat, Samsung Food, and every new AI app lead with it.

How it actually works (plain English):

Most food blogs embed a hidden recipe card in the page (schema.org / JSON-LD). A small server function fetches the URL and reads:

- name
- ingredient lines
- steps
- time / servings
- photo if present

The user reviews a preview and taps Save. They do not type ingredients.

Limits you must expect:

- Grandma’s Facebook post, many TikToks, and paywalled NYT recipes will fail.
- Some sites block scrapers.
- CORS means **the browser cannot fetch the recipe page itself**. You need a Vercel serverless function (or similar) that fetches on the user’s tap.

Fallback ladder (this is what makes it feel easy instead of broken):

1. Paste URL → auto-extract.
2. If extract fails → “Paste the ingredient list” box.
3. If they only have a card photo → keep the photo; optional later: Grok reads the photo.
4. Manual rows remain as last resort.

Do not promise “every website.” Promise “most food blogs and Allrecipes-style pages, with a paste backup.”

Legal / practical: only fetch when a person pastes a URL. Store a copy for the household. Keep the source link. Do not crawl the internet in bulk.

Grok API is the right *upgrade* when JSON-LD is missing (messy blogs, photos of cards). Do JSON-LD first. It is cheaper, faster, and more accurate on normal recipe sites.

---

## 3. Reminders app and Calendar

Short truth: **a Vercel website cannot write directly into the iPhone Reminders database.**

Apple keeps Reminders and Calendar behind EventKit, which only a **native iOS app** (or a Shortcut the user installs) can use. AnyList and Cozi feel “connected” because they shipped App Store apps.

What you can do from the web app, in order of payoff:

| Phase | What the user gets | Effort |
|---|---|---|
| Now | Copy grocery list (you have this) | Done |
| Now | **Share** button — iPhone share sheet → Reminders / Messages / Notes | Small |
| Now | **Download week as .ics** — user taps, iOS offers Calendar | Small |
| Next | A page titled “Add to my iPhone” with a ready-made Shortcut that turns a copied list into Reminders | Medium, no code in Apple’s system |
| App Store later | Real Reminders list + Calendar events via EventKit / App Intents | Requires wrapping the web app (Capacitor) |

Do not build a fake “Connect to Reminders” toggle that cannot work. It will train the family to distrust the app.

Recommended copy in the app:

> Share this list to Reminders, or download the week to Calendar. Direct sync comes when Family Planner is on the App Store.

That is honest and still useful tonight.

---

## 4. Grocery list = meals + manual items

Correct. AnyList wins because the list is a list, not a recipe report.

New grocery model:

- **From plan** — ingredients of planned recipes that have them. Tag the row with the recipe name so they know why “2 lbs chicken” is there.
- **Manual** — “bananas”, “paper towels”, “lunchbox yogurt.” Typed or tapped from a small quick-add.
- Checking off still works for both.
- Manual items survive when you clear the week’s meals (optional keep / clear prompt).
- Removing a meal from the plan removes its auto items, not the manual ones.

Quick-add should feel like iOS Reminders: one field at the top of the Grocery tab, Enter to add, default section “Other.”

---

## Build order (do not reshuffle)

1. Unlock the Plan tab (any recipe + one-off name). This is the bug your family already hit.
2. Manual grocery add.
3. URL ingredient import (Vercel function).
4. Share sheet + .ics export.
5. Only then talk App Store / Reminders sync.

If you do 3 before 1, you still cannot put Grandma’s card on Monday.
