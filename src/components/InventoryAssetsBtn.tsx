import React from 'react';
import { Language } from '../types';

interface InventoryAssetsBtnProps {
  onClick: () => void;
  language?: Language;
}

export default function InventoryAssetsBtn({ onClick, language = 'ar' }: InventoryAssetsBtnProps) {
  const isRtl = language === 'ar';
  
  return (
    <div className="assets-3d-wrapper">
      {/* الزر الكريستالي ثلاثي الأبعاد التفاعلي */}
      <button type="button" className="assets-glass-btn" onClick={onClick}>
        
        {/* حاوية الرموز ثلاثية الأبعاد اللّي بتتحرك في الفراغ */}
        <div className="assets-3d-scene">
          <span className="assets-cube-icon" role="img" aria-label="cube">🧱</span>
          <span className="assets-gear-icon" role="img" aria-label="gear">⚙️</span>
        </div>

        {/* النصوص المرتبة والمريحة للعين */}
        <div className="assets-btn-content">
          <span className="assets-main-title">
            {isRtl ? "إدارة المخزون والأصول" : "Inventory & Assets"}
          </span>
          <span className="assets-sub-title">
            {isRtl ? "تتبع السلع، رأس المال، والقطع الحية" : "Track goods, capital, and live units"}
          </span>
        </div>

      </button>
    </div>
  );
}
