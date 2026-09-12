import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimitedMap, parseJSONSafely, extractGridFromJSON, findMissingTileIds } from '../src/shared/importers.js';

test('parses the TXT format Tiley exports', () => {
  const result = parseDelimitedMap('0, 1, 2\n3, 4, 5');
  assert.equal(result.ok, true);
  assert.deepEqual(result.grid, [[0, 1, 2], [3, 4, 5]]);
  assert.equal(result.width, 3);
  assert.equal(result.height, 2);
});

test('parses plain CSV and tolerates CRLF line endings', () => {
  const result = parseDelimitedMap('0,0,1\r\n2,2,3\r\n');
  assert.equal(result.ok, true);
  assert.deepEqual(result.grid, [[0, 0, 1], [2, 2, 3]]);
});

test('reports the exact row and column of a bad value', () => {
  const result = parseDelimitedMap('0,0\n0,x');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Line 2, column 2 contains "x"/);
});

test('reports a row whose width does not match the rest', () => {
  const result = parseDelimitedMap('0,0,0\n0,0');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Row 2 contains 2 tiles, but the expected width is 3/);
});

test('reports a mismatch against the expected map dimensions', () => {
  const result = parseDelimitedMap('0,0\n0,0', { expectedWidth: 3, expectedHeight: 2 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /2 tiles wide, but this map is 3 tiles wide/);
});

test('rejects an empty file with a readable message', () => {
  assert.match(parseDelimitedMap('').errors[0], /empty/);
  assert.match(parseDelimitedMap('\n\n').errors[0], /no map rows|empty/);
});

test('rejects a blank line in the middle of a map', () => {
  const result = parseDelimitedMap('0,0\n\n0,0');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /blank/);
});

test('skips a textual header row and says so', () => {
  const result = parseDelimitedMap('x0,x1\n0,1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.grid, [[0, 1]]);
  assert.match(result.warnings[0], /header/);
});

test('parseJSONSafely reports malformed JSON instead of throwing', () => {
  const result = parseJSONSafely('{ nope');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /not valid JSON/);
});

test('extractGridFromJSON accepts an exported map and a bare grid', () => {
  assert.deepEqual(extractGridFromJSON({ data: [[1, 2]] }).grid, [[1, 2]]);
  assert.deepEqual(extractGridFromJSON([[3, 4]]).grid, [[3, 4]]);

  const bad = extractGridFromJSON({ nothing: true });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /No tilemap data/);
});

test('extractGridFromJSON validates the grid it finds', () => {
  const result = extractGridFromJSON({ data: [[0, 0], [0]] });
  assert.equal(result.ok, false);
});

test('findMissingTileIds lists undefined IDs in ascending order', () => {
  const dictionary = { tiles: [{ id: 0 }, { id: 1 }] };
  assert.deepEqual(findMissingTileIds([[0, 5], [1, 3]], dictionary), [3, 5]);
  assert.deepEqual(findMissingTileIds([[0, 1]], dictionary), []);
});
