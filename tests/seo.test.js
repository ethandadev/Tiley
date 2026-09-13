import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  normalizePublicUrl, resolvePublicUrl, renderIndexHtml, renderRobotsTxt, renderSitemapXml
} from '../src/backend/seo.js';
import { createApp } from '../src/backend/app.js';

const template = await fs.readFile(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
const SITE = 'https://tiley.ethandadev.com';

function structuredData(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'the page has a structured-data block');
  return JSON.parse(match[1]);
}

test('public URLs are normalised and non-http values rejected', () => {
  assert.equal(normalizePublicUrl('https://tiley.ethandadev.com/'), SITE);
  assert.equal(normalizePublicUrl('https://example.com/tools/tiley//'), 'https://example.com/tools/tiley');
  assert.equal(normalizePublicUrl('javascript:alert(1)'), null);
  assert.equal(normalizePublicUrl('not a url'), null);
});

test('the environment overrides package.json, and "none" opts out', () => {
  assert.equal(resolvePublicUrl(undefined, SITE), SITE);
  assert.equal(resolvePublicUrl('', SITE), SITE);
  assert.equal(resolvePublicUrl('https://other.dev', SITE), 'https://other.dev');
  assert.equal(resolvePublicUrl('none', SITE), null);
});

test('with a public URL every placeholder becomes an absolute URL', () => {
  const html = renderIndexHtml(template, { publicUrl: SITE, version: '1.2.3' });
  assert.ok(!html.includes('{{'), 'no placeholders survive');
  assert.match(html, /<link rel="canonical" href="https:\/\/tiley\.ethandadev\.com\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/tiley\.ethandadev\.com\/assets\/og-image\.png">/);
  assert.match(html, /<meta name="robots" content="index, follow/);

  const data = structuredData(html);
  assert.equal(data['@type'], 'SoftwareApplication');
  assert.equal(data.url, `${SITE}/`);
  assert.equal(data.softwareVersion, '1.2.3');
});

test('without a public URL, URL tags are removed and indexing is refused', () => {
  const html = renderIndexHtml(template, { publicUrl: null, version: '1.0.0' });
  assert.ok(!html.includes('{{'));
  assert.ok(!html.includes('rel="canonical"'));
  assert.ok(!html.includes('og:url'));
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);

  const data = structuredData(html);   // still valid JSON after removal
  assert.equal(data.url, undefined);
});

test('the page keeps one title, one description and one h1', () => {
  const html = renderIndexHtml(template, { publicUrl: SITE, version: '1.0.0' });
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.equal(html.match(/<title>/g).length, 1);
  assert.ok(title.length <= 70, `title is ${title.length} characters`);
  assert.ok(description.length >= 70 && description.length <= 160, `description is ${description.length} characters`);
  // One h1 in the rendered page, plus the fallback inside <noscript>.
  assert.equal(html.replace(/<noscript>[\s\S]*<\/noscript>/, '').match(/<h1>/g).length, 1);
});

test('robots.txt and the sitemap point at the public URL', () => {
  const robots = renderRobotsTxt({ publicUrl: SITE });
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/tiley\.ethandadev\.com\/sitemap\.xml/);
  assert.equal(renderRobotsTxt({ publicUrl: null }), 'User-agent: *\nDisallow: /\n');

  const sitemap = renderSitemapXml({ publicUrl: SITE, lastModified: '2026-09-13' });
  assert.match(sitemap, /<loc>https:\/\/tiley\.ethandadev\.com\/<\/loc>/);
  assert.match(sitemap, /<lastmod>2026-09-13<\/lastmod>/);
});

/* The routes, served by the real app. */

let server;
let baseUrl;
before(async () => {
  const app = await createApp({ publicUrl: SITE });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('SEO routes are served with the right content types', async () => {
  const cases = [
    ['/', 'text/html', 'rel="canonical"'],
    ['/robots.txt', 'text/plain', 'Sitemap:'],
    ['/sitemap.xml', 'application/xml', '<urlset'],
    ['/site.webmanifest', 'application/manifest+json', '"short_name": "Tiley"']
  ];
  for (const [path, type, snippet] of cases) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(type), `${path} is ${response.headers.get('content-type')}`);
    assert.ok((await response.text()).includes(snippet), `${path} contains ${snippet}`);
  }
  for (const image of ['/assets/og-image.png', '/assets/icon-192.png', '/assets/apple-touch-icon.png']) {
    assert.equal((await fetch(`${baseUrl}${image}`)).status, 200, image);
  }
});
