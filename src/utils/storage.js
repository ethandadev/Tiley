/**
 * Safe JSON persistence.
 *
 * Two problems are solved here:
 *
 *  1. **Torn writes.** A crash or a full disk halfway through `writeFile` would
 *     leave an unreadable project. Every write goes to a temporary file in the
 *     same directory and is then `rename`d over the target, which is atomic on
 *     POSIX filesystems, so a reader sees either the old file or the new one.
 *
 *  2. **Interleaved writes.** Autosave, a manual save and an asset upload can
 *     overlap. `withFileLock` serialises all work for a given path through a
 *     promise chain, so two writers can never interleave.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomToken } from './ids.js';
import { AppError } from './errors.js';

/** path -> tail of the queued operation chain for that path. */
const locks = new Map();

export function withFileLock(key, task) {
  const previous = locks.get(key) ?? Promise.resolve();
  // Run regardless of whether the previous operation resolved or rejected.
  const run = previous.then(task, task);
  const guard = run.then(() => {}, () => {});
  locks.set(key, guard);
  guard.then(() => {
    if (locks.get(key) === guard) locks.delete(key);
  });
  return run;
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Read and parse a JSON file. Returns `fallback` when the file is absent. */
export async function readJSON(filePath, { fallback = undefined, label = 'file' } = {}) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (error.code === 'ENOENT') {
      throw new AppError(`The ${label} could not be found.`, { status: 404, code: 'not_found', detail: filePath });
    }
    throw new AppError(`The ${label} could not be read.`, { status: 500, code: 'read_failed', detail: `${filePath}: ${error.message}` });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError(
      `The ${label} is damaged and could not be read. Its contents are not valid JSON.`,
      { status: 422, code: 'corrupt_file', detail: `${filePath}: ${error.message}` }
    );
  }
}

/** Atomically write a value as pretty-printed JSON. */
export async function writeJSON(filePath, value, serialize = (input) => JSON.stringify(input, null, 2)) {
  return writeTextAtomic(filePath, serialize(value));
}

/** Atomically write text: temp file in the same directory, then rename. */
export async function writeTextAtomic(filePath, text) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomToken(6)}.tmp`);
  try {
    await fs.writeFile(temporary, text, 'utf8');
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw new AppError('The file could not be saved. Check that the application directory is writable.', {
      status: 500,
      code: 'write_failed',
      detail: `${filePath}: ${error.message}`
    });
  }
}

export async function removeFile(filePath) {
  await fs.rm(filePath, { force: true });
}

export async function removeDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}

/** List the immediate sub-directory names of `directory`. */
export async function listDirectories(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** List file names in `directory` matching an extension (e.g. '.json'). */
export async function listFiles(directory, extension = '') {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension) && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function fileStats(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}
