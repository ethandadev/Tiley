/**
 * Constants shared by the Node backend and the browser frontend.
 * This module must stay dependency-free so it can be loaded in both places.
 */

/** Current on-disk schema version for a project document. */
export const PROJECT_FORMAT_VERSION = 2;

/** Current on-disk schema version for a tile dictionary document. */
export const DICTIONARY_FORMAT_VERSION = 1;

/** Hard limits used for validation. Generous, but they stop absurd allocations. */
export const LIMITS = Object.freeze({
  MAP_MIN: 1,
  MAP_MAX: 2000,
  MAP_MAX_CELLS: 2_500_000,
  TILE_SIZE_MIN: 1,
  TILE_SIZE_MAX: 1024,
  TILE_ID_MIN: 0,
  TILE_ID_MAX: 2_147_483_647,
  NAME_MAX: 120,
  DESCRIPTION_MAX: 2000,
  TAG_MAX: 40,
  TAGS_MAX: 32,
  ASSET_BYTES_MAX: 8 * 1024 * 1024,
  UNDO_DEPTH: 200,
  RECENT_PROJECTS: 12
});

/** Map-resize anchors. The value describes where existing content is pinned. */
export const ANCHORS = Object.freeze([
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right'
]);

export const EDITOR_TOOLS = Object.freeze([
  { id: 'pencil',     label: 'Pencil',     key: 'p', hint: 'Paint single cells' },
  { id: 'eraser',     label: 'Eraser',     key: 'e', hint: 'Reset cells to the default tile' },
  { id: 'fill',       label: 'Fill',       key: 'f', hint: 'Flood-fill a connected region' },
  { id: 'line',       label: 'Line',       key: 'l', hint: 'Draw a straight line of tiles' },
  { id: 'rectangle',  label: 'Rectangle',  key: 'r', hint: 'Draw a rectangle of tiles' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'i', hint: 'Pick the tile under the cursor' },
  { id: 'select',     label: 'Select',     key: 's', hint: 'Select a rectangular region' }
]);

/** Default application settings; also the shape validated on save. */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'dark',
  defaultTileWidth: 32,
  defaultTileHeight: 32,
  autosaveEnabled: true,
  autosaveIntervalSeconds: 30,
  showGrid: true,
  gridColor: '#3a4152',
  gridOpacity: 0.8,
  defaultExportFormat: 'txt',
  confirmDestructive: true,
  paletteThumbnailSize: 48
});

export const ALLOWED_IMAGE_TYPES = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
});
