import { useSyncExternalStore } from 'react';

/**
 * A password-reset link signs the user in. While this is true the app keeps showing the
 * "new password" form instead of the dashboard, until the password is saved or the user leaves.
 */
let active = false;
const listeners = new Set<() => void>();

export function setPasswordRecovery(next: boolean): void {
  if (active === next) return;
  active = next;
  listeners.forEach((listener) => listener());
}

export function isPasswordRecovery(): boolean {
  return active;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePasswordRecovery(): boolean {
  return useSyncExternalStore(subscribe, isPasswordRecovery, isPasswordRecovery);
}
