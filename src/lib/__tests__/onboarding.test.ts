import { describe, expect, it } from 'vitest';
import { needsOnboarding } from '../onboarding';
import type { AppSettings, Product, Warehouse } from '../../types';

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  userName: 'Owner',
  businessName: 'مستودعي',
  defaultVatRate: 16,
  defaultCustomsDuty: 5,
  defaultLanguage: 'ar',
  enableAnimations: true,
  aiVerbosity: 'detailed',
  theme: 'modern',
  darkMode: false,
  currency: 'JOD',
  ...over,
});

describe('needsOnboarding', () => {
  it('shows for an owner with an empty store and no completion flag', () => {
    expect(needsOnboarding({
      isOwner: true,
      isGuest: false,
      settings: settings(),
      warehouses: [],
      products: [],
    })).toBe(true);
  });

  it('hides after the owner finishes setup', () => {
    expect(needsOnboarding({
      isOwner: true,
      isGuest: false,
      settings: settings({ onboardingCompletedAt: Date.now() }),
      warehouses: [],
      products: [],
    })).toBe(false);
  });

  it('hides for guests, members, and stores that already have stock', () => {
    const empty = { isOwner: true, isGuest: false, settings: settings(), warehouses: [] as Warehouse[], products: [] as Product[] };
    expect(needsOnboarding({ ...empty, isGuest: true })).toBe(false);
    expect(needsOnboarding({ ...empty, isOwner: false })).toBe(false);
    expect(needsOnboarding({
      ...empty,
      warehouses: [{ id: 'w1', name: 'Main', parentId: null, createdAt: 1 }],
    })).toBe(false);
    expect(needsOnboarding({
      ...empty,
      products: [{ id: 'p1', name: 'Tea', sku: '1', category: '', brand: '', quantity: 1, unitCost: 1, sellingPrice: 2, status: 'In Stock', dateAdded: 1 }],
    })).toBe(false);
    expect(needsOnboarding({ ...empty, settings: null })).toBe(false);
  });
});
