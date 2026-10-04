import { describe, expect, it } from 'vitest';
import { isAdminEmail, isVerifiedAdmin } from '../adminAccess';

describe('admin access', () => {
  it('does not list placeholder addresses anyone could register', () => {
    expect(isAdminEmail('mohammad.salhab@example.com')).toBe(false);
  });

  it('requires a confirmed email before granting admin rights', () => {
    expect(isVerifiedAdmin({ email: 'venusalhab@gmail.com', email_confirmed_at: null })).toBe(false);
    expect(isVerifiedAdmin({ email: 'VenuSalhab@gmail.com ', email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isVerifiedAdmin({ email: 'someone@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(isVerifiedAdmin(null)).toBe(false);
  });
});
