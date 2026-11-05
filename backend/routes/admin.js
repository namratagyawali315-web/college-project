const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const config = require('../config');
const db = require('../db');
const { AppError, asyncHandler } = require('../lib/errors');
const {
  text,
  optionalText,
  parseId,
  parseInteger,
  parseBoolean,
  parsePricePaisa,
  normalizeDateRange,
  normalizeBaseUrl,
  isDateOnly
} = require('../lib/validation');
const { randomToken } = require('../lib/tokens');
const {
  publicAdmin,
  signAdminToken,
  setAdminCookie,
  clearAdminCookie,
  requireAdmin,
  verifySameOrigin
} = require('../middleware/auth');
const {
  uploadMenuImage,
  validateMenuImage,
  removeUploadedFile,
  removeStoredImage
} = require('../middleware/upload');
const {
  loginLimiter,
  adminApiLimiter,
  passwordChangeLimiter,
  uploadLimiter
} = require('../middleware/rateLimits');
const orderService = require('../services/orderService');
const settingsService = require('../services/settingsService');
const { emitOrderUpdate } = require('../lib/realtime');

const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('quickbite-dummy-password', BCRYPT_ROUNDS);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
    itemCount: row.item_count === undefined ? undefined : Number(row.item_count),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapMenuItem(row) {
  const pricePaisa = Number(row.price_paisa);
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    name: row.name,
    description: row.description || null,
    pricePaisa,
    price: pricePaisa / 100,
    imagePath: row.image_path || null,
    imageUrl: row.image_path || null,
    isAvailable: Boolean(row.is_available),
    isArchived: Boolean(row.is_archived),
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function getCategoryOrThrow(categoryId) {
  const rows = await db.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [categoryId]);
  if (!rows[0]) {
    throw new AppError(404, 'Category not found.', 'CATEGORY_NOT_FOUND');
  }
  return rows[0];
}

async function getMenuItemOrThrow(itemId) {
  const rows = await db.query(
    `SELECT mi.*, c.name AS category_name
     FROM menu_items mi
     JOIN categories c ON c.id = mi.category_id
     WHERE mi.id = ?
     LIMIT 1`,
    [itemId]
  );
  if (!rows[0]) {
    throw new AppError(404, 'Menu item not found.', 'MENU_ITEM_NOT_FOUND');
  }
  return rows[0];
}

async function getTableOrThrow(tableId) {
  const rows = await db.query('SELECT * FROM dining_tables WHERE id = ? LIMIT 1', [tableId]);
  if (!rows[0]) {
    throw new AppError(404, 'Table not found.', 'TABLE_NOT_FOUND');
  }
  return rows[0];
}

async function getQrBaseUrl(req) {
  const settings = await settingsService.getSettings(['qr_base_url']);
  if (settings.qr_base_url) {
    return settings.qr_base_url.replace(/\/+$/, '');
  }
  if (config.publicBaseUrl) {
    return config.publicBaseUrl;
  }
  return `${req.protocol}://${req.get('host')}`;
}

function serializeTable(row, baseUrl) {
  return {
    id: row.id,
    number: row.table_number,
    label: row.label || null,
    isActive: Boolean(row.is_active),
    qrToken: row.qr_token,
    scanUrl: `${baseUrl}/scan/${row.qr_token}`,
    qrImageUrl: `/api/admin/tables/${row.id}/qr.png`,
    activeOrders: row.active_orders === undefined ? undefined : Number(row.active_orders),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function parseOptionalDateFilter(value, field) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const result = String(value);
  if (!isDateOnly(result)) {
    throw new AppError(400, `${field} must use the YYYY-MM-DD format.`, 'VALIDATION_ERROR', {
      field
    });
  }
  return result;
}

function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError(400, 'New password must be between 8 and 128 characters.', 'VALIDATION_ERROR', {
      field: 'newPassword'
    });
  }
}

function createAdminRouter(io) {
  const router = express.Router();
  router.use(verifySameOrigin);

  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const username = text(body.username, 'Username', { required: true, max: 50 });
      const password = typeof body.password === 'string' ? body.password : '';

      if (!password || password.length > 200) {
        throw new AppError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
      }

      const rows = await db.query(
        `SELECT id, username, display_name, password_hash, token_version, last_login_at
         FROM admins
         WHERE username = ?
         LIMIT 1`,
        [username]
      );
      const admin = rows[0] || null;
      const passwordMatches = await bcrypt.compare(
        password,
        admin?.password_hash || DUMMY_PASSWORD_HASH
      );

      if (!admin || !passwordMatches) {
        throw new AppError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
      }

      await db.query('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);
      const token = signAdminToken(admin);
      setAdminCookie(res, token);

      res.json({
        admin: publicAdmin({
          ...admin,
          last_login_at: admin.last_login_at || new Date().toISOString()
        })
      });
    })
  );

  router.post('/logout', (req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  router.use(requireAdmin);
  router.use(adminApiLimiter);

  router.get('/me', (req, res) => {
    res.json({ admin: req.admin });
  });

  router.put(
    '/password',
    passwordChangeLimiter,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = body.newPassword;

      if (!currentPassword) {
        throw new AppError(400, 'Current password is required.', 'VALIDATION_ERROR', {
          field: 'currentPassword'
        });
      }

      validateNewPassword(newPassword);

      const rows = await db.query(
        'SELECT id, password_hash, token_version FROM admins WHERE id = ? LIMIT 1',
        [req.admin.id]
      );
      const admin = rows[0];

      if (!admin || !(await bcrypt.compare(currentPassword, admin.password_hash))) {
        throw new AppError(400, 'Current password is incorrect.', 'INVALID_PASSWORD');
      }

      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await db.withTransaction(async (connection) => {
        await connection.execute(
          `UPDATE admins
           SET password_hash = ?, token_version = token_version + 1
           WHERE id = ?`,
          [passwordHash, admin.id]
        );
      });

      const updatedRows = await db.query('SELECT token_version FROM admins WHERE id = ?', [admin.id]);
      const token = signAdminToken({
        id: admin.id,
        username: req.admin.username,
        token_version: updatedRows[0].token_version
      });
      setAdminCookie(res, token);
      io.in(`admin:${admin.id}`).disconnectSockets(true);

      res.json({ ok: true, message: 'Password updated successfully.' });
    })
  );

  router.get(
    '/dashboard',
    asyncHandler(async (req, res) => {
      const dashboard = await orderService.getDashboardData();
      res.json(dashboard);
    })
  );

  router.get(
    '/orders',
    asyncHandler(async (req, res) => {
      const status = req.query.status ? String(req.query.status) : '';
      const search = req.query.search ? text(req.query.search, 'Search', { max: 100 }) : '';
      const from = parseOptionalDateFilter(req.query.from, 'from');
      const to = parseOptionalDateFilter(req.query.to, 'to');
      const page = parseInteger(req.query.page, 'page', { min: 1, max: 100000, fallback: 1 });
      const limit = parseInteger(req.query.limit, 'limit', { min: 1, max: 100, fallback: 25 });

      const result = await orderService.listAdminOrders({
        status: status || null,
        search,
        from,
        to,
        page,
        limit
      });

      res.json(result);
    })
  );

  router.get(
    '/orders/:id',
    asyncHandler(async (req, res) => {
      const orderId = parseId(req.params.id, 'orderId');
      const order = await orderService.getAdminOrder(orderId);
      res.json({ order });
    })
  );

  router.patch(
    '/orders/:id/status',
    asyncHandler(async (req, res) => {
      const orderId = parseId(req.params.id, 'orderId');
      const status = text(req.body?.status, 'Order status', { required: true, max: 30 });
      const order = await orderService.updateOrderStatus(orderId, status);
      emitOrderUpdate(io, order);
      res.json({ order });
    })
  );

  router.get(
    '/categories',
    asyncHandler(async (req, res) => {
      const rows = await db.query(
        `SELECT c.*, COUNT(mi.id) AS item_count
         FROM categories c
         LEFT JOIN menu_items mi ON mi.category_id = c.id
         GROUP BY c.id
         ORDER BY c.sort_order ASC, c.name ASC`
      );

      res.json({ categories: rows.map(mapCategory) });
    })
  );

  router.post(
    '/categories',
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const name = text(body.name, 'Category name', { required: true, min: 2, max: 80 });
      const sortOrder = parseInteger(body.sortOrder, 'Sort order', {
        min: -10000,
        max: 10000,
        fallback: 0
      });
      const isActive = parseBoolean(body.isActive, 'isActive', true);

      const result = await db.query(
        'INSERT INTO categories (name, sort_order, is_active) VALUES (?, ?, ?)',
        [name, sortOrder, isActive ? 1 : 0]
      );
      const category = await getCategoryOrThrow(result.insertId);
      res.status(201).json({ category: mapCategory(category) });
    })
  );

  router.patch(
    '/categories/:id',
    asyncHandler(async (req, res) => {
      const categoryId = parseId(req.params.id, 'categoryId');
      const current = await getCategoryOrThrow(categoryId);
      const body = req.body || {};

      const name = hasOwn(body, 'name')
        ? text(body.name, 'Category name', { required: true, min: 2, max: 80 })
        : current.name;
      const sortOrder = hasOwn(body, 'sortOrder')
        ? parseInteger(body.sortOrder, 'Sort order', { min: -10000, max: 10000 })
        : Number(current.sort_order);
      const isActive = hasOwn(body, 'isActive')
        ? parseBoolean(body.isActive, 'isActive', Boolean(current.is_active))
        : Boolean(current.is_active);

      await db.query(
        'UPDATE categories SET name = ?, sort_order = ?, is_active = ? WHERE id = ?',
        [name, sortOrder, isActive ? 1 : 0, categoryId]
      );

      const updated = await getCategoryOrThrow(categoryId);
      res.json({ category: mapCategory(updated) });
    })
  );

  router.delete(
    '/categories/:id',
    asyncHandler(async (req, res) => {
      const categoryId = parseId(req.params.id, 'categoryId');
      await getCategoryOrThrow(categoryId);

      const rows = await db.query(
        'SELECT COUNT(*) AS count FROM menu_items WHERE category_id = ?',
        [categoryId]
      );
      if (Number(rows[0].count) > 0) {
        throw new AppError(
          409,
          'This category still has menu items. Move or archive them before deleting the category.',
          'CATEGORY_IN_USE'
        );
      }

      await db.query('DELETE FROM categories WHERE id = ?', [categoryId]);
      res.json({ ok: true });
    })
  );

  router.get(
    '/menu-items',
    asyncHandler(async (req, res) => {
      const rows = await db.query(
        `SELECT mi.*, c.name AS category_name
         FROM menu_items mi
         JOIN categories c ON c.id = mi.category_id
         ORDER BY c.sort_order ASC, c.name ASC, mi.sort_order ASC, mi.name ASC`
      );

      res.json({ items: rows.map(mapMenuItem) });
    })
  );

  router.post(
    '/menu-items',
    uploadLimiter,
    uploadMenuImage.single('image'),
    validateMenuImage,
    asyncHandler(async (req, res) => {
      try {
        const body = req.body || {};
        const categoryId = parseId(body.categoryId, 'categoryId');
        await getCategoryOrThrow(categoryId);

        const name = text(body.name, 'Item name', { required: true, min: 2, max: 120 });
        const description = optionalText(body.description, 'Description', 1000);
        const pricePaisa = parsePricePaisa(body.price, 'price');
        const isAvailable = parseBoolean(body.isAvailable, 'isAvailable', true);
        const sortOrder = parseInteger(body.sortOrder, 'Sort order', {
          min: -10000,
          max: 10000,
          fallback: 0
        });
        const imagePath = req.file ? `/uploads/menu/${req.file.filename}` : null;

        const result = await db.query(
          `INSERT INTO menu_items
            (category_id, name, description, price_paisa, image_path, is_available, is_archived, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
          [categoryId, name, description, pricePaisa, imagePath, isAvailable ? 1 : 0, sortOrder]
        );

        const item = await getMenuItemOrThrow(result.insertId);
        res.status(201).json({ item: mapMenuItem(item) });
      } catch (error) {
        await removeUploadedFile(req.file);
        throw error;
      }
    })
  );

  router.patch(
    '/menu-items/:id',
    uploadLimiter,
    uploadMenuImage.single('image'),
    validateMenuImage,
    asyncHandler(async (req, res) => {
      let imageStored = false;

      try {
        const itemId = parseId(req.params.id, 'itemId');
        const current = await getMenuItemOrThrow(itemId);
        const body = req.body || {};

        const name = hasOwn(body, 'name')
          ? text(body.name, 'Item name', { required: true, min: 2, max: 120 })
          : current.name;
        const description = hasOwn(body, 'description')
          ? optionalText(body.description, 'Description', 1000)
          : current.description;
        const pricePaisa = hasOwn(body, 'price')
          ? parsePricePaisa(body.price, 'price')
          : Number(current.price_paisa);
        const categoryId = hasOwn(body, 'categoryId')
          ? parseId(body.categoryId, 'categoryId')
          : current.category_id;

        if (categoryId !== current.category_id) {
          await getCategoryOrThrow(categoryId);
        }

        const isAvailable = hasOwn(body, 'isAvailable')
          ? parseBoolean(body.isAvailable, 'isAvailable')
          : Boolean(current.is_available);
        const isArchived = hasOwn(body, 'isArchived')
          ? parseBoolean(body.isArchived, 'isArchived')
          : Boolean(current.is_archived);
        const sortOrder = hasOwn(body, 'sortOrder')
          ? parseInteger(body.sortOrder, 'Sort order', { min: -10000, max: 10000 })
          : Number(current.sort_order);
        const removeImage = hasOwn(body, 'removeImage')
          ? parseBoolean(body.removeImage, 'removeImage', false)
          : false;

        let imagePath = current.image_path || null;
        if (req.file) {
          imagePath = `/uploads/menu/${req.file.filename}`;
        } else if (removeImage) {
          imagePath = null;
        }

        await db.query(
          `UPDATE menu_items
           SET category_id = ?, name = ?, description = ?, price_paisa = ?,
               image_path = ?, is_available = ?, is_archived = ?, sort_order = ?
           WHERE id = ?`,
          [
            categoryId,
            name,
            description,
            pricePaisa,
            imagePath,
            isAvailable ? 1 : 0,
            isArchived ? 1 : 0,
            sortOrder,
            itemId
          ]
        );

        imageStored = true;

        if (current.image_path && current.image_path !== imagePath) {
          await removeStoredImage(current.image_path);
        }

        const item = await getMenuItemOrThrow(itemId);
        res.json({ item: mapMenuItem(item) });
      } catch (error) {
        if (req.file && !imageStored) {
          await removeUploadedFile(req.file);
        }
        throw error;
      }
    })
  );

  router.delete(
    '/menu-items/:id',
    asyncHandler(async (req, res) => {
      const itemId = parseId(req.params.id, 'itemId');
      await getMenuItemOrThrow(itemId);
      await db.query('UPDATE menu_items SET is_archived = 1, is_available = 0 WHERE id = ?', [itemId]);
      res.json({ ok: true });
    })
  );

  router.get(
    '/tables',
    asyncHandler(async (req, res) => {
      const baseUrl = await getQrBaseUrl(req);
      const rows = await db.query(
        `SELECT t.*,
                (SELECT COUNT(*)
                 FROM orders o
                 WHERE o.table_id = t.id
                   AND o.status IN ('placed', 'preparing', 'ready')) AS active_orders
         FROM dining_tables t
         ORDER BY CAST(t.table_number AS UNSIGNED) ASC, t.table_number ASC`
      );

      res.json({ tables: rows.map((row) => serializeTable(row, baseUrl)) });
    })
  );

  router.post(
    '/tables',
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const tableNumber = text(body.tableNumber, 'Table number', {
        required: true,
        max: 20
      });
      const label = optionalText(body.label, 'Table label', 80);
      const isActive = parseBoolean(body.isActive, 'isActive', true);
      const qrToken = randomToken(32);

      const result = await db.query(
        `INSERT INTO dining_tables (table_number, label, qr_token, is_active)
         VALUES (?, ?, ?, ?)`,
        [tableNumber, label, qrToken, isActive ? 1 : 0]
      );

      const table = await getTableOrThrow(result.insertId);
      const baseUrl = await getQrBaseUrl(req);
      res.status(201).json({ table: serializeTable(table, baseUrl) });
    })
  );

  router.patch(
    '/tables/:id',
    asyncHandler(async (req, res) => {
      const tableId = parseId(req.params.id, 'tableId');
      const current = await getTableOrThrow(tableId);
      const body = req.body || {};

      const tableNumber = hasOwn(body, 'tableNumber')
        ? text(body.tableNumber, 'Table number', { required: true, max: 20 })
        : current.table_number;
      const label = hasOwn(body, 'label')
        ? optionalText(body.label, 'Table label', 80)
        : current.label;
      const isActive = hasOwn(body, 'isActive')
        ? parseBoolean(body.isActive, 'isActive', Boolean(current.is_active))
        : Boolean(current.is_active);

      await db.query(
        'UPDATE dining_tables SET table_number = ?, label = ?, is_active = ? WHERE id = ?',
        [tableNumber, label, isActive ? 1 : 0, tableId]
      );

      const table = await getTableOrThrow(tableId);
      const baseUrl = await getQrBaseUrl(req);
      res.json({ table: serializeTable(table, baseUrl) });
    })
  );

  router.post(
    '/tables/:id/regenerate-token',
    asyncHandler(async (req, res) => {
      const tableId = parseId(req.params.id, 'tableId');
      await getTableOrThrow(tableId);
      await db.query('UPDATE dining_tables SET qr_token = ? WHERE id = ?', [
        randomToken(32),
        tableId
      ]);

      const table = await getTableOrThrow(tableId);
      const baseUrl = await getQrBaseUrl(req);
      res.json({ table: serializeTable(table, baseUrl) });
    })
  );

  router.get(
    '/tables/:id/qr.png',
    asyncHandler(async (req, res) => {
      const tableId = parseId(req.params.id, 'tableId');
      const table = await getTableOrThrow(tableId);
      const baseUrl = await getQrBaseUrl(req);
      const scanUrl = `${baseUrl}/scan/${table.qr_token}`;
      const buffer = await QRCode.toBuffer(scanUrl, {
        type: 'png',
        width: 700,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#14532D',
          light: '#FFFFFF'
        }
      });

      const safeName = String(table.table_number).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30);
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.set({
        'Content-Type': 'image/png',
        'Content-Disposition': `${disposition}; filename="table-${safeName || table.id}.png"`,
        'Cache-Control': 'no-store'
      });
      res.send(buffer);
    })
  );

  router.delete(
    '/tables/:id',
    asyncHandler(async (req, res) => {
      const tableId = parseId(req.params.id, 'tableId');
      await getTableOrThrow(tableId);

      const rows = await db.query(
        'SELECT COUNT(*) AS count FROM orders WHERE table_id = ? OR scanned_table_id = ?',
        [tableId, tableId]
      );
      if (Number(rows[0].count) > 0) {
        throw new AppError(
          409,
          'This table has order history. Deactivate it instead of deleting it.',
          'TABLE_IN_USE'
        );
      }

      await db.query('DELETE FROM dining_tables WHERE id = ?', [tableId]);
      res.json({ ok: true });
    })
  );

  router.get(
    '/settings',
    asyncHandler(async (req, res) => {
      const settings = await settingsService.getSettings(['canteen_name', 'qr_base_url']);
      const baseUrl = await getQrBaseUrl(req);
      res.json({
        settings: {
          canteenName: settings.canteen_name,
          qrBaseUrl: settings.qr_base_url,
          resolvedQrBaseUrl: baseUrl
        }
      });
    })
  );

  router.put(
    '/settings',
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const updates = {};

      if (hasOwn(body, 'canteenName')) {
        updates.canteen_name = text(body.canteenName, 'Canteen name', {
          required: true,
          min: 2,
          max: 80
        });
      }

      if (hasOwn(body, 'qrBaseUrl')) {
        updates.qr_base_url = normalizeBaseUrl(body.qrBaseUrl);
      }

      if (Object.keys(updates).length > 0) {
        await settingsService.updateSettings(updates);
      }

      const settings = await settingsService.getSettings(['canteen_name', 'qr_base_url']);
      const baseUrl = await getQrBaseUrl(req);
      res.json({
        settings: {
          canteenName: settings.canteen_name,
          qrBaseUrl: settings.qr_base_url,
          resolvedQrBaseUrl: baseUrl
        }
      });
    })
  );

  router.get(
    '/reports/sales',
    asyncHandler(async (req, res) => {
      const { from, to } = normalizeDateRange(req.query.from, req.query.to, 30);
      const report = await orderService.getSalesReport(from, to);
      res.json({ from, to, ...report });
    })
  );

  return router;
}

module.exports = createAdminRouter;
