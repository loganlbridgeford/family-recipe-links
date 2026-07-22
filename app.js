// Bridgeford Family Recipe Links
// Connected to Google Sheet via Apps Script

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzlSno8NMMR15vC-j7XdbURig48FgVgh_uhIf0W6h1QFkDcEVFpxUbSi5jlcIZWZ7_gFg/exec";

// Get recipes from Google Sheet
async function getRecipes() {
  try {
    const response = await fetch(SCRIPT_URL);
    if (!response.ok) throw new Error("Failed to load recipes");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Error loading recipes:", err);
    return [];
  }
}

// Add a new recipe to Google Sheet
async function addRecipe(recipe) {
  try {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(recipe)
    });
    const result = await response.json();
    return result;
  } catch (err) {
    console.error("Error adding recipe:", err);
    return { success: false, error: err.message };
  }
}

// Format date nicely
function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

// Simple HTML escape
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// Render all recipes
async function renderRecipes() {
  const container = document.getElementById("recipesContainer");
  const countEl = document.getElementById("recipeCount");

  container.innerHTML = `<div class="empty-state"><p>Loading recipes…</p></div>`;

  const recipes = await getRecipes();

  countEl.textContent = recipes.length > 0 ? `(${recipes.length})` : "";

  if (recipes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No recipes yet.</p>
        <p>Add the first one using the form above!</p>
      </div>
    `;
    return;
  }

  // Newest first
  const sorted = [...recipes].sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

  container.innerHTML = sorted.map(recipe => `
    <div class="recipe-card">
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
}

// Handle form submit
document.getElementById("recipeForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const name = document.getElementById("recipeName").value.trim();
  const url = document.getElementById("recipeUrl").value.trim();
  const addedBy = document.getElementById("addedBy").value;
  const notes = document.getElementById("notes").value.trim();

  if (!name || !url || !addedBy) {
    alert("Please fill in Recipe Name, URL, and Added by.");
    return;
  }

  const submitBtn = document.querySelector(".btn-primary");
  submitBtn.disabled = true;
  submitBtn.textContent = "Adding…";

  const newRecipe = {
    id: Date.now().toString(),
    name,
    url,
    addedBy,
    notes,
    dateAdded: new Date().toISOString()
  };

  const result = await addRecipe(newRecipe);

  submitBtn.disabled = false;
  submitBtn.textContent = "Add Recipe";

  if (result.success) {
    document.getElementById("recipeForm").reset();
    renderRecipes();
  } else {
    alert("Could not add recipe. Please try again.");
  }
});

// Load recipes when page opens
document.addEventListener("DOMContentLoaded", renderRecipes);