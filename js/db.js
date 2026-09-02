/* global window, APP_CONFIG */
(function (global) {
  const C = global.APP_CONFIG;
  let client = null;

  function getClient() {
    if (client) return client;
    if (!global.supabase) {
      throw new Error('Supabase SDK not loaded');
    }
    client = global.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    return client;
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
      .eq('household_id', C.HOUSEHOLD_ID)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function listRecipes() {
    const scoped = await getClient()
      .from('recipes')
      .select('*')
      .eq('household_id', C.HOUSEHOLD_ID)
      .order('name', { ascending: true });

    if (!scoped.error) {
      const scopedRows = scoped.data || [];
      if (scopedRows.length) return scopedRows;
      const all = await getClient().from('recipes').select('*').order('name', { ascending: true });
      if (all.error) return scopedRows;
      return (all.data || []).filter((r) => !r.household_id || r.household_id === C.HOUSEHOLD_ID);
    }

    if (isMissingSchema(scoped.error)) {
      const { data, error } = await getClient()
        .from('recipes')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    }

    throw scoped.error;
  }

  async function uploadPhoto(file) {
    if (!file) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const fileName = `${C.HOUSEHOLD_ID}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
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
      household_id: C.HOUSEHOLD_ID,
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
      .eq('household_id', C.HOUSEHOLD_ID)
      .select();
    if (error) throw error;
    return data[0];
  }

  async function deleteRecipe(id) {
    const scoped = await getClient()
      .from('recipes')
      .delete()
      .eq('id', id)
      .eq('household_id', C.HOUSEHOLD_ID);
    if (!scoped.error) {
      const leftover = await getClient().from('recipes').select('id').eq('id', id).maybeSingle();
      if (leftover.data) {
        const { error } = await getClient().from('recipes').delete().eq('id', id);
        if (error) throw error;
      }
      return true;
    }
    if (isMissingSchema(scoped.error)) {
      const { error } = await getClient().from('recipes').delete().eq('id', id);
      if (error) throw error;
      return true;
    }
    throw scoped.error;
  }

  function emptyPlanRow(weekStart) {
    return {
      household_id: C.HOUSEHOLD_ID,
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
      .eq('household_id', C.HOUSEHOLD_ID)
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
      household_id: C.HOUSEHOLD_ID,
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
      .eq('household_id', C.HOUSEHOLD_ID);
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
    const res = await fetch('/api/import-recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    return res.json();
  }

  global.DB = {
    getClient,
    emptyPlan,
    canPlan,
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
