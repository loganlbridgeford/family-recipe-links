/* global APP_CONFIG, DB */
const C = APP_CONFIG;

const FALLBACK_MEMBERS = [
  'Logan',
  'Nadine',
  'John C.',
  'Neileen',
  'John A.',
  'Abbie',
  'Tyler',
  'Monica'
];

const state = {
  recipes: [],
  members: [],
  weekStart: getMondayISO(new Date()),
  plan: DB.emptyPlan(),
  groceryChecked: {},
  snackAdds: [],
  manualItems: [],
  categoryFilter: 'All',
  search: '',
  pickerCategory: 'All',
  generateCategory: 'All',
  pickerContext: null,
  pendingAssignId: null,
  assignDay: 'mon',
  assignSlot: 'breakfast',
  saveTimer: null
};

let drag = null;
let suppressClickUntil = 0;

function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMondayISO(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return toLocalISODate(d);
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

function slotValue(plan, day, slot) {
  if (!plan || !plan[day]) return null;
  const raw = plan[day][slot];
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') {
    const name = raw.type === 'custom' ? String(raw.name || '').trim() : '';
    return name ? { type: 'custom', name } : null;
  }
  return { type: 'recipe', id: raw, recipe: getRecipe(raw) };
}

function slotName(val) {
  if (!val) return '';
  if (val.type === 'custom') return val.name;
  return (val.recipe && val.recipe.name) || 'Meal';
}

function defaultAddedBy() {
  const sel = document.getElementById('addedBy');
  if (sel && sel.value) return sel.value;
  if (state.members[0] && state.members[0].display_name) return state.members[0].display_name;
  return FALLBACK_MEMBERS[0];
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
      snack_adds: state.snackAdds,
      manual_items: state.manualItems
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
  state.manualItems = Array.isArray(row.manual_items) ? row.manual_items : [];
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
  document.getElementById('weekBar').hidden = name === 'recipes';
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
      const val = slotValue(state.plan, day, slot);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.dataset.day = day;
      cell.dataset.slot = slot;
      if (val && val.type === 'custom') {
        cell.className = 'meal-cell filled custom';
        cell.innerHTML = `<span class="meal-cell-name">${escapeHtml(val.name)}</span>`;
      } else if (val && val.type === 'recipe' && val.recipe) {
        const meal = val.recipe;
        const batch = (meal.tags || []).includes('batch-cook');
        cell.className = 'meal-cell filled';
        cell.innerHTML = `
          <span class="meal-cell-name">${escapeHtml(meal.name)}</span>
          <span class="meal-cell-meta">
            ${meal.prep_minutes ? `<span class="badge badge-time">${meal.prep_minutes} min</span>` : ''}
            ${batch ? '<span class="badge badge-batch">Batch</span>' : ''}
          </span>`;
      } else {
        cell.className = 'meal-cell';
        cell.innerHTML = '<span class="meal-cell-placeholder">Tap to add</span>';
      }
      cell.addEventListener('click', () => {
        if (Date.now() < suppressClickUntil) return;
        if (val && val.type === 'recipe' && val.recipe) {
          openRecipeCard(val.recipe.id, { fromCalendar: true, day, slot });
        } else {
          openPicker(day, slot);
        }
      });
      grid.appendChild(cell);
    });
  });
}

function openPicker(day, slot) {
  state.pickerContext = { day, slot };
  state.pickerCategory = 'All';
  document.getElementById('pickerTitle').textContent = `Choose ${C.SLOT_LABELS[slot]} — ${C.DAY_LABELS[C.DAYS.indexOf(day)]}`;
  document.getElementById('pickerSearch').value = '';
  const current = slotValue(state.plan, day, slot);
  document.getElementById('customMealName').value = current && current.type === 'custom' ? current.name : '';
  document.getElementById('customSaveRecipe').checked = false;
  renderPickerCategoryChips();
  renderPickerList();
  document.getElementById('pickerModal').showModal();
}

function renderPickerCategoryChips() {
  const container = document.getElementById('pickerFilters');
  container.innerHTML = '';
  C.RECIPE_CATEGORIES.forEach((cat) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.pickerCategory === cat ? ' active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      state.pickerCategory = cat;
      renderPickerCategoryChips();
      renderPickerList();
    });
    container.appendChild(chip);
  });
}

function renderGenerateCategoryChips() {
  const container = document.getElementById('generateFilters');
  container.innerHTML = '';
  C.RECIPE_CATEGORIES.forEach((cat) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.generateCategory === cat ? ' active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      state.generateCategory = cat;
      renderGenerateCategoryChips();
    });
    container.appendChild(chip);
  });
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
  const list = document.getElementById('pickerMealList');
  list.innerHTML = '';

  const meals = state.recipes.filter((r) => {
    if (state.pickerCategory !== 'All' && (r.category || 'Other') !== state.pickerCategory) return false;
    if (q && !recipeSearchText(r).includes(q)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  if (!meals.length) {
    list.innerHTML = '<li class="meal-list-item"><p>No recipes match.</p></li>';
    return;
  }

  meals.forEach((meal) => {
    const li = document.createElement('li');
    li.className = 'meal-list-item';
    const note = DB.canPlan(meal) ? '' : '<div class="meta">No ingredients — won’t add to grocery.</div>';
    li.innerHTML = `
      <h4>${escapeHtml(meal.name)}</h4>
      <div class="meta">${meal.prep_minutes || '—'} min · ${(meal.tags || []).slice(0, 3).map((t) => C.TAG_LABELS[t] || t).join(' · ')}</div>
      ${note}
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
  assignPickerValue(mealId);
}

async function addCustomMeal() {
  if (!state.pickerContext) return;
  const name = document.getElementById('customMealName').value.trim();
  if (!name) {
    showToast('Type a meal name first.');
    return;
  }
  if (document.getElementById('customSaveRecipe').checked) {
    const btn = document.getElementById('customMealAddBtn');
    btn.disabled = true;
    try {
      const created = await DB.addRecipe({
        name,
        category: 'Other',
        added_by: defaultAddedBy(),
        ingredients: [],
        meal_types: [],
        tags: []
      });
      state.recipes.push(created);
      state.recipes.sort((a, b) => a.name.localeCompare(b.name));
      renderRecipeList();
      assignPickerValue(created.id);
    } catch (err) {
      console.error(err);
      showToast('Could not save recipe.');
    } finally {
      btn.disabled = false;
    }
    return;
  }
  assignPickerValue({ type: 'custom', name });
}

function assignPickerValue(value) {
  if (!state.pickerContext) return;
  const { day, slot } = state.pickerContext;
  state.plan[day][slot] = value;
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

function moveSlot(fromDay, fromSlot, toDay, toSlot) {
  if (fromDay === toDay && fromSlot === toSlot) return;
  const from = state.plan[fromDay][fromSlot];
  state.plan[fromDay][fromSlot] = state.plan[toDay][toSlot];
  state.plan[toDay][toSlot] = from;
  renderCalendar();
  renderGrocery();
  scheduleSave();
}

function cellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.closest ? el.closest('#calendarGrid .meal-cell') : null;
}

function endDrag() {
  if (drag && drag.ghost) drag.ghost.remove();
  document.querySelectorAll('.meal-cell.drag-source, .meal-cell.drag-over').forEach((el) => {
    el.classList.remove('drag-source', 'drag-over');
  });
  if (drag && drag.mode === 'active') suppressClickUntil = Date.now() + 400;
  drag = null;
}

function onGridPointerDown(e) {
  if (e.button != null && e.button !== 0) return;
  const cell = e.target.closest('.meal-cell');
  if (!cell) return;
  const { day, slot } = cell.dataset;
  const val = slotValue(state.plan, day, slot);
  if (!val || (val.type === 'recipe' && !val.recipe)) return;
  drag = { mode: 'pending', day, slot, x: e.clientX, y: e.clientY, cell, pointerId: e.pointerId };
}

function onGridPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (drag.mode === 'pending') {
    if (dx * dx + dy * dy < 144) return;
    drag.mode = 'active';
    drag.cell.classList.add('drag-source');
    const ghost = document.createElement('div');
    ghost.className = 'meal-drag-ghost';
    ghost.textContent = slotName(slotValue(state.plan, drag.day, drag.slot));
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    try {
      drag.cell.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  }
  if (drag.mode !== 'active') return;
  e.preventDefault();
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;
  document.querySelectorAll('.meal-cell.drag-over').forEach((el) => el.classList.remove('drag-over'));
  const over = cellFromPoint(e.clientX, e.clientY);
  if (over && (over.dataset.day !== drag.day || over.dataset.slot !== drag.slot)) {
    over.classList.add('drag-over');
  }
}

function onGridPointerUp(e) {
  if (!drag) return;
  if (drag.mode === 'active') {
    const over = cellFromPoint(e.clientX, e.clientY);
    if (over && over.dataset.day && over.dataset.slot) {
      moveSlot(drag.day, drag.slot, over.dataset.day, over.dataset.slot);
    }
  }
  endDrag();
}

function initCalendarDrag() {
  const grid = document.getElementById('calendarGrid');
  grid.addEventListener('pointerdown', onGridPointerDown);
  window.addEventListener('pointermove', onGridPointerMove, { passive: false });
  window.addEventListener('pointerup', onGridPointerUp);
  window.addEventListener('pointercancel', endDrag);
}

/* ---------- Generate ---------- */

function getUsedMealIds() {
  const used = new Set();
  C.DAYS.forEach((d) => {
    C.MEAL_SLOTS.forEach((s) => {
      const val = slotValue(state.plan, d, s);
      if (val && val.type === 'recipe') used.add(String(val.id));
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
    if (dayIndex <= 2 && (tags.includes('leftover-friendly') || tags.includes('batch-cook'))) score += 25;
    if (dayIndex <= 2 && (meal.prep_minutes || 99) <= 30) score += 15;
  }
  if (slot === 'lunch' && tags.includes('packable') && dayIndex <= 4) score += 10;
  if (slot === 'breakfast' && dayIndex <= 4 && tags.includes('quick')) score += 10;
  if (slot === 'breakfast' && dayIndex >= 5 && tags.includes('batch-cook')) score += 15;
  return score;
}

function getCandidates(slot, category, used) {
  let pool = state.recipes.filter((m) => DB.canPlan(m) && (m.meal_types || []).includes(slot));
  if (category && category !== 'All') {
    pool = pool.filter((m) => (m.category || 'Other') === category);
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
      if (!slotValue(state.plan, day, slot)) slots.push({ day, slot });
    });
  });
  if (!slots.length) {
    showToast('No empty slots to fill.');
    return;
  }
  let filled = 0;
  slots.forEach(({ day, slot }) => {
    const candidates = getCandidates(slot, state.generateCategory, used);
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
      if (slotValue(state.plan, day, slot)) return;
      const candidates = getCandidates(slot, state.generateCategory, used);
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
    : '<li>No ingredients — won’t add to grocery.</li>';

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
    const change = document.createElement('button');
    change.className = 'btn btn-secondary';
    change.textContent = 'Change meal';
    change.addEventListener('click', () => {
      document.getElementById('recipeModal').close();
      openPicker(context.day, context.slot);
    });
    actions.appendChild(change);
    const remove = document.createElement('button');
    remove.className = 'btn btn-ghost';
    remove.textContent = 'Remove meal';
    remove.addEventListener('click', () => {
      state.plan[context.day][context.slot] = null;
      document.getElementById('recipeModal').close();
      renderCalendar();
      renderGrocery();
      scheduleSave();
      showToast('Meal removed.');
    });
    actions.appendChild(remove);
  }
  if (context.fromLibrary) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Assign';
    btn.addEventListener('click', () => openAssignModal(meal.id));
    actions.appendChild(btn);
  }
  document.getElementById('recipeModal').showModal();
}

function openAssignModal(mealId) {
  state.pendingAssignId = mealId;
  state.assignDay = C.DAYS[0];
  state.assignSlot = 'breakfast';
  const meal = getRecipe(mealId);
  if (meal && (meal.meal_types || []).length === 1 && C.MEAL_SLOTS.includes(meal.meal_types[0])) {
    state.assignSlot = meal.meal_types[0];
  }
  document.getElementById('assignWeekLabel').textContent = formatWeekLabel(state.weekStart);
  renderAssignWeek();
  renderAssignSlots();
  document.getElementById('assignModal').showModal();
}

function renderAssignWeek() {
  const wrap = document.getElementById('assignWeek');
  wrap.innerHTML = '';
  C.DAYS.forEach((day, i) => {
    const date = getDayDate(state.weekStart, i);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assign-day' + (state.assignDay === day ? ' active' : '');
    if (slotValue(state.plan, day, state.assignSlot)) btn.classList.add('has-meal');
    btn.innerHTML = `<span class="dow">${C.DAY_LABELS[i]}</span><span class="num">${date.getDate()}</span>`;
    btn.addEventListener('click', () => {
      state.assignDay = day;
      renderAssignWeek();
    });
    wrap.appendChild(btn);
  });
}

function renderAssignSlots() {
  const wrap = document.getElementById('assignSlots');
  wrap.innerHTML = '';
  C.MEAL_SLOTS.forEach((slot) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (state.assignSlot === slot ? ' active' : '');
    btn.textContent = C.SLOT_LABELS[slot];
    btn.addEventListener('click', () => {
      state.assignSlot = slot;
      renderAssignSlots();
      renderAssignWeek();
    });
    wrap.appendChild(btn);
  });
}

function confirmAssign() {
  if (!state.pendingAssignId || !state.assignDay || !state.assignSlot) return;
  const day = state.assignDay;
  const slot = state.assignSlot;
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
  const cats = C.RECIPE_CATEGORIES;
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

const INGREDIENT_UNITS = new Set([
  'cup', 'cups',
  'tablespoon', 'tablespoons', 'tbsp', 'tbsps', 'tbs',
  'teaspoon', 'teaspoons', 'tsp', 'tsps',
  'pound', 'pounds', 'lb', 'lbs',
  'ounce', 'ounces', 'oz', 'ozs',
  'gram', 'grams', 'g',
  'kilogram', 'kilograms', 'kg',
  'milliliter', 'milliliters', 'ml',
  'liter', 'liters', 'l',
  'pinch', 'pinches',
  'dash', 'dashes',
  'clove', 'cloves',
  'can', 'cans',
  'package', 'packages', 'pkg', 'pkgs',
  'stick', 'sticks',
  'bunch', 'bunches',
  'head', 'heads',
  'slice', 'slices',
  'piece', 'pieces',
  'large', 'small', 'medium', 'whole'
]);

const SECTION_KEYWORDS = {
  produce: [
    'lettuce', 'tomato', 'onion', 'garlic', 'bell pepper', 'spinach', 'carrot', 'celery',
    'potato', 'avocado', 'lemon', 'lime', 'apple', 'banana', 'cilantro', 'basil',
    'parsley', 'cucumber', 'zucchini', 'broccoli', 'cabbage', 'mushroom', 'berry',
    'berries', 'fruit', 'scallion', 'shallot', 'ginger', 'jalapeno'
  ],
  meat: [
    'chicken', 'beef', 'pork', 'turkey', 'sausage', 'bacon', 'ham', 'shrimp',
    'salmon', 'fish', 'steak', 'ground', 'meatball', 'lamb'
  ],
  dairy: [
    'milk', 'cream', 'cheese', 'butter', 'yogurt', 'egg', 'eggs', 'sour cream',
    'mozzarella', 'parmesan', 'cheddar', 'half-and-half'
  ],
  frozen: ['frozen'],
  bakery: ['bread', 'bun', 'buns', 'tortilla', 'roll', 'rolls', 'pita', 'bagel']
};

function guessIngredientSection(item) {
  const key = String(item || '').toLowerCase();
  if (!key) return 'pantry';
  if (/\bfrozen\b/.test(key)) return 'frozen';
  const order = ['meat', 'dairy', 'produce', 'bakery', 'frozen'];
  for (const section of order) {
    if ((SECTION_KEYWORDS[section] || []).some((word) => {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i');
      return re.test(key);
    })) return section;
  }
  return 'pantry';
}

function parseIngredientLine(raw) {
  let line = String(raw || '')
    .replace(/[\u00bc]/g, '1/4')
    .replace(/[\u00bd]/g, '1/2')
    .replace(/[\u00be]/g, '3/4')
    .replace(/[\u2153]/g, '1/3')
    .replace(/[\u2154]/g, '2/3')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[•\-\*\u2022]+\s*/, '');
  if (!line) return null;

  const tokens = line.split(' ');
  const qtyParts = [];
  let i = 0;
  const isNumber = (t) => /^(?:\d+\/\d+|\d+\.\d+|\d+)(?:-\d+(?:\/\d+)?)?$/.test(t);
  while (i < tokens.length && isNumber(tokens[i])) {
    qtyParts.push(tokens[i]);
    i += 1;
  }
  if (i < tokens.length) {
    const unit = tokens[i].replace(/[.,]$/, '').toLowerCase();
    if (INGREDIENT_UNITS.has(unit)) {
      qtyParts.push(tokens[i].replace(/[.,]$/, ''));
      i += 1;
      if (tokens[i] && tokens[i].toLowerCase() === 'of') {
        qtyParts.push(tokens[i]);
        i += 1;
      }
    }
  }
  const item = tokens.slice(i).join(' ').trim() || line;
  return {
    item,
    qty: qtyParts.join(' '),
    section: guessIngredientSection(item)
  };
}

function setIngredientRows(list) {
  const container = document.getElementById('ingredientRows');
  container.innerHTML = '';
  const rows = list && list.length ? list : [{ item: '', qty: '', section: 'pantry' }];
  rows.forEach(addIngredientRow);
}

function hidePasteFallback() {
  const wrap = document.getElementById('pasteIngredientsWrap');
  wrap.classList.add('hidden');
  document.getElementById('pasteIngredients').value = '';
}

function showPasteFallback(hint) {
  const wrap = document.getElementById('pasteIngredientsWrap');
  wrap.classList.remove('hidden');
  const box = document.getElementById('pasteIngredients');
  box.focus();
  showToast(hint || 'Paste ingredients instead.');
}

function applyImportedRecipe(data) {
  const nameEl = document.getElementById('recipeName');
  if (!nameEl.value.trim() && data.name) nameEl.value = data.name;
  if (data.servings != null && data.servings !== '') {
    document.getElementById('recipeServings').value = data.servings;
  }
  if (data.prepMinutes != null && data.prepMinutes !== '') {
    document.getElementById('recipePrep').value = data.prepMinutes;
  }
  const parsed = (data.ingredients || []).map(parseIngredientLine).filter(Boolean);
  if (parsed.length) setIngredientRows(parsed);
  if (Array.isArray(data.steps) && data.steps.length) {
    document.getElementById('recipeStepsList').value = data.steps.join('\n');
  }
  document.getElementById('cookDetails').open = true;
}

async function pullIngredientsFromLink() {
  const urlEl = document.getElementById('recipeUrl');
  const url = urlEl.value.trim();
  const btn = document.getElementById('importRecipeBtn');
  if (!url) {
    showToast('Paste a recipe URL first.');
    urlEl.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Reading page…';
  try {
    const data = await DB.importRecipeFromUrl(url);
    if (data && data.ok) {
      applyImportedRecipe(data);
      if ((data.ingredients || []).length) {
        hidePasteFallback();
        showToast('Check the ingredients, then save.');
        return;
      }
    }
    showPasteFallback((data && data.hint) || 'Paste ingredients instead.');
  } catch (err) {
    console.error(err);
    showPasteFallback('Paste ingredients instead.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pull ingredients from link';
  }
}

function usePastedList() {
  const lines = document.getElementById('pasteIngredients').value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) {
    showToast('Paste one ingredient per line.');
    document.getElementById('pasteIngredients').focus();
    return;
  }
  setIngredientRows(lines.map(parseIngredientLine).filter(Boolean));
  document.getElementById('cookDetails').open = true;
  showToast('Check the ingredients, then save.');
}

function addIngredientRow(ing = { item: '', qty: '', section: 'pantry' }) {
  const container = document.getElementById('ingredientRows');
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  const opts = C.MEAL_SECTIONS.map(
    (s) => `<option value="${s}">${C.SECTION_LABELS[s]}</option>`
  ).join('');
  row.innerHTML = `
    <input type="text" class="ing-item" placeholder="Item">
    <input type="text" class="ing-qty" placeholder="Qty">
    <select class="ing-section">${opts}</select>
    <button type="button" class="btn btn-icon remove-ing" aria-label="Remove">✕</button>`;
  row.querySelector('.ing-item').value = ing.item || '';
  row.querySelector('.ing-qty').value = ing.qty || '';
  row.querySelector('.ing-section').value = C.MEAL_SECTIONS.includes(ing.section) ? ing.section : 'pantry';
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
  hidePasteFallback();
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
  hidePasteFallback();
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
        const val = slotValue(state.plan, d, s);
        if (val && val.type === 'recipe' && String(val.id) === String(id)) state.plan[d][s] = null;
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
        : '<span class="badge badge-needs">No ingredients — won’t add to grocery</span>'}</div>
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
        <button type="button" class="btn btn-primary btn-sm assign-btn">Assign</button>
      </div>`;
    card.querySelector('.delete-btn').addEventListener('click', () => handleDeleteRecipe(recipe.id));
    card.querySelector('.view-btn').addEventListener('click', () => openRecipeCard(recipe.id, { fromLibrary: true }));
    card.querySelector('.edit-btn').addEventListener('click', () => openEditForm(recipe));
    card.querySelector('.assign-btn').addEventListener('click', () => openAssignModal(recipe.id));
    container.appendChild(card);
  });
}

/* ---------- Grocery ---------- */

const GROCERY_PREP_WORDS = new Set([
  'minced', 'chopped', 'diced', 'sliced', 'grated', 'crushed', 'peeled', 'seeded',
  'softened', 'melted', 'divided', 'optional', 'finely', 'roughly', 'fresh',
  'large', 'small', 'medium', 'whole', 'thinly', 'coarsely', 'plus', 'more',
  'taste', 'to', 'clove', 'cloves', 'packed', 'thawed', 'drained', 'rinsed',
  'room', 'temperature', 'and', 'or', 'of', 'for', 'the'
]);

const QTY_UNIT_ALIASES = {
  tsp: 'teaspoon',
  tsps: 'teaspoon',
  teaspoon: 'teaspoon',
  teaspoons: 'teaspoon',
  tbsp: 'tablespoon',
  tbsps: 'tablespoon',
  tbs: 'tablespoon',
  tablespoon: 'tablespoon',
  tablespoons: 'tablespoon',
  cup: 'cup',
  cups: 'cup',
  lb: 'pound',
  lbs: 'pound',
  pound: 'pound',
  pounds: 'pound',
  oz: 'ounce',
  ozs: 'ounce',
  ounce: 'ounce',
  ounces: 'ounce',
  g: 'gram',
  gram: 'gram',
  grams: 'gram',
  clove: 'clove',
  cloves: 'clove',
  can: 'can',
  cans: 'can'
};

function groceryItemKey(item) {
  const words = String(item || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !GROCERY_PREP_WORDS.has(w));
  return words.sort().join(' ');
}

function prettyGroceryName(key, originals) {
  const unique = [...new Set((originals || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (unique.length === 1) return unique[0];
  if (!key) return unique[0] || '';
  return key.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function qtyToNumber(raw) {
  const s = String(raw || '').trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseQtyParts(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^((?:\d+\s+)?\d+\/\d+|\d+\.\d+|\d+)\s*(.*)$/);
  if (!m) return null;
  const n = qtyToNumber(m[1]);
  if (n == null) return null;
  const unitRaw = (m[2] || '').trim().toLowerCase().replace(/[.,]$/, '');
  const unit = QTY_UNIT_ALIASES[unitRaw] || unitRaw;
  return { n, unit };
}

function formatQtyNumber(n) {
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function pluralUnit(unit, n) {
  if (!unit) return '';
  if (n === 1) return unit;
  if (unit.endsWith('s')) return unit;
  return unit + 's';
}

function formatQtys(qtys) {
  const raw = (qtys || []).map((q) => String(q || '').trim()).filter(Boolean);
  if (!raw.length) return '';
  const parsed = raw.map(parseQtyParts);
  if (parsed.length >= 2 && parsed.every((p) => p && p.unit === parsed[0].unit)) {
    const sum = parsed.reduce((acc, p) => acc + p.n, 0);
    const unit = parsed[0].unit;
    return (formatQtyNumber(sum) + (unit ? ' ' + pluralUnit(unit, sum) : '')).trim();
  }
  return raw.join(' + ');
}

function addGroceryItem(items, ing, recipeName) {
  const itemName = (ing.item || '').trim();
  if (!itemName) return;
  const source = (recipeName || '').trim();
  const key = groceryItemKey(itemName);
  if (!key) return;
  if (!items[key]) {
    items[key] = {
      key,
      item: itemName,
      originals: [itemName],
      qtys: ing.qty ? [ing.qty] : [],
      section: ing.section || 'other',
      recipeNames: source ? [source] : []
    };
    return;
  }
  const row = items[key];
  if (!row.originals.includes(itemName)) row.originals.push(itemName);
  if (ing.qty && !row.qtys.includes(ing.qty)) row.qtys.push(ing.qty);
  if (source && !row.recipeNames.includes(source)) row.recipeNames.push(source);
  if ((!row.section || row.section === 'other') && ing.section && ing.section !== 'other') {
    row.section = ing.section;
  }
}

function groceryItemLabel(entry) {
  const recipes = [...(entry.recipeNames || (entry.recipeName ? [entry.recipeName] : []))].sort((a, b) =>
    a.localeCompare(b)
  );
  const item = prettyGroceryName(entry.key || groceryItemKey(entry.item), entry.originals || [entry.item]);
  const name = recipes.length ? `${item} (${recipes.join(', ')})` : item;
  const qty = formatQtys(entry.qtys);
  return qty ? `${name} — ${qty}` : name;
}

function getGroceryItems() {
  const items = {};
  C.DAYS.forEach((day) => {
    C.MEAL_SLOTS.forEach((slot) => {
      const val = slotValue(state.plan, day, slot);
      if (!val || val.type !== 'recipe' || !val.recipe || !DB.canPlan(val.recipe)) return;
      (val.recipe.ingredients || []).forEach((ing) => addGroceryItem(items, ing, val.recipe.name));
    });
  });
  state.snackAdds.forEach((id) => {
    const meal = getRecipe(id);
    if (meal && DB.canPlan(meal)) {
      (meal.ingredients || []).forEach((ing) => addGroceryItem(items, ing, meal.name));
    }
  });
  return items;
}

function guessGrocerySection(name) {
  const key = (name || '').toLowerCase().trim();
  if (!key) return 'other';
  for (const recipe of state.recipes) {
    for (const ing of recipe.ingredients || []) {
      if ((ing.item || '').toLowerCase().trim() === key && C.MEAL_SECTIONS.includes(ing.section)) {
        return ing.section;
      }
    }
  }
  return 'other';
}

function addManualGrocery() {
  const input = document.getElementById('manualGroceryInput');
  const name = input.value.trim();
  if (!name) {
    showToast('Type an item to add.');
    return;
  }
  state.manualItems.push({
    id: 'manual-' + Date.now(),
    item: name,
    qty: '',
    section: guessGrocerySection(name),
    checked: false
  });
  input.value = '';
  renderGrocery();
  scheduleSave();
}

function renderGrocery() {
  const container = document.getElementById('groceryList');
  const items = getGroceryItems();
  const manuals = state.manualItems || [];
  const keys = Object.keys(items);
  if (!keys.length && !manuals.length) {
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
    grouped[section].push({
      kind: 'recipe',
      key,
      item: item.item,
      originals: item.originals,
      qtys: item.qtys,
      recipeNames: item.recipeNames
    });
  });
  manuals.forEach((manual) => {
    const section = grouped[manual.section] ? manual.section : 'other';
    grouped[section].push({ kind: 'manual', ...manual });
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
    sectionItems.forEach((entry) => {
      const row = document.createElement('div');
      if (entry.kind === 'manual') {
        const checked = !!entry.checked;
        row.className = 'grocery-item' + (checked ? ' checked' : '');
        const id = 'm-' + String(entry.id).replace(/\W/g, '-');
        row.innerHTML = `
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
          <label for="${id}">${escapeHtml(entry.item)}${entry.qty ? ' — ' + escapeHtml(entry.qty) : ''} <span class="badge badge-added">Added</span></label>
          <button type="button" class="btn btn-icon btn-sm remove-manual" aria-label="Remove">✕</button>`;
        row.querySelector('input').addEventListener('change', (e) => {
          const found = state.manualItems.find((m) => m.id === entry.id);
          if (found) found.checked = e.target.checked;
          row.classList.toggle('checked', e.target.checked);
          scheduleSave();
        });
        row.querySelector('.remove-manual').addEventListener('click', (e) => {
          e.stopPropagation();
          state.manualItems = state.manualItems.filter((m) => m.id !== entry.id);
          renderGrocery();
          scheduleSave();
        });
      } else {
        const checked = !!state.groceryChecked[entry.key];
        row.className = 'grocery-item' + (checked ? ' checked' : '');
        const id = 'g-' + entry.key.replace(/\W/g, '-');
        row.innerHTML = `
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
          <label for="${id}">${escapeHtml(groceryItemLabel(entry))}</label>`;
        row.querySelector('input').addEventListener('change', (e) => {
          state.groceryChecked[entry.key] = e.target.checked;
          row.classList.toggle('checked', e.target.checked);
          scheduleSave();
        });
      }
      itemList.appendChild(row);
    });
    group.appendChild(title);
    group.appendChild(itemList);
    container.appendChild(group);
  });
}

function buildGroceryText() {
  const items = getGroceryItems();
  const keys = Object.keys(items);
  const manuals = state.manualItems || [];
  if (!keys.length && !manuals.length) return '';
  const grouped = {};
  keys.forEach((key) => {
    const item = items[key];
    const section = C.SECTION_LABELS[item.section] || 'Other';
    if (!grouped[section]) grouped[section] = [];
    grouped[section].push(groceryItemLabel(item));
  });
  manuals.forEach((manual) => {
    const section = C.SECTION_LABELS[manual.section] || 'Other';
    if (!grouped[section]) grouped[section] = [];
    grouped[section].push(manual.qty ? `${manual.item} — ${manual.qty}` : `${manual.item} (added)`);
  });
  let text = 'Family Grocery List\n\n';
  Object.entries(grouped).forEach(([section, lines]) => {
    text += `${section}\n`;
    lines.forEach((l) => {
      text += `  ☐ ${l}\n`;
    });
    text += '\n';
  });
  return text.trim();
}

function copyGroceryList() {
  const text = buildGroceryText();
  if (!text) {
    showToast('Nothing to copy yet.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => showToast('Grocery list copied.'));
}

async function shareGroceryList() {
  const text = buildGroceryText();
  if (!text) {
    showToast('Nothing to share yet.');
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Family grocery list', text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied — paste into Reminders');
  } catch (err) {
    console.error(err);
    showToast('Could not share the list.');
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function icsEscape(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsLocalStamp(date, hour, minute) {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `T${pad2(hour)}${pad2(minute)}00`
  );
}

function icsUtcNow() {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

function downloadWeekIcs() {
  const times = { breakfast: [7, 30], lunch: [12, 0], dinner: [18, 0] };
  const stamp = icsUtcNow();
  const events = [];
  C.DAYS.forEach((day, index) => {
    C.MEAL_SLOTS.forEach((slot) => {
      const val = slotValue(state.plan, day, slot);
      if (!val) return;
      const name = slotName(val);
      if (!name) return;
      const date = getDayDate(state.weekStart, index);
      const [hour, minute] = times[slot] || [18, 0];
      const uid = `family-plan-${state.weekStart}-${day}-${slot}@family-planner`;
      events.push(
        [
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsLocalStamp(date, hour, minute)}`,
          'DURATION:PT1H',
          `SUMMARY:${icsEscape(name)}`,
          'DESCRIPTION:From Family Planner',
          'END:VEVENT'
        ].join('\r\n')
      );
    });
  });
  if (!events.length) {
    showToast('No meals on this week to add.');
    return;
  }
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Planner//EN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n') + '\r\n';
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `family-plan-${state.weekStart}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  showToast('Calendar file downloaded.');
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
    state.generateCategory = 'All';
    renderGenerateCategoryChips();
    document.getElementById('previewList').innerHTML = '';
    document.getElementById('generateModal').showModal();
  });
  document.getElementById('fillWeekBtn').addEventListener('click', () => {
    fillSlots(document.getElementById('generateTarget').value);
  });
  document.getElementById('previewBtn').addEventListener('click', previewSuggestions);
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear all meals for this week?')) return;
    const clearExtras = confirm('Also clear extra grocery items?');
    state.plan = DB.emptyPlan();
    state.snackAdds = [];
    state.groceryChecked = {};
    if (clearExtras) state.manualItems = [];
    renderCalendar();
    renderGrocery();
    scheduleSave();
  });
  document.getElementById('manualGroceryBtn').addEventListener('click', addManualGrocery);
  document.getElementById('manualGroceryInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addManualGrocery();
    }
  });
  document.getElementById('pickerSearch').addEventListener('input', renderPickerList);
  document.getElementById('clearSlotBtn').addEventListener('click', clearSlot);
  document.getElementById('customMealAddBtn').addEventListener('click', addCustomMeal);
  document.getElementById('customMealName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomMeal();
    }
  });
  initCalendarDrag();
  document.getElementById('copyGroceryBtn').addEventListener('click', copyGroceryList);
  document.getElementById('shareGroceryBtn').addEventListener('click', shareGroceryList);
  document.getElementById('calendarWeekBtn').addEventListener('click', downloadWeekIcs);
  document.getElementById('snacksBtn').addEventListener('click', () => {
    document.getElementById('snackSearch').value = '';
    renderSnackList();
    document.getElementById('snacksModal').showModal();
  });
  document.getElementById('snackSearch').addEventListener('input', renderSnackList);
  document.getElementById('confirmAssignBtn').addEventListener('click', confirmAssign);
  document.getElementById('recipeForm').addEventListener('submit', handleSaveRecipe);
  document.getElementById('importRecipeBtn').addEventListener('click', pullIngredientsFromLink);
  document.getElementById('usePastedListBtn').addEventListener('click', usePastedList);
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
    state.recipes = await DB.listRecipes();
  } catch (err) {
    console.error(err);
    showToast('Could not load recipes. Check the SQL migration ran.');
    document.getElementById('recipesContainer').innerHTML =
      '<div class="empty-state"><p>Could not load recipes. Confirm the household SQL ran in Supabase.</p></div>';
  }

  try {
    const members = await DB.listMembers();
    state.members = members && members.length
      ? members
      : FALLBACK_MEMBERS.map((display_name, i) => ({ display_name, sort_order: i + 1 }));
  } catch (err) {
    console.error(err);
    state.members = FALLBACK_MEMBERS.map((display_name, i) => ({ display_name, sort_order: i + 1 }));
  }

  populateMemberSelect();
  renderRecipeList();
  try {
    await loadWeek();
  } catch (err) {
    console.error(err);
    showToast('Could not load this week’s plan.');
    renderCalendar();
    renderGrocery();
  }
}

document.addEventListener('DOMContentLoaded', init);
