import type { Cheque, ChequeInput, ChequeStatus, Currency } from '../types';
import { storeOwnerId } from './workspace';
import { getSupabaseClient } from '../services/supabase';
import { canTransition, chequeRestorePath, validateChequeInput } from './cheques';
import { roundMoney } from './exchangeRates';

export type ChequeStoreErrorCode =
  | 'schema_missing'
  | 'no_session'
  | 'duplicate'
  | 'invalid'
  | 'invalid_transition'
  | 'cheque-already-final'
  | 'not_found'
  | 'storage_full'
  | 'failed';

export class ChequeStoreError extends Error {
  constructor(public code: ChequeStoreErrorCode, message: string = code) {
    super(message);
  }
}

const GUEST_KEY = 'mustawdae_cheques_v1_guest';
const COLUMNS =
  'id, cheque_number, bank_name, amount, currency, due_date, type, status, drawer_name, payee_or_drawer, contact_type, contact_id, contact_name, endorsed_to, notes, status_changed_at, created_at';

function fromRow(row: Record<string, any>): Cheque {
  // Production once had payee_or_drawer before drawer_name; keep reading both.
  const drawer = String(row.drawer_name || row.payee_or_drawer || '');
  return {
    id: String(row.id),
    chequeNumber: String(row.cheque_number || ''),
    bankName: String(row.bank_name || ''),
    amount: Number(row.amount) || 0,
    currency: String(row.currency || 'ILS') as Currency,
    dueDate: String(row.due_date || '').slice(0, 10),
    type: row.type === 'outgoing' ? 'outgoing' : 'incoming',
    status: (row.status || 'pending') as ChequeStatus,
    drawerName: drawer,
    contactType: row.contact_type === 'customer' || row.contact_type === 'supplier' ? row.contact_type : null,
    contactId: row.contact_id ? String(row.contact_id) : null,
    contactName: String(row.contact_name || ''),
    endorsedTo: String(row.endorsed_to || ''),
    notes: String(row.notes || ''),
    statusChangedAt: row.status_changed_at ? String(row.status_changed_at) : null,
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

function toRow(input: ChequeInput) {
  const drawer = input.drawerName.trim();
  // Legacy NOT NULL columns (issue_date, payee_or_drawer) still exist on some stores.
  return {
    cheque_number: input.chequeNumber.trim(),
    bank_name: input.bankName.trim(),
    amount: roundMoney(input.amount, input.currency),
    currency: input.currency,
    due_date: input.dueDate,
    issue_date: input.dueDate,
    type: input.type,
    drawer_name: drawer,
    payee_or_drawer: drawer || input.contactName.trim() || '—',
    contact_type: input.contactType,
    contact_id: input.contactType === 'customer' ? input.contactId : null,
    contact_name: input.contactName.trim(),
    notes: input.notes.trim(),
  };
}

function mapError(error: { code?: string; message?: string; details?: string }): ChequeStoreError {
  const text = `${error.message || ''} ${error.details || ''}`;
  if (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    (/cheques/.test(text) && /schema cache|does not exist/.test(text)) ||
    (/permission denied for (table )?cheques/i.test(text) && /GRANT/i.test(text))
  ) {
    return new ChequeStoreError('schema_missing', text);
  }
  if (error.code === '23505') return new ChequeStoreError('duplicate', text);
  if (/invalid cheque status change|locked after/i.test(text)) return new ChequeStoreError('invalid_transition', text);
  if (error.code === '23514' || error.code === '22P02' || error.code === '22007') return new ChequeStoreError('invalid', text);
  // Missing column on a half-migrated cheques table — treat as register not ready.
  if (error.code === 'PGRST204' || /Could not find the '.+' column of 'cheques'/i.test(text)) {
    return new ChequeStoreError('schema_missing', text);
  }
  if (error.code === '42501' || /JWT|not authenticated/i.test(text)) return new ChequeStoreError('no_session', text);
  return new ChequeStoreError('failed', text);
}

async function cloudUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user?.id || null;
}

/** Signed-in accounts always use Supabase; only the no-account trial keeps cheques on this device. */
async function mode(userId: string): Promise<'cloud' | 'guest'> {
  const uid = await cloudUserId();
  if (uid && uid === userId) return 'cloud';
  if (userId === 'guest') return 'guest';
  throw new ChequeStoreError('no_session');
}

function readGuest(): Cheque[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGuest(rows: Cheque[]) {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(rows));
  } catch {
    throw new ChequeStoreError('storage_full');
  }
}

export async function loadCheques(userId: string): Promise<Cheque[]> {
  if ((await mode(userId)) === 'guest') return readGuest();
  const { data, error } = await getSupabaseClient()!
    .from('cheques')
    .select(COLUMNS)
    .order('due_date', { ascending: true });
  if (error) throw mapError(error);
  return (data || []).map(fromRow);
}

/** Backup export: empty register when cheques cloud is unavailable; other errors still surface. */
export async function loadChequesForBackup(userId: string | undefined | null): Promise<Cheque[]> {
  if (!userId) return [];
  try {
    return await loadCheques(userId);
  } catch (error) {
    if (error instanceof ChequeStoreError && (error.code === 'schema_missing' || error.code === 'no_session')) return [];
    throw error;
  }
}

/**
 * Restore LiveBooks: fail closed when the session is missing so an empty register cannot hide newer cheques.
 * schema_missing still returns [] (store never had the cheques table).
 */
export async function loadChequesForRestore(userId: string): Promise<Cheque[]> {
  try {
    return await loadCheques(userId);
  } catch (error) {
    if (error instanceof ChequeStoreError && error.code === 'schema_missing') return [];
    throw error;
  }
}

export async function createCheque(userId: string, input: ChequeInput): Promise<Cheque> {
  if (validateChequeInput(input)) throw new ChequeStoreError('invalid');
  if ((await mode(userId)) === 'guest') {
    const rows = readGuest();
    const key = (c: { type: string; bankName: string; chequeNumber: string }) =>
      `${c.type}|${c.bankName.trim().toLowerCase()}|${c.chequeNumber.trim()}`;
    if (rows.some((row) => key(row) === key(input))) throw new ChequeStoreError('duplicate');
    const cheque = fromRow({ ...toRow(input), id: crypto.randomUUID(), status: 'pending', created_at: new Date().toISOString() });
    writeGuest([...rows, cheque]);
    return cheque;
  }
  const { data, error } = await getSupabaseClient()!
    .from('cheques')
    .insert({ ...toRow(input), user_id: await storeOwnerId(userId), status: 'pending' })
    .select(COLUMNS)
    .single();
  if (error) throw mapError(error);
  return fromRow(data);
}

/** Corrects a cheque entered with a mistake; only possible while it is still pending (the server locks it afterwards). */
export async function updateCheque(userId: string, cheque: Cheque, input: ChequeInput): Promise<Cheque> {
  if (cheque.status !== 'pending') throw new ChequeStoreError('invalid_transition');
  if (input.type !== cheque.type || validateChequeInput(input)) throw new ChequeStoreError('invalid');
  const patch = toRow(input);

  if ((await mode(userId)) === 'guest') {
    const rows = readGuest();
    const index = rows.findIndex((row) => row.id === cheque.id);
    if (index < 0) throw new ChequeStoreError('not_found');
    if (rows[index].status !== 'pending') throw new ChequeStoreError('invalid_transition');
    const key = (c: { type: string; bankName: string; chequeNumber: string }) =>
      `${c.type}|${c.bankName.trim().toLowerCase()}|${c.chequeNumber.trim()}`;
    if (rows.some((row) => row.id !== cheque.id && key(row) === key(input))) throw new ChequeStoreError('duplicate');
    const updated = fromRow({ ...patch, id: cheque.id, status: 'pending', endorsed_to: '', status_changed_at: rows[index].statusChangedAt, created_at: rows[index].createdAt });
    rows[index] = updated;
    writeGuest(rows);
    return updated;
  }

  const { data, error } = await getSupabaseClient()!
    .from('cheques')
    .update(patch)
    .eq('id', cheque.id)
    .eq('status', 'pending')
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw mapError(error);
  if (!data) throw new ChequeStoreError('invalid_transition');
  return fromRow(data);
}

export async function changeChequeStatus(
  userId: string,
  cheque: Cheque,
  next: ChequeStatus,
  endorsedTo = '',
  notes: string = cheque.notes,
): Promise<Cheque> {
  if (!canTransition(cheque.type, cheque.status, next)) throw new ChequeStoreError('invalid_transition');
  if (next === 'endorsed' && !endorsedTo.trim()) throw new ChequeStoreError('invalid');
  const patch = {
    status: next,
    endorsed_to: next === 'endorsed' ? endorsedTo.trim() : cheque.endorsedTo,
    notes: notes.trim().slice(0, 1000),
  };

  if ((await mode(userId)) === 'guest') {
    const rows = readGuest();
    const index = rows.findIndex((row) => row.id === cheque.id);
    if (index < 0) throw new ChequeStoreError('not_found');
    if (rows[index].status !== cheque.status) throw new ChequeStoreError('invalid_transition');
    const updated: Cheque = { ...rows[index], status: next, endorsedTo: patch.endorsed_to, notes: patch.notes, statusChangedAt: new Date().toISOString() };
    rows[index] = updated;
    writeGuest(rows);
    return updated;
  }

  // Matching on the old status makes a second device's stale click a no-op instead of a double change.
  const { data, error } = await getSupabaseClient()!
    .from('cheques')
    .update(patch)
    .eq('id', cheque.id)
    .eq('status', cheque.status)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw mapError(error);
  if (!data) throw new ChequeStoreError('invalid_transition');
  return fromRow(data);
}

/** Only a cheque still pending can be removed, e.g. one entered by mistake. */
export async function deleteCheque(userId: string, cheque: Cheque): Promise<void> {
  if (cheque.status !== 'pending') throw new ChequeStoreError('invalid_transition');
  if ((await mode(userId)) === 'guest') {
    writeGuest(readGuest().filter((row) => !(row.id === cheque.id && row.status === 'pending')));
    return;
  }
  const { data, error } = await getSupabaseClient()!
    .from('cheques')
    .delete()
    .eq('id', cheque.id)
    .eq('status', 'pending')
    .select('id');
  if (error) throw mapError(error);
  if (!data?.length) throw new ChequeStoreError('invalid_transition');
}

const chequeKey = (c: Pick<Cheque, 'type' | 'bankName' | 'chequeNumber'>) =>
  `${c.type}|${c.bankName.trim().toLowerCase()}|${c.chequeNumber.trim()}`;

function asChequeInput(cheque: Cheque): ChequeInput {
  return {
    chequeNumber: cheque.chequeNumber,
    bankName: cheque.bankName,
    amount: cheque.amount,
    currency: cheque.currency,
    dueDate: cheque.dueDate,
    type: cheque.type,
    drawerName: cheque.drawerName,
    contactType: cheque.contactType,
    contactId: cheque.contactId,
    contactName: cheque.contactName,
    notes: cheque.notes,
  };
}

function normalizeRestoredCheque(cheque: Cheque): Cheque {
  return {
    id: String(cheque.id),
    chequeNumber: String(cheque.chequeNumber || '').trim(),
    bankName: String(cheque.bankName || '').trim(),
    amount: Number(cheque.amount) || 0,
    currency: cheque.currency,
    dueDate: String(cheque.dueDate || '').slice(0, 10),
    type: cheque.type === 'outgoing' ? 'outgoing' : 'incoming',
    status: cheque.status,
    drawerName: String(cheque.drawerName || ''),
    contactType: cheque.contactType === 'customer' || cheque.contactType === 'supplier' ? cheque.contactType : null,
    contactId: cheque.contactId ? String(cheque.contactId) : null,
    contactName: String(cheque.contactName || ''),
    endorsedTo: String(cheque.endorsedTo || ''),
    notes: String(cheque.notes || ''),
    statusChangedAt: cheque.statusChangedAt ? String(cheque.statusChangedAt) : null,
    createdAt: String(cheque.createdAt || new Date().toISOString()),
  };
}

/**
 * Writes a backup cheque through the same store the screen uses.
 * Cloud inserts always start as pending (DB trigger); status is then advanced along allowed transitions.
 * When the live row is already past what the backup can reach, the restore skips that cheque (like a closed shift).
 */
export async function restoreCheque(userId: string, raw: Cheque): Promise<void> {
  if (!raw?.id) return;
  const cheque = normalizeRestoredCheque(raw);
  const input = asChequeInput(cheque);
  if (validateChequeInput(input)) throw new ChequeStoreError('invalid');
  if (cheque.status === 'endorsed' && !cheque.endorsedTo.trim()) throw new ChequeStoreError('invalid');

  if ((await mode(userId)) === 'guest') {
    const rows = readGuest();
    const byId = rows.findIndex((row) => row.id === cheque.id);
    const byKey = rows.findIndex((row) => row.id !== cheque.id && chequeKey(row) === chequeKey(cheque));
    const live = byId >= 0 ? rows[byId] : byKey >= 0 ? rows[byKey] : null;
    if (live) {
      if (live.status === cheque.status) {
        if (live.status !== 'pending') return;
      } else {
        const path = chequeRestorePath(cheque.type, live.status, cheque.status);
        if (!path) throw new ChequeStoreError('cheque-already-final');
      }
    }
    const next = [...rows];
    if (byId >= 0) next[byId] = cheque;
    else if (byKey >= 0) next[byKey] = cheque;
    else next.push(cheque);
    writeGuest(next);
    return;
  }

  const client = getSupabaseClient()!;
  const ownerId = await storeOwnerId(userId);

  const { data: byIdRow, error: byIdErr } = await client.from('cheques').select(COLUMNS).eq('id', cheque.id).maybeSingle();
  if (byIdErr) throw mapError(byIdErr);

  let live: Cheque | null = byIdRow ? fromRow(byIdRow) : null;
  if (!live) {
    const { data: byKeyRows, error: byKeyErr } = await client
      .from('cheques')
      .select(COLUMNS)
      .eq('type', cheque.type)
      .eq('cheque_number', cheque.chequeNumber.trim());
    if (byKeyErr) throw mapError(byKeyErr);
    live = (byKeyRows || []).map(fromRow).find((row) => chequeKey(row) === chequeKey(cheque)) || null;
  }

  if (!live) {
    const { data, error } = await client
      .from('cheques')
      .insert({
        id: cheque.id,
        ...toRow(input),
        user_id: ownerId,
        status: 'pending',
      })
      .select(COLUMNS)
      .single();
    if (error) throw mapError(error);
    live = fromRow(data);
  } else if (live.status === 'pending' && cheque.status === 'pending') {
    // Refresh editable fields from the backup while still pending.
    const { error } = await client
      .from('cheques')
      .update(toRow(input))
      .eq('id', live.id)
      .eq('status', 'pending');
    if (error) throw mapError(error);
  }

  if (live.status === cheque.status) return;

  const path = chequeRestorePath(cheque.type, live.status, cheque.status);
  if (!path) {
    // Live is already finalized in a way the backup cannot undo — keep it and continue.
    throw new ChequeStoreError('cheque-already-final');
  }

  let current = live;
  for (const next of path) {
    current = await changeChequeStatus(
      userId,
      current,
      next,
      next === 'endorsed' ? cheque.endorsedTo : current.endorsedTo,
      cheque.notes,
    );
  }
}
