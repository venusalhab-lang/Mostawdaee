/**
 * Single source of truth for Supabase credentials: build-time env, then the built-in public defaults.
 * Never read from localStorage: a stored value could point the app (and its session) at another project.
 * The anon key is public by design; security is enforced by Row Level Security.
 */
const DEFAULT_URL = 'https://kwvrtsnvadjknioqbbxs.supabase.co';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3dnJ0c252YWRqa25pb3FiYnhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTk5NTQsImV4cCI6MjA5NTEzNTk1NH0.6YfS8ujoO2yjMQoaFNgptRa70qyUglqhignezpm2d4M';

const valid = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && !v.includes('...');

export const getSupabaseCredentials = (): { url: string; key: string } => {
  let url = '';
  let key = '';

  const env = (import.meta as any)?.env;
  if (env) {
    if (valid(env.VITE_SUPABASE_URL) && env.VITE_SUPABASE_URL.trim().startsWith('http')) url = env.VITE_SUPABASE_URL.trim();
    if (valid(env.VITE_SUPABASE_ANON_KEY)) key = env.VITE_SUPABASE_ANON_KEY.trim();
  }

  if (!url.startsWith('http')) url = DEFAULT_URL;
  if (!key) key = DEFAULT_ANON_KEY;
  return { url, key };
};

export const isSupabaseConfigured = (): boolean => {
  const { url, key } = getSupabaseCredentials();
  if (!url || !key) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  const u = url.toLowerCase();
  const k = key.toLowerCase();
  const placeholder =
    u.includes('...') || u.includes('your-') || u.includes('your_') || u.includes('placeholder') ||
    u.includes('<') || u.includes('project-id') ||
    k.includes('your_') || k.includes('your-') || k.includes('placeholder') || k.includes('...');
  return !placeholder;
};
