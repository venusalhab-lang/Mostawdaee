import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Package, Landmark, CloudOff, PauseCircle, Crown, CalendarClock } from 'lucide-react';
import { useFirebase } from './FirebaseProvider';
import { belongsToStore, OFFLINE_QUEUE_EVENT, readQueue } from '../lib/offlineQueue';
import { parkedHeldBills, readHeldBills } from '../lib/heldBills';
import { loadCheques } from '../lib/chequesStore';
import { localToday } from '../lib/cheques';
import {
  buildStoreNotices,
  noticeDetail,
  noticeTitle,
  noticesBadgeCount,
  type StoreNotice,
  type StoreNoticeKind,
} from '../lib/storeNotifications';
import { sounds } from '../lib/sounds';
import type { Cheque } from '../types';

interface Props {
  isRtl: boolean;
  subscriptionDaysRemaining?: number | null;
  onNavigate?: (screen: string) => void;
}

function kindIcon(kind: StoreNoticeKind) {
  switch (kind) {
    case 'stock_out':
    case 'stock_low':
    case 'expiry_past':
    case 'expiry_soon':
      return Package;
    case 'cheque_overdue':
    case 'cheque_soon':
      return Landmark;
    case 'offline_sales':
      return CloudOff;
    case 'held_bills':
      return PauseCircle;
    case 'subscription_soon':
      return Crown;
    default:
      return CalendarClock;
  }
}

function severityTone(severity: StoreNotice['severity']): { dot: string; icon: string } {
  if (severity === 'critical') {
    return { dot: 'bg-rose-600', icon: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' };
  }
  if (severity === 'attention') {
    return { dot: 'bg-amber-500', icon: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' };
  }
  return { dot: 'bg-slate-400', icon: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
}

export default function NotificationCenter({ isRtl, subscriptionDaysRemaining = null, onNavigate }: Props) {
  const { products, settings, user, workspace, canOpenScreen } = useFirebase();
  const [open, setOpen] = useState(false);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [offlinePending, setOfflinePending] = useState(0);
  const [heldParked, setHeldParked] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshDevice = () => {
    const uid = user?.uid;
    if (!uid) {
      setOfflinePending(0);
      setHeldParked(0);
      return;
    }
    const ownerId = workspace?.ownerId;
    const queue = readQueue(uid);
    setOfflinePending(ownerId ? queue.filter((entry) => belongsToStore(entry, ownerId)).length : queue.length);
    setHeldParked(parkedHeldBills(readHeldBills(uid)).length);
  };

  useEffect(() => {
    refreshDevice();
    const onQueue = (event: Event) => {
      const detailUid = (event as CustomEvent<{ uid?: string }>).detail?.uid;
      if (!detailUid || detailUid === user?.uid) refreshDevice();
    };
    window.addEventListener(OFFLINE_QUEUE_EVENT, onQueue);
    window.addEventListener('storage', refreshDevice);
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, onQueue);
      window.removeEventListener('storage', refreshDevice);
    };
  }, [user?.uid, workspace?.ownerId]);

  useEffect(() => {
    let cancelled = false;
    const uid = user?.uid;
    if (!uid || user?.isAnonymous) {
      setCheques([]);
      return;
    }
    loadCheques(uid)
      .then((rows) => {
        if (!cancelled) setCheques(rows);
      })
      .catch(() => {
        if (!cancelled) setCheques([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.isAnonymous, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const notices = useMemo(() => {
    const all = buildStoreNotices({
      products: products || [],
      lowStockDefault: settings?.lowStockThreshold,
      cheques,
      today: localToday(),
      offlinePending,
      heldParked,
      subscriptionDaysRemaining,
    });
    // Cashier (and other roles) must only see notices they can open — otherwise the tap looks broken.
    return all.filter((item) => !item.screen || canOpenScreen(item.screen));
  }, [products, settings?.lowStockThreshold, cheques, offlinePending, heldParked, subscriptionDaysRemaining, canOpenScreen]);

  const badge = noticesBadgeCount(notices);

  const openItem = (item: StoreNotice) => {
    sounds.playClick();
    setOpen(false);
    if (!item.screen) return;
    if (!canOpenScreen(item.screen)) return;
    if (onNavigate) onNavigate(item.screen);
    else window.dispatchEvent(new CustomEvent('change-screen', { detail: item.screen }));
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          sounds.playClick();
          setOpen((v) => !v);
          refreshDevice();
        }}
        className="relative flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition active:scale-95 cursor-pointer shrink-0"
        title={isRtl ? 'التنبيهات' : 'Notices'}
        aria-label={isRtl ? 'التنبيهات' : 'Notices'}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell className="w-4 h-4 sm:w-[18px] sm:h-[18px]" strokeWidth={2.25} />
        {badge > 0 && (
          <span className="absolute -top-0.5 -end-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-slate-900 dark:bg-cyan-700 text-white text-[9px] font-bold flex items-center justify-center leading-none tabular-nums">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={isRtl ? 'مركز التنبيهات' : 'Notice centre'}
          className={`absolute top-full mt-2 w-[min(22rem,calc(100vw-1.5rem))] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden z-50 ${
            isRtl ? 'left-0' : 'right-0'
          }`}
        >
          <div className="px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
                  {isRtl ? 'التنبيهات' : 'Notices'}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 leading-snug">
                  {isRtl
                    ? 'ملخص قابل للتحقق من دفاتر المتجر على هذا الجهاز'
                    : 'Verifiable summary from this store’s books on this device'}
                </p>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-slate-500 dark:text-slate-400 tabular-nums border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-0.5 bg-white dark:bg-slate-900">
                {badge}
              </span>
            </div>
          </div>

          <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
            {notices.length === 0 ? (
              <div className="px-5 py-11 text-center space-y-1.5">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {isRtl ? 'لا توجد تنبيهات الآن' : 'No notices right now'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-[16rem] mx-auto">
                  {isRtl
                    ? 'المخزون والشيكات والمزامنة ضمن الحدود المعتادة.'
                    : 'Stock, cheques and sync are within the usual limits.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {notices.map((item) => {
                  const Icon = kindIcon(item.kind);
                  const tone = severityTone(item.severity);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className="w-full text-start px-4 py-3.5 flex gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer bg-transparent"
                      >
                        <span className="relative mt-0.5 shrink-0">
                          <span className={`absolute -top-0.5 ${isRtl ? '-left-0.5' : '-right-0.5'} w-2 h-2 rounded-full ring-2 ring-white dark:ring-slate-900 ${tone.dot}`} />
                          <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${tone.icon}`}>
                            <Icon className="w-4 h-4" strokeWidth={2.25} />
                          </span>
                        </span>
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="block text-sm font-bold text-slate-900 dark:text-white leading-snug">
                            {noticeTitle(item, isRtl)}
                          </span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            {noticeDetail(item, isRtl)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {notices.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500 font-medium bg-slate-50/60 dark:bg-slate-950/40">
              {isRtl ? 'اضغط عنصراً للانتقال إلى الشاشة المعنية.' : 'Tap an item to open the related screen.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
