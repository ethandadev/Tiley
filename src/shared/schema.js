/**
 * Document schemas: creation, validation and migration for projects and
 * tile dictionaries.
 *
 * Validation is strict on load as well as on save — a hand-edited or corrupted
 * file must produce a clear list of problems rather than a half-loaded editor.
 */

import {
  PROJECT_FORMAT_VERSION,
  DICTIONARY_FORMAT_VERSION,
  LIMITS
} from './constants.js';
import { createGrid, validateGrid } from './tilemap.js';

/* ------------------------------------------------------------------ helpers */

const SLUG_SAFE = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeId(value) {
  return typeof value === 'string' && SLUG_SAFE.test(value);
}

/** Collapse whitespace and clamp length; returns '' for non-strings. */
export function cleanString(value, maxLength = LIMITS.NAME_MAX) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

/* ------------------------------------------------------------------- names  */

export function validateName(name, label = 'Name') {
  const errors = [];
  const clean = cleanString(name);
  if (clean.length === 0) errors.push(`${label} cannot be empty.`);
  if (clean.length > LIMITS.NAME_MAX) errors.push(`${label} must be ${LIMITS.NAME_MAX} characters or fewer.`);
  return { value: clean, errors };
}

/* ------------------------------------------------------------------- maps   */

export function createMap({
  id,
  name = 'Map 1',
  width = 32,
  height = 32,
  tileWidth = 32,
  tileHeight = 32,
  defaultTile = 0,
  dictionaryId = null,
  data = null
} = {}) {
  return {
    id,
    name: cleanString(name) || 'Map 1',
    width,
    height,
    tileWidth,
    tileHeight,
    defaultTile,
    dictionaryId,
    metadata: {},
    data: data ?? createGrid(width, height, defaultTile)
  };
}

export function validateMapSettings({ width, height, tileWidth, tileHeight, defaultTile }) {
  const errors = [];
  if (!Number.isInteger(width) || width < LIMITS.MAP_MIN || width > LIMITS.MAP_MAX) {
    errors.push(`Map width must be a whole number between ${LIMITS.MAP_MIN} and ${LIMITS.MAP_MAX}.`);
  }
  if (!Number.isInteger(height) || height < LIMITS.MAP_MIN || height > LIMITS.MAP_MAX) {
    errors.push(`Map height must be a whole number between ${LIMITS.MAP_MIN} and ${LIMITS.MAP_MAX}.`);
  }
  if (Number.isInteger(width) && Number.isInteger(height) && width * height > LIMITS.MAP_MAX_CELLS) {
    errors.push(`A ${width} x ${height} map has ${width * height} cells, which exceeds the ${LIMITS.MAP_MAX_CELLS} cell limit.`);
  }
  if (!Number.isInteger(tileWidth) || tileWidth < LIMITS.TILE_SIZE_MIN || tileWidth > LIMITS.TILE_SIZE_MAX) {
    errors.push(`Tile width must be a whole number between ${LIMITS.TILE_SIZE_MIN} and ${LIMITS.TILE_SIZE_MAX}.`);
  }
  if (!Number.isInteger(tileHeight) || tileHeight < LIMITS.TILE_SIZE_MIN || tileHeight > LIMITS.TILE_SIZE_MAX) {
    errors.push(`Tile height must be a whole number between ${LIMITS.TILE_SIZE_MIN} and ${LIMITS.TILE_SIZE_MAX}.`);
  }
  if (!Number.isInteger(defaultTile) || defaultTile < LIMITS.TILE_ID_MIN || defaultTile > LIMITS.TILE_ID_MAX) {
    errors.push('The default tile must be a whole number tile ID of 0 or more.');
  }
  return errors;
}

function validateMap(map, index) {
  const where = `Map ${index + 1}`;
  const errors = [];
  if (!isPlainObject(map)) return [`${where} is not a valid map object.`];
  if (!isSafeId(map.id)) errors.push(`${where} has an invalid identifier.`);
  if (cleanString(map.name).length === 0) errors.push(`${where} has no name.`);
  errors.push(...validateMapSettings(map).map((message) => `${where}: ${message}`));
  if (errors.length > 0) return errors;
  errors.push(...validateGrid(map.data, map.width, map.height).map((message) => `${where}: ${message}`));
  if (map.dictionaryId !== null && map.dictionaryId !== undefined && !isSafeId(map.dictionaryId)) {
    errors.push(`${where} references an invalid tile dictionary.`);
  }
  return errors;
}

/* --------------------------------------------------------------- projects   */

export function createProject({ id, name, description = '', maps = [] }) {
  const now = new Date().toISOString();
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id,
    name: cleanString(name) || 'Untitled Project',
    description: cleanString(description, LIMITS.DESCRIPTION_MAX),
    createdAt: now,
    updatedAt: now,
    activeMapId: maps[0]?.id ?? null,
    maps
  };
}

/**
 * Validate a whole project document.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateProject(project) {
  const errors = [];
  if (!isPlainObject(project)) return { ok: false, errors: ['The project file does not contain a project object.'] };
  if (!isSafeId(project.id)) errors.push('The project has an invalid identifier.');
  errors.push(...validateName(project.name, 'Project name').errors);

  if (!Number.isInteger(project.formatVersion) || project.formatVersion < 1) {
    errors.push('The project has no valid format version.');
  } else if (project.formatVersion > PROJECT_FORMAT_VERSION) {
    errors.push(`This project was made with a newer version of Tiley (format ${project.formatVersion}). Update Tiley to open it.`);
  }

  if (!Array.isArray(project.maps) || project.maps.length === 0) {
    errors.push('A project must contain at least one map.');
    return { ok: false, errors };
  }

  const seenIds = new Set();
  project.maps.forEach((map, index) => {
    errors.push(...validateMap(map, index));
    if (isPlainObject(map) && isSafeId(map.id)) {
      if (seenIds.has(map.id)) errors.push(`Two maps share the identifier "${map.id}".`);
      seenIds.add(map.id);
    }
  });

  if (project.activeMapId !== null && !seenIds.has(project.activeMapId)) {
    errors.push('The project points at an active map that does not exist.');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Migrate an older project document forward.
 *
 * Version history:
 *   1 -> 2  Single-map projects (`map`, `tileSize`, `mapSize`, `tiles` object)
 *           became multi-map projects with an external tile dictionary.
 */
export function migrateProject(raw, { makeId }) {
  if (!isPlainObject(raw)) return { project: null, errors: ['The project file is not a JSON object.'], migrated: false };

  const version = Number.isInteger(raw.formatVersion) ? raw.formatVersion
    : Number.isInteger(raw.version) ? raw.version
    : 1;

  if (version > PROJECT_FORMAT_VERSION) {
    return {
      project: null,
      migrated: false,
      errors: [`This project uses format version ${version}, which this version of Tiley does not understand.`]
    };
  }
  if (version === PROJECT_FORMAT_VERSION) {
    return { project: raw, migrated: false, errors: [] };
  }

  // v1 -> v2
  const tileWidth = clampInt(raw.tileSize?.width, LIMITS.TILE_SIZE_MIN, LIMITS.TILE_SIZE_MAX, 32);
  const tileHeight = clampInt(raw.tileSize?.height, LIMITS.TILE_SIZE_MIN, LIMITS.TILE_SIZE_MAX, 32);
  const data = Array.isArray(raw.map) ? raw.map : createGrid(
    clampInt(raw.mapSize?.width, LIMITS.MAP_MIN, LIMITS.MAP_MAX, 32),
    clampInt(raw.mapSize?.height, LIMITS.MAP_MIN, LIMITS.MAP_MAX, 32),
    0
  );
  const height = data.length;
  const width = data[0]?.length ?? 0;

  const map = createMap({
    id: makeId(),
    name: 'Map 1',
    width,
    height,
    tileWidth,
    tileHeight,
    defaultTile: 0,
    dictionaryId: null,
    data
  });

  const project = createProject({
    id: isSafeId(raw.id) ? raw.id : makeId(),
    name: raw.name ?? 'Imported Project',
    maps: [map]
  });
  project.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : project.createdAt;

  // v1 kept tiles inline; hand them back so the caller can build a dictionary.
  const inlineTiles = isPlainObject(raw.tiles)
    ? Object.entries(raw.tiles).map(([id, tile]) => ({
        id: Number.parseInt(id, 10),
        name: cleanString(tile?.name) || `Tile ${id}`,
        image: typeof tile?.image === 'string' ? tile.image : null,
        description: '',
        tags: [],
        metadata: {}
      })).filter((tile) => Number.isInteger(tile.id))
    : [];

  return { project, migrated: true, errors: [], inlineTiles };
}

/* ----------------------------------------------------------- dictionaries   */

export function createDictionary({ id, name, tiles = [], description = '' }) {
  const now = new Date().toISOString();
  return {
    formatVersion: DICTIONARY_FORMAT_VERSION,
    id,
    name: cleanString(name) || 'Untitled Dictionary',
    description: cleanString(description, LIMITS.DESCRIPTION_MAX),
    createdAt: now,
    updatedAt: now,
    tiles
  };
}

export function createTile({ id, name, image = null, description = '', tags = [], metadata = {} }) {
  return {
    id,
    name: cleanString(name) || `Tile ${id}`,
    image,
    description: cleanString(description, LIMITS.DESCRIPTION_MAX),
    tags: normalizeTags(tags),
    metadata: isPlainObject(metadata) ? metadata : {}
  };
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const tag of tags) {
    const clean = cleanString(tag, LIMITS.TAG_MAX).toLowerCase();
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= LIMITS.TAGS_MAX) break;
  }
  return out;
}

export function validateTile(tile, existingTiles = [], { ignoreId = null } = {}) {
  const errors = [];
  if (!Number.isInteger(tile.id) || tile.id < LIMITS.TILE_ID_MIN || tile.id > LIMITS.TILE_ID_MAX) {
    errors.push(`Tile ID must be a whole number between ${LIMITS.TILE_ID_MIN} and ${LIMITS.TILE_ID_MAX}.`);
  }
  if (cleanString(tile.name).length === 0) errors.push('Tile name cannot be empty.');
  if (tile.image !== null && tile.image !== undefined && typeof tile.image !== 'string') {
    errors.push('Tile image reference must be a file name.');
  }
  const clash = existingTiles.find((other) => other.id === tile.id && other.id !== ignoreId);
  if (clash) errors.push(`Tile ID ${tile.id} is already used by "${clash.name}".`);
  return errors;
}

export function validateDictionary(dictionary) {
  const errors = [];
  if (!isPlainObject(dictionary)) return { ok: false, errors: ['The dictionary file does not contain an object.'] };
  if (!isSafeId(dictionary.id)) errors.push('The dictionary has an invalid identifier.');
  errors.push(...validateName(dictionary.name, 'Dictionary name').errors);

  if (!Number.isInteger(dictionary.formatVersion) || dictionary.formatVersion < 1) {
    errors.push('The dictionary has no valid format version.');
  } else if (dictionary.formatVersion > DICTIONARY_FORMAT_VERSION) {
    errors.push(`This dictionary was made with a newer version of Tiley (format ${dictionary.formatVersion}).`);
  }

  if (!Array.isArray(dictionary.tiles)) {
    errors.push('The dictionary has no tile list.');
    return { ok: false, errors };
  }

  const seen = new Set();
  dictionary.tiles.forEach((tile, index) => {
    if (!isPlainObject(tile)) {
      errors.push(`Tile ${index + 1} is not a valid tile definition.`);
      return;
    }
    if (!Number.isInteger(tile.id)) {
      errors.push(`Tile ${index + 1} has a non-integer ID.`);
      return;
    }
    if (seen.has(tile.id)) errors.push(`Tile ID ${tile.id} appears more than once.`);
    seen.add(tile.id);
    if (cleanString(tile.name).length === 0) errors.push(`Tile ${tile.id} has no name.`);
  });

  return { ok: errors.length === 0, errors };
}

/** Normalise an imported dictionary document into the current schema. */
export function migrateDictionary(raw, { makeId }) {
  if (!isPlainObject(raw)) return { dictionary: null, errors: ['The dictionary file is not a JSON object.'] };

  // Accept both `tiles: [...]` and the v1 project-style `tiles: { "0": {...} }`.
  let tiles = [];
  if (Array.isArray(raw.tiles)) {
    tiles = raw.tiles;
  } else if (isPlainObject(raw.tiles)) {
    tiles = Object.entries(raw.tiles).map(([id, tile]) => ({ ...tile, id: Number.parseInt(id, 10) }));
  } else {
    return { dictionary: null, errors: ['The dictionary contains no tiles.'] };
  }

  const normalized = [];
  const seen = new Set();
  const errors = [];
  for (const tile of tiles) {
    if (!isPlainObject(tile) || !Number.isInteger(tile.id)) {
      errors.push('A tile entry is missing a whole-number ID and was skipped.');
      continue;
    }
    if (seen.has(tile.id)) {
      errors.push(`Tile ID ${tile.id} appears more than once in the file.`);
      continue;
    }
    seen.add(tile.id);
    normalized.push(createTile(tile));
  }
  if (normalized.length === 0) errors.push('No usable tiles were found in the file.');

  const dictionary = createDictionary({
    id: isSafeId(raw.id) ? raw.id : makeId(),
    name: raw.name ?? 'Imported Dictionary',
    description: raw.description ?? '',
    tiles: normalized
  });
  dictionary.formatVersion = DICTIONARY_FORMAT_VERSION;
  return { dictionary, errors };
}

/** Merge stored settings over the defaults, dropping anything unrecognised. */
export function normalizeSettings(raw, defaults) {
  const out = { ...defaults };
  if (!isPlainObject(raw)) return out;

  if (raw.theme === 'dark' || raw.theme === 'light') out.theme = raw.theme;
  out.defaultTileWidth = clampInt(raw.defaultTileWidth, LIMITS.TILE_SIZE_MIN, LIMITS.TILE_SIZE_MAX, defaults.defaultTileWidth);
  out.defaultTileHeight = clampInt(raw.defaultTileHeight, LIMITS.TILE_SIZE_MIN, LIMITS.TILE_SIZE_MAX, defaults.defaultTileHeight);
  out.autosaveEnabled = typeof raw.autosaveEnabled === 'boolean' ? raw.autosaveEnabled : defaults.autosaveEnabled;
  out.autosaveIntervalSeconds = clampInt(raw.autosaveIntervalSeconds, 5, 600, defaults.autosaveIntervalSeconds);
  out.showGrid = typeof raw.showGrid === 'boolean' ? raw.showGrid : defaults.showGrid;
  out.gridColor = /^#[0-9a-fA-F]{6}$/.test(raw.gridColor) ? raw.gridColor : defaults.gridColor;
  out.gridOpacity = Math.min(1, Math.max(0.05, Number(raw.gridOpacity) || defaults.gridOpacity));
  out.defaultExportFormat = ['txt', 'csv', 'json', 'png'].includes(raw.defaultExportFormat)
    ? raw.defaultExportFormat : defaults.defaultExportFormat;
  out.confirmDestructive = typeof raw.confirmDestructive === 'boolean' ? raw.confirmDestructive : defaults.confirmDestructive;
  out.paletteThumbnailSize = clampInt(raw.paletteThumbnailSize, 24, 128, defaults.paletteThumbnailSize);
  return out;
}
