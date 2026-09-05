import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { query, cors } from '../lib/db.js';
import { signToken } from '../lib/auth.js';

const SESSION_TTL_MS = 1000 * 60 * 30;

export default async function handler(req, res) {
  cors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Trūksta prisijungimo duomenų' });

  try {
    const rows = await query(
      'SELECT id, username, display_name, password_hash, role, active FROM users WHERE username = ? LIMIT 1',
      [String(username).trim()]
    );
    const user = rows[0];
    if (!user || !user.active || !verifyPassword(String(password), user.password_hash)) {
      return res.status(401).json({ error: 'Neteisingas vartotojo vardas arba slaptažodis' });
    }

    const token = await signToken({
      uid: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role
    });
    return res.status(200).json({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role
      },
      expiresIn: SESSION_TTL_MS
    });
  } catch (err) {
    console.error('/api/auth', err);
    return res.status(500).json({ error: 'Serverio klaida' });
  }
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
