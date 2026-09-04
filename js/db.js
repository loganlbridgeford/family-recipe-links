/* global window, APP_CONFIG */
(function (global) {
  const C = global.APP_CONFIG;
  let client = null;

  const HOUSEHOLD_STORAGE_KEY = 'familyPlanner.household';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function getClient() {
    if (client) return client;
    if (!global.supabase) {
      throw new Error('Supabase SDK not loaded');
    }
    client = global.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    return client;
  }

  function requireHouseholdId() {
    if (!C.HOUSEHOLD_ID) throw new Error('No family selected');
    return C.HOUSEHOLD_ID;
  }

  function randomFamilyCode() {
    const buf = new Uint8Array(8);
    (global.crypto || window.crypto).getRandomValues(buf);
    let out = '';
    for (let i = 0; i < buf.length; i += 1) out += CODE_CHARS[buf[i] % CODE_CHARS.length];
    return out;
  }

  function familyCode(row) {
    if (!row) return '';
    return String(row.invite_code || row.slug || '')
      .trim()
      .toUpperCase();
  }

  function parseFamilyCode(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s);
      const q = u.searchParams.get('family');
      if (q) return String(q).trim().toUpperCase();
    } catch (_) {
      /* not a URL */
    }
    const m = s.match(/[?&]family=([A-Za-z0-9-]+)/i);
    if (m) return m[1].toUpperCase();
    return s.replace(/\s+/g, '').toUpperCase();
  }

  function familyUrl(row) {
    const code = familyCode(row || C.HOUSEHOLD);
    const origin = global.location ? global.location.origin : '';
    const path = global.location ? global.location.pathname : '/';
    return `${origin}${path}?family=${encodeURIComponent(code)}`;
  }

  function setActiveHousehold(row) {
    C.HOUSEHOLD = row || null;
    C.HOUSEHOLD_ID = row && row.id ? row.id : '';
  }

  function readStoredHousehold() {
    try {
      return JSON.parse(global.localStorage.getItem(HOUSEHOLD_STORAGE_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function persistHousehold(row) {
    if (!row || !row.id) {
      global.localStorage.removeItem(HOUSEHOLD_STORAGE_KEY);
      return;
    }
    global.localStorage.setItem(
      HOUSEHOLD_STORAGE_KEY,
      JSON.stringify({
        id: row.id,
        name: row.name,
        code: familyCode(row)
      })
    );
  }

  async function getHousehold(id) {
    if (!id) return null;
    const { data, error } = await getClient().from('households').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function joinHousehold(rawCode) {
    const code = parseFamilyCode(rawCode);
    if (!code) return null;
    const attempts = [
      { col: 'invite_code', val: code },
      { col: 'slug', val: code },
      { col: 'slug', val: code.toLowerCase() }
    ];
    for (const attempt of attempts) {
      const { data, error } = await getClient()
        .from('households')
        .select('*')
        .eq(attempt.col, attempt.val)
        .maybeSingle();
      if (error && isMissingSchema(error)) continue;
      if (error) throw error;
      if (data) return data;
    }
    return null;
  }

  async function createHousehold(name, displayName) {
    const familyName = String(name || '').trim();
    if (!familyName) throw new Error('Family name required');
    let lastError = null;
    for (let i = 0; i < 4; i += 1) {
      const code = randomFamilyCode();
      const payload = { name: familyName, slug: code, invite_code: code };
      let ins = await getClient().from('households').insert([payload]).select().single();
      if (ins.error && isMissingSchema(ins.error)) {
        const fallback = { name: familyName, slug: code };
        ins = await getClient().from('households').insert([fallback]).select().single();
      }
      if (!ins.error) {
        const household = ins.data;
        const who = String(displayName || '').trim();
        if (who) {
          const mem = await getClient().from('household_members').insert([
            {
              household_id: household.id,
              display_name: who,
              role: 'owner',
              sort_order: 1
            }
          ]);
          if (mem.error) console.error(mem.error);
        }
        return household;
      }
      lastError = ins.error;
      if (!/duplicate|unique/i.test(String(ins.error.message || ''))) throw ins.error;
    }
    throw lastError || new Error('Could not create family');
  }

  function emptyPlan() {
    const plan = {};
    C.DAYS.forEach((d) => {
      plan[d] = { breakfast: null, lunch: null, dinner: null };
    });
    return plan;
  }

  function canPlan(recipe) {
    return !!(recipe && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0);
  }

  function isMissingSchema(error) {
    const msg = String((error && (error.message || error.details || error.hint)) || '');
    return /could not find|does not exist|schema cache|column .* of relation/i.test(msg);
  }

  function legacyRecipePayload(input) {
    return {
      name: input.name,
      url: input.url || null,
      category: input.category || 'Other',
      added_by: input.added_by,
      notes: input.notes || null,
      photo_url: input.photo_url || null,
      photo_url_back: input.photo_url_back || null
    };
  }

  async function listMembers() {
    const { data, error } = await getClient()
      .from('household_members')
      .select('id, display_name, role, sort_order')
      .eq('household_id', requireHouseholdId())
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function listRecipes() {
    const { data, error } = await getClient()
      .from('recipes')
      .select('*')
      .eq('household_id', requireHouseholdId())
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function uploadPhoto(file) {
    if (!file) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const fileName = `${requireHouseholdId()}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await getClient().storage.from(C.STORAGE_BUCKET).upload(fileName, file);
    if (error) throw error;
    const { data } = getClient().storage.from(C.STORAGE_BUCKET).getPublicUrl(fileName);
    return data.publicUrl;
  }

  function normalizeRecipePayload(input) {
    const mealTypes =
      Array.isArray(input.meal_types) && input.meal_types.length
        ? input.meal_types
        : C.CATEGORY_TO_MEAL_TYPES[input.category] || [];

    return {
      household_id: requireHouseholdId(),
      name: input.name,
      url: input.url || null,
      category: input.category || 'Other',
      added_by: input.added_by,
      notes: input.notes || null,
      photo_url: input.photo_url || null,
      photo_url_back: input.photo_url_back || null,
      ingredients: input.ingredients || [],
      meal_types: mealTypes,
      tags: input.tags || [],
      prep_minutes: input.prep_minutes == null ? null : Number(input.prep_minutes),
      servings: input.servings == null ? null : Number(input.servings),
      instructions: input.instructions || { prep: [], steps: [], tips: '' },
      updated_at: new Date().toISOString()
    };
  }

  async function addRecipe(input, frontFile, backFile) {
    const photo_url = input.photo_url || (await uploadPhoto(frontFile));
    const photo_url_back = input.photo_url_back || (await uploadPhoto(backFile));
    const merged = { ...input, photo_url, photo_url_back };
    const payload = normalizeRecipePayload(merged);
    const { data, error } = await getClient().from('recipes').insert([payload]).select();
    if (!error) return data[0];
    if (!isMissingSchema(error)) throw error;
    const retry = await getClient().from('recipes').insert([legacyRecipePayload(merged)]).select();
    if (retry.error) throw retry.error;
    return retry.data[0];
  }

  async function updateRecipe(id, input, frontFile, backFile) {
    const patch = normalizeRecipePayload(input);
    if (frontFile) patch.photo_url = await uploadPhoto(frontFile);
    if (backFile) patch.photo_url_back = await uploadPhoto(backFile);
    const { data, error } = await getClient()
      .from('recipes')
      .update(patch)
      .eq('id', id)
      .eq('household_id', requireHouseholdId())
      .select();
    if (error) throw error;
    return data[0];
  }

  async function deleteRecipe(id) {
    const { error } = await getClient()
      .from('recipes')
      .delete()
      .eq('id', id)
      .eq('household_id', requireHouseholdId());
    if (error) throw error;
    return true;
  }

  function emptyPlanRow(weekStart) {
    return {
      household_id: requireHouseholdId(),
      week_start: weekStart,
      plan: emptyPlan(),
      grocery_checked: {},
      snack_adds: [],
      manual_items: []
    };
  }

  async function getPlan(weekStart) {
    const { data, error } = await getClient()
      .from('meal_plans')
      .select('*')
      .eq('household_id', requireHouseholdId())
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) {
      if (isMissingSchema(error)) return emptyPlanRow(weekStart);
      throw error;
    }
    if (!data) return emptyPlanRow(weekStart);
    return {
      ...data,
      plan: data.plan && Object.keys(data.plan).length ? data.plan : emptyPlan(),
      grocery_checked: data.grocery_checked || {},
      snack_adds: data.snack_adds || [],
      manual_items: Array.isArray(data.manual_items) ? data.manual_items : []
    };
  }

  async function savePlan(weekStart, fields) {
    const payload = {
      household_id: requireHouseholdId(),
      week_start: weekStart,
      updated_at: new Date().toISOString(),
      ...fields
    };
    const { data, error } = await getClient()
      .from('meal_plans')
      .upsert(payload, { onConflict: 'household_id,week_start' })
      .select()
      .single();
    if (!error) return data;
    if (isMissingSchema(error) && Object.prototype.hasOwnProperty.call(fields, 'manual_items')) {
      const fallback = { ...payload };
      delete fallback.manual_items;
      const retry = await getClient()
        .from('meal_plans')
        .upsert(fallback, { onConflict: 'household_id,week_start' })
        .select()
        .single();
      if (retry.error) throw retry.error;
      return retry.data;
    }
    throw error;
  }

  async function removeRecipeFromAllPlans(recipeId) {
    const { data, error } = await getClient()
      .from('meal_plans')
      .select('*')
      .eq('household_id', requireHouseholdId());
    if (error) throw error;
    const updates = [];
    (data || []).forEach((row) => {
      let changed = false;
      const plan = row.plan || emptyPlan();
      C.DAYS.forEach((day) => {
        C.MEAL_SLOTS.forEach((slot) => {
          const raw = plan[day] && plan[day][slot];
          if (raw != null && typeof raw !== 'object' && String(raw) === String(recipeId)) {
            plan[day][slot] = null;
            changed = true;
          }
        });
      });
      const snack_adds = (row.snack_adds || []).filter((id) => id !== recipeId);
      if (snack_adds.length !== (row.snack_adds || []).length) changed = true;
      if (changed) {
        updates.push(
          getClient()
            .from('meal_plans')
            .update({ plan, snack_adds, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        );
      }
    });
    await Promise.all(updates);
  }

  async function importRecipeFromUrl(url) {
    try {
      const res = await fetch('/api/import-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { ok: false, reason: 'error', hint: 'Paste ingredients instead.' };
      }
    } catch (err) {
      console.error(err);
      return { ok: false, reason: 'fetch_failed', hint: 'Paste ingredients instead.' };
    }
  }

  global.DB = {
    getClient,
    emptyPlan,
    canPlan,
    familyCode,
    familyUrl,
    parseFamilyCode,
    setActiveHousehold,
    readStoredHousehold,
    persistHousehold,
    getHousehold,
    joinHousehold,
    createHousehold,
    listMembers,
    listRecipes,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    getPlan,
    savePlan,
    removeRecipeFromAllPlans,
    uploadPhoto,
    importRecipeFromUrl
  };
})(window);
