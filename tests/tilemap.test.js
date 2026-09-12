import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGrid, cloneGrid, setTile, setTiles, floodFill, replaceAll, lineCells, rectCells,
  resizeGrid, anchorOffset, copyRegion, pasteRegion, applyChanges, tileUsage, countTile,
  distinctTileIds, validateGrid, normalizeRect
} from '../src/shared/tilemap.js';

test('createGrid builds the requested dimensions and fill value', () => {
  const grid = createGrid(4, 3, 7);
  assert.equal(grid.length, 3);
  assert.equal(grid[0].length, 4);
  assert.deepEqual(grid[2], [7, 7, 7, 7]);
});

test('setTile returns a change list and ignores no-ops and out-of-bounds cells', () => {
  const grid = createGrid(3, 3, 0);
  assert.deepEqual(setTile(grid, 1, 1, 5), [{ x: 1, y: 1, before: 0, after: 5 }]);
  assert.deepEqual(setTile(grid, 1, 1, 5), []);
  assert.deepEqual(setTile(grid, 9, 9, 5), []);
  assert.equal(grid[1][1], 5);
});

test('setTiles de-duplicates repeated cells', () => {
  const grid = createGrid(3, 3, 0);
  const changes = setTiles(grid, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }], 2);
  assert.equal(changes.length, 2);
});

test('applyChanges can both redo and undo an edit', () => {
  const grid = createGrid(2, 2, 0);
  const changes = setTiles(grid, [{ x: 0, y: 0 }, { x: 1, y: 1 }], 4);
  applyChanges(grid, changes, 'before');
  assert.deepEqual(grid, [[0, 0], [0, 0]]);
  applyChanges(grid, changes, 'after');
  assert.deepEqual(grid, [[4, 0], [0, 4]]);
});

test('floodFill replaces only the connected region', () => {
  const grid = [
    [0, 0, 0, 1, 1],
    [0, 0, 0, 1, 1],
    [0, 0, 0, 1, 1]
  ];
  const changes = floodFill(grid, 0, 0, 2);
  assert.equal(changes.length, 9);
  assert.deepEqual(grid, [
    [2, 2, 2, 1, 1],
    [2, 2, 2, 1, 1],
    [2, 2, 2, 1, 1]
  ]);
});

test('floodFill does not cross a diagonal-only connection', () => {
  const grid = [
    [0, 1],
    [1, 0]
  ];
  floodFill(grid, 0, 0, 5);
  assert.deepEqual(grid, [[5, 1], [1, 0]]);
});

test('floodFill on the same value is a no-op', () => {
  const grid = createGrid(3, 3, 1);
  assert.deepEqual(floodFill(grid, 0, 0, 1), []);
});

test('floodFill handles a 1000x1000 map without recursing', () => {
  const grid = createGrid(1000, 1000, 0);
  const changes = floodFill(grid, 500, 500, 3);
  assert.equal(changes.length, 1_000_000);
  assert.equal(grid[0][0], 3);
  assert.equal(grid[999][999], 3);
});

test('replaceAll rewrites every occurrence', () => {
  const grid = [[1, 2, 1], [3, 1, 2]];
  const changes = replaceAll(grid, 1, 9);
  assert.equal(changes.length, 3);
  assert.deepEqual(grid, [[9, 2, 9], [3, 9, 2]]);
});

test('lineCells draws an inclusive Bresenham line', () => {
  assert.deepEqual(lineCells(0, 0, 3, 0), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  const diagonal = lineCells(0, 0, 2, 2);
  assert.deepEqual(diagonal, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]);
});

test('rectCells produces filled and outline rectangles', () => {
  assert.equal(rectCells(0, 0, 2, 2, true).length, 9);
  assert.equal(rectCells(0, 0, 2, 2, false).length, 8);
  // Corners are given in any order.
  assert.equal(rectCells(2, 2, 0, 0, true).length, 9);
});

test('normalizeRect orders corners', () => {
  assert.deepEqual(normalizeRect(5, 5, 2, 3), { x: 2, y: 3, width: 4, height: 3 });
});

test('anchorOffset places content for each anchor', () => {
  assert.deepEqual(anchorOffset(2, 2, 4, 4, 'top-left'), { dx: 0, dy: 0 });
  assert.deepEqual(anchorOffset(2, 2, 4, 4, 'bottom-right'), { dx: 2, dy: 2 });
  assert.deepEqual(anchorOffset(2, 2, 4, 4, 'center'), { dx: 1, dy: 1 });
});

test('resizeGrid preserves content when growing', () => {
  const grid = [[1, 2], [3, 4]];
  const result = resizeGrid(grid, 4, 4, 'top-left', 0);
  assert.equal(result.removedCells, 0);
  assert.deepEqual(result.grid[0], [1, 2, 0, 0]);
  assert.deepEqual(result.grid[3], [0, 0, 0, 0]);
});

test('resizeGrid reports the cells a shrink would discard', () => {
  const grid = [[1, 2], [3, 4]];
  const result = resizeGrid(grid, 1, 1, 'top-left', 0);
  assert.deepEqual(result.grid, [[1]]);
  assert.equal(result.removedCells, 3);
  assert.equal(result.removedNonDefault, 3);
});

test('resizeGrid honours a bottom-right anchor when shrinking', () => {
  const grid = [[1, 2], [3, 4]];
  const result = resizeGrid(grid, 1, 1, 'bottom-right', 0);
  assert.deepEqual(result.grid, [[4]]);
});

test('copyRegion and pasteRegion move a block of tiles', () => {
  const grid = [[1, 2, 0], [3, 4, 0], [0, 0, 0]];
  const region = copyRegion(grid, 0, 0, 2, 2);
  assert.deepEqual(region, [[1, 2], [3, 4]]);

  const target = createGrid(3, 3, 0);
  const changes = pasteRegion(target, region, 1, 1);
  assert.equal(changes.length, 4);
  assert.deepEqual(target, [[0, 0, 0], [0, 1, 2], [0, 3, 4]]);
});

test('pasteRegion clips at the map edge instead of growing the map', () => {
  const target = createGrid(2, 2, 0);
  pasteRegion(target, [[1, 1], [1, 1]], 1, 1);
  assert.deepEqual(target, [[0, 0], [0, 1]]);
});

test('tile statistics', () => {
  const grid = [[0, 1, 1], [2, 2, 2]];
  assert.equal(countTile(grid, 2), 3);
  assert.deepEqual(distinctTileIds(grid), [0, 1, 2]);
  assert.equal(tileUsage(grid).get(1), 2);
});

test('validateGrid rejects ragged rows and non-integer values', () => {
  assert.deepEqual(validateGrid([[0, 0], [0, 0]]), []);

  const ragged = validateGrid([[0, 0, 0], [0, 0]]);
  assert.equal(ragged.length, 1);
  assert.match(ragged[0], /Row 2 contains 2 tiles, but the expected width is 3/);

  const fractional = validateGrid([[0, 1.5]]);
  assert.match(fractional[0], /not a whole number/);

  const negative = validateGrid([[-3]]);
  assert.match(negative[0], /out of range/);
});

test('cloneGrid produces an independent copy', () => {
  const grid = [[1, 2]];
  const copy = cloneGrid(grid);
  copy[0][0] = 9;
  assert.equal(grid[0][0], 1);
});
