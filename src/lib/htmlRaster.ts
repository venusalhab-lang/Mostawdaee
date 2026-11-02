import { paperDots, toMonochrome, trimBottom, type MonoBitmap } from './escpos';
import { printableMm, type PaperWidth } from './receipt';

const CSS_PX_PER_MM = 96 / 25.4;

function loadFrame(html: string, widthPx: number): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthPx}px;height:10px;border:0;visibility:hidden;`;
    const timer = setTimeout(() => { frame.remove(); reject(new Error('render timeout')); }, 8000);
    frame.onload = () => { clearTimeout(timer); resolve(frame); };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('render failed'));
    img.src = src;
  });
}

/**
 * Lays a print document out at the paper's printable width and draws it at the print head's
 * resolution. Only system fonts and inline images are available here, which suits receipts.
 */
export async function renderHtmlToBitmap(html: string, paper: PaperWidth): Promise<MonoBitmap> {
  const cssWidth = Math.round(printableMm(paper) * CSS_PX_PER_MM);
  const dots = paperDots(paper);
  const frame = await loadFrame(html, cssWidth);
  try {
    const doc = frame.contentDocument!;
    await (doc.fonts?.ready ?? Promise.resolve());
    const height = Math.max(1, Math.ceil(doc.documentElement.scrollHeight));
    const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
    const heightDots = Math.ceil((height * dots) / cssWidth);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dots}" height="${heightDots}" viewBox="0 0 ${cssWidth} ${height}">`
      + `<foreignObject x="0" y="0" width="${cssWidth}" height="${height}">${xhtml}</foreignObject></svg>`;
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement('canvas');
    canvas.width = dots;
    canvas.height = heightDots;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, dots, heightDots);
    ctx.drawImage(img, 0, 0, dots, heightDots);
    const pixels = ctx.getImageData(0, 0, dots, heightDots).data;
    return trimBottom(toMonochrome(pixels, dots, heightDots));
  } finally {
    frame.remove();
  }
}
