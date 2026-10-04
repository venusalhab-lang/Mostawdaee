const ADMIN_EMAILS = ['venusalhab@gmail.com'] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim() as (typeof ADMIN_EMAILS)[number]);
}

/** Server-side check: an unconfirmed sign-up with an admin address must never get admin rights. */
export function isVerifiedAdmin(user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined): boolean {
  return !!user && isAdminEmail(user.email) && !!user.email_confirmed_at;
}
