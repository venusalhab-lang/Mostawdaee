import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativePrintPlugin {
  printHtml(options: { html: string; jobName?: string }): Promise<void>;
}

const NativePrint = registerPlugin<NativePrintPlugin>('NativePrint');

function printInIframe(html: string): boolean {
  if (typeof document === 'undefined') return false;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return false;
  }
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow?.focus();
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 250);
  return true;
}

/**
 * Print a complete HTML document. Callers must escape every user-supplied value (see escapeHtml):
 * on the web the document renders in a same-origin iframe that shares the session.
 * In the Android app it goes to the system print dialog (printer or PDF), since the WebView ignores print().
 */
export function printHtmlDocument(html: string, jobName = 'Mostawdaee'): boolean {
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativePrint')) {
    NativePrint.printHtml({ html, jobName }).catch((error) => {
      console.warn('[print] native print failed, trying the WebView:', error);
      printInIframe(html);
    });
    return true;
  }
  return printInIframe(html);
}
