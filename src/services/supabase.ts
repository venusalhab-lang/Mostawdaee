import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as sharedSupabase } from '../supabaseClient';
import {
  getSupabaseCredentials,
  isSupabaseConfigured,
  saveSupabaseCredentials,
  clearSupabaseCredentials,
} from '../lib/supabaseConfig';

export { getSupabaseCredentials, isSupabaseConfigured, saveSupabaseCredentials, clearSupabaseCredentials };

/**
 * Returns the ONE shared Supabase client (same session/auth storage as the rest of the app).
 * A second createClient() with the same storage key causes "Multiple GoTrueClient" lock contention.
 */
export const getSupabaseClient = (): SupabaseClient | null => {
  if (!isSupabaseConfigured()) return null;
  return sharedSupabase as unknown as SupabaseClient;
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
