import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as assets from '../services/assetService.js';
import { LIMITS, ALLOWED_IMAGE_TYPES } from '../../shared/constants.js';
import { AppError, badRequest } from '../../utils/errors.js';

export const assetsRouter = Router();

/**
 * Uploads are buffered in memory and only written to disk after the magic-byte
 * check in assetService, so an unsupported file never touches the filesystem.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.ASSET_BYTES_MAX, files: 1, fields: 4 },
  fileFilter(_request, file, callback) {
    const mime = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, mime)) {
      callback(badRequest('Tile images must be PNG, JPEG or WebP files.'));
      return;
    }
    callback(null, true);
  }
});

/** Translate multer's own errors into user-readable ones. */
function handleUpload(request, response, next) {
  upload.single('image')(request, response, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(`That image is too large. The maximum size is ${LIMITS.ASSET_BYTES_MAX / 1048576} MB.`, { status: 413, code: 'too_large' }));
        return;
      }
      next(badRequest('The upload could not be read. Send a single image in the "image" field.'));
      return;
    }
    next(error);
  });
}

assetsRouter.get('/', asyncHandler(async (_request, response) => {
  response.json({ assets: await assets.listAssets() });
}));

assetsRouter.post('/', handleUpload, asyncHandler(async (request, response) => {
  if (!request.file) throw badRequest('No image was uploaded.');
  const asset = await assets.saveUpload(request.file.buffer, request.file.mimetype);
  response.status(201).json({ asset });
}));

assetsRouter.delete('/:id', asyncHandler(async (request, response) => {
  response.json(await assets.deleteAsset(request.params.id));
}));
