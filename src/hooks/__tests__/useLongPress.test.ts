import { describe, expect, it } from 'vitest';
import { movedPastThreshold } from '../useLongPress';

describe('movedPastThreshold', () => {
  it('treats small finger jitter as a still tap', () => {
    expect(movedPastThreshold({ x: 0, y: 0 }, { x: 4, y: 3 }, 14)).toBe(false);
  });

  it('treats scroll-sized travel as a drag', () => {
    expect(movedPastThreshold({ x: 0, y: 0 }, { x: 0, y: 40 }, 14)).toBe(true);
  });
});
