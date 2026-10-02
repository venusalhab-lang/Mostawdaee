import React, { useState, useEffect } from 'react';
import { 
  Users, 
  ShieldCheck, 
  Check, 
  RefreshCw, 
  AlertCircle, 
  Calendar, 
  TrendingUp, 
  Clock, 
  Search, 
  Building2, 
  Sparkles,
  ChevronDown,
  Lock,
  Mail,
  UserCheck,
  CreditCard,
  UserX,
  SlidersHorizontal
} from 'lucide-react';
import { useFirebase } from './FirebaseProvider';
import { sounds } from '../lib/sounds';
import { toast } from 'sonner';
import { supabase as supabaseRaw } from '../supabaseClient';
import CoreCommandCenter from './CoreCommandCenter';
import { isAdminEmail } from '../lib/adminAccess';

const supabase = supabaseRaw as any;

interface Props {
  language: 'en' | 'ar';
}

interface TenantUser {
  id: string;
  email: string;
  displayName: string;
  businessName: string;
  role: string;
  status: 'active' | 'trial' | 'expired';
  plan?: string;
  trial_start_date: string;
  expiry_date: string;
  last_active: string;
  warehousesCount: number;
}

export default function AdminDashboard({ language }: Props) {
  const isRtl = language === 'ar';
  const { user } = useFirebase() as any;

  // Real Database and Authorization States
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [userRole, setUserRole] = useState<string>('user');

  // Subscribers State
  const [subscribers, setSubscribers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTroubleshooterOpen, setIsTroubleshooterOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'cyber' | 'classic'>('cyber');

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'trial' | 'expired'>('all');

  // Interactive drop-down row action ID
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  // 1. Authenticate & Authorize Super Admin
  useEffect(() => {
    async function verifySuperAdminGates() {
      setAuthChecking(true);
      try {
        if (!user) {
          setIsAuthorized(false);
          setAuthChecking(false);
          return;
        }

        const email = (user.email || '').toLowerCase().trim();

        // 1. Explicitly allow the super admin email venusalhab@gmail.com (with automatic background self-healing)
        if (isAdminEmail(email)) {
          setIsAuthorized(true);
          setUserRole('super_admin');
          setAuthChecking(false);

          // Force upsert our own profiles table role to super_admin to self-heal DB access
          const myUid = user.id || user.uid;
          if (myUid) {
            supabase
              .from('profiles')
              .upsert({
                id: myUid,
                role: 'super_admin',
                updated_at: new Date().toISOString()
              }, { onConflict: 'id' })
              .then(() => {
                console.log('[AdminDashboard] Self-healed/upserted master profile record in database to super_admin role.');
              })
              .catch((err: any) => {
                console.error('[AdminDashboard] Background self-healer profiles upsert failed:', err);
              });
          }
          return;
        }

        // 2. Lookup role field inside active database profile table
        const userId = user.id || user.uid;
        if (userId) {
          const { data: profileRecord, error: profileErr } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle();

          if (!profileErr && profileRecord && profileRecord.role === 'super_admin') {
            setIsAuthorized(true);
            setUserRole('super_admin');
            setAuthChecking(false);
            return;
          }
        }

        setIsAuthorized(false);
      } catch (err) {
        console.error('[AdminDashboard] Privilege screening exception:', err);
        setIsAuthorized(false);
      } finally {
        setAuthChecking(false);
      }
    }

    verifySuperAdminGates();
  }, [user]);

  // 1. Only fetch subscribers after the admin authorization gate is confirmed
  useEffect(() => {
    if (isAuthorized) {
      fetchRealSubscribers();
    }
  }, [isAuthorized]);

  const fetchRealSubscribers = async () => {
    if (!isAuthorized) {
      console.warn('[AdminDashboard] Skipping subscriber fetch: unauthorized access.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      console.log('[AdminDashboard] Fetching all registered users via RPC and custom merge fallback...');
      
      let authUsers: any[] = [];
      try {
        const { data, error: rpcErr } = await supabase.rpc('get_auth_users');
        if (!rpcErr && data) {
          authUsers = data;
          console.log('[AdminDashboard] get_auth_users RPC loaded successfully:', authUsers.length, 'users');
        } else {
          console.warn('[AdminDashboard] get_auth_users RPC error or empty:', rpcErr);
        }
      } catch (rpcEx) {
        console.warn('[AdminDashboard] Exception calling get_auth_users RPC:', rpcEx);
      }

      // جلب الحسابات النظيفة بكامل الحقول عبر النجمة
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('*');

      if (pErr) {
        console.error('[AdminDashboard] Profiles fetch error:', pErr);
        throw pErr;
      }

      console.log('[AdminDashboard] Raw Profiles fetched successfully:', profiles?.length || 0);

      // جلب الاشتراكات
      const { data: subs } = await supabase
        .from('user_subscriptions')
        .select('*');

      const profilesList = profiles || [];
      const subsList = subs || [];
      const joinedList: any[] = [];

      if (authUsers && authUsers.length > 0) {
        authUsers.forEach((au: any) => {
          const profile = profilesList.find((p: any) => p.id === au.id);
          joinedList.push({
            id: au.id,
            email: au.email || profile?.email || `user_${au.id.slice(0, 4)}@gmail.com`,
            user_name: au.raw_user_meta_data?.full_name || au.raw_user_meta_data?.user_name || profile?.user_name || 'مستخدم جديد',
            business_name: au.raw_user_meta_data?.business_name || profile?.business_name || (isRtl ? 'المنشأة المسجلة' : 'Registered Warehouse'),
            role: profile?.role || 'user',
            subscription_status: profile?.subscription_status || null,
            updated_at: au.created_at || profile?.updated_at || new Date().toISOString()
          });
        });

        // Add any profiles that aren't in auth.users (just in case)
        profilesList.forEach((p: any) => {
          if (!joinedList.some(u => u.id === p.id)) {
            joinedList.push({
              id: p.id,
              email: p.email || `user_${p.id.slice(0, 4)}@gmail.com`,
              user_name: p.user_name || 'مستخدم مستودعي',
              business_name: p.business_name || (isRtl ? 'المنشأة المسجلة' : 'Registered Warehouse'),
              role: p.role || 'user',
              subscription_status: p.subscription_status || null,
              updated_at: p.updated_at || new Date().toISOString()
            });
          }
        });
      } else {
        // Fallback to profiles table alone
        profilesList.forEach((p: any) => {
          joinedList.push({
            id: p.id,
            email: p.email || `user_${p.id.slice(0, 4)}@gmail.com`,
            user_name: p.user_name || 'مستخدم مستودعي',
            business_name: p.business_name || (isRtl ? 'المنشأة المسجلة' : 'Registered Warehouse'),
            role: p.role || 'user',
            subscription_status: p.subscription_status || null,
            updated_at: p.updated_at || new Date().toISOString()
          });
        });
      }

      const mapped: TenantUser[] = joinedList.map((p: any) => {
        const sub = (subsList || []).find((s: any) => s.user_id === p.id);
        const statusVal = p.subscription_status || sub?.subscription_status || sub?.status || 'trial';
        
        return {
          id: p.id,
          email: p.email,
          displayName: p.user_name,
          businessName: p.business_name,
          role: p.role || 'user',
          status: p.role === 'super_admin' ? 'active' : ((['active', 'trial', 'expired'].includes(statusVal) ? statusVal : 'trial') as 'active' | 'trial' | 'expired'),
          plan: sub?.plan || (p.role === 'super_admin' ? (isRtl ? 'الرخصة الكاملة' : 'Full License') : (statusVal === 'active' ? (isRtl ? 'الخطة السنوية' : 'Annual Plan') : (isRtl ? 'الخطة التجريبية' : 'Trial Plan'))),
          trial_start_date: sub?.trial_start_date || new Date().toISOString(),
          expiry_date: sub?.expiry_date || new Date().toISOString(),
          last_active: p.updated_at || new Date().toISOString(),
          warehousesCount: 1
        };
      });

      console.log('[AdminDashboard] Processed mapped users:', mapped);
      setSubscribers(mapped);
    } catch (err: any) {
      console.error('[AdminDashboard] Critical fetch error:', err);
      setError(`CRITICAL: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubscriptions = fetchRealSubscribers;

  // 3. Status update transaction handler
  const handleStatusChange = async (userId: string, newStatus: 'active' | 'trial' | 'expired') => {
    sounds.playClick();
    try {
      // strict email enforcement for admin actions
      const currentEmail = (user?.email || '').toLowerCase().trim();
      if (currentEmail !== 'venusalhab@gmail.com') {
        console.warn('[AdminDashboard] Unauthorized status change attempt by', currentEmail);
        toast.error(isRtl ? 'غير مصرح لك بتعديل حالة الاشتراكات.' : 'You are not authorized to change subscription status.');
        return;
      }
      const selectedUser = subscribers.find(s => s.id === userId);
      if (!selectedUser) return;

      const { error: updateErr } = await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: userId,
          subscription_status: newStatus,
          trial_start_date: selectedUser.trial_start_date,
          expiry_date: selectedUser.expiry_date,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (updateErr) throw updateErr;

      // Try syncing the status changes directly to the profiles table as requested
      try {
        await supabase
          .from('profiles')
          .update({ subscription_status: newStatus })
          .eq('id', userId);
        console.log('[AdminDashboard] Successfully synced subscription_status to profiles table');
      } catch (profileSyncErr) {
        console.warn('[AdminDashboard] Non-critical warning syncing status to profiles table:', profileSyncErr);
      }

      // Update local state instantly with premium response
      setSubscribers(prev => prev.map(s => s.id === userId ? { ...s, status: newStatus } : s));
      sounds.playSuccess();

      const userName = selectedUser.businessName || selectedUser.displayName || (isRtl ? 'مشترك مستودعي' : 'Warehouse Subscriber');
      const statusLabel = newStatus === 'active' 
        ? (isRtl ? 'نشط 🟢' : 'Active 🟢') 
        : newStatus === 'trial' 
          ? (isRtl ? 'تجريبي 🟡' : 'Trial 🟡') 
          : (isRtl ? 'معطل 🔴' : 'Inactive 🔴');

      toast.success(
        isRtl 
          ? 'تم تحديث حالة الاشتراك بنجاح! 📡'
          : 'Subscription status updated successfully! 📡',
        {
          description: isRtl 
            ? `العميل: ${userName} 🏢 | الوضع الحالي: ${statusLabel}`
            : `Client: ${userName} 🏢 | Current status: ${statusLabel}`,
          duration: 4000,
        }
      );
    } catch (err: any) {
      console.error('[AdminDashboard] Status Shift Fail:', err);
      toast.error(isRtl ? 'عذراً! تعذر تحديث حالة الاشتراك في السحابة' : `Failed to store subscription updates: ${err.message}`);
    }
  };

  // 4. Expiry period extensions
  const extendUserPeriod = async (userId: string, daysToAdd: number) => {
    sounds.playClick();
    try {
      // strict email enforcement for admin actions
      const currentEmail = (user?.email || '').toLowerCase().trim();
      if (currentEmail !== 'venusalhab@gmail.com') {
        console.warn('[AdminDashboard] Unauthorized extend period attempt by', currentEmail);
        toast.error(isRtl ? 'غير مصرح لك بتمديد فترات الاشتراك.' : 'You are not authorized to extend subscription periods.');
        return;
      }
      const selectedUser = subscribers.find(s => s.id === userId);
      if (!selectedUser) return;

      const currentExpiry = new Date(selectedUser.expiry_date);
      // Fallback if current expiry is invalid or in the past
      const baseDate = currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
      const nextExpiry = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

      const { error: extendErr } = await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: userId,
          subscription_status: selectedUser.status,
          trial_start_date: selectedUser.trial_start_date,
          expiry_date: nextExpiry,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (extendErr) throw extendErr;

      setSubscribers(prev => prev.map(s => s.id === userId ? { ...s, expiry_date: nextExpiry } : s));
      sounds.playSuccess();
      toast.success(
        isRtl 
          ? `تم تمديد فترة ترخيص العميل بنجاح بمقدار ${daysToAdd} يوماً!`
          : `Extended client validation criteria successfully by ${daysToAdd} days!`
      );
    } catch (err: any) {
      console.error('[AdminDashboard] Expiry extension failure:', err);
      toast.error(isRtl ? 'عذراً! فشل تحديث تاريخ انتهاء الاشتراك' : `Database connection issue during extension: ${err.message}`);
    }
  };

  // 5. Upgrade / Demote Role
  const handleToggleRole = async (userId: string, currentRole: string) => {
    sounds.playClick();
    const nextRole = currentRole === 'super_admin' ? 'user' : 'super_admin';
    try {
      // strict email enforcement for admin actions
      const currentEmail = (user?.email || '').toLowerCase().trim();
      if (currentEmail !== 'venusalhab@gmail.com') {
        console.warn('[AdminDashboard] Unauthorized role toggle attempt by', currentEmail);
        toast.error(isRtl ? 'غير مصرح لك بتغيير صلاحيات المستخدمين.' : 'You are not authorized to change user roles.');
        return;
      }
      const { error: roleErr } = await supabase
        .from('profiles')
        .update({ role: nextRole, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (roleErr) throw roleErr;

      setSubscribers(prev => prev.map(s => s.id === userId ? { ...s, role: nextRole } : s));
      sounds.playSuccess();
      toast.success(
        isRtl 
          ? `تم تغيير صلاحية العميل بنجاح لـ: ${nextRole === 'super_admin' ? 'مسؤول خارق' : 'مستخدم عادي'}`
          : `User role privilege altered to: ${nextRole}`
      );
    } catch (err: any) {
      console.error('[AdminDashboard] Role alteration error:', err);
      toast.error(isRtl ? 'فشل تعديل حزم الصلاحيات المشفرة' : `Error modifying profile role: ${err.message}`);
    }
  };

  // 6. Complete Expiry Date Modification via calendar input picker
  const handleCustomDateChange = async (userId: string, targetDateStr: string) => {
    if (!targetDateStr) return;
    try {
      // strict email enforcement for admin actions
      const currentEmail = (user?.email || '').toLowerCase().trim();
      if (currentEmail !== 'venusalhab@gmail.com') {
        console.warn('[AdminDashboard] Unauthorized custom date attempt by', currentEmail);
        toast.error(isRtl ? 'غير مصرح لك بتعديل تاريخ الانتهاء.' : 'You are not authorized to change expiry dates.');
        return;
      }
      const targetExpiry = new Date(targetDateStr).toISOString();
      const selectedUser = subscribers.find(s => s.id === userId);
      if (!selectedUser) return;

      const { error: dateErr } = await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: userId,
          subscription_status: selectedUser.status,
          trial_start_date: selectedUser.trial_start_date,
          expiry_date: targetExpiry,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (dateErr) throw dateErr;

      setSubscribers(prev => prev.map(s => s.id === userId ? { ...s, expiry_date: targetExpiry } : s));
      toast.success(isRtl ? 'تم تعديل موعد انتهاء رخصة المنشأة سحابياً!' : 'Custom expiry date changed successfully');
    } catch (err: any) {
      console.error('[AdminDashboard] Custom date allocation error:', err);
      toast.error(err.message || 'Error occurred');
    }
  };

  // Responsive metric counters
  const totalUsersCount = subscribers.length;
  const activeSubsCount = subscribers.filter(s => s.status === 'active').length;
  const expiredSubsCount = subscribers.filter(s => s.status === 'expired').length;
  const trialSubsCount = subscribers.filter(s => s.status === 'trial').length;

  // Filter list
  const filteredSubscribers = subscribers.filter(userNode => {
    const queryLower = searchQuery.toLowerCase().trim();
    const matchesSearch = 
      userNode.email.toLowerCase().includes(queryLower) ||
      userNode.displayName.toLowerCase().includes(queryLower) ||
      userNode.businessName.toLowerCase().includes(queryLower);

    const matchesStatus = statusFilter === 'all' || userNode.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Guard loading states gracefully
  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="text-center space-y-4">
          <RefreshCw className="h-10 w-10 text-indigo-600 animate-spin mx-auto text-center" />
          <p className="text-sm font-semibold text-slate-500">
            {isRtl ? 'جار التحقق من صلاحيات لوحة التحكم والمشتركين...' : 'Verifying control panel & subscriber privileges...'}
          </p>
        </div>
      </div>
    );
  }

  // Guard access restriction layout
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-8 text-center space-y-6">
          <div className="h-12 w-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
            <Lock size={22} />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-slate-900">
              {isRtl ? 'الدخول محظور - لوحة التحكم والمشتركين' : 'Access Restricted - Control Panel & Subscribers'}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              {isRtl 
                ? 'عذراً، هذه المنطقة مخصصة بالكامل للمطور أو المالك المسؤول عن مراجعة اشتراكات المستودعات والتراخيص.'
                : 'Access to real-time client databases is restricted to verified administrators.'}
            </p>
          </div>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-left text-xs font-mono space-y-2 text-slate-600">
            <div>Logged Email: <span className="text-slate-900 font-bold">{user?.email || 'Guest'}</span></div>
            <div>Required Email: <span className="text-indigo-600 font-bold">venusalhab@gmail.com</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 py-10 px-4 md:px-8 font-sans selection:bg-indigo-100" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Modern Tab Switcher for Admin View Modes */}
        <div className="flex justify-center md:justify-end">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 shadow-inner">
            <button
              onClick={() => { sounds.playClick(); setViewMode('cyber'); }}
              className={`px-4 py-2 text-[11px] font-black rounded-lg transition-all duration-300 flex items-center gap-2 cursor-pointer ${
                viewMode === 'cyber'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>🛰️</span>
              <span>{isRtl ? 'غرفة القيادة المركزية' : 'Central Command Center'}</span>
            </button>
            <button
              onClick={() => { sounds.playClick(); setViewMode('classic'); }}
              className={`px-4 py-2 text-[11px] font-black rounded-lg transition-all duration-300 flex items-center gap-2 cursor-pointer ${
                viewMode === 'classic'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>🛠️</span>
              <span>{isRtl ? 'أدوات الإدارة والاشتراكات' : 'Management & Support Tools'}</span>
            </button>
          </div>
        </div>

        {viewMode === 'cyber' ? (
          <CoreCommandCenter />
        ) : (
          <>
            {/* Clean, minimalist Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-200">
          <div className="space-y-1.5 text-right">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                <ShieldCheck size={24} />
              </span>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                {isRtl ? 'لوحة التحكم والمشتركين' : 'Control Panel & Subscribers'}
              </h1>
            </div>
            <p className="text-xs text-slate-500 font-semibold">
              {isRtl 
                ? 'إدارة حسابات المشتركين وتمديد الرخص والتحكم الفوري والحكيم بقواعد بيانات سوبابيس.'
                : 'Manage user licenses, configure validity terms, and modify database privileges live.'}
            </p>
          </div>

          {/* Super Admin Badge showing current login user */}
          <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm self-end md:self-center">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                {isRtl ? 'المسؤول الخارق النشط:' : 'Active Super Admin:'}
              </span>
              <span className="text-xs font-black text-slate-700 font-sans">
                venusalhab@gmail.com
              </span>
            </div>
          </div>
        </div>

        {/* High-Contrast Metric Cards in clean white with bold text & generous spacing */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* Metric 1: Total Users */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-450 uppercase tracking-widest block">
                {isRtl ? 'إجمالي العملاء المشتركين' : 'Total Customers'}
              </span>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <Users size={18} />
              </div>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-black text-slate-900 tracking-tight">
                {loading ? <RefreshCw className="h-5 w-5 animate-spin text-slate-300 inline" /> : totalUsersCount}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                {isRtl ? 'منشأة مسجلة' : 'Registered stores'}
              </span>
            </div>
          </div>

          {/* Metric 2: Active Subscriptions */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-emerald-600 uppercase tracking-widest block">
                {isRtl ? 'الاشتراكات المفعلة (نشط)' : 'Active Licenses'}
              </span>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                <UserCheck size={18} />
              </div>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-black text-slate-900 tracking-tight">
                {loading ? <RefreshCw className="h-5 w-5 animate-spin text-slate-300 inline" /> : activeSubsCount}
              </span>
              <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                {totalUsersCount > 0 ? Math.round((activeSubsCount / totalUsersCount) * 100) : 0}%
              </span>
            </div>
          </div>

          {/* Metric 3: Expired Subscriptions */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-rose-600 uppercase tracking-widest block">
                {isRtl ? 'اشتراكات منتهية وبانتظار الدفع' : 'Expired Accounts'}
              </span>
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600">
                <UserX size={18} />
              </div>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-black text-rose-650 tracking-tight">
                {loading ? <RefreshCw className="h-5 w-5 animate-spin text-slate-300 inline" /> : expiredSubsCount}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                {isRtl ? 'بحاجة لتمديد' : 'Needs renew'}
              </span>
            </div>
          </div>

          {/* Metric 4: Trial Periods */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-amber-600 uppercase tracking-widest block">
                {isRtl ? 'الفترات التجريبية' : 'Trial Accounts'}
              </span>
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                <Clock size={18} />
              </div>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-black text-slate-900 tracking-tight">
                {loading ? <RefreshCw className="h-5 w-5 animate-spin text-slate-300 inline" /> : trialSubsCount}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                {isRtl ? 'حساب تجريبي' : 'Trials active'}
              </span>
            </div>
          </div>

        </div>

        {/* Supreme Cloud License & SQL RLS Diagnostics Tool */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden font-sans">
          <button 
            onClick={() => { sounds.playClick(); setIsTroubleshooterOpen(!isTroubleshooterOpen); }}
            className="w-full flex items-center justify-between p-5 bg-gradient-to-r from-slate-50 to-indigo-50/20 hover:from-slate-100 hover:to-indigo-50/40 transition-all font-black text-slate-800 text-xs sm:text-sm outline-none cursor-pointer text-right"
          >
            <div className="flex items-center gap-3">
              <span className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg">
                <Sparkles size={16} />
              </span>
              <span>
                {isRtl 
                  ? '🛠️ أداة تشخيص المشاكل الفورية وتفعيل صلاحيات المسؤول الخارق لـ Supabase (RLS Diagnostics)'
                  : '🛠️ Supabase Super Admin & RLS Client Sync Troubleshooter'}
              </span>
            </div>
            <span className={`transition-transform duration-300 ${isTroubleshooterOpen ? 'rotate-180' : ''}`}>
              <ChevronDown size={18} className="text-slate-550" />
            </span>
          </button>

          {isTroubleshooterOpen && (
            <div className="p-6 border-t border-slate-100 bg-slate-50/40 space-y-6 text-xs leading-relaxed text-slate-600 animate-slide-down">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Visual Explanation Side */}
                <div className="space-y-4 text-right">
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl space-y-2 text-slate-700">
                    <h4 className="font-extrabold text-amber-900 text-sm flex items-center gap-2">
                      <AlertCircle size={16} className="text-amber-600" />
                      <span>{isRtl ? 'لماذا لا يظهر المستخدمون الجدد تلقائياً؟' : 'Why are other users hidden?'}</span>
                    </h4>
                    <p className="font-semibold text-xs leading-relaxed">
                      {isRtl 
                        ? 'تُفعّل منصة Supabase بشكل افتراضي ميزة حماية الأسطر (Row Level Security - RLS) لكل من جدول ملفات المستخدمين وتراخيص الاشتراكات لمنع تداخل البيانات وحماية خصوصية العملاء.'
                        : 'Supabase enforces Row Level Security (RLS) on both user profiles and subscriptions. This protects privacy but prevents the Super Admin account from querying or modifying other rows by default.'}
                    </p>
                    <p className="font-semibold text-xs leading-relaxed">
                      {isRtl
                        ? 'لكي تعمل لوحة التحكم الإدارية بالكامل، يجب تخصيص سياسة تمنح حساب المسؤول الخارق (المطابق للبريد الإلكتروني venusalhab@gmail.com أو المعين برتبة super_admin) تصريح قراءة وتعديل كافة الاشتراكات والتراخيص.'
                        : 'To unlock full capability, we need to create a specific SQL policy allowing the master email to bypass RLS and view all subscribers.'}
                    </p>
                  </div>

                  <div className="bg-emerald-50 border border-emerald-150 p-4 rounded-xl space-y-1.5 text-slate-700">
                    <h4 className="font-extrabold text-emerald-950 text-sm flex items-center gap-2">
                      <Check size={16} className="text-emerald-700" />
                      <span>{isRtl ? 'الحل الجذري والحلول الاحترافية التي قمنا بتطبيقها' : 'Professional Solution Applied'}</span>
                    </h4>
                    <ul className="list-disc list-inside space-y-1 pr-1 font-semibold text-xs text-slate-750">
                      <li>{isRtl ? 'تحديث ملف supabase_schema.sql بالكامل بأحدث سياسات الأمان.' : 'Root schema rules updated perfectly inside supabase_schema.sql.'}</li>
                      <li>{isRtl ? 'توفير دالة فحص مخصصة مستقلة تمنع التعليق أو الالتفاف العودي المستمر لـ RLS.' : 'Engineered a Security Definer function to check super-admin status cleanly without infinite recursion.'}</li>
                      <li>{isRtl ? 'السماح للبريد الإلكتروني venusalhab@gmail.com تلقائياً بإجراء كافة تعديلات الاشتراكات والتراخيص.' : 'Auto-authorized venusalhab@gmail.com as the ultimate master admin.'}</li>
                    </ul>
                  </div>
                </div>

                {/* Practical Copy SQL Script Side */}
                <div className="space-y-4 text-right flex flex-col justify-between">
                  <div className="space-y-2">
                    <h4 className="font-extrabold text-slate-900 text-sm">
                      {isRtl ? 'كيفية تطبيق التحديث فورا في ثوانٍ معدودة:' : 'How to apply the patch inside Supabase in seconds:'}
                    </h4>
                    <ol className="list-decimal list-inside space-y-1.5 font-semibold text-slate-600 text-xs pr-1">
                      <li>{isRtl ? 'افتح لوحة تحكم سوبابيس (Supabase Dashboard) واذهب لمشروعك.' : 'Open your Supabase project in the browser.'}</li>
                      <li>{isRtl ? 'اضغط على SQL Editor في القائمة الجانبية اليسرى.' : 'Navigate to SQL Editor in the left navigation.'}</li>
                      <li>{isRtl ? 'اضغط على زر New Query لفتح صفحة فارغة جديدة.' : 'Create a new empty query sheet.'}</li>
                      <li>{isRtl ? 'انسخ السكربت المخصص في الأسفل بالتبويب المنسوخ، ثم انقر Run باللون الأخضر.' : 'Copy the script code below, paste it, and hit Run.'}</li>
                      <li>{isRtl ? 'اضغط على زر "تحديث فوري" للقرص والمزامنة لرؤية كافة المستخدمين المكتشفين في الحال!' : 'Click "Sync Live" tool above to load and update all users on-the-spot!'}</li>
                    </ol>
                  </div>

                  <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 font-mono text-[11px] relative mt-2 group">
                    <div className="absolute top-3 left-3 flex items-center gap-1.5">
                      <button 
                        onClick={() => {
                          const sqlCode = `
-- 1. تحديث دالة المشرف الخارق مع تحديد مسار البحث (لأمان SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.check_is_super_admin(user_id UUID)
RETURNS BOOLEAN 
SECURITY DEFINER
SET search_path = public -- حماية الدالة من اختراق مسار البحث
AS $$
DECLARE
    is_admin BOOLEAN;
BEGIN
    -- Check if current authenticated user belongs to our master admin email directly
    IF auth.jwt() ->> 'email' = 'venusalhab@gmail.com' THEN
        RETURN TRUE;
    END IF;

    -- قراءة مباشرة لتجنب التعقيد
    SELECT (role = 'super_admin') INTO is_admin 
    FROM public.profiles 
    WHERE id = user_id;
    RETURN COALESCE(is_admin, FALSE);
END;
$$ LANGUAGE plpgsql;

-- التأكد من وجود عمود الرتبة
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- 2. سياسات أمان جدول ملفات المستخدمين (Profiles)
-- تنويه: لمنع التداخل الدائري في SELECT، يسمح للمستخدم برؤية نفسه مباشرة دون استدعاء الدالة
DROP POLICY IF EXISTS "Users can view their own profile settings." ON public.profiles;
CREATE POLICY "Users can view their own profile settings." 
    ON public.profiles FOR SELECT 
    USING (
        (auth.uid() = id) OR 
        public.check_is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Users can update their own profile settings." ON public.profiles;
CREATE POLICY "Users can update their own profile settings." 
    ON public.profiles FOR UPDATE 
    USING (
        (auth.uid() = id) OR 
        public.check_is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Users can insert their own profile settings." ON public.profiles;
CREATE POLICY "Users can insert their own profile settings." 
    ON public.profiles FOR INSERT 
    WITH CHECK (
        (auth.uid() = id) OR 
        public.check_is_super_admin(auth.uid())
    );

-- 3. سياسات أمان جدول اشتراكات المستخدمين (User Subscriptions)
DROP POLICY IF EXISTS "Users can view their own subscription status" ON public.user_subscriptions;
CREATE POLICY "Users can view their own subscription status"
    ON public.user_subscriptions FOR SELECT
    USING (
        (auth.uid() = user_id) OR 
        public.check_is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Users can update their own subscription" ON public.user_subscriptions;
CREATE POLICY "Users can update their own subscription"
    ON public.user_subscriptions FOR UPDATE
    USING (
        (auth.uid() = user_id) OR 
        public.check_is_super_admin(auth.uid())
    );

DROP POLICY IF EXISTS "Users can insert their own subscription" ON public.user_subscriptions;
CREATE POLICY "Users can insert their own subscription"
    ON public.user_subscriptions FOR INSERT
    WITH CHECK (
        (auth.uid() = user_id) OR 
        public.check_is_super_admin(auth.uid())
    );

-- 4. دالة لاسترجاع كافة المستخدمين المسجلين من جدول auth.users (حصرياً للمشرف الخارق)
CREATE OR REPLACE FUNCTION public.get_auth_users()
RETURNS TABLE (
    id UUID,
    email TEXT,
    raw_user_meta_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE
)
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- التحقق من صلاحية المشرف الخارق
    IF auth.jwt() ->> 'email' = 'venusalhab@gmail.com' OR public.check_is_super_admin(auth.uid()) THEN
        RETURN QUERY 
        SELECT u.id, u.email::text, u.raw_user_meta_data, u.created_at
        FROM auth.users u;
    ELSE
        RAISE EXCEPTION 'Not authorized';
    END IF;
END;
$$ LANGUAGE plpgsql;
`;
                          navigator.clipboard.writeText(sqlCode.trim());
                          setCopied(true);
                          sounds.playSuccess();
                          toast.success(isRtl ? 'تم نسخ سكربت الصلاحيات بنجاح!' : 'SQL script copied to clipboard!');
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-650 transition rounded-lg text-[10px] font-bold outline-none cursor-pointer text-slate-300 hover:text-white flex items-center gap-1 border border-slate-700"
                      >
                        {copied ? <Check size={12} className="text-emerald-400" /> : <CreditCard size={12} />}
                        <span>{copied ? (isRtl ? 'تم النسخ!' : 'Copied!') : (isRtl ? 'نسخ الكود البرمجي' : 'Copy Script')}</span>
                      </button>
                    </div>
                    <div className="max-h-40 overflow-y-auto text-left whitespace-pre ltr pt-8 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
{`-- Securing database access for Super Admins
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

CREATE OR REPLACE FUNCTION public.check_is_super_admin(user_id UUID)
RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = user_id AND role = 'super_admin'
    );
END;
$$ LANGUAGE plpgsql;

-- Apply Select & Update permissions...
-- (Click Copy above for the full script!)`}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>

        {/* Central Filter Bar */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
          
          <div className="relative w-full md:w-96">
            <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-450" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isRtl ? 'البحث بالاسم، اسم المستودع، أو البريد الإلكتروني...' : 'Search by client name, business, mail...'}
              className="w-full pl-3.5 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 outline-none focus:border-indigo-500 focus:bg-white font-bold transition-all"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
            <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
              <button
                onClick={() => { sounds.playClick(); setStatusFilter('all'); }}
                className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all cursor-pointer ${statusFilter === 'all' ? 'bg-white text-indigo-650 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {isRtl ? 'الكل' : 'All'}
              </button>
              <button
                onClick={() => { sounds.playClick(); setStatusFilter('active'); }}
                className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all cursor-pointer ${statusFilter === 'active' ? 'bg-white text-indigo-650 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {isRtl ? 'نشط' : 'Active'}
              </button>
              <button
                onClick={() => { sounds.playClick(); setStatusFilter('trial'); }}
                className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all cursor-pointer ${statusFilter === 'trial' ? 'bg-white text-indigo-650 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {isRtl ? 'تجريبي' : 'Trial'}
              </button>
              <button
                onClick={() => { sounds.playClick(); setStatusFilter('expired'); }}
                className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all cursor-pointer ${statusFilter === 'expired' ? 'bg-white text-indigo-650 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {isRtl ? 'منتهي لقفل' : 'Expired'}
              </button>
            </div>

            <button
              onClick={() => { sounds.playClick(); fetchRealSubscribers(); }}
              className="p-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold rounded-xl border border-indigo-150 transition-all cursor-pointer text-xs flex items-center gap-1.5"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>{isRtl ? 'تحديث فوري' : 'Sync Live'}</span>
            </button>
          </div>
        </div>

        {/* Ultra-Clean spacious subscriber registry table with light background */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {loading ? (
            <div className="py-20 text-center space-y-4">
              <RefreshCw className="h-8 w-8 text-indigo-600 animate-spin mx-auto text-center" />
              <p className="text-xs text-slate-400 font-bold">
                {isRtl ? 'جار الربط المباشر وجلب سجلات المشتركين...' : 'Reading subscriber nodes in live database...'}
              </p>
            </div>
          ) : filteredSubscribers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse" dir={isRtl ? 'rtl' : 'ltr'}>
                <thead>
                  <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 font-extrabold h-12">
                    <th className="px-6 text-right font-black">{isRtl ? 'المنشأة والعميل' : 'Registered Client'}</th>
                    <th className="px-6 text-center font-black">{isRtl ? 'حالة الترخيص' : 'Authorization Status'}</th>
                    <th className="px-6 text-right font-black">{isRtl ? 'فترة الصلاحية ونهايتها' : 'Validation Period / Expiry'}</th>
                    <th className="px-6 text-center font-black">{isRtl ? 'الرتبة في النظام' : 'System Role'}</th>
                    <th className="px-6 text-center font-black">{isRtl ? 'إجراءات وتحرير التراخيص' : 'License Adjustment Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredSubscribers.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition h-16">
                      
                      {/* Business Client identity */}
                      <td className="px-6 py-4 text-right">
                        <div>
                          <span className="font-extrabold text-slate-900 block truncate max-w-[220px]">
                            {item.businessName}
                          </span>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[11px] text-slate-550 block font-bold">
                              {item.displayName}
                            </span>
                            <span className="text-slate-350">•</span>
                            <span className="text-[10px] text-slate-400 font-mono block">
                              {item.email}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Pill style statuses */}
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center gap-1.5 justify-center">
                          <span className={`px-3 py-1.5 rounded-full font-bold text-[10px] uppercase tracking-wide inline-block border
                            ${item.status === 'active' 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                              : item.status === 'trial' 
                                ? 'bg-amber-50 text-amber-700 border-amber-100' 
                                : 'bg-rose-50 text-rose-700 border-rose-100'}`}
                          >
                            {item.status === 'active' 
                              ? (isRtl ? 'نشط (النسخة الكاملة)' : 'Active (Super Premium)') 
                              : item.status === 'trial' 
                                ? (isRtl ? 'تجريبي' : 'Trial period') 
                                : (isRtl ? 'منتهي الصلاحية' : 'License Blocked')}
                          </span>
                          {item.plan && (
                            <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md block">
                              {item.plan}
                            </span>
                          )}

                          {/* Direct Interactive active/inactive Toggle Switch with Instant Db Sync */}
                          <div className="flex items-center gap-1.5 mt-2 select-none" dir="ltr">
                            <span className={`text-[9px] font-extrabold ${item.status !== 'active' ? 'text-rose-500' : 'text-slate-400'}`}>
                              {isRtl ? 'معطل' : 'INACTIVE'}
                            </span>
                            <button
                              role="switch"
                              aria-checked={item.status === 'active'}
                              onClick={() => handleStatusChange(item.id, item.status === 'active' ? 'expired' : 'active')}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                item.status === 'active' ? 'bg-emerald-500' : 'bg-slate-200'
                              }`}
                              title={isRtl ? 'تبديل حالة الاشتراك فورياً' : 'Toggle status instantly'}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                                  item.status === 'active' ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <span className={`text-[9px] font-extrabold ${item.status === 'active' ? 'text-emerald-500' : 'text-slate-400'}`}>
                              {isRtl ? 'نشط' : 'ACTIVE'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Expiration term details */}
                      <td className="px-6 py-4 text-right">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Calendar size={12} className="text-slate-400" />
                            <span className="text-slate-800 font-bold font-sans">
                              {new Date(item.expiry_date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-450 block font-semibold">
                            {isRtl ? 'بدأ الاشتراك في: ' : 'Trial start: '} 
                            {new Date(item.trial_start_date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                          </span>
                        </div>
                      </td>

                      {/* Role indicator badge */}
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold block mx-auto w-max
                          ${item.role === 'super_admin' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-slate-100 text-slate-600'}`}
                        >
                          {item.role === 'super_admin' ? (isRtl ? 'مدير خارق' : 'Super Admin') : (isRtl ? 'مستخدم' : 'Standard')}
                        </span>
                      </td>

                      {/* Exquisite inline popup & quick dropdown next to each user to quickly change status/term without clutter */}
                      <td className="px-6 py-4 text-center relative select-none">
                        <div className="flex items-center justify-center gap-3">
                          
                          {/* 1. Direct status fast selector dropdown */}
                          <div className="relative inline-block">
                            <select
                              value={item.status}
                              onChange={(e) => handleStatusChange(item.id, e.target.value as any)}
                              className="bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold py-1.5 px-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer transition-colors"
                            >
                              <option value="active">{isRtl ? 'نشط' : 'Active'}</option>
                              <option value="trial">{isRtl ? 'تجريبي' : 'Trial'}</option>
                              <option value="expired">{isRtl ? 'معطل' : 'Expired'}</option>
                            </select>
                          </div>

                          {/* 2. Direct time and role action selector */}
                          <div className="relative inline-block">
                            <select
                              defaultValue=""
                              onChange={(e) => {
                                const action = e.target.value;
                                if (action === 'extend_30') {
                                  extendUserPeriod(item.id, 30);
                                } else if (action === 'extend_90') {
                                  extendUserPeriod(item.id, 90);
                                } else if (action === 'extend_365') {
                                  extendUserPeriod(item.id, 365);
                                } else if (action === 'toggle_role') {
                                  handleToggleRole(item.id, item.role);
                                }
                                e.target.value = ''; // Reset select to default
                              }}
                              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-black py-1.5 px-3 rounded-xl border border-indigo-150 focus:outline-none cursor-pointer transition-colors"
                            >
                              <option value="">{isRtl ? 'إجراء ترقية...' : 'Period Action...'}</option>
                              <option value="extend_30">{isRtl ? 'تمديد +30 يوماً' : 'Add +30 Days'}</option>
                              <option value="extend_90">{isRtl ? 'تمديد +90 يوماً' : 'Add +90 Days'}</option>
                              <option value="extend_365">{isRtl ? 'تمديد +سنة (٣٦٥ يوماً)' : 'Add +1 Year'}</option>
                              <option value="toggle_role">{isRtl ? 'تغيير الصلاحية (مشرف/مستند)' : 'Toggle Privileges'}</option>
                            </select>
                          </div>

                          {/* 3. Date Picker direct icon */}
                          <div className="relative flex items-center">
                            <input
                              type="date"
                              value={new Date(item.expiry_date).toISOString().split('T')[0]}
                              onChange={(e) => handleCustomDateChange(item.id, e.target.value)}
                              className="h-7 w-7 text-transparent bg-transparent absolute opacity-0 cursor-pointer z-10 [color-scheme:light]"
                              title={isRtl ? 'تعيين تاريخ انتهاء مخصص' : 'Select exact expiry date'}
                            />
                            <button className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-500">
                              <Calendar size={12} />
                            </button>
                          </div>

                        </div>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-20 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mx-auto border border-slate-100 text-slate-400">
                <AlertCircle size={22} />
              </div>
              <p className="text-xs text-slate-500 font-bold">
                {isRtl ? 'لا توجد أي منشآت لمستخدمين بعد.' : 'No registered storage nodes found in the database.'}
              </p>
            </div>
          )}
        </div>
          </>
        )}

      </div>
    </div>
  );
}
