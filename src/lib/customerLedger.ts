/** Manual AR increases (no sale invoice) must carry an audit reason. */
export const MANUAL_AR_REASON_MIN = 3;

export type ManualArError = 'reason-required';

/** Fail-closed when increasing customer debt without a real invoice document. */
export function checkManualArIncrease(notes: string): ManualArError | null {
  if (String(notes || '').trim().length < MANUAL_AR_REASON_MIN) return 'reason-required';
  return null;
}

/**
 * Tags a hand-typed debt increase so statements and accounting never read it as a credit sale.
 * Idempotent if the note already starts with a bracket tag.
 */
export function formatManualArNote(notes: string, ar: boolean): string {
  const trimmed = String(notes || '').trim();
  const tag = ar ? '[تسوية رصيد يدوية]' : '[Manual balance adjustment]';
  if (!trimmed) return tag;
  if (/^\s*\[/.test(trimmed)) return trimmed;
  return `${tag} ${trimmed}`;
}
