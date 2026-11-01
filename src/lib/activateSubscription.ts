import { supabase } from '../supabaseClient';
import { API_UNREACHABLE_AR, apiUrl, readApiJson } from './apiBase';
import { PLAY_PREMIUM_PRODUCT_ID, restorePurchases, type ProcessedTransaction } from '../services/billing';

async function sessionToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new Error('يرجى تسجيل الدخول أولاً');
  }
  return accessToken;
}

export async function activatePaidSubscription(tx: Pick<ProcessedTransaction, 'productId' | 'purchaseToken' | 'transactionId'>): Promise<void> {
  const accessToken = await sessionToken();

  const response = await fetch(apiUrl('/api/subscription/activate'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      productId: tx.productId,
      purchaseToken: tx.purchaseToken,
      transactionId: tx.transactionId,
      platform: 'play',
    }),
  });

  const body = await readApiJson(response);
  if (!body) throw new Error(API_UNREACHABLE_AR);
  if (!response.ok || body.ok !== true) throw new Error(body.message || 'تعذر تفعيل الاشتراك من الخادم');
}

/** Asks the server to re-read this account's Google Play purchases (renewals, refunds). */
export async function syncPaidSubscription(): Promise<void> {
  const accessToken = await sessionToken();
  const response = await fetch(apiUrl('/api/subscription/sync'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readApiJson(response);
  if (!body) throw new Error(API_UNREACHABLE_AR);
  if (!response.ok || body.ok !== true) throw new Error(body.message || 'تعذر مزامنة الاشتراك مع Google Play');
}

/** Links every premium purchase Google Play reports on this device to the signed-in account. */
export async function linkOwnedPurchases(tokens: string[]): Promise<{ linked: number; errors: string[] }> {
  let linked = 0;
  const errors: string[] = [];
  for (const purchaseToken of tokens) {
    try {
      await activatePaidSubscription({ productId: PLAY_PREMIUM_PRODUCT_ID, purchaseToken, transactionId: '' });
      linked += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { linked, errors };
}

/** Restore: re-reads Google Play purchases on this device, links them to this account, then re-syncs. */
export async function restoreOwnedPurchases(): Promise<{ found: number; linked: number; errors: string[] }> {
  const tokens = await restorePurchases();
  const { linked, errors } = await linkOwnedPurchases(tokens);
  await syncPaidSubscription().catch((error) => errors.push(error instanceof Error ? error.message : String(error)));
  return { found: tokens.length, linked, errors };
}
