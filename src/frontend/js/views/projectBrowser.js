/**
 * Welcome screen / project browser.
 *
 * Doubles as the empty state: with no projects it explains what to do next
 * instead of showing an empty grid.
 */

import { $, el, clear, formatNumber, formatWhen } from '../dom.js';
import * as api from '../api.js';
import { state, emit } from '../store.js';
import { openForm } from '../modal.js';
import { toastSuccess, toastApiError, toastWarning } from '../toast.js';
import { openProject, createProjectDialog, deleteProjectById, confirmDiscardIfDirty } from '../projectController.js';
import { importProjectFlow } from './exportImport.js';
import { openDictionaryManager, reloadDictionarySummaries } from './dictionaryManager.js';
import { openSettingsDialog } from './settingsDialog.js';
import { requestRender, viewportSize } from '../renderer.js';
import { fitToScreen } from '../viewport.js';

let initialised = false;

export function initProjectBrowser() {
  if (initialised) return;
  initialised = true;

  $('#welcome-new').addEventListener('click', async () => {
    await reloadDictionarySummaries();
    const created = await createProjectDialog({ dictionaries: state.dictionarySummaries });
    if (created) hideProjectBrowser();
  });
  $('#welcome-import').addEventListener('click', async () => {
    await importProjectFlow();
    await refresh();
  });
  $('#welcome-dictionaries').addEventListener('click', () => openDictionaryManager());
  $('#welcome-settings').addEventListener('click', () => openSettingsDialog());

  $('#project-search').addEventListener('input', (event) => {
    renderProjects(event.target.value.trim().toLowerCase());
  });
}

export async function showProjectBrowser() {
  initProjectBrowser();
  $('#welcome').hidden = false;
  $('#app').hidden = Boolean(!state.project);
  await refresh();
}

export function hideProjectBrowser() {
  $('#welcome').hidden = true;
  $('#app').hidden = false;
  // The canvas had no size while the overlay was up, so fit once it does.
  requestAnimationFrame(() => {
    const map = state.project?.maps.find((candidate) => candidate.id === state.activeMapId);
    const { width, height } = viewportSize();
    if (state.needsFit && map && width > 0) {
      fitToScreen(map, width, height);
      state.needsFit = false;
    }
    requestRender();
  });
}

/** Reload both lists from the server. */
export async function refresh() {
  try {
    const [projects, recents] = await Promise.all([api.listProjects(), api.listRecents()]);
    state.projects = projects;
    state.recents = recents;
    emit('projects');
  } catch (error) {
    toastApiError('Projects could not be listed', error);
  }
  renderRecents();
  renderProjects($('#project-search').value.trim().toLowerCase());
}

function renderRecents() {
  const grid = $('#recents-grid');
  const section = $('#recents-section');
  clear(grid);

  if (state.recents.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const project of state.recents) {
    grid.append(projectCard(project, { recent: true }));
  }
}

function renderProjects(query = '') {
  const grid = $('#projects-grid');
  const empty = $('#projects-empty');
  clear(grid);

  const projects = query
    ? state.projects.filter((project) =>
        project.name.toLowerCase().includes(query) ||
        String(project.description ?? '').toLowerCase().includes(query))
    : state.projects;

  empty.hidden = state.projects.length > 0;
  if (state.projects.length > 0 && projects.length === 0) {
    grid.append(el('p', { class: 'muted', text: `No projects match "${query}".` }));
    return;
  }
  for (const project of projects) grid.append(projectCard(project, { recent: false }));
}

function projectCard(project, { recent }) {
  const card = el('div', { class: `card${project.damaged ? ' damaged' : ''}` });

  card.append(
    el('h3', { text: project.name }),
    el('div', { class: 'card-meta' }, [
      project.damaged
        ? el('span', { class: 'badge warn', text: 'Damaged project file' })
        : `${project.mapCount} map${project.mapCount === 1 ? '' : 's'} · ${formatNumber(project.totalCells)} cells`
    ]),
    el('div', { class: 'card-meta', text: recent ? `Last opened: ${formatWhen(project.lastOpenedAt)}` : `Saved: ${formatWhen(project.savedAt)}` })
  );

  if (project.hasRecovery) {
    card.append(el('span', { class: 'badge info', text: 'Recovered work available' }));
  }
  if (project.damaged) {
    card.append(el('div', { class: 'notice danger' }, [
      el('ul', {}, (project.problems ?? []).map((problem) => el('li', { text: problem })))
    ]));
  }

  const actions = el('div', { class: 'card-actions' }, [
    el('button', {
      class: 'button small primary', text: 'Open', disabled: project.damaged,
      on: {
        click: async () => {
          if (!(await confirmDiscardIfDirty())) return;
          if (await openProject(project.id)) hideProjectBrowser();
        }
      }
    }),
    el('button', { class: 'button small', text: 'Rename', disabled: project.damaged, on: { click: () => renameFlow(project) } }),
    el('button', { class: 'button small', text: 'Duplicate', disabled: project.damaged, on: { click: () => duplicateFlow(project) } }),
    recent
      ? el('button', {
          class: 'button small', text: 'Remove from recents',
          attrs: { title: 'Removes it from this list without deleting the project' },
          on: {
            click: async () => {
              await api.forgetRecent(project.id).catch(() => {});
              toastSuccess('Removed from recent projects', project.name);
              await refresh();
            }
          }
        })
      : null,
    el('button', {
      class: 'button small danger', text: 'Delete',
      on: { click: async () => { if (await deleteProjectById(project.id, project.name)) await refresh(); } }
    })
  ]);
  card.append(actions);
  return card;
}

async function renameFlow(project) {
  await openForm({
    title: 'Rename project',
    submitLabel: 'Rename',
    fields: [{ name: 'name', label: 'Project name', type: 'text', value: project.name }],
    validate: (values) => (values.name.trim() ? [] : ['Enter a project name.']),
    onSubmit: async (values) => {
      const renamed = await api.renameProject(project.id, values.name.trim());
      if (state.project?.id === project.id) {
        state.project.name = renamed.name;
        emit('project');
      }
      toastSuccess('Project renamed', renamed.name);
    }
  });
  await refresh();
}

async function duplicateFlow(project) {
  await openForm({
    title: 'Duplicate project',
    submitLabel: 'Duplicate',
    fields: [{ name: 'name', label: 'Name for the copy', type: 'text', value: `${project.name} copy` }],
    validate: (values) => (values.name.trim() ? [] : ['Enter a name for the copy.']),
    onSubmit: async (values) => {
      const copy = await api.duplicateProject(project.id, values.name.trim());
      toastSuccess('Project duplicated', copy.name);
    }
  }).catch((error) => toastWarning('The project could not be duplicated', error.message));
  await refresh();
}
