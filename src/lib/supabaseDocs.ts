import { supabase } from '../supabaseClient';
import { isOfflineError } from './offlineQueue';

export const db = { kind: 'supabase-docs' as const };

const COLLECTIONS = new Set([
  'settings', 'inventory', 'invoices', 'employees', 'payroll', 'customers',
  'customer_transactions', 'stock_movements', 'vault_records', 'warehouses', 'audit_logs',
  'invoice_numbers',
]);

export interface DocRef {
  kind: 'doc';
  collection: string;
  id: string;
}

export interface CollectionRef {
  kind: 'collection';
  collection: string;
}

/** 'cached' re-emits from the in-memory copy; 'reload' reads the whole collection from the server. */
type Listener = (mode: 'cached' | 'reload') => void;

const listeners = new Map<string, Set<Listener>>();
let channel: { unsubscribe: () => void } | null = null;
let channelUid: string | null = null;
let channelPending: Promise<void> | null = null;
let reportedProblem: string | null = null;

export const SYNC_PROBLEM_EVENT = 'mostawdaee-sync-problem';

function reportProblem(error: { code?: string }) {
  const code = error?.code;
  if (code !== 'schema-missing' && code !== 'permission-denied' && code !== 'unauthenticated' && code !== 'subscription-required') return;
  if (reportedProblem === code || typeof window === 'undefined') return;
  reportedProblem = code;
  window.dispatchEvent(new CustomEvent(SYNC_PROBLEM_EVENT, { detail: code }));
}

/** Drop the realtime channel and listeners of the previous account. */
export function resetSync() {
  channel?.unsubscribe();
  channel = null;
  channelUid = null;
  channelPending = null;
  reportedProblem = null;
  listeners.clear();
  collectionCache.clear();
}

export function doc(_db: unknown, root: string, _uid: string, collection: string, id: string): DocRef {
  if (root !== 'users' || !COLLECTIONS.has(collection) || !id) {
    throw Object.assign(new Error('Invalid document path'), { code: 'invalid-argument' });
  }
  return { kind: 'doc', collection, id: String(id) };
}

export function collection(_db: unknown, root: string, _uid: string, name: string): CollectionRef {
  if (root !== 'users' || !COLLECTIONS.has(name)) {
    throw Object.assign(new Error('Invalid collection path'), { code: 'invalid-argument' });
  }
  return { kind: 'collection', collection: name };
}

function schemaError(error: { message?: string; code?: string; details?: string }) {
  const text = `${error?.message || ''} ${error?.details || ''}`;
  if (isOfflineError(error)) {
    return Object.assign(new Error('No network connection'), { code: 'offline' });
  }
  if (/subscription required/i.test(text)) {
    return Object.assign(new Error('Subscription required'), { code: 'subscription-required' });
  }
  if (/append-only/i.test(text)) {
    return Object.assign(new Error('The activity log cannot be changed'), { code: 'permission-denied' });
  }
  if (/merchant_documents_collection_check/.test(text)) {
    return Object.assign(new Error('This collection is not installed. Run supabase_production_setup.sql'), { code: 'collection-not-installed' });
  }
  if (error?.code === 'PGRST202' || error?.code === '42P01' || /merchant_commit|merchant_documents/.test(text)) {
    return Object.assign(new Error('Supabase sync is not installed. Run supabase_production_setup.sql'), { code: 'schema-missing' });
  }
  if (/not authenticated|JWT expired|invalid JWT/i.test(text)) {
    return Object.assign(new Error('No active session'), { code: 'unauthenticated' });
  }
  if (error?.code === '42501' || /row-level security|permission/i.test(text)) {
    return Object.assign(new Error(error.message || 'permission denied'), { code: 'permission-denied' });
  }
  if (/conflict/.test(text)) {
    return Object.assign(new Error('conflict'), { code: 'aborted' });
  }
  return Object.assign(new Error(error?.message || 'Supabase write failed'), { code: error?.code || 'unknown' });
}

class DocumentSnapshot {
  constructor(
    private row: { data: Record<string, unknown>; updated_at: string } | null,
  ) {}

  exists() {
    return this.row !== null;
  }

  data(): any {
    return this.row ? this.row.data : undefined;
  }
}

class QuerySnapshot {
  constructor(private rows: Array<{ doc_id: string; data: Record<string, unknown> }>) {}

  forEach(callback: (doc: { id: string; data: () => Record<string, unknown> }) => void) {
    this.rows.forEach((row) => callback({ id: row.doc_id, data: () => row.data }));
  }
}

async function requireUid(): Promise<string> {
  let result: { data: { session: any }; error?: any };
  try {
    result = await supabase.auth.getSession();
  } catch (error) {
    if (isOfflineError(error)) throw Object.assign(new Error('No network connection'), { code: 'offline' });
    throw error;
  }
  const uid = result.data.session?.user?.id;
  if (!uid) {
    // An expired token that cannot be refreshed without a network is "offline", not "signed out".
    if (isOfflineError(result.error) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      throw Object.assign(new Error('No network connection'), { code: 'offline' });
    }
    throw Object.assign(new Error('No active session'), { code: 'unauthenticated' });
  }
  return uid;
}

async function fetchDoc(ref: DocRef) {
  const uid = await requireUid();
  const { data, error } = await supabase
    .from('merchant_documents')
    .select('data, updated_at')
    .eq('user_id', uid)
    .eq('collection', ref.collection)
    .eq('doc_id', ref.id)
    .maybeSingle();
  if (error) throw schemaError(error);
  return data as { data: Record<string, unknown>; updated_at: string } | null;
}

type CollectionRow = { doc_id: string; data: Record<string, unknown>; updated_at: string };

/** Last full read of each collection, kept current row by row so a write never re-downloads everything. */
const collectionCache = new Map<string, Map<string, CollectionRow>>();

function cachedRows(name: string): CollectionRow[] | null {
  const rows = collectionCache.get(name);
  if (!rows) return null;
  return [...rows.values()].sort((a, b) => (a.doc_id < b.doc_id ? -1 : a.doc_id > b.doc_id ? 1 : 0));
}

function applyRow(name: string, id: string, row: CollectionRow | null) {
  const rows = collectionCache.get(name);
  if (rows) {
    if (row) rows.set(id, row);
    else rows.delete(id);
  }
  notify(name, 'cached');
}

/** After a successful commit, refresh only the documents it touched. */
async function applyCommitted(ops: Array<{ op: 'set' | 'delete'; collection: string; id: string }>) {
  const unique = new Map(ops.map((op) => [`${op.collection}/${op.id}`, op]));
  await Promise.all([...unique.values()].map(async (op) => {
    if (op.op === 'delete') {
      applyRow(op.collection, op.id, null);
      return;
    }
    try {
      const row = await fetchDoc({ kind: 'doc', collection: op.collection, id: op.id });
      applyRow(op.collection, op.id, row ? { doc_id: op.id, ...row } : null);
    } catch {
      notify(op.collection, 'reload');
    }
  }));
}

/** PostgREST caps a response (1000 rows by default), so a collection is read page by page. */
export const COLLECTION_PAGE_SIZE = 1000;

async function fetchCollection(name: string) {
  const uid = await requireUid();
  const rows: CollectionRow[] = [];
  for (let from = 0; ; from += COLLECTION_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('merchant_documents')
      .select('doc_id, data, updated_at')
      .eq('user_id', uid)
      .eq('collection', name)
      .order('doc_id', { ascending: true })
      .range(from, from + COLLECTION_PAGE_SIZE - 1);
    if (error) throw schemaError(error);
    const page = (data || []) as CollectionRow[];
    rows.push(...page);
    if (page.length < COLLECTION_PAGE_SIZE) {
      collectionCache.set(name, new Map(rows.map((row) => [row.doc_id, row])));
      return rows;
    }
  }
}

function notify(collectionName: string, mode: 'cached' | 'reload' = 'reload') {
  listeners.get(collectionName)?.forEach((listener) => listener(mode));
}

async function openChannel() {
  const uid = await requireUid();
  if (channel && channelUid === uid) return;
  channel?.unsubscribe();
  channelUid = uid;
  channel = supabase
    .channel(`merchant-documents-${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'merchant_documents', filter: `user_id=eq.${uid}` },
      (payload: { eventType?: string; new?: Partial<CollectionRow> & { collection?: string }; old?: Partial<CollectionRow> & { collection?: string } }) => {
        // REPLICA IDENTITY FULL puts the whole row in the event, so it can be applied without another read.
        if (payload.eventType === 'DELETE') {
          const name = payload.old?.collection;
          if (name && payload.old?.doc_id) applyRow(name, payload.old.doc_id, null);
          else if (name) notify(name);
          return;
        }
        const row = payload.new;
        if (row?.collection && row.doc_id && row.data && row.updated_at) {
          applyRow(row.collection, row.doc_id, { doc_id: row.doc_id, data: row.data, updated_at: row.updated_at });
        } else if (row?.collection) {
          notify(row.collection);
        }
      },
    )
    .subscribe();
}

// Every listener calls this at once on login; one shared promise keeps it to a single channel.
function ensureChannel() {
  if (!channelPending) {
    channelPending = openChannel().catch((error) => {
      channelPending = null;
      throw error;
    });
  }
  return channelPending;
}

export function onSnapshot(
  ref: DocRef | CollectionRef,
  onNext: (snap: any) => void,
  onError?: (error: any) => void,
) {
  let active = true;
  const emit = async (mode: 'cached' | 'reload' = 'reload') => {
    try {
      const cached = mode === 'cached' ? collectionCache.get(ref.collection) : undefined;
      if (ref.kind === 'doc') {
        const row = cached ? cached.get(ref.id) ?? null : await fetchDoc(ref);
        if (active) onNext(new DocumentSnapshot(row));
      } else {
        const rows = (cached && cachedRows(ref.collection)) || await fetchCollection(ref.collection);
        if (active) onNext(new QuerySnapshot(rows));
      }
    } catch (error) {
      if (!active) return;
      reportProblem(error as { code?: string });
      onError?.(error);
    }
  };
  const listener: Listener = (mode) => { void emit(mode); };
  const set = listeners.get(ref.collection) || new Set<Listener>();
  set.add(listener);
  listeners.set(ref.collection, set);
  void emit();
  void ensureChannel().catch((error) => onError?.(error));
  const onFocus = () => { void emit('reload'); };
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
  return () => {
    active = false;
    set.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
  };
}

async function writeOne(ref: DocRef, op: 'set' | 'delete', data?: Record<string, unknown>, merge = false) {
  const { error } = await supabase.rpc('merchant_commit', {
    p_expected: [],
    p_ops: [{ op, collection: ref.collection, id: ref.id, data: data ?? null, merge }],
  });
  if (error) {
    const wrapped = schemaError(error);
    reportProblem(wrapped);
    throw wrapped;
  }
  await applyCommitted([{ op, collection: ref.collection, id: ref.id }]);
}

export async function setDoc(ref: DocRef, data: any, options?: { merge?: boolean }) {
  await writeOne(ref, 'set', data, !!options?.merge);
}

export async function updateDoc(ref: DocRef, patch: any) {
  await writeOne(ref, 'set', patch, true);
}

export async function deleteDoc(ref: DocRef) {
  await writeOne(ref, 'delete');
}

interface ExpectedRow {
  collection: string;
  id: string;
  updated_at: string | null;
}

interface WriteOp {
  op: 'set' | 'delete';
  collection: string;
  id: string;
  data?: Record<string, unknown> | null;
  merge?: boolean;
}

export async function runTransaction(_db: unknown, work: (transaction: any) => Promise<void>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const expected: ExpectedRow[] = [];
    const seen = new Set<string>();
    const ops: WriteOp[] = [];
    const pending = new Map<string, { deleted?: boolean; data?: Record<string, unknown> }>();

    const transaction = {
      async get(ref: DocRef) {
        const key = `${ref.collection}/${ref.id}`;
        const staged = pending.get(key);
        if (staged?.deleted) return new DocumentSnapshot(null);
        if (staged?.data) return new DocumentSnapshot({ data: staged.data, updated_at: '' });
        const row = await fetchDoc(ref);
        if (!seen.has(key)) {
          seen.add(key);
          expected.push({ collection: ref.collection, id: ref.id, updated_at: row?.updated_at ?? null });
        }
        return new DocumentSnapshot(row);
      },
      set(ref: DocRef, data: Record<string, unknown>, options?: { merge?: boolean }) {
        const key = `${ref.collection}/${ref.id}`;
        const merge = !!options?.merge;
        const base = pending.get(key)?.data;
        const next = merge ? { ...(base || {}), ...data } : data;
        pending.set(key, { data: next });
        ops.push({ op: 'set', collection: ref.collection, id: ref.id, data, merge });
      },
      update(ref: DocRef, patch: Record<string, unknown>) {
        transaction.set(ref, patch, { merge: true });
      },
      delete(ref: DocRef) {
        pending.set(`${ref.collection}/${ref.id}`, { deleted: true });
        ops.push({ op: 'delete', collection: ref.collection, id: ref.id });
      },
    };

    await work(transaction);
    if (ops.length === 0) return;
    const { error } = await supabase.rpc('merchant_commit', { p_expected: expected, p_ops: ops });
    if (!error) {
      await applyCommitted(ops);
      return;
    }
    const wrapped = schemaError(error);
    if (wrapped.code === 'aborted' && attempt < 2) continue;
    reportProblem(wrapped);
    throw wrapped;
  }
}
