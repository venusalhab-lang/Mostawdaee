import { describe, expect, it } from 'vitest';
import { emptyFocus, resolveGridKey } from '../grid/entryGridKeyboard';

const editable = [true, false, true, true]; // code, name, qty, cost

describe('entryGridKeyboard', () => {
  it('starts with the first editable column', () => {
    expect(emptyFocus(editable)).toEqual({ row: 0, col: 0 });
  });

  it('Enter starts edit, then commits to the next row same column', () => {
    expect(resolveGridKey({
      key: 'Enter', editing: false, rowCount: 3, colCount: 4, focus: { row: 0, col: 2 }, editableCols: editable,
    })).toEqual({ type: 'startEdit' });

    expect(resolveGridKey({
      key: 'Enter', editing: true, rowCount: 3, colCount: 4, focus: { row: 0, col: 2 }, editableCols: editable,
    })).toEqual({ type: 'commitEdit', next: { row: 1, col: 2 } });
  });

  it('Enter on last row requests append', () => {
    expect(resolveGridKey({
      key: 'Enter', editing: true, rowCount: 2, colCount: 4, focus: { row: 1, col: 2 }, editableCols: editable,
    })).toEqual({ type: 'commitEdit', next: { row: 1, col: 2 }, appendRow: true });
  });

  it('Tab moves across editable columns and wraps to next row', () => {
    expect(resolveGridKey({
      key: 'Tab', editing: false, rowCount: 3, colCount: 4, focus: { row: 0, col: 0 }, editableCols: editable,
    })).toEqual({ type: 'move', focus: { row: 0, col: 2 } });

    expect(resolveGridKey({
      key: 'Tab', editing: false, rowCount: 3, colCount: 4, focus: { row: 0, col: 3 }, editableCols: editable,
    })).toEqual({ type: 'move', focus: { row: 1, col: 0 } });
  });

  it('Arrow keys move when not editing', () => {
    expect(resolveGridKey({
      key: 'ArrowDown', editing: false, rowCount: 3, colCount: 4, focus: { row: 0, col: 1 }, editableCols: editable,
    })).toEqual({ type: 'move', focus: { row: 1, col: 1 } });

    expect(resolveGridKey({
      key: 'ArrowDown', editing: true, rowCount: 3, colCount: 4, focus: { row: 0, col: 1 }, editableCols: editable,
    })).toEqual({ type: 'none' });
  });

  it('Escape cancels edit', () => {
    expect(resolveGridKey({
      key: 'Escape', editing: true, rowCount: 2, colCount: 4, focus: { row: 0, col: 0 }, editableCols: editable,
    })).toEqual({ type: 'cancelEdit' });
  });

  it('printable key starts edit on editable cell', () => {
    expect(resolveGridKey({
      key: '5', editing: false, rowCount: 2, colCount: 4, focus: { row: 0, col: 2 }, editableCols: editable,
    })).toEqual({ type: 'startEdit' });
  });
});
