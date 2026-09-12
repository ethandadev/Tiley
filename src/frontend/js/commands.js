/**
 * The command registry.
 *
 * Every user-invokable action is defined once here with its label, accelerator
 * and enablement rule. The menu bar, the keyboard handler and the context menus
 * all read from this list, so a shortcut shown in a menu is by construction the
 * shortcut that actually runs.
 *
 * Accelerators use "Mod" for Ctrl on Windows/Linux and Cmd on macOS.
 */

import { IS_MAC, MOD_LABEL } from './dom.js';
import { state, setTool, activeMap, activeDictionary, emit } from './store.js';
import { undo, redo, canUndo, canRedo } from './history.js';
import { EDITOR_TOOLS } from '../../shared/constants.js';
import { requestRender, viewportSize } from './renderer.js';
import { fitToScreen, centerMap, stepZoom, resetZoom } from './viewport.js';
import {
  copySelection, cutSelection, pasteClipboard, duplicateSelection, eraseSelection
} from './editorActions.js';
import { setSelection } from './store.js';
import {
  saveNow, saveAs, createProjectDialog, renameCurrentProject, confirmDiscardIfDirty, closeProject
} from './projectController.js';
import { addMapDialog, resizeMapDialog } from './views/mapDialogs.js';
import { exportDialog, quickExport, importMapDialog, importProjectFlow } from './views/exportImport.js';
import { openDictionaryManager } from './views/dictionaryManager.js';
import { openMissingTilesDialog, missingTileIds } from './views/missingTiles.js';
import { openSettingsDialog } from './views/settingsDialog.js';
import { showProjectBrowser } from './views/projectBrowser.js';
import { cancelGesture } from './tools.js';
import { toastInfo } from './toast.js';
import { openShortcutsDialog } from './views/shortcutsDialog.js';

const hasProject = () => Boolean(state.project);
const hasSelection = () => Boolean(state.selection);
const view = () => viewportSize();

/** Render an accelerator for display on the current platform. */
export function formatAccelerator(accelerator) {
  if (!accelerator) return '';
  return accelerator
    .replace('Mod', MOD_LABEL)
    .replace('Shift', IS_MAC ? '⇧' : 'Shift')
    .replaceAll('+', IS_MAC ? ' ' : ' + ');
}

export const commands = [
  /* File ------------------------------------------------------------------ */
  { id: 'project.new', menu: 'File', label: 'New project…', accelerator: 'Mod+N', run: () => createProjectDialog({ dictionaries: state.dictionarySummaries }) },
  { id: 'project.browse', menu: 'File', label: 'Project browser…', accelerator: 'Mod+O', run: () => showProjectBrowser() },
  { id: 'project.save', menu: 'File', label: 'Save', accelerator: 'Mod+S', enabled: hasProject, run: () => saveNow() },
  { id: 'project.saveAs', menu: 'File', label: 'Save as…', accelerator: 'Mod+Shift+S', enabled: hasProject, run: () => saveAs() },
  { id: 'project.rename', menu: 'File', label: 'Rename project…', enabled: hasProject, run: () => renameCurrentProject() },
  { id: 'file.sep1', menu: 'File', separator: true },
  { id: 'project.importMap', menu: 'File', label: 'Import tilemap into this map…', enabled: hasProject, run: () => importMapDialog() },
  { id: 'project.importProject', menu: 'File', label: 'Import project from JSON…', run: () => importProjectFlow() },
  { id: 'file.sep2', menu: 'File', separator: true },
  {
    id: 'project.close', menu: 'File', label: 'Close project', enabled: hasProject,
    run: async () => { if (await confirmDiscardIfDirty()) { closeProject(); showProjectBrowser(); } }
  },

  /* Edit ------------------------------------------------------------------ */
  { id: 'edit.undo', menu: 'Edit', label: 'Undo', accelerator: 'Mod+Z', enabled: canUndo, run: () => { undo(); requestRender(); } },
  { id: 'edit.redo', menu: 'Edit', label: 'Redo', accelerator: 'Mod+Shift+Z', enabled: canRedo, run: () => { redo(); requestRender(); } },
  { id: 'edit.redoAlt', accelerator: 'Mod+Y', hidden: true, enabled: canRedo, run: () => { redo(); requestRender(); } },
  { id: 'edit.sep1', menu: 'Edit', separator: true },
  { id: 'edit.cut', menu: 'Edit', label: 'Cut selection', accelerator: 'Mod+X', enabled: hasSelection, run: () => cutSelection() },
  { id: 'edit.copy', menu: 'Edit', label: 'Copy selection', accelerator: 'Mod+C', enabled: hasSelection, run: () => { if (copySelection()) toastInfo('Selection copied'); } },
  { id: 'edit.paste', menu: 'Edit', label: 'Paste', accelerator: 'Mod+V', enabled: () => Boolean(state.clipboard), run: () => pasteClipboard() },
  { id: 'edit.duplicate', menu: 'Edit', label: 'Duplicate selection', accelerator: 'Mod+D', enabled: hasSelection, run: () => duplicateSelection() },
  { id: 'edit.delete', menu: 'Edit', label: 'Erase selected cells', accelerator: 'Delete', enabled: hasSelection, run: () => eraseSelection() },
  { id: 'edit.sep2', menu: 'Edit', separator: true },
  {
    id: 'edit.selectAll', menu: 'Edit', label: 'Select whole map', accelerator: 'Mod+A', enabled: hasProject,
    run: () => { const map = activeMap(); if (map) setSelection({ x: 0, y: 0, width: map.width, height: map.height }); }
  },
  { id: 'edit.clearSelection', menu: 'Edit', label: 'Cancel / clear selection', accelerator: 'Escape', run: () => { if (!cancelGesture()) setSelection(null); } },

  /* View ------------------------------------------------------------------ */
  { id: 'view.zoomIn', menu: 'View', label: 'Zoom in', accelerator: '+', enabled: hasProject, run: () => { const v = view(); stepZoom(1, v.width, v.height); } },
  { id: 'view.zoomOut', menu: 'View', label: 'Zoom out', accelerator: '-', enabled: hasProject, run: () => { const v = view(); stepZoom(-1, v.width, v.height); } },
  { id: 'view.zoomReset', menu: 'View', label: 'Reset zoom to 100%', accelerator: 'Mod+0', enabled: hasProject, run: () => { const v = view(); resetZoom(v.width, v.height); } },
  { id: 'view.fit', menu: 'View', label: 'Fit map to screen', accelerator: 'Shift+F', enabled: hasProject, run: () => { const map = activeMap(); const v = view(); if (map) fitToScreen(map, v.width, v.height); } },
  { id: 'view.center', menu: 'View', label: 'Centre the map', enabled: hasProject, run: () => { const map = activeMap(); const v = view(); if (map) centerMap(map, v.width, v.height); } },
  { id: 'view.sep1', menu: 'View', separator: true },
  {
    id: 'view.grid', menu: 'View', label: 'Show grid', accelerator: 'G', checkbox: () => state.showGrid,
    run: () => { state.showGrid = !state.showGrid; emit('viewport', 'tool'); requestRender(); }
  },
  { id: 'view.sep2', menu: 'View', separator: true },
  { id: 'view.settings', menu: 'View', label: 'Settings…', accelerator: 'Mod+,', run: () => openSettingsDialog() },

  /* Project --------------------------------------------------------------- */
  { id: 'map.new', menu: 'Project', label: 'New map…', enabled: hasProject, run: () => addMapDialog() },
  { id: 'map.resize', menu: 'Project', label: 'Resize map…', accelerator: 'Mod+R', enabled: hasProject, run: () => resizeMapDialog() },
  { id: 'project.sep1', menu: 'Project', separator: true },
  { id: 'dict.manage', menu: 'Project', label: 'Tile dictionaries…', accelerator: 'Mod+K', run: () => openDictionaryManager() },
  {
    id: 'dict.missing', menu: 'Project', label: 'Resolve missing tiles…',
    enabled: () => Boolean(activeDictionary()) && missingTileIds().length > 0,
    run: () => openMissingTilesDialog()
  },

  /* Export ---------------------------------------------------------------- */
  { id: 'export.dialog', menu: 'Export', label: 'Export…', accelerator: 'Mod+E', enabled: hasProject, run: () => exportDialog() },
  { id: 'export.quick', menu: 'Export', label: 'Quick export (default format)', accelerator: 'Mod+Shift+E', enabled: hasProject, run: () => quickExport() },

  /* Help ------------------------------------------------------------------ */
  { id: 'help.shortcuts', menu: 'Help', label: 'Keyboard shortcuts…', accelerator: '?', run: () => openShortcutsDialog() },

  /* Tools (keyboard only; the toolbar shows them) -------------------------- */
  ...EDITOR_TOOLS.map((tool) => ({
    id: `tool.${tool.id}`,
    label: `${tool.label} tool`,
    accelerator: tool.key.toUpperCase(),
    hidden: true,
    enabled: hasProject,
    run: () => setTool(tool.id)
  }))
];

export const commandById = new Map(commands.filter((command) => !command.separator).map((command) => [command.id, command]));

export const isEnabled = (command) => (command.enabled ? Boolean(command.enabled()) : true);

export function runCommand(id) {
  const command = commandById.get(id);
  if (!command || !isEnabled(command)) return false;
  command.run();
  return true;
}

/** Menus in display order, with their items. */
export const MENUS = ['File', 'Edit', 'View', 'Project', 'Export', 'Help'];
export const menuItems = (menu) => commands.filter((command) => command.menu === menu);
