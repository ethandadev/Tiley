/**
 * Editor logic tests.
 *
 * These import the actual browser modules (the shared imports resolve the same
 * way on disk as they do over HTTP), so undo/redo, selection clipping and the
 * drawing tools are tested as they really run — not as a re-implementation.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state, setSelection } from '../src/frontend/js/store.js';
import {
  paintCell, paintCells, paintLine, paintRectangle, fillRegion, replaceTileId,
  beginStroke, endStroke, copySelection, cutSelection, pasteClipboard,
  duplicateSelection, eraseSelection, resizeActiveMap, previewResize
} from '../src/frontend/js/editorActions.js';
import { undo, redo, canUndo, canRedo, resetHistory, forgetMap } from '../src/frontend/js/history.js';
import { createProject, createMap } from '../src/shared/schema.js';

function loadProject({ width = 8, height = 6, defaultTile = 0 } = {}) {
  const map = createMap({ id: 'map-test', name: 'Test', width, height, tileWidth: 16, tileHeight: 16, defaultTile });
  state.project = createProject({ id: 'test-project', name: 'Test', maps: [map] });
  state.activeMapId = map.id;
  state.selection = null;
  state.clipboard = null;
  state.selectedTileId = 1;
  state.dirty = false;
  resetHistory();
  return map;
}

const grid = () => state.project.maps[0].data;

beforeEach(() => { loadProject(); });

test('painting a cell marks the project dirty and can be undone', () => {
  paintCell(2, 3, 5);
  assert.equal(grid()[3][2], 5);
  assert.equal(state.dirty, true);
  assert.equal(canUndo(), true);

  undo();
  assert.equal(grid()[3][2], 0);
  assert.equal(canRedo(), true);

  redo();
  assert.equal(grid()[3][2], 5);
});

test('a stroke of many cells becomes a single undo step', () => {
  beginStroke('Paint');
  paintCell(0, 0, 2);
  paintCell(1, 0, 2);
  paintCell(2, 0, 2);
  endStroke();

  undo();
  assert.deepEqual(grid()[0].slice(0, 3), [0, 0, 0]);
  assert.equal(canUndo(), false, 'the whole stroke was one step');
});

test('painting the same value twice records nothing to undo', () => {
  paintCell(1, 1, 0);
  assert.equal(canUndo(), false);
});

test('line and rectangle tools write the expected cells', () => {
  paintLine(0, 0, 3, 0, 7);
  assert.deepEqual(grid()[0].slice(0, 4), [7, 7, 7, 7]);

  paintRectangle(1, 2, 3, 4, 8, { filled: false });
  assert.equal(grid()[2][1], 8);
  assert.equal(grid()[3][2], 0, 'an outline rectangle leaves the interior alone');
  assert.equal(grid()[4][3], 8);
});

test('flood fill replaces the connected region and undoes in one step', () => {
  paintLine(0, 3, 7, 3, 9);   // a wall across the map
  const changes = fillRegion(0, 0, 4);
  assert.equal(changes.length, 8 * 3);
  assert.equal(grid()[0][0], 4);
  assert.equal(grid()[4][0], 0, 'the fill stopped at the wall');

  undo();
  assert.equal(grid()[0][0], 0);
});

test('edits are clipped to an active selection', () => {
  setSelection({ x: 1, y: 1, width: 2, height: 2 });

  paintRectangle(0, 0, 7, 5, 6);
  assert.equal(grid()[0][0], 0, 'cells outside the selection are untouched');
  assert.equal(grid()[1][1], 6);
  assert.equal(grid()[2][2], 6);

  fillRegion(0, 0, 3);
  assert.equal(grid()[0][0], 0, 'a fill is clipped to the selection too');
  setSelection(null);
});

test('erase resets the selected cells to the map default tile', () => {
  paintRectangle(0, 0, 3, 3, 5);
  setSelection({ x: 0, y: 0, width: 2, height: 2 });
  eraseSelection();
  assert.equal(grid()[0][0], 0);
  assert.equal(grid()[3][3], 5);
  setSelection(null);
});

test('copy, cut, paste and duplicate move regions of the map', () => {
  paintCells([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], 4);
  setSelection({ x: 0, y: 0, width: 2, height: 2 });

  assert.equal(copySelection(), true);
  assert.deepEqual(state.clipboard, [[4, 4], [4, 4]]);

  setSelection(null);
  pasteClipboard(5, 4);
  assert.equal(grid()[4][5], 4);
  assert.equal(grid()[5][6], 4);

  undo();
  assert.equal(grid()[4][5], 0, 'a paste is one undo step');

  setSelection({ x: 0, y: 0, width: 2, height: 2 });
  cutSelection();
  assert.equal(grid()[0][0], 0);

  setSelection({ x: 4, y: 0, width: 1, height: 1 });
  paintCell(4, 0, 9);
  duplicateSelection();
  assert.equal(grid()[0][5], 9, 'the duplicate lands to the right of the selection');
  setSelection(null);
});

test('replacing a tile ID rewrites every matching cell in one step', () => {
  paintCells([{ x: 0, y: 0 }, { x: 3, y: 2 }, { x: 7, y: 5 }], 2);
  const changes = replaceTileId(2, 6);
  assert.equal(changes.length, 3);
  assert.equal(grid()[5][7], 6);

  undo();
  assert.equal(grid()[5][7], 2);
});

test('resizing is undoable and preserves what still fits', () => {
  paintCell(0, 0, 3);
  paintCell(7, 5, 4);

  const preview = previewResize(state.project.maps[0], 4, 4, 'top-left');
  assert.equal(preview.removedNonDefault, 1);

  resizeActiveMap(4, 4, 'top-left');
  assert.equal(state.project.maps[0].width, 4);
  assert.equal(grid().length, 4);
  assert.equal(grid()[0][0], 3);

  undo();
  assert.equal(state.project.maps[0].width, 8);
  assert.equal(grid()[5][7], 4, 'the discarded cell came back');

  redo();
  assert.equal(state.project.maps[0].width, 4);
});

test('a large edit is packed into typed arrays and still undoes exactly', () => {
  loadProject({ width: 300, height: 300 });
  const changes = fillRegion(0, 0, 5);
  assert.equal(changes.length, 90_000);
  assert.equal(grid()[299][299], 5);

  undo();
  assert.equal(grid()[299][299], 0);
  assert.equal(grid()[0][0], 0);

  redo();
  assert.equal(grid()[150][150], 5);
});

test('history entries for a deleted map are discarded', () => {
  paintCell(0, 0, 2);
  assert.equal(canUndo(), true);
  forgetMap('map-test');
  assert.equal(canUndo(), false);
});

test('undo and redo stop cleanly at the ends of the history', () => {
  assert.equal(undo(), null);
  assert.equal(redo(), null);
  paintCell(0, 0, 1);
  undo();
  assert.equal(undo(), null);
});
