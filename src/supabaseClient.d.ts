import type { SupabaseClient } from '@supabase/supabase-js';

// Lightweight declaration so the TypeScript language server recognizes the
// exported `supabase` shape from the runtime `supabaseClient.js` proxy.
// Replace `any` with the generated `Database` type when available.
export type Database = any;

export const supabase: SupabaseClient<Database, 'public', any>;
export default supabase;

// Common helpers exported from src/supabaseClient.js
export const updateProfile: any;
