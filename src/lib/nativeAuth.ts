export const ANDROID_APPLICATION_ID = 'com.mostawdaee.app';
export const NATIVE_OAUTH_SCHEME = 'com.mostawdaee.app';
export const NATIVE_OAUTH_REDIRECT = `${NATIVE_OAUTH_SCHEME}://google-auth`;

/** Canonical web origin for Supabase Auth redirects (apex 308s to www; keep redirectTo on www). */
export const WEB_AUTH_ORIGIN = 'https://www.mostawdaee.com';

/**
 * Where Supabase should return after OAuth / password-reset on this device.
 * Native uses the app deep link; web always prefers www in production so the
 * allow-list and Site URL in the Supabase dashboard stay consistent.
 */
export function authRedirectTo(origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  const host = (() => {
    try {
      return new URL(origin || WEB_AUTH_ORIGIN).hostname;
    } catch {
      return '';
    }
  })();
  // Always the site root — never /auth/callback. Relative Vite assets (base "./")
  // break when the SPA HTML is served under /auth/*, which produces a blank page.
  if (host === 'mostawdaee.com' || host === 'www.mostawdaee.com' || host === 'app.mostawdaee.com') {
    return `${WEB_AUTH_ORIGIN}/`;
  }
  return origin || `${WEB_AUTH_ORIGIN}/`;
}
