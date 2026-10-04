import { supabase } from '../supabaseClient';

/**
 * Only PKCE returns (?code=) are accepted. The code can only be exchanged with the verifier
 * stored by the sign-in this device started, so a link someone else sends cannot log this
 * device into their account. Raw access_token links are rejected for the same reason.
 */
export function urlLooksLikeOAuthCallback(url = typeof window !== 'undefined' ? window.location.href : ''): boolean {
  return /[?#&]code=/.test(url);
}

export function readOAuthCallbackParams(url = typeof window !== 'undefined' ? window.location.href : ''): {
  code: string | null;
} {
  try {
    const parsed = new URL(url);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#\/?/, ''));
    return { code: parsed.searchParams.get('code') || hashParams.get('code') };
  } catch {
    const withoutScheme = url.includes('://') ? url.split('://').slice(1).join('://') : url;
    const [beforeHash, hashPart = ''] = withoutScheme.split('#');
    const searchPart = beforeHash.split('?')[1] || '';
    const searchParams = new URLSearchParams(searchPart);
    const hashParams = new URLSearchParams(hashPart.replace(/^\//, ''));
    return { code: searchParams.get('code') || hashParams.get('code') };
  }
}

const claimedCallbacks = new Set<string>();

/** One deep link can arrive as both the launch URL and appUrlOpen. Claim it once. */
export function claimOAuthCallback(url: string): boolean {
  const { code } = readOAuthCallbackParams(url);
  const key = code ? `code:${code}` : url;
  if (claimedCallbacks.has(key)) return false;
  claimedCallbacks.add(key);
  return true;
}

export function oauthProviderError(url: string): string | null {
  if (!/[?#&](error|error_description)=/.test(url)) return null;
  const params = new URLSearchParams(url.split(/[?#]/).slice(1).join('&'));
  return params.get('error_description') || params.get('error') || 'Google sign-in was rejected';
}

export function cleanOAuthParamsFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  if (/access_token=|refresh_token=/.test(url.hash)) {
    url.hash = '';
  }
  const next = `${url.pathname}${url.search}${url.hash}` || '/';
  window.history.replaceState(null, '', next);
}

/**
 * Finish Google / OAuth after the browser returns.
 * Waits for the SDK, then exchanges ?code= once if the session is still missing.
 */
export async function completeOAuthSessionFromLocation(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!urlLooksLikeOAuthCallback()) {
    const { data } = await supabase.auth.getSession();
    return !!data.session?.access_token;
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      cleanOAuthParamsFromUrl();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const { code } = readOAuthCallbackParams();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    cleanOAuthParamsFromUrl();
    return true;
  }

  return false;
}
