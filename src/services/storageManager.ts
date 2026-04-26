import { Recipe, IngredientInventoryItem, Category } from '../types';

const STORAGE_KEYS = {
  RECIPES: 'magic_cupboard_recipes',
  INVENTORY: 'magic_cupboard_inventory',
  CATEGORIES: 'magic_cupboard_categories',
};

export const storageManager = {
  getRecipes: (): Recipe[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.RECIPES);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  },
  saveRecipe: (recipe: Recipe): Recipe => {
    const recipes = storageManager.getRecipes();
    const id = recipe.id || crypto.randomUUID();
    const recipeWithId = { ...recipe, id, createdAt: recipe.createdAt || Date.now() };
    const index = recipes.findIndex(r => r.id === id);
    if (index >= 0) recipes[index] = recipeWithId;
    else recipes.push(recipeWithId);
    try { localStorage.setItem(STORAGE_KEYS.RECIPES, JSON.stringify(recipes)); }
    catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError')
        alert('儲存空間已滿，請刪除部分食譜或圖片後再試。');
    }
    return recipeWithId;
  },
  deleteRecipe: (id: string) => {
    const filtered = storageManager.getRecipes().filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEYS.RECIPES, JSON.stringify(filtered));
  },
  getInventory: (): IngredientInventoryItem[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.INVENTORY);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  },
  saveInventoryItem: (item: IngredientInventoryItem): IngredientInventoryItem => {
    const inventory = storageManager.getInventory();
    const id = item.id || crypto.randomUUID();
    const itemWithId = { ...item, id };
    const index = inventory.findIndex(i => i.id === id);
    if (index >= 0) inventory[index] = itemWithId;
    else inventory.push(itemWithId);
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventory));
    return itemWithId;
  },
  deleteInventoryItem: (id: string) => {
    const filtered = storageManager.getInventory().filter(i => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(filtered));
  },
  getCategories: (): Category[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  },
  saveCategory: (category: Category): Category => {
    const categories = storageManager.getCategories();
    const id = category.id || crypto.randomUUID();
    const categoryWithId = { ...category, id };
    const index = categories.findIndex(c => c.id === id);
    if (index >= 0) categories[index] = categoryWithId;
    else categories.push(categoryWithId);
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
    return categoryWithId;
  },
  deleteCategory: (id: string) => {
    const filtered = storageManager.getCategories().filter(c => c.id !== id);
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(filtered));
  }
};
