import { readQueue } from './offlineQueue';
import { clearUserCache } from './userStorage';

/** Sales still waiting on this device belong to the current store; switching first would send them to another one. */
export function pendingSalesBlockSwitch(userId: string): number {
  return readQueue(userId).length;
}

/** Joins or leaves a store, then reloads so no screen keeps the previous store's books. */
export async function switchStore(userId: string, action: () => Promise<void>): Promise<void> {
  await action();
  clearUserCache(userId);
  window.location.reload();
}
