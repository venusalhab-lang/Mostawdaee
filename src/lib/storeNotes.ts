import type { StoreNote, StoreNoteKind, StoreNoteLinkType } from '../types';

export const STORE_NOTE_KINDS: readonly StoreNoteKind[] = ['general', 'debt', 'stock', 'ops', 'reminder'];
export const STORE_NOTE_TITLE_MAX = 120;
export const STORE_NOTE_BODY_MAX = 4000;
export const STORE_NOTE_BODY_MIN = 2;

export function isStoreNoteKind(value: unknown): value is StoreNoteKind {
  return typeof value === 'string' && (STORE_NOTE_KINDS as readonly string[]).includes(value);
}

export function noteKindLabel(kind: StoreNoteKind, isRtl: boolean): string {
  switch (kind) {
    case 'debt': return isRtl ? 'دين / تحصيل' : 'Debt / collection';
    case 'stock': return isRtl ? 'مخزون' : 'Stock';
    case 'ops': return isRtl ? 'تشغيل' : 'Operations';
    case 'reminder': return isRtl ? 'تذكير' : 'Reminder';
    default: return isRtl ? 'عامة' : 'General';
  }
}

export function normalizeStoreNote(raw: Partial<StoreNote> & { id: string }): StoreNote | null {
  const body = String(raw.body || '').trim();
  if (!raw.id || body.length < STORE_NOTE_BODY_MIN) return null;
  const kind = isStoreNoteKind(raw.kind) ? raw.kind : 'general';
  const linkType: StoreNoteLinkType = raw.linkType === 'customer' || raw.linkType === 'supplier' ? raw.linkType : 'none';
  const remindAt = raw.remindAt && /^\d{4}-\d{2}-\d{2}$/.test(raw.remindAt) ? raw.remindAt : null;
  const createdAt = String(raw.createdAt || new Date().toISOString());
  return {
    id: String(raw.id),
    title: String(raw.title || '').trim().slice(0, STORE_NOTE_TITLE_MAX),
    body: body.slice(0, STORE_NOTE_BODY_MAX),
    kind,
    linkType,
    linkId: linkType === 'none' ? undefined : (raw.linkId ? String(raw.linkId) : undefined),
    linkName: linkType === 'none' ? undefined : (raw.linkName ? String(raw.linkName).trim() : undefined),
    remindAt,
    pinned: !!raw.pinned,
    createdAt,
    updatedAt: String(raw.updatedAt || createdAt),
    createdBy: String(raw.createdBy || ''),
    createdByName: String(raw.createdByName || '').trim() || '—',
  };
}

export function validateStoreNoteInput(input: {
  title?: string;
  body: string;
  kind?: string;
  remindAt?: string | null;
}): string | null {
  const body = String(input.body || '').trim();
  if (body.length < STORE_NOTE_BODY_MIN) return 'body_short';
  if (body.length > STORE_NOTE_BODY_MAX) return 'body_long';
  if (String(input.title || '').trim().length > STORE_NOTE_TITLE_MAX) return 'title_long';
  if (input.kind != null && !isStoreNoteKind(input.kind)) return 'kind_invalid';
  if (input.remindAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.remindAt)) return 'remind_invalid';
  return null;
}

/** Newest first; pinned notes stay on top. */
export function sortStoreNotes(notes: StoreNote[]): StoreNote[] {
  return [...notes].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
  });
}

export function filterStoreNotes(
  notes: StoreNote[],
  opts: { query?: string; kind?: StoreNoteKind | 'ALL'; linkCustomerId?: string; dueOnly?: boolean; today?: string } = {},
): StoreNote[] {
  const q = (opts.query || '').trim().toLowerCase();
  const today = opts.today || localToday();
  return sortStoreNotes(notes).filter((note) => {
    if (opts.kind && opts.kind !== 'ALL' && note.kind !== opts.kind) return false;
    if (opts.linkCustomerId && !(note.linkType === 'customer' && note.linkId === opts.linkCustomerId)) return false;
    if (opts.dueOnly) {
      if (!note.remindAt || note.remindAt > today) return false;
    }
    if (!q) return true;
    const hay = `${note.title} ${note.body} ${note.linkName || ''} ${note.createdByName}`.toLowerCase();
    return hay.includes(q);
  });
}

export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function noteIsDue(note: StoreNote, today = localToday()): boolean {
  return !!note.remindAt && note.remindAt <= today;
}

/** Author, or anyone who may delete store records (manager/owner). */
export function canEditStoreNote(
  note: StoreNote,
  viewerUid: string | undefined,
  canDeleteRecords: boolean,
): boolean {
  if (!viewerUid) return false;
  if (note.createdBy && note.createdBy === viewerUid) return true;
  return canDeleteRecords;
}
