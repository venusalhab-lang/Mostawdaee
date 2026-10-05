// What each role may open and do in the app. The database enforces the same limits
// (merchant_commit, row-level security); this only keeps the UI from offering what will be refused.

export type WorkspaceRole = 'owner' | 'manager' | 'cashier';

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['owner', 'manager', 'cashier'];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

// Salaries, full backups and the platform console stay with the owner.
const OWNER_ONLY_SCREENS = new Set(['employees', 'google-drive', 'admin-dashboard']);
const CASHIER_SCREENS = new Set(['pos', 'invoices', 'settings']);

export function canOpenScreen(role: WorkspaceRole, screen: string): boolean {
  if (role === 'owner') return true;
  if (role === 'cashier') return CASHIER_SCREENS.has(screen);
  return !OWNER_ONLY_SCREENS.has(screen);
}

export function homeScreen(role: WorkspaceRole): string {
  return role === 'cashier' ? 'pos' : 'dashboard';
}

export type WorkspaceAction =
  | 'manage_team'
  | 'business_settings'
  | 'billing'
  | 'back_office'
  | 'delete_records'
  | 'reverse_invoice'
  | 'manage_customers'
  | 'manage_catalog'
  | 'see_costs';

const OWNER_ONLY_ACTIONS = new Set<WorkspaceAction>(['manage_team', 'business_settings', 'billing']);

export function can(role: WorkspaceRole, action: WorkspaceAction): boolean {
  if (role === 'owner') return true;
  if (role === 'manager') return !OWNER_ONLY_ACTIONS.has(action);
  return false;
}

export function roleLabel(role: WorkspaceRole, ar: boolean): string {
  if (role === 'owner') return ar ? 'المالك' : 'Owner';
  if (role === 'manager') return ar ? 'مدير' : 'Manager';
  return ar ? 'كاشير' : 'Cashier';
}
