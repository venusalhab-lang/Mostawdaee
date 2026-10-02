import React, { useEffect, useState } from 'react';
import { supabase as rawSupabase } from '../supabaseClient';
import { Shield, Loader2, AlertTriangle } from 'lucide-react';
import { sounds } from '../lib/sounds';
import { useAuth } from './AuthContext';

const supabase = rawSupabase as any;

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  isRtl?: boolean;
}

/**
 * Mapped custom component to safeguard admin nodes based on authentic Supabase metadata/role.
 * Prevents screen flickering ("No flickering") during the checking resolution using a high-fidelity glassmorphic screen loader.
 */
export default function ProtectedRoute({ children, fallback, isRtl = true }: ProtectedRouteProps) {
  const { user, isAdmin } = useAuth();
  const [checking, setChecking] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function checkSecuritySession() {
      try {
        setChecking(true);
        if (!user) {
          if (active) {
            setHasAccess(false);
            setChecking(false);
          }
          return;
        }

        // 1. Check if administrative email matches or if table role is super_admin
        if (isAdmin) {
          if (active) {
            setUserRole('super_admin');
            setHasAccess(true);
            setChecking(false);
          }
          return;
        }

        let roleValue = 'user';
        try {
          const { db } = await import('../services/firebase');
          const { doc, getDoc } = await import('firebase/firestore');
          const profileDocRef = doc(db, 'users', (user.uid || user.id), 'settings', 'profile');
          const profileSnap = await getDoc(profileDocRef);
          if (profileSnap.exists()) {
            const data = profileSnap.data();
            if (data && data.role) {
              roleValue = data.role;
            }
          }
        } catch (fErr) {
          console.warn('[ProtectedRoute] Firebase role check skipped or failed:', fErr);
        }

        if (roleValue === 'user') {
          try {
            const { data: profile, error: dbErr } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', user.id || user.uid)
              .single();

            if (!dbErr && profile && profile.role) {
              roleValue = profile.role;
            } else {
              roleValue = user.user_metadata?.role || 'user';
            }
          } catch (sErr) {
            console.warn('[ProtectedRoute] Supabase role check failed:', sErr);
          }
        }

        if (active) {
          setUserRole(roleValue);
          if (roleValue === 'super_admin' || roleValue === 'admin') {
            setHasAccess(true);
          } else {
            setHasAccess(false);
          }
          setChecking(false);
        }
      } catch (err) {
        console.warn('[ProtectedRoute] Security verification error:', err);
        if (active) {
          setHasAccess(false);
          setChecking(false);
        }
      }
    }

    checkSecuritySession();

    return () => {
      active = false;
    };
  }, [user, isAdmin]);

  // Prevent flickering with an advanced glassmorphic card loader aligned with system designs
  if (checking) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 select-none">
        <div className="relative p-10 bg-white/5 dark:bg-slate-900/40 backdrop-blur-xl border border-slate-200/20 dark:border-white/10 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm text-center">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-cyan-400 via-indigo-500 to-rose-400 rounded-t-3xl animate-pulse" />
          
          <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-4 border border-indigo-500/20">
            <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
          </div>
          
          <h4 className="text-sm font-black text-slate-800 dark:text-slate-100 uppercase tracking-widest mb-1.5 font-sans">
            {isRtl ? 'تحقق من أمن المستودع...' : 'Security Authentication...'}
          </h4>
          <p className="text-[11px] text-slate-400 font-medium leading-relaxed leading-normal">
            {isRtl 
              ? 'يتم التحقق من صلاحيات المسؤول الخاص بك لمنع الوصول غير المصرح به.'
              : 'Verifying administrative session claims on Supabase backend without screen flicker.'}
          </p>
        </div>
      </div>
    );
  }

  // If role check fails, render a high-security access denied screen
  if (!hasAccess) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-4" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="relative max-w-md w-full bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 border border-red-500/20 dark:border-red-400/15 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-rose-950/25 text-center overflow-hidden">
          
          {/* Header decoration danger glow */}
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-red-500 via-rose-500 to-amber-500" />
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="w-16 h-16 mx-auto bg-rose-500/10 rounded-full flex items-center justify-center border border-rose-500/20 mb-5 animate-pulse text-rose-500">
            <Shield size={28} className="stroke-[1.75]" />
          </div>

          <h3 className="text-xl font-black text-rose-400 mb-2">
            {isRtl ? 'عذراً! وصول غير مصرح به' : 'Access Authorization Failed'}
          </h3>
          
          <p className="text-xs sm:text-sm text-slate-300 font-semibold leading-relaxed mb-6">
            {isRtl 
              ? 'إن هذه الصفحة محمية تحت حارس نظام (super_admin) ولا يمكن الوصول لها على حسابك الحالي. يرجى مراجعة المسؤولين لتعديل الـ Role الخاص بك.'
              : 'This interface is restricted under strict super_admin RLS policies. Your current tenant account lacks certified tokens.'}
          </p>

          <div className="space-y-3 bg-red-950/15 p-4 rounded-2xl border border-red-505/10 text-right font-mono text-[10px] sm:text-xs text-rose-350 leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold mb-1 border-b border-rose-505/10 pb-1">
              <AlertTriangle size={12} className="text-yellow-500" />
              <span>{isRtl ? 'معلومات الجلسة الآمنة:' : 'Security Event Context:'}</span>
            </div>
            <div>• Supabase Claim: role = "{userRole || 'authenticated'}"</div>
            <div>• Required Claim: role = "super_admin"</div>
            <div>• Policy check: Access Denied</div>
          </div>

          <div className="mt-6 pt-3 flex gap-3 justify-center">
            <p className="text-xs text-slate-400">
              {isRtl ? 'لا يمكن محاكاة صلاحيات المسؤول من المتصفح.' : 'Admin access cannot be simulated in the browser.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Access approved
  return <>{children}</>;
}
