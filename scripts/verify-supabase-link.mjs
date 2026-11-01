/**
 * Verifies Mostawdaee ↔ Supabase link using the public anon key only.
 * Usage: node scripts/verify-supabase-link.mjs
 * Does not print secrets.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const out = {};
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const cfg = readFileSync(resolve('src/lib/supabaseConfig.ts'), 'utf8');
const defaultUrl = cfg.match(/DEFAULT_URL = '([^']+)'/)?.[1];
const defaultAnon = cfg.match(/DEFAULT_ANON_KEY =\n  '([^']+)'/)?.[1];
const env = loadEnv();
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || defaultUrl;
const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || defaultAnon;

if (!url || !anon || anon.split('.').length !== 3) {
  console.error('FAIL: missing or invalid Supabase URL / anon JWT');
  process.exit(1);
}

async function probe(path, init) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      ...(init?.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const tables = [
  'merchant_documents',
  'cheques',
  'user_subscriptions',
  'inventory_audits',
  'play_purchases',
  'products',
  'warehouses',
  'einvoice_settings',
];
const rpcs = ['merchant_commit', 'claim_invoice_number'];

console.log('project', new URL(url).host);
console.log('anon_jwt', anon.split('.').length === 3, 'len', anon.length);

const auth = await probe('/auth/v1/settings');
console.log('auth_settings', auth.status, auth.status === 200 ? 'OK' : 'FAIL');

let fail = 0;
for (const t of tables) {
  const r = await probe(`/rest/v1/${t}?select=*&limit=0`);
  const ok = r.status === 200;
  if (!ok) fail += 1;
  const code = r.body?.code || '';
  console.log(`table ${t}:`, ok ? 'OK' : `FAIL ${r.status} ${code}`);
}
for (const rpc of rpcs) {
  const r = await probe(`/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  // Missing => 404 PGRST202. Present but unauthorized/invalid args => 400/401/403.
  const missing = r.status === 404 || r.body?.code === 'PGRST202';
  if (missing) fail += 1;
  console.log(`rpc ${rpc}:`, missing ? `MISSING ${r.status}` : `PRESENT ${r.status}`);
}

if (fail) {
  console.error(`\nRESULT: ${fail} critical gap(s). Run supabase_production_setup.sql then companion SQL files.`);
  process.exit(2);
}
console.log('\nRESULT: core Supabase link looks ready.');
