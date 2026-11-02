/**
 * Vercel serverless entry: reuse the production Express bundle built by `npm run build`.
 * Static SPA assets stay on the CDN (`dist/`); this function is /api/* only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type ExpressApp = (req: IncomingMessage, res: ServerResponse) => unknown;

let appPromise: Promise<ExpressApp> | null = null;

function loadApp(): Promise<ExpressApp> {
  if (!appPromise) {
    appPromise = import('../server-dist/server.js').then(async (mod) => {
      const booted = await (mod.default as Promise<ExpressApp> | ExpressApp);
      return booted;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
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
