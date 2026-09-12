/**
 * Project session management: opening, saving, closing and the recovery flow.
 *
 * The editor always works on a full in-memory project document. Saving sends
 * the whole document back; the server validates it before it replaces the file,
 * so a bug in the editor cannot write an unloadable project.
 */

import * as api from './api.js';
import { state, emit, setSaveStatus, activeMap } from './store.js';
import { resetHistory } from './history.js';
import { toastSuccess, toastApiError, toastWarning } from './toast.js';
import { confirmDialog, openForm } from './modal.js';
import { preloadDictionary, clearImageCache } from './tileImages.js';
import { requestRender, viewportSize } from './renderer.js';
import { fitToScreen } from './viewport.js';
import { LIMITS } from '../../shared/constants.js';

/* ------------------------------------------------------- dictionary cache - */

/** Load (and cache) every dictionary referenced by the open project. */
export async function loadProjectDictionaries() {
  if (!state.project) return;
  const ids = new Set(state.project.maps.map((map) => map.dictionaryId).filter(Boolean));
  for (const id of ids) {
    if (state.dictionaries.has(id)) continue;
    try {
      const dictionary = await api.getDictionary(id);
      state.dictionaries.set(id, dictionary);
      preloadDictionary(dictionary);
    } catch (error) {
      toastWarning(
        'A tile dictionary could not be loaded',
        `Maps using it will show their tile IDs as missing. ${error.message}`
      );
    }
  }
  emit('tiles');
  requestRender();
}

/** Re-fetch one dictionary after it has been edited elsewhere in the UI. */
export async function refreshDictionary(id) {
  if (!id) return null;
  const dictionary = await api.getDictionary(id);
  state.dictionaries.set(id, dictionary);
  preloadDictionary(dictionary);
  emit('tiles');
  requestRender();
  return dictionary;
}

/* -------------------------------------------------------------- open/save - */

/**
 * Open a project by id.
 * `silent` is used when restoring the remembered project at start-up: a
 * project that has since been deleted should quietly fall back to the browser
 * rather than greet the user with an error they did not ask for.
 */
export async function openProject(id, { silent = false } = {}) {
  if (!(await confirmDiscardIfDirty())) return false;

  let project;
  try {
    project = await api.getProject(id);
  } catch (error) {
    if (!silent) toastApiError('That project could not be opened', error);
    return false;
  }

  // Offer any newer autosaved snapshot before touching the saved document.
  try {
    const recovery = await api.getRecovery(id);
    if (recovery) {
      const restore = await confirmDialog({
        title: 'Recovered work is available',
        message: `A more recent version of "${project.name}" was saved automatically but never written to the project file.`,
        details: [`Autosaved ${new Date(recovery.savedAt).toLocaleString()}`],
        confirmLabel: 'Restore recovered version',
        cancelLabel: 'Discard it and open the saved project',
        // No dismiss button: discarding recovered work must be a deliberate choice.
        dismissible: false
      });
      if (restore) {
        project = recovery.project;
        await api.discardRecovery(id);
        toastSuccess('Recovered work restored', 'Save the project to keep it.');
      } else {
        await api.discardRecovery(id);
      }
    }
  } catch {
    // A failed recovery check must never block opening the project.
  }

  state.project = project;
  state.activeMapId = project.activeMapId ?? project.maps[0].id;
  state.dictionaries = new Map();
  state.selection = null;
  state.clipboard = null;
  state.preview = null;
  clearImageCache();
  resetHistory();
  setSaveStatus('saved', { savedAt: project.updatedAt });

  await loadProjectDictionaries();
  const map = activeMap();
  const selected = firstTileId(map);
  state.selectedTileId = selected;

  emit('project', 'map', 'tiles', 'status', 'selection');
  const { width, height } = viewportSize();
  if (map && width > 0) {
    fitToScreen(map, width, height);
    state.needsFit = false;
  } else {
    // The canvas is not on screen yet (the browser overlay is showing); fit
    // as soon as it becomes visible.
    state.needsFit = true;
  }
  requestRender();
  return true;
}

function firstTileId(map) {
  const dictionary = map?.dictionaryId ? state.dictionaries.get(map.dictionaryId) : null;
  return dictionary?.tiles[0]?.id ?? map?.defaultTile ?? 0;
}

export function closeProject() {
  state.project = null;
  state.activeMapId = null;
  state.selection = null;
  state.preview = null;
  resetHistory();
  setSaveStatus('saved');
  emit('project', 'map', 'tiles', 'status');
}

/** Persist the open project. Returns true on success. */
export async function saveNow({ silent = false } = {}) {
  if (!state.project) return false;
  setSaveStatus('saving');
  try {
    state.project.activeMapId = state.activeMapId;
    const result = await api.saveProject(state.project.id, state.project);
    state.project.updatedAt = result.savedAt;
    setSaveStatus('saved', { savedAt: result.savedAt });
    await api.discardRecovery(state.project.id).catch(() => {});
    if (!silent) toastSuccess('Project saved');
    return true;
  } catch (error) {
    setSaveStatus('error');
    toastApiError('The project could not be saved', error);
    return false;
  }
}

/** Save a copy under a new name and continue editing the copy. */
export async function saveAs() {
  if (!state.project) return false;
  const result = await openForm({
    title: 'Save project as',
    submitLabel: 'Save copy',
    fields: [{ name: 'name', label: 'New project name', type: 'text', value: `${state.project.name} copy` }],
    validate: (values) => (values.name.trim() ? [] : ['Enter a name for the copy.']),
    onSubmit: async (values) => {
      // Persist current edits into the source first so the copy is complete.
      await api.saveProject(state.project.id, state.project);
      return api.duplicateProject(state.project.id, values.name.trim());
    }
  });
  if (!result) return false;
  await openProject(result.id);
  toastSuccess('Saved as a new project', result.name);
  return true;
}

/* ---------------------------------------------------------------- create - */

export async function createProjectDialog({ dictionaries = [] } = {}) {
  const settings = state.settings;
  const dictionaryOptions = [
    { value: '', label: 'None — create tiles later' },
    ...dictionaries.map((dictionary) => ({ value: dictionary.id, label: `${dictionary.name} (${dictionary.tileCount} tiles)` }))
  ];

  const created = await openForm({
    title: 'New project',
    submitLabel: 'Create project',
    intro: 'A project holds one or more maps. You can add more maps at any time.',
    fields: [
      { name: 'name', label: 'Project name', type: 'text', value: 'My RPG' },
      { name: 'mapName', label: 'First map name', type: 'text', value: 'Map 1' },
      { name: 'mapWidth', label: 'Map width (tiles)', type: 'number', value: 64, min: LIMITS.MAP_MIN, max: LIMITS.MAP_MAX, half: true },
      { name: 'mapHeight', label: 'Map height (tiles)', type: 'number', value: 64, min: LIMITS.MAP_MIN, max: LIMITS.MAP_MAX, half: true },
      { name: 'tileWidth', label: 'Tile width (pixels)', type: 'number', value: settings.defaultTileWidth, min: 1, max: LIMITS.TILE_SIZE_MAX, half: true },
      { name: 'tileHeight', label: 'Tile height (pixels)', type: 'number', value: settings.defaultTileHeight, min: 1, max: LIMITS.TILE_SIZE_MAX, half: true },
      { name: 'defaultTile', label: 'Default tile ID', type: 'number', value: 0, min: 0, hint: 'Every cell starts with this value, and the eraser resets cells to it.' },
      { name: 'dictionaryId', label: 'Tile dictionary', type: 'select', options: dictionaryOptions, value: '' }
    ],
    validate: (values) => {
      const problems = [];
      if (!values.name.trim()) problems.push('Enter a project name.');
      for (const [key, label] of [['mapWidth', 'Map width'], ['mapHeight', 'Map height'], ['tileWidth', 'Tile width'], ['tileHeight', 'Tile height']]) {
        if (!Number.isInteger(values[key]) || values[key] < 1) problems.push(`${label} must be a whole number of 1 or more.`);
      }
      if (!Number.isInteger(values.defaultTile) || values.defaultTile < 0) problems.push('The default tile ID must be a whole number of 0 or more.');
      if (Number.isInteger(values.mapWidth) && Number.isInteger(values.mapHeight) && values.mapWidth * values.mapHeight > LIMITS.MAP_MAX_CELLS) {
        problems.push(`That map would have ${(values.mapWidth * values.mapHeight).toLocaleString()} cells; the limit is ${LIMITS.MAP_MAX_CELLS.toLocaleString()}.`);
      }
      return problems;
    },
    onSubmit: (values) => api.createProject({
      ...values,
      name: values.name.trim(),
      dictionaryId: values.dictionaryId || null
    })
  });

  if (!created) return null;
  await openProject(created.id);
  toastSuccess('Project created', created.name);
  return created;
}

/* ------------------------------------------------------------ dirty guard - */

/** Ask before throwing away unsaved changes. Returns true when it is safe. */
export async function confirmDiscardIfDirty() {
  if (!state.project || !state.dirty) return true;
  const choice = await confirmDialog({
    title: 'Unsaved changes',
    message: `"${state.project.name}" has changes that have not been saved.`,
    confirmLabel: 'Save and continue',
    cancelLabel: 'Cancel',
    details: ['Choosing Cancel keeps you in the current project.']
  });
  if (!choice) return false;
  return saveNow({ silent: true });
}

/* -------------------------------------------------------------- metadata - */

export async function renameCurrentProject() {
  if (!state.project) return;
  await openForm({
    title: 'Rename project',
    submitLabel: 'Rename',
    fields: [{ name: 'name', label: 'Project name', type: 'text', value: state.project.name }],
    validate: (values) => (values.name.trim() ? [] : ['Enter a project name.']),
    onSubmit: async (values) => {
      const project = await api.renameProject(state.project.id, values.name.trim());
      state.project.name = project.name;
      emit('project');
      toastSuccess('Project renamed', project.name);
    }
  });
}

export async function deleteProjectById(id, name) {
  const confirmed = await confirmDialog({
    title: 'Delete project',
    message: `Permanently delete "${name}"?`,
    details: ['This removes the project folder and every map inside it.', 'This cannot be undone.'],
    confirmLabel: 'Delete project',
    danger: true
  });
  if (!confirmed) return false;
  try {
    await api.deleteProject(id);
    if (state.project?.id === id) closeProject();
    toastSuccess('Project deleted', name);
    return true;
  } catch (error) {
    toastApiError('The project could not be deleted', error);
    return false;
  }
}
