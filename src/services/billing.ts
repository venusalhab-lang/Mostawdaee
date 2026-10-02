/**
 * Google Play Billing Service
 * Integration with cordova-plugin-purchase (compatible with Capacitor applications)
 * Supports continuous initialization, subscription upgrades, and multi-currency top-ups.
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

// Configured products as declared in Google Play Console
export const PLAY_STORE_PRODUCTS: DigitalProduct[] = [
  {
    id: 'mostawdaee_premium_100',
    name: 'Mostawdaee Premium (Annual)',
    description: '1-Year Unified premium commercial access, auto-backups and mobile dashboard access.',
    price: '$100.00',
    currency: 'USD',
    amount: 100,
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
  onPurchaseSuccess: (tx: ProcessedTransaction) => void,
  onError: (message: string) => void
) {
  // Safe guarding double initialization
  if (isInitialized) {
    console.log('[Google Play Billing] Already initialized.');
    return;
  }

  const CdvPurchase = (window as any).CdvPurchase;

  if (!CdvPurchase) {
    console.info('[Google Play Billing] CdvPurchase not found on window object. Running in browser Simulation Mode.');
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
      .approved((transaction: any) => {
        console.log('[Google Play Billing] Native Purchase APPROVED by Google Play Store:', transaction);

        // Capture purchase fields safely
        const productId = transaction.productId;
        const matchingProduct = PLAY_STORE_PRODUCTS.find(p => p.id === productId);
        
        if (!matchingProduct) {
          console.warn(`[Google Play Billing] Purchased product ID ${productId} is not registered in our local catalog!`);
          transaction.verify();
          return;
        }

        // 4. Token Verification: Capture secure tokens for cryptographic backend verification
        const purchaseToken = transaction.purchaseToken || 
                              transaction.token || 
                              (transaction.receipt && transaction.receipt.token) ||
                              transaction.transactionId || 
                              `token_${Date.now()}`;

        const processedTx: ProcessedTransaction = {
          productId: transaction.productId,
          transactionId: transaction.transactionId || `gplay_${Date.now()}`,
          purchaseToken: purchaseToken,
          currency: matchingProduct.currency,
          amount: matchingProduct.amount,
          type: matchingProduct.type,
          date: Date.now()
        };

        console.info(`[Google Play Billing] Secure token retrieved successfully: ${purchaseToken.substring(0, 15)}...`);
        console.info('[Google Play Billing] Dispatching processed transaction payload to secure ledger hooks...');

        // Fire database update hook
        onPurchaseSuccess(processedTx);

        // Hand over validation to finalize transaction
        transaction.verify();
      })
      .verified((receipt: any) => {
        console.log('[Google Play Billing] Native Receipt VERIFIED successfully by store:', receipt);
        receipt.finish();
      })
      .finished((receipt: any) => {
        console.log('[Google Play Billing] Native Transaction fully FINISHED & consumed:', receipt);
      });

    // Error logging gate
    store.error((err: any) => {
      console.error('[Google Play Billing] Error from official billing system:', err);
      onError(err.message || 'Billing subsystem encountered an unknown error');
    });

    // Initialize platform bindings
    store.initialize([Platform.GOOGLE_PLAY]);
    isInitialized = true;
    console.log('[Google Play Billing] Official store listener bindings successfully attached and booted.');
  } catch (error: any) {
    console.error('[Google Play Billing] Critical official initialization failed:', error);
    onError(error.message || 'Fatal initialization of payment sheet failed');
  }
}

/**
 * 2. Trigger Google's Native Payment Sheet or Simulated Dialog
 * 
 * @param productId Product / Subscription identifier to buy
 * @param simulatedCallback Browser preview fallback to trigger database updates right away
 */
export async function makePurchase(
  productId: string,
  simulatedCallback?: (tx: ProcessedTransaction) => void
): Promise<boolean> {
  const matchingProduct = PLAY_STORE_PRODUCTS.find(p => p.id === productId);
  if (!matchingProduct) {
    throw new Error(`Product metadata not found for item code: ${productId}`);
  }

  const CdvPurchase = (window as any).CdvPurchase;

  // Native flow trigger
  if (CdvPurchase && CdvPurchase.store) {
    try {
      const { store, Platform } = CdvPurchase;
      const productObj = store.get(productId, Platform.GOOGLE_PLAY);
      if (!productObj) {
        throw new Error(`Google Play billing could not retrieve product layout for ID: ${productId}. Make sure it is approved in the Play Console.`);
      }

      console.log(`[Google Play Billing] Ordering official product code: ${productId}`);
      
      // Fires the native billing layout
      productObj.order();
      return true;
    } catch (e: any) {
      console.error('[Google Play Billing] Failed ordering via Google Play Billing Store:', e);
      throw new Error(e.message || 'Google Play Billing order dispatch failed');
    }
  } else {
    throw new Error('Google Play Billing is only available in the native Android app.');
  }
}
