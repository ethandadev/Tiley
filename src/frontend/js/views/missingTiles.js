/**
 * Missing-tile resolution.
 *
 * A map may legitimately contain IDs that its dictionary does not define (after
 * an import, or after a tile was deleted). Tiley never substitutes another tile
 * for them; instead they render as an explicit placeholder and are resolved
 * deliberately here: define the tile, or rewrite those cells to another ID.
 */

import { el } from '../dom.js';
import { openModal, openForm } from '../modal.js';
import { activeMap, activeDictionary, emit } from '../store.js';
import { distinctTileIds, countTile } from '../../../shared/tilemap.js';
import * as api from '../api.js';
import { toastSuccess, toastApiError } from '../toast.js';
import { refreshDictionary } from '../projectController.js';
import { replaceTileId } from '../editorActions.js';
import { requestRender } from '../renderer.js';

/** IDs used by the map that the assigned dictionary does not define. */
export function missingTileIds() {
  const map = activeMap();
  const dictionary = activeDictionary();
  if (!map || !dictionary) return [];
  const known = new Set(dictionary.tiles.map((tile) => tile.id));
  return distinctTileIds(map.data).filter((id) => !known.has(id));
}

export function openMissingTilesDialog() {
  const map = activeMap();
  const dictionary = activeDictionary();
  if (!map || !dictionary) return;

  const body = el('div');
  const dialog = openModal({
    title: 'Missing tiles',
    wide: true,
    body,
    footer: [el('button', { class: 'button', text: 'Close', on: { click: () => dialog.close() } })]
  });

  function render() {
    const missing = missingTileIds();
    body.replaceChildren();

    if (missing.length === 0) {
      body.append(el('p', { class: 'muted', text: `Every tile ID used by "${map.name}" is defined in "${dictionary.name}".` }));
      return;
    }

    body.append(el('p', { class: 'muted', text: `These tile IDs appear on "${map.name}" but are not defined in "${dictionary.name}". Their numeric values are preserved exactly until you change them here.` }));

    const table = el('table', { class: 'list-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Tile ID' }),
        el('th', { text: 'Cells using it' }),
        el('th', { text: 'Resolve' })
      ])]),
      el('tbody', {}, missing.map((id) => el('tr', {}, [
        el('td', { text: String(id) }),
        el('td', { text: countTile(map.data, id).toLocaleString() }),
        el('td', {}, [
          el('div', { style: 'display:flex; gap:6px; flex-wrap:wrap;' }, [
            el('button', { class: 'button small', text: 'Create this tile…', on: { click: () => createMissingTile(id, render) } }),
            el('button', { class: 'button small', text: 'Point at an existing tile…', on: { click: () => reassign(id, render) } })
          ])
        ])
      ])))
    ]);
    body.append(table);
  }

  async function createMissingTile(id, refresh) {
    await openForm({
      title: `Define tile ${id}`,
      submitLabel: 'Create tile',
      intro: `This adds tile ID ${id} to "${dictionary.name}". The map data does not change.`,
      fields: [
        { name: 'name', label: 'Tile name', type: 'text', value: `Tile ${id}` },
        { name: 'tags', label: 'Tags (optional, comma separated)', type: 'text', value: '' }
      ],
      validate: (values) => (values.name.trim() ? [] : ['Enter a tile name.']),
      onSubmit: async (values) => {
        await api.addTile(dictionary.id, {
          id,
          name: values.name.trim(),
          tags: values.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        });
        await refreshDictionary(dictionary.id);
        emit('tiles');
        requestRender();
        toastSuccess('Tile created', `${id} — ${values.name.trim()}`);
      }
    }).catch((error) => toastApiError('The tile could not be created', error));
    refresh();
  }

  async function reassign(id, refresh) {
    const options = dictionary.tiles.map((tile) => ({ value: tile.id, label: `${tile.id} — ${tile.name}` }));
    if (options.length === 0) {
      toastApiError('No tiles to choose from', new Error('Add at least one tile to this dictionary first.'));
      return;
    }
    await openForm({
      title: `Replace tile ID ${id}`,
      submitLabel: 'Replace on this map',
      intro: `Every cell on "${map.name}" using ID ${id} will be changed. This can be undone.`,
      fields: [{ name: 'toId', label: 'Replace with', type: 'select', options, value: options[0].value }],
      onSubmit: (values) => {
        const changes = replaceTileId(id, Number(values.toId));
        toastSuccess('Tiles replaced', `${changes.length.toLocaleString()} cells changed from ${id} to ${values.toId}.`);
      }
    });
    refresh();
  }

  render();
}
