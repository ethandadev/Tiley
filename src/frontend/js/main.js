/**
 * Application bootstrap: load settings, wire the views together and decide
 * whether to open the editor or the project browser.
 */

import { $ } from './dom.js';
import * as api from './api.js';
import { state, emit, activeMap, setSelectedTile, setSelection } from './store.js';
import { initRenderer, requestRender, viewportSize } from './renderer.js';
import { initTools } from './tools.js';
import { initToolbar } from './views/toolbar.js';
import { initStatusbar } from './views/statusbar.js';
import { initMenubar } from './views/menubar.js';
import { initPalette } from './views/palette.js';
import { initMapsPanel } from './views/mapsPanel.js';
import { initProjectBrowser, showProjectBrowser, hideProjectBrowser } from './views/projectBrowser.js';
import { reloadDictionarySummaries } from './views/dictionaryManager.js';
import { initShortcuts } from './shortcuts.js';
import { startAutosave, installUnloadGuard, rescheduleAutosave } from './autosave.js';
import { applyTheme } from './views/settingsDialog.js';
import { openContextMenu } from './views/contextMenu.js';
import { fillRegion, paintCell, copySelection, pasteClipboard } from './editorActions.js';
import { screenToCell } from './viewport.js';
import { stepZoom, resetZoom, fitToScreen, centerMap } from './viewport.js';
import { openProject } from './projectController.js';
import { toastApiError, toastInfo } from './toast.js';
import { on } from './store.js';

const LAST_PROJECT_KEY = 'tiley.lastProjectId';

async function boot() {
  const canvas = $('#map-canvas');
  const canvasArea = $('#canvas-area');

  // Settings first: they decide the theme, the grid and the autosave cadence.
  try {
    state.settings = await api.getSettings();
  } catch (error) {
    toastApiError('Settings could not be loaded; defaults are in use', error);
  }
  applyTheme(state.settings.theme);
  state.showGrid = state.settings.showGrid;

  initRenderer(canvas, canvasArea);
  initTools(canvas);
  initMenubar();
  initToolbar();
  initStatusbar();
  initMapsPanel();
  initPalette();
  initProjectBrowser();
  initShortcuts();
  initCanvasContextMenu(canvas);
  initZoomControls();

  installUnloadGuard();
  startAutosave();
  on('settings', rescheduleAutosave);

  await reloadDictionarySummaries();

  $('#loading').hidden = true;

  // Reopen whatever was last open, so a refresh does not lose your place.
  const lastId = readLastProjectId();
  if (lastId) {
    const opened = await openProject(lastId, { silent: true }).catch(() => false);
    if (opened) {
      hideProjectBrowser();
      trackLastProject();
      return;
    }
    forgetLastProjectId();
  }

  await showProjectBrowser();
  trackLastProject();
}

/* ---------------------------------------------------------- last project - */

function readLastProjectId() {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;   // Private browsing or blocked storage: not an error.
  }
}

function writeLastProjectId(id) {
  try {
    if (id) window.localStorage.setItem(LAST_PROJECT_KEY, id);
    else window.localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // Ignore: remembering the last project is a convenience, not a feature.
  }
}

const forgetLastProjectId = () => writeLastProjectId(null);

function trackLastProject() {
  on('project', () => writeLastProjectId(state.project?.id ?? null));
}

/* ------------------------------------------------------- canvas context - */

function initCanvasContextMenu(canvas) {
  canvas.addEventListener('contextmenu', (event) => {
    const map = activeMap();
    if (!map) return;
    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const cell = screenToCell(map, event.clientX - rect.left, event.clientY - rect.top);
    const inside = cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
    if (!inside) return;

    const tileId = map.data[cell.y][cell.x];
    openContextMenu(event, [
      { label: `Cell X ${cell.x}, Y ${cell.y} — tile ${tileId}`, disabled: true },
      { separator: true },
      { label: 'Pick this tile', onSelect: () => setSelectedTile(tileId) },
      { label: 'Paint with the selected tile', onSelect: () => paintCell(cell.x, cell.y, state.selectedTileId) },
      { label: 'Erase this cell', onSelect: () => paintCell(cell.x, cell.y, map.defaultTile, 'Erase') },
      { label: 'Fill this region with the selected tile', onSelect: () => fillRegion(cell.x, cell.y, state.selectedTileId) },
      { separator: true },
      {
        label: 'Select this region',
        onSelect: () => {
          // Select the connected region's bounding box, which is what a user
          // means by "select this area" far more often than a flood selection.
          const bounds = regionBounds(map, cell.x, cell.y);
          setSelection(bounds);
        }
      },
      { label: 'Copy selection', disabled: !state.selection, onSelect: () => { if (copySelection()) toastInfo('Selection copied'); } },
      { label: 'Paste here', disabled: !state.clipboard, onSelect: () => pasteClipboard(cell.x, cell.y) },
      { label: 'Clear selection', disabled: !state.selection, onSelect: () => setSelection(null) }
    ]);
  });
}

/** Bounding box of the 4-connected region of identical tiles around a cell. */
function regionBounds(map, startX, startY) {
  const target = map.data[startY][startX];
  const width = map.width;
  const visited = new Uint8Array(width * map.height);
  const stack = [startY * width + startX];
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;

  while (stack.length > 0) {
    const index = stack.pop();
    if (visited[index]) continue;
    visited[index] = 1;
    const x = index % width;
    const y = (index - x) / width;
    if (map.data[y][x] !== target) continue;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - width);
    if (y < map.height - 1) stack.push(index + width);
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/* -------------------------------------------------------- zoom controls - */

function initZoomControls() {
  const readout = $('#zoom-readout');

  document.querySelectorAll('[data-zoom]').forEach((button) => {
    button.addEventListener('click', () => {
      const map = activeMap();
      if (!map) return;
      const { width, height } = viewportSize();
      switch (button.dataset.zoom) {
        case 'in': stepZoom(1, width, height); break;
        case 'out': stepZoom(-1, width, height); break;
        case 'fit': fitToScreen(map, width, height); break;
        case 'center': centerMap(map, width, height); break;
        default: break;
      }
    });
  });

  readout.addEventListener('click', () => {
    const { width, height } = viewportSize();
    resetZoom(width, height);
  });

  const render = () => { readout.textContent = `${Math.round(state.zoom * 100)}%`; };
  on('viewport', render);
  on('project', render);
  render();
}

boot().catch((error) => {
  console.error(error);
  $('#loading').hidden = false;
  $('#loading').textContent = 'Tiley could not start. Check that the server is running, then reload this page.';
});

// Keep the canvas in sync whenever the document changes underneath it.
on('map', requestRender);
on('tiles', requestRender);
emit('status');
