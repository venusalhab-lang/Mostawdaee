/**
 * Collection rows kept on this device between sessions, so opening the app downloads only what changed.
 * Keys start with the signed-in user's id; signing out clears every key of that user.
 * Any failure (no IndexedDB, private mode, quota) only means a full download next time.
 */

const DB_NAME = 'mostawdaee-rows';
const STORE = 'collections';
const FORMAT = 1;

export interface CachedRow {
  doc_id: string;
  data: Record<string, unknown>;
  updated_at: string;
}

let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!opening) {
    opening = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return opening;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

const isRow = (r: any): r is CachedRow =>
  !!r && typeof r.doc_id === 'string' && typeof r.updated_at === 'string' && !!r.data && typeof r.data === 'object';

export async function readRows(key: string): Promise<CachedRow[] | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const record = await new Promise<any>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!record || record.format !== FORMAT || !Array.isArray(record.rows)) return null;
    return record.rows.filter(isRow);
  } catch {
    return null;
  }
}

/** Users signed out on this page: a save already scheduled for them must not bring their rows back. */
const cleared = new Set<string>();

/** Lets a user signed in again save rows. */
export function allowRows(prefix: string): void {
  cleared.delete(prefix);
}

const isCleared = (key: string) => [...cleared].some((prefix) => key.startsWith(prefix));

export async function writeRows(key: string, rows: CachedRow[]): Promise<void> {
  if (isCleared(key)) return;
  const db = await openDb();
  if (!db || isCleared(key)) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ format: FORMAT, savedAt: Date.now(), rows }, key);
    await done(tx);
  } catch {
    // A failed save only costs a full download next time.
  }
}

/** Removes every collection saved under keys starting with `prefix`. */
export async function clearRows(prefix: string): Promise<void> {
  if (!prefix) return;
  cleared.add(prefix);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    await done(tx);
  } catch {
    // ignore
  }
}
