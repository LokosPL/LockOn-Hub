import crypto from 'node:crypto';
import { Pool } from 'pg';
import { OAuth2Client } from 'google-auth-library';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', (error) => console.error('[postgres idle client]', error));

const OWNER_EMAIL = String(process.env.LOCKON_OWNER_EMAIL || 'nowogar@gmail.com').trim().toLowerCase();
const GOOGLE_DESKTOP_CLIENT_ID = String(process.env.LOCKON_GOOGLE_DESKTOP_CLIENT_ID || '').trim();
const GOOGLE_DESKTOP_CLIENT_SECRET = String(process.env.LOCKON_GOOGLE_DESKTOP_CLIENT_SECRET || '').trim();
const GOOGLE_CUSTOMER_WEB_CLIENT_ID = String(process.env.LOCKON_GOOGLE_WEB_CLIENT_ID || '').trim();
const SITE_ORIGINS = new Set(
  [
    String(process.env.LOCKON_SITE_ORIGIN || '').trim().replace(/\/$/, ''),
    'https://app.serviceos.pl',
    'https://lokospl.github.io'
  ].filter(Boolean)
);
const GMAIL_TOKEN_KEY = String(process.env.LOCKON_GMAIL_TOKEN_KEY || '');
const PUBLIC_PORTAL_URL = String(process.env.LOCKON_SITE_ORIGIN || 'https://app.serviceos.pl').trim().replace(/\/$/,'') || 'https://app.serviceos.pl';
const ALLOW_DEV_LOGIN = process.env.LOCKON_ALLOW_DEV_LOGIN === '1';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const WEB_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const WEB_SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 365 * 5;
const WEBSITE_CODE_TTL_MS = 1000 * 60 * 5;
const BODY_LIMIT = 64 * 1024;
const GLOBAL_ROLES = new Set(['OWNER', 'BOSS']);
const REQUESTABLE_ROLES = new Set(['BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER']);
const SERVICE_CREATE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const SERVICE_INTAKE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_TRANSFER_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_MANAGE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR']);
const GMAIL_MANAGE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR']);
const CUSTOMER_QUOTE_STAFF_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const CUSTOMER_PORTAL_SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const googleVerifier = new OAuth2Client();

const STATUS_LABELS = {
  RECEIVED: 'Przyjęto urządzenie',
  DIAGNOSIS: 'Diagnoza',
  WAITING_PARTS: 'Oczekiwanie na części',
  IN_REPAIR: 'W naprawie',
  REPAIR_DONE: 'Naprawa zakończona',
  READY: 'Gotowe do odbioru',
  COMPLETED: 'Zakończone',
  CANCELLED: 'Anulowane',
  REJECTED: 'Odrzucone'
};
const SERVICE_STATUSES = new Set(Object.keys(STATUS_LABELS));
const DEFAULT_NOTIFY_STATUSES = Object.freeze(['RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','REPAIR_DONE','READY','COMPLETED','REJECTED','CANCELLED']);

const nowIso = () => new Date().toISOString();
const makeId = (prefix) => prefix + '_' + crypto.randomBytes(10).toString('hex');
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const normalizePhone = (value = '') => String(value).replace(/\D/g, '').slice(-15);
const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const normalizeTechnicianPercent = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? Math.round(number * 100) / 100
    : null;
};
const splitRevenueAmount = (amount, technicianPercent) => {
  const percent = normalizeTechnicianPercent(technicianPercent) ?? 50;
  const technicianShare = Math.round(Number(amount) * percent) / 100;
  const bossShare = Math.round((Number(amount) - technicianShare) * 100) / 100;
  return { technicianPercent:percent, bossPercent:Math.round((100-percent)*100)/100, technicianShare, bossShare };
};
const tokenHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const b64url = (value) => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const corsHeaders = (request) => {
  const origin = request.headers.get('origin') || '';
  const allowed = SITE_ORIGINS.has(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
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

const pointView = (row) => {
  const activeTechnicianCount = Number(row.active_technician_count || 0);
  const manualServiceEnabled = row.service_enabled === true;
  const manualAcceptsExternalRepairs = row.accepts_external_repairs === true;
  const externalRepairsPaused = row.external_repairs_paused === true;
  const autoServiceEnabled = activeTechnicianCount > 0;
  const serviceEnabled = row.effective_service_enabled == null
    ? (manualServiceEnabled || autoServiceEnabled)
    : row.effective_service_enabled === true;
  const acceptsExternalRepairs = row.effective_accepts_external_repairs == null
    ? (!externalRepairsPaused && (autoServiceEnabled || (manualServiceEnabled && manualAcceptsExternalRepairs)))
    : row.effective_accepts_external_repairs === true;
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    active: row.active !== false,
    serviceEnabled,
    acceptsExternalRepairs,
    manualServiceEnabled,
    manualAcceptsExternalRepairs,
    externalRepairsPaused,
    activeTechnicianCount,
    autoServiceEnabled,
    serviceNote: row.service_note || null
  };
};

const customerView = (row) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email || null,
  phone: row.phone || null
});

const loadRequestedPoint = async (userId) => {
  const { rows } = await q(
    "SELECT point_name, city, requested_role_code, technician_split_percent, requested_at FROM access_requests WHERE user_id=$1 AND status='PENDING' ORDER BY requested_at DESC LIMIT 1",
    [userId]
  );
  if (!rows[0]) return null;
  return {
    pointName: rows[0].point_name,
    city: rows[0].city,
    requestedRole: rows[0].requested_role_code,
    technicianSplitPercent: rows[0].technician_split_percent == null ? null : Number(rows[0].technician_split_percent),
    requestedAt: rows[0].requested_at
  };
};

const loadUser = async (userId) => {
  const { rows } = await q(
    'SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,support_enabled,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users WHERE id=$1 LIMIT 1',
    [userId]
  );
  return rows[0] || null;
};

const loadPointsForUser = async (user) => {
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q("SELECT p.id,p.name,p.city,p.active,p.service_enabled,p.accepts_external_repairs,p.external_repairs_paused,p.service_note,coalesce(t.active_technician_count,0)::int AS active_technician_count,(p.service_enabled OR coalesce(t.active_technician_count,0)>0) AS effective_service_enabled,(NOT p.external_repairs_paused AND (coalesce(t.active_technician_count,0)>0 OR (p.service_enabled AND p.accepts_external_repairs))) AS effective_accepts_external_repairs FROM points p LEFT JOIN LATERAL (SELECT count(*)::int AS active_technician_count FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=p.id AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL) t ON true WHERE p.active=true ORDER BY p.name");
    return rows.map(pointView);
  }
  const { rows } = await q(
    "SELECT p.id,p.name,p.city,p.active,p.service_enabled,p.accepts_external_repairs,p.external_repairs_paused,p.service_note,coalesce(t.active_technician_count,0)::int AS active_technician_count,(p.service_enabled OR coalesce(t.active_technician_count,0)>0) AS effective_service_enabled,(NOT p.external_repairs_paused AND (coalesce(t.active_technician_count,0)>0 OR (p.service_enabled AND p.accepts_external_repairs))) AS effective_accepts_external_repairs FROM points p JOIN user_point_access a0 ON a0.point_id=p.id LEFT JOIN LATERAL (SELECT count(*)::int AS active_technician_count FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=p.id AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL) t ON true WHERE a0.user_id=$1 AND p.active=true ORDER BY p.name",
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
  technicianSplitPercent: user.technician_split_percent == null ? null : Number(user.technician_split_percent),
  supportEnabled: user.support_enabled === true || user.role_code === 'SUPPORT',
  status: user.status,
  blocked: Boolean(user.blocked_at),
  blockedAt: user.blocked_at || null,
  blockedReason: user.blocked_reason || null,
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
  const webSession = clientType === 'WEB';
  const ttl = webSession ? WEB_SESSION_TTL_MS : SESSION_TTL_MS;
  const absoluteTtl = webSession ? WEB_SESSION_ABSOLUTE_TTL_MS : SESSION_ABSOLUTE_TTL_MS;
  await q(
    'INSERT INTO auth_sessions(id,user_id,token_hash,client_type,created_at,last_seen_at,expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,now(),now(),$5,$6)',
    [makeId('ses'), userId, tokenHash(token), clientType, new Date(now + ttl), new Date(now + absoluteTtl)]
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
    "SELECT s.id AS session_id,s.user_id,s.client_type,s.created_at AS session_created_at,u.id,u.google_sub,u.email,u.name,u.picture_url,u.role_code,u.technician_split_percent,u.support_enabled,u.status,u.blocked_at,u.blocked_reason,u.first_login_at,u.last_login_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() AND u.blocked_at IS NULL LIMIT 1",
    [hash]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.client_type === 'WEB') {
    await q(
      "UPDATE auth_sessions SET last_seen_at=now(),expires_at=LEAST(absolute_expires_at,now()+interval '90 days') WHERE id=$1",
      [row.session_id]
    );
  } else {
    await q('UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1', [row.session_id]);
  }
  return {
    sessionId: row.session_id,
    clientType: row.client_type,
    createdAt: row.session_created_at,
    user: {
      id: row.id,
      google_sub: row.google_sub,
      email: row.email,
      name: row.name,
      picture_url: row.picture_url,
      role_code: row.role_code,
      technician_split_percent: row.technician_split_percent,
      support_enabled: row.support_enabled === true,
      status: row.status,
      blocked_at: row.blocked_at,
      blocked_reason: row.blocked_reason,
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

const hasSupportAccess = (user) =>
  user?.role_code === 'OWNER' || user?.role_code === 'SUPPORT' || user?.support_enabled === true;

const requireSupportAccess = (user) => {
  if (!hasSupportAccess(user)) throw Object.assign(new Error('Brak uprawnienia Wsparcie LockOn.'), { status: 403, code: 'SUPPORT_FORBIDDEN' });
};

const audit = async (actor, action, entityType, entityId = null, pointId = null, metadata = {}) => {
  const actorUserId = typeof actor === 'string' ? actor : actor?.user?.id || actor?.id || null;
  const actorRole = typeof actor === 'object' ? actor?.user?.role_code || actor?.role_code || null : null;
  const clientType = typeof actor === 'object' ? actor?.clientType || null : null;
  const enrichedMetadata = {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    ...(actorRole ? { actorRole } : {}),
    ...(clientType ? { clientType } : {})
  };
  await q(
    'INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,point_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [makeId('aud'), actorUserId, action, entityType, entityId, pointId, JSON.stringify(enrichedMetadata)]
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

const validateDesktopRedirectUri = (value, expectedPath) => {
  let parsed;
  try { parsed = new URL(String(value || '')); }
  catch { throw Object.assign(new Error('Nieprawidłowy adres callbacku OAuth.'), { status: 400, code: 'OAUTH_REDIRECT' }); }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !parsed.port ||
    parsed.pathname !== expectedPath ||
    parsed.search ||
    parsed.hash
  ) {
    throw Object.assign(new Error('Odrzucono nieprawidłowy callback OAuth.'), { status: 400, code: 'OAUTH_REDIRECT' });
  }
  return parsed.origin + parsed.pathname;
};

const exchangeDesktopAuthorizationCode = async (body, expectedPath) => {
  if (!GOOGLE_DESKTOP_CLIENT_ID || !GOOGLE_DESKTOP_CLIENT_SECRET) {
    throw Object.assign(new Error('Serwerowa wymiana Google OAuth nie jest jeszcze skonfigurowana.'), { status: 503, code: 'SERVER_OAUTH_NOT_CONFIGURED' });
  }
  const code = cleanText(body.code, 4096);
  const codeVerifier = cleanText(body.codeVerifier, 256);
  const redirectUri = validateDesktopRedirectUri(body.redirectUri, expectedPath);
  if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    throw Object.assign(new Error('Nieprawidłowe dane PKCE.'), { status: 400, code: 'OAUTH_PKCE' });
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'error',
    body: new URLSearchParams({
      client_id: GOOGLE_DESKTOP_CLIENT_ID,
      client_secret: GOOGLE_DESKTOP_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = cleanText(payload?.error_description || payload?.error || 'Google odrzucił wymianę kodu OAuth.', 300);
    throw Object.assign(new Error(message), { status: 400, code: 'GOOGLE_CODE_EXCHANGE_FAILED' });
  }
  return payload;
};

const loginProfile = async (profile, clientType, allowCreate) => {
  let result = await q(
    'SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,support_enabled,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users WHERE google_sub=$1 OR lower(email)=lower($2) ORDER BY CASE WHEN google_sub=$1 THEN 0 ELSE 1 END LIMIT 1',
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

  if (user.blocked_at) {
    throw Object.assign(new Error(user.blocked_reason ? 'Konto zostało zablokowane: ' + cleanText(user.blocked_reason, 180) : 'Konto zostało zablokowane przez właściciela.'), { status: 403, code: 'ACCOUNT_BLOCKED' });
  }

  if (clientType === 'WEB' && user.status !== 'ACTIVE') {
    throw Object.assign(new Error('Konto nie jest aktywne.'), { status: 403, code: 'ACCOUNT_NOT_ACTIVE' });
  }

  const token = await createSession(user.id, clientType);
  await audit({ user, clientType }, 'LOGIN_' + clientType, 'user', user.id, null, {});
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
  homePointId: row.home_point_id || row.point_id,
  homePointName: row.point_name,
  currentPointId: row.current_point_id || null,
  customerId: row.customer_id,
  customerName: row.first_name + ' ' + row.last_name,
  customerEmail: row.email || null,
  customerPhone: row.phone || null,
  deviceId: row.device_id,
  brand: row.brand,
  model: row.model,
  imei: row.imei || null,
  serialNumber: row.serial_number || null,
  deviceNotes: row.device_notes || null,
  orderType: row.order_type,
  handlingMode: row.handling_mode || 'STANDARD',
  issueDescription: row.issue_description,
  status: row.status,
  statusLabel: STATUS_LABELS[row.status] || row.status,
  assignedTechnicianId: row.assigned_technician_id || null,
  assignedTechnicianName: row.technician_name || null,
  assignedTechnicianEmail: row.technician_email || null,
  estimatedCost: row.estimated_cost == null ? null : Number(row.estimated_cost),
  finalCost: row.final_cost == null ? null : Number(row.final_cost),
  currency: row.currency || 'PLN',
  estimatedCompletionAt: row.estimated_completion_at || null,
  receivedAt: row.received_at,
  completedAt: row.completed_at || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at || row.created_at
});

const orderViewForUser = (row, user) => {
  const view = orderView(row);
  if (!SERVICE_EDIT_ROLES.has(user.role_code)) {
    view.estimatedCost = null;
    view.finalCost = null;
  }
  return view;
};

const transferView = (row) => ({
  id: row.id,
  orderId: row.service_order_id,
  fromPointId: row.from_point_id,
  fromPointName: row.from_point_name,
  fromPointCity: row.from_point_city,
  toPointId: row.to_point_id,
  toPointName: row.to_point_name,
  toPointCity: row.to_point_city,
  kind: row.kind || 'OUTBOUND_SERVICE',
  status: row.status,
  note: row.note || null,
  sentByUserId: row.sent_by_user_id,
  sentByName: row.sent_by_name || row.sent_by_email || 'Użytkownik',
  acceptedByUserId: row.accepted_by_user_id || null,
  acceptedByName: row.accepted_by_name || row.accepted_by_email || null,
  requestedAt: row.requested_at,
  shippedAt: row.shipped_at || null,
  deliveredAt: row.delivered_at || null,
  acceptedAt: row.accepted_at || null,
  updatedAt: row.updated_at
});

const WORKFLOW_STAGE_TOTAL = 10;
const CLOSED_ORDER_STATUSES = new Set(['COMPLETED','CANCELLED','REJECTED']);

const deriveOrderWorkflow = (order, transfers, openTransfer, currentPointId, homePointId, returnRequired, canMarkReady) => {
  const status = String(order.status || 'RECEIVED').toUpperCase();
  const now = Date.now();
  const dueAtMs = order.estimatedCompletionAt ? new Date(order.estimatedCompletionAt).getTime() : NaN;
  const dueInMinutes = Number.isFinite(dueAtMs) ? Math.round((dueAtMs - now) / 60000) : null;
  const flags = [];
  let stageNumber = 1;
  let stageLabel = order.statusLabel || status;
  let nextActionCode = 'REVIEW_ORDER';
  let nextAction = 'Sprawdź zlecenie i wybierz kolejny etap.';
  let attentionCode = 'ACTIVE';
  let attentionLabel = 'W toku';
  let sortRank = 70;

  if (CLOSED_ORDER_STATUSES.has(status)) {
    stageNumber = 10;
    stageLabel = status === 'COMPLETED' ? 'Zakończone' : (order.statusLabel || status);
    nextActionCode = 'NONE';
    nextAction = 'Brak dalszych działań.';
    attentionCode = 'CLOSED';
    attentionLabel = 'Zamknięte';
    sortRank = 100;
    flags.push('CLOSED');
  } else if (openTransfer) {
    const returning = openTransfer.kind === 'RETURN_HOME';
    if (returning) {
      stageNumber = openTransfer.status === 'DELIVERED' ? 8 : 7;
      stageLabel = openTransfer.status === 'DELIVERED' ? 'Dostarczone do punktu macierzystego' : 'Zwrot do punktu macierzystego';
      if (openTransfer.status === 'DELIVERED') {
        nextActionCode = 'ACCEPT_RETURN_HOME';
        nextAction = 'Przyjmij urządzenie w punkcie macierzystym.';
        attentionCode = 'ACTION_NOW';
        attentionLabel = 'Wymaga działania teraz';
        sortRank = 10;
        flags.push('ACTION_NOW','RETURN_HOME');
      } else {
        nextActionCode = 'TRACK_RETURN_HOME';
        nextAction = 'Doprowadź zwrot do punktu macierzystego i potwierdź dostarczenie.';
        attentionCode = 'IN_TRANSIT';
        attentionLabel = 'W drodze';
        sortRank = 40;
        flags.push('IN_TRANSIT','RETURN_HOME');
      }
    } else {
      stageNumber = 4;
      stageLabel = openTransfer.status === 'DELIVERED' ? 'Czeka na przyjęcie przekazania' : 'Urządzenie w przekazaniu';
      if (openTransfer.status === 'DELIVERED') {
        nextActionCode = 'ACCEPT_EXTERNAL_SERVICE';
        nextAction = 'Potwierdź fizyczne przyjęcie urządzenia w punkcie docelowym.';
        attentionCode = 'ACTION_NOW';
        attentionLabel = 'Wymaga działania teraz';
        sortRank = 10;
        flags.push('ACTION_NOW','WAITING_SERVICE');
      } else {
        nextActionCode = 'TRACK_EXTERNAL_SERVICE';
        nextAction = 'Doprowadź przekazanie do punktu docelowego.';
        attentionCode = 'IN_TRANSIT';
        attentionLabel = 'W drodze';
        sortRank = 40;
        flags.push('IN_TRANSIT','WAITING_SERVICE');
      }
    }
  } else if (order.handlingMode === 'TRANSFER_ONLY') {
    stageNumber = 1;
    stageLabel = 'Tylko przekazanie';
    nextActionCode = 'FORWARD_DEVICE';
    nextAction = 'Wybierz kolejny punkt i przekaż urządzenie. Status serwisowy pozostaje bez zmian.';
    attentionCode = 'ACTION_NOW';
    attentionLabel = 'Czeka na przekazanie';
    sortRank = 12;
    flags.push('ACTION_NOW','TRANSFER_ONLY');
  } else if (status === 'READY') {
    stageNumber = 9;
    stageLabel = 'Gotowe do odbioru';
    nextActionCode = 'HANDOVER_CUSTOMER';
    nextAction = 'Wydaj urządzenie klientowi i zakończ zlecenie.';
    attentionCode = 'READY_FOR_PICKUP';
    attentionLabel = 'Gotowe do odbioru';
    sortRank = 30;
    flags.push('READY_FOR_PICKUP','ACTION_NOW');
  } else if (status === 'REPAIR_DONE') {
    stageNumber = 6;
    stageLabel = 'Naprawa zakończona';
    if (returnRequired || (currentPointId && currentPointId !== homePointId)) {
      nextActionCode = 'RETURN_HOME';
      nextAction = 'Odeślij urządzenie do punktu macierzystego.';
      flags.push('ACTION_NOW','WAITING_SERVICE','RETURN_HOME');
    } else {
      nextActionCode = 'MARK_READY';
      nextAction = 'Oznacz urządzenie jako gotowe do odbioru.';
      flags.push('ACTION_NOW');
    }
    attentionCode = 'ACTION_NOW';
    attentionLabel = 'Wymaga działania teraz';
    sortRank = 10;
  } else if (status === 'IN_REPAIR') {
    stageNumber = 5;
    stageLabel = 'W naprawie';
    nextActionCode = 'COMPLETE_REPAIR';
    nextAction = 'Dokończ naprawę i ustaw „Naprawa zakończona”.';
    attentionCode = 'ACTIVE';
    attentionLabel = 'W naprawie';
    sortRank = 60;
    flags.push('ACTIVE_REPAIR');
  } else if (status === 'WAITING_PARTS') {
    stageNumber = 4;
    stageLabel = 'Oczekiwanie na części';
    nextActionCode = 'RESUME_REPAIR';
    nextAction = 'Sprawdź części i wznow naprawę, gdy będą dostępne.';
    attentionCode = 'WAITING_PARTS';
    attentionLabel = 'Czeka na części';
    sortRank = 55;
    flags.push('WAITING_PARTS');
  } else if (status === 'DIAGNOSIS') {
    stageNumber = 3;
    stageLabel = 'Diagnoza';
    nextActionCode = 'FINISH_DIAGNOSIS';
    nextAction = 'Zakończ diagnozę i rozpocznij naprawę albo ustaw oczekiwanie na części.';
    attentionCode = 'ACTION_NOW';
    attentionLabel = 'Wymaga działania teraz';
    sortRank = 10;
    flags.push('ACTION_NOW');
  } else {
    stageNumber = 1;
    stageLabel = 'Przyjęte';
    nextActionCode = 'START_DIAGNOSIS';
    nextAction = currentPointId && currentPointId !== homePointId
      ? 'Rozpocznij diagnozę w aktualnym serwisie.'
      : 'Rozpocznij diagnozę urządzenia.';
    attentionCode = currentPointId && currentPointId !== homePointId ? 'WAITING_SERVICE' : 'ACTION_NOW';
    attentionLabel = currentPointId && currentPointId !== homePointId ? 'Czeka na serwis' : 'Wymaga działania teraz';
    sortRank = currentPointId && currentPointId !== homePointId ? 50 : 10;
    flags.push(attentionCode);
  }

  if (!CLOSED_ORDER_STATUSES.has(status) && dueInMinutes != null) {
    if (dueInMinutes < 0) {
      flags.unshift('OVERDUE');
      attentionCode = 'OVERDUE';
      attentionLabel = 'Po terminie';
      sortRank = 0;
    } else if (dueInMinutes <= 24 * 60) {
      flags.unshift('DUE_SOON');
      attentionCode = 'DUE_SOON';
      attentionLabel = 'Kończy się termin';
      sortRank = Math.min(sortRank, 5);
    }
  }

  return {
    stageNumber,
    stageTotal: WORKFLOW_STAGE_TOTAL,
    stageLabel,
    nextActionCode,
    nextAction,
    attentionCode,
    attentionLabel,
    flags: [...new Set(flags)],
    dueAt: Number.isFinite(dueAtMs) ? new Date(dueAtMs).toISOString() : null,
    dueInMinutes,
    progressPercent: Math.round((stageNumber / WORKFLOW_STAGE_TOTAL) * 100),
    sortRank,
    canMarkReady
  };
};

const sortOrdersByWorkflow = (orders) => [...orders].sort((a,b) => {
  const rankA = Number(a.workflow?.sortRank ?? 80);
  const rankB = Number(b.workflow?.sortRank ?? 80);
  if (rankA !== rankB) return rankA - rankB;
  const dueA = a.workflow?.dueAt ? new Date(a.workflow.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const dueB = b.workflow?.dueAt ? new Date(b.workflow.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (dueA !== dueB) return dueA - dueB;
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
});

const loadTransfersForOrders = async (orderIds) => {
  if (!orderIds.length) return new Map();
  const { rows } = await q(
    "SELECT t.*,fp.name AS from_point_name,fp.city AS from_point_city,tp.name AS to_point_name,tp.city AS to_point_city,su.name AS sent_by_name,su.email AS sent_by_email,au.name AS accepted_by_name,au.email AS accepted_by_email FROM service_order_transfers t JOIN points fp ON fp.id=t.from_point_id JOIN points tp ON tp.id=t.to_point_id JOIN users su ON su.id=t.sent_by_user_id LEFT JOIN users au ON au.id=t.accepted_by_user_id WHERE t.service_order_id=ANY($1::text[]) ORDER BY t.requested_at DESC",
    [orderIds]
  );
  const map = new Map();
  for (const row of rows) {
    const item = transferView(row);
    const list = map.get(item.orderId) || [];
    list.push(item);
    map.set(item.orderId, list);
  }
  return map;
};

const attachTransfers = async (orders) => {
  const map = await loadTransfersForOrders(orders.map((order) => order.id));
  return orders.map((order) => {
    const transfers = map.get(order.id) || [];
    const latestTransfer = transfers[0] || null;
    const openTransfer = transfers.find((item) => ['REQUESTED','IN_TRANSIT','DELIVERED'].includes(item.status)) || null;
    const homePointId = order.homePointId || order.pointId;
    const currentPointId = order.currentPointId || (!openTransfer ? homePointId : null);
    const latestOutboundAccepted = transfers.find((item) =>
      item.kind === 'OUTBOUND_SERVICE' &&
      item.status === 'ACCEPTED' &&
      item.toPointId !== homePointId
    ) || null;
    const latestReturnAccepted = transfers.find((item) =>
      item.kind === 'RETURN_HOME' &&
      item.status === 'ACCEPTED'
    ) || null;
    const outboundAfterReturn = Boolean(
      latestOutboundAccepted &&
      (!latestReturnAccepted || new Date(latestOutboundAccepted.requestedAt).getTime() > new Date(latestReturnAccepted.requestedAt).getTime())
    );
    const currentPointName = currentPointId === homePointId
      ? order.homePointName
      : (
          transfers.find((item) => item.toPointId === currentPointId)?.toPointName ||
          transfers.find((item) => item.fromPointId === currentPointId)?.fromPointName ||
          null
        );
    const returnRequired = Boolean(
      (currentPointId && currentPointId !== homePointId) ||
      (openTransfer && openTransfer.kind === 'RETURN_HOME') ||
      outboundAfterReturn
    );
    const canMarkReady = !openTransfer && currentPointId === homePointId && !returnRequired;
    const currentLocationLabel = openTransfer?.status === 'IN_TRANSIT'
      ? 'W drodze: ' + (openTransfer.fromPointName || openTransfer.fromPointId) + ' → ' + (openTransfer.toPointName || openTransfer.toPointId)
      : (currentPointName || (currentPointId ? currentPointId : 'W drodze'));

    return {
      ...order,
      homePointId,
      homePointName: order.homePointName || order.pointName,
      currentPointId,
      currentPointName,
      currentLocationLabel,
      returnRequired,
      canMarkReady,
      openTransfer,
      latestTransfer,
      transfers,
      workflow: deriveOrderWorkflow(order, transfers, openTransfer, currentPointId, homePointId, returnRequired, canMarkReady)
    };
  });
};

const canSeeOrder = async (user, orderId) => {
  if (GLOBAL_ROLES.has(user.role_code)) return true;
  const { rowCount } = await q(
    "SELECT 1 FROM service_orders s WHERE s.id=$1 AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND a.point_id=s.point_id) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id)) LIMIT 1",
    [orderId, user.id]
  );
  return rowCount > 0;
};

const requireOrder = async (user, orderId) => {
  if (!(await canSeeOrder(user, orderId))) {
    throw Object.assign(new Error('Brak dostępu do tego zlecenia.'), { status: 403, code: 'ORDER_FORBIDDEN' });
  }
};

const getVisibleOrderByNumber = async (user, number) => {
  const params = [Number(number)];
  let access = '';
  if (!GLOBAL_ROLES.has(user.role_code)) {
    params.push(user.id);
    access = " AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND a.point_id=s.point_id) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id))";
  }
  const { rows } = await q(
    "SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id WHERE s.order_number=$1" + access + ' LIMIT 1',
    params
  );
  if (!rows[0]) return null;
  return (await attachTransfers([orderViewForUser(rows[0], user)]))[0];
};

const listVisibleOrders = async (user) => {
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q(
      "SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id ORDER BY s.updated_at DESC,s.created_at DESC LIMIT 150"
    );
    return sortOrdersByWorkflow(await attachTransfers(rows.map((row) => orderViewForUser(row, user))));
  }
  const { rows } = await q(
    "SELECT DISTINCT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id WHERE EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$1 AND a.point_id=s.point_id) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$1 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id) ORDER BY s.updated_at DESC,s.created_at DESC LIMIT 150",
    [user.id]
  );
  return sortOrdersByWorkflow(await attachTransfers(rows.map((row) => orderViewForUser(row, user))));
};

const listVisibleCustomerOrders = async (user, customerId) => {
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q(
      "SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id WHERE s.customer_id=$1 ORDER BY s.created_at DESC LIMIT 100",
      [customerId]
    );
    return attachTransfers(rows.map((row) => orderViewForUser(row, user)));
  }
  const { rows } = await q(
    "SELECT DISTINCT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id WHERE s.customer_id=$1 AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND a.point_id=s.point_id) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id)) ORDER BY s.created_at DESC LIMIT 100",
    [customerId, user.id]
  );
  return attachTransfers(rows.map((row) => orderViewForUser(row, user)));
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

const ensureTrackingToken = async (orderId) => {
  let row=(await q("SELECT tracking_token_hash,tracking_token_ciphertext FROM service_orders WHERE id=$1 LIMIT 1",[orderId])).rows[0];
  if(!row)throw Object.assign(new Error('Nie znaleziono zlecenia.'),{status:404});
  if(row.tracking_token_ciphertext){
    return decryptSecret(row.tracking_token_ciphertext);
  }
  for(let attempt=0;attempt<3;attempt+=1){
    const token=crypto.randomBytes(32).toString('base64url');
    const hash=tokenHash(token);
    const packed=encryptSecret(token);
    const updated=(await q(
      "UPDATE service_orders SET tracking_token_hash=$2,tracking_token_ciphertext=$3,tracking_created_at=COALESCE(tracking_created_at,now()),updated_at=now() WHERE id=$1 AND tracking_token_ciphertext IS NULL RETURNING tracking_token_ciphertext",
      [orderId,hash,packed]
    )).rows[0];
    if(updated?.tracking_token_ciphertext)return token;
    row=(await q("SELECT tracking_token_ciphertext FROM service_orders WHERE id=$1 LIMIT 1",[orderId])).rows[0];
    if(row?.tracking_token_ciphertext)return decryptSecret(row.tracking_token_ciphertext);
  }
  throw new Error('Nie udało się utworzyć bezpiecznego linku śledzenia.');
};

const trackingUrlForOrder = async (orderId) => {
  const token=await ensureTrackingToken(orderId);
  return PUBLIC_PORTAL_URL + '/track.html#t=' + encodeURIComponent(token);
};

const refreshGmailAccess = async (refreshToken, legacyClientSecret = '') => {
  const clientSecret = GOOGLE_DESKTOP_CLIENT_SECRET || legacyClientSecret;
  if (!clientSecret) {
    const error = new Error('Brak serwerowego credentialu Google OAuth.');
    error.code = 'GMAIL_OAUTH_CONFIG';
    throw error;
  }
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
  if (!response.ok || !data.access_token) {
    const oauthError = cleanText(data?.error || '', 80).toLowerCase();
    const description = cleanText(data?.error_description || '', 300);
    const error = new Error(
      oauthError === 'invalid_grant'
        ? 'Zgoda Google dla Gmail wygasła albo została cofnięta.'
        : (description || 'Google odrzucił odświeżenie dostępu Gmail.')
    );
    error.code = oauthError ? 'GOOGLE_OAUTH_' + oauthError.toUpperCase().replace(/[^A-Z0-9]+/g,'_') : 'GMAIL_REFRESH_FAILED';
    error.oauthError = oauthError || null;
    error.reauthRequired = oauthError === 'invalid_grant';
    error.httpStatus = response.status;
    throw error;
  }
  return data.access_token;
};

const isGmailReauthError = (error) => Boolean(error && typeof error === 'object' && error.reauthRequired === true);

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

const loadActiveMailSender = async (pointId) => {
  const { rows } = await q(
    "SELECT point_id AS sender_point_id,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,status,connected_at FROM point_email_senders WHERE status='ACTIVE' AND refresh_token_ciphertext IS NOT NULL ORDER BY CASE WHEN point_id=$1 THEN 0 ELSE 1 END,connected_at DESC NULLS LAST,updated_at DESC LIMIT 1",
    [pointId]
  );
  const sender = rows[0] || null;
  if (!sender) return null;
  if (!GOOGLE_DESKTOP_CLIENT_SECRET && !sender.oauth_client_secret_ciphertext) return null;
  return sender;
};

const recoverNoSenderNotifications = async (pointId) => {
  const { rows } = await q(
    "UPDATE notification_outbox n SET status='PENDING',attempts=0,last_error=NULL,available_at=now(),updated_at=now() FROM service_orders s WHERE n.service_order_id=s.id AND s.point_id=$1 AND n.status='FAILED' AND n.last_error='Brak aktywnego, kompletnego nadawcy Gmail dla punktu.' RETURNING n.id",
    [pointId]
  );
  let sent = 0;
  for (const row of rows) {
    const result = await processNotification(row.id);
    if (result?.sent) sent += 1;
  }
  return { recovered: rows.length, sent };
};

const mailSettingsForPoint = async (pointId) => {
  const row = (await q(
    "SELECT automatic_email_enabled,notify_statuses,sender_display_name,footer_text FROM point_notification_settings WHERE point_id=$1 LIMIT 1",
    [pointId]
  )).rows[0];
  return row || {
    automatic_email_enabled:true,
    notify_statuses:[...DEFAULT_NOTIFY_STATUSES],
    sender_display_name:'LockOn ServiceOS',
    footer_text:null
  };
};

const CUSTOMER_PORTAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const normalizeCustomerPortalCode = (value) => {
  let raw = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (raw.startsWith('LK')) raw = raw.slice(2);
  if (!/^[A-Z0-9]{16}$/.test(raw)) return '';
  return 'LK-' + raw.match(/.{4}/g).join('-');
};

const generateCustomerPortalCode = () => {
  let raw = '';
  for (let i = 0; i < 16; i += 1) raw += CUSTOMER_PORTAL_ALPHABET[crypto.randomInt(0, CUSTOMER_PORTAL_ALPHABET.length)];
  return 'LK-' + raw.match(/.{4}/g).join('-');
};

const ensureCustomerPortalCode = async (customerId) => {
  let row = (await q("SELECT portal_code_hash,portal_code_ciphertext FROM customers WHERE id=$1 LIMIT 1",[customerId])).rows[0];
  if (!row) throw Object.assign(new Error('Nie znaleziono klienta.'),{status:404});
  if (row.portal_code_ciphertext) return { code: decryptSecret(row.portal_code_ciphertext), created:false };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCustomerPortalCode();
    const hash = tokenHash(code);
    const packed = encryptSecret(code);
    try {
      const updated = (await q(
        "UPDATE customers SET portal_code_hash=$2,portal_code_ciphertext=$3,portal_code_created_at=COALESCE(portal_code_created_at,now()),updated_at=now() WHERE id=$1 AND portal_code_ciphertext IS NULL RETURNING portal_code_ciphertext",
        [customerId,hash,packed]
      )).rows[0];
      if (updated?.portal_code_ciphertext) return { code, created:true };
      row = (await q("SELECT portal_code_ciphertext FROM customers WHERE id=$1 LIMIT 1",[customerId])).rows[0];
      if (row?.portal_code_ciphertext) return { code: decryptSecret(row.portal_code_ciphertext), created:false };
    } catch (error) {
      if (String(error?.code || '') !== '23505') throw error;
    }
  }
  throw new Error('Nie udało się utworzyć identyfikatora klienta.');
};

const rotateCustomerPortalCode = async (customerId) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCustomerPortalCode();
    try {
      await q(
        "UPDATE customers SET portal_code_hash=$2,portal_code_ciphertext=$3,portal_code_created_at=now(),updated_at=now() WHERE id=$1",
        [customerId,tokenHash(code),encryptSecret(code)]
      );
      return { code, created:true, rotated:true };
    } catch (error) {
      if (String(error?.code || '') !== '23505') throw error;
    }
  }
  throw new Error('Nie udało się wygenerować nowego kodu klienta.');
};

const customerPortalAccount = async (customerId) => {
  return (await q(
    "SELECT customer_id,google_sub,google_email,google_name,google_picture_url,linked_at,last_login_at,blocked_at,blocked_reason,notify_service_updates,notify_ready_for_pickup,notify_quote_updates,notify_messages,created_at,updated_at FROM customer_portal_accounts WHERE customer_id=$1 LIMIT 1",
    [customerId]
  )).rows[0] || null;
};

const customerNotificationPreferences = async (customerId) => {
  const account = await customerPortalAccount(customerId);
  return {
    serviceUpdates: account?.notify_service_updates !== false,
    readyForPickup: account?.notify_ready_for_pickup !== false,
    quoteUpdates: account?.notify_quote_updates !== false,
    messages: account?.notify_messages !== false
  };
};

const createCustomerPortalSession = async (customerId, authMethod = 'CODE') => {
  const method = authMethod === 'GOOGLE' ? 'GOOGLE' : 'CODE';
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CUSTOMER_PORTAL_SESSION_TTL_MS);
  await q("DELETE FROM customer_portal_sessions WHERE expires_at<=now()");
  await q(
    "INSERT INTO customer_portal_sessions(id,customer_id,token_hash,auth_method,expires_at) VALUES($1,$2,$3,$4,$5)",
    [makeId('cps'),customerId,tokenHash(token),method,expiresAt]
  );
  return { token, authMethod:method, expiresAt: expiresAt.toISOString() };
};

const requireCustomerPortal = async (request) => {
  const auth = String(request.headers.get('authorization') || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Object.assign(new Error('Sesja klienta wygasła. Zaloguj się ponownie.'),{status:401});
  const row = (await q(
    "SELECT s.id AS session_id,s.customer_id,s.auth_method,s.expires_at,c.first_name,c.last_name,c.email,c.phone,a.google_sub,a.google_email,a.google_name,a.google_picture_url,a.blocked_at,a.blocked_reason FROM customer_portal_sessions s JOIN customers c ON c.id=s.customer_id LEFT JOIN customer_portal_accounts a ON a.customer_id=c.id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1",
    [tokenHash(token)]
  )).rows[0];
  if (!row) throw Object.assign(new Error('Sesja klienta wygasła. Zaloguj się ponownie.'),{status:401});
  if (row.blocked_at) throw Object.assign(new Error(row.blocked_reason ? 'Dostęp do portalu został zablokowany: '+cleanText(row.blocked_reason,180) : 'Dostęp do portalu został zablokowany.'),{status:403,code:'CUSTOMER_ACCOUNT_BLOCKED'});
  await q("UPDATE customer_portal_sessions SET last_seen_at=now() WHERE id=$1",[row.session_id]);
  return row;
};

const requireCustomerPortalFull = async (request) => {
  const session = await requireCustomerPortal(request);
  if (session.auth_method !== 'GOOGLE' || !session.google_sub) {
    throw Object.assign(new Error('Ta funkcja wymaga pełnego konta klienta. Połącz konto Google.'),{status:403,code:'CUSTOMER_FULL_ACCOUNT_REQUIRED'});
  }
  return session;
};

const revokeCustomerPortalSessions = async (customerId) => {
  const result = await q("DELETE FROM customer_portal_sessions WHERE customer_id=$1 RETURNING id",[customerId]);
  return result.rowCount || result.rows.length;
};

const routeCustomerQuote = async (requestedPointId) => {
  const local = (await q(
    "SELECT u.id,u.name FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=$1 AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL ORDER BY (SELECT count(*) FROM service_orders s WHERE s.assigned_technician_id=u.id)::int DESC,u.last_login_at DESC LIMIT 1",
    [requestedPointId]
  )).rows[0];
  if (local) return { routedPointId: requestedPointId, technicianId: local.id, routingReason: 'LOCAL_TECHNICIAN' };

  let destination = (await q(
    "SELECT t.to_point_id,count(*)::int AS transfer_count,max(t.requested_at) AS last_transfer FROM service_order_transfers t JOIN users su ON su.id=t.sent_by_user_id WHERE t.from_point_id=$1 AND t.kind='OUTBOUND_SERVICE' AND su.role_code='USER' AND EXISTS(SELECT 1 FROM user_point_access a JOIN users tu ON tu.id=a.user_id WHERE a.point_id=t.to_point_id AND tu.role_code='TECHNICIAN' AND tu.status='ACTIVE' AND tu.blocked_at IS NULL) GROUP BY t.to_point_id ORDER BY count(*) DESC,max(t.requested_at) DESC LIMIT 1",
    [requestedPointId]
  )).rows[0];
  if (!destination) {
    destination = (await q(
      "SELECT t.to_point_id,count(*)::int AS transfer_count,max(t.requested_at) AS last_transfer FROM service_order_transfers t WHERE t.from_point_id=$1 AND t.kind='OUTBOUND_SERVICE' AND EXISTS(SELECT 1 FROM user_point_access a JOIN users tu ON tu.id=a.user_id WHERE a.point_id=t.to_point_id AND tu.role_code='TECHNICIAN' AND tu.status='ACTIVE' AND tu.blocked_at IS NULL) GROUP BY t.to_point_id ORDER BY count(*) DESC,max(t.requested_at) DESC LIMIT 1",
      [requestedPointId]
    )).rows[0];
  }
  if (!destination) {
    const fallback = (await q(
      "SELECT a.point_id AS to_point_id,u.id AS technician_id FROM user_point_access a JOIN users u ON u.id=a.user_id JOIN points p ON p.id=a.point_id WHERE u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL AND p.active=true ORDER BY (SELECT count(*) FROM service_order_transfers t WHERE t.to_point_id=a.point_id AND t.kind='OUTBOUND_SERVICE') DESC,u.last_login_at DESC,p.name,u.id LIMIT 1"
    )).rows[0];
    if (fallback) {
      return { routedPointId: fallback.to_point_id, technicianId: fallback.technician_id, routingReason: 'ACTIVE_TECHNICIAN_FALLBACK' };
    }
    return { routedPointId: requestedPointId, technicianId: null, routingReason: 'POINT_QUEUE_NO_TECHNICIAN' };
  }

  const tech = (await q(
    "SELECT u.id,u.name FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=$1 AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL ORDER BY (SELECT count(*) FROM service_order_transfers t WHERE t.from_point_id=$2 AND t.to_point_id=$1 AND t.accepted_by_user_id=u.id)::int DESC,(SELECT count(*) FROM service_orders s WHERE s.assigned_technician_id=u.id)::int DESC,u.last_login_at DESC LIMIT 1",
    [destination.to_point_id,requestedPointId]
  )).rows[0];
  return { routedPointId: destination.to_point_id, technicianId: tech?.id || null, routingReason: 'MOST_USED_TRANSFER_DESTINATION' };
};

const loadCustomerPortalPayload = async (customerId, portalSession = null) => {
  const customer = (await q("SELECT id,first_name,last_name,email,phone,created_at FROM customers WHERE id=$1 LIMIT 1",[customerId])).rows[0];
  if (!customer) throw Object.assign(new Error('Nie znaleziono klienta.'),{status:404});
  const [portalIdentity, account] = await Promise.all([
    ensureCustomerPortalCode(customerId),
    customerPortalAccount(customerId)
  ]);
  const authMethod = portalSession?.auth_method === 'GOOGLE' ? 'GOOGLE' : 'CODE';
  const fullAccess = authMethod === 'GOOGLE' && Boolean(account?.google_sub);
  const [ordersResult,quotesResult,pointsResult] = await Promise.all([
    q(
      "SELECT s.id,s.order_number,s.order_type,s.handling_mode,s.issue_description,s.status,s.estimated_completion_at,s.estimated_cost,s.final_cost,s.currency,s.received_at,s.completed_at,s.created_at,s.updated_at,d.brand,d.model,d.imei,d.serial_number,p.id AS point_id,p.name AS point_name,hp.id AS home_point_id,hp.name AS home_point_name,cp.id AS current_point_id,cp.name AS current_point_name FROM service_orders s JOIN devices d ON d.id=s.device_id JOIN points p ON p.id=s.point_id LEFT JOIN points hp ON hp.id=COALESCE(s.home_point_id,s.point_id) LEFT JOIN points cp ON cp.id=s.current_point_id WHERE s.customer_id=$1 ORDER BY s.received_at DESC,s.order_number DESC",
      [customerId]
    ),
    q(
      "SELECT r.*,rp.name AS requested_point_name,rrp.name AS routed_point_name,u.name AS technician_name FROM customer_quote_requests r JOIN points rp ON rp.id=r.requested_point_id JOIN points rrp ON rrp.id=r.routed_point_id LEFT JOIN users u ON u.id=r.assigned_technician_id WHERE r.customer_id=$1 ORDER BY r.updated_at DESC",
      [customerId]
    ),
    q("SELECT id,name,city FROM points WHERE active=true ORDER BY city,name")
  ]);

  const quoteIds = quotesResult.rows.map((row)=>row.id);
  let messageRows = [];
  if (quoteIds.length) {
    messageRows = (await q(
      "SELECT m.id,m.request_id,m.sender_kind,m.body,m.created_at,u.name AS sender_name FROM customer_quote_messages m LEFT JOIN users u ON u.id=m.sender_user_id WHERE m.request_id=ANY($1::text[]) ORDER BY m.created_at ASC",
      [quoteIds]
    )).rows;
  }
  const messagesByRequest = new Map();
  for (const row of messageRows) {
    const list = messagesByRequest.get(row.request_id) || [];
    list.push({id:row.id,senderKind:row.sender_kind,senderName:row.sender_name||null,body:row.body,createdAt:row.created_at});
    messagesByRequest.set(row.request_id,list);
  }

  return {
    customerPortalCode:portalIdentity?.code || null,
    customerPortalUrl:PUBLIC_PORTAL_URL + '/klient.html',
    access:{
      mode:fullAccess?'FULL':'VIEW_ONLY',
      authMethod,
      canWrite:fullAccess,
      googleLinked:Boolean(account?.google_sub)
    },
    account:{
      googleLinked:Boolean(account?.google_sub),
      googleEmail:account?.google_email||null,
      googleName:account?.google_name||null,
      googlePicture:account?.google_picture_url||null,
      notificationPreferences:{
        serviceUpdates:account?.notify_service_updates !== false,
        readyForPickup:account?.notify_ready_for_pickup !== false,
        quoteUpdates:account?.notify_quote_updates !== false,
        messages:account?.notify_messages !== false
      }
    },
    customer:{id:customer.id,firstName:customer.first_name,lastName:customer.last_name,email:customer.email||null,phone:customer.phone||null,customerSince:customer.created_at},
    orders:ordersResult.rows.map((row)=>({
      id:row.id,orderNumber:Number(row.order_number),orderType:row.order_type,handlingMode:row.handling_mode||'STANDARD',
      issueDescription:row.issue_description,status:row.status,statusLabel:STATUS_LABELS[row.status]||row.status,
      device:{brand:row.brand,model:row.model,imei:row.imei?('••••••••••'+String(row.imei).slice(-4)):null,serialNumber:row.serial_number?('••••'+String(row.serial_number).slice(-4)):null},
      pointId:row.point_id,pointName:row.point_name,homePointId:row.home_point_id||row.point_id,homePointName:row.home_point_name||row.point_name,
      currentPointId:row.current_point_id||null,currentPointName:row.current_point_name||null,
      estimatedCompletionAt:row.estimated_completion_at||null,estimatedCost:row.estimated_cost==null?null:Number(row.estimated_cost),
      finalCost:row.final_cost==null?null:Number(row.final_cost),currency:row.currency||'PLN',
      receivedAt:row.received_at,completedAt:row.completed_at||null,createdAt:row.created_at,updatedAt:row.updated_at
    })),
    points:pointsResult.rows.map((row)=>({id:row.id,name:row.name,city:row.city})),
    quoteRequests:quotesResult.rows.map((row)=>({
      id:row.id,requestedPointId:row.requested_point_id,requestedPointName:row.requested_point_name,
      routedPointId:row.routed_point_id,routedPointName:row.routed_point_name,assignedTechnicianName:row.technician_name||null,
      serviceOrderId:row.service_order_id||null,deviceDescription:row.device_description,issueDescription:row.issue_description,
      status:row.status,quoteAmount:row.quote_amount==null?null:Number(row.quote_amount),currency:row.currency||'PLN',
      quoteNote:row.quote_note||null,routingReason:row.routing_reason,createdAt:row.created_at,updatedAt:row.updated_at,
      quotedAt:row.quoted_at||null,closedAt:row.closed_at||null,messages:messagesByRequest.get(row.id)||[]
    }))
  };
};

const requireCustomerAccountAccess = async (user, customerId) => {
  requireSupportAccess(user);
  const customer=(await q(
    "SELECT id,first_name,last_name,email,phone,portal_code_created_at FROM customers WHERE id=$1 LIMIT 1",
    [customerId]
  )).rows[0];
  if (!customer) throw Object.assign(new Error('Nie znaleziono klienta.'),{status:404,code:'CUSTOMER_NOT_FOUND'});
  if (GLOBAL_ROLES.has(user.role_code)) return customer;
  const ids=await visiblePointIds(user);
  if (!ids.length) throw Object.assign(new Error('Brak dostępu do tego klienta.'),{status:403,code:'CUSTOMER_FORBIDDEN'});
  const visible=(await q(
    "SELECT 1 WHERE EXISTS(SELECT 1 FROM service_orders s WHERE s.customer_id=$1 AND COALESCE(s.current_point_id,s.home_point_id,s.point_id)=ANY($2::text[])) OR EXISTS(SELECT 1 FROM customer_quote_requests r WHERE r.customer_id=$1 AND (r.requested_point_id=ANY($2::text[]) OR r.routed_point_id=ANY($2::text[]))) LIMIT 1",
    [customerId,ids]
  )).rows[0];
  if (!visible) throw Object.assign(new Error('Brak dostępu do tego klienta.'),{status:403,code:'CUSTOMER_FORBIDDEN'});
  return customer;
};

const customerAccountManagementOverview = async (user, search = '') => {
  requireSupportAccess(user);
  const ids=GLOBAL_ROLES.has(user.role_code) ? [] : await visiblePointIds(user);
  const params=[GLOBAL_ROLES.has(user.role_code),ids];
  let filter=" WHERE ($1::boolean OR EXISTS(SELECT 1 FROM service_orders s0 WHERE s0.customer_id=c.id AND COALESCE(s0.current_point_id,s0.home_point_id,s0.point_id)=ANY($2::text[])) OR EXISTS(SELECT 1 FROM customer_quote_requests r0 WHERE r0.customer_id=c.id AND (r0.requested_point_id=ANY($2::text[]) OR r0.routed_point_id=ANY($2::text[]))))";
  const term=cleanText(search,120);
  if (term) {
    params.push('%'+term+'%');
    filter += " AND (lower(c.first_name||' '||c.last_name) LIKE lower($3) OR lower(coalesce(c.email,'')) LIKE lower($3) OR lower(coalesce(c.phone,'')) LIKE lower($3))";
  }
  const rows=(await q(
    "SELECT c.id,c.first_name,c.last_name,c.email,c.phone,c.portal_code_created_at,"+
    "a.google_sub,a.google_email,a.google_name,a.google_picture_url,a.linked_at,a.last_login_at,a.blocked_at,a.blocked_reason,"+
    "a.notify_service_updates,a.notify_ready_for_pickup,a.notify_quote_updates,a.notify_messages,"+
    "(SELECT count(*)::int FROM customer_portal_sessions ps WHERE ps.customer_id=c.id AND ps.expires_at>now()) AS active_sessions,"+
    "(SELECT max(ps.last_seen_at) FROM customer_portal_sessions ps WHERE ps.customer_id=c.id AND ps.expires_at>now()) AS last_seen_at,"+
    "(SELECT count(*)::int FROM service_orders s WHERE s.customer_id=c.id) AS order_count,"+
    "(SELECT count(*)::int FROM customer_quote_requests r WHERE r.customer_id=c.id AND r.status IN ('OPEN','QUOTED')) AS open_quote_count "+
    "FROM customers c LEFT JOIN customer_portal_accounts a ON a.customer_id=c.id"+filter+
    " ORDER BY COALESCE(a.last_login_at,c.updated_at) DESC,c.last_name,c.first_name LIMIT 250",
    params
  )).rows;
  const customers=rows.map(row=>({
    id:row.id,
    name:[row.first_name,row.last_name].filter(Boolean).join(' '),
    email:row.email||null,
    phone:row.phone||null,
    codeCreatedAt:row.portal_code_created_at||null,
    googleLinked:Boolean(row.google_sub),
    googleEmail:row.google_email||null,
    googleName:row.google_name||null,
    googlePicture:row.google_picture_url||null,
    linkedAt:row.linked_at||null,
    lastLoginAt:row.last_login_at||null,
    blocked:Boolean(row.blocked_at),
    blockedAt:row.blocked_at||null,
    blockedReason:row.blocked_reason||null,
    activeSessions:Number(row.active_sessions||0),
    lastSeenAt:row.last_seen_at||null,
    orders:Number(row.order_count||0),
    openQuotes:Number(row.open_quote_count||0),
    notificationPreferences:{
      serviceUpdates:row.notify_service_updates!==false,
      readyForPickup:row.notify_ready_for_pickup!==false,
      quoteUpdates:row.notify_quote_updates!==false,
      messages:row.notify_messages!==false
    }
  }));
  return {
    stats:{
      customers:customers.length,
      googleAccounts:customers.filter(item=>item.googleLinked).length,
      activeSessions:customers.reduce((sum,item)=>sum+item.activeSessions,0),
      blocked:customers.filter(item=>item.blocked).length
    },
    customers
  };
};

const staffQuoteVisible = async (user, requestId) => {
  const row = (await q(
    "SELECT r.* FROM customer_quote_requests r WHERE r.id=$1 AND ($2::boolean OR r.assigned_technician_id=$3 OR EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$3 AND a.point_id IN (r.requested_point_id,r.routed_point_id))) LIMIT 1",
    [requestId,GLOBAL_ROLES.has(user.role_code),user.id]
  )).rows[0];
  return row || null;
};

const renderStatusEmail = (item) => {
  const displayName = cleanText(item.sender_display_name || 'LockOn ServiceOS', 80).replace(/[\r\n]+/g, ' ');
  const transferStatus = String(item.payload?.transferStatus || '').toUpperCase();
  const transferKind = String(item.payload?.transferKind || 'OUTBOUND_SERVICE').toUpperCase();
  const returnHome = transferKind === 'RETURN_HOME';
  const transferLabels = returnHome ? {
    IN_TRANSIT: 'Urządzenie wraca do punktu macierzystego',
    DELIVERED: 'Urządzenie wróciło do punktu macierzystego',
    ACCEPTED: 'Punkt macierzysty przyjął urządzenie',
    REJECTED: 'Punkt macierzysty odrzucił przekazanie',
    CANCELLED: 'Powrót do punktu macierzystego anulowany'
  } : {
    IN_TRANSIT: 'Urządzenie wysłane do serwisu',
    DELIVERED: 'Urządzenie dotarło do serwisu',
    ACCEPTED: 'Serwisant przyjął urządzenie',
    REJECTED: 'Serwis odrzucił przekazanie',
    CANCELLED: 'Przekazanie anulowane'
  };

  const isTransfer = Boolean(transferLabels[transferStatus]);
  const targetStatus = String(item.payload?.to || item.status || 'RECEIVED').toUpperCase();
  const label = isTransfer ? transferLabels[transferStatus] : (STATUS_LABELS[targetStatus] || targetStatus);
  const fromPoint = cleanText(item.payload?.fromPointName || item.point_name || '', 100);
  const toPoint = cleanText(item.payload?.toPointName || '', 100);
  const transferNote = cleanText(item.payload?.note || '', 300);
  const contactPoint = cleanText(
    isTransfer
      ? (
          transferStatus === 'CANCELLED'
            ? (fromPoint || item.current_point_name || item.point_name || '')
            : (toPoint || item.current_point_name || item.point_name || '')
        )
      : (item.current_point_name || item.point_name || ''),
    100
  );
  const defaultContactText = contactPoint
    ? (
        isTransfer && transferStatus === 'IN_TRANSIT'
          ? 'W razie pytań skontaktuj się z punktem, do którego przekazywane jest urządzenie: ' + contactPoint + '.'
          : 'W razie pytań skontaktuj się z punktem, w którym znajduje się urządzenie: ' + contactPoint + '.'
      )
    : 'W razie pytań skontaktuj się z punktem prowadzącym zlecenie.';
  const customFooter = cleanText(item.footer_text || '', 500);
  const footer = cleanText(defaultContactText + (customFooter ? ' ' + customFooter : ''), 500);

  const subject = 'LockOn ServiceOS · zlecenie #' + item.order_number + ' · ' + label;
  const intro = isTransfer
    ? (
        returnHome
          ? (
              transferStatus === 'IN_TRANSIT'
                ? 'Naprawa została zakończona i Twoje urządzenie wraca z ' + fromPoint + ' do punktu macierzystego ' + toPoint + '.'
                : transferStatus === 'DELIVERED'
                  ? 'Twoje urządzenie dotarło z powrotem do punktu macierzystego ' + toPoint + '.'
                  : transferStatus === 'ACCEPTED'
                    ? 'Punkt macierzysty ' + toPoint + ' potwierdził fizyczny powrót urządzenia.'
                    : transferStatus === 'REJECTED'
                      ? 'Punkt macierzysty ' + toPoint + ' odrzucił przekazanie zwrotne urządzenia.'
                      : 'Powrót urządzenia do punktu macierzystego został anulowany.'
            )
          : (
              transferStatus === 'IN_TRANSIT'
                ? 'Twoje urządzenie zostało przekazane z punktu ' + fromPoint + ' do serwisu ' + toPoint + '.'
                : transferStatus === 'DELIVERED'
                  ? 'Twoje urządzenie zostało dostarczone do serwisu ' + toPoint + '.'
                  : transferStatus === 'ACCEPTED'
                    ? 'Serwisant w ' + toPoint + ' przyjął urządzenie do realizacji.'
                    : transferStatus === 'REJECTED'
                      ? 'Serwis ' + toPoint + ' odrzucił przekazanie urządzenia. Punkt prowadzący zlecenie skontaktuje się w razie potrzeby.'
                      : 'Przekazanie urządzenia do serwisu zostało anulowane.'
            )
      )
    : targetStatus === 'READY'
      ? 'Twoje urządzenie ' + item.brand + ' ' + item.model + ' jest gotowe do odbioru w punkcie ' + item.point_name + '.'
      : 'status urządzenia ' + item.brand + ' ' + item.model + ' (zlecenie #' + item.order_number + ') zmienił się na:';

  const text = [
    'Dzień dobry ' + item.first_name + ',',
    '',
    intro,
    isTransfer ? '' : label,
    transferNote ? 'Informacja: ' + transferNote : '',
    '',
    'Urządzenie: ' + item.brand + ' ' + item.model,
    'Punkt prowadzący: ' + item.point_name,
    contactPoint ? 'Kontakt / lokalizacja operacyjna: ' + contactPoint : '',
    item.tracking_url ? 'Śledź zlecenie: ' + item.tracking_url : '',
    item.customer_portal_code ? 'Twój stały identyfikator klienta: ' + item.customer_portal_code : '',
    item.customer_portal_url ? 'Historia wszystkich serwisów i zapytania o wycenę: ' + item.customer_portal_url : '',
    '',
    footer,
    '',
    'To automatyczna wiadomość z ' + displayName + '.'
  ].filter((line,index,array)=>line!=='' || (index>0 && array[index-1]!=='' )).join('\n');

  const html = '<!doctype html><html lang="pl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head><body style="margin:0;background:#0b0d10;color:#f3f5f7;font-family:Arial,sans-serif;word-break:break-word">' +
    '<div style="width:100%;max-width:600px;box-sizing:border-box;margin:0 auto;padding:18px 10px 28px">' +
      '<div style="padding:10px 4px 18px;font-size:13px;font-weight:800;color:#f3f5f7">LockOn <span style="color:#737d88;font-weight:500">ServiceOS</span></div>' +
      '<div style="border:1px solid #252b33;border-radius:20px;background:#11151a;overflow:hidden">' +
        '<div style="padding:24px 22px 20px">' +
          '<div style="font-size:11px;color:#ff8b60;font-weight:800;letter-spacing:.1em">ZLECENIE #' + escapeHtml(item.order_number) + '</div>' +
          '<div style="font-size:26px;line-height:1.15;font-weight:850;margin-top:8px">Mamy aktualizację Twojej naprawy</div>' +
          '<p style="margin:12px 0 0;color:#909aa5;font-size:14px;line-height:1.55">Dzień dobry ' + escapeHtml(item.first_name) + '. Poniżej najważniejsza informacja — bez technicznych szczegółów.</p>' +
        '</div>' +
        '<div style="margin:0 22px;padding:18px;border-radius:15px;background:#171d23;border:1px solid #2a323c">' +
          '<div style="font-size:10px;color:#7e8995;text-transform:uppercase;letter-spacing:.08em;font-weight:800">Teraz</div>' +
          '<div style="font-size:22px;line-height:1.25;font-weight:850;color:#f3f5f7;margin-top:6px">' + escapeHtml(label) + '</div>' +
          '<div style="margin-top:10px;color:#929ca7;font-size:13px">' + escapeHtml(item.brand) + ' ' + escapeHtml(item.model) + '</div>' +
        '</div>' +
        (transferNote ? '<div style="margin:12px 22px 0;padding:12px 14px;border-radius:12px;background:#15191f;color:#aab2bb;font-size:12px;line-height:1.5">' + escapeHtml(transferNote) + '</div>' : '') +
        '<div style="padding:18px 22px 22px">' +
          '<div style="font-size:12px;color:#858f9a;line-height:1.55">Punkt: <strong style="color:#dce1e6">' + escapeHtml(contactPoint || item.point_name) + '</strong></div>' +
          (item.tracking_url ? '<a href="' + escapeHtml(item.tracking_url) + '" style="display:block;box-sizing:border-box;width:100%;margin-top:16px;padding:15px 16px;border-radius:12px;background:#ff7048;color:#fff;text-align:center;text-decoration:none;font-size:15px;line-height:1.3;font-weight:850">Zobacz zlecenie →</a>' : '') +
          (item.customer_portal_code ? '<div style="margin-top:18px;padding-top:17px;border-top:1px solid #252b33"><div style="font-size:10px;color:#747f8a;text-transform:uppercase;letter-spacing:.07em;font-weight:800">Twój kod klienta</div><div style="font-size:17px;font-weight:800;color:#e9edf1;letter-spacing:.045em;margin-top:5px">' + escapeHtml(item.customer_portal_code) + '</div>' + (item.customer_portal_url ? '<a href="' + escapeHtml(item.customer_portal_url) + '" style="display:inline-block;margin-top:9px;color:#ff9a76;font-size:12px;font-weight:800;text-decoration:none">Wszystkie zlecenia i wyceny →</a>' : '') + '</div>' : '') +
          '<p style="margin:18px 0 0;font-size:11px;color:#707b86;line-height:1.5">' + escapeHtml(footer) + '</p>' +
        '</div>' +
      '</div>' +
      '<div style="padding:13px 4px;text-align:center;font-size:10px;color:#59636d">Automatyczna wiadomość z ' + escapeHtml(displayName) + '.</div>' +
    '</div></body></html>';
  return { subject, text, html, displayName };
};

const sendGmail = async (sender, recipient, subject, textBody, htmlBody, displayName = 'LockOn ServiceOS') => {
  const refreshToken = decryptSecret(sender.refresh_token_ciphertext);
  const legacyClientSecret = sender.oauth_client_secret_ciphertext ? decryptSecret(sender.oauth_client_secret_ciphertext) : '';
  const accessToken = await refreshGmailAccess(refreshToken, legacyClientSecret);
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

const sendCustomerPortalEventEmail = async ({
  customerId,
  pointId,
  preference,
  subject,
  title,
  message
}) => {
  const customer=(await q("SELECT email,first_name,last_name FROM customers WHERE id=$1 LIMIT 1",[customerId])).rows[0];
  if(!customer?.email)return {sent:false,reason:'NO_CUSTOMER_EMAIL'};
  const prefs=await customerNotificationPreferences(customerId);
  if(preference==='quoteUpdates'&&prefs.quoteUpdates===false)return {sent:false,reason:'CUSTOMER_PREF_DISABLED'};
  if(preference==='messages'&&prefs.messages===false)return {sent:false,reason:'CUSTOMER_PREF_DISABLED'};
  const sender=await loadActiveMailSender(pointId);
  if(!sender)return {sent:false,reason:'NO_SENDER'};
  const settings=await mailSettingsForPoint(pointId);
  const account=await customerPortalAccount(customerId);
  const portalUrl=PUBLIC_PORTAL_URL+'/klient.html'+(account?.google_sub?'?google=1':'');
  const textBody=title+'\n\n'+message+'\n\nPortal klienta: '+portalUrl;
  const htmlBody='<!doctype html><html lang="pl"><body style="margin:0;background:#0b0d10;color:#f3f5f7;font-family:Arial,sans-serif">'+
    '<div style="max-width:560px;margin:auto;padding:28px 14px"><div style="font-size:13px;font-weight:800">LockOn <span style="color:#77818c;font-weight:500">ServiceOS</span></div>'+
    '<div style="margin-top:18px;padding:24px;border:1px solid #252d35;border-radius:18px;background:#11161c">'+
    '<div style="font-size:11px;color:#ff8b60;font-weight:800;letter-spacing:.08em">PORTAL KLIENTA</div>'+
    '<h1 style="font-size:23px;line-height:1.2;margin:9px 0 10px">'+escapeHtml(title)+'</h1>'+
    '<p style="color:#929ca7;font-size:14px;line-height:1.6">'+escapeHtml(message)+'</p>'+
    '<a href="'+escapeHtml(portalUrl)+'" style="display:block;margin-top:18px;padding:14px;border-radius:12px;background:#ff7048;color:#fff;text-decoration:none;text-align:center;font-weight:800">Otwórz portal klienta →</a>'+
    '</div></div></body></html>';
  try{
    const sent=await sendGmail(sender,customer.email,subject,textBody,htmlBody,settings.sender_display_name||'LockOn ServiceOS');
    return {sent:true,messageId:sent.id};
  }catch(error){
    console.error('[customer portal email]',error);
    return {sent:false,reason:'SEND_FAILED'};
  }
};

const processNotification = async (notificationId) => {
  const { rows } = await q(
    "SELECT n.id,n.recipient,n.service_order_id,n.template_key,n.payload,n.attempts,n.subject,n.body_text,n.body_html,s.order_number,s.status,s.point_id,s.customer_id,p.name AS point_name,cp.name AS current_point_name,c.first_name,d.brand,d.model,e.sender_point_id,e.sender_email,e.refresh_token_ciphertext,e.oauth_client_secret_ciphertext,e.sender_status,coalesce(ns.sender_display_name,'LockOn ServiceOS') AS sender_display_name,ns.footer_text FROM notification_outbox n JOIN service_orders s ON s.id=n.service_order_id JOIN points p ON p.id=s.point_id LEFT JOIN points cp ON cp.id=s.current_point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN LATERAL (SELECT pe.point_id AS sender_point_id,pe.sender_email,pe.refresh_token_ciphertext,pe.oauth_client_secret_ciphertext,pe.status AS sender_status FROM point_email_senders pe WHERE pe.status='ACTIVE' AND pe.refresh_token_ciphertext IS NOT NULL ORDER BY CASE WHEN pe.point_id=s.point_id THEN 0 ELSE 1 END,pe.connected_at DESC NULLS LAST,pe.updated_at DESC LIMIT 1) e ON true LEFT JOIN point_notification_settings ns ON ns.point_id=s.point_id WHERE n.id=$1 LIMIT 1",
    [notificationId]
  );
  const item = rows[0];
  if (!item) return { sent: false, reason: 'NOT_FOUND' };

  const attempt = Number(item.attempts || 0) + 1;
  const retryMinutes = Math.min(240, 5 * Math.pow(2, Math.max(0, attempt - 1)));
  const nextAttemptAt = new Date(Date.now() + retryMinutes * 60_000);

  if (!item.sender_email || item.sender_status !== 'ACTIVE' || !item.refresh_token_ciphertext || (!GOOGLE_DESKTOP_CLIENT_SECRET && !item.oauth_client_secret_ciphertext)) {
    const error = 'Brak aktywnego, kompletnego nadawcy Gmail dla punktu.';
    await q(
      "UPDATE notification_outbox SET status='FAILED',attempts=$2,last_error=$3,available_at=$4,updated_at=now() WHERE id=$1",
      [notificationId, attempt, error, nextAttemptAt]
    );
    return { sent: false, reason: 'NO_SENDER', attempts: attempt, nextAttemptAt: nextAttemptAt.toISOString() };
  }

  try{
    item.tracking_url=await trackingUrlForOrder(item.service_order_id);
  }catch(error){
    console.error('[tracking link]',error);
    item.tracking_url='';
  }
  if (item.customer_id) {
    try {
      const portalIdentity = await ensureCustomerPortalCode(item.customer_id);
      item.customer_portal_code = portalIdentity.code;
      item.customer_portal_url = PUBLIC_PORTAL_URL + '/klient.html';
    } catch (error) {
      console.error('[customer portal code]', error);
      item.customer_portal_code = '';
      item.customer_portal_url = '';
    }
  }

  const rendered = renderStatusEmail(item);
  const subject = rendered.subject;
  // Treść jest renderowana ponownie przy każdej próbie. Dzięki temu retry starej
  // wiadomości nie zachowuje historycznego HTML-a bez kodu/linku portalu klienta.
  const textBody = rendered.text;
  const htmlBody = rendered.html;

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
    if(item.sender_point_id) await q("UPDATE point_email_senders SET status='ACTIVE',last_error=NULL,updated_at=now() WHERE point_id=$1", [item.sender_point_id]);
    return { sent: true, status: 'SENT', messageId: sent.id, attempts: attempt };
  } catch (error) {
    const message = cleanText(error instanceof Error ? error.message : error, 500);
    await q(
      "UPDATE notification_outbox SET status='FAILED',last_error=$2,available_at=$3,updated_at=now() WHERE id=$1",
      [notificationId, message, nextAttemptAt]
    );
    if(isGmailReauthError(error)){
      if(item.sender_point_id) await q("UPDATE point_email_senders SET status='REVOKED',last_error=$2,updated_at=now() WHERE point_id=$1", [item.sender_point_id, message]);
    }else{
      if(item.sender_point_id) await q("UPDATE point_email_senders SET last_error=$2,updated_at=now() WHERE point_id=$1", [item.sender_point_id, message]);
    }
    return { sent: false, status: 'FAILED', reason: isGmailReauthError(error) ? 'GMAIL_REAUTH_REQUIRED' : 'SEND_FAILED', attempts: attempt, nextAttemptAt: nextAttemptAt.toISOString() };
  }
};

const queueTransferNotification = async (actor, orderId, transfer, transferStatus, note = '') => {
  try {
    const orderData = (await q(
      "SELECT s.id,s.point_id,s.customer_id,c.email,fp.name AS from_point_name,tp.name AS to_point_name FROM service_orders s JOIN customers c ON c.id=s.customer_id JOIN points fp ON fp.id=$2 JOIN points tp ON tp.id=$3 WHERE s.id=$1 LIMIT 1",
      [orderId, transfer.from_point_id, transfer.to_point_id]
    )).rows[0];
    if (!orderData?.email) return { queued:false,sent:false,reason:'NO_CUSTOMER_EMAIL' };

    const settings = await mailSettingsForPoint(orderData.point_id);
    const customerPrefs = await customerNotificationPreferences(orderData.customer_id);
    if (customerPrefs.serviceUpdates === false) return { queued:false,sent:false,reason:'CUSTOMER_PREF_DISABLED' };
    if (settings.automatic_email_enabled !== true) return { queued:false,sent:false,reason:'AUTOMATIC_EMAIL_DISABLED' };

    const notificationId = makeId('ntf');
    await q(
      "INSERT INTO notification_outbox(id,user_id,customer_id,service_order_id,channel,template_key,recipient,payload,status) VALUES($1,$2,$3,$4,'EMAIL','SERVICE_TRANSFER_EVENT',$5,$6::jsonb,'PENDING')",
      [notificationId, actor.id, orderData.customer_id, orderId, orderData.email, JSON.stringify({
        transferId: transfer.id,
        transferStatus,
        transferKind: transfer.kind || 'OUTBOUND_SERVICE',
        fromPointId: transfer.from_point_id,
        fromPointName: orderData.from_point_name,
        toPointId: transfer.to_point_id,
        toPointName: orderData.to_point_name,
        note: cleanText(note,300) || null
      })]
    );
    return { queued:true,...(await processNotification(notificationId)) };
  } catch (error) {
    console.error('[transfer notification]', error);
    return { queued:false,sent:false,reason:'NOTIFICATION_ERROR' };
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
  await audit(session, 'WEBSITE_CODE_CREATED', 'user', session.user.id, null, {});
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
  const conversation = (await q(
    "SELECT sc.*,ass.name AS assigned_support_name FROM support_conversations sc LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE sc.user_id=$1 AND sc.status='OPEN' ORDER BY sc.updated_at DESC LIMIT 1",
    [userId]
  )).rows[0] || await getOrCreateConversation(userId);
  const { rows } = await q(
    'SELECT id,sender_user_id,sender_kind,body,metadata,created_at FROM support_messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 200',
    [conversation.id]
  );
  return {
    id: conversation.id,
    status: conversation.status,
    consultantRequestedAt: conversation.consultant_requested_at || null,
    consultantJoinedAt: conversation.consultant_joined_at || conversation.taken_at || null,
    assignedSupportUserId: conversation.assigned_support_user_id || null,
    assignedSupportName: conversation.assigned_support_name || null,
    consultantState: conversation.assigned_support_user_id ? 'JOINED' : conversation.consultant_requested_at ? 'WAITING' : 'BOT',
    messages: rows.map((row) => ({
      id: row.id,
      author: row.sender_kind.toLowerCase(),
      text: row.body,
      action: row.metadata?.action || null,
      createdAt: row.created_at
    }))
  };
};

const roleSelfDescription = (role, supportEnabled = false) => {
  const base = ({
    OWNER: 'Jesteś właścicielem ServiceOS. Masz pełny dostęp do administracji, punktów, serwisu, rozliczeń, audytu i bezpieczeństwa.',
    BOSS: 'Jesteś Szefem. Masz globalny dostęp operacyjny do punktów, napraw, przychodów i rozliczeń.',
    COORDINATOR: 'Jesteś Koordynatorem. Pracujesz na przypisanych punktach i możesz zarządzać ich obsługą serwisową.',
    SUPPORT: 'Masz starszy profil Wsparcia LockOn. Po aktualizacji wsparcie jest dodatkowym uprawnieniem niezależnym od głównej roli.',
    TECHNICIAN: 'Jesteś Serwisantem. Pracujesz na przypisanych punktach, zleceniach i własnych rozliczeniach.',
    USER: 'Jesteś Pracownikiem punktu. Możesz przyjmować zlecenia, edytować dane przyjęcia, anulować je i przekazywać urządzenia.'
  }[role] || 'Twoje konto nie ma jeszcze aktywnej roli.');
  return base + (supportEnabled || role === 'SUPPORT' || role === 'OWNER'
    ? ' Masz też uprawnienie Wsparcie LockOn i możesz dołączać do rozmów użytkowników, którzy poprosili konsultanta.'
    : '');
};

const assistantReply = async (session, message) => {
  const user = session.user;
  const lower = message.toLocaleLowerCase('pl-PL');
  const navAction = (target, label) => ({ type:'NAVIGATE', target, label });
  const cleanSearchQuery = (value) => cleanText(String(value || '')
    .replace(/^\s*\/(video|film|szukaj|web|net|diag)\b/iu,' ')
    .replace(/\b(znajdź|znajdz|wyszukaj|pokaż|pokaz|film|filmy|wideo|video|youtube|tutorial|poradnik|instrukcja|instrukcję|instrukcje|jak zrobić|jak zrobic|jak naprawić|jak naprawic)\b/giu,' ')
    .replace(/\s+/g,' ')
    .trim(),180);

  if (
    /^\s*\/net\b/i.test(message) ||
    lower.includes('test internetu') ||
    lower.includes('test prędkości') ||
    lower.includes('test predkosci') ||
    lower.includes('prędkość internetu') ||
    lower.includes('predkosc internetu') ||
    lower.includes('speedtest') ||
    lower.includes('speed test')
  ) {
    return {
      text:'Uruchamiam lokalny test łącza na tym urządzeniu. Zmierzę opóźnienie, pobieranie i — jeśli serwer testowy pozwoli — wysyłanie. Wynik dotyczy komputera, na którym działa ServiceOS.',
      action:{type:'SPEED_TEST',label:'Uruchom test internetu'}
    };
  }

  if (
    /^\s*\/diag\b/i.test(message) ||
    lower.includes('diagnostyka połączenia') ||
    lower.includes('diagnostyka polaczenia') ||
    lower.includes('sprawdź połączenie') ||
    lower.includes('sprawdz polaczenie') ||
    lower.includes('czy api działa') ||
    lower.includes('czy api dziala') ||
    lower.includes('nie łączy z serviceos') ||
    lower.includes('nie laczy z serviceos')
  ) {
    return {
      text:'Sprawdzę z tego urządzenia dostęp do internetu i centralnego API ServiceOS oraz pokażę opóźnienia, wersję aplikacji i platformę. To pomaga odróżnić problem z siecią od problemu z usługą.',
      action:{type:'CONNECTIVITY_TEST',label:'Uruchom diagnostykę'}
    };
  }

  const wantsVideo =
    /^\s*\/(video|film)\b/i.test(message) ||
    lower.includes('youtube') ||
    lower.includes('film jak') ||
    lower.includes('wideo jak') ||
    lower.includes('video jak') ||
    lower.includes('tutorial') ||
    (lower.includes('film') && (lower.includes('napraw') || lower.includes('wymieni') || lower.includes('rozebra') || lower.includes('złoży') || lower.includes('zlozy')));
  if (wantsVideo) {
    const query = cleanSearchQuery(message);
    if (query.length < 3) {
      return { text:'Podaj urządzenie i czynność, np. „film jak wymienić ekran iPhone 15”, „/video Samsung S24 USB-C replacement” albo „YouTube MacBook A2338 battery replacement”.' };
    }
    return {
      text:'Przygotowałem wyszukiwanie filmów instruktażowych dla: „'+query+'”. Otworzę wyniki w przeglądarce ServiceOS, żebyś mógł wybrać materiał pasujący do dokładnej wersji urządzenia.',
      action:{type:'BROWSER_SEARCH',provider:'YOUTUBE',query,label:'Znajdź filmy na YouTube'}
    };
  }

  const wantsWebGuide =
    /^\s*\/web\b/i.test(message) ||
    lower.includes('instrukcja serwisowa') ||
    lower.includes('service manual') ||
    lower.includes('schemat płyty') ||
    lower.includes('schemat plyty') ||
    lower.includes('datasheet') ||
    lower.includes('manual serwisowy');
  if (wantsWebGuide) {
    const query = cleanSearchQuery(message) || cleanText(message.replace(/^\s*\/web\b/i,''),180);
    if (query.length < 3) return { text:'Podaj model urządzenia i czego szukasz, np. „service manual ThinkPad T14 Gen 4” albo „schemat płyty iPhone 13 charging”.' };
    return {
      text:'Otworzę wyszukiwanie materiałów technicznych dla: „'+query+'”. Sprawdź zgodność modelu i rewizji płyty przed użyciem instrukcji.',
      action:{type:'BROWSER_SEARCH',provider:'WEB',query,label:'Szukaj materiałów technicznych'}
    };
  }

  if (lower.includes('audyt') || lower.includes('dziennik działa') || lower.includes('kto zmieni')) {
    if (user.role_code !== 'OWNER') return { text:'Audyt jest dostępny właścicielowi systemu. Jeżeli potrzebujesz sprawdzić konkretną zmianę w swoim zleceniu, podaj numer zlecenia.', action:navAction('support','Otwórz pomoc') };
    return { text:'W Administracji otwórz zakładkę Audyt. Możesz filtrować po pracowniku, punkcie, rodzaju działania, numerze zlecenia i dacie. Główny opis jest po polsku, a identyfikatory techniczne są schowane w szczegółach.', action:navAction('administration','Otwórz Administrację') };
  }

  if (lower.includes('zablok') || lower.includes('odblok') || lower.includes('konto pracownik') || lower.includes('uprawnieni') && lower.includes('konto')) {
    if (user.role_code !== 'OWNER') return { text:'Zmiany kont, blokady i uprawnienia wykonuje właściciel ServiceOS.' };
    return { text:'W Administracji → Konta i uprawnienia wybierz pracownika. Możesz zmienić główną rolę, przypisane punkty, dodatkowe Wsparcie LockOn, parametry serwisanta, zablokować konto albo wylogować jego urządzenia.', action:navAction('administration','Otwórz Konta i uprawnienia') };
  }

  if (lower.includes('przekazan') || lower.includes('gdzie jest telefon') || lower.includes('lokalizacj') && lower.includes('urządzen')) {
    return { text:'Przekazania pokazują fizyczną drogę urządzenia między punktami. W karcie zlecenia zobaczysz punkt macierzysty, aktualną lokalizację i trwające przekazanie. Status naprawy jest blokowany podczas transportu.', action:navAction('service','Otwórz Serwis') };
  }

  if (lower.includes('rozlicz') || lower.includes('przychód') || lower.includes('przychod') || lower.includes('procent serwisant')) {
    return { text:'Rozliczenia korzystają z procentu przypisanego do konkretnego serwisanta. Po zakończeniu zlecenia ServiceOS zapisuje snapshot procentu, dzięki czemu późniejsza zmiana ustawienia nie zmienia historii.', action:navAction('earnings','Otwórz Rozliczenia') };
  }

  if (lower.includes('gmail') || lower.includes('e-mail') || lower.includes('email') || lower.includes('powiadom')) {
    return { text:'Wiadomości serwisowe są kolejkowane przed wysyłką. Za wysłaną uznajemy wiadomość dopiero po zaakceptowaniu jej przez Gmail i zapisaniu identyfikatora dostawcy. Przy błędzie działa kolejka ponowień.', action:navAction('service','Otwórz Powiadomienia w Serwisie') };
  }

  if (lower.includes('konsultant') || lower.includes('wsparcie') || lower.includes('pomoc człow') || lower.includes('pomoc czlow')) {
    return { text:'Możesz najpierw korzystać z bota. Gdy potrzebujesz człowieka, wybierz „Poproś konsultanta”. Wsparcie LockOn zobaczy wtedy Twoją prośbę i może dołączyć do tej samej rozmowy. Samo używanie bota nie udostępnia rozmowy konsultantowi.', action:navAction('support','Otwórz Wsparcie') };
  }

  if (lower.includes('ustawien') || lower.includes('wygląd') || lower.includes('wyglad') || lower.includes('skala')) {
    return { text:'W Ustawieniach możesz zmienić skalę interfejsu i sprawdzić informacje o aplikacji. Zakres funkcji wynika z Twojej głównej roli i dodatkowych uprawnień.', action:navAction('settings','Otwórz Ustawienia') };
  }

  if ((lower.includes('kod') || lower.includes('autoryz')) && (lower.includes('stron') || lower.includes('www') || lower.includes('logow'))) {
    const code = await generateWebsiteCode(session);
    return {
      text: 'Kod jednorazowy do logowania na stronie: ' + code.code + '. Jest ważny 5 minut i zadziała tylko raz.',
      action: { type: 'WEBSITE_CODE', ...code }
    };
  }

  if (lower.includes('zlecen') || lower.includes('napraw')) {
    if (!SERVICE_READ_ROLES.has(user.role_code)) {
      return { text: 'Twoja rola nie ma dostępu do danych zleceń serwisowych.' };
    }

    const number = message.match(/\b\d{1,10}\b/);
    if (number) {
      const order = await getVisibleOrderByNumber(user, number[0]);
      if (!order) return { text: 'Nie znalazłem zlecenia #' + number[0] + ' w zakresie, do którego masz dostęp.' };

      const lines = [
        'Zlecenie #' + order.orderNumber + ' · ' + order.customerName,
        order.brand + ' ' + order.model + ' · ' + order.statusLabel,
        'Punkt: ' + order.pointName
      ];

      if (order.assignedTechnicianName) lines.push('Technik: ' + order.assignedTechnicianName);
      if (order.estimatedCompletionAt) lines.push('Przewidywany termin: ' + new Date(order.estimatedCompletionAt).toLocaleString('pl-PL'));

      if (lower.includes('imei')) {
        lines.push(order.imei ? 'IMEI: ' + order.imei : 'IMEI nie jest zapisany.');
      }
      if (lower.includes('seryj') || lower.includes('serial')) {
        lines.push(order.serialNumber ? 'Numer seryjny: ' + order.serialNumber : 'Numer seryjny nie jest zapisany.');
      }
      if (lower.includes('koszt') || lower.includes('cena') || lower.includes('wycen')) {
        if (order.finalCost != null) lines.push('Koszt końcowy: ' + Number(order.finalCost).toFixed(2) + ' ' + (order.currency || 'PLN'));
        else if (order.estimatedCost != null) lines.push('Koszt szacowany: ' + Number(order.estimatedCost).toFixed(2) + ' ' + (order.currency || 'PLN'));
        else if (SERVICE_MANAGE_ROLES.has(user.role_code)) lines.push('Koszt nie został jeszcze zapisany.');
        else lines.push('Twoja rola nie ma dostępu do danych kosztowych zlecenia.');
      }

      if (lower.includes('notatk') && SERVICE_EDIT_ROLES.has(user.role_code)) {
        const { rows } = await q(
          'SELECT n.body,n.created_at,usr.name AS author_name,usr.email AS author_email FROM service_order_notes n JOIN users usr ON usr.id=n.author_user_id WHERE n.service_order_id=$1 ORDER BY n.created_at DESC LIMIT 3',
          [order.id]
        );
        if (rows.length) {
          lines.push('Ostatnie notatki wewnętrzne:');
          for (const note of rows) {
            lines.push('- ' + (note.author_name || note.author_email || 'Użytkownik') + ' · ' + new Date(note.created_at).toLocaleString('pl-PL') + ': ' + cleanText(note.body, 240));
          }
        } else {
          lines.push('Brak notatek wewnętrznych.');
        }
      }

      if (lower.includes('histori') || lower.includes('statusy')) {
        const { rows } = await q(
          'SELECT h.from_status,h.to_status,h.note,h.created_at,usr.name AS changed_by_name,usr.email AS changed_by_email FROM service_order_status_history h LEFT JOIN users usr ON usr.id=h.changed_by_user_id WHERE h.service_order_id=$1 ORDER BY h.created_at DESC LIMIT 6',
          [order.id]
        );
        if (rows.length) {
          lines.push('Ostatnie zmiany statusu:');
          for (const item of rows.reverse()) {
            const from = item.from_status ? (STATUS_LABELS[item.from_status] || item.from_status) + ' → ' : '';
            const to = STATUS_LABELS[item.to_status] || item.to_status;
            const who = item.changed_by_name || item.changed_by_email || 'System';
            lines.push('- ' + from + to + ' · ' + new Date(item.created_at).toLocaleString('pl-PL') + ' · ' + who + (item.note ? ' · ' + cleanText(item.note, 180) : ''));
          }
        }
      }

      return {
        text: lines.join('\n'),
        action: { type:'OPEN_ORDER', target:'service', orderId:order.id, orderNumber:order.orderNumber, label:'Otwórz zlecenie #' + order.orderNumber }
      };
    }
  }

  if (lower.includes('klient')) {
    if (!SERVICE_READ_ROLES.has(user.role_code)) {
      return { text: 'Twoja rola nie ma dostępu do danych klientów. Mogę nadal pomóc w obsłudze samej aplikacji.' };
    }

    let term = message
      .replace(/znajdź|znajdz|wyszukaj|klienta|klient|pokaż|pokaz|szukaj|historia|historię|historie|zlecenia|zleceń|naprawy|napraw|telefony|telefon|urządzenia|urzadzenia/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    term = cleanText(term, 120);

    if (term.length >= 2) {
      const matches = await searchCustomers(user, term);
      if (!matches.length) return { text: 'Nie znalazłem klienta pasującego do "' + term + '" w zakresie danych, do których masz dostęp.' };

      const wantsHistory = lower.includes('histori') || lower.includes('zlecen') || lower.includes('napraw') || lower.includes('telefon') || lower.includes('urządzen') || lower.includes('urzadzen');

      if (wantsHistory && matches.length === 1) {
        const customer = matches[0];
        const orders = await listVisibleCustomerOrders(user, customer.id);
        const lines = [
          customer.firstName + ' ' + customer.lastName + (customer.email ? ' · ' + customer.email : '') + (customer.phone ? ' · ' + customer.phone : ''),
          'Widoczne zlecenia: ' + orders.length
        ];
        for (const order of orders.slice(0, 6)) {
          lines.push('- #' + order.orderNumber + ' · ' + order.brand + ' ' + order.model + ' · ' + order.statusLabel + ' · ' + order.pointName);
        }
        if (!orders.length) lines.push('Brak zleceń w zakresie punktów dostępnych dla Twojego konta.');
        return {
          text: lines.join('\n'),
          action: orders[0]
            ? { type:'OPEN_ORDER', target:'service', orderId:orders[0].id, orderNumber:orders[0].orderNumber, label:'Otwórz ostatnie zlecenie #' + orders[0].orderNumber }
            : navAction('service','Otwórz Serwis')
        };
      }

      const lines = matches.slice(0, 5).map((customer) =>
        '- ' + customer.firstName + ' ' + customer.lastName +
        (customer.email ? ' · ' + customer.email : '') +
        (customer.phone ? ' · ' + customer.phone : '')
      );
      const suffix = wantsHistory && matches.length > 1
        ? '\nZnalazłem kilka osób. Doprecyzuj klienta, a pokażę historię zleceń w Twoim zakresie.'
        : '';
      return { text: 'Znalazłem klientów w Twoim zakresie:\n' + lines.join('\n') + suffix };
    }
  }

  if (user.role_code === 'OWNER' && (lower.includes('pracownik') || lower.includes('użytkownik') || lower.includes('uzytkownik') || lower.includes('konto'))) {
    const term = cleanText(message
      .replace(/znajdź|znajdz|wyszukaj|pokaż|pokaz|pracownika|pracownik|użytkownika|uzytkownika|użytkownik|uzytkownik|konto|konta/gi,' ')
      .replace(/\s+/g,' ')
      .trim(),120);
    if (term.length >= 2) {
      const matches=(await q(
        "SELECT id,name,email,role_code,status,blocked_at,support_enabled FROM users WHERE lower(name||' '||email) LIKE '%'||lower($1)||'%' ORDER BY last_login_at DESC LIMIT 8",
        [term]
      )).rows;
      if (!matches.length) return { text:'Nie znalazłem konta pasującego do „'+term+'”.', action:navAction('administration','Otwórz Konta i uprawnienia') };
      const lines=matches.map(row=>'- '+row.name+' · '+row.email+' · '+(row.blocked_at?'zablokowane':row.status==='ACTIVE'?'aktywne':'oczekuje')+(row.support_enabled?' · Wsparcie LockOn':''));
      const match=matches.length===1?matches[0]:null;
      return {
        text:'Znalazłem konta:\n'+lines.join('\n')+(matches.length>1?'\nDoprecyzuj imię lub e-mail, jeśli mam wskazać jedno konto.':''),
        action: match
          ? {type:'OPEN_USER',target:'administration',userId:match.id,label:'Otwórz konto '+match.name}
          : navAction('administration','Otwórz Konta i uprawnienia')
      };
    }
  }

  if (lower.includes('moja rola') || lower.includes('moje uprawn') || lower.includes('co mogę') || lower.includes('co moge')) {
    return { text: roleSelfDescription(user.role_code,user.support_enabled) };
  }

  if ((lower.includes('role') || lower.includes('uprawnienia')) && user.role_code !== 'OWNER') {
    return { text: roleSelfDescription(user.role_code,user.support_enabled) + ' Pełny katalog wszystkich ról i uprawnień jest widoczny wyłącznie dla OWNER.' };
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

  return { text: 'Mogę pomóc w codziennej pracy serwisu i w ServiceOS: wyszukać klienta lub zlecenie w Twoim zakresie, sprawdzić historię i notatki, otworzyć właściwy ekran, wyjaśnić przekazania, rozliczenia, Gmail i uprawnienia, przetestować internet i połączenie z API oraz znaleźć filmy albo materiały techniczne do naprawy. Przykłady: „zlecenie 123 statusy”, „historia klienta Kowalski”, „test internetu”, „diagnostyka połączenia”, „film jak wymienić ekran iPhone 15”, „service manual ThinkPad T14”.' };
};

const route = async (request) => {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if(method==='POST'&&url.pathname==='/internal/notifications/process'){
    const triggerId=request.headers.get('x-neon-trigger-invocation-id');
    if(!triggerId)return json(request,{error:'TRIGGER_REQUIRED'},403);
    const triggerBody=await readJson(request).catch(()=>({}));
    const {rows}=await q("SELECT id FROM notification_outbox WHERE status IN ('PENDING','FAILED') AND available_at<=now() AND attempts<5 ORDER BY available_at ASC,created_at ASC LIMIT 25");
    const results=[];
    for(const row of rows)results.push({id:row.id,...(await processNotification(row.id))});
    console.log('[notification worker]',{triggerId,scheduledAt:triggerBody?.data?.scheduled_at||null,processed:results.length});
    return json(request,{ok:true,processed:results.length,results});
  }

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: secureHeaders(request) });

  if(method==='GET'&&url.pathname==='/public/service-track'){
    const token=String(url.searchParams.get('token')||'').trim();
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))return json(request,{error:'TRACKING_TOKEN',message:'Link śledzenia jest nieprawidłowy albo niepełny.'},404);
    const hash=tokenHash(token);
    const order=(await q(
      "SELECT s.id,s.order_number,s.order_type,s.handling_mode,s.issue_description,s.status,s.estimated_completion_at,s.received_at,s.completed_at,s.created_at,s.updated_at,d.brand,d.model,d.imei,d.serial_number,c.first_name,c.last_name,p.name AS point_name,hp.name AS home_point_name,cp.name AS current_point_name FROM service_orders s JOIN devices d ON d.id=s.device_id JOIN customers c ON c.id=s.customer_id JOIN points p ON p.id=s.point_id LEFT JOIN points hp ON hp.id=COALESCE(s.home_point_id,s.point_id) LEFT JOIN points cp ON cp.id=s.current_point_id WHERE s.tracking_token_hash=$1 LIMIT 1",
      [hash]
    )).rows[0];
    if(!order)return json(request,{error:'TRACKING_NOT_FOUND',message:'Link śledzenia wygasł albo nie istnieje.'},404);
    const [historyResult,transferResult]=await Promise.all([
      q("SELECT from_status,to_status,created_at FROM service_order_status_history WHERE service_order_id=$1 ORDER BY created_at ASC,id ASC",[order.id]),
      q("SELECT t.kind,t.status,t.requested_at,t.shipped_at,t.delivered_at,t.accepted_at,t.updated_at,fp.name AS from_point_name,tp.name AS to_point_name FROM service_order_transfers t JOIN points fp ON fp.id=t.from_point_id JOIN points tp ON tp.id=t.to_point_id WHERE t.service_order_id=$1 ORDER BY t.requested_at ASC,t.id ASC",[order.id])
    ]);
    return json(request,{
      order:{
        orderNumber:Number(order.order_number),
        orderType:order.order_type,
        handlingMode:order.handling_mode||'STANDARD',
        issueDescription:order.issue_description,
        status:order.status,
        statusLabel:STATUS_LABELS[order.status]||order.status,
        customerName:[order.first_name,order.last_name?String(order.last_name).slice(0,1)+'.':''].filter(Boolean).join(' '),
        device:{brand:order.brand,model:order.model,imei:order.imei?('••••••••••'+String(order.imei).slice(-4)):null,serialNumber:order.serial_number?('••••'+String(order.serial_number).slice(-4)):null},
        pointName:order.point_name,
        homePointName:order.home_point_name||order.point_name,
        currentPointName:order.current_point_name||null,
        estimatedCompletionAt:order.estimated_completion_at||null,
        receivedAt:order.received_at,
        completedAt:order.completed_at||null,
        createdAt:order.created_at,
        updatedAt:order.updated_at
      },
      statusHistory:historyResult.rows.map(row=>({
        fromStatus:row.from_status||null,
        fromLabel:row.from_status?(STATUS_LABELS[row.from_status]||row.from_status):null,
        toStatus:row.to_status,
        toLabel:STATUS_LABELS[row.to_status]||row.to_status,
        changedAt:row.created_at
      })),
      transfers:transferResult.rows.map(row=>({
        kind:row.kind||'OUTBOUND_SERVICE',
        status:row.status,
        fromPointName:row.from_point_name,
        toPointName:row.to_point_name,
        requestedAt:row.requested_at,
        shippedAt:row.shipped_at||null,
        deliveredAt:row.delivered_at||null,
        acceptedAt:row.accepted_at||null,
        updatedAt:row.updated_at
      }))
    });
  }

  if (method === 'GET' && url.pathname === '/public/customer-portal/config') {
    return json(request,{
      googleEnabled:Boolean(GOOGLE_CUSTOMER_WEB_CLIENT_ID),
      googleClientId:GOOGLE_CUSTOMER_WEB_CLIENT_ID || null
    });
  }

  if (method === 'POST' && url.pathname === '/public/customer-portal/login') {
    const body = await readJson(request);
    const code = normalizeCustomerPortalCode(body.customerId || body.code);
    if (!code) return json(request,{error:'CUSTOMER_ID',message:'Kod klienta jest nieprawidłowy.'},400);
    const customer = (await q(
      "SELECT c.id,a.blocked_at,a.blocked_reason FROM customers c LEFT JOIN customer_portal_accounts a ON a.customer_id=c.id WHERE c.portal_code_hash=$1 LIMIT 1",
      [tokenHash(code)]
    )).rows[0];
    if (!customer) return json(request,{error:'CUSTOMER_ID',message:'Nie znaleziono klienta dla tego kodu.'},401);
    if (customer.blocked_at) return json(request,{error:'CUSTOMER_ACCOUNT_BLOCKED',message:customer.blocked_reason?'Dostęp do portalu został zablokowany: '+cleanText(customer.blocked_reason,180):'Dostęp do portalu został zablokowany.'},403);
    const session = await createCustomerPortalSession(customer.id,'CODE');
    await q("INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,NULL,'CUSTOMER_PORTAL_LOGIN','customer',$2,$3::jsonb)",[
      makeId('aud'),customer.id,JSON.stringify({clientType:'CUSTOMER_PORTAL',authMethod:'CODE'})
    ]);
    return json(request,{sessionToken:session.token,expiresAt:session.expiresAt,...(await loadCustomerPortalPayload(customer.id,{auth_method:'CODE'}))});
  }

  if (method === 'POST' && url.pathname === '/public/customer-portal/google/link') {
    const customerSession = await requireCustomerPortal(request);
    if (!GOOGLE_CUSTOMER_WEB_CLIENT_ID) return json(request,{error:'GOOGLE_NOT_CONFIGURED',message:'Logowanie Google dla klientów nie jest jeszcze dostępne.'},503);
    const body = await readJson(request);
    if (!body.idToken) return json(request,{error:'MISSING_TOKEN',message:'Brak tokena Google.'},400);
    let profile;
    try { profile = await verifyGoogle(String(body.idToken),GOOGLE_CUSTOMER_WEB_CLIENT_ID); }
    catch { return json(request,{error:'GOOGLE_AUTH_FAILED',message:'Google nie potwierdził tożsamości.'},401); }
    const customerEmail=normalizeEmail(customerSession.email||'');
    if (!customerEmail) return json(request,{error:'CUSTOMER_EMAIL_REQUIRED',message:'Najpierw poproś punkt LockOn o zapisanie Twojego adresu e-mail przy kliencie.'},409);
    if (profile.email!==customerEmail) return json(request,{error:'GOOGLE_EMAIL_MISMATCH',message:'Konto Google musi używać tego samego adresu e-mail, który jest zapisany przy kliencie: '+customerEmail},409);
    const already=(await q("SELECT customer_id FROM customer_portal_accounts WHERE google_sub=$1 AND customer_id<>$2 LIMIT 1",[profile.sub,customerSession.customer_id])).rows[0];
    if (already) return json(request,{error:'GOOGLE_ALREADY_LINKED',message:'To konto Google jest już połączone z innym klientem.'},409);
    await q(
      "INSERT INTO customer_portal_accounts(customer_id,google_sub,google_email,google_name,google_picture_url,linked_at,last_login_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now(),now()) ON CONFLICT(customer_id) DO UPDATE SET google_sub=EXCLUDED.google_sub,google_email=EXCLUDED.google_email,google_name=EXCLUDED.google_name,google_picture_url=EXCLUDED.google_picture_url,linked_at=COALESCE(customer_portal_accounts.linked_at,now()),last_login_at=now(),blocked_at=NULL,blocked_reason=NULL,blocked_by_user_id=NULL,updated_at=now()",
      [customerSession.customer_id,profile.sub,profile.email,profile.name,profile.picture]
    );
    await q("DELETE FROM customer_portal_sessions WHERE id=$1",[customerSession.session_id]);
    const session=await createCustomerPortalSession(customerSession.customer_id,'GOOGLE');
    await q("INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,NULL,'CUSTOMER_GOOGLE_LINKED','customer',$2,$3::jsonb)",[
      makeId('aud'),customerSession.customer_id,JSON.stringify({clientType:'CUSTOMER_PORTAL',googleEmail:profile.email})
    ]);
    return json(request,{sessionToken:session.token,expiresAt:session.expiresAt,...(await loadCustomerPortalPayload(customerSession.customer_id,{auth_method:'GOOGLE'}))});
  }

  if (method === 'POST' && url.pathname === '/public/customer-portal/google/login') {
    if (!GOOGLE_CUSTOMER_WEB_CLIENT_ID) return json(request,{error:'GOOGLE_NOT_CONFIGURED',message:'Logowanie Google dla klientów nie jest jeszcze dostępne.'},503);
    const body=await readJson(request);
    if (!body.idToken) return json(request,{error:'MISSING_TOKEN',message:'Brak tokena Google.'},400);
    let profile;
    try { profile=await verifyGoogle(String(body.idToken),GOOGLE_CUSTOMER_WEB_CLIENT_ID); }
    catch { return json(request,{error:'GOOGLE_AUTH_FAILED',message:'Google nie potwierdził tożsamości.'},401); }
    let account=(await q(
      "SELECT a.customer_id,a.blocked_at,a.blocked_reason,c.email FROM customer_portal_accounts a JOIN customers c ON c.id=a.customer_id WHERE a.google_sub=$1 LIMIT 1",
      [profile.sub]
    )).rows[0];
    if (!account) {
      const matching=(await q("SELECT id FROM customers WHERE lower(email)=lower($1) LIMIT 1",[profile.email])).rows[0];
      if (matching) return json(request,{error:'CUSTOMER_GOOGLE_NOT_LINKED',message:'To konto Google pasuje do klienta, ale nie jest jeszcze połączone. Wpisz kod klienta jeden raz i wybierz „Połącz konto Google”.'},409);
      return json(request,{error:'CUSTOMER_GOOGLE_NOT_FOUND',message:'Nie znaleziono połączonego konta klienta. Użyj kodu klienta, aby połączyć Google.'},403);
    }
    if (account.blocked_at) return json(request,{error:'CUSTOMER_ACCOUNT_BLOCKED',message:account.blocked_reason?'Dostęp do portalu został zablokowany: '+cleanText(account.blocked_reason,180):'Dostęp do portalu został zablokowany.'},403);
    await q(
      "UPDATE customer_portal_accounts SET google_email=$2,google_name=$3,google_picture_url=$4,last_login_at=now(),updated_at=now() WHERE customer_id=$1",
      [account.customer_id,profile.email,profile.name,profile.picture]
    );
    const session=await createCustomerPortalSession(account.customer_id,'GOOGLE');
    await q("INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,NULL,'CUSTOMER_GOOGLE_LOGIN','customer',$2,$3::jsonb)",[
      makeId('aud'),account.customer_id,JSON.stringify({clientType:'CUSTOMER_PORTAL',googleEmail:profile.email})
    ]);
    return json(request,{sessionToken:session.token,expiresAt:session.expiresAt,...(await loadCustomerPortalPayload(account.customer_id,{auth_method:'GOOGLE'}))});
  }

  if (method === 'GET' && url.pathname === '/public/customer-portal/me') {
    const customerSession = await requireCustomerPortal(request);
    return json(request,await loadCustomerPortalPayload(customerSession.customer_id,customerSession));
  }

  if (method === 'POST' && url.pathname === '/public/customer-portal/settings') {
    const customerSession=await requireCustomerPortalFull(request);
    const body=await readJson(request);
    const current=await customerPortalAccount(customerSession.customer_id);
    const prefs={
      serviceUpdates:body.serviceUpdates===undefined ? current?.notify_service_updates!==false : body.serviceUpdates===true,
      readyForPickup:body.readyForPickup===undefined ? current?.notify_ready_for_pickup!==false : body.readyForPickup===true,
      quoteUpdates:body.quoteUpdates===undefined ? current?.notify_quote_updates!==false : body.quoteUpdates===true,
      messages:body.messages===undefined ? current?.notify_messages!==false : body.messages===true
    };
    await q(
      "UPDATE customer_portal_accounts SET notify_service_updates=$2,notify_ready_for_pickup=$3,notify_quote_updates=$4,notify_messages=$5,updated_at=now() WHERE customer_id=$1",
      [customerSession.customer_id,prefs.serviceUpdates,prefs.readyForPickup,prefs.quoteUpdates,prefs.messages]
    );
    await q("INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,NULL,'CUSTOMER_SETTINGS_UPDATED','customer',$2,$3::jsonb)",[
      makeId('aud'),customerSession.customer_id,JSON.stringify({clientType:'CUSTOMER_PORTAL',notificationPreferences:prefs})
    ]);
    return json(request,await loadCustomerPortalPayload(customerSession.customer_id,customerSession));
  }

  if (method === 'POST' && url.pathname === '/public/customer-portal/quotes') {
    const customerSession = await requireCustomerPortalFull(request);
    const body = await readJson(request);
    let requestedPointId = cleanText(body.requestedPointId,80);
    const serviceOrderId = cleanText(body.serviceOrderId,80) || null;
    let deviceDescription = cleanText(body.deviceDescription,180);
    const issueDescription = cleanText(body.issueDescription,2000);
    if (!issueDescription) return json(request,{error:'ISSUE_REQUIRED',message:'Opisz urządzenie i problem, który mamy wycenić.'},400);

    let linkedOrder = null;
    if (serviceOrderId) {
      linkedOrder = (await q(
        "SELECT s.id,s.point_id,d.brand,d.model FROM service_orders s JOIN devices d ON d.id=s.device_id WHERE s.id=$1 AND s.customer_id=$2 LIMIT 1",
        [serviceOrderId,customerSession.customer_id]
      )).rows[0];
      if (!linkedOrder) return json(request,{error:'ORDER_NOT_FOUND',message:'To zlecenie nie należy do Twojej historii.'},404);
      if (!deviceDescription) deviceDescription=[linkedOrder.brand,linkedOrder.model].filter(Boolean).join(' ');
      if (!requestedPointId) requestedPointId=linkedOrder.point_id;
    }
    if (!deviceDescription) return json(request,{error:'DEVICE_REQUIRED',message:'Podaj urządzenie, którego dotyczy wycena.'},400);

    const requestedPoint = (await q("SELECT id,name,city FROM points WHERE id=$1 AND active=true LIMIT 1",[requestedPointId])).rows[0];
    if (!requestedPoint) return json(request,{error:'POINT_NOT_FOUND',message:'Wybrany punkt jest niedostępny.'},400);
    const routing = await routeCustomerQuote(requestedPoint.id);
    const routedPoint = (await q("SELECT id,name,city FROM points WHERE id=$1 LIMIT 1",[routing.routedPointId])).rows[0] || requestedPoint;
    const requestId = makeId('cqr');
    await q(
      "INSERT INTO customer_quote_requests(id,customer_id,requested_point_id,routed_point_id,assigned_technician_id,service_order_id,device_description,issue_description,routing_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [requestId,customerSession.customer_id,requestedPoint.id,routing.routedPointId,routing.technicianId,serviceOrderId,deviceDescription,issueDescription,routing.routingReason]
    );
    await q(
      "INSERT INTO customer_quote_messages(id,request_id,sender_kind,body) VALUES($1,$2,'CUSTOMER',$3)",
      [makeId('cqm'),requestId,issueDescription]
    );
    if (routing.routedPointId !== requestedPoint.id) {
      await q(
        "INSERT INTO customer_quote_messages(id,request_id,sender_kind,body) VALUES($1,$2,'SYSTEM',$3)",
        [makeId('cqm'),requestId,'Zapytanie zostało automatycznie przekazane z punktu '+requestedPoint.name+' do serwisu '+routedPoint.name+'.']
      );
    }
    await q(
      "INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,point_id,metadata) VALUES($1,NULL,'CUSTOMER_QUOTE_CREATED','customer_quote_request',$2,$3,$4::jsonb)",
      [makeId('aud'),requestId,requestedPoint.id,JSON.stringify({customerId:customerSession.customer_id,routedPointId:routing.routedPointId,assignedTechnicianId:routing.technicianId||null,routingReason:routing.routingReason,clientType:'CUSTOMER_PORTAL'})]
    );
    return json(request,{ok:true,requestId,routedPointName:routedPoint.name,...(await loadCustomerPortalPayload(customerSession.customer_id))},201);
  }

  const customerQuoteMessageMatch=url.pathname.match(/^\/public\/customer-portal\/quotes\/([^/]+)\/messages$/);
  if(method==='POST'&&customerQuoteMessageMatch){
    const customerSession=await requireCustomerPortalFull(request);
    const body=await readJson(request);
    const message=cleanText(body.message,1000);
    if(!message)return json(request,{error:'MESSAGE_REQUIRED',message:'Wpisz wiadomość.'},400);
    const quote=(await q("SELECT id,status,requested_point_id FROM customer_quote_requests WHERE id=$1 AND customer_id=$2 LIMIT 1",[customerQuoteMessageMatch[1],customerSession.customer_id])).rows[0];
    if(!quote)return json(request,{error:'NOT_FOUND',message:'Nie znaleziono tego zapytania.'},404);
    if(['CLOSED','CANCELLED'].includes(quote.status))return json(request,{error:'QUOTE_CLOSED',message:'To zapytanie jest już zamknięte.'},409);
    await q("INSERT INTO customer_quote_messages(id,request_id,sender_kind,body) VALUES($1,$2,'CUSTOMER',$3)",[makeId('cqm'),quote.id,message]);
    await q("UPDATE customer_quote_requests SET status='OPEN',updated_at=now() WHERE id=$1",[quote.id]);
    await q("INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,point_id,metadata) VALUES($1,NULL,'CUSTOMER_QUOTE_MESSAGE','customer_quote_request',$2,$3,$4::jsonb)",[makeId('aud'),quote.id,quote.requested_point_id,JSON.stringify({clientType:'CUSTOMER_PORTAL'})]);
    return json(request,{ok:true,...(await loadCustomerPortalPayload(customerSession.customer_id))});
  }

  if (method === 'GET' && url.pathname === '/health') return json(request, { ok: true, service: 'LockOn ServiceOS Central API', time: nowIso() });

  if (method === 'POST' && url.pathname === '/auth/google-code') {
    const body = await readJson(request);
    try {
      const tokens = await exchangeDesktopAuthorizationCode(body, '/oauth2/callback');
      if (!tokens?.id_token) return json(request, { error:'GOOGLE_ID_TOKEN', message:'Google nie zwrócił tokena tożsamości.' }, 400);
      const profile = await verifyGoogle(String(tokens.id_token), GOOGLE_DESKTOP_CLIENT_ID);
      return json(request, await loginProfile(profile, 'DESKTOP', true));
    } catch (error) {
      if (error?.status) throw error;
      throw Object.assign(new Error('Google nie zakończył logowania.'), { status:401, code:'GOOGLE_AUTH_FAILED' });
    }
  }

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
    return json(request, {
      error: 'WEB_CODE_ONLY',
      message: 'Panel WWW można połączyć wyłącznie jednorazowym kodem z aplikacji ServiceOS.'
    }, 404);
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
      const userResult = await client.query("SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,support_enabled,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users WHERE id=$1 AND status='ACTIVE'", [result.rows[0].user_id]);
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
    const splitRaw = body.technicianSplitPercent;
    const technicianSplitPercent = requestedRole === 'TECHNICIAN'
      ? Number(splitRaw)
      : null;
    if (!pointName || !city || !REQUESTABLE_ROLES.has(requestedRole)) return json(request, { error: 'VALIDATION', message: 'Nieprawidłowe zgłoszenie punktu.' }, 400);
    if (requestedRole === 'TECHNICIAN' && (!Number.isFinite(technicianSplitPercent) || technicianSplitPercent < 0 || technicianSplitPercent > 100)) {
      return json(request, { error: 'TECHNICIAN_SPLIT', message: 'Ustaw swój procent rozliczenia serwisanta od 0 do 100%.' }, 400);
    }
    await q("UPDATE access_requests SET status='REJECTED',resolved_at=now(),note='Zastąpione nowszym zgłoszeniem' WHERE user_id=$1 AND status='PENDING'", [session.user.id]);
    await q(
      "INSERT INTO access_requests(id,user_id,point_name,city,requested_role_code,technician_split_percent,status,requested_at) VALUES($1,$2,$3,$4,$5,$6,'PENDING',now())",
      [makeId('acr'), session.user.id, pointName, city, requestedRole, technicianSplitPercent]
    );
    return json(request, await authPayload(await loadUser(session.user.id)));
  }

  if (method === 'GET' && url.pathname === '/customer-accounts') {
    const session=await requireActive(request);
    requireSupportAccess(session.user);
    return json(request,await customerAccountManagementOverview(session.user,url.searchParams.get('q')||''));
  }

  const customerAccountCodeMatch=url.pathname.match(/^\/customer-accounts\/([^/]+)\/code$/);
  if(method==='POST'&&customerAccountCodeMatch){
    const session=await requireActive(request),u=session.user;
    const customer=await requireCustomerAccountAccess(u,customerAccountCodeMatch[1]);
    const body=await readJson(request);
    const rotate=body.rotate===true;
    const identity=rotate ? await rotateCustomerPortalCode(customer.id) : await ensureCustomerPortalCode(customer.id);
    let revoked=0;
    if(rotate) revoked=await revokeCustomerPortalSessions(customer.id);
    await audit(session,rotate?'CUSTOMER_CODE_ROTATED':'CUSTOMER_CODE_VIEWED','customer',customer.id,null,{revokedSessions:revoked});
    return json(request,{ok:true,code:identity.code,created:identity.created===true,rotated:rotate,revoked});
  }

  const customerAccountSendCodeMatch=url.pathname.match(/^\/customer-accounts\/([^/]+)\/send-code$/);
  if(method==='POST'&&customerAccountSendCodeMatch){
    const session=await requireActive(request),u=session.user;
    const customer=await requireCustomerAccountAccess(u,customerAccountSendCodeMatch[1]);
    if(!customer.email)return json(request,{error:'CUSTOMER_EMAIL_REQUIRED',message:'Klient nie ma zapisanego adresu e-mail.'},409);
    const identity=await ensureCustomerPortalCode(customer.id);
    const account=await customerPortalAccount(customer.id);
    const point=(await q(
      "SELECT COALESCE((SELECT COALESCE(s.current_point_id,s.home_point_id,s.point_id) FROM service_orders s WHERE s.customer_id=$1 ORDER BY s.updated_at DESC LIMIT 1),(SELECT r.routed_point_id FROM customer_quote_requests r WHERE r.customer_id=$1 ORDER BY r.updated_at DESC LIMIT 1)) AS point_id",
      [customer.id]
    )).rows[0];
    if(!point?.point_id)return json(request,{error:'CUSTOMER_POINT_REQUIRED',message:'Nie znaleziono punktu powiązanego z tym klientem.'},409);
    await requirePoint(u,point.point_id);
    const sender=await loadActiveMailSender(point.point_id);
    if(!sender)return json(request,{error:'NO_SENDER',message:'Brak aktywnego nadawcy Gmail dla punktu klienta.'},409);
    const settings=await mailSettingsForPoint(point.point_id);
    const portalUrl=PUBLIC_PORTAL_URL+'/klient.html';
    const googleUrl=portalUrl+'?google=1';
    const name=[customer.first_name,customer.last_name].filter(Boolean).join(' ');
    const subject='LockOn ServiceOS · Twój dostęp do portalu klienta';
    const textBody=
      'Dzień dobry'+(name?' '+name:'')+'.\n\n'+
      'Twój kod klienta: '+identity.code+'\n'+
      'Portal: '+portalUrl+'\n\n'+
      (account?.google_sub?'Masz połączone konto Google. Możesz też zalogować się bez kodu: '+googleUrl+'\n\n':'')+
      'Kod daje dostęp tylko do podglądu. Pełne konto Google pozwala pisać do serwisu i zmieniać ustawienia powiadomień.';
    const htmlBody='<!doctype html><html lang="pl"><body style="margin:0;background:#0b0d10;color:#f3f5f7;font-family:Arial,sans-serif">'+
      '<div style="max-width:560px;margin:auto;padding:28px 14px"><div style="font-size:13px;font-weight:800">LockOn <span style="color:#77818c;font-weight:500">ServiceOS</span></div>'+
      '<div style="margin-top:18px;padding:24px;border:1px solid #252d35;border-radius:18px;background:#11161c"><div style="font-size:11px;color:#ff8b60;font-weight:800;letter-spacing:.08em">PORTAL KLIENTA</div>'+
      '<h1 style="font-size:24px;margin:9px 0 8px">Twój kod do portalu</h1><p style="color:#909ba5;font-size:14px;line-height:1.55">Kod pozwala szybko sprawdzić zlecenia i wyceny.</p>'+
      '<div style="margin:18px 0;padding:15px;border-radius:12px;background:#0a0f14;border:1px solid #2a333c;font-size:20px;font-weight:800;letter-spacing:.06em">'+escapeHtml(identity.code)+'</div>'+
      '<a href="'+escapeHtml(portalUrl)+'" style="display:block;padding:14px;border-radius:12px;background:#ff7048;color:#fff;text-decoration:none;text-align:center;font-weight:800">Otwórz portal</a>'+
      (account?.google_sub?'<a href="'+escapeHtml(googleUrl)+'" style="display:block;margin-top:13px;color:#ff9a76;text-decoration:none;text-align:center;font-size:12px;font-weight:800">Nie chcę wpisywać kodu — zaloguj przez Google →</a>':'')+
      '<p style="margin:18px 0 0;color:#707b86;font-size:11px;line-height:1.5">Pełne konto Google daje możliwość pisania do serwisu i ustawienia własnych powiadomień.</p></div></div></body></html>';
    const sent=await sendGmail(sender,customer.email,subject,textBody,htmlBody,settings.sender_display_name||'LockOn ServiceOS');
    await audit(session,'CUSTOMER_CODE_SENT','customer',customer.id,point.point_id,{recipient:customer.email,messageId:sent.id,googleLinked:Boolean(account?.google_sub)});
    return json(request,{ok:true,recipient:customer.email,messageId:sent.id});
  }

  const customerAccountBlockMatch=url.pathname.match(/^\/customer-accounts\/([^/]+)\/block$/);
  if(method==='POST'&&customerAccountBlockMatch){
    const session=await requireActive(request),u=session.user;
    const customer=await requireCustomerAccountAccess(u,customerAccountBlockMatch[1]);
    const body=await readJson(request),blocked=body.blocked===true,reason=cleanText(body.reason,500);
    await q(
      "INSERT INTO customer_portal_accounts(customer_id,blocked_at,blocked_reason,blocked_by_user_id,updated_at) VALUES($1,CASE WHEN $2 THEN now() ELSE NULL END,CASE WHEN $2 THEN NULLIF($3,'') ELSE NULL END,CASE WHEN $2 THEN $4 ELSE NULL END,now()) ON CONFLICT(customer_id) DO UPDATE SET blocked_at=CASE WHEN $2 THEN now() ELSE NULL END,blocked_reason=CASE WHEN $2 THEN NULLIF($3,'') ELSE NULL END,blocked_by_user_id=CASE WHEN $2 THEN $4 ELSE NULL END,updated_at=now()",
      [customer.id,blocked,reason,u.id]
    );
    const revoked=blocked?await revokeCustomerPortalSessions(customer.id):0;
    await audit(session,blocked?'CUSTOMER_ACCOUNT_BLOCKED':'CUSTOMER_ACCOUNT_UNBLOCKED','customer',customer.id,null,{reason:reason||null,revokedSessions:revoked});
    return json(request,{ok:true,blocked,revoked});
  }

  const customerAccountLogoutMatch=url.pathname.match(/^\/customer-accounts\/([^/]+)\/logout-all$/);
  if(method==='POST'&&customerAccountLogoutMatch){
    const session=await requireActive(request),u=session.user;
    const customer=await requireCustomerAccountAccess(u,customerAccountLogoutMatch[1]);
    const revoked=await revokeCustomerPortalSessions(customer.id);
    await audit(session,'CUSTOMER_SESSIONS_REVOKED','customer',customer.id,null,{revokedSessions:revoked});
    return json(request,{ok:true,revoked});
  }

  if (method === 'GET' && url.pathname === '/admin/overview') {
    const session = await requireActive(request);
    if (session.user.role_code !== 'OWNER') throw Object.assign(new Error('Brak uprawnień.'), { status: 403 });
    const [points, users, loginEvents, pendingRevenue, sessions, recentAudit, transferSummary] = await Promise.all([
      q("SELECT p.id,p.name,p.city,p.active,p.service_enabled,p.accepts_external_repairs,p.external_repairs_paused,p.service_note,coalesce(t.active_technician_count,0)::int AS active_technician_count,(p.service_enabled OR coalesce(t.active_technician_count,0)>0) AS effective_service_enabled,(NOT p.external_repairs_paused AND (coalesce(t.active_technician_count,0)>0 OR (p.service_enabled AND p.accepts_external_repairs))) AS effective_accepts_external_repairs FROM points p LEFT JOIN LATERAL (SELECT count(*)::int AS active_technician_count FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=p.id AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL) t ON true ORDER BY p.name"),
      q("SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,support_enabled,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users ORDER BY created_at DESC"),
      q("SELECT a.id,a.actor_user_id AS user_id,u.email,u.name,u.role_code AS role,u.status,a.created_at FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.action LIKE 'LOGIN_%' ORDER BY a.created_at DESC LIMIT 100"),
      q("SELECT r.*,u.name AS technician_name,u.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users u ON u.id=r.user_id JOIN points p ON p.id=r.point_id WHERE r.status='PENDING' ORDER BY r.created_at DESC"),
      q("SELECT client_type,count(*)::int AS count FROM auth_sessions WHERE revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now() GROUP BY client_type"),
      q("SELECT a.id,a.action,a.entity_type,a.entity_id,a.point_id,a.metadata,a.created_at,u.name AS actor_name,u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 80"),
      q("SELECT status,count(*)::int AS count FROM service_order_transfers GROUP BY status")
    ]);
    const mappedUsers = [];
    for (const user of users.rows) mappedUsers.push(await publicUser(user));
    const revenues = pendingRevenue.rows.map((r) => ({
      id:r.id,userId:r.user_id,pointId:r.point_id,amount:Number(r.amount),workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,
      splitTechnicianPercent:Number(r.technician_percent ?? 50),splitBossPercent:100-Number(r.technician_percent ?? 50),technicianShare:0,bossShare:0,submittedAt:r.created_at,reviewedAt:r.approved_at||null,
      technician:{id:r.user_id,name:r.technician_name,email:r.technician_email},point:{id:r.point_id,name:r.point_name,city:r.point_city,active:r.point_active}
    }));
    const sessionCounts=Object.fromEntries(sessions.rows.map((row)=>[row.client_type,Number(row.count)]));
    const transferCounts=Object.fromEntries(transferSummary.rows.map((row)=>[row.status,Number(row.count)]));
    return json(request, {
      points: points.rows.map(pointView),
      users: mappedUsers,
      pendingUsers: mappedUsers.filter((u) => u.status === 'PENDING' && !u.blocked),
      blockedUsers: mappedUsers.filter((u) => u.blocked),
      loginEvents: loginEvents.rows.map((e) => ({id:e.id,userId:e.user_id,email:e.email||'',name:e.name||'',role:e.role||null,status:e.status||'PENDING',pointIds:[],createdAt:e.created_at})),
      pendingRevenue: revenues,
      system: {
        activeSessions: Object.values(sessionCounts).reduce((sum,value)=>sum+Number(value||0),0),
        desktopSessions: Number(sessionCounts.DESKTOP||0),
        webSessions: Number(sessionCounts.WEB||0),
        servicePoints: points.rows.filter((point)=>point.effective_service_enabled===true).length,
        openTransfers: Number(transferCounts.REQUESTED||0)+Number(transferCounts.IN_TRANSIT||0)+Number(transferCounts.DELIVERED||0),
        blockedUsers: mappedUsers.filter((u)=>u.blocked).length
      },
      transferSummary: transferCounts,
      recentAudit: recentAudit.rows.map((row)=>({
        id:row.id,
        action:row.action,
        entityType:row.entity_type,
        entityId:row.entity_id||null,
        pointId:row.point_id||null,
        actorName:row.actor_name||row.actor_email||'System',
        metadata:row.metadata||{},
        createdAt:row.created_at
      }))
    });
  }

  if (method === 'GET' && url.pathname === '/admin/audit') {
    const session = await requireActive(request);
    if (session.user.role_code !== 'OWNER') throw Object.assign(new Error('Brak uprawnień.'), { status: 403 });
    const params = [];
    const where = [];
    const addFilter = (value, expression) => {
      params.push(value);
      where.push(expression.replace('?', '$' + params.length));
    };
    const userId = cleanText(url.searchParams.get('userId'), 80);
    const pointId = cleanText(url.searchParams.get('pointId'), 80);
    const action = cleanText(url.searchParams.get('action'), 120);
    const orderNumber = Number(url.searchParams.get('orderNumber') || 0);
    const dateFromRaw = cleanText(url.searchParams.get('dateFrom'), 40);
    const dateToRaw = cleanText(url.searchParams.get('dateTo'), 40);
    if (userId) addFilter(userId, 'a.actor_user_id=?');
    if (pointId) addFilter(pointId, 'a.point_id=?');
    if (action) addFilter('%' + action + '%', 'a.action ILIKE ?');
    if (Number.isInteger(orderNumber) && orderNumber > 0) addFilter(orderNumber, 'COALESCE(s.order_number,sn.order_number,sr.order_number)=?');
    if (dateFromRaw) {
      const parsed = new Date(dateFromRaw);
      if (!Number.isNaN(parsed.getTime())) addFilter(parsed.toISOString(), 'a.created_at>=?::timestamptz');
    }
    if (dateToRaw) {
      const parsed = new Date(dateToRaw);
      if (!Number.isNaN(parsed.getTime())) {
        parsed.setUTCHours(23,59,59,999);
        addFilter(parsed.toISOString(), 'a.created_at<=?::timestamptz');
      }
    }
    const sql =
      "SELECT a.id,a.actor_user_id,a.action,a.entity_type,a.entity_id,a.point_id,a.metadata,a.created_at," +
      "u.name AS actor_name,u.email AS actor_email,u.role_code AS actor_role,p.name AS point_name," +
      "target_u.name AS target_user_name,target_u.email AS target_user_email,target_p.name AS target_point_name," +
      "COALESCE(s.order_number,sn.order_number,sr.order_number,sq.order_number) AS order_number," +
      "trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')) AS customer_name," +
      "trim(coalesce(d.brand,'')||' '||coalesce(d.model,'')) AS device_name," +
      "n.status AS notification_status,tr.status AS transfer_status,r.status AS settlement_status " +
      "FROM audit_log a " +
      "LEFT JOIN users u ON u.id=a.actor_user_id " +
      "LEFT JOIN points p ON p.id=a.point_id " +
      "LEFT JOIN users target_u ON a.entity_type='user' AND target_u.id=a.entity_id " +
      "LEFT JOIN points target_p ON a.entity_type='point' AND target_p.id=a.entity_id " +
      "LEFT JOIN service_orders s ON a.entity_type='service_order' AND s.id=a.entity_id " +
      "LEFT JOIN notification_outbox n ON a.entity_type='notification' AND n.id=a.entity_id " +
      "LEFT JOIN service_orders sn ON sn.id=n.service_order_id " +
      "LEFT JOIN revenue_entries r ON a.entity_type='revenue' AND r.id=a.entity_id " +
      "LEFT JOIN service_orders sr ON sr.id=r.service_order_id " +
      "LEFT JOIN customer_quote_requests cq ON a.entity_type='customer_quote_request' AND cq.id=a.entity_id " +
      "LEFT JOIN service_orders sq ON sq.id=cq.service_order_id " +
      "LEFT JOIN service_order_transfers tr ON tr.id=(a.metadata->>'transferId') " +
      "LEFT JOIN customers c ON c.id=COALESCE(s.customer_id,sn.customer_id,sr.customer_id,cq.customer_id) " +
      "LEFT JOIN devices d ON d.id=COALESCE(s.device_id,sn.device_id,sr.device_id,sq.device_id) " +
      (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
      "ORDER BY a.created_at DESC LIMIT 300";
    const { rows } = await q(sql, params);
    return json(request, {
      events: rows.map((row) => {
        const metadata = row.metadata || {};
        const actionTransferStatus = String(row.action || '').startsWith('SERVICE_TRANSFER_')
          ? String(row.action).slice('SERVICE_TRANSFER_'.length)
          : null;
        return {
          id: row.id,
          actorUserId: row.actor_user_id || null,
          actorName: row.actor_name || row.actor_email || 'System',
          actorEmail: row.actor_email || null,
          actorRole: row.actor_role || metadata.actorRole || null,
          pointId: row.point_id || null,
          pointName: row.point_name || null,
          entityType: row.entity_type,
          entityId: row.entity_id || null,
          entityName: row.target_user_name || row.target_user_email || row.target_point_name || null,
          action: row.action,
          before: metadata.before ?? metadata.from ?? null,
          after: metadata.after ?? metadata.to ?? null,
          orderNumber: row.order_number == null ? null : Number(row.order_number),
          customerSummary: cleanText(row.customer_name, 160) || null,
          deviceSummary: cleanText(row.device_name, 160) || null,
          notificationStatus: row.notification_status || metadata?.notification?.status || (metadata?.notification?.sent ? 'SENT' : null),
          transferStatus: row.transfer_status || metadata.transferStatus || actionTransferStatus,
          settlementStatus: row.settlement_status || metadata.settlementStatus || null,
          clientType: metadata.clientType || null,
          metadata,
          createdAt: row.created_at
        };
      })
    });
  }

  if (method === 'POST' && url.pathname === '/admin/points') {
    const session = await requireActive(request);
    if (session.user.role_code !== 'OWNER') throw Object.assign(new Error('Brak uprawnień.'), { status: 403 });
    const body = await readJson(request);
    const name = cleanText(body.name, 90), city = cleanText(body.city, 90);
    const serviceEnabled=body.serviceEnabled===true;
    const acceptsExternalRepairs=serviceEnabled&&body.acceptsExternalRepairs===true;
    const serviceNote=cleanText(body.serviceNote,500);
    if (!name || !city) return json(request, { error:'VALIDATION',message:'Wpisz nazwę punktu i miasto.' }, 400);
    let result = await q("SELECT p.id,p.name,p.city,p.active,p.service_enabled,p.accepts_external_repairs,p.external_repairs_paused,p.service_note,coalesce(t.active_technician_count,0)::int AS active_technician_count,(p.service_enabled OR coalesce(t.active_technician_count,0)>0) AS effective_service_enabled,(NOT p.external_repairs_paused AND (coalesce(t.active_technician_count,0)>0 OR (p.service_enabled AND p.accepts_external_repairs))) AS effective_accepts_external_repairs FROM points p LEFT JOIN LATERAL (SELECT count(*)::int AS active_technician_count FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=p.id AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL) t ON true WHERE lower(p.name)=lower($1) AND lower(p.city)=lower($2) LIMIT 1",[name,city]);
    if (result.rows[0]) return json(request, pointView(result.rows[0]));
    const pointId=makeId('pnt');
    result=await q("INSERT INTO points(id,name,city,active,service_enabled,accepts_external_repairs,external_repairs_paused,service_note) VALUES($1,$2,$3,true,$4,$5,false,NULLIF($6,'')) RETURNING id,name,city,active,service_enabled,accepts_external_repairs,external_repairs_paused,service_note",[pointId,name,city,serviceEnabled,acceptsExternalRepairs,serviceNote]);
    await audit(session,'POINT_CREATED','point',pointId,pointId,{serviceEnabled,acceptsExternalRepairs});
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
    const supportEnabled=body.supportEnabled===true;
    if(!REQUESTABLE_ROLES.has(role)) return json(request,{error:'ROLE'},400);
    let pointIds=Array.isArray(body.pointIds)?body.pointIds.map(String):[];
    const req=await loadRequestedPoint(target.id);
    const technicianSplitPercent = role==='TECHNICIAN' && req?.requestedRole==='TECHNICIAN'
      ? req.technicianSplitPercent
      : (target.technician_split_percent == null ? null : Number(target.technician_split_percent));
    if(body.createRequestedPoint===true){
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
      await client.query(
        "UPDATE users SET role_code=$1,technician_split_percent=CASE WHEN $1='TECHNICIAN' THEN $2 ELSE technician_split_percent END,support_enabled=$3,status='ACTIVE',updated_at=now() WHERE id=$4",
        [role,technicianSplitPercent,supportEnabled,target.id]
      );
      await client.query('DELETE FROM user_point_access WHERE user_id=$1',[target.id]);
      if(!GLOBAL_ROLES.has(role)) for(const pointId of pointIds) await client.query('INSERT INTO user_point_access(user_id,point_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[target.id,pointId]);
      await client.query("UPDATE access_requests SET status='APPROVED',resolved_at=now(),resolved_by_user_id=$2 WHERE user_id=$1 AND status='PENDING'",[target.id,session.user.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally{client.release();}
    await audit(session,'USER_APPROVED','user',target.id,null,{role,pointIds,technicianSplitPercent,supportEnabled});
    return json(request, await authPayload(await loadUser(target.id)));
  }

  const reject = url.pathname.match(/^\/admin\/users\/([^/]+)\/reject$/);
  if(method==='POST'&&reject){
    const session=await requireActive(request);if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const target=await loadUser(reject[1]);if(!target)return json(request,{error:'NOT_FOUND'},404);if(target.role_code==='OWNER')return json(request,{error:'OWNER_PROTECTED'},400);
    await q("UPDATE users SET role_code=NULL,status='REJECTED',updated_at=now() WHERE id=$1",[target.id]);
    await q('DELETE FROM user_point_access WHERE user_id=$1',[target.id]);
    await q("UPDATE access_requests SET status='REJECTED',resolved_at=now(),resolved_by_user_id=$2 WHERE user_id=$1 AND status='PENDING'",[target.id,session.user.id]);
    await audit(session,'USER_REJECTED','user',target.id);
    return json(request,{ok:true});
  }

  const access = url.pathname.match(/^\/admin\/users\/([^/]+)\/access$/);
  if(method==='POST'&&access){
    const session=await requireActive(request);if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const target=await loadUser(access[1]);if(!target)return json(request,{error:'NOT_FOUND'},404);if(target.role_code==='OWNER')return json(request,{error:'OWNER_PROTECTED'},400);
    const body=await readJson(request);const role=String(body.role||target.role_code||'USER').toUpperCase();const pointIds=Array.isArray(body.pointIds)?body.pointIds.map(String):[];const technicianSplitPercent=role==='TECHNICIAN'?normalizeTechnicianPercent(body.technicianSplitPercent):null;const supportEnabled=body.supportEnabled===true;
    if(!REQUESTABLE_ROLES.has(role))return json(request,{error:'ROLE'},400);if(!GLOBAL_ROLES.has(role)&&pointIds.length===0)return json(request,{error:'POINT_REQUIRED'},400);if(role==='TECHNICIAN'&&technicianSplitPercent===null)return json(request,{error:'TECHNICIAN_SPLIT',message:'Ustaw procent rozliczenia serwisanta od 0 do 100%.'},400);
    const client=await pool.connect();try{await client.query('BEGIN');await client.query("UPDATE users SET role_code=$1,technician_split_percent=CASE WHEN $1='TECHNICIAN' THEN $3 ELSE technician_split_percent END,support_enabled=$4,status='ACTIVE',updated_at=now() WHERE id=$2",[role,target.id,technicianSplitPercent,supportEnabled]);await client.query('DELETE FROM user_point_access WHERE user_id=$1',[target.id]);if(!GLOBAL_ROLES.has(role))for(const pointId of pointIds)await client.query('INSERT INTO user_point_access(user_id,point_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[target.id,pointId]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
    await audit(session,'USER_ACCESS_UPDATED','user',target.id,null,{role,pointIds,technicianSplitPercent,supportEnabled});
    return json(request,await authPayload(await loadUser(target.id)));
  }

  const pointServiceMatch=url.pathname.match(/^\/admin\/points\/([^/]+)\/service$/);
  if(method==='POST'&&pointServiceMatch){
    const session=await requireActive(request);
    if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const body=await readJson(request);
    const serviceEnabled=body.serviceEnabled===true;
    const acceptsExternalRepairs=serviceEnabled&&body.acceptsExternalRepairs===true;
    const serviceNote=cleanText(body.serviceNote,500);
    const hasPause=Object.prototype.hasOwnProperty.call(body,'externalRepairsPaused');
    const externalRepairsPaused=hasPause?body.externalRepairsPaused===true:null;
    const row=(await q("UPDATE points SET service_enabled=$1,accepts_external_repairs=$2,external_repairs_paused=CASE WHEN $3::boolean IS NULL THEN external_repairs_paused ELSE $3 END,service_note=NULLIF($4,''),updated_at=now() WHERE id=$5 RETURNING id,name,city,active,service_enabled,accepts_external_repairs,external_repairs_paused,service_note",[serviceEnabled,acceptsExternalRepairs,externalRepairsPaused,serviceNote,pointServiceMatch[1]])).rows[0];
    if(!row)return json(request,{error:'NOT_FOUND'},404);
    const techCount=Number((await q("SELECT count(*)::int AS count FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=$1 AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL",[row.id])).rows[0]?.count||0);
    row.active_technician_count=techCount;
    row.effective_service_enabled=row.service_enabled===true||techCount>0;
    row.effective_accepts_external_repairs=row.external_repairs_paused!==true&&(techCount>0||(row.service_enabled===true&&row.accepts_external_repairs===true));
    await audit(session,'POINT_SERVICE_UPDATED','point',row.id,row.id,{serviceEnabled,acceptsExternalRepairs,externalRepairsPaused:row.external_repairs_paused,activeTechnicianCount:techCount});
    return json(request,pointView(row));
  }

  const blockUserMatch=url.pathname.match(/^\/admin\/users\/([^/]+)\/block$/);
  if(method==='POST'&&blockUserMatch){
    const session=await requireActive(request);
    if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const target=await loadUser(blockUserMatch[1]);
    if(!target)return json(request,{error:'NOT_FOUND'},404);
    if(target.role_code==='OWNER')return json(request,{error:'OWNER_PROTECTED',message:'Konta OWNER nie można zablokować.'},400);
    const body=await readJson(request),blocked=body.blocked!==false,reason=cleanText(body.reason,500);
    if(blocked){
      await q("UPDATE users SET blocked_at=now(),blocked_reason=NULLIF($1,''),blocked_by_user_id=$2,updated_at=now() WHERE id=$3",[reason,session.user.id,target.id]);
      await q("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL",[target.id]);
      await audit(session,'USER_BLOCKED','user',target.id,null,{reason:reason||null});
    }else{
      await q("UPDATE users SET blocked_at=NULL,blocked_reason=NULL,blocked_by_user_id=NULL,updated_at=now() WHERE id=$1",[target.id]);
      await audit(session,'USER_UNBLOCKED','user',target.id);
    }
    return json(request,await publicUser(await loadUser(target.id)));
  }

  const logoutUserMatch=url.pathname.match(/^\/admin\/users\/([^/]+)\/logout-all$/);
  if(method==='POST'&&logoutUserMatch){
    const session=await requireActive(request);
    if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const target=await loadUser(logoutUserMatch[1]);
    if(!target)return json(request,{error:'NOT_FOUND'},404);
    const keepCurrent=target.id===session.user.id?session.sessionId:null;
    const result=keepCurrent
      ? await q("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND id<>$2",[target.id,keepCurrent])
      : await q("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[target.id]);
    await audit(session,'USER_SESSIONS_REVOKED','user',target.id,null,{revoked:Number(result.rowCount||0)});
    return json(request,{ok:true,revoked:Number(result.rowCount||0)});
  }

  if(method==='POST'&&url.pathname==='/admin/logout-all'){
    const session=await requireActive(request);
    if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const body=await readJson(request);
    const exceptCurrent=body.exceptCurrent!==false;
    const result=exceptCurrent
      ? await q("UPDATE auth_sessions SET revoked_at=now() WHERE revoked_at IS NULL AND id<>$1",[session.sessionId])
      : await q("UPDATE auth_sessions SET revoked_at=now() WHERE revoked_at IS NULL");
    await audit(session,'ALL_SESSIONS_REVOKED','session',null,null,{revoked:Number(result.rowCount||0),exceptCurrent});
    return json(request,{ok:true,revoked:Number(result.rowCount||0),exceptCurrent});
  }


  if(method==='GET'&&url.pathname==='/admin/factory-reset/preview'){
    const session=await requireActive(request);
    if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Tylko OWNER może sprawdzić factory reset.'),{status:403,code:'OWNER_ONLY'});
    const counts=(await q(
      "SELECT jsonb_build_object(" +
      "'points',(SELECT count(*) FROM points)," +
      "'users',(SELECT count(*) FROM users)," +
      "'serviceOrders',(SELECT count(*) FROM service_orders)," +
      "'transfers',(SELECT count(*) FROM service_order_transfers)," +
      "'customers',(SELECT count(*) FROM customers)," +
      "'devices',(SELECT count(*) FROM devices)," +
      "'revenues',(SELECT count(*) FROM revenue_entries)," +
      "'sessions',(SELECT count(*) FROM auth_sessions)," +
      "'notifications',(SELECT count(*) FROM notification_outbox)" +
      ") AS counts"
    )).rows[0]?.counts||{};
    return json(request,{ok:true,counts});
  }

  if(method==='POST'&&url.pathname==='/admin/factory-reset'){
    const session=await requireActive(request);
    if(session.user.role_code!=='OWNER')throw Object.assign(new Error('Tylko OWNER może wykonać reset danych.'),{status:403,code:'OWNER_ONLY'});
    const body=await readJson(request);
    const phrase=String(body.phrase||'');
    const confirmed=body.confirmed===true;
    const reason=cleanText(body.reason,500);
    if(phrase!=='USUŃ WSZYSTKIE DANE'){
      return json(request,{error:'CONFIRMATION_PHRASE',message:'Wpisz dokładnie: USUŃ WSZYSTKIE DANE'},400);
    }
    if(!confirmed){
      return json(request,{error:'SECOND_CONFIRMATION_REQUIRED',message:'Wymagane jest drugie potwierdzenie resetu.'},400);
    }

    const resetId=makeId('rst');
    await q(
      "INSERT INTO system_reset_log(id,actor_email,actor_name,client_type,reason,status) VALUES($1,$2,NULLIF($3,''),$4,NULLIF($5,''),'REQUESTED')",
      [resetId,session.user.email,session.user.name||'',session.clientType||'',reason]
    );

    const client=await pool.connect();
    const deleted={};
    try{
      await client.query('BEGIN');
      const remove=async(table)=>{
        const result=await client.query('DELETE FROM '+table);
        deleted[table]=Number(result.rowCount||0);
      };
      await remove('notification_outbox');
      await remove('revenue_entries');
      await remove('service_order_notes');
      await remove('service_order_status_history');
      await remove('service_order_transfers');
      await remove('service_orders');
      await remove('devices');
      await remove('customers');
      await remove('settlements');
      await remove('point_email_senders');
      await remove('point_notification_settings');
      await remove('support_messages');
      await remove('support_conversations');
      await remove('website_auth_codes');
      await remove('access_requests');
      await remove('user_point_access');
      await remove('auth_sessions');
      await remove('audit_log');
      await remove('users');
      await remove('points');

      const remaining=(await client.query(
        "SELECT jsonb_build_object(" +
        "'points',(SELECT count(*) FROM points)," +
        "'users',(SELECT count(*) FROM users)," +
        "'service_orders',(SELECT count(*) FROM service_orders)," +
        "'service_order_transfers',(SELECT count(*) FROM service_order_transfers)," +
        "'service_order_notes',(SELECT count(*) FROM service_order_notes)," +
        "'service_order_status_history',(SELECT count(*) FROM service_order_status_history)," +
        "'customers',(SELECT count(*) FROM customers)," +
        "'devices',(SELECT count(*) FROM devices)," +
        "'revenue_entries',(SELECT count(*) FROM revenue_entries)," +
        "'settlements',(SELECT count(*) FROM settlements)," +
        "'point_email_senders',(SELECT count(*) FROM point_email_senders)," +
        "'point_notification_settings',(SELECT count(*) FROM point_notification_settings)," +
        "'support_conversations',(SELECT count(*) FROM support_conversations)," +
        "'support_messages',(SELECT count(*) FROM support_messages)," +
        "'website_auth_codes',(SELECT count(*) FROM website_auth_codes)," +
        "'access_requests',(SELECT count(*) FROM access_requests)," +
        "'user_point_access',(SELECT count(*) FROM user_point_access)," +
        "'notification_outbox',(SELECT count(*) FROM notification_outbox)," +
        "'audit_log',(SELECT count(*) FROM audit_log)," +
        "'auth_sessions',(SELECT count(*) FROM auth_sessions)" +
        ") AS counts"
      )).rows[0]?.counts||{};
      const leftovers=Object.entries(remaining).filter(([,value])=>Number(value)!==0);
      if(leftovers.length){
        throw new Error('Factory reset verification failed: '+leftovers.map(([key,value])=>key+'='+value).join(', '));
      }

      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>undefined);
      const message=cleanText(error instanceof Error?error.message:error,500);
      await q("UPDATE system_reset_log SET status='FAILED',error=$2,deleted_counts=$3::jsonb,completed_at=now() WHERE id=$1",[resetId,message,JSON.stringify(deleted)]).catch(()=>undefined);
      throw Object.assign(new Error('Factory reset nie został wykonany. Dane pozostają bez zmian.'),{status:500,code:'FACTORY_RESET_FAILED'});
    }finally{
      client.release();
    }

    await q("UPDATE system_reset_log SET status='COMPLETED',deleted_counts=$2::jsonb,error=NULL,completed_at=now() WHERE id=$1",[resetId,JSON.stringify(deleted)]);
    return json(request,{ok:true,resetId,reloginRequired:true,deleted});
  }

  if(method==='GET'&&url.pathname==='/finance/technician-settings'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code!=='TECHNICIAN')throw Object.assign(new Error('Ustawienia rozliczenia są dostępne dla serwisanta.'),{status:403});
    const row=(await q("SELECT technician_split_percent FROM users WHERE id=$1 LIMIT 1",[u.id])).rows[0];
    const technicianPercent=normalizeTechnicianPercent(row?.technician_split_percent);
    return json(request,{
      configured:technicianPercent!==null,
      technicianPercent,
      bossPercent:technicianPercent===null?null:Math.round((100-technicianPercent)*100)/100
    });
  }

  if(method==='POST'&&url.pathname==='/finance/technician-settings'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code!=='TECHNICIAN')throw Object.assign(new Error('Ustawienia rozliczenia są dostępne dla serwisanta.'),{status:403});
    const body=await readJson(request);
    const technicianPercent=normalizeTechnicianPercent(body.technicianPercent);
    if(technicianPercent===null)return json(request,{error:'TECHNICIAN_SPLIT',message:'Ustaw procent serwisanta od 0 do 100%.'},400);
    await q("UPDATE users SET technician_split_percent=$1,updated_at=now() WHERE id=$2",[technicianPercent,u.id]);
    await audit(session,'TECHNICIAN_SETTLEMENT_UPDATED','user',u.id,null,{technicianPercent,bossPercent:Math.round((100-technicianPercent)*100)/100});
    return json(request,{configured:true,technicianPercent,bossPercent:Math.round((100-technicianPercent)*100)/100});
  }

  if(method==='GET'&&url.pathname==='/finance/revenues'){
    const session=await requireActive(request);const u=session.user;
    if(u.role_code==='USER')throw Object.assign(new Error('Brak uprawnień do rozliczeń.'),{status:403});
    const baseSelect="SELECT r.*,usr.name AS technician_name,usr.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active,so.order_number FROM revenue_entries r JOIN users usr ON usr.id=r.user_id JOIN points p ON p.id=r.point_id LEFT JOIN service_orders so ON so.id=r.service_order_id ";
    let rows;
    if(GLOBAL_ROLES.has(u.role_code)) rows=(await q(baseSelect+"ORDER BY r.occurred_at DESC,r.created_at DESC")).rows;
    else if(u.role_code==='TECHNICIAN') rows=(await q(baseSelect+"WHERE r.user_id=$1 ORDER BY r.occurred_at DESC,r.created_at DESC",[u.id])).rows;
    else rows=(await q(baseSelect+"JOIN user_point_access a ON a.point_id=r.point_id AND a.user_id=$1 ORDER BY r.occurred_at DESC,r.created_at DESC",[u.id])).rows;
    const entries=rows.map((r)=>{
      const amount=Number(r.amount);
      const approved=r.status==='APPROVED'||r.status==='SETTLED';
      const split=splitRevenueAmount(amount,r.technician_percent);
      return{
        id:r.id,userId:r.user_id,pointId:r.point_id,serviceOrderId:r.service_order_id||null,
        orderNumber:r.order_number==null?null:Number(r.order_number),
        amount,workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,
        splitTechnicianPercent:split.technicianPercent,splitBossPercent:split.bossPercent,
        technicianShare:approved?split.technicianShare:0,bossShare:approved?split.bossShare:0,
        submittedAt:r.created_at,reviewedAt:r.approved_at||null,
        technician:{id:r.user_id,name:r.technician_name,email:r.technician_email},
        point:{id:r.point_id,name:r.point_name,city:r.point_city,active:r.point_active}
      };
    });
    const approved=entries.filter((e)=>e.status==='APPROVED'||e.status==='SETTLED');
    const pending=entries.filter((e)=>e.status==='PENDING');
    const pointMap=new Map();
    for(const entry of entries){
      let bucket=pointMap.get(entry.pointId);
      if(!bucket){
        bucket={pointId:entry.pointId,pointName:entry.point?.name||'Punkt',pointCity:entry.point?.city||'',approvedRevenue:0,technicianShare:0,bossShare:0,pendingRevenue:0,entries:[]};
        pointMap.set(entry.pointId,bucket);
      }
      bucket.entries.push(entry);
      if(entry.status==='APPROVED'||entry.status==='SETTLED'){
        bucket.approvedRevenue+=entry.amount;
        bucket.technicianShare+=entry.technicianShare;
        bucket.bossShare+=entry.bossShare;
      }else if(entry.status==='PENDING'){
        bucket.pendingRevenue+=entry.amount;
      }
    }
    const points=[...pointMap.values()].map((point)=>({
      ...point,
      approvedRevenue:Math.round(point.approvedRevenue*100)/100,
      technicianShare:Math.round(point.technicianShare*100)/100,
      bossShare:Math.round(point.bossShare*100)/100,
      pendingRevenue:Math.round(point.pendingRevenue*100)/100
    })).sort((a,b)=>a.pointName.localeCompare(b.pointName,'pl'));
    return json(request,{
      entries,
      points,
      summary:{
        approvedRevenue:approved.reduce((s,e)=>s+e.amount,0),
        technicianShare:approved.reduce((s,e)=>s+e.technicianShare,0),
        bossShare:approved.reduce((s,e)=>s+e.bossShare,0),
        pendingRevenue:pending.reduce((s,e)=>s+e.amount,0)
      }
    });
  }

  if(method==='POST'&&url.pathname==='/finance/revenues'){
    const session=await requireActive(request);if(session.user.role_code!=='TECHNICIAN')throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const body=await readJson(request),amount=Number(body.amount),pointId=String(body.pointId||''),note=cleanText(body.note,700),workDate=cleanText(body.workDate,20)||new Date().toISOString().slice(0,10);
    if(!Number.isFinite(amount)||amount<=0)return json(request,{error:'AMOUNT'},400);await requirePoint(session.user,pointId);
    const rounded=Math.round(amount*100)/100;
    const profile=(await q("SELECT technician_split_percent FROM users WHERE id=$1 LIMIT 1",[session.user.id])).rows[0];
    const technicianPercent=normalizeTechnicianPercent(profile?.technician_split_percent);
    if(technicianPercent===null)return json(request,{error:'SETTLEMENT_REQUIRED',message:'Najpierw ustaw swoje rozliczenie serwisanta w sekcji Rozliczenia.'},409);
    const split=splitRevenueAmount(rounded,technicianPercent);
    const id=makeId('rev');
    const row=(await q("INSERT INTO revenue_entries(id,point_id,user_id,amount,currency,category,technician_percent,status,note,occurred_at,approved_by_user_id,approved_at) VALUES($1,$2,$3,$4,'PLN','SERVICE',$5,'APPROVED',$6,$7,$3,now()) RETURNING created_at,approved_at",[id,pointId,session.user.id,rounded,technicianPercent,note,new Date(workDate+'T12:00:00Z')])).rows[0];
    await audit(session,'REVENUE_AUTO_APPROVED','revenue',id,pointId,{amount:rounded,manual:true,technicianPercent,settlementStatus:'APPROVED'});
    return json(request,{id,userId:session.user.id,pointId,serviceOrderId:null,amount:rounded,workDate,note,status:'APPROVED',splitTechnicianPercent:split.technicianPercent,splitBossPercent:split.bossPercent,technicianShare:split.technicianShare,bossShare:split.bossShare,submittedAt:row.created_at,reviewedAt:row.approved_at},201);
  }

  const review=url.pathname.match(/^\/finance\/revenues\/([^/]+)\/review$/);
  if(method==='POST'&&review){
    const session=await requireActive(request);if(!GLOBAL_ROLES.has(session.user.role_code))throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const body=await readJson(request),action=String(body.action||'');if(!['APPROVE','REJECT'].includes(action))return json(request,{error:'ACTION'},400);
    const result=await q("UPDATE revenue_entries SET status=$1,approved_by_user_id=$2,approved_at=now() WHERE id=$3 RETURNING *",[action==='APPROVE'?'APPROVED':'REJECTED',session.user.id,review[1]]);
    if(!result.rows[0])return json(request,{error:'NOT_FOUND'},404);
    const r=result.rows[0],amount=Number(r.amount),approved=r.status==='APPROVED';const split=splitRevenueAmount(amount,r.technician_percent);
    await audit(session,'REVENUE_REVIEWED','revenue',r.id,r.point_id,{after:r.status,amount,technicianPercent:split.technicianPercent,settlementStatus:r.status});
    return json(request,{id:r.id,userId:r.user_id,pointId:r.point_id,serviceOrderId:r.service_order_id||null,amount,workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,splitTechnicianPercent:split.technicianPercent,splitBossPercent:split.bossPercent,technicianShare:approved?split.technicianShare:0,bossShare:approved?split.bossShare:0,submittedAt:r.created_at,reviewedAt:r.approved_at});
  }

  if(method==='GET'&&url.pathname==='/dashboard'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code==='USER')return json(request,{pointCount:0,activeUsers:0,pendingUsers:0,approvedRevenue:0,pendingRevenue:0,bossShare:0,technicianShare:0});
    const ids=await visiblePointIds(u);
    const revenue=(await q("SELECT amount,status,user_id,technician_percent FROM revenue_entries WHERE point_id=ANY($1::text[])",[ids])).rows;
    const users=(await q("SELECT COUNT(DISTINCT u.id)::int AS count FROM users u LEFT JOIN user_point_access a ON a.user_id=u.id WHERE u.status='ACTIVE' AND ($2::boolean OR a.point_id=ANY($1::text[]))",[ids,GLOBAL_ROLES.has(u.role_code)])).rows[0].count;
    const approved=revenue.filter((r)=>r.status==='APPROVED'||r.status==='SETTLED'),pending=revenue.filter((r)=>r.status==='PENDING');
    const approvedSum=approved.reduce((s,r)=>s+Number(r.amount),0),pendingSum=pending.reduce((s,r)=>s+Number(r.amount),0);
    const technicianShareAll=approved.reduce((sum,row)=>sum+splitRevenueAmount(Number(row.amount),row.technician_percent).technicianShare,0);
    const bossShareAll=approved.reduce((sum,row)=>sum+splitRevenueAmount(Number(row.amount),row.technician_percent).bossShare,0);
    const technicianShareOwn=approved.filter((r)=>r.user_id===u.id).reduce((sum,row)=>sum+splitRevenueAmount(Number(row.amount),row.technician_percent).technicianShare,0);
    return json(request,{pointCount:ids.length,activeUsers:users,pendingUsers:u.role_code==='OWNER'?(await q("SELECT COUNT(*)::int AS count FROM users WHERE status='PENDING'")).rows[0].count:0,approvedRevenue:approvedSum,pendingRevenue:pendingSum,bossShare:bossShareAll,technicianShare:u.role_code==='TECHNICIAN'?technicianShareOwn:technicianShareAll});
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


  if(method==='GET'&&url.pathname==='/service/technicians'){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do listy techników.'),{status:403});
    const pointId=cleanText(url.searchParams.get('pointId'),80);
    if(!pointId)return json(request,{error:'POINT_REQUIRED',message:'Wybierz punkt.'},400);
    await requirePoint(u,pointId);
    const {rows}=await q(
      "SELECT DISTINCT usr.id,usr.name,usr.email FROM users usr JOIN user_point_access a ON a.user_id=usr.id WHERE usr.role_code='TECHNICIAN' AND usr.status='ACTIVE' AND a.point_id=$1 ORDER BY usr.name,usr.email",
      [pointId]
    );
    return json(request,rows.map((row)=>({id:row.id,name:row.name,email:row.email})));
  }

  const customerDetailMatch=url.pathname.match(/^\/service\/customers\/([^/]+)$/);
  if(method==='GET'&&customerDetailMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_READ_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do danych klientów.'),{status:403});
    const customerId=customerDetailMatch[1];
    const customer=(await q('SELECT id,first_name,last_name,email,phone,created_at,updated_at FROM customers WHERE id=$1 LIMIT 1',[customerId])).rows[0];
    if(!customer)return json(request,{error:'NOT_FOUND'},404);
    const orders=await listVisibleCustomerOrders(u,customerId);
    if(!GLOBAL_ROLES.has(u.role_code)&&orders.length===0)return json(request,{error:'NOT_FOUND'},404);
    const devices=[...new Map(orders.map((order)=>[order.deviceId,{
      id:order.deviceId,
      brand:order.brand,
      model:order.model,
      imei:order.imei||null,
      serialNumber:order.serialNumber||null,
      notes:order.deviceNotes||null
    }])).values()];
    return json(request,{
      customer:{...customerView(customer),createdAt:customer.created_at,updatedAt:customer.updated_at},
      devices,
      orders,
      totalVisibleOrders:orders.length
    });
  }

  const historyMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/history$/);
  if(method==='GET'&&historyMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_READ_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do historii zlecenia.'),{status:403});
    const order=(await q('SELECT id,point_id FROM service_orders WHERE id=$1 LIMIT 1',[historyMatch[1]])).rows[0];
    if(!order)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,order.id);
    const {rows}=await q(
      "SELECT h.id,h.from_status,h.to_status,h.note,h.created_at,h.changed_by_user_id,usr.name AS changed_by_name,usr.email AS changed_by_email FROM service_order_status_history h LEFT JOIN users usr ON usr.id=h.changed_by_user_id WHERE h.service_order_id=$1 ORDER BY h.created_at ASC,h.id ASC",
      [order.id]
    );
    return json(request,rows.map((row)=>({
      id:row.id,
      fromStatus:row.from_status||null,
      fromLabel:row.from_status?(STATUS_LABELS[row.from_status]||row.from_status):null,
      toStatus:row.to_status,
      toLabel:STATUS_LABELS[row.to_status]||row.to_status,
      note:row.note||null,
      changedAt:row.created_at,
      changedByUserId:row.changed_by_user_id||null,
      changedByName:row.changed_by_name||row.changed_by_email||'System'
    })));
  }

  const notesMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/notes$/);
  if(notesMatch&&(method==='GET'||method==='POST')){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_READ_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do notatek zlecenia.'),{status:403});
    const order=(await q('SELECT id,point_id FROM service_orders WHERE id=$1 LIMIT 1',[notesMatch[1]])).rows[0];
    if(!order)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,order.id);

    if(method==='GET'){
      if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do notatek wewnętrznych zlecenia.'),{status:403});
      const {rows}=await q(
        'SELECT n.id,n.body,n.created_at,n.author_user_id,usr.name AS author_name,usr.email AS author_email FROM service_order_notes n JOIN users usr ON usr.id=n.author_user_id WHERE n.service_order_id=$1 ORDER BY n.created_at DESC,n.id DESC',
        [order.id]
      );
      return json(request,rows.map((row)=>({
        id:row.id,
        body:row.body,
        createdAt:row.created_at,
        authorUserId:row.author_user_id,
        authorName:row.author_name||row.author_email
      })));
    }

    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do dodawania notatek.'),{status:403});
    const body=await readJson(request),note=cleanText(body.body,2000);
    if(!note)return json(request,{error:'NOTE_REQUIRED',message:'Notatka nie może być pusta.'},400);
    const id=makeId('not');
    await q('INSERT INTO service_order_notes(id,service_order_id,author_user_id,body) VALUES($1,$2,$3,$4)',[id,order.id,u.id,note]);
    await audit(session,'SERVICE_NOTE_ADDED','service_order',order.id,order.point_id,{length:note.length});
    return json(request,{id,body:note,createdAt:nowIso(),authorUserId:u.id,authorName:u.name||u.email},201);
  }

  const detailsMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/details$/);
  if(method==='POST'&&detailsMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_INTAKE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do edycji danych przyjęcia.'),{status:403});
    const found=(await q('SELECT id,point_id,home_point_id,current_point_id,handling_mode,device_id,assigned_technician_id,estimated_cost,final_cost,estimated_completion_at FROM service_orders WHERE id=$1 LIMIT 1',[detailsMatch[1]])).rows[0];
    if(!found)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,found.id);
    const detailsOpenTransfer=(await q("SELECT id FROM service_order_transfers WHERE service_order_id=$1 AND status IN ('REQUESTED','IN_TRANSIT','DELIVERED') LIMIT 1",[found.id])).rows[0]||null;
    if(detailsOpenTransfer){
      return json(request,{error:'DEVICE_IN_TRANSFER',message:'Szczegóły robocze zlecenia są zablokowane podczas transportu urządzenia.'},409);
    }
    const detailsCurrentPointId=found.current_point_id||found.home_point_id||found.point_id;
    await requirePoint(u,detailsCurrentPointId);
    const body=await readJson(request);
    const imei=cleanText(body.imei,32).replace(/\s+/g,'');
    const serialNumber=cleanText(body.serialNumber,120);
    const deviceNotes=cleanText(body.deviceNotes,1000);
    if(imei&&!/^\d{14,16}$/.test(imei))return json(request,{error:'IMEI',message:'IMEI powinien zawierać 14–16 cyfr.'},400);

    if(imei){
      const conflict=(await q('SELECT id FROM devices WHERE imei=$1 AND id<>$2 LIMIT 1',[imei,found.device_id])).rows[0];
      if(conflict)return json(request,{error:'IMEI_CONFLICT',message:'Ten IMEI jest już przypisany do innego urządzenia.'},409);
    }

    const canEditWorkflow=SERVICE_EDIT_ROLES.has(u.role_code);
    const etaText=canEditWorkflow&&found.handling_mode!=='TRANSFER_ONLY'?cleanText(body.estimatedCompletionAt,64):'';
    let estimatedCompletionAt=canEditWorkflow
      ? (found.handling_mode==='TRANSFER_ONLY'?found.estimated_completion_at:null)
      : found.estimated_completion_at;
    if(etaText){
      const date=new Date(etaText);
      if(Number.isNaN(date.getTime()))return json(request,{error:'ETA',message:'Nieprawidłowy przewidywany termin.'},400);
      estimatedCompletionAt=date;
    }

    const canManageAssignment=SERVICE_MANAGE_ROLES.has(u.role_code);
    const canEditCosts=SERVICE_EDIT_ROLES.has(u.role_code);
    if(!canEditWorkflow&&('estimatedCompletionAt' in body)&&body.estimatedCompletionAt){
      throw Object.assign(new Error('Rola USER nie może zmieniać terminu realizacji.'),{status:403});
    }
    if(found.handling_mode==='TRANSFER_ONLY'&&('assignedTechnicianId' in body||'estimatedCost' in body||'finalCost' in body)){
      return json(request,{error:'TRANSFER_ONLY_DETAILS_LOCKED',message:'W trybie „Tylko przekazanie” nie ustawia się serwisanta ani cen naprawy.'},409);
    }
    if(!canManageAssignment&&'assignedTechnicianId' in body){
      throw Object.assign(new Error('Tylko kierownictwo punktu może zmieniać przypisanego technika.'),{status:403});
    }
    if(!canEditCosts&&('estimatedCost' in body||'finalCost' in body)){
      throw Object.assign(new Error('Brak uprawnień do danych kosztowych zlecenia.'),{status:403});
    }

    let assignedTechnicianId=found.assigned_technician_id||null;
    let estimatedCost=found.estimated_cost==null?null:Number(found.estimated_cost);
    let finalCost=found.final_cost==null?null:Number(found.final_cost);
    if(canManageAssignment){
      assignedTechnicianId=cleanText(body.assignedTechnicianId,80)||null;
      if(assignedTechnicianId){
        const tech=(await q(
          "SELECT usr.id FROM users usr JOIN user_point_access a ON a.user_id=usr.id WHERE usr.id=$1 AND usr.role_code='TECHNICIAN' AND usr.status='ACTIVE' AND a.point_id=$2 LIMIT 1",
          [assignedTechnicianId,found.current_point_id||found.home_point_id||found.point_id]
        )).rows[0];
        if(!tech)return json(request,{error:'TECHNICIAN',message:'Wybrany technik nie ma dostępu do aktualnego punktu urządzenia.'},400);
      }
    }
    if(canEditCosts){
      if('estimatedCost' in body){
        const estimatedRaw=body.estimatedCost;
        estimatedCost=estimatedRaw==null||estimatedRaw===''?null:Number(estimatedRaw);
      }
      if('finalCost' in body){
        const finalRaw=body.finalCost;
        finalCost=finalRaw==null||finalRaw===''?null:Number(finalRaw);
      }
      if(estimatedCost!=null&&(!Number.isFinite(estimatedCost)||estimatedCost<0))return json(request,{error:'ESTIMATED_COST',message:'Nieprawidłowy koszt szacowany.'},400);
      if(finalCost!=null&&(!Number.isFinite(finalCost)||finalCost<0))return json(request,{error:'FINAL_COST',message:'Nieprawidłowy koszt końcowy.'},400);
    }

    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('UPDATE devices SET imei=NULLIF($1,\'\'),serial_number=NULLIF($2,\'\'),notes=NULLIF($3,\'\'),updated_at=now() WHERE id=$4',[imei,serialNumber,deviceNotes,found.device_id]);
      await client.query('UPDATE service_orders SET assigned_technician_id=$1,estimated_cost=$2,final_cost=$3,estimated_completion_at=$4,updated_at=now() WHERE id=$5',[assignedTechnicianId,estimatedCost,finalCost,estimatedCompletionAt,found.id]);
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>undefined);
      throw error;
    }finally{client.release();}

    await audit(session,'SERVICE_ORDER_DETAILS_UPDATED','service_order',found.id,found.point_id,{
      assignedTechnicianId,
      estimatedCost,
      finalCost,
      estimatedCompletionAt:estimatedCompletionAt?estimatedCompletionAt.toISOString():null,
      hasImei:Boolean(imei),
      hasSerialNumber:Boolean(serialNumber)
    });
    const view=(await listVisibleOrders(u)).find((order)=>order.id===found.id);
    return json(request,view);
  }

  if(method==='POST'&&url.pathname==='/service/orders'){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    if(!SERVICE_CREATE_ROLES.has(u.role_code)) throw Object.assign(new Error('Brak uprawnień do tworzenia zleceń.'),{status:403});
    const pointId=cleanText(body.pointId,80);await requirePoint(u,pointId);
    const firstName=cleanText(body.firstName,80),lastName=cleanText(body.lastName,100),email=normalizeEmail(cleanText(body.email,180)),phone=cleanText(body.phone,50),phoneNorm=normalizePhone(phone),brand=cleanText(body.brand,80),model=cleanText(body.model,120),issue=cleanText(body.issueDescription,2000),orderType=String(body.orderType||'REPAIR').toUpperCase(),handlingMode=String(body.handlingMode||'STANDARD').toUpperCase();
    const imei=cleanText(body.imei,32).replace(/\s+/g,''),serialNumber=cleanText(body.serialNumber,120),deviceNotes=cleanText(body.deviceNotes,1000);
    const canSetIntakeEta=SERVICE_EDIT_ROLES.has(u.role_code);
    const etaText=canSetIntakeEta?cleanText(body.estimatedCompletionAt,64):'';
    let estimatedCompletionAt=null;
    if(etaText){
      const eta=new Date(etaText);
      if(Number.isNaN(eta.getTime()))return json(request,{error:'ETA',message:'Nieprawidłowy przewidywany termin.'},400);
      estimatedCompletionAt=eta;
    }
    const canManage=SERVICE_MANAGE_ROLES.has(u.role_code);
    let assignedTechnicianId=u.role_code==='TECHNICIAN'?u.id:(canManage?(cleanText(body.assignedTechnicianId,80)||null):null);
    let estimatedCost=null;
    if(!SERVICE_EDIT_ROLES.has(u.role_code)&&body.estimatedCost!==undefined&&body.estimatedCost!=='')throw Object.assign(new Error('Brak uprawnień do danych kosztowych zlecenia.'),{status:403});
    if(SERVICE_EDIT_ROLES.has(u.role_code)&&body.estimatedCost!==undefined&&body.estimatedCost!==''){
      estimatedCost=Number(body.estimatedCost);
      if(!Number.isFinite(estimatedCost)||estimatedCost<0)return json(request,{error:'ESTIMATED_COST',message:'Nieprawidłowy koszt szacowany.'},400);
    }
    if(!canManage&&body.assignedTechnicianId&&String(body.assignedTechnicianId)!==u.id){
      throw Object.assign(new Error('Nie możesz przypisać zlecenia do innego technika.'),{status:403});
    }
    if(!firstName||!lastName||!brand||!model||!issue||!['REPAIR','COMPLAINT'].includes(orderType))return json(request,{error:'VALIDATION',message:'Uzupełnij dane klienta, urządzenia i usterki.'},400);
    if(!['STANDARD','TRANSFER_ONLY'].includes(handlingMode))return json(request,{error:'HANDLING_MODE',message:'Nieprawidłowy sposób obsługi zlecenia.'},400);
    if(!email&&!phoneNorm)return json(request,{error:'CONTACT_REQUIRED',message:'Podaj adres e-mail lub numer telefonu klienta.'},400);
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(request,{error:'EMAIL',message:'Adres e-mail klienta jest nieprawidłowy.'},400);
    if(phone&&phoneNorm.length<7)return json(request,{error:'PHONE',message:'Numer telefonu klienta jest zbyt krótki.'},400);
    if(imei&&!/^\d{14,16}$/.test(imei))return json(request,{error:'IMEI',message:'IMEI powinien zawierać 14–16 cyfr.'},400);
    if(assignedTechnicianId&&u.role_code!=='TECHNICIAN'){
      const tech=(await q("SELECT usr.id FROM users usr JOIN user_point_access a ON a.user_id=usr.id WHERE usr.id=$1 AND usr.role_code='TECHNICIAN' AND usr.status='ACTIVE' AND a.point_id=$2 LIMIT 1",[assignedTechnicianId,pointId])).rows[0];
      if(!tech)return json(request,{error:'TECHNICIAN',message:'Wybrany technik nie ma dostępu do tego punktu.'},400);
    }
    const client=await pool.connect();let reused=false,reusedDevice=false;try{
      await client.query('BEGIN');
      let customer=(await client.query("SELECT * FROM customers WHERE ($1<>'' AND lower(email)=lower($1)) OR ($2<>'' AND phone_normalized=$2) ORDER BY updated_at DESC LIMIT 1",[email,phoneNorm])).rows[0];
      if(customer){reused=true;await client.query("UPDATE customers SET first_name=$1,last_name=$2,email=COALESCE(NULLIF($3,''),email),phone=COALESCE(NULLIF($4,''),phone),phone_normalized=COALESCE(NULLIF($5,''),phone_normalized),updated_at=now() WHERE id=$6",[firstName,lastName,email,phone,phoneNorm,customer.id]);customer=(await client.query('SELECT * FROM customers WHERE id=$1',[customer.id])).rows[0];}
      else{
        const cid=makeId('cst');
        customer=(await client.query("INSERT INTO customers(id,first_name,last_name,email,phone,phone_normalized,created_by_user_id) VALUES($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7) ON CONFLICT DO NOTHING RETURNING *",[cid,firstName,lastName,email,phone,phoneNorm,u.id])).rows[0];
        if(!customer){
          reused=true;
          customer=(await client.query("SELECT * FROM customers WHERE ($1<>'' AND lower(email)=lower($1)) OR ($2<>'' AND phone_normalized=$2) ORDER BY updated_at DESC LIMIT 1",[email,phoneNorm])).rows[0];
          if(!customer)throw new Error('Nie udało się bezpiecznie rozpoznać istniejącego klienta.');
          await client.query("UPDATE customers SET first_name=$1,last_name=$2,email=COALESCE(NULLIF($3,''),email),phone=COALESCE(NULLIF($4,''),phone),phone_normalized=COALESCE(NULLIF($5,''),phone_normalized),updated_at=now() WHERE id=$6",[firstName,lastName,email,phone,phoneNorm,customer.id]);
          customer=(await client.query('SELECT * FROM customers WHERE id=$1',[customer.id])).rows[0];
        }
      }
      let device=null;
      if(imei){
        const byImei=(await client.query("SELECT * FROM devices WHERE imei=$1 ORDER BY updated_at DESC LIMIT 1",[imei])).rows[0];
        if(byImei&&byImei.customer_id!==customer.id)throw Object.assign(new Error('Urządzenie z tym IMEI jest przypisane do innego klienta.'),{status:409});
        device=byImei||null;
      }
      if(!device&&serialNumber){
        device=(await client.query("SELECT * FROM devices WHERE customer_id=$1 AND lower(brand)=lower($2) AND lower(model)=lower($3) AND lower(serial_number)=lower($4) ORDER BY updated_at DESC LIMIT 1",[customer.id,brand,model,serialNumber])).rows[0]||null;
      }
      let did='';
      if(device){
        reusedDevice=true;
        did=device.id;
        await client.query("UPDATE devices SET brand=$1,model=$2,imei=COALESCE(NULLIF($3,''),imei),serial_number=COALESCE(NULLIF($4,''),serial_number),notes=COALESCE(NULLIF($5,''),notes),updated_at=now() WHERE id=$6",[brand,model,imei,serialNumber,deviceNotes,did]);
      }else{
        did=makeId('dev');
        await client.query("INSERT INTO devices(id,customer_id,brand,model,imei,serial_number,notes) VALUES($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),NULLIF($7,''))",[did,customer.id,brand,model,imei,serialNumber,deviceNotes]);
      }
      const oid=makeId('srv');const order=(await client.query("INSERT INTO service_orders(id,point_id,home_point_id,current_point_id,customer_id,device_id,order_type,handling_mode,issue_description,status,assigned_technician_id,created_by_user_id,estimated_cost,estimated_completion_at) VALUES($1,$2,$2,$2,$3,$4,$5,$6,$7,'RECEIVED',$8,$9,$10,$11) RETURNING *",[oid,pointId,customer.id,did,orderType,handlingMode,issue,handlingMode==='TRANSFER_ONLY'?null:assignedTechnicianId,u.id,handlingMode==='TRANSFER_ONLY'?null:estimatedCost,estimatedCompletionAt])).rows[0];
      await client.query("INSERT INTO service_order_status_history(id,service_order_id,from_status,to_status,changed_by_user_id) VALUES($1,$2,NULL,'RECEIVED',$3)",[makeId('hst'),oid,u.id]);
      await client.query('COMMIT');

      let notification={queued:false,sent:false,reason:'NOT_CONFIGURED'};
      try{
        const settings=await mailSettingsForPoint(pointId);
        const customerPrefs=await customerNotificationPreferences(customer.id);
        if(!customer.email){
          notification={queued:false,sent:false,reason:'NO_CUSTOMER_EMAIL'};
        }else if(customerPrefs.serviceUpdates===false){
          notification={queued:false,sent:false,reason:'CUSTOMER_PREF_DISABLED'};
        }else if(settings.automatic_email_enabled!==true){
          notification={queued:false,sent:false,reason:'AUTOMATIC_EMAIL_DISABLED'};
        }else if(!Array.isArray(settings.notify_statuses)||!settings.notify_statuses.includes('RECEIVED')){
          notification={queued:false,sent:false,reason:'STATUS_NOT_ENABLED'};
        }else{
          const nid=makeId('ntf');
          await q(
            "INSERT INTO notification_outbox(id,user_id,customer_id,service_order_id,channel,template_key,recipient,payload,status) VALUES($1,$2,$3,$4,'EMAIL','SERVICE_STATUS_CHANGED',$5,$6::jsonb,'PENDING')",
            [nid,u.id,customer.id,oid,customer.email,JSON.stringify({from:null,to:'RECEIVED',note:null})]
          );
          notification={queued:true,...(await processNotification(nid))};
        }
      }catch(notificationError){
        console.error('[intake notification]',notificationError);
        notification={queued:false,sent:false,reason:'NOTIFICATION_ERROR'};
      }

      try{
        await audit(session,'SERVICE_ORDER_CREATED','service_order',oid,pointId,{orderType,handlingMode,notification});
      }catch(auditError){
        console.error('[service order audit]',auditError);
      }
      return json(request,{customer:customerView(customer),order:{id:order.id,orderNumber:Number(order.order_number),pointId,customerId:customer.id,deviceId:did,orderType,handlingMode,issueDescription:issue,status:'RECEIVED',assignedTechnicianId:handlingMode==='TRANSFER_ONLY'?null:assignedTechnicianId,estimatedCost:SERVICE_EDIT_ROLES.has(u.role_code)&&handlingMode!=='TRANSFER_ONLY'?estimatedCost:null,estimatedCompletionAt:order.estimated_completion_at||null,receivedAt:order.received_at},reusedCustomer:reused,reusedDevice,notification},201);
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  const statusMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/status$/);
  if(method==='POST'&&statusMatch){
    const session=await requireActive(request),u=session.user;
    const body=await readJson(request),next=String(body.status||'').toUpperCase(),note=cleanText(body.note,500),actingPointId=cleanText(body.actingPointId,80);
    const canEditStatus=SERVICE_EDIT_ROLES.has(u.role_code);
    const canCancelOnly=u.role_code==='USER'&&next==='CANCELLED';
    if(!canEditStatus&&!canCancelOnly)throw Object.assign(new Error('Brak uprawnień do zmiany statusu.'),{status:403});
    if(!SERVICE_STATUSES.has(next))return json(request,{error:'STATUS'},400);

    const found=(await q('SELECT id,order_number,point_id,home_point_id,current_point_id,status,handling_mode,customer_id,assigned_technician_id,created_by_user_id,final_cost,estimated_cost,currency FROM service_orders WHERE id=$1 LIMIT 1',[statusMatch[1]])).rows[0];
    if(!found)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,found.id);

    const homePointId=found.home_point_id||found.point_id;
    const openTransfer=(await q("SELECT id,kind,status,from_point_id,to_point_id FROM service_order_transfers WHERE service_order_id=$1 AND status IN ('REQUESTED','IN_TRANSIT','DELIVERED') ORDER BY requested_at DESC LIMIT 1",[found.id])).rows[0]||null;
    if(openTransfer&&next!==found.status){
      return json(request,{error:'DEVICE_IN_TRANSFER',message:'Status zlecenia jest zablokowany podczas aktywnego przekazania. Najpierw zakończ logistykę urządzenia.'},409);
    }
    const effectiveCurrentPointId=found.current_point_id||(!openTransfer?homePointId:null);
    if(next!==found.status){
      if(!effectiveCurrentPointId){
        return json(request,{error:'DEVICE_LOCATION_UNKNOWN',message:'Nie można zmienić statusu, dopóki lokalizacja urządzenia nie jest potwierdzona.'},409);
      }
      if(GLOBAL_ROLES.has(u.role_code)&&!actingPointId){
        return json(request,{error:'ACTIVE_POINT_REQUIRED',message:'Wybierz aktywny punkt, z którego wykonujesz zmianę statusu.'},409);
      }
      if(actingPointId&&actingPointId!==effectiveCurrentPointId){
        return json(request,{error:'WRONG_ACTIVE_POINT',message:'Status może zmienić tylko punkt, w którym fizycznie znajduje się urządzenie.'},409);
      }
      await requirePoint(u,effectiveCurrentPointId);
    }

    if(found.handling_mode==='TRANSFER_ONLY'&&next!==found.status&&next!=='CANCELLED'){
      return json(request,{error:'TRANSFER_ONLY_STATUS_LOCKED',message:'To zlecenie działa w trybie „Tylko przekazanie”. Możesz obsługiwać logistykę urządzenia albo anulować zlecenie, ale nie zmieniać etapów naprawy.'},409);
    }

    if(['READY','COMPLETED'].includes(next)){
      if(effectiveCurrentPointId!==homePointId){
        return json(request,{error:'RETURN_REQUIRED',message:'Urządzenie znajduje się poza punktem macierzystym. Najpierw odeślij je do punktu macierzystego i potwierdź przyjęcie zwrotu.'},409);
      }
      await requirePoint(u,homePointId);
      if(next==='READY'&&found.status!=='REPAIR_DONE'){
        return json(request,{error:'REPAIR_DONE_REQUIRED',message:'Status „Gotowe do odbioru” można ustawić dopiero po zakończeniu naprawy.'},409);
      }
      if(next==='COMPLETED'&&found.status!=='READY'){
        return json(request,{error:'READY_REQUIRED',message:'Zlecenie można zakończyć dopiero po oznaczeniu urządzenia jako gotowego do odbioru w punkcie macierzystym.'},409);
      }
    }

    const settlementAmount = next==='COMPLETED'
      ? Number(found.final_cost ?? found.estimated_cost)
      : null;
    if(next==='COMPLETED'&&(!Number.isFinite(settlementAmount)||settlementAmount<=0)){
      return json(request,{
        error:'FINAL_COST_REQUIRED',
        message:'Przed zakończeniem zlecenia wpisz koszt końcowy. Jeżeli koszt końcowy jest pusty, system może użyć zapisanej wyceny.'
      },409);
    }

    if(found.status===next){
      const view=(await listVisibleOrders(u)).find((o)=>o.id===found.id);
      return json(request,{order:view,notification:{queued:false,sent:false,reason:'STATUS_UNCHANGED'}});
    }

    let settlementSpec=null;
    if(next==='COMPLETED'){
      const settlementPointId=found.home_point_id||found.point_id;
      let revenueUserId=found.assigned_technician_id||null;
      if(!revenueUserId&&u.role_code==='TECHNICIAN') revenueUserId=u.id;
      if(!revenueUserId){
        const candidates=(await q(
          "SELECT usr.id FROM users usr JOIN user_point_access a ON a.user_id=usr.id WHERE a.point_id=$1 AND usr.role_code='TECHNICIAN' AND usr.status='ACTIVE' AND usr.blocked_at IS NULL ORDER BY usr.name,usr.id LIMIT 2",
          [settlementPointId]
        )).rows;
        if(candidates.length===1) revenueUserId=candidates[0].id;
      }
      if(!revenueUserId){
        return json(request,{error:'TECHNICIAN_REQUIRED',message:'Przed zakończeniem zlecenia przypisz serwisanta odpowiedzialnego za naprawę.'},409);
      }
      const revenueUser=(await q(
        "SELECT id,name,technician_split_percent FROM users WHERE id=$1 AND role_code='TECHNICIAN' AND status='ACTIVE' AND blocked_at IS NULL LIMIT 1",
        [revenueUserId]
      )).rows[0];
      if(!revenueUser){
        return json(request,{error:'TECHNICIAN_REQUIRED',message:'Przypisany serwisant nie jest aktywnym kontem TECHNICIAN.'},409);
      }
      const technicianPercent=normalizeTechnicianPercent(revenueUser.technician_split_percent);
      if(technicianPercent===null){
        return json(request,{error:'SETTLEMENT_REQUIRED',message:'Serwisant '+(revenueUser.name||'')+' musi najpierw ustawić swój procent rozliczenia w sekcji Rozliczenia.'},409);
      }
      settlementSpec={settlementPointId,revenueUserId,technicianPercent,split:splitRevenueAmount(settlementAmount,technicianPercent)};
    }

    let settlement=null;
    const statusClient=await pool.connect();
    try{
      await statusClient.query('BEGIN');
      await statusClient.query(
        "UPDATE service_orders SET status=$1,updated_at=now(),completed_at=CASE WHEN $1='COMPLETED' THEN now() ELSE completed_at END,final_cost=CASE WHEN $1='COMPLETED' AND final_cost IS NULL THEN estimated_cost ELSE final_cost END WHERE id=$2",
        [next,found.id]
      );
      await statusClient.query(
        'INSERT INTO service_order_status_history(id,service_order_id,from_status,to_status,note,changed_by_user_id) VALUES($1,$2,$3,$4,$5,$6)',
        [makeId('hst'),found.id,found.status,next,note||null,u.id]
      );

      if(next==='COMPLETED'&&settlementSpec){
        const revenueId=makeId('rev');
        const revenue=(await statusClient.query(
          "INSERT INTO revenue_entries(id,point_id,user_id,service_order_id,amount,currency,category,technician_percent,status,note,occurred_at,approved_by_user_id,approved_at) VALUES($1,$2,$3,$4,$5,$6,'SERVICE',$7,'APPROVED',$8,now(),$9,now()) ON CONFLICT (service_order_id) WHERE service_order_id IS NOT NULL DO UPDATE SET point_id=EXCLUDED.point_id,user_id=EXCLUDED.user_id,amount=EXCLUDED.amount,currency=EXCLUDED.currency,technician_percent=EXCLUDED.technician_percent,status='APPROVED',note=EXCLUDED.note,approved_by_user_id=EXCLUDED.approved_by_user_id,approved_at=now() RETURNING id,point_id,user_id,service_order_id,amount,currency,technician_percent,status,approved_at",
          [revenueId,settlementSpec.settlementPointId,settlementSpec.revenueUserId,found.id,Math.round(settlementAmount*100)/100,found.currency||'PLN',settlementSpec.technicianPercent,'Automatyczne rozliczenie zakończonego zlecenia #'+found.order_number,u.id]
        )).rows[0];
        settlement={
          id:revenue.id,
          amount:Number(revenue.amount),
          currency:String(revenue.currency||'PLN').trim(),
          status:revenue.status,
          serviceOrderId:revenue.service_order_id,
          userId:revenue.user_id,
          pointId:revenue.point_id,
          technicianPercent:settlementSpec.split.technicianPercent,
          bossPercent:settlementSpec.split.bossPercent,
          technicianShare:settlementSpec.split.technicianShare,
          bossShare:settlementSpec.split.bossShare,
          approvedAt:revenue.approved_at
        };
      }
      await statusClient.query('COMMIT');
    }catch(error){
      await statusClient.query('ROLLBACK').catch(()=>undefined);
      throw error;
    }finally{
      statusClient.release();
    }

    let notification={queued:false,sent:false,reason:'NOT_CONFIGURED'};
    try{
      const customer=(await q('SELECT email FROM customers WHERE id=$1',[found.customer_id])).rows[0];
      const settings=await mailSettingsForPoint(found.point_id);
      const customerPrefs=await customerNotificationPreferences(found.customer_id);
      if(!customer?.email){
        notification={queued:false,sent:false,reason:'NO_CUSTOMER_EMAIL'};
      }else if(next==='READY'&&customerPrefs.readyForPickup===false){
        notification={queued:false,sent:false,reason:'CUSTOMER_PREF_DISABLED'};
      }else if(next!=='READY'&&customerPrefs.serviceUpdates===false){
        notification={queued:false,sent:false,reason:'CUSTOMER_PREF_DISABLED'};
      }else if(settings.automatic_email_enabled!==true){
        notification={queued:false,sent:false,reason:'AUTOMATIC_EMAIL_DISABLED'};
      }else if(!Array.isArray(settings.notify_statuses)||!settings.notify_statuses.includes(next)){
        notification={queued:false,sent:false,reason:'STATUS_NOT_ENABLED'};
      }else{
        const nid=makeId('ntf');
        await q(
          "INSERT INTO notification_outbox(id,user_id,customer_id,service_order_id,channel,template_key,recipient,payload,status) VALUES($1,$2,$3,$4,'EMAIL','SERVICE_STATUS_CHANGED',$5,$6::jsonb,'PENDING')",
          [nid,u.id,found.customer_id,found.id,customer.email,JSON.stringify({from:found.status,to:next,note:note||null})]
        );
        notification={queued:true,...(await processNotification(nid))};
      }
    }catch(notificationError){
      console.error('[status notification]',notificationError);
      notification={queued:false,sent:false,reason:'NOTIFICATION_ERROR'};
    }

    try{
      await audit(session,'SERVICE_STATUS_CHANGED','service_order',found.id,found.point_id,{from:found.status,to:next,notification,settlementStatus:settlement?.status||null,settlementId:settlement?.id||null});
    }catch(auditError){
      console.error('[service status audit]',auditError);
    }
    const view=(await listVisibleOrders(u)).find((o)=>o.id===found.id);
    return json(request,{order:view,notification,settlement});
  }

  if(method==='GET'&&url.pathname==='/service/customer-quotes'){
    const session=await requireActive(request),u=session.user;
    if(!CUSTOMER_QUOTE_STAFF_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do wycen klientów.'),{status:403});
    const params=[];
    let where=' WHERE 1=1';
    if(!GLOBAL_ROLES.has(u.role_code)){
      params.push(u.id);
      where += " AND (r.assigned_technician_id=$" + params.length + " OR EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$" + params.length + " AND a.point_id IN (r.requested_point_id,r.routed_point_id)))";
    }
    const pointId=cleanText(url.searchParams.get('pointId'),80);
    if(pointId){
      await requirePoint(u,pointId);
      params.push(pointId);
      where += " AND r.routed_point_id=$" + params.length;
    }
    const status=cleanText(url.searchParams.get('status'),30).toUpperCase();
    if(status&&['OPEN','QUOTED','CLOSED','CANCELLED'].includes(status)){
      params.push(status);
      where += " AND r.status=$" + params.length;
    }
    const rows=(await q(
      "SELECT r.*,c.first_name,c.last_name,c.email,c.phone,rp.name AS requested_point_name,rrp.name AS routed_point_name,u.name AS technician_name,s.order_number FROM customer_quote_requests r JOIN customers c ON c.id=r.customer_id JOIN points rp ON rp.id=r.requested_point_id JOIN points rrp ON rrp.id=r.routed_point_id LEFT JOIN users u ON u.id=r.assigned_technician_id LEFT JOIN service_orders s ON s.id=r.service_order_id"+where+" ORDER BY CASE WHEN r.status='OPEN' THEN 0 WHEN r.status='QUOTED' THEN 1 ELSE 2 END,r.updated_at DESC LIMIT 150",
      params
    )).rows;
    const ids=rows.map((row)=>row.id);
    let messages=[];
    if(ids.length){
      messages=(await q(
        "SELECT m.id,m.request_id,m.sender_kind,m.body,m.created_at,u.name AS sender_name FROM customer_quote_messages m LEFT JOIN users u ON u.id=m.sender_user_id WHERE m.request_id=ANY($1::text[]) ORDER BY m.created_at ASC",
        [ids]
      )).rows;
    }
    const byRequest=new Map();
    for(const row of messages){
      const list=byRequest.get(row.request_id)||[];
      list.push({id:row.id,senderKind:row.sender_kind,senderName:row.sender_name||null,body:row.body,createdAt:row.created_at});
      byRequest.set(row.request_id,list);
    }
    return json(request,rows.map((row)=>({
      id:row.id,customerId:row.customer_id,customerName:[row.first_name,row.last_name].filter(Boolean).join(' '),customerEmail:row.email||null,customerPhone:row.phone||null,
      requestedPointId:row.requested_point_id,requestedPointName:row.requested_point_name,routedPointId:row.routed_point_id,routedPointName:row.routed_point_name,
      assignedTechnicianId:row.assigned_technician_id||null,assignedTechnicianName:row.technician_name||null,
      serviceOrderId:row.service_order_id||null,orderNumber:row.order_number?Number(row.order_number):null,
      deviceDescription:row.device_description,issueDescription:row.issue_description,status:row.status,
      quoteAmount:row.quote_amount==null?null:Number(row.quote_amount),currency:row.currency||'PLN',quoteNote:row.quote_note||null,
      routingReason:row.routing_reason,createdAt:row.created_at,updatedAt:row.updated_at,quotedAt:row.quoted_at||null,closedAt:row.closed_at||null,
      messages:byRequest.get(row.id)||[]
    })));
  }

  const staffQuoteReplyMatch=url.pathname.match(/^\/service\/customer-quotes\/([^/]+)\/reply$/);
  if(method==='POST'&&staffQuoteReplyMatch){
    const session=await requireActive(request),u=session.user;
    if(!CUSTOMER_QUOTE_STAFF_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do odpowiedzi klientowi.'),{status:403});
    const quote=await staffQuoteVisible(u,staffQuoteReplyMatch[1]);
    if(!quote)return json(request,{error:'NOT_FOUND'},404);
    if(['CLOSED','CANCELLED'].includes(quote.status))return json(request,{error:'QUOTE_CLOSED',message:'To zapytanie jest zamknięte.'},409);
    const body=await readJson(request),message=cleanText(body.message,1000);
    if(!message)return json(request,{error:'MESSAGE_REQUIRED',message:'Wpisz odpowiedź dla klienta.'},400);
    await q("INSERT INTO customer_quote_messages(id,request_id,sender_kind,sender_user_id,body) VALUES($1,$2,'STAFF',$3,$4)",[makeId('cqm'),quote.id,u.id,message]);
    await q("UPDATE customer_quote_requests SET assigned_technician_id=CASE WHEN assigned_technician_id IS NULL AND $2='TECHNICIAN' THEN $3 ELSE assigned_technician_id END,updated_at=now() WHERE id=$1",[quote.id,u.role_code,u.id]);
    await audit(session,'CUSTOMER_QUOTE_REPLIED','customer_quote_request',quote.id,quote.routed_point_id,{customerId:quote.customer_id});
    return json(request,{ok:true});
  }

  const staffQuotePriceMatch=url.pathname.match(/^\/service\/customer-quotes\/([^/]+)\/quote$/);
  if(method==='POST'&&staffQuotePriceMatch){
    const session=await requireActive(request),u=session.user;
    if(!CUSTOMER_QUOTE_STAFF_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do wyceny.'),{status:403});
    const quote=await staffQuoteVisible(u,staffQuotePriceMatch[1]);
    if(!quote)return json(request,{error:'NOT_FOUND'},404);
    if(['CLOSED','CANCELLED'].includes(quote.status))return json(request,{error:'QUOTE_CLOSED',message:'To zapytanie jest zamknięte.'},409);
    const body=await readJson(request);
    const amount=Number(body.amount);
    const note=cleanText(body.note,1000);
    if(!Number.isFinite(amount)||amount<0||amount>1000000)return json(request,{error:'QUOTE_AMOUNT',message:'Podaj prawidłową kwotę wyceny.'},400);
    const rounded=Math.round(amount*100)/100;
    await q(
      "UPDATE customer_quote_requests SET quote_amount=$2,quote_note=NULLIF($3,''),status='QUOTED',quoted_at=now(),updated_at=now(),assigned_technician_id=CASE WHEN assigned_technician_id IS NULL AND $4='TECHNICIAN' THEN $5 ELSE assigned_technician_id END WHERE id=$1",
      [quote.id,rounded,note,u.role_code,u.id]
    );
    const message='Wycena zdalna: '+rounded.toFixed(2)+' PLN'+(note?' · '+note:'');
    await q("INSERT INTO customer_quote_messages(id,request_id,sender_kind,sender_user_id,body) VALUES($1,$2,'STAFF',$3,$4)",[makeId('cqm'),quote.id,u.id,message]);
    await audit(session,'CUSTOMER_QUOTE_PRICED','customer_quote_request',quote.id,quote.routed_point_id,{customerId:quote.customer_id,amount:rounded,currency:'PLN'});
    return json(request,{ok:true,amount:rounded,currency:'PLN'});
  }

  const staffQuoteCloseMatch=url.pathname.match(/^\/service\/customer-quotes\/([^/]+)\/close$/);
  if(method==='POST'&&staffQuoteCloseMatch){
    const session=await requireActive(request),u=session.user;
    if(!CUSTOMER_QUOTE_STAFF_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do zamknięcia zapytania.'),{status:403});
    const quote=await staffQuoteVisible(u,staffQuoteCloseMatch[1]);
    if(!quote)return json(request,{error:'NOT_FOUND'},404);
    await q("UPDATE customer_quote_requests SET status='CLOSED',closed_at=now(),updated_at=now() WHERE id=$1",[quote.id]);
    await audit(session,'CUSTOMER_QUOTE_CLOSED','customer_quote_request',quote.id,quote.routed_point_id,{customerId:quote.customer_id});
    return json(request,{ok:true});
  }

  if(method==='GET'&&url.pathname==='/service/service-points'){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_READ_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do listy serwisów.'),{status:403});
    const {rows}=await q("SELECT p.id,p.name,p.city,p.active,p.service_enabled,p.accepts_external_repairs,p.external_repairs_paused,p.service_note,coalesce(t.active_technician_count,0)::int AS active_technician_count,(p.service_enabled OR coalesce(t.active_technician_count,0)>0) AS effective_service_enabled,(NOT p.external_repairs_paused AND (coalesce(t.active_technician_count,0)>0 OR (p.service_enabled AND p.accepts_external_repairs))) AS effective_accepts_external_repairs FROM points p LEFT JOIN LATERAL (SELECT count(*)::int AS active_technician_count FROM user_point_access a JOIN users usr ON usr.id=a.user_id WHERE a.point_id=p.id AND usr.role_code='TECHNICIAN' AND usr.status='ACTIVE' AND usr.blocked_at IS NULL) t ON true WHERE p.active=true AND (p.service_enabled=true OR coalesce(t.active_technician_count,0)>0) ORDER BY p.city,p.name");
    return json(request,rows.map(pointView));
  }

  if(method==='GET'&&url.pathname==='/service/transfers'){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_READ_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do przekazań serwisowych.'),{status:403});
    const status=cleanText(url.searchParams.get('status'),30).toUpperCase();
    const incoming=url.searchParams.get('incoming')==='1';
    const params=[];
    let where=' WHERE 1=1';
    if(!GLOBAL_ROLES.has(u.role_code)){
      params.push(u.id);
      where += incoming
        ? " AND EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$1 AND a.point_id=t.to_point_id)"
        : " AND EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$1 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id))";
    }
    if(status){
      params.push(status);
      where += ' AND t.status=' + '$' + String(params.length);
    }
    const {rows}=await q(
      "SELECT t.*,fp.name AS from_point_name,fp.city AS from_point_city,tp.name AS to_point_name,tp.city AS to_point_city,su.name AS sent_by_name,su.email AS sent_by_email,au.name AS accepted_by_name,au.email AS accepted_by_email,s.order_number,c.first_name,c.last_name,d.brand,d.model FROM service_order_transfers t JOIN points fp ON fp.id=t.from_point_id JOIN points tp ON tp.id=t.to_point_id JOIN users su ON su.id=t.sent_by_user_id LEFT JOIN users au ON au.id=t.accepted_by_user_id JOIN service_orders s ON s.id=t.service_order_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id" + where + " ORDER BY t.requested_at DESC LIMIT 150",
      params
    );
    return json(request,rows.map((row)=>({
      ...transferView(row),
      orderNumber:Number(row.order_number),
      customerName:[row.first_name,row.last_name].filter(Boolean).join(' '),
      device:[row.brand,row.model].filter(Boolean).join(' ')
    })));
  }

  const createTransferMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/transfer$/);
  if(method==='POST'&&createTransferMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_TRANSFER_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do przekazywania zleceń.'),{status:403});
    const order=(await q('SELECT id,point_id,home_point_id,current_point_id,status,handling_mode,customer_id FROM service_orders WHERE id=$1 LIMIT 1',[createTransferMatch[1]])).rows[0];
    if(!order)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,order.id);
    if(['COMPLETED','CANCELLED','REJECTED'].includes(order.status)){
      return json(request,{error:'ORDER_CLOSED',message:'Zamkniętego lub anulowanego zlecenia nie można dalej przekazywać.'},409);
    }

    const body=await readJson(request);
    const kind=String(body.kind||'OUTBOUND_SERVICE').toUpperCase();
    const note=cleanText(body.note,500);
    if(!['OUTBOUND_SERVICE','RETURN_HOME'].includes(kind))return json(request,{error:'TRANSFER_KIND',message:'Nieprawidłowy kierunek logistyki.'},400);

    const open=(await q("SELECT id FROM service_order_transfers WHERE service_order_id=$1 AND status IN ('REQUESTED','IN_TRANSIT','DELIVERED') LIMIT 1",[order.id])).rows[0];
    if(open)return json(request,{error:'TRANSFER_OPEN',message:'To zlecenie ma już aktywne przekazanie.'},409);

    const homePointId=order.home_point_id||order.point_id;
    const fromPointId=order.current_point_id||homePointId;
    await requirePoint(u,fromPointId);

    let toPointId=cleanText(body.toPointId,80);
    let destination=null;
    if(kind==='RETURN_HOME'){
      toPointId=homePointId;
      if(fromPointId===homePointId)return json(request,{error:'ALREADY_HOME',message:'Urządzenie znajduje się już w punkcie macierzystym.'},409);
      destination=(await q("SELECT id,name,city,active,service_enabled,accepts_external_repairs,service_note FROM points WHERE id=$1 AND active=true LIMIT 1",[toPointId])).rows[0];
      if(!destination)return json(request,{error:'HOME_POINT_UNAVAILABLE',message:'Punkt macierzysty jest nieaktywny.'},409);
    }else{
      if(!toPointId||toPointId===fromPointId)return json(request,{error:'DESTINATION',message:'Wybierz inny punkt serwisowy.'},400);
      if(toPointId===homePointId&&fromPointId!==homePointId){
        return json(request,{error:'USE_RETURN_HOME',message:'Powrót do punktu macierzystego musi być zapisany jako osobny zwrot logistyczny.'},400);
      }
      destination=(await q("SELECT p.id,p.name,p.city,p.active,p.service_enabled,p.accepts_external_repairs,p.external_repairs_paused,p.service_note,coalesce(t.active_technician_count,0)::int AS active_technician_count FROM points p LEFT JOIN LATERAL (SELECT count(*)::int AS active_technician_count FROM user_point_access a JOIN users usr ON usr.id=a.user_id WHERE a.point_id=p.id AND usr.role_code='TECHNICIAN' AND usr.status='ACTIVE' AND usr.blocked_at IS NULL) t ON true WHERE p.id=$1 AND p.active=true AND NOT p.external_repairs_paused AND (coalesce(t.active_technician_count,0)>0 OR (p.service_enabled=true AND p.accepts_external_repairs=true)) LIMIT 1",[toPointId])).rows[0];
      if(!destination)return json(request,{error:'SERVICE_UNAVAILABLE',message:'Wybrany punkt nie przyjmuje teraz przekazań serwisowych.'},400);
    }

    const transferId=makeId('trf');
    const row=(await q(
      "INSERT INTO service_order_transfers(id,service_order_id,from_point_id,to_point_id,kind,status,note,sent_by_user_id,shipped_at) VALUES($1,$2,$3,$4,$5,'IN_TRANSIT',NULLIF($6,''),$7,now()) RETURNING *",
      [transferId,order.id,fromPointId,toPointId,kind,note,u.id]
    )).rows[0];
    await q('UPDATE service_orders SET current_point_id=NULL,assigned_technician_id=NULL,updated_at=now() WHERE id=$1',[order.id]);

    const notification=await queueTransferNotification(u,order.id,row,'IN_TRANSIT',note);
    await audit(session,kind==='RETURN_HOME'?'SERVICE_RETURN_SENT':'SERVICE_TRANSFER_SENT','service_order',order.id,fromPointId,{transferId,toPointId,kind,homePointId,notification});
    const enriched=(await loadTransfersForOrders([order.id])).get(order.id)?.find((item)=>item.id===transferId);
    return json(request,{transfer:enriched||transferView({...row,from_point_name:'',to_point_name:destination.name}),notification},201);
  }

  const transferStatusMatch=url.pathname.match(/^\/service\/transfers\/([^/]+)\/status$/);
  if(method==='POST'&&transferStatusMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_TRANSFER_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do obsługi przekazania.'),{status:403});
    const transfer=(await q('SELECT * FROM service_order_transfers WHERE id=$1 LIMIT 1',[transferStatusMatch[1]])).rows[0];
    if(!transfer)return json(request,{error:'NOT_FOUND'},404);

    const body=await readJson(request),next=String(body.status||'').toUpperCase(),note=cleanText(body.note,500);
    const transitions={
      REQUESTED:new Set(['IN_TRANSIT','CANCELLED']),
      IN_TRANSIT:new Set(['DELIVERED','CANCELLED']),
      DELIVERED:new Set(['ACCEPTED','REJECTED']),
      ACCEPTED:new Set(),
      REJECTED:new Set(),
      CANCELLED:new Set()
    };
    if(!transitions[transfer.status]?.has(next))return json(request,{error:'TRANSFER_STATUS',message:'Niedozwolona zmiana etapu przekazania.'},400);

    const sourceAction=['IN_TRANSIT','CANCELLED'].includes(next);
    await requirePoint(u,sourceAction?transfer.from_point_id:transfer.to_point_id);

    const orderMode=(await q('SELECT handling_mode,status FROM service_orders WHERE id=$1 LIMIT 1',[transfer.service_order_id])).rows[0];
    if(!orderMode)return json(request,{error:'ORDER_NOT_FOUND'},404);
    if(orderMode.status==='CANCELLED'&&next!=='CANCELLED'){
      return json(request,{error:'ORDER_CANCELLED',message:'Zlecenie zostało anulowane. Nie można kontynuować przekazania.'},409);
    }

    let acceptedBy=null;
    if(next==='ACCEPTED'){
      if(!['OWNER','BOSS','COORDINATOR','TECHNICIAN'].includes(u.role_code))throw Object.assign(new Error('Brak uprawnień do przyjęcia urządzenia.'),{status:403});
      acceptedBy=u.id;
    }

    const updated=(await q(
      "UPDATE service_order_transfers SET status=$1,note=CASE WHEN NULLIF($2,'') IS NULL THEN note ELSE $2 END,accepted_by_user_id=CASE WHEN $1='ACCEPTED' THEN $3 ELSE accepted_by_user_id END,shipped_at=CASE WHEN $1='IN_TRANSIT' THEN COALESCE(shipped_at,now()) ELSE shipped_at END,delivered_at=CASE WHEN $1='DELIVERED' THEN now() ELSE delivered_at END,accepted_at=CASE WHEN $1='ACCEPTED' THEN now() ELSE accepted_at END,updated_at=now() WHERE id=$4 RETURNING *",
      [next,note,acceptedBy,transfer.id]
    )).rows[0];

    const physicalPointId=next==='CANCELLED'
      ? transfer.from_point_id
      : ['DELIVERED','ACCEPTED','REJECTED'].includes(next)
        ? transfer.to_point_id
        : null;
    if(next==='ACCEPTED'&&transfer.kind==='OUTBOUND_SERVICE'&&u.role_code==='TECHNICIAN'&&orderMode?.handling_mode!=='TRANSFER_ONLY'){
      await q('UPDATE service_orders SET current_point_id=$1,assigned_technician_id=$2,updated_at=now() WHERE id=$3',[physicalPointId,u.id,transfer.service_order_id]);
    }else{
      await q('UPDATE service_orders SET current_point_id=$1,updated_at=now() WHERE id=$2',[physicalPointId,transfer.service_order_id]);
    }

    const shouldEmail=['DELIVERED','ACCEPTED','REJECTED','CANCELLED'].includes(next) &&
      !(transfer.kind==='RETURN_HOME'&&next==='ACCEPTED');
    const notification=shouldEmail
      ? await queueTransferNotification(u,transfer.service_order_id,updated,next,note)
      : {queued:false,sent:false,reason:'EVENT_NOT_EMAILED'};

    await audit(session,'SERVICE_TRANSFER_'+next,'service_order',transfer.service_order_id,sourceAction?transfer.from_point_id:transfer.to_point_id,{transferId:transfer.id,kind:transfer.kind,notification});
    const full=(await loadTransfersForOrders([transfer.service_order_id])).get(transfer.service_order_id)?.find((item)=>item.id===transfer.id);
    return json(request,{transfer:full||transferView(updated),notification});
  }

  if(method==='GET'&&url.pathname==='/integrations/gmail'){
    const session=await requireActive(request),pointId=cleanText(url.searchParams.get('pointId'),80);
    await requirePoint(session.user,pointId);
    const {rows}=await q("SELECT point_id,sender_email,status,last_error,connected_at,updated_at,refresh_token_ciphertext,oauth_client_secret_ciphertext,(refresh_token_ciphertext IS NOT NULL) AS refresh_complete,(oauth_client_secret_ciphertext IS NOT NULL) AS legacy_secret_complete FROM point_email_senders WHERE point_id=$1 LIMIT 1",[pointId]);
    let row=rows[0]||null;
    let inherited=false;
    const checkedAt=nowIso();
    if(!row){
      const fallback=await loadActiveMailSender(pointId);
      if(!fallback)return json(request,{connected:false,pointId,needsReconnect:false,connectionState:'NOT_CONNECTED',checkedAt});
      row={
        point_id:fallback.sender_point_id,
        sender_email:fallback.sender_email,
        status:fallback.status,
        last_error:null,
        connected_at:fallback.connected_at,
        refresh_token_ciphertext:fallback.refresh_token_ciphertext,
        oauth_client_secret_ciphertext:fallback.oauth_client_secret_ciphertext,
        refresh_complete:Boolean(fallback.refresh_token_ciphertext),
        legacy_secret_complete:Boolean(fallback.oauth_client_secret_ciphertext)
      };
      inherited=true;
    }

    const credentialsComplete=row.refresh_complete===true&&Boolean(GOOGLE_DESKTOP_CLIENT_SECRET||row.legacy_secret_complete);
    if(!credentialsComplete){
      return json(request,{
        connected:false,
        needsReconnect:true,
        connectionState:'REAUTH_REQUIRED',
        pointId,
        senderPointId:row.point_id,
        inherited,
        email:row.sender_email,
        status:row.status,
        lastError:'Połączenie Gmail jest niekompletne i wymaga ponownej autoryzacji.',
        connectedAt:row.connected_at,
        checkedAt
      });
    }
    if(row.status==='REVOKED'){
      return json(request,{
        connected:false,
        needsReconnect:true,
        connectionState:'REAUTH_REQUIRED',
        pointId,
        senderPointId:row.point_id,
        inherited,
        email:row.sender_email,
        status:row.status,
        lastError:row.last_error||'Zgoda Google dla Gmail wygasła albo została cofnięta.',
        connectedAt:row.connected_at,
        checkedAt
      });
    }

    try{
      const refreshToken=decryptSecret(row.refresh_token_ciphertext);
      const legacyClientSecret=row.oauth_client_secret_ciphertext?decryptSecret(row.oauth_client_secret_ciphertext):'';
      await refreshGmailAccess(refreshToken,legacyClientSecret);
      if(row.status!=='ACTIVE'||row.last_error){
        await q("UPDATE point_email_senders SET status='ACTIVE',last_error=NULL,updated_at=now() WHERE point_id=$1",[row.point_id]);
      }
      return json(request,{
        connected:true,
        needsReconnect:false,
        connectionState:'CONNECTED',
        pointId,
        senderPointId:row.point_id,
        inherited,
        email:row.sender_email,
        status:'ACTIVE',
        lastError:null,
        connectedAt:row.connected_at,
        checkedAt
      });
    }catch(error){
      const reauth=isGmailReauthError(error);
      const message=cleanText(error instanceof Error?error.message:error,500);
      if(reauth){
        await q("UPDATE point_email_senders SET status='REVOKED',last_error=$2,updated_at=now() WHERE point_id=$1",[pointId,message]);
        return json(request,{
          connected:false,
          needsReconnect:true,
          connectionState:'REAUTH_REQUIRED',
          pointId,
        senderPointId:row.point_id,
        inherited,
          email:row.sender_email,
          status:'REVOKED',
          lastError:message,
          connectedAt:row.connected_at,
          checkedAt
        });
      }
      return json(request,{
        connected:false,
        needsReconnect:false,
        connectionState:'TEMPORARY_ERROR',
        pointId,
        senderPointId:row.point_id,
        inherited,
        email:row.sender_email,
        status:row.status,
        lastError:'Nie udało się teraz potwierdzić połączenia Gmail. ServiceOS spróbuje ponownie automatycznie.',
        connectedAt:row.connected_at,
        checkedAt
      });
    }
  }

  if(method==='POST'&&url.pathname==='/integrations/gmail/connect-code'){
    const session=await requireActive(request),u=session.user;
    if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do połączenia Gmail.'),{status:403});
    const body=await readJson(request),pointId=cleanText(body.pointId,80);
    await requirePoint(u,pointId);

    const tokens=await exchangeDesktopAuthorizationCode(body,'/gmail/callback');
    if(!tokens?.refresh_token) return json(request,{error:'REFRESH_TOKEN',message:'Google nie zwrócił refresh tokena. Odłącz wcześniejszy dostęp ServiceOS w koncie Google i spróbuj ponownie.'},400);
    if(!tokens?.id_token) return json(request,{error:'GOOGLE_ID_TOKEN',message:'Google nie zwrócił tokena tożsamości.'},400);

    const profile=await verifyGoogle(String(tokens.id_token),GOOGLE_DESKTOP_CLIENT_ID);
    await refreshGmailAccess(String(tokens.refresh_token),'');
    await q(
      "INSERT INTO point_email_senders(point_id,connected_by_user_id,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,status,last_error,connected_at,updated_at) VALUES($1,$2,$3,$4,NULL,'ACTIVE',NULL,now(),now()) ON CONFLICT(point_id) DO UPDATE SET connected_by_user_id=EXCLUDED.connected_by_user_id,sender_email=EXCLUDED.sender_email,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,oauth_client_secret_ciphertext=NULL,status='ACTIVE',last_error=NULL,connected_at=now(),updated_at=now()",
      [pointId,u.id,profile.email,encryptSecret(String(tokens.refresh_token))]
    );
    await q(
      "INSERT INTO point_notification_settings(point_id,automatic_email_enabled,notify_statuses,sender_display_name,updated_by_user_id,updated_at) VALUES($1,true,$2::text[],'LockOn ServiceOS',$3,now()) ON CONFLICT(point_id) DO NOTHING",
      [pointId,[...DEFAULT_NOTIFY_STATUSES],u.id]
    );
    const recovery=await recoverNoSenderNotifications(pointId);
    await audit(session,'GMAIL_CONNECTED','point',pointId,pointId,{senderEmail:profile.email,identitySource:'GOOGLE_ID_TOKEN',credentialLocation:'SERVER',recoveredNotifications:recovery.recovered,recoveredSent:recovery.sent});
    return json(request,{connected:true,needsReconnect:false,pointId,email:profile.email,status:'ACTIVE',recoveredNotifications:recovery.recovered,recoveredSent:recovery.sent});
  }

  if(method==='POST'&&url.pathname==='/integrations/gmail/connect'){
    const session=await requireActive(request),u=session.user;if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do połączenia Gmail.'),{status:403});
    const body=await readJson(request),pointId=cleanText(body.pointId,80),refreshToken=cleanText(body.refreshToken,4096),idToken=cleanText(body.idToken,8192),clientSecret=cleanText(body.clientSecret,4096);
    await requirePoint(u,pointId);
    if(!refreshToken||!idToken||!clientSecret)return json(request,{error:'TOKEN',message:'Brak kompletnych danych autoryzacji Google.'},400);

    const profile=await verifyGoogle(idToken,GOOGLE_DESKTOP_CLIENT_ID);
    await refreshGmailAccess(refreshToken,clientSecret);

    await q("INSERT INTO point_email_senders(point_id,connected_by_user_id,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,status,last_error,connected_at,updated_at) VALUES($1,$2,$3,$4,$5,'ACTIVE',NULL,now(),now()) ON CONFLICT(point_id) DO UPDATE SET connected_by_user_id=EXCLUDED.connected_by_user_id,sender_email=EXCLUDED.sender_email,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,oauth_client_secret_ciphertext=EXCLUDED.oauth_client_secret_ciphertext,status='ACTIVE',last_error=NULL,connected_at=now(),updated_at=now()",[pointId,u.id,profile.email,encryptSecret(refreshToken),encryptSecret(clientSecret)]);
    await q(
      "INSERT INTO point_notification_settings(point_id,automatic_email_enabled,notify_statuses,sender_display_name,updated_by_user_id,updated_at) VALUES($1,true,$2::text[],'LockOn ServiceOS',$3,now()) ON CONFLICT(point_id) DO NOTHING",
      [pointId,[...DEFAULT_NOTIFY_STATUSES],u.id]
    );
    const recovery=await recoverNoSenderNotifications(pointId);

    await audit(session,'GMAIL_CONNECTED','point',pointId,pointId,{senderEmail:profile.email,identitySource:'GOOGLE_ID_TOKEN',recoveredNotifications:recovery.recovered,recoveredSent:recovery.sent});
    return json(request,{connected:true,needsReconnect:false,pointId,email:profile.email,status:'ACTIVE',recoveredNotifications:recovery.recovered,recoveredSent:recovery.sent});
  }

  if(method==='DELETE'&&url.pathname==='/integrations/gmail'){
    const session=await requireActive(request),u=session.user;if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const pointId=cleanText(url.searchParams.get('pointId'),80);await requirePoint(u,pointId);await q('DELETE FROM point_email_senders WHERE point_id=$1',[pointId]);await audit(session,'GMAIL_DISCONNECTED','point',pointId,pointId,{});
    return json(request,{ok:true});
  }

  if(method==='GET'&&url.pathname==='/notifications/settings'){
    const session=await requireActive(request),u=session.user;
    const pointId=cleanText(url.searchParams.get('pointId'),80);
    await requirePoint(u,pointId);
    await q("INSERT INTO point_notification_settings(point_id) VALUES($1) ON CONFLICT(point_id) DO NOTHING",[pointId]);
    const {rows}=await q("SELECT point_id,automatic_email_enabled,notify_statuses,sender_display_name,footer_text,updated_at FROM point_notification_settings WHERE point_id=$1 LIMIT 1",[pointId]);
    const row=rows[0];
    return json(request,{
      pointId:row.point_id,
      automaticEmailEnabled:row.automatic_email_enabled,
      notifyStatuses:row.notify_statuses||[],
      senderDisplayName:row.sender_display_name,
      footerText:row.footer_text||'',
      updatedAt:row.updated_at
    });
  }

  if(method==='POST'&&url.pathname==='/notifications/settings'){
    const session=await requireActive(request),u=session.user;
    if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do ustawień powiadomień.'),{status:403});
    const body=await readJson(request),pointId=cleanText(body.pointId,80);
    await requirePoint(u,pointId);
    const automaticEmailEnabled=body.automaticEmailEnabled!==false;
    const rawStatuses=Array.isArray(body.notifyStatuses)?body.notifyStatuses:[];
    const notifyStatuses=[...new Set(rawStatuses.map((value)=>String(value).toUpperCase()).filter((value)=>SERVICE_STATUSES.has(value)))];
    const senderDisplayName=cleanText(body.senderDisplayName||'LockOn ServiceOS',80).replace(/[\r\n]+/g,' ');
    const footerText=cleanText(body.footerText||'',500);
    await q(
      "INSERT INTO point_notification_settings(point_id,automatic_email_enabled,notify_statuses,sender_display_name,footer_text,updated_by_user_id,updated_at) VALUES($1,$2,$3::text[],$4,NULLIF($5,''),$6,now()) ON CONFLICT(point_id) DO UPDATE SET automatic_email_enabled=EXCLUDED.automatic_email_enabled,notify_statuses=EXCLUDED.notify_statuses,sender_display_name=EXCLUDED.sender_display_name,footer_text=EXCLUDED.footer_text,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()",
      [pointId,automaticEmailEnabled,notifyStatuses,senderDisplayName,footerText,u.id]
    );
    await audit(session,'NOTIFICATION_SETTINGS_UPDATED','point',pointId,pointId,{automaticEmailEnabled,notifyStatuses});
    return json(request,{ok:true,pointId,automaticEmailEnabled,notifyStatuses,senderDisplayName,footerText});
  }

  if(method==='GET'&&url.pathname==='/notifications/history'){
    const session=await requireActive(request),u=session.user;
    const pointId=cleanText(url.searchParams.get('pointId'),80);
    await requirePoint(u,pointId);
    const {rows}=await q(
      "SELECT n.id,n.service_order_id,n.recipient,n.status,n.attempts,n.subject,n.provider_message_id,n.last_error,n.available_at,n.sent_at,n.created_at,n.updated_at,s.order_number,c.first_name,c.last_name,d.brand,d.model FROM notification_outbox n LEFT JOIN service_orders s ON s.id=n.service_order_id LEFT JOIN customers c ON c.id=n.customer_id LEFT JOIN devices d ON d.id=s.device_id WHERE s.point_id=$1 ORDER BY n.created_at DESC LIMIT 100",
      [pointId]
    );
    return json(request,rows.map((row)=>({
      id:row.id,
      orderId:row.service_order_id,
      orderNumber:row.order_number?Number(row.order_number):null,
      recipient:row.recipient,
      status:row.status,
      attempts:Number(row.attempts||0),
      subject:row.subject||null,
      providerMessageId:row.provider_message_id||null,
      lastError:row.last_error||null,
      availableAt:row.available_at,
      sentAt:row.sent_at||null,
      createdAt:row.created_at,
      updatedAt:row.updated_at,
      customerName:row.first_name?[row.first_name,row.last_name].filter(Boolean).join(' '):null,
      device:[row.brand,row.model].filter(Boolean).join(' ')
    })));
  }

  if(method==='POST'&&url.pathname==='/integrations/gmail/test'){
    const session=await requireActive(request),u=session.user;
    if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do testowania Gmail.'),{status:403});
    const body=await readJson(request),pointId=cleanText(body.pointId,80);
    await requirePoint(u,pointId);
    const senderBase=await loadActiveMailSender(pointId);
    if(!senderBase)return json(request,{error:'NO_SENDER',message:'Brak aktywnego firmowego nadawcy Gmail.'},409);
    const point=(await q("SELECT name FROM points WHERE id=$1 LIMIT 1",[pointId])).rows[0];
    const settings=await mailSettingsForPoint(pointId);
    const sender={
      ...senderBase,
      sender_display_name:settings.sender_display_name||'LockOn ServiceOS',
      point_name:point?.name||pointId
    };
    const recipient=normalizeEmail(u.email);
    const subject='LockOn ServiceOS · test powiadomień · '+sender.point_name;
    const textBody='To jest wiadomość testowa z LockOn ServiceOS.\n\nPunkt: '+sender.point_name+'\nNadawca: '+sender.sender_email+'\n\nJeżeli ją widzisz, integracja Gmail działa poprawnie.';
    const htmlBody='<!doctype html><html lang="pl"><body style="background:#111318;color:#eceff3;font-family:Arial,sans-serif;padding:28px"><div style="max-width:600px;margin:auto;border:1px solid #2a2f37;border-radius:16px;background:#171a20;padding:22px"><div style="color:#ff7b45;font-size:12px;font-weight:700">LOCKON SERVICEOS</div><h2 style="margin:8px 0 12px">Test powiadomień Gmail</h2><p>Integracja dla punktu <strong>'+escapeHtml(sender.point_name)+'</strong> działa poprawnie.</p><p style="color:#89939e">Nadawca: '+escapeHtml(sender.sender_email)+'</p></div></body></html>';
    try{
      const sent=await sendGmail(sender,recipient,subject,textBody,htmlBody,sender.sender_display_name);
      await q("UPDATE point_email_senders SET last_error=NULL,status='ACTIVE',updated_at=now() WHERE point_id=$1",[sender.sender_point_id]);
      await audit(session,'GMAIL_TEST_SENT','point',pointId,pointId,{recipient,messageId:sent.id,senderPointId:sender.sender_point_id,inherited:sender.sender_point_id!==pointId});
      return json(request,{ok:true,recipient,messageId:sent.id});
    }catch(error){
      const message=cleanText(error instanceof Error?error.message:error,500);
      if(isGmailReauthError(error)){
        await q("UPDATE point_email_senders SET status='REVOKED',last_error=$2,updated_at=now() WHERE point_id=$1",[sender.sender_point_id,message]);
      }else{
        await q("UPDATE point_email_senders SET last_error=$2,updated_at=now() WHERE point_id=$1",[sender.sender_point_id,message]);
      }
      throw Object.assign(new Error(message),{status:502,code:isGmailReauthError(error)?'GMAIL_REAUTH_REQUIRED':'GMAIL_TEST_FAILED'});
    }
  }

  const retryNotification=url.pathname.match(/^\/notifications\/([^/]+)\/retry$/);
  if(method==='POST'&&retryNotification){
    const session=await requireActive(request),u=session.user;
    const row=(await q("SELECT n.id,s.point_id FROM notification_outbox n JOIN service_orders s ON s.id=n.service_order_id WHERE n.id=$1 LIMIT 1",[retryNotification[1]])).rows[0];
    if(!row)return json(request,{error:'NOT_FOUND'},404);
    await requirePoint(u,row.point_id);
    if(!SERVICE_EDIT_ROLES.has(u.role_code)&&!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do ponowienia wysyłki.'),{status:403});
    await q("UPDATE notification_outbox SET status='PENDING',available_at=now(),last_error=NULL,updated_at=now() WHERE id=$1",[row.id]);
    const result=await processNotification(row.id);
    await audit(session,'NOTIFICATION_RETRIED','notification',row.id,row.point_id,result);
    return json(request,{id:row.id,...result});
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

  if(method==='POST'&&url.pathname==='/support/request'){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    const requestedPointId=cleanText(body.pointId,80);
    const pointIds=await visiblePointIds(u);
    const pointId=requestedPointId&&pointIds.includes(requestedPointId)?requestedPointId:(pointIds[0]||null);
    if(!pointId)return json(request,{error:'POINT_REQUIRED',message:'Konto nie ma przypisanego punktu do zgłoszenia.'},409);
    let conversation=(await q("SELECT id,user_id,subject,status,point_id,assigned_support_user_id,taken_at,consultant_requested_at,consultant_joined_at,closed_at,created_at,updated_at FROM support_conversations WHERE user_id=$1 AND status='OPEN' ORDER BY updated_at DESC LIMIT 1",[u.id])).rows[0];
    if(!conversation){
      const id=makeId('sup');
      conversation=(await q("INSERT INTO support_conversations(id,user_id,subject,status,point_id) VALUES($1,$2,'Pomoc konsultanta','OPEN',$3) RETURNING *",[id,u.id,pointId])).rows[0];
    }else if(!conversation.point_id){
      conversation=(await q("UPDATE support_conversations SET point_id=$2,updated_at=now() WHERE id=$1 RETURNING *",[conversation.id,pointId])).rows[0];
    }
    const note=cleanText(body.message,1500);
    if(note)await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,$3,'USER',$4)",[makeId('msg'),conversation.id,u.id,note]);
    const firstRequest=!conversation.consultant_requested_at;
    if(firstRequest){
      await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,NULL,'SYSTEM',$3)",[makeId('msg'),conversation.id,'Poproszono konsultanta o pomoc. Do czasu dołączenia konsultanta możesz nadal korzystać z bota.']);
    }
    await q("UPDATE support_conversations SET consultant_requested_at=COALESCE(consultant_requested_at,now()),updated_at=now() WHERE id=$1",[conversation.id]);
    await audit(session,'SUPPORT_REQUESTED','support_conversation',conversation.id,pointId,{firstRequest});
    return json(request,{ok:true,conversationId:conversation.id,pointId,consultantState:'WAITING'},201);
  }

  if(method==='GET'&&url.pathname==='/support/presence'){
    const session=await requireActive(request),u=session.user;
    requireSupportAccess(u);
    const ids=await visiblePointIds(u);
    const global=u.role_code==='OWNER'||GLOBAL_ROLES.has(u.role_code);
    const sql=global
      ? "SELECT usr.id,usr.name,usr.email,usr.role_code,usr.support_enabled,max(s.last_seen_at) AS last_seen_at,array_agg(DISTINCT s.client_type) AS client_types,sc.id AS conversation_id,sc.consultant_requested_at,sc.assigned_support_user_id,ass.name AS assigned_support_name,sc.updated_at AS conversation_updated_at FROM users usr JOIN auth_sessions s ON s.user_id=usr.id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() LEFT JOIN LATERAL (SELECT x.* FROM support_conversations x WHERE x.user_id=usr.id AND x.status='OPEN' ORDER BY x.updated_at DESC LIMIT 1) sc ON true LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE usr.status='ACTIVE' AND usr.blocked_at IS NULL AND usr.id<>$1 AND s.last_seen_at>now()-interval '10 minutes' GROUP BY usr.id,usr.name,usr.email,usr.role_code,usr.support_enabled,sc.id,sc.consultant_requested_at,sc.assigned_support_user_id,ass.name,sc.updated_at ORDER BY max(s.last_seen_at) DESC"
      : "SELECT usr.id,usr.name,usr.email,usr.role_code,usr.support_enabled,max(s.last_seen_at) AS last_seen_at,array_agg(DISTINCT s.client_type) AS client_types,sc.id AS conversation_id,sc.consultant_requested_at,sc.assigned_support_user_id,ass.name AS assigned_support_name,sc.updated_at AS conversation_updated_at FROM users usr JOIN auth_sessions s ON s.user_id=usr.id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() LEFT JOIN LATERAL (SELECT x.* FROM support_conversations x WHERE x.user_id=usr.id AND x.status='OPEN' ORDER BY x.updated_at DESC LIMIT 1) sc ON true LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE usr.status='ACTIVE' AND usr.blocked_at IS NULL AND usr.id<>$1 AND s.last_seen_at>now()-interval '10 minutes' AND EXISTS(SELECT 1 FROM user_point_access target_access WHERE target_access.user_id=usr.id AND target_access.point_id=ANY($2::text[])) GROUP BY usr.id,usr.name,usr.email,usr.role_code,usr.support_enabled,sc.id,sc.consultant_requested_at,sc.assigned_support_user_id,ass.name,sc.updated_at ORDER BY max(s.last_seen_at) DESC";
    const rows=global?(await q(sql,[u.id])).rows:(await q(sql,[u.id,ids])).rows;
    return json(request,rows.map(row=>({
      userId:row.id,name:row.name,email:row.email,role:row.role_code||null,supportEnabled:row.support_enabled===true,
      online:true,lastSeenAt:row.last_seen_at,clientTypes:row.client_types||[],
      conversationId:row.consultant_requested_at?row.conversation_id:null,
      consultantState:row.assigned_support_user_id?'JOINED':row.consultant_requested_at?'WAITING':'BOT',
      assignedSupportUserId:row.assigned_support_user_id||null,assignedSupportName:row.assigned_support_name||null,
      conversationUpdatedAt:row.consultant_requested_at?row.conversation_updated_at:null
    })));
  }

  if(method==='GET'&&url.pathname==='/support/tickets'){
    const session=await requireActive(request),u=session.user;
    requireSupportAccess(u);
    const ids=await visiblePointIds(u);
    const {rows}=GLOBAL_ROLES.has(u.role_code)
      ? await q("SELECT sc.*,usr.name AS user_name,usr.email AS user_email,p.name AS point_name,ass.name AS assigned_name FROM support_conversations sc JOIN users usr ON usr.id=sc.user_id LEFT JOIN points p ON p.id=sc.point_id LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE sc.consultant_requested_at IS NOT NULL ORDER BY CASE WHEN sc.status='OPEN' THEN 0 ELSE 1 END,sc.updated_at DESC LIMIT 200")
      : await q("SELECT sc.*,usr.name AS user_name,usr.email AS user_email,p.name AS point_name,ass.name AS assigned_name FROM support_conversations sc JOIN users usr ON usr.id=sc.user_id LEFT JOIN points p ON p.id=sc.point_id LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE sc.consultant_requested_at IS NOT NULL AND sc.point_id=ANY($1::text[]) ORDER BY CASE WHEN sc.status='OPEN' THEN 0 ELSE 1 END,sc.updated_at DESC LIMIT 200",[ids]);
    const tickets=[];
    for(const row of rows){
      const messages=(await q("SELECT id,sender_user_id,sender_kind,body,metadata,created_at FROM support_messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 200",[row.id])).rows;
      tickets.push({id:row.id,userId:row.user_id,userName:row.user_name,userEmail:row.user_email,pointId:row.point_id,pointName:row.point_name||'Brak punktu',status:row.status,assignedSupportUserId:row.assigned_support_user_id||null,assignedSupportName:row.assigned_name||null,consultantRequestedAt:row.consultant_requested_at||null,consultantJoinedAt:row.consultant_joined_at||row.taken_at||null,createdAt:row.created_at,updatedAt:row.updated_at,messages:messages.map(m=>({id:m.id,author:m.sender_kind.toLowerCase(),text:m.body,action:m.metadata?.action||null,createdAt:m.created_at}))});
    }
    return json(request,tickets);
  }

  const supportTicketAction=url.pathname.match(/^\/support\/tickets\/([^/]+)\/(take|reply|close)$/);
  if(method==='POST'&&supportTicketAction){
    const session=await requireActive(request),u=session.user;
    requireSupportAccess(u);
    const ticket=(await q("SELECT * FROM support_conversations WHERE id=$1 LIMIT 1",[supportTicketAction[1]])).rows[0];
    if(!ticket)return json(request,{error:'NOT_FOUND'},404);
    if(ticket.point_id)await requirePoint(u,ticket.point_id);
    const action=supportTicketAction[2],body=await readJson(request);
    if(action==='take'){
      if(!ticket.consultant_requested_at)return json(request,{error:'CONSULTANT_NOT_REQUESTED',message:'Użytkownik nie poprosił jeszcze konsultanta o dołączenie.'},409);
      const firstJoin=!ticket.assigned_support_user_id;
      await q("UPDATE support_conversations SET assigned_support_user_id=$2,taken_at=COALESCE(taken_at,now()),consultant_joined_at=COALESCE(consultant_joined_at,now()),updated_at=now() WHERE id=$1",[ticket.id,u.id]);
      if(firstJoin)await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,$3,'SYSTEM',$4)",[makeId('msg'),ticket.id,u.id,(u.name||u.email||'Konsultant')+' dołączył do rozmowy.']);
      await audit(session,'SUPPORT_TAKEN','support_conversation',ticket.id,ticket.point_id,{firstJoin});
    }else if(action==='reply'){
      const message=cleanText(body.message,2000);if(!message)return json(request,{error:'MESSAGE_REQUIRED'},400);
      if(ticket.status!=='OPEN')return json(request,{error:'TICKET_CLOSED',message:'Zgłoszenie jest zamknięte.'},409);
      await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,$3,'SUPPORT',$4)",[makeId('msg'),ticket.id,u.id,message]);
      await q("UPDATE support_conversations SET assigned_support_user_id=COALESCE(assigned_support_user_id,$2),taken_at=COALESCE(taken_at,now()),consultant_joined_at=COALESCE(consultant_joined_at,now()),updated_at=now() WHERE id=$1",[ticket.id,u.id]);
      await audit(session,'SUPPORT_REPLIED','support_conversation',ticket.id,ticket.point_id,{length:message.length});
    }else{
      await q("UPDATE support_conversations SET status='CLOSED',closed_at=now(),assigned_support_user_id=COALESCE(assigned_support_user_id,$2),updated_at=now() WHERE id=$1",[ticket.id,u.id]);
      await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,$3,'SYSTEM','Konsultant zamknął zgłoszenie.')",[makeId('msg'),ticket.id,u.id]);
      await audit(session,'SUPPORT_CLOSED','support_conversation',ticket.id,ticket.point_id,{});
    }
    return json(request,{ok:true});
  }

  if(method==='POST'&&url.pathname==='/assistant/chat'){
    const session=await requireActive(request),body=await readJson(request),message=cleanText(body.message,1500);if(!message)return json(request,{error:'MESSAGE'},400);
    const conv=await getOrCreateConversation(session.user.id);
    const live=(await q("SELECT assigned_support_user_id,consultant_requested_at FROM support_conversations WHERE id=$1",[conv.id])).rows[0]||{};
    const uid=makeId('msg');await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,$3,'USER',$4)",[uid,conv.id,session.user.id,message]);
    await q('UPDATE support_conversations SET updated_at=now() WHERE id=$1',[conv.id]);
    if(live.assigned_support_user_id){
      return json(request,{userMessage:{id:uid,author:'user',text:message,createdAt:nowIso()},assistantMessage:null,action:null,consultantState:'JOINED'});
    }
    const reply=await assistantReply(session,message);
    const aid=makeId('msg');
    await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,NULL,'ASSISTANT',$3,$4::jsonb)",[aid,conv.id,reply.text,JSON.stringify({action:reply.action||null})]);
    return json(request,{userMessage:{id:uid,author:'user',text:message,createdAt:nowIso()},assistantMessage:{id:aid,author:'assistant',text:reply.text,action:reply.action||null,createdAt:nowIso()},action:reply.action||null,consultantState:live.consultant_requested_at?'WAITING':'BOT'});
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
