import crypto from 'node:crypto';
import { Pool } from 'pg';
import { OAuth2Client } from 'google-auth-library';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', (error) => console.error('[postgres idle client]', error));

const OWNER_EMAIL = String(process.env.LOCKON_OWNER_EMAIL || 'nowogar@gmail.com').trim().toLowerCase();
const GOOGLE_DESKTOP_CLIENT_ID = String(process.env.LOCKON_GOOGLE_DESKTOP_CLIENT_ID || '').trim();
const GOOGLE_WEB_CLIENT_ID = String(process.env.LOCKON_GOOGLE_WEB_CLIENT_ID || '').trim();
const SITE_ORIGIN = String(process.env.LOCKON_SITE_ORIGIN || 'https://lokospl.github.io').replace(/\/$/, '');
const GMAIL_TOKEN_KEY = String(process.env.LOCKON_GMAIL_TOKEN_KEY || '');
const ALLOW_DEV_LOGIN = process.env.LOCKON_ALLOW_DEV_LOGIN === '1';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const WEBSITE_CODE_TTL_MS = 1000 * 60 * 5;
const BODY_LIMIT = 64 * 1024;
const GLOBAL_ROLES = new Set(['OWNER', 'BOSS']);
const REQUESTABLE_ROLES = new Set(['BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER']);
const SERVICE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN']);
const SERVICE_CREATE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const SERVICE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const GMAIL_MANAGE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR']);
const googleVerifier = new OAuth2Client();

const STATUS_LABELS = {
  RECEIVED: 'Przyjęto urządzenie',
  DIAGNOSIS: 'Diagnoza',
  WAITING_PARTS: 'Oczekiwanie na części',
  IN_REPAIR: 'W naprawie',
  READY: 'Gotowe do odbioru',
  COMPLETED: 'Zakończone',
  CANCELLED: 'Anulowane',
  REJECTED: 'Odrzucone'
};
const SERVICE_STATUSES = new Set(Object.keys(STATUS_LABELS));

const nowIso = () => new Date().toISOString();
const makeId = (prefix) => prefix + '_' + crypto.randomBytes(10).toString('hex');
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const normalizePhone = (value = '') => String(value).replace(/\D/g, '').slice(-15);
const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const tokenHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const b64url = (value) => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const corsHeaders = (request) => {
  const origin = request.headers.get('origin') || '';
  const allowed = origin === SITE_ORIGIN || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  return allowed ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Vary': 'Origin'
  } : {};
};

const secureHeaders = (request) => ({
  ...corsHeaders(request),
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
});

const json = (request, body, status = 200) =>
  Response.json(body, { status, headers: secureHeaders(request) });

const readJson = async (request) => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > BODY_LIMIT) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > BODY_LIMIT) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); }
};

const q = (text, params = []) => pool.query(text, params);

const pointView = (row) => ({
  id: row.id,
  name: row.name,
  city: row.city,
  active: row.active !== false
});

const customerView = (row) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email || null,
  phone: row.phone || null
});

const loadRequestedPoint = async (userId) => {
  const { rows } = await q(
    "SELECT point_name, city, requested_role_code, requested_at FROM access_requests WHERE user_id=$1 AND status='PENDING' ORDER BY requested_at DESC LIMIT 1",
    [userId]
  );
  if (!rows[0]) return null;
  return {
    pointName: rows[0].point_name,
    city: rows[0].city,
    requestedRole: rows[0].requested_role_code,
    requestedAt: rows[0].requested_at
  };
};

const loadUser = async (userId) => {
  const { rows } = await q(
    'SELECT id,google_sub,email,name,picture_url,role_code,status,first_login_at,last_login_at FROM users WHERE id=$1 LIMIT 1',
    [userId]
  );
  return rows[0] || null;
};

const loadPointsForUser = async (user) => {
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q('SELECT id,name,city,active FROM points WHERE active=true ORDER BY name');
    return rows.map(pointView);
  }
  const { rows } = await q(
    'SELECT p.id,p.name,p.city,p.active FROM points p JOIN user_point_access a ON a.point_id=p.id WHERE a.user_id=$1 AND p.active=true ORDER BY p.name',
    [user.id]
  );
  return rows.map(pointView);
};

const publicUser = async (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  picture: user.picture_url || null,
  role: user.role_code || null,
  status: user.status,
  pointIds: (await loadPointsForUser(user)).map((point) => point.id),
  requestedPoint: await loadRequestedPoint(user.id),
  firstLoginAt: user.first_login_at,
  lastLoginAt: user.last_login_at
});

const authPayload = async (user) => ({
  user: await publicUser(user),
  points: await loadPointsForUser(user)
});

const createSession = async (userId, clientType) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await q(
    'INSERT INTO auth_sessions(id,user_id,token_hash,client_type,created_at,last_seen_at,expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,now(),now(),$5,$6)',
    [makeId('ses'), userId, tokenHash(token), clientType, new Date(now + SESSION_TTL_MS), new Date(now + SESSION_ABSOLUTE_TTL_MS)]
  );
  return token;
};

const currentSession = async (request) => {
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer /i.test(auth)) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const hash = tokenHash(token);
  const { rows } = await q(
    "SELECT s.id AS session_id,s.user_id,s.client_type,u.id,u.google_sub,u.email,u.name,u.picture_url,u.role_code,u.status,u.first_login_at,u.last_login_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() LIMIT 1",
    [hash]
  );
  const row = rows[0];
  if (!row) return null;
  await q('UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1', [row.session_id]);
  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      google_sub: row.google_sub,
      email: row.email,
      name: row.name,
      picture_url: row.picture_url,
      role_code: row.role_code,
      status: row.status,
      first_login_at: row.first_login_at,
      last_login_at: row.last_login_at
    }
  };
};

const requireUser = async (request) => {
  const session = await currentSession(request);
  if (!session) throw Object.assign(new Error('Sesja wygasła albo jest nieprawidłowa.'), { status: 401, code: 'UNAUTHORIZED' });
  return session;
};

const requireActive = async (request) => {
  const session = await requireUser(request);
  if (session.user.status !== 'ACTIVE') throw Object.assign(new Error('Konto nie jest aktywne.'), { status: 403, code: 'ACCOUNT_NOT_ACTIVE' });
  return session;
};

const canSeePoint = async (user, pointId) => {
  if (GLOBAL_ROLES.has(user.role_code)) return true;
  const { rowCount } = await q('SELECT 1 FROM user_point_access WHERE user_id=$1 AND point_id=$2 LIMIT 1', [user.id, pointId]);
  return rowCount > 0;
};

const requirePoint = async (user, pointId) => {
  if (!(await canSeePoint(user, pointId))) throw Object.assign(new Error('Brak dostępu do wybranego punktu.'), { status: 403, code: 'POINT_FORBIDDEN' });
};

const audit = async (actorUserId, action, entityType, entityId = null, pointId = null, metadata = {}) => {
  await q(
    'INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,point_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [makeId('aud'), actorUserId || null, action, entityType, entityId, pointId, JSON.stringify(metadata)]
  );
};

const verifyGoogle = async (idToken, audience) => {
  if (!audience) throw new Error('Google OAuth audience is not configured.');
  const ticket = await googleVerifier.verifyIdToken({ idToken, audience });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email || p.email_verified !== true) throw new Error('Google nie potwierdził tożsamości.');
  return {
    sub: p.sub,
    email: normalizeEmail(p.email),
    name: cleanText(p.name || p.email, 120),
    picture: p.picture || null
  };
};

const loginProfile = async (profile, clientType, allowCreate) => {
  let result = await q(
    'SELECT id,google_sub,email,name,picture_url,role_code,status,first_login_at,last_login_at FROM users WHERE google_sub=$1 OR lower(email)=lower($2) ORDER BY CASE WHEN google_sub=$1 THEN 0 ELSE 1 END LIMIT 1',
    [profile.sub, profile.email]
  );
  let user = result.rows[0] || null;

  if (profile.email === OWNER_EMAIL) {
    await q(
      "INSERT INTO users(id,google_sub,email,name,picture_url,role_code,status,first_login_at,last_login_at,updated_at) VALUES('usr_owner',$1,$2,$3,$4,'OWNER','ACTIVE',now(),now(),now()) ON CONFLICT(id) DO UPDATE SET google_sub=EXCLUDED.google_sub,email=EXCLUDED.email,name=EXCLUDED.name,picture_url=EXCLUDED.picture_url,role_code='OWNER',status='ACTIVE',last_login_at=now(),updated_at=now()",
      [profile.sub, OWNER_EMAIL, profile.name || 'Bartłomiej Motłoch', profile.picture]
    );
    user = await loadUser('usr_owner');
  } else if (!user && allowCreate) {
    const userId = makeId('usr');
    await q(
      "INSERT INTO users(id,google_sub,email,name,picture_url,role_code,status,first_login_at,last_login_at) VALUES($1,$2,$3,$4,$5,NULL,'PENDING',now(),now())",
      [userId, profile.sub, profile.email, profile.name, profile.picture]
    );
    user = await loadUser(userId);
  } else if (!user) {
    throw Object.assign(new Error('To konto nie ma dostępu do LockOn ServiceOS.'), { status: 403, code: 'NO_ACCOUNT' });
  } else {
    await q(
      'UPDATE users SET google_sub=COALESCE(google_sub,$1),name=$2,picture_url=$3,last_login_at=now(),updated_at=now() WHERE id=$4',
      [profile.sub, profile.name, profile.picture, user.id]
    );
    user = await loadUser(user.id);
  }

  if (clientType === 'WEB' && user.status !== 'ACTIVE') {
    throw Object.assign(new Error('Konto nie jest aktywne.'), { status: 403, code: 'ACCOUNT_NOT_ACTIVE' });
  }

  const token = await createSession(user.id, clientType);
  await audit(user.id, 'LOGIN_' + clientType, 'user', user.id, null, {});
  return { token, ...(await authPayload(user)) };
};

const visiblePointIds = async (user) => {
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q('SELECT id FROM points WHERE active=true');
    return rows.map((r) => r.id);
  }
  const { rows } = await q('SELECT point_id AS id FROM user_point_access WHERE user_id=$1', [user.id]);
  return rows.map((r) => r.id);
};

const searchCustomers = async (user, term) => {
  const query = cleanText(term, 120);
  if (query.length < 2) return [];
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q(
      "SELECT id,first_name,last_name,email,phone FROM customers WHERE lower(first_name||' '||last_name||' '||coalesce(email,'')||' '||coalesce(phone,'')) LIKE '%'||lower($1)||'%' ORDER BY updated_at DESC LIMIT 20",
      [query]
    );
    return rows.map(customerView);
  }
  const { rows } = await q(
    "SELECT DISTINCT c.id,c.first_name,c.last_name,c.email,c.phone FROM customers c JOIN service_orders s ON s.customer_id=c.id JOIN user_point_access a ON a.point_id=s.point_id AND a.user_id=$2 WHERE lower(c.first_name||' '||c.last_name||' '||coalesce(c.email,'')||' '||coalesce(c.phone,'')) LIKE '%'||lower($1)||'%' ORDER BY c.last_name,c.first_name LIMIT 20",
    [query, user.id]
  );
  return rows.map(customerView);
};

const orderView = (row) => ({
  id: row.id,
  orderNumber: Number(row.order_number),
  pointId: row.point_id,
  pointName: row.point_name,
  customerId: row.customer_id,
  customerName: row.first_name + ' ' + row.last_name,
  customerEmail: row.email || null,
  customerPhone: row.phone || null,
  deviceId: row.device_id,
  brand: row.brand,
  model: row.model,
  orderType: row.order_type,
  issueDescription: row.issue_description,
  status: row.status,
  statusLabel: STATUS_LABELS[row.status] || row.status,
  assignedTechnicianId: row.assigned_technician_id || null,
  receivedAt: row.received_at,
  completedAt: row.completed_at || null
});

const getVisibleOrderByNumber = async (user, number) => {
  const params = [Number(number)];
  let access = '';
  if (!GLOBAL_ROLES.has(user.role_code)) {
    params.push(user.id);
    access = ' AND EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND a.point_id=s.point_id)';
  }
  const { rows } = await q(
    "SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id WHERE s.order_number=$1" + access + ' LIMIT 1',
    params
  );
  return rows[0] ? orderView(rows[0]) : null;
};

const listVisibleOrders = async (user) => {
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q(
      "SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id ORDER BY s.created_at DESC LIMIT 100"
    );
    return rows.map(orderView);
  }
  const { rows } = await q(
    "SELECT DISTINCT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id JOIN user_point_access a ON a.point_id=s.point_id AND a.user_id=$1 ORDER BY s.created_at DESC LIMIT 100",
    [user.id]
  );
  return rows.map(orderView);
};

const gmailKey = () => {
  const key = Buffer.from(GMAIL_TOKEN_KEY, 'base64');
  if (key.length !== 32) throw new Error('LOCKON_GMAIL_TOKEN_KEY is not configured.');
  return key;
};

const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', gmailKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), encrypted.toString('base64'), cipher.getAuthTag().toString('base64')].join('.');
};

const decryptSecret = (packed) => {
  const parts = String(packed).split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted token.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', gmailKey(), Buffer.from(parts[0], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[1], 'base64')), decipher.final()]).toString('utf8');
};

const refreshGmailAccess = async (refreshToken, clientSecret) => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_DESKTOP_CLIENT_ID,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('Google odrzucił odświeżenie dostępu Gmail.');
  return data.access_token;
};

const gmailProfile = async (accessToken) => {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.emailAddress) throw new Error('Brak uprawnienia gmail.send dla połączonego konta.');
  return { email: normalizeEmail(data.emailAddress) };
};

const encodeSubject = (value) => '=?UTF-8?B?' + Buffer.from(value, 'utf8').toString('base64') + '?=';
const sanitizeHeader = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const renderStatusEmail = (item) => {
  const targetStatus = String(item.payload?.to || item.status || 'RECEIVED').toUpperCase();
  const label = STATUS_LABELS[targetStatus] || targetStatus;
  const displayName = cleanText(item.sender_display_name || 'LockOn ServiceOS', 80).replace(/[\r\n]+/g, ' ');
  const footer = cleanText(item.footer_text || 'W razie pytań skontaktuj się bezpośrednio z punktem serwisowym.', 500);
  const subject = 'LockOn ServiceOS · status zlecenia #' + item.order_number + ' · ' + label;
  const intro = 'status urządzenia ' + item.brand + ' ' + item.model + ' (zlecenie #' + item.order_number + ') zmienił się na:';
  const text = [
    'Dzień dobry ' + item.first_name + ',',
    '',
    intro,
    label,
    '',
    'Punkt: ' + item.point_name,
    '',
    footer,
    '',
    'To automatyczna wiadomość z ' + displayName + '.'
  ].join('\n');
  const html = '<!doctype html><html lang="pl"><body style="margin:0;background:#111318;color:#eceff3;font-family:Arial,sans-serif">' +
    '<div style="max-width:620px;margin:0 auto;padding:28px 18px">' +
      '<div style="border:1px solid #2a2f37;border-radius:16px;background:#171a20;overflow:hidden">' +
        '<div style="padding:18px 22px;border-bottom:1px solid #2a2f37;background:#13161b">' +
          '<div style="font-size:12px;color:#ff7b45;font-weight:700;letter-spacing:.08em">LOCKON SERVICEOS</div>' +
          '<div style="font-size:20px;font-weight:800;margin-top:6px">Aktualizacja naprawy #' + escapeHtml(item.order_number) + '</div>' +
        '</div>' +
        '<div style="padding:22px">' +
          '<p style="margin:0 0 16px">Dzień dobry <strong>' + escapeHtml(item.first_name) + '</strong>,</p>' +
          '<p style="margin:0 0 14px;color:#aeb6c0">' + escapeHtml(intro) + '</p>' +
          '<div style="padding:16px;border-radius:12px;background:#101318;border:1px solid #333944">' +
            '<div style="font-size:11px;color:#7f8995;text-transform:uppercase">Aktualny status</div>' +
            '<div style="font-size:21px;font-weight:800;color:#ff8754;margin-top:5px">' + escapeHtml(label) + '</div>' +
          '</div>' +
          '<div style="margin-top:16px;font-size:13px;color:#aeb6c0">' +
            '<strong style="color:#e8ebef">' + escapeHtml(item.brand) + ' ' + escapeHtml(item.model) + '</strong><br>' +
            'Punkt: ' + escapeHtml(item.point_name) +
          '</div>' +
          '<p style="margin:20px 0 0;font-size:12px;color:#818b97;line-height:1.5">' + escapeHtml(footer) + '</p>' +
        '</div>' +
      '</div>' +
      '<div style="padding:12px 4px;text-align:center;font-size:10px;color:#626b75">Automatyczne powiadomienie z ' + escapeHtml(displayName) + '.</div>' +
    '</div></body></html>';
  return { subject, text, html, displayName };
};

const sendGmail = async (sender, recipient, subject, textBody, htmlBody, displayName = 'LockOn ServiceOS') => {
  const refreshToken = decryptSecret(sender.refresh_token_ciphertext);
  const clientSecret = decryptSecret(sender.oauth_client_secret_ciphertext);
  const accessToken = await refreshGmailAccess(refreshToken, clientSecret);
  const boundary = 'lockon_' + crypto.randomBytes(12).toString('hex');
  const fromName = encodeSubject(sanitizeHeader(displayName || 'LockOn ServiceOS'));
  const raw = [
    'From: ' + fromName + ' <' + sanitizeHeader(sender.sender_email) + '>',
    'To: ' + sanitizeHeader(recipient),
    'Subject: ' + encodeSubject(sanitizeHeader(subject)),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(textBody, 'utf8').toString('base64'),
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody, 'utf8').toString('base64'),
    '--' + boundary + '--'
  ].join('\r\n');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(raw) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    throw new Error(cleanText(payload?.error?.message || 'Gmail send failed', 300));
  }
  return { id: String(payload.id), threadId: payload.threadId ? String(payload.threadId) : null };
};

const processNotification = async (notificationId) => {
  const { rows } = await q(
    "SELECT n.id,n.recipient,n.service_order_id,n.payload,n.attempts,n.subject,n.body_text,n.body_html,s.order_number,s.status,s.point_id,p.name AS point_name,c.first_name,d.brand,d.model,e.sender_email,e.refresh_token_ciphertext,e.oauth_client_secret_ciphertext,e.status AS sender_status,coalesce(ns.sender_display_name,'LockOn ServiceOS') AS sender_display_name,ns.footer_text FROM notification_outbox n JOIN service_orders s ON s.id=n.service_order_id JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN point_email_senders e ON e.point_id=s.point_id LEFT JOIN point_notification_settings ns ON ns.point_id=s.point_id WHERE n.id=$1 LIMIT 1",
    [notificationId]
  );
  const item = rows[0];
  if (!item) return { sent: false, reason: 'NOT_FOUND' };

  const attempt = Number(item.attempts || 0) + 1;
  const retryMinutes = Math.min(240, 5 * Math.pow(2, Math.max(0, attempt - 1)));
  const nextAttemptAt = new Date(Date.now() + retryMinutes * 60_000);

  if (!item.sender_email || item.sender_status !== 'ACTIVE' || !item.oauth_client_secret_ciphertext) {
    const error = 'Brak aktywnego, kompletnego nadawcy Gmail dla punktu.';
    await q(
      "UPDATE notification_outbox SET status='FAILED',attempts=$2,last_error=$3,available_at=$4,updated_at=now() WHERE id=$1",
      [notificationId, attempt, error, nextAttemptAt]
    );
    return { sent: false, reason: 'NO_SENDER', attempts: attempt, nextAttemptAt: nextAttemptAt.toISOString() };
  }

  const rendered = renderStatusEmail(item);
  const subject = item.subject || rendered.subject;
  const textBody = item.body_text || rendered.text;
  const htmlBody = item.body_html || rendered.html;

  try {
    await q(
      "UPDATE notification_outbox SET status='PROCESSING',attempts=$2,last_error=NULL,subject=$3,body_text=$4,body_html=$5,updated_at=now() WHERE id=$1",
      [notificationId, attempt, subject, textBody, htmlBody]
    );
    const sent = await sendGmail(item, item.recipient, subject, textBody, htmlBody, rendered.displayName);
    await q(
      "UPDATE notification_outbox SET status='SENT',sent_at=now(),provider_message_id=$2,last_error=NULL,updated_at=now() WHERE id=$1",
      [notificationId, sent.id]
    );
    await q("UPDATE point_email_senders SET status='ACTIVE',last_error=NULL,updated_at=now() WHERE point_id=$1", [item.point_id]);
    return { sent: true, status: 'SENT', messageId: sent.id, attempts: attempt };
  } catch (error) {
    const message = cleanText(error instanceof Error ? error.message : error, 500);
    await q(
      "UPDATE notification_outbox SET status='FAILED',last_error=$2,available_at=$3,updated_at=now() WHERE id=$1",
      [notificationId, message, nextAttemptAt]
    );
    await q("UPDATE point_email_senders SET last_error=$2,updated_at=now() WHERE point_id=$1", [item.point_id, message]);
    return { sent: false, status: 'FAILED', reason: 'SEND_FAILED', attempts: attempt, nextAttemptAt: nextAttemptAt.toISOString() };
  }
};

const generateWebsiteCode = async (session) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i += 1) code += alphabet[crypto.randomInt(0, alphabet.length)];
  const pretty = code.slice(0, 4) + '-' + code.slice(4);
  const expiresAt = new Date(Date.now() + WEBSITE_CODE_TTL_MS);
  await q("UPDATE website_auth_codes SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND consumed_at IS NULL", [session.user.id]);
  await q(
    'INSERT INTO website_auth_codes(id,user_id,code_hash,expires_at,created_from_session_id) VALUES($1,$2,$3,$4,$5)',
    [makeId('wac'), session.user.id, tokenHash(code), expiresAt, session.sessionId]
  );
  await audit(session.user.id, 'WEBSITE_CODE_CREATED', 'user', session.user.id, null, {});
  return { code: pretty, expiresAt: expiresAt.toISOString() };
};

const getOrCreateConversation = async (userId) => {
  let result = await q("SELECT id,user_id,subject,status,created_at,updated_at FROM support_conversations WHERE user_id=$1 AND status='OPEN' ORDER BY updated_at DESC LIMIT 1", [userId]);
  if (result.rows[0]) return result.rows[0];
  try {
    await q("INSERT INTO support_conversations(id,user_id,subject,status) VALUES($1,$2,'Pomoc ServiceOS','OPEN')", [makeId('sup'), userId]);
  } catch {}
  result = await q("SELECT id,user_id,subject,status,created_at,updated_at FROM support_conversations WHERE user_id=$1 AND status='OPEN' ORDER BY updated_at DESC LIMIT 1", [userId]);
  return result.rows[0];
};

const conversationPayload = async (userId) => {
  const conversation = await getOrCreateConversation(userId);
  const { rows } = await q(
    'SELECT id,sender_user_id,sender_kind,body,created_at FROM support_messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 200',
    [conversation.id]
  );
  return {
    id: conversation.id,
    status: conversation.status,
    messages: rows.map((row) => ({
      id: row.id,
      author: row.sender_kind.toLowerCase(),
      text: row.body,
      createdAt: row.created_at
    }))
  };
};

const roleSelfDescription = (role) => ({
  OWNER: 'Masz rolę OWNER i globalny dostęp administracyjny.',
  BOSS: 'Masz rolę BOSS: globalny dostęp operacyjny do punktów, napraw, przychodów i rozliczeń.',
  COORDINATOR: 'Masz rolę COORDINATOR: pracujesz na przypisanych punktach.',
  SUPPORT: 'Masz rolę SUPPORT: pracujesz na przypisanych punktach i w obszarze wsparcia.',
  TECHNICIAN: 'Masz rolę TECHNICIAN: pracujesz na przypisanych punktach, naprawach i własnych przychodach.',
  USER: 'Masz rolę USER: podstawowy dostęp do przypisanego punktu.'
}[role] || 'Twoje konto nie ma jeszcze aktywnej roli.');

const assistantReply = async (session, message) => {
  const user = session.user;
  const lower = message.toLocaleLowerCase('pl-PL');

  if ((lower.includes('kod') || lower.includes('autoryz')) && (lower.includes('stron') || lower.includes('www') || lower.includes('logow'))) {
    const code = await generateWebsiteCode(session);
    return {
      text: 'Kod jednorazowy do logowania na stronie: ' + code.code + '. Jest ważny 5 minut i zadziała tylko raz.',
      action: { type: 'WEBSITE_CODE', ...code }
    };
  }

  if (lower.includes('klient')) {
    if (!SERVICE_READ_ROLES.has(user.role_code)) {
      return { text: 'Twoja rola nie ma dostępu do danych klientów. Mogę nadal pomóc w obsłudze samej aplikacji.' };
    }
    let term = message.replace(/znajdź|znajdz|wyszukaj|klienta|klient|pokaż|pokaz|szukaj/gi, ' ').replace(/\s+/g, ' ').trim();
    term = cleanText(term, 120);
    if (term.length >= 2) {
      const matches = await searchCustomers(user, term);
      if (!matches.length) return { text: 'Nie znalazłem klienta pasującego do "' + term + '" w zakresie danych, do których masz dostęp.' };
      const lines = matches.slice(0, 5).map((c) => '- ' + c.firstName + ' ' + c.lastName + (c.email ? ' · ' + c.email : '') + (c.phone ? ' · ' + c.phone : ''));
      return { text: 'Znalazłem klientów w Twoim zakresie:\n' + lines.join('\n') };
    }
  }

  if (lower.includes('zlecen') || lower.includes('napraw')) {
    if (!SERVICE_READ_ROLES.has(user.role_code)) {
      return { text: 'Twoja rola nie ma dostępu do danych zleceń serwisowych.' };
    }
    const number = message.match(/\b\d{1,10}\b/);
    if (number) {
      const order = await getVisibleOrderByNumber(user, number[0]);
      if (!order) return { text: 'Nie znalazłem zlecenia #' + number[0] + ' w zakresie, do którego masz dostęp.' };
      return { text: 'Zlecenie #' + order.orderNumber + ': ' + order.customerName + ', ' + order.brand + ' ' + order.model + '. Status: ' + order.statusLabel + '. Punkt: ' + order.pointName + '.' };
    }
  }

  if (lower.includes('moja rola') || lower.includes('moje uprawn') || lower.includes('co mogę') || lower.includes('co moge')) {
    return { text: roleSelfDescription(user.role_code) };
  }

  if ((lower.includes('role') || lower.includes('uprawnienia')) && user.role_code !== 'OWNER') {
    return { text: roleSelfDescription(user.role_code) + ' Pełny katalog wszystkich ról i uprawnień jest widoczny wyłącznie dla OWNER.' };
  }

  const audience = user.role_code === 'OWNER' ? ['ALL', 'OWNER'] : ['ALL'];
  const { rows } = await q(
    'SELECT slug,title,keywords,body,audience FROM assistant_knowledge WHERE enabled=true AND audience=ANY($1::text[])',
    [audience]
  );
  let best = null;
  let bestScore = 0;
  for (const item of rows) {
    const score = (item.keywords || []).reduce((sum, keyword) => sum + (lower.includes(String(keyword).toLocaleLowerCase('pl-PL')) ? 1 : 0), 0);
    if (score > bestScore) { best = item; bestScore = score; }
  }
  if (best) return { text: best.body };

  return { text: 'Mogę pomóc w obsłudze ServiceOS, wyszukać klienta lub zlecenie w Twoim zakresie oraz wygenerować jednorazowy kod logowania na stronę. Napisz np. "znajdź klienta Kowalski", "zlecenie 123" albo "kod do strony".' };
};

const route = async (request) => {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: secureHeaders(request) });
  if (method === 'GET' && url.pathname === '/health') return json(request, { ok: true, service: 'LockOn ServiceOS Central API', time: nowIso() });

  if (method === 'POST' && url.pathname === '/auth/google') {
    const body = await readJson(request);
    if (!body.idToken) return json(request, { error: 'MISSING_TOKEN', message: 'Brak tokena Google.' }, 400);
    try {
      const profile = await verifyGoogle(String(body.idToken), GOOGLE_DESKTOP_CLIENT_ID);
      return json(request, await loginProfile(profile, 'DESKTOP', true));
    } catch (error) {
      if (error?.status) throw error;
      return json(request, { error: 'GOOGLE_AUTH_FAILED', message: 'Google nie potwierdził tożsamości.' }, 401);
    }
  }

  if (method === 'POST' && url.pathname === '/auth/google-web') {
    const body = await readJson(request);
    if (!body.idToken) return json(request, { error: 'MISSING_TOKEN', message: 'Brak tokena Google.' }, 400);
    try {
      const profile = await verifyGoogle(String(body.idToken), GOOGLE_WEB_CLIENT_ID);
      return json(request, await loginProfile(profile, 'WEB', false));
    } catch (error) {
      if (error?.status) throw error;
      return json(request, { error: 'GOOGLE_AUTH_FAILED', message: 'Google nie potwierdził tożsamości.' }, 401);
    }
  }

  if (method === 'POST' && url.pathname === '/auth/dev-owner') {
    if (!ALLOW_DEV_LOGIN) return json(request, { error: 'NOT_FOUND' }, 404);
    return json(request, await loginProfile({ sub: 'dev-owner', email: OWNER_EMAIL, name: 'Bartłomiej Motłoch', picture: null }, 'DESKTOP', true));
  }

  if (method === 'GET' && url.pathname === '/me') {
    const session = await requireUser(request);
    return json(request, await authPayload(session.user));
  }

  if (method === 'POST' && url.pathname === '/auth/logout') {
    const session = await currentSession(request);
    if (session) await q('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [session.sessionId]);
    return json(request, { ok: true });
  }

  if (method === 'POST' && url.pathname === '/website/auth-code') {
    const session = await requireActive(request);
    return json(request, await generateWebsiteCode(session), 201);
  }

  if (method === 'POST' && url.pathname === '/website/redeem') {
    const body = await readJson(request);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) return json(request, { error: 'CODE', message: 'Nieprawidłowy kod.' }, 400);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        "UPDATE website_auth_codes SET consumed_at=now() WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING user_id",
        [tokenHash(code)]
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return json(request, { error: 'CODE_EXPIRED', message: 'Kod jest nieprawidłowy, wykorzystany albo wygasł.' }, 401);
      }
      const userResult = await client.query("SELECT id,google_sub,email,name,picture_url,role_code,status,first_login_at,last_login_at FROM users WHERE id=$1 AND status='ACTIVE'", [result.rows[0].user_id]);
      if (!userResult.rows[0]) {
        await client.query('ROLLBACK');
        return json(request, { error: 'ACCOUNT_NOT_ACTIVE', message: 'Konto nie jest aktywne.' }, 403);
      }
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      await client.query(
        'INSERT INTO auth_sessions(id,user_id,token_hash,client_type,created_at,last_seen_at,expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,now(),now(),$5,$6)',
        [makeId('ses'), userResult.rows[0].id, tokenHash(token), 'WEB', new Date(now + SESSION_TTL_MS), new Date(now + SESSION_ABSOLUTE_TTL_MS)]
      );
      await client.query('COMMIT');
      return json(request, { token, ...(await authPayload(userResult.rows[0])) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  if (method === 'POST' && url.pathname === '/access/request-point') {
    const session = await requireUser(request);
    if (session.user.status === 'ACTIVE') return json(request, { error: 'ALREADY_ACTIVE', message: 'Konto jest już aktywne.' }, 400);
    const body = await readJson(request);
    const pointName = cleanText(body.pointName, 90);
    const city = cleanText(body.city, 90);
    const requestedRole = String(body.requestedRole || 'USER').toUpperCase();
    if (!pointName || !city || !REQUESTABLE_ROLES.has(requestedRole)) return json(request, { error: 'VALIDATION', message: 'Nieprawidłowe zgłoszenie punktu.' }, 400);
    await q("UPDATE access_requests SET status='REJECTED',resolved_at=now(),note='Zastąpione nowszym zgłoszeniem' WHERE user_id=$1 AND status='PENDING'", [session.user.id]);
    await q(
      "INSERT INTO access_requests(id,user_id,point_name,city,requested_role_code,status,requested_at) VALUES($1,$2,$3,$4,$5,'PENDING',now())",
      [makeId('acr'), session.user.id, pointName, city, requestedRole]
    );
    return json(request, await authPayload(await loadUser(session.user.id)));
  }

  if (method === 'GET' && url.pathname === '/admin/overview') {
    const session = await requireActive(request);
    if (session.user.role_code !== 'OWNER') throw Object.assign(new Error('Brak uprawnień.'), { status: 403 });
    const [points, users, loginEvents, pendingRevenue] = await Promise.all([
      q('SELECT id,name,city,active FROM points ORDER BY name'),
      q("SELECT id,google_sub,email,name,picture_url,role_code,status,first_login_at,last_login_at FROM users ORDER BY created_at DESC"),
      q("SELECT a.id,a.actor_user_id AS user_id,u.email,u.name,u.role_code AS role,u.status,a.created_at FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.action LIKE 'LOGIN_%' ORDER BY a.created_at DESC LIMIT 100"),
      q("SELECT r.*,u.name AS technician_name,u.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users u ON u.id=r.user_id JOIN points p ON p.id=r.point_id WHERE r.status='PENDING' ORDER BY r.created_at DESC")
    ]);
    const mappedUsers = [];
    for (const user of users.rows) mappedUsers.push(await publicUser(user));
    const revenues = pendingRevenue.rows.map((r) => ({
      id:r.id,userId:r.user_id,pointId:r.point_id,amount:Number(r.amount),workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,
      splitTechnicianPercent:50,splitBossPercent:50,technicianShare:0,bossShare:0,submittedAt:r.created_at,reviewedAt:r.approved_at||null,
      technician:{id:r.user_id,name:r.technician_name,email:r.technician_email},point:{id:r.point_id,name:r.point_name,city:r.point_city,active:r.point_active}
    }));
    return json(request, {
      points: points.rows.map(pointView),
      users: mappedUsers,
      pendingUsers: mappedUsers.filter((u) => u.status === 'PENDING'),
      loginEvents: loginEvents.rows.map((e) => ({id:e.id,userId:e.user_id,email:e.email||'',name:e.name||'',role:e.role||null,status:e.status||'PENDING',pointIds:[],createdAt:e.created_at})),
      pendingRevenue: revenues
    });
  }

  if (method === 'POST' && url.pathname === '/admin/points') {
    const session = await requireActive(request);
    if (session.user.role_code !== 'OWNER') throw Object.assign(new Error('Brak uprawnień.'), { status: 403 });
    const body = await readJson(request);
    const name = cleanText(body.name, 90), city = cleanText(body.city, 90);
    if (!name || !city) return json(request, { error:'VALIDATION',message:'Wpisz nazwę punktu i miasto.' }, 400);
    let result = await q('SELECT id,name,city,active FROM points WHERE lower(name)=lower($1) AND lower(city)=lower($2) LIMIT 1',[name,city]);
    if (result.rows[0]) return json(request, pointView(result.rows[0]));
    const pointId=makeId('pnt');
    result=await q('INSERT INTO points(id,name,city,active) VALUES($1,$2,$3,true) RETURNING id,name,city,active',[pointId,name,city]);
    await audit(session.user.id,'POINT_CREATED','point',pointId,pointId,{});
    return json(request, pointView(result.rows[0]), 201);
  }

  const approve = url.pathname.match(/^\/admin\/users\/([^/]+)\/approve$/);
  if (method === 'POST' && approve) {
    const session=await requireActive(request);
    if(session.user.role_code!=='OWNER') throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const target=await loadUser(approve[1]);
    if(!target) return json(request,{error:'NOT_FOUND'},404);
    const body=await readJson(request);
    const role=String(body.role||'USER').toUpperCase();
    if(!REQUESTABLE_ROLES.has(role)) return json(request,{error:'ROLE'},400);
    let pointIds=Array.isArray(body.pointIds)?body.pointIds.map(String):[];
    if(body.createRequestedPoint===true){
      const req=await loadRequestedPoint(target.id);
      if(req){
        let found=await q('SELECT id FROM points WHERE lower(name)=lower($1) AND lower(city)=lower($2) LIMIT 1',[req.pointName,req.city]);
        let pointId=found.rows[0]?.id;
        if(!pointId){pointId=makeId('pnt');await q('INSERT INTO points(id,name,city,active) VALUES($1,$2,$3,true)',[pointId,req.pointName,req.city]);}
        pointIds=[pointId];
      }
    }
    if(!GLOBAL_ROLES.has(role)&&pointIds.length===0) return json(request,{error:'POINT_REQUIRED',message:'Wybierz co najmniej jeden punkt.'},400);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("UPDATE users SET role_code=$1,status='ACTIVE',updated_at=now() WHERE id=$2",[role,target.id]);
      await client.query('DELETE FROM user_point_access WHERE user_id=$1',[target.id]);
      if(!GLOBAL_ROLES.has(role)) for(const pointId of pointIds) await client.query('INSERT INTO user_point_access(user_id,point_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[target.id,pointId]);
      await client.query("UPDATE access_requests SET status='APPROVED',resolved_at=now(),resolved_by_user_id=$2 WHERE user_id=$1 AND status='PENDING'",[target.id,session.user.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally{client.release();}
    await audit(session.user.id,'USER_APPROVED','user',target.id,null,{role,pointIds});
    return json(request, await authPayload(await loadUser(target.id)));
  }

  const reject = url.pathname.match(/^\/admin\/users\/([^/]+)\/reject$/);
  if(method==='POST'&&reject){
    const session=await requireActive(request);if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const target=await loadUser(reject[1]);if(!target)return json(request,{error:'NOT_FOUND'},404);if(target.role_code==='OWNER')return json(request,{error:'OWNER_PROTECTED'},400);
    await q("UPDATE users SET role_code=NULL,status='REJECTED',updated_at=now() WHERE id=$1",[target.id]);
    await q('DELETE FROM user_point_access WHERE user_id=$1',[target.id]);
    await q("UPDATE access_requests SET status='REJECTED',resolved_at=now(),resolved_by_user_id=$2 WHERE user_id=$1 AND status='PENDING'",[target.id,session.user.id]);
    await audit(session.user.id,'USER_REJECTED','user',target.id);
    return json(request,{ok:true});
  }

  const access = url.pathname.match(/^\/admin\/users\/([^/]+)\/access$/);
  if(method==='POST'&&access){
    const session=await requireActive(request);if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const target=await loadUser(access[1]);if(!target)return json(request,{error:'NOT_FOUND'},404);if(target.role_code==='OWNER')return json(request,{error:'OWNER_PROTECTED'},400);
    const body=await readJson(request);const role=String(body.role||target.role_code||'USER').toUpperCase();const pointIds=Array.isArray(body.pointIds)?body.pointIds.map(String):[];
    if(!REQUESTABLE_ROLES.has(role))return json(request,{error:'ROLE'},400);if(!GLOBAL_ROLES.has(role)&&pointIds.length===0)return json(request,{error:'POINT_REQUIRED'},400);
    const client=await pool.connect();try{await client.query('BEGIN');await client.query("UPDATE users SET role_code=$1,status='ACTIVE',updated_at=now() WHERE id=$2",[role,target.id]);await client.query('DELETE FROM user_point_access WHERE user_id=$1',[target.id]);if(!GLOBAL_ROLES.has(role))for(const pointId of pointIds)await client.query('INSERT INTO user_point_access(user_id,point_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[target.id,pointId]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
    await audit(session.user.id,'USER_ACCESS_UPDATED','user',target.id,null,{role,pointIds});
    return json(request,await authPayload(await loadUser(target.id)));
  }

  if(method==='GET'&&url.pathname==='/finance/revenues'){
    const session=await requireActive(request);const u=session.user;
    let rows;
    if(GLOBAL_ROLES.has(u.role_code)) rows=(await q("SELECT r.*,usr.name AS technician_name,usr.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users usr ON usr.id=r.user_id JOIN points p ON p.id=r.point_id ORDER BY r.occurred_at DESC")).rows;
    else if(u.role_code==='TECHNICIAN') rows=(await q("SELECT r.*,usr.name AS technician_name,usr.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users usr ON usr.id=r.user_id JOIN points p ON p.id=r.point_id WHERE r.user_id=$1 ORDER BY r.occurred_at DESC",[u.id])).rows;
    else rows=(await q("SELECT DISTINCT r.*,usr.name AS technician_name,usr.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users usr ON usr.id=r.user_id JOIN points p ON p.id=r.point_id JOIN user_point_access a ON a.point_id=r.point_id AND a.user_id=$1 ORDER BY r.occurred_at DESC",[u.id])).rows;
    const entries=rows.map((r)=>{const amount=Number(r.amount);const approved=r.status==='APPROVED'||r.status==='SETTLED';return{id:r.id,userId:r.user_id,pointId:r.point_id,amount,workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,splitTechnicianPercent:50,splitBossPercent:50,technicianShare:approved?Math.round(amount*50)/100:0,bossShare:approved?Math.round(amount*50)/100:0,submittedAt:r.created_at,reviewedAt:r.approved_at||null,technician:{id:r.user_id,name:r.technician_name,email:r.technician_email},point:{id:r.point_id,name:r.point_name,city:r.point_city,active:r.point_active}}});
    const approved=entries.filter((e)=>e.status==='APPROVED'||e.status==='SETTLED'),pending=entries.filter((e)=>e.status==='PENDING');
    return json(request,{entries,summary:{approvedRevenue:approved.reduce((s,e)=>s+e.amount,0),technicianShare:approved.reduce((s,e)=>s+e.technicianShare,0),bossShare:approved.reduce((s,e)=>s+e.bossShare,0),pendingRevenue:pending.reduce((s,e)=>s+e.amount,0)}});
  }

  if(method==='POST'&&url.pathname==='/finance/revenues'){
    const session=await requireActive(request);if(session.user.role_code!=='TECHNICIAN')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const body=await readJson(request),amount=Number(body.amount),pointId=String(body.pointId||''),note=cleanText(body.note,700),workDate=cleanText(body.workDate,20)||new Date().toISOString().slice(0,10);
    if(!Number.isFinite(amount)||amount<=0)return json(request,{error:'AMOUNT'},400);await requirePoint(session.user,pointId);
    const id=makeId('rev');await q("INSERT INTO revenue_entries(id,point_id,user_id,amount,currency,category,status,note,occurred_at) VALUES($1,$2,$3,$4,'PLN','SERVICE','PENDING',$5,$6)",[id,pointId,session.user.id,Math.round(amount*100)/100,note,new Date(workDate+'T12:00:00Z')]);
    return json(request,{id,userId:session.user.id,pointId,amount:Math.round(amount*100)/100,workDate,note,status:'PENDING',splitTechnicianPercent:50,splitBossPercent:50,technicianShare:0,bossShare:0,submittedAt:nowIso()},201);
  }

  const review=url.pathname.match(/^\/finance\/revenues\/([^/]+)\/review$/);
  if(method==='POST'&&review){
    const session=await requireActive(request);if(!GLOBAL_ROLES.has(session.user.role_code))throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const body=await readJson(request),action=String(body.action||'');if(!['APPROVE','REJECT'].includes(action))return json(request,{error:'ACTION'},400);
    const result=await q("UPDATE revenue_entries SET status=$1,approved_by_user_id=$2,approved_at=now() WHERE id=$3 RETURNING *",[action==='APPROVE'?'APPROVED':'REJECTED',session.user.id,review[1]]);
    if(!result.rows[0])return json(request,{error:'NOT_FOUND'},404);
    const r=result.rows[0],amount=Number(r.amount),approved=r.status==='APPROVED';
    return json(request,{id:r.id,userId:r.user_id,pointId:r.point_id,amount,workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,splitTechnicianPercent:50,splitBossPercent:50,technicianShare:approved?Math.round(amount*50)/100:0,bossShare:approved?Math.round(amount*50)/100:0,submittedAt:r.created_at,reviewedAt:r.approved_at});
  }

  if(method==='GET'&&url.pathname==='/dashboard'){
    const session=await requireActive(request),u=session.user,ids=await visiblePointIds(u);
    const revenue=(await q("SELECT amount,status,user_id FROM revenue_entries WHERE point_id=ANY($1::text[])",[ids])).rows;
    const users=(await q("SELECT COUNT(DISTINCT u.id)::int AS count FROM users u LEFT JOIN user_point_access a ON a.user_id=u.id WHERE u.status='ACTIVE' AND ($2::boolean OR a.point_id=ANY($1::text[]))",[ids,GLOBAL_ROLES.has(u.role_code)])).rows[0].count;
    const approved=revenue.filter((r)=>r.status==='APPROVED'||r.status==='SETTLED'),pending=revenue.filter((r)=>r.status==='PENDING');
    const approvedSum=approved.reduce((s,r)=>s+Number(r.amount),0),pendingSum=pending.reduce((s,r)=>s+Number(r.amount),0);
    return json(request,{pointCount:ids.length,activeUsers:users,pendingUsers:u.role_code==='OWNER'?(await q("SELECT COUNT(*)::int AS count FROM users WHERE status='PENDING'")).rows[0].count:0,approvedRevenue:approvedSum,pendingRevenue:pendingSum,bossShare:approvedSum/2,technicianShare:u.role_code==='TECHNICIAN'?approved.filter((r)=>r.user_id===u.id).reduce((s,r)=>s+Number(r.amount)/2,0):approvedSum/2});
  }

  if(method==='GET'&&url.pathname==='/service/customers/search'){
    const session=await requireActive(request);
    if(!SERVICE_READ_ROLES.has(session.user.role_code)) throw Object.assign(new Error('Brak uprawnień do danych klientów.'),{status:403});
    return json(request,await searchCustomers(session.user,url.searchParams.get('q')||''));
  }

  if(method==='GET'&&url.pathname==='/service/orders'){
    const session=await requireActive(request);
    if(!SERVICE_READ_ROLES.has(session.user.role_code)) throw Object.assign(new Error('Brak uprawnień do zleceń.'),{status:403});
    return json(request,await listVisibleOrders(session.user));
  }

  if(method==='POST'&&url.pathname==='/service/orders'){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    if(!SERVICE_CREATE_ROLES.has(u.role_code)) throw Object.assign(new Error('Brak uprawnień do tworzenia zleceń.'),{status:403});
    const pointId=cleanText(body.pointId,80);await requirePoint(u,pointId);
    const firstName=cleanText(body.firstName,80),lastName=cleanText(body.lastName,100),email=normalizeEmail(cleanText(body.email,180)),phone=cleanText(body.phone,50),phoneNorm=normalizePhone(phone),brand=cleanText(body.brand,80),model=cleanText(body.model,120),issue=cleanText(body.issueDescription,2000),orderType=String(body.orderType||'REPAIR').toUpperCase();
    if(!firstName||!lastName||!brand||!model||!issue||!['REPAIR','COMPLAINT'].includes(orderType))return json(request,{error:'VALIDATION',message:'Uzupełnij dane klienta, urządzenia i usterki.'},400);
    const client=await pool.connect();let reused=false;try{
      await client.query('BEGIN');
      let customer=(await client.query("SELECT * FROM customers WHERE ($1<>'' AND lower(email)=lower($1)) OR ($2<>'' AND phone_normalized=$2) ORDER BY updated_at DESC LIMIT 1",[email,phoneNorm])).rows[0];
      if(customer){reused=true;await client.query("UPDATE customers SET first_name=$1,last_name=$2,email=COALESCE(NULLIF($3,''),email),phone=COALESCE(NULLIF($4,''),phone),phone_normalized=COALESCE(NULLIF($5,''),phone_normalized),updated_at=now() WHERE id=$6",[firstName,lastName,email,phone,phoneNorm,customer.id]);customer=(await client.query('SELECT * FROM customers WHERE id=$1',[customer.id])).rows[0];}
      else{const cid=makeId('cst');customer=(await client.query("INSERT INTO customers(id,first_name,last_name,email,phone,phone_normalized,created_by_user_id) VALUES($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7) RETURNING *",[cid,firstName,lastName,email,phone,phoneNorm,u.id])).rows[0];}
      const did=makeId('dev');await client.query('INSERT INTO devices(id,customer_id,brand,model) VALUES($1,$2,$3,$4)',[did,customer.id,brand,model]);
      const oid=makeId('srv');const order=(await client.query("INSERT INTO service_orders(id,point_id,customer_id,device_id,order_type,issue_description,status,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'RECEIVED',$7) RETURNING *",[oid,pointId,customer.id,did,orderType,issue,u.id])).rows[0];
      await client.query("INSERT INTO service_order_status_history(id,service_order_id,from_status,to_status,changed_by_user_id) VALUES($1,$2,NULL,'RECEIVED',$3)",[makeId('hst'),oid,u.id]);
      await client.query('COMMIT');
      await audit(u.id,'SERVICE_ORDER_CREATED','service_order',oid,pointId,{orderType});
      return json(request,{customer:customerView(customer),order:{id:order.id,orderNumber:Number(order.order_number),pointId,customerId:customer.id,deviceId:did,orderType,issueDescription:issue,status:'RECEIVED',receivedAt:order.received_at},reusedCustomer:reused},201);
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  const statusMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/status$/);
  if(method==='POST'&&statusMatch){
    const session=await requireActive(request),u=session.user;if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do zmiany statusu.'),{status:403});
    const body=await readJson(request),next=String(body.status||'').toUpperCase(),note=cleanText(body.note,500);if(!SERVICE_STATUSES.has(next))return json(request,{error:'STATUS'},400);
    const found=(await q('SELECT id,point_id,status,customer_id FROM service_orders WHERE id=$1 LIMIT 1',[statusMatch[1]])).rows[0];if(!found)return json(request,{error:'NOT_FOUND'},404);await requirePoint(u,found.point_id);
    await q("UPDATE service_orders SET status=$1,updated_at=now(),completed_at=CASE WHEN $1='COMPLETED' THEN now() ELSE completed_at END WHERE id=$2",[next,found.id]);
    await q('INSERT INTO service_order_status_history(id,service_order_id,from_status,to_status,note,changed_by_user_id) VALUES($1,$2,$3,$4,$5,$6)',[makeId('hst'),found.id,found.status,next,note||null,u.id]);
    const customer=(await q('SELECT email FROM customers WHERE id=$1',[found.customer_id])).rows[0];
    let notification={queued:false,sent:false};
    if(customer?.email){
      const nid=makeId('ntf');await q("INSERT INTO notification_outbox(id,user_id,customer_id,service_order_id,channel,template_key,recipient,payload,status) VALUES($1,$2,$3,$4,'EMAIL','SERVICE_STATUS_CHANGED',$5,$6::jsonb,'PENDING')",[nid,u.id,found.customer_id,found.id,customer.email,JSON.stringify({from:found.status,to:next})]);
      notification={queued:true,...(await processNotification(nid))};
    }
    await audit(u.id,'SERVICE_STATUS_CHANGED','service_order',found.id,found.point_id,{from:found.status,to:next});
    const view=(await listVisibleOrders(u)).find((o)=>o.id===found.id);
    return json(request,{order:view,notification});
  }

  if(method==='GET'&&url.pathname==='/integrations/gmail'){
    const session=await requireActive(request),pointId=cleanText(url.searchParams.get('pointId'),80);await requirePoint(session.user,pointId);
    const {rows}=await q('SELECT point_id,sender_email,status,last_error,connected_at,updated_at FROM point_email_senders WHERE point_id=$1 LIMIT 1',[pointId]);
    return json(request,rows[0]?{connected:true,pointId:rows[0].point_id,email:rows[0].sender_email,status:rows[0].status,lastError:rows[0].last_error||null,connectedAt:rows[0].connected_at}:{connected:false,pointId});
  }

  if(method==='POST'&&url.pathname==='/integrations/gmail/connect'){
    const session=await requireActive(request),u=session.user;if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do połączenia Gmail.'),{status:403});
    const body=await readJson(request),pointId=cleanText(body.pointId,80),refreshToken=cleanText(body.refreshToken,4096),clientSecret=cleanText(body.clientSecret,4096);await requirePoint(u,pointId);if(!refreshToken||!clientSecret)return json(request,{error:'TOKEN'},400);
    const accessToken=await refreshGmailAccess(refreshToken,clientSecret);const profile=await gmailProfile(accessToken);
    await q("INSERT INTO point_email_senders(point_id,connected_by_user_id,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,status,last_error,connected_at,updated_at) VALUES($1,$2,$3,$4,$5,'ACTIVE',NULL,now(),now()) ON CONFLICT(point_id) DO UPDATE SET connected_by_user_id=EXCLUDED.connected_by_user_id,sender_email=EXCLUDED.sender_email,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,oauth_client_secret_ciphertext=EXCLUDED.oauth_client_secret_ciphertext,status='ACTIVE',last_error=NULL,updated_at=now()",[pointId,u.id,profile.email,encryptSecret(refreshToken),encryptSecret(clientSecret)]);
    await audit(u.id,'GMAIL_CONNECTED','point',pointId,pointId,{senderEmail:profile.email});
    return json(request,{connected:true,pointId,email:profile.email,status:'ACTIVE'});
  }

  if(method==='DELETE'&&url.pathname==='/integrations/gmail'){
    const session=await requireActive(request),u=session.user;if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const pointId=cleanText(url.searchParams.get('pointId'),80);await requirePoint(u,pointId);await q('DELETE FROM point_email_senders WHERE point_id=$1',[pointId]);await audit(u.id,'GMAIL_DISCONNECTED','point',pointId,pointId,{});
    return json(request,{ok:true});
  }

  if(method==='POST'&&url.pathname==='/notifications/process'){
    const session=await requireActive(request);if(!GLOBAL_ROLES.has(session.user.role_code))throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const {rows}=await q("SELECT id FROM notification_outbox WHERE status IN ('PENDING','FAILED') AND available_at<=now() AND attempts<5 ORDER BY created_at ASC LIMIT 20");
    const results=[];for(const row of rows)results.push({id:row.id,...(await processNotification(row.id))});
    return json(request,{processed:results.length,results});
  }

  if(method==='GET'&&url.pathname==='/support/conversation'){
    const session=await requireActive(request);return json(request,await conversationPayload(session.user.id));
  }

  if(method==='POST'&&url.pathname==='/assistant/chat'){
    const session=await requireActive(request),body=await readJson(request),message=cleanText(body.message,1500);if(!message)return json(request,{error:'MESSAGE'},400);
    const conv=await getOrCreateConversation(session.user.id);
    const uid=makeId('msg');await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,$3,'USER',$4)",[uid,conv.id,session.user.id,message]);
    const reply=await assistantReply(session,message);
    const aid=makeId('msg');await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,NULL,'ASSISTANT',$3)",[aid,conv.id,reply.text]);await q('UPDATE support_conversations SET updated_at=now() WHERE id=$1',[conv.id]);
    return json(request,{userMessage:{id:uid,author:'user',text:message,createdAt:nowIso()},assistantMessage:{id:aid,author:'assistant',text:reply.text,createdAt:nowIso()},action:reply.action||null});
  }

  return json(request,{error:'NOT_FOUND',message:'Nie znaleziono endpointu.'},404);
};

export default {
  async fetch(request) {
    try {
      return await route(request);
    } catch (error) {
      console.error('[LockOn Central API]', error);
      const status = Number(error?.status) || 500;
      const code = error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
      const message = status >= 500 ? 'Wystąpił błąd centralnego API.' : cleanText(error instanceof Error ? error.message : error, 300);
      return json(request, { error: code, message }, status);
    }
  }
};
