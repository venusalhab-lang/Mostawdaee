import type { Cheque, ChequeInput, ChequeStatus, Currency } from '../types';
import { storeOwnerId } from './workspace';
import { getSupabaseClient } from '../services/supabase';
import { canTransition, validateChequeInput } from './cheques';
import { roundMoney } from './exchangeRates';

export type ChequeStoreErrorCode =
  | 'schema_missing'
  | 'no_session'
  | 'duplicate'
  | 'invalid'
  | 'invalid_transition'
  | 'not_found'
  | 'failed';

export class ChequeStoreError extends Error {
  constructor(public code: ChequeStoreErrorCode, message: string = code) {
    super(message);
  }
}

const GUEST_KEY = 'mustawdae_cheques_v1_guest';
const COLUMNS =
  'id, cheque_number, bank_name, amount, currency, due_date, type, status, drawer_name, contact_type, contact_id, contact_name, endorsed_to, notes, status_changed_at, created_at';

function fromRow(row: Record<string, any>): Cheque {
  return {
    id: String(row.id),
    chequeNumber: String(row.cheque_number || ''),
    bankName: String(row.bank_name || ''),
    amount: Number(row.amount) || 0,
    currency: String(row.currency || 'ILS') as Currency,
    dueDate: String(row.due_date || '').slice(0, 10),
    type: row.type === 'outgoing' ? 'outgoing' : 'incoming',
    status: (row.status || 'pending') as ChequeStatus,
    drawerName: String(row.drawer_name || ''),
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
  return {
    cheque_number: input.chequeNumber.trim(),
    bank_name: input.bankName.trim(),
    amount: roundMoney(input.amount, input.currency),
    currency: input.currency,
    due_date: input.dueDate,
    type: input.type,
    drawer_name: input.drawerName.trim(),
    contact_type: input.contactType,
    contact_id: input.contactType === 'customer' ? input.contactId : null,
    contact_name: input.contactName.trim(),
    notes: input.notes.trim(),
  };
}

function mapError(error: { code?: string; message?: string; details?: string }): ChequeStoreError {
  const text = `${error.message || ''} ${error.details || ''}`;
  if (error.code === 'PGRST205' || error.code === '42P01' || (/cheques/.test(text) && /schema cache|does not exist/.test(text))) {
    return new ChequeStoreError('schema_missing', text);
  }
  if (error.code === '23505') return new ChequeStoreError('duplicate', text);
  if (/invalid cheque status change|locked after/i.test(text)) return new ChequeStoreError('invalid_transition', text);
  if (error.code === '23514' || error.code === '22P02' || error.code === '22007') return new ChequeStoreError('invalid', text);
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
  localStorage.setItem(GUEST_KEY, JSON.stringify(rows));
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

export async function changeChequeStatus(
  userId: string,
  cheque: Cheque,
  next: ChequeStatus,
  endorsedTo = '',
): Promise<Cheque> {
  if (!canTransition(cheque.type, cheque.status, next)) throw new ChequeStoreError('invalid_transition');
  if (next === 'endorsed' && !endorsedTo.trim()) throw new ChequeStoreError('invalid');
  const patch = {
    status: next,
    endorsed_to: next === 'endorsed' ? endorsedTo.trim() : cheque.endorsedTo,
  };

  if ((await mode(userId)) === 'guest') {
    const rows = readGuest();
    const index = rows.findIndex((row) => row.id === cheque.id);
    if (index < 0) throw new ChequeStoreError('not_found');
    if (rows[index].status !== cheque.status) throw new ChequeStoreError('invalid_transition');
    const updated: Cheque = { ...rows[index], status: next, endorsedTo: patch.endorsed_to, statusChangedAt: new Date().toISOString() };
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
