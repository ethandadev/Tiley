/**
 * Application settings, persisted to data/settings.json.
 * Unknown keys are dropped by `normalizeSettings`, so a hand-edited file can
 * never introduce unexpected values into the editor.
 */

import { SETTINGS_FILE } from '../../utils/paths.js';
import { readJSON, writeJSON, withFileLock } from '../../utils/storage.js';
import { DEFAULT_SETTINGS } from '../../shared/constants.js';
import { normalizeSettings } from '../../shared/schema.js';

export async function getSettings() {
  const raw = await readJSON(SETTINGS_FILE, { fallback: {}, label: 'settings' });
  return normalizeSettings(raw, DEFAULT_SETTINGS);
}

export async function updateSettings(patch) {
  return withFileLock(SETTINGS_FILE, async () => {
    const current = await getSettings();
    const next = normalizeSettings({ ...current, ...patch }, DEFAULT_SETTINGS);
    await writeJSON(SETTINGS_FILE, next);
    return next;
  });
}

export async function resetSettings() {
  return withFileLock(SETTINGS_FILE, async () => {
    await writeJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  });
}
