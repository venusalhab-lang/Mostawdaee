import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, Search } from 'lucide-react';
import type { Language } from '../types';
import {
  GUIDE_GROUPS,
  USER_GUIDE_TOPICS,
  type GuideSettingsSection,
  type GuideTopic,
} from '../lib/userGuide';

interface Props {
  language: Language;
  /** Jump to another Settings section without leaving Settings. */
  onOpenSettingsSection?: (section: GuideSettingsSection) => void;
}

function openAppScreen(screen: string) {
  window.dispatchEvent(new CustomEvent('change-screen', { detail: screen }));
}

/** Short task-based user guide under Settings. */
export default function UserGuide({ language, onOpenSettingsSection }: Props) {
  const ar = language === 'ar';
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(USER_GUIDE_TOPICS[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return USER_GUIDE_TOPICS;
    return USER_GUIDE_TOPICS.filter((topic) => {
      const blob = [
        topic.title.ar, topic.title.en, topic.summary.ar, topic.summary.en,
        ...topic.steps.flatMap((s) => [s.ar, s.en]),
        topic.warning?.ar, topic.warning?.en,
      ].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [query]);

  const openTopic = filtered.find((t) => t.id === openId) || filtered[0] || null;

  const go = (topic: GuideTopic) => {
    if (topic.openScreen) {
      openAppScreen(topic.openScreen);
      return;
    }
    if (topic.openSettings && onOpenSettingsSection) {
      onOpenSettingsSection(topic.openSettings);
    }
  };

  const Chevron = ar ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'}>
      <div className="flex items-start gap-3">
        <BookOpen className="text-indigo-600 shrink-0 mt-1" />
        <div className="min-w-0">
          <h2 className="text-2xl font-black text-gray-900 dark:text-white">
            {ar ? 'دليل الاستخدام' : 'User guide'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            {ar
              ? 'خطوات قصيرة للمهام اليومية. للدعم البشري استخدم قسم الدعم الفني.'
              : 'Short steps for daily tasks. For human help, use Support.'}
          </p>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ar ? 'ابحث: آجل، جرد، خزنة…' : 'Search: credit, stocktake, vault…'}
          className="w-full h-11 ps-10 pe-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-bold text-gray-900 dark:text-white outline-none focus:border-indigo-500"
          aria-label={ar ? 'بحث في الدليل' : 'Search the guide'}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm font-bold text-gray-500 py-8 text-center">
          {ar ? 'لا نتائج. جرّب كلمة أخرى.' : 'No matches. Try another word.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <nav className="lg:col-span-2 space-y-4 max-h-[min(70vh,560px)] overflow-y-auto custom-scrollbar pe-1">
            {GUIDE_GROUPS.map((group) => {
              const items = filtered.filter((t) => t.group === group.id);
              if (!items.length) return null;
              return (
                <div key={group.id} className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 px-1">
                    {ar ? group.ar : group.en}
                  </p>
                  {items.map((topic) => {
                    const active = openTopic?.id === topic.id;
                    return (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => setOpenId(topic.id)}
                        className={`w-full text-start px-3 py-2.5 rounded-xl text-sm font-bold transition cursor-pointer flex items-center justify-between gap-2 ${
                          active
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-gray-50 dark:bg-gray-800/60 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="leading-snug">{ar ? topic.title.ar : topic.title.en}</span>
                        <Chevron size={14} className="shrink-0 opacity-70" />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {openTopic && (
            <article className="lg:col-span-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40 p-5 sm:p-6 space-y-4">
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">
                  {ar ? openTopic.title.ar : openTopic.title.en}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1.5 leading-relaxed">
                  {ar ? openTopic.summary.ar : openTopic.summary.en}
                </p>
              </div>

              <ol className="space-y-2.5 list-decimal list-inside text-sm text-gray-800 dark:text-gray-100 font-medium leading-relaxed">
                {(ar ? openTopic.steps.map((s) => s.ar) : openTopic.steps.map((s) => s.en)).map((step, i) => (
                  <li key={i} className="ps-1">{step}</li>
                ))}
              </ol>

              {openTopic.warning && (
                <p className="text-xs font-bold leading-relaxed rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2.5">
                  {ar ? openTopic.warning.ar : openTopic.warning.en}
                </p>
              )}

              {(openTopic.openScreen || (openTopic.openSettings && onOpenSettingsSection)) && (
                <button
                  type="button"
                  onClick={() => go(openTopic)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition cursor-pointer"
                >
                  <ExternalLink size={14} />
                  {openTopic.openScreen
                    ? (ar ? 'فتح الشاشة' : 'Open screen')
                    : (ar ? 'فتح القسم في الإعدادات' : 'Open settings section')}
                </button>
              )}
            </article>
          )}
        </div>
      )}
    </div>
  );
}
