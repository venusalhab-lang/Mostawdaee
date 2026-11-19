export type GridFocus = { row: number; col: number };

export type GridKeyAction =
  | { type: 'none' }
  | { type: 'move'; focus: GridFocus; startEdit?: boolean }
  | { type: 'startEdit' }
  | { type: 'commitEdit'; next?: GridFocus; appendRow?: boolean }
  | { type: 'cancelEdit' };

export type GridKeyInput = {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** True while the focused cell is in edit mode (input focused). */
  editing: boolean;
  rowCount: number;
  colCount: number;
  focus: GridFocus;
  /** Columns that are editable (true) vs read-only (false), length = colCount. */
  editableCols: boolean[];
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function nextEditableCol(editableCols: boolean[], from: number, dir: 1 | -1): number | null {
  if (editableCols.length === 0) return null;
  let col = from;
  for (let i = 0; i < editableCols.length; i += 1) {
    col = (col + dir + editableCols.length) % editableCols.length;
    if (editableCols[col]) return col;
  }
  return editableCols[from] ? from : null;
}

function firstEditableCol(editableCols: boolean[]): number {
  const idx = editableCols.findIndex(Boolean);
  return idx >= 0 ? idx : 0;
}

/**
 * Pure keyboard state machine for Excel-like grid navigation.
 * Does not touch the DOM — callers apply the returned action.
 */
export function resolveGridKey(input: GridKeyInput): GridKeyAction {
  const { key, editing, rowCount, colCount, focus, editableCols } = input;
  if (rowCount <= 0 || colCount <= 0) return { type: 'none' };
  if (input.metaKey || input.ctrlKey || input.altKey) return { type: 'none' };

  const row = clamp(focus.row, 0, rowCount - 1);
  const col = clamp(focus.col, 0, colCount - 1);

  if (key === 'Escape') {
    return editing ? { type: 'cancelEdit' } : { type: 'none' };
  }

  if (key === 'F2') {
    if (!editableCols[col]) return { type: 'none' };
    return editing ? { type: 'none' } : { type: 'startEdit' };
  }

  if (key === 'Enter') {
    if (editing) {
      const nextRow = row + 1;
      if (nextRow >= rowCount) {
        return { type: 'commitEdit', next: { row, col }, appendRow: true };
      }
      return { type: 'commitEdit', next: { row: nextRow, col } };
    }
    if (!editableCols[col]) return { type: 'none' };
    return { type: 'startEdit' };
  }

  if (key === 'Tab') {
    const dir: 1 | -1 = input.shiftKey ? -1 : 1;
    const nextCol = nextEditableCol(editableCols, col, dir);
    if (nextCol === null) return editing ? { type: 'commitEdit', next: { row, col } } : { type: 'none' };

    // Wrap to next/previous row when leaving the edge editable column.
    const atEdge =
      (dir === 1 && nextCol <= col && editableCols.filter(Boolean).length > 0) ||
      (dir === -1 && nextCol >= col && editableCols.filter(Boolean).length > 0);
    // Simpler wrap: if moving forward from last editable, go next row first editable.
    const editableIndexes = editableCols.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    const pos = editableIndexes.indexOf(col);
    if (editing) {
      if (dir === 1 && (pos === editableIndexes.length - 1 || pos < 0)) {
        const nextRow = row + 1;
        const targetCol = editableIndexes[0] ?? col;
        if (nextRow >= rowCount) {
          return { type: 'commitEdit', next: { row, col: targetCol }, appendRow: true };
        }
        return { type: 'commitEdit', next: { row: nextRow, col: targetCol } };
      }
      if (dir === -1 && (pos <= 0)) {
        const prevRow = row - 1;
        const targetCol = editableIndexes[editableIndexes.length - 1] ?? col;
        if (prevRow < 0) return { type: 'commitEdit', next: { row, col: targetCol } };
        return { type: 'commitEdit', next: { row: prevRow, col: targetCol } };
      }
      return { type: 'commitEdit', next: { row, col: nextCol } };
    }

    if (dir === 1 && pos === editableIndexes.length - 1) {
      const nextRow = row + 1;
      const targetCol = editableIndexes[0] ?? col;
      if (nextRow >= rowCount) {
        return { type: 'move', focus: { row, col: targetCol }, startEdit: false };
      }
      return { type: 'move', focus: { row: nextRow, col: targetCol } };
    }
    if (dir === -1 && pos <= 0) {
      const prevRow = row - 1;
      const targetCol = editableIndexes[editableIndexes.length - 1] ?? col;
      if (prevRow < 0) return { type: 'move', focus: { row, col: targetCol } };
      return { type: 'move', focus: { row: prevRow, col: targetCol } };
    }
    void atEdge;
    return { type: 'move', focus: { row, col: nextCol ?? col } };
  }

  if (editing) {
    // Let the input handle arrows while typing (except we still want Ctrl-free plain arrows to stay in input).
    return { type: 'none' };
  }

  if (key === 'ArrowDown') {
    if (row + 1 >= rowCount) return { type: 'none' };
    return { type: 'move', focus: { row: row + 1, col } };
  }
  if (key === 'ArrowUp') {
    if (row - 1 < 0) return { type: 'none' };
    return { type: 'move', focus: { row: row - 1, col } };
  }
  if (key === 'ArrowRight') {
    const next = nextEditableCol(editableCols, col, 1);
    if (next === null || next === col) {
      // Prefer moving to any next column index for read-only browsing.
      if (col + 1 < colCount) return { type: 'move', focus: { row, col: col + 1 } };
      return { type: 'none' };
    }
    return { type: 'move', focus: { row, col: next } };
  }
  if (key === 'ArrowLeft') {
    const next = nextEditableCol(editableCols, col, -1);
    if (next === null || next === col) {
      if (col - 1 >= 0) return { type: 'move', focus: { row, col: col - 1 } };
      return { type: 'none' };
    }
    return { type: 'move', focus: { row, col: next } };
  }

  // Printable character starts edit on editable cells.
  if (key.length === 1 && editableCols[col]) {
    return { type: 'startEdit' };
  }

  return { type: 'none' };
}

export function emptyFocus(editableCols: boolean[]): GridFocus {
  return { row: 0, col: firstEditableCol(editableCols) };
}
