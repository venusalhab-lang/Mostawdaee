import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, Mail, Store, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import { roleLabel, type WorkspaceRole } from '../lib/roles';
import {
  type TeamMember, type WorkspaceInvite,
  acceptInvite, declineInvite, inviteMember, leaveStore, listTeam, refreshWorkspace, removeMember, teamErrorMessage,
} from '../lib/workspace';
import { pendingSalesBlockSwitch, switchStore } from '../lib/storeSwitch';
import SupportCenter from './SupportCenter';

type MemberRole = Exclude<WorkspaceRole, 'owner'>;

const card = 'p-6 sm:p-8 bg-gray-50 dark:bg-gray-800/50 rounded-[2rem] border border-gray-200 dark:border-gray-700/50';
const input = 'w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-900 dark:text-white outline-none focus:border-indigo-500';
const primary = 'px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-black transition flex items-center justify-center gap-2 cursor-pointer';
const quiet = 'px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 text-xs font-black text-gray-700 dark:text-gray-200 transition flex items-center justify-center gap-2 cursor-pointer';

function roleHelp(role: MemberRole, ar: boolean) {
  if (role === 'manager') {
    return ar
      ? 'يدير المخزون والفواتير والعملاء والخزنة والمشتريات والتقارير. لا يرى الرواتب ولا يغيّر بيانات المتجر أو الاشتراك أو الفريق.'
      : 'Runs stock, invoices, customers, the vault, purchases and reports. Cannot see salaries or change the store profile, subscription or team.';
  }
  return ar
    ? 'يبيع من نقطة البيع ويطبع الفواتير فقط. لا يحذف ولا يعدّل الأسعار ولا يسحب من الخزنة.'
    : 'Sells at the POS and prints invoices only. Cannot delete, change prices or take money out of the vault.';
}

function guardPendingSales(userId: string, ar: boolean): boolean {
  const pending = pendingSalesBlockSwitch(userId);
  if (pending === 0) return true;
  toast.error(ar
    ? `توجد ${pending} عملية بيع على هذا الجهاز لم تُرسل بعد. اتصل بالإنترنت وانتظر إرسالها أولاً حتى لا تُسجَّل في متجر آخر.`
    : `${pending} sale(s) on this device have not been sent yet. Connect and wait for them first so they are not recorded in another store.`);
  return false;
}

/** Owner view: invite staff by email, change their role, remove them. */
export function TeamManager({ language }: { language: 'ar' | 'en' }) {
  const ar = language === 'ar';
  const { user } = useFirebase();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('cashier');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await listTeam());
      setLoadError(null);
    } catch (error) {
      setLoadError(teamErrorMessage(error, ar));
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    if (user) void load();
    else setLoading(false);
  }, [user, load]);

  const run = async (key: string, action: () => Promise<void>, done: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      await load();
    } catch (error) {
      toast.error(teamErrorMessage(error, ar));
    } finally {
      setBusy(null);
    }
  };

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    void run('invite', async () => {
      await inviteMember(address, role);
      setEmail('');
    }, ar ? `أُرسلت الدعوة إلى ${address}. يقبلها عند دخوله بهذا البريد.` : `Invitation saved for ${address}. They accept it when they sign in with this email.`);
  };

  if (!user) {
    return (
      <div className={card}>
        <p className="text-sm font-bold text-gray-600 dark:text-gray-300">
          {ar ? 'سجّل الدخول لإضافة موظفين إلى متجرك.' : 'Sign in to add staff to your store.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="text-indigo-600" />
        <h2 className="text-2xl font-black text-gray-900 dark:text-white">{ar ? 'الفريق والصلاحيات' : 'Team & permissions'}</h2>
      </div>

      <form onSubmit={invite} className={`${card} space-y-4`}>
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          {ar
            ? 'ادعُ موظفاً ببريده الإلكتروني. يسجّل الدخول إلى مستودعي بهذا البريد (Google أو البريد وكلمة المرور) ثم يقبل الدعوة، فيعمل في دفاتر متجرك وتحت اشتراكك.'
            : 'Invite a staff member by email. They sign in to Mostawdaee with that email (Google or email and password), accept the invitation, and work in your books under your subscription.'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={ar ? 'بريد الموظف' : 'Staff email'}
            className={input}
            dir="ltr"
            aria-label={ar ? 'بريد الموظف' : 'Staff email'}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} className={input} aria-label={ar ? 'الدور' : 'Role'}>
            <option value="cashier">{roleLabel('cashier', ar)}</option>
            <option value="manager">{roleLabel('manager', ar)}</option>
          </select>
          <button type="submit" disabled={busy !== null} className={primary}>
            <UserPlus size={16} />
            <span>{busy === 'invite' ? (ar ? 'جاري الحفظ...' : 'Saving...') : (ar ? 'دعوة' : 'Invite')}</span>
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{roleHelp(role, ar)}</p>
      </form>

      <div className={card}>
        {loading ? (
          <p className="text-sm text-gray-500">{ar ? 'جاري التحميل...' : 'Loading...'}</p>
        ) : loadError ? (
          <p className="text-sm font-bold text-rose-600">{loadError}</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{ar ? 'لا يوجد أعضاء بعد. أنت المالك الوحيد لهذا المتجر.' : 'No members yet. You are the only person in this store.'}</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {members.map((member) => (
              <li key={member.email} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-gray-900 dark:text-white truncate" dir="ltr">{member.email}</p>
                  <p className={`text-xs font-bold mt-1 ${member.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {member.status === 'active' ? (ar ? 'نشط' : 'Active') : (ar ? 'بانتظار القبول' : 'Waiting to accept')}
                  </p>
                </div>
                <select
                  value={member.role}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const next = e.target.value as MemberRole;
                    void run(`role:${member.email}`, () => inviteMember(member.email, next),
                      ar ? `أصبح ${member.email} ${roleLabel(next, ar)}.` : `${member.email} is now ${roleLabel(next, ar)}.`);
                  }}
                  className={`${input} sm:w-36`}
                  aria-label={ar ? `دور ${member.email}` : `Role of ${member.email}`}
                >
                  <option value="cashier">{roleLabel('cashier', ar)}</option>
                  <option value="manager">{roleLabel('manager', ar)}</option>
                </select>
                <button
                  type="button"
                  disabled={busy !== null}
                  className={quiet}
                  onClick={() => {
                    const ok = window.confirm(ar
                      ? `إزالة ${member.email} من المتجر؟ يفقد الوصول فوراً، وتبقى عملياته السابقة في السجلات.`
                      : `Remove ${member.email}? They lose access at once; their past records stay in the books.`);
                    if (!ok) return;
                    void run(`remove:${member.email}`, () => removeMember(member.email), ar ? 'أُزيل العضو.' : 'Member removed.');
                  }}
                >
                  <Trash2 size={14} className="text-rose-500" />
                  <span>{ar ? 'إزالة' : 'Remove'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Member view: which store this account works in, and the way out. */
export function MembershipSettings({ language, onLanguageToggle }: { language: 'ar' | 'en'; onLanguageToggle: () => void }) {
  const ar = language === 'ar';
  const { user, workspace } = useFirebase();
  const [busy, setBusy] = useState(false);
  if (!user || !workspace || workspace.role === 'owner') return null;

  const leave = async () => {
    if (!guardPendingSales(user.uid, ar)) return;
    const ok = window.confirm(ar
      ? `مغادرة «${workspace.storeName || 'المتجر'}»؟ ستعود إلى حسابك الخاص ولن ترى بيانات هذا المتجر.`
      : `Leave "${workspace.storeName || 'the store'}"? You return to your own account and no longer see this store's data.`);
    if (!ok) return;
    setBusy(true);
    try {
      await switchStore(user.uid, leaveStore);
    } catch (error) {
      toast.error(teamErrorMessage(error, ar));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6" dir={ar ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3">
        <Store className="text-indigo-600" />
        <h2 className="text-2xl font-black text-gray-900 dark:text-white">{ar ? 'حسابي في المتجر' : 'My store account'}</h2>
      </div>
      <div className={`${card} space-y-4`}>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs font-bold text-gray-500">{ar ? 'المتجر' : 'Store'}</dt>
            <dd className="font-black text-gray-900 dark:text-white mt-1">{workspace.storeName || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-gray-500">{ar ? 'دورك' : 'Your role'}</dt>
            <dd className="font-black text-gray-900 dark:text-white mt-1">{roleLabel(workspace.role, ar)}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-gray-500">{ar ? 'المالك' : 'Owner'}</dt>
            <dd className="font-black text-gray-900 dark:text-white mt-1" dir="ltr">{workspace.ownerEmail || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-gray-500">{ar ? 'حسابك' : 'Your account'}</dt>
            <dd className="font-black text-gray-900 dark:text-white mt-1" dir="ltr">{user.email}</dd>
          </div>
        </dl>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{roleHelp(workspace.role, ar)}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {ar
            ? 'بيانات المتجر واشتراكه وعملته يديرها المالك. تفضيلات العرض مثل اللغة تُحفظ على هذا الجهاز فقط.'
            : 'The store data, subscription and currency are managed by the owner. Display preferences such as language are kept on this device.'}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <button type="button" onClick={onLanguageToggle} className={quiet}>
          <span>{ar ? 'English' : 'العربية'}</span>
        </button>
        <button type="button" onClick={leave} disabled={busy} className={quiet}>
          <LogOut size={14} className="text-rose-500" />
          <span>{busy ? (ar ? 'جاري المغادرة...' : 'Leaving...') : (ar ? 'مغادرة المتجر' : 'Leave store')}</span>
        </button>
      </div>
      <SupportCenter language={language} />
    </div>
  );
}

/** Shown to an account with a pending invitation; joining hides its own books until it leaves. */
export function PendingInvites({ language }: { language: 'ar' | 'en' }) {
  const ar = language === 'ar';
  const { user, workspace } = useFirebase();
  const [busy, setBusy] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  if (!user || !workspace || workspace.role !== 'owner') return null;
  const invites = workspace.invites.filter((invite) => !hidden.includes(invite.ownerId));
  if (invites.length === 0) return null;

  const accept = async (invite: WorkspaceInvite) => {
    if (!guardPendingSales(user.uid, ar)) return;
    const store = invite.storeName || invite.ownerEmail;
    const ok = window.confirm(ar
      ? `الانضمام إلى «${store}» بدور ${roleLabel(invite.role, ar)}؟\nستعمل في دفاتر ذلك المتجر وتحت اشتراكه. بيانات حسابك الحالي لا تُحذف لكنها لا تظهر حتى تغادر المتجر.`
      : `Join "${store}" as ${roleLabel(invite.role, ar)}?\nYou will work in that store's books under its subscription. Your own data is not deleted, but it stays hidden until you leave.`);
    if (!ok) return;
    setBusy(invite.ownerId);
    try {
      await switchStore(user.uid, () => acceptInvite(invite.ownerId));
    } catch (error) {
      toast.error(teamErrorMessage(error, ar));
      setBusy(null);
    }
  };

  const decline = async (invite: WorkspaceInvite) => {
    setBusy(invite.ownerId);
    try {
      await declineInvite(invite.ownerId);
      setHidden((prev) => [...prev, invite.ownerId]);
      await refreshWorkspace(user.uid);
    } catch (error) {
      toast.error(teamErrorMessage(error, ar));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-6 space-y-3" dir={ar ? 'rtl' : 'ltr'}>
      {invites.map((invite) => (
        <div key={invite.ownerId} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 flex flex-col sm:flex-row sm:items-center gap-3">
          <Mail size={18} className="text-indigo-500 shrink-0" />
          <p className="flex-1 text-sm font-bold text-gray-800 dark:text-gray-100">
            {ar
              ? `دعوة للانضمام إلى «${invite.storeName || invite.ownerEmail}» بدور ${roleLabel(invite.role, ar)}.`
              : `Invitation to join "${invite.storeName || invite.ownerEmail}" as ${roleLabel(invite.role, ar)}.`}
            {invite.ownerEmail && <span className="block text-xs font-medium text-gray-500 mt-0.5" dir="ltr">{invite.ownerEmail}</span>}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy !== null} onClick={() => void accept(invite)} className={primary}>
              {busy === invite.ownerId ? (ar ? 'جاري...' : 'Working...') : (ar ? 'قبول' : 'Accept')}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void decline(invite)} className={quiet}>
              {ar ? 'رفض' : 'Decline'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
