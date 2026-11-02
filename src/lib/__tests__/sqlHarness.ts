import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/** The parts of Supabase the setup scripts rely on: auth.users, auth.uid(), auth.role() and the API roles. */
const SUPABASE_STUBS = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  email_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`;

export const SQL_FILES = [
  'supabase_production_setup.sql',
  'supabase_cheques.sql',
  'supabase_inventory_audit.sql',
  'supabase_einvoicing.sql',
];

export interface SqlHarness {
  db: PGlite;
  /** Runs `sql` as the signed-in user `uid` (role authenticated), the way PostgREST does. */
  as<T = any>(uid: string, sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs as the database owner (setup and assertions that must see everything). */
  admin<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  addUser(id: string, email: string, confirmed?: boolean): Promise<void>;
  setSubscription(userId: string, status: 'trial' | 'active' | 'expired', expiry: string): Promise<void>;
}

export async function createSqlHarness(files = SQL_FILES): Promise<SqlHarness> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of files) {
    await db.exec(readFileSync(resolve(process.cwd(), file), 'utf8'));
  }

  const admin = async <T,>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;

  const as = async <T,>(uid: string, sql: string, params: unknown[] = []) => {
    await db.exec('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [uid]);
      await db.exec('SET LOCAL ROLE authenticated');
      const rows = (await db.query<T>(sql, params)).rows;
      await db.exec('COMMIT');
      return rows;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  };

  const addUser = async (id: string, email: string, confirmed = true) => {
    await admin('INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, $3)', [id, email, confirmed ? new Date().toISOString() : null]);
  };

  const setSubscription = async (userId: string, status: 'trial' | 'active' | 'expired', expiry: string) => {
    await db.exec('BEGIN');
    await db.query(`SELECT set_config('request.jwt.claim.role', 'service_role', true)`);
    await db.query(
      `INSERT INTO public.user_subscriptions (user_id, subscription_status, expiry_date, trial_start_date)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET subscription_status = EXCLUDED.subscription_status, expiry_date = EXCLUDED.expiry_date`,
      [userId, status, expiry],
    );
    await db.exec('COMMIT');
  };

  return { db, as, admin, addUser, setSubscription };
}
