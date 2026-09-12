/**
 * Application state.
 *
 * One mutable state object plus a topic-based emitter. Views subscribe to the
 * topics they care about ('project', 'map', 'tiles', 'tool', 'viewport',
 * 'status', 'selection', 'settings') instead of re-rendering everything on
 * every change — which matters because the canvas redraw is the expensive part.
 *
 * The tilemap itself is *not* copied into the store on every edit: tools mutate
 * `state.project.maps[n].data` in place and emit 'map'. That keeps painting on
 * a 1000x1000 map allocation-free.
 */

import { DEFAULT_SETTINGS } from '../../shared/constants.js';

const TOPICS = ['project', 'map', 'tiles', 'tool', 'viewport', 'status', 'selection', 'settings', 'projects'];

function createEmitter() {
  const listeners = new Map(TOPICS.map((topic) => [topic, new Set()]));
  return {
    on(topic, handler) {
      const set = listeners.get(topic);
      if (!set) throw new Error(`Unknown state topic: ${topic}`);
      set.add(handler);
      return () => set.delete(handler);
    },
    emit(...topics) {
      for (const topic of topics) {
        for (const handler of listeners.get(topic) ?? []) handler(state);
      }
    }
  };
}

export const state = {
  /** Persisted application settings. */
  settings: { ...DEFAULT_SETTINGS },

  /** Browser data. */
  projects: [],
  recents: [],
  dictionarySummaries: [],

  /** Loaded documents. */
  project: null,
  /** dictionaryId -> full dictionary document. */
  dictionaries: new Map(),

  /** Editor state. */
  activeMapId: null,
  selectedTileId: 0,
  tool: 'pencil',
  showGrid: true,
  zoom: 1,
  panX: 0,
  panY: 0,
  cursor: { x: -1, y: -1 },
  selection: null,       // { x, y, width, height }
  clipboard: null,       // number[][]
  preview: null,         // { cells: [{x,y}], tileId } drawn as a ghost

  /** True until the viewport has been fitted for the current map. */
  needsFit: false,

  /** Persistence state. */
  dirty: false,
  saveStatus: 'saved',   // 'saved' | 'saving' | 'unsaved' | 'error'
  lastSavedAt: null,

  /** Palette view state. */
  paletteQuery: '',
  paletteSort: 'id-asc',
  paletteTags: new Set()
};

const emitter = createEmitter();
export const on = emitter.on;
export const emit = emitter.emit;

/* ------------------------------------------------------------- selectors - */

export function activeMap() {
  if (!state.project) return null;
  return state.project.maps.find((map) => map.id === state.activeMapId) ?? state.project.maps[0] ?? null;
}

export function activeDictionary() {
  const map = activeMap();
  if (!map?.dictionaryId) return null;
  return state.dictionaries.get(map.dictionaryId) ?? null;
}

export function tileById(id) {
  return activeDictionary()?.tiles.find((tile) => tile.id === id) ?? null;
}

/** Human label for a tile ID, honest about why a name is unavailable. */
export function tileLabel(id) {
  const tile = tileById(id);
  if (tile) return `${id} — ${tile.name}`;
  return activeDictionary() ? `${id} — missing tile` : `${id} — no tile dictionary`;
}

/* --------------------------------------------------------------- setters - */

export function setSaveStatus(status, { savedAt = null } = {}) {
  state.saveStatus = status;
  if (savedAt) state.lastSavedAt = savedAt;
  if (status === 'saved') state.dirty = false;
  emit('status');
}

/** Mark the document as changed; autosave picks this up. */
export function markDirty() {
  state.dirty = true;
  if (state.saveStatus !== 'saving') state.saveStatus = 'unsaved';
  emit('status');
}

export function setTool(tool) {
  if (state.tool === tool) return;
  state.tool = tool;
  state.preview = null;
  emit('tool', 'map');
}

export function setSelectedTile(id) {
  if (state.selectedTileId === id) return;
  state.selectedTileId = id;
  emit('tiles', 'status');
}

export function setSelection(selection) {
  state.selection = selection;
  emit('selection', 'map', 'status');
}

export function setCursor(x, y) {
  if (state.cursor.x === x && state.cursor.y === y) return;
  state.cursor = { x, y };
  emit('status', 'map');
}

export function setViewport({ zoom, panX, panY }) {
  if (zoom !== undefined) state.zoom = zoom;
  if (panX !== undefined) state.panX = panX;
  if (panY !== undefined) state.panY = panY;
  emit('viewport', 'map', 'status');
}
