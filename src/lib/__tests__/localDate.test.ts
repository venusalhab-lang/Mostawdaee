import { describe, it, expect } from 'vitest';
import {
  formatDisplayDate,
  localDayEnd,
  localDayStart,
  localIsoDate,
  parseFlexibleDate,
  timestampForLocalDay,
} from '../localDate';

describe('localDate', () => {
  it('uses the device calendar day, not UTC', () => {
    const lateNight = new Date(2026, 9, 9, 1, 30);
    expect(localIsoDate(lateNight)).toBe('2026-10-09');
  });

  it('covers the whole local day', () => {
    const start = localDayStart('2026-10-09')!;
    const end = localDayEnd('2026-10-09')!;
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(start).getDate()).toBe(9);
    expect(new Date(end).getHours()).toBe(23);
    expect(new Date(end).getDate()).toBe(9);
    expect(new Date(2026, 9, 9, 0, 5).getTime()).toBeGreaterThanOrEqual(start);
    expect(new Date(2026, 9, 9, 23, 58).getTime()).toBeLessThanOrEqual(end);
  });

  it('rejects invalid dates', () => {
    expect(localDayStart('2026-02-30')).toBeNull();
    expect(localDayEnd('')).toBeNull();
    expect(localDayStart('09/10/2026')).toBeNull();
  });

  it('keeps the current time for today and the day start for past days', () => {
    const now = new Date(2026, 9, 9, 14, 0).getTime();
    expect(timestampForLocalDay('2026-10-09', now)).toBe(now);
    expect(timestampForLocalDay('2026-10-01', now)).toBe(new Date(2026, 9, 1).getTime());
    expect(timestampForLocalDay('bad', now)).toBe(now);
  });

  it('formats ISO as day-first display', () => {
    expect(formatDisplayDate('2026-03-09')).toBe('09/03/2026');
    expect(formatDisplayDate('')).toBe('');
    expect(formatDisplayDate('bad')).toBe('');
  });

  it('parses day-first typed dates, not US month-first', () => {
    expect(parseFlexibleDate('09/03/2026')).toBe('2026-03-09');
    expect(parseFlexibleDate('9-3-2026')).toBe('2026-03-09');
    expect(parseFlexibleDate('09032026')).toBe('2026-03-09');
    expect(parseFlexibleDate('2026-03-09')).toBe('2026-03-09');
    expect(parseFlexibleDate('31/02/2026')).toBeNull();
    expect(parseFlexibleDate('')).toBeNull();
  });
});
