import React from 'react';

/** Beyond this many hidden rows a single "show all" click would freeze low-end devices. */
const SHOW_ALL_MAX = 500;

interface ShowMoreBarProps {
  isRtl: boolean;
  shown: number;
  total: number;
  pageSize: number;
  onMore: () => void;
  onAll: () => void;
  className?: string;
}

export default function ShowMoreBar({ isRtl, shown, total, pageSize, onMore, onAll, className = '' }: ShowMoreBarProps) {
  if (total <= shown) return null;
  const next = Math.min(pageSize, total - shown);
  return (
    <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 py-3 text-xs font-bold text-slate-500 ${className}`}>
      <span>{isRtl ? `عرض ${shown} من ${total}` : `Showing ${shown} of ${total}`}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMore}
          className="px-4 py-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/50 cursor-pointer"
        >
          {isRtl ? `عرض ${next} إضافي` : `Show ${next} more`}
        </button>
        {total - shown <= SHOW_ALL_MAX && <button
          type="button"
          onClick={onAll}
          className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 cursor-pointer"
        >
          {isRtl ? 'عرض الكل' : 'Show all'}
        </button>}
      </div>
    </div>
  );
}
