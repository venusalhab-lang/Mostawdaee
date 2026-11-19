import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { emptyFocus, resolveGridKey, type GridFocus } from '../../lib/grid/entryGridKeyboard';

export type EntryGridColumn<T> = {
  id: string;
  header: string;
  editable: boolean;
  /** Prefer monospace for qty/money. */
  mono?: boolean;
  align?: 'start' | 'end' | 'center';
  widthClass?: string;
  readValue: (row: T, rowIndex: number) => string;
  /** When editable; commit returns the next row object (or same). */
  commitValue?: (row: T, raw: string, rowIndex: number) => T;
  /** Optional display override when not editing (e.g. computed total). */
  displayValue?: (row: T, rowIndex: number) => string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
};

type Props<T> = {
  rows: T[];
  columns: EntryGridColumn<T>[];
  isRtl?: boolean;
  getRowKey: (row: T, rowIndex: number) => string;
  onRowsChange: (rows: T[]) => void;
  /** Append empty row(s) when Enter/Tab past the last row. */
  onAppendRows?: (count?: number) => void;
  rowError?: (row: T, rowIndex: number) => boolean;
  className?: string;
  'aria-label'?: string;
};

export default function EntryGrid<T>({
  rows,
  columns,
  isRtl = true,
  getRowKey,
  onRowsChange,
  onAppendRows,
  rowError,
  className = '',
  'aria-label': ariaLabel,
}: Props<T>) {
  const tableId = useId();
  const editableCols = columns.map((c) => c.editable);
  const [focus, setFocus] = useState<GridFocus>(() => emptyFocus(editableCols));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());

  const focusKey = (r: number, c: number) => `${r}:${c}`;

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing, focus.row, focus.col]);

  useEffect(() => {
    if (editing) return;
    const el = cellRefs.current.get(focusKey(focus.row, focus.col));
    el?.focus();
  }, [focus.row, focus.col, editing, rows.length]);

  const startEditAt = useCallback((row: number, col: number, seed?: string) => {
    if (!columns[col]?.editable) return;
    const value = seed !== undefined ? seed : columns[col].readValue(rows[row], row);
    setFocus({ row, col });
    setDraft(value);
    setEditing(true);
  }, [columns, rows]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft('');
  }, []);

  const commitEdit = useCallback((next?: GridFocus, appendRow?: boolean) => {
    const col = columns[focus.col];
    if (!col?.editable || !col.commitValue) {
      setEditing(false);
      if (next) setFocus(next);
      if (appendRow) onAppendRows?.(1);
      return;
    }
    const updated = rows.map((row, i) => (i === focus.row ? col.commitValue!(row, draft, i) : row));
    onRowsChange(updated);
    setEditing(false);
    setDraft('');
    if (appendRow) onAppendRows?.(1);
    if (next) setFocus(next);
  }, [columns, draft, focus.col, focus.row, onAppendRows, onRowsChange, rows]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // In RTL, left/right arrows follow visual direction (swap logical column move).
    let key = event.key;
    if (isRtl && key === 'ArrowLeft') key = 'ArrowRight';
    else if (isRtl && key === 'ArrowRight') key = 'ArrowLeft';

    const action = resolveGridKey({
      key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      editing,
      rowCount: rows.length,
      colCount: columns.length,
      focus,
      editableCols,
    });

    if (action.type === 'none') {
      // Allow typing into the input; block grid chrome keys when not editing printable start handled below.
      if (!editing && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && editableCols[focus.col]) {
        event.preventDefault();
        startEditAt(focus.row, focus.col, event.key);
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (action.type === 'startEdit') {
      startEditAt(focus.row, focus.col);
      return;
    }
    if (action.type === 'cancelEdit') {
      cancelEdit();
      return;
    }
    if (action.type === 'move') {
      setFocus(action.focus);
      if (action.startEdit) startEditAt(action.focus.row, action.focus.col);
      return;
    }
    if (action.type === 'commitEdit') {
      commitEdit(action.next, action.appendRow);
    }
  };

  return (
    <div className={`overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10 ${className}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <table
        id={tableId}
        role="grid"
        aria-label={ariaLabel}
        className="w-full text-sm border-collapse"
        onKeyDown={handleKeyDown}
      >
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/80 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <th className="px-2 py-2 font-bold w-10 text-center">#</th>
            {columns.map((col) => (
              <th
                key={col.id}
                className={`px-2 py-2 font-bold ${col.widthClass || ''} ${
                  col.align === 'end' ? 'text-end' : col.align === 'center' ? 'text-center' : 'text-start'
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const err = rowError?.(row, rowIndex);
            return (
              <tr
                key={getRowKey(row, rowIndex)}
                className={`border-t border-slate-100 dark:border-white/5 ${
                  err ? 'bg-rose-50/80 dark:bg-rose-950/30' : 'bg-white dark:bg-slate-900'
                }`}
              >
                <td className="px-2 py-1.5 text-center text-[11px] font-mono text-slate-400">{rowIndex + 1}</td>
                {columns.map((col, colIndex) => {
                  const isFocused = focus.row === rowIndex && focus.col === colIndex;
                  const isEditing = isFocused && editing && col.editable;
                  const shown = col.displayValue
                    ? col.displayValue(row, rowIndex)
                    : col.readValue(row, rowIndex);
                  return (
                    <td
                      key={col.id}
                      role="gridcell"
                      aria-selected={isFocused}
                      tabIndex={isFocused && !isEditing ? 0 : -1}
                      ref={(el) => {
                        const k = focusKey(rowIndex, colIndex);
                        if (el) cellRefs.current.set(k, el);
                        else cellRefs.current.delete(k);
                      }}
                      className={`px-1.5 py-1 ${
                        isFocused ? 'ring-2 ring-inset ring-indigo-500/70' : ''
                      } ${col.mono ? 'font-mono' : ''} ${
                        col.align === 'end' ? 'text-end' : col.align === 'center' ? 'text-center' : 'text-start'
                      }`}
                      onClick={() => {
                        setFocus({ row: rowIndex, col: colIndex });
                        if (col.editable) startEditAt(rowIndex, colIndex);
                      }}
                      onDoubleClick={() => {
                        if (col.editable) startEditAt(rowIndex, colIndex);
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={draft}
                          inputMode={col.inputMode}
                          placeholder={col.placeholder}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitEdit()}
                          className={`w-full min-w-[4rem] rounded-lg bg-white dark:bg-slate-950 border border-indigo-400 px-2 py-1.5 text-sm outline-none ${
                            col.mono ? 'font-mono' : ''
                          } ${col.align === 'end' ? 'text-end' : ''}`}
                        />
                      ) : (
                        <span className={`block px-1 py-1.5 min-h-[2rem] ${shown ? 'text-slate-800 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600'}`}>
                          {shown || (col.placeholder ?? '')}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
