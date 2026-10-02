import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const getSupabaseCredentials = () => {
  let url = '';
  let key = '';
  const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

  // 1. Try to load from Vite environment variables (highest priority)
  try {
    const metaEnv = (import.meta as any).env;
    if (typeof import.meta !== 'undefined' && metaEnv) {
      if (metaEnv.VITE_SUPABASE_URL && metaEnv.VITE_SUPABASE_URL.trim() && !metaEnv.VITE_SUPABASE_URL.includes('...')) {
        const envUrl = metaEnv.VITE_SUPABASE_URL.trim();
        if (envUrl.startsWith('http')) {
          url = envUrl;
        }
      }
      if (metaEnv.VITE_SUPABASE_ANON_KEY && metaEnv.VITE_SUPABASE_ANON_KEY.trim() && !metaEnv.VITE_SUPABASE_ANON_KEY.includes('...')) {
        key = metaEnv.VITE_SUPABASE_ANON_KEY.trim();
      }
    }
  } catch (e) {
    console.warn("[supabase service] Failed reading from import.meta.env:", e);
  }

  // 2. Try to load from localStorage (to support user-specific overrides/debugging)
  if (isBrowser) {
    try {
      const storedUrl = window.localStorage.getItem('VITE_SUPABASE_URL');
      const storedKey = window.localStorage.getItem('VITE_SUPABASE_ANON_KEY');
      if (storedUrl && storedUrl.trim() && !storedUrl.includes('...')) {
        const trimmedUrl = storedUrl.trim();
        if (trimmedUrl.startsWith('http')) {
          url = trimmedUrl;
        }
      }
      if (storedKey && storedKey.trim() && !storedKey.includes('...')) {
        key = storedKey.trim();
      }
    } catch (e) {
      console.warn("[supabase service] Failed reading from localStorage:", e);
    }
  }

  // 3. Fallback to default hardcoded keys if still empty/invalid
  if (!url || !url.startsWith('http')) {
    url = 'https://kwvrtsnvadjknioqbbxs.supabase.co';
  }
  if (!key) {
    key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3dnJ0c252YWRqa25pb3FiYnhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTk5NTQsImV4cCI6MjA5NTEzNTk1NH0.6YfS8ujoO2yjMQoaFNgptRa70qyUglqhignezpm2d4M';
  }

  return { url, key };
};

let cachedClient: SupabaseClient | null = null;

export const isSupabaseConfigured = (): boolean => {
  const { url: supabaseUrl, key: supabaseAnonKey } = getSupabaseCredentials();

  if (!supabaseUrl || !supabaseAnonKey) {
    return false;
  }
  
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
  } catch (e) {
    return false;
  }

  const lowerUrl = supabaseUrl.toLowerCase();
  const lowerKey = supabaseAnonKey.toLowerCase();
  
  const isPlaceholder = 
    lowerUrl.includes('...') || 
    lowerUrl.includes('your-') || 
    lowerUrl.includes('your_') || 
    lowerUrl.includes('placeholder') || 
    lowerUrl.includes('<') || 
    lowerUrl.includes('project-id') ||
    lowerKey.includes('your_') || 
    lowerKey.includes('your-') || 
    lowerKey.includes('placeholder') ||
    lowerKey.includes('...');
    
  return !isPlaceholder;
};

/**
 * Save custom Supabase credentials from client-side config forms.
 */
export const saveSupabaseCredentials = (url: string, key: string) => {
  const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  if (!isBrowser) {
    console.error('Cannot save Supabase credentials: no browser localStorage available.');
    return;
  }

  try {
    window.localStorage.setItem('VITE_SUPABASE_URL', url.trim());
    window.localStorage.setItem('VITE_SUPABASE_ANON_KEY', key.trim());
    cachedClient = null; // Reset singleton client to make it re-evaluate
  } catch (e) {
    console.error('Failed to save Supabase credentials in local storage:', e);
  }
};

/**
 * Clear stored Supabase credentials.
 */
export const clearSupabaseCredentials = () => {
  const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  if (!isBrowser) {
    console.error('Cannot clear Supabase credentials: no browser localStorage available.');
    cachedClient = null;
    return;
  }

  try {
    window.localStorage.removeItem('VITE_SUPABASE_URL');
    window.localStorage.removeItem('VITE_SUPABASE_ANON_KEY');
    cachedClient = null;
  } catch (e) {
    console.error('Failed to clear Supabase credentials:', e);
  }
};

/**
 * Access the lazily instantiated Supabase client.
 */
export const getSupabaseClient = (): SupabaseClient | null => {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!cachedClient) {
    try {
      const { url: supabaseUrl, key: supabaseAnonKey } = getSupabaseCredentials();
      cachedClient = createClient(supabaseUrl, supabaseAnonKey);
    } catch (err) {
      console.error('Failed to initialize Supabase client:', err);
      return null;
    }
  }
  return cachedClient;
};

/**
 * Map local frontend product object to user's custom Supabase 'products' structure:
 * columns: id, product_name, quantity, price, user_id
 */
export interface SupabaseProductRow {
  id?: number;
  product_name: string;
  quantity: number;
  price: number;
  user_id: string; // auth.uid() UUID
}

/**
 * Pull products from Supabase
 */
export async function fetchSupabaseProducts(): Promise<SupabaseProductRow[] | null> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured yet. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  
  const { data, error } = await client
    .from('products')
    .select('*');
    
  if (error) {
    throw error;
  }
  return data as SupabaseProductRow[];
}

/**
 * Write/sync product to user's Supabase products table
 */
export async function insertSupabaseProduct(row: Omit<SupabaseProductRow, 'id'>): Promise<SupabaseProductRow | null> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured yet.');
  }

  const { data, error } = await client
    .from('products')
    .insert([row])
    .select();

  if (error) {
    throw error;
  }
  return data && data[0] ? (data[0] as SupabaseProductRow) : null;
}
