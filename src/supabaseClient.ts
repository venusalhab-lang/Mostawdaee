// Type wrapper for the JS-based supabase client to satisfy TypeScript checks.
import client, * as _client from './supabaseClient.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Re-export all named exports from the original JS module so existing imports keep working
export * from './supabaseClient.js';

// Export a lightweight `Database` type placeholder you can replace with generated types later
// Replace `any` with the real generated `Database` interface from Supabase when available.
export type Database = any;

// Export a helper Supabase client type for local imports
export type Supabase = SupabaseClient<Database, 'public', any>;

// Re-export the proxied client with a SupabaseClient type (generically typed to Database)
export const supabase: SupabaseClient<Database, 'public', any> = (client as any) || (_client as any);
export default supabase;

// Explicitly re-export commonly used helper functions with `any` typing to avoid TS churn
export const updateSubscription: any = (_client as any).updateSubscription;
export const updateProfile: any = (_client as any).updateProfile;
export const createCompletedInvoice: any = (_client as any).createCompletedInvoice;
export const createCompletedExpense: any = (_client as any).createCompletedExpense;
export const createCompletedPurchase: any = (_client as any).createCompletedPurchase;
