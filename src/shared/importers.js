/**
 * Import parsers for numeric tilemaps and Tiley documents.
 *
 * Every parser returns `{ ok, grid|data, errors, warnings }` rather than
 * throwing, so the UI can show a precise, user-readable reason for a rejection
 * instead of a stack trace.
 */

import { LIMITS } from './constants.js';
import { validateGrid, gridWidth } from './tilemap.js';

/**
 * Parse a delimited numeric tilemap (both the TXT `0, 0, 1` form and plain
 * CSV `0,0,1`). Blank lines at the start/end are ignored; a blank line in the
 * middle is an error because it would silently shift every following row.
 */
export function parseDelimitedMap(text, options = {}) {
  const errors = [];
  const warnings = [];
  const { expectedWidth = null, expectedHeight = null, allowHeader = true } = options;

  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, grid: null, errors: ['The file is empty.'], warnings };
  }

  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  // Trim leading/trailing blank lines only.
  let start = 0;
  let end = rawLines.length;
  while (start < end && rawLines[start].trim() === '') start++;
  while (end > start && rawLines[end - 1].trim() === '') end--;
  let lines = rawLines.slice(start, end);

  if (lines.length === 0) {
    return { ok: false, grid: null, errors: ['The file contains no map rows.'], warnings };
  }

  // Skip a non-numeric header row (e.g. "x0,x1,x2") when permitted.
  if (allowHeader && lines.length > 1 && /[A-Za-z]/.test(lines[0])) {
    warnings.push('The first line looked like a header and was ignored.');
    lines = lines.slice(1);
  }

  const grid = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      errors.push(`Line ${i + 1} is blank. Remove blank lines from the middle of the map.`);
      break;
    }
    const parts = line.split(',').map((part) => part.trim());
    const row = [];
    for (let column = 0; column < parts.length; column++) {
      const token = parts[column];
      if (!/^-?\d+$/.test(token)) {
        errors.push(`Line ${i + 1}, column ${column + 1} contains "${token}", which is not a whole number.`);
        break;
      }
      const value = Number.parseInt(token, 10);
      if (value < LIMITS.TILE_ID_MIN || value > LIMITS.TILE_ID_MAX) {
        errors.push(`Line ${i + 1}, column ${column + 1} contains tile ID ${value}, which is out of range.`);
        break;
      }
      row.push(value);
    }
    if (errors.length > 0) break;
    grid.push(row);
  }

  if (errors.length > 0) return { ok: false, grid: null, errors, warnings };

  const width = gridWidth(grid);
  for (let y = 0; y < grid.length; y++) {
    if (grid[y].length !== width) {
      errors.push(`Row ${y + 1} contains ${grid[y].length} tiles, but the expected width is ${width}.`);
      break;
    }
  }
  if (errors.length > 0) return { ok: false, grid: null, errors, warnings };

  if (expectedWidth !== null && width !== expectedWidth) {
    errors.push(`The imported map is ${width} tiles wide, but this map is ${expectedWidth} tiles wide.`);
  }
  if (expectedHeight !== null && grid.length !== expectedHeight) {
    errors.push(`The imported map is ${grid.length} tiles tall, but this map is ${expectedHeight} tiles tall.`);
  }
  if (errors.length > 0) return { ok: false, grid: null, errors, warnings };

  errors.push(...validateGrid(grid, width, grid.length));
  if (errors.length > 0) return { ok: false, grid: null, errors, warnings };

  if (width * grid.length > LIMITS.MAP_MAX_CELLS) {
    return {
      ok: false,
      grid: null,
      errors: [`The imported map has ${width * grid.length} cells, which exceeds the ${LIMITS.MAP_MAX_CELLS} cell limit.`],
      warnings
    };
  }

  return { ok: true, grid, width, height: grid.length, errors: [], warnings };
}

/** Parse JSON safely, returning a readable message instead of throwing. */
export function parseJSONSafely(text) {
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object') {
      return { ok: false, value: null, errors: ['The file does not contain a JSON object.'] };
    }
    return { ok: true, value, errors: [] };
  } catch (error) {
    return { ok: false, value: null, errors: [`The file is not valid JSON: ${error.message}`] };
  }
}

/**
 * Accept either a Tiley map export (`{ data: [[...]] }`) or a bare
 * `[[...]]` grid and return the numeric grid.
 */
export function extractGridFromJSON(value) {
  const candidate = Array.isArray(value) ? value
    : Array.isArray(value?.data) ? value.data
    : Array.isArray(value?.map) ? value.map
    : null;

  if (!candidate) {
    return { ok: false, grid: null, errors: ['No tilemap data found. Expected a "data" array of rows.'] };
  }
  const errors = validateGrid(candidate);
  if (errors.length > 0) return { ok: false, grid: null, errors };
  return { ok: true, grid: candidate, errors: [] };
}

/** Tile IDs in the grid that have no definition in the dictionary. */
export function findMissingTileIds(grid, dictionary) {
  const known = new Set((dictionary?.tiles ?? []).map((tile) => tile.id));
  const missing = new Set();
  for (const row of grid) {
    for (const value of row) if (!known.has(value)) missing.add(value);
  }
  return [...missing].sort((a, b) => a - b);
}
