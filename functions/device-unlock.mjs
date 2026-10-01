import crypto from 'node:crypto';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('error', (error) => console.error('[device unlock postgres idle client]', error));

const DEVICE_UNLOCK_KEY = String(process.env.LOCKON_DEVICE_UNLOCK_KEY || '').trim();
const BODY_LIMIT = 8 * 1024;
const WRITE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const READ_SECRET_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const GLOBAL_ROLES = new Set(['OWNER', 'BOSS']);

const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
};

const json = (body, status = 200) => Response.json(body, { status, headers });
const q = (text, params = []) => pool.query(text, params);
const makeId = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
const tokenHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const unlockKey = () => {
  const key = Buffer.from(DEVICE_UNLOCK_KEY, 'base64');
  if (key.length !== 32) {
    throw Object.assign(new Error('Chronione dane blokady nie są skonfigurowane.'), { status: 503, code: 'DEVICE_UNLOCK_KEY_MISSING' });
  }
  return key;
};

const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', unlockKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), encrypted.toString('base64'), cipher.getAuthTag().toString('base64')].join('.');
};

const decryptSecret = (packed) => {
  const parts = String(packed || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted device unlock payload.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', unlockKey(), Buffer.from(parts[0], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[1], 'base64')), decipher.final()]).toString('utf8');
};

const readJson = async (request) => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > BODY_LIMIT) throw Object.assign(new Error('Za duże żądanie.'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
  const text = await request.text();
  if (Buffer.byteLength(text) > BODY_LIMIT) throw Object.assign(new Error('Za duże żądanie.'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('Nieprawidłowe dane JSON.'), { status: 400, code: 'INVALID_JSON' }); }
};

const currentSession = async (request) => {
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer /i.test(auth)) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const { rows } = await q(
    "SELECT s.id AS session_id,s.user_id,s.client_type,s.active_point_id,u.id,u.role_code,u.status,u.blocked_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() AND u.blocked_at IS NULL LIMIT 1",
    [tokenHash(token)]
  );
  const row = rows[0];
  if (!row) return null;
  await q('UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1', [row.session_id]);
  return {
    sessionId: row.session_id,
    clientType: row.client_type,
    activePointId: row.active_point_id || null,
    user: { id: row.id, role_code: row.role_code, status: row.status }
  };
};

const requireActive = async (request) => {
  const session = await currentSession(request);
  if (!session) throw Object.assign(new Error('Sesja wygasła albo jest nieprawidłowa.'), { status: 401, code: 'UNAUTHORIZED' });
  if (session.user.status !== 'ACTIVE') throw Object.assign(new Error('Konto nie jest aktywne.'), { status: 403, code: 'ACCOUNT_NOT_ACTIVE' });
  return session;
};

const canReadOrder = async (user, orderId) => {
  if (GLOBAL_ROLES.has(user.role_code)) return true;
  const { rowCount } = await q(
    "SELECT 1 FROM service_orders s WHERE s.id=$1 AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND (a.point_id=COALESCE(s.home_point_id,s.point_id) OR a.point_id=COALESCE(s.current_point_id,s.home_point_id,s.point_id))) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id AND t.status IN ('REQUESTED','IN_TRANSIT','DELIVERED'))) LIMIT 1",
    [orderId, user.id]
  );
  return rowCount > 0;
};

const requireOrderAccess = async (user, orderId) => {
  if (!(await canReadOrder(user, orderId))) {
    throw Object.assign(new Error('Brak dostępu do tego zlecenia.'), { status: 403, code: 'ORDER_FORBIDDEN' });
  }
};

const normalizeUnlock = (body) => {
  const type = String(body?.type || 'NONE').trim().toUpperCase();
  if (!['NONE', 'PIN', 'PATTERN'].includes(type)) {
    throw Object.assign(new Error('Wybierz: brak blokady, PIN albo wzór.'), { status: 400, code: 'DEVICE_UNLOCK_TYPE' });
  }
  if (type === 'NONE') return { type, secret: null };

  const secret = String(body?.secret || '').trim();
  if (type === 'PIN') {
    if (!/^\d{4,16}$/.test(secret)) {
      throw Object.assign(new Error('PIN powinien zawierać od 4 do 16 cyfr.'), { status: 400, code: 'DEVICE_UNLOCK_PIN' });
    }
    return { type, secret };
  }

  if (!/^[1-9]{4,9}$/.test(secret) || new Set(secret.split('')).size !== secret.length) {
    throw Object.assign(new Error('Wzór powinien zawierać 4–9 różnych punktów siatki.'), { status: 400, code: 'DEVICE_UNLOCK_PATTERN' });
  }
  return { type, secret };
};

const auditUnlock = async (session, orderId, action, type) => {
  await q(
    'INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,point_id,metadata) SELECT $1,$2,$3,$4,$5,COALESCE(current_point_id,home_point_id,point_id),$6::jsonb FROM service_orders WHERE id=$5',
    [makeId('aud'), session.user.id, action, 'service_order_device_unlock', orderId, JSON.stringify({ unlockType: type, clientType: session.clientType || 'DESKTOP' })]
  );
};

const route = async (request) => {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, service: 'LockOn ServiceOS Device Unlock', time: new Date().toISOString() });
  }

  const match = url.pathname.match(/^\/service\/orders\/([^/]+)\/unlock$/);
  if (!match) return json({ error: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' }, 404);
  const orderId = decodeURIComponent(match[1]);
  if (!/^srv_[a-f0-9]{20}$/.test(orderId)) return json({ error: 'ORDER_ID', message: 'Nieprawidłowe zlecenie.' }, 400);

  const session = await requireActive(request);
  await requireOrderAccess(session.user, orderId);

  if (request.method === 'POST') {
    if (!WRITE_ROLES.has(session.user.role_code)) {
      return json({ error: 'DEVICE_UNLOCK_WRITE_FORBIDDEN', message: 'Brak uprawnienia do danych blokady telefonu.' }, 403);
    }
    const payload = normalizeUnlock(await readJson(request));
    const ciphertext = payload.secret == null ? null : encryptSecret(payload.secret);
    await q(
      "INSERT INTO service_order_device_unlock(service_order_id,unlock_type,secret_ciphertext,updated_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(service_order_id) DO UPDATE SET unlock_type=EXCLUDED.unlock_type,secret_ciphertext=EXCLUDED.secret_ciphertext,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()",
      [orderId, payload.type, ciphertext, session.user.id]
    );
    await auditUnlock(session, orderId, 'DEVICE_UNLOCK_UPDATED', payload.type);
    return json({ type: payload.type, secret: null, updatedAt: new Date().toISOString() });
  }

  if (request.method === 'GET') {
    if (!READ_SECRET_ROLES.has(session.user.role_code)) {
      return json({ error: 'DEVICE_UNLOCK_READ_FORBIDDEN', message: 'Kod blokady jest dostępny tylko dla osób realizujących serwis.' }, 403);
    }
    const { rows } = await q(
      'SELECT unlock_type,secret_ciphertext,updated_at FROM service_order_device_unlock WHERE service_order_id=$1 LIMIT 1',
      [orderId]
    );
    if (!rows[0]) return json({ type: 'NONE', secret: null, updatedAt: null });
    const row = rows[0];
    const secret = row.unlock_type === 'NONE' || !row.secret_ciphertext ? null : decryptSecret(row.secret_ciphertext);
    return json({ type: row.unlock_type, secret, updatedAt: row.updated_at });
  }

  return json({ error: 'METHOD_NOT_ALLOWED', message: 'Niedozwolona metoda.' }, 405);
};

export default {
  async fetch(request) {
    try {
      return await route(request);
    } catch (error) {
      console.error('[LockOn Device Unlock]', {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code || null
      });
      return json({
        error: error?.code || 'SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Błąd chronionych danych blokady.'
      }, Number(error?.status) || 500);
    }
  }
};
