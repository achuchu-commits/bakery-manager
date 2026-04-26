import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Plus, Trash2, Search, Save, Package, DollarSign, Calendar, Factory, Loader2, X, LayoutGrid, List, Tag, Settings2, Download } from 'lucide-react';
import { IngredientInventoryItem, Category } from '../types';
import { db } from '../firebase';
import { storageManager } from '../services/storageManager';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { buildDefaultIngredients, DEFAULT_CATEGORIES } from '../data/defaultIngredients';

interface IngredientInventoryProps {
  inventory: IngredientInventoryItem[];
  onBack: () => void;
  userId: string;
}

export default function IngredientInventory({ inventory, onBack, userId }: IngredientInventoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingItem, setEditingItem] = useState<IngredientInventoryItem | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [categories, setCategories] = useState<Category[]>([]);
  const [isManagingCategories, setIsManagingCategories] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  useEffect(() => {
    setCategories(storageManager.getCategories());
    // 不用 orderBy 避免需要複合索引，改在 client 端排序
    const q = query(collection(db, 'categories'), where('userId', '==', userId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const firebaseCategories = snapshot.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: data.id || doc.id } as Category;
      });
      // 以 Firestore 資料為主，本地補漏，按名稱去重
      const seen = new Set<string>();
      const merged: Category[] = [];
      [...firebaseCategories, ...storageManager.getCategories()].forEach(cat => {
        if (!seen.has(cat.name)) { seen.add(cat.name); merged.push(cat); }
      });
      merged.sort((a, b) => (a.order || 0) - (b.order || 0));
      storageManager.getCategories; // keep local in sync
      setCategories(merged);
    }, (error) => {
      console.error('Categories snapshot error:', error);
      setCategories(storageManager.getCategories());
    });
    return () => unsubscribe();
  }, [userId]);

  const initialItem: IngredientInventoryItem = {
    userId, name: '', spec: 0, price: 0, unitPrice: 0, vendor: '',
    purchaseDate: new Date().toISOString().split('T')[0], unit: 'g',
    category: categories[0]?.name || '其他'
  };
  const [newItem, setNewItem] = useState<IngredientInventoryItem>(initialItem);

  const filteredInventory = inventory.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.vendor.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === '全部' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      const categoryData = { userId, name: newCategoryName.trim(), order: categories.length };
      const saved = storageManager.saveCategory(categoryData);
      setCategories(prev => [...prev, saved]);
      await addDoc(collection(db, 'categories'), { ...categoryData, id: saved.id });
      setNewCategoryName('');
    } catch (error) { console.error('Add Category Error:', error); }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!window.confirm('確定要刪除此分類嗎？')) return;
    try {
      storageManager.deleteCategory(id);
      setCategories(prev => prev.filter(c => c.id !== id));
      await deleteDoc(doc(db, 'categories', id));
    } catch (error) { console.error('Delete Category Error:', error); }
  };

  const handleSave = async () => {
    if (!newItem.name || newItem.spec <= 0 || newItem.price <= 0) { alert('請填寫完整資訊'); return; }
    setIsSaving(true);
    try {
      const unitPrice = newItem.price / newItem.spec;
      const itemData = { ...newItem, unitPrice };
      const saved = storageManager.saveInventoryItem(itemData);
      if (editingItem?.id) {
        await updateDoc(doc(db, 'ingredient_inventory', editingItem.id), itemData as any);
      } else {
        await addDoc(collection(db, 'ingredient_inventory'), { ...itemData, id: saved.id });
      }
      setIsAdding(false); setEditingItem(null); setNewItem(initialItem);
    } catch (error) { console.error('Save Inventory Error:', error); alert('儲存失敗');
    } finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('確定要刪除此食材資訊嗎？')) return;
    try {
      storageManager.deleteInventoryItem(id);
      await deleteDoc(doc(db, 'ingredient_inventory', id));
    } catch (error) { console.error('Delete Inventory Error:', error); }
  };

  const handleImportDefaults = async () => {
    if (!window.confirm(`確定要匯入 75 筆原料資料嗎？\n（已存在的資料不會被刪除）`)) return;
    setIsSaving(true);
    try {
      // 先匯入分類（以 localStorage 為準去重，確保 Firestore 也有資料）
      const existingLocalCats = storageManager.getCategories();
      for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
        const cat = { ...DEFAULT_CATEGORIES[i], userId };
        const existing = existingLocalCats.find(c => c.name === cat.name);
        if (existing) {
          // 本地有，確保 Firestore 也有（可能上次失敗沒寫進去）
          await addDoc(collection(db, 'categories'), { ...cat, id: existing.id }).catch(() => {});
        } else {
          const saved = storageManager.saveCategory(cat);
          await addDoc(collection(db, 'categories'), { ...cat, id: saved.id });
        }
      }
      // 再匯入原料
      const items = buildDefaultIngredients(userId);
      for (const item of items) {
        const saved = storageManager.saveInventoryItem(item);
        await addDoc(collection(db, 'ingredient_inventory'), { ...item, id: saved.id });
      }
      alert('✅ 匯入完成！共匯入 75 筆原料資料。');
    } catch (error) {
      console.error('Import Error:', error);
      alert('匯入過程發生錯誤，請重試。');
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (item: IngredientInventoryItem) => { setEditingItem(item); setNewItem(item); setIsAdding(true); };

  return (
    <div className="min-h-screen bg-stone-50 pb-20">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-all"><ChevronLeft className="w-6 h-6" /></button>
            <h1 className="text-xl font-serif font-bold text-stone-800">食材庫存管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-stone-100 p-1 rounded-xl mr-2">
              <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400'}`}><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'table' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400'}`}><List className="w-4 h-4" /></button>
            </div>
            {inventory.length === 0 && (
              <button onClick={handleImportDefaults} disabled={isSaving} className="bg-stone-700 text-white px-4 py-2 rounded-full font-medium flex items-center gap-2 hover:bg-stone-800 transition-all disabled:opacity-50">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                匯入原料庫
              </button>
            )}
            <button onClick={() => { setNewItem(initialItem); setEditingItem(null); setIsAdding(true); }} className="bg-brand-500 text-white px-4 py-2 rounded-full font-medium flex items-center gap-2 hover:bg-brand-600 transition-all">
              <Plus className="w-4 h-4" /> 新增食材
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-8">
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 w-5 h-5" />
            <input type="text" placeholder="搜尋食材名稱或廠商..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-white border border-stone-200 rounded-2xl pl-12 pr-4 py-4 shadow-sm focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            <button onClick={() => setSelectedCategory('全部')} className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all ${selectedCategory === '全部' ? 'bg-stone-900 text-white' : 'bg-white text-stone-500 border border-stone-200'}`}>全部</button>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.name)} className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all ${selectedCategory === cat.name ? 'bg-stone-900 text-white' : 'bg-white text-stone-500 border border-stone-200'}`}>{cat.name}</button>
            ))}
            <button onClick={() => setIsManagingCategories(true)} className="px-3 py-2 rounded-full bg-stone-100 text-stone-400 hover:text-stone-600"><Settings2 className="w-4 h-4" /></button>
          </div>
        </div>

        {viewMode === 'table' ? (
          <div className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  {['食材名稱','分類','規格','總價','單位價格','廠商','購買日期','操作'].map(h => (
                    <th key={h} className="px-6 py-4 text-xs font-bold text-stone-500 uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredInventory.map(item => (
                  <tr key={item.id} className="hover:bg-stone-50 transition-colors group">
                    <td className="px-6 py-4 font-bold text-stone-800">{item.name}</td>
                    <td className="px-6 py-4"><span className="px-2 py-1 bg-stone-100 text-stone-500 text-[10px] font-bold rounded-md">{item.category || '未分類'}</span></td>
                    <td className="px-6 py-4 text-sm text-stone-600">{item.spec}{item.unit}</td>
                    <td className="px-6 py-4 text-sm font-bold text-stone-800">${item.price}</td>
                    <td className="px-6 py-4 text-sm font-bold text-emerald-600">${item.unitPrice.toFixed(4)}</td>
                    <td className="px-6 py-4 text-sm text-stone-500">{item.vendor || '-'}</td>
                    <td className="px-6 py-4 text-sm text-stone-500">{item.purchaseDate || '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(item)} className="p-1.5 text-stone-400 hover:text-brand-500 hover:bg-brand-50 rounded-lg"><Save className="w-4 h-4" /></button>
                        <button onClick={() => item.id && handleDelete(item.id)} className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {filteredInventory.map(item => (
              <motion.div layout key={item.id} className="bg-white p-5 rounded-3xl shadow-sm border border-stone-100 hover:shadow-md transition-all group relative">
                <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <button onClick={() => startEdit(item)} className="p-1.5 text-stone-400 hover:text-brand-500 rounded-lg"><Save className="w-3.5 h-3.5" /></button>
                  <button onClick={() => item.id && handleDelete(item.id)} className="p-1.5 text-stone-400 hover:text-red-500 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <span className="inline-block px-2 py-0.5 bg-stone-100 text-stone-500 text-[10px] font-bold rounded-md mb-2">{item.category || '未分類'}</span>
                <h3 className="text-base font-bold text-stone-800">{item.name}</h3>
                <p className="text-xs text-stone-400 flex items-center gap-1 mt-1"><Factory className="w-3 h-3" />{item.vendor || '未填寫廠商'}</p>
                <div className="mt-3 space-y-2">
                  <div className="bg-stone-50 p-2.5 rounded-xl"><p className="text-[9px] font-bold text-stone-400 uppercase">規格 / 總價</p><p className="font-bold text-stone-700 text-sm">{item.spec}{item.unit} / ${item.price}</p></div>
                  <div className="bg-emerald-50 p-2.5 rounded-xl"><p className="text-[9px] font-bold text-emerald-400 uppercase">單位價格</p><p className="font-bold text-emerald-600 text-sm">${item.unitPrice.toFixed(4)} / {item.unit}</p></div>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {filteredInventory.length === 0 && (
          <div className="text-center py-20"><Package className="w-16 h-16 text-stone-200 mx-auto mb-4" /><p className="text-stone-400">尚無庫存資料</p></div>
        )}
      </main>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAdding(false)} className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl relative z-10">
              <div className="p-8">
                <div className="flex justify-between items-center mb-8">
                  <h2 className="text-2xl font-serif font-bold text-stone-800">{editingItem ? '編輯食材' : '新增食材'}</h2>
                  <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-stone-100 rounded-full"><X className="w-6 h-6 text-stone-400" /></button>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-sm font-bold text-stone-500 mb-2">食材名稱 *</label>
                      <input type="text" value={newItem.name} onChange={(e) => setNewItem(prev => ({ ...prev, name: e.target.value }))} placeholder="如：低筋麵粉" className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none" />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-sm font-bold text-stone-500 mb-2">分類</label>
                      <div className="relative">
                        <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 w-4 h-4" />
                        <select value={newItem.category || ''} onChange={(e) => setNewItem(prev => ({ ...prev, category: e.target.value }))} className="w-full bg-stone-50 border border-stone-200 rounded-2xl pl-10 pr-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none appearance-none">
                          {categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                          {categories.length === 0 && <option value="其他">其他</option>}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-stone-500 mb-2">規格 *</label>
                      <div className="flex gap-2">
                        <input type="number" value={newItem.spec || ''} onChange={(e) => setNewItem(prev => ({ ...prev, spec: Number(e.target.value) }))} placeholder="1000" className="flex-1 bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none" />
                        <input type="text" value={newItem.unit} onChange={(e) => setNewItem(prev => ({ ...prev, unit: e.target.value }))} placeholder="g" className="w-16 bg-stone-50 border border-stone-200 rounded-2xl px-2 py-3 text-center focus:ring-2 focus:ring-brand-500 outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-stone-500 mb-2">購買總價 *</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 w-4 h-4" />
                        <input type="number" value={newItem.price || ''} onChange={(e) => setNewItem(prev => ({ ...prev, price: Number(e.target.value) }))} placeholder="250" className="w-full bg-stone-50 border border-stone-200 rounded-2xl pl-10 pr-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none" />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-stone-500 mb-2">廠商</label>
                      <input type="text" value={newItem.vendor} onChange={(e) => setNewItem(prev => ({ ...prev, vendor: e.target.value }))} placeholder="如：全聯" className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-stone-500 mb-2">購買日期</label>
                      <input type="date" value={newItem.purchaseDate} onChange={(e) => setNewItem(prev => ({ ...prev, purchaseDate: e.target.value }))} className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none" />
                    </div>
                  </div>
                  <button onClick={handleSave} disabled={isSaving} className="w-full bg-stone-900 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-stone-800 transition-all disabled:bg-stone-300">
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} 儲存資訊
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isManagingCategories && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsManagingCategories(false)} className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-md rounded-[40px] shadow-2xl relative z-10">
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-serif font-bold text-stone-800">管理分類</h2>
                  <button onClick={() => setIsManagingCategories(false)} className="p-2 hover:bg-stone-100 rounded-full"><X className="w-6 h-6 text-stone-400" /></button>
                </div>
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input type="text" placeholder="新增分類名稱..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()} className="flex-1 bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none" />
                    <button onClick={handleAddCategory} className="bg-stone-900 text-white p-3 rounded-2xl hover:bg-stone-800"><Plus className="w-6 h-6" /></button>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {categories.map(cat => (
                      <div key={cat.id} className="flex items-center justify-between p-3 bg-stone-50 rounded-xl group">
                        <span className="font-medium text-stone-700">{cat.name}</span>
                        <button onClick={() => cat.id && handleDeleteCategory(cat.id)} className="p-1.5 text-stone-300 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
