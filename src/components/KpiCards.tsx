import React from 'react';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { Language } from '../types';

interface KpiCardsProps {
  language: Language;
}

export default function KpiCards({ language }: KpiCardsProps) {
  const { products, loading } = useFirebase();
  const { formatPrice, formatCurrencySymbol } = usePreferredCurrency();
  const isRtl = language === 'ar';

  const MAX_WAREHOUSE_CAPACITY = 5000; // السعة القصوى للمستودع

  if (loading) {
    return (
      <div className="kpi-loading font-arabic">
        {isRtl ? 'جاري تحديث المؤشرات الإحصائية...' : 'Updating key performance indicators...'}
      </div>
    );
  }

  let totalQty = 0;
  let totalVal = 0;
  const uniqueCount = products.length; // عدد الأصناف الفرعية

  products.forEach((product) => {
    const qty = Number(product.quantity) || 0;
    const price = Number(product.unitCost) || Number(product.sellingPrice) || 0; // سعر التكلفة لرأس المال

    totalQty += qty;
    totalVal += (qty * price);
  });

  // حسبة النسبة المئوية لسعة المستودع الإشغالية
  const occupancy = (totalQty / MAX_WAREHOUSE_CAPACITY) * 100;
  const occupancyRate = Math.min(occupancy, 100);

  const stats = {
    totalItems: totalQty,
    totalValue: totalVal,
    uniqueProducts: uniqueCount,
    occupancyRate
  };

  return (
    <div className="kpi-grid summary-grid" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* البطاقة 1: إجمالي القطع المخزنة */}
      <div className="kpi-card glass-card blue-glow">
        <div className="kpi-icon select-none">📦</div>
        <div className="kpi-content">
          <span className="kpi-title font-arabic">
            {isRtl ? 'إجمالي القطع بالمخزن' : 'Total Items in Warehouse'}
          </span>
          <h2 className="kpi-value font-mono">
            {stats.totalItems.toLocaleString()}
          </h2>
        </div>
      </div>

      {/* البطاقة 2: القيمة المالية للمستودع */}
      <div className="kpi-card glass-card green-glow">
        <div className="kpi-icon select-none font-sans">{formatCurrencySymbol('₪')}</div>
        <div className="kpi-content">
          <span className="kpi-title font-arabic">
            {isRtl ? 'رأس المال المخزن' : 'Stored Capital'}
          </span>
          <h2 className="kpi-value font-mono">
            {formatPrice(stats.totalValue, '₪')}
          </h2>
        </div>
      </div>

      {/* البطاقة 3: عدد الأصناف الفرعية */}
      <div className="kpi-card glass-card purple-glow">
        <div className="kpi-icon select-none">🏷️</div>
        <div className="kpi-content">
          <span className="kpi-title font-arabic">
            {isRtl ? 'عدد الأصناف الفرعية' : 'Sub-categories'}
          </span>
          <h2 className="kpi-value font-mono font-arabic">
            {stats.uniqueProducts} {isRtl ? 'صنف' : 'Items'}
          </h2>
        </div>
      </div>

      {/* البطاقة 4: السعة الإشغالية للمستودع */}
      <div className="kpi-card glass-card orange-glow">
        <div className="kpi-icon select-none">🏢</div>
        <div className="kpi-content">
          <span className="kpi-title font-arabic">
            {isRtl ? 'السعة الإشغالية' : 'Occupancy Rate'}
          </span>
          <h2 className="kpi-value font-mono">
            {stats.occupancyRate.toFixed(1)}%
          </h2>
          {/* شريط تقدم أفقي متوهج ومرصوص */}
          <div className="progress-bar-bg">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${stats.occupancyRate}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
