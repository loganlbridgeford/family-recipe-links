/* global APP_CONFIG, DB */
const C = APP_CONFIG;

const state = {
  recipes: [],
  members: [],
  weekStart: getMondayISO(new Date()),
  plan: DB.emptyPlan(),
  groceryChecked: {},
  snackAdds: [],
  categoryFilter: 'All',
  search: '',
  pickerFilters: new Set(),
  generateFilters: new Set(),
  pickerContext: null,
  pendingAssignId: null,
  saveTimer: null
};

function getMondayISO(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatWeekLabel(iso) {
  const start = parseDate(iso);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

function getDayDate(iso, index) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + index);
  return d;
}

function escapeHtml(str) {
  const el = document.createElement('div');
  el.textContent = str == null ? '' : String(str);
  return el.innerHTML;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function getRecipe(id) {
  return state.recipes.find((r) => String(r.id) === String(id)) || null;
}

function recipeSearchText(r) {
  const ings = (r.ingredients || []).map((i) => i.item).join(' ');
  const instr = r.instructions || {};
  return [
    r.name,
    r.notes,
    r.url,
    r.added_by,
    r.category,
    ings,
    ...(instr.prep || []),
    ...(instr.steps || []),
    instr.tips || ''
  ]
    .join(' ')
    .toLowerCase();
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(persistPlan, 500);
}

async function persistPlan() {
  try {
    await DB.savePlan(state.weekStart, {
      plan: state.plan,
      grocery_checked: state.groceryChecked,
      snack_adds: state.snackAdds
    });
  } catch (err) {
    console.error(err);
    showToast('Could not save plan.');
  }
}

async function loadWeek() {
  const row = await DB.getPlan(state.weekStart);
  state.plan = row.plan || DB.emptyPlan();
  C.DAYS.forEach((d) => {
    if (!state.plan[d]) state.plan[d] = { breakfast: null, lunch: null, dinner: null };
  });
  state.groceryChecked = row.grocery_checked || {};
  state.snackAdds = row.snack_adds || [];
  renderWeekLabel();
  renderCalendar();
  renderGrocery();
}

function renderWeekLabel() {
  document.getElementById('weekLabel').textContent = formatWeekLabel(state.weekStart);
}

function setTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    const on = panel.id === `panel-${name}`;
    panel.hidden = !on;
    panel.classList.toggle('active', on);
  });
}

/* ---------- Calendar ---------- */

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  grid.appendChild(document.createElement('div'));

  C.DAYS.forEach((day, i) => {
    const header = document.createElement('div');
    header.className = 'cal-day-header';
    const date = getDayDate(state.weekStart, i);
    header.innerHTML = `${C.DAY_LABELS[i]}<span class="date-num">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`;
    grid.appendChild(header);
  });

  C.MEAL_SLOTS.forEach((slot) => {
    const label = document.createElement('div');
    label.className = 'cal-row-label';
    label.textContent = C.SLOT_LABELS[slot];
    grid.appendChild(label);

    C.DAYS.forEach((day) => {
      const mealId = state.plan[day][slot];
      const meal = mealId ? getRecipe(mealId) : null;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'meal-cell' + (meal ? ' filled' : '');
      if (meal) {
        const batch = (meal.tags || []).includes('batch-cook');
        cell.innerHTML = `
          <span class="meal-cell-name">${escapeHtml(meal.name)}</span>
          <span class="meal-cell-meta">
            ${meal.prep_minutes ? `<span class="badge badge-time">${meal.prep_minutes} min</span>` : ''}
            ${batch ? '<span class="badge badge-batch">Batch</span>' : ''}
          </span>`;
      } else {
        cell.innerHTML = '<span class="meal-cell-placeholder">Tap to add</span>';
      }
      cell.addEventListener('click', () => {
        if (meal) openRecipeCard(meal.id, { fromCalendar: true, day, slot });
        else openPicker(day, slot);
      });
      grid.appendChild(cell);
    });
  });
}

function openPicker(day, slot) {
  state.pickerContext = { day, slot };
  state.pickerFilters = new Set();
  document.getElementById('pickerTitle').textContent = `Choose ${C.SLOT_LABELS[slot]} — ${C.DAY_LABELS[C.DAYS.indexOf(day)]}`;
  document.getElementById('pickerSearch').value = '';
  renderFilterChips('pickerFilters', state.pickerFilters, renderPickerList);
  renderPickerList();
  document.getElementById('pickerModal').showModal();
}

function renderFilterChips(containerId, filterSet, onChange) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  Object.entries(C.TAG_LABELS).forEach(([tag, label]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (filterSet.has(tag) ? ' active' : '');
    chip.textContent = label;
    chip.addEventListener('click', () => {
      if (filterSet.has(tag)) filterSet.delete(tag);
      else filterSet.add(tag);
      renderFilterChips(containerId, filterSet, onChange);
      onChange();
    });
    container.appendChild(chip);
  });
}

function renderPickerList() {
  const q = document.getElementById('pickerSearch').value.trim().toLowerCase();
  const slot = state.pickerContext?.slot;
  const list = document.getElementById('pickerMealList');
  list.innerHTML = '';

  const meals = state.recipes.filter((r) => {
    if (!DB.canPlan(r)) return false;
    if (slot && !(r.meal_types || []).includes(slot)) return false;
    if (q && !recipeSearchText(r).includes(q)) return false;
    if (state.pickerFilters.size) {
      for (const tag of state.pickerFilters) {
        if (!(r.tags || []).includes(tag)) return false;
      }
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  if (!meals.length) {
    list.innerHTML = '<li class="meal-list-item"><p>No plan-ready recipes match. Add ingredients on the Recipes tab.</p></li>';
    return;
  }

  meals.forEach((meal) => {
    const li = document.createElement('li');
    li.className = 'meal-list-item';
    li.innerHTML = `
      <h4>${escapeHtml(meal.name)}</h4>
      <div class="meta">${meal.prep_minutes || '—'} min · ${(meal.tags || []).slice(0, 3).map((t) => C.TAG_LABELS[t] || t).join(' · ')}</div>
      <div class="actions">
        <button type="button" class="btn btn-secondary btn-sm view-recipe">View</button>
        <button type="button" class="btn btn-primary btn-sm assign-meal">Add to calendar</button>
      </div>`;
    li.querySelector('.view-recipe').addEventListener('click', () => openRecipeCard(meal.id, { fromPicker: true }));
    li.querySelector('.assign-meal').addEventListener('click', () => selectMeal(meal.id));
    list.appendChild(li);
  });
}

function selectMeal(mealId) {
  if (!state.pickerContext) return;
  const { day, slot } = state.pickerContext;
  state.plan[day][slot] = mealId;
  document.getElementById('pickerModal').close();
  renderCalendar();
  renderGrocery();
  scheduleSave();
  showToast('Meal added to the week.');
}

function clearSlot() {
  if (!state.pickerContext) return;
  const { day, slot } = state.pickerContext;
  state.plan[day][slot] = null;
  document.getElementById('pickerModal').close();
  renderCalendar();
  renderGrocery();
  scheduleSave();
}

/* ---------- Generate ---------- */

function getUsedMealIds() {
  const used = new Set();
  C.DAYS.forEach((d) => {
    C.MEAL_SLOTS.forEach((s) => {
      if (state.plan[d][s]) used.add(String(state.plan[d][s]));
    });
  });
  return used;
}

function scoreMealForSlot(meal, day, slot) {
  let score = Math.random() * 10;
  const dayIndex = C.DAYS.indexOf(day);
  const tags = meal.tags || [];
  if (slot === 'dinner') {
    if (dayIndex >= 5 && tags.includes('batch-cook')) score += 50;
    if (dayIndex <= 2 && tags.includes('batch-cook')) score += 20;
    if (dayIndex <= 2 && (meal.prep_minutes || 99) <= 30) score += 15;
  }
  if (slot === 'lunch' && tags.includes('packable') && dayIndex <= 4) score += 10;
  if (slot === 'breakfast' && dayIndex <= 4 && tags.includes('quick')) score += 10;
  if (slot === 'breakfast' && dayIndex >= 5 && tags.includes('batch-cook')) score += 15;
  return score;
}

function getCandidates(slot, filters, used) {
  let pool = state.recipes.filter((m) => DB.canPlan(m) && (m.meal_types || []).includes(slot));
  if (filters.size) {
    pool = pool.filter((m) => {
      for (const tag of filters) {
        if (!(m.tags || []).includes(tag)) return false;
      }
      return true;
    });
  }
  const unused = pool.filter((m) => !used.has(String(m.id)));
  return unused.length ? unused : pool;
}

async function fillSlots(target) {
  const used = getUsedMealIds();
  const slots = [];
  C.DAYS.forEach((day) => {
    C.MEAL_SLOTS.forEach((slot) => {
      if (target !== 'all' && target !== slot) return;
      if (!state.plan[day][slot]) slots.push({ day, slot });
    });
  });
  if (!slots.length) {
    showToast('No empty slots to fill.');
    return;
  }
  let filled = 0;
  slots.forEach(({ day, slot }) => {
    const candidates = getCandidates(slot, state.generateFilters, used);
    if (!candidates.length) return;
    candidates.sort((a, b) => scoreMealForSlot(b, day, slot) - scoreMealForSlot(a, day, slot));
    const pick = candidates[0];
    state.plan[day][slot] = pick.id;
    used.add(String(pick.id));
    filled += 1;
  });
  document.getElementById('generateModal').close();
  renderCalendar();
  renderGrocery();
  scheduleSave();
  showToast(filled ? `Filled ${filled} slot${filled === 1 ? '' : 's'}.` : 'No plan-ready recipes for those slots.');
}

function previewSuggestions() {
  const used = getUsedMealIds();
  const target = document.getElementById('generateTarget').value;
  const seen = new Set();
  const suggestions = [];
  C.DAYS.forEach((day) => {
    C.MEAL_SLOTS.forEach((slot) => {
      if (target !== 'all' && target !== slot) return;
      if (state.plan[day][slot]) return;
      const candidates = getCandidates(slot, state.generateFilters, used);
      candidates.sort((a, b) => scoreMealForSlot(b, day, slot) - scoreMealForSlot(a, day, slot));
      const pick = candidates.find((m) => !seen.has(String(m.id))) || candidates[0];
      if (pick) {
        seen.add(String(pick.id));
        suggestions.push({ meal: pick, day, slot });
      }
    });
  });
  const list = document.getElementById('previewList');
  list.innerHTML = '';
  if (!suggestions.length) {
    list.innerHTML = '<li class="meal-list-item">No suggestions. Add ingredients to recipes first.</li>';
    return;
  }
  suggestions.slice(0, 14).forEach(({ meal, day, slot }) => {
    const li = document.createElement('li');
    li.className = 'meal-list-item';
    li.innerHTML = `<h4>${escapeHtml(meal.name)}</h4><div class="meta">${C.DAY_LABELS[C.DAYS.indexOf(day)]} ${C.SLOT_LABELS[slot]} · ${meal.prep_minutes || '—'} min</div>`;
    list.appendChild(li);
  });
}

/* ---------- Recipe detail / assign ---------- */

function openRecipeCard(mealId, context = {}) {
  const meal = getRecipe(mealId);
  if (!meal) return;
  document.getElementById('recipeTitle').textContent = meal.name;
  const tags = (meal.tags || []).slice(0, 4).map((t) => C.TAG_LABELS[t] || t).join(' · ');
  document.getElementById('recipeMeta').innerHTML = `
    ${meal.prep_minutes ? `<span>${meal.prep_minutes} min</span>` : ''}
    ${meal.servings ? `<span>Serves ${meal.servings}</span>` : ''}
    ${meal.added_by ? `<span>Added by ${escapeHtml(meal.added_by)}</span>` : ''}
    ${tags ? `<span>${escapeHtml(tags)}</span>` : ''}
    ${meal.url ? `<span><a href="${escapeHtml(meal.url)}" target="_blank" rel="noopener">Open link</a></span>` : ''}
  `;

  const photos = document.getElementById('recipePhotos');
  photos.innerHTML = '';
  if (meal.photo_url || meal.photo_url_back) {
    photos.className = 'thumb-row';
    photos.innerHTML = `
      ${meal.photo_url ? `<a href="${escapeHtml(meal.photo_url)}" target="_blank"><img src="${escapeHtml(meal.photo_url)}" alt="Front"></a>` : ''}
      ${meal.photo_url_back ? `<a href="${escapeHtml(meal.photo_url_back)}" target="_blank"><img src="${escapeHtml(meal.photo_url_back)}" alt="Back"></a>` : ''}`;
  }

  const ings = meal.ingredients || [];
  document.getElementById('recipeIngredients').innerHTML = ings.length
    ? ings.map((i) => `<li>${escapeHtml(i.item)}${i.qty ? ' — ' + escapeHtml(i.qty) : ''}</li>`).join('')
    : '<li>No ingredients yet. Edit this recipe to use it on the calendar.</li>';

  const instr = meal.instructions || {};
  const prepSection = document.getElementById('recipePrepSection');
  if (instr.prep && instr.prep.length) {
    prepSection.style.display = '';
    document.getElementById('recipePrepItems').innerHTML = instr.prep.map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  } else {
    prepSection.style.display = 'none';
  }
  document.getElementById('recipeSteps').innerHTML =
    instr.steps && instr.steps.length
      ? instr.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')
      : '<li>No cooking steps yet.</li>';
  document.getElementById('recipeTip').innerHTML = instr.tips ? `<strong>Tip:</strong> ${escapeHtml(instr.tips)}` : '';

  const actions = document.getElementById('recipeActions');
  actions.innerHTML = '';
  if (context.fromPicker && state.pickerContext) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Add to calendar';
    btn.addEventListener('click', () => {
      selectMeal(meal.id);
      document.getElementById('recipeModal').close();
    });
    actions.appendChild(btn);
  }
  if (context.fromCalendar) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Change meal';
    btn.addEventListener('click', () => {
      document.getElementById('recipeModal').close();
      openPicker(context.day, context.slot);
    });
    actions.appendChild(btn);
  }
  if (context.fromLibrary && DB.canPlan(meal)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Assign to calendar';
    btn.addEventListener('click', () => openAssignModal(meal.id));
    actions.appendChild(btn);
  }
  document.getElementById('recipeModal').showModal();
}

function openAssignModal(mealId) {
  state.pendingAssignId = mealId;
  const select = document.getElementById('assignDay');
  select.innerHTML = '';
  C.DAYS.forEach((day, i) => {
    const date = getDayDate(state.weekStart, i);
    const opt = document.createElement('option');
    opt.value = day;
    opt.textContent = `${C.DAY_LABELS[i]} (${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
    select.appendChild(opt);
  });
  const meal = getRecipe(mealId);
  if (meal && (meal.meal_types || []).length === 1 && C.MEAL_SLOTS.includes(meal.meal_types[0])) {
    document.getElementById('assignSlot').value = meal.meal_types[0];
  }
  document.getElementById('assignModal').showModal();
}

function confirmAssign() {
  if (!state.pendingAssignId) return;
  const day = document.getElementById('assignDay').value;
  const slot = document.getElementById('assignSlot').value;
  state.plan[day][slot] = state.pendingAssignId;
  state.pendingAssignId = null;
  document.getElementById('assignModal').close();
  document.getElementById('recipeModal').close();
  renderCalendar();
  renderGrocery();
  scheduleSave();
  showToast(`Assigned to ${C.DAY_LABELS[C.DAYS.indexOf(day)]} ${C.SLOT_LABELS[slot]}.`);
}

/* ---------- Recipes tab ---------- */

function populateMemberSelect(selected) {
  const sel = document.getElementById('addedBy');
  const current = selected || sel.value;
  sel.innerHTML = '<option value="">Select who</option>';
  state.members.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.display_name;
    opt.textContent = m.display_name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function renderCategoryChips() {
  const cats = ['All', 'Breakfast', 'Lunch', 'Dinner', 'Appetizer', 'Dessert', 'Snack', 'Other'];
  const wrap = document.getElementById('filterChips');
  wrap.innerHTML = '';
  cats.forEach((cat) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.categoryFilter === cat ? ' active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      state.categoryFilter = cat;
      renderCategoryChips();
      renderRecipeList();
    });
    wrap.appendChild(chip);
  });
}

function renderTypeChips(selected) {
  const container = document.getElementById('recipeTypeChips');
  const sel = new Set(selected || []);
  container.innerHTML = '';
  C.MEAL_TYPES.forEach((type) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (sel.has(type) ? ' active' : '');
    chip.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    chip.dataset.type = type;
    chip.addEventListener('click', () => {
      if (sel.has(type)) sel.delete(type);
      else sel.add(type);
      renderTypeChips([...sel]);
    });
    container.appendChild(chip);
  });
  container._selected = () => [...container.querySelectorAll('.chip.active')].map((c) => c.dataset.type);
}

function renderTagChips(selected) {
  const container = document.getElementById('recipeTagChips');
  const sel = new Set(selected || []);
  container.innerHTML = '';
  Object.entries(C.TAG_LABELS).forEach(([tag, label]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (sel.has(tag) ? ' active' : '');
    chip.textContent = label;
    chip.dataset.tag = tag;
    chip.addEventListener('click', () => {
      if (sel.has(tag)) sel.delete(tag);
      else sel.add(tag);
      renderTagChips([...sel]);
    });
    container.appendChild(chip);
  });
  container._selected = () => [...container.querySelectorAll('.chip.active')].map((c) => c.dataset.tag);
}

function addIngredientRow(ing = { item: '', qty: '', section: 'pantry' }) {
  const container = document.getElementById('ingredientRows');
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  const opts = C.MEAL_SECTIONS.map(
    (s) => `<option value="${s}" ${ing.section === s ? 'selected' : ''}>${C.SECTION_LABELS[s]}</option>`
  ).join('');
  row.innerHTML = `
    <input type="text" class="ing-item" placeholder="Item" value="${escapeHtml(ing.item || '')}">
    <input type="text" class="ing-qty" placeholder="Qty" value="${escapeHtml(ing.qty || '')}">
    <select class="ing-section">${opts}</select>
    <button type="button" class="btn btn-icon remove-ing" aria-label="Remove">✕</button>`;
  row.querySelector('.remove-ing').addEventListener('click', () => {
    if (container.children.length > 1) row.remove();
  });
  container.appendChild(row);
}

function resetRecipeForm() {
  document.getElementById('recipeForm').reset();
  document.getElementById('recipeEditId').value = '';
  document.getElementById('recipeFormTitle').textContent = 'Add a Recipe';
  document.getElementById('saveRecipeBtn').textContent = 'Add Recipe';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  document.getElementById('ingredientRows').innerHTML = '';
  addIngredientRow();
  renderTypeChips([]);
  renderTagChips([]);
  document.getElementById('cookDetails').open = false;
}

function openEditForm(meal) {
  setTab('recipes');
  document.getElementById('recipeEditId').value = meal.id;
  document.getElementById('recipeFormTitle').textContent = 'Edit Recipe';
  document.getElementById('saveRecipeBtn').textContent = 'Save changes';
  document.getElementById('cancelEditBtn').classList.remove('hidden');
  document.getElementById('recipeName').value = meal.name || '';
  document.getElementById('recipeUrl').value = meal.url || '';
  document.getElementById('category').value = meal.category || 'Other';
  populateMemberSelect(meal.added_by);
  document.getElementById('notes').value = meal.notes || '';
  document.getElementById('recipePrep').value = meal.prep_minutes || 30;
  document.getElementById('recipeServings').value = meal.servings || 6;
  const instr = meal.instructions || {};
  document.getElementById('recipePrepList').value = (instr.prep || []).join('\n');
  document.getElementById('recipeStepsList').value = (instr.steps || []).join('\n');
  document.getElementById('recipeTips').value = instr.tips || '';
  renderTypeChips(meal.meal_types || []);
  renderTagChips(meal.tags || []);
  document.getElementById('ingredientRows').innerHTML = '';
  const ings = meal.ingredients && meal.ingredients.length ? meal.ingredients : [{ item: '', qty: '', section: 'pantry' }];
  ings.forEach(addIngredientRow);
  document.getElementById('cookDetails').open = true;
  document.getElementById('recipeForm').scrollIntoView({ behavior: 'smooth' });
}

function collectFormRecipe() {
  const ingredients = [...document.querySelectorAll('.ingredient-row')]
    .map((row) => ({
      item: row.querySelector('.ing-item').value.trim(),
      qty: row.querySelector('.ing-qty').value.trim(),
      section: row.querySelector('.ing-section').value
    }))
    .filter((i) => i.item);
  const prep = document.getElementById('recipePrepList').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const steps = document.getElementById('recipeStepsList').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const tips = document.getElementById('recipeTips').value.trim();
  return {
    name: document.getElementById('recipeName').value.trim(),
    url: document.getElementById('recipeUrl').value.trim(),
    category: document.getElementById('category').value,
    added_by: document.getElementById('addedBy').value,
    notes: document.getElementById('notes').value.trim(),
    meal_types: document.getElementById('recipeTypeChips')._selected(),
    tags: document.getElementById('recipeTagChips')._selected(),
    prep_minutes: document.getElementById('recipePrep').value,
    servings: document.getElementById('recipeServings').value,
    ingredients,
    instructions: { prep, steps, tips }
  };
}

async function handleSaveRecipe(e) {
  e.preventDefault();
  const payload = collectFormRecipe();
  if (!payload.name || !payload.category || !payload.added_by) {
    showToast('Name, category, and added by are required.');
    return;
  }
  const editId = document.getElementById('recipeEditId').value;
  const front = document.getElementById('photo').files[0];
  const back = document.getElementById('photoBack').files[0];
  const btn = document.getElementById('saveRecipeBtn');
  btn.disabled = true;
  btn.textContent = editId ? 'Saving…' : 'Adding…';
  try {
    if (editId) {
      const existing = getRecipe(editId);
      payload.photo_url = existing?.photo_url || null;
      payload.photo_url_back = existing?.photo_url_back || null;
      const updated = await DB.updateRecipe(editId, payload, front, back);
      const idx = state.recipes.findIndex((r) => String(r.id) === String(editId));
      if (idx >= 0) state.recipes[idx] = updated;
    } else {
      const created = await DB.addRecipe(payload, front, back);
      state.recipes.push(created);
      state.recipes.sort((a, b) => a.name.localeCompare(b.name));
    }
    resetRecipeForm();
    populateMemberSelect();
    renderRecipeList();
    renderCalendar();
    renderGrocery();
    showToast(editId ? 'Recipe updated.' : 'Recipe added.');
  } catch (err) {
    console.error(err);
    showToast('Could not save recipe.');
  } finally {
    btn.disabled = false;
    if (!document.getElementById('recipeEditId').value) {
      document.getElementById('saveRecipeBtn').textContent = 'Add Recipe';
    }
  }
}

async function handleDeleteRecipe(id) {
  if (!confirm('Delete this recipe? It will also leave any planned slots empty.')) return;
  try {
    await DB.deleteRecipe(id);
    await DB.removeRecipeFromAllPlans(id);
    state.recipes = state.recipes.filter((r) => String(r.id) !== String(id));
    C.DAYS.forEach((d) => {
      C.MEAL_SLOTS.forEach((s) => {
        if (String(state.plan[d][s]) === String(id)) state.plan[d][s] = null;
      });
    });
    state.snackAdds = state.snackAdds.filter((sid) => String(sid) !== String(id));
    renderRecipeList();
    renderCalendar();
    renderGrocery();
    scheduleSave();
    showToast('Recipe deleted.');
  } catch (err) {
    console.error(err);
    showToast('Could not delete recipe.');
  }
}

function renderRecipeList() {
  const container = document.getElementById('recipesContainer');
  let list = [...state.recipes];
  if (state.categoryFilter !== 'All') {
    list = list.filter((r) => (r.category || 'Other') === state.categoryFilter);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((r) => recipeSearchText(r).includes(q));
  }
  document.getElementById('recipeCount').textContent = list.length ? `(${list.length})` : '';
  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><p>No recipes found.</p></div>';
    return;
  }
  container.innerHTML = '';
  list.forEach((recipe) => {
    const ready = DB.canPlan(recipe);
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.innerHTML = `
      <button class="delete-btn" title="Delete">×</button>
      <div class="recipe-category">${escapeHtml(recipe.category || 'Other')}</div>
      <h3>${
        recipe.url
          ? `<a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener">${escapeHtml(recipe.name)}</a>`
          : escapeHtml(recipe.name)
      }</h3>
      <div class="recipe-meta">
        Added by <strong>${escapeHtml(recipe.added_by || '')}</strong>
        ${recipe.prep_minutes ? ` · ${recipe.prep_minutes} min` : ''}
      </div>
      <div>${ready
        ? '<span class="badge badge-ready">Ready to plan</span>'
        : '<span class="badge badge-needs">Add ingredients to use on calendar</span>'}</div>
      ${recipe.notes ? `<div class="recipe-notes">${escapeHtml(recipe.notes)}</div>` : ''}
      ${
        recipe.photo_url || recipe.photo_url_back
          ? `<div class="thumb-row">
              ${recipe.photo_url ? `<img src="${escapeHtml(recipe.photo_url)}" alt="Front">` : ''}
              ${recipe.photo_url_back ? `<img src="${escapeHtml(recipe.photo_url_back)}" alt="Back">` : ''}
            </div>`
          : ''
      }
      <div class="recipe-card-actions">
        <button type="button" class="btn btn-secondary btn-sm view-btn">View</button>
        <button type="button" class="btn btn-ghost btn-sm edit-btn">Edit</button>
        ${ready ? '<button type="button" class="btn btn-primary btn-sm assign-btn">Assign</button>' : ''}
      </div>`;
    card.querySelector('.delete-btn').addEventListener('click', () => handleDeleteRecipe(recipe.id));
    card.querySelector('.view-btn').addEventListener('click', () => openRecipeCard(recipe.id, { fromLibrary: true }));
    card.querySelector('.edit-btn').addEventListener('click', () => openEditForm(recipe));
    const assignBtn = card.querySelector('.assign-btn');
    if (assignBtn) assignBtn.addEventListener('click', () => openAssignModal(recipe.id));
    container.appendChild(card);
  });
}

/* ---------- Grocery ---------- */

function addGroceryItem(items, ing) {
  const key = (ing.item || '').toLowerCase().trim();
  if (!key) return;
  if (!items[key]) items[key] = { item: ing.item, qtys: [ing.qty], section: ing.section || 'other' };
  else if (ing.qty && !items[key].qtys.includes(ing.qty)) items[key].qtys.push(ing.qty);
}

function getGroceryItems() {
  const items = {};
  C.DAYS.forEach((day) => {
    C.MEAL_SLOTS.forEach((slot) => {
      const meal = getRecipe(state.plan[day][slot]);
      if (!meal) return;
      (meal.ingredients || []).forEach((ing) => addGroceryItem(items, ing));
    });
  });
  state.snackAdds.forEach((id) => {
    const meal = getRecipe(id);
    if (meal) (meal.ingredients || []).forEach((ing) => addGroceryItem(items, ing));
  });
  return items;
}

function renderGrocery() {
  const container = document.getElementById('groceryList');
  const items = getGroceryItems();
  const keys = Object.keys(items);
  if (!keys.length) {
    container.innerHTML = '<div class="empty-state"><p>Add plan-ready meals to this week to build a grocery list.</p></div>';
    return;
  }
  const grouped = {};
  C.MEAL_SECTIONS.forEach((s) => {
    grouped[s] = [];
  });
  keys.forEach((key) => {
    const item = items[key];
    const section = grouped[item.section] ? item.section : 'other';
    grouped[section].push({ key, ...item });
  });
  container.innerHTML = '';
  C.MEAL_SECTIONS.forEach((section) => {
    const sectionItems = grouped[section];
    if (!sectionItems.length) return;
    sectionItems.sort((a, b) => a.item.localeCompare(b.item));
    const group = document.createElement('div');
    group.className = 'grocery-section-group';
    const title = document.createElement('div');
    title.className = 'grocery-section-title';
    title.innerHTML = `<span>${C.SECTION_LABELS[section]}</span><span class="count">${sectionItems.length}</span>`;
    const itemList = document.createElement('div');
    itemList.className = 'grocery-items';
    title.addEventListener('click', () => itemList.classList.toggle('collapsed'));
    sectionItems.forEach(({ key, item, qtys }) => {
      const row = document.createElement('div');
      const checked = !!state.groceryChecked[key];
      row.className = 'grocery-item' + (checked ? ' checked' : '');
      const id = 'g-' + key.replace(/\W/g, '-');
      row.innerHTML = `
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
        <label for="${id}">${escapeHtml(item)}${qtys.filter(Boolean).length ? ' — ' + escapeHtml(qtys.filter(Boolean).join(' + ')) : ''}</label>`;
      row.querySelector('input').addEventListener('change', (e) => {
        state.groceryChecked[key] = e.target.checked;
        row.classList.toggle('checked', e.target.checked);
        scheduleSave();
      });
      itemList.appendChild(row);
    });
    group.appendChild(title);
    group.appendChild(itemList);
    container.appendChild(group);
  });
}

function copyGroceryList() {
  const items = getGroceryItems();
  const keys = Object.keys(items);
  if (!keys.length) {
    showToast('Nothing to copy yet.');
    return;
  }
  const grouped = {};
  keys.forEach((key) => {
    const item = items[key];
    const section = C.SECTION_LABELS[item.section] || 'Other';
    if (!grouped[section]) grouped[section] = [];
    const qty = item.qtys.filter(Boolean).join(' + ');
    grouped[section].push(qty ? `${item.item} — ${qty}` : item.item);
  });
  let text = 'Family Grocery List\n\n';
  Object.entries(grouped).forEach(([section, lines]) => {
    text += `${section}\n`;
    lines.forEach((l) => {
      text += `  ☐ ${l}\n`;
    });
    text += '\n';
  });
  navigator.clipboard.writeText(text.trim()).then(() => showToast('Grocery list copied.'));
}

function renderSnackList() {
  const q = document.getElementById('snackSearch').value.trim().toLowerCase();
  const snacks = state.recipes.filter((m) => {
    if (!(m.meal_types || []).includes('snack')) return false;
    if (!DB.canPlan(m)) return false;
    if (q && !m.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const list = document.getElementById('snackList');
  list.innerHTML = '';
  if (!snacks.length) {
    list.innerHTML = '<li class="meal-list-item">No snack recipes with ingredients yet.</li>';
    return;
  }
  snacks.forEach((meal) => {
    const inGrocery = state.snackAdds.map(String).includes(String(meal.id));
    const li = document.createElement('li');
    li.className = 'meal-list-item';
    li.innerHTML = `
      <h4>${escapeHtml(meal.name)}</h4>
      <div class="meta">${(meal.ingredients || []).map((i) => i.item).join(', ')}</div>
      <div class="actions">
        <button type="button" class="btn ${inGrocery ? 'btn-ghost' : 'btn-primary'} btn-sm toggle-snack">
          ${inGrocery ? 'Remove from grocery' : 'Add to grocery list'}
        </button>
      </div>`;
    li.querySelector('.toggle-snack').addEventListener('click', () => {
      if (inGrocery) state.snackAdds = state.snackAdds.filter((id) => String(id) !== String(meal.id));
      else state.snackAdds.push(meal.id);
      renderSnackList();
      renderGrocery();
      scheduleSave();
    });
    list.appendChild(li);
  });
}

/* ---------- Init ---------- */

async function changeWeek(offsetDays) {
  const d = parseDate(state.weekStart);
  d.setDate(d.getDate() + offsetDays);
  state.weekStart = getMondayISO(d);
  await loadWeek();
}

async function init() {
  renderTypeChips([]);
  renderTagChips([]);
  addIngredientRow();
  renderCategoryChips();

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });
  document.getElementById('prevWeek').addEventListener('click', () => changeWeek(-7));
  document.getElementById('nextWeek').addEventListener('click', () => changeWeek(7));
  document.getElementById('todayBtn').addEventListener('click', async () => {
    state.weekStart = getMondayISO(new Date());
    await loadWeek();
  });
  document.getElementById('generateBtn').addEventListener('click', () => {
    state.generateFilters = new Set();
    renderFilterChips('generateFilters', state.generateFilters, () => {});
    document.getElementById('previewList').innerHTML = '';
    document.getElementById('generateModal').showModal();
  });
  document.getElementById('fillWeekBtn').addEventListener('click', () => {
    fillSlots(document.getElementById('generateTarget').value);
  });
  document.getElementById('previewBtn').addEventListener('click', previewSuggestions);
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear all meals for this week?')) return;
    state.plan = DB.emptyPlan();
    state.snackAdds = [];
    state.groceryChecked = {};
    renderCalendar();
    renderGrocery();
    scheduleSave();
  });
  document.getElementById('pickerSearch').addEventListener('input', renderPickerList);
  document.getElementById('clearSlotBtn').addEventListener('click', clearSlot);
  document.getElementById('copyGroceryBtn').addEventListener('click', copyGroceryList);
  document.getElementById('snacksBtn').addEventListener('click', () => {
    document.getElementById('snackSearch').value = '';
    renderSnackList();
    document.getElementById('snacksModal').showModal();
  });
  document.getElementById('snackSearch').addEventListener('input', renderSnackList);
  document.getElementById('confirmAssignBtn').addEventListener('click', confirmAssign);
  document.getElementById('recipeForm').addEventListener('submit', handleSaveRecipe);
  document.getElementById('addIngredientBtn').addEventListener('click', () => addIngredientRow());
  document.getElementById('cancelEditBtn').addEventListener('click', resetRecipeForm);
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderRecipeList();
  });
  document.getElementById('category').addEventListener('change', (e) => {
    const mapped = C.CATEGORY_TO_MEAL_TYPES[e.target.value] || [];
    if (mapped.length && !document.getElementById('recipeTypeChips')._selected().length) {
      renderTypeChips(mapped);
    }
  });
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => document.getElementById(btn.dataset.close).close());
  });

  try {
    const [recipes, members] = await Promise.all([DB.listRecipes(), DB.listMembers()]);
    state.recipes = recipes;
    state.members = members;
    populateMemberSelect();
    renderRecipeList();
    await loadWeek();
  } catch (err) {
    console.error(err);
    showToast('Could not load household data. Check the SQL migration ran.');
    document.getElementById('recipesContainer').innerHTML =
      '<div class="empty-state"><p>Could not load recipes. Confirm the household SQL ran in Supabase.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', init);
