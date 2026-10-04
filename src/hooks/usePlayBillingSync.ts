import { useEffect, useRef } from 'react';
import { initializeBilling, isMobileDevice } from '../services/billing';
import { activatePaidSubscription, syncPaidSubscription } from '../lib/activateSubscription';

/**
 * Once per signed-in session: registers Google Play so unfinished purchases are re-delivered and
 * activated, and asks the server to re-read renewals and refunds from Google.
 */
export function usePlayBillingSync(userId: string | null | undefined, onChanged: () => Promise<void> | void) {
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    if (isMobileDevice()) {
      initializeBilling(
        async (tx) => {
          await activatePaidSubscription(tx);
          if (!cancelled) await onChangedRef.current();
        },
        (message) => console.warn('[Billing]', message),
      );
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    syncPaidSubscription()
      .then(() => { if (!cancelled) return onChangedRef.current(); })
      .catch((error) => console.warn('[Billing] Subscription sync skipped:', error?.message || error));

    return () => { cancelled = true; };
  }, [userId]);
}
