import multer, { MulterError } from 'multer';
import { Request, Response, NextFunction } from 'express';

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const fields = multerInstance.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'user_images', maxCount: 3 },
]);

// Wraps multer so MulterError (LIMIT_FILE_SIZE, etc.) returns a clean JSON 400
// instead of propagating as an unhandled 500.
export function handleUpload(req: Request, res: Response, next: NextFunction) {
  fields(req, res, (err) => {
    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `הקובץ גדול מדי. הגודל המקסימלי הוא 10MB`
          : err.message;
      res.status(400).json({ error: message });
      return;
    }
    if (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    next();
  });
}

const singleImage = multerInstance.single('image');

export function handleSingleImageUpload(req: Request, res: Response, next: NextFunction) {
  singleImage(req, res, (err) => {
    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `הקובץ גדול מדי. הגודל המקסימלי הוא 10MB`
          : err.message;
      res.status(400).json({ error: message });
      return;
    }
    if (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    next();
  });
}
