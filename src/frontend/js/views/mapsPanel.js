/**
 * Left panel: the list of maps in the project and the settings of the active
 * map. Maps are reordered, renamed, duplicated and deleted from here.
 */

import { $, el, clear, formatNumber } from '../dom.js';
import { state, on, emit, activeMap, markDirty } from '../store.js';
import { openForm, confirmDialog } from '../modal.js';
import { openContextMenu } from './contextMenu.js';
import { addMapDialog, resizeMapDialog } from './mapDialogs.js';
import { toastSuccess } from '../toast.js';
import { forgetMap } from '../history.js';
import { requestRender, viewportSize } from '../renderer.js';
import { fitToScreen } from '../viewport.js';
import { loadProjectDictionaries } from '../projectController.js';
import { LIMITS } from '../../../shared/constants.js';

export function initMapsPanel() {
  const list = $('#map-list');
  const settings = $('#map-settings');

  $('#add-map-button').addEventListener('click', () => addMapDialog());

  async function switchTo(mapId) {
    if (state.activeMapId === mapId) return;
    state.activeMapId = mapId;
    state.selection = null;
    state.preview = null;
    emit('project', 'map', 'tiles', 'selection');
    await loadProjectDictionaries();
    const map = activeMap();
    const { width, height } = viewportSize();
    if (map) fitToScreen(map, width, height);
    requestRender();
  }

  function renderList() {
    clear(list);
    if (!state.project) return;

    state.project.maps.forEach((map, index) => {
      const item = el('li', {}, [
        el('button', {
          type: 'button',
          class: 'map-item',
          attrs: {
            'aria-current': String(map.id === state.activeMapId),
            title: `${map.name} — ${map.width} × ${map.height} tiles`
          },
          on: {
            click: () => switchTo(map.id),
            contextmenu: (event) => {
              event.preventDefault();
              showMapMenu(event, map, index);
            }
          }
        }, [
          el('span', { text: map.name }),
          el('span', { class: 'map-dimensions', text: `${map.width}×${map.height}` })
        ])
      ]);
      list.append(item);
    });
  }

  function showMapMenu(event, map, index) {
    const maps = state.project.maps;
    openContextMenu(event, [
      { label: 'Switch to this map', disabled: map.id === state.activeMapId, onSelect: () => switchTo(map.id) },
      { label: 'Rename map…', onSelect: () => renameMap(map) },
      { label: 'Duplicate map', onSelect: () => duplicateMap(map) },
      { separator: true },
      { label: 'Move up', disabled: index === 0, onSelect: () => moveMap(index, index - 1) },
      { label: 'Move down', disabled: index === maps.length - 1, onSelect: () => moveMap(index, index + 1) },
      { separator: true },
      { label: 'Delete map…', danger: true, disabled: maps.length <= 1, onSelect: () => deleteMap(map) }
    ]);
  }

  async function renameMap(map) {
    await openForm({
      title: 'Rename map',
      submitLabel: 'Rename',
      fields: [{ name: 'name', label: 'Map name', type: 'text', value: map.name }],
      validate: (values) => (values.name.trim() ? [] : ['Enter a map name.']),
      onSubmit: (values) => {
        map.name = values.name.trim();
        markDirty();
        emit('project', 'status');
      }
    });
    renderAll();
  }

  function duplicateMap(map) {
    const random = crypto.getRandomValues(new Uint8Array(8));
    const copy = structuredClone(map);
    copy.id = `map-${[...random].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    copy.name = `${map.name} copy`;
    state.project.maps.splice(state.project.maps.indexOf(map) + 1, 0, copy);
    markDirty();
    emit('project');
    renderAll();
    toastSuccess('Map duplicated', copy.name);
  }

  function moveMap(from, to) {
    const maps = state.project.maps;
    const [moved] = maps.splice(from, 1);
    maps.splice(to, 0, moved);
    markDirty();
    emit('project');
    renderAll();
  }

  async function deleteMap(map) {
    const confirmed = await confirmDialog({
      title: 'Delete map',
      message: `Delete "${map.name}" from this project?`,
      details: [`${formatNumber(map.width * map.height)} cells of tile data will be removed.`, 'This cannot be undone with Undo.'],
      confirmLabel: 'Delete map',
      danger: true
    });
    if (!confirmed) return;

    const maps = state.project.maps;
    maps.splice(maps.indexOf(map), 1);
    forgetMap(map.id);
    if (state.activeMapId === map.id) {
      state.activeMapId = maps[0].id;
      state.selection = null;
    }
    markDirty();
    emit('project', 'map', 'tiles');
    requestRender();
    renderAll();
    toastSuccess('Map deleted', map.name);
  }

  /* ------------------------------------------------------- map settings -- */

  function renderSettings() {
    clear(settings);
    const map = activeMap();
    if (!map) {
      settings.append(el('p', { class: 'muted', text: 'No map open.' }));
      return;
    }

    settings.append(
      readOnlyRow('Size', `${map.width} × ${map.height} tiles`),
      readOnlyRow('Cells', formatNumber(map.width * map.height)),
      readOnlyRow('Tile size', `${map.tileWidth} × ${map.tileHeight} px`),
      readOnlyRow('Default tile', String(map.defaultTile)),
      el('div', { style: 'display:flex; gap:6px; flex-wrap:wrap;' }, [
        el('button', { class: 'button small', text: 'Resize map…', on: { click: () => resizeMapDialog() } }),
        el('button', { class: 'button small', text: 'Map properties…', on: { click: () => editMapProperties(map) } })
      ])
    );
  }

  const readOnlyRow = (label, value) => el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    el('strong', { text: value })
  ]);

  async function editMapProperties(map) {
    await openForm({
      title: `Properties of "${map.name}"`,
      submitLabel: 'Save properties',
      intro: 'Tile size affects how the map is drawn and exported as an image. It does not change any tile values.',
      fields: [
        { name: 'name', label: 'Map name', type: 'text', value: map.name },
        { name: 'tileWidth', label: 'Tile width (px)', type: 'number', value: map.tileWidth, min: 1, max: LIMITS.TILE_SIZE_MAX, half: true },
        { name: 'tileHeight', label: 'Tile height (px)', type: 'number', value: map.tileHeight, min: 1, max: LIMITS.TILE_SIZE_MAX, half: true },
        { name: 'defaultTile', label: 'Default tile ID', type: 'number', value: map.defaultTile, min: 0, hint: 'Used by the eraser and by new cells added when the map grows.' }
      ],
      validate: (values) => {
        const problems = [];
        if (!values.name.trim()) problems.push('Enter a map name.');
        if (!Number.isInteger(values.tileWidth) || values.tileWidth < 1) problems.push('Tile width must be a whole number of 1 or more.');
        if (!Number.isInteger(values.tileHeight) || values.tileHeight < 1) problems.push('Tile height must be a whole number of 1 or more.');
        if (!Number.isInteger(values.defaultTile) || values.defaultTile < 0) problems.push('The default tile ID must be a whole number of 0 or more.');
        return problems;
      },
      onSubmit: (values) => {
        map.name = values.name.trim();
        map.tileWidth = values.tileWidth;
        map.tileHeight = values.tileHeight;
        map.defaultTile = values.defaultTile;
        markDirty();
        emit('project', 'map');
        requestRender();
      }
    });
    renderAll();
  }

  function renderAll() {
    renderList();
    renderSettings();
  }

  on('project', renderAll);
  on('tiles', renderSettings);
  renderAll();
}
