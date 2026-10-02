import { useCallback, useRef, useState } from 'react';

export default function useLongPress(
  onLongPress: (e: any) => void,
  onClick?: (e: any) => void,
  { delay = 500, threshold = 10 } = {}
) {
  const [isLongPressActive, setIsLongPressActive] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressHappened = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const start = useCallback(
    (e: any) => {
      isLongPressHappened.current = false;
      const pos = e.touches ? e.touches[0] : e;
      startPos.current = { x: pos.clientX, y: pos.clientY };
      
      timerRef.current = setTimeout(() => {
        onLongPress(e);
        setIsLongPressActive(true);
        isLongPressHappened.current = true;
      }, delay);
    },
    [onLongPress, delay]
  );

  const stop = useCallback(
    (e: any) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      
      if (isLongPressActive) {
        setIsLongPressActive(false);
      } else if (!isLongPressHappened.current && onClick) {
        onClick(e);
      }
    },
    [isLongPressActive, onClick]
  );

  const move = useCallback(
    (e: any) => {
      if (!timerRef.current) return;
      const pos = e.touches ? e.touches[0] : e;
      const dist = Math.sqrt(
        Math.pow(pos.clientX - startPos.current.x, 2) +
        Math.pow(pos.clientY - startPos.current.y, 2)
      );
      
      if (dist > threshold) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [threshold]
  );

  return {
    onMouseDown: start,
    onMouseUp: stop,
    onMouseLeave: stop,
    onMouseMove: move,
    onTouchStart: start,
    onTouchEnd: stop,
    onTouchMove: move,
  };
}
