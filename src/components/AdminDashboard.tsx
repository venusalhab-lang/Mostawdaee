import React, { useEffect, useState } from 'react';
import {
  AlertCircle, Calendar, ClipboardList, Clock, Inbox, Lock, RefreshCw, Search, ShieldCheck, UserCheck, Users, UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import { sounds } from '../lib/sounds';
import { arCount } from '../lib/arabicPlural';
import { type AdminSubscriber, type AdminSubscriptionOp, fetchAdminSubscribers, mutateAdminSubscription } from '../lib/adminSubscriptionApi';
import { type PlatformRole, SUPPORT_GRACE_DAYS, platformRoleLabel, staffCan } from '../lib/platformStaff';
import AdminSupportInbox from './AdminSupportInbox';
import { AdminAuditLog, AdminStaffManager, FounderNotices } from './AdminStaffPanel';

interface Props {
  language: 'en' | 'ar';
}

type Tab = 'subscribers' | 'tickets' | 'staff' | 'audit';

export default function AdminDashboard({ language }: Props) {
  const isRtl = language === 'ar';
  const { user, platformRole } = useFirebase();
  const [tab, setTab] = useState<Tab>('subscribers');

  if (!platformRole) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
            <Lock size={22} />
          </div>
          <h3 className="text-lg font-bold text-slate-900">{isRtl ? 'هذه اللوحة لفريق مستودعي' : 'This console is for the Mostawdaee team'}</h3>
          <p className="text-xs text-slate-500">{user?.email}</p>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType; allowed: boolean }> = [
    { id: 'subscribers', label: isRtl ? 'المشتركون' : 'Subscribers', icon: Users, allowed: staffCan(platformRole, 'view_subscribers') },
    { id: 'tickets', label: isRtl ? 'طلبات الدعم' : 'Support tickets', icon: Inbox, allowed: staffCan(platformRole, 'answer_tickets') },
    { id: 'staff', label: isRtl ? 'فريق المنصة' : 'Platform team', icon: ShieldCheck, allowed: staffCan(platformRole, 'manage_staff') },
    { id: 'audit', label: isRtl ? 'سجل العمليات' : 'Audit log', icon: ClipboardList, allowed: staffCan(platformRole, 'view_audit') },
  ];
  const visibleTabs = tabs.filter((t) => t.allowed);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 py-8 px-4 md:px-8 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl"><ShieldCheck size={22} /></span>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">{isRtl ? 'لوحة فريق مستودعي' : 'Mostawdaee console'}</h1>
          </div>
          <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 self-start md:self-center">
            <div className="text-xs">
              <span className="font-black text-indigo-700">{platformRoleLabel(platformRole, isRtl)}</span>
              <span className="text-slate-400 mx-1.5">•</span>
              <span className="font-bold text-slate-600" dir="ltr">{user?.email}</span>
            </div>
          </div>
        </div>

        {platformRole === 'founder' && <FounderNotices isRtl={isRtl} />}

        <div className="flex flex-wrap gap-2" role="tablist">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => { sounds.playClick(); setTab(t.id); }}
              className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 border transition cursor-pointer ${
                activeTab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <t.icon size={14} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {activeTab === 'subscribers' && <SubscribersPanel role={platformRole} isRtl={isRtl} />}
        {activeTab === 'tickets' && <AdminSupportInbox isRtl={isRtl} />}
        {activeTab === 'staff' && <AdminStaffManager isRtl={isRtl} />}
        {activeTab === 'audit' && <AdminAuditLog isRtl={isRtl} />}
      </div>
    </div>
  );
}

function SubscribersPanel({ role, isRtl }: { role: PlatformRole; isRtl: boolean }) {
  const [subscribers, setSubscribers] = useState<AdminSubscriber[]>([]);
  const [aiDailyLimit, setAiDailyLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'trial' | 'expired'>('all');
  const canManage = staffCan(role, 'manage_subscriptions');
  const canGrace = staffCan(role, 'grant_grace');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { subscribers: rows, aiDailyLimit: limit } = await fetchAdminSubscribers();
      setSubscribers(rows || []);
      setAiDailyLimit(typeof limit === 'number' ? limit : null);
    } catch (err: any) {
      setSubscribers([]);
      setError(err?.message || (isRtl ? 'تعذر قراءة المشتركين' : 'Could not load subscribers'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (userId: string, op: AdminSubscriptionOp, extra?: { days?: number; expiry?: string }) => {
    if (busyId) return;
    sounds.playClick();
    setBusyId(userId);
    try {
      const { subscriber } = await mutateAdminSubscription({ userId, op, ...extra });
      setSubscribers((prev) => prev.map((row) => (row.id === userId ? { ...row, ...subscriber } : row)));
      sounds.playSuccess();
      const kind = subscriber.status === 'active'
        ? (isRtl ? 'مدفوع' : 'paid')
        : subscriber.status === 'trial' ? (isRtl ? 'تجريبي' : 'trial') : (isRtl ? 'منتهٍ' : 'expired');
      toast.success(isRtl
        ? `${subscriber.businessName || subscriber.displayName || subscriber.email}: ${kind}، ${arCount(subscriber.daysRemaining, { one: 'يوم واحد متبقٍ', two: 'يومان متبقيان', few: '{n} أيام متبقية', many: '{n} يوماً متبقياً', other: '{n} يوم متبقٍ' })}`
        : `${subscriber.email}: ${kind}, ${subscriber.daysRemaining} days left`);
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر تعديل الاشتراك' : 'Could not update the subscription'));
    } finally {
      setBusyId(null);
    }
  };

  const counts = {
    total: subscribers.length,
    active: subscribers.filter((s) => s.status === 'active').length,
    trial: subscribers.filter((s) => s.status === 'trial').length,
    expired: subscribers.filter((s) => s.status === 'expired').length,
  };

  const query = searchQuery.toLowerCase().trim();
  const filtered = subscribers.filter((s) =>
    (statusFilter === 'all' || s.status === statusFilter) &&
    (s.email.toLowerCase().includes(query) || s.displayName.toLowerCase().includes(query) || s.businessName.toLowerCase().includes(query)));

  const metric = (label: string, value: number, Icon: React.ElementType, tone: string) => (
    <div className="bg-white p-5 rounded-2xl border border-slate-200">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-extrabold ${tone}`}>{label}</span>
        <Icon size={18} className={tone} />
      </div>
      <div className="mt-3 text-3xl font-black text-slate-900 tabular-nums">
        {loading ? <RefreshCw className="h-5 w-5 animate-spin text-slate-300 inline" /> : value}
      </div>
    </div>
  );

  const chip = 'px-2 py-1 rounded-lg text-[10px] font-bold border disabled:opacity-50 cursor-pointer';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metric(isRtl ? 'كل الحسابات' : 'All accounts', counts.total, Users, 'text-slate-500')}
        {metric(isRtl ? 'مدفوع' : 'Paid', counts.active, UserCheck, 'text-emerald-600')}
        {metric(isRtl ? 'تجريبي' : 'Trial', counts.trial, Clock, 'text-amber-600')}
        {metric(isRtl ? 'منتهٍ' : 'Expired', counts.expired, UserX, 'text-rose-600')}
      </div>

      {!canManage && canGrace && (
        <p className="text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-3">
          {isRtl
            ? `صلاحيتك: مهلة حتى ${SUPPORT_GRACE_DAYS} أيام من اليوم لحساب انتهى أو قارب. تُسجَّل باسمك في سجل العمليات.`
            : `Your role can give a grace of up to ${SUPPORT_GRACE_DAYS} days from today. It is recorded under your name.`}
        </p>
      )}

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-5 py-4 text-sm font-semibold">{error}</div>}

      <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-96">
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isRtl ? 'البحث بالاسم أو المتجر أو البريد' : 'Search by name, store or email'}
            aria-label={isRtl ? 'البحث بالاسم أو المتجر أو البريد' : 'Search by name, store or email'}
            className="w-full pl-3.5 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 outline-none focus:border-indigo-500 font-bold"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'active', 'trial', 'expired'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs font-extrabold rounded-lg border cursor-pointer ${statusFilter === f ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'text-slate-500 border-transparent hover:text-slate-900'}`}
            >
              {f === 'all' ? (isRtl ? 'الكل' : 'All') : f === 'active' ? (isRtl ? 'مدفوع' : 'Paid') : f === 'trial' ? (isRtl ? 'تجريبي' : 'Trial') : (isRtl ? 'منتهٍ' : 'Expired')}
            </button>
          ))}
          <button type="button" onClick={() => void load()} className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>{isRtl ? 'تحديث' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><RefreshCw className="h-7 w-7 text-indigo-600 animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <AlertCircle size={22} className="mx-auto text-slate-400" />
            <p className="text-xs text-slate-500 font-bold">{isRtl ? 'لا توجد حسابات مطابقة.' : 'No matching accounts.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 h-11">
                  <th className="px-5 text-start font-black">{isRtl ? 'المتجر والحساب' : 'Store & account'}</th>
                  <th className="px-5 text-center font-black">{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="px-5 text-start font-black">{isRtl ? 'المتبقي' : 'Remaining'}</th>
                  {subscribers.some((s) => s.aiToday != null) && (
                    <th className="px-5 text-center font-black">{isRtl ? 'أسئلة المساعد' : 'Assistant questions'}</th>
                  )}
                  {canGrace && <th className="px-5 text-center font-black">{isRtl ? 'إجراءات' : 'Actions'}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <span className="font-extrabold text-slate-900 block truncate max-w-[220px]">{item.businessName || item.displayName || '—'}</span>
                      <span className="text-[10px] text-slate-400 font-mono block" dir="ltr">{item.email || (isRtl ? 'بدون بريد' : 'No email')}</span>
                      {item.role === 'founder' && <span className="text-[10px] font-bold text-indigo-600">{isRtl ? 'المؤسس' : 'Founder'}</span>}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] border ${
                        item.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : item.status === 'trial' ? 'bg-amber-50 text-amber-700 border-amber-100'
                            : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                        {item.status === 'active' ? (isRtl ? 'مدفوع' : 'Paid') : item.status === 'trial' ? (isRtl ? 'تجريبي' : 'Trial') : (isRtl ? 'منتهٍ' : 'Expired')}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-base font-black text-slate-900 tabular-nums">{item.daysRemaining}</span>
                      <span className="text-[10px] text-slate-500 font-semibold mx-1">{isRtl ? 'يوماً' : 'days'}</span>
                      {item.endsAt && (
                        <div className="flex items-center gap-1 text-slate-600">
                          <Calendar size={11} className="text-slate-400" />
                          <span>{new Date(item.endsAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                        </div>
                      )}
                    </td>
                    {subscribers.some((s) => s.aiToday != null) && (
                      <td className="px-5 py-3 text-center tabular-nums">
                        <span className="font-black text-slate-900">{item.aiToday ?? 0}</span>
                        {aiDailyLimit !== null && <span className="text-slate-400">/{aiDailyLimit}</span>}
                        <span className="block text-[10px] text-slate-500">{isRtl ? `${item.ai30d ?? 0} خلال 30 يوماً` : `${item.ai30d ?? 0} in 30 days`}</span>
                      </td>
                    )}
                    {canGrace && (
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-xs mx-auto">
                          {(canManage ? [7, 30, 90, 365] : [SUPPORT_GRACE_DAYS]).map((days) => (
                            <button key={days} type="button" disabled={busyId === item.id} onClick={() => void run(item.id, 'extend', { days })}
                              className={`${chip} bg-indigo-50 text-indigo-800 border-indigo-100`}>
                              {canManage ? `+${days}` : (isRtl ? `مهلة ${days} أيام` : `${days}-day grace`)}
                            </button>
                          ))}
                          {canManage && (
                            <>
                              <button type="button" disabled={busyId === item.id} onClick={() => void run(item.id, 'mark_paid')}
                                className={`${chip} bg-emerald-50 text-emerald-800 border-emerald-100`}>
                                {isRtl ? 'مدفوع' : 'Paid'}
                              </button>
                              <button type="button" disabled={busyId === item.id}
                                onClick={() => {
                                  if (!window.confirm(isRtl ? 'يبدأ هذا تجربة جديدة من 25 يوماً من اليوم.' : 'This starts a 25-day trial from today.')) return;
                                  void run(item.id, 'set_trial');
                                }}
                                className={`${chip} bg-amber-50 text-amber-800 border-amber-100`}>
                                {isRtl ? 'تجريبي' : 'Trial'}
                              </button>
                              <button type="button" disabled={busyId === item.id}
                                onClick={() => {
                                  if (!window.confirm(isRtl ? 'إنهاء الاشتراك يغلق حساب هذا العميل.' : 'Ending the subscription locks this customer out.')) return;
                                  void run(item.id, 'expire');
                                }}
                                className={`${chip} bg-rose-50 text-rose-800 border-rose-100`}>
                                {isRtl ? 'إنهاء' : 'End'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
