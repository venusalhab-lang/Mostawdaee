import { describe, expect, it } from 'vitest';
import type { StoreNote } from '../../types';
import {
  canEditStoreNote,
  filterStoreNotes,
  localToday,
  normalizeStoreNote,
  noteIsDue,
  sortStoreNotes,
  validateStoreNoteInput,
} from '../storeNotes';

const note = (patch: Partial<StoreNote> & Pick<StoreNote, 'id' | 'body'>): StoreNote => ({
  title: '',
  kind: 'general',
  linkType: 'none',
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  createdBy: 'u1',
  createdByName: 'Amina',
  ...patch,
});

describe('storeNotes', () => {
  it('rejects empty or tiny bodies', () => {
    expect(validateStoreNoteInput({ body: ' ' })).toBe('body_short');
    expect(validateStoreNoteInput({ body: 'x' })).toBe('body_short');
    expect(validateStoreNoteInput({ body: 'ok' })).toBeNull();
  });

  it('normalizes and drops invalid rows', () => {
    expect(normalizeStoreNote({ id: 'n1', body: 'x' })).toBeNull();
    expect(normalizeStoreNote({
      id: 'n1',
      body: '  Follow up Ali  ',
      kind: 'debt',
      linkType: 'customer',
      linkId: 'c1',
      linkName: 'Ali',
      remindAt: '2026-11-12',
      pinned: true,
      createdBy: 'u1',
      createdByName: 'Amina',
      createdAt: '2026-11-10T10:00:00.000Z',
    })).toMatchObject({
      body: 'Follow up Ali',
      kind: 'debt',
      linkType: 'customer',
      remindAt: '2026-11-12',
      pinned: true,
    });
  });

  it('pins first then newest updated', () => {
    const sorted = sortStoreNotes([
      note({ id: 'a', body: 'a', updatedAt: '2026-11-12T12:00:00.000Z' }),
      note({ id: 'b', body: 'b', pinned: true, updatedAt: '2026-11-11T12:00:00.000Z' }),
      note({ id: 'c', body: 'c', updatedAt: '2026-11-13T12:00:00.000Z' }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('filters by query, kind, due and customer link', () => {
    const rows = [
      note({
        id: '1', body: 'Collect from Ali Friday', kind: 'debt', linkType: 'customer',
        linkId: 'c1', linkName: 'Ali', remindAt: '2026-11-01',
      }),
      note({ id: '2', body: 'Restock tea', kind: 'stock', remindAt: '2099-01-01' }),
      note({ id: '3', body: 'General log', kind: 'general' }),
    ];
    expect(filterStoreNotes(rows, { kind: 'debt' }).map((n) => n.id)).toEqual(['1']);
    expect(filterStoreNotes(rows, { query: 'tea' }).map((n) => n.id)).toEqual(['2']);
    expect(filterStoreNotes(rows, { linkCustomerId: 'c1' }).map((n) => n.id)).toEqual(['1']);
    expect(filterStoreNotes(rows, { dueOnly: true, today: '2026-11-12' }).map((n) => n.id)).toEqual(['1']);
  });

  it('due notes are those with remindAt on or before today', () => {
    const today = localToday(new Date(2026, 10, 12));
    expect(noteIsDue(note({ id: '1', body: 'x', remindAt: '2026-11-12' }), today)).toBe(true);
    expect(noteIsDue(note({ id: '2', body: 'x', remindAt: '2026-11-13' }), today)).toBe(false);
    expect(noteIsDue(note({ id: '3', body: 'x' }), today)).toBe(false);
  });

  it('author or manager may edit; others may not', () => {
    const row = note({ id: '1', body: 'hello', createdBy: 'cashier-1' });
    expect(canEditStoreNote(row, 'cashier-1', false)).toBe(true);
    expect(canEditStoreNote(row, 'cashier-2', false)).toBe(false);
    expect(canEditStoreNote(row, 'cashier-2', true)).toBe(true);
    expect(canEditStoreNote(row, undefined, true)).toBe(false);
  });
});

describe('home tasks notes_due', () => {
  it('surfaces due reminders when notes are provided', async () => {
    const { homeTasks } = await import('../homeTasks');
    const NOW = new Date(2026, 10, 12, 10, 0, 0).getTime();
    const tasks = homeTasks({
      now: NOW,
      storeCurrency: 'JOD',
      products: [],
      cheques: [],
      customers: [],
      customerTransactions: [],
      payroll: [],
      notes: [
        { title: 'Ali', body: 'Collect', remindAt: '2026-11-11' },
        { body: 'Later', remindAt: '2026-11-20' },
      ],
      pendingUploads: 0,
    });
    expect(tasks.find((t) => t.kind === 'notes_due')).toMatchObject({
      count: 1,
      screen: 'notes',
      names: ['Ali'],
    });
  });
});
