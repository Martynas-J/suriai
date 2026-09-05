import { createHmac, timingSafeEqual } from 'node:crypto';

function getSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv !== 'change-me' && fromEnv !== 'change-me-to-a-long-random-string-at-least-32-chars') {
    return fromEnv;
  }
  return 'change-me';
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expires, payload, sig] = parts;
  if (!/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now()) return false;
  return true;
}

export async function decodeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [expires, payloadB64, sig] = parts;
  if (!/^\d+$/.test(expires)) return null;
  if (Number(expires) < Date.now()) return null;
  const secret = getSecret();
  const expected = createHmac('sha256', secret).update(`${expires}.${payloadB64}`).digest('hex');
  try {
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) return null;
  } catch {
    return null;
  }
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function signToken(payload) {
  const secret = getSecret();
  const expires = Date.now() + 1000 * 60 * 30;
  const json = JSON.stringify({ ...payload });
  const payloadB64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(`${expires}.${payloadB64}`).digest('hex');
  return `${expires}.${payloadB64}.${sig}`;
}

export function extractToken(req) {
  const auth = req.headers?.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.query && req.query.token) return String(req.query.token);
  if (req.cookies && req.cookies.admin_token) return req.cookies.admin_token;
  return null;
}
