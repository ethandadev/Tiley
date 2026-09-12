import { randomUUID, randomBytes } from 'node:crypto';

/** Short, URL-safe, filesystem-safe identifier. */
export function makeId(prefix = '') {
  const raw = randomUUID().replace(/-/g, '').slice(0, 16);
  return prefix ? `${prefix}-${raw}` : raw;
}

/** Random hex token, used for generated asset file names. */
export function randomToken(bytes = 12) {
  return randomBytes(bytes).toString('hex');
}

/**
 * Turn an arbitrary name into a readable, collision-resistant id.
 * The result is still validated by `assertSafeSegment` before it is used
 * as a path segment.
 */
export function slugify(name, fallback = 'item') {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || fallback}-${randomToken(4)}`;
}
