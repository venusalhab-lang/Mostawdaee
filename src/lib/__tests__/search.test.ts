import { describe, expect, it } from 'vitest';
import {
  matchesQuery,
  normalizeSearchText,
  phoneMatches,
  pushRecentSearch,
  rankMatches,
  scoreMatch,
  RECENT_SEARCHES_LIMIT,
} from '../search';

describe('normalizeSearchText', () => {
  it('unifies Arabic spellings, diacritics and tatweel', () => {
    expect(normalizeSearchText('قَهْوَة')).toBe('قهوه');
    expect(normalizeSearchText('قـــهوة')).toBe('قهوه');
    expect(normalizeSearchText('أحمد')).toBe(normalizeSearchText('احمد'));
    expect(normalizeSearchText('إبراهيم')).toBe(normalizeSearchText('ابراهيم'));
    expect(normalizeSearchText('مصطفى')).toBe(normalizeSearchText('مصطفي'));
    expect(normalizeSearchText('مؤسسة')).toBe(normalizeSearchText('موسسه'));
    expect(normalizeSearchText('سائق')).toBe(normalizeSearchText('سايق'));
  });

  it('converts Arabic-Indic and Persian digits', () => {
    expect(normalizeSearchText('٦٢٩١')).toBe('6291');
    expect(normalizeSearchText('۱۲۳')).toBe('123');
  });

  it('ignores case, extra spaces and invisible marks', () => {
    expect(normalizeSearchText('  Arabic\u200F   COFFEE ')).toBe('arabic coffee');
    expect(normalizeSearchText(null)).toBe('');
    expect(normalizeSearchText(42)).toBe('42');
  });
});

describe('matchesQuery', () => {
  const coffee = ['قهوة عربية محمصة', '6291041500213', 'مشروبات'];

  it('matches every word in any order and across fields', () => {
    expect(matchesQuery(coffee, 'قهوة محمصة')).toBe(true);
    expect(matchesQuery(coffee, 'محمصه قهوه')).toBe(true);
    expect(matchesQuery(coffee, 'قهوة مشروبات')).toBe(true);
    expect(matchesQuery(coffee, '٦٢٩١')).toBe(true);
    expect(matchesQuery(coffee, 'قهوة شاي')).toBe(false);
  });

  it('treats an empty query as matching everything', () => {
    expect(matchesQuery(coffee, '   ')).toBe(true);
  });

  it('skips missing fields', () => {
    expect(matchesQuery([undefined, null, 'Nour'], 'nour')).toBe(true);
  });
});

describe('phoneMatches', () => {
  it('ignores separators, country code and leading zero', () => {
    expect(phoneMatches('+970599123456', '0599 123')).toBe(true);
    expect(phoneMatches('+970 (59) 912-3456', '٠٥٩٩١٢٣')).toBe(true);
  });

  it('needs at least three digits and no letters', () => {
    expect(phoneMatches('+970599123456', '59')).toBe(false);
    expect(phoneMatches('+970599123456', 'abc 599')).toBe(false);
    expect(phoneMatches('', '0599')).toBe(false);
  });
});

describe('scoreMatch and rankMatches', () => {
  const products = [
    { id: 'a', name: 'شاي أخضر بالقهوة', sku: 'TEA-1' },
    { id: 'b', name: 'قهوة عربية', sku: '6291041500213' },
    { id: 'c', name: 'قهوة تركية', sku: '6291041500999' },
  ];
  const fields = (p: (typeof products)[number]) => ({ primary: p.name, codes: [p.sku] });

  it('puts an exact barcode first', () => {
    const ranked = rankMatches(products, '6291041500999', fields, 5);
    expect(ranked.items.map((p) => p.id)).toEqual(['c']);
  });

  it('ranks names that start with the query above names that only contain it', () => {
    const ranked = rankMatches(products, 'قهوه', fields, 5);
    expect(ranked.items.map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(ranked.total).toBe(3);
  });

  it('limits the shown items but reports the full total', () => {
    const ranked = rankMatches(products, 'قهوة', fields, 1);
    expect(ranked.items).toHaveLength(1);
    expect(ranked.total).toBe(3);
  });

  it('returns nothing for an empty query or no match', () => {
    expect(rankMatches(products, ' ', fields, 5)).toEqual({ items: [], total: 0 });
    expect(scoreMatch({ primary: 'قهوة' }, 'سكر')).toBe(0);
  });

  it('finds people by phone', () => {
    expect(scoreMatch({ primary: 'أحمد', phone: '+970599123456' }, '0599123')).toBeGreaterThan(0);
  });
});

describe('pushRecentSearch', () => {
  it('moves a repeated search to the top without duplicating spellings', () => {
    expect(pushRecentSearch(['قهوه', 'سكر'], 'قهوة')).toEqual(['قهوة', 'سكر']);
  });

  it('caps the list and ignores blank input', () => {
    const many = Array.from({ length: RECENT_SEARCHES_LIMIT }, (_, i) => `q${i}`);
    expect(pushRecentSearch(many, 'new')).toHaveLength(RECENT_SEARCHES_LIMIT);
    expect(pushRecentSearch(['a'], '   ')).toEqual(['a']);
  });
});
