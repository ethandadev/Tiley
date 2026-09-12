/**
 * Thin wrapper around the REST API.
 *
 * Every failure becomes an `ApiError` carrying the server's user-facing
 * message plus its list of specific problems, so callers never have to inspect
 * status codes to show something useful.
 */

export class ApiError extends Error {
  constructor(message, problems = [], status = 0) {
    super(message);
    this.name = 'ApiError';
    this.problems = problems;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, signal, isForm = false } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: isForm || body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : (body === undefined ? undefined : JSON.stringify(body))
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Tiley could not reach the local server. Check that it is still running.', [], 0);
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError('The server sent a response Tiley could not understand.', [], response.status);
    }
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(error.message ?? 'That request could not be completed.', error.problems ?? [], response.status);
  }
  return payload;
}

/* Projects */
export const listProjects = (query = '') => request(`/api/projects${query ? `?q=${encodeURIComponent(query)}` : ''}`).then((r) => r.projects);
export const listRecents = () => request('/api/projects/recents').then((r) => r.recents);
export const forgetRecent = (id) => request(`/api/projects/recents/${id}`, { method: 'DELETE' });
export const getProject = (id) => request(`/api/projects/${id}`).then((r) => r.project);
export const createProject = (input) => request('/api/projects', { method: 'POST', body: input }).then((r) => r.project);
export const saveProject = (id, project) => request(`/api/projects/${id}`, { method: 'PUT', body: { project } });
export const renameProject = (id, name) => request(`/api/projects/${id}`, { method: 'PATCH', body: { name } }).then((r) => r.project);
export const duplicateProject = (id, name) => request(`/api/projects/${id}/duplicate`, { method: 'POST', body: { name } }).then((r) => r.project);
export const deleteProject = (id) => request(`/api/projects/${id}`, { method: 'DELETE' });
export const importProject = (document) => request('/api/projects/import', { method: 'POST', body: { document } }).then((r) => r.project);

/* Recovery */
export const saveRecovery = (id, project) => request(`/api/projects/${id}/recovery`, { method: 'POST', body: { project } });
export const getRecovery = (id) => request(`/api/projects/${id}/recovery`).then((r) => r.recovery);
export const discardRecovery = (id) => request(`/api/projects/${id}/recovery`, { method: 'DELETE' });

/* Dictionaries */
export const listDictionaries = () => request('/api/dictionaries').then((r) => r.dictionaries);
export const getDictionary = (id) => request(`/api/dictionaries/${id}`).then((r) => r.dictionary);
export const createDictionary = (input) => request('/api/dictionaries', { method: 'POST', body: input }).then((r) => r.dictionary);
export const updateDictionary = (id, patch) => request(`/api/dictionaries/${id}`, { method: 'PUT', body: patch }).then((r) => r.dictionary);
export const renameDictionary = (id, name) => request(`/api/dictionaries/${id}`, { method: 'PATCH', body: { name } }).then((r) => r.dictionary);
export const duplicateDictionary = (id, name) => request(`/api/dictionaries/${id}/duplicate`, { method: 'POST', body: { name } }).then((r) => r.dictionary);
export const deleteDictionary = (id) => request(`/api/dictionaries/${id}`, { method: 'DELETE' });
export const importDictionary = (document) => request('/api/dictionaries/import', { method: 'POST', body: { document } }).then((r) => r.dictionary);
export const addTile = (dictionaryId, tile) => request(`/api/dictionaries/${dictionaryId}/tiles`, { method: 'POST', body: tile }).then((r) => r.tile);
export const updateTile = (dictionaryId, tileId, patch) => request(`/api/dictionaries/${dictionaryId}/tiles/${tileId}`, { method: 'PUT', body: patch }).then((r) => r.tile);
export const deleteTile = (dictionaryId, tileId) => request(`/api/dictionaries/${dictionaryId}/tiles/${tileId}`, { method: 'DELETE' });

/* Assets */
export const listAssets = () => request('/api/assets').then((r) => r.assets);
export function uploadAsset(file) {
  const form = new FormData();
  form.append('image', file);
  return request('/api/assets', { method: 'POST', body: form, isForm: true }).then((r) => r.asset);
}
export const deleteAsset = (id) => request(`/api/assets/${id}`, { method: 'DELETE' });

/* Settings */
export const getSettings = () => request('/api/settings').then((r) => r.settings);
export const updateSettings = (patch) => request('/api/settings', { method: 'PUT', body: patch }).then((r) => r.settings);
export const resetSettings = () => request('/api/settings/reset', { method: 'POST' }).then((r) => r.settings);
