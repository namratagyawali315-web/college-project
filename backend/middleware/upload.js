const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const config = require('../config');
const { AppError } = require('../lib/errors');
const { randomToken } = require('../lib/tokens');

const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

fs.mkdirSync(config.uploads.dir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, config.uploads.dir);
  },
  filename(req, file, callback) {
    const extension = MIME_EXTENSIONS[file.mimetype] || '.img';
    callback(null, `${Date.now()}-${randomToken(8)}${extension}`);
  }
});

const uploadMenuImage = multer({
  storage,
  limits: {
    fileSize: config.uploads.maxBytes,
    files: 1
  },
  fileFilter(req, file, callback) {
    if (!MIME_EXTENSIONS[file.mimetype]) {
      callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
      return;
    }
    callback(null, true);
  }
});

function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

async function validateMenuImage(req, res, next) {
  if (!req.file) {
    return next();
  }

  let handle;
  let validationError = null;

  try {
    handle = await fs.promises.open(req.file.path, 'r');
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const detectedMime = detectImageMime(header.subarray(0, bytesRead));

    if (!detectedMime || detectedMime !== req.file.mimetype) {
      validationError = new AppError(
        400,
        'Upload a valid JPEG, PNG, or WebP image.',
        'INVALID_IMAGE'
      );
    }
  } catch {
    validationError = new AppError(400, 'The image could not be verified.', 'INVALID_IMAGE');
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }

  if (validationError) {
    await removeUploadedFile(req.file);
    return next(validationError);
  }

  return next();
}

async function removeUploadedFile(file) {
  if (!file?.path) {
    return;
  }

  try {
    await fs.promises.unlink(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Could not remove uploaded file:', error.message);
    }
  }
}

async function removeStoredImage(imagePath) {
  if (typeof imagePath !== 'string' || !imagePath.startsWith('/uploads/menu/')) {
    return;
  }

  const filePath = path.join(config.uploads.dir, path.basename(imagePath));

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Could not remove stored image:', error.message);
    }
  }
}

module.exports = {
  uploadMenuImage,
  validateMenuImage,
  removeUploadedFile,
  removeStoredImage
};
