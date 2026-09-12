/**
 * Canvas renderer.
 *
 * Rendering strategy (the reason this stays smooth on a 1000x1000 map):
 *
 *  - only the cells inside the viewport are ever considered, so cost is bound
 *    by the window size rather than by the map size;
 *  - above `MIN_CELL_FOR_IMAGES` pixels per cell, tile bitmaps are drawn;
 *  - below it, drawing thousands of scaled bitmaps is both slow and illegible,
 *    so the view switches to "pixel mode": one averaged colour per screen pixel
 *    written into an ImageData buffer, which bounds the work by the number of
 *    pixels on screen no matter how far out the user zooms;
 *  - redraws are coalesced into a single requestAnimationFrame.
 *
 * Nothing here mutates state; it only reads the store.
 */

import { state, activeMap, activeDictionary } from './store.js';
import { visibleCellRange, cellSize } from './viewport.js';
import { getImageEntry, tileImageUrl, fallbackColor, onImagesChanged } from './tileImages.js';

const MIN_CELL_FOR_IMAGES = 4;   // px — below this, use pixel mode
const MIN_CELL_FOR_GRID = 7;     // px — below this, grid lines become noise
const MIN_CELL_FOR_LABELS = 26;  // px — below this, missing-tile text is unreadable

let canvas = null;
let context = null;
let container = null;
let frameRequested = false;
let pixelCanvas = null;
let pixelContext = null;

/** Per-frame memo of tile id -> visual, rebuilt each render. */
let visualCache = new Map();

export function initRenderer(canvasElement, containerElement) {
  canvas = canvasElement;
  container = containerElement;
  context = canvas.getContext('2d', { alpha: false });

  const observer = new ResizeObserver(() => {
    resizeCanvas();
    requestRender();
  });
  observer.observe(container);
  window.addEventListener('resize', () => { resizeCanvas(); requestRender(); });
  onImagesChanged(requestRender);

  resizeCanvas();
  requestRender();
}

/** Viewport size in CSS pixels. */
export function viewportSize() {
  if (!container) return { width: 0, height: 0 };
  const rect = container.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function resizeCanvas() {
  if (!canvas) return;
  const { width, height } = viewportSize();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

export function requestRender() {
  if (frameRequested || !context) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    render();
  });
}

/* -------------------------------------------------------------- visuals --- */

function readStyle(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Resolve how one tile id should look.
 *
 * `missing` marks an ID the assigned dictionary does not define — those are
 * drawn as an explicit placeholder and never substituted with another tile.
 * Two cases are deliberately *not* treated as missing: a map with no dictionary
 * assigned at all ("no tiles defined yet"), and the map's own default tile,
 * which is the empty value and is drawn as empty space. Both still appear in
 * "Resolve missing tiles" so they can be defined when the user wants to.
 */
function visualFor(tileId, dictionary, hasDictionary, emptyColor, defaultTile) {
  const cached = visualCache.get(tileId);
  if (cached) return cached;

  const tile = dictionary?.tiles.find((candidate) => candidate.id === tileId) ?? null;
  let visual;
  if (tile) {
    const url = tileImageUrl(tile);
    const entry = url ? getImageEntry(url) : null;
    visual = {
      entry,
      color: entry?.color ? `rgb(${entry.color.join(',')})` : fallbackColor(tileId),
      missing: false,
      tile
    };
  } else if (!hasDictionary || tileId === defaultTile) {
    visual = { entry: null, color: emptyColor, missing: false, tile: null, empty: true };
  } else {
    visual = { entry: null, color: readStyle('--missing') || '#f0685f', missing: true, tile: null };
  }
  visualCache.set(tileId, visual);
  return visual;
}

/* --------------------------------------------------------------- render --- */

export function render() {
  if (!context) return;
  const { width: viewWidth, height: viewHeight } = viewportSize();
  const background = readStyle('--canvas-bg') || '#0a0c12';

  context.fillStyle = background;
  context.fillRect(0, 0, viewWidth, viewHeight);

  const map = activeMap();
  if (!map) return;

  const dictionary = activeDictionary();
  const hasDictionary = Boolean(dictionary);
  const emptyColor = readStyle('--canvas-empty') || '#171c28';
  visualCache = new Map();

  const { width: cellWidth, height: cellHeight } = cellSize(map);
  const range = visibleCellRange(map, viewWidth, viewHeight);

  // The map's own area, so the edges of the world are obvious.
  const origin = { x: state.panX, y: state.panY };
  context.fillStyle = emptyColor;
  context.fillRect(origin.x, origin.y, map.width * cellWidth, map.height * cellHeight);

  if (range.endX >= range.startX && range.endY >= range.startY) {
    if (cellWidth >= MIN_CELL_FOR_IMAGES && cellHeight >= MIN_CELL_FOR_IMAGES) {
      drawCells(map, dictionary, hasDictionary, emptyColor, range, cellWidth, cellHeight);
    } else {
      drawPixelMode(map, dictionary, hasDictionary, emptyColor, viewWidth, viewHeight, cellWidth, cellHeight);
    }
  }

  if (state.showGrid && cellWidth >= MIN_CELL_FOR_GRID) drawGrid(map, range, cellWidth, cellHeight);
  drawMapBorder(map, cellWidth, cellHeight);
  drawPreview(map, cellWidth, cellHeight);
  drawSelection(map, cellWidth, cellHeight);
  drawCursor(map, cellWidth, cellHeight);
}

function drawCells(map, dictionary, hasDictionary, emptyColor, range, cellWidth, cellHeight) {
  context.imageSmoothingEnabled = false;
  const labelsFit = cellWidth >= MIN_CELL_FOR_LABELS;

  for (let y = range.startY; y <= range.endY; y++) {
    const row = map.data[y];
    if (!row) continue;
    const screenY = y * cellHeight + state.panY;
    for (let x = range.startX; x <= range.endX; x++) {
      const tileId = row[x];
      const screenX = x * cellWidth + state.panX;
      const visual = visualFor(tileId, dictionary, hasDictionary, emptyColor, map.defaultTile);

      if (visual.entry?.status === 'ready') {
        context.drawImage(visual.entry.image, screenX, screenY, cellWidth, cellHeight);
        continue;
      }
      if (visual.missing) {
        drawMissingCell(screenX, screenY, cellWidth, cellHeight, tileId, labelsFit);
        continue;
      }
      if (visual.empty) continue;   // empty cell: the background already shows
      context.fillStyle = visual.color;
      context.fillRect(screenX, screenY, cellWidth, cellHeight);
      if (labelsFit && !visual.entry) drawCellLabel(screenX, screenY, cellWidth, cellHeight, String(tileId));
    }
  }
}

/** Hatched red block plus the offending ID — never a substituted tile. */
function drawMissingCell(x, y, width, height, tileId, labelsFit) {
  context.fillStyle = 'rgba(240, 104, 95, 0.22)';
  context.fillRect(x, y, width, height);
  context.strokeStyle = 'rgba(240, 104, 95, 0.85)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 1, y + 1);
  context.lineTo(x + width - 1, y + height - 1);
  context.moveTo(x + width - 1, y + 1);
  context.lineTo(x + 1, y + height - 1);
  context.stroke();
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  if (labelsFit) {
    context.fillStyle = '#ffffff';
    context.font = `${Math.min(11, Math.floor(height / 3))}px monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(tileId), x + width / 2, y + height / 2);
  }
}

function drawCellLabel(x, y, width, height, label) {
  context.fillStyle = 'rgba(255,255,255,0.75)';
  context.font = `${Math.min(10, Math.floor(height / 3))}px monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, x + width / 2, y + height / 2);
}

/**
 * Pixel mode: one screen pixel per sample, so a 1000x1000 map costs the same
 * as a 50x50 one. Colours come from the cached per-tile average.
 */
function drawPixelMode(map, dictionary, hasDictionary, emptyColor, viewWidth, viewHeight, cellWidth, cellHeight) {
  const pixelWidth = Math.max(1, Math.floor(viewWidth));
  const pixelHeight = Math.max(1, Math.floor(viewHeight));

  if (!pixelCanvas) {
    pixelCanvas = document.createElement('canvas');
    pixelContext = pixelCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (pixelCanvas.width !== pixelWidth || pixelCanvas.height !== pixelHeight) {
    pixelCanvas.width = pixelWidth;
    pixelCanvas.height = pixelHeight;
  }

  const imageData = pixelContext.createImageData(pixelWidth, pixelHeight);
  const pixels = imageData.data;
  const rgbCache = new Map();

  const rgbFor = (tileId) => {
    const cached = rgbCache.get(tileId);
    if (cached) return cached;
    const visual = visualFor(tileId, dictionary, hasDictionary, emptyColor, map.defaultTile);
    let rgb;
    if (visual.missing) rgb = [240, 104, 95];
    else if (visual.entry?.color) rgb = visual.entry.color;
    else rgb = parseColor(visual.color);
    rgbCache.set(tileId, rgb);
    return rgb;
  };

  // Precompute the cell column for every screen column once, instead of once
  // per pixel: this is the difference between ~70 ms and ~15 ms on a
  // 1000 x 1000 map filling the window.
  const columnCells = new Int32Array(pixelWidth);
  for (let px = 0; px < pixelWidth; px++) {
    const cellX = Math.floor((px - state.panX) / cellWidth);
    columnCells[px] = cellX >= 0 && cellX < map.width ? cellX : -1;
  }

  for (let py = 0; py < pixelHeight; py++) {
    const cellY = Math.floor((py - state.panY) / cellHeight);
    const row = cellY >= 0 && cellY < map.height ? map.data[cellY] : null;
    let index = py * pixelWidth * 4;
    if (!row) {
      // Nothing on this scanline; leave it transparent.
      continue;
    }
    // Runs of identical tiles are the common case, so cache the last colour.
    let lastId = -1;
    let lastRgb = [0, 0, 0];
    for (let px = 0; px < pixelWidth; px++, index += 4) {
      const cellX = columnCells[px];
      if (cellX === -1) continue;
      const tileId = row[cellX];
      if (tileId !== lastId) {
        lastId = tileId;
        lastRgb = rgbFor(tileId);
      }
      pixels[index] = lastRgb[0];
      pixels[index + 1] = lastRgb[1];
      pixels[index + 2] = lastRgb[2];
      pixels[index + 3] = 255;
    }
  }

  pixelContext.putImageData(imageData, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(pixelCanvas, 0, 0, pixelWidth, pixelHeight);
}

/** Accepts the "#rrggbb", "rgb(r,g,b)" and "hsl(...)" forms we generate. */
function parseColor(color) {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? [...hex].map((char) => char + char).join('') : hex;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16)
    ];
  }
  const numbers = color.match(/-?\d+(\.\d+)?/g);
  if (color.startsWith('rgb') && numbers) return numbers.slice(0, 3).map(Number);
  if (color.startsWith('hsl') && numbers) return hslToRgb(Number(numbers[0]), Number(numbers[1]) / 100, Number(numbers[2]) / 100);
  return [128, 128, 128];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function drawGrid(map, range, cellWidth, cellHeight) {
  context.save();
  context.globalAlpha = state.settings.gridOpacity ?? 0.8;
  context.strokeStyle = state.settings.gridColor || readStyle('--grid-line') || '#3a4152';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = range.startX; x <= range.endX + 1; x++) {
    const screenX = Math.round(x * cellWidth + state.panX) + 0.5;
    context.moveTo(screenX, Math.round(range.startY * cellHeight + state.panY));
    context.lineTo(screenX, Math.round((range.endY + 1) * cellHeight + state.panY));
  }
  for (let y = range.startY; y <= range.endY + 1; y++) {
    const screenY = Math.round(y * cellHeight + state.panY) + 0.5;
    context.moveTo(Math.round(range.startX * cellWidth + state.panX), screenY);
    context.lineTo(Math.round((range.endX + 1) * cellWidth + state.panX), screenY);
  }
  context.stroke();
  context.restore();
}

function drawMapBorder(map, cellWidth, cellHeight) {
  context.save();
  context.strokeStyle = readStyle('--border-strong') || '#3a4359';
  context.lineWidth = 1;
  context.strokeRect(
    Math.round(state.panX) + 0.5,
    Math.round(state.panY) + 0.5,
    Math.round(map.width * cellWidth),
    Math.round(map.height * cellHeight)
  );
  context.restore();
}

/** Ghost of the shape a drag tool would commit if released now. */
function drawPreview(map, cellWidth, cellHeight) {
  if (!state.preview?.cells?.length) return;
  context.save();
  context.globalAlpha = 0.55;
  const accent = readStyle('--accent') || '#5b9dff';
  const dictionary = activeDictionary();
  const visual = visualFor(state.preview.tileId, dictionary, Boolean(dictionary), readStyle('--canvas-empty'), map.defaultTile);

  for (const cell of state.preview.cells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= map.width || cell.y >= map.height) continue;
    const x = cell.x * cellWidth + state.panX;
    const y = cell.y * cellHeight + state.panY;
    if (visual.entry?.status === 'ready') {
      context.drawImage(visual.entry.image, x, y, cellWidth, cellHeight);
    } else {
      context.fillStyle = visual.missing ? accent : visual.color;
      context.fillRect(x, y, cellWidth, cellHeight);
    }
  }
  context.restore();
}

function drawSelection(map, cellWidth, cellHeight) {
  const selection = state.selection;
  if (!selection) return;
  const x = selection.x * cellWidth + state.panX;
  const y = selection.y * cellHeight + state.panY;
  const width = selection.width * cellWidth;
  const height = selection.height * cellHeight;

  context.save();
  context.fillStyle = 'rgba(91, 157, 255, 0.14)';
  context.fillRect(x, y, width, height);
  context.strokeStyle = readStyle('--selection') || '#5b9dff';
  context.lineWidth = 1.5;
  context.setLineDash([5, 3]);
  context.strokeRect(x + 0.5, y + 0.5, width, height);
  context.restore();
}

function drawCursor(map, cellWidth, cellHeight) {
  const { x, y } = state.cursor;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
  if (cellWidth < 3) return;
  context.save();
  context.strokeStyle = readStyle('--accent') || '#5b9dff';
  context.lineWidth = 2;
  context.strokeRect(
    Math.round(x * cellWidth + state.panX) + 1,
    Math.round(y * cellHeight + state.panY) + 1,
    Math.round(cellWidth) - 2,
    Math.round(cellHeight) - 2
  );
  context.restore();
}

/**
 * Render the whole map to a standalone canvas at 1:1 tile size, for PNG export.
 * Done off-screen so it is unaffected by zoom, pan or the visible viewport.
 */
export function renderToCanvas(map, dictionary) {
  const output = document.createElement('canvas');
  output.width = map.width * map.tileWidth;
  output.height = map.height * map.tileHeight;
  const outputContext = output.getContext('2d');
  outputContext.imageSmoothingEnabled = false;

  const lookup = new Map((dictionary?.tiles ?? []).map((tile) => [tile.id, tile]));
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tileId = map.data[y][x];
      const tile = lookup.get(tileId);
      const url = tile ? tileImageUrl(tile) : null;
      const entry = url ? getImageEntry(url) : null;
      const px = x * map.tileWidth;
      const py = y * map.tileHeight;
      if (entry?.status === 'ready') {
        outputContext.drawImage(entry.image, px, py, map.tileWidth, map.tileHeight);
      } else if (tile) {
        outputContext.fillStyle = fallbackColor(tileId);
        outputContext.fillRect(px, py, map.tileWidth, map.tileHeight);
      } else if (dictionary) {
        outputContext.fillStyle = 'rgba(240, 104, 95, 0.5)';
        outputContext.fillRect(px, py, map.tileWidth, map.tileHeight);
      }
    }
  }
  return output;
}
