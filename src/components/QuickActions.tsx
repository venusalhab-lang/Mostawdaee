import React, { useState } from 'react';
import { 
  collection, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth, OperationType, handleFirestoreError } from '../services/firebase';
import { toast } from 'sonner';
import { Language } from '../types';

interface QuickActionsProps {
  language: Language;
}

export default function QuickActions({ language }: QuickActionsProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const isRtl = language === 'ar';

  const handleQuickAction = async (actionType: 'IN' | 'OUT' | 'AUDIT', titleAr: string, titleEn: string, status: string) => {
    if (!auth.currentUser) {
      toast.error(isRtl ? 'الرجاء تسجيل الدخول أولاً' : 'Please log in first');
      return;
    }

    const currentActionId = actionType;
    setLoadingAction(currentActionId);
    
    const collectionPath = 'transactions';
    const actionTitle = isRtl ? titleAr : titleEn;

    try {
      // 1. Write the transaction securely to Firestore
      const docRef = await addDoc(collection(db, collectionPath), {
        type: actionType,
        title: actionTitle,
        status: status,
        userId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });

      // 2. Beautiful Success Feedback
      toast.success(
        isRtl 
          ? `تم تسجيل العملية بنجاح! مرجع: ${docRef.id.slice(0, 8)}...` 
          : `Action recorded successfully! Ref: ${docRef.id.slice(0, 8)}...`
      );
      
      // Also show standard user-facing alert as specified by user requirements
      alert(
        isRtl 
          ? `تم تسجيل الشحنة بنجاح! رقم المرجع: ${docRef.id}`
          : `Shipment recorded successfully! Ref No: ${docRef.id}`
      );

    } catch (error) {
      console.error("Error executing quick action:", error);
      toast.error(isRtl ? 'حدث خطأ أثناء تسجيل العملية' : 'An error occurred while logging the operation');
      
      // Pass validation and operations errors through standard handleFirestoreError to crash safely/report
      handleFirestoreError(error, OperationType.WRITE, `${collectionPath}/quick_${actionType}`);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="bento-card quick-actions-container">
      <h3 className="section-title">
        {isRtl ? 'الإجراءات السريعة' : 'Quick Actions'}
      </h3>
      
      <div className="actions-grid">
        {/* الزر الأول: استلام شحنة واردة */}
        <button 
          className="icon-container glass-btn" 
          onClick={() => handleQuickAction('IN', 'شحنة واردة سريعة', 'Inward Quick Shipment', 'pending')}
          disabled={loadingAction !== null}
        >
          <span className="glowing-symbol">📦</span>
          <span className="glowing-text">
            {loadingAction === 'IN' 
              ? (isRtl ? "جاري الإضافة..." : "Adding...") 
              : (isRtl ? "استلام شحنة" : "Receive Shipment")}
          </span>
        </button>

        {/* الزر الثاني: صرف بضاعة */}
        <button 
          className="icon-container glass-btn"
          onClick={() => handleQuickAction('OUT', 'شحنة صادرة سريعة', 'Outward Quick Shipment', 'completed')}
          disabled={loadingAction !== null}
        >
          <span className="glowing-symbol">📤</span>
          <span className="glowing-text">
            {loadingAction === 'OUT' 
              ? (isRtl ? "جاري الصرف..." : "Dispatching...") 
              : (isRtl ? "صرف بضاعة" : "Dispatch Goods")}
          </span>
        </button>

        {/* الزر الثالث: جرد المخزون */}
        <button 
          className="icon-container glass-btn"
          onClick={() => handleQuickAction('AUDIT', 'جرد مخزني مبسط', 'Quick Stock Re-audit', 'verified')}
          disabled={loadingAction !== null}
        >
          <span className="glowing-symbol">🔍</span>
          <span className="glowing-text">
            {loadingAction === 'AUDIT' 
              ? (isRtl ? "جاري الجرد..." : "Auditing...") 
              : (isRtl ? "جرد المخزون" : "Inventory Audit")}
          </span>
        </button>

        {/* أيقونة البيع المباشر وقارئ الباركود المعدلة */}
        <button 
          className="barcode-glass-btn"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('change-screen', { detail: 'pos' }));
          }}
          type="button"
        >
          {/* الرمز ثلاثي الأبعاد المتوهج بالفسفوري */}
          <div className="barcode-3d-symbol">
            <span className="laser-line"></span>
            📊
          </div>
          {/* النص المريح للعين والواضح للقراءة */}
          <span className="barcode-text">
            {isRtl ? 'البيع المباشر والباركود' : 'Barcode Direct POS'}
          </span>
        </button>
      </div>
    </div>
  );
}

