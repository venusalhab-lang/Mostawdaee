import { beforeAll, describe, expect, it } from 'vitest';
import { SQL_FILES, createSqlHarness, type SqlHarness } from './sqlHarness';

const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '33333333-3333-3333-3333-333333333333';
let h: SqlHarness;

const saveInvoice = (id: string, data: Record<string, unknown>) =>
  h.as(OWNER, `SELECT public.merchant_commit('[]'::jsonb, $1::jsonb)`, [
    JSON.stringify([{ op: 'set', collection: 'invoices', id, data }]),
  ]);
const deleteInvoice = (id: string) =>
  h.as(OWNER, `SELECT public.merchant_commit('[]'::jsonb, $1::jsonb)`, [
    JSON.stringify([{ op: 'delete', collection: 'invoices', id }]),
  ]);
const claim = (invoice: string) =>
  h.admin<{ claim_uuid: string; claim_icv: string; claim_attempts: number }>(
    `SELECT * FROM public.einvoice_claim($1, $2, $3, 'invoice', $1)`, [OWNER, invoice, `N-${invoice}`]);
const record = (invoice: string, status: string) =>
  h.admin(`SELECT public.einvoice_record($1, $2, $3, '011', 109, '<Invoice/>', '{}'::jsonb, 'QR', '1', NULL)`, [OWNER, invoice, status]);

beforeAll(async () => {
  h = await createSqlHarness(SQL_FILES);
  await h.addUser(OWNER, 'owner@shop.com');
  await h.addUser(OTHER, 'other@shop.com');
  await h.setSubscription(OWNER, 'active', '2099-01-01T00:00:00Z');
  await saveInvoice('a', { type: 'sale', totalAmount: 109 });
  await saveInvoice('b', { type: 'sale', totalAmount: 50 });
}, 60_000);

describe('einvoice_claim / einvoice_record', () => {
  it('numbers invoices 1, 2, ... and refuses a second sender while one is sending', async () => {
    const [first] = await claim('a');
    expect(Number(first.claim_icv)).toBe(1);
    await expect(claim('a')).rejects.toThrow(/EINVOICE_IN_PROGRESS/);
    const [second] = await claim('b');
    expect(Number(second.claim_icv)).toBe(2);
  });

  it('keeps the same UUID and counter on a resend after a failure', async () => {
    const [before] = await h.admin<{ uuid: string }>(`SELECT uuid FROM public.einvoice_submissions WHERE invoice_id = 'b'`);
    await record('b', 'failed');
    const [again] = await claim('b');
    expect(again.claim_uuid).toBe(before.uuid);
    expect(Number(again.claim_icv)).toBe(2);
    expect(again.claim_attempts).toBe(2);
    await record('b', 'rejected');
    await expect(record('b', 'accepted')).rejects.toThrow(/EINVOICE_NOT_CLAIMED/);
  });

  it('locks an accepted invoice against edits and deletion, but not an identical re-save', async () => {
    await record('a', 'accepted');
    await expect(claim('a')).rejects.toThrow(/EINVOICE_ALREADY_ACCEPTED/);
    await expect(deleteInvoice('a')).rejects.toThrow(/einvoice locked/);
    await expect(saveInvoice('a', { type: 'sale', totalAmount: 1 })).rejects.toThrow(/einvoice locked/);
    await expect(saveInvoice('a', { type: 'sale', totalAmount: 109, actorId: OWNER })).resolves.toBeDefined();
    await expect(deleteInvoice('b')).resolves.toBeDefined();
  });

  it('still lets a return record the quantities it took back on an accepted sale', async () => {
    await expect(saveInvoice('a', { type: 'sale', totalAmount: 109, actorId: OWNER, returnedQty: [1] })).resolves.toBeDefined();
    await expect(saveInvoice('a', { type: 'sale', totalAmount: 50, actorId: OWNER, returnedQty: [1] })).rejects.toThrow(/einvoice locked/);
  });
});

describe('access', () => {
  it('lets the store read statuses but not the stored XML, and nobody else', async () => {
    const rows = await h.as<{ invoice_id: string; status: string }>(OWNER,
      `SELECT invoice_id, status, qr FROM public.einvoice_submissions ORDER BY icv`);
    expect(rows.map((r) => [r.invoice_id, r.status])).toEqual([['a', 'accepted'], ['b', 'rejected']]);
    await expect(h.as(OWNER, `SELECT request_xml FROM public.einvoice_submissions`)).rejects.toThrow(/permission denied/);
    expect(await h.as(OTHER, `SELECT invoice_id FROM public.einvoice_submissions`)).toEqual([]);
  });

  it('keeps the linking credentials and the claim functions server-only', async () => {
    await expect(h.as(OWNER, `SELECT client_id FROM public.einvoice_settings`)).rejects.toThrow(/permission denied/);
    await expect(h.as(OWNER, `SELECT * FROM public.einvoice_claim($1, 'x', 'x', 'invoice', $1)`, [OWNER])).rejects.toThrow(/permission denied/);
    await expect(h.as(OWNER, `INSERT INTO public.einvoice_submissions (owner_id, invoice_id, invoice_number, icv, status)
      VALUES ($1, 'z', 'z', 9, 'accepted')`, [OWNER])).rejects.toThrow(/permission denied/);
  });
});
