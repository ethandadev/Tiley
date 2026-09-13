/**
 * Express application wiring.
 *
 * Kept separate from server.js so the tests can mount the same app without
 * binding a port.
 */

import path from 'node:path';
import express from 'express';
import { FRONTEND_DIR, SHARED_DIR, ASSETS_DIR, ensureDataDirectories } from '../utils/paths.js';
import { projectsRouter } from './routes/projects.js';
import { dictionariesRouter } from './routes/dictionaries.js';
import { assetsRouter } from './routes/assets.js';
import { settingsRouter } from './routes/settings.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createSeo } from './seo.js';

/**
 * Large maps produce large documents: a 1000 x 1000 map is roughly 4 MB of
 * JSON, and a project can hold several maps.
 */
const JSON_BODY_LIMIT = '96mb';

/**
 * Static files are revalidated after an hour. No build step fingerprints the
 * file names, so a long immutable cache would serve stale code after an update.
 */
const STATIC_MAX_AGE = '1h';

export async function createApp(options = {}) {
  await ensureDataDirectories();
  const seo = await createSeo('publicUrl' in options ? { publicUrl: options.publicUrl } : {});
  const app = express();
  app.locals.publicUrl = seo.publicUrl;

  app.disable('x-powered-by');
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // Conservative headers for a local-first tool: no framing, no sniffing,
  // and a CSP that keeps the editor to its own origin.
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
    );
    next();
  });

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, name: 'Tiley', time: new Date().toISOString() });
  });

  app.use('/api/projects', projectsRouter);
  app.use('/api/dictionaries', dictionariesRouter);
  app.use('/api/assets', assetsRouter);
  app.use('/api/settings', settingsRouter);

  app.use('/api', notFoundHandler);

  // Static content. Uploaded images are served with a fixed disposition so a
  // stored file can never be interpreted as an executable document.
  app.use('/assets', express.static(ASSETS_DIR, {
    index: false,
    maxAge: STATIC_MAX_AGE,
    dotfiles: 'deny',
    setHeaders(response) {
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }));
  /*
   * The frontend is mounted at /frontend and the shared modules at /shared so
   * that a relative import such as "../../shared/tilemap.js" resolves the same
   * way in the browser as it does on disk. That is what lets the Node test
   * suite import the very modules the editor runs.
   */
  app.use('/shared', express.static(SHARED_DIR, { index: false, dotfiles: 'deny', maxAge: STATIC_MAX_AGE }));
  app.use('/frontend', express.static(FRONTEND_DIR, { index: false, dotfiles: 'deny', maxAge: STATIC_MAX_AGE }));

  // The page itself is rendered once at start-up with the deployment's
  // canonical URL and robots policy (see seo.js).
  app.get(['/', '/index.html'], (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache');
    response.type('html').send(seo.indexHtml);
  });
  app.get('/robots.txt', (_request, response) => {
    response.type('text/plain').send(seo.robotsTxt);
  });
  app.get('/sitemap.xml', (_request, response) => {
    if (!seo.sitemapXml) {
      response.status(404).type('text/plain').send('No sitemap: PUBLIC_URL is not configured.');
      return;
    }
    response.type('application/xml').send(seo.sitemapXml);
  });
  app.get('/site.webmanifest', (_request, response) => {
    response.type('application/manifest+json').sendFile(path.join(FRONTEND_DIR, 'site.webmanifest'));
  });

  app.use(errorHandler);
  return app;
}
