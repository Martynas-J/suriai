import { query, cors } from '../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rows = await query(
      'SELECT id, name, description, price, unit, tag, emoji FROM products WHERE active = 1 ORDER BY sort_order, name'
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(rows);
  } catch (err) {
    console.error('GET /api/products', err);
    return res.status(500).json({ error: 'Nepavyko gauti produktų' });
  }
}
