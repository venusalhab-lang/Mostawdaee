const DEVICE_KEY = 'mustawdae_device_id';

function deviceId(): string {
  if (typeof window === 'undefined') return 'SRV0';
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'TMP0';
  }
}

interface SeqState {
  date: string;
  n: number;
}

// Deliberately NOT under the per-user cache prefix: logout wipes that prefix and would restart the counter.
function seqKey(prefix: string, scope: string): string {
  return `mustawdae_invoice_seq:${scope || 'guest'}:${prefix}`;
}

function readOne(key: string, date: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as SeqState;
      if (parsed?.date === date && Number.isFinite(parsed.n)) return parsed.n;
    }
  } catch {
    // ignore
  }
  return 0;
}

/**
 * Two accounts of the same store on one device share the device code, so they must share one counter.
 * Counters used to be kept per account; the larger of both is taken so a number is never handed out twice.
 */
function readSeq(prefix: string, uid: string, storeId?: string): SeqState {
  const date = today();
  const scope = storeId || uid;
  let n = readOne(seqKey(prefix, scope), date);
  if (uid && uid !== scope) n = Math.max(n, readOne(seqKey(prefix, uid), date));
  return { date, n };
}

function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${mm}${dd}`;
}

function format(prefix: string, date: string, n: number): string {
  return `${prefix}-${date}-${deviceId()}-${String(n).padStart(4, '0')}`;
}

/** Next number without consuming it (for display). */
export function peekInvoiceNumber(prefix: string, uid: string, storeId?: string): string {
  const s = readSeq(prefix, uid, storeId);
  return format(prefix, s.date, s.n + 1);
}

/** Consume and return the next sequential invoice number for this store, device and day. */
export function consumeInvoiceNumber(prefix: string, uid: string, storeId?: string): string {
  const s = readSeq(prefix, uid, storeId);
  const n = s.n + 1;
  try {
    localStorage.setItem(seqKey(prefix, storeId || uid), JSON.stringify({ date: s.date, n }));
  } catch {
    // ignore
  }
  return format(prefix, s.date, n);
}
