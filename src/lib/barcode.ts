/**
 * Printable 1D barcodes for shelf and product labels, without a third-party library.
 * A valid EAN-13 prints as EAN-13; everything else prints as Code 128, which scanners read back
 * as exactly the same text, so a printed label always finds its product again.
 */

export type BarcodeFormat = 'ean13' | 'code128';

export interface EncodedBarcode {
  format: BarcodeFormat;
  /** Module pattern from left to right, true for a dark bar. */
  modules: boolean[];
  /** Human-readable text under the bars. */
  text: string;
}

// Code 128 bar/space widths for symbol values 0–106 (106 is the stop pattern).
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

export const CODE128_PATTERNS: readonly string[] = CODE128;

function widthsToModules(widths: string, out: boolean[]): void {
  let dark = true;
  for (const w of widths) {
    for (let i = 0; i < Number(w); i++) out.push(dark);
    dark = !dark;
  }
}

/** Code 128 symbol values (start, data, checksum, stop). Null when the text has characters Code 128 B cannot carry. */
export function code128Values(text: string): number[] | null {
  if (!text || !/^[\x20-\x7e]+$/.test(text)) return null;
  const values: number[] = [];
  const digitsRun = (from: number) => {
    let n = 0;
    while (from + n < text.length && text[from + n] >= '0' && text[from + n] <= '9') n++;
    return n;
  };
  let i = 0;
  // Pairs of digits are packed in set C when the run is long enough to pay for the switch.
  const leading = digitsRun(0);
  let set: 'B' | 'C' = leading >= 4 && (leading === text.length || leading >= 6) ? 'C' : 'B';
  values.push(set === 'C' ? START_C : START_B);
  while (i < text.length) {
    if (set === 'C') {
      const run = digitsRun(i);
      if (run >= 2) {
        values.push(Number(text.slice(i, i + 2)));
        i += 2;
        continue;
      }
      values.push(CODE_B);
      set = 'B';
      continue;
    }
    const run = digitsRun(i);
    const rest = text.length - i;
    if (run >= 4 && run % 2 === 0 && (run === rest || run >= 6)) {
      values.push(CODE_C);
      set = 'C';
      continue;
    }
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  let sum = values[0];
  for (let k = 1; k < values.length; k++) sum += values[k] * k;
  values.push(sum % 103, STOP);
  return values;
}

export function encodeCode128(text: string): EncodedBarcode | null {
  const values = code128Values(text);
  if (!values) return null;
  const modules: boolean[] = [];
  for (const v of values) widthsToModules(CODE128[v], modules);
  return { format: 'code128', modules, text };
}

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code) === Number(code[12]);
}

export function encodeEan13(code: string): EncodedBarcode | null {
  if (!isValidEan13(code)) return null;
  const bits: string[] = ['101'];
  const parity = EAN_PARITY[Number(code[0])];
  for (let i = 1; i <= 6; i++) bits.push((parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(code[i])]);
  bits.push('01010');
  for (let i = 7; i <= 12; i++) bits.push(EAN_R[Number(code[i])]);
  bits.push('101');
  return { format: 'ean13', modules: [...bits.join('')].map((b) => b === '1'), text: code };
}

/** The best printable barcode for a stored product code, or null when it cannot be printed as a barcode. */
export function encodeBarcode(code: string): EncodedBarcode | null {
  const value = code.trim();
  return encodeEan13(value) || encodeCode128(value);
}

/**
 * SVG for the bars only. Width is in modules (the caller scales it to the label);
 * a quiet zone of 10 modules on each side is part of the drawing, since scanners need it.
 */
export function barcodeSvg(barcode: EncodedBarcode, opts: { height?: number } = {}): string {
  const quiet = 10;
  const height = opts.height ?? 50;
  const width = barcode.modules.length + quiet * 2;
  let rects = '';
  let i = 0;
  while (i < barcode.modules.length) {
    if (!barcode.modules[i]) { i++; continue; }
    let run = 1;
    while (barcode.modules[i + run]) run++;
    rects += `<rect x="${i + quiet}" y="0" width="${run}" height="${height}"/>`;
    i += run;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${width}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
