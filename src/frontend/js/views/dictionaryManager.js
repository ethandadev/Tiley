/**
 * Tile dictionary manager: create, rename, duplicate, delete, import, export
 * and assign dictionaries.
 */

import { el, downloadFile, pickFile, formatWhen } from '../dom.js';
import { openModal, openForm, confirmDialog } from '../modal.js';
import * as api from '../api.js';
import { state, emit, activeMap } from '../store.js';
import { toastSuccess, toastApiError, toastWarning } from '../toast.js';
import { loadProjectDictionaries, refreshDictionary } from '../projectController.js';
import { parseJSONSafely } from '../../../shared/importers.js';
import { dictionaryToJSON } from '../../../shared/exporters.js';
import { requestRender } from '../renderer.js';
import { markDirty } from '../store.js';

/** Refresh the cached list of dictionary summaries used across the UI. */
export async function reloadDictionarySummaries() {
  try {
    state.dictionarySummaries = await api.listDictionaries();
    emit('tiles');
  } catch (error) {
    toastApiError('Tile dictionaries could not be listed', error);
  }
}

export function openDictionaryManager() {
  const body = el('div');
  const dialog = openModal({
    title: 'Tile dictionaries',
    wide: true,
    body,
    footer: [
      el('button', { class: 'button', text: 'Import dictionary…', on: { click: () => importFlow(render) } }),
      el('button', { class: 'button primary', text: 'New dictionary…', on: { click: () => createFlow(render) } }),
      el('button', { class: 'button', text: 'Close', on: { click: () => dialog.close() } })
    ]
  });

  async function render() {
    body.replaceChildren(el('p', { class: 'muted', text: 'Loading…' }));
    await reloadDictionarySummaries();
    const map = activeMap();
    body.replaceChildren();

    body.append(el('p', { class: 'muted', text: 'Dictionaries are shared across projects. Each map points at one dictionary.' }));

    if (state.dictionarySummaries.length === 0) {
      body.append(el('div', { class: 'empty-state' }, [
        el('strong', { text: 'No tile dictionaries yet' }),
        'Create one to start defining the tiles your maps use.'
      ]));
      return;
    }

    const table = el('table', { class: 'list-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Name' }),
        el('th', { text: 'Tiles' }),
        el('th', { text: 'Updated' }),
        el('th', { text: 'Actions' })
      ])]),
      el('tbody', {}, state.dictionarySummaries.map((summary) => el('tr', {}, [
        el('td', {}, [
          el('div', { text: summary.name }),
          summary.damaged ? el('span', { class: 'badge warn', text: 'Damaged file' }) : null,
          map?.dictionaryId === summary.id ? el('span', { class: 'badge info', text: 'Used by this map' }) : null
        ]),
        el('td', { text: String(summary.tileCount) }),
        el('td', { text: formatWhen(summary.updatedAt) }),
        el('td', {}, [
          el('div', { style: 'display:flex; gap:4px; flex-wrap:wrap;' }, [
            el('button', { class: 'button small', text: 'Assign to map', disabled: !map || map.dictionaryId === summary.id, on: { click: () => assign(summary.id, render) } }),
            el('button', { class: 'button small', text: 'Rename', on: { click: () => renameFlow(summary, render) } }),
            el('button', { class: 'button small', text: 'Duplicate', on: { click: () => duplicateFlow(summary, render) } }),
            el('button', { class: 'button small', text: 'Export', on: { click: () => exportFlow(summary) } }),
            el('button', { class: 'button small danger', text: 'Delete', on: { click: () => deleteFlow(summary, render) } })
          ])
        ])
      ])))
    ]);
    body.append(table);
  }

  render();
}

async function assign(dictionaryId, refresh) {
  const map = activeMap();
  if (!map) return;
  map.dictionaryId = dictionaryId;
  markDirty();
  await loadProjectDictionaries();
  await refreshDictionary(dictionaryId);
  emit('tiles', 'map', 'project');
  requestRender();
  toastSuccess('Dictionary assigned', `"${map.name}" now uses this dictionary.`);
  refresh();
}

async function createFlow(refresh) {
  const created = await openForm({
    title: 'New tile dictionary',
    submitLabel: 'Create dictionary',
    fields: [
      { name: 'name', label: 'Dictionary name', type: 'text', value: 'Overworld Tiles' },
      { name: 'description', label: 'Description (optional)', type: 'textarea', rows: 2, value: '' },
      { name: 'assign', label: 'Assign it to the current map', type: 'checkbox', value: true }
    ],
    validate: (values) => (values.name.trim() ? [] : ['Enter a dictionary name.']),
    onSubmit: (values) => api.createDictionary({ name: values.name.trim(), description: values.description })
      .then((dictionary) => ({ dictionary, assign: values.assign }))
  });
  if (!created) return;
  state.dictionaries.set(created.dictionary.id, created.dictionary);
  toastSuccess('Dictionary created', created.dictionary.name);
  if (created.assign) await assign(created.dictionary.id, () => {});
  refresh();
}

async function renameFlow(summary, refresh) {
  await openForm({
    title: 'Rename dictionary',
    submitLabel: 'Rename',
    fields: [{ name: 'name', label: 'Dictionary name', type: 'text', value: summary.name }],
    validate: (values) => (values.name.trim() ? [] : ['Enter a dictionary name.']),
    onSubmit: async (values) => {
      const dictionary = await api.renameDictionary(summary.id, values.name.trim());
      if (state.dictionaries.has(dictionary.id)) state.dictionaries.set(dictionary.id, dictionary);
      toastSuccess('Dictionary renamed', dictionary.name);
    }
  });
  emit('tiles');
  refresh();
}

async function duplicateFlow(summary, refresh) {
  await openForm({
    title: 'Duplicate dictionary',
    submitLabel: 'Duplicate',
    fields: [{ name: 'name', label: 'Name for the copy', type: 'text', value: `${summary.name} copy` }],
    validate: (values) => (values.name.trim() ? [] : ['Enter a name for the copy.']),
    onSubmit: async (values) => {
      const dictionary = await api.duplicateDictionary(summary.id, values.name.trim());
      toastSuccess('Dictionary duplicated', dictionary.name);
    }
  });
  refresh();
}

async function deleteFlow(summary, refresh) {
  const usedByOpenProject = (state.project?.maps ?? []).filter((map) => map.dictionaryId === summary.id);
  const confirmed = await confirmDialog({
    title: 'Delete tile dictionary',
    message: `Permanently delete "${summary.name}"?`,
    details: [
      usedByOpenProject.length > 0
        ? `${usedByOpenProject.length} map(s) in the open project use it; their tiles will show as missing.`
        : 'No map in the open project uses it.',
      'Map data is never changed by deleting a dictionary.',
      'This cannot be undone.'
    ],
    confirmLabel: 'Delete dictionary',
    danger: true
  });
  if (!confirmed) return;

  try {
    await api.deleteDictionary(summary.id);
    state.dictionaries.delete(summary.id);
    emit('tiles');
    requestRender();
    toastSuccess('Dictionary deleted', summary.name);
  } catch (error) {
    toastApiError('The dictionary could not be deleted', error);
  }
  refresh();
}

async function exportFlow(summary) {
  try {
    const dictionary = await api.getDictionary(summary.id);
    const filename = `${dictionary.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dictionary'}.json`;
    downloadFile(filename, dictionaryToJSON(dictionary), 'application/json');
    toastSuccess('Dictionary exported', filename);
  } catch (error) {
    toastApiError('The dictionary could not be exported', error);
  }
}

async function importFlow(refresh) {
  const file = await pickFile({ accept: 'application/json,.json' });
  if (!file) return;
  const parsed = parseJSONSafely(await file.text());
  if (!parsed.ok) {
    toastApiError('That file could not be imported', { message: parsed.errors[0], problems: parsed.errors });
    return;
  }
  try {
    const dictionary = await api.importDictionary(parsed.value);
    if (dictionary.warnings?.length) {
      toastWarning('Dictionary imported with warnings', dictionary.name, dictionary.warnings);
    } else {
      toastSuccess('Dictionary imported', `${dictionary.name} (${dictionary.tiles.length} tiles)`);
    }
  } catch (error) {
    toastApiError('The dictionary could not be imported', error);
  }
  refresh();
}
