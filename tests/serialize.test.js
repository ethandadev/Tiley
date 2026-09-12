import test from 'node:test';
import assert from 'node:assert/strict';
import { stringifyProject } from '../src/utils/serialize.js';
import { createProject, createMap } from '../src/shared/schema.js';

test('project serialisation round-trips through JSON.parse', () => {
  const project = createProject({
    id: 'demo',
    name: 'Demo',
    maps: [
      createMap({ id: 'map-1', width: 3, height: 2, data: [[0, 1, 2], [3, 4, 5]] }),
      createMap({ id: 'map-2', width: 2, height: 2, data: [[9, 9], [9, 9]] })
    ]
  });

  const text = stringifyProject(project);
  assert.deepEqual(JSON.parse(text), project);
});

test('tile rows are written one line per map row, not one line per tile', () => {
  const project = createProject({
    id: 'demo',
    name: 'Demo',
    maps: [createMap({ id: 'map-1', width: 4, height: 3, data: [[0, 0, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0]] })]
  });

  const text = stringifyProject(project);
  assert.ok(text.includes('[0,1,1,0]'));
  // Three data rows, and nothing like a lone "0," on its own line.
  assert.equal(text.split('\n').filter((line) => line.trim().startsWith('[')).length, 3);
});

test('serialisation stays compact for a large map', () => {
  const width = 400;
  const height = 400;
  const data = Array.from({ length: height }, () => new Array(width).fill(0));
  const project = createProject({ id: 'big', name: 'Big', maps: [createMap({ id: 'map-1', width, height, data })] });

  const text = stringifyProject(project);
  const pretty = JSON.stringify(project, null, 2);
  assert.ok(text.length < pretty.length / 4, 'compact rows should be far smaller than fully indented JSON');
  assert.deepEqual(JSON.parse(text).maps[0].data.length, height);
});
