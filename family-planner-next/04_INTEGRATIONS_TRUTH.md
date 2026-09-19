# Integrations — what is actually possible

## Reminders

**Web app (current Vercel site)**
- Cannot create or edit an Apple Reminders list.
- Can put text on the clipboard.
- Can open the iOS Share Sheet (`navigator.share`) with the grocery text. On iPhone, Reminders appears in that sheet if the user has it.
- Can deep-link to the Reminders app with `x-apple-reminderkit://` or `reminders://` but you cannot pass a full shopping list in a reliable, supported way.

**Shortcuts**
- You can publish a Shortcut recipe: “Take clipboard → split lines → add Reminders in list Family Groceries.”
- The user taps it once to install. After that, Copy in your app + Run Shortcut is two taps.
- You do not need App Store review for a Shortcut.

**Native iOS app (later)**
- EventKit / EventKitUI or App Intents can create a list named “Family Groceries” and upsert items.
- This is the real “connected to Reminders” feature.
- Requires an Apple Developer account, Capacitor (or similar) wrapper, and App Store review.
- Do this after the web product is used weekly. Not before.

## Calendar

**Web app**
- Generate an `.ics` file for the week (one event per planned meal, 30–60 min at breakfast/lunch/dinner hours you choose).
- User taps “Add week to Calendar.” iOS/macOS offers Calendar.
- Optional: a `webcal://` link if you later host a live feed. Skip for v1.

**Native later**
- EventKit can write events into a “Family Meals” calendar and update them when the plan changes.
- Google Calendar OAuth is possible from the web, but your family lives on iPhone. Do Apple first when you wrap the app.

## What not to do

- Do not ask for Apple ID inside the website.
- Do not store Reminders credentials.
- Do not promise two-way sync from Vercel.
- Do not spend a sprint on Google Calendar if the household calendar is iCloud.

## Recommended labels in the UI

Grocery tab buttons:
- Copy list
- Share list (native share sheet)
- Add extra item

Plan tab button:
- Add week to Calendar (.ics)

Footer note:
- Direct Reminders and Calendar sync ships with the iPhone app.
