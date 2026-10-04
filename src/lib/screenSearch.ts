import { useEffect, useRef } from 'react';
import type { ChequeType } from '../types';

export type SearchScreen = 'inventory' | 'invoices' | 'customers' | 'employees' | 'cheques';

export interface ScreenSearchRequest {
  screen: SearchScreen;
  query: string;
  /** Open this record directly when the screen supports it (invoice id). */
  recordId?: string;
  chequeType?: ChequeType;
}

const SCREEN_SEARCH_EVENT = 'mostawdaee-screen-search';

// Screens are lazy-loaded, so a request made before the target mounts is held here
// and consumed on mount. A mounted screen receives it through the event instead.
let pending: ScreenSearchRequest | null = null;

export function requestScreenSearch(request: ScreenSearchRequest): void {
  pending = request;
  window.dispatchEvent(new CustomEvent<ScreenSearchRequest>(SCREEN_SEARCH_EVENT, { detail: request }));
}

export function useScreenSearch(screen: SearchScreen, apply: (request: ScreenSearchRequest) => void): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (pending?.screen === screen) {
      const request = pending;
      pending = null;
      applyRef.current(request);
    }
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<ScreenSearchRequest>).detail;
      if (request?.screen !== screen) return;
      pending = null;
      applyRef.current(request);
    };
    window.addEventListener(SCREEN_SEARCH_EVENT, onRequest);
    return () => window.removeEventListener(SCREEN_SEARCH_EVENT, onRequest);
  }, [screen]);
}
