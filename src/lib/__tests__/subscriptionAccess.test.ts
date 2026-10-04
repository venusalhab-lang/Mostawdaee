import { describe, expect, it } from 'vitest';
import { subscriptionWindow, trialStartForEnd, TRIAL_DAYS, SUBSCRIPTION_DAY_MS } from '../subscriptionAccess';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');

describe('subscriptionWindow', () => {
  it('counts a fresh trial as 25 days', () => {
    const access = subscriptionWindow({
      status: 'trial',
      trialStart: new Date(NOW).toISOString(),
      expiry: new Date(NOW + 365 * SUBSCRIPTION_DAY_MS).toISOString(),
      now: NOW,
    });
    expect(access.kind).toBe('trial');
    expect(access.daysRemaining).toBe(TRIAL_DAYS);
  });

  it('does not let a client-written expiry lengthen a trial', () => {
    const access = subscriptionWindow({
      status: 'trial',
      trialStart: new Date(NOW - 20 * SUBSCRIPTION_DAY_MS).toISOString(),
      expiry: new Date(NOW + 400 * SUBSCRIPTION_DAY_MS).toISOString(),
      now: NOW,
    });
    expect(access.kind).toBe('trial');
    expect(access.daysRemaining).toBe(5);
  });

  it('expires a trial after 25 days', () => {
    const access = subscriptionWindow({
      status: 'trial',
      trialStart: new Date(NOW - 26 * SUBSCRIPTION_DAY_MS).toISOString(),
      now: NOW,
    });
    expect(access.kind).toBe('expired');
    expect(access.daysRemaining).toBe(0);
  });

  it('treats an active row with a future expiry as paid', () => {
    const access = subscriptionWindow({
      status: 'active',
      expiry: new Date(NOW + 10 * SUBSCRIPTION_DAY_MS).toISOString(),
      now: NOW,
    });
    expect(access.kind).toBe('paid');
    expect(access.daysRemaining).toBe(10);
  });

  it('expires a paid row when expiry has passed, even if a profile flag would say otherwise', () => {
    const access = subscriptionWindow({
      status: 'active',
      expiry: new Date(NOW - SUBSCRIPTION_DAY_MS).toISOString(),
      now: NOW,
    });
    expect(access.kind).toBe('expired');
    expect(access.daysRemaining).toBe(0);
  });

  it('does not invent a year when a paid row has no expiry', () => {
    const access = subscriptionWindow({ status: 'active', expiry: null, now: NOW });
    expect(access.kind).toBe('expired');
    expect(access.daysRemaining).toBe(0);
  });

  it('does not grant an endless trial when trial_start is missing', () => {
    const access = subscriptionWindow({ status: 'trial', trialStart: null, now: NOW });
    expect(access.kind).toBe('expired');
  });

  it('shifts trial_start so an owner extension is visible to the 25-day clock', () => {
    const start = NOW - 10 * SUBSCRIPTION_DAY_MS;
    const before = subscriptionWindow({
      status: 'trial',
      trialStart: new Date(start).toISOString(),
      now: NOW,
    });
    const extendedEnd = before.endsAt! + 7 * SUBSCRIPTION_DAY_MS;
    const after = subscriptionWindow({
      status: 'trial',
      trialStart: trialStartForEnd(extendedEnd),
      now: NOW,
    });
    expect(after.kind).toBe('trial');
    expect(after.daysRemaining).toBe(before.daysRemaining + 7);
  });
});
