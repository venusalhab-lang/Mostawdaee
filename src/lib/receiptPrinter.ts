import { Capacitor, registerPlugin } from '@capacitor/core';
import { buildRasterJob, bytesToBase64 } from './escpos';
import { renderHtmlToBitmap } from './htmlRaster';
import { printHtmlDocument } from './printHtml';
import type { PaperWidth } from './receipt';

export interface PairedPrinter {
  name: string;
  address: string;
  /** Android reports the device as an imaging device; many cheap printers do not, so this is only a hint. */
  printer: boolean;
}

interface BluetoothPrinterPlugin {
  listPaired(): Promise<{ devices: PairedPrinter[] }>;
  print(options: { address: string; data: string }): Promise<void>;
}

const BluetoothPrinter = registerPlugin<BluetoothPrinterPlugin>('BluetoothPrinter');

/** Kept on this device only: a printer is paired with a phone, not with the store. */
export interface ReceiptPrinterPrefs {
  paper: PaperWidth;
  address?: string;
  name?: string;
  /** A cash drawer is wired to the printer; open it with the receipt of a cash sale. */
  openDrawer?: boolean;
}

const PREFS_KEY = 'mustawdae_receipt_printer';

export function readReceiptPrinter(): ReceiptPrinterPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      paper: saved.paper === 58 ? 58 : 80,
      address: typeof saved.address === 'string' && saved.address ? saved.address : undefined,
      name: typeof saved.name === 'string' ? saved.name : undefined,
      openDrawer: saved.openDrawer === true,
    };
  } catch {
    return { paper: 80 };
  }
}

export function saveReceiptPrinter(prefs: ReceiptPrinterPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

export function bluetoothPrintingAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('BluetoothPrinter');
}

export async function listPairedPrinters(): Promise<PairedPrinter[]> {
  const { devices } = await BluetoothPrinter.listPaired();
  return [...devices].sort((a, b) => Number(b.printer) - Number(a.printer) || a.name.localeCompare(b.name));
}

export function printerErrorMessage(err: unknown, isRtl: boolean): string {
  const code = (err as { code?: string })?.code;
  const L = (ar: string, en: string) => (isRtl ? ar : en);
  switch (code) {
    case 'permission-denied': return L('اسمح للتطبيق باستخدام البلوتوث من إعدادات الهاتف.', 'Allow the app to use Bluetooth in the phone settings.');
    case 'disabled': return L('البلوتوث مغلق. شغّله ثم أعد المحاولة.', 'Bluetooth is off. Turn it on and try again.');
    case 'unavailable': return L('هذا الجهاز لا يدعم البلوتوث.', 'This device has no Bluetooth.');
    case 'connect-failed': return L('تعذّر الاتصال بالطابعة. تأكد أنها مشغّلة وقريبة وغير متصلة بجهاز آخر.', 'Could not reach the printer. Make sure it is on, nearby and not connected to another device.');
    default: return L('تعذّرت الطباعة على طابعة البلوتوث.', 'Could not print on the Bluetooth printer.');
  }
}

/** Renders a print document and sends it to the paired printer as an ESC/POS image. */
export async function printHtmlOnBluetooth(html: string, prefs: ReceiptPrinterPrefs, openDrawer = false): Promise<void> {
  if (!prefs.address) throw Object.assign(new Error('No printer selected'), { code: 'no-printer' });
  const bitmap = await renderHtmlToBitmap(html, prefs.paper);
  const job = buildRasterJob(bitmap, { openDrawer });
  await BluetoothPrinter.print({ address: prefs.address, data: bytesToBase64(job) });
}

/**
 * Prints a receipt on the paired Bluetooth printer when one is set up in this app,
 * otherwise through the system print dialog. Bluetooth failures are thrown, never silently rerouted.
 * `cashSale` opens the drawer only when this device has one enabled; the system dialog cannot.
 */
export async function printReceipt(html: string, jobName = 'Receipt', options: { cashSale?: boolean } = {}): Promise<'bluetooth' | 'system'> {
  const prefs = readReceiptPrinter();
  if (prefs.address && bluetoothPrintingAvailable()) {
    await printHtmlOnBluetooth(html, prefs, Boolean(options.cashSale && prefs.openDrawer));
    return 'bluetooth';
  }
  printHtmlDocument(html, jobName);
  return 'system';
}
