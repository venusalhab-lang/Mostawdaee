import { describe, expect, it } from 'vitest';
import { GUIDE_GROUPS, USER_GUIDE_TOPICS, guideTopicsByGroup } from '../userGuide';

describe('userGuide', () => {
  it('has bilingual titles and at least one step per topic', () => {
    expect(USER_GUIDE_TOPICS.length).toBeGreaterThanOrEqual(10);
    for (const topic of USER_GUIDE_TOPICS) {
      expect(topic.title.ar.trim()).toBeTruthy();
      expect(topic.title.en.trim()).toBeTruthy();
      expect(topic.steps.length).toBeGreaterThan(0);
      expect(GUIDE_GROUPS.some((g) => g.id === topic.group)).toBe(true);
      expect(!!topic.openScreen || !!topic.openSettings).toBe(true);
    }
  });

  it('groups topics without dropping any', () => {
    const nested = GUIDE_GROUPS.flatMap((g) => guideTopicsByGroup(g.id));
    expect(nested.map((t) => t.id).sort()).toEqual(USER_GUIDE_TOPICS.map((t) => t.id).sort());
  });
});
