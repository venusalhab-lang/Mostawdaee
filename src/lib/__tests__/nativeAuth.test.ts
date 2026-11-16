import { describe, expect, it } from 'vitest';
import { WEB_AUTH_ORIGIN, authRedirectTo } from '../nativeAuth';

describe('authRedirectTo', () => {
  it('maps production hosts to the canonical www origin (not /auth/callback)', () => {
    expect(authRedirectTo('https://mostawdaee.com')).toBe(WEB_AUTH_ORIGIN);
    expect(authRedirectTo('https://www.mostawdaee.com')).toBe(WEB_AUTH_ORIGIN);
    expect(authRedirectTo('https://app.mostawdaee.com')).toBe(WEB_AUTH_ORIGIN);
    expect(authRedirectTo('https://www.mostawdaee.com/settings')).toBe(WEB_AUTH_ORIGIN);
  });

  it('keeps local and preview origins unchanged', () => {
    expect(authRedirectTo('http://localhost:5173')).toBe('http://localhost:5173');
    expect(authRedirectTo('http://127.0.0.1:5187')).toBe('http://127.0.0.1:5187');
    expect(authRedirectTo('https://mostawdaee-git-preview.vercel.app')).toBe('https://mostawdaee-git-preview.vercel.app');
  });
});
