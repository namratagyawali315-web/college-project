const path = require('node:path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

function toInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function trimTrailingSlash(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function parseTrustProxy(value) {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!raw) {
    return false;
  }

  const normalized = raw.toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return 1;
  }

  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  return raw;
}

function isWeakJwtSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    return true;
  }

  return /(change[-_ ]?me|replace[-_ ]?this|development[-_ ]?secret|example[-_ ]?secret)/i.test(
    secret
  );
}

const env = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'quickbite-development-secret-change-me';
const pendingOrderTtlMinutes = toInteger(process.env.PENDING_ORDER_TTL_MINUTES, 45, {
  min: 0,
  max: 10080
});

const config = {
  env,
  isProduction: env === 'production',
  rootDir,
  port: toInteger(process.env.PORT, 3000, { min: 1, max: 65535 }),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  pendingOrderTtlMinutes,
  publicDir: path.join(rootDir, 'frontend'),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInteger(process.env.DB_PORT, 3306, { min: 1, max: 65535 }),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'quickbite',
    connectionLimit: toInteger(process.env.DB_CONNECTION_LIMIT, 10, { min: 1, max: 50 })
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    cookieName: 'qb_admin',
    cookieSecure: toBoolean(process.env.COOKIE_SECURE, env === 'production')
  },
  adminSeed: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
    displayName: process.env.ADMIN_DISPLAY_NAME || 'Canteen Admin'
  },
  publicBaseUrl: trimTrailingSlash(process.env.PUBLIC_BASE_URL),
  uploads: {
    root: path.join(__dirname, 'uploads'),
    dir: path.join(__dirname, 'uploads', 'menu'),
    maxBytes: toInteger(process.env.MAX_UPLOAD_MB, 2, { min: 1, max: 10 }) * 1024 * 1024
  }
};

if (config.isProduction) {
  if (isWeakJwtSecret(process.env.JWT_SECRET)) {
    throw new Error(
      'JWT_SECRET must be a unique random value of at least 32 characters when NODE_ENV=production.'
    );
  }

  if (!config.jwt.cookieSecure) {
    throw new Error('COOKIE_SECURE must be true when NODE_ENV=production.');
  }
}

module.exports = config;
