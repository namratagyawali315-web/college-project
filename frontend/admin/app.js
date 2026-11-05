'use strict';

const VIEW_META = Object.freeze({
  dashboard: { title: 'Dashboard', eyebrow: 'Overview' },
  orders: { title: 'Live orders', eyebrow: 'Service' },
  menu: { title: 'Menu management', eyebrow: 'Catalogue' },
  tables: { title: 'Tables & QR', eyebrow: 'Dine-in' },
  reports: { title: 'Reports', eyebrow: 'Sales' },
  settings: { title: 'Settings', eyebrow: 'Configuration' }
});

const STATUS_LABELS = Object.freeze({
  pending_payment: 'Unpaid',
  placed: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled'
});

const ACTIVE_STATUSES = Object.freeze(['placed', 'preparing', 'ready']);
const ALL_STATUSES = Object.freeze([
  'placed',
  'preparing',
  'ready',
  'pending_payment',
  'completed',
  'cancelled'
]);
const ORDER_GROUPS = Object.freeze({
  placed: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  pending_payment: 'Unpaid',
  completed: 'Completed',
  cancelled: 'Cancelled'
});

const SOUND_STORAGE_KEY = 'quickbite.admin.sound';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const state = {
  admin: null,
  view: 'dashboard',
  sound: true,
  dashboard: null,
  orders: [],
  orderFilter: 'active',
  orderSearch: '',
  categories: [],
  menuItems: [],
  menuTab: 'items',
  tables: [],
  settings: null,
  report: null,
  socket: null,
  audioContext: null,
  orderBadgeCount: 0
};

let searchTimer = null;
let ordersRequestSequence = 0;
let dashboardRequestSequence = 0;
const refreshTimers = {
  orders: null,
  dashboard: null
};

function $(id) {
  return document.getElementById(id);
}

const moneyFormatter = new Intl.NumberFormat('en-NP', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

function formatCurrency(paisa) {
  return `NPR\u00a0${moneyFormatter.format(Number(paisa || 0) / 100)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const replacements = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return replacements[character];
  });
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const dateOnly = new Date(`${value}T00:00:00`);
    return Number.isNaN(dateOnly.getTime()) ? null : dateOnly;
  }

  const normalized = typeof value === 'string' ? value.replace(' ', 'T') : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDateValue(value);
  if (!date) {
    return '--';
  }
  return date.toLocaleDateString('en-NP', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatTime(value) {
  const date = parseDateValue(value);
  if (!date) {
    return '--';
  }
  return date.toLocaleTimeString('en-NP', {
    hour: 'numeric',
    minute: '2-digit'
  });
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

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateKey(date) {
  return toDateInputValue(date);
}

function dateKeyFromIso(value) {
  return String(value || '').slice(0, 10);
}

function enumerateDateKeys(from, to) {
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  const keys = [];
  for (let time = fromTime; time <= toTime; time += 86400000) {
    keys.push(new Date(time).toISOString().slice(0, 10));
  }
  return keys;
}

function formatRangeLabel(from, to) {
  const start = parseDateValue(from);
  const end = parseDateValue(to);
  if (!start || !end) {
    return '--';
  }
  const formatter = new Intl.DateTimeFormat('en-NP', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  return `${formatter.format(start)} to ${formatter.format(end)}`;
}

function statusChip(status) {
  const label = STATUS_LABELS[status] || status || 'Unknown';
  return `<span class="status-chip ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

const STAT_ICON_SVGS = {
  revenue:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.5"></circle><path d="M6 10h.01M18 14h.01"></path></svg>',
  orders:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 2h16v20l-4-3-4 3-4-3-4 3V2Z"></path><path d="M8 7h8M8 11h6"></path></svg>',
  unpaid:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
  average:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3v18h18"></path><path d="m7 14 4-4 4 3 5-6"></path></svg>',
  days:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M8 2v4M16 2v4M3 10h18"></path></svg>'
};

function statIcon(name) {
  return `<span class="stat-icon" aria-hidden="true">${STAT_ICON_SVGS[name] || STAT_ICON_SVGS.revenue}</span>`;
}

function revenueTrendMarkup(current, previous) {
  if (!previous && !current) {
    return '';
  }
  if (!previous) {
    return '<span class="stat-trend up">&#8599; New sales today</span>';
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 1) {
    return '<span class="stat-trend flat">&#8594; Level with yesterday</span>';
  }
  const direction = change > 0 ? 'up' : 'down';
  const arrow = change > 0 ? '&#8599;' : '&#8600;';
  return `<span class="stat-trend ${direction}">${arrow} ${Math.abs(change).toFixed(0)}% vs yesterday</span>`;
}

function setButtonBusy(button, busy, label) {
  if (!button) {
    return;
  }

  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = label || 'Working...';
    return;
  }

  button.disabled = false;
  button.classList.remove('is-busy');
  if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
  }
}

function setFormError(element, message) {
  if (!element) {
    return;
  }
  element.textContent = message || '';
  element.classList.toggle('hidden', !message);
}

function toast(message, type = 'info', timeout = 3000) {
  const region = $('toastRegion');
  if (!region) {
    return;
  }

  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.setAttribute('role', 'status');
  node.textContent = message;
  node.addEventListener('click', () => node.remove());
  region.append(node);
  window.setTimeout(() => {
    node.classList.add('leaving');
    window.setTimeout(() => node.remove(), 220);
  }, timeout);
}

function handleApiError(error) {
  if (!error || error.status === 401) {
    return;
  }
  toast(error.message || 'The request could not be completed.', 'error');
}

async function adminApi(path, options = {}) {
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

  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && state.admin) {
      showLogin('Your admin session expired. Sign in again to continue.');
    }
    const error = new Error(
      data?.error?.message || `The request failed with status ${response.status}.`
    );
    error.status = response.status;
    error.code = data?.error?.code || 'REQUEST_FAILED';
    throw error;
  }

  return data;
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!state.audioContext) {
    try {
      state.audioContext = new AudioContextClass();
    } catch {
      return null;
    }
  }

  if (state.audioContext.state === 'suspended') {
    state.audioContext.resume().catch(() => {});
  }

  return state.audioContext;
}

function playAlert() {
  if (!state.sound) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  const start = context.currentTime + 0.02;
  const notes = [880, 1046.5, 1318.5];

  notes.forEach((frequency, index) => {
    const offset = index * 0.16;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.17, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.14);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.16);
  });
}

function loadSoundPreference() {
  try {
    const stored = window.localStorage.getItem(SOUND_STORAGE_KEY);
    state.sound = stored !== 'off';
  } catch {
    state.sound = true;
  }
}

function saveSoundPreference() {
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, state.sound ? 'on' : 'off');
  } catch {
    return;
  }
}

function updateSoundButton() {
  const button = $('soundToggleButton');
  const label = $('soundToggleLabel');
  if (!button || !label) {
    return;
  }

  button.classList.toggle('muted', !state.sound);
  button.setAttribute('aria-pressed', String(state.sound));
  label.textContent = state.sound ? 'Sound on' : 'Sound off';
}

function toggleSound() {
  state.sound = !state.sound;
  saveSoundPreference();
  updateSoundButton();
  if (state.sound) {
    getAudioContext();
  }
  toast(state.sound ? 'New-order sound alerts are on.' : 'New-order sound alerts are off.');
}

function unlockAudio() {
  if (state.sound) {
    getAudioContext();
  }
}

function setLiveStatus(online) {
  const pill = $('livePill');
  const orderPill = document.querySelector('.orders-panel .live-pill');

  [pill, orderPill].forEach((element) => {
    if (!element) {
      return;
    }
    element.classList.toggle('offline', !online);
    element.innerHTML = `<span></span>${online ? 'Live' : 'Offline'}`;
  });
}

function disconnectSocket() {
  const socket = state.socket;
  state.socket = null;
  if (socket) {
    socket.disconnect();
  }
  setLiveStatus(false);
}

function scheduleRefresh(kind) {
  window.clearTimeout(refreshTimers[kind]);
  refreshTimers[kind] = window.setTimeout(() => {
    if (kind === 'orders' && state.view === 'orders') {
      loadOrders({ silent: true }).catch(handleApiError);
    }
    if (kind === 'dashboard' && state.view === 'dashboard') {
      loadDashboard({ silent: true }).catch(handleApiError);
    }
  }, 240);
}

function connectSocket() {
  disconnectSocket();

  if (typeof window.io !== 'function') {
    setLiveStatus(false);
    return;
  }

  try {
    const socket = window.io();
    state.socket = socket;
    setLiveStatus(false);

    socket.on('connect', () => setLiveStatus(true));
    socket.on('disconnect', (reason) => {
      setLiveStatus(false);

      if (reason === 'io server disconnect' && state.socket === socket) {
        window.setTimeout(() => {
          if (state.socket === socket) {
            socket.connect();
          }
        }, 1000);
      }
    });
    socket.on('connect_error', () => setLiveStatus(false));

    socket.on('admin:order:new', (order) => {
      if (!order || !order.id) {
        return;
      }

      playAlert();
      const tableNumber = order.table?.number ? `Table ${order.table.number}` : 'an order';
      toast(
        `New order ${order.orderCode || ''} from ${tableNumber} - ${formatCurrency(order.totalPaisa)}.`,
        'success',
        6200
      );

      if (state.view === 'orders' || state.view === 'dashboard') {
        scheduleRefresh(state.view);
      } else {
        setOrderBadge(state.orderBadgeCount + 1);
      }
    });

    socket.on('admin:order:updated', () => {
      if (state.view === 'orders' || state.view === 'dashboard') {
        scheduleRefresh(state.view);
      }
    });
  } catch {
    setLiveStatus(false);
  }
}

async function init() {
  loadSoundPreference();
  updateSoundButton();
  initializeReportDates();
  setDashboardDate();
  bindEvents();
  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  document.addEventListener('keydown', unlockAudio, { once: true, capture: true });
  await restoreSession();
}

(async () => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    await init();
  }
})();

async function restoreSession() {
  try {
    const data = await adminApi('/api/admin/me');
    state.admin = data.admin;
    showApp();
  } catch (error) {
    showLogin(
      error.status === 401 ? '' : 'Could not reach the canteen server. Check the server and try again.'
    );
  }
}

function setDashboardDate() {
  const element = $('dashboardDate');
  if (!element) {
    return;
  }
  const today = new Intl.DateTimeFormat('en-NP', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());
  element.textContent = `Live service summary for ${today}.`;
}

function initializeReportDates() {
  const from = new Date();
  const to = new Date();
  from.setDate(from.getDate() - 29);
  const fromInput = $('reportFrom');
  const toInput = $('reportTo');
  if (fromInput) {
    fromInput.value = toDateInputValue(from);
  }
  if (toInput) {
    toInput.value = toDateInputValue(to);
  }
}

function getViewFromHash() {
  const candidate = window.location.hash.replace(/^#/, '');
  return VIEW_META[candidate] ? candidate : 'dashboard';
}

function showApp() {
  $('loginScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  updateAdminChrome();
  connectSocket();
  setView(getViewFromHash()).catch(handleApiError);
}

function updateAdminChrome() {
  if (!state.admin) {
    return;
  }

  const displayName = state.admin.displayName || state.admin.username || 'Canteen Admin';
  $('adminDisplayName').textContent = displayName;
  $('adminUsername').textContent = `@${state.admin.username || 'admin'}`;
  $('adminInitial').textContent = displayName.charAt(0).toUpperCase();
}

function showLogin(message = '') {
  state.admin = null;
  disconnectSocket();
  closeModal();
  closeSidebar();
  $('appShell').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('loginPassword').value = '';
  $('loginButton').disabled = false;
  $('loginButton').classList.remove('is-busy');
  $('loginButton').textContent = 'Sign in';
  setFormError($('loginError'), message);
  document.title = 'QuickBite | Staff Console';
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  window.setTimeout(() => $('loginUsername').focus(), 60);
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  const errorBox = $('loginError');
  const button = $('loginButton');

  if (!username || !password) {
    setFormError(errorBox, 'Enter both your username and password.');
    return;
  }

  setFormError(errorBox, '');
  setButtonBusy(button, true, 'Signing in');

  try {
    const data = await adminApi('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    state.admin = data.admin;
    $('loginForm').reset();
    $('loginPassword').type = 'password';
    $('togglePasswordButton').textContent = 'Show';
    showApp();
    toast(`Signed in as ${state.admin.displayName || state.admin.username}.`, 'success');
  } catch (error) {
    setFormError(errorBox, error.message || 'Sign in failed.');
  } finally {
    setButtonBusy(button, false);
  }
}

function togglePasswordVisibility() {
  const input = $('loginPassword');
  const button = $('togglePasswordButton');
  const makingVisible = input.type === 'password';
  input.type = makingVisible ? 'text' : 'password';
  button.textContent = makingVisible ? 'Hide' : 'Show';
  button.setAttribute('aria-label', makingVisible ? 'Hide password' : 'Show password');
}

async function handleLogout() {
  try {
    await adminApi('/api/admin/logout', { method: 'POST' });
  } catch (error) {
    if (error?.status !== 401) {
      toast('Signed out on this device. The server could not be reached.', 'error', 5200);
    }
  }
  showLogin();
}

function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebarBackdrop').classList.remove('hidden');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').classList.add('hidden');
}

function setOrderBadge(count) {
  const badge = $('sidebarOrderBadge');
  state.orderBadgeCount = Math.max(0, Number(count) || 0);
  if (!badge) {
    return;
  }
  badge.textContent = state.orderBadgeCount > 99 ? '99+' : String(state.orderBadgeCount);
  badge.classList.toggle('hidden', state.orderBadgeCount === 0);
}

async function setView(view) {
  const nextView = VIEW_META[view] ? view : 'dashboard';
  state.view = nextView;

  document.querySelectorAll('.admin-view').forEach((section) => {
    section.classList.toggle('hidden', section.id !== `view-${nextView}`);
  });

  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === nextView);
  });

  const meta = VIEW_META[nextView];
  $('pageTitle').textContent = meta.title;
  $('pageEyebrow').textContent = meta.eyebrow;
  document.title = `${meta.title} | QuickBite Staff`;
  closeSidebar();

  const nextHash = `#${nextView}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${nextHash}`
    );
  }

  await loadView(nextView);
}

async function loadView(view) {
  if (view === 'dashboard') {
    await loadDashboard();
    return;
  }
  if (view === 'orders') {
    await loadOrders();
    return;
  }
  if (view === 'menu') {
    await loadMenu();
    return;
  }
  if (view === 'tables') {
    await loadTables();
    return;
  }
  if (view === 'reports') {
    await loadReport();
    return;
  }
  if (view === 'settings') {
    await loadSettings();
  }
}

async function refreshCurrentView() {
  const button = $('refreshViewButton');
  setButtonBusy(button, true, 'Refreshing');

  try {
    await loadView(state.view);
    toast('View refreshed.', 'success', 1900);
  } catch (error) {
    handleApiError(error);
  } finally {
    setButtonBusy(button, false);
  }
}

function setDashboardLoading() {
  $('dashboardStats').innerHTML = Array.from({ length: 4 })
    .map(
      () => `
        <article class="stat-card">
          <span class="stat-label">Loading</span>
          <span class="stat-value">--</span>
          <span class="stat-detail">Fetching today's numbers...</span>
        </article>`
    )
    .join('');
  $('weekChart').innerHTML = '<div class="chart-empty">Loading revenue trend...</div>';
  $('topItems').innerHTML = '<div class="rank-empty">Loading top dishes...</div>';
  $('recentOrders').innerHTML = '<div class="empty-state">Loading recent orders...</div>';
}

async function loadDashboard(options = {}) {
  const sequence = ++dashboardRequestSequence;
  if (!options.silent) {
    setDashboardLoading();
  }

  const data = await adminApi('/api/admin/dashboard');
  if (sequence !== dashboardRequestSequence) {
    return;
  }

  state.dashboard = data;
  renderDashboard(data);
}

function renderDashboard(data) {
  const activeOrders = data.activeOrders || { placed: 0, preparing: 0, ready: 0 };
  const activeTotal =
    Number(activeOrders.placed || 0) +
    Number(activeOrders.preparing || 0) +
    Number(activeOrders.ready || 0);
  const today = data.today || { orderCount: 0, revenuePaisa: 0 };
  const pendingPayments = Number(data.pendingPayments || 0);
  const averageOrder = today.orderCount > 0 ? today.revenuePaisa / today.orderCount : 0;

  setOrderBadge(activeTotal);

  const byDate = new Map(
    (data.lastSevenDays || []).map((row) => [dateKeyFromIso(row.date), row])
  );
  const yesterday = new Date();
  yesterday.setHours(12, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayRevenue = Number(byDate.get(localDateKey(yesterday))?.revenuePaisa || 0);

  const cards = [
    {
      label: "Today's revenue",
      value: formatCurrency(today.revenuePaisa),
      detail: `${today.orderCount} paid ${today.orderCount === 1 ? 'order' : 'orders'}`,
      tone: '',
      icon: 'revenue',
      trend: revenueTrendMarkup(Number(today.revenuePaisa || 0), yesterdayRevenue)
    },
    {
      label: 'Active orders',
      value: String(activeTotal),
      detail: `${activeOrders.placed || 0} new, ${activeOrders.preparing || 0} preparing, ${activeOrders.ready || 0} ready`,
      tone: 'amber',
      icon: 'orders'
    },
    {
      label: 'Unpaid orders',
      value: String(pendingPayments),
      detail: 'Waiting for demo payment',
      tone: pendingPayments > 0 ? 'danger' : 'info',
      icon: 'unpaid'
    },
    {
      label: 'Average bill',
      value: formatCurrency(averageOrder),
      detail: 'Per paid order today',
      tone: 'info',
      icon: 'average'
    }
  ];

  $('dashboardStats').innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card ${card.tone}">
          <div class="stat-card-head">
            <span class="stat-label">${escapeHtml(card.label)}</span>
            ${statIcon(card.icon)}
          </div>
          <span class="stat-value">${escapeHtml(card.value)}</span>
          <span class="stat-detail">${escapeHtml(card.detail)}</span>
          ${card.trend || ''}
        </article>`
    )
    .join('');

  const weekPoints = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = localDateKey(date);
    const row = byDate.get(key);
    weekPoints.push({
      label: date.toLocaleDateString('en-NP', { weekday: 'short' }),
      value: Number(row?.revenuePaisa || 0),
      title: formatDate(key)
    });
  }
  renderBarChart($('weekChart'), weekPoints, 'No paid orders in the last seven days.');

  const topItems = data.topItems || [];
  $('topItems').innerHTML = topItems.length
    ? topItems
        .map(
          (item, index) => `
            <div class="rank-item">
              <span class="rank-number">${index + 1}</span>
              <span class="rank-info">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${item.quantity} sold</span>
              </span>
              <span class="rank-value">${escapeHtml(formatCurrency(item.revenuePaisa))}</span>
            </div>`
        )
        .join('')
    : '<div class="rank-empty">No dish sales recorded today yet.</div>';

  renderRecentOrders(data.recentOrders || []);
}

function renderBarChart(container, points, emptyMessage) {
  const maxValue = Math.max(...points.map((point) => point.value), 0);
  if (!points.length || maxValue <= 0) {
    container.innerHTML = `<div class="chart-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = points
    .map((point) => {
      const height = Math.max(3, Math.round((point.value / maxValue) * 100));
      return `
        <div class="chart-column" title="${escapeHtml(point.title || point.label)}">
          <div class="chart-bar-track">
            <div class="chart-bar" style="height: ${height}%" data-value="${escapeHtml(formatCurrency(point.value))}"></div>
          </div>
          <span class="chart-label">${escapeHtml(point.label)}</span>
        </div>`;
    })
    .join('');
}

function renderRecentOrders(orders) {
  if (!orders.length) {
    $('recentOrders').innerHTML = '<div class="empty-state">No orders have been paid yet.</div>';
    return;
  }

  $('recentOrders').innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Order</th>
          <th>Table</th>
          <th>Customer</th>
          <th>Total</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${orders
          .map(
            (order) => `
              <tr>
                <td>
                  <strong>${escapeHtml(order.orderCode)}</strong>
                  <span class="subtle">${escapeHtml(formatTime(order.createdAt))}</span>
                </td>
                <td>${escapeHtml(formatTable(order.table))}</td>
                <td>${escapeHtml(order.customer?.name || '--')}</td>
                <td>${escapeHtml(formatCurrency(order.totalPaisa))}</td>
                <td>${statusChip(order.status)}</td>
                <td>
                  <button class="mini-button" type="button" data-order-view="${order.id}">Details</button>
                </td>
              </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function formatTable(table) {
  if (!table) {
    return '--';
  }
  return table.label ? `Table ${table.number} - ${table.label}` : `Table ${table.number}`;
}

function setOrderBoardTitle() {
  const titles = {
    active: 'Live orders',
    all: 'All orders',
    placed: 'New orders',
    preparing: 'Preparing orders',
    ready: 'Ready orders',
    pending_payment: 'Unpaid orders',
    completed: 'Completed orders',
    cancelled: 'Cancelled orders'
  };
  $('orderBoardTitle').textContent = titles[state.orderFilter] || 'Orders';
}

function setOrdersLoading() {
  setOrderBoardTitle();
  $('orderBoardSummary').textContent = 'Loading orders...';
  $('ordersBoard').className = 'orders-board mode-single';
  $('ordersBoard').innerHTML = '<div class="empty-state">Loading orders...</div>';
}

function buildOrdersUrl(status, search) {
  const params = new URLSearchParams({ limit: '100' });
  if (status) {
    params.set('status', status);
  }
  if (search) {
    params.set('search', search);
  }
  return `/api/admin/orders?${params.toString()}`;
}

async function loadOrders(options = {}) {
  const sequence = ++ordersRequestSequence;
  if (!options.silent) {
    setOrdersLoading();
  }

  const filter = state.orderFilter;
  const search = state.orderSearch;
  let orders = [];
  let total = 0;

  if (filter === 'active') {
    const results = await Promise.all(
      ACTIVE_STATUSES.map((status) => adminApi(buildOrdersUrl(status, search)))
    );
    orders = results.flatMap((result) => result.orders || []);
    total = orders.length;
  } else {
    const status = filter === 'all' ? '' : filter;
    const data = await adminApi(buildOrdersUrl(status, search));
    orders = data.orders || [];
    total = Number(data.pagination?.total || orders.length);
  }

  if (sequence !== ordersRequestSequence) {
    return;
  }

  orders.sort((left, right) => {
    const leftTime = parseDateValue(left.createdAt)?.getTime() || 0;
    const rightTime = parseDateValue(right.createdAt)?.getTime() || 0;
    return rightTime - leftTime || Number(right.id) - Number(left.id);
  });

  state.orders = orders;

  if (filter === 'active' && !search) {
    setOrderBadge(total);
  }

  renderOrders(orders, total);
}

function renderOrders(orders, total) {
  setOrderBoardTitle();

  const searchNote = state.orderSearch
    ? ` matching "${state.orderSearch}"`
    : '';

  if (state.orderFilter === 'active') {
    const counts = Object.fromEntries(ACTIVE_STATUSES.map((status) => [status, 0]));
    orders.forEach((order) => {
      if (counts[order.status] !== undefined) {
        counts[order.status] += 1;
      }
    });
    $('orderBoardSummary').textContent =
      `${total} active ${total === 1 ? 'order' : 'orders'}${searchNote} - ` +
      `${counts.placed} new, ${counts.preparing} preparing, ${counts.ready} ready.`;
  } else {
    const label =
      state.orderFilter === 'all'
        ? 'order'
        : (ORDER_GROUPS[state.orderFilter] || 'order').toLowerCase();
    $('orderBoardSummary').textContent =
      `${total} ${label} ${total === 1 ? 'order' : 'orders'}${searchNote}.`;
  }

  if (!orders.length) {
    $('ordersBoard').className = 'orders-board mode-single';
    $('ordersBoard').innerHTML = `
      <div class="empty-state">
        No ${state.orderFilter === 'all' ? '' : escapeHtml((ORDER_GROUPS[state.orderFilter] || 'active').toLowerCase()) + ' '}orders found${escapeHtml(searchNote)}.
      </div>`;
    return;
  }

  let groups;
  if (state.orderFilter === 'active') {
    groups = ACTIVE_STATUSES.map((status) => ({ status, label: ORDER_GROUPS[status] }));
  } else if (state.orderFilter === 'all') {
    groups = ALL_STATUSES.map((status) => ({ status, label: ORDER_GROUPS[status] }))
      .filter((group) => orders.some((order) => order.status === group.status));
  } else {
    groups = [{ status: state.orderFilter, label: ORDER_GROUPS[state.orderFilter] || 'Orders' }];
  }

  const modeClass =
    groups.length === 1 ? ' mode-single' : groups.length >= 4 ? ' mode-list' : '';
  $('ordersBoard').className = `orders-board${modeClass}`;

  $('ordersBoard').innerHTML = groups
    .map((group) => {
      const groupOrders = orders.filter((order) => order.status === group.status);
      const cards = groupOrders.map(orderCard).join('');
      return `
        <section class="orders-column">
          <div class="orders-column-head">
            <strong>${escapeHtml(group.label)}</strong>
            <span>${groupOrders.length}</span>
          </div>
          <div class="orders-column-body">
            ${cards || '<div class="order-empty-column">No orders here.</div>'}
          </div>
        </section>`;
    })
    .join('');
}

function orderCard(order) {
  const items = order.items || [];
  const preview = items
    .slice(0, 3)
    .map(
      (item) =>
        `<span>${Number(item.quantity)} x ${escapeHtml(item.name)}</span>`
    )
    .join('');
  const remaining = items.length > 3 ? `<span>+ ${items.length - 3} more item(s)</span>` : '';
  const scannedNote =
    order.scannedTable && Number(order.scannedTable.id) !== Number(order.table?.id)
      ? `<div class="order-card-customer">Scanned ${escapeHtml(formatTable(order.scannedTable))}</div>`
      : '';

  return `
    <article class="order-card ${escapeHtml(order.status)}">
      <div class="order-card-head">
        <div>
          <span class="order-code">${escapeHtml(order.orderCode)}</span>
          <span class="order-time">${escapeHtml(formatTime(order.createdAt))}</span>
        </div>
        ${statusChip(order.status)}
      </div>
      <div class="order-card-table">${escapeHtml(formatTable(order.table))}</div>
      <div class="order-card-customer">${escapeHtml(order.customer?.name || 'Guest')} - ${escapeHtml(order.customer?.phone || '')}</div>
      ${scannedNote}
      <div class="order-items-preview">${preview}${remaining}</div>
      <div class="order-card-footer">
        <span class="order-card-total">${escapeHtml(formatCurrency(order.totalPaisa))}</span>
        ${order.paymentStatus === 'paid' ? '<span class="status-chip completed">Paid</span>' : ''}
      </div>
      <div class="order-card-actions">${orderActions(order)}</div>
    </article>`;
}

function orderActions(order) {
  const actions = [];
  if (order.status === 'placed') {
    actions.push(
      `<button class="mini-button primary" type="button" data-order-action="status" data-order-id="${order.id}" data-status="preparing">Start preparing</button>`
    );
  } else if (order.status === 'preparing') {
    actions.push(
      `<button class="mini-button primary" type="button" data-order-action="status" data-order-id="${order.id}" data-status="ready">Mark ready</button>`
    );
  } else if (order.status === 'ready') {
    actions.push(
      `<button class="mini-button primary" type="button" data-order-action="status" data-order-id="${order.id}" data-status="completed">Complete</button>`
    );
  }

  actions.push(
    `<button class="mini-button" type="button" data-order-view="${order.id}">Details</button>`
  );

  if (ACTIVE_STATUSES.includes(order.status)) {
    actions.push(
      `<button class="mini-button danger" type="button" data-order-action="status" data-order-id="${order.id}" data-status="cancelled">Cancel</button>`
    );
  }

  return actions.join('');
}

async function handleOrderBoardClick(event) {
  const viewButton = event.target.closest('[data-order-view]');
  if (viewButton) {
    await viewOrder(Number(viewButton.dataset.orderView));
    return;
  }

  const actionButton = event.target.closest('[data-order-action="status"]');
  if (!actionButton) {
    return;
  }

  const orderId = Number(actionButton.dataset.orderId);
  const nextStatus = actionButton.dataset.status;
  const order = state.orders.find((entry) => Number(entry.id) === orderId);

  if (nextStatus === 'cancelled') {
    const confirmed = window.confirm(
      `Cancel order ${order?.orderCode || orderId}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
  }

  setButtonBusy(actionButton, true, 'Saving');

  try {
    const data = await adminApi(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus })
    });
    toast(
      `Order ${data.order?.orderCode || orderId} moved to ${STATUS_LABELS[nextStatus] || nextStatus}.`,
      'success'
    );
    await loadOrders({ silent: true });
  } catch (error) {
    handleApiError(error);
    setButtonBusy(actionButton, false);
  }
}

async function viewOrder(orderId) {
  try {
    const data = await adminApi(`/api/admin/orders/${orderId}`);
    const order = data.order;
    const items = order.items || [];
    const payment = order.payment || {};
    const scannedTable =
      order.scannedTable && Number(order.scannedTable.id) !== Number(order.table?.id)
        ? formatTable(order.scannedTable)
        : 'Not scanned / same as selected';

    const body = `
      <div class="modal-detail-grid">
        <div class="detail-box">
          <span>Order</span>
          <strong>${escapeHtml(order.orderCode)}</strong>
        </div>
        <div class="detail-box">
          <span>Status</span>
          ${statusChip(order.status)}
        </div>
        <div class="detail-box">
          <span>Table</span>
          <strong>${escapeHtml(formatTable(order.table))}</strong>
        </div>
        <div class="detail-box">
          <span>Scanned table</span>
          <strong>${escapeHtml(scannedTable)}</strong>
        </div>
        <div class="detail-box">
          <span>Customer</span>
          <strong>${escapeHtml(order.customer?.name || '--')}</strong>
        </div>
        <div class="detail-box">
          <span>Phone</span>
          <strong>${escapeHtml(order.customer?.phone || '--')}</strong>
        </div>
        <div class="detail-box">
          <span>Placed</span>
          <strong>${escapeHtml(formatDateTime(order.createdAt))}</strong>
        </div>
        <div class="detail-box">
          <span>Payment</span>
          <strong>${escapeHtml(order.paymentStatus || 'pending')} - eSewa demo</strong>
        </div>
      </div>
      <div class="detail-box">
        <span>Items</span>
        <ul class="detail-list">
          ${items
            .map(
              (item) => `
                <li>
                  <span>${Number(item.quantity)} x ${escapeHtml(item.name)}<small>${escapeHtml(formatCurrency(item.unitPricePaisa))} each</small></span>
                  <strong>${escapeHtml(formatCurrency(item.lineTotalPaisa))}</strong>
                </li>`
            )
            .join('')}
          <li>
            <span><strong>Total</strong></span>
            <strong>${escapeHtml(formatCurrency(order.totalPaisa))}</strong>
          </li>
        </ul>
      </div>
      <div class="detail-box">
        <span>Notes</span>
        <strong>${escapeHtml(order.notes || 'No special instructions.')}</strong>
      </div>
      <div class="detail-box">
        <span>Payment reference</span>
        <strong>${escapeHtml(payment.reference || 'Not paid yet')}</strong>
      </div>`;

    openModal({
      title: order.orderCode,
      eyebrow: 'Order details',
      wide: true,
      body,
      footer: '<button class="button secondary" type="button" data-close-modal>Close</button>'
    });
  } catch (error) {
    handleApiError(error);
  }
}

async function loadMenu(options = {}) {
  if (!options.silent) {
    $('menuItemsSummary').textContent = 'Loading menu...';
    $('menuItemsGrid').innerHTML = '<div class="empty-state">Loading menu items...</div>';
    $('categoriesList').innerHTML = '<div class="empty-state">Loading categories...</div>';
  }

  const [categoriesData, itemsData] = await Promise.all([
    adminApi('/api/admin/categories'),
    adminApi('/api/admin/menu-items')
  ]);

  state.categories = categoriesData.categories || [];
  state.menuItems = itemsData.items || [];
  renderMenu();
}

function renderMenu() {
  const activeItems = state.menuItems.filter((item) => !item.isArchived);
  const available = activeItems.filter((item) => item.isAvailable).length;
  const unavailable = activeItems.length - available;
  const archived = state.menuItems.length - activeItems.length;

  $('menuItemsSummary').textContent =
    `${available} available, ${unavailable} unavailable, ${archived} archived.`;

  $('menuItemsGrid').innerHTML = state.menuItems.length
    ? state.menuItems.map(menuItemCard).join('')
    : '<div class="empty-state">No menu items yet. Add your first dish to get started.</div>';

  $('categoriesList').innerHTML = state.categories.length
    ? state.categories.map(categoryRow).join('')
    : '<div class="empty-state">No categories yet. Add a category before adding dishes.</div>';

  setMenuTab(state.menuTab);
}

function menuItemCard(item) {
  const image = item.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name || 'Menu item')}" loading="lazy">`
    : escapeHtml((item.name || '?').charAt(0).toUpperCase());
  const statuses = [
    item.isArchived
      ? '<span class="status-chip cancelled">Archived</span>'
      : item.isAvailable
        ? '<span class="status-chip completed">Available</span>'
        : '<span class="status-chip off">Unavailable</span>'
  ].join('');

  const archiveAction = item.isArchived
    ? `<button class="mini-button" type="button" data-menu-action="restore" data-item-id="${item.id}">Restore</button>`
    : `<button class="mini-button" type="button" data-menu-action="toggle-availability" data-item-id="${item.id}">
        ${item.isAvailable ? 'Mark unavailable' : 'Mark available'}
      </button>
      <button class="mini-button danger" type="button" data-menu-action="archive" data-item-id="${item.id}">Archive</button>`;

  return `
    <article class="menu-admin-card ${item.isArchived ? 'archived' : ''}">
      <div class="menu-admin-media">${image}</div>
      <div class="menu-admin-body">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="menu-admin-meta">${escapeHtml(item.categoryName || 'Uncategorised')} - sort ${Number(item.sortOrder)}</div>
        <span class="menu-admin-price">${escapeHtml(formatCurrency(item.pricePaisa))}</span>
        <div class="menu-status-row">${statuses}</div>
        <div class="menu-actions">
          <button class="mini-button" type="button" data-menu-action="edit" data-item-id="${item.id}">Edit</button>
          ${archiveAction}
        </div>
      </div>
    </article>`;
}

function categoryRow(category) {
  return `
    <div class="category-admin-row">
      <div class="category-admin-main">
        <strong>${escapeHtml(category.name)}</strong>
        <span>${Number(category.itemCount || 0)} item(s) - sort order ${Number(category.sortOrder)}</span>
        <div class="menu-status-row">
          ${category.isActive
            ? '<span class="status-chip completed">Active</span>'
            : '<span class="status-chip off">Inactive</span>'}
        </div>
      </div>
      <div class="category-admin-actions">
        <button class="mini-button" type="button" data-category-action="edit" data-category-id="${category.id}">Edit</button>
        <button class="mini-button danger" type="button" data-category-action="delete" data-category-id="${category.id}">Delete</button>
      </div>
    </div>`;
}

function setMenuTab(tab) {
  const nextTab = tab === 'categories' ? 'categories' : 'items';
  state.menuTab = nextTab;

  document.querySelectorAll('[data-menu-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.menuTab === nextTab);
  });

  $('menuItemsPane').classList.toggle('hidden', nextTab !== 'items');
  $('menuCategoriesPane').classList.toggle('hidden', nextTab !== 'categories');
}

function categoryOptions(selectedId) {
  return state.categories
    .map(
      (category) => `
        <option value="${category.id}" ${Number(selectedId) === Number(category.id) ? 'selected' : ''}>
          ${escapeHtml(category.name)}${category.isActive ? '' : ' (inactive)'}
        </option>`
    )
    .join('');
}

function openMenuItemModal(item = null) {
  if (!state.categories.length) {
    setMenuTab('categories');
    toast('Add a category before adding menu items.', 'error');
    return;
  }

  const editing = Boolean(item);
  const price = item ? (Number(item.pricePaisa) / 100).toFixed(2) : '';
  const currentImage = item?.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="Current dish photo">`
    : 'No photo selected';

  const body = `
    <form id="menuItemForm">
      <div class="form-grid">
        <label class="field field-wide">
          <span>Dish name</span>
          <input id="menuItemName" name="name" type="text" minlength="2" maxlength="120" required value="${escapeHtml(item?.name || '')}">
        </label>
        <label class="field">
          <span>Category</span>
          <select id="menuItemCategory" name="categoryId" required>
            ${categoryOptions(item?.categoryId)}
          </select>
        </label>
        <label class="field">
          <span>Price (NPR)</span>
          <input id="menuItemPrice" name="price" type="number" min="0.01" max="9999999" step="0.01" required value="${escapeHtml(price)}">
        </label>
        <label class="field field-wide">
          <span>Description</span>
          <textarea id="menuItemDescription" name="description" maxlength="1000">${escapeHtml(item?.description || '')}</textarea>
        </label>
        <label class="field">
          <span>Sort order</span>
          <input id="menuItemSortOrder" name="sortOrder" type="number" min="-10000" max="10000" step="1" value="${Number(item?.sortOrder || 0)}">
        </label>
        <label class="checkbox-field">
          <input id="menuItemAvailable" type="checkbox" ${!item || item.isAvailable ? 'checked' : ''}>
          Available to customers
        </label>
        <div class="field field-wide">
          <span>Dish photo</span>
          <div class="image-preview" id="menuImagePreview">${currentImage}</div>
          <input class="file-input" id="menuImageInput" name="image" type="file" accept="image/jpeg,image/png,image/webp">
          <small>JPG, PNG or WebP. Maximum 2 MB.</small>
          ${item?.imageUrl ? '<label class="checkbox-field"><input id="menuRemoveImage" type="checkbox"> Remove current photo</label>' : ''}
        </div>
        <div class="form-error hidden field-wide" id="menuItemError" role="alert"></div>
      </div>
    </form>`;

  openModal({
    title: editing ? 'Edit menu item' : 'Add menu item',
    eyebrow: 'Catalogue',
    wide: true,
    body,
    footer: `
      <button class="button secondary" type="button" data-close-modal>Cancel</button>
      <button class="button primary" id="saveMenuItemButton" type="submit" form="menuItemForm">
        ${editing ? 'Save changes' : 'Add item'}
      </button>`
  });

  const form = $('menuItemForm');
  const imageInput = $('menuImageInput');
  const preview = $('menuImagePreview');
  const removeImage = $('menuRemoveImage');
  const fileInputError = $('menuItemError');

  imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    setFormError(fileInputError, '');

    if (!file) {
      preview.innerHTML = item?.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" alt="Current dish photo">`
        : 'No photo selected';
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError(fileInputError, 'Choose a JPG, PNG, or WebP image.');
      imageInput.value = '';
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setFormError(fileInputError, 'The image must be 2 MB or smaller.');
      imageInput.value = '';
      return;
    }

    if (removeImage) {
      removeImage.checked = false;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      preview.innerHTML = `<img src="${reader.result}" alt="Selected dish photo preview">`;
    });
    reader.readAsDataURL(file);
  });

  if (removeImage) {
    removeImage.addEventListener('change', () => {
      if (removeImage.checked) {
        imageInput.value = '';
        preview.textContent = 'The current photo will be removed when you save.';
      } else {
        preview.innerHTML = `<img src="${escapeHtml(item.imageUrl)}" alt="Current dish photo">`;
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(fileInputError, '');

    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    formData.set('name', $('menuItemName').value.trim());
    formData.set('categoryId', $('menuItemCategory').value);
    formData.set('price', $('menuItemPrice').value);
    formData.set('description', $('menuItemDescription').value.trim());
    formData.set('sortOrder', $('menuItemSortOrder').value || '0');
    formData.set('isAvailable', $('menuItemAvailable').checked ? '1' : '0');
    if (removeImage?.checked && !imageInput.files?.length) {
      formData.set('removeImage', '1');
    }

    const button = $('saveMenuItemButton');
    setButtonBusy(button, true, 'Saving');

    try {
      await adminApi(editing ? `/api/admin/menu-items/${item.id}` : '/api/admin/menu-items', {
        method: editing ? 'PATCH' : 'POST',
        body: formData
      });
      closeModal();
      toast(editing ? 'Menu item updated.' : 'Menu item added.', 'success');
      await loadMenu({ silent: true });
    } catch (error) {
      setFormError(fileInputError, error.message || 'Could not save the menu item.');
      setButtonBusy(button, false);
    }
  });
}

function openCategoryModal(category = null) {
  const editing = Boolean(category);
  const body = `
    <form id="categoryForm">
      <div class="form-grid">
        <label class="field field-wide">
          <span>Category name</span>
          <input id="categoryName" name="name" type="text" minlength="2" maxlength="80" required value="${escapeHtml(category?.name || '')}">
        </label>
        <label class="field">
          <span>Sort order</span>
          <input id="categorySortOrder" name="sortOrder" type="number" min="-10000" max="10000" step="1" value="${Number(category?.sortOrder || 0)}">
        </label>
        <label class="checkbox-field">
          <input id="categoryActive" type="checkbox" ${!category || category.isActive ? 'checked' : ''}>
          Show category to customers
        </label>
        <div class="form-error hidden field-wide" id="categoryError" role="alert"></div>
      </div>
    </form>`;

  openModal({
    title: editing ? 'Edit category' : 'Add category',
    eyebrow: 'Catalogue',
    body,
    footer: `
      <button class="button secondary" type="button" data-close-modal>Cancel</button>
      <button class="button primary" id="saveCategoryButton" type="submit" form="categoryForm">
        ${editing ? 'Save changes' : 'Add category'}
      </button>`
  });

  const form = $('categoryForm');
  const errorBox = $('categoryError');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(errorBox, '');

    if (!form.reportValidity()) {
      return;
    }

    const button = $('saveCategoryButton');
    setButtonBusy(button, true, 'Saving');

    try {
      await adminApi(
        editing ? `/api/admin/categories/${category.id}` : '/api/admin/categories',
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: $('categoryName').value.trim(),
            sortOrder: $('categorySortOrder').value || 0,
            isActive: $('categoryActive').checked
          })
        }
      );
      closeModal();
      toast(editing ? 'Category updated.' : 'Category added.', 'success');
      setMenuTab('categories');
      await loadMenu({ silent: true });
    } catch (error) {
      setFormError(errorBox, error.message || 'Could not save the category.');
      setButtonBusy(button, false);
    }
  });
}

async function handleMenuClick(event) {
  const tabButton = event.target.closest('[data-menu-tab]');
  if (tabButton) {
    setMenuTab(tabButton.dataset.menuTab);
    return;
  }

  const menuButton = event.target.closest('[data-menu-action]');
  if (menuButton) {
    const item = state.menuItems.find(
      (entry) => Number(entry.id) === Number(menuButton.dataset.itemId)
    );
    if (!item) {
      return;
    }

    const action = menuButton.dataset.menuAction;
    if (action === 'edit') {
      openMenuItemModal(item);
      return;
    }

    setButtonBusy(menuButton, true, 'Saving');
    try {
      if (action === 'toggle-availability') {
        await adminApi(`/api/admin/menu-items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isAvailable: !item.isAvailable })
        });
        toast(`"${item.name}" is now ${item.isAvailable ? 'unavailable' : 'available'}.`, 'success');
      } else if (action === 'archive') {
        const confirmed = window.confirm(
          `Archive "${item.name}"? It will disappear from the customer menu.`
        );
        if (!confirmed) {
          setButtonBusy(menuButton, false);
          return;
        }
        await adminApi(`/api/admin/menu-items/${item.id}`, { method: 'DELETE' });
        toast(`"${item.name}" archived.`, 'success');
      } else if (action === 'restore') {
        await adminApi(`/api/admin/menu-items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isArchived: false })
        });
        toast(`"${item.name}" restored. Mark it available when ready.`, 'success');
      }
      await loadMenu({ silent: true });
    } catch (error) {
      handleApiError(error);
      setButtonBusy(menuButton, false);
    }
    return;
  }

  const categoryButton = event.target.closest('[data-category-action]');
  if (!categoryButton) {
    return;
  }

  const category = state.categories.find(
    (entry) => Number(entry.id) === Number(categoryButton.dataset.categoryId)
  );
  if (!category) {
    return;
  }

  if (categoryButton.dataset.categoryAction === 'edit') {
    openCategoryModal(category);
    return;
  }

  if (Number(category.itemCount || 0) > 0) {
    toast('Move this category\'s items, including archived ones, before deleting it.', 'error');
    return;
  }

  const confirmed = window.confirm(`Delete the category "${category.name}"?`);
  if (!confirmed) {
    return;
  }

  setButtonBusy(categoryButton, true, 'Deleting');
  try {
    await adminApi(`/api/admin/categories/${category.id}`, { method: 'DELETE' });
    toast('Category deleted.', 'success');
    await loadMenu({ silent: true });
  } catch (error) {
    handleApiError(error);
    setButtonBusy(categoryButton, false);
  }
}

async function loadTables(options = {}) {
  if (!options.silent) {
    $('tablesGrid').innerHTML = '<div class="empty-state">Loading tables...</div>';
  }

  const data = await adminApi('/api/admin/tables');
  state.tables = data.tables || [];
  renderTables();
}

function renderTables() {
  if (!state.tables.length) {
    $('tablesGrid').innerHTML =
      '<div class="empty-state">No tables yet. Add a table to create its QR code.</div>';
    return;
  }

  $('tablesGrid').innerHTML = state.tables.map(tableCard).join('');
}

function tableCard(table) {
  const updated = encodeURIComponent(table.updatedAt || String(Date.now()));
  const qrSrc = `${table.qrImageUrl}?v=${updated}`;
  const activeOrderText =
    Number(table.activeOrders || 0) > 0
      ? `${table.activeOrders} active order(s) at this table`
      : 'No active orders';
  const activeAction = table.isActive
    ? `<button class="mini-button" type="button" data-table-action="toggle" data-table-id="${table.id}">Deactivate</button>`
    : `<button class="mini-button" type="button" data-table-action="toggle" data-table-id="${table.id}">Activate</button>`;

  return `
    <article class="table-card ${table.isActive ? '' : 'inactive'}">
      <div class="table-card-head">
        <div>
          <h3>Table ${escapeHtml(table.number)}</h3>
          <p>${escapeHtml(table.label || (table.isActive ? 'QR ordering enabled' : 'QR ordering disabled'))}</p>
        </div>
        ${table.isActive
          ? '<span class="status-chip completed">Active</span>'
          : '<span class="status-chip off">Inactive</span>'}
      </div>
      <div class="table-qr-frame">
        ${table.isActive
          ? `<img src="${escapeHtml(qrSrc)}" alt="QR code for table ${escapeHtml(table.number)}" loading="lazy">`
          : '<span class="table-qr-placeholder">Activate this table to enable its QR.</span>'}
      </div>
      <p class="table-active-orders">${escapeHtml(activeOrderText)}</p>
      <div class="table-card-actions">
        <button class="mini-button" type="button" data-table-action="view-qr" data-table-id="${table.id}">View QR</button>
        <a class="mini-button" href="${escapeHtml(table.qrImageUrl)}?download=1" download>Download</a>
        <button class="mini-button" type="button" data-table-action="copy-link" data-table-id="${table.id}">Copy link</button>
        <button class="mini-button" type="button" data-table-action="edit" data-table-id="${table.id}">Edit</button>
        <button class="mini-button" type="button" data-table-action="regenerate" data-table-id="${table.id}">Regenerate</button>
        ${activeAction}
        <button class="mini-button danger" type="button" data-table-action="delete" data-table-id="${table.id}">Delete</button>
      </div>
    </article>`;
}

function openTableModal(table = null) {
  const editing = Boolean(table);
  const body = `
    <form id="tableForm">
      <div class="form-grid">
        <label class="field">
          <span>Table number</span>
          <input id="tableNumber" name="tableNumber" type="text" maxlength="20" required value="${escapeHtml(table?.number || '')}">
        </label>
        <label class="field">
          <span>Label (optional)</span>
          <input id="tableLabel" name="label" type="text" maxlength="80" value="${escapeHtml(table?.label || '')}" placeholder="Window seat, counter, etc.">
        </label>
        <label class="checkbox-field field-wide">
          <input id="tableActive" type="checkbox" ${!table || table.isActive ? 'checked' : ''}>
          Table is active and can accept QR orders
        </label>
        <div class="form-error hidden field-wide" id="tableError" role="alert"></div>
      </div>
    </form>`;

  openModal({
    title: editing ? `Edit table ${table.number}` : 'Add table',
    eyebrow: 'Dine-in service',
    body,
    footer: `
      <button class="button secondary" type="button" data-close-modal>Cancel</button>
      <button class="button primary" id="saveTableButton" type="submit" form="tableForm">
        ${editing ? 'Save changes' : 'Add table'}
      </button>`
  });

  const form = $('tableForm');
  const errorBox = $('tableError');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError(errorBox, '');

    if (!form.reportValidity()) {
      return;
    }

    const button = $('saveTableButton');
    setButtonBusy(button, true, 'Saving');

    try {
      await adminApi(editing ? `/api/admin/tables/${table.id}` : '/api/admin/tables', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          tableNumber: $('tableNumber').value.trim(),
          label: $('tableLabel').value.trim(),
          isActive: $('tableActive').checked
        })
      });
      closeModal();
      toast(editing ? 'Table updated.' : 'Table added with a new QR code.', 'success');
      await loadTables({ silent: true });
    } catch (error) {
      setFormError(errorBox, error.message || 'Could not save the table.');
      setButtonBusy(button, false);
    }
  });
}

function openQrModal(table) {
  const updated = encodeURIComponent(table.updatedAt || String(Date.now()));
  const qrSrc = `${table.qrImageUrl}?v=${updated}`;
  const body = `
    <div class="qr-modal">
      <img src="${escapeHtml(qrSrc)}" alt="QR code for table ${escapeHtml(table.number)}">
      <code>${escapeHtml(table.scanUrl)}</code>
      <p class="panel-subtitle">
        ${table.isActive
          ? 'Customers scan this code to open the menu with the table already selected.'
          : 'This table is inactive. Activate it before printing this QR code.'}
      </p>
    </div>`;

  openModal({
    title: `Table ${table.number}`,
    eyebrow: 'QR code',
    body,
    footer: `
      <a class="button secondary" href="${escapeHtml(table.qrImageUrl)}?download=1" download>Download PNG</a>
      <button class="button secondary" id="qrCopyButton" type="button">Copy scan link</button>
      <button class="button primary" type="button" data-close-modal>Done</button>`
  });

  $('qrCopyButton').addEventListener('click', () => copyText(table.scanUrl));
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast('Scan link copied.', 'success');
    return;
  } catch {}

  const temporary = document.createElement('textarea');
  temporary.value = value;
  temporary.setAttribute('readonly', '');
  temporary.style.position = 'fixed';
  temporary.style.opacity = '0';
  document.body.append(temporary);
  temporary.select();

  try {
    const copied = document.execCommand('copy');
    temporary.remove();
    if (copied) {
      toast('Scan link copied.', 'success');
    } else {
      toast('Could not copy the scan link.', 'error');
    }
  } catch {
    temporary.remove();
    toast('Could not copy the scan link.', 'error');
  }
}

async function handleTablesClick(event) {
  const button = event.target.closest('[data-table-action]');
  if (!button) {
    return;
  }

  const table = state.tables.find(
    (entry) => Number(entry.id) === Number(button.dataset.tableId)
  );
  if (!table) {
    return;
  }

  const action = button.dataset.tableAction;

  if (action === 'view-qr') {
    openQrModal(table);
    return;
  }

  if (action === 'edit') {
    openTableModal(table);
    return;
  }

  if (action === 'copy-link') {
    await copyText(table.scanUrl);
    return;
  }

  if (action === 'regenerate') {
    const confirmed = window.confirm(
      `Generate a new QR code for table ${table.number}? The existing printed QR will stop working.`
    );
    if (!confirmed) {
      return;
    }
  }

  if (action === 'toggle' && table.isActive && Number(table.activeOrders || 0) > 0) {
    const confirmed = window.confirm(
      `Table ${table.number} has active orders. Deactivate it anyway?`
    );
    if (!confirmed) {
      return;
    }
  }

  if (action === 'delete') {
    const confirmed = window.confirm(
      `Delete table ${table.number}? Tables with order history cannot be deleted.`
    );
    if (!confirmed) {
      return;
    }
  }

  setButtonBusy(button, true, 'Saving');

  try {
    if (action === 'regenerate') {
      await adminApi(`/api/admin/tables/${table.id}/regenerate-token`, {
        method: 'POST'
      });
      toast(`A new QR code was generated for table ${table.number}.`, 'success');
    } else if (action === 'toggle') {
      await adminApi(`/api/admin/tables/${table.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !table.isActive })
      });
      toast(`Table ${table.number} is now ${table.isActive ? 'inactive' : 'active'}.`, 'success');
    } else if (action === 'delete') {
      await adminApi(`/api/admin/tables/${table.id}`, { method: 'DELETE' });
      toast(`Table ${table.number} deleted.`, 'success');
    }
    await loadTables({ silent: true });
  } catch (error) {
    handleApiError(error);
    setButtonBusy(button, false);
  }
}

function setReportLoading() {
  $('reportSummary').innerHTML = Array.from({ length: 4 })
    .map(
      () => `
        <article class="stat-card">
          <span class="stat-label">Loading</span>
          <span class="stat-value">--</span>
          <span class="stat-detail">Calculating sales...</span>
        </article>`
    )
    .join('');
  $('reportChart').innerHTML = '<div class="chart-empty">Loading daily sales...</div>';
  $('reportTopItems').innerHTML = '<div class="rank-empty">Loading top dishes...</div>';
  $('reportCategories').innerHTML = '<div class="empty-state">Loading categories...</div>';
}

async function loadReport(options = {}) {
  const from = $('reportFrom').value;
  const to = $('reportTo').value;

  if (!from || !to) {
    throw new Error('Choose both a start date and an end date.');
  }

  if (from > to) {
    throw new Error('The start date cannot be after the end date.');
  }

  if (!options.silent) {
    setReportLoading();
  }

  const params = new URLSearchParams({ from, to });
  const data = await adminApi(`/api/admin/reports/sales?${params.toString()}`);
  state.report = data;
  renderReport(data);
}

function renderReport(data) {
  const summary = data.summary || {
    orderCount: 0,
    revenuePaisa: 0,
    averageOrderPaisa: 0
  };
  const daily = data.daily || [];
  const sellingDays = daily.filter((row) => Number(row.revenuePaisa) > 0).length;

  $('reportRangeLabel').textContent = formatRangeLabel(data.from, data.to);

  const cards = [
    {
      label: 'Revenue',
      value: formatCurrency(summary.revenuePaisa),
      detail: 'Paid, non-cancelled orders',
      tone: '',
      icon: 'revenue'
    },
    {
      label: 'Paid orders',
      value: String(summary.orderCount),
      detail: 'In the selected range',
      tone: 'amber',
      icon: 'orders'
    },
    {
      label: 'Average order',
      value: formatCurrency(summary.averageOrderPaisa),
      detail: 'Revenue divided by orders',
      tone: 'info',
      icon: 'average'
    },
    {
      label: 'Selling days',
      value: String(sellingDays),
      detail: `${daily.length} day(s) with sales activity`,
      tone: 'info',
      icon: 'days'
    }
  ];

  $('reportSummary').innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card ${card.tone}">
          <div class="stat-card-head">
            <span class="stat-label">${escapeHtml(card.label)}</span>
            ${statIcon(card.icon)}
          </div>
          <span class="stat-value">${escapeHtml(card.value)}</span>
          <span class="stat-detail">${escapeHtml(card.detail)}</span>
        </article>`
    )
    .join('');

  const dailyByDate = new Map(daily.map((row) => [dateKeyFromIso(row.date), row]));
  let points = [];
  const rangeLength =
    Math.round(
      (Date.parse(`${data.to}T00:00:00Z`) - Date.parse(`${data.from}T00:00:00Z`)) /
        86400000
    ) + 1;

  if (rangeLength <= 62) {
    points = enumerateDateKeys(data.from, data.to).map((key) => {
      const row = dailyByDate.get(key);
      const date = parseDateValue(key);
      return {
        label: String(date.getDate()),
        value: Number(row?.revenuePaisa || 0),
        title: formatDate(key)
      };
    });
  } else {
    points = daily.map((row) => ({
      label: String(Number(dateKeyFromIso(row.date).slice(8, 10))),
      value: Number(row.revenuePaisa || 0),
      title: formatDate(row.date)
    }));
  }

  renderBarChart($('reportChart'), points, 'No paid orders in this date range.');

  $('reportTopItems').innerHTML = (data.topItems || []).length
    ? data.topItems
        .map(
          (item, index) => `
            <div class="rank-item">
              <span class="rank-number">${index + 1}</span>
              <span class="rank-info">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${item.quantity} sold</span>
              </span>
              <span class="rank-value">${escapeHtml(formatCurrency(item.revenuePaisa))}</span>
            </div>`
        )
        .join('')
    : '<div class="rank-empty">No dishes were sold in this range.</div>';

  $('reportCategories').innerHTML = (data.categories || []).length
    ? `
      <table class="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Items sold</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${data.categories
            .map(
              (category) => `
                <tr>
                  <td><strong>${escapeHtml(category.name)}</strong></td>
                  <td>${Number(category.quantity)}</td>
                  <td>${escapeHtml(formatCurrency(category.revenuePaisa))}</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty-state">No category sales in this date range.</div>';
}

async function printReport() {
  try {
    if (!state.report) {
      await loadReport();
    }
    if (state.report) {
      window.print();
    }
  } catch (error) {
    handleApiError(error);
  }
}

async function loadSettings() {
  const data = await adminApi('/api/admin/settings');
  state.settings = data.settings;
  $('canteenNameInput').value = data.settings.canteenName || '';
  $('qrBaseUrlInput').value = data.settings.qrBaseUrl || '';
  $('resolvedQrBase').textContent = data.settings.resolvedQrBaseUrl || '--';
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const form = $('settingsForm');
  const errorBox = $('settingsError');
  const button = $('saveSettingsButton');
  setFormError(errorBox, '');

  if (!form.reportValidity()) {
    return;
  }

  setButtonBusy(button, true, 'Saving');

  try {
    const data = await adminApi('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        canteenName: $('canteenNameInput').value.trim(),
        qrBaseUrl: $('qrBaseUrlInput').value.trim()
      })
    });
    state.settings = data.settings;
    $('resolvedQrBase').textContent = data.settings.resolvedQrBaseUrl || '--';
    toast('Canteen settings saved.', 'success');
  } catch (error) {
    setFormError(errorBox, error.message || 'Could not save settings.');
  } finally {
    setButtonBusy(button, false);
  }
}

async function handlePasswordSubmit(event) {
  event.preventDefault();
  const form = $('passwordForm');
  const errorBox = $('passwordError');
  const button = $('changePasswordButton');
  setFormError(errorBox, '');

  if (!form.reportValidity()) {
    return;
  }

  const currentPassword = $('currentPassword').value;
  const newPassword = $('newPassword').value;
  const confirmPassword = $('confirmPassword').value;

  if (newPassword !== confirmPassword) {
    setFormError(errorBox, 'The new password and confirmation do not match.');
    return;
  }

  setButtonBusy(button, true, 'Updating');

  try {
    await adminApi('/api/admin/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    form.reset();
    connectSocket();
    toast('Password updated. Your current session has been renewed.', 'success');
  } catch (error) {
    setFormError(errorBox, error.message || 'Could not update the password.');
  } finally {
    setButtonBusy(button, false);
  }
}

function openModal({ title, eyebrow = '', body = '', footer = '', wide = false }) {
  const root = $('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay">
      <section class="modal-card ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <header class="modal-head">
          <div>
            ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
            <h2 id="modalTitle">${escapeHtml(title)}</h2>
          </div>
          <button class="modal-close" type="button" data-close-modal aria-label="Close dialog">&times;</button>
        </header>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </section>
    </div>`;
  root.classList.remove('hidden');
  document.body.classList.add('modal-open');

  window.requestAnimationFrame(() => {
    const target = root.querySelector('input, select, textarea, button');
    target?.focus();
  });
}

function closeModal() {
  const root = $('modalRoot');
  if (!root) {
    return;
  }
  root.classList.add('hidden');
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
}

function handleModalClick(event) {
  if (
    event.target.classList.contains('modal-overlay') ||
    event.target.closest('[data-close-modal]')
  ) {
    closeModal();
  }
}

function handleGlobalKeydown(event) {
  if (event.key !== 'Escape') {
    return;
  }

  if (!$('modalRoot').classList.contains('hidden')) {
    closeModal();
    return;
  }

  closeSidebar();
}

function handleDocumentClick(event) {
  if (state.admin) {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton && !viewButton.disabled) {
      setView(viewButton.dataset.view).catch(handleApiError);
      return;
    }
  }

  const menuTab = event.target.closest('[data-menu-tab]');
  if (menuTab && state.admin) {
    setMenuTab(menuTab.dataset.menuTab);
  }
}

function bindEvents() {
  $('loginForm').addEventListener('submit', handleLoginSubmit);
  $('togglePasswordButton').addEventListener('click', togglePasswordVisibility);
  $('loginForm').addEventListener('input', () => setFormError($('loginError'), ''));

  $('openSidebarButton').addEventListener('click', openSidebar);
  $('closeSidebarButton').addEventListener('click', closeSidebar);
  $('sidebarBackdrop').addEventListener('click', closeSidebar);

  $('soundToggleButton').addEventListener('click', toggleSound);
  $('refreshViewButton').addEventListener('click', refreshCurrentView);

  $('logoutButton').addEventListener('click', handleLogout);
  $('sidebarLogoutButton').addEventListener('click', handleLogout);
  $('settingsLogoutButton').addEventListener('click', handleLogout);

  $('orderFilters').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-order-filter]');
    if (!tab) {
      return;
    }
    state.orderFilter = tab.dataset.orderFilter;
    document.querySelectorAll('[data-order-filter]').forEach((button) => {
      const selected = button === tab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    loadOrders().catch(handleApiError);
  });

  $('orderSearch').addEventListener('input', (event) => {
    state.orderSearch = event.target.value.trim();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      if (state.view === 'orders') {
        loadOrders({ silent: true }).catch(handleApiError);
      }
    }, 300);
  });

  $('refreshOrdersButton').addEventListener('click', () => {
    loadOrders().catch(handleApiError);
  });

  $('addMenuItemButton').addEventListener('click', () => openMenuItemModal());
  $('addCategoryButton').addEventListener('click', () => openCategoryModal());
  $('addTableButton').addEventListener('click', () => openTableModal());

  $('menuItemsGrid').addEventListener('click', handleMenuClick);
  $('categoriesList').addEventListener('click', handleMenuClick);
  $('tablesGrid').addEventListener('click', handleTablesClick);

  $('ordersBoard').addEventListener('click', handleOrderBoardClick);
  $('recentOrders').addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-order-view]');
    if (viewButton) {
      await viewOrder(Number(viewButton.dataset.orderView));
    }
  });

  $('reportForm').addEventListener('submit', (event) => {
    event.preventDefault();
    state.report = null;
    loadReport().catch(handleApiError);
  });

  $('printReportButton').addEventListener('click', printReport);
  $('settingsForm').addEventListener('submit', handleSettingsSubmit);
  $('passwordForm').addEventListener('submit', handlePasswordSubmit);

  $('modalRoot').addEventListener('click', handleModalClick);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleGlobalKeydown);
}
