import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_FILE_PREFIX,
  DRIVE_BACKUP_QUERY,
  assertCanRestore,
  backupDownloadName,
  backupDriveName,
  restoreBlockedMessage,
} from '../backupIo';
import { enqueueInvoice, writeQueue } from '../offlineQueue';
import type { Invoice } from '../../types';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}

const sale = (): Invoice => ({
  id: 'inv-1',
  invoiceNumber: 'POS-1',
  date: 1,
  type: 'sale',
  currency: 'JOD',
  items: [{ productId: 'p1', description: 'شاي', quantity: 2, unitPrice: 1, total: 2 }],
  subtotal: 2,
  taxAmount: 0,
  totalAmount: 2,
  paymentMethod: 'cash',
});

describe('backupIo', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = new MemoryStorage();
  });

  it('names local and Drive files with the canonical prefix', () => {
    const at = new Date('2026-03-15T08:09:10');
    expect(backupDownloadName(at)).toBe(`${BACKUP_FILE_PREFIX}_2026-03-15.json`);
    expect(backupDriveName(at).startsWith(`${BACKUP_FILE_PREFIX}_2026-03-15_`)).toBe(true);
    expect(backupDriveName(at).endsWith('.json')).toBe(true);
  });

  it('lists both current and legacy Drive filenames', () => {
    expect(DRIVE_BACKUP_QUERY).toContain('mostawdaee_backup');
    expect(DRIVE_BACKUP_QUERY).toContain('mustawdae_backup');
    expect(DRIVE_BACKUP_QUERY).toContain('mustawdae_local_backup');
    expect(DRIVE_BACKUP_QUERY).toContain('trashed = false');
  });

  it('blocks restore while offline sales are waiting', () => {
    expect(enqueueInvoice('owner-1', sale(), 'store-1')).toBe(true);
    expect(() => assertCanRestore('owner-1')).toThrowError(/waiting to sync/);
    try {
      assertCanRestore('owner-1');
    } catch (error: any) {
      expect(error.code).toBe('offline-queue-pending');
      expect(error.pending).toBe(1);
      expect(restoreBlockedMessage(error, true)).toMatch(/لم تُرسل/);
      expect(restoreBlockedMessage(error, false)).toMatch(/have not been sent/);
    }
  });

  it('allows restore when the queue is empty and keeps vault/backup-older messages', () => {
    writeQueue('owner-1', []);
    expect(() => assertCanRestore('owner-1')).not.toThrow();
    expect(restoreBlockedMessage({ code: 'backup-older', newer: 1 }, false)).toMatch(/not restored/i);
    expect(restoreBlockedMessage({ code: 'vault-newer' }, true)).toMatch(/لم تُستعد/);
    expect(restoreBlockedMessage({ code: 'vault-newer' }, false)).toMatch(/Nothing was changed/i);
    expect(restoreBlockedMessage({ code: 'vault-newer' }, true)).not.toMatch(/أُعيدت البيانات/);
    expect(restoreBlockedMessage({ code: 'other' }, false)).toBeNull();
    expect(restoreBlockedMessage({ code: 'replace-undeletable', kind: 'shift' }, true)).toMatch(/وردية مغلقة/);
    expect(restoreBlockedMessage({ code: 'replace-undeletable', kind: 'cheque' }, false)).toMatch(/finalized cheque/i);
  });
});
