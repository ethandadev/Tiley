/**
 * Viewport maths: the mapping between map cells and canvas pixels.
 *
 * Screen position of a cell = (cell * tileSize * zoom) + pan.
 * Everything else here is derived from that single rule, so the renderer and
 * the pointer tools can never disagree about where a cell is.
 */

import { state, setViewport } from './store.js';

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 16;
const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];

export const clampZoom = (zoom) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

export function cellSize(map) {
  return { width: map.tileWidth * state.zoom, height: map.tileHeight * state.zoom };
}

/** Canvas pixel -> cell coordinate (may fall outside the map). */
export function screenToCell(map, screenX, screenY) {
  const { width, height } = cellSize(map);
  return {
    x: Math.floor((screenX - state.panX) / width),
    y: Math.floor((screenY - state.panY) / height)
  };
}

/** Cell coordinate -> top-left canvas pixel. */
export function cellToScreen(map, cellX, cellY) {
  const { width, height } = cellSize(map);
  return { x: cellX * width + state.panX, y: cellY * height + state.panY };
}

/** Inclusive range of cells currently visible, clamped to the map. */
export function visibleCellRange(map, viewWidth, viewHeight) {
  const { width, height } = cellSize(map);
  const startX = Math.max(0, Math.floor(-state.panX / width));
  const startY = Math.max(0, Math.floor(-state.panY / height));
  const endX = Math.min(map.width - 1, Math.ceil((viewWidth - state.panX) / width));
  const endY = Math.min(map.height - 1, Math.ceil((viewHeight - state.panY) / height));
  return { startX, startY, endX, endY };
}

/** Zoom about a fixed screen point, so the cell under the cursor stays put. */
export function zoomAt(factor, anchorX, anchorY) {
  const nextZoom = clampZoom(state.zoom * factor);
  if (nextZoom === state.zoom) return;
  const scale = nextZoom / state.zoom;
  setViewport({
    zoom: nextZoom,
    panX: anchorX - (anchorX - state.panX) * scale,
    panY: anchorY - (anchorY - state.panY) * scale
  });
}

/** Step to the next/previous preset zoom level, centred on the viewport. */
export function stepZoom(direction, viewWidth, viewHeight) {
  const current = state.zoom;
  const next = direction > 0
    ? ZOOM_STEPS.find((step) => step > current + 1e-6) ?? ZOOM_MAX
    : [...ZOOM_STEPS].reverse().find((step) => step < current - 1e-6) ?? ZOOM_MIN;
  zoomAt(next / current, viewWidth / 2, viewHeight / 2);
}

export function resetZoom(viewWidth, viewHeight) {
  zoomAt(1 / state.zoom, viewWidth / 2, viewHeight / 2);
}

/** Fit the whole map in the viewport with a small margin. */
export function fitToScreen(map, viewWidth, viewHeight) {
  const margin = 24;
  const zoom = clampZoom(Math.min(
    (viewWidth - margin) / (map.width * map.tileWidth),
    (viewHeight - margin) / (map.height * map.tileHeight)
  ));
  setViewport({
    zoom,
    panX: (viewWidth - map.width * map.tileWidth * zoom) / 2,
    panY: (viewHeight - map.height * map.tileHeight * zoom) / 2
  });
}

/** Centre the map without changing the zoom level. */
export function centerMap(map, viewWidth, viewHeight) {
  setViewport({
    panX: (viewWidth - map.width * map.tileWidth * state.zoom) / 2,
    panY: (viewHeight - map.height * map.tileHeight * state.zoom) / 2
  });
}

/** Keep at least a corner of the map on screen when panning. */
export function clampPan(map, viewWidth, viewHeight) {
  const mapWidth = map.width * map.tileWidth * state.zoom;
  const mapHeight = map.height * map.tileHeight * state.zoom;
  const slack = 80;
  const panX = Math.min(viewWidth - slack, Math.max(slack - mapWidth, state.panX));
  const panY = Math.min(viewHeight - slack, Math.max(slack - mapHeight, state.panY));
  if (panX !== state.panX || panY !== state.panY) setViewport({ panX, panY });
}

/** Scroll the view so a cell is visible (used after "go to coordinate"). */
export function revealCell(map, cellX, cellY, viewWidth, viewHeight) {
  const { width, height } = cellSize(map);
  setViewport({
    panX: viewWidth / 2 - (cellX + 0.5) * width,
    panY: viewHeight / 2 - (cellY + 0.5) * height
  });
}
