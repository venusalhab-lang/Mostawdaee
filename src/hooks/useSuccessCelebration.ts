import { useState, useCallback } from 'react';
import { sounds } from '../lib/sounds';

export function useSuccessCelebration() {
  const [isCelebrating, setIsCelebrating] = useState(false);

  const trigger = useCallback(() => {
    setIsCelebrating(true);
    sounds.playSuccess();
    setTimeout(() => setIsCelebrating(false), 1000);
  }, []);

  return {
    celebrationClass: isCelebrating ? 'animate-success-glow' : '',
    triggerCelebration: trigger,
    isCelebrating
  };
}
