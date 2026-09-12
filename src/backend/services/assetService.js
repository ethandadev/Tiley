/**
 * Tile image storage.
 *
 * Uploaded files are never trusted:
 *   - the client-supplied name is discarded entirely and replaced with a
 *     server-generated random token plus an extension derived from the file's
 *     own magic bytes, which removes filename-based attacks completely;
 *   - the declared MIME type is only accepted if the file's signature agrees;
 *   - files are written under assets/tiles and served as static images with a
 *     Content-Type we choose, so nothing uploaded can ever be executed.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { TILE_ASSETS_DIR, resolveWithin, assertSafeSegment } from '../../utils/paths.js';
import { listFiles, pathExists, fileStats } from '../../utils/storage.js';
import { randomToken } from '../../utils/ids.js';
import { badRequest, notFound, AppError } from '../../utils/errors.js';
import { LIMITS } from '../../shared/constants.js';

/** File signatures for the formats we accept. */
const SIGNATURES = [
  {
    extension: '.png',
    mime: 'image/png',
    test: (buffer) => buffer.length > 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  },
  {
    extension: '.jpg',
    mime: 'image/jpeg',
    test: (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  },
  {
    extension: '.webp',
    mime: 'image/webp',
    test: (buffer) => buffer.length > 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  }
];

/** The asset id is the stored file name; validate it before any path use. */
function assetPath(id) {
  assertSafeSegment(path.parse(id).name, 'image name');
  const extension = path.extname(id).toLowerCase();
  if (!SIGNATURES.some((signature) => signature.extension === extension)) {
    throw badRequest('That image type is not supported.');
  }
  // Contain the name first, then re-attach the validated extension.
  return `${resolveWithin(TILE_ASSETS_DIR, path.parse(id).name)}${extension}`;
}

export function detectImageType(buffer) {
  return SIGNATURES.find((signature) => signature.test(buffer)) ?? null;
}

/**
 * Store an uploaded image buffer.
 * @returns {{ id: string, url: string, bytes: number, type: string }}
 */
export async function saveUpload(buffer, declaredMime) {
  if (!buffer || buffer.length === 0) throw badRequest('The uploaded file was empty.');
  if (buffer.length > LIMITS.ASSET_BYTES_MAX) {
    throw new AppError(
      `That image is ${(buffer.length / 1048576).toFixed(1)} MB. The maximum size is ${LIMITS.ASSET_BYTES_MAX / 1048576} MB.`,
      { status: 413, code: 'too_large' }
    );
  }

  const signature = detectImageType(buffer);
  if (!signature) {
    throw badRequest('That file is not a PNG, JPEG or WebP image. Tile images must be one of those formats.');
  }
  if (declaredMime && declaredMime !== signature.mime && !(declaredMime === 'image/jpg' && signature.mime === 'image/jpeg')) {
    throw badRequest(`The file says it is ${declaredMime}, but its contents are ${signature.mime}. Re-export the image and try again.`);
  }

  await fs.mkdir(TILE_ASSETS_DIR, { recursive: true });
  const id = `${randomToken(12)}${signature.extension}`;
  await fs.writeFile(path.join(TILE_ASSETS_DIR, id), buffer, { mode: 0o644 });

  return { id, url: `/assets/tiles/${id}`, bytes: buffer.length, type: signature.mime };
}

export async function deleteAsset(id) {
  const file = assetPath(id);
  if (!(await pathExists(file))) throw notFound('That image no longer exists.');
  await fs.rm(file, { force: true });
  return { id };
}

export async function listAssets() {
  const files = await listFiles(TILE_ASSETS_DIR);
  const assets = [];
  for (const name of files) {
    const extension = path.extname(name).toLowerCase();
    if (!SIGNATURES.some((signature) => signature.extension === extension)) continue;
    const stats = await fileStats(path.join(TILE_ASSETS_DIR, name));
    assets.push({
      id: name,
      url: `/assets/tiles/${name}`,
      bytes: stats?.size ?? 0,
      uploadedAt: stats ? stats.mtime.toISOString() : null
    });
  }
  assets.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  return assets;
}
