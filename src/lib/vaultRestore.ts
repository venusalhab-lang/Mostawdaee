import { doc, runTransaction } from './supabaseDocs';

/**
 * Replaces the vault with a backup only after reading the live row.
 * The database refuses the write when the backup is older than sales already recorded.
 */
export async function restoreVaultBalance(db: unknown, uid: string, vault: object) {
  const ref = doc(db, 'users', uid, 'settings', 'vault');
  await runTransaction(db, async (tx) => {
    await tx.get(ref);
    tx.set(ref, vault);
  });
}

/** Shown when a restore was refused, or kept the live vault, because the store is newer than the backup. */
export function vaultRestoreMessage(error: { code?: string; newer?: number } | null | undefined, isRtl: boolean): string | null {
  if (error?.code === 'backup-older') {
    const when = error.newer ? new Date(error.newer).toLocaleString(isRtl ? 'ar' : 'en-US') : '';
    return isRtl
      ? `لم تُستعد النسخة: سُجّلت بعدها عمليات بيع أو دفع أو حركات خزنة${when ? ` (آخرها ${when})` : ''}. استعادتها كانت ستعيد كميات بضاعة بيعت فعلاً. لم يتغيّر شيء.`
      : `The backup was not restored: sales, payments or vault movements were recorded after it${when ? ` (latest ${when})` : ''}. Restoring it would bring back goods that were already sold. Nothing was changed.`;
  }
  if (error?.code !== 'vault-newer') return null;
  return isRtl
    ? 'أُعيدت البيانات التي سبقت الخزنة، وبقي رصيد الخزنة كما هو لأن حركات أحدث من هذه النسخة سُجّلت بعدها.'
    : 'Earlier data was restored. The vault balance was kept because newer movements exist than this backup.';
}
