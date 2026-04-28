import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User
} from 'firebase/auth';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, setDoc,
  onSnapshot, query, where, orderBy
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { storageManager } from './services/storageManager';
import { extractRecipeFromImage } from './services/geminiService';
import RecipeGallery from './components/RecipeGallery';
import IngredientInventory from './components/IngredientInventory';
import { Recipe, Ingredient, Step, BakingStage, IngredientInventoryItem } from './types';
import {
  Cake, ChevronLeft, Plus, Trash2, Save, Loader2, X,
  Upload, Sparkles, FileText, Printer, AlertCircle
} from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

type View = 'gallery' | 'detail' | 'edit' | 'inventory' | 'compare';

const newRecipeTemplate = (): Recipe => ({
  title: '', description: '', mainCategory: '', subCategory: '',
  ingredients: [{ id: crypto.randomUUID(), name: '', amount: 0, unit: 'g' }],
  steps: [{ id: crypto.randomUUID(), content: '' }],
  bakingStages: [{ id: crypto.randomUUID(), temp: '', time: '' }],
  image: null, notes: '',
});

// ── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const handleLogin = async () => {
    setLoading(true); setError('');
    try { await signInWithPopup(auth, new GoogleAuthProvider()); onLogin(); }
    catch (e: any) { setError(e.message || '登入失敗，請再試一次。'); }
    finally { setLoading(false); }
  };
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[40px] shadow-2xl p-12 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <Cake className="w-10 h-10 text-brand-500" />
        </div>
        <h1 className="text-4xl font-serif font-bold text-stone-800 mb-2">魔法師的櫥櫃</h1>
        <p className="text-stone-400 mb-10">您的專屬美味配方集</p>
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}
        <button onClick={handleLogin} disabled={loading}
          className="w-full bg-stone-900 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-stone-800 transition-all disabled:bg-stone-300">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          使用 Google 帳號登入
        </button>
      </motion.div>
    </div>
  );
}

// ── Recipe Editor ─────────────────────────────────────────────────────────────
function RecipeEditor({ recipe, onSave, onCancel, inventory, existingMainCats, existingSubCats }: {
  recipe: Recipe; onSave: (r: Recipe) => Promise<void>;
  onCancel: () => void; inventory: IngredientInventoryItem[];
  existingMainCats: string[]; existingSubCats: string[];
}) {
  const [form, setForm] = useState<Recipe>(recipe);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [ingMode, setIngMode] = useState<'simple' | 'detail'>('simple');
  const [pickerIngId, setPickerIngId] = useState<string | null>(null);
  const [pickerCat, setPickerCat] = useState<string | null>(null);
  const aiFileRef = React.useRef<HTMLInputElement>(null);
  const coverFileRef = React.useRef<HTMLInputElement>(null);

  // 食材庫分類
  const ingCategories = [...new Set(inventory.map(i => i.category).filter(Boolean))] as string[];
  const totalWeight = form.ingredients.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  // 烘焙百分比基準：麵粉類總重，若無麵粉則用總重
  const flourTotal = form.ingredients
    .filter(i => inventory.find(inv => inv.name === i.name)?.category === '麵粉類')
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const basisWeight = flourTotal > 0 ? flourTotal : totalWeight;

  // 壓縮圖片至最大 1000px 寬，JPEG 0.75 品質（約 50-150KB）
  const compressImage = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 1000;
          let w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });

  // AI 辨識：壓縮 → Gemini → 填入表單
  const handleAIUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    setAiLoading(true);
    try {
      const dataUrl = await compressImage(file);
      setForm(p => ({ ...p, image: dataUrl }));
      const base64 = dataUrl.split(',')[1];
      const result = await extractRecipeFromImage(base64, 'image/jpeg');
      setForm(p => ({
        ...p, ...result, image: dataUrl,
        ingredients: (result.ingredients?.length ? result.ingredients : p.ingredients).map((i: any) => ({ ...i, id: i.id || crypto.randomUUID() })),
        steps: (result.steps?.length ? result.steps : p.steps).map((s: any) => ({ ...s, id: s.id || crypto.randomUUID() })),
        bakingStages: (result.bakingStages?.length ? result.bakingStages : p.bakingStages).map((b: any) => ({ ...b, id: b.id || crypto.randomUUID() })),
      }));
    } catch (err: any) {
      console.error('AI 辨識錯誤:', err);
      alert(`AI 辨識失敗：${err?.message || String(err)}\n\n圖片已上傳，請手動填寫。`);
    }
    finally { setAiLoading(false); }
  };

  // 只上傳封面圖：壓縮即可，不送 AI
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    const dataUrl = await compressImage(file);
    setForm(p => ({ ...p, image: dataUrl }));
  };

  const addIngredient = () => setForm(p => ({ ...p, ingredients: [...p.ingredients, { id: crypto.randomUUID(), name: '', amount: 0, unit: 'g' }] }));
  const updateIngredient = (id: string, field: string, value: any) =>
    setForm(p => ({ ...p, ingredients: p.ingredients.map(i => i.id === id ? { ...i, [field]: value } : i) }));
  const removeIngredient = (id: string) => setForm(p => ({ ...p, ingredients: p.ingredients.filter(i => i.id !== id) }));

  const addStep = () => setForm(p => ({ ...p, steps: [...p.steps, { id: crypto.randomUUID(), content: '' }] }));
  const updateStep = (id: string, content: string) =>
    setForm(p => ({ ...p, steps: p.steps.map(s => s.id === id ? { ...s, content } : s) }));
  const removeStep = (id: string) => setForm(p => ({ ...p, steps: p.steps.filter(s => s.id !== id) }));

  const addBakingStage = () => setForm(p => ({ ...p, bakingStages: [...p.bakingStages, { id: crypto.randomUUID(), temp: '', time: '' }] }));
  const updateBakingStage = (id: string, field: keyof BakingStage, value: string) =>
    setForm(p => ({ ...p, bakingStages: p.bakingStages.map(b => b.id === id ? { ...b, [field]: value } : b) }));
  const removeBakingStage = (id: string) => setForm(p => ({ ...p, bakingStages: p.bakingStages.filter(b => b.id !== id) }));

  const handleSave = async () => {
    if (!form.title) { alert('請填寫食譜名稱'); return; }
    setSaving(true);
    try { await onSave(form); }
    catch (err: any) { alert(`儲存失敗：${err?.message || '請再試一次'}`); }
    finally { setSaving(false); }
  };

  const totalCost = form.ingredients.reduce((sum, ing) => {
    const item = inventory.find(inv => inv.name === ing.name);
    return sum + (item ? item.unitPrice * ing.amount : 0);
  }, 0);

  return (
    <div className="min-h-screen bg-stone-50 pb-24">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button onClick={onCancel} className="p-2 text-stone-400 hover:text-stone-600 rounded-full"><ChevronLeft className="w-6 h-6" /></button>
          <h2 className="font-serif font-bold text-stone-800">{form.id ? '編輯食譜' : '新增食譜'}</h2>
          <button onClick={handleSave} disabled={saving} className="bg-brand-500 text-white px-6 py-2 rounded-full font-bold flex items-center gap-2 hover:bg-brand-600 disabled:bg-stone-300">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 儲存
          </button>
        </div>
      </header>

      {aiLoading && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 text-center shadow-2xl">
            <Sparkles className="w-12 h-12 text-brand-500 mx-auto mb-4 animate-pulse" />
            <p className="font-bold text-stone-800">AI 正在辨識食譜...</p>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-4 mt-8 space-y-6">
        {/* Image */}
        <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-stone-100">
          {form.image ? (
            <div className="relative aspect-video">
              <img src={form.image} alt="食譜" className="w-full h-full object-cover" />
              <button onClick={() => setForm(p => ({ ...p, image: null }))}
                className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition-all" title="移除圖片">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="aspect-video bg-stone-50 flex flex-col items-center justify-center gap-4 p-6">
              <Upload className="w-10 h-10 text-stone-300" />
              <p className="text-sm text-stone-400">選擇上傳方式</p>
              <div className="flex gap-3">
                <button onClick={() => aiFileRef.current?.click()}
                  className="flex items-center gap-2 bg-brand-500 text-white px-5 py-2.5 rounded-full font-bold text-sm hover:bg-brand-600 transition-all">
                  <Sparkles className="w-4 h-4" /> AI 辨識食譜
                </button>
                <button onClick={() => coverFileRef.current?.click()}
                  className="flex items-center gap-2 bg-stone-200 text-stone-700 px-5 py-2.5 rounded-full font-bold text-sm hover:bg-stone-300 transition-all">
                  <Upload className="w-4 h-4" /> 只上傳封面
                </button>
              </div>
            </div>
          )}
          <input ref={aiFileRef} type="file" accept="image/*" className="hidden" onChange={handleAIUpload} />
          <input ref={coverFileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
        </div>

        {/* Basic Info */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100 space-y-4">
          <h3 className="font-bold text-stone-800">基本資訊</h3>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="食譜名稱 *" className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none text-xl font-bold" />
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="食譜描述..." rows={3} className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none resize-none" />
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-stone-500 mb-1">系列名稱 <span className="font-normal text-stone-400">（選填，用於版本比較，如「原味奶油曲奇」）</span></label>
              <input value={form.series || ''} onChange={e => setForm(p => ({ ...p, series: e.target.value }))}
                placeholder="同系列不同版本填相同名稱..." className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-500 mb-1">主分類</label>
              <select value={form.mainCategory}
                onChange={e => {
                  if (e.target.value === '__new__') {
                    const name = window.prompt('輸入新的主分類名稱');
                    if (name?.trim()) setForm(p => ({ ...p, mainCategory: name.trim() }));
                  } else {
                    setForm(p => ({ ...p, mainCategory: e.target.value }));
                  }
                }}
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none">
                <option value="">請選擇</option>
                {existingMainCats.map(c => <option key={c} value={c}>{c}</option>)}
                {form.mainCategory && !existingMainCats.includes(form.mainCategory) &&
                  <option value={form.mainCategory}>{form.mainCategory}</option>}
                <option value="__new__">＋ 新增分類</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-500 mb-1">次分類</label>
              <select value={form.subCategory}
                onChange={e => {
                  if (e.target.value === '__new__') {
                    const name = window.prompt('輸入新的次分類名稱');
                    if (name?.trim()) setForm(p => ({ ...p, subCategory: name.trim() }));
                  } else {
                    setForm(p => ({ ...p, subCategory: e.target.value }));
                  }
                }}
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none">
                <option value="">請選擇</option>
                {existingSubCats.map(c => <option key={c} value={c}>{c}</option>)}
                {form.subCategory && !existingSubCats.includes(form.subCategory) &&
                  <option value={form.subCategory}>{form.subCategory}</option>}
                <option value="__new__">＋ 新增分類</option>
              </select>
            </div>
          </div>
        </div>

        {/* Baking Stages */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-stone-800">烘焙階段</h3>
            <button onClick={addBakingStage} className="text-brand-500 text-sm font-bold flex items-center gap-1"><Plus className="w-4 h-4" />新增</button>
          </div>
          {form.bakingStages.map((stage, idx) => (
            <div key={stage.id} className="flex gap-3 items-center">
              <span className="text-stone-400 text-sm font-bold w-6">#{idx + 1}</span>
              <input value={stage.temp} onChange={e => updateBakingStage(stage.id, 'temp', e.target.value)}
                placeholder="溫度 (如: 上火180/下火160)" className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
              <input value={stage.time} onChange={e => updateBakingStage(stage.id, 'time', e.target.value)}
                placeholder="時間 (如: 25分鐘)" className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
              <button onClick={() => removeBakingStage(stage.id)} className="text-stone-300 hover:text-red-400"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>

        {/* Ingredients */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-stone-800">食材列表</h3>
            <div className="flex items-center gap-3">
              {/* 模式切換 */}
              <div className="flex bg-stone-100 rounded-xl p-1 text-xs font-bold">
                <button onClick={() => setIngMode('simple')}
                  className={`px-3 py-1 rounded-lg transition-all ${ingMode === 'simple' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-400'}`}>
                  精簡
                </button>
                <button onClick={() => setIngMode('detail')}
                  className={`px-3 py-1 rounded-lg transition-all ${ingMode === 'detail' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-400'}`}>
                  詳細
                </button>
              </div>
              <button onClick={addIngredient} className="text-brand-500 text-sm font-bold flex items-center gap-1"><Plus className="w-4 h-4" />新增</button>
            </div>
          </div>

          {/* 詳細模式標題列 */}
          {ingMode === 'detail' && (
            <div className="grid grid-cols-[1fr_60px_38px_44px_44px_64px_20px] gap-1 text-[10px] font-bold text-stone-400 px-1">
              <span>食材</span>
              <span className="text-center">用量</span>
              <span className="text-center">單位</span>
              <span className="text-center">烘焙%</span>
              <span className="text-center">實際%</span>
              <span className="text-center">小計/成本</span>
              <span />
            </div>
          )}

          {form.ingredients.map((ing) => {
            const invItem = inventory.find(i => i.name === ing.name);
            const savedUnitPrice = (ing as any).unitPrice ?? 0;
            const unitPrice = invItem?.unitPrice ?? savedUnitPrice;
            const subtotal = unitPrice * (Number(ing.amount) || 0);
            const amt = Number(ing.amount) || 0;
            const bakersPct = basisWeight > 0 ? (amt / basisWeight * 100) : 0;
            const actualPct = totalWeight > 0 ? (amt / totalWeight * 100) : 0;
            return (
              <div key={ing.id} className={ingMode === 'detail'
                ? 'grid grid-cols-[1fr_60px_38px_44px_44px_64px_20px] gap-1 items-center'
                : 'flex gap-1.5 items-center'}>
                {/* 食材名稱 + 選擇器按鈕 */}
                <div className={`flex gap-1 min-w-0 ${ingMode === 'simple' ? 'flex-[3]' : ''}`}>
                  <input value={ing.name} onChange={e => updateIngredient(ing.id, 'name', e.target.value)}
                    placeholder="食材名稱" className="flex-1 min-w-0 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
                  <button onClick={() => { setPickerIngId(ing.id); setPickerCat(null); }}
                    title="從食材庫選擇"
                    className="shrink-0 w-8 h-[38px] bg-stone-100 hover:bg-stone-200 border border-stone-200 rounded-xl text-stone-500 text-base flex items-center justify-center transition-all">
                    ≡
                  </button>
                </div>
                {/* 用量 */}
                <input type="number" value={ing.amount || ''} onChange={e => updateIngredient(ing.id, 'amount', Number(e.target.value))}
                  placeholder="0" className={`bg-stone-50 border border-stone-200 rounded-xl px-2 py-2 text-sm text-center focus:ring-2 focus:ring-brand-500 outline-none ${ingMode === 'simple' ? 'w-20 shrink-0' : 'w-full'}`} />
                {/* 單位 */}
                <input value={ing.unit} onChange={e => updateIngredient(ing.id, 'unit', e.target.value)}
                  placeholder="g" className={`bg-stone-50 border border-stone-200 rounded-xl px-1 py-2 text-sm text-center focus:ring-2 focus:ring-brand-500 outline-none ${ingMode === 'simple' ? 'w-14 shrink-0' : 'w-full'}`} />
                {/* 詳細欄位 */}
                {ingMode === 'detail' && (
                  <>
                    {/* 烘焙% */}
                    <span className="text-xs text-brand-600 text-center font-medium">
                      {bakersPct.toFixed(1)}%
                    </span>
                    {/* 實際% */}
                    <span className="text-xs text-stone-500 text-center font-medium">
                      {actualPct.toFixed(1)}%
                    </span>
                    {/* 成本 */}
                    {unitPrice > 0
                      ? <span className="text-xs text-emerald-600 text-center font-medium">{subtotal > 0 ? `$${subtotal.toFixed(1)}` : '—'}</span>
                      : <input type="number" min="0" step="0.001" placeholder="成本/g"
                          value={savedUnitPrice || ''}
                          onChange={e => updateIngredient(ing.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className="text-xs border border-dashed border-stone-300 rounded-lg px-1 py-1.5 text-center w-full focus:ring-1 focus:ring-brand-500 outline-none" />
                    }
                  </>
                )}
                <button onClick={() => removeIngredient(ing.id)} className="shrink-0 text-stone-300 hover:text-red-400 flex items-center justify-center"><X className="w-4 h-4" /></button>
              </div>
            );
          })}

          {/* 總計列：兩種模式都是左右各一 */}
          <div className="pt-2 border-t border-stone-100 flex justify-between text-sm font-bold">
            <span className="text-stone-500">總重量：<span className="text-stone-800">{totalWeight}g</span></span>
            {totalCost > 0 && <span className="text-emerald-700">總成本：${totalCost.toFixed(1)}</span>}
          </div>
        </div>

        {/* 食材選擇器 Modal */}
        {pickerIngId && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => { setPickerIngId(null); setPickerCat(null); }}>
            <div className="bg-white rounded-t-3xl w-full p-6 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                {pickerCat
                  ? <button className="flex items-center gap-2 text-stone-600 font-bold" onClick={() => setPickerCat(null)}>← {pickerCat}</button>
                  : <h3 className="font-bold text-stone-800">選擇分類</h3>}
                <button onClick={() => { setPickerIngId(null); setPickerCat(null); }} className="text-stone-400 hover:text-stone-700"><X className="w-5 h-5" /></button>
              </div>
              {!pickerCat ? (
                <div className="grid grid-cols-3 gap-2">
                  {ingCategories.map(cat => (
                    <button key={cat} onClick={() => setPickerCat(cat)}
                      className="p-3 bg-stone-50 rounded-2xl text-sm font-medium text-stone-700 hover:bg-brand-50 hover:text-brand-600 transition-all text-left">
                      {cat}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {inventory.filter(i => i.category === pickerCat).map(item => (
                    <button key={item.id} className="w-full text-left px-4 py-3 hover:bg-stone-50 rounded-xl flex items-center justify-between transition-all"
                      onClick={() => {
                        updateIngredient(pickerIngId, 'name', item.name);
                        updateIngredient(pickerIngId, 'unit', item.unit);
                        if (item.unitPrice) (updateIngredient as any)(pickerIngId, 'unitPrice', item.unitPrice);
                        setPickerIngId(null); setPickerCat(null);
                      }}>
                      <span className="text-stone-800 font-medium">{item.name}</span>
                      <span className="text-xs text-stone-400">{item.spec}{item.unit} · ${item.unitPrice?.toFixed(3)}/{item.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-stone-800">製作步驟</h3>
            <button onClick={addStep} className="text-brand-500 text-sm font-bold flex items-center gap-1"><Plus className="w-4 h-4" />新增</button>
          </div>
          {form.steps.map((step, idx) => (
            <div key={step.id} className="flex gap-3">
              <span className="w-7 h-7 bg-brand-500 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-2">{idx + 1}</span>
              <textarea value={step.content} onChange={e => updateStep(step.id, e.target.value)}
                placeholder={`步驟 ${idx + 1}`} rows={2}
                className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none resize-none" />
              <button onClick={() => removeStep(step.id)} className="text-stone-300 hover:text-red-400 mt-2"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100">
          <h3 className="font-bold text-stone-800 mb-3">備註</h3>
          <textarea value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            placeholder="小秘訣、注意事項..." rows={4}
            className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none resize-none text-sm" />
        </div>
      </main>
    </div>
  );
}

// ── Recipe Detail ─────────────────────────────────────────────────────────────
function RecipeDetail({ recipe, onEdit, onBack, inventory }: {
  recipe: Recipe; onEdit: () => void; onBack: () => void;
  inventory: IngredientInventoryItem[];
}) {
  const cardRef = React.useRef<HTMLDivElement>(null);

  // 烘焙%基準：麵粉類總重，若無則總重
  const totalWeight = recipe.ingredients.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const flourTotal = recipe.ingredients
    .filter(i => inventory.find(inv => inv.name === i.name)?.category === '麵粉類')
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const basis = flourTotal > 0 ? flourTotal : totalWeight;

  const handleDownloadCard = async () => {
    if (!cardRef.current) return;
    // 暫時讓隱藏元素可見以便 html2canvas 擷取
    const el = cardRef.current.parentElement as HTMLElement;
    const prevStyle = el.getAttribute('style') || '';
    el.style.cssText = 'position:absolute;left:0;top:0;width:794px;z-index:-1;opacity:0;pointer-events:none;';
    await new Promise(r => setTimeout(r, 50)); // 等瀏覽器 repaint
    try {
      const canvas = await html2canvas(cardRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      pdf.save(`${recipe.title}.pdf`);
    } finally {
      el.setAttribute('style', prevStyle);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 pb-24">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10 px-4 py-4 no-print">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button onClick={onBack} className="p-2 text-stone-400 hover:text-stone-600 rounded-full"><ChevronLeft className="w-6 h-6" /></button>
          <div className="flex gap-2">
            <button onClick={handleDownloadCard} className="flex items-center gap-1.5 px-4 py-2 text-stone-500 hover:text-brand-600 hover:bg-brand-50 rounded-full font-medium text-sm transition-all" title="下載食譜卡片 PDF">
              <FileText className="w-4 h-4" /> 下載食譜
            </button>
            <button onClick={onEdit} className="bg-brand-500 text-white px-4 py-2 rounded-full font-bold text-sm hover:bg-brand-600">編輯</button>
          </div>
        </div>
      </header>

      {/* 網頁瀏覽版 */}
      <div className="max-w-3xl mx-auto px-4 mt-8 space-y-6">
        {recipe.image && <img src={recipe.image} alt={recipe.title} className="w-full aspect-video object-cover rounded-3xl shadow-sm" />}
        <div>
          <div className="flex gap-2 mb-2">
            <span className="bg-brand-100 text-brand-600 text-xs font-bold px-3 py-1 rounded-full">{recipe.mainCategory}</span>
            <span className="bg-stone-100 text-stone-500 text-xs font-bold px-3 py-1 rounded-full">{recipe.subCategory}</span>
            {recipe.series && <span className="bg-brand-500 text-white text-xs font-bold px-3 py-1 rounded-full">{recipe.series}</span>}
          </div>
          <h1 className="text-3xl font-serif font-bold text-stone-800">{recipe.title}</h1>
          {recipe.description && <p className="text-stone-500 mt-2">{recipe.description}</p>}
        </div>

        {recipe.bakingStages.length > 0 && recipe.bakingStages[0].temp && (
          <div className="bg-amber-50 border border-amber-100 rounded-3xl p-6">
            <h3 className="font-bold text-amber-800 mb-3">🔥 烘焙設定</h3>
            {recipe.bakingStages.map((s, i) => (
              <div key={s.id} className="flex items-center gap-4 text-sm text-amber-700">
                <span className="font-bold">第 {i + 1} 段</span>
                <span>溫度：{s.temp}</span>
                <span>時間：{s.time}</span>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100">
          <h3 className="font-bold text-stone-800 mb-4">食材列表</h3>
          <div className="text-[11px] font-bold text-stone-400 grid grid-cols-[1fr_52px_32px_42px_42px_52px] gap-1 px-1 mb-1">
            <span>食材</span><span className="text-right">用量</span><span className="text-center">單位</span>
            <span className="text-center">烘焙%</span><span className="text-center">實際%</span><span className="text-right">小計</span>
          </div>
          <div className="space-y-0.5">
            {recipe.ingredients.filter(i => i.name).map(ing => {
              const amt = Number(ing.amount) || 0;
              const bakerPct = basis > 0 ? (amt / basis * 100) : 0;
              const actualPct = totalWeight > 0 ? (amt / totalWeight * 100) : 0;
              const invItem = inventory.find(inv => inv.name === ing.name);
              const unitPrice = invItem?.unitPrice ?? (ing as any).unitPrice ?? 0;
              const subtotal = unitPrice * amt;
              return (
                <div key={ing.id} className="grid grid-cols-[1fr_52px_32px_42px_42px_52px] gap-1 items-center py-1.5 border-b border-stone-50 last:border-0">
                  <span className="text-stone-700 font-medium text-sm">{ing.name}</span>
                  <span className="text-stone-600 font-bold text-sm text-right">{ing.amount}</span>
                  <span className="text-stone-400 text-sm text-center">{ing.unit}</span>
                  <span className="text-brand-600 text-xs font-bold text-center">{bakerPct.toFixed(1)}%</span>
                  <span className="text-stone-400 text-xs text-center">{actualPct.toFixed(1)}%</span>
                  <span className="text-xs text-right font-medium">
                    {subtotal > 0 ? <span className="text-emerald-600">${subtotal.toFixed(1)}</span> : <span className="text-stone-300">—</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {(() => {
            const totalCost = recipe.ingredients.reduce((sum, ing) => {
              const invItem = inventory.find(inv => inv.name === ing.name);
              const unitPrice = invItem?.unitPrice ?? (ing as any).unitPrice ?? 0;
              return sum + unitPrice * (Number(ing.amount) || 0);
            }, 0);
            return (
              <div className="mt-3 pt-3 border-t border-stone-100 flex justify-between text-sm font-bold text-stone-500">
                <span>總重量：<span className="text-stone-800">{totalWeight}g</span></span>
                <span className="flex items-center gap-4">
                  {flourTotal > 0 && <span className="text-xs text-stone-400 font-normal">麵粉基準 {flourTotal}g</span>}
                  {totalCost > 0 && <span className="text-emerald-700">總成本：${totalCost.toFixed(1)}</span>}
                </span>
              </div>
            );
          })()}
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100">
          <h3 className="font-bold text-stone-800 mb-4">製作步驟</h3>
          <div className="space-y-4">
            {recipe.steps.map((step, idx) => (
              <div key={step.id} className="flex gap-4">
                <span className="w-8 h-8 bg-brand-500 text-white rounded-full flex items-center justify-center text-sm font-bold shrink-0">{idx + 1}</span>
                <p className="text-stone-700 leading-relaxed pt-1">{step.content}</p>
              </div>
            ))}
          </div>
        </div>

        {recipe.notes && (
          <div className="bg-stone-50 border border-stone-200 rounded-3xl p-6">
            <h3 className="font-bold text-stone-700 mb-2">📝 備註</h3>
            <p className="text-stone-500 text-sm leading-relaxed whitespace-pre-wrap">{recipe.notes}</p>
          </div>
        )}
      </div>

      {/* 隱藏的 PDF 卡片（用於下載，不顯示在畫面上）*/}
      <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '794px', background: 'white' }}>
        <div ref={cardRef} className="p-10 font-sans text-stone-800" style={{ fontFamily: 'sans-serif' }}>
          {/* Header */}
          <div className="border-b-2 border-stone-800 pb-4 mb-6">
            <div className="text-xs text-stone-400 mb-1">{recipe.mainCategory}{recipe.subCategory ? ` · ${recipe.subCategory}` : ''}{recipe.series ? ` · ${recipe.series}` : ''}</div>
            <h1 className="text-3xl font-bold text-stone-900">{recipe.title}</h1>
            {recipe.description && <p className="text-stone-500 mt-1 text-sm">{recipe.description}</p>}
          </div>

          <div className="grid grid-cols-2 gap-8">
            {/* 食材 */}
            <div>
              <h2 className="font-bold text-base mb-3 border-b border-stone-200 pb-1">食材</h2>
              <table className="w-full text-sm">
                <tbody>
                  {recipe.ingredients.filter(i => i.name).map(ing => (
                    <tr key={ing.id} className="border-b border-stone-100">
                      <td className="py-1.5 text-stone-700">{ing.name}</td>
                      <td className="py-1.5 text-right font-bold text-stone-900">{ing.amount} {ing.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recipe.bakingStages.length > 0 && recipe.bakingStages[0].temp && (
                <div className="mt-4">
                  <h2 className="font-bold text-base mb-2 border-b border-stone-200 pb-1">烘焙設定</h2>
                  {recipe.bakingStages.map((s, i) => (
                    <div key={s.id} className="text-sm py-1 text-stone-600">
                      第 {i + 1} 段：{s.temp}　{s.time}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 步驟 */}
            <div>
              <h2 className="font-bold text-base mb-3 border-b border-stone-200 pb-1">製作步驟</h2>
              <ol className="space-y-2">
                {recipe.steps.filter(s => s.content).map((step, idx) => (
                  <li key={step.id} className="flex gap-2 text-sm">
                    <span className="shrink-0 w-5 h-5 bg-stone-800 text-white rounded-full flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                    <span className="text-stone-700 leading-relaxed">{step.content}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {recipe.notes && (
            <div className="mt-6 pt-4 border-t border-stone-200">
              <h2 className="font-bold text-sm mb-1 text-stone-500">備註</h2>
              <p className="text-sm text-stone-500 whitespace-pre-wrap">{recipe.notes}</p>
            </div>
          )}
          <div className="mt-6 text-right text-xs text-stone-300">魔法師的櫥櫃</div>
        </div>
      </div>
    </div>
  );
}

// ── Compare View ──────────────────────────────────────────────────────────────
function CompareView({ recipes, inventory, onBack }: {
  recipes: Recipe[];
  inventory: IngredientInventoryItem[];
  onBack: () => void;
}) {
  // Compute baker's % basis for each recipe
  const getBasis = (recipe: Recipe) => {
    const flourTotal = recipe.ingredients
      .filter(i => inventory.find(inv => inv.name === i.name)?.category === '麵粉類')
      .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const totalWeight = recipe.ingredients.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    return flourTotal > 0 ? flourTotal : totalWeight;
  };

  // Collect all unique ingredient names, sorted by frequency then alpha
  const nameCount = new Map<string, number>();
  recipes.forEach(r => {
    r.ingredients.forEach(i => {
      if (i.name.trim()) nameCount.set(i.name, (nameCount.get(i.name) || 0) + 1);
    });
  });
  const allNames = [...nameCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-TW'))
    .map(([name]) => name);

  const bases = recipes.map(getBasis);

  // Find a reasonable short label for each recipe
  const getLabel = (recipe: Recipe) => {
    if (recipe.series && recipe.title.replace(recipe.series, '').trim()) {
      return recipe.title.replace(recipe.series, '').trim() || recipe.title;
    }
    return recipe.title;
  };

  return (
    <div className="min-h-screen bg-stone-50 pb-24">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button onClick={onBack} className="p-2 text-stone-400 hover:text-stone-600 rounded-full"><ChevronLeft className="w-6 h-6" /></button>
          <h2 className="font-serif font-bold text-stone-800">食譜比較</h2>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-8 space-y-6">
        {/* Recipe summary cards */}
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${recipes.length}, minmax(0, 1fr))` }}>
          {recipes.map((r, idx) => (
            <div key={r.id} className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 text-center">
              {r.image && <img src={r.image} alt={r.title} className="w-full aspect-video object-cover rounded-xl mb-3" />}
              <div className="text-xs text-brand-600 font-bold mb-1">{r.subCategory}</div>
              <div className="font-bold text-stone-800 text-sm leading-tight">{r.title}</div>
              {r.series && <div className="text-xs text-stone-400 mt-1">系列：{r.series}</div>}
              <div className="mt-2 text-xs text-stone-400">
                總重 {r.ingredients.reduce((s, i) => s + (Number(i.amount) || 0), 0)}g
                {bases[idx] !== r.ingredients.reduce((s, i) => s + (Number(i.amount) || 0), 0) && (
                  <span className="ml-1">（麵粉 {bases[idx]}g）</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Merged ingredient table */}
        <div className="bg-white rounded-3xl shadow-sm border border-stone-100 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="text-left px-5 py-4 font-bold text-stone-600 w-36 shrink-0">食材</th>
                {recipes.map((r, idx) => (
                  <th key={r.id} className="px-3 py-4 font-bold text-stone-600 text-center min-w-[100px]">
                    <div className="text-xs text-stone-400 font-normal mb-0.5">{r.series || ''}</div>
                    <div className="text-sm leading-tight">{getLabel(r)}</div>
                    <div className="text-[10px] text-stone-400 font-normal mt-0.5">烘焙%</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allNames.map((name, nameIdx) => {
                const rowIngredients = recipes.map(r => r.ingredients.find(i => i.name === name) ?? null);
                const hasAny = rowIngredients.some(Boolean);
                if (!hasAny) return null;
                const presentCount = rowIngredients.filter(Boolean).length;
                return (
                  <tr key={name} className={`border-b border-stone-50 ${nameIdx % 2 === 0 ? 'bg-stone-50/40' : 'bg-white'}`}>
                    <td className="px-5 py-3 font-medium text-stone-700 whitespace-nowrap">
                      {name}
                      {presentCount < recipes.length && (
                        <span className="ml-1.5 text-[10px] text-amber-500 font-bold">部分</span>
                      )}
                    </td>
                    {rowIngredients.map((ing, rIdx) => {
                      if (!ing) return (
                        <td key={rIdx} className="px-3 py-3 text-center text-stone-300 font-bold text-base">—</td>
                      );
                      const pct = bases[rIdx] > 0 ? (Number(ing.amount) / bases[rIdx] * 100) : 0;
                      return (
                        <td key={rIdx} className="px-3 py-3 text-center">
                          <span className="font-bold text-brand-600">{pct.toFixed(1)}%</span>
                          <span className="text-[11px] text-stone-400 ml-1">({ing.amount}{ing.unit})</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {allNames.length === 0 && (
            <div className="text-center py-12 text-stone-400">所選食譜沒有食材資料</div>
          )}
        </div>

        {/* Legend */}
        <div className="text-xs text-stone-400 text-center pb-4">
          烘焙百分比以麵粉總重為基準（若無麵粉則以總重為基準）<br />
          <span className="text-amber-500 font-bold">部分</span> 表示此食材不是所有食譜都有
        </div>
      </main>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('gallery');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [inventory, setInventory] = useState<IngredientInventoryItem[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [compareRecipes, setCompareRecipes] = useState<Recipe[]>([]);

  // Auth state
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
  }, []);

  // Firestore sync – recipes
  useEffect(() => {
    if (!user) return;
    const local = storageManager.getRecipes().filter(r => r.userId === user.uid);
    setRecipes(local);
    const q = query(collection(db, 'recipes'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      const fbRecipes = snap.docs.map(d => ({ ...d.data(), id: d.id })) as Recipe[];
      setRecipes(fbRecipes);
    });
  }, [user]);

  // Firestore sync – inventory
  useEffect(() => {
    if (!user) return;
    const local = storageManager.getInventory().filter(i => i.userId === user.uid);
    setInventory(local);
    const q = query(collection(db, 'ingredient_inventory'), where('userId', '==', user.uid));
    return onSnapshot(q, (snap) => {
      const fbItems = snap.docs.map(d => ({ ...d.data(), id: d.id })) as IngredientInventoryItem[];
      setInventory(fbItems);
    });
  }, [user]);

  const handleSaveRecipe = useCallback(async (recipe: Recipe) => {
    if (!user) return;
    const data = { ...recipe, userId: user.uid };
    const saved = storageManager.saveRecipe(data);
    try {
      if (recipe.id) {
        // 現有食譜：recipe.id 就是 Firestore 文件 ID
        await updateDoc(doc(db, 'recipes', recipe.id), data as any);
      } else {
        // 新食譜：用 setDoc 讓 Firestore doc ID = 我們的 UUID，避免 ID 不一致
        await setDoc(doc(db, 'recipes', saved.id), { ...data, id: saved.id });
      }
      setView('gallery');
      setEditingRecipe(null);
    } catch (err) {
      console.error('Save recipe error:', err);
      alert('儲存失敗，請再試一次');
    }
  }, [user]);

  const handleDeleteRecipe = useCallback(async (id: string) => {
    if (!window.confirm('確定要刪除此食譜嗎？')) return;
    storageManager.deleteRecipe(id);
    await deleteDoc(doc(db, 'recipes', id));
  }, []);

  const handleLogout = useCallback(async () => {
    await signOut(auth);
    setUser(null); setView('gallery');
    setRecipes([]); setInventory([]);
  }, []);

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
    </div>
  );

  if (!user) return <LoginScreen onLogin={() => {}} />;

  return (
    <AnimatePresence mode="wait">
      {view === 'gallery' && (
        <motion.div key="gallery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <RecipeGallery
            recipes={recipes}
            onSelectRecipe={(r) => { setSelectedRecipe(r); setView('detail'); }}
            onNewRecipe={() => { setEditingRecipe(newRecipeTemplate()); setView('edit'); }}
            onDeleteRecipe={handleDeleteRecipe}
            onLogout={handleLogout}
            onOpenInventory={() => setView('inventory')}
            onCompare={(selected) => { setCompareRecipes(selected); setView('compare'); }}
            onExportAll={() => {
              const data = JSON.stringify(recipes, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `魔法師的櫥櫃備份_${new Date().toLocaleDateString('zh-TW').replace(/\//g, '-')}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            onImportJSON={async (json) => {
              const data = JSON.parse(json);
              const recipes = Array.isArray(data) ? data : [data];
              for (const r of recipes) {
                const recipe: Recipe = {
                  title: r.title || '未命名食譜',
                  description: r.description || '',
                  mainCategory: r.mainCategory || '',
                  subCategory: r.subCategory || '',
                  series: r.series || '',
                  ingredients: (r.ingredients || []).map((i: any) => ({ ...i, id: crypto.randomUUID() })),
                  steps: (r.steps || []).map((s: any) => ({ ...s, id: crypto.randomUUID() })),
                  bakingStages: (r.bakingStages || []).map((b: any) => ({ ...b, id: crypto.randomUUID() })),
                  image: r.image || null,
                  notes: r.notes || '',
                };
                await handleSaveRecipe(recipe);
              }
              alert(`成功匯入 ${recipes.length} 個食譜！`);
            }}
          />
        </motion.div>
      )}
      {view === 'detail' && selectedRecipe && (
        <motion.div key="detail" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
          <RecipeDetail
            recipe={selectedRecipe}
            onEdit={() => { setEditingRecipe(selectedRecipe); setView('edit'); }}
            onBack={() => setView('gallery')}
            inventory={inventory}
          />
        </motion.div>
      )}
      {view === 'edit' && editingRecipe && (
        <motion.div key="edit" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
          <RecipeEditor
            recipe={editingRecipe}
            onSave={handleSaveRecipe}
            onCancel={() => setView(selectedRecipe ? 'detail' : 'gallery')}
            inventory={inventory}
            existingMainCats={[...new Set(recipes.map(r => r.mainCategory).filter(Boolean))] as string[]}
            existingSubCats={[...new Set(recipes.map(r => r.subCategory).filter(Boolean))] as string[]}
          />
        </motion.div>
      )}
      {view === 'inventory' && user && (
        <motion.div key="inventory" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
          <IngredientInventory
            inventory={inventory}
            onBack={() => setView('gallery')}
            userId={user.uid}
          />
        </motion.div>
      )}
      {view === 'compare' && compareRecipes.length >= 2 && (
        <motion.div key="compare" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
          <CompareView
            recipes={compareRecipes}
            inventory={inventory}
            onBack={() => setView('gallery')}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
