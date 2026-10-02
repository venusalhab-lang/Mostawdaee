import React, { useState } from 'react';
import { 
  Building2, 
  Search, 
  MapPin, 
  Calendar, 
  Trash2, 
  Edit2, 
  Plus, 
  ChevronRight, 
  ChevronDown, 
  FileBox, 
  Coins, 
  Boxes,
  X,
  ArrowRightLeft
} from 'lucide-react';
import { Language, Warehouse, Product, AppSettings } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { useFirebase } from './FirebaseProvider';
import { TactileButton } from './ui/TactileButton';
import { toast } from 'sonner';

interface Props {
  language: Language;
  settings: AppSettings;
}

export default function WarehouseManagement({ language, settings }: Props) {
  const isRtl = language === 'ar';
  const { 
    warehouses = [], 
    products = [], 
    saveWarehouse, 
    deleteWarehouse,
    saveProduct 
  } = useFirebase();

  // Dialog and Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'MAIN' | 'SUB'>('ALL');

  // Form Fields State
  const [formData, setFormData] = useState<Partial<Warehouse>>({
    name: '',
    location: '',
    parentId: null
  });

  // Transfer stock fields
  const [transferProductId, setTransferProductId] = useState('');
  const [transferQty, setTransferQty] = useState<number>(0);
  const [transferFromWarehouseId, setTransferFromWarehouseId] = useState('');
  const [transferToWarehouseId, setTransferToWarehouseId] = useState('');

  // Arabic Text Normalizer
  function normalizeText(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .trim()
      .replace(/[أإآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[َُِّّْ]/g, '');
  }

  // Bilingual translation map
  const t = {
    title: isRtl ? 'إدارة المستودعات والمخازن' : 'Warehouse & Storage Management',
    subtitle: isRtl ? 'هيكلة وإدارة المخازن الرئيسية والفرعية، تتبع بضاعة كل مستودع والتحويل البيني' : 'Structure and manage main & branch warehouses, trace physical items, and transfer stock',
    addWarehouse: isRtl ? 'إنشاء مستودع جديد' : 'Create New Warehouse',
    editWarehouse: isRtl ? 'تعديل بيانات المستودع' : 'Edit Warehouse Details',
    warehouseName: isRtl ? 'اسم المستودع' : 'Warehouse Name',
    locationOpt: isRtl ? 'الموقع الجغرافي / العنوان (اختياري)' : 'Geographical Location (Optional)',
    typeLabel: isRtl ? 'طبيعة المستودع' : 'Warehouse Class',
    mainClass: isRtl ? 'مستودع رئيسي مستقل' : 'Independent Main Warehouse',
    subClass: isRtl ? 'مستودع فرعي متفرع' : 'Subordinate Branch Warehouse',
    parentSelect: isRtl ? 'تابع للمستودع الرئيسي' : 'Belongs to Main Warehouse',
    searchPlaceholder: isRtl ? 'ابحث عن مستودع بالاسم أو الموقع...' : 'Search warehouse by name or address...',
    allTypes: isRtl ? 'جميع المستودعات' : 'All Warehouses',
    mainOnly: isRtl ? 'الرئيسية فقط' : 'Main Only',
    subOnly: isRtl ? 'الفرعية فقط' : 'Branch Only',
    noWarehouses: isRtl ? 'لا توجد مستودعات مطابقة' : 'No matching warehouses found',
    noWarehousesDesc: isRtl ? 'يرجى تسجيل مستودعك الأول للبدء في توزيع أصناف بضاعتك وهيكلتها.' : 'Please register your first warehouse to begin category and stock load distribution.',
    itemCount: isRtl ? 'صنف فريد' : 'unique items',
    totalQty: isRtl ? 'إجمالي القطع المخزنة' : 'aggregate stock volume',
    totalVal: isRtl ? 'القيمة التقديرية للمخزون' : 'estimated value in storage',
    deleteConfirm: isRtl ? 'هل أنت متأكد من حذف هذا المستودع؟ سيتحول تبعية المستودعات الفرعية إلى مستقلة.' : 'Are you sure you want to delete this warehouse? Attached branch warehouses will decouple.',
    saveBtn: isRtl ? 'حفظ البيانات' : 'Commit Configuration',
    cancelBtn: isRtl ? 'إلغاء' : 'Cancel',
    mainWarehouse: isRtl ? 'مستودع رئيسي' : 'Main Warehouse',
    subWarehouse: isRtl ? 'مستودع فرعي تابع لـ' : 'Branch under',
    stockTransfer: isRtl ? 'تحويل مخزون بيني' : 'Stock Transfer',
    transferSuccess: isRtl ? 'تمت عملية تحويل المخزون بنجاح!' : 'Stock successfully transferred between warehouses!',
    selectProduct: isRtl ? 'حدد الصنف للتحويل' : 'Select item to transfer',
    qtyToTransfer: isRtl ? 'الكمية المراد نقلها' : 'Stock count to move',
    fromWh: isRtl ? 'من المستودع' : 'From Warehouse',
    toWh: isRtl ? 'إلى المستودع' : 'To Warehouse',
    transferAction: isRtl ? 'تنفيذ التحويل البيني' : 'Execute Transfer',
    availableQty: isRtl ? 'الكمية المتاحة في هذا المستودع' : 'Available size in source',
    unitsPlural: isRtl ? 'وحدة' : 'units'
  };

  // Open modal for registration / editing
  const handleOpenModal = (wh: Warehouse | null = null) => {
    if (wh) {
      setEditingWarehouse(wh);
      setFormData({
        name: wh.name,
        location: wh.location || '',
        parentId: wh.parentId
      });
    } else {
      setEditingWarehouse(null);
      setFormData({
        name: '',
        location: '',
        parentId: null
      });
    }
    setIsModalOpen(true);
  };

  // Process saving
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      toast.error(isRtl ? 'الرجاء إدخال اسم المستودع' : 'Please provide a valid warehouse name');
      return;
    }

    const id = editingWarehouse ? editingWarehouse.id : `WH_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const newWarehouse: Warehouse = {
      id,
      name: formData.name.trim(),
      location: formData.location?.trim() || '',
      parentId: formData.parentId || null,
      createdAt: editingWarehouse ? editingWarehouse.createdAt : Date.now()
    };

    try {
      await saveWarehouse(newWarehouse);
      toast.success(isRtl ? 'تم حفظ بيانات المستودع بنجاح' : 'Warehouse configuration secured successfully');
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(isRtl ? 'حدث خطأ أثناء حفظ البيانات' : 'Failed to write warehouse data');
    }
  };

  // Handle warehouse deletion
  const handleDelete = async (id: string) => {
    if (!window.confirm(t.deleteConfirm)) return;

    try {
      // 1. Clean up sub-warehouses that refer to this parent
      const childWarehouses = warehouses.filter(w => w.parentId === id);
      for (const child of childWarehouses) {
        await saveWarehouse({
          ...child,
          parentId: null
        });
      }

      // 2. Remove warehouse info from products
      const attachedProducts = products.filter(p => p.warehouseId === id);
      for (const prod of attachedProducts) {
        await saveProduct({
          ...prod,
          warehouseId: undefined
        });
      }

      await deleteWarehouse(id);
      toast.success(isRtl ? 'تم حذف المستودع بنجاح' : 'Warehouse record decommissioned safely');
    } catch (err) {
      console.error(err);
      toast.error(isRtl ? 'فشل إتمام العملية' : 'Error deleting warehouse');
    }
  };

  // Execute Stock Transfer between Warehouses
  const handleStockTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferProductId) {
      toast.error(isRtl ? 'الرجاء اختيار المنتج أولاً' : 'Please select a product target first');
      return;
    }
    if (transferFromWarehouseId === transferToWarehouseId) {
      toast.error(isRtl ? 'لا يمكن النقل لنفس المستودع' : 'Cannot transfer within the same warehouse');
      return;
    }
    if (transferQty <= 0) {
      toast.error(isRtl ? 'الرجاء تحديد كمية نقل صالحة وبقيمة أكبر من صفر' : 'Please enter a quantity greater than zero');
      return;
    }

    const targetProduct = products.find(p => p.id === transferProductId);
    if (!targetProduct) {
      toast.error(isRtl ? 'المنتج غير موجود' : 'Specified product not found');
      return;
    }

    // Verify quantity in source warehouse
    // If the product is assigned back to of the starting warehouse
    const currentWhId = targetProduct.warehouseId || '';
    if (currentWhId !== transferFromWarehouseId) {
      toast.error(isRtl ? 'المنتج المحدد غير مخصص لهذا المستودع حالياً' : 'Product is not currently allocated to the source warehouse');
      return;
    }

    if (targetProduct.quantity < transferQty) {
      toast.error(isRtl ? 'الكمية المخزنة المطروحة للنقل أكبر من رصيد المنتج المتاح' : 'Quantity exceeds inventory limit in source');
      return;
    }

    try {
      // Since a product is a simple entity assigning its warehouseId,
      // moving a portion splits the product or completely re-assigns its warehouse.
      // If moving all quantity, we can simply re-assign warehouseId.
      // If moving a part, we can adjust the source product's quantity, and create/update
      // a product duplicate marked for the new warehouse. This is realistic!
      const remainingQty = targetProduct.quantity - transferQty;
      
      // Update original product quantity
      if (remainingQty === 0) {
        // Just change the warehouse destination for the product
        await saveProduct({
          ...targetProduct,
          warehouseId: transferToWarehouseId
        });
      } else {
        // Adjust original item down
        await saveProduct({
          ...targetProduct,
          quantity: remainingQty
        });

        // Add or merge into the destination warehouse
        const matchingDupe = products.find(p => p.sku === targetProduct.sku && p.warehouseId === transferToWarehouseId);
        if (matchingDupe) {
          await saveProduct({
            ...matchingDupe,
            quantity: matchingDupe.quantity + transferQty
          });
        } else {
          // Create new split item record
          const splitId = `PROD_SPLIT_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
          await saveProduct({
            ...targetProduct,
            id: splitId,
            quantity: transferQty,
            warehouseId: transferToWarehouseId,
            dateAdded: Date.now()
          });
        }
      }

      toast.success(t.transferSuccess);
      setIsTransferModalOpen(false);
      setTransferProductId('');
      setTransferQty(0);
    } catch (err) {
      console.error(err);
      toast.error(isRtl ? 'حدث خطأ غير متوقع أثناء نقل المخزون' : 'Internal error executing stock split');
    }
  };

  // Compute metrics for a warehouse
  const getWarehouseStats = (warehouseId: string) => {
    const attachedProds = products.filter(p => p.warehouseId === warehouseId);
    const uniqueItemsCount = attachedProds.length;
    const totalCount = attachedProds.reduce((sum, p) => sum + p.quantity, 0);
    const estimatedValue = attachedProds.reduce((sum, p) => sum + (p.quantity * p.unitCost), 0);

    return {
      uniqueItemsCount,
      totalCount,
      estimatedValue
    };
  };

  // Normalized search filtration
  const filteredWarehouses = warehouses.filter(wh => {
    const term = normalizeText(searchQuery);
    const matchesQuery = normalizeText(wh.name).includes(term) || normalizeText(wh.location || '').includes(term);
    
    const isMain = !wh.parentId;
    if (typeFilter === 'MAIN') return matchesQuery && isMain;
    if (typeFilter === 'SUB') return matchesQuery && !isMain;
    return matchesQuery;
  });

  // Top level Main Warehouses listing for hierarchy drawing
  const mainWarehouses = warehouses.filter(w => !w.parentId);
  
  // Potential parent options (must be main warehouse and not itself)
  const parentOptions = mainWarehouses.filter(w => !editingWarehouse || w.id !== editingWarehouse.id);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header section with sleek bento layout dashboard styling */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-br from-indigo-500/5 via-indigo-500/0 to-transparent p-6 rounded-[2.5rem] border border-slate-200/40 dark:border-slate-800/40 dark:from-slate-8 w-full">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl text-indigo-600 dark:text-indigo-400">
              <Building2 size={28} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{t.title}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.subtitle}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
          <TactileButton 
            onClick={() => setIsTransferModalOpen(true)}
            variant="secondary" 
            className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-5 py-3 rounded-2xl font-bold w-full md:w-auto text-sm transition-all shadow-sm"
          >
            <ArrowRightLeft size={18} />
            <span>{t.stockTransfer}</span>
          </TactileButton>

          <TactileButton 
            onClick={() => handleOpenModal(null)}
            variant="primary" 
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-2xl font-bold w-full md:w-auto text-sm transition-all shadow-md shadow-indigo-600/10"
          >
            <Plus size={18} />
            <span>{t.addWarehouse}</span>
          </TactileButton>
        </div>
      </div>

      {/* Analytics Bento Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-200/50 dark:border-slate-800/50 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{isRtl ? 'المستودعات الإجمالية' : 'Total Warehouses'}</span>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{warehouses.length}</div>
          </div>
          <div className="p-4 bg-blue-50 dark:bg-blue-950/40 rounded-2xl text-blue-600 dark:text-blue-400">
            <Building2 size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-200/50 dark:border-slate-800/50 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{isRtl ? 'أصناف موزعة' : 'Distributed Categories'}</span>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{products.filter(p => !!p.warehouseId).length}</div>
          </div>
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl text-emerald-600 dark:text-emerald-400">
            <Boxes size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-200/50 dark:border-slate-800/50 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{isRtl ? 'أخرى غير مخصصة' : 'Unallocated Items'}</span>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{products.filter(p => !p.warehouseId).length}</div>
          </div>
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 rounded-2xl text-amber-600 dark:text-amber-400">
            <FileBox size={24} />
          </div>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/50 dark:border-slate-800/50 shadow-sm flex flex-col sm:flex-row gap-4 items-center">
        <div className="relative w-full sm:flex-1">
          <Search className="absolute right-3.5 top-3.5 h-4 w-4 text-slate-400" />
          <input 
            type="text" 
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100/50 dark:hover:bg-slate-800/60 transition focus:bg-white dark:focus:bg-slate-950 outline-none border border-slate-200/30 dark:border-slate-700/30 focus:border-indigo-500 rounded-2xl py-2.5 pr-10 pl-4 text-sm font-medium"
          />
        </div>

        <div className="flex gap-2 self-stretch shrink-0">
          {(['ALL', 'MAIN', 'SUB'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`flex-1 sm:flex-initial text-xs font-bold px-4 py-3 rounded-xl transition cursor-pointer select-none border border-transparent ${
                typeFilter === type
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/80'
              }`}
            >
              {type === 'ALL' && t.allTypes}
              {type === 'MAIN' && t.mainOnly}
              {type === 'SUB' && t.subOnly}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid View */}
      {filteredWarehouses.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-900 rounded-[2.5rem] border border-dashed border-slate-200 dark:border-slate-800 text-center">
          <div className="p-5 bg-indigo-50 dark:bg-indigo-950/20 rounded-[2rem] text-indigo-500 mb-4 animate-pulse">
            <Building2 size={44} />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t.noWarehouses}</h3>
          <p className="text-sm text-slate-500 max-w-md leading-relaxed">{t.noWarehousesDesc}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredWarehouses.map((wh) => {
            const stats = getWarehouseStats(wh.id);
            const isSub = !!wh.parentId;
            const parentWh = warehouses.find(w => w.id === wh.parentId);

            return (
              <motion.div
                key={wh.id}
                layout
                className="bg-white dark:bg-slate-900 rounded-[2.2rem] border border-slate-200/50 dark:border-slate-800/50 p-6 flex flex-col justify-between shadow-sm hover:shadow-md transition-all group relative overflow-hidden"
              >
                {/* Subtle colored flag in header */}
                <div className={`absolute top-0 right-0 left-0 h-1.5 ${isSub ? 'bg-amber-400' : 'bg-indigo-600'}`} />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider ${
                      isSub 
                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' 
                        : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400'
                    }`}>
                      {isSub ? `${t.subWarehouse} : ${parentWh?.name || ''}` : t.mainWarehouse}
                    </span>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleOpenModal(wh)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-500 hover:text-indigo-600 dark:text-slate-400 transition"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(wh.id)}
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl text-slate-400 hover:text-red-600 transition"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-snug">{wh.name}</h3>
                    {wh.location && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                        <MapPin size={13} className="shrink-0" />
                        <span className="truncate">{wh.location}</span>
                      </div>
                    )}
                  </div>

                  {/* Micro Indicators */}
                  <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/60">
                    <div className="space-y-0.5 text-center">
                      <Boxes className="h-4 w-4 text-slate-400 mx-auto" />
                      <div className="text-xs font-bold text-slate-900 dark:text-white mt-1">{stats.uniqueItemsCount}</div>
                      <div className="text-[9px] font-medium text-slate-400">{t.itemCount}</div>
                    </div>

                    <div className="space-y-0.5 text-center">
                      <FileBox className="h-4 w-4 text-slate-400 mx-auto" />
                      <div className="text-xs font-bold text-slate-900 dark:text-white mt-1">{stats.totalCount}</div>
                      <div className="text-[9px] font-medium text-slate-400">{isRtl ? 'قطعة معبأة' : 'items stored'}</div>
                    </div>

                    <div className="space-y-0.5 text-center">
                      <Coins className="h-4 w-4 text-slate-400 mx-auto" />
                      <div className="text-xs font-bold text-slate-900 dark:text-white mt-1">
                        {stats.estimatedValue.toLocaleString()} {settings.currency || 'ILS'}
                      </div>
                      <div className="text-[9px] font-medium text-slate-400">{isRtl ? 'ملخص القيمة' : 'stored valuation'}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800/40 flex justify-between items-center text-[10px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={12} />
                    <span>{new Date(wh.createdAt).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}</span>
                  </div>
                  <div>ID: {wh.id.substring(wh.id.length - 6)}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Main Form Dialog Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-950/30 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200/50 dark:border-slate-800/50 shadow-2xl p-6 sm:p-8 overflow-hidden z-10"
              style={{ maxHeight: '90vh', overflowY: 'auto' }}
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {editingWarehouse ? t.editWarehouse : t.addWarehouse}
                </h3>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-full transition"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    {t.warehouseName} *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={isRtl ? 'أدخل اسم المستودع (مثال: مخزن رقم 1)' : 'e.g. Primary Storage Depot'}
                    className="w-full bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100/60 dark:hover:bg-slate-800/70 border border-slate-200/50 dark:border-slate-700/50 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-950 outline-none rounded-2xl px-4 py-3 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    {t.locationOpt}
                  </label>
                  <input
                    type="text"
                    value={formData.location || ''}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder={isRtl ? 'المنطقة الصناعية، نابلس' : 'e.g. Industrial District, Zone 7'}
                    className="w-full bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100/60 dark:hover:bg-slate-800/70 border border-slate-200/50 dark:border-slate-700/50 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-950 outline-none rounded-2xl px-4 py-3 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition font-medium"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    {t.typeLabel}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, parentId: null })}
                      className={`py-3.5 px-4 rounded-2xl text-xs font-extrabold border-2 transition text-center flex flex-col items-center gap-1.5 cursor-pointer ${
                        formData.parentId === null
                          ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400'
                          : 'border-slate-200/50 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/40'
                      }`}
                    >
                      <Building2 size={16} />
                      <span>{t.mainClass}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        // Select the first parent if none set yet
                        const defaultParent = parentOptions[0]?.id || '';
                        setFormData({ ...formData, parentId: defaultParent });
                      }}
                      className={`py-3.5 px-4 rounded-2xl text-xs font-extrabold border-2 transition text-center flex flex-col items-center gap-1.5 cursor-pointer ${
                        formData.parentId !== null
                          ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400'
                          : 'border-slate-200/50 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/40'
                      }`}
                      disabled={parentOptions.length === 0}
                    >
                      <Boxes size={16} />
                      <span>{t.subClass}</span>
                    </button>
                  </div>
                  {parentOptions.length === 0 && (
                    <p className="text-[10px] text-amber-500 font-bold mt-1.5 block">
                      {isRtl ? '* لا توجد مستودعات رئيسية متوفرة لربطها حالياً.' : '* No main warehouses exist to establish child bounds.'}
                    </p>
                  )}
                </div>

                {formData.parentId !== null && parentOptions.length > 0 && (
                  <div className="space-y-1.5 animate-slide-up">
                    <label className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                      {t.parentSelect}
                    </label>
                    <select
                      value={formData.parentId || ''}
                      onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100/60 dark:hover:bg-slate-800/70 border border-slate-200/50 dark:border-slate-700/50 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-950 outline-none rounded-2xl px-4 py-3 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition font-bold"
                    >
                      {parentOptions.map((main) => (
                        <option key={main.id} value={main.id} className="text-slate-900 bg-white dark:bg-slate-900 dark:text-white">
                          {main.name} {main.location ? `(${main.location})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <TactileButton
                    type="submit"
                    variant="primary"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl py-3.5 font-bold transition shadow-md shadow-indigo-600/10"
                  >
                    {t.saveBtn}
                  </TactileButton>

                  <TactileButton
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    variant="secondary"
                    className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl py-3.5 font-bold transition"
                  >
                    {t.cancelBtn}
                  </TactileButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Stock Transfer Between Warehouses Dialog Modal */}
      <AnimatePresence>
        {isTransferModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsTransferModalOpen(false)}
              className="absolute inset-0 bg-slate-950/30 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200/50 dark:border-slate-800/50 shadow-2xl p-6 sm:p-8 overflow-hidden z-10"
              style={{ maxHeight: '90vh', overflowY: 'auto' }}
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ArrowRightLeft className="text-indigo-600 dark:text-indigo-400" size={20} />
                  <span>{t.stockTransfer}</span>
                </h3>
                <button 
                  onClick={() => setIsTransferModalOpen(false)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-full transition"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleStockTransfer} className="space-y-5">
                {/* Select Product */}
                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    {t.selectProduct} *
                  </label>
                  <select
                    required
                    value={transferProductId}
                    onChange={(e) => {
                      const selProdId = e.target.value;
                      setTransferProductId(selProdId);
                      const currentSelected = products.find(p => p.id === selProdId);
                      if (currentSelected) {
                        setTransferFromWarehouseId(currentSelected.warehouseId || '');
                      }
                    }}
                    className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 focus:border-indigo-500 outline-none rounded-2xl px-4 py-3 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition font-bold"
                  >
                    <option value="">-- {t.selectProduct} --</option>
                    {products.map((p) => {
                      const attachedWh = warehouses.find(w => w.id === p.warehouseId);
                      const whName = attachedWh ? attachedWh.name : (isRtl ? 'غير مصنف' : 'Unspecified');
                      return (
                        <option key={p.id} value={p.id} className="text-slate-900 bg-white dark:bg-slate-900 dark:text-white">
                          [{p.sku}] {p.name} - ({whName}) - Qty: {p.quantity} {t.unitsPlural}
                        </option>
                      )
                    })}
                  </select>
                </div>

                {/* Grid of Source and Destination */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* From Warehouse (Locked based on selected active product location) */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-extrabold text-slate-400 uppercase tracking-wider block">
                      {t.fromWh}
                    </label>
                    <select
                      disabled
                      value={transferFromWarehouseId}
                      className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200/30 dark:border-slate-700/30 outline-none rounded-2xl px-4 py-3 text-slate-500 font-bold opacity-75 cursor-not-allowed"
                    >
                      <option value="">{isRtl ? 'غير مصنف / رئيسي' : 'Unspecified / Main Office'}</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* To Warehouse */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                      {t.toWh} *
                    </label>
                    <select
                      required
                      value={transferToWarehouseId}
                      onChange={(e) => setTransferToWarehouseId(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 focus:border-indigo-500 outline-none rounded-2xl px-4 py-3 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition font-bold"
                    >
                      <option value="">-- {isRtl ? 'اختر المستودع المستهدف' : 'Select target warehouse'} --</option>
                      {/* Blank Option if they want to clear allocation to general */}
                      <option value="" className="text-slate-900 bg-white dark:bg-slate-900 dark:text-white">
                        {isRtl ? 'المقر العام (غير مصنف)' : 'General Headquarters (Unallocated)'}
                      </option>
                      {warehouses
                        .filter(w => w.id !== transferFromWarehouseId)
                        .map((w) => (
                          <option key={w.id} value={w.id} className="text-slate-900 bg-white dark:bg-slate-900 dark:text-white">
                            {w.name} {w.location ? `(${w.location})` : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Transfer Quantity */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-extrabold text-slate-400 block uppercase tracking-wider">
                    <span>{t.qtyToTransfer} *</span>
                    {transferProductId && (
                      <span className="text-indigo-600 dark:text-indigo-400">
                        {t.availableQty}: {products.find(p => p.id === transferProductId)?.quantity || 0}
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    required
                    min={1}
                    value={transferQty || ''}
                    name="qty"
                    onChange={(e) => setTransferQty(parseInt(e.target.value) || 0)}
                    placeholder="e.g. 100"
                    className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-950 outline-none rounded-2xl px-4 py-3 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition font-bold"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <TactileButton
                    type="submit"
                    variant="primary"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl py-3.5 font-bold transition shadow-md shadow-indigo-600/10"
                  >
                    {t.transferAction}
                  </TactileButton>

                  <TactileButton
                    type="button"
                    onClick={() => setIsTransferModalOpen(false)}
                    variant="secondary"
                    className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl py-3.5 font-bold transition"
                  >
                    {t.cancelBtn}
                  </TactileButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
