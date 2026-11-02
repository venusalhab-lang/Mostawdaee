import React, { useEffect, useId, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { formatDisplayDate, parseFlexibleDate } from '../../lib/localDate';

type Props = {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  title?: string;
  'aria-label'?: string;
  placeholder?: string;
  /** Compact filter-bar sizing. */
  compact?: boolean;
};

function withinBounds(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

/**
 * Date entry that prefers typing (DD/MM/YYYY) with an optional native calendar button.
 * `value` / `onChange` stay YYYY-MM-DD to match the rest of the app.
 */
export default function DateField({
  value,
  onChange,
  className = '',
  id,
  name,
  required,
  disabled,
  min,
  max,
  title,
  'aria-label': ariaLabel,
  placeholder = '31/12/2026',
  compact,
}: Props) {
  const autoId = useId();
  const fieldId = id || autoId;
  const pickerRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => formatDisplayDate(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(formatDisplayDate(value));
    setInvalid(false);
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setInvalid(false);
      setDraft('');
      if (value) onChange('');
      return;
    }
    const iso = parseFlexibleDate(trimmed);
    if (!iso || !withinBounds(iso, min, max)) {
      setInvalid(true);
      setDraft(formatDisplayDate(value));
      return;
    }
    setInvalid(false);
    setDraft(formatDisplayDate(iso));
    if (iso !== value) onChange(iso);
  };

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el || disabled) return;
    try {
      el.showPicker?.();
    } catch {
      el.click();
    }
  };

  const textSize = compact ? 'text-xs' : 'text-sm';
  // Vertical rhythm comes from `className` on the shell when callers pass py-*;
  // otherwise fall back so bare borders still look like normal fields.
  const shellHasPad = /\bpy-\S+/.test(className);
  const padY = shellHasPad ? 'py-0' : compact ? 'py-1.5' : 'py-2.5';

  return (
    <div className={`relative flex items-stretch ${className}`}>
      <input
        id={fieldId}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        disabled={disabled}
        required={required}
        title={title || (invalid ? undefined : 'DD/MM/YYYY')}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`w-full self-stretch ${padY} pl-3 pr-10 ${textSize} font-mono rounded-[inherit] bg-transparent outline-none text-inherit border-0 ${
          invalid ? 'ring-1 ring-rose-400' : ''
        }`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={openPicker}
        aria-label="Calendar"
        className="absolute inset-y-0 right-0 w-9 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-40"
      >
        <Calendar size={compact ? 14 : 16} />
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        min={min}
        max={max}
        value={value || ''}
        onChange={(e) => {
          const next = e.target.value;
          setInvalid(false);
          setDraft(formatDisplayDate(next));
          onChange(next);
        }}
        className="sr-only"
      />
    </div>
  );
}
