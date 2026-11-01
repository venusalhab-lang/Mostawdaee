/** Canonical download/upload prefix. Older files used `mustawdae_`. */
export const BACKUP_FILE_PREFIX = 'mostawdaee_backup';

/** Drive list matches current and legacy Mostawdaee backup filenames. */
export const DRIVE_BACKUP_QUERY =
  "(name contains 'mostawdaee_backup' or name contains 'mustawdae_backup' or name contains 'mustawdae_local_backup') and trashed = false";

export function backupDownloadName(now = new Date()): string {
  return `${BACKUP_FILE_PREFIX}_${now.toISOString().slice(0, 10)}.json`;
}

export function backupDriveName(now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');
  return `${BACKUP_FILE_PREFIX}_${date}_${time}.json`;
}
