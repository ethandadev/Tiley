import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as projects from '../services/projectService.js';
import { badRequest } from '../../utils/errors.js';

export const projectsRouter = Router();

/* Collection ------------------------------------------------------------- */

projectsRouter.get('/', asyncHandler(async (request, response) => {
  const all = await projects.listProjects();
  const query = String(request.query.q ?? '').trim().toLowerCase();
  const filtered = query
    ? all.filter((project) =>
        project.name.toLowerCase().includes(query) ||
        String(project.description ?? '').toLowerCase().includes(query))
    : all;
  response.json({ projects: filtered });
}));

projectsRouter.post('/', asyncHandler(async (request, response) => {
  const project = await projects.createNewProject(request.body);
  response.status(201).json({ project });
}));

projectsRouter.post('/import', asyncHandler(async (request, response) => {
  const project = await projects.importProject(request.body?.document ?? request.body);
  response.status(201).json({ project });
}));

/* Recents ---------------------------------------------------------------- */

projectsRouter.get('/recents', asyncHandler(async (_request, response) => {
  const [recents, all] = await Promise.all([projects.getRecents(), projects.listProjects()]);
  const byId = new Map(all.map((project) => [project.id, project]));
  response.json({
    recents: recents
      .filter((entry) => byId.has(entry.id))
      .map((entry) => ({ ...byId.get(entry.id), lastOpenedAt: entry.lastOpenedAt }))
  });
}));

projectsRouter.delete('/recents/:id', asyncHandler(async (request, response) => {
  const recents = await projects.removeRecent(request.params.id);
  response.json({ recents });
}));

/* Single project --------------------------------------------------------- */

projectsRouter.get('/:id', asyncHandler(async (request, response) => {
  const project = await projects.getProject(request.params.id);
  if (request.query.touch !== 'false') await projects.touchRecent(project.id);
  response.json({ project });
}));

projectsRouter.put('/:id', asyncHandler(async (request, response) => {
  const incoming = request.body?.project;
  if (!incoming) throw badRequest('No project data was supplied.');
  const project = await projects.saveProject(request.params.id, incoming);
  response.json({ project, savedAt: project.updatedAt });
}));

projectsRouter.patch('/:id', asyncHandler(async (request, response) => {
  if (typeof request.body?.name !== 'string') throw badRequest('No new project name was supplied.');
  const project = await projects.renameProject(request.params.id, request.body.name);
  response.json({ project });
}));

projectsRouter.delete('/:id', asyncHandler(async (request, response) => {
  await projects.deleteProject(request.params.id);
  response.json({ deleted: request.params.id });
}));

projectsRouter.post('/:id/duplicate', asyncHandler(async (request, response) => {
  const project = await projects.duplicateProject(request.params.id, request.body?.name);
  response.status(201).json({ project });
}));

/* Recovery --------------------------------------------------------------- */

projectsRouter.post('/:id/recovery', asyncHandler(async (request, response) => {
  const result = await projects.saveRecovery(request.params.id, request.body?.project);
  response.json(result);
}));

projectsRouter.get('/:id/recovery', asyncHandler(async (request, response) => {
  const recovery = await projects.getRecovery(request.params.id);
  response.json({ recovery });
}));

projectsRouter.delete('/:id/recovery', asyncHandler(async (request, response) => {
  await projects.discardRecovery(request.params.id);
  response.json({ discarded: true });
}));

/* Maps ------------------------------------------------------------------- */

projectsRouter.get('/:id/maps', asyncHandler(async (request, response) => {
  response.json({ maps: await projects.listMaps(request.params.id) });
}));

projectsRouter.post('/:id/maps', asyncHandler(async (request, response) => {
  const map = await projects.addMap(request.params.id, request.body);
  response.status(201).json({ map });
}));

projectsRouter.put('/:id/maps/:mapId', asyncHandler(async (request, response) => {
  const map = await projects.updateMap(request.params.id, request.params.mapId, request.body ?? {});
  response.json({ map });
}));

projectsRouter.delete('/:id/maps/:mapId', asyncHandler(async (request, response) => {
  response.json(await projects.deleteMap(request.params.id, request.params.mapId));
}));
