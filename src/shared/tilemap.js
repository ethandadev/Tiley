/**
 * Pure tilemap operations.
 *
 * The tilemap is always a plain `number[][]` (rows of integer tile IDs) — that
 * grid is the source of truth for the whole application. Nothing in this module
 * knows about images, canvases or the DOM, which is what lets the same code run
 * in the browser and in the Node test suite.
 *
 * Mutating helpers return a *change list* rather than a copy of the grid:
 *
 *     [{ x, y, before, after }, ...]
 *
 * Change lists are what the undo stack stores, so editing a 1000x1000 map costs
 * memory proportional to the number of cells actually touched, not to the map.
 */

import { LIMITS, ANCHORS } from './constants.js';

/** Create a `height x width` grid filled with `fill`. */
export function createGrid(width, height, fill = 0) {
  const grid = new Array(height);
  for (let y = 0; y < height; y++) grid[y] = new Array(width).fill(fill);
  return grid;
}

/** Deep copy a grid. */
export function cloneGrid(grid) {
  const out = new Array(grid.length);
  for (let y = 0; y < grid.length; y++) out[y] = grid[y].slice();
  return out;
}

export function gridWidth(grid) {
  return grid.length === 0 ? 0 : grid[0].length;
}

export function gridHeight(grid) {
  return grid.length;
}

export function inBounds(grid, x, y) {
  return y >= 0 && y < grid.length && x >= 0 && x < (grid[0]?.length ?? 0);
}

/** Read a cell, or `undefined` when out of bounds. */
export function getTile(grid, x, y) {
  return inBounds(grid, x, y) ? grid[y][x] : undefined;
}

/**
 * Apply a change list to a grid. Used for both redo (`after`) and undo
 * (`before`) by flipping `direction`.
 */
export function applyChanges(grid, changes, direction = 'after') {
  const key = direction === 'before' ? 'before' : 'after';
  for (const change of changes) {
    if (inBounds(grid, change.x, change.y)) grid[change.y][change.x] = change[key];
  }
  return grid;
}

/** Set one cell. Returns a one-element change list, or `[]` when it is a no-op. */
export function setTile(grid, x, y, value) {
  if (!inBounds(grid, x, y)) return [];
  const before = grid[y][x];
  if (before === value) return [];
  grid[y][x] = value;
  return [{ x, y, before, after: value }];
}

/** Set many cells at once, skipping no-ops and out-of-bounds coordinates. */
export function setTiles(grid, cells, value) {
  const changes = [];
  const width = gridWidth(grid);
  const seen = new Set();
  for (const { x, y } of cells) {
    const key = y * width + x;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!inBounds(grid, x, y)) continue;
    const before = grid[y][x];
    if (before === value) continue;
    grid[y][x] = value;
    changes.push({ x, y, before, after: value });
  }
  return changes;
}

/**
 * Iterative 4-connected flood fill.
 *
 * A recursive implementation blows the stack on large uniform maps (a 1000x1000
 * map is a million-deep recursion), so this uses an explicit stack plus a
 * `Uint8Array` visited mask — O(cells) time, O(cells) memory, no recursion.
 */
export function floodFill(grid, startX, startY, value) {
  if (!inBounds(grid, startX, startY)) return [];
  const target = grid[startY][startX];
  if (target === value) return [];

  const width = gridWidth(grid);
  const height = gridHeight(grid);
  const visited = new Uint8Array(width * height);
  const stack = [startY * width + startX];
  const changes = [];

  while (stack.length > 0) {
    const index = stack.pop();
    if (visited[index]) continue;
    visited[index] = 1;

    const x = index % width;
    const y = (index - x) / width;
    if (grid[y][x] !== target) continue;

    grid[y][x] = value;
    changes.push({ x, y, before: target, after: value });

    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - width);
    if (y < height - 1) stack.push(index + width);
  }
  return changes;
}

/** Replace every occurrence of `fromId` with `toId` across the whole grid. */
export function replaceAll(grid, fromId, toId) {
  const changes = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] === fromId) {
        grid[y][x] = toId;
        changes.push({ x, y, before: fromId, after: toId });
      }
    }
  }
  return changes;
}

/** Bresenham line between two cells (inclusive of both ends). */
export function lineCells(x0, y0, x1, y1) {
  const cells = [];
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;

  for (;;) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return cells;
}

/** Cells of an axis-aligned rectangle; `filled: false` yields the outline only. */
export function rectCells(x0, y0, x1, y1, filled = true) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const cells = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const onEdge = x === minX || x === maxX || y === minY || y === maxY;
      if (filled || onEdge) cells.push({ x, y });
    }
  }
  return cells;
}

/** Normalise two corner points into `{ x, y, width, height }`. */
export function normalizeRect(x0, y0, x1, y1) {
  const minX = Math.min(x0, x1);
  const minY = Math.min(y0, y1);
  return {
    x: minX,
    y: minY,
    width: Math.abs(x1 - x0) + 1,
    height: Math.abs(y1 - y0) + 1
  };
}

/**
 * Offset at which the old grid is placed inside the new grid for a given
 * anchor. A negative offset means content is cropped on that side.
 */
export function anchorOffset(oldWidth, oldHeight, newWidth, newHeight, anchor) {
  if (!ANCHORS.includes(anchor)) anchor = 'top-left';
  const [vertical, horizontal] = anchor === 'center'
    ? ['middle', 'center']
    : anchor.split('-');

  const dx = horizontal === 'left' ? 0
    : horizontal === 'right' ? newWidth - oldWidth
    : Math.floor((newWidth - oldWidth) / 2);
  const dy = vertical === 'top' ? 0
    : vertical === 'bottom' ? newHeight - oldHeight
    : Math.floor((newHeight - oldHeight) / 2);

  return { dx, dy };
}

/**
 * Resize a grid, preserving whatever content still fits.
 * Returns the new grid plus how many non-default cells were dropped, so the UI
 * can warn before a destructive resize.
 */
export function resizeGrid(grid, newWidth, newHeight, anchor = 'top-left', fill = 0) {
  const oldWidth = gridWidth(grid);
  const oldHeight = gridHeight(grid);
  const { dx, dy } = anchorOffset(oldWidth, oldHeight, newWidth, newHeight, anchor);
  const next = createGrid(newWidth, newHeight, fill);

  let removedCells = 0;
  let removedNonDefault = 0;
  for (let y = 0; y < oldHeight; y++) {
    for (let x = 0; x < oldWidth; x++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && tx < newWidth && ty >= 0 && ty < newHeight) {
        next[ty][tx] = grid[y][x];
      } else {
        removedCells++;
        if (grid[y][x] !== fill) removedNonDefault++;
      }
    }
  }
  return { grid: next, removedCells, removedNonDefault, offset: { dx, dy } };
}

/** Copy a rectangular region out of the grid. */
export function copyRegion(grid, x, y, width, height) {
  const out = [];
  for (let row = 0; row < height; row++) {
    const line = [];
    for (let col = 0; col < width; col++) {
      line.push(getTile(grid, x + col, y + row) ?? 0);
    }
    out.push(line);
  }
  return out;
}

/** Stamp a region (as produced by `copyRegion`) at `x, y`. */
export function pasteRegion(grid, region, x, y) {
  const changes = [];
  for (let row = 0; row < region.length; row++) {
    for (let col = 0; col < region[row].length; col++) {
      const tx = x + col;
      const ty = y + row;
      if (!inBounds(grid, tx, ty)) continue;
      const before = grid[ty][tx];
      const after = region[row][col];
      if (before === after) continue;
      grid[ty][tx] = after;
      changes.push({ x: tx, y: ty, before, after });
    }
  }
  return changes;
}

/** Histogram of tile IDs: `Map<tileId, count>`. */
export function tileUsage(grid) {
  const usage = new Map();
  for (const row of grid) {
    for (const value of row) {
      usage.set(value, (usage.get(value) ?? 0) + 1);
    }
  }
  return usage;
}

/** How many cells use `tileId`. */
export function countTile(grid, tileId) {
  let count = 0;
  for (const row of grid) {
    for (const value of row) if (value === tileId) count++;
  }
  return count;
}

/** Sorted list of distinct tile IDs present in the grid. */
export function distinctTileIds(grid) {
  return [...tileUsage(grid).keys()].sort((a, b) => a - b);
}

/**
 * Structural check for a grid loaded from disk or an import.
 * Returns a list of human-readable problems; empty means valid.
 */
export function validateGrid(grid, expectedWidth, expectedHeight) {
  const errors = [];
  if (!Array.isArray(grid) || grid.length === 0) {
    errors.push('Map data must be a non-empty array of rows.');
    return errors;
  }
  const width = expectedWidth ?? gridWidth(grid);
  const height = expectedHeight ?? gridHeight(grid);

  if (height !== grid.length) {
    errors.push(`Map has ${grid.length} rows, but the expected height is ${height}.`);
  }
  if (width * height > LIMITS.MAP_MAX_CELLS) {
    errors.push(`Map is too large (${width} x ${height}); the maximum is ${LIMITS.MAP_MAX_CELLS} cells.`);
  }

  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    if (!Array.isArray(row)) {
      errors.push(`Row ${y + 1} is not a list of tile IDs.`);
      continue;
    }
    if (row.length !== width) {
      errors.push(`Row ${y + 1} contains ${row.length} tiles, but the expected width is ${width}.`);
    }
    for (let x = 0; x < row.length; x++) {
      const value = row[x];
      if (!Number.isInteger(value)) {
        errors.push(`Row ${y + 1}, column ${x + 1} contains "${value}", which is not a whole number.`);
      } else if (value < LIMITS.TILE_ID_MIN || value > LIMITS.TILE_ID_MAX) {
        errors.push(`Row ${y + 1}, column ${x + 1} contains tile ID ${value}, which is out of range.`);
      }
      if (errors.length > 25) {
        errors.push('Too many problems to list; the remaining rows were not checked.');
        return errors;
      }
    }
  }
  return errors;
}
