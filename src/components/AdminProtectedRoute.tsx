import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { isAdminEmail } from '../lib/adminAccess';

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * حارس واجهة فقط: صلاحيات الإدارة الفعلية يفرضها الخادم (requireOwner) ببريد مؤكَّد.
 */
export default function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const { isAdmin, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-indigo-500"></div>
      </div>
    );
  }

  const userEmail = (user && (user.email || user?.user_metadata?.email)) ? (user.email || user?.user_metadata?.email) : null;
  const allowed = isAdmin || isAdminEmail(userEmail);

  return allowed ? <>{children}</> : <Navigate to="/" replace />;
}
