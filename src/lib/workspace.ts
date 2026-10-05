import { supabase } from '../supabaseClient';
import { isWorkspaceRole, type WorkspaceRole } from './roles';

export interface WorkspaceSubscription {
  user_id: string;
  subscription_status: 'trial' | 'active' | 'expired';
  expiry_date: string;
  trial_start_date: string;
}

export interface WorkspaceInvite {
  ownerId: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  storeName: string;
  ownerEmail: string;
}

/** The store a signed-in account works in. Members work in their owner's books, never their own. */
export interface Workspace {
  userId: string;
  ownerId: string;
  role: WorkspaceRole;
  storeName: string;
  ownerEmail: string;
  subscription: WorkspaceSubscription | null;
  invites: WorkspaceInvite[];
  /** 'server' is current; 'cache' is the last answer seen on this device; 'solo' means teams are not installed or unknown. */
  source: 'server' | 'cache' | 'solo';
}

export function soloWorkspace(userId: string): Workspace {
  return { userId, ownerId: userId, role: 'owner', storeName: '', ownerEmail: '', subscription: null, invites: [], source: 'solo' };
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Reads the team_context() payload; anything unexpected is refused rather than guessed. */
export function parseTeamContext(userId: string, raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const ownerId = text(data.owner_id);
  if (!ownerId || !isWorkspaceRole(data.role)) return null;
  if ((data.role === 'owner') !== (ownerId === userId)) return null;
  const sub = data.subscription as Record<string, unknown> | null | undefined;
  const status = sub?.subscription_status;
  const subscription: WorkspaceSubscription | null = sub && (status === 'trial' || status === 'active' || status === 'expired')
    ? { user_id: ownerId, subscription_status: status, expiry_date: text(sub.expiry_date), trial_start_date: text(sub.trial_start_date) }
    : null;
  const invites = (Array.isArray(data.invites) ? data.invites : []).flatMap((item): WorkspaceInvite[] => {
    const row = (item || {}) as Record<string, unknown>;
    const inviteOwner = text(row.owner_id);
    if (!inviteOwner || (row.role !== 'manager' && row.role !== 'cashier')) return [];
    return [{ ownerId: inviteOwner, role: row.role, storeName: text(row.store_name), ownerEmail: text(row.owner_email) }];
  });
  return {
    userId,
    ownerId,
    role: data.role,
    storeName: text(data.store_name),
    ownerEmail: text(data.owner_email),
    subscription,
    invites,
    source: 'server',
  };
}

const cacheKey = (userId: string) => `mustawdae:${userId}:workspace`;

function readCached(userId: string): Workspace | null {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(userId)) || 'null');
    if (!cached || cached.userId !== userId || !cached.ownerId || !isWorkspaceRole(cached.role)) return null;
    return { ...cached, source: 'cache' };
  } catch {
    return null;
  }
}

function writeCached(workspace: Workspace) {
  try {
    localStorage.setItem(cacheKey(workspace.userId), JSON.stringify(workspace));
  } catch { /* storage full or unavailable */ }
}

function isMissingRpc(error: { code?: string; message?: string }) {
  return error?.code === 'PGRST202' || error?.code === '42883' || /team_context/.test(error?.message || '');
}

let current: Workspace | null = null;
let pending: { userId: string; promise: Promise<Workspace> } | null = null;
const listeners = new Set<(workspace: Workspace | null) => void>();

function publish(next: Workspace | null) {
  current = next;
  listeners.forEach((listener) => listener(next));
}

const CONTEXT_TIMEOUT_MS = 4000;

async function fetchWorkspace(userId: string): Promise<Workspace> {
  try {
    const { data, error } = await Promise.race([
      supabase.rpc('team_context'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('team_context timeout')), CONTEXT_TIMEOUT_MS)),
    ]);
    if (!error) {
      const parsed = parseTeamContext(userId, data);
      if (parsed) {
        writeCached(parsed);
        return parsed;
      }
    } else if (isMissingRpc(error)) {
      return soloWorkspace(userId);
    }
  } catch { /* offline: fall back to what this device last saw */ }
  return readCached(userId) || soloWorkspace(userId);
}

/** Resolves the store for this session once; every read and write waits on it. */
export function ensureWorkspace(userId: string): Promise<Workspace> {
  if (current?.userId === userId) return Promise.resolve(current);
  if (pending?.userId === userId) return pending.promise;
  const promise = fetchWorkspace(userId).then((workspace) => {
    if (pending?.promise === promise) {
      pending = null;
      publish(workspace);
    }
    return workspace;
  });
  pending = { userId, promise };
  return promise;
}

/** Asks the server again (after an invite, or when the network returns). */
export async function refreshWorkspace(userId: string): Promise<Workspace> {
  pending = null;
  const next = await fetchWorkspace(userId);
  if (next.source === 'server' || current?.userId !== userId) publish(next);
  return current?.userId === userId ? current : next;
}

export function currentWorkspace(): Workspace | null {
  return current;
}

export function subscribeWorkspace(listener: (workspace: Workspace | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function resetWorkspace() {
  pending = null;
  publish(null);
}

/** The owner whose books the signed-in account reads and writes. */
export async function storeOwnerId(userId: string): Promise<string> {
  return (await ensureWorkspace(userId)).ownerId;
}

export type TeamMember = {
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  status: 'invited' | 'active';
  invitedAt: string;
  joinedAt: string | null;
};

export type TeamErrorCode =
  | 'not_installed' | 'offline' | 'subscription_required' | 'invalid_role' | 'invalid_email' | 'self'
  | 'team_full' | 'email_not_confirmed' | 'already_member' | 'has_team' | 'not_found' | 'not_allowed' | 'failed';

export class TeamError extends Error {
  constructor(public code: TeamErrorCode, message: string = code) {
    super(message);
  }
}

function teamError(error: { code?: string; message?: string }): TeamError {
  const message = error?.message || '';
  const pairs: Array<[RegExp, TeamErrorCode]> = [
    [/subscription required/, 'subscription_required'],
    [/invalid role/, 'invalid_role'],
    [/invalid email/, 'invalid_email'],
    [/yourself/, 'self'],
    [/team is full/, 'team_full'],
    [/email not confirmed/, 'email_not_confirmed'],
    [/already in a store/, 'already_member'],
    [/has own team/, 'has_team'],
    [/invitation not found/, 'not_found'],
    [/role not allowed/, 'not_allowed'],
    [/Failed to fetch|NetworkError|network/i, 'offline'],
  ];
  if (error?.code === 'PGRST202' || error?.code === '42883') return new TeamError('not_installed', message);
  const hit = pairs.find(([pattern]) => pattern.test(message));
  return new TeamError(hit ? hit[1] : 'failed', message);
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: any };
  try {
    result = await supabase.rpc(fn, args);
  } catch (error: any) {
    throw teamError(error);
  }
  if (result.error) throw teamError(result.error);
  return result.data as T;
}

export async function listTeam(): Promise<TeamMember[]> {
  const rows = await call<Array<Record<string, unknown>>>('team_list');
  return (Array.isArray(rows) ? rows : []).flatMap((row): TeamMember[] => {
    if (row.role !== 'manager' && row.role !== 'cashier') return [];
    return [{
      email: text(row.email),
      role: row.role,
      status: row.status === 'active' ? 'active' : 'invited',
      invitedAt: text(row.invited_at),
      joinedAt: text(row.joined_at) || null,
    }];
  });
}

export const inviteMember = (email: string, role: Exclude<WorkspaceRole, 'owner'>) =>
  call<void>('team_invite', { p_email: email, p_role: role });
export const removeMember = (email: string) => call<void>('team_remove', { p_email: email });
export const acceptInvite = (ownerId: string) => call<void>('team_accept', { p_owner: ownerId });
export const declineInvite = (ownerId: string) => call<void>('team_decline', { p_owner: ownerId });
export const leaveStore = () => call<void>('team_leave');

export function teamErrorMessage(error: unknown, ar: boolean): string {
  const code = error instanceof TeamError ? error.code : 'failed';
  const messages: Record<TeamErrorCode, [string, string]> = {
    not_installed: ['ميزة الفريق غير مفعّلة على الخادم بعد. شغّل ملف الإعداد في Supabase.', 'Teams are not enabled on the server yet. Run the setup file in Supabase.'],
    offline: ['لا يوجد اتصال بالإنترنت. أعد المحاولة عند الاتصال.', 'No internet connection. Try again when online.'],
    subscription_required: ['يلزم اشتراك فعّال لإضافة أعضاء إلى الفريق.', 'An active subscription is required to add team members.'],
    invalid_role: ['الدور غير صالح.', 'Invalid role.'],
    invalid_email: ['البريد الإلكتروني غير صالح.', 'Invalid email address.'],
    self: ['لا يمكنك دعوة نفسك.', 'You cannot invite yourself.'],
    team_full: ['وصل الفريق إلى الحد الأقصى (25 عضواً).', 'The team has reached its limit (25 members).'],
    email_not_confirmed: ['أكّد بريدك الإلكتروني أولاً ثم أعد المحاولة.', 'Confirm your email address first, then try again.'],
    already_member: ['أنت عضو في متجر آخر. غادره أولاً.', 'You are a member of another store. Leave it first.'],
    has_team: ['لديك فريق في متجرك. أزل أعضاءه أولاً قبل الانضمام إلى متجر آخر.', 'You have your own team. Remove its members before joining another store.'],
    not_found: ['الدعوة لم تعد موجودة.', 'This invitation no longer exists.'],
    not_allowed: ['هذا الإجراء متاح لمالك المتجر فقط.', 'Only the store owner can do this.'],
    failed: ['تعذّر تنفيذ الطلب. أعد المحاولة.', 'The request failed. Try again.'],
  };
  return messages[code][ar ? 0 : 1];
}
