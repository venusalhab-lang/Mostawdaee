/** How long a new trial lasts. Owner extensions move trial_start so this window still applies. */
export const TRIAL_DAYS = 25;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionKind = 'trial' | 'paid' | 'expired';

export interface SubscriptionWindowInput {
  status?: string | null;
  trialStart?: string | null;
  expiry?: string | null;
  now?: number;
}

export interface SubscriptionWindow {
  kind: SubscriptionKind;
  endsAt: number | null;
  daysRemaining: number;
}

/**
 * The same clock the app uses to lock a merchant.
 * A trial ends 25 days after trial_start. A paid account ends at expiry_date.
 * A later expiry_date does not lengthen a trial: clients can write that column,
 * so only a server-side shift of trial_start extends a trial.
 */
export function subscriptionWindow(input: SubscriptionWindowInput): SubscriptionWindow {
  const now = input.now ?? Date.now();
  const expiry = Date.parse(input.expiry || '');
  const trialStart = Date.parse(input.trialStart || '');

  if (input.status === 'active') {
    if (!Number.isFinite(expiry) || expiry <= now) {
      return { kind: 'expired', endsAt: Number.isFinite(expiry) ? expiry : null, daysRemaining: 0 };
    }
    return {
      kind: 'paid',
      endsAt: expiry,
      daysRemaining: Math.ceil((expiry - now) / DAY_MS),
    };
  }

  if (input.status === 'trial') {
    // The database sets trial_start; without it the trial cannot be dated, so it grants nothing.
    if (!Number.isFinite(trialStart)) return { kind: 'expired', endsAt: null, daysRemaining: 0 };
    const endsAt = trialStart + TRIAL_DAYS * DAY_MS;
    const daysRemaining = Math.ceil((endsAt - now) / DAY_MS);
    if (daysRemaining <= 0) return { kind: 'expired', endsAt, daysRemaining: 0 };
    return { kind: 'trial', endsAt, daysRemaining };
  }

  return {
    kind: 'expired',
    endsAt: Number.isFinite(expiry) ? expiry : null,
    daysRemaining: 0,
  };
}

/** New trial_start that makes the 25-day window end at `endsAt`. */
export function trialStartForEnd(endsAtMs: number): string {
  return new Date(endsAtMs - TRIAL_DAYS * DAY_MS).toISOString();
}

export const SUBSCRIPTION_DAY_MS = DAY_MS;
export const MAX_SUBSCRIPTION_GRANT_DAYS = 730;
