import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Briefcase, Clock, FileText, Package, Search, Truck, Users, X } from 'lucide-react';
import type { Cheque, Customer, Employee, Invoice, Language, Product } from '../types';
import { useFirebase } from './FirebaseProvider';
import { formatMoney } from '../lib/exchangeRates';
import { CHEQUE_STATUS_LABELS } from '../lib/cheques';
import { loadCheques } from '../lib/chequesStore';
import { normalizeSearchText, pushRecentSearch, rankMatches, RECENT_SEARCHES_KEY } from '../lib/search';
import { requestScreenSearch, type ScreenSearchRequest } from '../lib/screenSearch';
import { readUserCache, writeUserCache } from '../lib/userStorage';
import { arCount } from '../lib/arabicPlural';

const GROUP_LIMIT = 4;
const CHEQUES_REFRESH_MS = 15_000;

type GroupKind = 'products' | 'customers' | 'invoices' | 'cheques' | 'suppliers' | 'employees';

interface SupplierSummary {
  name: string;
  invoiceCount: number;
  lastDate: number;
}

interface Hit {
  key: string;
  title: string;
  titleDir?: 'ltr';
  subtitle: string;
  trailing?: string;
  badge?: { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' };
  request: ScreenSearchRequest;
}

interface Group {
  kind: GroupKind;
  hits: Hit[];
  total: number;
  showAll: ScreenSearchRequest;
}

interface Option {
  key: string;
  run: () => void;
}

interface GlobalSearchProps {
  language: Language;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: (screen: string) => void;
  showShortcutHint: boolean;
}

const GROUP_META: Record<GroupKind, { icon: React.ComponentType<{ size?: number; className?: string }>; ar: string; en: string }> = {
  products: { icon: Package, ar: 'المنتجات', en: 'Products' },
  customers: { icon: Users, ar: 'العملاء', en: 'Customers' },
  invoices: { icon: FileText, ar: 'الفواتير', en: 'Invoices' },
  cheques: { icon: Banknote, ar: 'الشيكات', en: 'Cheques' },
  suppliers: { icon: Truck, ar: 'الموردون', en: 'Suppliers' },
  employees: { icon: Briefcase, ar: 'الموظفون', en: 'Employees' },
};

const BADGE_TONE: Record<NonNullable<Hit['badge']>['tone'], string> = {
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bad: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  muted: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
};

function summarizeSuppliers(invoices: readonly Invoice[]): SupplierSummary[] {
  const byName = new Map<string, SupplierSummary>();
  for (const invoice of invoices) {
    const name = invoice.type === 'purchase' ? invoice.supplierName?.trim() : '';
    if (!name) continue;
    const key = normalizeSearchText(name);
    const existing = byName.get(key);
    if (existing) {
      existing.invoiceCount += 1;
      existing.lastDate = Math.max(existing.lastDate, invoice.date || 0);
    } else {
      byName.set(key, { name, invoiceCount: 1, lastDate: invoice.date || 0 });
    }
  }
  return [...byName.values()].sort((a, b) => b.lastDate - a.lastDate);
}

export default function GlobalSearch({ language, inputRef, onNavigate, showShortcutHint }: GlobalSearchProps) {
  const isRtl = language === 'ar';
  const locale = isRtl ? 'ar' : 'en-US';
  const { products = [], invoices = [], employees = [], customers = [], user, canOpenScreen } = useFirebase();
  const userId = user?.uid || 'guest';

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const chequesLoadedAt = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecent(readUserCache<string[]>(userId, RECENT_SEARCHES_KEY, []));
    setCheques([]);
    chequesLoadedAt.current = 0;
  }, [userId]);

  const refreshCheques = useCallback(async () => {
    if (!canOpenScreen('cheques')) return;
    if (Date.now() - chequesLoadedAt.current < CHEQUES_REFRESH_MS) return;
    chequesLoadedAt.current = Date.now();
    try {
      setCheques(await loadCheques(userId));
    } catch {
      // Cheques are optional here: a missing table or signed-out session just hides the group.
      setCheques([]);
    }
  }, [userId, canOpenScreen]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, []);

  const suppliers = useMemo(() => summarizeSuppliers(invoices), [invoices]);
  const invoicesNewestFirst = useMemo(() => [...invoices].sort((a, b) => (b.date || 0) - (a.date || 0)), [invoices]);

  const buildGroups = useCallback((text: string): Group[] => {
    const raw = text.trim();
    if (!raw) return [];
    const groups: Group[] = [];

    const productMatches = rankMatches<Product>(products, raw, (p) => ({
      primary: p.name,
      codes: [p.sku, p.serialNumber],
      extra: [p.category, p.brand],
    }), GROUP_LIMIT);
    if (productMatches.total) {
      groups.push({
        kind: 'products',
        total: productMatches.total,
        showAll: { screen: 'inventory', query: raw },
        hits: productMatches.items.map((p) => {
          const qty = Number(p.quantity) || 0;
          const low = p.lowStockThreshold ?? 5;
          return {
            key: `p:${p.id}`,
            title: p.name,
            subtitle: [p.sku, p.category].filter(Boolean).join(' · '),
            badge: {
              text: isRtl ? `${qty} قطعة` : `${qty} pcs`,
              tone: qty <= 0 ? 'bad' : qty <= low ? 'warn' : 'ok',
            },
            request: { screen: 'inventory', query: p.sku || p.name },
          };
        }),
      });
    }

    const customerMatches = rankMatches<Customer>(customers, raw, (c) => ({
      primary: c.name,
      codes: [c.customerId],
      phone: c.phone,
    }), GROUP_LIMIT);
    if (customerMatches.total) {
      groups.push({
        kind: 'customers',
        total: customerMatches.total,
        showAll: { screen: 'customers', query: raw },
        hits: customerMatches.items.map((c) => {
          const debt = Number(c.totalDebt) || 0;
          return {
            key: `c:${c.id}`,
            title: c.name,
            subtitle: c.phone || '',
            trailing: debt > 0 ? formatMoney(debt, c.currency, locale) : undefined,
            badge: debt > 0 ? undefined : { text: isRtl ? 'لا ديون' : 'No debt', tone: 'muted' },
            request: { screen: 'customers', query: c.customerId || c.name },
          };
        }),
      });
    }

    const invoiceMatches = rankMatches<Invoice>(invoicesNewestFirst, raw, (i) => ({
      primary: i.customerName || i.supplierName || '',
      codes: [i.invoiceNumber],
      extra: (i.items || []).map((item) => item.description),
    }), GROUP_LIMIT);
    if (invoiceMatches.total) {
      groups.push({
        kind: 'invoices',
        total: invoiceMatches.total,
        showAll: { screen: 'invoices', query: raw },
        hits: invoiceMatches.items.map((i) => {
          const party = i.customerName || i.supplierName || (isRtl ? 'زبون نقدي' : 'Walk-in');
          const date = i.date ? new Date(i.date).toLocaleDateString(locale) : '';
          return {
            key: `i:${i.id}`,
            title: `#${i.invoiceNumber}`,
            titleDir: 'ltr',
            subtitle: [party, date].filter(Boolean).join(' · '),
            trailing: formatMoney(i.totalAmount, i.currency, locale),
            badge: {
              text: i.type === 'sale' ? (isRtl ? 'بيع' : 'Sale') : (isRtl ? 'شراء' : 'Purchase'),
              tone: i.type === 'sale' ? 'ok' : 'muted',
            },
            request: { screen: 'invoices', query: i.invoiceNumber, recordId: i.id },
          };
        }),
      });
    }

    const chequeMatches = rankMatches<Cheque>(cheques, raw, (c) => ({
      primary: c.drawerName || c.contactName,
      codes: [c.chequeNumber],
      extra: [c.bankName, c.contactName, c.endorsedTo, c.notes],
    }), GROUP_LIMIT);
    if (chequeMatches.total) {
      groups.push({
        kind: 'cheques',
        total: chequeMatches.total,
        showAll: { screen: 'cheques', query: raw, chequeType: chequeMatches.items[0].type },
        hits: chequeMatches.items.map((c) => {
          const label = CHEQUE_STATUS_LABELS[c.status];
          return {
            key: `q:${c.id}`,
            title: `#${c.chequeNumber}`,
            titleDir: 'ltr',
            subtitle: [c.bankName, c.drawerName || c.contactName, c.dueDate].filter(Boolean).join(' · '),
            trailing: formatMoney(c.amount, c.currency, locale),
            badge: {
              text: isRtl ? label.ar : label.en,
              tone: c.status === 'cashed' ? 'ok' : c.status === 'bounced' ? 'bad' : c.status === 'pending' ? 'warn' : 'muted',
            },
            request: { screen: 'cheques', query: c.chequeNumber, chequeType: c.type },
          };
        }),
      });
    }

    const supplierMatches = rankMatches<SupplierSummary>(suppliers, raw, (s) => ({ primary: s.name }), GROUP_LIMIT);
    if (supplierMatches.total) {
      groups.push({
        kind: 'suppliers',
        total: supplierMatches.total,
        showAll: { screen: 'invoices', query: raw },
        hits: supplierMatches.items.map((s) => ({
          key: `s:${normalizeSearchText(s.name)}`,
          title: s.name,
          subtitle: isRtl ? arCount(s.invoiceCount, { one: 'فاتورة شراء واحدة', two: 'فاتورتا شراء', few: '{n} فواتير شراء', many: '{n} فاتورة شراء', other: '{n} فاتورة شراء' }) : `${s.invoiceCount} purchase invoice${s.invoiceCount === 1 ? '' : 's'}`,
          request: { screen: 'invoices', query: s.name },
        })),
      });
    }

    const employeeMatches = rankMatches<Employee>(employees, raw, (e) => ({
      primary: e.name,
      extra: [e.role],
      phone: e.contact,
    }), GROUP_LIMIT);
    if (employeeMatches.total) {
      groups.push({
        kind: 'employees',
        total: employeeMatches.total,
        showAll: { screen: 'employees', query: raw },
        hits: employeeMatches.items.map((e) => ({
          key: `e:${e.id}`,
          title: e.name,
          subtitle: e.role || '',
          request: { screen: 'employees', query: e.name },
        })),
      });
    }

    // A role only sees results it can open.
    return groups.filter((group) => canOpenScreen(group.showAll.screen));
  }, [products, customers, invoicesNewestFirst, cheques, suppliers, employees, isRtl, locale, canOpenScreen]);

  const groups = useMemo(() => buildGroups(deferredQuery), [buildGroups, deferredQuery]);
  const totalMatches = groups.reduce((sum, group) => sum + group.total, 0);

  useEffect(() => {
    setActiveIndex(0);
  }, [deferredQuery]);

  const close = () => {
    setOpen(false);
    inputRef.current?.blur();
  };

  const go = (request: ScreenSearchRequest, remember: string) => {
    const nextRecent = pushRecentSearch(recent, remember);
    setRecent(nextRecent);
    writeUserCache(userId, RECENT_SEARCHES_KEY, nextRecent);
    requestScreenSearch(request);
    onNavigate(request.screen);
    setQuery('');
    close();
  };

  const showRecent = open && !query.trim() && recent.length > 0;
  const showResults = open && !!deferredQuery.trim();

  const options: Option[] = [];
  if (showRecent) {
    recent.forEach((item) => options.push({ key: `r:${item}`, run: () => setQuery(item) }));
  } else if (showResults) {
    for (const group of groups) {
      group.hits.forEach((hit) => options.push({ key: hit.key, run: () => go(hit.request, query) }));
      if (group.total > group.hits.length) {
        options.push({ key: `all:${group.kind}`, run: () => go(group.showAll, query) });
      }
    }
  }
  const optionIndex = new Map(options.map((option, index) => [option.key, index]));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (query) setQuery('');
      else close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + step + options.length) % options.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (query.trim() && deferredQuery !== query) {
        // A barcode scanner types and presses Enter faster than the deferred render.
        const fresh = buildGroups(query);
        const first = fresh[0]?.hits[0];
        if (first) go(first.request, query);
        return;
      }
      options[Math.min(activeIndex, options.length - 1)]?.run();
    }
  };

  const optionClass = (key: string) => {
    const active = optionIndex.get(key) === activeIndex;
    return `w-full text-start flex items-center gap-2 px-2 py-2 rounded-xl transition-colors ${
      active ? 'bg-white dark:bg-white/10 shadow-xs' : 'hover:bg-white/70 dark:hover:bg-white/5'
    }`;
  };

  return (
    <div ref={containerRef} className="sidebar-search-container px-4 py-3 border-b border-slate-200/40 dark:border-white/5 relative z-40 bg-white/45 dark:bg-[#0c1221]/15">
      <div className="search-input-wrapper relative flex items-center bg-slate-100/60 dark:bg-slate-900/40 border border-slate-200/60 dark:border-white/5 rounded-xl px-3 py-2.5 group transition-colors focus-within:border-cyan-500 dark:focus-within:border-[#00E5FF] focus-within:ring-1 focus-within:ring-cyan-500/20">
        <Search className="w-4 h-4 text-slate-400 group-focus-within:text-cyan-500 dark:group-focus-within:text-[#00E5FF] shrink-0" />
        <input
          ref={inputRef}
          type="search"
          id="global-search"
          role="combobox"
          aria-expanded={showRecent || showResults}
          aria-controls="search-results-dropdown"
          aria-autocomplete="list"
          enterKeyHint="search"
          value={query}
          onFocus={() => {
            setOpen(true);
            void refreshCheques();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={isRtl ? 'ابحث: منتج، باركود، زبون، فاتورة، شيك…' : 'Search products, barcodes, customers, invoices…'}
          className="w-full !bg-transparent !border-0 !p-0 !rounded-none !shadow-none outline-none text-xs !text-slate-800 dark:!text-white placeholder:text-slate-400 mx-2 font-bold focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
            aria-label={isRtl ? 'مسح البحث' : 'Clear search'}
          >
            <X size={14} />
          </button>
        ) : showShortcutHint && (
          <kbd className="hidden lg:inline text-[10px] font-bold text-slate-400 border border-slate-200 dark:border-white/10 rounded px-1.5 py-0.5" dir="ltr">
            Ctrl K
          </kbd>
        )}
      </div>

      {(showRecent || showResults) && (
        <div
          id="search-results-dropdown"
          ref={listRef}
          role="listbox"
          className="mt-3 max-h-[60vh] overflow-y-auto bg-slate-50/90 dark:bg-black/40 rounded-2xl border border-slate-200/60 dark:border-white/[0.06] p-2 space-y-3 text-[11px]"
        >
          {showRecent && (
            <div className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <span className="font-black text-slate-500 dark:text-slate-400">{isRtl ? 'عمليات بحث سابقة' : 'Recent searches'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setRecent([]);
                    writeUserCache(userId, RECENT_SEARCHES_KEY, []);
                    inputRef.current?.focus();
                  }}
                  className="font-bold text-slate-400 hover:text-rose-500"
                >
                  {isRtl ? 'مسح' : 'Clear'}
                </button>
              </div>
              {recent.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="option"
                  aria-selected={optionIndex.get(`r:${item}`) === activeIndex}
                  data-active={optionIndex.get(`r:${item}`) === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setQuery(item)}
                  className={optionClass(`r:${item}`)}
                >
                  <Clock size={13} className="text-slate-400 shrink-0" />
                  <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{item}</span>
                </button>
              ))}
            </div>
          )}

          {showResults && groups.map((group) => {
            const meta = GROUP_META[group.kind];
            const Icon = meta.icon;
            return (
              <div key={group.kind} className="space-y-1">
                <div className="flex items-center gap-1.5 px-1 font-black text-slate-500 dark:text-slate-400">
                  <Icon size={12} />
                  <span>{isRtl ? meta.ar : meta.en}</span>
                  <span className="font-bold text-slate-400">({group.total})</span>
                </div>
                {group.hits.map((hit) => (
                  <button
                    key={hit.key}
                    type="button"
                    role="option"
                    aria-selected={optionIndex.get(hit.key) === activeIndex}
                    data-active={optionIndex.get(hit.key) === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => go(hit.request, query)}
                    className={optionClass(hit.key)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-slate-800 dark:text-slate-100 truncate" dir={hit.titleDir}>{hit.title}</span>
                      {hit.subtitle && <span className="block text-[10px] text-slate-400 truncate">{hit.subtitle}</span>}
                    </span>
                    <span className="flex flex-col items-end gap-0.5 shrink-0">
                      {hit.trailing && <span className="font-mono font-black text-slate-700 dark:text-slate-200" dir="ltr">{hit.trailing}</span>}
                      {hit.badge && <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${BADGE_TONE[hit.badge.tone]}`}>{hit.badge.text}</span>}
                    </span>
                  </button>
                ))}
                {group.total > group.hits.length && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={optionIndex.get(`all:${group.kind}`) === activeIndex}
                    data-active={optionIndex.get(`all:${group.kind}`) === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => go(group.showAll, query)}
                    className={`${optionClass(`all:${group.kind}`)} justify-center font-bold text-cyan-700 dark:text-[#00E5FF]`}
                  >
                    {isRtl ? `عرض كل النتائج (${group.total})` : `Show all ${group.total} results`}
                  </button>
                )}
              </div>
            );
          })}

          {showResults && totalMatches === 0 && (
            <div className="text-center py-4 font-bold text-slate-400">
              {isRtl ? 'لا توجد نتائج. جرّب جزءاً من الاسم أو الباركود أو رقم الهاتف.' : 'No results. Try part of a name, barcode or phone number.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
