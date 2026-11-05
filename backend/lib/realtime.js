function customerStatusPayload(order) {
  return {
    orderId: order.id,
    orderCode: order.orderCode,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt,
    completedAt: order.completedAt,
    updatedAt: order.updatedAt
  };
}

function emitCustomerStatus(io, order) {
  io.to(`order:${order.id}`).emit('order:status', customerStatusPayload(order));
}

function emitNewOrder(io, adminOrder) {
  io.to('admin').emit('admin:order:new', adminOrder);
  emitCustomerStatus(io, adminOrder);
}

function emitOrderUpdate(io, adminOrder) {
  io.to('admin').emit('admin:order:updated', adminOrder);
  emitCustomerStatus(io, adminOrder);
}

module.exports = {
  emitNewOrder,
  emitOrderUpdate,
  emitCustomerStatus
};
