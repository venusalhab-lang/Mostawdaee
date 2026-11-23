import { useCallback, useRef } from 'react';
import { movedPastThreshold } from './useLongPress';

/**
 * Fires `onTap` only when the pointer ended without scrolling/dragging.
 * Use on list rows inside scrollable panels instead of raw onClick.
 */
export function useIntentionalTap(onTap: () => void, threshold = 14) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const onPointerDown = useCallback((e: { clientX: number; clientY: number }) => {
    origin.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
  }, []);

  const onPointerMove = useCallback((e: { clientX: number; clientY: number }) => {
    if (!origin.current || moved.current) return;
    if (movedPastThreshold(origin.current, { x: e.clientX, y: e.clientY }, threshold)) moved.current = true;
  }, [threshold]);

  const onPointerUp = useCallback(() => {
    if (origin.current && !moved.current) onTap();
    origin.current = null;
  }, [onTap]);

  const onPointerCancel = useCallback(() => {
    origin.current = null;
    moved.current = true;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
