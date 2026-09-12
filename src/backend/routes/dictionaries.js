import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as dictionaries from '../services/dictionaryService.js';
import { badRequest } from '../../utils/errors.js';

export const dictionariesRouter = Router();

function parseTileId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) throw badRequest('That tile ID is not a whole number.');
  return id;
}

dictionariesRouter.get('/', asyncHandler(async (request, response) => {
  const all = await dictionaries.listDictionaries();
  const query = String(request.query.q ?? '').trim().toLowerCase();
  response.json({
    dictionaries: query ? all.filter((entry) => entry.name.toLowerCase().includes(query)) : all
  });
}));

dictionariesRouter.post('/', asyncHandler(async (request, response) => {
  const dictionary = await dictionaries.createDictionaryDocument(request.body ?? {});
  response.status(201).json({ dictionary });
}));

dictionariesRouter.post('/import', asyncHandler(async (request, response) => {
  const dictionary = await dictionaries.importDictionary(request.body?.document ?? request.body);
  response.status(201).json({ dictionary });
}));

dictionariesRouter.get('/:id', asyncHandler(async (request, response) => {
  response.json({ dictionary: await dictionaries.getDictionary(request.params.id) });
}));

dictionariesRouter.put('/:id', asyncHandler(async (request, response) => {
  response.json({ dictionary: await dictionaries.updateDictionary(request.params.id, request.body ?? {}) });
}));

dictionariesRouter.patch('/:id', asyncHandler(async (request, response) => {
  if (typeof request.body?.name !== 'string') throw badRequest('No new dictionary name was supplied.');
  response.json({ dictionary: await dictionaries.renameDictionary(request.params.id, request.body.name) });
}));

dictionariesRouter.post('/:id/duplicate', asyncHandler(async (request, response) => {
  const dictionary = await dictionaries.duplicateDictionary(request.params.id, request.body?.name);
  response.status(201).json({ dictionary });
}));

dictionariesRouter.delete('/:id', asyncHandler(async (request, response) => {
  response.json(await dictionaries.deleteDictionary(request.params.id));
}));

/* Tiles ------------------------------------------------------------------ */

dictionariesRouter.post('/:id/tiles', asyncHandler(async (request, response) => {
  const tile = await dictionaries.addTile(request.params.id, request.body ?? {});
  response.status(201).json({ tile });
}));

dictionariesRouter.put('/:id/tiles/:tileId', asyncHandler(async (request, response) => {
  const tile = await dictionaries.updateTile(request.params.id, parseTileId(request.params.tileId), request.body ?? {});
  response.json({ tile });
}));

dictionariesRouter.delete('/:id/tiles/:tileId', asyncHandler(async (request, response) => {
  response.json(await dictionaries.deleteTile(request.params.id, parseTileId(request.params.tileId)));
}));
