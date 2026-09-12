/**
 * End-to-end tests against the real Express application, using the real
 * projects/ and data/ directories. Everything created is named with a unique
 * prefix and removed in the `after` hook.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createApp } from '../src/backend/app.js';
import { deleteProject } from '../src/backend/services/projectService.js';
import { deleteDictionary } from '../src/backend/services/dictionaryService.js';
import { deleteAsset } from '../src/backend/services/assetService.js';

let server;
let baseUrl;
const createdProjects = new Set();
const createdDictionaries = new Set();
const createdAssets = new Set();

const unique = (label) => `Ztest ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

before(async () => {
  const app = await createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const id of createdProjects) await deleteProject(id).catch(() => {});
  for (const id of createdDictionaries) await deleteDictionary(id).catch(() => {});
  for (const id of createdAssets) await deleteAsset(id).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
});

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body instanceof FormData || options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body instanceof FormData ? options.body : (options.body === undefined ? undefined : JSON.stringify(options.body))
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function newProject(overrides = {}) {
  const result = await api('/api/projects', {
    method: 'POST',
    body: { name: unique('Project'), mapWidth: 5, mapHeight: 4, tileWidth: 32, tileHeight: 32, defaultTile: 0, ...overrides }
  });
  if (result.status === 201) createdProjects.add(result.body.project.id);
  return result;
}

async function newDictionary(tiles = []) {
  const result = await api('/api/dictionaries', { method: 'POST', body: { name: unique('Dictionary'), tiles } });
  if (result.status === 201) createdDictionaries.add(result.body.dictionary.id);
  return result;
}

/* ----------------------------------------------------------------- health */

test('the server reports its health', async () => {
  const { status, body } = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

/* --------------------------------------------------------------- projects */

test('creating a project stores a valid document with one map', async () => {
  const { status, body } = await newProject();
  assert.equal(status, 201);
  assert.equal(body.project.maps.length, 1);
  assert.equal(body.project.maps[0].width, 5);
  assert.equal(body.project.maps[0].data.length, 4);
  assert.equal(body.project.formatVersion, 2);
});

test('creating a project validates its dimensions', async () => {
  const { status, body } = await api('/api/projects', {
    method: 'POST',
    body: { name: 'Bad', mapWidth: 0, mapHeight: -3, tileWidth: 32, tileHeight: 32, defaultTile: 0 }
  });
  assert.equal(status, 400);
  assert.match(body.error.message, /could not be created/);
  assert.ok(body.error.problems.length >= 2);
});

test('creating a project rejects an empty name', async () => {
  const { status, body } = await api('/api/projects', {
    method: 'POST',
    body: { name: '   ', mapWidth: 4, mapHeight: 4, tileWidth: 8, tileHeight: 8, defaultTile: 0 }
  });
  assert.equal(status, 400);
  assert.ok(body.error.problems.some((problem) => /cannot be empty/.test(problem)));
});

test('a saved project can be loaded back unchanged', async () => {
  const { body: created } = await newProject();
  const id = created.project.id;

  created.project.maps[0].data[1][2] = 7;
  const saved = await api(`/api/projects/${id}`, { method: 'PUT', body: { project: created.project } });
  assert.equal(saved.status, 200);

  const loaded = await api(`/api/projects/${id}`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.project.maps[0].data[1][2], 7);
  assert.equal(loaded.body.project.name, created.project.name);
});

test('saving rejects map data that does not match the declared size', async () => {
  const { body: created } = await newProject();
  const project = created.project;
  project.maps[0].data = [[0, 0]];

  const { status, body } = await api(`/api/projects/${project.id}`, { method: 'PUT', body: { project } });
  assert.equal(status, 400);
  assert.ok(body.error.problems.length > 0);
});

test('saving rejects non-integer tile values', async () => {
  const { body: created } = await newProject();
  const project = created.project;
  project.maps[0].data[0][0] = 'grass';

  const { status } = await api(`/api/projects/${project.id}`, { method: 'PUT', body: { project } });
  assert.equal(status, 400);
});

test('projects can be renamed, duplicated and deleted', async () => {
  const { body: created } = await newProject();
  const id = created.project.id;

  const renamed = await api(`/api/projects/${id}`, { method: 'PATCH', body: { name: 'Ztest Renamed' } });
  assert.equal(renamed.body.project.name, 'Ztest Renamed');

  const copy = await api(`/api/projects/${id}/duplicate`, { method: 'POST', body: { name: unique('Copy') } });
  assert.equal(copy.status, 201);
  createdProjects.add(copy.body.project.id);
  assert.notEqual(copy.body.project.id, id);
  assert.notEqual(copy.body.project.maps[0].id, created.project.maps[0].id, 'the copy gets fresh map identifiers');

  const deleted = await api(`/api/projects/${id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  createdProjects.delete(id);
  assert.equal((await api(`/api/projects/${id}`)).status, 404);
});

test('an unknown project returns a readable 404', async () => {
  const { status, body } = await api('/api/projects/does-not-exist');
  assert.equal(status, 404);
  assert.ok(!('stack' in body.error));
  assert.match(body.error.message, /could not be found/);
});

test('project identifiers that try to traverse the filesystem are rejected', async () => {
  for (const attempt of ['..', '../../etc', '%2e%2e%2fetc', 'a/b', '.hidden']) {
    const { status } = await api(`/api/projects/${encodeURIComponent(attempt)}`);
    assert.ok(status === 400 || status === 404, `expected ${attempt} to be refused, got ${status}`);
  }
});

test('recent projects can be forgotten without deleting the project', async () => {
  const { body: created } = await newProject();
  const id = created.project.id;
  await api(`/api/projects/${id}`);   // opening records it as recent

  const recents = await api('/api/projects/recents');
  assert.ok(recents.body.recents.some((entry) => entry.id === id));

  await api(`/api/projects/recents/${id}`, { method: 'DELETE' });
  const after = await api('/api/projects/recents');
  assert.ok(!after.body.recents.some((entry) => entry.id === id));
  assert.equal((await api(`/api/projects/${id}`)).status, 200, 'the project itself still exists');
});

/* ------------------------------------------------------------------- maps */

test('maps can be added, resized, renamed and deleted', async () => {
  const { body: created } = await newProject();
  const id = created.project.id;

  const added = await api(`/api/projects/${id}/maps`, {
    method: 'POST',
    body: { name: 'Dungeon', width: 6, height: 6, tileWidth: 16, tileHeight: 16, defaultTile: 0 }
  });
  assert.equal(added.status, 201);
  const mapId = added.body.map.id;

  const resized = await api(`/api/projects/${id}/maps/${mapId}`, { method: 'PUT', body: { width: 3, height: 3, anchor: 'top-left' } });
  assert.equal(resized.body.map.width, 3);
  assert.equal(resized.body.map.data.length, 3);
  assert.equal(resized.body.map.data[0].length, 3);

  const renamed = await api(`/api/projects/${id}/maps/${mapId}`, { method: 'PUT', body: { name: 'Cavern' } });
  assert.equal(renamed.body.map.name, 'Cavern');

  const maps = await api(`/api/projects/${id}/maps`);
  assert.equal(maps.body.maps.length, 2);

  const removed = await api(`/api/projects/${id}/maps/${mapId}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
});

test('the last map in a project cannot be deleted', async () => {
  const { body: created } = await newProject();
  const { status, body } = await api(`/api/projects/${created.project.id}/maps/${created.project.maps[0].id}`, { method: 'DELETE' });
  assert.equal(status, 400);
  assert.match(body.error.message, /at least one map/);
});

/* --------------------------------------------------------------- recovery */

test('a recovery snapshot is offered only while it is newer than the save', async () => {
  const { body: created } = await newProject();
  const project = created.project;

  assert.equal((await api(`/api/projects/${project.id}/recovery`)).body.recovery, null);

  project.maps[0].data[0][0] = 4;
  await new Promise((resolve) => setTimeout(resolve, 12));
  const stored = await api(`/api/projects/${project.id}/recovery`, { method: 'POST', body: { project } });
  assert.equal(stored.status, 200);

  const offered = await api(`/api/projects/${project.id}/recovery`);
  assert.equal(offered.body.recovery.project.maps[0].data[0][0], 4);

  // The saved project itself must be untouched by the snapshot.
  const onDisk = await api(`/api/projects/${project.id}`);
  assert.equal(onDisk.body.project.maps[0].data[0][0], 0);

  await api(`/api/projects/${project.id}/recovery`, { method: 'DELETE' });
  assert.equal((await api(`/api/projects/${project.id}/recovery`)).body.recovery, null);
});

/* ----------------------------------------------------------- dictionaries */

test('dictionaries and their tiles can be managed', async () => {
  const { status, body } = await newDictionary([{ id: 0, name: 'Grass', tags: ['terrain'] }]);
  assert.equal(status, 201);
  const id = body.dictionary.id;

  const added = await api(`/api/dictionaries/${id}/tiles`, { method: 'POST', body: { id: 1, name: 'Dirt' } });
  assert.equal(added.status, 201);

  const updated = await api(`/api/dictionaries/${id}/tiles/1`, { method: 'PUT', body: { id: 5, name: 'Deep Dirt' } });
  assert.equal(updated.body.tile.id, 5);

  const removed = await api(`/api/dictionaries/${id}/tiles/5`, { method: 'DELETE' });
  assert.equal(removed.status, 200);

  const loaded = await api(`/api/dictionaries/${id}`);
  assert.deepEqual(loaded.body.dictionary.tiles.map((tile) => tile.id), [0]);
});

test('duplicate tile IDs are refused with a message naming the clash', async () => {
  const { body } = await newDictionary([{ id: 2, name: 'Water' }]);
  const { status, body: error } = await api(`/api/dictionaries/${body.dictionary.id}/tiles`, { method: 'POST', body: { id: 2, name: 'Sea' } });
  assert.equal(status, 400);
  assert.ok(error.error.problems.some((problem) => /already used by "Water"/.test(problem)));
});

test('a dictionary can be duplicated and exported/imported as a file', async () => {
  const { body } = await newDictionary([{ id: 0, name: 'Floor' }, { id: 1, name: 'Wall' }]);
  const id = body.dictionary.id;

  const copy = await api(`/api/dictionaries/${id}/duplicate`, { method: 'POST', body: { name: unique('Copy') } });
  assert.equal(copy.status, 201);
  createdDictionaries.add(copy.body.dictionary.id);
  assert.deepEqual(copy.body.dictionary.tiles.map((tile) => tile.name), ['Floor', 'Wall']);

  const exported = (await api(`/api/dictionaries/${id}`)).body.dictionary;
  const imported = await api('/api/dictionaries/import', { method: 'POST', body: { document: { ...exported, name: unique('Imported') } } });
  assert.equal(imported.status, 201);
  createdDictionaries.add(imported.body.dictionary.id);
  assert.deepEqual(imported.body.dictionary.tiles.map((tile) => tile.id), [0, 1]);
});

test('importing a file that is not a dictionary fails with a clear message', async () => {
  const { status, body } = await api('/api/dictionaries/import', { method: 'POST', body: { document: { name: 'Nope' } } });
  assert.equal(status, 400);
  assert.match(body.error.message, /not a tile dictionary/);
});

/* ---------------------------------------------------------------- assets */

/** Smallest valid 1x1 PNG, built here so the test has no binary fixtures. */
function onePixelPng() {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const idat = zlib.deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test('a real PNG upload is stored under a generated name', async () => {
  const form = new FormData();
  form.append('image', new Blob([onePixelPng()], { type: 'image/png' }), 'my picture.png');
  const { status, body } = await api('/api/assets', { method: 'POST', body: form });

  assert.equal(status, 201);
  createdAssets.add(body.asset.id);
  assert.match(body.asset.id, /^[0-9a-f]{24}\.png$/, 'the client filename is discarded');
  assert.equal(body.asset.url, `/assets/tiles/${body.asset.id}`);

  const served = await fetch(`${baseUrl}${body.asset.url}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
});

test('a file that only claims to be an image is rejected', async () => {
  const form = new FormData();
  form.append('image', new Blob([Buffer.from('<?php echo "hi"; ?>')], { type: 'image/png' }), 'evil.png');
  const { status, body } = await api('/api/assets', { method: 'POST', body: form });
  assert.equal(status, 400);
  assert.match(body.error.message, /not a PNG, JPEG or WebP/);
});

test('an unsupported image type is rejected before it is written', async () => {
  const form = new FormData();
  form.append('image', new Blob([Buffer.from('GIF89a')], { type: 'image/gif' }), 'x.gif');
  const { status } = await api('/api/assets', { method: 'POST', body: form });
  assert.equal(status, 400);
});

test('asset deletion refuses paths outside the tile directory', async () => {
  const { status } = await api('/api/assets/..%2F..%2Fserver.js', { method: 'DELETE' });
  assert.ok(status === 400 || status === 404);
});

/* --------------------------------------------------------------- settings */

test('settings round-trip and unknown values are clamped', async () => {
  const before = (await api('/api/settings')).body.settings;

  const updated = await api('/api/settings', { method: 'PUT', body: { autosaveIntervalSeconds: 1, theme: 'light', nonsense: true } });
  assert.equal(updated.body.settings.autosaveIntervalSeconds, 5);
  assert.equal(updated.body.settings.theme, 'light');
  assert.equal(updated.body.settings.nonsense, undefined);

  await api('/api/settings', { method: 'PUT', body: before });
});

/* ----------------------------------------------------------------- misc  */

test('unknown API routes return JSON, not HTML', async () => {
  const { status, body } = await api('/api/nope');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'not_found');
});

test('a project exported as JSON can be imported back as a new project', async () => {
  const { body: created } = await newProject();
  created.project.maps[0].data[0][0] = 3;
  await api(`/api/projects/${created.project.id}`, { method: 'PUT', body: { project: created.project } });

  const imported = await api('/api/projects/import', {
    method: 'POST',
    body: { document: { project: { ...created.project, name: unique('Imported') }, dictionaries: [] } }
  });
  assert.equal(imported.status, 201);
  createdProjects.add(imported.body.project.id);
  assert.notEqual(imported.body.project.id, created.project.id);
  assert.equal(imported.body.project.maps[0].data[0][0], 3);
});

test('a version 1 project document is migrated on import', async () => {
  const legacy = {
    name: unique('Legacy'),
    version: 1,
    tileSize: { width: 16, height: 16 },
    mapSize: { width: 2, height: 2 },
    tiles: { 0: { name: 'Grass' }, 1: { name: 'Dirt' } },
    map: [[0, 1], [1, 0]]
  };
  const { status, body } = await api('/api/projects/import', { method: 'POST', body: { document: legacy } });
  assert.equal(status, 201);
  createdProjects.add(body.project.id);
  createdDictionaries.add(body.project.maps[0].dictionaryId);

  assert.equal(body.project.formatVersion, 2);
  assert.deepEqual(body.project.maps[0].data, [[0, 1], [1, 0]]);
  assert.ok(body.project.maps[0].dictionaryId, 'inline tiles became a real dictionary');
});
