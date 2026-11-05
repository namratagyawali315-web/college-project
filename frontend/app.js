'use strict';

const CART_KEY = 'quickbite.cart.v1';
const LEGACY_CUSTOMER_KEY = 'quickbite.customer.v1';
const ACTIVE_ORDER_KEY = 'quickbite.activeOrder.v1';

const STATUS_META = {
  pending_payment: {
    label: 'Payment pending',
    title: 'Payment is still pending',
    text: 'Complete the demo payment to send your order to the kitchen.'
  },
  placed: {
    label: 'Confirmed',
    title: 'Your order is confirmed',
    text: 'The kitchen has received your order. We will update this page as it progresses.'
  },
  preparing: {
    label: 'Preparing',
    title: 'Your food is being prepared',
    text: 'The kitchen is working on your order. Keep this page open for live updates.'
  },
  ready: {
    label: 'Ready',
    title: 'Your order is ready',
    text: 'Your food is ready and will be served at your table shortly.'
  },
  completed: {
    label: 'Completed',
    title: 'Order completed',
    text: 'Your order has been completed. We hope you enjoy your meal.'
  },
  cancelled: {
    label: 'Cancelled',
    title: 'Order cancelled',
    text: 'This order was cancelled. Please speak with the canteen staff if you need help.'
  }
};

const el = {};
const state = {
  config: { canteenName: 'QuickBite', demoNotice: '' },
  menu: [],
  items: [],
  itemMap: new Map(),
  tables: [],
  scannedToken: null,
  scannedTable: null,
  cart: new Map(),
  category: 'all',
  search: '',
  activeView: 'menu',
  activeOrder: null,
  currentOrder: null,
  trackingToken: null,
  resumeMode: null,
  socket: null,
  trackingTimer: null
};

const moneyFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

function cash(paisa) {
  const amount = Number(paisa || 0) / 100;
  return `NPR\u00a0${moneyFormatter.format(amount)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeUploadPath(value) {
  return typeof value === 'string' && value.startsWith('/uploads/') ? value : null;
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = parseDateValue(value);
  if (!date) {
    return '--';
  }
  return date.toLocaleString('en-NP', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function formatTable(table) {
  if (!table) {
    return '--';
  }
  return table.label ? `Table ${table.number} · ${table.label}` : `Table ${table.number}`;
}

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
  }
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  el.toastRegion.append(node);
  window.setTimeout(() => {
    node.classList.add('leaving');
    window.setTimeout(() => node.remove(), 220);
  }, 3000);
}

function setButtonBusy(button, busy, busyLabel = 'Please wait') {
  if (!button) {
    return;
  }

  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
    button.classList.add('is-busy');
    return;
  }

  button.textContent = button.dataset.originalLabel || button.textContent;
  button.disabled = false;
  button.classList.remove('is-busy');
}

function showInlineError(element, message) {
  if (!element) {
    return;
  }
  element.textContent = message || '';
  element.classList.toggle('hidden', !message);
}

function showGlobalAlert(message) {
  el.globalAlert.textContent = message;
  el.globalAlert.classList.toggle('hidden', !message);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const body = options.body;

  if (body && !(body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data?.error?.message || 'The request could not be completed.');
    error.code = data?.error?.code || 'REQUEST_FAILED';
    error.details = data?.error?.details || null;
    error.status = response.status;
    throw error;
  }

  return data;
}

function getScannedToken() {
  const match = window.location.pathname.match(/^\/scan\/([^/]+)\/?$/);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function cacheElements() {
  const ids = [
    'brandName',
    'receiptBrandName',
    'tablePill',
    'tablePillText',
    'heroTableChip',
    'heroTableNumber',
    'openCartButton',
    'headerCartCount',
    'resumeBanner',
    'resumeTitle',
    'resumeText',
    'resumeOrderButton',
    'globalAlert',
    'menuView',
    'menuSearch',
    'categoryNav',
    'menuGrid',
    'menuEmpty',
    'clearMenuSearch',
    'cartPanel',
    'cartBackdrop',
    'closeCartButton',
    'cartEmpty',
    'cartItems',
    'cartSummary',
    'cartItemCount',
    'cartTotal',
    'checkoutButton',
    'mobileCartNavButton',
    'mobileCartNavCount',
    'mobileOrderNavButton',
    'checkoutView',
    'backToMenuButton',
    'checkoutForm',
    'customerName',
    'customerPhone',
    'tableSelect',
    'orderNotes',
    'customerNameError',
    'customerPhoneError',
    'tableSelectError',
    'checkoutError',
    'placeOrderButton',
    'checkoutItems',
    'checkoutTotal',
    'paymentView',
    'demoNotice',
    'paymentAmount',
    'paymentOrderCode',
    'paymentTableNumber',
    'paymentItems',
    'paymentError',
    'payButton',
    'cancelPaymentButton',
    'trackingView',
    'receiptOrderCode',
    'receiptTable',
    'receiptCustomer',
    'receiptPaidAt',
    'receiptItems',
    'receiptTotal',
    'receiptPaymentNote',
    'receiptNotes',
    'printReceiptButton',
    'orderMoreButton',
    'trackingStatusBadge',
    'trackingStatusTitle',
    'trackingStatusText',
    'trackingTimeline',
    'refreshTrackingButton',
    'trackingConnectionNote',
    'toastRegion'
  ];

  for (const id of ids) {
    el[id] = document.getElementById(id);
  }
}

function bindEvents() {
  el.openCartButton.addEventListener('click', openCart);
  el.mobileCartNavButton.addEventListener('click', () => {
    if (state.activeView !== 'menu') {
      showView('menu');
    }
    openCart();
  });
  el.mobileOrderNavButton.addEventListener('click', openActiveOrderFromNav);
  document.querySelector('[data-mobile-view="menu"]').addEventListener('click', () => {
    if (state.activeView !== 'menu') {
      showView('menu');
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  el.closeCartButton.addEventListener('click', closeCart);
  el.cartBackdrop.addEventListener('click', closeCart);

  el.categoryNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) {
      return;
    }
    state.category = button.dataset.category;
    renderCategoryNav();
    renderMenu();
  });

  el.menuGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-item]');
    if (button) {
      addToCart(Number(button.dataset.addItem));
    }
  });

  el.cartItems.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cart-action]');
    if (!button) {
      return;
    }
    const itemId = Number(button.dataset.itemId);
    if (button.dataset.cartAction === 'increase') {
      changeQuantity(itemId, 1);
    } else if (button.dataset.cartAction === 'decrease') {
      changeQuantity(itemId, -1);
    }
  });

  el.menuSearch.addEventListener('input', () => {
    state.search = el.menuSearch.value;
    renderMenu();
  });

  el.clearMenuSearch.addEventListener('click', () => {
    state.search = '';
    el.menuSearch.value = '';
    renderMenu();
  });

  el.checkoutButton.addEventListener('click', openCheckout);
  el.backToMenuButton.addEventListener('click', () => showView('menu'));
  el.tableSelect.addEventListener('change', handleTableChange);
  el.checkoutForm.addEventListener('submit', placeOrder);

  el.payButton.addEventListener('click', handlePayment);
  el.cancelPaymentButton.addEventListener('click', handlePaymentCancellation);

  el.printReceiptButton.addEventListener('click', () => window.print());
  el.orderMoreButton.addEventListener('click', startNewOrder);
  el.refreshTrackingButton.addEventListener('click', () => refreshActiveOrder(false));
  el.resumeOrderButton.addEventListener('click', resumeActiveOrder);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCart();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.activeView === 'tracking') {
      refreshActiveOrder(true);
    }
  });
}

function renderMenuSkeleton() {
  const cards = Array.from({ length: 6 }, () => `
    <div class="skeleton-card" aria-hidden="true">
      <span class="skeleton-media"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-line short"></span>
      <span class="skeleton-line tiny"></span>
    </div>
  `).join('');
  el.menuGrid.innerHTML = cards;
  el.menuGrid.setAttribute('aria-busy', 'true');
}

function renderCategoryNav() {
  const buttons = [
    `<button class="category-button ${state.category === 'all' ? 'active' : ''}" type="button" data-category="all">All dishes</button>`,
    ...state.menu.map(
      (category) => `
        <button class="category-button ${state.category === String(category.id) ? 'active' : ''}"
          type="button" data-category="${escapeHtml(category.id)}">${escapeHtml(category.name)}</button>
      `
    )
  ];
  el.categoryNav.innerHTML = buttons.join('');
}

function itemMediaMarkup(item) {
  const imagePath = safeUploadPath(item.imagePath || item.imageUrl);
  if (imagePath) {
    return `<img src="${escapeHtml(imagePath)}" alt="${escapeHtml(item.name || 'Menu item')}" loading="lazy">`;
  }

  const initial = String(item.name || 'Q').trim().charAt(0).toUpperCase() || 'Q';
  return `
    <div class="menu-placeholder">
      <strong>${escapeHtml(initial)}</strong>
    </div>
  `;
}

function renderMenu() {
  const query = state.search.trim().toLowerCase();
  const filtered = state.items.filter((item) => {
    const matchesCategory = state.category === 'all' || String(item.categoryId) === state.category;
    const searchText = `${item.name} ${item.description || ''} ${item.categoryName || ''}`.toLowerCase();
    return matchesCategory && (!query || searchText.includes(query));
  });

  el.menuGrid.setAttribute('aria-busy', 'false');
  el.menuEmpty.classList.toggle('hidden', filtered.length > 0);

  if (filtered.length === 0) {
    el.menuGrid.innerHTML = '';
    return;
  }

  el.menuGrid.innerHTML = filtered
    .map((item) => {
      const quantity = state.cart.get(item.id)?.quantity || 0;
      const soldOut = item.isAvailable === false;
      return `
        <article class="menu-card">
          <div class="menu-card-media">
            ${itemMediaMarkup(item)}
            <span class="menu-price-badge">${cash(item.pricePaisa)}</span>
            ${quantity > 0 ? `<span class="cart-quantity-badge" aria-label="${quantity} in cart">${quantity}</span>` : ''}
          </div>
          <div class="menu-card-body">
            <div class="menu-card-meta">
              <span class="menu-card-category">${escapeHtml(item.categoryName || '')}</span>
              <span class="availability ${soldOut ? 'sold-out' : ''}">
                <span aria-hidden="true"></span>${soldOut ? 'Sold out' : 'Available'}
              </span>
            </div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="menu-card-description">${escapeHtml(item.description || 'Freshly prepared in the college canteen.')}</p>
            <button class="add-button" type="button" data-add-item="${escapeHtml(item.id)}"
              aria-label="Add ${escapeHtml(item.name)} to order" ${soldOut ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
              <span>${soldOut ? 'Sold out' : 'Add to order'}</span>
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

function cartTotalPaisa() {
  return [...state.cart.values()].reduce(
    (sum, item) => sum + Number(item.pricePaisa) * item.quantity,
    0
  );
}

function cartQuantity() {
  return [...state.cart.values()].reduce((sum, item) => sum + item.quantity, 0);
}

function saveCart() {
  const items = [...state.cart.values()].map((item) => ({
    id: item.id,
    quantity: item.quantity
  }));
  storageSet(CART_KEY, JSON.stringify(items));
}

function restoreCart() {
  let stored;
  try {
    stored = JSON.parse(storageGet(CART_KEY) || '[]');
  } catch {
    stored = [];
  }

  if (!Array.isArray(stored)) {
    return;
  }

  for (const entry of stored) {
    const item = state.itemMap.get(Number(entry.id));
    const quantity = Number(entry.quantity);
    if (item && Number.isInteger(quantity) && quantity > 0) {
      state.cart.set(item.id, {
        ...item,
        quantity: Math.min(quantity, 20)
      });
    }
  }
  saveCart();
}

function addToCart(itemId) {
  const item = state.itemMap.get(itemId);
  if (!item) {
    return;
  }

  const current = state.cart.get(itemId);
  const nextQuantity = (current?.quantity || 0) + 1;
  if (nextQuantity > 20) {
    toast('The maximum quantity for one item is 20.', 'error');
    return;
  }

  state.cart.set(itemId, {
    ...item,
    quantity: nextQuantity
  });
  saveCart();
  renderCart();
  renderMenu();
}

function changeQuantity(itemId, delta) {
  const current = state.cart.get(itemId);
  if (!current) {
    return;
  }

  const nextQuantity = current.quantity + delta;
  if (nextQuantity <= 0) {
    state.cart.delete(itemId);
  } else if (nextQuantity > 20) {
    toast('The maximum quantity for one item is 20.', 'error');
    return;
  } else {
    state.cart.set(itemId, {
      ...current,
      quantity: nextQuantity
    });
  }

  saveCart();
  renderCart();
  renderMenu();
}

function updateMobileTabbar() {
  const menuTab = document.querySelector('[data-mobile-view="menu"]');
  menuTab.classList.toggle('active', state.activeView === 'menu' || state.activeView === 'checkout');
  el.mobileOrderNavButton.classList.toggle(
    'active',
    state.activeView === 'payment' || state.activeView === 'tracking'
  );
}

function renderCart() {
  const items = [...state.cart.values()];
  const total = cartTotalPaisa();
  const quantity = cartQuantity();

  el.cartEmpty.classList.toggle('hidden', items.length > 0);
  el.cartSummary.classList.toggle('hidden', items.length === 0);
  el.cartItems.classList.toggle('hidden', items.length === 0);
  el.headerCartCount.textContent = String(quantity);
  el.cartItemCount.textContent = String(quantity);
  el.cartTotal.textContent = cash(total);
  el.checkoutButton.disabled = items.length === 0;
  el.mobileCartNavCount.textContent = String(quantity);
  el.mobileCartNavCount.classList.toggle('hidden', quantity === 0);

  el.cartItems.innerHTML = items
    .map((item) => {
      const imagePath = safeUploadPath(item.imagePath || item.imageUrl);
      return `
        <div class="cart-item">
          <span class="cart-item-thumb">
            ${imagePath ? `<img src="${escapeHtml(imagePath)}" alt="">` : escapeHtml(String(item.name).charAt(0).toUpperCase())}
          </span>
          <span class="cart-item-info">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${cash(item.pricePaisa)} each</span>
          </span>
          <span class="cart-item-controls">
            <button class="quantity-button" type="button" data-cart-action="decrease"
              data-item-id="${escapeHtml(item.id)}" aria-label="Remove one ${escapeHtml(item.name)}">&minus;</button>
            <span class="cart-item-quantity">${item.quantity}</span>
            <button class="quantity-button" type="button" data-cart-action="increase"
              data-item-id="${escapeHtml(item.id)}" aria-label="Add one more ${escapeHtml(item.name)}">+</button>
          </span>
        </div>
      `;
    })
    .join('');

}

function openCart() {
  if (window.matchMedia('(max-width: 980px)').matches) {
    el.cartPanel.classList.add('open');
    el.cartBackdrop.classList.remove('hidden');
    el.mobileCartNavButton.classList.add('active');
    document.body.classList.add('cart-open');
    el.openCartButton.setAttribute('aria-expanded', 'true');
    return;
  }

  el.cartPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeCart() {
  el.cartPanel.classList.remove('open');
  el.cartBackdrop.classList.add('hidden');
  el.mobileCartNavButton.classList.remove('active');
  document.body.classList.remove('cart-open');
  el.openCartButton.setAttribute('aria-expanded', 'false');
}

function openActiveOrderFromNav() {
  const order = state.activeOrder?.order;
  if (!order) {
    toast('No active order yet. Add a dish from the menu to get started.');
    return;
  }

  if (order.status === 'pending_payment') {
    renderPayment(order);
    showView('payment');
    return;
  }

  openTracking(order);
}

function populateTableSelect() {
  const options = ['<option value="">Choose your table</option>'];

  for (const table of state.tables) {
    const label = table.label ? `Table ${table.number} · ${table.label}` : `Table ${table.number}`;
    options.push(
      `<option value="${escapeHtml(table.id)}">${escapeHtml(label)}</option>`
    );
  }

  el.tableSelect.innerHTML = options.join('');

  if (state.scannedTable) {
    el.tableSelect.value = String(state.scannedTable.id);
  }
  updateTableUI();
}

function selectedTable() {
  const tableId = Number(el.tableSelect.value);
  return state.tables.find((table) => Number(table.id) === tableId) || null;
}

function updateTableUI() {
  const table = selectedTable();
  const label = table ? formatTable(table) : 'Choose a table';
  el.tablePillText.textContent = table ? label : 'Choose a table';
  el.heroTableChip.textContent = table ? label : 'Table not selected';
  el.heroTableNumber.textContent = table ? table.number : '--';
}

function handleTableChange() {
  const table = selectedTable();

  if (
    state.scannedToken &&
    (!table || Number(table.id) !== Number(state.scannedTable?.id))
  ) {
    state.scannedToken = null;
    state.scannedTable = null;

    if (window.location.pathname.startsWith('/scan/')) {
      window.history.replaceState(null, '', '/');
    }
  }

  updateTableUI();
}

function showView(name) {
  const views = {
    menu: el.menuView,
    checkout: el.checkoutView,
    payment: el.paymentView,
    tracking: el.trackingView
  };

  for (const [key, node] of Object.entries(views)) {
    node.classList.toggle('hidden', key !== name);
  }

  state.activeView = name;
  closeCart();
  updateMobileTabbar();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (name === 'menu' && state.activeOrder?.order) {
    showResumeBanner(state.activeOrder.order);
  } else {
    el.resumeBanner.classList.add('hidden');
  }

  if (name !== 'tracking') {
    stopTrackingPolling();
  }
}

function openCheckout() {
  if (state.cart.size === 0) {
    toast('Add at least one dish before checkout.', 'error');
    return;
  }

  const items = [...state.cart.values()];
  el.checkoutItems.innerHTML = items
    .map(
      (item) => `
        <div class="checkout-item">
          <span>${escapeHtml(item.name)}<small>${item.quantity} × ${cash(item.pricePaisa)}</small></span>
          <strong>${cash(item.quantity * item.pricePaisa)}</strong>
        </div>
      `
    )
    .join('');
  el.checkoutTotal.textContent = cash(cartTotalPaisa());

  clearInvalidFields();
  showInlineError(el.checkoutError, '');
  showView('checkout');
}

function removeLegacyCustomerData() {
  storageRemove(LEGACY_CUSTOMER_KEY);
}

function normalizePhoneInput(value) {
  return String(value || '').replace(/[\s()-]/g, '');
}

function clearInvalidFields() {
  for (const field of [el.customerName, el.customerPhone, el.tableSelect]) {
    field.classList.remove('invalid');
  }
  for (const errorNode of [el.customerNameError, el.customerPhoneError, el.tableSelectError]) {
    showInlineError(errorNode, '');
  }
}

function validateCheckout() {
  clearInvalidFields();
  const name = el.customerName.value.trim();
  const phone = normalizePhoneInput(el.customerPhone.value);
  const tableId = Number(el.tableSelect.value);

  if (name.length < 2) {
    el.customerName.classList.add('invalid');
    showInlineError(el.customerNameError, 'Enter the customer name.');
    el.customerName.focus();
    return { ok: false };
  }

  if (!/^\+?\d{7,15}$/.test(phone)) {
    el.customerPhone.classList.add('invalid');
    showInlineError(el.customerPhoneError, 'Enter a valid phone number.');
    el.customerPhone.focus();
    return { ok: false };
  }

  if (!Number.isInteger(tableId) || tableId < 1) {
    el.tableSelect.classList.add('invalid');
    showInlineError(el.tableSelectError, 'Choose the table for this order.');
    el.tableSelect.focus();
    return { ok: false };
  }

  return {
    ok: true,
    name,
    phone,
    tableId
  };
}

async function placeOrder(event) {
  event.preventDefault();
  showInlineError(el.checkoutError, '');

  if (state.cart.size === 0) {
    showInlineError(el.checkoutError, 'Your cart is empty. Add a dish before placing the order.');
    return;
  }

  const validation = validateCheckout();
  if (!validation.ok) {
    return;
  }

  const payload = {
    tableId: validation.tableId,
    customerName: validation.name,
    phone: validation.phone,
    notes: el.orderNotes.value.trim() || null,
    items: [...state.cart.values()].map((item) => ({
      menuItemId: item.id,
      quantity: item.quantity
    }))
  };

  if (state.scannedToken) {
    payload.scannedTableToken = state.scannedToken;
  }

  setButtonBusy(el.placeOrderButton, true, 'Placing order');

  try {
    const result = await api('/api/public/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    state.currentOrder = result.order;
    state.trackingToken = result.trackingToken;
    saveActiveOrder(result.order, result.trackingToken);

    state.cart.clear();
    saveCart();
    renderCart();
    renderMenu();
    el.resumeBanner.classList.add('hidden');

    renderPayment(result.order);
    showView('payment');
  } catch (error) {
    showInlineError(el.checkoutError, error.message);
  } finally {
    setButtonBusy(el.placeOrderButton, false);
  }
}

function paymentItemsMarkup(order) {
  return (order.items || [])
    .map(
      (item) => `
        <div class="checkout-item">
          <span>${escapeHtml(item.name)}<small>${item.quantity} × ${cash(item.unitPricePaisa)}</small></span>
          <strong>${cash(item.lineTotalPaisa)}</strong>
        </div>
      `
    )
    .join('');
}

function renderPayment(order) {
  state.currentOrder = order;
  el.paymentAmount.textContent = cash(order.totalPaisa);
  el.paymentOrderCode.textContent = order.orderCode;
  el.paymentTableNumber.textContent = order.table?.number || '--';
  el.paymentItems.innerHTML = paymentItemsMarkup(order);
  el.demoNotice.textContent =
    state.config.demoNotice || 'This is a simulated payment page. No money will be charged.';
  showInlineError(el.paymentError, '');
  el.payButton.disabled = false;
  el.payButton.textContent = 'Pay with eSewa (Demo)';
  el.cancelPaymentButton.disabled = false;
}

function saveActiveOrder(order, trackingToken) {
  if (isTerminalOrder(order)) {
    state.activeOrder = null;
    state.currentOrder = order;
    state.trackingToken = null;
    state.resumeMode = null;
    storageRemove(ACTIVE_ORDER_KEY);
    el.resumeBanner.classList.add('hidden');
    return;
  }

  state.activeOrder = {
    id: order.id,
    trackingToken,
    order
  };
  storageSet(
    ACTIVE_ORDER_KEY,
    JSON.stringify({
      id: order.id,
      trackingToken,
      savedAt: new Date().toISOString()
    })
  );
}

function readActiveOrder() {
  try {
    const stored = JSON.parse(storageGet(ACTIVE_ORDER_KEY) || 'null');
    const id = Number(stored?.id);
    const trackingToken =
      typeof stored?.trackingToken === 'string' ? stored.trackingToken : '';

    if (
      !Number.isInteger(id) ||
      id < 1 ||
      trackingToken.length === 0 ||
      trackingToken.length > 128
    ) {
      storageRemove(ACTIVE_ORDER_KEY);
      return null;
    }

    const normalized = {
      id,
      trackingToken,
      savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : null
    };
    storageSet(ACTIVE_ORDER_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    storageRemove(ACTIVE_ORDER_KEY);
    return null;
  }
}

function clearActiveOrder() {
  state.activeOrder = null;
  state.currentOrder = null;
  state.trackingToken = null;
  state.resumeMode = null;
  storageRemove(ACTIVE_ORDER_KEY);
  el.resumeBanner.classList.add('hidden');
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  stopTrackingPolling();
}

async function restoreActiveOrder() {
  const stored = readActiveOrder();
  if (!stored) {
    return;
  }

  state.activeOrder = {
    id: stored.id,
    trackingToken: stored.trackingToken,
    order: null
  };
  state.currentOrder = null;
  state.trackingToken = stored.trackingToken;

  try {
    const result = await api(`/api/public/orders/${encodeURIComponent(stored.id)}`, {
      headers: {
        'X-Order-Token': stored.trackingToken
      }
    });
    saveActiveOrder(result.order, stored.trackingToken);

    if (!isTerminalOrder(result.order)) {
      showResumeBanner(result.order);
    }
  } catch (error) {
    if (error.status === 404) {
      clearActiveOrder();
    }
  }
}

function showResumeBanner(order) {
  const meta = STATUS_META[order.status] || STATUS_META.placed;
  state.resumeMode = order.status === 'pending_payment' ? 'payment' : 'tracking';
  el.resumeTitle.textContent =
    order.status === 'pending_payment'
      ? `Payment pending for ${order.orderCode}`
      : `${order.orderCode}: ${meta.label}`;
  el.resumeText.textContent =
    order.status === 'pending_payment'
      ? `Your order for ${formatTable(order.table)} is waiting for the demo payment.`
      : `${formatTable(order.table)} · ${meta.text}`;
  el.resumeOrderButton.textContent =
    order.status === 'pending_payment'
      ? 'Resume payment'
      : order.status === 'completed' || order.status === 'cancelled'
        ? 'View receipt'
        : 'Track order';
  el.resumeBanner.classList.remove('hidden');
}

function resumeActiveOrder() {
  const order = state.activeOrder?.order;
  if (!order) {
    toast('This order is no longer available.', 'error');
    return;
  }

  if (state.resumeMode === 'payment' || order.status === 'pending_payment') {
    renderPayment(order);
    showView('payment');
    return;
  }

  openTracking(order);
}

async function handlePayment() {
  if (!state.activeOrder || !state.trackingToken) {
    showInlineError(el.paymentError, 'The order details are missing. Please return to the menu and try again.');
    return;
  }

  showInlineError(el.paymentError, '');
  el.payButton.disabled = true;
  el.payButton.textContent = 'Processing demo payment';
  el.payButton.classList.add('is-busy');
  el.cancelPaymentButton.disabled = true;

  try {
    const result = await api(
      `/api/public/orders/${encodeURIComponent(state.activeOrder.id)}/pay`,
      {
        method: 'POST',
        headers: {
          'X-Order-Token': state.trackingToken
        },
        body: JSON.stringify({
          outcome: 'success'
        })
      }
    );

    saveActiveOrder(result.order, state.trackingToken);
    el.resumeBanner.classList.add('hidden');
    toast('Demo payment successful. Your order is confirmed.', 'success');
    openTracking(result.order);
  } catch (error) {
    showInlineError(el.paymentError, error.message);
  } finally {
    el.payButton.classList.remove('is-busy');
    el.payButton.textContent = 'Pay with eSewa (Demo)';
    el.payButton.disabled = false;
    el.cancelPaymentButton.disabled = false;
  }
}

async function handlePaymentCancellation() {
  if (!state.activeOrder || !state.trackingToken) {
    showView('menu');
    return;
  }

  if (!window.confirm('Cancel this demo payment? Your order will stay unpaid.')) {
    return;
  }

  el.cancelPaymentButton.disabled = true;

  try {
    const result = await api(
      `/api/public/orders/${encodeURIComponent(state.activeOrder.id)}/pay`,
      {
        method: 'POST',
        headers: {
          'X-Order-Token': state.trackingToken
        },
        body: JSON.stringify({
          outcome: 'failure'
        })
      }
    );
    saveActiveOrder(result.order, state.trackingToken);
    el.resumeBanner.classList.add('hidden');
    showInlineError(
      el.paymentError,
      'Demo payment cancelled. Your order is still waiting for payment, and you can retry.'
    );
  } catch (error) {
    showInlineError(el.paymentError, error.message);
  } finally {
    el.cancelPaymentButton.disabled = false;
  }
}

function timelineMarkup(order) {
  if (order.status === 'cancelled') {
    return `
      <li class="timeline-step cancelled current" aria-current="step">
        <span class="timeline-dot">×</span>
        <span class="timeline-copy">
          <strong>Order cancelled</strong>
          <p>Please contact the canteen staff for help.</p>
          <span class="timeline-time">${escapeHtml(formatDateTime(order.updatedAt || order.createdAt))}</span>
        </span>
      </li>
    `;
  }

  const steps = [
    {
      status: 'placed',
      title: 'Order confirmed',
      text: 'Payment received and the kitchen was notified.'
    },
    {
      status: 'preparing',
      title: 'Being prepared',
      text: 'The kitchen is preparing your food.'
    },
    {
      status: 'ready',
      title: 'Ready',
      text: 'Your order is ready and on its way to the table.'
    },
    {
      status: 'completed',
      title: 'Completed',
      text: 'The order has been served.'
    }
  ];

  const orderIndex = Math.max(
    0,
    steps.findIndex((step) => step.status === order.status)
  );

  return steps
    .map((step, index) => {
      const classes = [
        'timeline-step',
        index < orderIndex ? 'done' : '',
        index === orderIndex ? 'current' : ''
      ]
        .filter(Boolean)
        .join(' ');

      let timeLabel = 'Pending';
      if (index === 0) {
        timeLabel = formatDateTime(order.paidAt || order.createdAt);
      } else if (index === orderIndex) {
        timeLabel = formatDateTime(order.updatedAt || order.paidAt || order.createdAt);
      } else if (index < orderIndex) {
        timeLabel = 'Completed';
      }

      return `
        <li class="${classes}"${index === orderIndex ? ' aria-current="step"' : ''}>
          <span class="timeline-dot">${index < orderIndex ? '&#10003;' : index + 1}</span>
          <span class="timeline-copy">
            <strong>${step.title}</strong>
            <p>${step.text}</p>
            <span class="timeline-time">${escapeHtml(timeLabel)}</span>
          </span>
        </li>
      `;
    })
    .join('');
}

function renderTracking(order) {
  if (order.status === 'pending_payment') {
    renderPayment(order);
    return;
  }

  state.currentOrder = order;
  const meta = STATUS_META[order.status] || STATUS_META.placed;
  const table = formatTable(order.table);

  el.receiptOrderCode.textContent = order.orderCode;
  el.receiptTable.textContent = table;
  el.receiptCustomer.textContent = order.customer?.name || '--';
  el.receiptPaidAt.textContent = formatDateTime(order.paidAt);
  el.receiptTotal.textContent = cash(order.totalPaisa);
  el.receiptItems.innerHTML = (order.items || [])
    .map(
      (item) => `
        <div class="receipt-item">
          <span><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} × ${cash(item.unitPricePaisa)}</small></span>
          <span>${cash(item.lineTotalPaisa)}</span>
        </div>
      `
    )
    .join('');

  el.receiptPaymentNote.textContent =
    order.paymentStatus === 'paid'
      ? 'Paid via the simulated eSewa demo checkout. No real money was charged.'
      : 'Payment has not been marked as paid.';

  if (order.notes) {
    el.receiptNotes.textContent = `Notes: ${order.notes}`;
    el.receiptNotes.classList.remove('hidden');
  } else {
    el.receiptNotes.classList.add('hidden');
  }

  el.trackingStatusBadge.textContent = meta.label;
  el.trackingStatusBadge.className = `status-badge ${order.status}`;
  el.trackingStatusTitle.textContent = meta.title;
  el.trackingStatusText.textContent = meta.text;
  el.trackingTimeline.innerHTML = timelineMarkup(order);

  if (isTerminalOrder(order)) {
    storageRemove(ACTIVE_ORDER_KEY);
    if (Number(state.activeOrder?.id) === Number(order.id)) {
      state.activeOrder = null;
    }
    state.trackingToken = null;
    state.resumeMode = null;
    el.resumeBanner.classList.add('hidden');
    stopTrackingPolling();
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
    el.trackingConnectionNote.textContent = 'This order is finished. The receipt above is final.';
  }
}

function isTerminalOrder(order) {
  return order?.status === 'completed' || order?.status === 'cancelled';
}

function openTracking(order) {
  renderTracking(order);
  showView('tracking');

  if (isTerminalOrder(order)) {
    el.trackingConnectionNote.textContent = 'This order is finished. The receipt is shown below.';
    return;
  }

  connectTrackingSocket();
  startTrackingPolling();
}

function connectTrackingSocket() {
  if (!state.activeOrder || !state.trackingToken || isTerminalOrder(state.activeOrder.order)) {
    return;
  }

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  if (typeof window.io !== 'function') {
    el.trackingConnectionNote.textContent = 'Live updates are unavailable. Use refresh to check the status.';
    return;
  }

  const socket = window.io();
  state.socket = socket;
  el.trackingConnectionNote.textContent = 'Connecting to live updates...';

  socket.on('connect', () => {
    socket.emit(
      'track:order',
      {
        orderId: state.activeOrder.id,
        token: state.trackingToken
      },
      (result) => {
        if (result?.ok) {
          el.trackingConnectionNote.textContent = 'Live updates connected.';
        } else {
          el.trackingConnectionNote.textContent = 'Live updates could not be verified. Use refresh instead.';
        }
      }
    );
  });

  socket.on('order:status', (payload) => {
    if (Number(payload?.orderId) === Number(state.activeOrder?.id)) {
      refreshActiveOrder(true);
    }
  });

  socket.on('disconnect', () => {
    el.trackingConnectionNote.textContent = 'Live updates paused. Use refresh to check the status.';
  });

  socket.on('connect_error', () => {
    el.trackingConnectionNote.textContent = 'Live updates unavailable. Use refresh to check the status.';
  });
}

function startTrackingPolling() {
  stopTrackingPolling();
  if (isTerminalOrder(state.activeOrder?.order)) {
    return;
  }
  state.trackingTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && state.activeView === 'tracking') {
      refreshActiveOrder(true);
    }
  }, 15000);
}

function stopTrackingPolling() {
  if (state.trackingTimer) {
    window.clearInterval(state.trackingTimer);
    state.trackingTimer = null;
  }
}

async function refreshActiveOrder(silent) {
  if (!state.activeOrder || !state.trackingToken) {
    return;
  }

  const orderId = state.activeOrder.id;
  const trackingToken = state.trackingToken;

  try {
    const result = await api(`/api/public/orders/${encodeURIComponent(orderId)}`, {
      headers: {
        'X-Order-Token': trackingToken
      }
    });

    if (
      !state.activeOrder ||
      Number(state.activeOrder.id) !== Number(orderId) ||
      state.trackingToken !== trackingToken
    ) {
      return;
    }

    saveActiveOrder(result.order, trackingToken);

    if (!isTerminalOrder(result.order) && state.activeView === 'menu') {
      showResumeBanner(result.order);
    }

    if (state.activeView === 'tracking') {
      renderTracking(result.order);
    }
  } catch (error) {
    const orderStillActive =
      state.activeOrder &&
      Number(state.activeOrder.id) === Number(orderId) &&
      state.trackingToken === trackingToken;

    if (!silent && orderStillActive) {
      toast(error.message, 'error');
    }
    if (error.status === 404 && orderStillActive) {
      clearActiveOrder();
    }
  }
}

function startNewOrder() {
  clearActiveOrder();
  state.cart.clear();
  saveCart();
  renderCart();
  renderMenu();
  el.orderNotes.value = '';
  showInlineError(el.checkoutError, '');
  showView('menu');
}

async function init() {
  cacheElements();
  bindEvents();
  removeLegacyCustomerData();
  renderMenuSkeleton();
  state.scannedToken = getScannedToken();

  try {
    const [config, menu, tables] = await Promise.all([
      api('/api/public/config'),
      api('/api/public/menu'),
      api('/api/public/tables')
    ]);

    state.config = config;
    state.menu = menu.categories || [];
    state.items = state.menu.flatMap((category) =>
      (category.items || []).map((item) => ({
        ...item,
        categoryId: category.id,
        categoryName: category.name
      }))
    );
    state.itemMap = new Map(state.items.map((item) => [Number(item.id), item]));
    state.tables = tables.tables || [];

    el.brandName.textContent = config.canteenName || 'QuickBite';
    el.receiptBrandName.textContent = config.canteenName || 'QuickBite';
    document.title = `${config.canteenName || 'QuickBite'} | Table Ordering`;

    if (state.scannedToken) {
      try {
        const result = await api(`/api/public/tables/${encodeURIComponent(state.scannedToken)}`);
        state.scannedTable = result.table;
      } catch {
        state.scannedToken = null;
        showGlobalAlert('This table QR code is invalid or inactive. You can choose a table manually.');
      }
    }

    restoreCart();
    populateTableSelect();
    renderCategoryNav();
    renderMenu();
    renderCart();
    updateTableUI();

    await restoreActiveOrder();
  } catch (error) {
    el.menuGrid.innerHTML = '';
    el.menuGrid.setAttribute('aria-busy', 'false');
    showGlobalAlert(`Could not load the menu. ${error.message} Please refresh the page or contact canteen staff.`);
  }
}

document.addEventListener('DOMContentLoaded', init);
