import { beforeAll, describe, expect, it } from 'vitest';
import { createSqlHarness, type SqlHarness } from './sqlHarness';

const OWNER = '11111111-1111-1111-1111-111111111111';
const AUDIT = '22222222-2222-2222-2222-222222222222';
let h: SqlHarness;

beforeAll(async () => {
  h = await createSqlHarness();
  await h.addUser(OWNER, 'owner@shop.com');
  await h.setSubscription(OWNER, 'active', '2099-01-01T00:00:00Z');
  await h.as(OWNER, `INSERT INTO public.inventory_audits (id, audit_number) VALUES ($1, 'JRD-1')`, [AUDIT]);
  await h.as(OWNER, `INSERT INTO public.inventory_audit_items (audit_id, product_id, expected_qty, actual_qty) VALUES
    ($1, 'p1', 10, 8), ($1, 'p2', 5, 5)`, [AUDIT]);
}, 60_000);

describe('apply_inventory_audit', () => {
  it('closes the stocktake without needing a products table', async () => {
    const [row] = await h.as<{ r: any }>(OWNER, `SELECT public.apply_inventory_audit($1) AS r`, [AUDIT]);
    expect(row.r).toMatchObject({ status: 'completed', adjusted: 1, unchanged: 1, missing_products: [] });
    const [audit] = await h.admin<{ status: string }>(`SELECT status FROM public.inventory_audits WHERE id = $1`, [AUDIT]);
    expect(audit.status).toBe('completed');
  });

  it('refuses to apply the same stocktake twice', async () => {
    await expect(h.as(OWNER, `SELECT public.apply_inventory_audit($1)`, [AUDIT])).rejects.toThrow(/AUDIT_ALREADY_COMPLETED/);
  });
});
