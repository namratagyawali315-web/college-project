const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const createSocketServer = require('./socket');
const createPublicRouter = require('./routes/public');
const createAdminRouter = require('./routes/admin');
const orderService = require('./services/orderService');
const { AppError } = require('./lib/errors');

function createApp() {
  fs.mkdirSync(config.uploads.dir, { recursive: true });

  const app = express();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProduction ? [] : null
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/public', createPublicRouter(io));
  app.use('/api/admin', createAdminRouter(io));
  app.use(
    '/api',
    (req, res, next) => {
      next(new AppError(404, 'API endpoint not found.', 'NOT_FOUND'));
    }
  );

  app.use('/uploads', express.static(config.uploads.root, { maxAge: '7d' }));
  app.use(express.static(config.publicDir));
  app.get('/scan/:token', (req, res, next) => {
    res.sendFile(path.join(config.publicDir, 'index.html'), (error) => {
      if (error) {
        next(error);
      }
    });
  });

  app.use((req, res, next) => {
    next(new AppError(404, 'Page not found.', 'NOT_FOUND'));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    let status = Number(error.status) || 500;
    let code = typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR';
    let message = error.message || 'Something went wrong.';
    let details = error.details || null;

    if (error instanceof multer.MulterError) {
      status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      code = 'UPLOAD_ERROR';
      message =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'The image is too large.'
          : 'The image upload could not be accepted.';
      details = null;
    } else if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'The request body contains invalid JSON.';
    } else if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'The request body is too large.';
    } else if (error.code === 'ER_DUP_ENTRY') {
      status = 409;
      code = 'DUPLICATE_RECORD';
      message = 'A record with that value already exists.';
      details = null;
    } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      status = 409;
      code = 'RELATED_RECORD_MISSING';
      message = 'A related record no longer exists.';
      details = null;
    } else if (status >= 500) {
      console.error(error);
      status = 500;
      code = 'INTERNAL_ERROR';
      message = 'Something went wrong. Please try again.';
      details = null;
    }

    const payload = {
      error: {
        code,
        message
      }
    };
    if (details) {
      payload.error.details = details;
    }

    res.status(status).json(payload);
  });

  return { app, httpServer, io };
}

async function start() {
  try {
    await db.pingDatabase();
  } catch (error) {
    console.error('Could not connect to MySQL. Start MySQL and check your .env settings.');
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const { httpServer, io } = createApp();

  httpServer.on('error', async (error) => {
    console.error('Server error:', error.message);
    try {
      await db.closePool();
    } catch (closeError) {
      console.error('Could not close the database pool:', closeError.message);
    }
    process.exit(1);
  });

  httpServer.listen(config.port, () => {
    console.log(`QuickBite is running at http://localhost:${config.port}`);
    console.log(`Admin panel: http://localhost:${config.port}/admin/`);
    if (!config.publicBaseUrl) {
      console.log('Set PUBLIC_BASE_URL after starting a tunnel so printed QR codes use the tunnel URL.');
    }
  });

  let cleanupTimer = null;
  let shuttingDown = false;

  const runPendingOrderCleanup = async () => {
    try {
      const cancelled = await orderService.cancelStalePendingOrders(
        config.pendingOrderTtlMinutes
      );
      if (cancelled > 0) {
        console.log(`Cancelled ${cancelled} stale unpaid order(s).`);
      }
    } catch (error) {
      console.error('Could not clean up stale unpaid orders:', error.message);
    }
  };

  if (config.pendingOrderTtlMinutes > 0) {
    runPendingOrderCleanup();
    cleanupTimer = setInterval(runPendingOrderCleanup, 5 * 60 * 1000);
    cleanupTimer.unref();
  }

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}. Shutting down...`);

    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }

    io.close(async () => {
      try {
        await db.closePool();
      } catch (error) {
        console.error('Could not close the database pool:', error.message);
      }
      process.exitCode = 0;
    });

    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Failed to start QuickBite:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  start
};
