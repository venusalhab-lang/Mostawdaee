import React, { useState, useEffect } from 'react';
import { 
  Users, 
  ShieldCheck, 
  RefreshCw, 
  AlertCircle, 
  Calendar, 
  Clock, 
  Search, 
  Lock,
  UserCheck,
  UserX
} from 'lucide-react';
import { useFirebase } from './FirebaseProvider';
import { sounds } from '../lib/sounds';
import { toast } from 'sonner';
import CoreCommandCenter from './CoreCommandCenter';
import { isAdminEmail } from '../lib/adminAccess';
import { fetchAdminSubscribers, mutateAdminSubscription } from '../lib/adminSubscriptionApi';

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
  trial_start_date: string | null;
  expiry_date: string | null;
  endsAt: string | null;
  daysRemaining: number;
}

export default function AdminDashboard({ language }: Props) {
  const isRtl = language === 'ar';
  const { user } = useFirebase() as any;

  // Real Database and Authorization States
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Subscribers State
  const [subscribers, setSubscribers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cyber' | 'classic'>('classic');

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'trial' | 'expired'>('all');

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
        setIsAuthorized(isAdminEmail(email));
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

  const applySubscriber = (row: {
    id: string;
    email: string;
    displayName: string;
    businessName: string;
    role: string;
    status: 'active' | 'trial' | 'expired';
    trialStart: string | null;
    expiry: string | null;
    endsAt: string | null;
    daysRemaining: number;
  }): TenantUser => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    businessName: row.businessName,
    role: row.role || 'user',
    status: row.status,
    trial_start_date: row.trialStart,
    expiry_date: row.expiry,
    endsAt: row.endsAt,
    daysRemaining: row.daysRemaining,
  });

  const fetchRealSubscribers = async () => {
    if (!isAuthorized) return;
    setLoading(true);
    setError(null);
    try {
      const { subscribers: rows } = await fetchAdminSubscribers();
      setSubscribers((rows || []).map(applySubscriber));
    } catch (err: any) {
      setSubscribers([]);
      setError(err?.message || (isRtl ? 'تعذر قراءة المشتركين' : 'Could not load subscribers'));
    } finally {
      setLoading(false);
    }
  };

  const runSubscriptionOp = async (
    userId: string,
    op: 'extend' | 'expire' | 'mark_paid' | 'set_trial' | 'set_expiry',
    extra?: { days?: number; expiry?: string }
  ) => {
    if (busyId) return;
    sounds.playClick();
    setBusyId(userId);
    try {
      const { subscriber } = await mutateAdminSubscription({ userId, op, ...extra });
      const next = applySubscriber(subscriber);
      setSubscribers((prev) => prev.map((row) => (row.id === userId ? next : row)));
      sounds.playSuccess();
      const kind = next.status === 'active'
        ? (isRtl ? 'مدفوع' : 'paid')
        : next.status === 'trial'
          ? (isRtl ? 'تجريبي' : 'trial')
          : (isRtl ? 'منتهٍ' : 'expired');
      toast.success(
        isRtl
          ? `${next.businessName || next.displayName || next.email}: ${kind}، ${next.daysRemaining} يوماً متبقية`
          : `${next.email}: ${kind}, ${next.daysRemaining} days left`
      );
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر تعديل الاشتراك' : 'Could not update the subscription'));
    } finally {
      setBusyId(null);
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
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs text-slate-600">
            {isRtl ? 'الحساب الحالي: ' : 'Signed in as: '}
            <span className="font-bold text-slate-900">{user?.email || (isRtl ? 'زائر' : 'Guest')}</span>
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
                ? 'الوقت المتبقي، نوع الحساب، وتمديد الاشتراك من الخادم.'
                : 'Time left, account type, and subscription extensions from the server.'}
            </p>
          </div>

          {/* Super Admin Badge showing current login user */}
          <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm self-end md:self-center">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                {isRtl ? 'حساب المالك:' : 'Owner account:'}
              </span>
              <span className="text-xs font-black text-slate-700 font-sans">
                {user?.email}
              </span>
            </div>
          </div>
        </div>

        {/* High-Contrast Metric Cards in clean white with bold text & generous spacing */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* Metric 1: Total Users */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow duration-300 relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block">
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
              <span className="text-4xl font-black text-rose-600 tracking-tight">
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

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-5 py-4 text-sm font-semibold">
            {error}
          </div>
        )}


        {/* Central Filter Bar */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
          
          <div className="relative w-full md:w-96">
            <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isRtl ? 'البحث بالاسم، اسم المستودع، أو البريد الإلكتروني...' : 'Search by client name, business, mail...'} aria-label={isRtl ? 'البحث بالاسم، اسم المستودع، أو البريد الإلكتروني...' : 'Search by client name, business, mail...'}
              className="w-full pl-3.5 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 outline-none focus:border-indigo-500 focus:bg-white font-bold transition-all"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
            <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
              <button
                onClick={() => { sounds.playClick(); setStatusFilter('all'); }}
                className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all cursor-pointer ${statusFilter === 'all' ? 'bg-white text-indigo-600 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {isRtl ? 'الكل' : 'All'}
              </button>
              <button
                onClick={() => { sounds.playClick(); setStatusFilter('active'); }}
                className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all cursor-pointer ${statusFilter === 'active' ? 'bg-white text-indigo-600 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {isRtl ? 'نشط' : 'Active'}
              </button>
              <button
                onClick={() => { sounds.playClick(); setStatusFilter('trial'); }}
                className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all cursor-pointer ${statusFilter === 'trial' ? 'bg-white text-indigo-600 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {isRtl ? 'تجريبي' : 'Trial'}
              </button>
              <button
                onClick={() => { sounds.playClick(); setStatusFilter('expired'); }}
                className={`px-3 py-1.5 text-xs font-extrabold rounded-lg transition-all cursor-pointer ${statusFilter === 'expired' ? 'bg-white text-indigo-600 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {isRtl ? 'منتهي لقفل' : 'Expired'}
              </button>
            </div>

            <button
              onClick={() => { sounds.playClick(); fetchRealSubscribers(); }}
              className="p-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold rounded-xl border border-indigo-100 transition-all cursor-pointer text-xs flex items-center gap-1.5"
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
                    <th className="px-6 text-right font-black">{isRtl ? 'الوقت المتبقي' : 'Time remaining'}</th>
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
                            <span className="text-[11px] text-slate-500 block font-bold">
                              {item.displayName}
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="text-[10px] text-slate-400 font-mono block">
                              {item.email || (isRtl ? 'بدون بريد' : 'No email')}
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
                              ? (isRtl ? 'مدفوع' : 'Paid') 
                              : item.status === 'trial' 
                                ? (isRtl ? 'تجريبي' : 'Trial') 
                                : (isRtl ? 'منتهٍ' : 'Expired')}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="space-y-1">
                          <span className="text-lg font-black text-slate-900 tabular-nums">
                            {item.daysRemaining}
                          </span>
                          <span className="text-[10px] text-slate-500 font-semibold mr-1">
                            {isRtl ? 'يوماً' : 'days'}
                          </span>
                          {item.endsAt && (
                            <div className="flex items-center gap-1.5">
                              <Calendar size={12} className="text-slate-400" />
                              <span className="text-slate-700 font-semibold text-xs">
                                {new Date(item.endsAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                          )}
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
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-xs mx-auto">
                          {[7, 30, 90, 365].map((days) => (
                            <button
                              key={days}
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => runSubscriptionOp(item.id, 'extend', { days })}
                              className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-800 text-[10px] font-bold border border-indigo-100 disabled:opacity-50"
                            >
                              +{days}
                            </button>
                          ))}
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => runSubscriptionOp(item.id, 'mark_paid')}
                            className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 text-[10px] font-bold border border-emerald-100 disabled:opacity-50"
                          >
                            {isRtl ? 'مدفوع' : 'Paid'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => {
                              const warning = isRtl
                                ? 'يبدأ هذا حساباً تجريبياً من 25 يوماً من الآن.'
                                : 'This starts a 25-day trial from today.';
                              if (!window.confirm(warning)) return;
                              runSubscriptionOp(item.id, 'set_trial');
                            }}
                            className="px-2 py-1 rounded-lg bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-100 disabled:opacity-50"
                          >
                            {isRtl ? 'تجريبي' : 'Trial'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => {
                              const warning = isRtl
                                ? 'إنهاء الاشتراك يغلق حساب هذا العميل.'
                                : 'Ending the subscription locks this customer out.';
                              if (!window.confirm(warning)) return;
                              runSubscriptionOp(item.id, 'expire');
                            }}
                            className="px-2 py-1 rounded-lg bg-rose-50 text-rose-800 text-[10px] font-bold border border-rose-100 disabled:opacity-50"
                          >
                            {isRtl ? 'إنهاء' : 'End'}
                          </button>
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
