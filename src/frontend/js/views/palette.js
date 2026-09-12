/**
 * Tile palette: dictionary chooser, search, tag filters, sorting and the
 * selectable tile grid.
 */

import { $, el, clear } from '../dom.js';
import { state, on, emit, activeMap, activeDictionary, setSelectedTile } from '../store.js';
import { tileImageUrl } from '../tileImages.js';
import * as api from '../api.js';
import { toastInfo } from '../toast.js';
import { loadProjectDictionaries } from '../projectController.js';
import { createTileDialog, editTileDialog, duplicateTileDialog, deleteTileDialog, replaceTileIdDialog } from './tileEditor.js';
import { openContextMenu } from './contextMenu.js';
import { openDictionaryManager } from './dictionaryManager.js';
import { openMissingTilesDialog } from './missingTiles.js';
import { countTile, distinctTileIds } from '../../../shared/tilemap.js';
import { requestRender } from '../renderer.js';
import { markDirty } from '../store.js';

export function initPalette() {
  const grid = $('#palette-grid');
  const search = $('#tile-search');
  const sort = $('#tile-sort');
  const tagFilter = $('#tag-filter');
  const dictionarySelect = $('#dictionary-select');
  const thumbSize = $('#thumb-size');
  const thumbValue = $('#thumb-size-value');
  const missingButton = $('#missing-tiles-button');

  search.addEventListener('input', () => {
    state.paletteQuery = search.value.trim().toLowerCase();
    renderGrid();
  });
  sort.addEventListener('change', () => {
    state.paletteSort = sort.value;
    renderGrid();
  });
  thumbSize.addEventListener('input', () => {
    const size = Number(thumbSize.value);
    thumbValue.textContent = String(size);
    grid.style.setProperty('--thumb-size', `${size}px`);
  });
  thumbSize.addEventListener('change', async () => {
    state.settings.paletteThumbnailSize = Number(thumbSize.value);
    try {
      await api.updateSettings({ paletteThumbnailSize: state.settings.paletteThumbnailSize });
    } catch {
      // A failed settings save is not worth interrupting editing for.
    }
  });

  $('#add-tile-button').addEventListener('click', async () => {
    const dictionary = activeDictionary();
    if (!dictionary) {
      toastInfo('No tile dictionary assigned', 'Assign or create a dictionary for this map first.');
      openDictionaryManager();
      return;
    }
    await createTileDialog(dictionary);
    renderAll();
  });

  $('#manage-dictionaries-button').addEventListener('click', () => openDictionaryManager());
  missingButton.addEventListener('click', () => openMissingTilesDialog());

  dictionarySelect.addEventListener('change', async () => {
    const map = activeMap();
    if (!map) return;
    const value = dictionarySelect.value || null;
    map.dictionaryId = value;
    markDirty();
    await loadProjectDictionaries();
    emit('tiles', 'map', 'project');
    requestRender();
    renderAll();
  });

  /* ------------------------------------------------------------- rendering */

  function renderDictionarySelect() {
    const map = activeMap();
    clear(dictionarySelect);
    dictionarySelect.append(el('option', { value: '', text: 'None assigned' }));
    for (const summary of state.dictionarySummaries) {
      // Prefer the loaded document's count: the cached summary can lag behind
      // tiles added during this session.
      const loaded = state.dictionaries.get(summary.id);
      const tileCount = loaded ? loaded.tiles.length : summary.tileCount;
      dictionarySelect.append(el('option', {
        value: summary.id,
        text: `${summary.name} (${tileCount} tiles)`,
        selected: map?.dictionaryId === summary.id
      }));
    }
    dictionarySelect.disabled = !map;
  }

  function renderTagFilter() {
    const dictionary = activeDictionary();
    clear(tagFilter);
    const tags = new Set();
    for (const tile of dictionary?.tiles ?? []) for (const tag of tile.tags ?? []) tags.add(tag);
    if (tags.size === 0) return;

    for (const tag of [...tags].sort()) {
      tagFilter.append(el('button', {
        type: 'button',
        class: 'tag-chip',
        text: tag,
        attrs: { 'aria-pressed': String(state.paletteTags.has(tag)), title: `Only show tiles tagged "${tag}"` },
        on: {
          click: () => {
            if (state.paletteTags.has(tag)) state.paletteTags.delete(tag);
            else state.paletteTags.add(tag);
            renderTagFilter();
            renderGrid();
          }
        }
      }));
    }
  }

  function visibleTiles() {
    const dictionary = activeDictionary();
    let tiles = [...(dictionary?.tiles ?? [])];

    if (state.paletteQuery) {
      const query = state.paletteQuery;
      tiles = tiles.filter((tile) =>
        tile.name.toLowerCase().includes(query) ||
        String(tile.id) === query ||
        String(tile.id).startsWith(query) ||
        (tile.tags ?? []).some((tag) => tag.includes(query)) ||
        (tile.description ?? '').toLowerCase().includes(query));
    }
    if (state.paletteTags.size > 0) {
      tiles = tiles.filter((tile) => [...state.paletteTags].every((tag) => (tile.tags ?? []).includes(tag)));
    }

    const [key, direction] = state.paletteSort.split('-');
    tiles.sort((a, b) => {
      const result = key === 'id' ? a.id - b.id : a.name.localeCompare(b.name);
      return direction === 'desc' ? -result : result;
    });
    return tiles;
  }

  function renderGrid() {
    const dictionary = activeDictionary();
    const map = activeMap();
    clear(grid);

    if (!map) {
      grid.append(el('p', { class: 'muted', text: 'Open a project to see its tiles.' }));
      return;
    }
    if (!dictionary) {
      grid.append(el('div', { class: 'empty-state' }, [
        el('strong', { text: 'No tile dictionary' }),
        'Assign one above, or create a dictionary to start defining tiles.'
      ]));
      return;
    }

    const tiles = visibleTiles();
    if (tiles.length === 0) {
      grid.append(el('p', { class: 'muted', text: dictionary.tiles.length === 0 ? 'This dictionary has no tiles yet.' : 'No tiles match your search.' }));
      return;
    }

    for (const tile of tiles) {
      const url = tileImageUrl(tile);
      const node = el('div', {
        class: 'palette-tile',
        attrs: {
          role: 'option',
          tabindex: '0',
          'aria-selected': String(state.selectedTileId === tile.id),
          title: `${tile.name} (ID ${tile.id})${tile.description ? ` — ${tile.description}` : ''}\nClick to select, double-click to edit, right-click for options`
        },
        on: {
          click: () => setSelectedTile(tile.id),
          dblclick: async () => { await editTileDialog(dictionary, tile); renderAll(); },
          keydown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSelectedTile(tile.id);
            }
          },
          contextmenu: (event) => {
            event.preventDefault();
            setSelectedTile(tile.id);
            showTileMenu(event, dictionary, tile);
          }
        }
      }, [
        el('div', {
          class: 'tile-thumb',
          style: url ? `background-image:url("${url}")` : '',
          text: url ? '' : String(tile.id)
        }),
        el('span', { class: 'tile-name', text: tile.name }),
        el('span', { class: 'tile-id', text: `ID: ${tile.id}` })
      ]);
      grid.append(node);
    }
  }

  function showTileMenu(event, dictionary, tile) {
    openContextMenu(event, [
      { label: 'Edit tile…', onSelect: async () => { await editTileDialog(dictionary, tile); renderAll(); } },
      { label: 'Duplicate tile…', onSelect: async () => { await duplicateTileDialog(dictionary, tile); renderAll(); } },
      { label: 'Replace image…', onSelect: async () => { await editTileDialog(dictionary, tile); renderAll(); } },
      { separator: true },
      { label: `Used by ${countTile(activeMap()?.data ?? [], tile.id).toLocaleString()} cells on this map`, disabled: true },
      { label: `Replace every ${tile.id} on this map…`, onSelect: () => replaceTileIdDialog(tile.id) },
      { separator: true },
      { label: 'Delete tile…', danger: true, onSelect: async () => { await deleteTileDialog(dictionary, tile); renderAll(); } }
    ]);
  }

  /** Show the "resolve missing tiles" button only when there are any. */
  function renderMissingButton() {
    const map = activeMap();
    const dictionary = activeDictionary();
    if (!map || !dictionary) {
      missingButton.hidden = true;
      return;
    }
    const known = new Set(dictionary.tiles.map((tile) => tile.id));
    const missing = distinctTileIds(map.data).filter((id) => !known.has(id));
    missingButton.hidden = missing.length === 0;
    missingButton.textContent = missing.length === 1
      ? 'Resolve 1 missing tile'
      : `Resolve ${missing.length} missing tiles`;
  }

  function renderAll() {
    renderDictionarySelect();
    renderTagFilter();
    renderGrid();
    renderMissingButton();
    const size = state.settings.paletteThumbnailSize ?? 48;
    thumbSize.value = String(size);
    thumbValue.textContent = String(size);
    grid.style.setProperty('--thumb-size', `${size}px`);
  }

  on('project', renderAll);
  on('tiles', renderAll);
  on('map', renderMissingButton);
  on('settings', renderAll);
  renderAll();

  return { refresh: renderAll };
}
