const { Server } = require('socket.io');
const { parseCookie } = require('cookie');
const config = require('./config');
const { getAdminFromToken } = require('./middleware/auth');
const orderService = require('./services/orderService');

const TRACK_WINDOW_MS = 60 * 1000;
const TRACK_ATTEMPTS_PER_WINDOW = 10;

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:(80|443)$/, '');
}

function matchesSocketHost(value, host) {
  try {
    return normalizeHost(new URL(value).host) === host;
  } catch {
    return false;
  }
}

function isAllowedSocketHandshake(headers, hasAdminCookie) {
  const host = normalizeHost(headers.host);
  const origin = headers.origin;
  const referer = headers.referer;
  const fetchSite = String(headers['sec-fetch-site'] || '').toLowerCase();

  if (!host) {
    return false;
  }

  if (origin) {
    return matchesSocketHost(origin, host);
  }

  if (referer) {
    return matchesSocketHost(referer, host);
  }

  if (fetchSite) {
    return fetchSite === 'same-origin' || fetchSite === 'none';
  }

  return !hasAdminCookie;
}

function hasAdminCookie(headers) {
  try {
    const cookies = parseCookie(headers.cookie || '');
    return Boolean(cookies[config.jwt.cookieName]);
  } catch {
    return false;
  }
}

function consumeTrackAttempt(socket) {
  const now = Date.now();

  if (!socket.data.trackWindowStart || now - socket.data.trackWindowStart >= TRACK_WINDOW_MS) {
    socket.data.trackWindowStart = now;
    socket.data.trackAttempts = 0;
  }

  if (socket.data.trackAttempts >= TRACK_ATTEMPTS_PER_WINDOW) {
    return false;
  }

  socket.data.trackAttempts += 1;
  return true;
}

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    serveClient: true,
    maxHttpBufferSize: 64 * 1024,
    pingTimeout: 30000,
    pingInterval: 25000,
    allowRequest: (request, callback) => {
      callback(null, isAllowedSocketHandshake(request.headers, hasAdminCookie(request.headers)));
    }
  });

  io.use(async (socket, next) => {
    let token = '';

    try {
      const cookies = parseCookie(socket.handshake.headers.cookie || '');
      token = cookies[config.jwt.cookieName] || '';
      socket.data.admin = token ? await getAdminFromToken(token) : null;
    } catch {
      socket.data.admin = null;
    }

    if (!isAllowedSocketHandshake(socket.handshake.headers, Boolean(token))) {
      next(new Error('Connection origin is not allowed.'));
      return;
    }

    next();
  });

  io.on('connection', (socket) => {
    if (socket.data.admin) {
      socket.join('admin');
      socket.join(`admin:${socket.data.admin.id}`);
    }

    socket.on('track:order', async (payload, acknowledge) => {
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};

      if (!consumeTrackAttempt(socket)) {
        respond({ ok: false, error: 'Too many tracking attempts. Please try again shortly.' });
        return;
      }

      const orderId = Number(payload?.orderId);
      const token = typeof payload?.token === 'string' ? payload.token : '';

      if (!Number.isInteger(orderId) || orderId < 1 || !token) {
        respond({ ok: false, error: 'Invalid order tracking request.' });
        return;
      }

      try {
        const allowed = await orderService.verifyOrderTrackingToken(orderId, token);
        if (!allowed) {
          respond({ ok: false, error: 'Order not found.' });
          return;
        }

        socket.join(`order:${orderId}`);
        respond({ ok: true });
      } catch {
        respond({ ok: false, error: 'Could not track this order.' });
      }
    });
  });

  return io;
}

module.exports = createSocketServer;
