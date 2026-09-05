import { query, cors } from '../../lib/db.js';
import { decodeToken, extractToken } from '../../lib/auth.js';
import { hashPassword } from '../auth.js';

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
    res.status(403).json({ error: 'Tik super administratorius' });
    return null;
  }
  return payload;
}

export default async function handler(req, res) {
  cors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const id = Number(req.query.id);
  if (!id || !Number.isInteger(id)) return res.status(400).json({ error: 'Neteisingas ID' });

  const session = await requireSuperAdmin(req, res);
  if (!session) return;

  try {
    if (req.method === 'PATCH') {
      const { displayName, role, password, active } = req.body || {};
      const updates = [];
      const params = [];

      if (displayName !== undefined) {
        updates.push('display_name = ?');
        params.push(String(displayName).trim());
      }
      if (role !== undefined) {
        if (role !== 'super_admin' && role !== 'admin') {
          return res.status(400).json({ error: 'Neteisinga rolė' });
        }
        if (id === session.uid && role !== 'super_admin') {
          return res.status(400).json({ error: 'Negalite panaikinti super admin rolės sau' });
        }
        updates.push('role = ?');
        params.push(role);
      }
      if (password !== undefined && password !== '') {
        if (String(password).length < 6) {
          return res.status(400).json({ error: 'Slaptažodis per trumpas (min. 6 simboliai)' });
        }
        updates.push('password_hash = ?');
        params.push(hashPassword(String(password)));
      }
      if (active !== undefined) {
        if (id === session.uid && !active) {
          return res.status(400).json({ error: 'Negalite deaktyvuoti savo paskyros' });
        }
        updates.push('active = ?');
        params.push(active ? 1 : 0);
      }

      if (updates.length === 0) return res.status(400).json({ error: 'Nėra ką atnaujinti' });

      params.push(id);
      const result = await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Vartotojas nerastas' });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (id === session.uid) {
        return res.status(400).json({ error: 'Negalite ištrinti savo paskyros' });
      }
      const result = await query('DELETE FROM users WHERE id = ?', [id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Vartotojas nerastas' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('/api/users/[id]', err);
    return res.status(500).json({ error: 'Serverio klaida' });
  }
}
