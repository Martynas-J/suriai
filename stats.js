const API_BASE = '';
const TOKEN_KEY = 'pieno-gaminiai-admin-token-v1';
const USER_KEY = 'pieno-gaminiai-admin-user-v1';

const money = value => `${Number(value).toFixed(2).replace('.', ',')} €`;
const escapeHTML = text => String(text ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));

const getToken = () => localStorage.getItem(TOKEN_KEY) || '';

async function apiGet(path) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { headers });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    showLogin();
    throw new Error('Sesija nebegalioja');
  }
  if (!res.ok) throw new Error('Klaida: ' + res.status);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Klaida: ' + res.status);
  return data;
}

const statsState = { from: '', to: '' };
let allOrders = [];

function getOrderTotal(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
  return (Number(order.price) || 0) * (Number(order.quantity) || 0);
}
function getOrderTotalQuantity(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return Number(order.quantity) || 0;
}
function getOrderProductEntries(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items.map(item => ({ name: item.name, quantity: Number(item.quantity) || 0 }));
  return [{ name: order.productName || 'Nežinomas produktas', quantity: Number(order.quantity) || 0 }];
}

function filteredOrders() {
  return allOrders.filter(order => {
    const date = String(order.date || '');
    return (!statsState.from || date >= statsState.from) && (!statsState.to || date <= statsState.to);
  });
}

function renderStats() {
  const orders = filteredOrders();
  const quantity = orders.reduce((sum, order) => sum + getOrderTotalQuantity(order), 0);
  const revenue = orders.filter(order => order.status !== 'Atšauktas').reduce((sum, order) => sum + getOrderTotal(order), 0);
  const statuses = ['Naujas', 'Patvirtintas', 'Įvykdytas', 'Atšauktas'];
  const productTotals = new Map();
  orders.forEach(order => {
    getOrderProductEntries(order).forEach(entry => {
      productTotals.set(entry.name, (productTotals.get(entry.name) || 0) + entry.quantity);
    });
  });
  const topProducts = [...productTotals.entries()].sort((a, b) => b[1] - a[1]);
  document.querySelector('#stats-orders').textContent = orders.length;
  document.querySelector('#stats-quantity').textContent = quantity;
  document.querySelector('#stats-revenue').textContent = money(revenue);
  document.querySelector('#stats-range-label').textContent = statsState.from || statsState.to ? `${statsState.from || 'Pradžia'} – ${statsState.to || 'dabar'}` : 'Visas laikotarpis';
  document.querySelector('#stats-statuses').innerHTML = statuses.map(status => `<div class="status-chip"><span>${orders.filter(order => order.status === status).length}</span>${escapeHTML(status)}</div>`).join('');
  document.querySelector('#top-products').innerHTML = topProducts.length ? topProducts.map(([name, count], index) => `<div class="product-rank"><span>${index + 1}</span><strong>${escapeHTML(name)}</strong><b>${count} vnt.</b></div>`).join('') : '<p class="muted">Dar nėra užsakymų.</p>';
}

function showLogin() {
  document.querySelector('#stats-login').hidden = false;
  document.querySelector('#stats-content').hidden = true;
}

function showStats() {
  document.querySelector('#stats-login').hidden = true;
  document.querySelector('#stats-content').hidden = false;
  loadOrders();
}

async function loadOrders() {
  try {
    allOrders = await apiGet('/api/orders?limit=1000');
  } catch (err) {
    console.error('Nepavyko gauti užsakymų:', err);
    allOrders = [];
  }
  renderStats();
}

document.querySelector('#stats-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = document.querySelector('#stats-login-error');
  if (errorEl) errorEl.textContent = '';
  const username = document.querySelector('#stats-username').value.trim();
  const password = document.querySelector('#stats-password').value;
  if (!username || !password) {
    if (errorEl) errorEl.textContent = 'Įveskite vartotojo vardą ir slaptažodį.';
    return;
  }
  try {
    const result = await apiPost('/api/auth', { username, password });
    if (result.token && result.user) {
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(USER_KEY, JSON.stringify(result.user));
      showStats();
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Nepavyko prisijungti.';
  }
});

document.querySelector('#stats-from').onchange = event => { statsState.from = event.target.value; renderStats(); };
document.querySelector('#stats-to').onchange = event => { statsState.to = event.target.value; renderStats(); };
document.querySelector('#stats-clear').onclick = () => { statsState.from = ''; statsState.to = ''; document.querySelector('#stats-from').value = ''; document.querySelector('#stats-to').value = ''; renderStats(); };

if (getToken()) showStats();
