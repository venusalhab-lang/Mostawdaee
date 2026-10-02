import React, { useState } from 'react';
import { useFirebase } from './FirebaseProvider';
import { Product } from '../types';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { Trash2 } from 'lucide-react';
import { computeStockStatus } from '../lib/stock';

interface InventoryAssetsPanelProps {
  onClose: () => void;
  language: 'ar' | 'en';
}

export default function InventoryAssetsPanel({ onClose, language }: InventoryAssetsPanelProps) {
  const { products, saveProduct, deleteProduct } = useFirebase();
  const [activeTab, setActiveTab] = useState<'inventory' | 'assets' | 'wizard'>('inventory');
  const [newItem, setNewItem] = useState({ name: '', quantity: '', price: '', type: 'product' });

  const isRtl = language === 'ar';

  // Separation: products vs operational assets
  const commercialProducts = products.filter((p) => !p.type || p.type === 'product');
  const capitalAssets = products.filter((p) => p.type === 'asset');

  const handleQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name || !newItem.quantity) {
      toast.error(isRtl ? 'الرجاء تعبئة اسم الصنف والكمية المتاحة.' : 'Please fill out item description and quantity.');
      return;
    }

    const qty = Number(newItem.quantity);
    const priceVal = Number(newItem.price) || 0;

    if (qty < 0 || priceVal < 0) {
      toast.error(isRtl ? 'القيم لا يمكن أن تكون سالبة.' : 'Values cannot be negative.');
      return;
    }

    try {
      const productToSave: Product = {
        id: 'ITM-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
        name: newItem.name,
        sku: (newItem.type === 'asset' ? 'AST-' : 'SKU-') + Math.random().toString(36).substring(2, 6).toUpperCase(),
        category: newItem.type === 'asset' 
          ? (isRtl ? 'أصول تشغيلية' : 'Capital Assets') 
          : (isRtl ? 'سلع تجارية' : 'Commercial Goods'),
        brand: isRtl ? 'عام' : 'General',
        quantity: qty,
        unitCost: priceVal,
        sellingPrice: newItem.type === 'asset' ? 0 : priceVal * 1.25,
        status: computeStockStatus(qty),
        dateAdded: Date.now(),
        type: newItem.type as 'product' | 'asset'
      };

      await saveProduct(productToSave);

      toast.success(
        isRtl 
          ? `تم رصد وحفظ ${newItem.type === 'product' ? 'المنتج' : 'الأصل'} بنجاح في الوقت الفعلي!`
          : `Successfully registered ${newItem.type === 'product' ? 'product' : 'capital asset'} instantly!`
      );

      setNewItem({ name: '', quantity: '', price: '', type: 'product' });
      setActiveTab(newItem.type === 'asset' ? 'assets' : 'inventory');
    } catch (err) {
      console.error(err);
      toast.error(isRtl ? 'فشل إدخال البيانات اللحظية' : 'System failed to insert record');
    }
  };

  const handleDeleteItem = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(isRtl ? `هل أنت متأكد من شطب (${name}) من السجلات نهائياً؟` : `Are you sure you want to permanently delete (${name})?`)) {
      try {
        await deleteProduct(id);
        toast.success(isRtl ? 'تم الشطب اللحظي والمزامنة بنجاح' : 'Item deleted, synced in real-time');
      } catch (err) {
        toast.error(isRtl ? 'حدث خطأ أثناء الشطب' : 'Error deleting item');
      }
    }
  };

  return (
    <div className="panel-blur-overlay">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, z: -100 }}
        animate={{ scale: 1, opacity: 1, z: 50 }}
        className="panel-3d-container glass-card"
      >
        {/* هيدر اللوحة الداخلية وأزرار التنقل ثلاثية الأبعاد */}
        <header className="panel-header">
          <div className="panel-title-area">
            <h2>
              {isRtl ? "⚙️ منظومة إدارة المخزون والأصول" : "⚙️ Capital Inventory & Assets System"}
            </h2>
            <p>
              {isRtl 
                ? "التحكم المركزي السلس بالسلع التجارية والأصول الثابتة للمستودع" 
                : "Central real-time control of commercial merchandise and operational hardware"}
            </p>
          </div>
          
          <div className="panel-tabs-3d">
            <button 
              type="button"
              className={activeTab === 'inventory' ? 'tab-active' : ''} 
              onClick={() => setActiveTab('inventory')}
            >
              {isRtl ? "📦 جرد السلع الحركي" : "📦 Commercial goods"}
            </button>
            <button 
              type="button"
              className={activeTab === 'assets' ? 'tab-active' : ''} 
              onClick={() => setActiveTab('assets')}
            >
              {isRtl ? "🏗️ الأصول الرأسمالية" : "🏗️ Capital Assets"}
            </button>
            <button 
              type="button"
              className={activeTab === 'wizard' ? 'tab-active' : ''} 
              onClick={() => setActiveTab('wizard')}
            >
              {isRtl ? "⚡ المعالج السريع" : "⚡ Quick Wizard"}
            </button>
          </div>

          <button type="button" className="panel-close-btn" onClick={onClose}>
            {isRtl ? "✕ إغلاق" : "✕ Close"}
          </button>
        </header>

        {/* محتوى مراكز التحكم الداخلية بناءً على التبويب النشط */}
        <div className="panel-content-body custom-scrollbar">
          
          {/* مركز التحكم 1: جرد السلع */}
          {activeTab === 'inventory' && (
            <div className="sub-control-center fade-in">
              <div className="flex items-center justify-between mt-2 mb-4">
                <h3 className="text-white font-extrabold text-base">
                  {isRtl ? "قائمة جرد السلع التجارية الحالية" : "Current commercial stock tracking"}
                </h3>
                <span className="counter-badge">
                  {commercialProducts.length} {isRtl ? "صنف تجاري" : "products"}
                </span>
              </div>
              
              {commercialProducts.length === 0 ? (
                <div className="text-center py-16 bg-white/5 border border-dashed border-white/5 rounded-2xl">
                  <span className="text-3xl block mb-2">📦</span>
                  <p className="text-slate-400 text-xs font-bold">
                    {isRtl ? "لا توجد سلع تجارية مضافة حتى اللحظة." : "No commercial merchandise added yet."}
                  </p>
                </div>
              ) : (
                <div className="custom-table">
                  <div className="table-th text-slate-400">
                    <span>{isRtl ? "اسم المنتج" : "Commercial Item"}</span>
                    <span className="text-center">{isRtl ? "الكمية المتاحة" : "In Stock Qty"}</span>
                    <span className="text-center">{isRtl ? "سعر التكلفة" : "Unit Cost"}</span>
                    <span className="text-center">{isRtl ? "إجمالي القيمة" : "Capital Book Value"}</span>
                    <span className="text-center">{isRtl ? "إجراء" : "Action"}</span>
                  </div>
                  {commercialProducts.map(item => (
                    <div key={item.id} className="table-tr">
                      <span className="item-highlight font-black text-sm">{item.name}</span>
                      <span className="text-center">
                        <span className="qty-tag">{item.quantity} {isRtl ? "قطعة" : "units"}</span>
                      </span>
                      <span className="text-center font-mono text-slate-300">${(item.unitCost || 0).toLocaleString()}</span>
                      <span className="text-center total-val-tag font-mono">${((item.quantity || 0) * (item.unitCost || 0)).toLocaleString()}</span>
                      <span className="text-center">
                        <button 
                          type="button"
                          onClick={(e) => handleDeleteItem(e, item.id, item.name)}
                          className="p-1 px-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg text-xs transition cursor-pointer inline-flex items-center gap-1"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                          {isRtl ? "شطب" : "Delete"}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* مركز التحكم 2: الأصول الرأسمالية والمعدات */}
          {activeTab === 'assets' && (
            <div className="sub-control-center fade-in">
              <div className="flex items-center justify-between mt-2 mb-4">
                <h3 className="text-white font-extrabold text-base">
                  {isRtl ? "تتبع الأصول والمعدات التشغيلية للمستودع" : "Warehouse Capital Hardware & Heavy Assets"}
                </h3>
                <span className="counter-badge asset-purple">
                  {capitalAssets.length} {isRtl ? "أصل ثابت" : "capital assets"}
                </span>
              </div>

              {capitalAssets.length === 0 ? (
                <div className="text-center py-16 bg-white/5 border border-dashed border-white/5 rounded-2xl">
                  <span className="text-3xl block mb-2">🏗️</span>
                  <p className="text-slate-400 text-xs font-bold">
                    {isRtl ? "مستند الأصول فارغ حالياً. استخدم معالج المعاملات للاستثمار والإدراج!" : "No capital assets currently logged. Use the Wizard to insert operational items."}
                  </p>
                </div>
              ) : (
                <div className="custom-table">
                  <div className="table-th text-slate-400">
                    <span>{isRtl ? "بيان الأصل الرأسمالي" : "Asset Description"}</span>
                    <span className="text-center">{isRtl ? "الحالة التشغيلية" : "Operational Status"}</span>
                    <span className="text-center">{isRtl ? "الكمية / العدد" : "Quantity"}</span>
                    <span className="text-center">{isRtl ? "القيمة الدفترية" : "Capital Book Value"}</span>
                    <span className="text-center">{isRtl ? "إجراء" : "Action"}</span>
                  </div>
                  {capitalAssets.map(item => (
                    <div key={item.id} className="table-tr">
                      <span className="item-highlight text-purple-300 font-extrabold flex items-center gap-2">
                        <span>🏗️</span>
                        {item.name}
                      </span>
                      <span className="text-center">
                        <span className="status-badge-green">
                          {isRtl ? "ممتازة (نشط)" : "Excellent (Active)"}
                        </span>
                      </span>
                      <span className="text-center text-white">{item.quantity}</span>
                      <span className="text-center total-val-tag font-mono text-purple-400">${((item.quantity || 1) * (item.unitCost || 0)).toLocaleString()}</span>
                      <span className="text-center">
                        <button 
                          type="button"
                          onClick={(e) => handleDeleteItem(e, item.id, item.name)}
                          className="p-1 px-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg text-xs transition cursor-pointer inline-flex items-center gap-1"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                          {isRtl ? "شطب" : "Delete"}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* مركز التحكم 3: معالج المعاملات السريع (الإدخال الذكي) */}
          {activeTab === 'wizard' && (
            <div className="sub-control-center wizard-center fade-in">
              <div className="wizard-card-3d">
                <h3 className="mb-4 text-white font-extrabold text-base text-center">
                  {isRtl ? "إجراء حركة مخزنية سريعة" : "Instant Inventory Registry Wizard"}
                </h3>
                
                <form onSubmit={handleQuickSubmit} className="wizard-form">
                  <div className="input-group-grid">
                    
                    <div className="form-field">
                      <label className="font-extrabold text-xs text-slate-400">
                        {isRtl ? "نوع الإضافة" : "Input Type"}
                      </label>
                      <select 
                        value={newItem.type} 
                        onChange={(e) => setNewItem({ ...newItem, type: e.target.value })}
                        className="cursor-pointer"
                      >
                        <option value="product">📦 {isRtl ? "منتج تجاري (للبيع والصرف)" : "Commercial merchandise"}</option>
                        <option value="asset">🏗️ {isRtl ? "أصل رأسمالي (معدات وبنية تحتية)" : "Capital Asset"}</option>
                      </select>
                    </div>

                    <div className="form-field">
                      <label className="font-extrabold text-xs text-slate-400">
                        {isRtl ? "الاسم / البيان" : "Label Description"}
                      </label>
                      <input 
                        type="text" 
                        placeholder={newItem.type === 'asset' ? (isRtl ? "مثال: رافعة شوكية Toyota أو شاشات LED" : "e.g., Toyota Forklift or LED board") : (isRtl ? "مثال: مكيف هواء صحراوي أو حاويات تخزين" : "e.g., Storage container")} 
                        value={newItem.name} 
                        onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} 
                        required 
                      />
                    </div>

                    <div className="form-field">
                      <label className="font-extrabold text-xs text-slate-400">
                        {isRtl ? "الكمية / العدد" : "Quantity"}
                      </label>
                      <input 
                        type="number" 
                        min="1"
                        placeholder="0" 
                        value={newItem.quantity} 
                        onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })} 
                        required 
                      />
                    </div>

                    <div className="form-field">
                      <label className="font-extrabold text-xs text-slate-400">
                        {isRtl ? "التكلفة التقديرية للأصل ($)" : "Capital evaluation cost ($)"}
                      </label>
                      <input 
                        type="number" 
                        min="0"
                        step="any"
                        placeholder="0.00" 
                        value={newItem.price} 
                        onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} 
                      />
                    </div>

                  </div>
                  
                  <button type="submit" className="submit-btn-3d">
                    {isRtl ? "⚡ تنفيذ الحركة وحقن البيانات فوراً" : "⚡ Execute Injection & Match Asset"}
                  </button>
                </form>
              </div>
            </div>
          )}

        </div>
      </motion.div>
    </div>
  );
}
