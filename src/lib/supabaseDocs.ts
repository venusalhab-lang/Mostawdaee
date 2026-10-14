import { supabase } from '../supabaseClient';
import { isOfflineError } from './offlineQueue';
import { ensureWorkspace, resetWorkspace } from './workspace';
import { allowRows, readRows, writeRows } from './rowCache';

export const db = { kind: 'supabase-docs' as const };

const COLLECTIONS = new Set([
  'settings', 'inventory', 'invoices', 'employees', 'payroll', 'customers',
  'customer_transactions', 'stock_movements', 'vault_records', 'warehouses', 'audit_logs',
  'invoice_numbers', 'suppliers', 'supplier_transactions', 'shifts', 'orders',
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

/**
 * 'cached' re-emits from the in-memory copy; 'fetch' brings the collection up to date from the server
 * (only the changes once it is in memory), joining a read of the same collection that is already running.
 */
type SyncMode = 'cached' | 'fetch';
type Listener = (mode: SyncMode) => void;

const listeners = new Map<string, Set<Listener>>();
let channel: { unsubscribe: () => void } | null = null;
let channelUid: string | null = null;
let channelPending: Promise<void> | null = null;
let reportedProblem: string | null = null;
/** True while realtime is subscribed; while it is, the cache is kept current row by row. */
let channelLive = false;
let channelWasLive = false;
let hiddenAt = 0;
/** A phone may drop the realtime socket in the background without telling us. */
export const STALE_AFTER_HIDDEN_MS = 60_000;

export const SYNC_PROBLEM_EVENT = 'mostawdaee-sync-problem';

function reportProblem(error: { code?: string }) {
  const code = error?.code;
  if (code !== 'schema-missing' && code !== 'permission-denied' && code !== 'role-denied' && code !== 'unauthenticated' && code !== 'subscription-required') return;
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
  channelLive = false;
  channelWasLive = false;
  reportedProblem = null;
  listeners.clear();
  collectionCache.clear();
  inflight.clear();
  persistTimers.forEach((timer) => clearTimeout(timer));
  persistTimers.clear();
  deviceScope = null;
  generation += 1;
  resetWorkspace();
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
  if (/role not allowed/i.test(text)) {
    return Object.assign(new Error('Your role in this store does not allow this change'), { code: 'role-denied' });
  }
  if (/vault is newer/i.test(text)) {
    return Object.assign(new Error('vault is newer'), { code: 'vault-newer' });
  }
  if (/einvoice locked/i.test(text)) {
    return Object.assign(new Error('This invoice was accepted by the national e-invoicing system'), { code: 'einvoice-locked' });
  }
  if (/shift is closed/i.test(text)) {
    return Object.assign(new Error('This shift is closed'), { code: 'shift-closed' });
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

/** The store owner whose documents this session reads; members read their owner's books. */
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
  const workspace = await ensureWorkspace(uid);
  // A new role sees different rows (cashiers never see the vault), so it starts from its own saved copy.
  const scope = `${uid}|${workspace.ownerId}|${workspace.role}|`;
  if (scope !== deviceScope) {
    allowRows(`${uid}|`);
    deviceScope = scope;
  }
  return workspace.ownerId;
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
    schedulePersist(name);
  }
  notify(name, 'cached');
}

/** `<session user>|<store owner>|<role>|`; set once the workspace is known, cleared on sign-out. */
let deviceScope: string | null = null;
/** Bumped by resetSync so work started for the previous account never lands in the new one. */
let generation = 0;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
export const PERSIST_DELAY_MS = 2000;

function schedulePersist(name: string) {
  const scope = deviceScope;
  if (!scope || persistTimers.has(name)) return;
  const gen = generation;
  persistTimers.set(name, setTimeout(() => {
    persistTimers.delete(name);
    const rows = collectionCache.get(name);
    if (gen !== generation || !rows) return;
    void writeRows(scope + name, [...rows.values()]);
  }, PERSIST_DELAY_MS));
}

/** Loads the copy saved on this device into memory, so the next sync downloads only what changed since. */
async function restoreSaved(name: string): Promise<void> {
  const scope = deviceScope;
  if (!scope) return;
  const gen = generation;
  const saved = await readRows(scope + name);
  if (!saved || gen !== generation || collectionCache.has(name)) return;
  collectionCache.set(name, new Map(saved.map((row) => [row.doc_id, row])));
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
      notify(op.collection, 'fetch');
    }
  }));
}

/** PostgREST caps a response (1000 rows by default), so a collection is read page by page. */
export const COLLECTION_PAGE_SIZE = 1000;

/** A download that started for the previous account must not land in the next one's memory. */
function assertSameAccount(gen: number) {
  if (gen !== generation) throw Object.assign(new Error('The account changed during the download'), { code: 'account-changed' });
}

async function fetchCollection(name: string) {
  const gen = generation;
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
      assertSameAccount(gen);
      collectionCache.set(name, new Map(rows.map((row) => [row.doc_id, row])));
      return rows;
    }
  }
}

/**
 * A commit's rows carry the time they were written but become visible when the transaction ends,
 * so a refresh re-reads everything changed this long before the newest row already held.
 */
export const DELTA_OVERLAP_MS = 2 * 60_000;

const stampOf = (row: CollectionRow) => {
  const t = Date.parse(row.updated_at);
  return Number.isFinite(t) ? t : -Infinity;
};

async function fetchPaged<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += COLLECTION_PAGE_SIZE) {
    const { data, error } = await page(from, from + COLLECTION_PAGE_SIZE - 1);
    if (error) throw schemaError(error);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < COLLECTION_PAGE_SIZE) return out;
  }
}

/** Ids handed to `in (...)` per request, so the URL stays short. */
const ID_CHUNK = 150;

/**
 * Brings a collection already in memory up to date by downloading only what changed: rows written since the newest one held,
 * plus a row count. Only when the count shows that rows were deleted (or missed) is the list of ids read, never the documents.
 */
async function syncCollection(name: string): Promise<CollectionRow[]> {
  const gen = generation;
  const uid = await requireUid();
  if (!collectionCache.has(name)) await restoreSaved(name);
  assertSameAccount(gen);
  const rows = collectionCache.get(name);
  let newest = -Infinity;
  if (rows) for (const row of rows.values()) newest = Math.max(newest, stampOf(row));
  if (!rows || !Number.isFinite(newest)) {
    const fresh = await fetchCollection(name);
    schedulePersist(name);
    return fresh;
  }

  const since = new Date(newest - DELTA_OVERLAP_MS).toISOString();
  const base = () => supabase.from('merchant_documents');
  const [changed, counted] = await Promise.all([
    fetchPaged<CollectionRow>((from, to) => base()
      .select('doc_id, data, updated_at')
      .eq('user_id', uid)
      .eq('collection', name)
      .gte('updated_at', since)
      .order('doc_id', { ascending: true })
      .range(from, to)),
    base().select('doc_id', { count: 'exact', head: true }).eq('user_id', uid).eq('collection', name),
  ]);
  if (counted.error) throw schemaError(counted.error);
  assertSameAccount(gen);

  // Realtime may have applied a newer copy while this was downloading; never go back to an older one.
  const keep = (row: CollectionRow) => {
    const current = rows.get(row.doc_id);
    if (!current || stampOf(row) >= stampOf(current)) rows.set(row.doc_id, row);
  };
  changed.forEach(keep);

  if (rows.size !== counted.count) {
    const ids = await fetchPaged<{ doc_id: string }>((from, to) => base()
      .select('doc_id')
      .eq('user_id', uid)
      .eq('collection', name)
      .order('doc_id', { ascending: true })
      .range(from, to));
    assertSameAccount(gen);
    const live = new Set(ids.map((r) => r.doc_id));
    // Rows that arrived by realtime during this refresh are newer than `newest` and stay.
    for (const [id, row] of rows) if (!live.has(id) && stampOf(row) <= newest) rows.delete(id);
    const missing = [...live].filter((id) => !rows.has(id));
    for (let i = 0; i < missing.length; i += ID_CHUNK) {
      const { data, error } = await base()
        .select('doc_id, data, updated_at')
        .eq('user_id', uid)
        .eq('collection', name)
        .in('doc_id', missing.slice(i, i + ID_CHUNK));
      if (error) throw schemaError(error);
      assertSameAccount(gen);
      ((data || []) as CollectionRow[]).forEach(keep);
    }
  }
  schedulePersist(name);
  return cachedRows(name) || [];
}

const inflight = new Map<string, Promise<CollectionRow[]>>();

/** Several screens open the same collection at once; they share one download. */
function sharedFetchCollection(name: string) {
  let pending = inflight.get(name);
  if (!pending) {
    const started: Promise<CollectionRow[]> = syncCollection(name).finally(() => {
      if (inflight.get(name) === started) inflight.delete(name);
    });
    pending = started;
    inflight.set(name, pending);
  }
  return pending;
}

function notify(collectionName: string, mode: SyncMode = 'fetch') {
  listeners.get(collectionName)?.forEach((listener) => listener(mode));
}

/** Catches up every open collection once (changes only), after realtime may have missed some. */
function refreshOpenCollections() {
  for (const name of [...collectionCache.keys()]) if (!listeners.has(name)) collectionCache.delete(name);
  for (const name of listeners.keys()) notify(name, 'fetch');
}

let windowWatchInstalled = false;

function installWindowWatch() {
  if (windowWatchInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  windowWatchInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (!channelLive || (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS)) refreshOpenCollections();
    hiddenAt = 0;
  });
  window.addEventListener('focus', () => {
    if (!channelLive) refreshOpenCollections();
  });
  window.addEventListener('online', refreshOpenCollections);
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
      (payload: { eventType?: string; new?: Partial<CollectionRow> & { collection?: string; user_id?: string }; old?: Partial<CollectionRow> & { collection?: string; user_id?: string } }) => {
        // REPLICA IDENTITY FULL puts the whole row in the event, so it can be applied without another read.
        if (payload.eventType === 'DELETE') {
          // Realtime applies neither the filter nor row-level security to deletes: other stores' deletes arrive too.
          if (payload.old?.user_id !== uid) return;
          const name = payload.old?.collection;
          if (name && payload.old?.doc_id) applyRow(name, payload.old.doc_id, null);
          else if (name) notify(name);
          return;
        }
        const row = payload.new;
        if (row?.user_id && row.user_id !== uid) return;
        if (row?.collection && row.doc_id && row.data && row.updated_at) {
          applyRow(row.collection, row.doc_id, { doc_id: row.doc_id, data: row.data, updated_at: row.updated_at });
        } else if (row?.collection) {
          notify(row.collection);
        }
      },
    )
    .subscribe((status: string) => {
      channelLive = status === 'SUBSCRIBED';
      if (!channelLive) return;
      // Rejoining after a drop: changes made while disconnected never arrived as events.
      if (channelWasLive) refreshOpenCollections();
      channelWasLive = true;
    });
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
  const emit = async (mode: SyncMode = 'fetch') => {
    try {
      const cached = mode === 'cached' ? collectionCache.get(ref.collection) : undefined;
      if (ref.kind === 'doc') {
        const row = cached ? cached.get(ref.id) ?? null : await fetchDoc(ref);
        if (active) onNext(new DocumentSnapshot(row));
      } else {
        const rows = (cached && cachedRows(ref.collection)) || await sharedFetchCollection(ref.collection);
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
  installWindowWatch();
  void emit(channelLive && collectionCache.has(ref.collection) ? 'cached' : 'fetch');
  void ensureChannel().catch((error) => onError?.(error));
  return () => {
    active = false;
    set.delete(listener);
    if (set.size === 0 && listeners.get(ref.collection) === set) listeners.delete(ref.collection);
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
