import { useState, useCallback, useEffect, useRef } from 'react';
// @ts-ignore
import { getSubscription, getProfileById } from '../supabaseClient';
import { useAuth } from '../components/AuthContext';

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
  const [daysRemaining, setDaysRemaining] = useState<number>(365);
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

  // Compute live subscription checks with strict 25-day free trial boundary
  const trialStart = subscription?.trial_start_date ? new Date(subscription.trial_start_date).getTime() : Date.now();
  const trialDurationMs = 25 * 24 * 60 * 60 * 1000;
  const trialExpiryTime = trialStart + trialDurationMs;
  const trialDaysLeft = Math.max(0, Math.ceil((trialExpiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
  
  // Treat guest preview separately from an actual trial subscription
  const isGuestPreview = !!isGuest;
  const isTrialActive = (subscription?.subscription_status === 'trial' && trialDaysLeft > 0);

  // The custom premium attribute allows automatic sync between mobile purchases and PC session verification
  const isPremiumActive = 
    (subscription?.subscription_status === 'active' && new Date(subscription.expiry_date).getTime() > Date.now()) ||
    profile?.is_premium === true ||
    profile?.is_premium === 'true' ||
    profile?.role === 'premium' ||
    profile?.user_role === 'premium' ||
    profile?.subscription_status === 'active';

  const isSubscribed = isPremiumActive || isTrialActive;
  const isExpired = !isSubscribed && !(checkFailed && !subscription);

  // Set standard days remaining based on active mode
  const resolvedDaysRemaining = isPremiumActive 
    ? (subscription?.expiry_date ? Math.max(0, Math.ceil((new Date(subscription.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 365)
    : (isGuest ? 365 : (subscription?.subscription_status === 'trial' ? trialDaysLeft : 0));

  return {
    loading,
    isSubscribed,
    isExpired,
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
