/**
 * Undo / redo.
 *
 * Entries store *diffs*, not snapshots:
 *
 *   { kind: 'cells',  mapId, changes: [{ x, y, before, after }], label }
 *   { kind: 'resize', mapId, before: { width, height, data }, after: {...} }
 *
 * A pencil stroke across a 1000x1000 map therefore costs a few hundred bytes
 * instead of 4 MB. Only a resize — which genuinely replaces the grid — keeps
 * full copies, and those are capped by the same depth limit as everything else.
 */

import { LIMITS } from '../../shared/constants.js';
import { applyChanges } from '../../shared/tilemap.js';
import { state, emit, markDirty } from './store.js';

const undoStack = [];
const redoStack = [];

export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  emit('status');
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function undoLabel() { return undoStack.at(-1)?.label ?? null; }
export function redoLabel() { return redoStack.at(-1)?.label ?? null; }

/**
 * Threshold above which a change list is packed into typed arrays.
 * A million-cell flood fill as objects costs tens of megabytes; as three
 * Int32Arrays it costs twelve, and applying it is faster too.
 */
const COMPACT_THRESHOLD = 20_000;

/** Pack a change list into typed arrays keyed by linear cell index. */
function compact(entry, width) {
  const count = entry.changes.length;
  const indices = new Int32Array(count);
  const before = new Int32Array(count);
  const after = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const change = entry.changes[i];
    indices[i] = change.y * width + change.x;
    before[i] = change.before;
    after[i] = change.after;
  }
  return { kind: 'cells-compact', mapId: entry.mapId, label: entry.label, width, indices, before, after };
}

/** Record an already-applied edit. No-op edits are ignored. */
export function pushHistory(entry) {
  if (entry.kind === 'cells' && entry.changes.length === 0) return;
  if (entry.kind === 'cells' && entry.changes.length > COMPACT_THRESHOLD) {
    const map = state.project?.maps.find((candidate) => candidate.id === entry.mapId);
    if (map) entry = compact(entry, map.width);
  }
  undoStack.push(entry);
  if (undoStack.length > LIMITS.UNDO_DEPTH) undoStack.shift();
  redoStack.length = 0;
  markDirty();
  emit('status');
}

function mapFor(entry) {
  return state.project?.maps.find((map) => map.id === entry.mapId) ?? null;
}

function applyEntry(entry, direction) {
  const map = mapFor(entry);
  if (!map) return false;

  if (entry.kind === 'cells') {
    applyChanges(map.data, entry.changes, direction);
    return true;
  }
  if (entry.kind === 'cells-compact') {
    const values = direction === 'before' ? entry.before : entry.after;
    const width = entry.width;
    for (let i = 0; i < entry.indices.length; i++) {
      const index = entry.indices[i];
      const x = index % width;
      const y = (index - x) / width;
      if (map.data[y]) map.data[y][x] = values[i];
    }
    return true;
  }
  if (entry.kind === 'resize') {
    const target = direction === 'before' ? entry.before : entry.after;
    map.data = target.data.map((row) => row.slice());
    map.width = target.width;
    map.height = target.height;
    return true;
  }
  return false;
}

/** Undo the most recent edit. Returns the map id that changed, or null. */
export function undo() {
  const entry = undoStack.pop();
  if (!entry) return null;
  if (!applyEntry(entry, 'before')) return null;
  redoStack.push(entry);
  markDirty();
  emit('map', 'status', 'project');
  return entry;
}

/** Redo the most recently undone edit. */
export function redo() {
  const entry = redoStack.pop();
  if (!entry) return null;
  if (!applyEntry(entry, 'after')) return null;
  undoStack.push(entry);
  markDirty();
  emit('map', 'status', 'project');
  return entry;
}

/** Drop history entries belonging to a map that no longer exists. */
export function forgetMap(mapId) {
  for (const stack of [undoStack, redoStack]) {
    for (let index = stack.length - 1; index >= 0; index--) {
      if (stack[index].mapId === mapId) stack.splice(index, 1);
    }
  }
  emit('status');
}
