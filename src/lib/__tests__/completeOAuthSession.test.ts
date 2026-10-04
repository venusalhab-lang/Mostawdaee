import { describe, expect, it } from 'vitest';
import { claimOAuthCallback, oauthProviderError, readOAuthCallbackParams, urlLooksLikeOAuthCallback } from '../completeOAuthSession';

describe('OAuth callback parsing', () => {
  it('reads a PKCE code from the query string', () => {
    const parsed = readOAuthCallbackParams('http://localhost:3000/?code=abc123&state=x');
    expect(parsed.code).toBe('abc123');
    expect(urlLooksLikeOAuthCallback('http://localhost:3000/?code=abc123')).toBe(true);
  });

  it('reads tokens from a custom-scheme deep link', () => {
    const parsed = readOAuthCallbackParams('com.mostawdaee.app://google-auth?code=native-code');
    expect(parsed.code).toBe('native-code');
  });

  it('does not treat a normal app URL as an OAuth return', () => {
    expect(urlLooksLikeOAuthCallback('http://localhost:3000/#/')).toBe(false);
  });

  it('ignores raw tokens in a link so nobody can inject their own session', () => {
    const injected = 'com.mostawdaee.app://google-auth#access_token=attacker-token&refresh_token=attacker-refresh';
    expect(urlLooksLikeOAuthCallback(injected)).toBe(false);
    expect(readOAuthCallbackParams(injected)).toEqual({ code: null });
  });

  it('claims the same Google return only once', () => {
    const url = 'com.mostawdaee.app://google-auth?code=once-only-code';
    expect(claimOAuthCallback(url)).toBe(true);
    expect(claimOAuthCallback(url)).toBe(false);
  });

  it('reads the provider error from the return link', () => {
    expect(oauthProviderError('com.mostawdaee.app://google-auth?error=access_denied&error_description=User%20denied')).toBe('User denied');
    expect(oauthProviderError('com.mostawdaee.app://google-auth?code=ok')).toBeNull();
  });
});
