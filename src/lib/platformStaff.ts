// The founder's own team, separate from store teams (roles.ts). The server and the database
// (platform_role_of, admin_* functions) enforce these limits; the app uses them to hide what will be refused.

export type PlatformRole = 'founder' | 'operations' | 'support';

export const PLATFORM_ROLES: readonly PlatformRole[] = ['founder', 'operations', 'support'];

export type StaffRole = Exclude<PlatformRole, 'founder'>;

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export type PlatformAction =
  | 'view_subscribers'
  | 'grant_grace'
  | 'manage_subscriptions'
  | 'view_ai_usage'
  | 'answer_tickets'
  | 'manage_staff'
  | 'view_audit';

/** Support may lengthen an account to at most this many days from today, never mark it paid. */
export const SUPPORT_GRACE_DAYS = 7;

const SUPPORT_ACTIONS = new Set<PlatformAction>(['view_subscribers', 'grant_grace', 'view_ai_usage', 'answer_tickets']);
const FOUNDER_ONLY_ACTIONS = new Set<PlatformAction>(['manage_staff', 'view_audit']);

export function staffCan(role: PlatformRole | null | undefined, action: PlatformAction): boolean {
  if (role === 'founder') return true;
  if (role === 'operations') return !FOUNDER_ONLY_ACTIONS.has(action);
  if (role === 'support') return SUPPORT_ACTIONS.has(action);
  return false;
}

export function platformRoleLabel(role: PlatformRole, ar: boolean): string {
  if (role === 'founder') return ar ? 'المؤسس' : 'Founder';
  if (role === 'operations') return ar ? 'مدير عمليات' : 'Operations';
  return ar ? 'دعم فني' : 'Support';
}

export function platformRoleHelp(role: StaffRole, ar: boolean): string {
  if (role === 'operations') {
    return ar
      ? 'يرى المشتركين واستهلاك المساعد، ويعدّل الاشتراكات (تمديد، مدفوع، تجربة، إنهاء)، ويرد على طلبات الدعم. لا يدير الفريق ولا يرى سجل العمليات.'
      : 'Sees subscribers and assistant usage, changes subscriptions (extend, paid, trial, end) and answers tickets. Cannot manage staff or read the audit log.';
  }
  return ar
    ? `يرى المشتركين واستهلاك المساعد، ويرد على طلبات الدعم، ويمنح مهلة حتى ${SUPPORT_GRACE_DAYS} أيام من اليوم. لا يعلّم حساباً كمدفوع ولا ينهي اشتراكاً.`
    : `Sees subscribers and assistant usage, answers tickets, and can give a grace of up to ${SUPPORT_GRACE_DAYS} days from today. Cannot mark an account paid or end a subscription.`;
}
