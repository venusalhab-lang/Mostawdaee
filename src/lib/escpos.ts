/**
 * ESC/POS raster printing. Receipts are sent as a 1-bit image rather than text: printer code pages
 * cannot shape Arabic, while a bitmap prints exactly what the app rendered on any ESC/POS printer.
 */

import type { PaperWidth } from './receipt';

/** Dots across the print head at 203 dpi. */
export function paperDots(paper: PaperWidth): number {
  return paper === 58 ? 384 : 576;
}

export interface MonoBitmap {
  width: number;
  height: number;
  /** Bytes per row; each byte holds 8 pixels, most significant bit first, 1 = black. */
  rowBytes: number;
  data: Uint8Array;
}

/** RGBA pixels to a 1-bit bitmap. Transparent counts as white paper. */
export function toMonochrome(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 160): MonoBitmap {
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, rowBytes, data };
}

/** Drops blank rows at the bottom so the paper is not fed for nothing. */
export function trimBottom(bmp: MonoBitmap): MonoBitmap {
  let last = bmp.height - 1;
  while (last >= 0) {
    const row = bmp.data.subarray(last * bmp.rowBytes, (last + 1) * bmp.rowBytes);
    if (row.some((b) => b !== 0)) break;
    last--;
  }
  const height = last + 1;
  return { ...bmp, height, data: bmp.data.slice(0, height * bmp.rowBytes) };
}

export interface RasterJobOptions {
  /** Lines fed after the image so the receipt clears the tear bar. */
  feedLines?: number;
  /** Partial cut on printers with a cutter; others ignore it. */
  cut?: boolean;
  /** Rows per GS v 0 command; small bands keep cheap printers from overflowing their buffer. */
  bandRows?: number;
  /** Pulse the cash drawer wired to the printer's RJ11 port once the receipt is out. */
  openDrawer?: boolean;
}

/** ESC p on pin 2: 50 ms on, 500 ms off, the timing most drawers expect. */
export const DRAWER_PULSE = [0x1b, 0x70, 0x00, 0x19, 0xfa] as const;

/** The full byte stream for one receipt: initialize, image in bands, feed and cut. */
export function buildRasterJob(bmp: MonoBitmap, opts: RasterJobOptions = {}): Uint8Array {
  const feed = Math.max(0, Math.min(255, opts.feedLines ?? 4));
  const band = Math.max(1, Math.min(255, opts.bandRows ?? 128));
  const chunks: number[][] = [[0x1b, 0x40]];
  for (let y = 0; y < bmp.height; y += band) {
    const rows = Math.min(band, bmp.height - y);
    chunks.push([0x1d, 0x76, 0x30, 0x00, bmp.rowBytes & 0xff, (bmp.rowBytes >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff]);
    chunks.push(Array.from(bmp.data.subarray(y * bmp.rowBytes, (y + rows) * bmp.rowBytes)));
  }
  chunks.push([0x1b, 0x64, feed]);
  if (opts.cut ?? true) chunks.push([0x1d, 0x56, 0x42, 0x00]);
  if (opts.openDrawer) chunks.push([...DRAWER_PULSE]);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
