import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as settings from '../services/settingsService.js';

export const settingsRouter = Router();

settingsRouter.get('/', asyncHandler(async (_request, response) => {
  response.json({ settings: await settings.getSettings() });
}));

settingsRouter.put('/', asyncHandler(async (request, response) => {
  response.json({ settings: await settings.updateSettings(request.body ?? {}) });
}));

settingsRouter.post('/reset', asyncHandler(async (_request, response) => {
  response.json({ settings: await settings.resetSettings() });
}));
