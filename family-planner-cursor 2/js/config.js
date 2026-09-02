/* global window */
(function (global) {
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
  const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

  const TAG_LABELS = {
    quick: 'Quick',
    'batch-cook': 'Batch Cook',
    packable: 'Packable',
    'kid-friendly': 'Kid Friendly',
    'whole-foods': 'Whole Foods',
    'high-protein': 'High Protein',
    vegetarian: 'Vegetarian',
    'one-pan': 'One Pan',
    'freezer-friendly': 'Freezer Friendly',
    'leftover-friendly': 'Leftover Friendly'
  };

  const MEAL_SECTIONS = ['produce', 'meat', 'dairy', 'pantry', 'frozen', 'bakery', 'other'];
  const SECTION_LABELS = {
    produce: 'Produce',
    meat: 'Meat & Seafood',
    dairy: 'Dairy & Eggs',
    pantry: 'Pantry',
    frozen: 'Frozen',
    bakery: 'Bakery',
    other: 'Other'
  };

  const CATEGORY_TO_MEAL_TYPES = {
    Breakfast: ['breakfast'],
    Lunch: ['lunch'],
    Dinner: ['dinner'],
    Snack: ['snack'],
    Appetizer: [],
    Dessert: [],
    Other: []
  };

  global.APP_CONFIG = {
    SUPABASE_URL: 'https://tthmojfercxemrqghbfm.supabase.co',
    SUPABASE_ANON_KEY:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0aG1vamZlcmN4ZW1ycWdoYmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NTU0NDYsImV4cCI6MjEwMDQzMTQ0Nn0.QxtgLYQHpC-0KYuGGk6rzQcovY3drlXCSgIMeUNS3lY',
    HOUSEHOLD_ID: '7c8f2a10-4d3b-4e9a-9c1f-2b6e8d5a4f01',
    STORAGE_BUCKET: 'recipe-photos',
    DAYS,
    DAY_LABELS,
    MEAL_SLOTS,
    SLOT_LABELS,
    TAG_LABELS,
    MEAL_SECTIONS,
    SECTION_LABELS,
    CATEGORY_TO_MEAL_TYPES,
    MEAL_TYPES: ['breakfast', 'lunch', 'dinner', 'snack']
  };
})(window);
