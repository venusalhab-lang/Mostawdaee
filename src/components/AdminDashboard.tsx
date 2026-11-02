import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  ClipboardList,
  Clock,
  ExternalLink,
  Inbox,
  Lock,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import Logo from './Logo';
import { sounds } from '../lib/sounds';
import { arCount } from '../lib/arabicPlural';
import { APP_NAME_AR, APP_NAME_EN } from '../lib/brand';
import {
  type AdminSubscriber,
  type AdminSubscriptionOp,
  fetchAdminSubscribers,
  mutateAdminSubscription,
} from '../lib/adminSubscriptionApi';
import { type PlatformRole, SUPPORT_GRACE_DAYS, platformRoleLabel, staffCan } from '../lib/platformStaff';
import {
  opsAmbient,
  opsBtnGhost,
  opsCard,
  opsChip,
  opsError,
  opsGrid,
  opsInput,
  opsShell,
  opsStatus,
  opsTableHead,
} from '../lib/adminOpsTheme';
import AdminSupportInbox from './AdminSupportInbox';
import { AdminAuditLog, AdminStaffManager, FounderNotices } from './AdminStaffPanel';

interface Props {
  language: 'en' | 'ar';
}

type Tab = 'subscribers' | 'tickets' | 'staff' | 'audit';

const SITE = 'https://mostawdaee.com';

export default function AdminDashboard({ language }: Props) {
  const isRtl = language === 'ar';
  const { user, platformRole, platformRoleReady } = useFirebase();
  const [tab, setTab] = useState<Tab>('subscribers');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!platformRoleReady) {
    return (
      <div className={`${opsShell} flex items-center justify-center p-10`} dir={isRtl ? 'rtl' : 'ltr'}>
        <div className={opsAmbient} />
        <div className="relative text-center space-y-3">
          <RefreshCw className="h-6 w-6 text-cyan-300 animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-400">
            {isRtl ? 'جارٍ التحقق من صلاحيات الفريق...' : 'Checking team access...'}
          </p>
        </div>
      </div>
    );
  }

  if (!platformRole) {
    return (
      <div className={`${opsShell} flex items-center justify-center p-6`} dir={isRtl ? 'rtl' : 'ltr'}>
        <div className={opsAmbient} />
        <div className={`relative max-w-md w-full ${opsCard} p-8 text-center space-y-4`}>
          <div className="h-12 w-12 rounded-2xl bg-rose-500/10 text-rose-300 flex items-center justify-center mx-auto border border-rose-400/20">
            <Lock size={22} />
          </div>
          <h3 className="text-lg font-black text-white">
            {isRtl ? 'هذه اللوحة لفريق مستودعي' : 'This console is for the Mostawdaee team'}
          </h3>
          <p className="text-xs text-slate-400" dir="ltr">{user?.email}</p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {isRtl
              ? 'إن كنت عضواً في الفريق وتظهر هذه الرسالة، أكّد بريدك أو اطلب من المؤسس تفعيل عضويتك، وتأكد أن الخادم يعمل بمفتاح الخدمة.'
              : 'If you are on the team and see this, confirm your email or ask the founder to activate you, and ensure the server has the service role key.'}
          </p>
          <a
            href={SITE}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-cyan-300 hover:text-cyan-200"
          >
            mostawdaee.com <ExternalLink size={12} />
          </a>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType; allowed: boolean }> = [
    { id: 'subscribers', label: isRtl ? 'المشتركون' : 'Subscribers', icon: Users, allowed: staffCan(platformRole, 'view_subscribers') },
    { id: 'tickets', label: isRtl ? 'الدعم' : 'Support', icon: Inbox, allowed: staffCan(platformRole, 'answer_tickets') },
    { id: 'staff', label: isRtl ? 'الفريق' : 'Team', icon: ShieldCheck, allowed: staffCan(platformRole, 'manage_staff') },
    { id: 'audit', label: isRtl ? 'سجل العمليات' : 'Audit', icon: ClipboardList, allowed: staffCan(platformRole, 'view_audit') },
  ];
  const visibleTabs = tabs.filter((t) => t.allowed);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id;
  const brand = isRtl ? APP_NAME_AR : APP_NAME_EN;
  const clock = new Date(now).toLocaleString(isRtl ? 'ar-EG' : 'en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={opsShell} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className={opsAmbient} />
      <div className={opsGrid} />

      <div className="relative z-[1] p-5 sm:p-7 lg:p-8 space-y-6">
        <header className="flex flex-col xl:flex-row xl:items-end justify-between gap-5 pb-5 border-b border-white/[0.07]">
          <div className="space-y-3 min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-3 py-1 text-[10px] font-black tracking-[0.18em] uppercase text-cyan-200/90">
              <Radio size={11} className="text-cyan-300 animate-pulse" />
              {isRtl ? 'غرفة العمليات' : 'Operations'}
            </div>
            <div className="flex items-center gap-3 min-w-0">
              <Logo size={44} />
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white truncate">
                  {isRtl ? `غرفة عمليات ${brand}` : `${brand} operations`}
                </h1>
                <p className="text-xs text-slate-400 font-semibold mt-1">
                  {isRtl
                    ? 'اشتراكات · دعم · صلاحيات · تدقيق — مرتبطة بـ mostawdaee.com'
                    : 'Subscriptions · support · access · audit — live on mostawdaee.com'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start xl:self-auto">
            <div className={`${opsCard} px-3.5 py-2.5 flex items-center gap-3`}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {isRtl ? 'الدور' : 'Role'}
                </p>
                <p className="text-xs font-black text-cyan-200">{platformRoleLabel(platformRole, isRtl)}</p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {isRtl ? 'المشغّل' : 'Operator'}
                </p>
                <p className="text-xs font-bold text-slate-300 truncate max-w-[180px]" dir="ltr">
                  {user?.email}
                </p>
              </div>
            </div>
            <div className={`${opsCard} px-3.5 py-2.5 text-end`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 justify-end">
                <Clock size={11} />
                {isRtl ? 'الوقت المحلي' : 'Local time'}
              </p>
              <p className="text-sm font-black tabular-nums text-white mt-0.5">{clock}</p>
            </div>
            <a
              href={SITE}
              target="_blank"
              rel="noreferrer"
              className={`${opsBtnGhost} text-cyan-200 border-cyan-400/20 hover:border-cyan-300/40`}
              title="mostawdaee.com"
            >
              <ExternalLink size={13} />
              mostawdaee.com
            </a>
          </div>
        </header>

        {platformRole === 'founder' && <FounderNotices isRtl={isRtl} />}

        <nav className={`${opsCard} p-1.5 flex flex-wrap gap-1`} role="tablist" aria-label={isRtl ? 'أقسام غرفة العمليات' : 'Operations sections'}>
          {visibleTabs.map((t) => {
            const selected = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  sounds.playClick();
                  setTab(t.id);
                }}
                className={`px-4 py-2.5 rounded-xl text-xs font-black flex items-center gap-2 transition cursor-pointer ${
                  selected
                    ? 'bg-cyan-500 text-[#041018] shadow-[0_0_24px_-8px_rgba(34,211,238,0.8)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <t.icon size={14} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

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

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (userId: string, op: AdminSubscriptionOp, extra?: { days?: number; expiry?: string }) => {
    if (busyId) return;
    sounds.playClick();
    setBusyId(userId);
    try {
      const { subscriber } = await mutateAdminSubscription({ userId, op, ...extra });
      setSubscribers((prev) => prev.map((row) => (row.id === userId ? { ...row, ...subscriber } : row)));
      sounds.playSuccess();
      const kind =
        subscriber.status === 'active'
          ? isRtl
            ? 'مدفوع'
            : 'paid'
          : subscriber.status === 'trial'
            ? isRtl
              ? 'تجريبي'
              : 'trial'
            : isRtl
              ? 'منتهٍ'
              : 'expired';
      toast.success(
        isRtl
          ? `${subscriber.businessName || subscriber.displayName || subscriber.email}: ${kind}، ${arCount(subscriber.daysRemaining, { one: 'يوم واحد متبقٍ', two: 'يومان متبقيان', few: '{n} أيام متبقية', many: '{n} يوماً متبقياً', other: '{n} يوم متبقٍ' })}`
          : `${subscriber.email}: ${kind}, ${subscriber.daysRemaining} days left`,
      );
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر تعديل الاشتراك' : 'Could not update the subscription'));
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(
    () => ({
      total: subscribers.length,
      active: subscribers.filter((s) => s.status === 'active').length,
      trial: subscribers.filter((s) => s.status === 'trial').length,
      expired: subscribers.filter((s) => s.status === 'expired').length,
    }),
    [subscribers],
  );

  const query = searchQuery.toLowerCase().trim();
  const filtered = subscribers.filter(
    (s) =>
      (statusFilter === 'all' || s.status === statusFilter) &&
      (s.email.toLowerCase().includes(query) ||
        s.displayName.toLowerCase().includes(query) ||
        s.businessName.toLowerCase().includes(query)),
  );

  const showAi = subscribers.some((s) => s.aiToday != null);
  const actionChip =
    'px-2 py-1 rounded-lg text-[10px] font-bold border disabled:opacity-50 cursor-pointer transition-colors';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label={isRtl ? 'كل الحسابات' : 'Accounts'} value={counts.total} Icon={Users} tone="text-slate-300" loading={loading} />
        <Metric label={isRtl ? 'مدفوع' : 'Paid'} value={counts.active} Icon={UserCheck} tone="text-emerald-300" loading={loading} />
        <Metric label={isRtl ? 'تجريبي' : 'Trial'} value={counts.trial} Icon={Clock} tone="text-amber-300" loading={loading} />
        <Metric label={isRtl ? 'منتهٍ' : 'Expired'} value={counts.expired} Icon={UserX} tone="text-rose-300" loading={loading} />
      </div>

      {!canManage && canGrace && (
        <p className={`${opsCard} px-4 py-3 text-xs font-bold text-slate-300`}>
          {isRtl
            ? `صلاحيتك: مهلة حتى ${SUPPORT_GRACE_DAYS} أيام من اليوم لحساب انتهى أو قارب. تُسجَّل باسمك في سجل العمليات.`
            : `Your role can give a grace of up to ${SUPPORT_GRACE_DAYS} days from today. It is recorded under your name.`}
        </p>
      )}

      {error && <div className={opsError}>{error}</div>}

      <div className={`${opsCard} p-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3`}>
        <div className="relative w-full md:w-96">
          <Search size={16} className={`absolute top-1/2 -translate-y-1/2 text-slate-500 ${isRtl ? 'right-3.5' : 'left-3.5'}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isRtl ? 'البحث بالاسم أو المتجر أو البريد' : 'Search by name, store or email'}
            aria-label={isRtl ? 'البحث بالاسم أو المتجر أو البريد' : 'Search by name, store or email'}
            className={`${opsInput} ${isRtl ? 'pr-10 pl-3.5' : 'pl-10 pr-3.5'}`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'active', 'trial', 'expired'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setStatusFilter(f)} className={opsChip(statusFilter === f)}>
              {f === 'all'
                ? isRtl
                  ? 'الكل'
                  : 'All'
                : f === 'active'
                  ? isRtl
                    ? 'مدفوع'
                    : 'Paid'
                  : f === 'trial'
                    ? isRtl
                      ? 'تجريبي'
                      : 'Trial'
                    : isRtl
                      ? 'منتهٍ'
                      : 'Expired'}
            </button>
          ))}
          <button type="button" onClick={() => void load()} className={opsBtnGhost}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>{isRtl ? 'تحديث' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <div className={`${opsCard} overflow-hidden`}>
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="h-7 w-7 text-cyan-300 animate-spin mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <AlertCircle size={22} className="mx-auto text-slate-500" />
            <p className="text-xs text-slate-400 font-bold">{isRtl ? 'لا توجد حسابات مطابقة.' : 'No matching accounts.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className={opsTableHead}>
                  <th className="px-5 text-start font-black">{isRtl ? 'المتجر والحساب' : 'Store & account'}</th>
                  <th className="px-5 text-center font-black">{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="px-5 text-start font-black">{isRtl ? 'المتبقي' : 'Remaining'}</th>
                  {showAi && (
                    <th className="px-5 text-center font-black">{isRtl ? 'أسئلة المساعد' : 'Assistant'}</th>
                  )}
                  {canGrace && <th className="px-5 text-center font-black">{isRtl ? 'إجراءات' : 'Actions'}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.025] transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-extrabold text-white block truncate max-w-[220px]">
                        {item.businessName || item.displayName || '—'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono block" dir="ltr">
                        {item.email || (isRtl ? 'بدون بريد' : 'No email')}
                      </span>
                      {item.role === 'founder' && (
                        <span className="text-[10px] font-bold text-cyan-300">{isRtl ? 'المؤسس' : 'Founder'}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full font-bold text-[10px] border ${
                          item.status === 'active'
                            ? opsStatus.active
                            : item.status === 'trial'
                              ? opsStatus.trial
                              : opsStatus.expired
                        }`}
                      >
                        {item.status === 'active'
                          ? isRtl
                            ? 'مدفوع'
                            : 'Paid'
                          : item.status === 'trial'
                            ? isRtl
                              ? 'تجريبي'
                              : 'Trial'
                            : isRtl
                              ? 'منتهٍ'
                              : 'Expired'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-base font-black text-white tabular-nums">{item.daysRemaining}</span>
                      <span className="text-[10px] text-slate-500 font-semibold mx-1">{isRtl ? 'يوماً' : 'days'}</span>
                      {item.endsAt && (
                        <div className="flex items-center gap-1 text-slate-400">
                          <Calendar size={11} className="text-slate-500" />
                          <span>
                            {new Date(item.endsAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      )}
                    </td>
                    {showAi && (
                      <td className="px-5 py-3.5 text-center tabular-nums">
                        <span className="font-black text-white">{item.aiToday ?? 0}</span>
                        {aiDailyLimit !== null && <span className="text-slate-500">/{aiDailyLimit}</span>}
                        <span className="block text-[10px] text-slate-500">
                          {isRtl ? `${item.ai30d ?? 0} خلال 30 يوماً` : `${item.ai30d ?? 0} in 30 days`}
                        </span>
                      </td>
                    )}
                    {canGrace && (
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-xs mx-auto">
                          {(canManage ? [7, 30, 90, 365] : [SUPPORT_GRACE_DAYS]).map((days) => (
                            <button
                              key={days}
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => void run(item.id, 'extend', { days })}
                              className={`${actionChip} bg-cyan-400/10 text-cyan-200 border-cyan-400/20 hover:bg-cyan-400/20`}
                            >
                              {canManage ? `+${days}` : isRtl ? `مهلة ${days} أيام` : `${days}-day grace`}
                            </button>
                          ))}
                          {canManage && (
                            <>
                              <button
                                type="button"
                                disabled={busyId === item.id}
                                onClick={() => void run(item.id, 'mark_paid')}
                                className={`${actionChip} bg-emerald-400/10 text-emerald-200 border-emerald-400/20`}
                              >
                                {isRtl ? 'مدفوع' : 'Paid'}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === item.id}
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      isRtl ? 'يبدأ هذا تجربة جديدة من 25 يوماً من اليوم.' : 'This starts a 25-day trial from today.',
                                    )
                                  )
                                    return;
                                  void run(item.id, 'set_trial');
                                }}
                                className={`${actionChip} bg-amber-400/10 text-amber-200 border-amber-400/20`}
                              >
                                {isRtl ? 'تجريبي' : 'Trial'}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === item.id}
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      isRtl ? 'إنهاء الاشتراك يغلق حساب هذا العميل.' : 'Ending the subscription locks this customer out.',
                                    )
                                  )
                                    return;
                                  void run(item.id, 'expire');
                                }}
                                className={`${actionChip} bg-rose-400/10 text-rose-200 border-rose-400/20`}
                              >
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

function Metric({
  label,
  value,
  Icon,
  tone,
  loading,
}: {
  label: string;
  value: number;
  Icon: React.ElementType;
  tone: string;
  loading: boolean;
}) {
  return (
    <div className={`${opsCard} p-4 sm:p-5 relative overflow-hidden`}>
      <div className="absolute -top-8 -end-8 w-24 h-24 rounded-full bg-cyan-400/[0.04] blur-2xl pointer-events-none" />
      <div className="relative flex items-center justify-between">
        <span className={`text-[11px] font-extrabold tracking-wide ${tone}`}>{label}</span>
        <Icon size={16} className={tone} />
      </div>
      <div className="relative mt-3 text-3xl font-black text-white tabular-nums tracking-tight">
        {loading ? <RefreshCw className="h-5 w-5 animate-spin text-slate-500 inline" /> : value}
      </div>
    </div>
  );
}
