/**
 * Export formats.
 *
 * The TXT and CSV writers are deliberately minimal: the numeric grid is the
 * contract with the game engine consuming these files, so nothing decorative
 * (headers, brackets, quotes, row numbers, trailing whitespace) is ever added.
 */

import { PROJECT_FORMAT_VERSION } from './constants.js';

/**
 * Plain text export.
 * Rows are separated by a single "\n"; tiles by ", " (comma + one space).
 * There is no trailing newline, no header and no metadata.
 */
export function toTXT(grid) {
  return grid.map((row) => row.join(', ')).join('\n');
}

/**
 * CSV export. Tile IDs are bare integers, so no quoting or escaping applies.
 * Rows separated by "\n", values by ",".
 */
export function toCSV(grid) {
  return grid.map((row) => row.join(',')).join('\n');
}

/**
 * CSV with an optional header row of column indices. Only produced when the
 * user explicitly asks for metadata.
 */
export function toCSVWithHeader(grid) {
  const width = grid[0]?.length ?? 0;
  const header = Array.from({ length: width }, (_, i) => `x${i}`).join(',');
  return [header, ...grid.map((row) => row.join(','))].join('\n');
}

/**
 * Rich JSON export for one map: dimensions, tile size, dictionary and data.
 */
export function toJSON(project, map, dictionary) {
  const payload = {
    formatVersion: PROJECT_FORMAT_VERSION,
    generator: 'Tiley',
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      description: project.description ?? ''
    },
    map: {
      id: map.id,
      name: map.name,
      size: { width: map.width, height: map.height },
      tileSize: { width: map.tileWidth, height: map.tileHeight },
      defaultTile: map.defaultTile,
      metadata: map.metadata ?? {}
    },
    tiles: dictionary
      ? Object.fromEntries(dictionary.tiles.map((tile) => [
          String(tile.id),
          {
            name: tile.name,
            image: tile.image ?? null,
            description: tile.description ?? '',
            tags: tile.tags ?? [],
            metadata: tile.metadata ?? {}
          }
        ]))
      : {},
    dictionary: dictionary ? { id: dictionary.id, name: dictionary.name } : null,
    data: map.data
  };
  return JSON.stringify(payload, null, 2);
}

/** Whole-project JSON export (every map plus the dictionaries they reference). */
export function projectToJSON(project, dictionaries) {
  return JSON.stringify({
    formatVersion: PROJECT_FORMAT_VERSION,
    generator: 'Tiley',
    exportedAt: new Date().toISOString(),
    project,
    dictionaries
  }, null, 2);
}

/** Portable tile dictionary document. */
export function dictionaryToJSON(dictionary) {
  return JSON.stringify(dictionary, null, 2);
}

/** File extension for an export format id. */
export function extensionFor(format) {
  switch (format) {
    case 'txt': return 'txt';
    case 'csv':
    case 'csv-header': return 'csv';
    case 'json':
    case 'project-json': return 'json';
    case 'png': return 'png';
    default: return 'txt';
  }
}
