import { describe, expect, it } from 'vitest';
import { type PlatformAction, isPlatformRole, staffCan } from '../platformStaff';

const ALL: PlatformAction[] = [
  'view_subscribers', 'grant_grace', 'manage_subscriptions', 'view_ai_usage', 'answer_tickets', 'manage_staff', 'view_audit',
];

describe('platform staff permissions', () => {
  it('the founder can do everything', () => {
    for (const action of ALL) expect(staffCan('founder', action)).toBe(true);
  });

  it('operations runs subscriptions and tickets but not the team or the audit log', () => {
    expect(ALL.filter((a) => staffCan('operations', a))).toEqual([
      'view_subscribers', 'grant_grace', 'manage_subscriptions', 'view_ai_usage', 'answer_tickets',
    ]);
  });

  it('support sees, answers and gives grace, but never changes a subscription otherwise', () => {
    expect(ALL.filter((a) => staffCan('support', a))).toEqual(['view_subscribers', 'grant_grace', 'view_ai_usage', 'answer_tickets']);
  });

  it('anyone else gets nothing', () => {
    for (const role of [null, undefined, 'user' as any, 'super_admin' as any]) {
      for (const action of ALL) expect(staffCan(role, action)).toBe(false);
    }
    expect(isPlatformRole('founder')).toBe(true);
    expect(isPlatformRole('super_admin')).toBe(false);
  });
});
