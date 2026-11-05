const { AppError } = require('./errors');

function stringValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function text(value, field, { required = false, min = 0, max = 255 } = {}) {
  const result = stringValue(value).trim();

  if (required && !result) {
    throw new AppError(400, `${field} is required.`, 'VALIDATION_ERROR', { field });
  }

  if (result && result.length < min) {
    throw new AppError(400, `${field} must be at least ${min} characters.`, 'VALIDATION_ERROR', { field });
  }

  if (result.length > max) {
    throw new AppError(400, `${field} must be at most ${max} characters.`, 'VALIDATION_ERROR', { field });
  }

  return result;
}

function optionalText(value, field, max = 500) {
  const result = text(value, field, { max });
  return result || null;
}

function parseId(value, field = 'id') {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > Number.MAX_SAFE_INTEGER) {
    throw new AppError(400, `${field} must be a positive integer.`, 'VALIDATION_ERROR', { field });
  }
  return result;
}

function parseInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) {
    return fallback;
  }

  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new AppError(400, `${field} must be an integer between ${min} and ${max}.`, 'VALIDATION_ERROR', {
      field
    });
  }

  return result;
}

function parseBoolean(value, field = 'value', fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new AppError(400, `${field} must be true or false.`, 'VALIDATION_ERROR', { field });
}

function parsePricePaisa(value, field = 'price') {
  const raw = stringValue(value).trim();

  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) {
    throw new AppError(400, `${field} must be a valid amount with up to two decimals.`, 'VALIDATION_ERROR', {
      field
    });
  }

  const paisa = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(paisa) || paisa < 1) {
    throw new AppError(400, `${field} must be greater than zero.`, 'VALIDATION_ERROR', { field });
  }

  return paisa;
}

function normalizePhone(value) {
  const raw = text(value, 'Phone number', { required: true, min: 7, max: 30 });
  const normalized = raw.replace(/[\s()-]/g, '');

  if (!/^\+?\d{7,15}$/.test(normalized)) {
    throw new AppError(400, 'Enter a valid phone number.', 'VALIDATION_ERROR', {
      field: 'phone'
    });
  }

  return normalized;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(400, 'Add at least one food item to the order.', 'VALIDATION_ERROR', {
      field: 'items'
    });
  }

  if (items.length > 50) {
    throw new AppError(400, 'Too many order items.', 'VALIDATION_ERROR', { field: 'items' });
  }

  const combined = new Map();

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      throw new AppError(400, 'Each order item is invalid.', 'VALIDATION_ERROR', { field: 'items' });
    }

    const menuItemId = parseId(item.menuItemId ?? item.id, 'menuItemId');
    const quantity = parseInteger(item.quantity, 'quantity', { min: 1, max: 20 });
    const totalQuantity = (combined.get(menuItemId) || 0) + quantity;

    if (totalQuantity > 20) {
      throw new AppError(400, 'The maximum quantity for one item is 20.', 'VALIDATION_ERROR', {
        field: 'quantity'
      });
    }

    combined.set(menuItemId, totalQuantity);
  }

  return Array.from(combined, ([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateRange(fromValue, toValue, defaultDays = 30) {
  const now = new Date();
  const to = toValue ? String(toValue) : toDateOnly(now);
  let from = fromValue ? String(fromValue) : '';

  if (!from) {
    const start = new Date(now);
    start.setDate(start.getDate() - (defaultDays - 1));
    from = toDateOnly(start);
  }

  if (!isDateOnly(from) || !isDateOnly(to)) {
    throw new AppError(400, 'Dates must use the YYYY-MM-DD format.', 'VALIDATION_ERROR', {
      field: 'date'
    });
  }

  if (from > to) {
    throw new AppError(400, 'The start date cannot be after the end date.', 'VALIDATION_ERROR', {
      field: 'date'
    });
  }

  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  if (toTime - fromTime > 366 * 24 * 60 * 60 * 1000) {
    throw new AppError(400, 'The date range cannot exceed 366 days.', 'VALIDATION_ERROR', {
      field: 'date'
    });
  }

  return { from, to };
}

function normalizeBaseUrl(value) {
  const raw = text(value, 'QR base URL', { max: 500 });
  if (!raw) {
    return '';
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'QR base URL must be a valid URL.', 'VALIDATION_ERROR', {
      field: 'qrBaseUrl'
    });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AppError(400, 'QR base URL must start with http:// or https://.', 'VALIDATION_ERROR', {
      field: 'qrBaseUrl'
    });
  }

  if (url.username || url.password) {
    throw new AppError(400, 'QR base URL cannot contain credentials.', 'VALIDATION_ERROR', {
      field: 'qrBaseUrl'
    });
  }

  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function parsePaymentOutcome(value) {
  if (value === undefined || value === null || value === '') {
    return 'success';
  }

  const normalized = String(value).trim().toLowerCase();
  if (['success', 'paid'].includes(normalized)) {
    return 'success';
  }
  if (['failure', 'failed', 'cancel'].includes(normalized)) {
    return 'failure';
  }

  throw new AppError(400, 'Payment outcome must be success or failure.', 'VALIDATION_ERROR', {
    field: 'outcome'
  });
}

module.exports = {
  text,
  optionalText,
  parseId,
  parseInteger,
  parseBoolean,
  parsePricePaisa,
  normalizePhone,
  normalizeItems,
  isDateOnly,
  normalizeDateRange,
  normalizeBaseUrl,
  parsePaymentOutcome
};
