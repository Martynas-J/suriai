const API_BASE = '';
const TOKEN_KEY = 'pieno-gaminiai-admin-token-v1';
const USER_KEY = 'pieno-gaminiai-admin-user-v1';

const adminState = { dateFrom: '', dateTo: '', status: 'Naujas', product: 'all', search: '', sort: 'newest', pageSize: 10, page: 1 };
let allProducts = [];
let allOrders = [];
let currentUser = null;

const money = value => `${Number(value).toFixed(2).replace('.', ',')} €`;
const escapeHTML = text => String(text ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));

const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
const setToken = value => { if (value) localStorage.setItem(TOKEN_KEY, value); else localStorage.removeItem(TOKEN_KEY); };
const getStoredUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } };
const setStoredUser = user => { if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)); else localStorage.removeItem(USER_KEY); };

async function apiRequest(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    setToken('');
    setStoredUser(null);
    if (currentUser) showLogin();
    throw new Error('Sesija nebegalioja');
  }
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Neturite teisių');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Klaida: ' + res.status);
  return data;
}

const apiGet    = (path) => apiRequest('GET', path);
const apiPost   = (path, body) => apiRequest('POST', path, body);
const apiPatch  = (path, body) => apiRequest('PATCH', path, body);
const apiPut    = (path, body) => apiRequest('PUT', path, body);
const apiDelete = (path) => apiRequest('DELETE', path);

function isLoggedIn() { return Boolean(getToken() && getStoredUser()); }

function showLogin() {
  document.querySelector('#admin-login').hidden = false;
  document.querySelector('#admin-content').hidden = true;
  document.querySelector('#login-error').textContent = '';
}

function showAdmin() {
  document.querySelector('#admin-login').hidden = true;
  document.querySelector('#admin-content').hidden = false;
  applyUserInterface();
  switchPane('orders');
  loadOrders();
}

function applyUserInterface() {
  if (!currentUser) return;
  const isSuperAdmin = currentUser.role === 'super_admin';
  const link = document.querySelector('#current-user');
  if (link) {
    const roleLabel = isSuperAdmin ? 'Super administratorius' : 'Administratorius';
    link.innerHTML = `Prisijungęs: <strong>${escapeHTML(currentUser.displayName)}</strong> · <span class="role-pill role-${escapeHTML(currentUser.role)}">${escapeHTML(roleLabel)}</span>`;
  }
  const usersTab = document.querySelector('#users-tab-link');
  if (usersTab) usersTab.hidden = !isSuperAdmin;
}

function switchPane(name) {
  document.querySelectorAll('[data-pane]').forEach(el => el.hidden = el.dataset.pane !== name);
  document.querySelectorAll('.dashboard-nav a[data-tab]').forEach(a => a.classList.toggle('is-active', a.dataset.tab === name));
  if (name === 'users' && currentUser?.role === 'super_admin') loadUsers();
}

document.querySelectorAll('.dashboard-nav a[data-tab]').forEach(a => {
  a.addEventListener('click', event => {
    event.preventDefault();
    switchPane(a.dataset.tab);
  });
});

function logout() {
  setToken('');
  setStoredUser(null);
  currentUser = null;
  showLogin();
  document.querySelector('#admin-password').value = '';
  document.querySelector('#admin-username').value = '';
}

document.querySelector('#logout-btn').onclick = logout;

function getOrderTotal(order) {
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
  }
  return (Number(order.price) || 0) * (Number(order.quantity) || 0);
}
function getOrderTotalQuantity(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return Number(order.quantity) || 0;
}
function getOrderItemsText(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items.map(item => `${escapeHTML(item.name)} × ${escapeHTML(item.quantity)}`).join('<br>');
  return `${escapeHTML(order.productName)} × ${escapeHTML(order.quantity)}`;
}
function getOrderProductNames(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items.map(item => item.name);
  return order.productName ? [order.productName] : [];
}

function getFilteredOrders() {
  const search = adminState.search.trim().toLocaleLowerCase('lt-LT');
  return allOrders.filter(order => {
    const date = String(order.date || '');
    const fromMatches = !adminState.dateFrom || date >= adminState.dateFrom;
    const toMatches = !adminState.dateTo || date <= adminState.dateTo;
    const statusMatches = adminState.status === 'all' || order.status === adminState.status;
    const productNames = getOrderProductNames(order);
    const productMatches = adminState.product === 'all' || productNames.includes(adminState.product);
    const itemNames = productNames.join(' ');
    const searchable = [order.customer, order.phone, order.email, order.productName, itemNames].join(' ').toLocaleLowerCase('lt-LT');
    return fromMatches && toMatches && statusMatches && productMatches && (!search || searchable.includes(search));
  }).sort((a, b) => {
    if (adminState.sort === 'delivery') return String(a.date || '').localeCompare(String(b.date || ''));
    if (adminState.sort === 'value') return getOrderTotal(b) - getOrderTotal(a);
    if (adminState.sort === 'customer') return String(a.customer || '').localeCompare(String(b.customer || ''), 'lt');
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function populateProductFilter() {
  const select = document.querySelector('#filter-product');
  const orderedNames = allProducts.map(product => product.name);
  const orderedProductNames = getFilteredOrders().flatMap(getOrderProductNames);
  const productNames = [...new Set([...orderedNames, ...orderedProductNames])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'lt'));
  select.innerHTML = `<option value="all">Visi produktai</option>${productNames.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('')}`;
  select.value = productNames.includes(adminState.product) ? adminState.product : 'all';
  if (select.value === 'all') adminState.product = 'all';
}

function renderPagination(totalPages) {
  const pagination = document.querySelector('#pagination');
  if (totalPages <= 1) { pagination.innerHTML = ''; return; }
  const pages = Array.from({ length: totalPages }, (_, index) => `<button class="page-button ${adminState.page === index + 1 ? 'is-active' : ''}" data-page="${index + 1}" type="button">${index + 1}</button>`).join('');
  pagination.innerHTML = `<button class="page-button" data-page="${adminState.page - 1}" type="button" ${adminState.page === 1 ? 'disabled' : ''}>‹</button>${pages}<button class="page-button" data-page="${adminState.page + 1}" type="button" ${adminState.page === totalPages ? 'disabled' : ''}>›</button>`;
  pagination.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { adminState.page = Number(button.dataset.page); renderOrders(); });
}

function renderOrders() {
  populateProductFilter();
  const orders = getFilteredOrders();
  const totalPages = Math.max(1, Math.ceil(orders.length / adminState.pageSize));
  adminState.page = Math.min(adminState.page, totalPages);
  const start = (adminState.page - 1) * adminState.pageSize;
  const pageOrders = orders.slice(start, start + adminState.pageSize);
  document.querySelector('#order-total').textContent = `${allOrders.length} visi užsakymai`;
  document.querySelector('#orders-summary').textContent = orders.length ? `Rodomi ${start + 1}–${Math.min(start + adminState.pageSize, orders.length)} iš ${orders.length} užsakymų` : 'Pagal filtrus užsakymų nėra';
  document.querySelector('#orders-list').innerHTML = pageOrders.length ? pageOrders.map(order => `<article class="order-item"><div><h3>${getOrderItemsText(order)}</h3><p>Pristatymas / atsiėmimas: ${escapeHTML(order.date)}</p><p>${escapeHTML(order.notes) || 'Be pastabų'}</p></div><div><p><strong>${escapeHTML(order.customer)}</strong></p><p>${escapeHTML(order.phone)}</p><p>${escapeHTML(order.email)}</p></div><div><p>Pateikta</p><p>${new Date(order.createdAt).toLocaleString('lt-LT')}</p></div><div class="order-status"><select class="status-select" data-id="${order.id}"><option ${order.status === 'Naujas' ? 'selected' : ''}>Naujas</option><option ${order.status === 'Patvirtintas' ? 'selected' : ''}>Patvirtintas</option><option ${order.status === 'Įvykdytas' ? 'selected' : ''}>Įvykdytas</option><option ${order.status === 'Atšauktas' ? 'selected' : ''}>Atšauktas</option></select><strong>${money(getOrderTotal(order))}</strong><div class="order-actions"><button type="button" class="edit-order" data-id="${order.id}" aria-label="Redaguoti užsakymą">Redaguoti</button><button type="button" class="delete-order" data-id="${order.id}" data-customer="${escapeHTML(order.customer)}" aria-label="Ištrinti užsakymą">Trinti</button></div></div></article>`).join('') : '<p class="empty">Užsakymų pagal pasirinktus filtrus nėra.</p>';
  document.querySelectorAll('.status-select').forEach(select => select.onchange = async () => {
    const id = select.dataset.id;
    const previous = select.value;
    select.disabled = true;
    try {
      await apiPatch('/api/orders/' + encodeURIComponent(id), { status: select.value });
      const order = allOrders.find(o => o.id === id);
      if (order) order.status = select.value;
      renderOrders();
    } catch (err) {
      select.value = previous;
      alert('Nepavyko atnaujinti būsenos: ' + err.message);
    } finally {
      select.disabled = false;
    }
  });
  document.querySelectorAll('.delete-order').forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.id;
    const customer = btn.dataset.customer || 'užsakymą';
    if (!confirm(`Ar tikrai norite ištrinti ${customer} užsakymą? Šio veiksmo atstatyti negalėsite.`)) return;
    btn.disabled = true;
    try {
      await apiDelete('/api/orders/' + encodeURIComponent(id));
      allOrders = allOrders.filter(o => o.id !== id);
      renderOrders();
    } catch (err) {
      alert('Nepavyko ištrinti užsakymo: ' + err.message);
      btn.disabled = false;
    }
  });
  document.querySelectorAll('.edit-order').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.id;
    const order = allOrders.find(o => o.id === id);
    if (order) openEditOrderDialog(order);
  });
  renderPagination(totalPages);
}

async function loadProducts() {
  if (allProducts.length) return;
  try {
    const res = await fetch(API_BASE + '/api/products');
    if (res.ok) allProducts = await res.json();
  } catch (err) {
    console.error('Nepavyko gauti produktų filtro:', err);
  }
}

async function loadOrders() {
  await loadProducts();
  try {
    allOrders = await apiGet('/api/orders?limit=1000');
  } catch (err) {
    console.error(err);
    allOrders = [];
  }
  renderOrders();
}

function buildOrdersText(format) {
  const orders = getFilteredOrders();
  const date = new Date();
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const header = `UŽSAKYMŲ SĄRAŠAS — ${stamp}\nRasta: ${orders.length} užsakymų\n======================================\n\n`;
  const itemsText = order => Array.isArray(order.items) && order.items.length
    ? order.items.map(item => `${item.name} × ${item.quantity} (${money(item.price * item.quantity)})`).join('\n  ')
    : `${order.productName || ''} × ${order.quantity || 0} (${money(getOrderTotal(order))})`;
  const body = orders.map((order, index) => {
    const lines = [
      `#${index + 1}. ${order.customer || '—'}`,
      `  Būsena: ${order.status}`,
      `  Data: ${order.date || '—'}`,
      `  Pateikta: ${new Date(order.createdAt).toLocaleString('lt-LT')}`,
      `  Kontaktai: ${[order.phone, order.email].filter(Boolean).join(', ') || '—'}`,
      `  Prekės: ${itemsText(order)}`,
      `  Suma: ${money(getOrderTotal(order))}`,
      `  Pastabos: ${order.notes || '—'}`,
      ''
    ];
    return lines.join('\n');
  }).join('\n');

  if (format === 'doc') {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Užsakymai</title><style>body{font-family:Arial,Helvetica,sans-serif;font-size:12pt;color:#000;margin:36px;line-height:1.5}h1{font-size:18pt;margin:0 0 8px}.meta{color:#555;font-size:10pt;margin-bottom:20px;border-bottom:1px solid #888;padding-bottom:8px}.order{margin-bottom:18px;padding:10px 12px;border:1px solid #ccc;border-radius:6px;page-break-inside:avoid}.order h3{margin:0 0 6px;font-size:13pt}.order p{margin:2px 0}.label{display:inline-block;min-width:90px;color:#555}.total{font-weight:bold;margin-top:6px;border-top:1px dashed #999;padding-top:6px}</style></head><body><h1>Užsakymų sąrašas</h1><p class="meta">Sugeneruota: ${stamp} · Rasta: ${orders.length} užsakymų</p>${orders.map((order, index) => `<div class="order"><h3>#${index + 1}. ${escapeHTML(order.customer || '—')}</h3><p><span class="label">Būsena:</span> ${escapeHTML(order.status)}</p><p><span class="label">Data:</span> ${escapeHTML(order.date || '—')}</p><p><span class="label">Pateikta:</span> ${new Date(order.createdAt).toLocaleString('lt-LT')}</p><p><span class="label">Kontaktai:</span> ${escapeHTML([order.phone, order.email].filter(Boolean).join(', ') || '—')}</p><p><span class="label">Prekės:</span><br>${escapeHTML(itemsText(order).replace(/\n/g, '<br>'))}</p><p class="total">Suma: ${escapeHTML(money(getOrderTotal(order)))}</p><p><span class="label">Pastabos:</span> ${escapeHTML(order.notes || '—')}</p></div>`).join('')}</body></html>`;
    return { content: html, mime: 'application/msword', filename: `uzsakymai-${stamp.replace(/[: ]/g, '-')}.doc` };
  }
  return { content: header + body, mime: 'text/plain;charset=utf-8', filename: `uzsakymai-${stamp.replace(/[: ]/g, '-')}.txt` };
}

function openEditOrderDialog(order) {
  const dialog = document.querySelector('#edit-order-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('form');
  form.querySelector('[name=customer]').value = order.customer || '';
  form.querySelector('[name=phone]').value = order.phone || '';
  form.querySelector('[name=email]').value = order.email || '';
  form.querySelector('[name=date]').value = order.date || '';
  form.querySelector('[name=status]').value = order.status || 'Naujas';
  form.querySelector('[name=notes]').value = order.notes || '';
  form.dataset.orderId = order.id;

  const itemsList = form.querySelector('#edit-items');
  const existingItems = Array.isArray(order.items) && order.items.length
    ? order.items.map(i => ({ id: String(i.id), name: i.name, price: Number(i.price) || 0, quantity: Number(i.quantity) || 1 }))
    : [{ id: order.productId || order.id, name: order.productName || '', price: Number(order.price) || 0, quantity: Number(order.quantity) || 1 }];

  const renderItems = () => {
    itemsList.innerHTML = existingItems.map((item, idx) => `
      <div class="edit-item-row" data-index="${idx}">
        <select name="item_id" data-idx="${idx}" required>
          <option value="">— Pasirinkti produktą —</option>
          ${allProducts.map(p => `<option value="${escapeHTML(p.id)}" data-name="${escapeHTML(p.name)}" data-price="${p.price}" ${String(p.id) === String(item.id) ? 'selected' : ''}>${escapeHTML(p.name)} (${money(p.price)})</option>`).join('')}
        </select>
        <input name="item_qty" data-idx="${idx}" type="number" min="1" step="1" value="${item.quantity}" required />
        <button type="button" class="remove-item" data-idx="${idx}" aria-label="Pašalinti">×</button>
      </div>
    `).join('');
    itemsList.querySelectorAll('select[name=item_id]').forEach(sel => {
      sel.onchange = () => {
        const idx = Number(sel.dataset.idx);
        const opt = sel.selectedOptions[0];
        existingItems[idx].id = sel.value;
        existingItems[idx].name = opt?.dataset.name || '';
        existingItems[idx].price = Number(opt?.dataset.price) || 0;
      };
    });
    itemsList.querySelectorAll('input[name=item_qty]').forEach(inp => {
      inp.oninput = () => {
        const idx = Number(inp.dataset.idx);
        existingItems[idx].quantity = Math.max(1, Math.floor(Number(inp.value) || 1));
      };
    });
    itemsList.querySelectorAll('.remove-item').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.idx);
        existingItems.splice(idx, 1);
        renderItems();
      };
    });
    const total = existingItems.reduce((s, i) => s + i.price * i.quantity, 0);
    form.querySelector('#edit-total').textContent = money(total);
  };

  renderItems();

  form.querySelector('#add-item').onclick = (event) => {
    event.preventDefault();
    if (!allProducts.length) {
      alert('Produktų sąrašas tuščias.');
      return;
    }
    const first = allProducts[0];
    existingItems.push({ id: first.id, name: first.name, price: Number(first.price) || 0, quantity: 1 });
    renderItems();
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    try {
      const fd = new FormData(form);
      const items = existingItems.filter(i => i.id && i.quantity > 0);
      if (!items.length) throw new Error('Pasirinkite bent vieną produktą');
      const payload = {
        customer: fd.get('customer'),
        phone: fd.get('phone') || null,
        email: fd.get('email') || null,
        date: fd.get('date') || null,
        notes: fd.get('notes') || null,
        status: fd.get('status'),
        items
      };
      await apiPut('/api/orders/' + encodeURIComponent(order.id), payload);
      dialog.close();
      await loadOrders();
    } catch (err) {
      alert('Nepavyko išsaugoti: ' + err.message);
    } finally {
      submitBtn.disabled = false;
    }
  };

  dialog.querySelector('#cancel-edit').onclick = () => dialog.close();
  dialog.querySelector('#cancel-edit-2').onclick = () => dialog.close();
  dialog.showModal();
}

document.querySelector('#export-orders').onclick = () => {
  const format = document.querySelector('#export-format')?.value || 'txt';
  const { content, mime, filename } = buildOrdersText(format);
  const file = new Blob([content], { type: mime });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: filename });
  link.click();
  URL.revokeObjectURL(link.href);
};

document.querySelector('#refresh-orders')?.addEventListener('click', loadOrders);

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = document.querySelector('#login-error');
  if (errorEl) errorEl.textContent = '';
  const username = document.querySelector('#admin-username').value.trim();
  const password = document.querySelector('#admin-password').value;
  if (!username || !password) {
    if (errorEl) errorEl.textContent = 'Įveskite vartotojo vardą ir slaptažodį.';
    return;
  }
  try {
    const result = await apiPost('/api/auth', { username, password });
    if (result.token && result.user) {
      setToken(result.token);
      setStoredUser(result.user);
      currentUser = result.user;
      showAdmin();
    } else if (errorEl) {
      errorEl.textContent = 'Neteisingi prisijungimo duomenys.';
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Nepavyko prisijungti.';
  }
});

document.querySelector('#filter-date-from').onchange = event => { adminState.dateFrom = event.target.value; adminState.page = 1; renderOrders(); };
document.querySelector('#filter-date-to').onchange = event => { adminState.dateTo = event.target.value; adminState.page = 1; renderOrders(); };
document.querySelector('#filter-status').onchange = event => { adminState.status = event.target.value; adminState.page = 1; renderOrders(); };
document.querySelector('#filter-product').onchange = event => { adminState.product = event.target.value; adminState.page = 1; renderOrders(); };
document.querySelector('#filter-search').oninput = event => { adminState.search = event.target.value; adminState.page = 1; renderOrders(); };
document.querySelector('#sort-orders').onchange = event => { adminState.sort = event.target.value; adminState.page = 1; renderOrders(); };
document.querySelector('#page-size').onchange = event => { adminState.pageSize = Number(event.target.value); adminState.page = 1; renderOrders(); };
document.querySelector('#clear-filters').onclick = () => {
  adminState.dateFrom = ''; adminState.dateTo = ''; adminState.status = 'Naujas'; adminState.product = 'all';
  adminState.search = ''; adminState.sort = 'newest'; adminState.pageSize = 10; adminState.page = 1;
  document.querySelector('#filter-date-from').value = '';
  document.querySelector('#filter-date-to').value = '';
  document.querySelector('#filter-status').value = 'Naujas';
  document.querySelector('#filter-product').value = 'all';
  document.querySelector('#filter-search').value = '';
  document.querySelector('#sort-orders').value = 'newest';
  document.querySelector('#page-size').value = '10';
  renderOrders();
};

async function loadUsers() {
  if (!currentUser || currentUser.role !== 'super_admin') return;
  try {
    const users = await apiGet('/api/users');
    const container = document.querySelector('#users-list');
    container.innerHTML = users.length ? users.map(user => `
      <article class="user-card" data-id="${user.id}">
        <div class="user-info">
          <strong>${escapeHTML(user.displayName)}</strong>
          <span class="muted">@${escapeHTML(user.username)}</span>
          <span class="role-pill role-${escapeHTML(user.role)}">${user.role === 'super_admin' ? 'Super admin' : 'Admin'}</span>
          ${user.active ? '' : '<span class="role-pill role-inactive">Neaktyvus</span>'}
        </div>
        <div class="user-actions">
          <button type="button" class="text-button edit-user" data-id="${user.id}">Keisti</button>
          ${user.id === currentUser.id ? '' : `<button type="button" class="text-button delete-user" data-id="${user.id}" data-name="${escapeHTML(user.displayName)}">Trinti</button>`}
        </div>
      </article>
    `).join('') : '<p class="muted">Nėra vartotojų.</p>';

    container.querySelectorAll('.edit-user').forEach(btn => btn.onclick = () => editUser(Number(btn.dataset.id), users));
    container.querySelectorAll('.delete-user').forEach(btn => btn.onclick = async () => {
      if (!confirm(`Ištrinti vartotoją „${btn.dataset.name}"?`)) return;
      try {
        await apiDelete('/api/users/' + btn.dataset.id);
        loadUsers();
      } catch (err) {
        alert('Nepavyko ištrinti: ' + err.message);
      }
    });
  } catch (err) {
    if (err.message === 'Sesija nebegalioja') return;
    alert('Nepavyko gauti vartotojų: ' + err.message);
  }
}

function editUser(id, users) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  const newDisplayName = prompt('Vardas, pavardė:', user.displayName);
  if (newDisplayName === null) return;
  const newRole = prompt('Rolė (admin arba super_admin):', user.role);
  if (newRole === null) return;
  if (newRole !== 'admin' && newRole !== 'super_admin') {
    alert('Neteisinga rolė');
    return;
  }
  const newPassword = prompt('Naujas slaptažodis (palikite tuščią, jei nekeisite):', '');
  if (newPassword === null) return;
  const body = { displayName: newDisplayName, role: newRole };
  if (newPassword.trim()) body.password = newPassword.trim();
  apiPatch('/api/users/' + id, body)
    .then(() => { alert('Atnaujinta'); loadUsers(); })
    .catch(err => alert('Klaida: ' + err.message));
}

document.querySelector('#user-create-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  if (!data.username || !data.displayName || !data.password) return;
  try {
    await apiPost('/api/users', data);
    form.reset();
    loadUsers();
  } catch (err) {
    alert('Nepavyko sukurti: ' + err.message);
  }
});

if (isLoggedIn()) {
  currentUser = getStoredUser();
  showAdmin();
} else {
  showLogin();
}
