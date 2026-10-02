import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInAnonymously,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  onSnapshot, 
  updateDoc, 
  deleteDoc, 
  addDoc, 
  where, 
  getDocFromServer,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure robust browser local persistence to prevent session drops
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Firebase Auth] Persistence adjustment skipped:', err);
});

// Enable Offline Persistence with multi-tab support and force long-polling for restricted sandbox/iframe networks
let dbInstance;
try {
  // Gracefully define the cache mechanism. In certain iframe/sandbox environments, IndexedDB block throws on setup.
  let cacheConfig;
  try {
    cacheConfig = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  } catch (e) {
    console.warn('[Firebase] persistentMultipleTabManager Cache config generation failed, falling back to default persistent cache:', e);
    try {
      cacheConfig = persistentLocalCache();
    } catch (e2) {
      console.warn('[Firebase] persistentLocalCache is not supported in this environment, using memory-first cache.');
    }
  }

  dbInstance = initializeFirestore(app, {
    ...(cacheConfig ? { localCache: cacheConfig } : {}),
    experimentalForceLongPolling: true
  }, (firebaseConfig as any).firestoreDatabaseId);
} catch (e) {
  console.warn('[Firebase] initializeFirestore with robust configuration failed, falling back to standard getFirestore:', e);
  dbInstance = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
}
export const db = dbInstance;

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive');

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));

  if (
    errorMessage.toLowerCase().includes('quota') || 
    errorMessage.toLowerCase().includes('limit exceeded') ||
    errorMessage.toLowerCase().includes('exhausted')
  ) {
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('firestore-quota-exceeded', { detail: errorMessage }));
      }, 50);
    }
  }

  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection() {
  if (typeof window !== 'undefined' && !window.navigator?.onLine) {
    console.info("[Firebase] Browser status reports offline. Initial connection check deferred; running in offline mode.");
    return;
  }
  try {
    // Fast 1.5s race for network timeouts to fail gracefully without blocking the thread or triggering 10s wait
    const checkPromise = getDocFromServer(doc(db, 'test', 'connection'));
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('timeout')), 1500)
    );
    
    await Promise.race([checkPromise, timeoutPromise]);
    console.info("[Firebase] Successfully established server connection.");
  } catch (error: any) {
    const code = error?.code || "";
    const message = String(error?.message || error || "");
    if (code === "permission-denied" || message.toLowerCase().includes("permission-denied")) {
      console.info("[Firebase] Server is reachable; probe document is denied by rules.");
      return;
    }
    console.warn("[Firebase] Server connection check timed out or was blocked. Continuing with network enabled.", message);
  }
}

export {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  onSnapshot,
  updateDoc,
  deleteDoc,
  addDoc,
  where,
  GoogleAuthProvider
};
export type { User };
