import { API_UNREACHABLE_AR, apiUrl, readApiJson } from './apiBase';
import { supabase } from '../supabaseClient';
import { isVerifiedAdmin } from './adminAccess';
import { isPlatformRole, type PlatformRole, type StaffRole } from './platformStaff';
import type { TicketCategory, TicketStatus } from './supportTickets';

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
  /** Assistant questions today and over 30 days; null when this role cannot see usage. */
  aiToday?: number | null;
  ai30d?: number | null;
}

export type AdminSubscriptionOp = 'extend' | 'expire' | 'mark_paid' | 'set_trial' | 'set_expiry';

export interface StaffTicket {
  id: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  assigned_email: string | null;
  created_at: string;
  updated_at: string;
  author_email: string | null;
  store_name: string | null;
  store_owner_email: string | null;
  store_subscription: 'trial' | 'active' | 'expired' | null;
  messages?: number;
}

export interface StaffMessage {
  id: number;
  from_staff: boolean;
  staff_email: string | null;
  body: string;
  created_at: string;
}

export interface PlatformStaffMember {
  email: string;
  role: StaffRole;
  status: 'pending' | 'active';
  created_at: string;
  updated_at: string;
  has_account: boolean;
}

export interface StaffNotice {
  id: number;
  actor_email: string;
  action: string;
  target_email: string | null;
  details: Record<string, any>;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  actor_email: string;
  actor_role: PlatformRole;
  action: string;
  target_email: string | null;
  details: Record<string, any>;
  created_at: string;
}

async function adminRequest(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('سجّل الدخول بحساب الفريق');
  }
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await readApiJson(response);
  if (!body) throw new Error(API_UNREACHABLE_AR);
  if (!response.ok) {
    throw new Error(body.message || 'تعذر تنفيذ الأمر');
  }
  return body;
}

/** Which console the account may open. The server checks again on every console request. */
export async function fetchPlatformRole(user: { email?: string | null; email_confirmed_at?: string | null } | null): Promise<PlatformRole | null> {
  if (!user) return null;
  if (isVerifiedAdmin(user)) return 'founder';
  if (!user.email_confirmed_at) return null;
  try {
    const { data, error } = await supabase.rpc('platform_role');
    if (error) return null;
    return isPlatformRole(data) ? data : null;
  } catch {
    return null;
  }
}

const post = (path: string, payload: unknown) => adminRequest(path, { method: 'POST', body: JSON.stringify(payload) });

export function fetchAdminSubscribers(): Promise<{ subscribers: AdminSubscriber[]; aiDailyLimit?: number }> {
  return adminRequest('/api/admin/subscribers');
}

export function mutateAdminSubscription(payload: {
  userId: string;
  op: AdminSubscriptionOp;
  days?: number;
  expiry?: string;
}): Promise<{ subscriber: AdminSubscriber }> {
  return post('/api/admin/subscription', payload);
}

export function fetchStaffTickets(status: TicketStatus | 'all'): Promise<{ tickets: StaffTicket[] }> {
  return adminRequest(`/api/admin/tickets?status=${status}`);
}

export function fetchStaffThread(id: string): Promise<{ ticket: StaffTicket; messages: StaffMessage[] }> {
  return adminRequest(`/api/admin/tickets/${encodeURIComponent(id)}`);
}

export function replyAsStaff(id: string, body: string, close: boolean): Promise<{ ok: true }> {
  return post(`/api/admin/tickets/${encodeURIComponent(id)}/reply`, { body, close });
}

export function setTicketStatus(id: string, status: TicketStatus): Promise<{ ok: true }> {
  return post(`/api/admin/tickets/${encodeURIComponent(id)}/status`, { status });
}

export function fetchPlatformStaff(): Promise<{ staff: PlatformStaffMember[] }> {
  return adminRequest('/api/admin/staff');
}

export function savePlatformStaff(email: string, role: StaffRole): Promise<{ ok: true }> {
  return post('/api/admin/staff', { email, role });
}

export function confirmPlatformStaff(email: string): Promise<{ ok: true }> {
  return post('/api/admin/staff/confirm', { email });
}

export function removePlatformStaff(email: string): Promise<{ ok: true }> {
  return post('/api/admin/staff/remove', { email });
}

export function fetchOpenNotices(): Promise<{ notices: StaffNotice[] }> {
  return adminRequest('/api/admin/notices');
}

export function ackNotice(id: number): Promise<{ ok: true }> {
  return post('/api/admin/notices/ack', { id });
}

export function fetchAuditLog(limit = 200): Promise<{ entries: AuditEntry[] }> {
  return adminRequest(`/api/admin/audit?limit=${limit}`);
}
