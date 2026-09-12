/**
 * Project persistence.
 *
 * Layout on disk:
 *
 *   projects/<projectId>/project.json    the saved document
 *   projects/<projectId>/recovery.json   autosaved snapshot of unsaved work
 *
 * A project is only ever written through `writeJSON` (atomic) inside
 * `withFileLock` (serialised), and is validated both before writing and after
 * reading, so a damaged or hand-edited file surfaces as a readable error rather
 * than a broken editor.
 */

import path from 'node:path';
import {
  PROJECTS_DIR, RECENTS_FILE, resolveWithin, assertSafeSegment
} from '../../utils/paths.js';
import {
  readJSON, writeJSON, withFileLock, listDirectories, removeDirectory, pathExists, fileStats, removeFile
} from '../../utils/storage.js';
import { makeId, slugify } from '../../utils/ids.js';
import { stringifyProject } from '../../utils/serialize.js';
import { AppError, badRequest, notFound } from '../../utils/errors.js';
import {
  createProject, createMap, validateProject, migrateProject,
  validateMapSettings, validateName, cleanString, isSafeId
} from '../../shared/schema.js';
import { LIMITS, PROJECT_FORMAT_VERSION } from '../../shared/constants.js';
import { resizeGrid } from '../../shared/tilemap.js';
import * as dictionaryService from './dictionaryService.js';

const PROJECT_FILE = 'project.json';
const RECOVERY_FILE = 'recovery.json';

function projectDir(id) {
  assertSafeSegment(id, 'project identifier');
  return resolveWithin(PROJECTS_DIR, id);
}

function projectFile(id) {
  return path.join(projectDir(id), PROJECT_FILE);
}

function recoveryFile(id) {
  return path.join(projectDir(id), RECOVERY_FILE);
}

/** Cheap summary used by the project browser — never loads tile data. */
function summarize(project, stats, recoveryAt) {
  const totalCells = project.maps.reduce((sum, map) => sum + map.width * map.height, 0);
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    savedAt: stats ? stats.mtime.toISOString() : project.updatedAt,
    mapCount: project.maps.length,
    totalCells,
    maps: project.maps.map((map) => ({
      id: map.id, name: map.name, width: map.width, height: map.height
    })),
    hasRecovery: Boolean(recoveryAt),
    recoveryAt: recoveryAt ?? null,
    formatVersion: project.formatVersion
  };
}

/* ------------------------------------------------------------------- read   */

/**
 * Load a project, migrating older format versions in place.
 * Migration result is written back so a project is upgraded exactly once.
 */
export async function getProject(id) {
  const file = projectFile(id);
  const raw = await readJSON(file, { label: 'project' });

  const { project, migrated, errors, inlineTiles } = migrateProject(raw, { makeId });
  if (!project) throw new AppError(errors[0] ?? 'The project could not be opened.', { status: 422, code: 'unsupported_version', errors });

  // Keep the folder name authoritative; a copied folder should still open.
  project.id = id;

  const validation = validateProject(project);
  if (!validation.ok) {
    throw new AppError('This project file is damaged and could not be opened.', {
      status: 422,
      code: 'invalid_project',
      errors: validation.errors,
      detail: `${file}: ${validation.errors.join(' | ')}`
    });
  }

  if (migrated) {
    // A v1 project carried its tiles inline; promote them to a real dictionary.
    if (Array.isArray(inlineTiles) && inlineTiles.length > 0) {
      const dictionary = await dictionaryService.createDictionaryDocument({
        name: `${project.name} Tiles`,
        tiles: inlineTiles
      });
      for (const map of project.maps) map.dictionaryId = dictionary.id;
    }
    await saveProject(id, project);
  }
  return project;
}

export async function listProjects() {
  const ids = await listDirectories(PROJECTS_DIR);
  const summaries = [];
  for (const id of ids) {
    if (!isSafeId(id)) continue;
    const file = path.join(PROJECTS_DIR, id, PROJECT_FILE);
    try {
      const raw = await readJSON(file, { fallback: null, label: 'project' });
      if (!raw) continue;
      const { project } = migrateProject(raw, { makeId });
      if (!project) continue;
      project.id = id;
      const validation = validateProject(project);
      const stats = await fileStats(file);
      const recoveryStats = await fileStats(path.join(PROJECTS_DIR, id, RECOVERY_FILE));
      if (!validation.ok) {
        summaries.push({
          id,
          name: project.name ?? id,
          damaged: true,
          problems: validation.errors.slice(0, 5),
          savedAt: stats ? stats.mtime.toISOString() : null,
          mapCount: Array.isArray(project.maps) ? project.maps.length : 0,
          totalCells: 0,
          maps: [],
          hasRecovery: Boolean(recoveryStats)
        });
        continue;
      }
      summaries.push({ ...summarize(project, stats, recoveryStats?.mtime.toISOString()), damaged: false });
    } catch (error) {
      summaries.push({
        id,
        name: id,
        damaged: true,
        problems: [error instanceof AppError ? error.message : 'The project could not be read.'],
        savedAt: null,
        mapCount: 0,
        totalCells: 0,
        maps: [],
        hasRecovery: false
      });
    }
  }
  summaries.sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')));
  return summaries;
}

/* ------------------------------------------------------------------ write   */

/** Validate and atomically persist a whole project document. */
export async function saveProject(id, incoming) {
  assertSafeSegment(id, 'project identifier');
  const project = { ...incoming, id, formatVersion: PROJECT_FORMAT_VERSION };
  project.name = cleanString(project.name);
  project.updatedAt = new Date().toISOString();
  if (!project.createdAt) project.createdAt = project.updatedAt;

  const validation = validateProject(project);
  if (!validation.ok) throw badRequest('The project could not be saved because it contains invalid data.', validation.errors);

  return withFileLock(projectFile(id), async () => {
    await writeJSON(projectFile(id), project, stringifyProject);
    return project;
  });
}

export async function createNewProject(input) {
  const nameCheck = validateName(input?.name, 'Project name');
  const errors = [...nameCheck.errors];

  const mapSettings = {
    width: Number(input?.mapWidth),
    height: Number(input?.mapHeight),
    tileWidth: Number(input?.tileWidth),
    tileHeight: Number(input?.tileHeight),
    defaultTile: Number(input?.defaultTile ?? 0)
  };
  errors.push(...validateMapSettings(mapSettings));
  if (input?.dictionaryId != null && !isSafeId(input.dictionaryId)) {
    errors.push('The chosen tile dictionary is not valid.');
  }
  if (errors.length > 0) throw badRequest('The project could not be created.', errors);

  const id = slugify(nameCheck.value, 'project');
  if (await pathExists(projectDir(id))) throw new AppError('A project with that identifier already exists.', { status: 409, code: 'conflict' });

  const map = createMap({
    id: makeId('map'),
    name: cleanString(input?.mapName) || 'Map 1',
    ...mapSettings,
    dictionaryId: input?.dictionaryId ?? null
  });

  const project = createProject({
    id,
    name: nameCheck.value,
    description: input?.description ?? '',
    maps: [map]
  });

  await saveProject(id, project);
  await touchRecent(id);
  return project;
}

export async function renameProject(id, name) {
  const { value, errors } = validateName(name, 'Project name');
  if (errors.length > 0) throw badRequest('The project could not be renamed.', errors);
  const project = await getProject(id);
  project.name = value;
  return saveProject(id, project);
}

export async function duplicateProject(id, name) {
  const source = await getProject(id);
  const { value, errors } = validateName(name ?? `${source.name} copy`, 'Project name');
  if (errors.length > 0) throw badRequest('The project could not be duplicated.', errors);

  const newId = slugify(value, 'project');
  const copy = structuredClone(source);
  copy.id = newId;
  copy.name = value;
  copy.createdAt = new Date().toISOString();
  // Fresh map ids keep the copy independent of the original.
  const idMap = new Map();
  for (const map of copy.maps) {
    const fresh = makeId('map');
    idMap.set(map.id, fresh);
    map.id = fresh;
  }
  copy.activeMapId = idMap.get(source.activeMapId) ?? copy.maps[0].id;

  await saveProject(newId, copy);
  return copy;
}

export async function deleteProject(id) {
  const directory = projectDir(id);
  if (!(await pathExists(directory))) throw notFound('That project no longer exists.');
  await withFileLock(projectFile(id), async () => {
    await removeDirectory(directory);
  });
  await removeRecent(id);
}

/* ---------------------------------------------------------------- recovery  */

/**
 * Recovery snapshots are written far more often than real saves and are never
 * allowed to overwrite `project.json` without the user confirming.
 */
export async function saveRecovery(id, project) {
  assertSafeSegment(id, 'project identifier');
  if (!(await pathExists(projectDir(id)))) throw notFound('That project no longer exists.');
  const validation = validateProject({ ...project, id, formatVersion: PROJECT_FORMAT_VERSION });
  if (!validation.ok) throw badRequest('The recovery snapshot contained invalid data.', validation.errors);

  const snapshot = { ...project, id, formatVersion: PROJECT_FORMAT_VERSION, savedAt: new Date().toISOString() };
  return withFileLock(recoveryFile(id), async () => {
    await writeJSON(recoveryFile(id), snapshot, stringifyProject);
    return { savedAt: snapshot.savedAt };
  });
}

/** Returns the snapshot only when it is genuinely newer than the saved file. */
export async function getRecovery(id) {
  const recovery = recoveryFile(id);
  const [recoveryStats, savedStats] = await Promise.all([fileStats(recovery), fileStats(projectFile(id))]);
  if (!recoveryStats) return null;
  if (savedStats && savedStats.mtimeMs >= recoveryStats.mtimeMs) return null;

  const snapshot = await readJSON(recovery, { fallback: null, label: 'recovery snapshot' });
  if (!snapshot) return null;
  const validation = validateProject({ ...snapshot, id });
  if (!validation.ok) return null;
  return { project: { ...snapshot, id }, savedAt: recoveryStats.mtime.toISOString() };
}

export async function discardRecovery(id) {
  await removeFile(recoveryFile(id));
}

/* -------------------------------------------------------------------- maps  */

export async function listMaps(projectId) {
  const project = await getProject(projectId);
  return project.maps.map(({ data, ...rest }) => ({ ...rest, cells: rest.width * rest.height }));
}

export async function addMap(projectId, input) {
  const project = await getProject(projectId);
  const settings = {
    width: Number(input?.width),
    height: Number(input?.height),
    tileWidth: Number(input?.tileWidth),
    tileHeight: Number(input?.tileHeight),
    defaultTile: Number(input?.defaultTile ?? 0)
  };
  const nameCheck = validateName(input?.name, 'Map name');
  const errors = [...nameCheck.errors, ...validateMapSettings(settings)];
  if (errors.length > 0) throw badRequest('The map could not be created.', errors);

  const map = createMap({
    id: makeId('map'),
    name: nameCheck.value,
    ...settings,
    dictionaryId: isSafeId(input?.dictionaryId) ? input.dictionaryId : null
  });
  project.maps.push(map);
  project.activeMapId = map.id;
  await saveProject(projectId, project);
  return map;
}

export async function updateMap(projectId, mapId, patch) {
  const project = await getProject(projectId);
  const map = project.maps.find((candidate) => candidate.id === mapId);
  if (!map) throw notFound('That map no longer exists.');

  if (patch.name !== undefined) {
    const { value, errors } = validateName(patch.name, 'Map name');
    if (errors.length > 0) throw badRequest('The map could not be updated.', errors);
    map.name = value;
  }
  if (patch.dictionaryId !== undefined) {
    if (patch.dictionaryId !== null && !isSafeId(patch.dictionaryId)) throw badRequest('That tile dictionary is not valid.');
    map.dictionaryId = patch.dictionaryId;
  }
  if (patch.tileWidth !== undefined || patch.tileHeight !== undefined || patch.defaultTile !== undefined) {
    const next = {
      width: map.width,
      height: map.height,
      tileWidth: Number(patch.tileWidth ?? map.tileWidth),
      tileHeight: Number(patch.tileHeight ?? map.tileHeight),
      defaultTile: Number(patch.defaultTile ?? map.defaultTile)
    };
    const errors = validateMapSettings(next);
    if (errors.length > 0) throw badRequest('The map could not be updated.', errors);
    Object.assign(map, next);
  }
  if (patch.width !== undefined || patch.height !== undefined) {
    const width = Number(patch.width ?? map.width);
    const height = Number(patch.height ?? map.height);
    const errors = validateMapSettings({ ...map, width, height });
    if (errors.length > 0) throw badRequest('The map could not be resized.', errors);
    const result = resizeGrid(map.data, width, height, patch.anchor ?? 'top-left', map.defaultTile);
    map.data = result.grid;
    map.width = width;
    map.height = height;
  }
  if (Array.isArray(patch.data)) {
    map.data = patch.data;
  }

  await saveProject(projectId, project);
  return map;
}

export async function deleteMap(projectId, mapId) {
  const project = await getProject(projectId);
  if (project.maps.length <= 1) throw badRequest('A project must keep at least one map.');
  const index = project.maps.findIndex((map) => map.id === mapId);
  if (index === -1) throw notFound('That map no longer exists.');
  project.maps.splice(index, 1);
  if (project.activeMapId === mapId) project.activeMapId = project.maps[0].id;
  await saveProject(projectId, project);
  return { id: mapId };
}

/* ------------------------------------------------------------------ recents */

/** Recent-project list; entries can be forgotten without deleting the project. */
export async function getRecents() {
  const recents = await readJSON(RECENTS_FILE, { fallback: [], label: 'recent projects list' });
  return Array.isArray(recents) ? recents.filter((entry) => isSafeId(entry?.id)) : [];
}

export async function touchRecent(id) {
  assertSafeSegment(id, 'project identifier');
  return withFileLock(RECENTS_FILE, async () => {
    const recents = await getRecents();
    const filtered = recents.filter((entry) => entry.id !== id);
    filtered.unshift({ id, lastOpenedAt: new Date().toISOString() });
    const trimmed = filtered.slice(0, LIMITS.RECENT_PROJECTS);
    await writeJSON(RECENTS_FILE, trimmed);
    return trimmed;
  });
}

export async function removeRecent(id) {
  return withFileLock(RECENTS_FILE, async () => {
    const recents = await getRecents();
    const trimmed = recents.filter((entry) => entry.id !== id);
    await writeJSON(RECENTS_FILE, trimmed);
    return trimmed;
  });
}

/** Import a project document produced by "Export project as JSON". */
export async function importProject(document) {
  const source = document?.project ?? document;
  const { project, errors, inlineTiles } = migrateProject(source, { makeId });
  if (!project) throw badRequest('That file is not a Tiley project.', errors);

  const nameCheck = validateName(project.name, 'Project name');
  const id = slugify(nameCheck.value || 'imported', 'project');
  project.id = id;
  for (const map of project.maps) map.id = makeId('map');
  project.activeMapId = project.maps[0].id;

  // Bring along any dictionaries the export carried with it.
  const dictionaryIdMap = new Map();
  if (Array.isArray(document?.dictionaries)) {
    for (const raw of document.dictionaries) {
      const imported = await dictionaryService.importDictionary(raw);
      if (raw?.id) dictionaryIdMap.set(raw.id, imported.id);
    }
  }
  if (Array.isArray(inlineTiles) && inlineTiles.length > 0) {
    const dictionary = await dictionaryService.createDictionaryDocument({
      name: `${project.name} Tiles`, tiles: inlineTiles
    });
    for (const map of project.maps) map.dictionaryId = dictionary.id;
  } else {
    for (const map of project.maps) {
      map.dictionaryId = dictionaryIdMap.get(map.dictionaryId) ?? (isSafeId(map.dictionaryId) ? map.dictionaryId : null);
    }
  }

  const validation = validateProject(project);
  if (!validation.ok) throw badRequest('That project file could not be imported.', validation.errors);

  await saveProject(id, project);
  return project;
}
