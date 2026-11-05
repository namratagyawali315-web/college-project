const rateLimit = require('express-rate-limit');

function createRateLimiter({ windowMs, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message
      }
    }
  });
}

const publicReadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  message: 'Too many requests. Please wait and try again.'
});

const orderTrackingLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  message: 'Too many tracking requests. Please wait and try again.'
});

const adminApiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  message: 'Too many admin requests. Please wait and try again.'
});

const passwordChangeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many password change attempts. Please wait 15 minutes and try again.'
});

const uploadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many image uploads. Please wait and try again.'
});

const orderLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: 'Too many order attempts. Please wait and try again.'
});

const paymentLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  message: 'Too many payment attempts. Please wait and try again.'
});

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts. Please wait 15 minutes and try again.'
});

module.exports = {
  publicReadLimiter,
  orderTrackingLimiter,
  adminApiLimiter,
  passwordChangeLimiter,
  uploadLimiter,
  orderLimiter,
  paymentLimiter,
  loginLimiter
};
