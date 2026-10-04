import { useState, useCallback, useEffect, useRef } from 'react';
// @ts-ignore
import { getSubscription, getProfileById } from '../supabaseClient';
import { useAuth } from '../components/AuthContext';
import { subscriptionWindow } from '../lib/subscriptionAccess';

export interface Subscription {
  user_id: string;
  trial_start_date: string;
  subscription_status: 'trial' | 'active' | 'expired';
  expiry_date: string;
}

export function useSubscriptionSync(passedUser?: any, passedIsGuest?: boolean) {
  const { user: authUser, isGuest: authIsGuest } = useAuth();
  const supabaseUser = passedUser !== undefined ? passedUser : authUser;
  const isGuest = passedIsGuest !== undefined ? passedIsGuest : authIsGuest;
  const [loading, setLoading] = useState<boolean>(true);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [daysRemaining, setDaysRemaining] = useState<number>(0);
  const [hasOnboarded, setHasOnboarded] = useState<boolean>(true);
  // True when the status could not be verified (slow/offline network) and nothing is cached
  const [checkFailed, setCheckFailed] = useState<boolean>(false);
  const loadedUserRef = useRef<string | null>(null);

  // Expose setSupabaseUser for backwards compatibility in App.tsx
  const setSupabaseUser = useCallback((userObj: any) => {
    // Handled centrally through AuthContext now.
  }, []);

  const refreshSubscription = useCallback(async () => {
    const userId = supabaseUser?.id || supabaseUser?.uid;
    if (!supabaseUser || isGuest || userId === '00000000-0000-0000-0000-000000000000') {
      setSubscription(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    // Stale-while-revalidate: show the spinner only the first time for this user
    const cacheKey = `mustawdae:${userId}:subscription_cache`;
    if (loadedUserRef.current !== userId) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (cached?.subscription) {
          setSubscription(cached.subscription);
          if (cached.profile) setProfile(cached.profile);
          setLoading(false);
        } else {
          setLoading(true);
        }
      } catch {
        setLoading(true);
      }
    }
    try {
      let freshProfile: any = null;
      // 1. Fetch user custom database profile from profiles table
      try {
        const profileData = await getProfileById(userId);
        if (profileData) {
          freshProfile = profileData;
          setProfile(profileData);
        }
      } catch (pErr) {
        console.warn("[SubscriptionSync] Could not load user profile metadata:", pErr);
      }

      // 2. Implement a 3.5-second query safety timeout for getSubscription
      const queryWithTimeout = new Promise<any>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('subscription_query_timeout'));
        }, 3500);

        getSubscription(userId)
          .then((res) => {
            clearTimeout(timeoutId);
            resolve(res);
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            reject(err);
          });
      });

      const data = await queryWithTimeout;
      setCheckFailed(false);
      loadedUserRef.current = userId;
      if (data) {
        setSubscription(data);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ subscription: data, profile: freshProfile }));
        } catch { /* ignore */ }
        
        // Compute days remaining
        const expiry = new Date(data.expiry_date).getTime();
        const now = Date.now();
        const diffMs = expiry - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        setDaysRemaining(diffDays > 0 ? diffDays : 0);
      } else {
        setSubscription(null);
      }
    } catch (err) {
      // A slow or offline network must NOT lock out a paying customer: keep the last known status.
      console.warn("[SubscriptionSync] Could not verify subscription, keeping last known status:", err);
      setCheckFailed(true);
    } finally {
      setLoading(false);
    }
  }, [supabaseUser]);

  // Automatically refresh subscription when user logins or switches
  useEffect(() => {
    refreshSubscription();
  }, [supabaseUser?.id, supabaseUser?.uid, isGuest]); // key on the user id, not object identity

  // Paid access is an active row with a future expiry. Trial access is 25 days from trial_start.
  // Profile flags do not unlock the app: a missing expiry must not invent a year of premium.
  const access = subscription
    ? subscriptionWindow({
        status: subscription.subscription_status,
        trialStart: subscription.trial_start_date,
        expiry: subscription.expiry_date,
      })
    : null;
  const isTrialActive = access?.kind === 'trial';
  const isPremiumActive = access?.kind === 'paid';
  const trialDaysLeft = isTrialActive ? access.daysRemaining : 0;

  const isSubscribed = isPremiumActive || isTrialActive;
  // Fail closed: no verified window means no access. The lock screen tells "unverified" apart from "ended".
  const isExpired = !isSubscribed;
  const lockReason: 'trial' | 'paid' | 'unverified' = !subscription
    ? 'unverified'
    : subscription.subscription_status === 'trial' ? 'trial' : 'paid';

  const resolvedDaysRemaining = access && access.kind !== 'expired' ? access.daysRemaining : 0;

  return {
    loading,
    isSubscribed,
    isExpired,
    lockReason,
    isTrialActive,
    isPremiumActive,
    trialDaysLeft,
    subscription,
    daysRemaining: resolvedDaysRemaining,
    supabaseUser,
    refreshSubscription,
    setSupabaseUser,
    hasOnboarded,
    setHasOnboarded
  };
}
