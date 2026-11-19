import { useCallback, useState } from 'react';
import {
  emptyFocus,
  resolveGridKey,
  type GridFocus,
  type GridKeyAction,
  type GridKeyInput,
} from './entryGridKeyboard';

/**
 * React wrapper around the pure grid keyboard state machine.
 * Callers apply `action` (commit/move/edit) against their own cells.
 */
export function useEntryGridKeyboard(editableCols: boolean[], rowCount: number) {
  const [focus, setFocus] = useState<GridFocus>(() => emptyFocus(editableCols));
  const [editing, setEditing] = useState(false);

  const handleKey = useCallback(
    (partial: Omit<GridKeyInput, 'editing' | 'rowCount' | 'colCount' | 'focus' | 'editableCols'>): GridKeyAction => {
      return resolveGridKey({
        ...partial,
        editing,
        rowCount,
        colCount: editableCols.length,
        focus,
        editableCols,
      });
    },
    [editableCols, editing, focus, rowCount],
  );

  const applyActionMeta = useCallback((action: GridKeyAction) => {
    if (action.type === 'move') {
      setFocus(action.focus);
      setEditing(!!action.startEdit);
      return;
    }
    if (action.type === 'startEdit') {
      setEditing(true);
      return;
    }
    if (action.type === 'cancelEdit') {
      setEditing(false);
      return;
    }
    if (action.type === 'commitEdit') {
      setEditing(false);
      if (action.next) setFocus(action.next);
    }
  }, []);

  return { focus, setFocus, editing, setEditing, handleKey, applyActionMeta };
}
