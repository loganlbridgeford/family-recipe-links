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
    const { data, error } = await getClient()
      .from('recipes')
      .select('*')
      .eq('household_id', C.HOUSEHOLD_ID)
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
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
    const payload = normalizeRecipePayload({ ...input, photo_url, photo_url_back });
    const { data, error } = await getClient().from('recipes').insert([payload]).select();
    if (error) throw error;
    return data[0];
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
    const { error } = await getClient()
      .from('recipes')
      .delete()
      .eq('id', id)
      .eq('household_id', C.HOUSEHOLD_ID);
    if (error) throw error;
    return true;
  }

  async function getPlan(weekStart) {
    const { data, error } = await getClient()
      .from('meal_plans')
      .select('*')
      .eq('household_id', C.HOUSEHOLD_ID)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return {
        household_id: C.HOUSEHOLD_ID,
        week_start: weekStart,
        plan: emptyPlan(),
        grocery_checked: {},
        snack_adds: []
      };
    }
    return {
      ...data,
      plan: data.plan && Object.keys(data.plan).length ? data.plan : emptyPlan(),
      grocery_checked: data.grocery_checked || {},
      snack_adds: data.snack_adds || []
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
    if (error) throw error;
    return data;
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
          if (plan[day] && plan[day][slot] === recipeId) {
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
    uploadPhoto
  };
})(window);
