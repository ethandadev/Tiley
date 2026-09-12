/** Settings panel. Changes are persisted server-side and applied immediately. */

import { openForm } from '../modal.js';
import { state, emit } from '../store.js';
import * as api from '../api.js';
import { toastSuccess, toastApiError } from '../toast.js';
import { requestRender } from '../renderer.js';

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  requestRender();
}

export async function openSettingsDialog() {
  await openForm({
    title: 'Settings',
    submitLabel: 'Save settings',
    intro: 'Settings apply to every project and are stored on this machine.',
    fields: [
      {
        name: 'theme', label: 'Theme', type: 'select', value: state.settings.theme,
        options: [{ value: 'dark', label: 'Dark (default)' }, { value: 'light', label: 'Light' }]
      },
      { name: 'defaultTileWidth', label: 'Default tile width (px)', type: 'number', value: state.settings.defaultTileWidth, min: 1, max: 1024, half: true },
      { name: 'defaultTileHeight', label: 'Default tile height (px)', type: 'number', value: state.settings.defaultTileHeight, min: 1, max: 1024, half: true },
      { name: 'autosaveEnabled', label: 'Save changes automatically', type: 'checkbox', value: state.settings.autosaveEnabled },
      { name: 'autosaveIntervalSeconds', label: 'Autosave interval (seconds)', type: 'number', value: state.settings.autosaveIntervalSeconds, min: 5, max: 600 },
      { name: 'showGrid', label: 'Show the grid by default', type: 'checkbox', value: state.settings.showGrid },
      { name: 'gridColor', label: 'Grid colour', type: 'text', value: state.settings.gridColor, hint: 'A hex colour such as #3a4152.', half: true },
      { name: 'gridOpacity', label: 'Grid opacity (0.05 – 1)', type: 'number', value: state.settings.gridOpacity, min: 0.05, max: 1, step: 0.05, half: true },
      {
        name: 'defaultExportFormat', label: 'Default export format', type: 'select', value: state.settings.defaultExportFormat,
        options: [
          { value: 'txt', label: 'Text (.txt)' },
          { value: 'csv', label: 'CSV (.csv)' },
          { value: 'json', label: 'JSON (.json)' },
          { value: 'png', label: 'PNG image' }
        ],
        hint: 'Used by Export ▸ Quick export.'
      },
      { name: 'confirmDestructive', label: 'Ask before destructive actions', type: 'checkbox', value: state.settings.confirmDestructive, hint: 'Resizing away cells, deleting maps, tiles and projects.' },
      { name: 'paletteThumbnailSize', label: 'Palette thumbnail size (px)', type: 'number', value: state.settings.paletteThumbnailSize, min: 24, max: 128 }
    ],
    validate: (values) => {
      const problems = [];
      if (!/^#[0-9a-fA-F]{6}$/.test(values.gridColor)) problems.push('The grid colour must be a hex value such as #3a4152.');
      if (!Number.isFinite(values.gridOpacity) || values.gridOpacity < 0.05 || values.gridOpacity > 1) problems.push('Grid opacity must be between 0.05 and 1.');
      if (!Number.isInteger(values.autosaveIntervalSeconds) || values.autosaveIntervalSeconds < 5) problems.push('The autosave interval must be at least 5 seconds.');
      return problems;
    },
    onSubmit: async (values) => {
      const saved = await api.updateSettings(values);
      state.settings = saved;
      applyTheme(saved.theme);
      state.showGrid = saved.showGrid;
      emit('settings', 'viewport', 'tiles');
      requestRender();
      toastSuccess('Settings saved');
    }
  }).catch((error) => toastApiError('Settings could not be saved', error));
}

export async function resetSettingsFlow() {
  try {
    state.settings = await api.resetSettings();
    applyTheme(state.settings.theme);
    state.showGrid = state.settings.showGrid;
    emit('settings', 'viewport', 'tiles');
    requestRender();
    toastSuccess('Settings reset to their defaults');
  } catch (error) {
    toastApiError('Settings could not be reset', error);
  }
}
