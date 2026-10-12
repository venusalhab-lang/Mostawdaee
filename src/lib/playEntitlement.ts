/** Google Play subscriptionsv2 states that still entitle the buyer until expiryTime. */
const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  // Auto-renew turned off: paid time is kept until it runs out.
  'SUBSCRIPTION_STATE_CANCELED',
]);

export interface PlayTokenState {
  state: string;
  expiry: string | null;
  /** The expiry Google reported for this token last time; a refund moves `expiry` back below it. */
  previousExpiry?: string | null;
}

export interface CurrentSubscription {
  status: string | null;
  expiry: string | null;
}

export type SubscriptionChange = { status: 'active' | 'expired'; expiry: string } | null;

function time(value: string | null | undefined): number {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

export function isEntitled(token: PlayTokenState, now = Date.now()): boolean {
  return ENTITLED_STATES.has(token.state) && time(token.expiry) > now;
}

/**
 * Decides the account's paid window from every Play token it owns, as last reported by Google.
 * Paid time an owner granted beyond any Play expiry is kept; a refund or lapse never extends access.
 * Returns null when the row should be left as it is.
 */
export function reconcilePlaySubscription(
  current: CurrentSubscription | null,
  tokens: PlayTokenState[],
  now = Date.now(),
): SubscriptionChange {
  if (!tokens.length) return null;

  // A date Play itself once reported is not an owner grant, even after Play moves it back.
  const playMax = Math.max(...tokens.map((t) => Math.max(time(t.expiry), time(t.previousExpiry))));
  const currentExpiry = time(current?.expiry);
  const ownerGrant = current?.status === 'active' && currentExpiry > playMax && currentExpiry > now;

  const entitled = tokens.filter((t) => isEntitled(t, now));
  if (entitled.length) {
    const playExpiry = Math.max(...entitled.map((t) => time(t.expiry)));
    const expiry = ownerGrant ? Math.max(playExpiry, currentExpiry) : playExpiry;
    if (current?.status === 'active' && currentExpiry === expiry) return null;
    return { status: 'active', expiry: new Date(expiry).toISOString() };
  }

  if (ownerGrant) return null;
  // A trial is left alone; a paid window that already ended needs no write.
  if (current?.status !== 'active' || currentExpiry <= now) return null;
  return { status: 'expired', expiry: new Date(now).toISOString() };
}
