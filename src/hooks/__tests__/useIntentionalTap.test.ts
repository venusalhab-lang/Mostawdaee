import { describe, expect, it } from 'vitest';
import { movedPastThreshold } from '../useLongPress';

/** Same cancel rule intentional taps share with long-press. */
describe('intentional tap cancel rule', () => {
  it('cancels when movement exceeds the shared threshold', () => {
    expect(movedPastThreshold({ x: 10, y: 10 }, { x: 10, y: 30 }, 14)).toBe(true);
    expect(movedPastThreshold({ x: 10, y: 10 }, { x: 12, y: 11 }, 14)).toBe(false);
  });
});
