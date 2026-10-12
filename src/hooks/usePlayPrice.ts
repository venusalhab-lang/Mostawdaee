import { useEffect, useState } from 'react';
import { playLocalizedPrice } from '../services/billing';

/** Google Play's localized price for a product; null until Play has loaded it or outside the Android app. */
export function usePlayPrice(productId: string, enabled: boolean): string | null {
  const [price, setPrice] = useState<string | null>(() => (enabled ? playLocalizedPrice(productId) : null));

  useEffect(() => {
    if (!enabled) return;
    let tries = 0;
    const read = () => {
      const next = playLocalizedPrice(productId);
      if (next) setPrice(next);
      return !!next;
    };
    if (read()) return;
    const timer = setInterval(() => {
      tries += 1;
      if (read() || tries >= 20) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [productId, enabled]);

  return price;
}
