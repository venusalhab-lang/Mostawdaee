import { useCallback, useEffect, useRef, useState } from 'react';
import { db, doc, onSnapshot, setDoc } from '../lib/supabaseDocs';
import { EMPTY_ACCOUNTING_CONFIG, normalizeAccountingConfig, type AccountingConfig } from '../lib/accounting';

/**
 * The owner's classifications and opening balances (settings/accounting). Only the owner may write settings documents,
 * so a manager's save is refused by merchant_commit. Without a signed-in store nothing is saved.
 */
export function useAccountingConfig(userId: string | null) {
  const signedIn = !!userId;
  const [config, setConfig] = useState<AccountingConfig>(EMPTY_ACCOUNTING_CONFIG);
  const [loading, setLoading] = useState(signedIn);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(config);
  latest.current = config;

  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(db, 'users', userId || '', 'settings', 'accounting'),
      (snap: any) => {
        setConfig(snap.exists() ? normalizeAccountingConfig(snap.data()) : EMPTY_ACCOUNTING_CONFIG);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
  }, [signedIn, userId]);

  /** Applies `change` to the latest config and saves it. Throws when nothing could be saved; the screen is then unchanged. */
  const update = useCallback(async (change: (current: AccountingConfig) => AccountingConfig) => {
    if (!signedIn) throw Object.assign(new Error('Not signed in'), { code: 'guest' });
    const previous = latest.current;
    const next = { ...change(previous), updatedAt: Date.now() };
    setConfig(next);
    try {
      await setDoc(doc(db, 'users', userId || '', 'settings', 'accounting'), JSON.parse(JSON.stringify(next)));
    } catch (err) {
      setConfig(previous);
      throw err;
    }
  }, [signedIn, userId]);

  return { config, loading, error, update };
}
