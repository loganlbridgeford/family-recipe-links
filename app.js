// Bridgeford Family Recipe Links
// Simple shared recipe URL collector

const STORAGE_KEY = 'bridgeford-family-recipes';

// Get recipes from localStorage (temporary - will switch to Google Sheets later)
function getRecipes() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

// Save recipes to localStorage
function saveRecipes(recipes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

// Format date nicely
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// Render all recipes
function renderRecipes() {
  const recipes = getRecipes();
  const container = document.getElementById('recipesContainer');
  const countEl = document.getElementById('recipeCount');

  // Update count
  countEl.textContent = recipes.length > 0 ? `(${recipes.length})` : '';

  if (recipes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No recipes yet.</p>
        <p>Add the first one using the form above!</p>
      </div>
    `;
    return;
  }

  // Sort newest first
  const sorted = [...recipes].sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

  container.innerHTML = sorted.map(recipe => `
    <div class="recipe-card">
      <h3>
        <a href="${recipe.url}" target="_blank" rel="noopener">
          ${escapeHtml(recipe.name)}
        </a>
      </h3>
      <div class="recipe-meta">
        Added by <strong>${escapeHtml(recipe.addedBy)}</strong> · ${formatDate(recipe.dateAdded)}
      </div>
      ${recipe.notes ? `<div class="recipe-notes">${escapeHtml(recipe.notes)}</div>` : ''}
    </div>
  `).join('');
}

// Simple HTML escape to prevent issues
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle form submit
document.getElementById('recipeForm').addEventListener('submit', function(e) {
  e.preventDefault();

  const name = document.getElementById('recipeName').value.trim();
  const url = document.getElementById('recipeUrl').value.trim();
  const addedBy = document.getElementById('addedBy').value;
  const notes = document.getElementById('notes').value.trim();

  if (!name || !url || !addedBy) {
    alert('Please fill in Recipe Name, URL, and Added by.');
    return;
  }

  const newRecipe = {
    id: Date.now().toString(),
    name,
    url,
    addedBy,
    notes,
    dateAdded: new Date().toISOString()
  };

  const recipes = getRecipes();
  recipes.push(newRecipe);
  saveRecipes(recipes);

  // Clear form
  document.getElementById('recipeForm').reset();

  // Re-render list
  renderRecipes();
});

// Load recipes when page opens
document.addEventListener('DOMContentLoaded', renderRecipes);