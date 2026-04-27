export interface Ingredient {
  id: string;
  name: string;
  amount: number;
  unit: string;
  unitPrice?: number;
  isFlour?: boolean;
}

export interface IngredientInventoryItem {
  id?: string;
  userId: string;
  name: string;
  spec: number;
  price: number;
  unitPrice: number;
  vendor: string;
  purchaseDate: string;
  unit: string;
  category?: string;
}

export interface Category {
  id?: string;
  userId: string;
  name: string;
  order?: number;
}

export interface Step {
  id: string;
  content: string;
}

export interface BakingStage {
  id: string;
  temp: string;
  time: string;
}

export interface Recipe {
  id?: string;
  userId?: string;
  title: string;
  description: string;
  mainCategory: string;
  subCategory: string;
  series?: string;          // 系列名稱，用於版本比較
  ingredients: Ingredient[];
  steps: Step[];
  image: string | null;
  bakingStages: BakingStage[];
  notes?: string;
  createdAt?: number;
}
