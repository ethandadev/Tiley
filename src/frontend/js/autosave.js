/**
 * Autosave and crash recovery.
 *
 * Two independent timers, because they protect against different failures:
 *
 *   - the *recovery* timer writes a snapshot to projects/<id>/recovery.json
 *     every few seconds while there are unsaved changes. It never touches the
 *     real project file, so a crash mid-edit loses at most a few seconds and
 *     the saved project is never corrupted by a partial state.
 *
 *   - the *autosave* timer performs a real save on the configured interval.
 *
 * Both skip while a save is already in flight, and neither blocks editing.
 */

import { state } from './store.js';
import * as api from './api.js';
import { saveNow } from './projectController.js';

const RECOVERY_INTERVAL_MS = 8000;

let autosaveTimer = null;
let recoveryTimer = null;
let saving = false;

export function startAutosave() {
  stopAutosave();

  recoveryTimer = setInterval(async () => {
    if (!state.project || !state.dirty || saving) return;
    try {
      await api.saveRecovery(state.project.id, state.project);
    } catch {
      // Recovery is best-effort; a failure must not interrupt editing.
    }
  }, RECOVERY_INTERVAL_MS);

  scheduleAutosave();
}

function scheduleAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  const seconds = Math.max(5, state.settings.autosaveIntervalSeconds ?? 30);
  autosaveTimer = setInterval(async () => {
    if (!state.settings.autosaveEnabled) return;
    if (!state.project || !state.dirty || saving) return;
    saving = true;
    try {
      await saveNow({ silent: true });
    } finally {
      saving = false;
    }
  }, seconds * 1000);
}

/** Call after the autosave interval setting changes. */
export function rescheduleAutosave() {
  scheduleAutosave();
}

export function stopAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  if (recoveryTimer) clearInterval(recoveryTimer);
  autosaveTimer = null;
  recoveryTimer = null;
}

/**
 * Last-chance protection when the tab closes. `sendBeacon` is used because
 * fetch is not guaranteed to complete during unload.
 */
export function installUnloadGuard() {
  window.addEventListener('beforeunload', (event) => {
    if (!state.project || !state.dirty) return;
    try {
      const payload = new Blob([JSON.stringify({ project: state.project })], { type: 'application/json' });
      navigator.sendBeacon(`/api/projects/${state.project.id}/recovery`, payload);
    } catch {
      // Ignore: the warning below is the meaningful protection.
    }
    event.preventDefault();
    event.returnValue = '';
    return '';
  });

  // Saving when the tab is hidden catches the common "close the window" case.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.project && state.dirty && state.settings.autosaveEnabled) {
      api.saveRecovery(state.project.id, state.project).catch(() => {});
    }
  });
}
