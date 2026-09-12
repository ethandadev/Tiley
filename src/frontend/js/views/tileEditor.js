/**
 * Tile creation and editing dialogs.
 *
 * Changing or deleting a tile that the open map actually uses is a destructive
 * act, so the dialogs count the affected cells first and say exactly how many
 * will be left pointing at a missing ID.
 */

import { el, pickFile } from '../dom.js';
import { openForm, openModal, confirmDialog } from '../modal.js';
import * as api from '../api.js';
import { state, activeMap, emit } from '../store.js';
import { toastSuccess, toastApiError, toastWarning } from '../toast.js';
import { refreshDictionary } from '../projectController.js';
import { tileImageUrl, getImageEntry } from '../tileImages.js';
import { countTile } from '../../../shared/tilemap.js';
import { LIMITS } from '../../../shared/constants.js';
import { requestRender } from '../renderer.js';

/** How many cells of the open map use this tile ID. */
function usageCount(tileId) {
  const map = activeMap();
  return map ? countTile(map.data, tileId) : 0;
}

/**
 * Image picker: upload a file, or reuse an image already in the library.
 * Returns a node whose `dataset.image` holds the chosen asset id ('' = none).
 */
function imageField(initialImage) {
  const holder = el('div', { class: 'field' });
  holder.dataset.image = initialImage ?? '';

  const preview = el('div', { class: 'tile-preview', text: initialImage ? '' : 'No image' });
  const applyPreview = () => {
    const image = holder.dataset.image;
    if (image) {
      preview.style.backgroundImage = `url("${tileImageUrl({ image })}")`;
      preview.textContent = '';
    } else {
      preview.style.backgroundImage = '';
      preview.textContent = 'No image';
    }
  };
  applyPreview();

  const status = el('span', { class: 'field-hint', text: 'PNG, JPEG or WebP, up to 8 MB. PNG is best for pixel art.' });

  const uploadButton = el('button', {
    type: 'button', class: 'button small', text: 'Upload image…',
    on: {
      click: async () => {
        const file = await pickFile({ accept: 'image/png,image/jpeg,image/webp' });
        if (!file) return;
        if (file.size > LIMITS.ASSET_BYTES_MAX) {
          status.textContent = `That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${LIMITS.ASSET_BYTES_MAX / 1048576} MB.`;
          return;
        }
        uploadButton.disabled = true;
        status.textContent = 'Uploading…';
        try {
          const asset = await api.uploadAsset(file);
          holder.dataset.image = asset.id;
          getImageEntry(asset.url);
          applyPreview();
          status.textContent = `Uploaded (${Math.round(asset.bytes / 1024)} KB).`;
        } catch (error) {
          status.textContent = error.message;
        } finally {
          uploadButton.disabled = false;
        }
      }
    }
  });

  const libraryButton = el('button', {
    type: 'button', class: 'button small', text: 'Choose existing…',
    on: {
      click: async () => {
        const chosen = await chooseExistingImage();
        if (chosen === undefined) return;
        holder.dataset.image = chosen ?? '';
        applyPreview();
        status.textContent = chosen ? 'Image selected.' : 'Image removed.';
      }
    }
  });

  const clearButton = el('button', {
    type: 'button', class: 'button small', text: 'Remove image',
    on: {
      click: () => {
        holder.dataset.image = '';
        applyPreview();
        status.textContent = 'This tile will show its ID and a placeholder colour.';
      }
    }
  });

  holder.append(
    el('span', { class: 'field-label', text: 'Tile image' }),
    el('div', { style: 'display:flex; gap:12px; align-items:center;' }, [
      preview,
      el('div', { style: 'display:flex; flex-direction:column; gap:6px;' }, [
        el('div', { style: 'display:flex; gap:6px; flex-wrap:wrap;' }, [uploadButton, libraryButton, clearButton]),
        status
      ])
    ])
  );
  return holder;
}

/**
 * Image library picker.
 * Resolves to an asset id, `null` to clear the image, or `undefined` on cancel.
 */
function chooseExistingImage() {
  return new Promise((resolve) => {
    let choice;
    const grid = el('div', { class: 'palette-grid', style: '--thumb-size:72px; max-height:50vh;' }, [
      el('p', { class: 'muted', text: 'Loading images…' })
    ]);

    const dialog = openModal({
      title: 'Choose an existing image',
      body: grid,
      wide: true,
      footer: [
        el('button', { class: 'button', text: 'Cancel', on: { click: () => dialog.close() } })
      ],
      onClose: () => resolve(choice)
    });

    api.listAssets().then((assets) => {
      grid.replaceChildren();
      if (assets.length === 0) {
        grid.append(el('p', { class: 'muted', text: 'No images have been uploaded yet. Use “Upload image…” to add one.' }));
        return;
      }
      for (const asset of assets) {
        grid.append(el('button', {
          type: 'button',
          class: 'palette-tile',
          attrs: { title: `${asset.id} — ${Math.round(asset.bytes / 1024)} KB` },
          on: { click: () => { choice = asset.id; dialog.close(); } }
        }, [
          el('div', { class: 'tile-thumb', style: `background-image:url("${asset.url}")` }),
          el('span', { class: 'tile-id', text: `${Math.round(asset.bytes / 1024)} KB` })
        ]));
      }
    }).catch((error) => {
      grid.replaceChildren(el('p', { class: 'field-error', text: error.message }));
    });
  });
}

/** Shared field list for both the create and edit dialogs. */
function tileFields(tile, imageNode) {
  return [
    { name: 'id', label: 'Tile ID (unique number used in exports)', type: 'number', value: tile?.id ?? 0, min: 0, half: true },
    { name: 'name', label: 'Name', type: 'text', value: tile?.name ?? '', half: true },
    { type: 'custom', name: 'image', render: () => imageNode },
    { name: 'description', label: 'Description (optional)', type: 'textarea', value: tile?.description ?? '', rows: 2 },
    { name: 'tags', label: 'Tags (optional, comma separated)', type: 'text', value: (tile?.tags ?? []).join(', '), hint: 'Tags drive the palette filters, e.g. terrain, outdoor.' }
  ];
}

const parseTags = (value) => String(value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);

export async function createTileDialog(dictionary) {
  const nextId = (dictionary.tiles.at(-1)?.id ?? -1) + 1;
  const imageNode = imageField('');

  const created = await openForm({
    title: `Add a tile to "${dictionary.name}"`,
    submitLabel: 'Add tile',
    fields: tileFields({ id: nextId, name: '' }, imageNode),
    validate: (values) => validateTileValues(values, dictionary, null),
    onSubmit: (values) => api.addTile(dictionary.id, {
      id: values.id,
      name: values.name.trim(),
      image: imageNode.dataset.image || null,
      description: values.description,
      tags: parseTags(values.tags)
    })
  });

  if (created) {
    await refreshDictionary(dictionary.id);
    toastSuccess('Tile added', `${created.id} — ${created.name}`);
  }
  return created;
}

export async function editTileDialog(dictionary, tile) {
  const imageNode = imageField(tile.image ?? '');
  const uses = usageCount(tile.id);

  const updated = await openForm({
    title: `Edit tile ${tile.id}`,
    submitLabel: 'Save tile',
    intro: uses > 0
      ? `This tile is used by ${uses.toLocaleString()} cells on the current map. Changing its ID will leave those cells pointing at ID ${tile.id}.`
      : 'This tile is not used by the current map.',
    fields: tileFields(tile, imageNode),
    validate: (values) => validateTileValues(values, dictionary, tile.id),
    onSubmit: async (values) => {
      if (values.id !== tile.id && uses > 0) {
        const confirmed = await confirmDialog({
          title: 'Change tile ID?',
          message: `${uses.toLocaleString()} cells on the current map use ID ${tile.id}.`,
          details: [
            `Those cells keep the value ${tile.id} and will show as missing tiles.`,
            `You can afterwards replace all ${tile.id} values with ${values.id} from the palette menu.`
          ],
          confirmLabel: 'Change the ID anyway',
          danger: true
        });
        if (!confirmed) throw new Error('The tile ID was left unchanged.');
      }
      return api.updateTile(dictionary.id, tile.id, {
        id: values.id,
        name: values.name.trim(),
        image: imageNode.dataset.image || null,
        description: values.description,
        tags: parseTags(values.tags)
      });
    }
  });

  if (updated) {
    await refreshDictionary(dictionary.id);
    emit('tiles');
    requestRender();
    toastSuccess('Tile saved', `${updated.id} — ${updated.name}`);
  }
  return updated;
}

function validateTileValues(values, dictionary, ignoreId) {
  const problems = [];
  if (!Number.isInteger(values.id) || values.id < 0) problems.push('The tile ID must be a whole number of 0 or more.');
  if (!values.name.trim()) problems.push('Enter a tile name.');
  const clash = dictionary.tiles.find((tile) => tile.id === values.id && tile.id !== ignoreId);
  if (clash) problems.push(`Tile ID ${values.id} is already used by "${clash.name}".`);
  return problems;
}

export async function duplicateTileDialog(dictionary, tile) {
  const nextId = (dictionary.tiles.at(-1)?.id ?? -1) + 1;
  const created = await openForm({
    title: `Duplicate tile ${tile.id}`,
    submitLabel: 'Duplicate',
    fields: [
      { name: 'id', label: 'New tile ID', type: 'number', value: nextId, min: 0, half: true },
      { name: 'name', label: 'New name', type: 'text', value: `${tile.name} copy`, half: true }
    ],
    validate: (values) => validateTileValues({ ...values, name: values.name }, dictionary, null),
    onSubmit: (values) => api.addTile(dictionary.id, {
      ...tile, id: values.id, name: values.name.trim()
    })
  });
  if (created) {
    await refreshDictionary(dictionary.id);
    toastSuccess('Tile duplicated', `${created.id} — ${created.name}`);
  }
  return created;
}

export async function deleteTileDialog(dictionary, tile) {
  const uses = usageCount(tile.id);
  const confirmed = await confirmDialog({
    title: 'Delete tile',
    message: `Delete "${tile.name}" (ID ${tile.id}) from "${dictionary.name}"?`,
    details: uses > 0
      ? [
          `${uses.toLocaleString()} cells on the current map use this ID.`,
          'Those cells keep their numeric value and will be shown as missing tiles — no map data is changed.'
        ]
      : ['This tile is not used by the current map.'],
    confirmLabel: 'Delete tile',
    danger: true
  });
  if (!confirmed) return false;

  try {
    await api.deleteTile(dictionary.id, tile.id);
    await refreshDictionary(dictionary.id);
    emit('tiles');
    requestRender();
    if (uses > 0) toastWarning('Tile deleted', `${uses.toLocaleString()} cells now show as missing tile ${tile.id}.`);
    else toastSuccess('Tile deleted', tile.name);
    return true;
  } catch (error) {
    toastApiError('The tile could not be deleted', error);
    return false;
  }
}

/** Replace every occurrence of one tile ID on the current map with another. */
export async function replaceTileIdDialog(fromId) {
  const map = activeMap();
  if (!map) return;
  const dictionary = map.dictionaryId ? state.dictionaries.get(map.dictionaryId) : null;
  const uses = usageCount(fromId);

  await openForm({
    title: `Replace tile ID ${fromId}`,
    submitLabel: 'Replace on this map',
    intro: `${uses.toLocaleString()} cells on "${map.name}" currently use ID ${fromId}.`,
    fields: [{
      name: 'toId',
      label: 'Replace with tile ID',
      type: 'number',
      value: dictionary?.tiles[0]?.id ?? map.defaultTile,
      min: 0
    }],
    validate: (values) => (Number.isInteger(values.toId) && values.toId >= 0 ? [] : ['Enter a whole number tile ID of 0 or more.']),
    onSubmit: async (values) => {
      const { replaceTileId } = await import('../editorActions.js');
      const changes = replaceTileId(fromId, values.toId);
      toastSuccess('Tiles replaced', `${changes.length.toLocaleString()} cells changed from ${fromId} to ${values.toId}.`);
    }
  });
}
