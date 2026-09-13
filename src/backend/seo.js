/**
 * Search-engine and social-preview metadata.
 *
 * index.html carries {{PUBLIC_URL}}, {{ROBOTS}} and {{VERSION}} placeholders.
 * Canonical links, Open Graph URLs and sitemaps must be absolute. The public
 * URL comes from, in order:
 *
 *   1. the PUBLIC_URL environment variable (self-hosting under another domain);
 *   2. "homepage" in package.json (https://tiley.ethandadev.com).
 *
 * With a URL the page is indexable and a sitemap is published. Setting
 * PUBLIC_URL=none opts out: URL-dependent tags are removed and the page asks
 * not to be indexed — for a private copy that should never be crawled.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { FRONTEND_DIR, ROOT_DIR } from '../utils/paths.js';

const LD_JSON = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/;

/** Normalise PUBLIC_URL: must be http(s), no trailing slash. Invalid -> null. */
export function normalizePublicUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Fill the structured-data block, dropping URL fields when there is no public URL. */
function renderStructuredData(block, { publicUrl, version }) {
  const data = JSON.parse(block);
  data.softwareVersion = version;
  if (publicUrl) {
    data.url = `${publicUrl}/`;
    data.image = `${publicUrl}/assets/og-image.png`;
  } else {
    delete data.url;
    delete data.image;
  }
  // "<" is escaped so no string in the data can ever close the script element.
  return `\n  ${JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/\n/g, '\n  ')}\n  `;
}

/** Render index.html for a given deployment. Pure, so it is unit-testable. */
export function renderIndexHtml(template, { publicUrl, version }) {
  let html = template.replace(LD_JSON, (_match, open, body, close) =>
    `${open}${renderStructuredData(body, { publicUrl, version })}${close}`);

  html = html
    .replaceAll('{{ROBOTS}}', publicUrl ? 'index, follow, max-image-preview:large' : 'noindex, nofollow')
    .replaceAll('{{VERSION}}', version);

  if (publicUrl) return html.replaceAll('{{PUBLIC_URL}}', publicUrl);

  // No public URL: remove every line that still needs one.
  return html
    .split('\n')
    .filter((line) => !line.includes('{{PUBLIC_URL}}'))
    .join('\n');
}

export function renderRobotsTxt({ publicUrl }) {
  if (!publicUrl) return 'User-agent: *\nDisallow: /\n';
  return [
    'User-agent: *',
    'Allow: /',
    // Application data is not content; keep crawlers out of it.
    'Disallow: /api/',
    'Disallow: /assets/tiles/',
    '',
    `Sitemap: ${publicUrl}/sitemap.xml`,
    ''
  ].join('\n');
}

export function renderSitemapXml({ publicUrl, lastModified }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${publicUrl}/</loc>`,
    `    <lastmod>${lastModified}</lastmod>`,
    '  </url>',
    '</urlset>',
    ''
  ].join('\n');
}

/** Read the template and package version once; render per configuration. */
export function resolvePublicUrl(environmentValue, homepage) {
  if (environmentValue !== undefined && environmentValue !== '') {
    return environmentValue.toLowerCase() === 'none' ? null : normalizePublicUrl(environmentValue);
  }
  return normalizePublicUrl(homepage);
}

export async function createSeo(overrides = {}) {
  const [template, pkg, stats] = await Promise.all([
    fs.readFile(path.join(FRONTEND_DIR, 'index.html'), 'utf8'),
    fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf8').then(JSON.parse),
    fs.stat(path.join(FRONTEND_DIR, 'index.html'))
  ]);

  const publicUrl = 'publicUrl' in overrides
    ? overrides.publicUrl
    : resolvePublicUrl(process.env.PUBLIC_URL, pkg.homepage);
  const options = { publicUrl, version: pkg.version };
  return {
    publicUrl,
    indexHtml: renderIndexHtml(template, options),
    robotsTxt: renderRobotsTxt(options),
    sitemapXml: publicUrl ? renderSitemapXml({ publicUrl, lastModified: stats.mtime.toISOString().slice(0, 10) }) : null
  };
}
