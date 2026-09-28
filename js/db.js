/* global window, APP_CONFIG */
(function (global) {
  const C = global.APP_CONFIG;
  let client = null;

  const HOUSEHOLD_STORAGE_KEY = 'familyPlanner.household';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function resetClient() {
    client = null;
  }

  function setFamilyAccess(code) {
    C.FAMILY_CODE = String(code || '')
      .trim()
      .toUpperCase();
    resetClient();
  }

  function getClient() {
    if (client) return client;
    if (!global.supabase) {
      throw new Error('Supabase SDK not loaded');
    }
    const headers = {};
    if (C.FAMILY_CODE) headers['x-family-code'] = C.FAMILY_CODE;
    client = global.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      global: { headers }
    });
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

  function newId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const n = (Math.random() * 16) | 0;
      return (ch === 'x' ? n : (n & 0x3) | 0x8).toString(16);
    });
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
    setFamilyAccess(familyCode(row));
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
    setFamilyAccess(code);
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
    setFamilyAccess('');
    return null;
  }

  async function createHousehold(name, displayName) {
    const familyName = String(name || '').trim();
    if (!familyName) throw new Error('Family name required');
    const who = String(displayName || '').trim();
    if (!who) throw new Error('Your name required');
    let lastError = null;
    for (let i = 0; i < 4; i += 1) {
      const code = randomFamilyCode();
      const id = newId();
      const payload = { id, name: familyName, slug: code, invite_code: code };
      let ins = await getClient().from('households').insert([payload]);
      if (ins.error && isMissingSchema(ins.error)) {
        const fallback = { id, name: familyName, slug: code };
        ins = await getClient().from('households').insert([fallback]);
      }
      if (ins.error) {
        lastError = ins.error;
        if (!/duplicate|unique/i.test(String(ins.error.message || ''))) throw ins.error;
        continue;
      }
      setFamilyAccess(code);
      const household = await getHousehold(id);
      if (!household) {
        setFamilyAccess('');
        throw new Error('Could not create family');
      }
      const mem = await getClient().from('household_members').insert([
        {
          household_id: household.id,
          display_name: who,
          role: 'owner',
          sort_order: 1
        }
      ]);
      if (mem.error) {
        await getClient().from('households').delete().eq('id', household.id);
        setFamilyAccess('');
        throw mem.error;
      }
      return household;
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

  function planConflictError() {
    const err = new Error('plan_conflict');
    err.code = 'plan_conflict';
    return err;
  }

  function isPlanConflict(error) {
    return !!(error && (error.code === 'plan_conflict' || error.message === 'plan_conflict'));
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
    if (!error) return data[0];
    if (!isMissingSchema(error)) throw error;
    const legacy = legacyRecipePayload({ ...input, photo_url: patch.photo_url, photo_url_back: patch.photo_url_back });
    const retry = await getClient()
      .from('recipes')
      .update(legacy)
      .eq('id', id)
      .eq('household_id', requireHouseholdId())
      .select();
    if (retry.error) throw retry.error;
    return retry.data[0];
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

  async function savePlan(weekStart, fields, expectedUpdatedAt) {
    const payload = {
      household_id: requireHouseholdId(),
      week_start: weekStart,
      updated_at: new Date().toISOString(),
      ...fields
    };

    async function updateMatching(body) {
      return getClient()
        .from('meal_plans')
        .update(body)
        .eq('household_id', requireHouseholdId())
        .eq('week_start', weekStart)
        .eq('updated_at', expectedUpdatedAt)
        .select()
        .maybeSingle();
    }

    async function upsertBody(body) {
      return getClient()
        .from('meal_plans')
        .upsert(body, { onConflict: 'household_id,week_start' })
        .select()
        .single();
    }

    if (expectedUpdatedAt) {
      let upd = await updateMatching(payload);
      if (upd.error && isMissingSchema(upd.error) && Object.prototype.hasOwnProperty.call(fields, 'manual_items')) {
        const fallback = { ...payload };
        delete fallback.manual_items;
        upd = await updateMatching(fallback);
      }
      if (upd.error) throw upd.error;
      if (!upd.data) throw planConflictError();
      return upd.data;
    }

    let { data, error } = await upsertBody(payload);
    if (!error) return data;
    if (isMissingSchema(error) && Object.prototype.hasOwnProperty.call(fields, 'manual_items')) {
      const fallback = { ...payload };
      delete fallback.manual_items;
      const retry = await upsertBody(fallback);
      if (retry.error) throw retry.error;
      return retry.data;
    }
    throw error;
  }

  function stripRecipeFromSlot(raw, recipeId) {
    const id = String(recipeId);
    if (raw == null || raw === '') return { raw, changed: false };
    if (typeof raw !== 'object') {
      if (String(raw) === id) return { raw: null, changed: true };
      return { raw, changed: false };
    }
    if (raw.type === 'recipe' && raw.id != null && String(raw.id) === id) {
      return { raw: null, changed: true };
    }
    const sides = Array.isArray(raw.sides) ? raw.sides : [];
    const nextSides = sides.filter((side) => {
      if (!side || typeof side !== 'object' || side.type !== 'recipe') return true;
      return side.id == null || String(side.id) !== id;
    });
    if (nextSides.length === sides.length) return { raw, changed: false };
    if (!nextSides.length) {
      if (raw.type === 'recipe' && raw.id != null && String(raw.id) !== '') {
        return { raw: raw.id, changed: true };
      }
      if (raw.type === 'custom') {
        const name = String(raw.name || '').trim();
        return { raw: name ? { type: 'custom', name } : null, changed: true };
      }
      return { raw: null, changed: true };
    }
    if (raw.type === 'recipe' && raw.id != null && String(raw.id) !== '') {
      return { raw: { type: 'recipe', id: raw.id, sides: nextSides }, changed: true };
    }
    if (raw.type === 'custom') {
      const name = String(raw.name || '').trim();
      if (!name) return { raw: null, changed: true };
      return { raw: { type: 'custom', name, sides: nextSides }, changed: true };
    }
    return { raw: Object.assign({}, raw, { sides: nextSides }), changed: true };
  }

  async function removeRecipeFromAllPlans(recipeId) {
    const rid = String(recipeId);
    const { data, error } = await getClient()
      .from('meal_plans')
      .select('*')
      .eq('household_id', requireHouseholdId());
    if (error) throw error;
    const updates = [];
    (data || []).forEach((row) => {
      if (row.week_start === CHORE_WEEK) return;
      let changed = false;
      const plan = row.plan || emptyPlan();
      C.DAYS.forEach((day) => {
        C.MEAL_SLOTS.forEach((slot) => {
          const raw = plan[day] && plan[day][slot];
          const next = stripRecipeFromSlot(raw, recipeId);
          if (next.changed) {
            plan[day][slot] = next.raw;
            changed = true;
          }
        });
      });
      const snack_adds = (row.snack_adds || []).filter((id) => String(id) !== rid);
      if (snack_adds.length !== (row.snack_adds || []).length) changed = true;
      if (changed) {
        updates.push(
          getClient()
            .from('meal_plans')
            .update({ plan, snack_adds, updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .eq('household_id', requireHouseholdId())
        );
      }
    });
    const results = await Promise.all(updates);
    results.forEach((result) => {
      if (result && result.error) throw result.error;
    });
  }

  function importRecipeEndpoint() {
    const configured = String(C.API_BASE || '')
      .trim()
      .replace(/\/$/, '');
    if (configured) return `${configured}/api/import-recipe`;
    const loc = global.location;
    if (!loc || !loc.origin) return '/api/import-recipe';
    if (/^(capacitor|ionic|file):/i.test(loc.protocol)) {
      return configured ? `${configured}/api/import-recipe` : '/api/import-recipe';
    }
    return '/api/import-recipe';
  }

  const CHORE_WEEK = '1970-01-05';

  function emptyChoreBoard() {
    return { kids: [], chores: [], checks: [], rewards: [], redemptions: [], reward: '' };
  }

  async function readChoreBoard() {
    const row = await getPlan(CHORE_WEEK);
    const raw = row.grocery_checked && row.grocery_checked.__chore_board;
    const board = raw && typeof raw === 'object' ? raw : emptyChoreBoard();
    const next = {
      kids: Array.isArray(board.kids) ? board.kids : [],
      chores: (Array.isArray(board.chores) ? board.chores : []).map((chore) => {
        const fromList = Array.isArray(chore.kid_ids) ? chore.kid_ids.filter(Boolean) : [];
        const kid_ids = fromList.length ? fromList : (chore.kid_id ? [chore.kid_id] : []);
        return Object.assign({}, chore, { kid_ids });
      }),
      checks: Array.isArray(board.checks) ? board.checks : [],
      rewards: Array.isArray(board.rewards) ? board.rewards : [],
      redemptions: Array.isArray(board.redemptions) ? board.redemptions : [],
      reward: board.reward || ''
    };
    if (C.HOUSEHOLD) C.HOUSEHOLD.chore_reward = next.reward;
    return next;
  }

  async function writeChoreBoard(board) {
    await savePlan(CHORE_WEEK, {
      plan: emptyPlan(),
      grocery_checked: { __chore_board: board },
      snack_adds: [],
      manual_items: []
    });
    if (C.HOUSEHOLD) C.HOUSEHOLD.chore_reward = board.reward || '';
  }

  async function listKids() {
    const board = await readChoreBoard();
    return board.kids.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  async function addKid(displayName) {
    const name = String(displayName || '').trim();
    if (!name) throw new Error('Name required');
    const board = await readChoreBoard();
    if (board.kids.some((kid) => kid.display_name.toLowerCase() === name.toLowerCase())) {
      const err = new Error('duplicate kid');
      err.code = '23505';
      throw err;
    }
    const kid = {
      id: newId(),
      display_name: name,
      points_reset_at: null,
      created_at: new Date().toISOString()
    };
    board.kids.push(kid);
    await writeChoreBoard(board);
    return kid;
  }

  async function removeKid(id) {
    const board = await readChoreBoard();
    board.kids = board.kids.filter((kid) => kid.id !== id);
    board.chores = board.chores
      .map((chore) => Object.assign({}, chore, {
        kid_ids: (chore.kid_ids || []).filter((kidId) => kidId !== id)
      }))
      .filter((chore) => chore.kid_ids.length);
    board.checks = board.checks.filter((check) => check.kid_id !== id);
    await writeChoreBoard(board);
  }

  async function listChores() {
    const board = await readChoreBoard();
    return board.chores.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  async function addChore(input) {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('Chore required');
    const points = Math.min(5, Math.max(1, Number(input.points) || 1));
    const cadence = ['daily', 'weekdays', 'weekends', 'once'].includes(input.cadence)
      ? input.cadence
      : 'daily';
    const kidIds = (Array.isArray(input.kidIds) ? input.kidIds : [input.kidId])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (!kidIds.length) throw new Error('Pick at least one kid');
    const board = await readChoreBoard();
    const chore = {
      id: newId(),
      kid_ids: [...new Set(kidIds)],
      title,
      points,
      cadence,
      created_at: new Date().toISOString()
    };
    board.chores.push(chore);
    await writeChoreBoard(board);
    return chore;
  }

  async function removeChore(id) {
    const board = await readChoreBoard();
    board.chores = board.chores.filter((chore) => chore.id !== id);
    board.checks = board.checks.filter((check) => check.chore_id !== id);
    await writeChoreBoard(board);
  }

  async function dropKidFromChore(choreId, kidId) {
    const board = await readChoreBoard();
    board.chores = board.chores
      .map((chore) => {
        if (chore.id !== choreId) return chore;
        return Object.assign({}, chore, {
          kid_ids: (chore.kid_ids || []).filter((id) => id !== kidId)
        });
      })
      .filter((chore) => (chore.kid_ids || []).length);
    board.checks = board.checks.filter((check) => !(check.chore_id === choreId && check.kid_id === kidId));
    await writeChoreBoard(board);
  }

  async function listChoreChecksForDate(onDate) {
    const board = await readChoreBoard();
    return board.checks.filter((check) => check.on_date === onDate);
  }

  async function listPendingChoreChecks() {
    const board = await readChoreBoard();
    return board.checks.filter((check) => check.status === 'pending');
  }

  async function listApprovedChoreChecks() {
    const board = await readChoreBoard();
    return board.checks.filter((check) => check.status === 'approved');
  }

  async function markChoreDone(choreId, kidId, onDate) {
    const board = await readChoreBoard();
    const now = new Date().toISOString();
    let check = board.checks.find((row) => row.chore_id === choreId && row.kid_id === kidId && row.on_date === onDate);
    if (!check) {
      check = {
        id: newId(),
        chore_id: choreId,
        kid_id: kidId,
        on_date: onDate,
        status: 'pending',
        completed_at: now,
        approved_at: null
      };
      board.checks.push(check);
    } else {
      check.status = 'pending';
      check.completed_at = now;
      check.approved_at = null;
    }
    await writeChoreBoard(board);
    return check;
  }

  async function approveChoreCheck(id) {
    const board = await readChoreBoard();
    const check = board.checks.find((row) => row.id === id);
    if (!check) throw new Error('Check not found');
    check.status = 'approved';
    check.approved_at = new Date().toISOString();
    await writeChoreBoard(board);
    return check;
  }

  async function clearChoreCheck(id) {
    const board = await readChoreBoard();
    board.checks = board.checks.filter((row) => row.id !== id);
    await writeChoreBoard(board);
  }

  async function resetKidPoints(id) {
    const board = await readChoreBoard();
    const kid = board.kids.find((row) => row.id === id);
    if (!kid) throw new Error('Kid not found');
    kid.points_reset_at = new Date().toISOString();
    await writeChoreBoard(board);
  }

  function kidEarned(board, kid) {
    const reset = kid.points_reset_at ? new Date(kid.points_reset_at).getTime() : 0;
    return board.checks.reduce((sum, check) => {
      if (check.kid_id !== kid.id || check.status !== 'approved') return sum;
      const when = new Date(check.approved_at || check.completed_at || 0).getTime();
      if (when <= reset) return sum;
      const chore = board.chores.find((row) => row.id === check.chore_id);
      return sum + (chore ? Number(chore.points) || 1 : 1);
    }, 0);
  }

  function kidSpent(board, kid) {
    const reset = kid.points_reset_at ? new Date(kid.points_reset_at).getTime() : 0;
    return (board.redemptions || []).reduce((sum, redemption) => {
      const when = new Date(redemption.at || 0).getTime();
      if (when <= reset) return sum;
      const amounts = redemption.amounts || {};
      return sum + (Number(amounts[kid.id]) || 0);
    }, 0);
  }

  function splitPointCost(cost, kids) {
    const total = kids.reduce((sum, kid) => sum + kid.balance, 0);
    if (!kids.length || total < cost) return null;
    const amounts = {};
    let left = cost;
    kids.forEach((kid) => {
      const share = Math.floor((cost * kid.balance) / total);
      amounts[kid.id] = share;
      left -= share;
    });
    const roomiest = kids.slice().sort((a, b) => b.balance - a.balance);
    roomiest.forEach((kid) => {
      if (left <= 0) return;
      const room = kid.balance - amounts[kid.id];
      const take = Math.min(room, left);
      amounts[kid.id] += take;
      left -= take;
    });
    if (left > 0) return null;
    return amounts;
  }

  async function listRewards() {
    const board = await readChoreBoard();
    return board.rewards.slice();
  }

  async function listRedemptions() {
    const board = await readChoreBoard();
    return board.redemptions.slice();
  }

  async function addReward(title, cost) {
    const name = String(title || '').trim();
    if (!name) throw new Error('Reward required');
    const points = Math.min(200, Math.max(5, Math.round(Number(cost) / 5) * 5 || 5));
    const board = await readChoreBoard();
    const reward = {
      id: newId(),
      title: name,
      cost: points,
      created_at: new Date().toISOString()
    };
    board.rewards.push(reward);
    await writeChoreBoard(board);
    return reward;
  }

  async function removeReward(id) {
    const board = await readChoreBoard();
    board.rewards = board.rewards.filter((reward) => reward.id !== id);
    await writeChoreBoard(board);
  }

  async function redeemReward(rewardId, kidIds) {
    const ids = [...new Set((kidIds || []).filter(Boolean))];
    if (!ids.length) throw new Error('Pick a kid');
    const board = await readChoreBoard();
    const reward = board.rewards.find((row) => row.id === rewardId);
    if (!reward) throw new Error('Reward not found');
    const payers = ids.map((id) => {
      const kid = board.kids.find((row) => row.id === id);
      if (!kid) return null;
      return { id, balance: Math.max(0, kidEarned(board, kid) - kidSpent(board, kid)) };
    }).filter(Boolean);
    const amounts = splitPointCost(Number(reward.cost) || 0, payers);
    if (!amounts) {
      const err = new Error('not enough points');
      err.code = 'not_enough';
      throw err;
    }
    board.redemptions.push({
      id: newId(),
      reward_id: reward.id,
      title: reward.title,
      cost: reward.cost,
      amounts,
      at: new Date().toISOString()
    });
    await writeChoreBoard(board);
    return amounts;
  }

  async function saveChoreReward(text) {
    const board = await readChoreBoard();
    board.reward = String(text || '').trim();
    await writeChoreBoard(board);
  }

  async function importRecipeFromUrl(url) {
    try {
      const res = await fetch(importRecipeEndpoint(), {
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
    setFamilyAccess,
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
    isPlanConflict,
    removeRecipeFromAllPlans,
    uploadPhoto,
    importRecipeFromUrl,
    isMissingSchema,
    listKids,
    addKid,
    removeKid,
    listChores,
    addChore,
    removeChore,
    dropKidFromChore,
    listChoreChecksForDate,
    listPendingChoreChecks,
    listApprovedChoreChecks,
    markChoreDone,
    approveChoreCheck,
    clearChoreCheck,
    resetKidPoints,
    saveChoreReward,
    listRewards,
    listRedemptions,
    addReward,
    removeReward,
    redeemReward
  };
})(window);
