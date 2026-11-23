import { useCallback, useRef, useState } from 'react';

/** True when pointer travel exceeds the still-tap threshold (scroll/drag). */
export function movedPastThreshold(
  start: { x: number; y: number },
  point: { x: number; y: number },
  threshold: number,
): boolean {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  return dx * dx + dy * dy > threshold * threshold;
}

/**
 * Long-press / tap helpers that ignore scroll gestures.
 * If the finger moves past `threshold`, both long-press and click are cancelled —
 * otherwise lifting after a scroll would fire onClick and open sheets by accident.
 */
export default function useLongPress(
  onLongPress: (e: unknown) => void,
  onClick?: (e: unknown) => void,
  { delay = 500, threshold = 14 } = {},
) {
  const [isLongPressActive, setIsLongPressActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressHappened = useRef(false);
  const movedRef = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = useCallback(
    (e: { touches?: ArrayLike<{ clientX: number; clientY: number }>; clientX?: number; clientY?: number }) => {
      isLongPressHappened.current = false;
      movedRef.current = false;
      const pos = e.touches && e.touches.length > 0 ? e.touches[0] : e;
      startPos.current = { x: Number(pos.clientX) || 0, y: Number(pos.clientY) || 0 };

      clearTimer();
      timerRef.current = setTimeout(() => {
        if (movedRef.current) return;
        onLongPress(e);
        setIsLongPressActive(true);
        isLongPressHappened.current = true;
      }, delay);
    },
    [onLongPress, delay],
  );

  const stop = useCallback(
    (e: unknown) => {
      clearTimer();

      if (isLongPressActive) {
        setIsLongPressActive(false);
        return;
      }
      // Scroll / drag: never treat as a tap.
      if (movedRef.current || isLongPressHappened.current) return;
      if (onClick) onClick(e);
    },
    [isLongPressActive, onClick],
  );

  const move = useCallback(
    (e: { touches?: ArrayLike<{ clientX: number; clientY: number }>; clientX?: number; clientY?: number }) => {
      if (movedRef.current) return;
      const pos = e.touches && e.touches.length > 0 ? e.touches[0] : e;
      if (movedPastThreshold(startPos.current, { x: Number(pos.clientX) || 0, y: Number(pos.clientY) || 0 }, threshold)) {
        movedRef.current = true;
        clearTimer();
      }
    },
    [threshold],
  );

  const cancel = useCallback(() => {
    clearTimer();
    movedRef.current = true;
    if (isLongPressActive) setIsLongPressActive(false);
  }, [isLongPressActive]);

  return {
    onMouseDown: start,
    onMouseUp: stop,
    onMouseLeave: cancel,
    onMouseMove: move,
    onTouchStart: start,
    onTouchEnd: stop,
    onTouchMove: move,
    onTouchCancel: cancel,
  };
}
