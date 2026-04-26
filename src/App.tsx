import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User
} from 'firebase/auth';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
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

type View = 'gallery' | 'detail' | 'edit' | 'inventory';

const MAIN_CATEGORIES = ['吐司 & 麵包', '蛋糕 & 烘焙', '餅乾 & 酥點', '泡芙 & 塔派', '中式糕點', '其他'];
const SUB_CATEGORIES: Record<string, string[]> = {
  '吐司 & 麵包': ['白吐司', '全麥吐司', '甜麵包', '歐式麵包', '其他'],
  '蛋糕 & 烘焙': ['戚風蛋糕', '海綿蛋糕', '磅蛋糕', '起司蛋糕', '其他'],
  '餅乾 & 酥點': ['奶油餅乾', '酥餅', '馬卡龍', '其他'],
  '泡芙 & 塔派': ['泡芙', '塔', '派', '其他'],
  '中式糕點': ['月餅', '鳳梨酥', '蛋黃酥', '其他'],
  '其他': ['其他'],
};

const newRecipeTemplate = (): Recipe => ({
  title: '', description: '', mainCategory: MAIN_CATEGORIES[0],
  subCategory: SUB_CATEGORIES[MAIN_CATEGORIES[0]][0],
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
function RecipeEditor({ recipe, onSave, onCancel, inventory }: {
  recipe: Recipe; onSave: (r: Recipe) => Promise<void>;
  onCancel: () => void; inventory: IngredientInventoryItem[];
}) {
  const [form, setForm] = useState<Recipe>(recipe);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setForm(p => ({ ...p, image: dataUrl }));
      if (window.confirm('要用 AI 自動辨識食譜內容嗎？')) {
        setAiLoading(true);
        try {
          const base64 = dataUrl.split(',')[1];
          const result = await extractRecipeFromImage(base64, file.type);
          setForm(p => ({
            ...p, ...result,
            ingredients: (result.ingredients || []).map((i: any) => ({ ...i, id: crypto.randomUUID() })),
            steps: (result.steps || []).map((s: any) => ({ ...s, id: crypto.randomUUID() })),
            bakingStages: (result.bakingStages || []).map((b: any) => ({ ...b, id: crypto.randomUUID() })),
          }));
        } catch { alert('AI 辨識失敗，請手動填寫。'); }
        finally { setAiLoading(false); }
      }
    };
    reader.readAsDataURL(file);
  };

  const addIngredient = () => setForm(p => ({ ...p, ingredients: [...p.ingredients, { id: crypto.randomUUID(), name: '', amount: 0, unit: 'g' }] }));
  const updateIngredient = (id: string, field: keyof Ingredient, value: any) =>
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
    try { await onSave(form); } finally { setSaving(false); }
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
          <div className="aspect-video bg-stone-100 relative cursor-pointer group" onClick={() => fileRef.current?.click()}>
            {form.image
              ? <img src={form.image} alt="食譜" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-stone-300">
                  <Upload className="w-10 h-10" /><span className="text-sm">點擊上傳食譜照片</span>
                </div>}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="bg-white/90 text-stone-800 px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-500" />上傳並 AI 辨識</span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </div>
        </div>

        {/* Basic Info */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100 space-y-4">
          <h3 className="font-bold text-stone-800">基本資訊</h3>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="食譜名稱 *" className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none text-xl font-bold" />
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="食譜描述..." rows={3} className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none resize-none" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-500 mb-1">主分類</label>
              <select value={form.mainCategory} onChange={e => setForm(p => ({ ...p, mainCategory: e.target.value, subCategory: SUB_CATEGORIES[e.target.value][0] }))}
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none">
                {MAIN_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-500 mb-1">次分類</label>
              <select value={form.subCategory} onChange={e => setForm(p => ({ ...p, subCategory: e.target.value }))}
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none">
                {(SUB_CATEGORIES[form.mainCategory] || []).map(c => <option key={c}>{c}</option>)}
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
            <button onClick={addIngredient} className="text-brand-500 text-sm font-bold flex items-center gap-1"><Plus className="w-4 h-4" />新增</button>
          </div>
          {form.ingredients.map((ing) => (
            <div key={ing.id} className="flex gap-2 items-center">
              <input list={`ing-list-${ing.id}`} value={ing.name} onChange={e => updateIngredient(ing.id, 'name', e.target.value)}
                placeholder="食材名稱" className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
              <datalist id={`ing-list-${ing.id}`}>
                {inventory.map(i => <option key={i.id} value={i.name} />)}
              </datalist>
              <input type="number" value={ing.amount || ''} onChange={e => updateIngredient(ing.id, 'amount', Number(e.target.value))}
                placeholder="份量" className="w-20 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
              <input value={ing.unit} onChange={e => updateIngredient(ing.id, 'unit', e.target.value)}
                placeholder="單位" className="w-14 bg-stone-50 border border-stone-200 rounded-xl px-2 py-2 text-sm text-center focus:ring-2 focus:ring-brand-500 outline-none" />
              <button onClick={() => removeIngredient(ing.id)} className="text-stone-300 hover:text-red-400"><X className="w-4 h-4" /></button>
            </div>
          ))}
          {totalCost > 0 && (
            <div className="mt-2 p-3 bg-emerald-50 rounded-xl text-sm font-bold text-emerald-700">
              估計材料成本：${totalCost.toFixed(1)}
            </div>
          )}
        </div>

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
function RecipeDetail({ recipe, onEdit, onBack }: { recipe: Recipe; onEdit: () => void; onBack: () => void }) {
  const printRef = React.useRef<HTMLDivElement>(null);

  const handleExportPDF = async () => {
    if (!printRef.current) return;
    const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height * w) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, w, h);
    pdf.save(`${recipe.title}.pdf`);
  };

  return (
    <div className="min-h-screen bg-stone-50 pb-24">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10 px-4 py-4 no-print">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button onClick={onBack} className="p-2 text-stone-400 hover:text-stone-600 rounded-full"><ChevronLeft className="w-6 h-6" /></button>
          <div className="flex gap-2">
            <button onClick={handleExportPDF} className="p-2 text-stone-400 hover:text-stone-600 rounded-full" title="匯出 PDF"><FileText className="w-5 h-5" /></button>
            <button onClick={() => window.print()} className="p-2 text-stone-400 hover:text-stone-600 rounded-full" title="列印"><Printer className="w-5 h-5" /></button>
            <button onClick={onEdit} className="bg-brand-500 text-white px-4 py-2 rounded-full font-bold text-sm hover:bg-brand-600">編輯</button>
          </div>
        </div>
      </header>

      <div ref={printRef} className="max-w-3xl mx-auto px-4 mt-8 space-y-6">
        {recipe.image && <img src={recipe.image} alt={recipe.title} className="w-full aspect-video object-cover rounded-3xl shadow-sm" />}
        <div>
          <div className="flex gap-2 mb-2">
            <span className="bg-brand-100 text-brand-600 text-xs font-bold px-3 py-1 rounded-full">{recipe.mainCategory}</span>
            <span className="bg-stone-100 text-stone-500 text-xs font-bold px-3 py-1 rounded-full">{recipe.subCategory}</span>
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
          <div className="space-y-2">
            {recipe.ingredients.map(ing => (
              <div key={ing.id} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                <span className="text-stone-700 font-medium">{ing.name}</span>
                <span className="text-stone-500 font-bold">{ing.amount} {ing.unit}</span>
              </div>
            ))}
          </div>
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
      const fbRecipes = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Recipe[];
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
      const fbItems = snap.docs.map(d => ({ id: d.id, ...d.data() })) as IngredientInventoryItem[];
      setInventory(fbItems);
    });
  }, [user]);

  const handleSaveRecipe = useCallback(async (recipe: Recipe) => {
    if (!user) return;
    const data = { ...recipe, userId: user.uid };
    const saved = storageManager.saveRecipe(data);
    if (recipe.id) {
      await updateDoc(doc(db, 'recipes', recipe.id), data as any);
    } else {
      await addDoc(collection(db, 'recipes'), { ...data, id: saved.id });
    }
    setView('gallery');
    setEditingRecipe(null);
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
          />
        </motion.div>
      )}
      {view === 'detail' && selectedRecipe && (
        <motion.div key="detail" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
          <RecipeDetail
            recipe={selectedRecipe}
            onEdit={() => { setEditingRecipe(selectedRecipe); setView('edit'); }}
            onBack={() => setView('gallery')}
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
    </AnimatePresence>
  );
}
