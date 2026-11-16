import { useEffect, useRef } from 'react';

/** Opens the store-notes screen ready to log against a customer or supplier. */
export interface NoteIntent {
  linkType: 'customer' | 'supplier';
  linkId: string;
  linkName: string;
}

const NOTE_INTENT_EVENT = 'mostawdaee-note-intent';
let pending: NoteIntent | null = null;

export function requestStoreNote(intent: NoteIntent): void {
  pending = intent;
  window.dispatchEvent(new CustomEvent<NoteIntent>(NOTE_INTENT_EVENT, { detail: intent }));
  window.dispatchEvent(new CustomEvent('change-screen', { detail: 'notes' }));
}

export function useStoreNoteIntent(apply: (intent: NoteIntent) => void): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (pending) {
      const intent = pending;
      pending = null;
      applyRef.current(intent);
    }
    const onIntent = (event: Event) => {
      const intent = (event as CustomEvent<NoteIntent>).detail;
      if (!intent?.linkId) return;
      pending = null;
      applyRef.current(intent);
    };
    window.addEventListener(NOTE_INTENT_EVENT, onIntent);
    return () => window.removeEventListener(NOTE_INTENT_EVENT, onIntent);
  }, []);
}
