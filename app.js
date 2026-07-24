// Family Recipe Links - Supabase version

const SUPABASE_URL = "https://tthmojfercxemrqghbfm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0aG1vamZlcmN4ZW1ycWdoYmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NTU0NDYsImV4cCI6MjEwMDQzMTQ0Nn0.QxtgLYQHpC-0KYuGGk6rzQcovY3drlXCSgIMeUNS3lY";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allRecipes = [];
let currentCategory = "All";
let currentSearch = "";

// Get all recipes
async function getRecipes() {
  try {
    const { data, error } = await supabase
      .from("recipes")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Error loading recipes:", err);
    return [];
  }
}

// Add a recipe
async function addRecipe(recipe) {
  try {
    const { data, error } = await supabase
      .from("recipes")
      .insert([recipe])
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Error adding recipe:", err);
    return { success: false, error: err.message };
  }
}

// Delete a recipe
async function deleteRecipe(id) {
  try {
    const { error } = await supabase
      .from("recipes")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Error deleting recipe:", err);
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

  if (currentCategory !== "All") {
    list = list.filter(r => (r.category || "Other") === currentCategory);
  }

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(r =>
      (r.name || "").toLowerCase().includes(q) ||
      (r.url || "").toLowerCase().includes(q) ||
      (r.added_by || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
    );
  }

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
        ${recipe.url 
          ? `<a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener">${escapeHtml(recipe.name)}</a>` 
          : escapeHtml(recipe.name)}
      </h3>
      <div class="recipe-meta">
        Added by <strong>${escapeHtml(recipe.added_by)}</strong> · ${formatDate(recipe.created_at)}
      </div>
      ${recipe.notes ? `<div class="recipe-notes">${escapeHtml(recipe.notes)}</div>` : ""}
    </div>
  `).join("");

  // Delete buttons
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

  if (!name || !category || !addedBy) {
    alert("Please fill in Recipe Name, Category, and Added by.");
    return;
  }

  const submitBtn = document.querySelector(".btn-primary");
  submitBtn.disabled = true;
  submitBtn.textContent = "Adding…";

  const newRecipe = {
    name,
    url: url || null,
    category,
    added_by: addedBy,
    notes: notes || null
  };

  const result = await addRecipe(newRecipe);

  submitBtn.disabled = false;
  submitBtn.textContent = "Add Recipe";

  if (result.success) {
    document.getElementById("recipeForm").reset();
    await loadRecipes();
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

// Start
document.addEventListener("DOMContentLoaded", loadRecipes);