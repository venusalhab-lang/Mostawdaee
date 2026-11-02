import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import { isVerifiedAdmin } from '../lib/adminAccess';
import { deviceLocalWorkMessage, pendingSalesBlockSwitch } from '../lib/storeSwitch';
import { AccountDeletionError, accountDeletionMessage, confirmationMatches, deleteMyAccount } from '../lib/accountDeletion';
import { SUPPORT_EMAIL, privacyPolicy } from '../lib/privacyPolicy';
import PrivacyPolicyBody from './PrivacyPolicyBody';

const card = 'p-6 sm:p-8 bg-gray-50 dark:bg-gray-800/50 rounded-[2rem] border border-gray-200 dark:border-gray-700/50';
const input = 'w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-900 dark:text-white outline-none focus:border-rose-500';
const quiet = 'px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 text-xs font-black text-gray-700 dark:text-gray-200 transition flex items-center justify-center gap-2 cursor-pointer';
const danger = 'px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-black transition flex items-center justify-center gap-2 cursor-pointer';

/** The account itself: the privacy policy and permanent deletion (required by Google Play). */
export default function AccountSettings({ language }: { language: 'ar' | 'en' }) {
  const ar = language === 'ar';
  const { user, workspace, logout } = useFirebase();
  const [showPolicy, setShowPolicy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  const isMember = !!workspace && workspace.role !== 'owner';
  const isFounder = isVerifiedAdmin(user as any);
  const policy = privacyPolicy(ar);

  const handleDelete = async () => {
    if (!user || !confirmationMatches(typed, user.email)) return;
    const blocked = deviceLocalWorkMessage(user.uid, ar);
    if (blocked) {
      toast.error(pendingSalesBlockSwitch(user.uid) > 0
        ? accountDeletionMessage(new AccountDeletionError('pending_offline'), ar)
        : blocked);
      return;
    }
    setDeleting(true);
    try {
      await deleteMyAccount(typed);
    } catch (error) {
      toast.error(accountDeletionMessage(error, ar));
      setDeleting(false);
      return;
    }
    toast.success(ar ? 'حُذف حسابك نهائياً.' : 'Your account has been permanently deleted.');
    try {
      await logout();
    } catch {
      // The account is gone on the server; the local session ends with the next auth check.
    }
  };

  return (
    <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'}>
      <div className={card}>
        <h3 className="text-lg font-black text-gray-900 dark:text-white">{ar ? 'الحساب' : 'Account'}</h3>
        <p className="mt-1 text-sm font-bold text-gray-500 dark:text-gray-400 break-all">{user?.email || (ar ? 'غير مسجّل الدخول' : 'Not signed in')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={quiet} onClick={() => setShowPolicy(true)}>
            <FileText className="w-4 h-4" />
            {ar ? 'سياسة الخصوصية' : 'Privacy policy'}
          </button>
        </div>
      </div>

      {user && (
        <div className={card}>
          <h3 className="text-base font-black text-gray-900 dark:text-white">{ar ? 'حذف الحساب' : 'Delete account'}</h3>
          {isFounder ? (
            <p className="mt-2 text-sm font-bold text-gray-600 dark:text-gray-300">
              {ar ? 'حساب المؤسس لا يُحذف من التطبيق.' : 'The founder account cannot be deleted from the app.'}
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2 text-sm font-bold text-gray-600 dark:text-gray-300 list-disc ps-5">
                {isMember ? (
                  <li>{ar
                    ? `ستخرج من متجر ${workspace?.storeName || ''} ويُحذف حسابك. السجلات التي أدخلتها تبقى ملكاً لصاحب المتجر.`
                    : `You will leave ${workspace?.storeName || 'the store'} and your account will be deleted. Records you entered stay with the store owner.`}</li>
                ) : (
                  <>
                    <li>{ar
                      ? 'سيُحذف متجرك وكل دفاتره نهائياً: الأصناف والفواتير والعملاء والديون والموظفين والرواتب والخزنة والشيكات والجرد.'
                      : 'Your store and all its books will be permanently deleted: products, invoices, customers, debts, employees, payroll, vault, cheques and stocktakes.'}</li>
                    <li>{ar ? 'سيخرج أعضاء فريقك من المتجر.' : 'Your team members will be removed from the store.'}</li>
                    <li>{ar
                      ? 'نزّل نسخة احتياطية من قسم النظام قبل الحذف إن أردت الاحتفاظ بدفاترك.'
                      : 'Download a backup from the System section first if you want to keep your books.'}</li>
                  </>
                )}
                <li>{ar
                  ? 'اشتراك Google Play لا يُلغى بحذف الحساب. ألغِه من Google Play ← الاشتراكات.'
                  : 'A Google Play subscription is not cancelled by deleting the account. Cancel it in Google Play → Subscriptions.'}</li>
                <li>{ar ? 'لا يمكن التراجع عن الحذف.' : 'Deletion cannot be undone.'}</li>
              </ul>

              {!confirming ? (
                <button type="button" className={`${quiet} mt-5 text-rose-600 dark:text-rose-400`} onClick={() => setConfirming(true)}>
                  <Trash2 className="w-4 h-4" />
                  {ar ? 'حذف الحساب' : 'Delete account'}
                </button>
              ) : (
                <div className="mt-5 space-y-3">
                  <label className="block text-xs font-black text-gray-700 dark:text-gray-200" htmlFor="delete-confirm-email">
                    {ar ? 'اكتب بريدك الإلكتروني للتأكيد' : 'Type your email to confirm'}
                  </label>
                  <input
                    id="delete-confirm-email"
                    className={input}
                    type="email"
                    autoComplete="off"
                    dir="ltr"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={user.email || ''}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={danger}
                      disabled={deleting || !confirmationMatches(typed, user.email)}
                      onClick={handleDelete}
                    >
                      <Trash2 className="w-4 h-4" />
                      {deleting ? (ar ? 'جارٍ الحذف...' : 'Deleting...') : (ar ? 'حذف الحساب نهائياً' : 'Delete permanently')}
                    </button>
                    <button type="button" className={quiet} disabled={deleting} onClick={() => { setConfirming(false); setTyped(''); }}>
                      {ar ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <p className="mt-4 text-xs font-bold text-gray-400">
            {ar ? `لا تستطيع فتح التطبيق؟ راسل ${SUPPORT_EMAIL} من بريد حسابك.` : `Cannot open the app? Email ${SUPPORT_EMAIL} from your account address.`}
          </p>
        </div>
      )}

      {/* The settings panel is transformed by its animation, which would trap a fixed overlay inside it. */}
      {showPolicy && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={policy.title} dir={ar ? 'rtl' : 'ltr'}>
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setShowPolicy(false)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-base font-black text-gray-900 dark:text-white">{policy.title}</h3>
              <button type="button" className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer" onClick={() => setShowPolicy(false)} aria-label={ar ? 'إغلاق' : 'Close'}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <PrivacyPolicyBody ar={ar} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}