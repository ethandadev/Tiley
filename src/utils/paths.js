/**
 * Every filesystem path the server touches is produced here.
 *
 * The rule enforced by `resolveWithin`: a caller-supplied segment may only ever
 * resolve to a path inside one of the application's own data directories. This
 * is the single choke point that makes directory traversal ("../../etc/passwd",
 * absolute paths, odd separators) impossible from the HTTP layer.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..', '..');
export const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DICTIONARIES_DIR = path.join(DATA_DIR, 'dictionaries');
export const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
export const TILE_ASSETS_DIR = path.join(ASSETS_DIR, 'tiles');
export const FRONTEND_DIR = path.join(ROOT_DIR, 'src', 'frontend');
export const SHARED_DIR = path.join(ROOT_DIR, 'src', 'shared');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
export const RECENTS_FILE = path.join(DATA_DIR, 'recents.json');

/** Identifiers allowed as a path segment. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeSegment(segment) {
  return typeof segment === 'string' && SAFE_SEGMENT.test(segment);
}

export function assertSafeSegment(segment, label = 'identifier') {
  if (!isSafeSegment(segment)) {
    throw new AppError(`That ${label} is not valid.`, {
      status: 400,
      code: 'invalid_id',
      detail: `Rejected unsafe path segment: ${JSON.stringify(segment)}`
    });
  }
  return segment;
}

/**
 * Join `segments` onto `baseDir` and guarantee the result stays inside it.
 * Throws rather than returning an escaped path.
 */
export function resolveWithin(baseDir, ...segments) {
  for (const segment of segments) assertSafeSegment(segment, 'name');
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('That location is not allowed.', {
      status: 400,
      code: 'path_traversal',
      detail: `Attempted to escape ${base} with ${target}`
    });
  }
  return target;
}

/** Create every directory the application writes to. */
export async function ensureDataDirectories() {
  await Promise.all([
    fs.mkdir(PROJECTS_DIR, { recursive: true }),
    fs.mkdir(DICTIONARIES_DIR, { recursive: true }),
    fs.mkdir(TILE_ASSETS_DIR, { recursive: true }),
    fs.mkdir(DATA_DIR, { recursive: true })
  ]);
}
