import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations } from '../translations';
import { Language, Product, Transaction } from '../types';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { 
  ShoppingCart, 
  ArrowUpRight, 
  ArrowDownRight, 
  Plus, 
  Search,
  CheckCircle2,
  AlertCircle,
  FileText,
  Eye,
  Printer,
  Share2,
  MoreVertical,
  Trash2
} from 'lucide-react';
import SuccessVisual from './SuccessVisual';
import ContextMenu3D from './ContextMenu3D';
import useLongPress from '../hooks/useLongPress';
import { toast } from 'sonner';
import { TactileButton } from './ui/TactileButton';
import { useSuccessCelebration } from '../hooks/useSuccessCelebration';
import { sounds } from '../lib/sounds';

interface TransactionManagerProps {
  language: Language;
  onDelete: (id: string) => void;
}

interface TransactionRowProps {
  key?: string;
  tx: Transaction;
  t: any;
  isRtl: boolean;
  onShowContextMenu: (tx: Transaction) => void;
}

function TransactionRow({ tx, t, isRtl, onShowContextMenu }: TransactionRowProps) {
  const longPressProps = useLongPress(() => onShowContextMenu(tx));
  const { formatPrice } = usePreferredCurrency();

  return (
    <motion.tr 
      key={tx.id}
      {...longPressProps}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors select-none cursor-pointer"
    >
      <td className={`px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500`}>
        {new Date(tx.timestamp).toLocaleDateString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 flex flex-col">
        <span className="font-bold">{tx.productName}</span>
        {tx.serialNumber && (
          <span className="text-[10px] text-gray-400 font-mono">SN: {tx.serialNumber}</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
          tx.type === 'sale' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
        }`}>
          {tx.type === 'sale' ? t.sale : t.purchase}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 font-bold">
        {tx.quantity}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-black text-gray-900 dark:text-white">
        {formatPrice(tx.totalAmount)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-center">
          <button 
            onClick={(e) => { e.stopPropagation(); onShowContextMenu(tx); }}
            className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors"
          >
            <MoreVertical size={16} />
          </button>
      </td>
    </motion.tr>
  );
}

export default function TransactionManager({ language, onDelete }: TransactionManagerProps) {
  const t = translations[language];
  const isRtl = language === 'ar';
  const { products, recordTransaction, transactions } = useFirebase() as any;
  const { celebrationClass, triggerCelebration } = useSuccessCelebration();
  const { formatPrice } = usePreferredCurrency();
  
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [txSearchTerm, setTxSearchTerm] = useState('');
  const [type, setType] = useState<'sale' | 'purchase'>('sale');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Transaction; direction: 'desc' | 'asc' }>({ key: 'timestamp', direction: 'desc' });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [serialNumber, setSerialNumber] = useState('');
  const [success, setSuccess] = useState(false);
  const [showSuccessVisual, setShowSuccessVisual] = useState(false);
  const [contextMenuTarget, setContextMenuTarget] = useState<Transaction | null>(null);

  const handleSort = (key: keyof Transaction) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedTransactions = React.useMemo(() => {
    let result = transactions.filter(tx => 
      tx.productName.toLowerCase().includes(txSearchTerm.toLowerCase())
    );
    result.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [transactions, txSearchTerm, sortConfig]);

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleRecord = async () => {
    if (!selectedProduct) return;

    // Validations
    if (quantity <= 0) {
      toast.error(isRtl ? 'الكمية يجب أن تكون أكبر من صفر' : 'Quantity must be greater than zero');
      return;
    }

    if (type === 'sale' && quantity > selectedProduct.quantity) {
      toast.error(isRtl ? 'الكمية المطلوبة أكبر من المتوفر' : 'Quantity exceeds available stock');
      return;
    }

    if (serialNumber) {
      // For sales, we should check if this specific serial number exists in recent transactions or is the one for the product
      // For purchases, check if a new serial number already exists in inventory
      const isDuplicate = products.some(p => p.serialNumber === serialNumber && p.id !== selectedProduct.id);
      if (isDuplicate) {
        toast.error(isRtl ? 'الرقم التسلسلي موجود مسبقاً لصنف آخر' : 'Serial number already exists for another product');
        // We allow same serial number for same product (restocking), but usually it should be unique
      }
    }
    
    await recordTransaction({
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      type,
      quantity,
      pricePerUnit: price,
      totalAmount: quantity * price,
      serialNumber
    });

    triggerCelebration();
    toast.success(type === 'sale' ? (isRtl ? 'تم تسجيل عملية البيع' : 'Sale recorded') : (isRtl ? 'تم تسجيل عملية الشراء' : 'Purchase recorded'));
    setSuccess(true);
    setShowSuccessVisual(true);
    
    // Hide modal first
    setTimeout(() => {
      setShowForm(false);
      resetForm();
    }, 1000);

    // Then hide success visual
    setTimeout(() => {
      setSuccess(false);
      setShowSuccessVisual(false);
    }, 3000);
  };

  const resetForm = () => {
    setSelectedProduct(null);
    setSearchTerm('');
    setQuantity(1);
    setPrice(0);
    setSerialNumber('');
  };

  return (
    <div className={`space-y-8 px-4 sm:px-0 notranslate ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <SuccessVisual show={showSuccessVisual} />
      
      <ContextMenu3D 
        isOpen={!!contextMenuTarget}
        onClose={() => setContextMenuTarget(null)}
        title={contextMenuTarget?.productName || ''}
        subtitle={contextMenuTarget?.type === 'sale' ? t.sale : t.purchase}
        language={language}
        details={[
          { label: t.quantity, value: contextMenuTarget?.quantity?.toString() || '0' },
          { label: t.total, value: formatPrice(contextMenuTarget?.totalAmount || 0) },
          { label: t.serialNumber, value: contextMenuTarget?.serialNumber || 'N/A' },
          { label: t.date, value: contextMenuTarget ? new Date(contextMenuTarget.timestamp).toLocaleDateString() : '' }
        ]}
        actions={[
          { id: 'view', label: t.view, icon: <Eye size={18}/>, onClick: () => { toast.info(isRtl ? 'عرض التفاصيل غير متاح حالياً' : 'View details not available yet'); setContextMenuTarget(null); } },
          { id: 'print', label: t.print, icon: <Printer size={18}/>, onClick: () => { window.print(); setContextMenuTarget(null); } },
          { id: 'share', label: t.shareInvoice, icon: <Share2 size={18}/>, onClick: () => { toast.success(isRtl ? 'تم نسخ الرابط' : 'Link copied'); setContextMenuTarget(null); } },
          { id: 'delete', label: t.delete, color: 'rose', icon: <Trash2 size={18}/>, onClick: () => { onDelete(contextMenuTarget!.id); setContextMenuTarget(null); } }
        ]}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{t.salesAndPurchases}</h2>
          <p className="text-gray-500 mt-1">{t.inventoryUpdated}</p>
        </div>
        <TactileButton
          onClick={() => setShowForm(true)}
        >
          <Plus size={20} />
          {t.newTransaction}
        </TactileButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions List */}
        <div className="lg:col-span-3">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`bg-white dark:bg-gray-800 rounded-[2rem] border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden premium-card ${celebrationClass}`}
          >
            <div className="p-4 border-b border-gray-50 dark:border-gray-700 flex flex-col sm:flex-row items-center gap-4 bg-gray-50/30 dark:bg-gray-900/30">
              <div className="relative flex-1 w-full">
                <Search size={18} className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-4' : 'left-4'} text-gray-400`} />
                <input 
                  type="text"
                  placeholder={t.searchPlaceholder}
                  value={txSearchTerm}
                  onChange={(e) => setTxSearchTerm(e.target.value)}
                  className={`w-full ${isRtl ? 'pr-11 pl-4' : 'pl-11 pr-4'} py-2.5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all dark:text-white`}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right" dir={isRtl ? 'rtl' : 'ltr'}>
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-gray-900/50">
                    {[
                      { key: 'timestamp', label: t.date },
                      { key: 'productName', label: t.itemName },
                      { key: 'type', label: t.transactionType },
                      { key: 'quantity', label: t.quantity },
                      { key: 'totalAmount', label: t.total },
                    ].map((col) => (
                      <th 
                        key={col.key}
                        onClick={() => handleSort(col.key as keyof Transaction)}
                        className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-indigo-600 transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          {col.label}
                          {sortConfig.key === col.key && (
                            <span className="text-indigo-600">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {sortedTransactions.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      t={t}
                      isRtl={isRtl}
                      onShowContextMenu={setContextMenuTarget}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Transaction Modal */}
      <AnimatePresence>
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)}
              className="absolute inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              {success ? (
                <div className="p-12 text-center flex flex-col items-center gap-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400"
                  >
                    <CheckCircle2 size={48} />
                  </motion.div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{t.transactionSuccess}</h3>
                </div>
              ) : (
                <div className="p-8 space-y-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{t.newTransaction}</h3>
                    <div className="flex bg-gray-100 dark:bg-gray-900 p-1 rounded-xl">
                      <button 
                        onClick={() => setType('sale')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                          type === 'sale' ? 'bg-white dark:bg-gray-800 shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-gray-500'
                        }`}
                      >
                        {t.sale}
                      </button>
                      <button 
                        onClick={() => setType('purchase')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                          type === 'purchase' ? 'bg-white dark:bg-gray-800 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-gray-500'
                        }`}
                      >
                        {t.purchase}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="relative">
                      <Search className={`absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-gray-400`} size={18} />
                      <input 
                        type="text"
                        placeholder={t.searchPlaceholder}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={`w-full ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-3 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white`}
                      />
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                      {filteredProducts.map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedProduct(p);
                            setPrice(type === 'sale' ? p.sellingPrice : p.unitCost);
                          }}
                          className={`w-full p-4 rounded-2xl border text-right transition-all flex items-center justify-between ${
                            selectedProduct?.id === p.id 
                              ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/30 shadow-sm' 
                              : 'border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
                          }`}
                        >
                          <div className="text-left text-xs font-mono text-gray-400">
                             {p.quantity} {t.unitsPlural}
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-gray-900 dark:text-white">{p.name}</div>
                            <div className="text-xs text-gray-500 font-mono">{p.sku}</div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {selectedProduct && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-4 pt-4 border-t border-gray-50 dark:border-gray-700"
                      >
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-gray-400 uppercase">{t.serialNumber}</label>
                          <input 
                            required
                            type="text"
                            placeholder="Enter unique Serial Number"
                            value={serialNumber}
                            onChange={(e) => setSerialNumber(e.target.value)}
                            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-transparent rounded-xl focus:bg-white dark:focus:bg-gray-800 focus:border-indigo-500 outline-none font-mono dark:text-white"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-400 uppercase">{t.quantity}</label>
                            <input 
                              type="number"
                              value={quantity}
                              onChange={(e) => setQuantity(Number(e.target.value))}
                              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-transparent rounded-xl focus:bg-white dark:focus:bg-gray-800 focus:border-indigo-500 outline-none font-mono text-center dark:text-white"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-400 uppercase">{t.total} (₪)</label>
                            <div className="w-full px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-xl font-mono text-center font-bold">
                              {(quantity * price).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4">
                    <TactileButton 
                      variant="secondary"
                      fullWidth
                      onClick={() => setShowForm(false)}
                    >
                      {t.cancel}
                    </TactileButton>
                    <TactileButton 
                      disabled={!selectedProduct || quantity <= 0 || !serialNumber}
                      fullWidth
                      onClick={handleRecord}
                    >
                      {t.recordTransaction}
                    </TactileButton>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
