import { readHeldBills } from './heldBills';
import { readQueue } from './offlineQueue';
import { clearUserCache } from './userStorage';

/** Sales still waiting on this device belong to the current store; switching first would send them to another one. */
export function pendingSalesBlockSwitch(userId: string): number {
  return readQueue(userId).length;
}

/** Held carts are device-local; switching stores must not wipe them without the merchant noticing. */
export function pendingHeldBlockSwitch(userId: string): number {
  return readHeldBills(userId).length;
}

export function deviceLocalWorkMessage(userId: string, ar: boolean): string | null {
  const sales = pendingSalesBlockSwitch(userId);
  if (sales > 0) {
    return ar
      ? `توجد ${sales} عملية بيع على هذا الجهاز لم تُرسل بعد. اتصل بالإنترنت وانتظر إرسالها أولاً.`
      : `${sales} sale(s) on this device have not been sent yet. Connect and wait for them first.`;
  }
  const held = pendingHeldBlockSwitch(userId);
  if (held > 0) {
    return ar
      ? `توجد ${held} فاتورة معلّقة على هذا الجهاز. أتمم بيعها أو احذفها من نقطة البيع أولاً.`
      : `${held} held bill(s) are still on this device. Finish or discard them in POS first.`;
  }
  return null;
}

/** Joins or leaves a store, then reloads so no screen keeps the previous store's books. */
export async function switchStore(userId: string, action: () => Promise<void>): Promise<void> {
  await action();
  clearUserCache(userId);
  window.location.reload();
}
