import { supabase } from '../supabaseClient';
import { apiUrl } from './apiBase';
import type { ProcessedTransaction } from '../services/billing';

export async function activatePaidSubscription(tx: ProcessedTransaction): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new Error('يرجى تسجيل الدخول أولاً');
  }

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

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.message || 'تعذر تفعيل الاشتراك من الخادم');
  }
}
