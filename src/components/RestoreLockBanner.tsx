import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useFirebase } from './FirebaseProvider';
import {
  RESTORE_LOCK_EVENT,
  readIncompleteRestore,
  refreshIncompleteRestore,
  type IncompleteRestore,
} from '../lib/restoreGuard';
import { sounds } from '../lib/sounds';

interface RestoreLockBannerProps {
  language: 'ar' | 'en';
  onOpenBackup: () => void;
}

/** Owner-only: store is locked until a finished restore clears the server flag. */
export default function RestoreLockBanner({ language, onOpenBackup }: RestoreLockBannerProps) {
  const { user, isStoreOwner } = useFirebase();
  const isRtl = language === 'ar';
  const [flag, setFlag] = useState<IncompleteRestore | null>(null);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || !isStoreOwner) {
      setFlag(null);
      return;
    }
    let cancelled = false;
    const pull = () => {
      setFlag(readIncompleteRestore(uid));
      void refreshIncompleteRestore(uid).then((next) => {
        if (!cancelled) setFlag(next);
      }, () => {
        if (!cancelled) setFlag(readIncompleteRestore(uid));
      });
    };
    pull();
    const onLocal = (event: Event) => {
      const detailUid = (event as CustomEvent<{ uid?: string }>).detail?.uid;
      if (!detailUid || detailUid === uid) setFlag(readIncompleteRestore(uid));
    };
    window.addEventListener(RESTORE_LOCK_EVENT, onLocal);
    window.addEventListener('focus', pull);
    window.addEventListener('online', pull);
    return () => {
      cancelled = true;
      window.removeEventListener(RESTORE_LOCK_EVENT, onLocal);
      window.removeEventListener('focus', pull);
      window.removeEventListener('online', pull);
    };
  }, [user?.uid, isStoreOwner]);

  if (!isStoreOwner || !flag) return null;

  const when = Number.isFinite(flag.at)
    ? new Date(flag.at).toLocaleString(isRtl ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : '';

  return (
    <div
      role="alert"
      className="mx-3 mt-2 mb-0 rounded-xl border border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-50 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" aria-hidden />
        <p className="text-xs sm:text-sm font-semibold leading-snug font-arabic">
          {isRtl
            ? `توقفت استعادة سابقة${when ? ` (${when})` : ''}. المبيعات والتغييرات المالية موقوفة حتى تكتمل الاستعادة من ملف سليم.`
            : `A previous restore stopped${when ? ` (${when})` : ''}. Sales and money changes stay blocked until you finish restoring from a good file.`}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          sounds.playClick();
          onOpenBackup();
        }}
        className="shrink-0 self-stretch sm:self-center rounded-lg bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold px-3 py-2 font-arabic"
      >
        {isRtl ? 'إعادة الاستعادة من ملف' : 'Restore from a file'}
      </button>
    </div>
  );
}
