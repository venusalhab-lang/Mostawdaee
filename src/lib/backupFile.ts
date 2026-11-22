import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Web: Blob download. Native: write to cache then open the system share sheet (Files / Drive / WhatsApp). */
export async function exportBackupFile(content: string, filename: string): Promise<void> {
  if (!content) {
    throw Object.assign(new Error('Backup file is empty'), { code: 'backup-empty' });
  }
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    const uri = written.uri;
    if (!uri) {
      throw Object.assign(new Error('Could not write the backup file'), { code: 'backup-write-failed' });
    }
    await Share.share({
      title: filename,
      files: [uri],
      dialogTitle: filename,
    });
    return;
  }

  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Stock CSV / report downloads — same native share path when on device. */
export async function exportTextFile(content: string, filename: string, mimeType: string): Promise<void> {
  if (!content) {
    throw Object.assign(new Error('File is empty'), { code: 'backup-empty' });
  }
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    const uri = written.uri;
    if (!uri) {
      throw Object.assign(new Error('Could not write the file'), { code: 'backup-write-failed' });
    }
    await Share.share({
      title: filename,
      files: [uri],
      dialogTitle: filename,
    });
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
