/**
 * Import and export.
 *
 * Exports are produced in the browser from the same shared writers the tests
 * cover, so what is downloaded is byte-for-byte what the test suite asserts.
 */

import { el, downloadFile, pickFile } from '../dom.js';
import { openForm } from '../modal.js';
import { state, activeMap, activeDictionary, emit, markDirty } from '../store.js';
import { toastSuccess, toastApiError, toastWarning } from '../toast.js';
import { toTXT, toCSV, toCSVWithHeader, toJSON, projectToJSON, extensionFor } from '../../../shared/exporters.js';
import { parseDelimitedMap, parseJSONSafely, extractGridFromJSON, findMissingTileIds } from '../../../shared/importers.js';
import { cloneGrid } from '../../../shared/tilemap.js';
import { renderToCanvas, requestRender } from '../renderer.js';
import { pushHistory } from '../history.js';
import * as api from '../api.js';
import { openProject } from '../projectController.js';

const safeName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';

/* -------------------------------------------------------------- exports --- */

export async function exportDialog() {
  const map = activeMap();
  if (!map) return;

  await openForm({
    title: 'Export',
    submitLabel: 'Export',
    intro: 'TXT and CSV contain only the numeric tilemap — no headers, brackets or metadata.',
    fields: [
      {
        name: 'format',
        label: 'Format',
        type: 'select',
        value: state.settings.defaultExportFormat ?? 'txt',
        options: [
          { value: 'txt', label: 'Text (.txt) — "0, 0, 1" rows' },
          { value: 'csv', label: 'CSV (.csv) — "0,0,1" rows' },
          { value: 'csv-header', label: 'CSV with a column header row' },
          { value: 'json', label: 'JSON — this map, its tile dictionary and metadata' },
          { value: 'project-json', label: 'JSON — the whole project (every map)' },
          { value: 'png', label: 'PNG image — the map rendered with its tile images' }
        ]
      },
      {
        name: 'scope',
        label: 'What to export',
        type: 'select',
        value: 'active',
        options: [
          { value: 'active', label: `This map only (${map.name})` },
          { value: 'all', label: `Every map in the project (${state.project.maps.length})` }
        ],
        hint: 'Exporting every map downloads one file per map, except for whole-project JSON.'
      }
    ],
    onSubmit: async (values) => {
      const maps = values.scope === 'all' ? state.project.maps : [map];
      if (values.format === 'project-json') {
        const dictionaries = [...state.dictionaries.values()];
        downloadFile(`${safeName(state.project.name)}.tiley.json`, projectToJSON(state.project, dictionaries), 'application/json');
        toastSuccess('Project exported');
        return;
      }
      for (const target of maps) {
        await exportOneMap(target, values.format);
      }
      toastSuccess(maps.length === 1 ? 'Map exported' : `${maps.length} maps exported`);
    }
  });
}

async function exportOneMap(map, format) {
  const dictionary = map.dictionaryId ? state.dictionaries.get(map.dictionaryId) ?? null : null;
  const base = `${safeName(state.project.name)}-${safeName(map.name)}`;
  const filename = `${base}.${extensionFor(format)}`;

  if (format === 'txt') return downloadFile(filename, toTXT(map.data), 'text/plain');
  if (format === 'csv') return downloadFile(filename, toCSV(map.data), 'text/csv');
  if (format === 'csv-header') return downloadFile(filename, toCSVWithHeader(map.data), 'text/csv');
  if (format === 'json') return downloadFile(filename, toJSON(state.project, map, dictionary), 'application/json');

  if (format === 'png') {
    const canvas = renderToCanvas(map, dictionary);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      toastApiError('The image could not be created', new Error('The browser refused to encode the PNG. Try a smaller map.'));
      return;
    }
    downloadFile(filename, blob, 'image/png');
  }
}

/** Quick export using the configured default format, no dialog. */
export async function quickExport() {
  const map = activeMap();
  if (!map) return;
  await exportOneMap(map, state.settings.defaultExportFormat ?? 'txt');
  toastSuccess('Map exported', `${map.name} (${(state.settings.defaultExportFormat ?? 'txt').toUpperCase()})`);
}

/* -------------------------------------------------------------- imports --- */

/**
 * Import numeric map data into the active map.
 * Dimension mismatches are reported precisely and can be accepted by resizing.
 */
export async function importMapDialog() {
  const map = activeMap();
  if (!map) return;

  const file = await pickFile({ accept: '.txt,.csv,.json,text/plain,text/csv,application/json' });
  if (!file) return;

  const text = await file.text();
  const isJSON = file.name.toLowerCase().endsWith('.json');
  const parsed = isJSON ? parseJSONFile(text) : parseDelimitedMap(text);

  if (!parsed.ok) {
    toastApiError('That file could not be imported', { message: `${file.name} could not be read.`, problems: parsed.errors });
    return;
  }

  const grid = parsed.grid;
  const width = grid[0].length;
  const height = grid.length;
  const sizeMatches = width === map.width && height === map.height;
  const dictionary = activeDictionary();
  const missing = dictionary ? findMissingTileIds(grid, dictionary) : [];

  await openForm({
    title: 'Import tilemap',
    submitLabel: 'Import into this map',
    intro: `${file.name} contains a ${width} × ${height} map.`,
    fields: [
      {
        type: 'custom',
        name: 'summary',
        render: () => el('div', { class: sizeMatches ? 'notice' : 'notice warning' }, [
          el('div', { text: sizeMatches
            ? `The size matches "${map.name}" exactly.`
            : `"${map.name}" is ${map.width} × ${map.height}. Importing will resize it to ${width} × ${height}.` }),
          missing.length > 0
            ? el('div', { style: 'margin-top:8px' }, [
                `${missing.length} tile ID(s) in this file are not defined in "${dictionary.name}": ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}. `,
                'They will be imported unchanged and shown as missing tiles.'
              ])
            : null
        ])
      },
      { name: 'confirm', label: 'Replace the current tile data of this map', type: 'checkbox', value: true, hint: 'This can be undone with Undo.' }
    ],
    validate: (values) => (values.confirm ? [] : ['Tick the box to confirm replacing the current map data.']),
    onSubmit: () => {
      const before = { width: map.width, height: map.height, data: cloneGrid(map.data) };
      map.data = grid;
      map.width = width;
      map.height = height;
      pushHistory({
        kind: 'resize',
        mapId: map.id,
        before,
        after: { width, height, data: cloneGrid(grid) },
        label: 'Import map'
      });
      markDirty();
      emit('map', 'project', 'tiles');
      requestRender();
      if (missing.length > 0) {
        toastWarning('Map imported', `${missing.length} tile ID(s) are not defined in the current dictionary.`, missing.slice(0, 10).map(String));
      } else {
        toastSuccess('Map imported', `${width} × ${height} tiles from ${file.name}`);
      }
    }
  });
}

function parseJSONFile(text) {
  const parsed = parseJSONSafely(text);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return extractGridFromJSON(parsed.value);
}

/** Import a whole project document exported by Tiley. */
export async function importProjectFlow() {
  const file = await pickFile({ accept: '.json,application/json' });
  if (!file) return;
  const parsed = parseJSONSafely(await file.text());
  if (!parsed.ok) {
    toastApiError('That file could not be imported', { message: `${file.name} is not valid JSON.`, problems: parsed.errors });
    return;
  }
  try {
    const project = await api.importProject(parsed.value);
    toastSuccess('Project imported', project.name);
    await openProject(project.id);
  } catch (error) {
    toastApiError('The project could not be imported', error);
  }
}
