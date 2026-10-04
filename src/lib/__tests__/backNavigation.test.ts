import { describe, expect, it } from 'vitest';
import { decideBack, hasUnsavedWork, markUnsavedWork } from '../backNavigation';

const base = {
  overlayOpen: false,
  unsavedWork: false,
  screen: 'dashboard',
  homeScreen: 'dashboard',
  previousScreen: null,
  exitArmedAt: null,
  now: 10_000,
};

describe('decideBack', () => {
  it('closes an open window before anything else', () => {
    expect(decideBack({ ...base, overlayOpen: true, unsavedWork: true, screen: 'pos' })).toBe('close-overlay');
  });

  it('never leaves a screen with unsaved work', () => {
    expect(decideBack({ ...base, unsavedWork: true, screen: 'pos', previousScreen: 'dashboard' })).toBe('blocked-unsaved');
  });

  it('goes to the previous screen, or home when there is none', () => {
    expect(decideBack({ ...base, screen: 'pos', previousScreen: 'inventory' })).toBe('previous-screen');
    expect(decideBack({ ...base, screen: 'pos' })).toBe('home');
  });

  it('exits only on a second press shortly after the first', () => {
    expect(decideBack(base)).toBe('arm-exit');
    expect(decideBack({ ...base, exitArmedAt: 9_000 })).toBe('exit');
    expect(decideBack({ ...base, exitArmedAt: 5_000 })).toBe('arm-exit');
  });
});

describe('unsaved work registry', () => {
  it('tracks holders independently', () => {
    markUnsavedWork('pos', true);
    markUnsavedWork('invoice', true);
    markUnsavedWork('pos', false);
    expect(hasUnsavedWork()).toBe(true);
    markUnsavedWork('invoice', false);
    expect(hasUnsavedWork()).toBe(false);
  });
});
