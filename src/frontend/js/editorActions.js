/**
 * Edit operations on the active map.
 *
 * Every mutation of tile data in the application goes through this module, so
 * undo recording, the "restrict edits to the selection" rule and dirty-marking
 * are implemented exactly once.
 */

import { state, activeMap, emit, markDirty, setSelection } from './store.js';
import { pushHistory } from './history.js';
import {
  setTiles, floodFill, lineCells, rectCells, replaceAll,
  copyRegion, pasteRegion, resizeGrid, cloneGrid
} from '../../shared/tilemap.js';
import { requestRender } from './renderer.js';

/** An open multi-cell gesture (a pencil drag) accumulating into one undo step. */
let stroke = null;

export function beginStroke(label) {
  stroke = { label, changes: [] };
}

export function isStroking() {
  return stroke !== null;
}

/** Finish the open gesture and record it as a single undo entry. */
export function endStroke() {
  if (!stroke) return;
  const finished = stroke;
  stroke = null;
  if (finished.changes.length > 0) {
    pushHistory({ kind: 'cells', mapId: activeMap()?.id, changes: finished.changes, label: finished.label });
  }
}

/** When a selection is active, edits are clipped to it. */
function allowedCells(cells) {
  const selection = state.selection;
  if (!selection) return cells;
  return cells.filter((cell) =>
    cell.x >= selection.x && cell.x < selection.x + selection.width &&
    cell.y >= selection.y && cell.y < selection.y + selection.height);
}

/** Record changes that have already been applied to the grid. */
function record(changes, label) {
  if (changes.length === 0) return changes;
  if (stroke) stroke.changes.push(...changes);
  else pushHistory({ kind: 'cells', mapId: activeMap()?.id, changes, label });
  markDirty();
  emit('map');
  requestRender();
  return changes;
}

/* ------------------------------------------------------------ operations - */

export function paintCells(cells, tileId, label = 'Paint') {
  const map = activeMap();
  if (!map) return [];
  return record(setTiles(map.data, allowedCells(cells), tileId), label);
}

export function paintCell(x, y, tileId, label = 'Paint') {
  return paintCells([{ x, y }], tileId, label);
}

export function paintLine(x0, y0, x1, y1, tileId, label = 'Line') {
  return paintCells(lineCells(x0, y0, x1, y1), tileId, label);
}

export function paintRectangle(x0, y0, x1, y1, tileId, { filled = true, label = 'Rectangle' } = {}) {
  return paintCells(rectCells(x0, y0, x1, y1, filled), tileId, label);
}

/**
 * Flood fill. When a selection is active the fill is clipped to it, which is
 * why the raw result is reverted first and only the allowed cells re-applied.
 */
export function fillRegion(x, y, tileId, label = 'Fill') {
  const map = activeMap();
  if (!map) return [];
  const changes = floodFill(map.data, x, y, tileId);
  if (!state.selection) return record(changes, label);

  for (const change of changes) map.data[change.y][change.x] = change.before;
  const allowed = allowedCells(changes);
  for (const change of allowed) map.data[change.y][change.x] = change.after;
  return record(allowed, label);
}

/** Replace every instance of one tile ID with another across the whole map. */
export function replaceTileId(fromId, toId, label = 'Replace tile') {
  const map = activeMap();
  if (!map) return [];
  return record(replaceAll(map.data, fromId, toId), label);
}

export function eraseSelection() {
  const map = activeMap();
  const selection = state.selection;
  if (!map || !selection) return [];
  const cells = [];
  for (let y = selection.y; y < selection.y + selection.height; y++) {
    for (let x = selection.x; x < selection.x + selection.width; x++) cells.push({ x, y });
  }
  return record(setTiles(map.data, cells, map.defaultTile), 'Erase selection');
}

export function copySelection() {
  const map = activeMap();
  const selection = state.selection;
  if (!map || !selection) return false;
  state.clipboard = copyRegion(map.data, selection.x, selection.y, selection.width, selection.height);
  return true;
}

export function cutSelection() {
  if (!copySelection()) return false;
  eraseSelection();
  return true;
}

/**
 * Paste the clipboard at a cell, defaulting to the current selection corner.
 *
 * A paste is a deliberate placement, so unlike the drawing tools it is *not*
 * clipped to the selection — otherwise pasting next to a selected region, or
 * duplicating it, would silently drop most of the pasted block. It is still
 * clipped to the edges of the map.
 */
export function pasteClipboard(x, y) {
  const map = activeMap();
  if (!map || !state.clipboard) return [];
  const targetX = x ?? state.selection?.x ?? 0;
  const targetY = y ?? state.selection?.y ?? 0;
  return record(pasteRegion(map.data, state.clipboard, targetX, targetY), 'Paste');
}

/** Duplicate the selected region immediately to its right, and select the copy. */
export function duplicateSelection() {
  const selection = state.selection;
  if (!selection || !copySelection()) return [];
  const changes = pasteClipboard(selection.x + selection.width, selection.y);
  setSelection({ ...selection, x: selection.x + selection.width });
  return changes;
}

/**
 * Resize the active map. Recorded as a single undo entry holding both grids,
 * because a resize is the one operation a diff cannot describe.
 */
export function resizeActiveMap(newWidth, newHeight, anchor) {
  const map = activeMap();
  if (!map) return null;

  const before = { width: map.width, height: map.height, data: cloneGrid(map.data) };
  const result = resizeGrid(map.data, newWidth, newHeight, anchor, map.defaultTile);
  map.data = result.grid;
  map.width = newWidth;
  map.height = newHeight;

  pushHistory({
    kind: 'resize',
    mapId: map.id,
    before,
    after: { width: newWidth, height: newHeight, data: cloneGrid(result.grid) },
    label: 'Resize map'
  });
  markDirty();
  emit('map', 'project');
  requestRender();
  return result;
}

/** Preview how many cells a prospective resize would discard. */
export function previewResize(map, newWidth, newHeight, anchor) {
  const result = resizeGrid(map.data, newWidth, newHeight, anchor, map.defaultTile);
  return { removedCells: result.removedCells, removedNonDefault: result.removedNonDefault };
}
