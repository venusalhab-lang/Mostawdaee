import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../services/firebase';
import { Capacitor } from '@capacitor/core';
import { apiUrl, getApiBase } from './apiBase';

export async function linkFirebaseAuth(supabaseAccessToken: string, expectedUid: string): Promise<void> {
  if (!supabaseAccessToken || !expectedUid) return;
  if (auth.currentUser?.uid === expectedUid) return;

  if (Capacitor.isNativePlatform() && !getApiBase()) {
    throw new Error('VITE_API_BASE_URL is not set: the mobile app cannot reach /api/firebase-session');
  }

  // Never let an unreachable/cold server freeze app start-up
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/firebase-session'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseAccessToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error: any) {
    throw new Error(error?.name === 'AbortError' ? 'Firebase session bridge timed out' : (error?.message || 'Firebase session bridge unreachable'));
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.message || `Firebase session bridge failed (${response.status})`);
  }

  const payload = await response.json();
  if (!payload?.token) {
    throw new Error('Firebase session bridge returned no token');
  }

  await signInWithCustomToken(auth, payload.token);
}
