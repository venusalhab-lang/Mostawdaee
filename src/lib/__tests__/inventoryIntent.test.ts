import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY_INTENT_EVENT, requestInventoryIntent, takeInventoryIntent } from '../inventoryIntent';

describe('inventory intent', () => {
  afterEach(() => {
    takeInventoryIntent();
    vi.unstubAllGlobals();
  });

  it('waits for the inventory screen and is taken only once', () => {
    requestInventoryIntent({ type: 'add' });
    expect(takeInventoryIntent()).toEqual({ type: 'add' });
    expect(takeInventoryIntent()).toBeNull();
  });

  it('tells an already open inventory screen right away', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    requestInventoryIntent({ type: 'view', product: { id: 'p1' } as any });
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0].type).toBe(INVENTORY_INTENT_EVENT);
    expect(takeInventoryIntent()).toMatchObject({ type: 'view', product: { id: 'p1' } });
  });

  it('keeps only the latest request', () => {
    requestInventoryIntent({ type: 'add' });
    requestInventoryIntent({ type: 'view', product: { id: 'p2' } as any });
    expect(takeInventoryIntent()).toMatchObject({ type: 'view' });
  });
});
