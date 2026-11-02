import { describe, expect, it } from 'vitest';
import { productVisualEmoji, resolveProductVisualKey } from '../productVisual';

describe('resolveProductVisualKey', () => {
  it('maps cafe drinks and desserts from Arabic or English', () => {
    expect(resolveProductVisualKey('', 'قهوة تركية')).toBe('coffee');
    expect(resolveProductVisualKey('مشروبات', 'Cappuccino')).toBe('coffee');
    expect(resolveProductVisualKey('', 'تشيز كيك')).toBe('cake');
    expect(resolveProductVisualKey('حلويات', 'Chocolate cake')).toBe('cake');
    expect(resolveProductVisualKey('', 'عصير برتقال')).toBe('juice');
    expect(resolveProductVisualKey('مشروبات', 'شاي أخضر')).toBe('tea');
  });

  it('uses category when the name is generic', () => {
    expect(resolveProductVisualKey('مخبوزات', 'صنف 1')).toBe('bakery');
    expect(resolveProductVisualKey('ألبان', 'منتج أ')).toBe('dairy');
  });

  it('falls back to general', () => {
    expect(resolveProductVisualKey('', '')).toBe('general');
    expect(resolveProductVisualKey('متفرقات', 'XYZ-99')).toBe('general');
  });
});

describe('productVisualEmoji', () => {
  it('returns a non-empty glyph', () => {
    expect(productVisualEmoji('', 'قهوة').length).toBeGreaterThan(0);
    expect(productVisualEmoji('', 'unknown')).toBe('📦');
  });
});
