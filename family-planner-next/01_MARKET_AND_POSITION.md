# Market research — family meal + grocery apps (2026)

## Should you use a Grok bot for this?

**No, not for this decision.** I should do the research. A Grok bot is the wrong tool for a one-time market + product call.

Use a bot later for a *recurring* job, for example:

- weekly “what did Plan to Eat / AnyList / Samsung Food ship?”
- watch App Store reviews for the phrase “shared grocery list”
- alert you when a competitor adds URL import or Reminders sync

Use me (this chat) for:

- strategy
- architecture
- the next Cursor brief
- debugging the live app

A bot does not replace sitting with Nadine for one Sunday and watching where she gets stuck. That test beats every comparison blog.

---

## How crowded is this?

Very. That is normal.

Industry reports put meal-planning apps around **$1.6–1.8B in 2025**, growing low-double-digits. Grocery-list automation is a separate, larger pile of apps (AnyList, Bring!, OurGroceries, Out of Milk, plus every supermarket app).

No single product owns more than a small slice. Comparison sites in 2026 list **8–12 “best” apps** and they do not even agree on the winner. That is a fragmented category, not a winner-take-all category.

You will not win by having “a calendar and a grocery list.” Everyone has that. You win by being the app a *specific household type* actually opens on Sunday night and at the store.

Your household type is clear:

- dual-military / busy parents
- several adults who add recipes (not one “food person”)
- mix of blog URLs, handwritten cards (photos), and “we’re just doing leftovers”
- need the same week on two phones
- want less thinking, not more data entry

That is closer to **Plan to Eat + AnyList** than to Mealime or Eat This Much.

---

## What the main apps actually do

Treat comparison-blog “#1” badges as ads. The feature patterns are what matter.

### 1. Plan to Eat — closest analog to what you are building
- Bring your own recipes
- Drag them onto a week calendar
- Grocery list builds from whatever is on the calendar
- Household sharing
- URL import
- Paid (~$50/year), no real free tier
- Weakness: one shared login, not individual members; feels like software from 2014

### 2. AnyList — wins shared grocery, meal plan is secondary
- Best-in-class shared list (live checkoffs, cheap household plan ~$15/year)
- Meal calendar exists but is not the product
- Voice / Siri extras because it is a **native** app
- Weakness: recipe import and planning sit behind Complete; not a family recipe box first

### 3. Paprika 3 — best recipe clipper, worst family product
- Pay once per platform
- Excellent “paste a URL, get ingredients”
- Almost no household sharing (shared password)
- You will lose family users here

### 4. Mealime / eMeals / Eat This Much — they pick dinner for you
- Fast for people with no recipe collection
- Usually **cannot import Grandma’s chili**
- Wrong model for a family that already has cards and links

### 5. Samsung Food (old Whisk) — free all-rounder
- Save from the web, plan, list
- Household features exist
- Product is a content feed + appliance play, not a quiet family tool

### 6. Cozi / FamilyWall / FamilySora — household OS
- Calendar, chores, lists, meals as one more module
- Meals are rarely best-in-class
- Useful reminder: families already live in Calendar and Reminders. A meal app that ignores that feels like another inbox.

### 7. New AI wave (FoodiePrep, MenuMagic, Recipe One, Ollie, etc.)
- Pitch: import from TikTok / photo / URL, auto-plan the week
- Crowded and noisy
- Import quality is the actual product. Planning is the wrapper.

---

## What families complain about (the gap)

Across those reviews, the same pain repeats:

1. **Too much typing.** If adding a recipe means filling 12 ingredient rows, they quit.
2. **Cannot put “real life” on the calendar.** Leftovers, takeout, school dinner, “Dad grilling.”
3. **Grocery list is only food-from-recipes.** Diapers, foil, coffee filters, kid snacks never appear.
4. **Sharing is fake.** Shared password, or only one person can edit.
5. **The app does not meet them in Reminders / the store.** Native list apps win at the supermarket. Web apps lose if checkoff sync is slow.
6. **Paywalls after the habit forms.** Free tier gets stripped.

You already have a real differentiator started: **a household recipe box that accepts a photo of a card, a URL, or a typed recipe, plus a shared week.** Most apps pick one of those capture methods and ignore the others.

Do not try to beat Mealime at “we choose your dinners.”
Do not try to beat AnyList at Siri in month one.
Do beat Plan to Eat at *less typing* and *any meal can go on the week*.

---

## How to be “a little better” without boiling the ocean

Priority order for a product people will pay for later:

1. **Zero-friction capture** — paste URL or snap card → ingredients appear. Manual entry is the fallback, not the default.
2. **The week accepts reality** — library recipe, one-off name, leftovers, eating out.
3. **Grocery is a list, not a report** — auto from the week + “add milk” + “add trash bags.”
4. **Two phones, same truth** — you are already pointed here with Supabase.
5. **Leave the house** — copy list, share sheet into Reminders, later a real iOS wrapper.

That is the whole strategy. Nutrition, Instacart, TikTok import, and a public recipe social network can wait until a second household besides yours uses it for 30 days.
