const express = require('express');
const db = require('../db');
const { AppError, asyncHandler } = require('../lib/errors');
const {
  text,
  optionalText,
  parseId,
  normalizePhone,
  normalizeItems,
  parsePaymentOutcome
} = require('../lib/validation');
const orderService = require('../services/orderService');
const settingsService = require('../services/settingsService');
const { emitNewOrder, emitCustomerStatus } = require('../lib/realtime');
const {
  publicReadLimiter,
  orderTrackingLimiter,
  orderLimiter,
  paymentLimiter
} = require('../middleware/rateLimits');

function trackingTokenFromRequest(req) {
  return text(req.get('x-order-token'), 'Order token', { required: true, max: 128 });
}

function createPublicRouter(io) {
  const router = express.Router();

  router.get(
    '/health',
    publicReadLimiter,
    asyncHandler(async (req, res) => {
      await db.query('SELECT 1');
      res.json({
        ok: true,
        service: 'quickbite',
        timestamp: new Date().toISOString()
      });
    })
  );

  router.get(
    '/config',
    publicReadLimiter,
    asyncHandler(async (req, res) => {
      const settings = await settingsService.getSettings(['canteen_name']);
      res.json({
        canteenName: settings.canteen_name,
        currency: 'NPR',
        paymentMode: 'demo',
        demoNotice: 'Demo payment only. No real money is charged.'
      });
    })
  );

  router.get(
    '/menu',
    publicReadLimiter,
    asyncHandler(async (req, res) => {
      const rows = await db.query(
        `SELECT c.id AS category_id,
                c.name AS category_name,
                c.sort_order AS category_sort_order,
                mi.id AS item_id,
                mi.name AS item_name,
                mi.description AS item_description,
                mi.price_paisa,
                mi.image_path,
                mi.sort_order AS item_sort_order
         FROM categories c
         JOIN menu_items mi ON mi.category_id = c.id
         WHERE c.is_active = 1
           AND mi.is_available = 1
           AND mi.is_archived = 0
         ORDER BY c.sort_order ASC, c.name ASC, mi.sort_order ASC, mi.name ASC`
      );

      const categories = [];
      const categoryMap = new Map();

      for (const row of rows) {
        let category = categoryMap.get(row.category_id);
        if (!category) {
          category = {
            id: row.category_id,
            name: row.category_name,
            items: []
          };
          categoryMap.set(row.category_id, category);
          categories.push(category);
        }

        category.items.push({
          id: row.item_id,
          name: row.item_name,
          description: row.item_description || null,
          pricePaisa: Number(row.price_paisa),
          imageUrl: row.image_path || null
        });
      }

      const settings = await settingsService.getSettings(['canteen_name']);
      res.json({
        canteenName: settings.canteen_name,
        currency: 'NPR',
        categories
      });
    })
  );

  router.get(
    '/tables',
    publicReadLimiter,
    asyncHandler(async (req, res) => {
      const rows = await db.query(
        `SELECT id, table_number, label
         FROM dining_tables
         WHERE is_active = 1
         ORDER BY CAST(table_number AS UNSIGNED) ASC, table_number ASC`
      );

      res.json({
        tables: rows.map((row) => ({
          id: row.id,
          number: row.table_number,
          label: row.label || null
        }))
      });
    })
  );

  router.get(
    '/tables/:token',
    publicReadLimiter,
    asyncHandler(async (req, res) => {
      const token = text(req.params.token, 'Table token', { required: true, max: 128 });
      const rows = await db.query(
        `SELECT id, table_number, label
         FROM dining_tables
         WHERE qr_token = ? AND is_active = 1
         LIMIT 1`,
        [token]
      );
      const table = rows[0];

      if (!table) {
        throw new AppError(404, 'This table QR code is invalid or inactive.', 'TABLE_NOT_FOUND');
      }

      res.json({
        table: {
          id: table.id,
          number: table.table_number,
          label: table.label || null
        }
      });
    })
  );

  router.post(
    '/orders',
    orderLimiter,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const tableId =
        body.tableId === undefined || body.tableId === null || body.tableId === ''
          ? null
          : parseId(body.tableId, 'tableId');
      const scannedTableToken = optionalText(body.scannedTableToken, 'scannedTableToken', 128);
      const customerName = text(body.customerName, 'Name', { required: true, min: 2, max: 100 });
      const customerPhone = normalizePhone(body.phone);
      const notes = optionalText(body.notes, 'Order notes', 500);
      const items = normalizeItems(body.items);

      const result = await orderService.createOrder({
        tableId,
        scannedTableToken,
        customerName,
        customerPhone,
        notes,
        items
      });

      res.status(201).json(result);
    })
  );

  router.get(
    '/orders/:id',
    orderTrackingLimiter,
    asyncHandler(async (req, res) => {
      const orderId = parseId(req.params.id, 'orderId');
      const trackingToken = trackingTokenFromRequest(req);
      const order = await orderService.getCustomerOrder(orderId, trackingToken);

      res.json({ order });
    })
  );

  router.post(
    '/orders/:id/pay',
    paymentLimiter,
    asyncHandler(async (req, res) => {
      const orderId = parseId(req.params.id, 'orderId');
      const body = req.body || {};
      const trackingToken = trackingTokenFromRequest(req);
      const outcome = parsePaymentOutcome(body.outcome);
      const result = await orderService.payForOrder(orderId, trackingToken, outcome);

      if (result.newlyPaid) {
        const adminOrder = await orderService.getAdminOrder(orderId);
        emitNewOrder(io, adminOrder);
      } else {
        emitCustomerStatus(io, result.order);
      }

      res.json({
        order: result.order,
        paid: result.order.paymentStatus === 'paid'
      });
    })
  );

  return router;
}

module.exports = createPublicRouter;
