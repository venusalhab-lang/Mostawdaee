import type { Currency, InvoiceItem } from '../types';
import { formatMoney } from './exchangeRates';
import { isPackLine, lineQuantityText } from './packs';

export const CUSTOMER_DISPLAY_HASH = '#/customer-display';
export const CUSTOMER_DISPLAY_CHANNEL = 'mostawdaee-customer-display-v1';
export const CUSTOMER_DISPLAY_STORAGE_KEY = 'mostawdaee_customer_display_snapshot_v1';

export type CustomerDisplayStatus = 'idle' | 'cart' | 'paid';

export type CustomerDisplayLine = {
  key: string;
  description: string;
  quantityLabel: string;
  unitPrice: number;
  total: number;
};

export type CustomerDisplaySnapshot = {
  v: 1;
  updatedAt: number;
  status: CustomerDisplayStatus;
  language: 'ar' | 'en';
  businessName: string;
  currency: Currency;
  lines: CustomerDisplayLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  /** Present briefly after a cash sale. */
  changeDue?: number;
  storeKey?: string;
};

export function isCustomerDisplayHash(hash = typeof window !== 'undefined' ? window.location.hash : ''): boolean {
  const path = hash.replace(/^#/, '').split('?')[0].replace(/^\//, '').replace(/\/$/, '');
  return path === 'customer-display';
}

export function customerDisplayUrl(): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${CUSTOMER_DISPLAY_HASH}`;
}

function isSnapshot(value: unknown): value is CustomerDisplaySnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as CustomerDisplaySnapshot;
  return s.v === 1 && typeof s.updatedAt === 'number' && Array.isArray(s.lines) && typeof s.total === 'number';
}

export function readCustomerDisplaySnapshot(): CustomerDisplaySnapshot | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_DISPLAY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCustomerDisplaySnapshot(snapshot: CustomerDisplaySnapshot): void {
  try {
    localStorage.setItem(CUSTOMER_DISPLAY_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
}

export function publishCustomerDisplay(snapshot: CustomerDisplaySnapshot): void {
  writeCustomerDisplaySnapshot(snapshot);
  try {
    const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    channel.postMessage(snapshot);
    channel.close();
  } catch {
    /* BroadcastChannel unavailable — storage + storage event still help same-origin tabs */
  }
  try {
    // storage event does not fire in the writing tab; other windows still get it.
    localStorage.setItem(`${CUSTOMER_DISPLAY_STORAGE_KEY}:ping`, String(snapshot.updatedAt));
  } catch {
    /* ignore */
  }
}

export function subscribeCustomerDisplay(onSnapshot: (snapshot: CustomerDisplaySnapshot) => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    channel.onmessage = (event) => {
      if (isSnapshot(event.data)) onSnapshot(event.data);
    };
  } catch {
    channel = null;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === CUSTOMER_DISPLAY_STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue) as unknown;
        if (isSnapshot(parsed)) onSnapshot(parsed);
      } catch {
        /* ignore */
      }
      return;
    }
    if (event.key === `${CUSTOMER_DISPLAY_STORAGE_KEY}:ping`) {
      const latest = readCustomerDisplaySnapshot();
      if (latest) onSnapshot(latest);
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener('storage', onStorage);
    try {
      channel?.close();
    } catch {
      /* ignore */
    }
  };
}

export function buildCustomerDisplayLines(items: InvoiceItem[], language: 'ar' | 'en'): CustomerDisplayLine[] {
  const isRtl = language === 'ar';
  return items.map((item, index) => ({
    key: `${item.productId}:${isPackLine(item) ? 'p' : 'u'}:${index}`,
    description: item.description || (isRtl ? 'صنف' : 'Item'),
    quantityLabel: lineQuantityText(item, isRtl),
    unitPrice: Number(item.unitPrice) || 0,
    total: Number(item.total) || 0,
  }));
}

export function idleCustomerDisplaySnapshot(partial: {
  language: 'ar' | 'en';
  businessName: string;
  currency: Currency;
  storeKey?: string;
}): CustomerDisplaySnapshot {
  return {
    v: 1,
    updatedAt: Date.now(),
    status: 'idle',
    language: partial.language,
    businessName: partial.businessName,
    currency: partial.currency,
    lines: [],
    itemCount: 0,
    subtotal: 0,
    discount: 0,
    taxAmount: 0,
    total: 0,
    storeKey: partial.storeKey,
  };
}

/** Prefer the secondary monitor when the Window Management API is available. */
export async function openCustomerDisplayWindow(): Promise<Window | null> {
  const url = customerDisplayUrl();
  const features = 'popup=yes,noopener=yes,noreferrer=yes';
  const popup = window.open(url, 'mostawdaee-customer-display', features);
  if (!popup) return null;

  try {
    const getScreenDetails = (window as Window & {
      getScreenDetails?: () => Promise<{
        currentScreen: { left: number; top: number; width: number; height: number; availLeft: number; availTop: number; availWidth: number; availHeight: number };
        screens: Array<{ left: number; top: number; width: number; height: number; availLeft: number; availTop: number; availWidth: number; availHeight: number; isPrimary?: boolean }>;
      }>;
    }).getScreenDetails;

    if (typeof getScreenDetails === 'function') {
      const details = await getScreenDetails.call(window);
      const current = details.currentScreen;
      const secondary =
        details.screens.find((s) => s.availLeft !== current.availLeft || s.availTop !== current.availTop) ||
        details.screens.find((s) => s.isPrimary === false) ||
        details.screens[1];
      if (secondary) {
        popup.moveTo(secondary.availLeft, secondary.availTop);
        popup.resizeTo(secondary.availWidth, secondary.availHeight);
      }
    }
  } catch {
    /* permission denied or unsupported — cashier can drag the window */
  }

  try {
    popup.focus();
  } catch {
    /* ignore */
  }
  return popup;
}

export function formatCustomerMoney(amount: number, currency: Currency, language: 'ar' | 'en'): string {
  return formatMoney(amount, currency, language === 'ar' ? 'ar' : 'en-US');
}
