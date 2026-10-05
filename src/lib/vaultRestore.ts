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

/** Shown when a restore kept the live vault because it is newer than the backup. */
export function vaultRestoreMessage(error: { code?: string } | null | undefined, isRtl: boolean): string | null {
  if (error?.code !== 'vault-newer') return null;
  return isRtl
    ? 'أُعيدت البيانات التي سبقت الخزنة، وبقي رصيد الخزنة كما هو لأن حركات أحدث من هذه النسخة سُجّلت بعده.'
    : 'Earlier data was restored. The vault balance was kept because newer movements exist than this backup.';
}
