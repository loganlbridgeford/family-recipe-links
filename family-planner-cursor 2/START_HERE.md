# Start here (you)

SQL is done. The three-tab app is in this folder. Copy it onto `planner-merge` and deploy a preview.

```bash
cd ~/projects/family-recipe-links
git checkout planner-merge   # or: git checkout -b planner-merge

# From the unpacked pack:
cp index.html app.js styles.css .
mkdir -p js supabase
cp js/config.js js/db.js js/
cp supabase/001_household_planner.sql supabase/

# Keep family.jpg and food-bg.jpg. Do not delete them.
```

Then either:

- open `index.html` via a local static server, or
- `git add . && git commit && git push` and let Vercel build a preview for `planner-merge`

Do not merge to `main` until:

1. Existing recipe cards still show
2. You can add a URL-only recipe
3. That recipe cannot be assigned until it has an ingredient
4. A planned dinner appears on a second phone
5. Grocery checkboxes survive a refresh

If members dropdown is empty or recipes say they cannot load, the SQL did not apply to this project — re-run `supabase/001_household_planner.sql`.
