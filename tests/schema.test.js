import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, createMap, createTile, createDictionary,
  validateProject, validateMapSettings, validateTile, validateDictionary,
  migrateProject, migrateDictionary, normalizeSettings, normalizeTags, isSafeId, cleanString
} from '../src/shared/schema.js';
import { DEFAULT_SETTINGS, PROJECT_FORMAT_VERSION } from '../src/shared/constants.js';

const makeId = () => 'generated-id';

function sampleProject() {
  return createProject({
    id: 'demo-1',
    name: 'Demo',
    maps: [createMap({ id: 'map-1', name: 'Map 1', width: 3, height: 2, tileWidth: 16, tileHeight: 16, defaultTile: 0 })]
  });
}

test('a newly created project validates and carries the current format version', () => {
  const project = sampleProject();
  assert.equal(project.formatVersion, PROJECT_FORMAT_VERSION);
  assert.deepEqual(validateProject(project), { ok: true, errors: [] });
  assert.deepEqual(project.maps[0].data, [[0, 0, 0], [0, 0, 0]]);
});

test('validateProject rejects a project with no maps', () => {
  const project = sampleProject();
  project.maps = [];
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /at least one map/);
});

test('validateProject rejects map data that disagrees with the declared size', () => {
  const project = sampleProject();
  project.maps[0].data = [[0, 0]];
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /expected height|expected width/.test(error)));
});

test('validateProject rejects duplicate map identifiers', () => {
  const project = sampleProject();
  project.maps.push({ ...structuredClone(project.maps[0]) });
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /share the identifier/.test(error)));
});

test('validateProject refuses a project from a newer format version', () => {
  const project = sampleProject();
  project.formatVersion = PROJECT_FORMAT_VERSION + 1;
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /newer version of Tiley/.test(error)));
});

test('validateMapSettings enforces minimums and the cell budget', () => {
  assert.deepEqual(validateMapSettings({ width: 1, height: 1, tileWidth: 1, tileHeight: 1, defaultTile: 0 }), []);
  assert.ok(validateMapSettings({ width: 0, height: 10, tileWidth: 16, tileHeight: 16, defaultTile: 0 }).length > 0);
  assert.ok(validateMapSettings({ width: 10, height: 10, tileWidth: 0, tileHeight: 16, defaultTile: 0 }).length > 0);
  assert.ok(validateMapSettings({ width: 10, height: 10, tileWidth: 16, tileHeight: 16, defaultTile: -1 }).length > 0);
  assert.ok(validateMapSettings({ width: 2000, height: 2000, tileWidth: 16, tileHeight: 16, defaultTile: 0 }).length > 0);
});

test('migrateProject upgrades a version 1 document and hands back its inline tiles', () => {
  const legacy = {
    name: 'My RPG',
    version: 1,
    tileSize: { width: 32, height: 32 },
    mapSize: { width: 3, height: 3 },
    tiles: { 0: { name: 'Grass', image: 'grass.png' }, 1: { name: 'Dirt' } },
    map: [[0, 0, 0], [0, 1, 0], [0, 0, 0]]
  };

  const { project, migrated, inlineTiles } = migrateProject(legacy, { makeId });
  assert.equal(migrated, true);
  assert.equal(project.formatVersion, PROJECT_FORMAT_VERSION);
  assert.equal(project.maps.length, 1);
  assert.equal(project.maps[0].width, 3);
  assert.deepEqual(project.maps[0].data, legacy.map);
  assert.deepEqual(inlineTiles.map((tile) => tile.id), [0, 1]);
  assert.deepEqual(validateProject(project), { ok: true, errors: [] });
});

test('migrateProject leaves a current-version document untouched', () => {
  const project = sampleProject();
  const result = migrateProject(project, { makeId });
  assert.equal(result.migrated, false);
  assert.equal(result.project, project);
});

test('migrateProject refuses a future format version', () => {
  const result = migrateProject({ formatVersion: 99 }, { makeId });
  assert.equal(result.project, null);
  assert.match(result.errors[0], /format version 99/);
});

test('tiles reject duplicate IDs within a dictionary', () => {
  const existing = [createTile({ id: 3, name: 'Stone' })];
  const errors = validateTile(createTile({ id: 3, name: 'Rock' }), existing);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /already used by "Stone"/);
});

test('tiles require a whole-number ID and a name', () => {
  assert.ok(validateTile({ id: 1.5, name: 'x' }, []).some((error) => /whole number/.test(error)));
  assert.ok(validateTile({ id: 1, name: '  ' }, []).some((error) => /name cannot be empty/.test(error)));
});

test('validateDictionary catches duplicate IDs in a loaded file', () => {
  const dictionary = createDictionary({ id: 'dict-1', name: 'Overworld', tiles: [createTile({ id: 0, name: 'A' }), createTile({ id: 0, name: 'B' })] });
  const result = validateDictionary(dictionary);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /appears more than once/);
});

test('migrateDictionary accepts both array and object tile collections', () => {
  const fromObject = migrateDictionary({ name: 'Legacy', tiles: { 0: { name: 'Grass' }, 2: { name: 'Water' } } }, { makeId });
  assert.deepEqual(fromObject.dictionary.tiles.map((tile) => tile.id), [0, 2]);

  const fromArray = migrateDictionary({ name: 'Modern', tiles: [{ id: 5, name: 'Lava' }] }, { makeId });
  assert.equal(fromArray.dictionary.tiles[0].name, 'Lava');
});

test('migrateDictionary skips unusable entries and reports them', () => {
  const result = migrateDictionary({ name: 'Broken', tiles: [{ id: 0, name: 'Ok' }, { name: 'No id' }, { id: 0, name: 'Duplicate' }] }, { makeId });
  assert.equal(result.dictionary.tiles.length, 1);
  assert.equal(result.errors.length, 2);
});

test('normalizeSettings clamps values and drops unknown keys', () => {
  const settings = normalizeSettings({
    theme: 'neon',
    autosaveIntervalSeconds: 1,
    paletteThumbnailSize: 9999,
    gridColor: 'not-a-colour',
    secret: 'ignored'
  }, DEFAULT_SETTINGS);

  assert.equal(settings.theme, DEFAULT_SETTINGS.theme);
  assert.equal(settings.autosaveIntervalSeconds, 5);
  assert.equal(settings.paletteThumbnailSize, 128);
  assert.equal(settings.gridColor, DEFAULT_SETTINGS.gridColor);
  assert.equal(settings.secret, undefined);
});

test('helpers: tags are lower-cased and de-duplicated, ids are restricted', () => {
  assert.deepEqual(normalizeTags(['Terrain', 'terrain', ' Outdoor ']), ['terrain', 'outdoor']);
  assert.equal(isSafeId('good-id_1'), true);
  assert.equal(isSafeId('../escape'), false);
  assert.equal(isSafeId(''), false);
  assert.equal(cleanString('  many   spaces  '), 'many spaces');
});
