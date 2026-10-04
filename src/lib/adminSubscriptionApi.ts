import { apiUrl } from './apiBase';
import { supabase } from '../supabaseClient';

export interface AdminSubscriber {
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
}

export type AdminSubscriptionOp = 'extend' | 'expire' | 'mark_paid' | 'set_trial' | 'set_expiry';

async function adminRequest(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('سجّل الدخول بحساب المالك');
  }
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || 'تعذر تنفيذ الأمر');
  }
  return body;
}

export function fetchAdminSubscribers(): Promise<{ subscribers: AdminSubscriber[] }> {
  return adminRequest('/api/admin/subscribers');
}

export function mutateAdminSubscription(payload: {
  userId: string;
  op: AdminSubscriptionOp;
  days?: number;
  expiry?: string;
}): Promise<{ subscriber: AdminSubscriber }> {
  return adminRequest('/api/admin/subscription', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
