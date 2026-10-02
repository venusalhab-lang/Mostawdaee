import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot 
} from 'firebase/firestore';
import { db, auth, OperationType, handleFirestoreError } from '../services/firebase';
import { Language, Product } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, RefreshCw } from 'lucide-react';

interface RadarAlertsProps {
  language: Language;
}

export default function RadarAlerts({ language }: RadarAlertsProps) {
  const [lowStockItems, setLowStockItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const isRtl = language === 'ar';
  
  const isFirstLoad = useRef(true);
  const lowStockItemsRef = useRef<Product[]>([]);
  const isRtlRef = useRef(isRtl);

  useEffect(() => {
    isRtlRef.current = isRtl;
  }, [isRtl]);

  const requestNotificationPermission = async () => {
    if (typeof window !== 'undefined' && "Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch (err) {
        console.error("Error requesting notification permissions on mount:", err);
      }
    }
  };

  const sendLiveNotification = (itemName: string, quantity: number) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === "granted") {
      const title = isRtlRef.current ? "⚠️ تنبيه هام من مستودعي" : "⚠️ Critical Stock Alert";
      const body = isRtlRef.current
        ? `المنتج (${itemName}) وصل للحد الحرج! المتبقي في المستودع: ${quantity} قطع فقط.`
        : `Product (${itemName}) reached critical limit! Only ${quantity} items left in stock.`;

      const options = {
        body,
        icon: '/radar-alert-icon.png', // مسار أيقونة نظام مستودعي المتوهجة
        vibrate: [200, 100, 200], // نمط الاهتزاز للموبايل
        badge: '/badge-icon.png', // أيقونة صغيرة تظهر في شريط التنبيهات فوق
      };

      try {
        const notification = new Notification(title, options);
        notification.onclick = () => {
          window.focus();
        };
      } catch (err) {
        console.error("Failed to showcase desktop notification:", err);
      }
    }
  };

  useEffect(() => {
    // 1. طلب الإذن فوراً عند تشغيل المكون
    requestNotificationPermission();

    if (!auth.currentUser) {
      setLoading(false);
      return;
    }

    const uid = auth.currentUser.uid;
    const inventoryPath = `users/${uid}/inventory`;

    // 1. بناء الاستعلام: جلب المنتجات التي كميتها 5 أو أقل للتاجر الحالي
    const q = query(
      collection(db, 'users', uid, 'inventory'), 
      where("quantity", "<=", 5)
    );

    // 2. الاستماع اللحظي للتغييرات (Live Radar)
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const items: Product[] = [];

      querySnapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() } as Product;
        items.push(data);
      });

      // ترتيب المنتجات حسب الأقل كمية أولاً
      items.sort((a, b) => a.quantity - b.quantity);

      // 2. إذا لم يكن التحميل الأول، نقارن لمعرفة هل هناك منتج نقص حديثاً
      const previousItems = lowStockItemsRef.current;
      if (!isFirstLoad.current && items.length > previousItems.length) {
        // العثور على المنتج اللي انضاف حديثاً لقائمة النواقص
        const newCriticalItem = items.find(
          newItem => !previousItems.some(oldItem => oldItem.id === newItem.id)
        );
        
        if (newCriticalItem) {
          // إطلاق الإشعار الفوري للمتصفح/الموبايل!
          sendLiveNotification(newCriticalItem.name, newCriticalItem.quantity);
        }
      }
      
      lowStockItemsRef.current = items;
      setLowStockItems(items);
      isFirstLoad.current = false; // تفعيل الإشعارات بعد أول جلب للبيانات
      setLoading(false);
    }, (error) => {
      console.error("خطأ في مراقبة الرادار: ", error);
      setLoading(false);
      handleFirestoreError(error, OperationType.GET, inventoryPath);
    });

    // تنظيف الاستماع عند إغلاق المكون
    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  if (loading) {
    return (
      <div className="bento-card radar-container flex items-center justify-center p-8 text-slate-400">
        <span className="flex items-center gap-2 font-arabic text-sm text-[#00f2fe] font-bold animate-pulse">
          <RefreshCw className="h-4 w-4 animate-spin text-[#00f2fe]" />
          {isRtl ? 'جاري تشغيل الرادار ومسح المخزون اللحظي...' : 'Initializing Radar Scan...'}
        </span>
      </div>
    );
  }

  return (
    <div className="bento-card radar-container">
      <div className="radar-header">
        <div className="radar-pulse-dot"></div>
        <h3 className="text-lg font-bold text-slate-100 font-arabic select-none">
          {isRtl ? 'رادار النواقص اللحظي' : 'Live Inventory Radar'}
        </h3>
      </div>

      <AnimatePresence mode="popLayout">
        {lowStockItems.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="no-alerts p-6 text-center select-none rounded-xl bg-emerald-500/5 border border-emerald-500/10"
          >
            <span className="text-2xl mb-1 block">✓</span>
            <h4 className="text-sm font-bold text-emerald-400 font-arabic">
              {isRtl ? 'المستودع في أمان تام' : 'Stock Levels Stable'}
            </h4>
            <p className="text-xs text-slate-400 mt-1 font-arabic">
              {isRtl ? 'جميع المنتجات في وضع آمن وسليم حالياً.' : 'No items are below critical thresholds.'}
            </p>
          </motion.div>
        ) : (
          <div className="radar-list max-h-[300px] overflow-y-auto pr-1">
            {lowStockItems.map((item, index) => {
              return (
                <motion.div 
                  key={item.id} 
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  transition={{ duration: 0.2, delay: Math.min(index * 0.05, 0.3) }}
                  className="radar-item warning-glow group relative overflow-hidden"
                >
                  <div className="item-info">
                    <span className="item-name font-arabic truncate">
                      {item.name}
                    </span>
                    <span className="item-sku font-mono select-all">
                      SKU: {item.sku || item.id.substring(0, 6)}
                    </span>
                  </div>

                  <div className="item-stock-status">
                    <span className="stock-count font-mono">
                      {item.quantity}
                    </span>
                    <span className="stock-label font-arabic">
                      {isRtl ? 'قطع متبقية' : 'items left'}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
