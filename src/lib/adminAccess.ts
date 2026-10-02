const ADMIN_EMAILS = [
  'venusalhab@gmail.com',
  'mohammad.salhab@example.com',
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim() as (typeof ADMIN_EMAILS)[number]);
}
