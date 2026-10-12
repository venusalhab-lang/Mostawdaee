import type { Product } from '../types';

/** A request for the inventory screen, kept until that screen (loaded on demand) takes it exactly once. */
export type InventoryIntent = { type: 'add' } | { type: 'view'; product: Product };

export const INVENTORY_INTENT_EVENT = 'inventory-intent';

let pending: InventoryIntent | null = null;

export function requestInventoryIntent(intent: InventoryIntent): void {
  pending = intent;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INVENTORY_INTENT_EVENT));
}

export function takeInventoryIntent(): InventoryIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}
