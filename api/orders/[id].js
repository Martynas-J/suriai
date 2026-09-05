import { query, cors, getPool } from '../../lib/db.js';
import { decodeToken, extractToken } from '../../lib/auth.js';

const STATUSES = ['Naujas', 'Patvirtintas', 'Įvykdytas', 'Atšauktas'];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Trūksta užsakymo ID' });

  const session = await authenticate(req, res);
  if (!session) return;

  try {
    if (req.method === 'PATCH') {
      const { status } = req.body || {};
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Neteisinga būsena' });
      }
      const result = await query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Užsakymas nerastas' });
      }
      return res.status(200).json({ ok: true, status });
    }

    if (req.method === 'PUT') {
      return await updateOrder(req, res, id);
    }

    if (req.method === 'DELETE') {
      const result = await query('DELETE FROM orders WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Užsakymas nerastas' });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('/api/orders/[id]', err);
    return res.status(500).json({ error: 'Serverio klaida' });
  }
}

async function updateOrder(req, res, id) {
  const { customer, phone, email, date, notes, status, items } = req.body || {};

  if (!customer || !String(customer).trim()) {
    return res.status(400).json({ error: 'Trūksta vardo' });
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Neteisinga būsena' });
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

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orderRows] = await conn.query('SELECT id FROM orders WHERE id = ? FOR UPDATE', [id]);
    if (orderRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Užsakymas nerastas' });
    }

    await conn.query(
      `UPDATE orders
       SET customer = ?, phone = ?, email = ?, date = ?, notes = ?, status = ?, total = ?
       WHERE id = ?`,
      [
        String(customer).trim().slice(0, 150),
        phone ? String(phone).trim().slice(0, 60) : null,
        email ? String(email).trim().slice(0, 150) : null,
        date || null,
        notes ? String(notes).trim().slice(0, 1000) : null,
        status || 'Naujas',
        total.toFixed(2),
        id
      ]
    );

    await conn.query('DELETE FROM order_items WHERE order_id = ?', [id]);

    const values = [];
    const placeholders = cleanItems.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
    for (const item of cleanItems) {
      values.push(
        id,
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

  return res.status(200).json({ ok: true, id });
}

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
