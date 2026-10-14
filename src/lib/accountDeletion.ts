import { apiUrl, readApiJson } from './apiBase';
import { supabase } from '../supabaseClient';

export type AccountDeletionCode =
  | 'sign_in_required' | 'rate_limited' | 'confirm_mismatch' | 'founder_account' | 'not_configured' | 'delete_failed'
  | 'pending_offline' | 'network';

export class AccountDeletionError extends Error {
  constructor(public code: AccountDeletionCode, message = code) {
    super(message);
  }
}

/** The typed confirmation must be the account email, ignoring case and surrounding spaces. */
export function confirmationMatches(typed: string, email: string | null | undefined): boolean {
  return !!email && typed.trim().toLowerCase() === email.trim().toLowerCase();
}

export async function deleteMyAccount(confirmEmail: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AccountDeletionError('sign_in_required');
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/account/delete'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmEmail }),
    });
  } catch {
    throw new AccountDeletionError('network');
  }
  const body = await readApiJson(response);
  if (!body) throw new AccountDeletionError('network');
  if (response.ok && body.ok === true) return;
  const code = typeof body?.code === 'string' ? body.code : 'delete_failed';
  throw new AccountDeletionError(code as AccountDeletionCode, body?.message);
}

export function accountDeletionMessage(error: unknown, ar: boolean): string {
  const code = error instanceof AccountDeletionError ? error.code : 'delete_failed';
  const messages: Record<AccountDeletionCode, [string, string]> = {
    sign_in_required: ['انتهت الجلسة. سجّل الدخول مجدداً ثم أعد المحاولة.', 'Your session ended. Sign in again and retry.'],
    rate_limited: ['محاولات كثيرة. انتظر بضع دقائق ثم أعد المحاولة.', 'Too many attempts. Wait a few minutes and retry.'],
    confirm_mismatch: ['البريد المكتوب لا يطابق بريد هذا الحساب.', 'The typed email does not match this account.'],
    founder_account: ['لا يمكن حذف حساب المؤسس.', 'The founder account cannot be deleted.'],
    not_configured: ['حذف الحساب غير مفعّل على الخادم بعد. راسل الدعم.', 'Account deletion is not set up on the server yet. Contact support.'],
    delete_failed: ['تعذّر حذف الحساب، وبيانات متجرك كما هي. أعد المحاولة أو راسل الدعم.', 'The account could not be deleted; your store data is unchanged. Retry or contact support.'],
    pending_offline: [
      'توجد مبيعات محفوظة على هذا الجهاز لم تُرسل بعد. اتصل بالإنترنت وانتظر إرسالها قبل حذف الحساب.',
      'Sales saved on this device have not been sent yet. Connect and let them send before deleting the account.',
    ],
    network: ['لا يوجد اتصال بالخادم. تحقق من الإنترنت وأعد المحاولة.', 'Cannot reach the server. Check your connection and retry.'],
  };
  const pair = messages[code] || messages.delete_failed;
  return ar ? pair[0] : pair[1];
}
