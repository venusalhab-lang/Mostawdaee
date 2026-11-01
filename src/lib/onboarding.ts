import type { AppSettings, Product, Warehouse } from '../types';

/** Owner of an empty store who has not finished first-run setup. */
export function needsOnboarding(input: {
  isOwner: boolean;
  isGuest: boolean;
  settings: AppSettings | null | undefined;
  warehouses: Warehouse[];
  products: Product[];
}): boolean {
  if (input.isGuest || !input.isOwner || !input.settings) return false;
  if (input.settings.onboardingCompletedAt) return false;
  return input.warehouses.length === 0 && input.products.length === 0;
}

export const ONBOARDING_VAT_OPTIONS = [0, 5, 10, 15, 16] as const;
