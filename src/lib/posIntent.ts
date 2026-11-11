import { useEffect, useRef } from 'react';
import { requestScreenSearch } from './screenSearch';

/** Opens the POS ready to sell to a registered customer. */
export interface PosSaleIntent {
  customerId: string;
}

const POS_INTENT_EVENT = 'mostawdaee-pos-intent';

// The POS is lazy-loaded, so a request made before it mounts is held here and consumed on mount.
let pending: PosSaleIntent | null = null;

export function requestPosSale(intent: PosSaleIntent): void {
  pending = intent;
  window.dispatchEvent(new CustomEvent<PosSaleIntent>(POS_INTENT_EVENT, { detail: intent }));
  window.dispatchEvent(new CustomEvent('change-screen', { detail: 'pos' }));
}

export function usePosSaleIntent(apply: (intent: PosSaleIntent) => void): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (pending) {
      const intent = pending;
      pending = null;
      applyRef.current(intent);
    }
    const onIntent = (event: Event) => {
      const intent = (event as CustomEvent<PosSaleIntent>).detail;
      if (!intent?.customerId) return;
      pending = null;
      applyRef.current(intent);
    };
    window.addEventListener(POS_INTENT_EVENT, onIntent);
    return () => window.removeEventListener(POS_INTENT_EVENT, onIntent);
  }, []);
}

/** Opens the customer's statement on the Customers screen. */
export function openCustomerStatement(customerId: string, customerName: string): void {
  requestScreenSearch({ screen: 'customers', query: customerName, recordId: customerId });
  window.dispatchEvent(new CustomEvent('change-screen', { detail: 'customers' }));
}
