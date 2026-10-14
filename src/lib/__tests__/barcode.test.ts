import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, barcodeSvg, code128Values, ean13CheckDigit, encodeBarcode, encodeCode128, encodeEan13, isValidEan13 } from '../barcode';
import { LABEL_SIZES, MAX_LABELS, MIN_MODULE_MM, buildLabelsHtml, canPrintCode, moduleWidthMm, totalLabels } from '../labels';

/** Reads Code 128 modules back into symbol values, independently of how they were produced. */
function decode128(modules: boolean[]): number[] {
  const widths: number[] = [];
  let i = 0;
  while (i < modules.length) {
    let run = 1;
    while (i + run < modules.length && modules[i + run] === modules[i]) run++;
    widths.push(run);
    i += run;
  }
  const out: number[] = [];
  for (let k = 0; k + 6 <= widths.length; k += 6) {
    const symbol = widths.slice(k, k + (widths.length - k === 7 ? 7 : 6)).join('');
    out.push(CODE128_PATTERNS.indexOf(symbol));
    if (symbol.length === 7) break;
  }
  return out;
}

/** Text carried by Code 128 values (sets B and C). */
function text128(values: number[]): string {
  let set = values[0] === 105 ? 'C' : 'B';
  let s = '';
  for (const v of values.slice(1, -2)) {
    if (v === 99) { set = 'C'; continue; }
    if (v === 100) { set = 'B'; continue; }
    s += set === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
  }
  return s;
}

describe('Code 128', () => {
  it('has 107 distinct patterns of 11 modules (13 for stop)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const sum = [...p].reduce((a, b) => a + Number(b), 0);
      expect(sum).toBe(i === 106 ? 13 : 11);
    });
  });

  it.each(['ABC-123', 'SKU 9', '12345678', '1234567', 'X12345678', '628100123456A', '00', 'a~z'])('round-trips %s with a valid checksum', (text) => {
    const enc = encodeCode128(text)!;
    const values = decode128(enc.modules);
    expect(values).toEqual(code128Values(text));
    expect(values.every((v) => v >= 0)).toBe(true);
    const data = values.slice(0, -2);
    const sum = data.reduce((acc, v, i) => acc + (i === 0 ? v : v * i), 0);
    expect(values[values.length - 2]).toBe(sum % 103);
    expect(text128(values)).toBe(text);
  });

  it('packs long digit runs in set C so numeric codes stay short', () => {
    expect(code128Values('12345678')![0]).toBe(105);
    expect(code128Values('12345678')).toHaveLength(4 + 3);
    expect(code128Values('AB')![0]).toBe(104);
  });

  it('refuses text a barcode cannot carry', () => {
    expect(encodeCode128('')).toBeNull();
    expect(encodeCode128('شاي')).toBeNull();
    expect(encodeCode128('tab\tx')).toBeNull();
  });
});

describe('EAN-13', () => {
  it('checks the check digit', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('400638133393')).toBe(false);
  });

  it('draws 95 modules with guards and the parity of the first digit', () => {
    const enc = encodeEan13('4006381333931')!;
    const bits = enc.modules.map((b) => (b ? '1' : '0')).join('');
    expect(bits).toHaveLength(95);
    expect(bits.slice(0, 3)).toBe('101');
    expect(bits.slice(45, 50)).toBe('01010');
    expect(bits.slice(92)).toBe('101');
    // First digit 4 → LGLLGG: second digit 0 in L, third digit 0 in G.
    expect(bits.slice(3, 10)).toBe('0001101');
    expect(bits.slice(10, 17)).toBe('0100111');
    // Right half digit 3 (position 8) in R.
    expect(bits.slice(50, 57)).toBe('1000010');
  });

  it('is used only for valid EAN-13 codes; everything else becomes Code 128', () => {
    expect(encodeBarcode('4006381333931')?.format).toBe('ean13');
    expect(encodeBarcode('4006381333932')?.format).toBe('code128');
    expect(encodeBarcode('012345678905')?.format).toBe('code128');
    expect(encodeBarcode(' 4006381333931 ')?.text).toBe('4006381333931');
  });

  it('renders bars as an SVG with a quiet zone', () => {
    const svg = barcodeSvg(encodeEan13('4006381333931')!);
    expect(svg).toContain('viewBox="0 0 115 50"');
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

describe('labels', () => {
  const row = { name: 'Tea <b>', code: '4006381333931', price: '1.500 JOD', copies: 2 };

  it('prints each copy, escapes text and leaves out codes that cannot be drawn', () => {
    const html = buildLabelsHtml([row, { ...row, name: 'Bad', code: 'شاي', copies: 3 }], { size: 'roll-50x30', showName: true, showPrice: true, isRtl: true });
    expect(html.match(/class="label"/g)).toHaveLength(2);
    expect(html).toContain('Tea &lt;b&gt;');
    expect(html).not.toContain('Bad');
    expect(html).toContain('@page { size: 50mm 30mm; margin: 0; }');
    expect(html).toContain('1.500 JOD');
  });

  it('hides name, price and store name when asked, and lays out an A4 sheet', () => {
    const html = buildLabelsHtml([row], { size: 'a4-3x8', showName: false, showPrice: false, isRtl: false });
    expect(html).not.toContain('Tea');
    expect(html).not.toContain('1.500 JOD');
    expect(html).toContain('size: A4');
    expect(html).toContain('repeat(3, 70mm)');
    expect(buildLabelsHtml([row], { size: 'roll-50x30', showName: true, showPrice: true, isRtl: false, businessName: 'Shop & Co' })).toContain('Shop &amp; Co');
  });

  it('caps one print run and counts copies as whole non-negative numbers', () => {
    const html = buildLabelsHtml([{ ...row, copies: MAX_LABELS + 50 }], { size: 'roll-40x25', showName: true, showPrice: true, isRtl: false });
    expect(html.match(/class="label"/g)).toHaveLength(MAX_LABELS);
    expect(totalLabels([{ copies: 2.7 }, { copies: -3 }, { copies: NaN }, { copies: 4 }])).toBe(6);
  });

  it('warns when a long code is too dense for a small label', () => {
    expect(canPrintCode('4006381333931')).toBe(true);
    expect(moduleWidthMm('4006381333931', 'roll-50x30')!).toBeGreaterThan(MIN_MODULE_MM);
    expect(moduleWidthMm('ABCDEFGHIJKLMNOP', 'roll-38x25')!).toBeLessThan(MIN_MODULE_MM);
    expect(moduleWidthMm('شاي', 'roll-50x30')).toBeNull();
    expect(LABEL_SIZES.map((s) => s.id)).toContain('a4-3x8');
  });
});
