import test from 'node:test';
import assert from 'node:assert/strict';
import { toTXT, toCSV, toCSVWithHeader, toJSON, projectToJSON, extensionFor } from '../src/shared/exporters.js';

const GRID = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8]
];

test('TXT export matches the documented format exactly', () => {
  assert.equal(toTXT(GRID), '0, 1, 2\n3, 4, 5\n6, 7, 8');
});

test('TXT export adds no brackets, quotes, headers or trailing whitespace', () => {
  const output = toTXT([[0, 0, 0], [0, 1, 0], [0, 0, 0]]);
  assert.equal(output, '0, 0, 0\n0, 1, 0\n0, 0, 0');
  assert.ok(!output.includes('['));
  assert.ok(!output.includes('"'));
  assert.ok(!/\s$/.test(output));
  assert.equal(output.split('\n').length, 3);
});

test('TXT export separates tiles with a comma and exactly one space', () => {
  const [firstRow] = toTXT(GRID).split('\n');
  assert.equal(firstRow, '0, 1, 2');
  assert.deepEqual(firstRow.split(', '), ['0', '1', '2']);
});

test('TXT export handles a single cell and multi-digit IDs', () => {
  assert.equal(toTXT([[42]]), '42');
  assert.equal(toTXT([[10, 200, 3000]]), '10, 200, 3000');
});

test('CSV export is valid, comma separated and free of metadata', () => {
  assert.equal(toCSV(GRID), '0,1,2\n3,4,5\n6,7,8');
  assert.equal(toCSV([[0, 0, 0], [0, 1, 0], [0, 0, 0]]), '0,0,0\n0,1,0\n0,0,0');
});

test('CSV rows all have the same number of fields', () => {
  const rows = toCSV(GRID).split('\n').map((row) => row.split(','));
  assert.ok(rows.every((row) => row.length === rows[0].length));
});

test('CSV with a header only adds the header when explicitly requested', () => {
  assert.equal(toCSVWithHeader(GRID), 'x0,x1,x2\n0,1,2\n3,4,5\n6,7,8');
});

test('JSON export carries dimensions, tile size, dictionary and data', () => {
  const project = { id: 'p1', name: 'My RPG', description: '' };
  const map = { id: 'm1', name: 'Level 1', width: 3, height: 3, tileWidth: 32, tileHeight: 16, defaultTile: 0, data: GRID, metadata: {} };
  const dictionary = { id: 'd1', name: 'Overworld', tiles: [{ id: 0, name: 'Grass', image: 'grass.png', tags: ['terrain'] }] };

  const parsed = JSON.parse(toJSON(project, map, dictionary));
  assert.equal(parsed.map.size.width, 3);
  assert.equal(parsed.map.tileSize.height, 16);
  assert.equal(parsed.project.name, 'My RPG');
  assert.equal(parsed.dictionary.name, 'Overworld');
  assert.deepEqual(parsed.tiles['0'], { name: 'Grass', image: 'grass.png', description: '', tags: ['terrain'], metadata: {} });
  assert.deepEqual(parsed.data, GRID);
});

test('project JSON export includes every map and dictionary', () => {
  const project = { id: 'p1', name: 'Game', maps: [{ id: 'm1', data: GRID }, { id: 'm2', data: GRID }] };
  const parsed = JSON.parse(projectToJSON(project, [{ id: 'd1', name: 'Tiles', tiles: [] }]));
  assert.equal(parsed.project.maps.length, 2);
  assert.equal(parsed.dictionaries.length, 1);
});

test('extensionFor maps each format to a file extension', () => {
  assert.equal(extensionFor('txt'), 'txt');
  assert.equal(extensionFor('csv-header'), 'csv');
  assert.equal(extensionFor('project-json'), 'json');
  assert.equal(extensionFor('png'), 'png');
});
