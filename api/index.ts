/**
 * Single Vercel function for every /api/* route (including nested admin paths).
 * vercel.json rewrites /api/:path* → /api and we restore the original URL for Express.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type ExpressApp = (req: IncomingMessage, res: ServerResponse) => unknown;

let appPromise: Promise<ExpressApp> | null = null;

function loadApp(): Promise<ExpressApp> {
  if (!appPromise) {
    appPromise = import('../server-dist/server.js').then(async (mod) => {
      return await (mod.default as Promise<ExpressApp> | ExpressApp);
    });
  }
  return appPromise;
}

function restoreApiUrl(req: IncomingMessage & { url?: string; headers: IncomingMessage['headers'] }) {
  const headerPath =
    (typeof req.headers['x-forwarded-uri'] === 'string' && req.headers['x-forwarded-uri']) ||
    (typeof req.headers['x-invoke-path'] === 'string' && req.headers['x-invoke-path']) ||
    (typeof req.headers['x-matched-path'] === 'string' && req.headers['x-matched-path']) ||
    '';

  // Rewrite from /api/:path* lands on /api — recover nested paths Express registered.
  if (headerPath.startsWith('/api/') && headerPath !== '/api' && headerPath !== '/api/') {
    const q = (req.url || '').includes('?') ? req.url!.slice(req.url!.indexOf('?')) : '';
    req.url = headerPath.split('?')[0] + q;
    return;
  }

  const current = req.url || '/api';
  if (current === '/api' || current.startsWith('/api?')) {
    // Fallback query form: /api?__p=admin/subscribers
    try {
      const u = new URL(current, 'http://n');
      const nested = u.searchParams.get('__p');
      if (nested) {
        u.searchParams.delete('__p');
        const rest = u.searchParams.toString();
        req.url = `/api/${nested.replace(/^\/+/, '')}${rest ? `?${rest}` : ''}`;
      }
    } catch {
      /* keep url */
    }
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    restoreApiUrl(req as IncomingMessage & { url?: string });
    const app = await loadApp();
    return app(req, res);
  } catch (error) {
    console.error('[api] boot failed', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        message: 'API boot failed',
        detail: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}
