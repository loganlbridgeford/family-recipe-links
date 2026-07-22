// Bridgeford Family Recipe Links
// Connected to Google Sheet

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzlSno8NMMR15vC-j7XdbURig48FgVgh_uhIf0W6h1QFkDcEVFpxUbSi5jlcIZWZ7_gFg/exec";

let allRecipes = [];
let currentCategory = "All";
let currentSearch = "";

async function getRecipes() {
  try {
    const response = await fetch(SCRIPT_URL);
    if (!response.ok) throw new Error("Failed to load");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function addRecipe(recipe) {
  try {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(recipe)
    });
    return await response.json();
  } catch (err) {
    console.error(err);
    return { success: false };
  }
}

async function deleteRecipe(id) {
  try {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "delete", id })
    });
    return await response.json();
  } catch (err) {
    console.error(err);
    return { success: false };
  }
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function getFilteredRecipes() {
  let list = [...allRecipes];

  // Category filter
  if (currentCategory !== "All") {
    list = list.filter(r => (r.category || "Other") === currentCategory);
  }

  // Search filter
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(r =>
      (r.name || "").toLowerCase().includes(q) ||
      (r.url || "").toLowerCase().includes(q) ||
      (r.addedBy || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
    );
  }

  // Alphabetical by name
  list.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));

  return list;
}

function renderRecipes() {
  const container = document.getElementById("recipesContainer");
  const countEl = document.getElementById("recipeCount");
  const recipes = getFilteredRecipes();

  countEl.textContent = recipes.length > 0 ? `(${recipes.length})` : "";

  if (recipes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No recipes found.</p>
        <p>Try a different filter or add a new one!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = recipes.map(recipe => `
    <div class="recipe-card">
      <button class="delete-btn" data-id="${escapeHtml(recipe.id)}" title="Delete recipe">×</button>
      <div class="recipe-category">${escapeHtml(recipe.category || "Other")}</div>
      <h3>
        <a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener">
          ${escapeHtml(recipe.name)}
        </a>
      </h3>
      <div class="recipe-meta">
        Added by <strong>${escapeHtml(recipe.addedBy)}</strong> · ${formatDate(recipe.dateAdded)}
      </div>
      ${recipe.notes ? `<div class="recipe-notes">${escapeHtml(recipe.notes)}</div>` : ""}
    </div>
  `).join("");

  // Attach delete handlers
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!confirm("Delete this recipe?")) return;

      btn.disabled = true;
      const result = await deleteRecipe(id);
      if (result.success) {
        allRecipes = allRecipes.filter(r => r.id !== id);
        renderRecipes();
      } else {
        alert("Could not delete recipe.");
        btn.disabled = false;
      }
    });
  });
}

async function loadRecipes() {
  const container = document.getElementById("recipesContainer");
  container.innerHTML = `<div class="empty-state"><p>Loading recipes…</p></div>`;
  allRecipes = await getRecipes();
  renderRecipes();
}

// Form submit
document.getElementById("recipeForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const name = document.getElementById("recipeName").value.trim();
  const url = document.getElementById("recipeUrl").value.trim();
  const category = document.getElementById("category").value;
  const addedBy = document.getElementById("addedBy").value;
  const notes = document.getElementById("notes").value.trim();

  if (!name || !url || !category || !addedBy) {
    alert("Please fill in all required fields.");
    return;
  }

  const submitBtn = document.querySelector(".btn-primary");
  submitBtn.disabled = true;
  submitBtn.textContent = "Adding…";

  const newRecipe = {
    id: Date.now().toString(),
    name,
    url,
    category,
    addedBy,
    notes,
    dateAdded: new Date().toISOString()
  };

  const result = await addRecipe(newRecipe);

  submitBtn.disabled = false;
  submitBtn.textContent = "Add Recipe";

  if (result.success) {
    document.getElementById("recipeForm").reset();
    allRecipes.push(newRecipe);
    renderRecipes();
  } else {
    alert("Could not add recipe. Please try again.");
  }
});

// Search
document.getElementById("searchInput").addEventListener("input", (e) => {
  currentSearch = e.target.value.trim();
  renderRecipes();
});

// Category chips
document.getElementById("filterChips").addEventListener("click", (e) => {
  if (!e.target.classList.contains("chip")) return;

  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  e.target.classList.add("active");
  currentCategory = e.target.dataset.category;
  renderRecipes();
});

// Initial load
document.addEventListener("DOMContentLoaded", loadRecipes);