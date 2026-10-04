const unsavedHolders = new Set<string>();

/** A screen holding work that would be lost on navigation (e.g. a POS cart) registers itself here. */
export function markUnsavedWork(key: string, active: boolean) {
  if (active) unsavedHolders.add(key);
  else unsavedHolders.delete(key);
}

export function hasUnsavedWork(): boolean {
  return unsavedHolders.size > 0;
}

export type BackAction = 'close-overlay' | 'blocked-unsaved' | 'previous-screen' | 'home' | 'arm-exit' | 'exit';

export const EXIT_CONFIRM_WINDOW_MS = 2000;

/** Android back button: close what is on top first, never drop unsaved work, and exit only on a confirmed second press. */
export function decideBack(state: {
  overlayOpen: boolean;
  unsavedWork: boolean;
  screen: string;
  homeScreen: string;
  previousScreen: string | null;
  exitArmedAt: number | null;
  now: number;
}): BackAction {
  if (state.overlayOpen) return 'close-overlay';
  if (state.unsavedWork) return 'blocked-unsaved';
  if (state.screen !== state.homeScreen) return state.previousScreen ? 'previous-screen' : 'home';
  if (state.exitArmedAt !== null && state.now - state.exitArmedAt <= EXIT_CONFIRM_WINDOW_MS) return 'exit';
  return 'arm-exit';
}
