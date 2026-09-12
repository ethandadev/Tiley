/**
 * Tile dictionary persistence.
 *
 * Dictionaries live outside projects (data/dictionaries/<id>.json) precisely so
 * the same dictionary can be shared by several maps and several projects, and
 * exported as a standalone file.
 */

import path from 'node:path';
import { DICTIONARIES_DIR, resolveWithin, assertSafeSegment } from '../../utils/paths.js';
import { readJSON, writeJSON, withFileLock, listFiles, removeFile, pathExists, fileStats } from '../../utils/storage.js';
import { makeId, slugify } from '../../utils/ids.js';
import { AppError, badRequest, notFound } from '../../utils/errors.js';
import {
  createDictionary, createTile, validateDictionary, validateTile,
  migrateDictionary, validateName, cleanString, isSafeId
} from '../../shared/schema.js';
import { DICTIONARY_FORMAT_VERSION } from '../../shared/constants.js';

/**
 * The `.json` suffix is appended *after* `resolveWithin` has validated and
 * contained the identifier, because a path segment containing a dot is not a
 * legal identifier on its own.
 */
function dictionaryFile(id) {
  assertSafeSegment(id, 'dictionary identifier');
  return `${resolveWithin(DICTIONARIES_DIR, id)}.json`;
}

export async function getDictionary(id) {
  const raw = await readJSON(dictionaryFile(id), { label: 'tile dictionary' });
  const dictionary = { ...raw, id };
  const validation = validateDictionary(dictionary);
  if (!validation.ok) {
    throw new AppError('This tile dictionary is damaged and could not be opened.', {
      status: 422, code: 'invalid_dictionary', errors: validation.errors
    });
  }
  return dictionary;
}

export async function listDictionaries() {
  const files = await listFiles(DICTIONARIES_DIR, '.json');
  const summaries = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    if (!isSafeId(id)) continue;
    try {
      const raw = await readJSON(path.join(DICTIONARIES_DIR, file), { fallback: null, label: 'tile dictionary' });
      if (!raw) continue;
      const stats = await fileStats(path.join(DICTIONARIES_DIR, file));
      const validation = validateDictionary({ ...raw, id });
      summaries.push({
        id,
        name: raw.name ?? id,
        description: raw.description ?? '',
        tileCount: Array.isArray(raw.tiles) ? raw.tiles.length : 0,
        updatedAt: stats ? stats.mtime.toISOString() : raw.updatedAt ?? null,
        damaged: !validation.ok,
        problems: validation.ok ? [] : validation.errors.slice(0, 5)
      });
    } catch {
      summaries.push({ id, name: id, tileCount: 0, damaged: true, problems: ['The file could not be read.'] });
    }
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}

async function persist(dictionary) {
  const document = { ...dictionary, formatVersion: DICTIONARY_FORMAT_VERSION, updatedAt: new Date().toISOString() };
  const validation = validateDictionary(document);
  if (!validation.ok) throw badRequest('The tile dictionary could not be saved.', validation.errors);
  const file = dictionaryFile(document.id);
  return withFileLock(file, async () => {
    await writeJSON(file, document);
    return document;
  });
}

/** Create a dictionary document from a name plus optional tile definitions. */
export async function createDictionaryDocument({ name, description = '', tiles = [] }) {
  const nameCheck = validateName(name, 'Dictionary name');
  if (nameCheck.errors.length > 0) throw badRequest('The tile dictionary could not be created.', nameCheck.errors);

  const id = slugify(nameCheck.value, 'dictionary');
  if (await pathExists(dictionaryFile(id))) throw new AppError('A dictionary with that identifier already exists.', { status: 409, code: 'conflict' });

  const normalized = [];
  const seen = new Set();
  for (const tile of tiles) {
    if (!Number.isInteger(tile?.id) || seen.has(tile.id)) continue;
    seen.add(tile.id);
    normalized.push(createTile(tile));
  }
  return persist(createDictionary({ id, name: nameCheck.value, description, tiles: normalized }));
}

export async function renameDictionary(id, name) {
  const { value, errors } = validateName(name, 'Dictionary name');
  if (errors.length > 0) throw badRequest('The tile dictionary could not be renamed.', errors);
  const dictionary = await getDictionary(id);
  dictionary.name = value;
  return persist(dictionary);
}

export async function updateDictionary(id, patch) {
  const dictionary = await getDictionary(id);
  if (patch.name !== undefined) {
    const { value, errors } = validateName(patch.name, 'Dictionary name');
    if (errors.length > 0) throw badRequest('The tile dictionary could not be updated.', errors);
    dictionary.name = value;
  }
  if (patch.description !== undefined) dictionary.description = cleanString(patch.description, 2000);
  if (patch.tiles !== undefined) {
    if (!Array.isArray(patch.tiles)) throw badRequest('The tile list must be an array.');
    const seen = new Set();
    const tiles = [];
    for (const tile of patch.tiles) {
      const errors = validateTile(tile, tiles);
      if (errors.length > 0) throw badRequest('The tile list contains invalid entries.', errors);
      if (seen.has(tile.id)) throw badRequest(`Tile ID ${tile.id} appears more than once.`);
      seen.add(tile.id);
      tiles.push(createTile(tile));
    }
    dictionary.tiles = tiles;
  }
  return persist(dictionary);
}

export async function duplicateDictionary(id, name) {
  const source = await getDictionary(id);
  const { value, errors } = validateName(name ?? `${source.name} copy`, 'Dictionary name');
  if (errors.length > 0) throw badRequest('The tile dictionary could not be duplicated.', errors);
  const newId = slugify(value, 'dictionary');
  const copy = createDictionary({
    id: newId,
    name: value,
    description: source.description,
    tiles: structuredClone(source.tiles)
  });
  return persist(copy);
}

export async function deleteDictionary(id) {
  const file = dictionaryFile(id);
  if (!(await pathExists(file))) throw notFound('That tile dictionary no longer exists.');
  await withFileLock(file, () => removeFile(file));
  return { id };
}

/** Import a dictionary document exported by Tiley (or a compatible file). */
export async function importDictionary(raw) {
  const { dictionary, errors } = migrateDictionary(raw, { makeId });
  if (!dictionary) throw badRequest('That file is not a tile dictionary.', errors);
  const id = slugify(dictionary.name, 'dictionary');
  dictionary.id = id;
  const saved = await persist(dictionary);
  // Non-fatal problems (skipped tiles, duplicate IDs) travel with the result.
  return { ...saved, warnings: errors };
}

/* ------------------------------------------------------------------- tiles  */

export async function addTile(dictionaryId, tileInput) {
  const dictionary = await getDictionary(dictionaryId);
  const tile = createTile({ ...tileInput, id: Number(tileInput?.id) });
  const errors = validateTile(tile, dictionary.tiles);
  if (errors.length > 0) throw badRequest('The tile could not be added.', errors);
  dictionary.tiles.push(tile);
  dictionary.tiles.sort((a, b) => a.id - b.id);
  await persist(dictionary);
  return tile;
}

export async function updateTile(dictionaryId, tileId, patch) {
  const dictionary = await getDictionary(dictionaryId);
  const index = dictionary.tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) throw notFound('That tile no longer exists in this dictionary.');

  const merged = createTile({ ...dictionary.tiles[index], ...patch, id: Number(patch?.id ?? tileId) });
  const others = dictionary.tiles.filter((_, position) => position !== index);
  const errors = validateTile(merged, others);
  if (errors.length > 0) throw badRequest('The tile could not be updated.', errors);

  dictionary.tiles[index] = merged;
  dictionary.tiles.sort((a, b) => a.id - b.id);
  await persist(dictionary);
  return merged;
}

export async function deleteTile(dictionaryId, tileId) {
  const dictionary = await getDictionary(dictionaryId);
  const index = dictionary.tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) throw notFound('That tile no longer exists in this dictionary.');
  dictionary.tiles.splice(index, 1);
  await persist(dictionary);
  return { id: tileId };
}
