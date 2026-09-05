import { query, cors } from '../lib/db.js';
import { decodeToken, extractToken } from '../lib/auth.js';
import { hashPassword } from './auth.js';

async function requireSuperAdmin(req, res) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Reikalingas prisijungimas' });
    return null;
  }
  const payload = await decodeToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesija nebegalioja' });
    return null;
  }
  if (payload.role !== 'super_admin') {
    res.status(403).json({ error: 'Tik super administratorius gali valdyti vartotojus' });
    return null;
  }
  return payload;
}

export default async function handler(req, res) {
  cors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const session = await requireSuperAdmin(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const rows = await query(
        'SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id'
      );
      return res.status(200).json(rows.map(mapUser));
    }

    if (req.method === 'POST') {
      const { username, displayName, password, role } = req.body || {};
      if (!username || !password || !displayName) {
        return res.status(400).json({ error: 'Trūksta duomenų (username, displayName, password)' });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'Slaptažodis per trumpas (min. 6 simboliai)' });
      }
      const finalRole = role === 'super_admin' ? 'super_admin' : 'admin';
      try {
        const result = await query(
          'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)',
          [String(username).trim().toLowerCase(), String(displayName).trim(), hashPassword(String(password)), finalRole]
        );
        return res.status(201).json({ ok: true, id: result.insertId });
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ error: 'Toks vartotojo vardas jau egzistuoja' });
        }
        throw err;
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('/api/users', err);
    return res.status(500).json({ error: 'Serverio klaida' });
  }
}

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: !!row.active,
    createdAt: row.created_at
  };
}
