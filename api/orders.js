import { randomUUID } from 'node:crypto';
import { query, cors, getPool } from '../lib/db.js';
import { decodeToken, extractToken } from '../lib/auth.js';

const STATUSES = ['Naujas', 'Patvirtintas', 'Įvykdytas', 'Atšauktas'];

async function authenticate(req, res) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Reikalingas administratoriaus leidimas' });
    return null;
  }
  const payload = await decodeToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesija nebegalioja. Prisijunkite iš naujo.' });
    return null;
  }
  return payload;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const session = await authenticate(req, res);
      if (!session) return;
      return await getOrders(req, res);
    }
    if (req.method === 'POST') return await createOrder(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('/api/orders', err);
    return res.status(500).json({ error: 'Serverio klaida' });
  }
}

async function getOrders(req, res) {
  const { status, period, date, search, limit } = req.query;
  const params = [];
  let where = '1=1';

  if (status && status !== 'all' && STATUSES.includes(status)) {
    where += ' AND o.status = ?';
    params.push(status);
  }
  if (period === 'day' && date) {
    where += ' AND o.date = ?';
    params.push(date);
  } else if (period === 'month' && date) {
    where += ' AND DATE_FORMAT(o.date, "%Y-%m") = ?';
    params.push(date);
  }
  if (search) {
    where += ' AND (o.customer LIKE ? OR o.phone LIKE ? OR o.email LIKE ? OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.product_name LIKE ?))';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const orderRows = await query(
    `SELECT o.id, o.customer, o.phone, o.email, o.date, o.notes, o.status, o.total, o.created_at
     FROM orders o
     WHERE ${where}
     ORDER BY o.created_at DESC
     LIMIT ?`,
    [...params, Number(limit) || 1000]
  );

  if (orderRows.length === 0) {
    return res.status(200).json([]);
  }

  const ids = orderRows.map(o => o.id);
  const placeholders = ids.map(() => '?').join(',');
  const itemRows = await query(
    `SELECT order_id, product_id, product_name, unit_price, quantity, line_total
     FROM order_items WHERE order_id IN (${placeholders})`,
    ids
  );

  const itemsByOrder = new Map();
  for (const item of itemRows) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push({
      id: item.product_id,
      name: item.product_name,
      price: Number(item.unit_price),
      quantity: item.quantity
    });
  }

  const result = orderRows.map(o => {
    const items = itemsByOrder.get(o.id) || [];
    const productName = items.map(i => `${i.name} × ${i.quantity}`).join(', ');
    const totalQuantity = items.reduce((s, i) => s + Number(i.quantity), 0);
    return {
      id: o.id,
      customer: o.customer,
      phone: o.phone || '',
      email: o.email || '',
      date: o.date || '',
      notes: o.notes || '',
      status: o.status,
      createdAt: o.created_at,
      items,
      productName,
      quantity: totalQuantity,
      price: items[0] ? items[0].price : 0,
      total: Number(o.total)
    };
  });

  return res.status(200).json(result);
}

async function createOrder(req, res) {
  const { customer, phone, email, date, notes, items } = req.body || {};
  if (!customer || !String(customer).trim()) {
    return res.status(400).json({ error: 'Trūksta vardo' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Pasirinkite bent vieną produktą' });
  }

  const cleanItems = items
    .map(item => ({
      id: String(item.id || ''),
      name: String(item.name || ''),
      price: Number(item.price) || 0,
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 0))
    }))
    .filter(item => item.id && item.name && item.quantity > 0 && item.price >= 0);

  if (cleanItems.length === 0) {
    return res.status(400).json({ error: 'Neteisingi prekių duomenys' });
  }

  const total = cleanItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const orderId = randomUUID();

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO orders (id, customer, phone, email, date, notes, status, total)
       VALUES (?, ?, ?, ?, ?, ?, 'Naujas', ?)`,
      [
        orderId,
        String(customer).trim().slice(0, 150),
        phone ? String(phone).trim().slice(0, 60) : null,
        email ? String(email).trim().slice(0, 150) : null,
        date || null,
        notes ? String(notes).trim().slice(0, 1000) : null,
        total.toFixed(2)
      ]
    );

    const values = [];
    const placeholders = cleanItems.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
    for (const item of cleanItems) {
      values.push(
        orderId,
        item.id,
        item.name.slice(0, 150),
        item.price.toFixed(2),
        item.quantity,
        (item.price * item.quantity).toFixed(2)
      );
    }
    await conn.query(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
       VALUES ${placeholders}`,
      values
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return res.status(201).json({ ok: true, id: orderId });
}
