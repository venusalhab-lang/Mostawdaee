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
 * The trailing "_100" is the original product id; the billed amount is set in Play Console and
 * mirrored below for UI fallbacks only — do not rename the SKU or existing subscribers break.
 */
export const PLAY_PREMIUM_PRODUCT_ID = 'mostawdaee_premium_100';
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

// Active connection state
let isInitialized = false;

// Listeners are registered once, but the screen that triggers a purchase may change;
// always call the most recent handlers.
type PurchaseHandler = (tx: ProcessedTransaction) => void | Promise<void>;
let currentHandlers: { onPurchaseSuccess: PurchaseHandler; onError: (message: string) => void } | null = null;

/**
 * Checks if the application is running inside a native hybrid mobile container (Capacitor/Cordova)
 */
export function isMobileDevice(): boolean {
  return typeof window !== 'undefined' && 
         (!!(window as any).cordova || !!(window as any).Capacitor?.isNative);
}

/**
 * 1. Initialize Google Play Billing Plugin
 * Registers products and listeners with Google Play native store.
 * 
 * @param onPurchaseSuccess Callback to trigger on successful checkout
 * @param onError Callback for failed billing workflows
 */
export function initializeBilling(
  onPurchaseSuccess: PurchaseHandler,
  onError: (message: string) => void
) {
  currentHandlers = { onPurchaseSuccess, onError };

  // Safe guarding double initialization
  if (isInitialized) {
    console.log('[Google Play Billing] Already initialized.');
    return;
  }

  const CdvPurchase = (window as any).CdvPurchase;

  if (!CdvPurchase) {
    console.info('[Google Play Billing] Not running in the Android app; billing is unavailable.');
    return;
  }

  try {
    const { store, ProductType, Platform } = CdvPurchase;

    if (!store) {
      throw new Error('Billing store interface of cordova-plugin-purchase is unpopulated.');
    }

    console.log('[Google Play Billing] Registering digital products for Google Play Billing...');
    
    // Register all catalog products
    const storeProducts = PLAY_STORE_PRODUCTS.map(p => ({
      id: p.id,
      type: p.type === 'subscription' ? ProductType.PAID_SUBSCRIPTION : ProductType.CONSUMABLE,
      platform: Platform.GOOGLE_PLAY
    }));
    
    store.register(storeProducts);

    /**
     * 3. Secure Purchase Flow & Purchases Updated Listeners (approved, verified, finished)
     * Handles the real-time response from Google's official payment sheet.
     */
    store.when()
      .approved(async (transaction: any) => {
        console.log('[Google Play Billing] Purchase approved by Google Play');

        const productId = transaction.products?.[0]?.id || transaction.productId;
        const matchingProduct = PLAY_STORE_PRODUCTS.find(p => p.id === productId);
        if (!matchingProduct) {
          console.warn(`[Google Play Billing] Product ${productId} is not in our catalog; ignoring.`);
          return;
        }

        // Real Google Play purchase token (the server verifies it with the Play Developer API).
        const purchaseToken: string =
          transaction.nativePurchase?.purchaseToken ||
          transaction.purchaseToken ||
          transaction.token ||
          '';
        if (!purchaseToken) {
          currentHandlers?.onError('Google Play did not return a purchase token');
          return;
        }

        const processedTx: ProcessedTransaction = {
          productId,
          transactionId: transaction.transactionId || '',
          purchaseToken,
          currency: matchingProduct.currency,
          amount: matchingProduct.amount,
          type: matchingProduct.type,
          date: Date.now()
        };

        try {
          // 1. Activate on OUR server (which verifies the token with Google)
          await currentHandlers?.onPurchaseSuccess(processedTx);
          // 2. Only then acknowledge/finish with Google. Unacknowledged purchases are
          //    refunded automatically after 3 days, and are re-delivered on the next launch,
          //    so a failed activation is retried instead of being lost.
          await transaction.finish();
        } catch (err) {
          console.warn('[Google Play Billing] Activation failed; purchase left pending for retry.', err);
        }
      });

    // Error logging gate
    store.error((err: any) => {
      console.error('[Google Play Billing] Error from official billing system:', err);
      currentHandlers?.onError(err.message || 'Billing subsystem encountered an unknown error');
    });

    // Initialize platform bindings
    store.initialize([Platform.GOOGLE_PLAY]);
    isInitialized = true;
    console.log('[Google Play Billing] Official store listener bindings successfully attached and booted.');
  } catch (error: any) {
    console.error('[Google Play Billing] Critical official initialization failed:', error);
    currentHandlers?.onError(error.message || 'Fatal initialization of payment sheet failed');
  }
}

/** Opens Google's native payment sheet. Purchases only exist in the Android app. */
export async function makePurchase(productId: string): Promise<boolean> {
  const matchingProduct = PLAY_STORE_PRODUCTS.find(p => p.id === productId);
  if (!matchingProduct) {
    throw new Error(`Product metadata not found for item code: ${productId}`);
  }

  const CdvPurchase = (window as any).CdvPurchase;
  if (!CdvPurchase?.store) {
    throw new Error('Google Play Billing is only available in the native Android app.');
  }
  const { store, Platform } = CdvPurchase;
  const productObj = store.get(productId, Platform.GOOGLE_PLAY);
  const offer = productObj?.getOffer?.();
  if (!productObj || !offer) {
    throw new Error(`Google Play billing could not retrieve product ${productId}. Make sure the subscription is active in the Play Console and the app is installed from a Play test track.`);
  }
  // cordova-plugin-purchase v13: orders go through an Offer
  const error = await offer.order();
  if (error) {
    throw new Error(error.message || 'Google Play order failed');
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
  if (!store) throw new Error('Google Play Billing is only available in the native Android app.');
  const error = await store.restorePurchases();
  if (error) throw new Error(error.message || 'Google Play restore failed');
  return ownedPurchaseTokens();
}
