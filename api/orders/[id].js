import { query, cors } from '../../lib/db.js';
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
    return     res.status(500).json({ error: 'Serverio klaida' });
  }
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
