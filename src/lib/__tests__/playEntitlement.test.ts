import { describe, expect, it } from 'vitest';
import { isEntitled, reconcilePlaySubscription } from '../playEntitlement';

const NOW = Date.parse('2026-10-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

describe('reconcilePlaySubscription', () => {
  it('activates a new purchase on a trial account', () => {
    const change = reconcilePlaySubscription(
      { status: 'trial', expiry: at(10) },
      [{ state: 'SUBSCRIPTION_STATE_ACTIVE', expiry: at(365) }],
      NOW,
    );
    expect(change).toEqual({ status: 'active', expiry: at(365) });
  });

  it('extends access when Google reports a renewal', () => {
    const change = reconcilePlaySubscription(
      { status: 'active', expiry: at(-1) },
      [{ state: 'SUBSCRIPTION_STATE_ACTIVE', expiry: at(364) }],
      NOW,
    );
    expect(change).toEqual({ status: 'active', expiry: at(364) });
  });

  it('writes nothing when the row already matches Google', () => {
    const change = reconcilePlaySubscription(
      { status: 'active', expiry: at(30) },
      [{ state: 'SUBSCRIPTION_STATE_ACTIVE', expiry: at(30) }],
      NOW,
    );
    expect(change).toBeNull();
  });

  it('keeps paid time after auto-renew is cancelled', () => {
    expect(isEntitled({ state: 'SUBSCRIPTION_STATE_CANCELED', expiry: at(20) }, NOW)).toBe(true);
    expect(isEntitled({ state: 'SUBSCRIPTION_STATE_ON_HOLD', expiry: at(20) }, NOW)).toBe(false);
  });

  it('ends access immediately on a refund or revocation', () => {
    const change = reconcilePlaySubscription(
      { status: 'active', expiry: at(300) },
      [{ state: 'SUBSCRIPTION_STATE_EXPIRED', expiry: at(300) }],
      NOW,
    );
    expect(change).toEqual({ status: 'expired', expiry: new Date(NOW).toISOString() });
  });

  it('keeps an owner grant that runs past every Play expiry', () => {
    const change = reconcilePlaySubscription(
      { status: 'active', expiry: at(400) },
      [{ state: 'SUBSCRIPTION_STATE_EXPIRED', expiry: at(-5) }],
      NOW,
    );
    expect(change).toBeNull();
  });

  it('uses the latest entitled token when a merchant re-subscribed', () => {
    const change = reconcilePlaySubscription(
      { status: 'active', expiry: at(-2) },
      [
        { state: 'SUBSCRIPTION_STATE_EXPIRED', expiry: at(-2) },
        { state: 'SUBSCRIPTION_STATE_ACTIVE', expiry: at(363) },
      ],
      NOW,
    );
    expect(change).toEqual({ status: 'active', expiry: at(363) });
  });

  it('never touches a trial when no token is entitled', () => {
    const change = reconcilePlaySubscription(
      { status: 'trial', expiry: at(10) },
      [{ state: 'SUBSCRIPTION_STATE_PENDING', expiry: null }],
      NOW,
    );
    expect(change).toBeNull();
  });
});
