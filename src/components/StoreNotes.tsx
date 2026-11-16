import { useEffect, useMemo, useState } from 'react';
import {
  Bell, Link2, NotebookPen, Pin, Plus, Search, StickyNote, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Language, StoreNote, StoreNoteKind, StoreNoteLinkType } from '../types';
import { useFirebase } from './FirebaseProvider';
import {
  STORE_NOTE_BODY_MAX,
  STORE_NOTE_KINDS,
  STORE_NOTE_TITLE_MAX,
  canEditStoreNote,
  filterStoreNotes,
  localToday,
  noteIsDue,
  noteKindLabel,
  validateStoreNoteInput,
} from '../lib/storeNotes';
import { useStoreNoteIntent } from '../lib/noteIntent';

interface Props {
  language: Language;
}

type KindFilter = StoreNoteKind | 'ALL';

interface Draft {
  id?: string;
  title: string;
  body: string;
  kind: StoreNoteKind;
  linkType: StoreNoteLinkType;
  linkId: string;
  linkName: string;
  remindAt: string;
  pinned: boolean;
}

const emptyDraft = (): Draft => ({
  title: '',
  body: '',
  kind: 'general',
  linkType: 'none',
  linkId: '',
  linkName: '',
  remindAt: '',
  pinned: false,
});

function newNoteId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatWhen(iso: string, isRtl: boolean): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  return new Date(at).toLocaleString(isRtl ? 'ar' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function StoreNotes({ language }: Props) {
  const isRtl = language === 'ar';
  const {
    storeNotes, customers, suppliers, user, can, saveStoreNote, deleteStoreNote,
  } = useFirebase();
  const canManage = can('delete_records');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('ALL');
  const [dueOnly, setDueOnly] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const today = localToday();

  useStoreNoteIntent((intent) => {
    setDraft({
      ...emptyDraft(),
      kind: intent.linkType === 'customer' ? 'debt' : 'ops',
      linkType: intent.linkType,
      linkId: intent.linkId,
      linkName: intent.linkName,
    });
    setComposerOpen(true);
  });

  const visible = useMemo(
    () => filterStoreNotes(storeNotes, { query, kind, dueOnly, today }),
    [storeNotes, query, kind, dueOnly, today],
  );
  const dueCount = useMemo(
    () => storeNotes.filter((n) => noteIsDue(n, today)).length,
    [storeNotes, today],
  );

  const L = (ar: string, en: string) => (isRtl ? ar : en);

  const openCreate = () => {
    setDraft(emptyDraft());
    setComposerOpen(true);
  };

  const openEdit = (note: StoreNote) => {
    if (!canEditStoreNote(note, user?.uid, canManage)) {
      toast.error(L('هذه الملاحظة للقراءة فقط لحسابك.', 'This note is read-only for your account.'));
      return;
    }
    setDraft({
      id: note.id,
      title: note.title || '',
      body: note.body,
      kind: note.kind,
      linkType: note.linkType,
      linkId: note.linkId || '',
      linkName: note.linkName || '',
      remindAt: note.remindAt || '',
      pinned: !!note.pinned,
    });
    setComposerOpen(true);
  };

  const applyLink = (type: StoreNoteLinkType, id: string) => {
    if (type === 'none' || !id) {
      setDraft((d) => ({ ...d, linkType: 'none', linkId: '', linkName: '' }));
      return;
    }
    if (type === 'customer') {
      const c = customers.find((row) => row.id === id);
      setDraft((d) => ({
        ...d,
        linkType: 'customer',
        linkId: id,
        linkName: c?.name || d.linkName,
        kind: d.kind === 'general' ? 'debt' : d.kind,
      }));
      return;
    }
    const s = suppliers.find((row) => row.id === id);
    setDraft((d) => ({
      ...d,
      linkType: 'supplier',
      linkId: id,
      linkName: s?.name || d.linkName,
      kind: d.kind === 'general' ? 'ops' : d.kind,
    }));
  };

  const handleSave = async () => {
    const invalid = validateStoreNoteInput({
      title: draft.title,
      body: draft.body,
      kind: draft.kind,
      remindAt: draft.remindAt || null,
    });
    if (invalid === 'body_short') {
      toast.error(L('اكتب جملة مفيدة على الأقل.', 'Write at least a short useful sentence.'));
      return;
    }
    if (invalid) {
      toast.error(L('تحقق من الحقول قبل الحفظ.', 'Check the fields before saving.'));
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const note: StoreNote = {
        id: draft.id || newNoteId(),
        title: draft.title.trim(),
        body: draft.body.trim(),
        kind: draft.kind,
        linkType: draft.linkType,
        linkId: draft.linkType === 'none' ? undefined : draft.linkId || undefined,
        linkName: draft.linkType === 'none' ? undefined : draft.linkName.trim() || undefined,
        remindAt: draft.remindAt || null,
        pinned: draft.pinned,
        createdAt: now,
        updatedAt: now,
        createdBy: user?.uid || '',
        createdByName: user?.displayName || user?.email || (isRtl ? 'مستخدم' : 'User'),
      };
      await saveStoreNote(note);
      toast.success(draft.id ? L('تم تحديث الملاحظة.', 'Note updated.') : L('تم حفظ الملاحظة.', 'Note saved.'));
      setComposerOpen(false);
      setDraft(emptyDraft());
    } catch (error: any) {
      toast.error(error?.message || L('تعذّر الحفظ.', 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (note: StoreNote) => {
    if (!canEditStoreNote(note, user?.uid, canManage)) {
      toast.error(L('لا يمكنك حذف ملاحظة زميل.', 'You cannot delete a colleague’s note.'));
      return;
    }
    const ok = window.confirm(L('حذف هذه الملاحظة؟', 'Delete this note?'));
    if (!ok) return;
    setDeletingId(note.id);
    try {
      await deleteStoreNote(note.id);
      toast.success(L('حُذفت الملاحظة.', 'Note deleted.'));
      if (draft.id === note.id) {
        setComposerOpen(false);
        setDraft(emptyDraft());
      }
    } catch (error: any) {
      toast.error(error?.message || L('تعذّر الحذف.', 'Could not delete.'));
    } finally {
      setDeletingId(null);
    }
  };

  const togglePin = async (note: StoreNote) => {
    if (!canEditStoreNote(note, user?.uid, canManage)) return;
    try {
      await saveStoreNote({ ...note, pinned: !note.pinned, updatedAt: new Date().toISOString() });
    } catch (error: any) {
      toast.error(error?.message || L('تعذّر التثبيت.', 'Could not update pin.'));
    }
  };

  useEffect(() => {
    if (!composerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setComposerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composerOpen]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 p-4 sm:p-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-1">
            <NotebookPen size={18} />
            <span className="text-[11px] font-black uppercase tracking-[0.18em]">
              {L('سجل المتجر', 'Store log')}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            {L('الملاحظات والتسجيل الحر', 'Notes & free log')}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-xl">
            {L(
              'سجّل ما يهم اليوم: وعد تحصيل، نقص رف، أو تذكير تشغيلي. لا يغيّر المخزون أو الديون.',
              'Log what matters today: a collection promise, a shelf gap, or an ops reminder. This never changes stock or debts.',
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-lg shadow-indigo-600/20 transition-colors"
        >
          <Plus size={16} />
          {L('ملاحظة جديدة', 'New note')}
        </button>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={L('ابحث في النص أو الاسم أو الكاتب…', 'Search text, name, or author…')}
            className="w-full h-11 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ps-10 pe-3 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDueOnly((v) => !v)}
            className={`h-10 px-3 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors ${
              dueOnly
                ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-200'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Bell size={13} />
            {L('مستحق اليوم', 'Due today')}
            {dueCount > 0 && (
              <span className="min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] leading-5 text-center">
                {dueCount}
              </span>
            )}
          </button>
          {(['ALL', ...STORE_NOTE_KINDS] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`h-10 px-3 rounded-xl text-xs font-bold border transition-colors ${
                kind === k
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {k === 'ALL' ? L('الكل', 'All') : noteKindLabel(k, isRtl)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {visible.length === 0 ? (
          <div className="h-full min-h-[240px] rounded-[1.75rem] border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 flex flex-col items-center justify-center text-center px-6">
            <StickyNote className="text-slate-300 dark:text-slate-600 mb-3" size={40} />
            <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">
              {storeNotes.length === 0
                ? L('لا ملاحظات بعد', 'No notes yet')
                : L('لا نتائج لهذا التصفية', 'Nothing matches this filter')}
            </h2>
            <p className="mt-1 text-sm text-slate-500 max-w-sm">
              {storeNotes.length === 0
                ? L('ابدأ بجملة قصيرة عما يحتاج المتابعة اليوم.', 'Start with a short line about what needs follow-up today.')
                : L('جرّب مسح البحث أو إلغاء «مستحق اليوم».', 'Clear the search or turn off Due today.')}
            </p>
            {storeNotes.length === 0 && (
              <button
                type="button"
                onClick={openCreate}
                className="mt-4 h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold"
              >
                {L('اكتب أول ملاحظة', 'Write the first note')}
              </button>
            )}
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((note) => {
              const editable = canEditStoreNote(note, user?.uid, canManage);
              const due = noteIsDue(note, today);
              return (
                <li
                  key={note.id}
                  className={`rounded-3xl border bg-white dark:bg-slate-900/80 p-4 flex flex-col gap-3 shadow-sm ${
                    due
                      ? 'border-amber-300/80 dark:border-amber-700/60'
                      : 'border-slate-100 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {noteKindLabel(note.kind, isRtl)}
                        </span>
                        {note.pinned && (
                          <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-1">
                            <Pin size={11} /> {L('مثبّت', 'Pinned')}
                          </span>
                        )}
                        {due && (
                          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                            <Bell size={11} /> {L('تذكير مستحق', 'Reminder due')}
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-slate-900 dark:text-white truncate">
                        {note.title || L('بدون عنوان', 'Untitled')}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {editable && (
                        <button
                          type="button"
                          onClick={() => void togglePin(note)}
                          className="p-2 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                          aria-label={L('تثبيت', 'Pin')}
                        >
                          <Pin size={14} className={note.pinned ? 'fill-current text-indigo-600' : ''} />
                        </button>
                      )}
                      {editable && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(note)}
                          disabled={deletingId === note.id}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
                          aria-label={L('حذف', 'Delete')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openEdit(note)}
                    className="text-start text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap line-clamp-5 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    {note.body}
                  </button>

                  <div className="mt-auto pt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    {note.linkType !== 'none' && note.linkName && (
                      <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                        <Link2 size={11} />
                        {note.linkName}
                      </span>
                    )}
                    <span>{note.createdByName}</span>
                    <span>{formatWhen(note.updatedAt || note.createdAt, isRtl)}</span>
                    {note.remindAt && (
                      <span className={due ? 'text-amber-600 dark:text-amber-300 font-semibold' : ''}>
                        {L('تذكير', 'Remind')} {note.remindAt}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {composerOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
            aria-label={L('إغلاق', 'Close')}
            onClick={() => setComposerOpen(false)}
          />
          <div className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                {draft.id ? L('تعديل ملاحظة', 'Edit note') : L('ملاحظة جديدة', 'New note')}
              </h2>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                aria-label={L('إغلاق', 'Close')}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  {L('العنوان (اختياري)', 'Title (optional)')}
                </span>
                <input
                  value={draft.title}
                  maxLength={STORE_NOTE_TITLE_MAX}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  className="mt-1 w-full h-11 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30"
                  placeholder={L('مثال: وعد تحصيل الغد', 'e.g. Collection promise tomorrow')}
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  {L('النص', 'Body')}
                </span>
                <textarea
                  value={draft.body}
                  maxLength={STORE_NOTE_BODY_MAX}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  rows={5}
                  className="mt-1 w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 resize-y min-h-[120px]"
                  placeholder={L('اكتب ما يجب متابعته بوضوح…', 'Write clearly what should be followed up…')}
                  autoFocus
                />
              </label>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {L('النوع', 'Kind')}
                  </span>
                  <select
                    value={draft.kind}
                    onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as StoreNoteKind }))}
                    className="mt-1 w-full h-11 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm outline-none"
                  >
                    {STORE_NOTE_KINDS.map((k) => (
                      <option key={k} value={k}>{noteKindLabel(k, isRtl)}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {L('تذكير بتاريخ', 'Remind on date')}
                  </span>
                  <input
                    type="date"
                    value={draft.remindAt}
                    onChange={(e) => setDraft((d) => ({ ...d, remindAt: e.target.value }))}
                    className="mt-1 w-full h-11 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm outline-none"
                  />
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {L('ربط بـ', 'Link to')}
                  </span>
                  <select
                    value={draft.linkType}
                    onChange={(e) => {
                      const next = e.target.value as StoreNoteLinkType;
                      if (next === 'none') applyLink('none', '');
                      else setDraft((d) => ({ ...d, linkType: next, linkId: '', linkName: '' }));
                    }}
                    className="mt-1 w-full h-11 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm outline-none"
                  >
                    <option value="none">{L('بدون ربط', 'No link')}</option>
                    <option value="customer">{L('عميل', 'Customer')}</option>
                    <option value="supplier">{L('مورد', 'Supplier')}</option>
                  </select>
                </label>
                {draft.linkType === 'customer' && (
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      {L('العميل', 'Customer')}
                    </span>
                    <select
                      value={draft.linkId}
                      onChange={(e) => applyLink('customer', e.target.value)}
                      className="mt-1 w-full h-11 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm outline-none"
                    >
                      <option value="">{L('اختر…', 'Choose…')}</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {draft.linkType === 'supplier' && (
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      {L('المورد', 'Supplier')}
                    </span>
                    <select
                      value={draft.linkId}
                      onChange={(e) => applyLink('supplier', e.target.value)}
                      className="mt-1 w-full h-11 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm outline-none"
                    >
                      <option value="">{L('اختر…', 'Choose…')}</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.pinned}
                  onChange={(e) => setDraft((d) => ({ ...d, pinned: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                {L('تثبيت أعلى القائمة', 'Pin to top')}
              </label>
            </div>

            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="h-11 px-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300"
              >
                {L('إلغاء', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="h-11 px-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-bold"
              >
                {saving ? L('جارٍ الحفظ…', 'Saving…') : L('حفظ الملاحظة', 'Save note')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
