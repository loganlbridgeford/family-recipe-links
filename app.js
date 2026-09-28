/* global APP_CONFIG, DB */
const C = APP_CONFIG;

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
  assignWeekStart: null,
  assignPlan: null,
  assignSaving: false,
  saveTimer: null,
  saving: false,
  planUpdatedAt: null,
  pendingSnapshot: null
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

function safeHttpUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch (_) {
    return '';
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function capturePlanSnapshot() {
  return {
    weekStart: state.weekStart,
    plan: cloneJson(state.plan),
    groceryChecked: cloneJson(state.groceryChecked),
    snackAdds: cloneJson(state.snackAdds),
    manualItems: cloneJson(state.manualItems),
    updatedAt: state.planUpdatedAt || null
  };
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

function isSnackAdd(id) {
  return state.snackAdds.some((sid) => String(sid) === String(id));
}

function toggleSnackAdd(id) {
  if (isSnackAdd(id)) {
    state.snackAdds = state.snackAdds.filter((sid) => String(sid) !== String(id));
  } else {
    state.snackAdds.push(id);
  }
  renderRecipeList();
  renderSnackList();
  renderGrocery();
  scheduleSave();
}

function normalizeSides(rawSides) {
  if (!Array.isArray(rawSides)) return [];
  const sides = [];
  rawSides.forEach((side) => {
    if (!side || typeof side !== 'object') return;
    if (side.type === 'recipe') {
      if (side.id == null || String(side.id) === '') return;
      sides.push({ type: 'recipe', id: side.id, recipe: getRecipe(side.id) });
      return;
    }
    if (side.type === 'custom') {
      const name = String(side.name || '').trim();
      if (name) sides.push({ type: 'custom', name });
    }
  });
  return sides;
}

function writeSides(sides) {
  if (!Array.isArray(sides)) return [];
  const out = [];
  sides.forEach((side) => {
    if (!side || typeof side !== 'object') return;
    if (side.type === 'recipe' && side.id != null && String(side.id) !== '') {
      out.push({ type: 'recipe', id: side.id });
      return;
    }
    if (side.type === 'custom') {
      const name = String(side.name || '').trim();
      if (name) out.push({ type: 'custom', name });
    }
  });
  return out;
}

function encodePlate(main, sides) {
  const written = writeSides(sides);
  if (!main) return null;
  if (main.type === 'recipe') {
    if (main.id == null || String(main.id) === '') {
      return written.length ? { type: 'recipe', id: main.id, sides: written } : null;
    }
    if (!written.length) return main.id;
    return { type: 'recipe', id: main.id, sides: written };
  }
  if (main.type === 'custom') {
    const name = String(main.name || '').trim();
    if (!name) return null;
    if (!written.length) return { type: 'custom', name };
    return { type: 'custom', name, sides: written };
  }
  return null;
}

function slotValue(plan, day, slot) {
  if (!plan || !plan[day]) return null;
  const raw = plan[day][slot];
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') {
    const sides = normalizeSides(raw.sides);
    if (raw.type === 'recipe') {
      return {
        type: 'recipe',
        id: raw.id,
        recipe: raw.id != null ? getRecipe(raw.id) : null,
        sides
      };
    }
    if (raw.type === 'custom') {
      const name = String(raw.name || '').trim();
      return name ? { type: 'custom', name, sides } : null;
    }
    return null;
  }
  return { type: 'recipe', id: raw, recipe: getRecipe(raw), sides: [] };
}

function slotName(val) {
  if (!val) return '';
  if (val.type === 'custom') return val.name;
  return (val.recipe && val.recipe.name) || 'Meal';
}

function plateNames(val) {
  if (!val) return [];
  const names = [];
  const main = slotName(val);
  if (main) names.push(main);
  (val.sides || []).forEach((side) => {
    const name = slotName(side);
    if (name) names.push(name);
  });
  return names;
}

function plateLabel(val) {
  return plateNames(val).join(', ');
}

function pickerPart(value) {
  if (value && typeof value === 'object') {
    if (value.type === 'recipe' && value.id != null && String(value.id) !== '') {
      return { type: 'recipe', id: value.id };
    }
    if (value.type === 'custom') {
      const name = String(value.name || '').trim();
      return name ? { type: 'custom', name } : null;
    }
    return null;
  }
  if (value == null || value === '') return null;
  return { type: 'recipe', id: value };
}

function defaultAddedBy() {
  const sel = document.getElementById('addedBy');
  if (sel && sel.value) return sel.value;
  if (state.members[0] && state.members[0].display_name) return state.members[0].display_name;
  return 'Me';
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
  state.pendingSnapshot = capturePlanSnapshot();
  state.saveTimer = setTimeout(() => {
    const snap = state.pendingSnapshot;
    state.saveTimer = null;
    persistPlan(snap);
  }, 500);
}

async function persistPlan(snapshot) {
  if (!snapshot) return;
  state.saving = true;
  try {
    const saved = await DB.savePlan(
      snapshot.weekStart,
      {
        plan: snapshot.plan,
        grocery_checked: snapshot.groceryChecked,
        snack_adds: snapshot.snackAdds,
        manual_items: snapshot.manualItems
      },
      snapshot.updatedAt
    );
    if (saved && saved.updated_at && snapshot.weekStart === state.weekStart) {
      state.planUpdatedAt = saved.updated_at;
    }
    if (
      saved &&
      saved.updated_at &&
      state.pendingSnapshot &&
      state.pendingSnapshot.weekStart === snapshot.weekStart
    ) {
      state.pendingSnapshot.updatedAt = saved.updated_at;
    }
  } catch (err) {
    console.error(err);
    if (DB.isPlanConflict(err)) {
      showToast('This week was updated on another phone. Reloading.');
      if (snapshot.weekStart === state.weekStart) {
        try {
          await loadWeek();
        } catch (loadErr) {
          console.error(loadErr);
        }
      }
    } else {
      showToast('Could not save plan.');
    }
  } finally {
    state.saving = false;
  }
}

function applyPlanRow(row) {
  state.plan = (row && row.plan) || DB.emptyPlan();
  C.DAYS.forEach((d) => {
    if (!state.plan[d]) state.plan[d] = { breakfast: null, lunch: null, dinner: null };
  });
  state.groceryChecked = (row && row.grocery_checked) || {};
  state.snackAdds = (row && row.snack_adds) || [];
  state.manualItems = row && Array.isArray(row.manual_items) ? row.manual_items : [];
  state.planUpdatedAt = (row && row.updated_at) || null;
}

async function loadWeek() {
  const row = await DB.getPlan(state.weekStart);
  applyPlanRow(row);
  renderWeekLabel();
  renderCalendar();
  renderGrocery();
  renderRecipeList();
  renderSnackList();
}

let refetchTimer = null;

function scheduleWeekRefetch() {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(refetchOpenWeek, 1000);
}

async function refetchOpenWeek() {
  if (!C.HOUSEHOLD_ID) return;
  const gate = document.getElementById('familyGate');
  if (gate && gate.open) return;
  if (state.saveTimer || state.saving) return;
  try {
    const row = await DB.getPlan(state.weekStart);
    applyPlanRow(row);
    renderWeekLabel();
    renderCalendar();
    renderGrocery();
    renderRecipeList();
    renderSnackList();
  } catch (err) {
    console.error(err);
  }
}

function renderWeekLabel() {
  document.getElementById('weekLabel').textContent = formatWeekLabel(state.weekStart);
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setTab(name) {
  const apply = () => {
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
    const planHeader = document.getElementById('header-plan');
    const recipesHeader = document.getElementById('header-recipes');
    const groceryHeader = document.getElementById('header-grocery');
    if (planHeader) planHeader.hidden = name !== 'plan';
    if (recipesHeader) recipesHeader.hidden = name !== 'recipes';
    if (groceryHeader) groceryHeader.hidden = name !== 'grocery';
  };
  if (document.startViewTransition && !prefersReducedMotion()) {
    document.startViewTransition(apply);
  } else {
    apply();
  }
}

/* ---------- Calendar ---------- */

function todayDayKey() {
  const monday = parseDate(state.weekStart);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((now - monday) / 86400000);
  if (diff < 0 || diff > 6) return null;
  return C.DAYS[diff];
}

function mealCellSidesHtml(val) {
  return (val && val.sides ? val.sides : [])
    .map((side) => {
      const name = slotName(side);
      return name ? `<span class="meal-cell-side">${escapeHtml(name)}</span>` : '';
    })
    .join('');
}

function mealCellContent(val, slot) {
  const slotHtml = `<span class="meal-cell-slot">${escapeHtml(C.SLOT_LABELS[slot])}</span>`;
  if (val && val.type === 'custom') {
    return {
      className: 'meal-cell',
      rowClass: 'meal-row filled custom',
      html: `${slotHtml}<span class="meal-cell-body"><span class="meal-cell-name">${escapeHtml(val.name)}</span>${mealCellSidesHtml(val)}</span>`,
      hasGrip: true
    };
  }
  if (val && val.type === 'recipe') {
    const meal = val.recipe;
    const batch = meal && (meal.tags || []).includes('batch-cook');
    const meta = meal
      ? `<span class="meal-cell-meta">
          ${meal.prep_minutes ? `<span class="badge badge-time">${meal.prep_minutes} min</span>` : ''}
          ${batch ? '<span class="badge badge-batch">Batch</span>' : ''}
        </span>`
      : '';
    return {
      className: 'meal-cell',
      rowClass: 'meal-row filled',
      html: `${slotHtml}<span class="meal-cell-body"><span class="meal-cell-main"><span class="meal-cell-name">${escapeHtml(slotName(val))}</span>${meta}</span>${mealCellSidesHtml(val)}</span>`,
      hasGrip: true
    };
  }
  return {
    className: 'meal-cell',
    rowClass: 'meal-row',
    html: `${slotHtml}<span class="meal-cell-placeholder">Add</span>`,
    hasGrip: false
  };
}

function bindMealCell(cell, day, slot, val) {
  cell.addEventListener('click', () => {
    if (Date.now() < suppressClickUntil) return;
    if (val && val.type === 'recipe' && val.recipe) {
      openRecipeCard(val.recipe.id, { fromCalendar: true, day, slot });
    } else {
      openPicker(day, slot);
    }
  });
}

function renderTonight() {
  const el = document.getElementById('tonightStrip');
  if (!el) return;
  const day = todayDayKey();
  if (!day) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  const label = C.DAY_LABELS[C.DAYS.indexOf(day)];
  el.innerHTML = `<h2>Tonight · ${label}</h2>`;
  C.MEAL_SLOTS.forEach((slot) => {
    const val = slotValue(state.plan, day, slot);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tonight-row';
    const name = val ? slotName(val) : 'Add';
    const sideNames = val ? (val.sides || []).map(slotName).filter(Boolean) : [];
    const sideLine = sideNames.length
      ? `<span class="tonight-sides">${escapeHtml(sideNames.join(', '))}</span>`
      : '';
    row.innerHTML = `<span class="tonight-slot">${escapeHtml(C.SLOT_LABELS[slot])}</span><span class="tonight-body"><span class="tonight-name${val ? '' : ' empty'}">${escapeHtml(name)}</span>${sideLine}</span>`;
    row.addEventListener('click', () => {
      if (val && val.type === 'recipe' && val.recipe) {
        openRecipeCard(val.recipe.id, { fromCalendar: true, day, slot });
      } else {
        openPicker(day, slot);
      }
    });
    el.appendChild(row);
  });
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  const todayKey = todayDayKey();
  C.DAYS.forEach((day, i) => {
    const block = document.createElement('section');
    block.className = 'day-block';
    const date = getDayDate(state.weekStart, i);
    const header = document.createElement('div');
    header.className = 'day-block-header' + (day === todayKey ? ' today' : '');
    header.innerHTML = `<span>${C.DAY_LABELS[i]}</span><span class="date-num">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`;
    block.appendChild(header);
    C.MEAL_SLOTS.forEach((slot) => {
      const val = slotValue(state.plan, day, slot);
      const painted = mealCellContent(val, slot);
      const row = document.createElement('div');
      row.className = painted.rowClass;
      row.dataset.day = day;
      row.dataset.slot = slot;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = painted.className;
      cell.dataset.day = day;
      cell.dataset.slot = slot;
      cell.innerHTML = painted.html;
      bindMealCell(cell, day, slot, val);
      row.appendChild(cell);
      if (painted.hasGrip) {
        const grip = document.createElement('button');
        grip.type = 'button';
        grip.className = 'meal-grip';
        grip.setAttribute('aria-label', 'Hold one second, then drag to move');
        grip.innerHTML = '<i></i><i></i><i></i>';
        grip.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        row.appendChild(grip);
      }
      block.appendChild(row);
    });
    grid.appendChild(block);
  });
  renderTonight();
}

function openPicker(day, slot, opts = {}) {
  const asSide = !!opts.asSide;
  state.pickerContext = { day, slot, asSide };
  state.pickerCategory = 'All';
  const dayLabel = C.DAY_LABELS[C.DAYS.indexOf(day)];
  document.getElementById('pickerTitle').textContent = asSide
    ? `Add a side — ${C.SLOT_LABELS[slot]} · ${dayLabel}`
    : `Choose ${C.SLOT_LABELS[slot]} — ${dayLabel}`;
  document.getElementById('pickerSearch').value = '';
  const current = slotValue(state.plan, day, slot);
  const nameInput = document.getElementById('customMealName');
  nameInput.value = !asSide && current && current.type === 'custom' ? current.name : '';
  nameInput.placeholder = asSide ? 'e.g. Rice' : 'e.g. Leftovers';
  const nameLabel = document.querySelector('label[for="customMealName"]');
  if (nameLabel) nameLabel.textContent = asSide ? 'Or type a side name' : 'Or type a meal name';
  document.getElementById('customSaveRecipe').checked = false;
  document.getElementById('customMealAddBtn').textContent = asSide ? 'Add side' : 'Add to Calendar';
  const clearBtn = document.getElementById('clearSlotBtn');
  clearBtn.classList.toggle('hidden', asSide);
  clearBtn.textContent = 'Clear this slot';
  const plateEl = document.getElementById('pickerPlate');
  if (plateEl) {
    if (!asSide && current) renderSidesEditor(plateEl, day, slot);
    else {
      plateEl.hidden = true;
      plateEl.innerHTML = '';
    }
  }
  renderPickerCategoryChips();
  renderPickerList();
  const modal = document.getElementById('pickerModal');
  if (!modal.open) modal.showModal();
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
    const tagText = (meal.tags || []).slice(0, 3).map((t) => C.TAG_LABELS[t] || t).join(' · ');
    li.innerHTML = `
      <h4>${escapeHtml(meal.name)}</h4>
      <div class="meta">${meal.prep_minutes || '—'} min · ${escapeHtml(tagText)}</div>
      ${note}
      <div class="actions">
        <button type="button" class="btn btn-secondary btn-sm view-recipe">View</button>
        <button type="button" class="btn btn-primary btn-sm assign-meal">${state.pickerContext && state.pickerContext.asSide ? 'Add side' : 'Add to calendar'}</button>
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
    showToast(state.pickerContext.asSide ? 'Type a side name first.' : 'Type a meal name first.');
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
  const { day, slot, asSide } = state.pickerContext;
  const part = pickerPart(value);
  if (!part) return;
  const current = slotValue(state.plan, day, slot);
  if (asSide) {
    if (!current) return;
    state.plan[day][slot] = encodePlate(current, (current.sides || []).concat([part]));
    document.getElementById('pickerModal').close();
    renderCalendar();
    renderGrocery();
    scheduleSave();
    showToast('Side added.');
    return;
  }
  state.plan[day][slot] = encodePlate(part, current && current.sides ? current.sides : []);
  document.getElementById('pickerModal').close();
  renderCalendar();
  renderGrocery();
  scheduleSave();
  showToast('Meal added to the week.');
}

function clearSlot() {
  if (!state.pickerContext) return;
  if (state.pickerContext.asSide) {
    document.getElementById('pickerModal').close();
    return;
  }
  const { day, slot } = state.pickerContext;
  state.plan[day][slot] = null;
  document.getElementById('pickerModal').close();
  renderCalendar();
  renderGrocery();
  scheduleSave();
}

function removePlateSide(day, slot, index) {
  const val = slotValue(state.plan, day, slot);
  if (!val) return;
  const sides = (val.sides || []).slice();
  if (index < 0 || index >= sides.length) return;
  sides.splice(index, 1);
  state.plan[day][slot] = encodePlate(val, sides);
  renderCalendar();
  renderGrocery();
  scheduleSave();
}

function startAddSide(day, slot) {
  const recipeModal = document.getElementById('recipeModal');
  if (recipeModal && recipeModal.open) recipeModal.close();
  openPicker(day, slot, { asSide: true });
}

function renderSidesEditor(container, day, slot) {
  if (!container) return;
  const val = slotValue(state.plan, day, slot);
  if (!val) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = 'Sides';
  container.appendChild(heading);
  const list = document.createElement('div');
  list.className = 'plate-side-list';
  (val.sides || []).forEach((side, index) => {
    const row = document.createElement('div');
    row.className = 'plate-side-row';
    const name = document.createElement('span');
    name.className = 'plate-side-name';
    name.textContent = slotName(side);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-ghost btn-sm';
    rm.textContent = 'Remove';
    rm.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removePlateSide(day, slot, index);
      renderSidesEditor(container, day, slot);
    });
    row.appendChild(name);
    row.appendChild(rm);
    list.appendChild(row);
  });
  container.appendChild(list);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-secondary btn-block';
  add.textContent = 'Add a side';
  add.addEventListener('click', (e) => {
    e.preventDefault();
    startAddSide(day, slot);
  });
  container.appendChild(add);
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
  return el && el.closest ? el.closest('#calendarGrid .meal-row') : null;
}

function endDrag() {
  if (drag && drag.timer) clearTimeout(drag.timer);
  if (drag && drag.ghost) drag.ghost.remove();
  document.querySelectorAll('.meal-row.drag-source, .meal-row.drag-over, .meal-row.drag-armed, .meal-row.drag-holding').forEach((el) => {
    el.classList.remove('drag-source', 'drag-over', 'drag-armed', 'drag-holding');
  });
  document.body.classList.remove('is-meal-dragging');
  if (drag && (drag.mode === 'active' || drag.mode === 'armed')) suppressClickUntil = Date.now() + 400;
  drag = null;
}

function beginMealDrag() {
  if (!drag || drag.mode === 'active') return;
  drag.mode = 'active';
  drag.row.classList.add('drag-source');
  drag.row.classList.remove('drag-armed', 'drag-holding');
  document.body.classList.add('is-meal-dragging');
  const ghost = document.createElement('div');
  ghost.className = 'meal-drag-ghost';
  ghost.textContent = plateLabel(slotValue(state.plan, drag.day, drag.slot));
  document.body.appendChild(ghost);
  ghost.style.left = `${drag.x}px`;
  ghost.style.top = `${drag.y}px`;
  drag.ghost = ghost;
}

function onGridPointerDown(e) {
  if (e.button != null && e.button !== 0) return;
  const grip = e.target.closest('.meal-grip');
  if (!grip) return;
  const row = grip.closest('.meal-row');
  if (!row) return;
  const { day, slot } = row.dataset;
  const val = slotValue(state.plan, day, slot);
  if (!val) return;
  e.preventDefault();
  e.stopPropagation();
  drag = {
    mode: 'holding',
    day,
    slot,
    x: e.clientX,
    y: e.clientY,
    row,
    pointerId: e.pointerId,
    timer: null
  };
  row.classList.add('drag-holding');
  try {
    grip.setPointerCapture(e.pointerId);
  } catch (_) { /* ignore */ }
  drag.timer = setTimeout(() => {
    if (!drag || drag.mode !== 'holding') return;
    drag.mode = 'armed';
    drag.row.classList.add('drag-armed');
    drag.row.classList.remove('drag-holding');
    try {
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (_) { /* ignore */ }
  }, 1000);
}

function onGridPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (drag.mode === 'holding') {
    if (dx * dx + dy * dy > 144) endDrag();
    return;
  }
  if (drag.mode === 'armed') {
    if (dx * dx + dy * dy < 36) return;
    beginMealDrag();
  }
  if (drag.mode !== 'active') return;
  e.preventDefault();
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;
  document.querySelectorAll('.meal-row.drag-over').forEach((el) => el.classList.remove('drag-over'));
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
  grid.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.meal-grip, .meal-row')) e.preventDefault();
  });
  grid.addEventListener('selectstart', (e) => e.preventDefault());
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
      if (!val) return;
      if (val.type === 'recipe' && val.id != null) used.add(String(val.id));
      (val.sides || []).forEach((side) => {
        if (side && side.type === 'recipe' && side.id != null) used.add(String(side.id));
      });
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
  const recipeLink = safeHttpUrl(meal.url);
  document.getElementById('recipeMeta').innerHTML = `
    ${meal.prep_minutes ? `<span>${meal.prep_minutes} min</span>` : ''}
    ${meal.servings ? `<span>Serves ${meal.servings}</span>` : ''}
    ${meal.added_by ? `<span>Added by ${escapeHtml(meal.added_by)}</span>` : ''}
    ${tags ? `<span>${escapeHtml(tags)}</span>` : ''}
    ${recipeLink ? `<span><a href="${escapeHtml(recipeLink)}" target="_blank" rel="noopener noreferrer">Open link</a></span>` : ''}
  `;

  const photos = document.getElementById('recipePhotos');
  photos.innerHTML = '';
  const frontPhoto = safeHttpUrl(meal.photo_url);
  const backPhoto = safeHttpUrl(meal.photo_url_back);
  if (frontPhoto || backPhoto) {
    photos.className = 'thumb-row';
    photos.innerHTML = `
      ${frontPhoto ? `<a href="${escapeHtml(frontPhoto)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(frontPhoto)}" alt="Front"></a>` : ''}
      ${backPhoto ? `<a href="${escapeHtml(backPhoto)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(backPhoto)}" alt="Back"></a>` : ''}`;
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

  const plateEl = document.getElementById('recipePlate');
  if (context.fromCalendar && context.day && context.slot) {
    renderSidesEditor(plateEl, context.day, context.slot);
  } else if (plateEl) {
    plateEl.hidden = true;
    plateEl.innerHTML = '';
  }

  const actions = document.getElementById('recipeActions');
  actions.innerHTML = '';
  if (context.fromPicker && state.pickerContext) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = state.pickerContext.asSide ? 'Add as side' : 'Add to calendar';
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
  if (DB.canPlan(meal)) {
    const groceryBtn = document.createElement('button');
    groceryBtn.type = 'button';
    const syncGroceryBtn = () => {
      const on = isSnackAdd(meal.id);
      groceryBtn.className = 'btn ' + (on ? 'btn-ghost' : 'btn-primary');
      groceryBtn.textContent = on ? 'On this week’s list' : 'Add to grocery';
    };
    syncGroceryBtn();
    groceryBtn.addEventListener('click', () => {
      toggleSnackAdd(meal.id);
      syncGroceryBtn();
    });
    actions.appendChild(groceryBtn);
  }
  document.getElementById('recipeModal').showModal();
}

function openAssignModal(mealId) {
  state.pendingAssignId = mealId;
  state.assignWeekStart = state.weekStart;
  state.assignPlan = null;
  state.assignDay = todayDayKey() || C.DAYS[0];
  state.assignSlot = 'breakfast';
  const meal = getRecipe(mealId);
  if (meal && (meal.meal_types || []).length === 1 && C.MEAL_SLOTS.includes(meal.meal_types[0])) {
    state.assignSlot = meal.meal_types[0];
  }
  const btn = document.getElementById('confirmAssignBtn');
  if (btn) btn.disabled = false;
  document.getElementById('assignWeekLabel').textContent = formatWeekLabel(state.assignWeekStart);
  renderAssignWeek();
  renderAssignSlots();
  document.getElementById('assignModal').showModal();
}

async function changeAssignWeek(offsetDays) {
  const next = parseDate(state.assignWeekStart || state.weekStart);
  next.setDate(next.getDate() + offsetDays);
  state.assignWeekStart = getMondayISO(next);
  state.assignPlan = null;
  document.getElementById('assignWeekLabel').textContent = formatWeekLabel(state.assignWeekStart);
  renderAssignWeek();
  if (state.assignWeekStart === state.weekStart) return;
  const week = state.assignWeekStart;
  try {
    const row = await DB.getPlan(week);
    if (state.assignWeekStart !== week) return;
    const plan = (row && row.plan) || DB.emptyPlan();
    C.DAYS.forEach((day) => {
      if (!plan[day]) plan[day] = { breakfast: null, lunch: null, dinner: null };
    });
    state.assignPlan = plan;
    renderAssignWeek();
  } catch (err) {
    if (state.assignWeekStart !== week) return;
    console.error(err);
    showToast('Could not load that week’s plan.');
  }
}

function renderAssignWeek() {
  const wrap = document.getElementById('assignWeek');
  wrap.innerHTML = '';
  const weekStart = state.assignWeekStart || state.weekStart;
  const plan = weekStart === state.weekStart ? state.plan : state.assignPlan;
  C.DAYS.forEach((day, i) => {
    const date = getDayDate(weekStart, i);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assign-day' + (state.assignDay === day ? ' active' : '');
    if (plan && slotValue(plan, day, state.assignSlot)) btn.classList.add('has-meal');
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

async function confirmAssign() {
  if (state.assignSaving) return;
  if (!state.pendingAssignId || !state.assignDay || !state.assignSlot) return;
  const day = state.assignDay;
  const slot = state.assignSlot;
  const recipeId = state.pendingAssignId;
  const targetWeek = state.assignWeekStart || state.weekStart;
  const dayIndex = C.DAYS.indexOf(day);
  const dayLabel = C.DAY_LABELS[dayIndex];
  const dateLabel = getDayDate(targetWeek, dayIndex).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
  const btn = document.getElementById('confirmAssignBtn');
  state.assignSaving = true;
  if (btn) btn.disabled = true;
  try {
    const sameWeek = targetWeek === state.weekStart;
    let plan;
    let otherRow = null;
    if (sameWeek) {
      plan = state.plan || DB.emptyPlan();
    } else {
      otherRow = await DB.getPlan(targetWeek);
      plan = (otherRow && otherRow.plan) || DB.emptyPlan();
    }
    C.DAYS.forEach((d) => {
      if (!plan[d]) plan[d] = { breakfast: null, lunch: null, dinner: null };
    });
    const existing = slotValue(plan, day, slot);
    if (existing) {
      const name =
        existing.type === 'custom'
          ? String(existing.name || '').trim()
          : String((existing.recipe && existing.recipe.name) || '').trim();
      const msg = name
        ? `Replace ${name} on ${dayLabel} ${slot}?`
        : `Replace on ${dayLabel} ${slot}?`;
      if (!confirm(msg)) return;
    }
    plan[day][slot] = encodePlate(
      { type: 'recipe', id: recipeId },
      existing && existing.sides ? existing.sides : []
    );
    if (sameWeek) {
      state.plan = plan;
      scheduleSave();
      renderCalendar();
      renderGrocery();
    } else {
      try {
        await DB.savePlan(targetWeek, { plan }, otherRow && otherRow.updated_at);
      } catch (err) {
        if (DB.isPlanConflict(err)) {
          showToast('That week was updated on another phone. Try again.');
          return;
        }
        throw err;
      }
    }
    state.pendingAssignId = null;
    document.getElementById('assignModal').close();
    document.getElementById('recipeModal').close();
    showToast(`Assigned to ${dayLabel} ${slot}, ${dateLabel}`);
  } catch (err) {
    console.error(err);
    showToast('Could not assign meal.');
  } finally {
    state.assignSaving = false;
    if (btn) btn.disabled = false;
  }
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

function openRecipeFormSheet() {
  document.getElementById('recipeFormModal').showModal();
}

function closeRecipeFormSheet() {
  const modal = document.getElementById('recipeFormModal');
  if (modal.open) modal.close();
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
  openRecipeFormSheet();
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
    closeRecipeFormSheet();
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
    await DB.removeRecipeFromAllPlans(id);
    await DB.deleteRecipe(id);
    const row = await DB.getPlan(state.weekStart);
    if (row && row.updated_at) state.planUpdatedAt = row.updated_at;
    state.recipes = state.recipes.filter((r) => String(r.id) !== String(id));
    C.DAYS.forEach((d) => {
      C.MEAL_SLOTS.forEach((s) => {
        const val = slotValue(state.plan, d, s);
        if (!val) return;
        if (val.type === 'recipe' && String(val.id) === String(id)) {
          state.plan[d][s] = null;
          return;
        }
        const sides = (val.sides || []).filter((side) => !(side.type === 'recipe' && String(side.id) === String(id)));
        if (sides.length !== (val.sides || []).length) state.plan[d][s] = encodePlate(val, sides);
      });
    });
    state.snackAdds = state.snackAdds.filter((sid) => String(sid) !== String(id));
    renderRecipeList();
    renderSnackList();
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
  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><p>No recipes found.</p></div>';
    return;
  }
  const hasPhotos = list.some((r) => r.photo_url);
  container.className = 'recipe-grid' + (hasPhotos ? ' has-photos' : '');
  container.innerHTML = '';
  list.forEach((recipe) => {
    const ready = DB.canPlan(recipe);
    const onList = isSnackAdd(recipe.id);
    const card = document.createElement('div');
    const photo = safeHttpUrl(recipe.photo_url);
    card.className = 'recipe-card' + (photo ? ' has-photo' : '');
    const title = escapeHtml(recipe.name);
    card.innerHTML = `
      <button class="delete-btn" title="Delete">×</button>
      ${photo ? `<img class="recipe-photo" src="${escapeHtml(photo)}" alt="">` : ''}
      <div class="recipe-card-body">
        <div class="recipe-category">${escapeHtml(recipe.category || 'Other')}</div>
        <h3>${title}</h3>
        <div class="recipe-meta">
          ${escapeHtml(recipe.added_by || '')}${recipe.prep_minutes ? ` · ${recipe.prep_minutes} min` : ''}
        </div>
        ${ready ? '' : '<div><span class="badge badge-needs">No grocery items</span></div>'}
        <div class="recipe-card-actions">
          <button type="button" class="btn btn-secondary btn-sm view-btn">View</button>
          <button type="button" class="btn btn-ghost btn-sm edit-btn">Edit</button>
          <button type="button" class="btn btn-primary btn-sm assign-btn">Assign</button>
          ${ready ? `<button type="button" class="btn ${onList ? 'btn-ghost' : 'btn-primary'} btn-sm grocery-toggle-btn">${onList ? 'On this week’s list' : 'Add to grocery'}</button>` : ''}
        </div>
      </div>`;
    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteRecipe(recipe.id);
    });
    card.querySelector('.view-btn').addEventListener('click', () => openRecipeCard(recipe.id, { fromLibrary: true }));
    card.querySelector('.edit-btn').addEventListener('click', () => openEditForm(recipe));
    card.querySelector('.assign-btn').addEventListener('click', () => openAssignModal(recipe.id));
    const groceryBtn = card.querySelector('.grocery-toggle-btn');
    if (groceryBtn) groceryBtn.addEventListener('click', () => toggleSnackAdd(recipe.id));
    container.appendChild(card);
  });
}

/* ---------- Grocery ---------- */

const GROCERY_PREP_WORDS = new Set([
  'minced', 'chopped', 'diced', 'sliced', 'grated', 'crushed', 'peeled', 'seeded',
  'softened', 'melted', 'divided', 'optional', 'finely', 'roughly', 'fresh',
  'large', 'small', 'medium', 'whole', 'thinly', 'coarsely', 'plus', 'more',
  'taste', 'to', 'clove', 'cloves', 'packed', 'thawed', 'drained', 'rinsed',
  'room', 'temperature', 'and', 'or', 'of', 'for', 'the', 'unbleached', 'bleached'
]);

const GROCERY_ALIASES = {
  'all purpose flour': 'flour',
  'all flour purpose': 'flour',
  'ap flour': 'flour',
  'flour ap': 'flour',
  'plain flour': 'flour',
  'flour plain': 'flour',
  'yellow onion': 'onion',
  'onion yellow': 'onion',
  'white onion': 'onion',
  'onion white': 'onion',
  onions: 'onion',
  'kosher salt': 'salt',
  'salt kosher': 'salt',
  'sea salt': 'salt',
  'salt sea': 'salt',
  'chicken breast': 'chicken breast',
  'chicken breasts': 'chicken breast',
  'breast chicken': 'chicken breast',
  'breasts chicken': 'chicken breast',
  'unsalted butter': 'butter',
  'butter unsalted': 'butter',
  'olive oil': 'olive oil',
  'oil olive': 'olive oil',
  'extra virgin olive oil': 'olive oil',
  'extra oil olive virgin': 'olive oil',
  'ground beef': 'ground beef',
  'beef ground': 'ground beef',
  'beef mince': 'ground beef',
  'mince beef': 'ground beef'
};

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
  const natural = words.join(' ');
  const sorted = [...words].sort().join(' ');
  return GROCERY_ALIASES[natural] || GROCERY_ALIASES[sorted] || sorted;
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

function addGroceryItem(items, ing) {
  const itemName = (ing.item || '').trim();
  if (!itemName) return '';
  const key = groceryItemKey(itemName);
  if (!key) return '';
  if (!items[key]) {
    items[key] = {
      key,
      item: itemName,
      originals: [itemName],
      qtys: ing.qty ? [ing.qty] : [],
      section: ing.section || 'other',
      recipeNames: []
    };
    return key;
  }
  const row = items[key];
  if (!row.originals.includes(itemName)) row.originals.push(itemName);
  if (ing.qty) row.qtys.push(ing.qty);
  if ((!row.section || row.section === 'other') && ing.section && ing.section !== 'other') {
    row.section = ing.section;
  }
  return key;
}

function addRecipeGrocery(items, recipe) {
  if (!recipe) return;
  const source = (recipe.name || '').trim();
  const seen = new Set();
  (recipe.ingredients || []).forEach((ing) => {
    const key = addGroceryItem(items, ing);
    if (key) seen.add(key);
  });
  if (!source) return;
  seen.forEach((key) => items[key].recipeNames.push(source));
}

function countedRecipeNames(names) {
  const counts = {};
  (names || []).forEach((n) => {
    const name = String(n || '').trim();
    if (name) counts[name] = (counts[name] || 0) + 1;
  });
  return Object.keys(counts)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => (counts[name] > 1 ? `${name} ×${counts[name]}` : name));
}

function groceryItemParts(entry) {
  const recipes = countedRecipeNames(entry.recipeNames || (entry.recipeName ? [entry.recipeName] : []));
  const item = prettyGroceryName(entry.key || groceryItemKey(entry.item), entry.originals || [entry.item]);
  const qty = formatQtys(entry.qtys);
  return {
    name: qty ? `${item} — ${qty}` : item,
    sub: recipes
  };
}

function groceryItemLabel(entry) {
  const parts = groceryItemParts(entry);
  return parts.sub.length ? `${parts.name} (${parts.sub.join(', ')})` : parts.name;
}

function hiddenGroceryKeys() {
  const hidden = state.groceryChecked && state.groceryChecked.__hidden;
  return Array.isArray(hidden) ? hidden : [];
}

function hideGroceryKey(key) {
  const hidden = hiddenGroceryKeys();
  if (!hidden.includes(key)) hidden.push(key);
  state.groceryChecked.__hidden = hidden;
}

function getGroceryItems() {
  const items = {};
  C.DAYS.forEach((day) => {
    C.MEAL_SLOTS.forEach((slot) => {
      const val = slotValue(state.plan, day, slot);
      if (!val) return;
      if (val.type === 'recipe' && val.recipe && DB.canPlan(val.recipe)) addRecipeGrocery(items, val.recipe);
      (val.sides || []).forEach((side) => {
        if (side && side.type === 'recipe' && side.recipe && DB.canPlan(side.recipe)) {
          addRecipeGrocery(items, side.recipe);
        }
      });
    });
  });
  state.snackAdds.forEach((id) => {
    const meal = getRecipe(id);
    if (meal && DB.canPlan(meal)) addRecipeGrocery(items, meal);
  });
  hiddenGroceryKeys().forEach((key) => {
    delete items[key];
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

const SWIPE_DELETE_WIDTH = 88;
let grocerySwipe = null;
let suppressGroceryClickUntil = 0;

function swipeTranslate(front) {
  const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(front.style.transform || '');
  return m ? Number(m[1]) : 0;
}

function closeOpenGrocerySwipe() {
  if (!grocerySwipe || !grocerySwipe.opened) return;
  const front = grocerySwipe.opened.querySelector('.swipe-front');
  if (front) {
    front.style.transition = 'transform 0.2s ease';
    front.style.transform = 'translateX(0)';
  }
  grocerySwipe.opened = null;
}

function initGrocerySwipe() {
  const list = document.getElementById('groceryList');
  if (!list || list.dataset.swipeReady) return;
  list.dataset.swipeReady = '1';
  grocerySwipe = { tracking: false, opened: null };

  list.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.swipe-delete')) return;
    const wrap = e.target.closest('.swipe-row');
    const front = wrap && wrap.querySelector('.swipe-front');
    if (!wrap || !front) return;
    if (grocerySwipe.opened && grocerySwipe.opened !== wrap) closeOpenGrocerySwipe();
    grocerySwipe.tracking = true;
    grocerySwipe.wrap = wrap;
    grocerySwipe.front = front;
    grocerySwipe.startX = e.clientX;
    grocerySwipe.startY = e.clientY;
    grocerySwipe.startTx = swipeTranslate(front);
    grocerySwipe.rowWidth = wrap.offsetWidth;
    grocerySwipe.axis = null;
    grocerySwipe.dx = grocerySwipe.startTx;
    front.style.transition = 'none';
  });

  window.addEventListener('pointermove', (e) => {
    if (!grocerySwipe || !grocerySwipe.tracking) return;
    const mx = e.clientX - grocerySwipe.startX;
    const my = e.clientY - grocerySwipe.startY;
    if (!grocerySwipe.axis) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      grocerySwipe.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (grocerySwipe.axis === 'y') {
        grocerySwipe.tracking = false;
        return;
      }
      try {
        grocerySwipe.front.setPointerCapture(e.pointerId);
      } catch (_) { /* ignore */ }
      grocerySwipe.front.style.touchAction = 'none';
    }
    if (grocerySwipe.axis !== 'x') return;
    e.preventDefault();
    const width = grocerySwipe.rowWidth || grocerySwipe.wrap.offsetWidth || 0;
    grocerySwipe.dx = Math.min(0, Math.max(-width, grocerySwipe.startTx + mx));
    grocerySwipe.front.style.transform = `translateX(${grocerySwipe.dx}px)`;
  }, { passive: false });

  function endGrocerySwipe() {
    if (!grocerySwipe || !grocerySwipe.tracking) return;
    const { front, wrap, axis, dx } = grocerySwipe;
    grocerySwipe.tracking = false;
    if (front) front.style.touchAction = 'pan-y';
    if (axis !== 'x' || !front || !wrap) {
      grocerySwipe.front = null;
      grocerySwipe.wrap = null;
      grocerySwipe.axis = null;
      return;
    }
    const width = grocerySwipe.rowWidth || wrap.offsetWidth || front.offsetWidth || 0;
    const deleteAt = Math.max(width * 0.45, 120);
    if (dx <= -deleteAt) {
      const del = wrap.querySelector('.swipe-delete');
      grocerySwipe.front = null;
      grocerySwipe.wrap = null;
      grocerySwipe.opened = null;
      grocerySwipe.axis = null;
      // Click before suppress so the capture-phase list handler does not swallow Delete.
      if (del) del.click();
      suppressGroceryClickUntil = Date.now() + 350;
      return;
    }
    suppressGroceryClickUntil = Date.now() + 350;
    if (dx < -SWIPE_DELETE_WIDTH * 0.45) {
      front.style.transition = 'transform 0.2s ease';
      front.style.transform = `translateX(${-SWIPE_DELETE_WIDTH}px)`;
      grocerySwipe.opened = wrap;
    } else {
      front.style.transition = 'transform 0.2s ease';
      front.style.transform = 'translateX(0)';
      if (grocerySwipe.opened === wrap) grocerySwipe.opened = null;
    }
    grocerySwipe.front = null;
    grocerySwipe.wrap = null;
    grocerySwipe.axis = null;
  }

  window.addEventListener('pointerup', endGrocerySwipe);
  window.addEventListener('pointercancel', endGrocerySwipe);

  list.addEventListener('click', (e) => {
    if (Date.now() < suppressGroceryClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!grocerySwipe || !grocerySwipe.opened) return;
    if (e.target.closest('.swipe-delete')) return;
    e.preventDefault();
    e.stopPropagation();
    closeOpenGrocerySwipe();
  }, true);
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
  if (grocerySwipe) grocerySwipe.opened = null;
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
    if (key === '__hidden') return;
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
    sectionItems.forEach((entry) => {
      const wrap = document.createElement('div');
      wrap.className = 'swipe-row';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'swipe-delete';
      del.textContent = 'Delete';
      const row = document.createElement('div');
      row.className = 'swipe-front grocery-item';
      if (entry.kind === 'manual') {
        const checked = !!entry.checked;
        if (checked) row.classList.add('checked');
        const id = 'm-' + String(entry.id).replace(/\W/g, '-');
        row.innerHTML = `
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
          <label for="${id}">
            <span class="grocery-name">${escapeHtml(entry.item)}${entry.qty ? ' — ' + escapeHtml(entry.qty) : ''}</span>
            <span class="grocery-sub">Added</span>
          </label>`;
        row.querySelector('input').addEventListener('change', (e) => {
          const found = state.manualItems.find((m) => m.id === entry.id);
          if (found) found.checked = e.target.checked;
          row.classList.toggle('checked', e.target.checked);
          scheduleSave();
        });
        del.addEventListener('click', () => {
          state.manualItems = state.manualItems.filter((m) => m.id !== entry.id);
          renderGrocery();
          scheduleSave();
        });
      } else {
        const checked = !!state.groceryChecked[entry.key];
        if (checked) row.classList.add('checked');
        const id = 'g-' + entry.key.replace(/\W/g, '-');
        const parts = groceryItemParts(entry);
        row.innerHTML = `
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
          <label for="${id}">
            <span class="grocery-name">${escapeHtml(parts.name)}</span>
            ${parts.sub.map((line) => `<span class="grocery-sub">${escapeHtml(line)}</span>`).join('')}
          </label>`;
        row.querySelector('input').addEventListener('change', (e) => {
          state.groceryChecked[entry.key] = e.target.checked;
          row.classList.toggle('checked', e.target.checked);
          scheduleSave();
        });
        del.addEventListener('click', () => {
          hideGroceryKey(entry.key);
          renderGrocery();
          scheduleSave();
        });
      }
      wrap.appendChild(del);
      wrap.appendChild(row);
      itemList.appendChild(wrap);
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

function icsDateStamp(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function icsUtcNow() {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

function downloadWeekIcs() {
  const stamp = icsUtcNow();
  const events = [];
  C.DAYS.forEach((day, index) => {
    C.MEAL_SLOTS.forEach((slot) => {
      const val = slotValue(state.plan, day, slot);
      if (!val) return;
      const name = plateLabel(val);
      if (!name) return;
      const date = getDayDate(state.weekStart, index);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      const uid = `family-plan-${state.weekStart}-${day}-${slot}@family-planner`;
      const summary = `${C.SLOT_LABELS[slot]} — ${name}`;
      events.push(
        [
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${icsDateStamp(date)}`,
          `DTEND;VALUE=DATE:${icsDateStamp(end)}`,
          'TRANSP:TRANSPARENT',
          'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
          'X-MICROSOFT-CDO-BUSYSTATUS:FREE',
          `SUMMARY:${icsEscape(summary)}`,
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
  const searchEl = document.getElementById('snackSearch');
  const list = document.getElementById('snackList');
  if (!searchEl || !list) return;
  const q = searchEl.value.trim().toLowerCase();
  const recipes = state.recipes.filter((m) => {
    if (!DB.canPlan(m)) return false;
    if (q && !m.name.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
  list.innerHTML = '';
  if (!recipes.length) {
    list.innerHTML = q
      ? '<li class="meal-list-item">No matching recipes with ingredients.</li>'
      : '<li class="meal-list-item">No recipes with ingredients yet.</li>';
    return;
  }
  recipes.forEach((meal) => {
    const inGrocery = isSnackAdd(meal.id);
    const li = document.createElement('li');
    li.className = 'meal-list-item';
    li.innerHTML = `
      <h4>${escapeHtml(meal.name)}</h4>
      ${inGrocery ? '<div class="meta">List only</div>' : ''}
      <div class="meta">${escapeHtml((meal.ingredients || []).map((i) => i.item).join(', '))}</div>
      <div class="actions">
        <button type="button" class="btn ${inGrocery ? 'btn-ghost' : 'btn-primary'} btn-sm toggle-snack">
          ${inGrocery ? 'Remove from grocery' : 'Add to grocery list'}
        </button>
      </div>`;
    li.querySelector('.toggle-snack').addEventListener('click', () => toggleSnackAdd(meal.id));
    list.appendChild(li);
  });
}

/* ---------- Family / household ---------- */

function householdTitle() {
  return (C.HOUSEHOLD && C.HOUSEHOLD.name) || 'Family';
}

function renderHouseholdChrome() {
  document.querySelectorAll('[data-household-name]').forEach((el) => {
    el.textContent = householdTitle();
  });
  const hint = document.getElementById('planHouseholdHint');
  if (hint) hint.textContent = `${householdTitle()} — two phones, same week. Send the invite to your people, not the bare website.`;
}

function rememberFamilyInUrl(row) {
  const code = DB.familyCode(row);
  if (!code || !window.history || !window.history.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.set('family', code);
  window.history.replaceState({}, '', url);
}

function showGateError(msg) {
  const el = document.getElementById('gateError');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
}

function openFamilyGate() {
  const gate = document.getElementById('familyGate');
  if (!gate.open) gate.showModal();
}

function closeFamilyGate() {
  const gate = document.getElementById('familyGate');
  if (gate.open) gate.close();
}

async function enterHousehold(row) {
  if (!row) return;
  DB.setActiveHousehold(row);
  DB.persistHousehold(row);
  rememberFamilyInUrl(row);
  renderHouseholdChrome();
  closeFamilyGate();
  await loadAppData();
}

async function copyInviteLink() {
  const url = DB.familyUrl();
  if (!url || !url.includes('family=')) {
    showToast('Join a family first.');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Invite link copied.');
  } catch (err) {
    console.error(err);
    showToast(url);
  }
}

async function shareInviteLink() {
  const url = DB.familyUrl();
  if (!url || !url.includes('family=')) {
    showToast('Join a family first.');
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({
        title: householdTitle(),
        text: `Join ${householdTitle()} on Family Planner`,
        url
      });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  await copyInviteLink();
}

async function resolveHousehold() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('family');
  if (fromUrl) {
    try {
      const row = await DB.joinHousehold(fromUrl);
      if (row) {
        await enterHousehold(row);
        return true;
      }
      showGateError('That family code was not found.');
    } catch (err) {
      console.error(err);
      showGateError('Could not open that family.');
    }
    openFamilyGate();
    return false;
  }

  const stored = DB.readStoredHousehold();
  if (stored && stored.id) {
    try {
      if (stored.code) DB.setFamilyAccess(stored.code);
      const row = await DB.getHousehold(stored.id);
      if (row) {
        await enterHousehold(row);
        return true;
      }
    } catch (err) {
      console.error(err);
    }
  }

  openFamilyGate();
  return false;
}

async function handleGateJoin() {
  const btn = document.getElementById('gateJoinBtn');
  const raw = document.getElementById('gateCode').value;
  showGateError('');
  btn.disabled = true;
  try {
    const row = await DB.joinHousehold(raw);
    if (!row) {
      showGateError('That family code was not found.');
      return;
    }
    await enterHousehold(row);
  } catch (err) {
    console.error(err);
    showGateError('Could not join that family.');
  } finally {
    btn.disabled = false;
  }
}

async function handleGateCreate() {
  const btn = document.getElementById('gateCreateBtn');
  const name = document.getElementById('gateFamilyName').value.trim();
  const who = document.getElementById('gateYourName').value.trim();
  showGateError('');
  if (!name) {
    showGateError('Name your family.');
    return;
  }
  if (!who) {
    showGateError('Add your name so recipes can say who added them.');
    return;
  }
  btn.disabled = true;
  try {
    const row = await DB.createHousehold(name, who);
    await enterHousehold(row);
    showToast('Kitchen created. Send the invite to your people.');
    shareInviteLink();
  } catch (err) {
    console.error(err);
    showGateError('Could not start that family. Try again.');
  } finally {
    btn.disabled = false;
  }
}

async function loadAppData() {
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
    state.members = members && members.length ? members : [{ display_name: 'Me', sort_order: 1 }];
  } catch (err) {
    console.error(err);
    state.members = [{ display_name: 'Me', sort_order: 1 }];
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
  document.getElementById('planMenuBtn').addEventListener('click', () => {
    renderHouseholdChrome();
    document.getElementById('planMenuModal').showModal();
  });
  document.getElementById('copyInviteBtn').addEventListener('click', async () => {
    await copyInviteLink();
  });
  document.getElementById('shareInviteBtn').addEventListener('click', async () => {
    document.getElementById('planMenuModal').close();
    await shareInviteLink();
  });
  document.getElementById('familyGate').addEventListener('cancel', (e) => e.preventDefault());
  document.getElementById('gateJoinBtn').addEventListener('click', handleGateJoin);
  document.getElementById('gateCreateBtn').addEventListener('click', handleGateCreate);
  document.getElementById('gateCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleGateJoin();
    }
  });
  document.getElementById('gateYourName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleGateCreate();
    }
  });
  document.getElementById('generateBtn').addEventListener('click', () => {
    document.getElementById('planMenuModal').close();
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
    document.getElementById('planMenuModal').close();
    if (!confirm('Clear all meals for this week?')) return;
    const clearExtras = confirm('Also clear extra grocery items?');
    state.plan = DB.emptyPlan();
    state.snackAdds = [];
    state.groceryChecked = {};
    if (clearExtras) state.manualItems = [];
    renderCalendar();
    renderGrocery();
    renderRecipeList();
    renderSnackList();
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
  initGrocerySwipe();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleWeekRefetch();
  });
  window.addEventListener('focus', scheduleWeekRefetch);
  document.getElementById('copyGroceryBtn').addEventListener('click', copyGroceryList);
  document.getElementById('shareGroceryBtn').addEventListener('click', shareGroceryList);
  document.getElementById('calendarWeekBtn').addEventListener('click', () => {
    document.getElementById('planMenuModal').close();
    downloadWeekIcs();
  });
  document.getElementById('addRecipeOpenBtn').addEventListener('click', () => {
    resetRecipeForm();
    openRecipeFormSheet();
  });
  document.getElementById('closeRecipeFormBtn').addEventListener('click', closeRecipeFormSheet);
  document.getElementById('snacksBtn').addEventListener('click', () => {
    document.getElementById('snackSearch').value = '';
    renderSnackList();
    document.getElementById('snacksModal').showModal();
  });
  document.getElementById('snackSearch').addEventListener('input', renderSnackList);
  document.getElementById('assignPrevWeek').addEventListener('click', () => changeAssignWeek(-7));
  document.getElementById('assignNextWeek').addEventListener('click', () => changeAssignWeek(7));
  document.getElementById('confirmAssignBtn').addEventListener('click', confirmAssign);
  document.getElementById('recipeForm').addEventListener('submit', handleSaveRecipe);
  document.getElementById('importRecipeBtn').addEventListener('click', pullIngredientsFromLink);
  document.getElementById('usePastedListBtn').addEventListener('click', usePastedList);
  document.getElementById('addIngredientBtn').addEventListener('click', () => addIngredientRow());
  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    resetRecipeForm();
    closeRecipeFormSheet();
  });
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

  await resolveHousehold();
}

document.addEventListener('DOMContentLoaded', init);
