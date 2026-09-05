const API_BASE = '';

const money = value => `${Number(value).toFixed(2).replace('.', ',')} €`;
const escapeHTML = text => String(text ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));

let products = [];

async function apiGet(path) {
  const res = await fetch(API_BASE + path);
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

async function loadProducts() {
  try {
    products = await apiGet('/api/products');
  } catch (err) {
    console.error('Nepavyko gauti produktų:', err);
    products = [];
  }
  document.querySelector('#menu-count').textContent = products.length ? `${products.length} produktai` : 'Nėra produktų';
  document.querySelector('#product-grid').innerHTML = products.length
    ? products.map(item => `
      <article class="product-card"><div class="product-emoji">${item.emoji || '🧀'}</div><span class="tag">${escapeHTML(item.tag || '')}</span><h3>${escapeHTML(item.name)}</h3><p>${escapeHTML(item.description || '')}</p><div class="price">Nuo ${money(item.price)} / ${escapeHTML(item.unit || 'vnt.')}</div></article>`).join('')
    : '<p class="empty">Šiuo metu produktų nėra.</p>';

  const container = document.querySelector('#product-options');
  if (container) {
    container.innerHTML = products.map(item => `
      <div class="product-option" data-id="${item.id}" data-price="${item.price}">
        <span class="product-option-info">
          <span class="product-option-emoji" aria-hidden="true">${item.emoji || '🧀'}</span>
          <span class="product-option-text">
            <span class="product-option-name">${escapeHTML(item.name)}</span>
            <span class="product-option-price">${money(item.price)} / ${escapeHTML(item.unit || 'vnt.')}</span>
          </span>
        </span>
        <span class="product-option-qty">
          <button type="button" class="qty-btn" data-step="-1" aria-label="${escapeHTML(item.name)} mažiau">−</button>
          <input type="number" name="qty_${item.id}" min="0" value="0" inputmode="numeric" aria-label="${escapeHTML(item.name)} kiekis" />
          <button type="button" class="qty-btn" data-step="1" aria-label="${escapeHTML(item.name)} daugiau">+</button>
        </span>
      </div>`).join('');
    bindProductOptions();
  }
  setDefaultDate();
}

function bindProductOptions() {
  const container = document.querySelector('#product-options');
  if (!container) return;
  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.product-option');
      const input = row.querySelector('input[type="number"]');
      const current = Number(input.value) || 0;
      const next = Math.max(0, current + Number(btn.dataset.step));
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  container.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('input', () => {
      const value = Math.max(0, Number(input.value) || 0);
      input.value = value;
      const row = input.closest('.product-option');
      row.classList.toggle('is-selected', value > 0);
      updateOrderTotal();
    });
  });
  updateOrderTotal();
}

function updateOrderTotal() {
  const total = getSelectedItems().reduce((sum, item) => sum + item.price * item.quantity, 0);
  const preview = document.querySelector('#order-total-preview');
  if (preview) preview.textContent = money(total);
}

function getSelectedItems() {
  const container = document.querySelector('#product-options');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.product-option'))
    .map(row => {
      const input = row.querySelector('input[type="number"]');
      const quantity = Math.max(0, Number(input.value) || 0);
      if (quantity <= 0) return null;
      const product = products.find(item => item.id === row.dataset.id);
      if (!product) return null;
      return { id: product.id, name: product.name, price: Number(product.price), quantity };
    })
    .filter(Boolean);
}

function setDefaultDate() {
  const dateInput = document.querySelector('#order-form [name="date"]');
  if (dateInput && !dateInput.value) dateInput.value = '';
}

function resetProductQuantities() {
  const container = document.querySelector('#product-options');
  if (!container) return;
  container.querySelectorAll('.product-option').forEach(row => {
    const input = row.querySelector('input[type="number"]');
    if (input) input.value = 0;
    row.classList.remove('is-selected');
  });
  updateOrderTotal();
}

let showMessageTimeout;

document.querySelector('#order-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const items = getSelectedItems();
  const error = document.querySelector('#product-error');
  if (items.length === 0) {
    if (error) error.textContent = 'Pasirinkite bent vieną produktą ir nurodykite kiekį.';
    return;
  }
  if (error) error.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await apiPost('/api/orders', {
      customer: data.customer,
      phone: data.phone || '',
      email: data.email || '',
      date: data.date || null,
      notes: data.notes || '',
      items
    });
    form.reset();
    resetProductQuantities();
    setDefaultDate();
    const message = document.querySelector('#form-message');
    if (message) {
      message.textContent = 'Ačiū! Užsakymas priimtas.';
      message.classList.add('is-visible');
      clearTimeout(showMessageTimeout);
      showMessageTimeout = setTimeout(() => message.classList.remove('is-visible'), 3000);
    }
  } catch (err) {
    const message = document.querySelector('#form-message');
    if (message) {
      message.textContent = 'Klaida siunčiant užsakymą. Bandykite dar kartą.';
      message.classList.add('is-visible');
      message.style.color = '#a02b1f';
      message.style.background = '#fde2dd';
      message.style.borderColor = '#d68479';
      clearTimeout(showMessageTimeout);
      showMessageTimeout = setTimeout(() => {
        message.classList.remove('is-visible');
        message.style.cssText = '';
      }, 3000);
    }
    console.error(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

loadProducts();
