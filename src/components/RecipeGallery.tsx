import React from 'react';
import { motion } from 'motion/react';
import { Plus, Clock, ChevronRight, Cake, Trash2, Search, LogOut, Package } from 'lucide-react';
import { Recipe } from '../types';

interface RecipeGalleryProps {
  recipes: Recipe[];
  onSelectRecipe: (recipe: Recipe) => void;
  onNewRecipe: () => void;
  onDeleteRecipe: (id: string) => void;
  onLogout: () => void;
  onOpenInventory: () => void;
}

export default function RecipeGallery({ recipes, onSelectRecipe, onNewRecipe, onDeleteRecipe, onLogout, onOpenInventory }: RecipeGalleryProps) {
  const [searchTerm, setSearchTerm] = React.useState('');
  const filteredRecipes = recipes.filter(r =>
    r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.mainCategory.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.subCategory.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-stone-50 pb-24">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10 px-4 py-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold text-brand-600 flex items-center gap-2">
              <Cake className="w-8 h-8" /> 魔法師的櫥櫃
            </h1>
            <p className="text-stone-400 text-sm mt-1">您的專屬美味配方集</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={onOpenInventory} className="p-3 text-stone-400 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-all" title="食材庫存管理">
              <Package className="w-5 h-5" />
            </button>
            <button onClick={onNewRecipe} className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 transition-all transform hover:scale-105 active:scale-95">
              <Plus className="w-5 h-5" /> 新增食譜
            </button>
            <button onClick={() => { if (window.confirm('確定要登出嗎？')) onLogout(); }} className="p-3 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-all" title="登出">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 mt-8">
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 w-5 h-5" />
          <input
            type="text"
            placeholder="搜尋食譜、分類..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-stone-200 rounded-2xl py-4 pl-12 pr-4 shadow-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all"
          />
        </div>
        {filteredRecipes.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-stone-200">
            <div className="bg-stone-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Cake className="w-10 h-10 text-stone-200" />
            </div>
            <h3 className="text-xl font-bold text-stone-400">尚無食譜</h3>
            <p className="text-stone-300 mt-2">點擊上方按鈕開始記錄您的第一個美味配方</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRecipes.map((recipe) => (
              <motion.div
                key={recipe.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-3xl overflow-hidden shadow-sm border border-stone-100 hover:shadow-xl transition-all group cursor-pointer"
                onClick={() => onSelectRecipe(recipe)}
              >
                <div className="aspect-[4/3] bg-stone-100 relative overflow-hidden">
                  {recipe.image ? (
                    <img src={recipe.image} alt={recipe.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Cake className="w-12 h-12 text-stone-200" /></div>
                  )}
                  <div className="absolute top-4 left-4">
                    <span className="bg-white/90 backdrop-blur-sm text-brand-600 text-[10px] font-bold px-3 py-1 rounded-full shadow-sm uppercase tracking-wider">{recipe.subCategory}</span>
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xl font-bold text-stone-800 line-clamp-1">{recipe.title || '未命名食譜'}</h3>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (recipe.id) onDeleteRecipe(recipe.id); }}
                      className="p-2 text-stone-200 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-stone-500 text-sm line-clamp-2 mb-4 h-10">{recipe.description || '暫無描述...'}</p>
                  <div className="flex items-center justify-between pt-4 border-t border-stone-50">
                    <div className="flex items-center gap-2 text-stone-400">
                      <Clock className="w-4 h-4" />
                      <span className="text-xs">{recipe.createdAt ? new Date(recipe.createdAt).toLocaleDateString() : '剛剛'}</span>
                    </div>
                    <div className="text-brand-500 flex items-center gap-1 font-bold text-sm">查看詳情 <ChevronRight className="w-4 h-4" /></div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
