/** The signed-in account as the app sees it, mapped from the Supabase session. */
export interface User {
  uid: string;
  /** Same as uid. */
  readonly id?: string;
  email: string | null;
  email_confirmed_at?: string | null;
  displayName: string | null;
  photoURL?: string | null;
  isAnonymous: boolean;
  providerData: { providerId: string; email: string | null }[];
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('Store write error: ', JSON.stringify({ error: errorMessage, operationType, path }));

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

  // Rethrow the original error: callers branch on its code.
  throw error instanceof Error ? error : new Error(errorMessage);
}
