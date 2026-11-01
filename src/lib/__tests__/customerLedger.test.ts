import { describe, expect, it } from 'vitest';
import { checkManualArIncrease, formatManualArNote, MANUAL_AR_REASON_MIN } from '../customerLedger';

describe('customerLedger manual AR', () => {
  it('refuses a debt increase without an audit reason', () => {
    expect(MANUAL_AR_REASON_MIN).toBe(3);
    expect(checkManualArIncrease('')).toBe('reason-required');
    expect(checkManualArIncrease('  ab  ')).toBe('reason-required');
    expect(checkManualArIncrease('old books')).toBeNull();
  });

  it('tags manual adjustments so they are never read as credit sales', () => {
    expect(formatManualArNote('مرحّل من دفتر قديم', true)).toBe('[تسوية رصيد يدوية] مرحّل من دفتر قديم');
    expect(formatManualArNote('brought forward', false)).toBe('[Manual balance adjustment] brought forward');
    expect(formatManualArNote('[Manual balance adjustment] already', false)).toBe('[Manual balance adjustment] already');
  });
});
