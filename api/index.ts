/**
 * Vercel serverless entry: same Express /api routes as localhost / Render.
 * Static SPA assets are served by Vercel's CDN from `dist/`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type ExpressApp = (req: IncomingMessage, res: ServerResponse) => unknown;

let appPromise: Promise<ExpressApp> | null = null;

function loadApp(): Promise<ExpressApp> {
  if (!appPromise) {
    // server.ts default export is Promise<Express> when booted under VERCEL.
    appPromise = import('../server').then(async (mod) => {
      const booted = await (mod.default as Promise<ExpressApp> | ExpressApp);
      return booted;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await loadApp();
  return app(req, res);
}
