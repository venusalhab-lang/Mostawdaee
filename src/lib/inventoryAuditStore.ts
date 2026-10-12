import type { InventoryAudit, InventoryAuditLine, InventoryAuditStatus } from '../types';
import { storeOwnerId } from './workspace';
import { auditDifference } from './inventoryAudit';
import { getSupabaseClient } from '../services/supabase';

export interface StoredInventoryAudit {
  audit: InventoryAudit;
  lines: InventoryAuditLine[];
}

export interface CloudSaveResult {
  cloud: boolean;
  reason?: 'no_session' | 'schema_missing' | 'failed';
  message?: string;
  missingProducts?: string[];
}

const storageKey = (userId: string) => `mustawdae_inventory_audits_v1_${userId || 'guest'}`;

export function readLocalAudits(userId: string): StoredInventoryAudit[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredInventoryAudit[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeLocalAudits(userId: string, audits: StoredInventoryAudit[]) {
  localStorage.setItem(storageKey(userId), JSON.stringify(audits));
}

export function upsertLocalAudit(userId: string, stored: StoredInventoryAudit) {
  const current = readLocalAudits(userId).filter((row) => row.audit.id !== stored.audit.id);
  writeLocalAudits(userId, [stored, ...current]);
}

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code || '';
  const message = (error.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42883' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    message.includes('schema cache') ||
    message.includes('apply_inventory_audit') ||
    message.includes('inventory_audits')
  );
}

function mapAudit(row: Record<string, unknown>): InventoryAudit {
  return {
    id: String(row.id),
    auditNumber: String(row.audit_number || ''),
    status: (row.status === 'completed' ? 'completed' : 'draft') as InventoryAuditStatus,
    notes: String(row.notes || ''),
    createdAt: String(row.created_at || new Date().toISOString()),
    createdBy: String(row.created_by || ''),
  };
}

function mapLine(row: Record<string, unknown>, names: Map<string, InventoryAuditLine>): InventoryAuditLine {
  const productId = String(row.product_id);
  const known = names.get(`${row.audit_id}:${productId}`);
  const expectedQty = Number(row.expected_qty) || 0;
  const actualQty = Number(row.actual_qty) || 0;
  return {
    id: String(row.id),
    auditId: String(row.audit_id),
    productId,
    productName: known?.productName || productId,
    sku: known?.sku || '',
    currency: known?.currency || '',
    expectedQty,
    actualQty,
    difference: Number(row.difference ?? auditDifference(expectedQty, actualQty)) || 0,
    unitCost: Number(row.unit_cost) || 0,
  };
}

async function sessionUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user?.id || null;
}

export async function loadAuditArchive(userId: string): Promise<StoredInventoryAudit[]> {
  const local = readLocalAudits(userId);
  const client = getSupabaseClient();
  const uid = await sessionUserId();
  if (!client || !uid) return local;

  const { data: audits, error } = await client
    .from('inventory_audits')
    .select('id, audit_number, status, notes, created_at, created_by')
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingSchema(error)) return local;
    throw new Error(error.message);
  }

  const ids = (audits || []).map((row) => row.id);
  let itemRows: Record<string, unknown>[] = [];
  if (ids.length) {
    const { data: items, error: itemError } = await client
      .from('inventory_audit_items')
      .select('id, audit_id, product_id, expected_qty, actual_qty, difference, unit_cost')
      .in('audit_id', ids);
    if (itemError) {
      if (isMissingSchema(itemError)) return local;
      throw new Error(itemError.message);
    }
    itemRows = (items || []) as Record<string, unknown>[];
  }

  const localNames = new Map<string, InventoryAuditLine>();
  for (const stored of local) {
    for (const line of stored.lines) localNames.set(`${line.auditId}:${line.productId}`, line);
  }

  const appliedHere = new Set(local.filter((row) => row.audit.status === 'completed').map((row) => row.audit.id));
  return (audits || []).map((row) => {
    const mapped = mapAudit(row as Record<string, unknown>);
    // Stock was already changed from this device; a draft on the server must not be offered for a second apply.
    const audit = appliedHere.has(mapped.id) ? { ...mapped, status: 'completed' as const } : mapped;
    const lines = itemRows
      .filter((item) => String(item.audit_id) === audit.id)
      .map((item) => mapLine(item, localNames));
    return { audit, lines };
  });
}

export async function saveAuditDraft(
  userId: string,
  audit: InventoryAudit,
  lines: InventoryAuditLine[],
): Promise<CloudSaveResult> {
  const draft: InventoryAudit = { ...audit, status: 'draft' };
  upsertLocalAudit(userId, { audit: draft, lines });

  const client = getSupabaseClient();
  const uid = await sessionUserId();
  if (!client || !uid) return { cloud: false, reason: 'no_session' };

  const { error } = await client.from('inventory_audits').upsert(
    {
      id: draft.id,
      user_id: await storeOwnerId(uid),
      audit_number: draft.auditNumber,
      status: 'draft',
      notes: draft.notes || '',
      created_at: draft.createdAt,
      created_by: uid,
    },
    { onConflict: 'id' },
  );
  if (error) {
    if (isMissingSchema(error)) return { cloud: false, reason: 'schema_missing', message: error.message };
    return { cloud: false, reason: 'failed', message: error.message };
  }

  const { error: deleteError } = await client.from('inventory_audit_items').delete().eq('audit_id', draft.id);
  if (deleteError && !isMissingSchema(deleteError)) {
    return { cloud: false, reason: 'failed', message: deleteError.message };
  }

  if (lines.length) {
    const { error: insertError } = await client.from('inventory_audit_items').insert(
      lines.map((line) => ({
        id: line.id,
        audit_id: draft.id,
        product_id: line.productId,
        expected_qty: line.expectedQty,
        actual_qty: line.actualQty,
        unit_cost: line.unitCost,
      })),
    );
    if (insertError) {
      if (isMissingSchema(insertError)) return { cloud: false, reason: 'schema_missing', message: insertError.message };
      return { cloud: false, reason: 'failed', message: insertError.message };
    }
  }
  return { cloud: true };
}

export async function completeAuditCloud(auditId: string): Promise<CloudSaveResult> {
  const client = getSupabaseClient();
  const uid = await sessionUserId();
  if (!client || !uid) return { cloud: false, reason: 'no_session' };

  const { data, error } = await client.rpc('apply_inventory_audit', { p_audit_id: auditId });
  if (error) {
    if (isMissingSchema(error)) return { cloud: false, reason: 'schema_missing', message: error.message };
    return { cloud: false, reason: 'failed', message: error.message };
  }
  const missing = Array.isArray((data as { missing_products?: unknown })?.missing_products)
    ? ((data as { missing_products: string[] }).missing_products)
    : [];
  return { cloud: true, missingProducts: missing };
}

export async function deleteAuditDraft(userId: string, auditId: string): Promise<CloudSaveResult> {
  const next = readLocalAudits(userId).filter((row) => row.audit.id !== auditId);
  writeLocalAudits(userId, next);
  const client = getSupabaseClient();
  const uid = await sessionUserId();
  if (!client || !uid) return { cloud: false, reason: 'no_session' };
  const { error } = await client.from('inventory_audits').delete().eq('id', auditId).eq('status', 'draft');
  if (error) {
    if (isMissingSchema(error)) return { cloud: false, reason: 'schema_missing', message: error.message };
    return { cloud: false, reason: 'failed', message: error.message };
  }
  return { cloud: true };
}

export function markLocalCompleted(userId: string, auditId: string) {
  const next = readLocalAudits(userId).map((row) =>
    row.audit.id === auditId ? { ...row, audit: { ...row.audit, status: 'completed' as const } } : row,
  );
  writeLocalAudits(userId, next);
}
