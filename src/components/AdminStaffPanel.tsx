import React, { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  type AuditEntry, type PlatformStaffMember, type StaffNotice,
  ackNotice, confirmPlatformStaff, fetchAuditLog, fetchOpenNotices, fetchPlatformStaff, removePlatformStaff, savePlatformStaff,
} from '../lib/adminSubscriptionApi';
import { type StaffRole, isPlatformRole, platformRoleHelp, platformRoleLabel } from '../lib/platformStaff';

const card = 'bg-white rounded-2xl border border-slate-200 p-5';
const input = 'w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500';

/** Founder only: who is on the platform team and with which role. */
export function AdminStaffManager({ isRtl }: { isRtl: boolean }) {
  const [staff, setStaff] = useState<PlatformStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('support');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStaff((await fetchPlatformStaff()).staff);
      setError(null);
    } catch (err: any) {
      setError(err?.message || (isRtl ? 'تعذر قراءة الفريق' : 'Could not load the team'));
    } finally {
      setLoading(false);
    }
  }, [isRtl]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      await load();
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر تنفيذ الأمر' : 'Could not complete the action'));
    } finally {
      setBusy(null);
    }
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    void run('add', async () => {
      await savePlatformStaff(address, role);
      setEmail('');
    }, isRtl
      ? `أُضيف ${address}. أكّد التعيين بعد أن يسجّل ويؤكّد بريده.`
      : `${address} was added. Confirm them after they sign up and verify their email.`);
  };

  const roleOptions = (
    <>
      <option value="support">{platformRoleLabel('support', isRtl)}</option>
      <option value="operations">{platformRoleLabel('operations', isRtl)}</option>
    </>
  );

  return (
    <div className="space-y-4">
      <form onSubmit={add} className={`${card} space-y-3`}>
        <p className="text-sm text-slate-600 leading-relaxed">
          {isRtl
            ? 'أضف موظفاً ببريده. الدور يبقى معلّقاً حتى تؤكّد أنت أن الحساب الذي سجّل هو الشخص المقصود. قبل ذلك لا تظهر له اللوحة. لا يرى أي موظف دفاتر التجار.'
            : 'Add a staff member by email. The role stays pending until you confirm that the signed-up account is the person you meant. Until then the console stays hidden. No staff member can see merchants\u2019 books.'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr"
            placeholder={isRtl ? 'بريد الموظف' : 'Staff email'} aria-label={isRtl ? 'بريد الموظف' : 'Staff email'} className={input} />
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={input} aria-label={isRtl ? 'الدور' : 'Role'}>
            {roleOptions}
          </select>
          <button type="submit" disabled={busy !== null}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-black flex items-center justify-center gap-2 cursor-pointer">
            <UserPlus size={16} />
            <span>{busy === 'add' ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : (isRtl ? 'إضافة' : 'Add')}</span>
          </button>
        </div>
        <p className="text-xs text-slate-500">{platformRoleHelp(role, isRtl)}</p>
      </form>

      <div className={card}>
        {loading ? (
          <p className="text-sm text-slate-500">{isRtl ? 'جاري التحميل...' : 'Loading...'}</p>
        ) : error ? (
          <p className="text-sm font-bold text-rose-600">{error}</p>
        ) : staff.length === 0 ? (
          <p className="text-sm text-slate-500">{isRtl ? 'لا يوجد موظفون بعد. أنت وحدك في الفريق.' : 'No staff yet. You are the only one on the team.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {staff.map((member) => (
              <li key={member.email} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate" dir="ltr">{member.email}</p>
                  <p className={`text-xs font-bold mt-0.5 ${member.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {member.status === 'active'
                      ? (isRtl ? 'مفعّل' : 'Active')
                      : member.has_account
                        ? (isRtl ? 'لديه حساب مؤكَّد — بانتظار تأكيدك' : 'Confirmed account — waiting for you to confirm')
                        : (isRtl ? 'بانتظار أن يسجّل ويؤكّد بريده، ثم تؤكّد أنت' : 'Waiting for them to sign up and verify their email, then you confirm')}
                  </p>
                </div>
                {member.status !== 'active' && member.has_account && (
                  <button type="button" disabled={busy !== null}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
                    onClick={() => void run(`confirm:${member.email}`, () => confirmPlatformStaff(member.email),
                      isRtl ? `تم تأكيد ${member.email}. اللوحة ظاهرة له الآن.` : `${member.email} is confirmed. The console is now available to them.`)}>
                    <Check size={14} />
                    <span>{busy === `confirm:${member.email}` ? (isRtl ? 'جاري التأكيد...' : 'Confirming...') : (isRtl ? 'تأكيد الحساب' : 'Confirm account')}</span>
                  </button>
                )}
                <select value={member.role} disabled={busy !== null} className={`${input} sm:w-40`}
                  aria-label={isRtl ? `دور ${member.email}` : `Role of ${member.email}`}
                  onChange={(e) => {
                    const next = e.target.value as StaffRole;
                    void run(`role:${member.email}`, () => savePlatformStaff(member.email, next),
                      member.status === 'active'
                        ? (isRtl ? `أصبح ${member.email} ${platformRoleLabel(next, isRtl)}.` : `${member.email} is now ${platformRoleLabel(next, isRtl)}.`)
                        : (isRtl ? 'تغيّر الدور. التفعيل يبقى معلّقاً حتى التأكيد.' : 'Role saved. Access stays pending until you confirm.'));
                  }}>
                  {roleOptions}
                </select>
                <button type="button" disabled={busy !== null}
                  className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-xs font-black text-slate-700 flex items-center justify-center gap-2 cursor-pointer"
                  onClick={() => {
                    if (!window.confirm(isRtl ? `إزالة ${member.email} من فريق المنصة؟ يفقد الوصول إلى اللوحة فوراً.` : `Remove ${member.email} from the platform team? They lose console access at once.`)) return;
                    void run(`remove:${member.email}`, () => removePlatformStaff(member.email), isRtl ? 'أُزيل الموظف.' : 'Staff member removed.');
                  }}>
                  <Trash2 size={14} className="text-rose-500" />
                  <span>{isRtl ? 'إزالة' : 'Remove'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function describeEntry(entry: AuditEntry, ar: boolean): string {
  const d = entry.details || {};
  const after = d.after || {};
  const status = (s: string | undefined) => s === 'active' ? (ar ? 'مدفوع' : 'paid') : s === 'trial' ? (ar ? 'تجريبي' : 'trial') : s === 'expired' ? (ar ? 'منتهٍ' : 'expired') : (s || '—');
  const date = (v: string | undefined) => v ? new Date(v).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const end = after.status === 'trial' && after.trial_start
    ? new Date(Date.parse(after.trial_start) + 25 * 24 * 60 * 60 * 1000).toISOString()
    : after.expiry;
  const staffRole = isPlatformRole(d.role) && d.role !== 'founder' ? platformRoleLabel(d.role, ar) : d.role;
  switch (entry.action) {
    case 'subscription.extend':
      return ar ? `تمديد ${d.days ?? ''} يوماً ← ${status(after.status)} حتى ${date(end)}` : `Extended ${d.days ?? ''} days → ${status(after.status)} until ${date(end)}`;
    case 'subscription.mark_paid':
      return ar ? `تعليم كمدفوع حتى ${date(end)}` : `Marked paid until ${date(end)}`;
    case 'subscription.set_trial':
      return ar ? `تجربة جديدة حتى ${date(end)}` : `New trial until ${date(end)}`;
    case 'subscription.set_expiry':
      return ar ? `ضبط الانتهاء ← ${status(after.status)} حتى ${date(end)}` : `Set expiry → ${status(after.status)} until ${date(end)}`;
    case 'subscription.expire':
      return ar ? 'إنهاء الاشتراك' : 'Ended the subscription';
    case 'staff.set':
      return ar ? `${d.email}: ${staffRole}${d.before ? ' (تغيير دور)' : ' (إضافة، بانتظار التأكيد)'}` : `${d.email}: ${staffRole}${d.before ? ' (role change)' : ' (added, pending confirmation)'}`;
    case 'staff.confirm':
      return ar ? `تأكيد ${d.email} كـ${staffRole}` : `Confirmed ${d.email} as ${staffRole}`;
    case 'staff.remove':
      return ar ? `إزالة ${d.email} من الفريق` : `Removed ${d.email} from the team`;
    default:
      return entry.action;
  }
}

/** Founder only: a support grace stays here until it is acknowledged. The audit row itself is never edited. */
export function FounderNotices({ isRtl }: { isRtl: boolean }) {
  const [notices, setNotices] = useState<StaffNotice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setNotices((await fetchOpenNotices()).notices);
      setError(null);
    } catch (err: any) {
      setError(err?.message || (isRtl ? 'تعذر قراءة التنبيهات' : 'Could not load notices'));
    }
  }, [isRtl]);

  useEffect(() => { void load(); }, [load]);

  if (!error && notices.length === 0) return null;

  const ack = async (id: number) => {
    setBusy(id);
    try {
      await ackNotice(id);
      setNotices((prev) => prev.filter((n) => n.id !== id));
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر إخفاء التنبيه' : 'Could not dismiss the notice'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-black text-amber-950">
        {error || (isRtl ? 'مهل منحها الدعم الفني' : 'Grace periods granted by support')}
      </p>
      <ul className="space-y-2">
        {notices.map((notice) => (
          <li key={notice.id} className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
            <p className="flex-1 text-amber-950">
              <span dir="ltr" className="font-bold">{notice.actor_email}</span>
              {isRtl ? ' منح مهلة ' : ' granted '}
              <span className="font-bold">{notice.details?.days ?? ''}</span>
              {isRtl ? ' يوماً للحساب ' : ' days to '}
              <span dir="ltr" className="font-bold">{notice.target_email || '—'}</span>
            </p>
            <button type="button" disabled={busy !== null} onClick={() => void ack(notice.id)}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-black text-amber-950 hover:bg-amber-100 disabled:opacity-50 cursor-pointer">
              {busy === notice.id ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : (isRtl ? 'اطّلعت' : 'Noted')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Founder only: every console change, newest first. The database refuses edits and deletions. */
export function AdminAuditLog({ isRtl }: { isRtl: boolean }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries((await fetchAuditLog(200)).entries);
      setError(null);
    } catch (err: any) {
      setError(err?.message || (isRtl ? 'تعذر قراءة السجل' : 'Could not load the log'));
    } finally {
      setLoading(false);
    }
  }, [isRtl]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {isRtl ? 'آخر 200 عملية من اللوحة. لا يمكن تعديل السجل أو حذفه.' : 'The last 200 console actions. The log cannot be edited or deleted.'}
        </p>
        <button type="button" onClick={() => void load()} className="p-2 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>{isRtl ? 'تحديث' : 'Refresh'}</span>
        </button>
      </div>
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-5 py-4 text-sm font-semibold">{error}</div>}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        {!loading && entries.length === 0 && !error ? (
          <p className="p-10 text-center text-xs font-bold text-slate-500">{isRtl ? 'لا توجد عمليات بعد.' : 'No actions yet.'}</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 h-10">
                <th className="px-4 text-start font-black">{isRtl ? 'الوقت' : 'When'}</th>
                <th className="px-4 text-start font-black">{isRtl ? 'المنفّذ' : 'By'}</th>
                <th className="px-4 text-start font-black">{isRtl ? 'الحساب' : 'Account'}</th>
                <th className="px-4 text-start font-black">{isRtl ? 'العملية' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                    {new Date(entry.created_at).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-bold text-slate-800 block" dir="ltr">{entry.actor_email}</span>
                    <span className="text-[10px] text-slate-500">{isPlatformRole(entry.actor_role) ? platformRoleLabel(entry.actor_role, isRtl) : entry.actor_role}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700" dir="ltr">{entry.target_email || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-800 font-semibold">{describeEntry(entry, isRtl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
