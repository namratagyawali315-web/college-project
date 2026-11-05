const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { AppError } = require('../lib/errors');

const JWT_ISSUER = 'quickbite';
const JWT_AUDIENCE = 'quickbite-admin';

function publicAdmin(admin) {
  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.display_name,
    lastLoginAt: admin.last_login_at || null
  };
}

function signAdminToken(admin) {
  return jwt.sign(
    {
      username: admin.username,
      tokenVersion: Number(admin.token_version)
    },
    config.jwt.secret,
    {
      algorithm: 'HS256',
      subject: String(admin.id),
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: config.jwt.expiresIn
    }
  );
}

async function getAdminFromToken(token) {
  if (!token) {
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
  } catch {
    return null;
  }

  const adminId = Number(payload.sub);
  if (!Number.isInteger(adminId) || adminId < 1) {
    return null;
  }

  const rows = await db.query(
    `SELECT id, username, display_name, token_version, last_login_at
     FROM admins
     WHERE id = ?
     LIMIT 1`,
    [adminId]
  );
  const admin = rows[0];

  if (!admin || Number(admin.token_version) !== Number(payload.tokenVersion)) {
    return null;
  }

  return publicAdmin(admin);
}

function adminCookieMaxAge(token) {
  const decoded = jwt.decode(token);

  if (!decoded || typeof decoded !== 'object' || !Number.isFinite(Number(decoded.exp))) {
    return undefined;
  }

  return Math.max(0, Number(decoded.exp) * 1000 - Date.now());
}

function setAdminCookie(res, token) {
  res.cookie(config.jwt.cookieName, token, {
    httpOnly: true,
    secure: config.jwt.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: adminCookieMaxAge(token)
  });
}

function clearAdminCookie(res) {
  res.clearCookie(config.jwt.cookieName, {
    httpOnly: true,
    secure: config.jwt.cookieSecure,
    sameSite: 'lax',
    path: '/'
  });
}

async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.[config.jwt.cookieName];
    const admin = await getAdminFromToken(token);

    if (!admin) {
      throw new AppError(401, 'Your admin session is missing or has expired.', 'UNAUTHORIZED');
    }

    req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
}

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:(80|443)$/, '');
}

function verifySameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const origin = req.get('origin');
  const requestHost = normalizeHost(req.get('host'));

  if (!origin || !requestHost) {
    return next(new AppError(403, 'Cross-origin admin request blocked.', 'FORBIDDEN'));
  }

  let originHost;
  try {
    originHost = normalizeHost(new URL(origin).host);
  } catch {
    return next(new AppError(403, 'Cross-origin admin request blocked.', 'FORBIDDEN'));
  }

  if (originHost !== requestHost) {
    return next(new AppError(403, 'Cross-origin admin request blocked.', 'FORBIDDEN'));
  }

  next();
}

module.exports = {
  publicAdmin,
  signAdminToken,
  getAdminFromToken,
  setAdminCookie,
  clearAdminCookie,
  requireAdmin,
  verifySameOrigin
};
