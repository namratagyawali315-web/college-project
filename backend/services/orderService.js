const db = require('../db');
const { AppError } = require('../lib/errors');
const { generateOrderCode, randomToken, safeEqual } = require('../lib/tokens');

const ORDER_STATUSES = ['pending_payment', 'placed', 'preparing', 'ready', 'completed', 'cancelled'];
const ACTIVE_STATUSES = ['placed', 'preparing', 'ready'];
const STATUS_TRANSITIONS = {
  pending_payment: [],
  placed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

function mapItem(row) {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: row.item_name,
    unitPricePaisa: Number(row.unit_price_paisa),
    quantity: Number(row.quantity),
    lineTotalPaisa: Number(row.line_total_paisa)
  };
}

function serializeOrder(row, items, { admin = false } = {}) {
  const order = {
    id: row.id,
    orderCode: row.order_code,
    status: row.status,
    paymentStatus: row.payment_status || 'pending',
    table: {
      id: row.table_id,
      number: row.table_number,
      label: row.table_label || null
    },
    customer: admin
      ? {
          name: row.customer_name,
          phone: row.customer_phone
        }
      : {
          name: row.customer_name
        },
    notes: row.notes || null,
    subtotalPaisa: Number(row.subtotal_paisa),
    totalPaisa: Number(row.total_paisa),
    items: items.map(mapItem),
    paidAt: row.paid_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };

  if (admin) {
    order.scannedTable = row.scanned_table_number
      ? {
          id: row.scanned_table_id,
          number: row.scanned_table_number,
          label: row.scanned_table_label || null
        }
      : null;
    order.payment = {
      provider: row.payment_provider || 'esewa_demo',
      reference: row.payment_ref || null,
      paidAt: row.payment_paid_at || null
    };
  }

  return order;
}

function orderSelectSql() {
  return `SELECT o.*,
                 t.table_number,
                 t.label AS table_label,
                 st.table_number AS scanned_table_number,
                 st.label AS scanned_table_label,
                 p.status AS payment_status,
                 p.provider AS payment_provider,
                 p.provider_ref AS payment_ref,
                 p.paid_at AS payment_paid_at
          FROM orders o
          JOIN dining_tables t ON t.id = o.table_id
          LEFT JOIN dining_tables st ON st.id = o.scanned_table_id
          LEFT JOIN payments p ON p.order_id = o.id`;
}

async function getItemsByOrderIds(orderIds, connection = db.pool) {
  if (orderIds.length === 0) {
    return new Map();
  }

  const placeholders = orderIds.map(() => '?').join(', ');
  const [rows] = await connection.query(
    `SELECT id, order_id, menu_item_id, item_name, unit_price_paisa, quantity, line_total_paisa
     FROM order_items
     WHERE order_id IN (${placeholders})
     ORDER BY id ASC`,
    orderIds
  );

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.order_id)) {
      grouped.set(row.order_id, []);
    }
    grouped.get(row.order_id).push(row);
  }

  return grouped;
}

async function getCustomerOrder(orderId, trackingToken) {
  if (!trackingToken) {
    throw new AppError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  }

  const rows = await db.query(`${orderSelectSql()} WHERE o.id = ? LIMIT 1`, [orderId]);
  const row = rows[0];

  if (!row || !safeEqual(row.tracking_token, trackingToken)) {
    throw new AppError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  }

  const itemsByOrder = await getItemsByOrderIds([orderId]);
  return serializeOrder(row, itemsByOrder.get(orderId) || []);
}

async function verifyOrderTrackingToken(orderId, trackingToken) {
  if (!trackingToken) {
    return false;
  }

  const rows = await db.query('SELECT tracking_token FROM orders WHERE id = ? LIMIT 1', [orderId]);
  return Boolean(rows[0] && safeEqual(rows[0].tracking_token, trackingToken));
}

async function createOrder({
  tableId,
  scannedTableToken,
  customerName,
  customerPhone,
  notes,
  items
}) {
  let createdOrderId;
  let trackingToken;

  await db.withTransaction(async (connection) => {
    let scannedTable = null;

    if (scannedTableToken) {
      const [scannedRows] = await connection.execute(
        `SELECT id, table_number, label
         FROM dining_tables
         WHERE qr_token = ? AND is_active = 1
         LIMIT 1`,
        [scannedTableToken]
      );
      scannedTable = scannedRows[0] || null;

      if (!scannedTable) {
        throw new AppError(400, 'This table QR code is invalid or inactive.', 'INVALID_TABLE_QR');
      }
    }

    if (scannedTable && tableId && Number(tableId) !== Number(scannedTable.id)) {
      throw new AppError(
        400,
        'The selected table does not match the scanned QR code.',
        'TABLE_MISMATCH'
      );
    }

    const selectedTableId = tableId || scannedTable?.id;
    if (!selectedTableId) {
      throw new AppError(400, 'Select a table before placing the order.', 'VALIDATION_ERROR', {
        field: 'tableId'
      });
    }

    const [tableRows] = await connection.execute(
      `SELECT id, table_number, label
       FROM dining_tables
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
      [selectedTableId]
    );

    if (!tableRows[0]) {
      throw new AppError(400, 'The selected table is invalid or inactive.', 'INVALID_TABLE');
    }

    const menuItemIds = items.map((item) => item.menuItemId);
    const placeholders = menuItemIds.map(() => '?').join(', ');
    const [menuRows] = await connection.query(
      `SELECT mi.id, mi.name, mi.price_paisa, mi.is_available, mi.is_archived,
              c.is_active AS category_active
       FROM menu_items mi
       JOIN categories c ON c.id = mi.category_id
       WHERE mi.id IN (${placeholders})`,
      menuItemIds
    );

    const menuById = new Map(menuRows.map((row) => [row.id, row]));

    if (menuRows.length !== menuItemIds.length) {
      throw new AppError(409, 'One or more items are no longer on the menu. Refresh and try again.', 'ITEM_UNAVAILABLE');
    }

    for (const item of items) {
      const menuItem = menuById.get(item.menuItemId);
      if (!menuItem || !menuItem.is_available || menuItem.is_archived || !menuItem.category_active) {
        throw new AppError(409, 'One or more items are unavailable right now. Refresh and try again.', 'ITEM_UNAVAILABLE');
      }
    }

    const orderItems = items.map((item) => {
      const menuItem = menuById.get(item.menuItemId);
      return {
        menuItemId: menuItem.id,
        name: menuItem.name,
        unitPricePaisa: Number(menuItem.price_paisa),
        quantity: item.quantity,
        lineTotalPaisa: Number(menuItem.price_paisa) * item.quantity
      };
    });

    const subtotalPaisa = orderItems.reduce((sum, item) => sum + item.lineTotalPaisa, 0);
    const orderCode = generateOrderCode();
    trackingToken = randomToken(32);

    const [insertResult] = await connection.execute(
      `INSERT INTO orders
        (order_code, table_id, scanned_table_id, customer_name, customer_phone, notes,
         status, subtotal_paisa, total_paisa, tracking_token)
       VALUES (?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?)`,
      [
        orderCode,
        selectedTableId,
        scannedTable?.id || null,
        customerName,
        customerPhone,
        notes,
        subtotalPaisa,
        subtotalPaisa,
        trackingToken
      ]
    );

    createdOrderId = insertResult.insertId;

    const itemRows = orderItems.map((item) => [
      createdOrderId,
      item.menuItemId,
      item.name,
      item.unitPricePaisa,
      item.quantity,
      item.lineTotalPaisa
    ]);

    await connection.query(
      `INSERT INTO order_items
        (order_id, menu_item_id, item_name, unit_price_paisa, quantity, line_total_paisa)
       VALUES ?`,
      [itemRows]
    );

    await connection.execute(
      `INSERT INTO payments (order_id, provider, amount_paisa, status)
       VALUES (?, 'esewa_demo', ?, 'pending')`,
      [createdOrderId, subtotalPaisa]
    );
  });

  const order = await getCustomerOrder(createdOrderId, trackingToken);
  return { order, trackingToken };
}

async function payForOrder(orderId, trackingToken, outcome) {
  let newlyPaid = false;

  await db.withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT o.id, o.status, o.tracking_token,
              p.id AS payment_id, p.status AS payment_status
       FROM orders o
       LEFT JOIN payments p ON p.order_id = o.id
       WHERE o.id = ?
       FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];

    if (!order || !safeEqual(order.tracking_token, trackingToken)) {
      throw new AppError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    }

    if (order.status !== 'pending_payment') {
      if (outcome === 'success' && order.payment_status === 'paid') {
        return;
      }
      throw new AppError(409, 'This order can no longer be paid.', 'ORDER_NOT_PAYABLE');
    }

    if (outcome === 'failure') {
      await connection.execute(
        `UPDATE payments SET status = 'failed', provider_ref = NULL, paid_at = NULL
         WHERE id = ?`,
        [order.payment_id]
      );
      return;
    }

    const providerRef = `DEMO-${randomToken(8).toUpperCase()}`;

    await connection.execute(
      `UPDATE payments
       SET status = 'paid', provider_ref = ?, paid_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [providerRef, order.payment_id]
    );

    await connection.execute(
      `UPDATE orders
       SET status = 'placed', paid_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending_payment'`,
      [orderId]
    );

    newlyPaid = true;
  });

  const order = await getCustomerOrder(orderId, trackingToken);
  return { order, newlyPaid };
}

async function getAdminOrder(orderId) {
  const rows = await db.query(`${orderSelectSql()} WHERE o.id = ? LIMIT 1`, [orderId]);
  const row = rows[0];

  if (!row) {
    throw new AppError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  }

  const itemsByOrder = await getItemsByOrderIds([orderId]);
  return serializeOrder(row, itemsByOrder.get(orderId) || [], { admin: true });
}

async function listAdminOrders({ status, search, from, to, page = 1, limit = 25 }) {
  const conditions = [];
  const params = [];

  if (status) {
    if (!ORDER_STATUSES.includes(status)) {
      throw new AppError(400, 'Invalid order status filter.', 'VALIDATION_ERROR', { field: 'status' });
    }
    conditions.push('o.status = ?');
    params.push(status);
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      `(o.order_code LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR t.table_number LIKE ?)`
    );
    params.push(pattern, pattern, pattern, pattern);
  }

  if (from) {
    conditions.push('DATE(o.created_at) >= ?');
    params.push(from);
  }

  if (to) {
    conditions.push('DATE(o.created_at) <= ?');
    params.push(to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const countRows = await db.query(
    `SELECT COUNT(*) AS total
     FROM orders o
     JOIN dining_tables t ON t.id = o.table_id
     ${where}`,
    params
  );

  const rows = await db.query(
    `${orderSelectSql()}
     ${where}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, offset]
  );

  const itemsByOrder = await getItemsByOrderIds(rows.map((row) => row.id));
  const orders = rows.map((row) =>
    serializeOrder(row, itemsByOrder.get(row.id) || [], { admin: true })
  );

  const total = Number(countRows[0]?.total || 0);

  return {
    orders,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit))
    }
  };
}

async function updateOrderStatus(orderId, nextStatus) {
  if (!ORDER_STATUSES.includes(nextStatus)) {
    throw new AppError(400, 'Invalid order status.', 'VALIDATION_ERROR', { field: 'status' });
  }

  await db.withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      'SELECT status FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    const order = rows[0];

    if (!order) {
      throw new AppError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    }

    const allowed = STATUS_TRANSITIONS[order.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(
        409,
        `Order cannot move from ${order.status} to ${nextStatus}.`,
        'INVALID_STATUS_TRANSITION'
      );
    }

    if (nextStatus === 'completed') {
      await connection.execute(
        `UPDATE orders
         SET status = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextStatus, orderId]
      );
      return;
    }

    await connection.execute('UPDATE orders SET status = ? WHERE id = ?', [nextStatus, orderId]);
  });

  return getAdminOrder(orderId);
}

async function getDashboardData() {
  const revenueRows = await db.query(
    `SELECT COUNT(*) AS order_count,
            COALESCE(SUM(total_paisa), 0) AS revenue_paisa
     FROM orders
     WHERE paid_at IS NOT NULL
       AND status <> 'cancelled'
       AND DATE(paid_at) = CURDATE()`
  );

  const statusRows = await db.query(
    `SELECT status, COUNT(*) AS count
     FROM orders
     WHERE status IN ('placed', 'preparing', 'ready')
     GROUP BY status`
  );

  const statusCounts = {
    placed: 0,
    preparing: 0,
    ready: 0
  };
  for (const row of statusRows) {
    statusCounts[row.status] = Number(row.count);
  }

  const pendingRows = await db.query(
    `SELECT COUNT(*) AS count FROM orders WHERE status = 'pending_payment'`
  );

  const recentRows = await db.query(
    `${orderSelectSql()}
     WHERE o.paid_at IS NOT NULL
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT 8`
  );

  const recentItems = await getItemsByOrderIds(recentRows.map((row) => row.id));
  const recentOrders = recentRows.map((row) =>
    serializeOrder(row, recentItems.get(row.id) || [], { admin: true })
  );

  const topItemRows = await db.query(
    `SELECT oi.item_name,
            SUM(oi.quantity) AS quantity,
            SUM(oi.line_total_paisa) AS revenue_paisa
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.paid_at IS NOT NULL
       AND o.status <> 'cancelled'
       AND DATE(o.paid_at) = CURDATE()
     GROUP BY oi.item_name
     ORDER BY quantity DESC, revenue_paisa DESC
     LIMIT 5`
  );

  const weekRows = await db.query(
    `SELECT DATE(paid_at) AS sale_date,
            COUNT(*) AS order_count,
            COALESCE(SUM(total_paisa), 0) AS revenue_paisa
     FROM orders
     WHERE paid_at IS NOT NULL
       AND status <> 'cancelled'
       AND DATE(paid_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(paid_at)
     ORDER BY sale_date ASC`
  );

  return {
    today: {
      orderCount: Number(revenueRows[0]?.order_count || 0),
      revenuePaisa: Number(revenueRows[0]?.revenue_paisa || 0)
    },
    activeOrders: statusCounts,
    pendingPayments: Number(pendingRows[0]?.count || 0),
    topItems: topItemRows.map((row) => ({
      name: row.item_name,
      quantity: Number(row.quantity),
      revenuePaisa: Number(row.revenue_paisa)
    })),
    recentOrders,
    lastSevenDays: weekRows.map((row) => ({
      date: row.sale_date,
      orderCount: Number(row.order_count),
      revenuePaisa: Number(row.revenue_paisa)
    }))
  };
}

async function getSalesReport(from, to) {
  const summaryRows = await db.query(
    `SELECT COUNT(*) AS order_count,
            COALESCE(SUM(total_paisa), 0) AS revenue_paisa
     FROM orders
     WHERE paid_at IS NOT NULL
       AND status <> 'cancelled'
       AND DATE(paid_at) BETWEEN ? AND ?`,
    [from, to]
  );

  const dailyRows = await db.query(
    `SELECT DATE(paid_at) AS sale_date,
            COUNT(*) AS order_count,
            COALESCE(SUM(total_paisa), 0) AS revenue_paisa
     FROM orders
     WHERE paid_at IS NOT NULL
       AND status <> 'cancelled'
       AND DATE(paid_at) BETWEEN ? AND ?
     GROUP BY DATE(paid_at)
     ORDER BY sale_date ASC`,
    [from, to]
  );

  const topItemRows = await db.query(
    `SELECT oi.item_name,
            SUM(oi.quantity) AS quantity,
            SUM(oi.line_total_paisa) AS revenue_paisa
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.paid_at IS NOT NULL
       AND o.status <> 'cancelled'
       AND DATE(o.paid_at) BETWEEN ? AND ?
     GROUP BY oi.item_name
     ORDER BY quantity DESC, revenue_paisa DESC
     LIMIT 10`,
    [from, to]
  );

  const categoryRows = await db.query(
    `SELECT COALESCE(c.name, 'Other') AS category_name,
            SUM(oi.quantity) AS quantity,
            SUM(oi.line_total_paisa) AS revenue_paisa
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
     LEFT JOIN categories c ON c.id = mi.category_id
     WHERE o.paid_at IS NOT NULL
       AND o.status <> 'cancelled'
       AND DATE(o.paid_at) BETWEEN ? AND ?
     GROUP BY COALESCE(c.name, 'Other')
     ORDER BY revenue_paisa DESC`,
    [from, to]
  );

  const orderCount = Number(summaryRows[0]?.order_count || 0);
  const revenuePaisa = Number(summaryRows[0]?.revenue_paisa || 0);

  return {
    summary: {
      orderCount,
      revenuePaisa,
      averageOrderPaisa: orderCount > 0 ? Math.round(revenuePaisa / orderCount) : 0
    },
    daily: dailyRows.map((row) => ({
      date: row.sale_date,
      orderCount: Number(row.order_count),
      revenuePaisa: Number(row.revenue_paisa)
    })),
    topItems: topItemRows.map((row) => ({
      name: row.item_name,
      quantity: Number(row.quantity),
      revenuePaisa: Number(row.revenue_paisa)
    })),
    categories: categoryRows.map((row) => ({
      name: row.category_name,
      quantity: Number(row.quantity),
      revenuePaisa: Number(row.revenue_paisa)
    }))
  };
}

async function cancelStalePendingOrders(ttlMinutes) {
  const minutes = Number(ttlMinutes);
  if (!Number.isInteger(minutes) || minutes < 1) {
    return 0;
  }

  return db.withTransaction(async (connection) => {
    const [staleOrders] = await connection.query(
      `SELECT id
       FROM orders
       WHERE status = 'pending_payment'
         AND created_at < DATE_SUB(NOW(), INTERVAL ${minutes} MINUTE)
       ORDER BY created_at ASC
       LIMIT 500
       FOR UPDATE`
    );

    if (staleOrders.length === 0) {
      return 0;
    }

    const orderIds = staleOrders.map((order) => order.id);
    const placeholders = orderIds.map(() => '?').join(', ');

    await connection.query(
      `UPDATE payments
       SET status = 'failed', provider_ref = NULL, paid_at = NULL
       WHERE status = 'pending'
         AND order_id IN (${placeholders})`,
      orderIds
    );

    await connection.execute(
      `UPDATE orders
       SET status = 'cancelled'
       WHERE status = 'pending_payment'
         AND id IN (${placeholders})`,
      orderIds
    );

    return orderIds.length;
  });
}

module.exports = {
  ORDER_STATUSES,
  ACTIVE_STATUSES,
  createOrder,
  payForOrder,
  getCustomerOrder,
  verifyOrderTrackingToken,
  getAdminOrder,
  listAdminOrders,
  updateOrderStatus,
  getDashboardData,
  getSalesReport,
  cancelStalePendingOrders
};
