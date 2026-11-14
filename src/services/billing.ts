/**
 * Google Play Billing Service
 * Integration with cordova-plugin-purchase (compatible with Capacitor applications)
 * Activation is always verified by our server against the Google Play Developer API.
 */

export interface DigitalProduct {
  id: string;
  name: string;
  description: string;
  price: string;
  currency: 'JOD' | 'ILS' | 'USD';
  amount: number;
  type: 'subscription' | 'consumable';
}

/**
 * Google Play subscription SKU (must match Play Console exactly).
 * The billed amount is set in Play Console and mirrored below for UI fallbacks only —
 * do not rename the SKU or existing subscribers break.
 */
export const PLAY_PREMIUM_PRODUCT_ID = 'mostawdaee_supscription_169';
/** Display fallback when Play has not returned a localized price yet. Must match Play Console base price. */
export const PLAY_PREMIUM_FALLBACK_PRICE = '$169';
export const PLAY_PREMIUM_AMOUNT_USD = 169;

// Configured products as declared in Google Play Console
export const PLAY_STORE_PRODUCTS: DigitalProduct[] = [
  {
    id: PLAY_PREMIUM_PRODUCT_ID,
    name: 'Mostawdaee Premium (Annual)',
    description: '1-Year Unified premium commercial access, auto-backups and mobile dashboard access.',
    price: '$169.00',
    currency: 'USD',
    amount: PLAY_PREMIUM_AMOUNT_USD,
    type: 'subscription'
  }
];

export interface ProcessedTransaction {
  productId: string;
  transactionId: string;
  purchaseToken: string;
  currency: 'JOD' | 'ILS' | 'USD';
  amount: number;
  type: 'subscription' | 'consumable';
  date: number;
}

type PurchaseHandler = (tx: ProcessedTransaction) => void | Promise<void>;
let currentHandlers: { onPurchaseSuccess: PurchaseHandler; onError: (message: string) => void } | null = null;
/** Shared boot so renew never races ahead of Play product loading. */
let bootPromise: Promise<void> | null = null;

/**
 * Checks if the application is running inside a native hybrid mobile container (Capacitor/Cordova)
 */
export function isMobileDevice(): boolean {
  return typeof window !== 'undefined' &&
         (!!(window as any).cordova || !!(window as any).Capacitor?.isNative);
}

function productNotReadyMessage(productId: string): string {
  return (
    `تعذّر تحميل منتج الاشتراك (${productId}) من Google Play. `
    + 'ثبّت التطبيق من متجر Play (وليس ملفاً خارجياً)، وتأكد أن الاشتراك منشور ونشط في Play Console لهذا الحزمة com.mostawdaee.app.'
  );
}

function waitForStoreReady(store: any, timeoutMs = 20_000): Promise<void> {
  if (store.isReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('انتهت مهلة تهيئة Google Play. تحقق من الاتصال وأعد المحاولة.'));
    }, timeoutMs);
    store.ready(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForOffer(store: any, Platform: any, productId: string, timeoutMs = 15_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const productObj = store.get(productId, Platform.GOOGLE_PLAY);
    const offer = productObj?.getOffer?.();
    if (productObj && offer) return offer;
    await new Promise((r) => setTimeout(r, 250));
    try { await store.update?.(); } catch { /* ignore transient update errors while waiting */ }
  }
  throw new Error(productNotReadyMessage(productId));
}

/**
 * Registers products/listeners and waits until Google Play has loaded them.
 * Safe to call repeatedly; handlers always point at the latest screen.
 */
export function initializeBilling(
  onPurchaseSuccess: PurchaseHandler,
  onError: (message: string) => void
): Promise<void> {
  currentHandlers = { onPurchaseSuccess, onError };

  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    const CdvPurchase = (window as any).CdvPurchase;
    if (!CdvPurchase) {
      console.info('[Google Play Billing] Not running in the Android app; billing is unavailable.');
      return;
    }

    const { store, ProductType, Platform } = CdvPurchase;
    if (!store) {
      throw new Error('واجهة الفوترة في التطبيق غير جاهزة.');
    }

    console.log('[Google Play Billing] Registering digital products for Google Play Billing...');
    store.register(PLAY_STORE_PRODUCTS.map((p) => ({
      id: p.id,
      type: p.type === 'subscription' ? ProductType.PAID_SUBSCRIPTION : ProductType.CONSUMABLE,
      platform: Platform.GOOGLE_PLAY,
    })));

    store.when()
      .approved(async (transaction: any) => {
        console.log('[Google Play Billing] Purchase approved by Google Play');

        const productId = transaction.products?.[0]?.id || transaction.productId;
        const matchingProduct = PLAY_STORE_PRODUCTS.find((p) => p.id === productId);
        if (!matchingProduct) {
          console.warn(`[Google Play Billing] Product ${productId} is not in our catalog; ignoring.`);
          return;
        }

        const purchaseToken: string =
          transaction.nativePurchase?.purchaseToken ||
          transaction.purchaseToken ||
          transaction.token ||
          '';
        if (!purchaseToken) {
          currentHandlers?.onError('Google Play لم يُرجع رمز الشراء');
          return;
        }

        const processedTx: ProcessedTransaction = {
          productId,
          transactionId: transaction.transactionId || '',
          purchaseToken,
          currency: matchingProduct.currency,
          amount: matchingProduct.amount,
          type: matchingProduct.type,
          date: Date.now(),
        };

        try {
          await currentHandlers?.onPurchaseSuccess(processedTx);
          // Acknowledge only after our server verified + granted access.
          await transaction.finish();
        } catch (err) {
          console.warn('[Google Play Billing] Activation failed; purchase left pending for retry.', err);
        }
      });

    store.error((err: any) => {
      console.error('[Google Play Billing] Error from official billing system:', err);
      currentHandlers?.onError(err.message || 'حدث خطأ في نظام الفوترة');
    });

    const initErrors = await store.initialize([Platform.GOOGLE_PLAY]);
    if (Array.isArray(initErrors) && initErrors.length > 0) {
      const first = initErrors[0];
      const message = first?.message || 'تعذّرت تهيئة Google Play Billing';
      currentHandlers?.onError(message);
      throw new Error(message);
    }
    await waitForStoreReady(store);
    console.log('[Google Play Billing] Store ready.');
  })().catch((error: any) => {
    // Allow a later renew attempt to reboot after a failed first init.
    bootPromise = null;
    const message = error?.message || 'فشل تهيئة الدفع';
    currentHandlers?.onError(message);
    throw error;
  });

  return bootPromise;
}

/** Opens Google's native payment sheet. Purchases only exist in the Android app. */
export async function makePurchase(productId: string): Promise<boolean> {
  const matchingProduct = PLAY_STORE_PRODUCTS.find((p) => p.id === productId);
  if (!matchingProduct) {
    throw new Error(`منتج غير معروف: ${productId}`);
  }

  const CdvPurchase = (window as any).CdvPurchase;
  if (!CdvPurchase?.store) {
    throw new Error('الاشتراك متاح فقط من تطبيق مستودعي على أندرويد عبر Google Play.');
  }

  if (!bootPromise) {
    throw new Error('الفوترة غير مهيأة. أعد فتح شاشة الاشتراك ثم حاول مرة أخرى.');
  }
  await bootPromise;

  const { store, Platform } = CdvPurchase;
  const offer = await waitForOffer(store, Platform, productId);
  const error = await offer.order();
  if (error) {
    throw new Error(error.message || 'تعذّر إتمام طلب Google Play');
  }
  return true;
}

/** Price as Google Play formats it for this account's country (e.g. "JOD 71.000"), once the product has loaded. */
export function playLocalizedPrice(productId: string): string | null {
  const CdvPurchase = (window as any).CdvPurchase;
  if (!CdvPurchase?.store) return null;
  const product = CdvPurchase.store.get(productId, CdvPurchase.Platform.GOOGLE_PLAY);
  const price = product?.pricing?.price || product?.getOffer?.()?.pricingPhases?.[0]?.price;
  return typeof price === 'string' && price.trim() ? price : null;
}

/** Purchase tokens Google Play reports as owned on this device (after initializeBilling). */
export function ownedPurchaseTokens(): string[] {
  const store = (window as any).CdvPurchase?.store;
  if (!store) return [];
  const tokens = new Set<string>();
  for (const receipt of store.localReceipts || []) {
    for (const tx of receipt.transactions || []) {
      const ownsPremium = (tx.products || []).some((p: any) => PLAY_STORE_PRODUCTS.some((known) => known.id === p.id));
      const token = tx.nativePurchase?.purchaseToken || tx.purchaseToken;
      if (ownsPremium && token) tokens.add(token);
    }
  }
  return [...tokens];
}

/** Asks Google Play for this Google account's purchases again (reinstall, new phone). */
export async function restorePurchases(): Promise<string[]> {
  const store = (window as any).CdvPurchase?.store;
  if (!store) throw new Error('الاستعادة متاحة فقط من تطبيق أندرويد.');
  if (bootPromise) await bootPromise;
  const error = await store.restorePurchases();
  if (error) throw new Error(error.message || 'تعذّرت استعادة مشتريات Google Play');
  return ownedPurchaseTokens();
}
