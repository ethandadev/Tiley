/**
 * Map-level dialogs: add a map and resize a map.
 *
 * Resizing is the one destructive geometry change, so the dialog computes the
 * exact number of non-default cells that would be discarded for the chosen
 * anchor and refuses to proceed silently.
 */

import { el } from '../dom.js';
import { openForm, confirmDialog } from '../modal.js';
import { state, activeMap, emit, markDirty } from '../store.js';
import { createMap } from '../../../shared/schema.js';
import { ANCHORS, LIMITS } from '../../../shared/constants.js';
import { previewResize, resizeActiveMap } from '../editorActions.js';
import { toastSuccess } from '../toast.js';
import { requestRender, viewportSize } from '../renderer.js';
import { fitToScreen } from '../viewport.js';

const ANCHOR_LABELS = {
  'top-left': 'Top left', 'top-center': 'Top centre', 'top-right': 'Top right',
  'middle-left': 'Middle left', 'center': 'Centre', 'middle-right': 'Middle right',
  'bottom-left': 'Bottom left', 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right'
};

/** Generate a map id on the client; the server validates it on save. */
function newMapId() {
  const random = crypto.getRandomValues(new Uint8Array(8));
  return `map-${[...random].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function addMapDialog() {
  if (!state.project) return null;
  const template = activeMap();
  const dictionaryOptions = [
    { value: '', label: 'None assigned' },
    ...state.dictionarySummaries.map((summary) => ({ value: summary.id, label: `${summary.name} (${summary.tileCount})` }))
  ];

  const created = await openForm({
    title: 'New map',
    submitLabel: 'Add map',
    intro: 'Each map has its own size, tile size and tile dictionary.',
    fields: [
      { name: 'name', label: 'Map name', type: 'text', value: `Map ${state.project.maps.length + 1}` },
      { name: 'width', label: 'Width (tiles)', type: 'number', value: template?.width ?? 64, min: 1, max: LIMITS.MAP_MAX, half: true },
      { name: 'height', label: 'Height (tiles)', type: 'number', value: template?.height ?? 64, min: 1, max: LIMITS.MAP_MAX, half: true },
      { name: 'tileWidth', label: 'Tile width (px)', type: 'number', value: template?.tileWidth ?? state.settings.defaultTileWidth, min: 1, half: true },
      { name: 'tileHeight', label: 'Tile height (px)', type: 'number', value: template?.tileHeight ?? state.settings.defaultTileHeight, min: 1, half: true },
      { name: 'defaultTile', label: 'Default tile ID', type: 'number', value: template?.defaultTile ?? 0, min: 0 },
      { name: 'dictionaryId', label: 'Tile dictionary', type: 'select', options: dictionaryOptions, value: template?.dictionaryId ?? '' }
    ],
    validate: (values) => {
      const problems = [];
      if (!values.name.trim()) problems.push('Enter a map name.');
      for (const [key, label] of [['width', 'Width'], ['height', 'Height'], ['tileWidth', 'Tile width'], ['tileHeight', 'Tile height']]) {
        if (!Number.isInteger(values[key]) || values[key] < 1) problems.push(`${label} must be a whole number of 1 or more.`);
      }
      if (!Number.isInteger(values.defaultTile) || values.defaultTile < 0) problems.push('The default tile ID must be a whole number of 0 or more.');
      if (values.width * values.height > LIMITS.MAP_MAX_CELLS) {
        problems.push(`That map would have ${(values.width * values.height).toLocaleString()} cells; the limit is ${LIMITS.MAP_MAX_CELLS.toLocaleString()}.`);
      }
      return problems;
    },
    onSubmit: (values) => createMap({
      id: newMapId(),
      name: values.name.trim(),
      width: values.width,
      height: values.height,
      tileWidth: values.tileWidth,
      tileHeight: values.tileHeight,
      defaultTile: values.defaultTile,
      dictionaryId: values.dictionaryId || null
    })
  });

  if (!created) return null;
  state.project.maps.push(created);
  state.activeMapId = created.id;
  markDirty();
  emit('project', 'map', 'tiles');

  const { width, height } = viewportSize();
  fitToScreen(created, width, height);
  requestRender();
  toastSuccess('Map added', created.name);
  return created;
}

export async function resizeMapDialog() {
  const map = activeMap();
  if (!map) return;

  // The anchor picker is a live 3x3 control, so the warning updates as it moves.
  let anchor = 'top-left';
  const warning = el('div', { class: 'notice', text: '' });

  const anchorGrid = el('div', { class: 'anchor-picker', attrs: { role: 'group', 'aria-label': 'Anchor existing content' } });
  const cells = new Map();
  for (const value of ANCHORS) {
    const cell = el('button', {
      type: 'button',
      class: 'anchor-cell',
      attrs: { 'aria-pressed': String(value === anchor), title: ANCHOR_LABELS[value], 'aria-label': ANCHOR_LABELS[value] },
      on: {
        click: () => {
          anchor = value;
          for (const [key, node] of cells) node.setAttribute('aria-pressed', String(key === value));
          updateWarning();
        }
      }
    });
    cells.set(value, cell);
    anchorGrid.append(cell);
  }

  let currentValues = { width: map.width, height: map.height };
  function updateWarning() {
    const { width, height } = currentValues;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      warning.className = 'notice warning';
      warning.textContent = 'Enter whole numbers of 1 or more.';
      return;
    }
    const { removedCells, removedNonDefault } = previewResize(map, width, height, anchor);
    if (removedCells === 0) {
      warning.className = 'notice';
      warning.textContent = `Anchor: ${ANCHOR_LABELS[anchor]}. No existing cells will be removed.`;
    } else {
      warning.className = 'notice warning';
      warning.textContent =
        `Anchor: ${ANCHOR_LABELS[anchor]}. ${removedCells.toLocaleString()} cells fall outside the new size and will be removed` +
        (removedNonDefault > 0 ? `, including ${removedNonDefault.toLocaleString()} that are not the default tile.` : '.');
    }
  }

  // openForm builds its DOM synchronously, so the live handlers can be attached
  // immediately after the call and before awaiting the user's answer.
  const formPromise = openForm({
    title: `Resize "${map.name}"`,
    submitLabel: 'Resize map',
    intro: `Current size: ${map.width} × ${map.height} tiles.`,
    fields: [
      { name: 'width', label: 'New width (tiles)', type: 'number', value: map.width, min: 1, max: LIMITS.MAP_MAX, half: true },
      { name: 'height', label: 'New height (tiles)', type: 'number', value: map.height, min: 1, max: LIMITS.MAP_MAX, half: true },
      {
        type: 'custom',
        name: 'anchor',
        render: () => el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Anchor existing content' }),
          anchorGrid,
          el('span', { class: 'field-hint', text: 'The highlighted corner or edge stays fixed while the map grows or shrinks.' })
        ])
      },
      { type: 'custom', name: 'warning', render: () => warning }
    ],
    validate: (values) => {
      const problems = [];
      if (!Number.isInteger(values.width) || values.width < 1) problems.push('Width must be a whole number of 1 or more.');
      if (!Number.isInteger(values.height) || values.height < 1) problems.push('Height must be a whole number of 1 or more.');
      if (values.width * values.height > LIMITS.MAP_MAX_CELLS) {
        problems.push(`That size has ${(values.width * values.height).toLocaleString()} cells; the limit is ${LIMITS.MAP_MAX_CELLS.toLocaleString()}.`);
      }
      return problems;
    },
    onSubmit: async (values) => {
      const { removedCells, removedNonDefault } = previewResize(map, values.width, values.height, anchor);
      if (removedCells > 0 && state.settings.confirmDestructive) {
        const confirmed = await confirmDialog({
          title: 'Resize will remove cells',
          message: `Resizing "${map.name}" to ${values.width} × ${values.height} discards ${removedCells.toLocaleString()} cells.`,
          details: [
            removedNonDefault > 0
              ? `${removedNonDefault.toLocaleString()} of them contain tiles other than the default.`
              : 'All of them contain the default tile.',
            'This can be undone with Undo.'
          ],
          confirmLabel: 'Resize anyway',
          danger: true
        });
        if (!confirmed) throw new Error('The map size was left unchanged.');
      }
      resizeActiveMap(values.width, values.height, anchor);
      toastSuccess('Map resized', `${values.width} × ${values.height}`);
    }
  });

  // Keep the live warning in sync with the number inputs while the form is open.
  function attachLiveUpdates() {
    const form = document.querySelector('.modal-form');
    if (!form) return;
    for (const name of ['width', 'height']) {
      form.querySelector(`[name="${name}"]`)?.addEventListener('input', (event) => {
        currentValues = { ...currentValues, [name]: Number(event.target.value) };
        updateWarning();
      });
    }
    updateWarning();
  }
  attachLiveUpdates();
  await formPromise;
}
