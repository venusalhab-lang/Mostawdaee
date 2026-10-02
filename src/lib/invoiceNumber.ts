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
function seqKey(prefix: string, uid: string): string {
  return `mustawdae_invoice_seq:${uid || 'guest'}:${prefix}`;
}

function readSeq(prefix: string, uid: string): SeqState {
  const date = today();
  try {
    const raw = localStorage.getItem(seqKey(prefix, uid));
    if (raw) {
      const parsed = JSON.parse(raw) as SeqState;
      if (parsed?.date === date && Number.isFinite(parsed.n)) return parsed;
    }
  } catch {
    // ignore
  }
  return { date, n: 0 };
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
export function peekInvoiceNumber(prefix: string, uid: string): string {
  const s = readSeq(prefix, uid);
  return format(prefix, s.date, s.n + 1);
}

/** Consume and return the next sequential invoice number for this device/day. */
export function consumeInvoiceNumber(prefix: string, uid: string): string {
  const s = readSeq(prefix, uid);
  const n = s.n + 1;
  try {
    localStorage.setItem(seqKey(prefix, uid), JSON.stringify({ date: s.date, n }));
  } catch {
    // ignore
  }
  return format(prefix, s.date, n);
}
