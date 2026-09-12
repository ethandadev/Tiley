/**
 * Pointer interaction on the map canvas.
 *
 * A single pointer handler dispatches to the active tool. Drag tools (line,
 * rectangle, select) show a live ghost via `state.preview` and only commit on
 * pointer-up, so an accidental drag can be abandoned with Escape.
 *
 * Panning is available at all times on the middle mouse button and while the
 * space bar is held, so it never competes with the drawing tools.
 */

import { state, activeMap, setCursor, setSelection, setSelectedTile, setViewport, emit } from './store.js';
import { screenToCell, zoomAt, clampPan } from './viewport.js';
import { requestRender, viewportSize } from './renderer.js';
import {
  beginStroke, endStroke, paintCell, paintLine, paintRectangle, fillRegion
} from './editorActions.js';
import { normalizeRect, lineCells, rectCells } from '../../shared/tilemap.js';

let canvas = null;
let spaceHeld = false;
let gesture = null;   // { type, pointerId, startCell, lastCell, startClient, startPan, ... }

export function initTools(canvasElement) {
  canvas = canvasElement;

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', cancelGesture);
  canvas.addEventListener('pointerleave', () => {
    if (!gesture) setCursor(-1, -1);
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !spaceHeld) {
      spaceHeld = true;
      canvas.classList.add('pannable');
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      spaceHeld = false;
      canvas.classList.remove('pannable');
    }
  });
  window.addEventListener('blur', () => {
    spaceHeld = false;
    canvas.classList.remove('pannable');
  });
}

function pointerCell(event) {
  const map = activeMap();
  if (!map) return null;
  const rect = canvas.getBoundingClientRect();
  return screenToCell(map, event.clientX - rect.left, event.clientY - rect.top);
}

const inBounds = (map, cell) => cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;

/* ---------------------------------------------------------------- events - */

function onPointerDown(event) {
  const map = activeMap();
  if (!map) return;
  canvas.focus({ preventScroll: true });

  const isPanRequest = event.button === 1 || (event.button === 0 && spaceHeld);
  if (isPanRequest) {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    gesture = {
      type: 'pan',
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { x: state.panX, y: state.panY }
    };
    canvas.classList.add('panning');
    return;
  }

  if (event.button !== 0) return;   // right button opens the context menu
  const cell = pointerCell(event);
  if (!cell) return;

  canvas.setPointerCapture(event.pointerId);
  const tool = state.tool;

  if (tool === 'eyedropper') {
    if (inBounds(map, cell)) setSelectedTile(map.data[cell.y][cell.x]);
    gesture = { type: 'none', pointerId: event.pointerId };
    return;
  }

  if (tool === 'fill') {
    if (inBounds(map, cell)) fillRegion(cell.x, cell.y, state.selectedTileId);
    gesture = { type: 'none', pointerId: event.pointerId };
    return;
  }

  if (tool === 'select') {
    gesture = { type: 'select', pointerId: event.pointerId, startCell: cell };
    setSelection({ x: clamp(cell.x, 0, map.width - 1), y: clamp(cell.y, 0, map.height - 1), width: 1, height: 1 });
    return;
  }

  if (tool === 'line' || tool === 'rectangle') {
    gesture = { type: tool, pointerId: event.pointerId, startCell: cell, lastCell: cell, outline: event.shiftKey };
    updateShapePreview(cell, event.shiftKey);
    return;
  }

  // Pencil and eraser paint immediately and keep painting while dragging.
  const tileId = tool === 'eraser' ? map.defaultTile : state.selectedTileId;
  beginStroke(tool === 'eraser' ? 'Erase' : 'Paint');
  gesture = { type: 'paint', pointerId: event.pointerId, lastCell: cell, tileId };
  paintCell(cell.x, cell.y, tileId);
}

function onPointerMove(event) {
  const map = activeMap();
  if (!map) return;
  const cell = pointerCell(event);
  if (cell) setCursor(cell.x, cell.y);
  if (!gesture || event.pointerId !== gesture.pointerId) return;

  if (gesture.type === 'pan') {
    setViewport({
      panX: gesture.startPan.x + (event.clientX - gesture.startClient.x),
      panY: gesture.startPan.y + (event.clientY - gesture.startClient.y)
    });
    return;
  }
  if (!cell) return;

  if (gesture.type === 'paint') {
    // Interpolate: fast drags would otherwise leave gaps between samples.
    if (cell.x !== gesture.lastCell.x || cell.y !== gesture.lastCell.y) {
      paintLine(gesture.lastCell.x, gesture.lastCell.y, cell.x, cell.y, gesture.tileId);
      gesture.lastCell = cell;
    }
    return;
  }

  if (gesture.type === 'line' || gesture.type === 'rectangle') {
    gesture.lastCell = cell;
    updateShapePreview(cell, event.shiftKey);
    return;
  }

  if (gesture.type === 'select') {
    const start = gesture.startCell;
    const rect = normalizeRect(
      clamp(start.x, 0, map.width - 1), clamp(start.y, 0, map.height - 1),
      clamp(cell.x, 0, map.width - 1), clamp(cell.y, 0, map.height - 1)
    );
    setSelection(rect);
  }
}

function onPointerUp(event) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const map = activeMap();

  if (gesture.type === 'paint') endStroke();
  if (gesture.type === 'line' && map) {
    paintLine(gesture.startCell.x, gesture.startCell.y, gesture.lastCell.x, gesture.lastCell.y, state.selectedTileId);
  }
  if (gesture.type === 'rectangle' && map) {
    paintRectangle(gesture.startCell.x, gesture.startCell.y, gesture.lastCell.x, gesture.lastCell.y,
      state.selectedTileId, { filled: !gesture.outline });
  }
  if (gesture.type === 'select' && map) {
    // A plain click with no drag clears the selection instead of leaving a 1x1.
    const rect = state.selection;
    if (rect && rect.width === 1 && rect.height === 1 &&
        gesture.startCell.x === state.cursor.x && gesture.startCell.y === state.cursor.y) {
      setSelection(null);
    }
  }

  finishGesture(event.pointerId);
}

function finishGesture(pointerId) {
  if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  canvas.classList.remove('panning');
  gesture = null;
  state.preview = null;
  const map = activeMap();
  if (map) {
    const { width, height } = viewportSize();
    clampPan(map, width, height);
  }
  emit('map');
  requestRender();
}

/** Escape abandons an in-flight drag without committing it. */
export function cancelGesture() {
  if (!gesture) return false;
  if (gesture.type === 'paint') endStroke();
  finishGesture(gesture.pointerId);
  return true;
}

function updateShapePreview(cell, outline) {
  const start = gesture.startCell;
  const cells = gesture.type === 'line'
    ? lineCells(start.x, start.y, cell.x, cell.y)
    : rectCells(start.x, start.y, cell.x, cell.y, !outline);
  gesture.outline = outline;
  state.preview = { cells, tileId: state.selectedTileId };
  emit('map');
  requestRender();
}

/**
 * Wheel behaviour:
 *   wheel            zoom about the pointer (trackpad pinch arrives as ctrl+wheel)
 *   shift + wheel    pan horizontally
 *   alt + wheel      pan vertically
 */
function onWheel(event) {
  const map = activeMap();
  if (!map) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();

  if (event.shiftKey || event.altKey) {
    const amount = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    setViewport(event.shiftKey ? { panX: state.panX - amount } : { panY: state.panY - amount });
    clampPan(map, rect.width, rect.height);
    return;
  }

  const factor = Math.exp(-event.deltaY * 0.0015);
  zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
  clampPan(map, rect.width, rect.height);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** The cell currently under the pointer, or null when it is off the map. */
export function cursorCell() {
  const map = activeMap();
  if (!map) return null;
  const { x, y } = state.cursor;
  return inBounds(map, { x, y }) ? { x, y } : null;
}
