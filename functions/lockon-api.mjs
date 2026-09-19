import crypto from 'node:crypto';
import { Pool } from 'pg';
import { OAuth2Client } from 'google-auth-library';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', (error) => console.error('[postgres idle client]', error));

const OWNER_EMAIL = String(process.env.LOCKON_OWNER_EMAIL || 'nowogar@gmail.com').trim().toLowerCase();
const GOOGLE_DESKTOP_CLIENT_ID = String(process.env.LOCKON_GOOGLE_DESKTOP_CLIENT_ID || '').trim();
const GOOGLE_DESKTOP_CLIENT_SECRET = String(process.env.LOCKON_GOOGLE_DESKTOP_CLIENT_SECRET || '').trim();
const GOOGLE_WEB_CLIENT_ID = String(process.env.LOCKON_GOOGLE_WEB_CLIENT_ID || '').trim();
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
const WEBSITE_CODE_TTL_MS = 1000 * 60 * 5;
const BODY_LIMIT = 64 * 1024;
const GLOBAL_ROLES = new Set(['OWNER', 'BOSS']);
const REQUESTABLE_ROLES = new Set(['BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER']);
const SERVICE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN']);
const SERVICE_CREATE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const SERVICE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const SERVICE_MANAGE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR']);
const GMAIL_MANAGE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR']);
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
    'SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users WHERE id=$1 LIMIT 1',
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
    "SELECT s.id AS session_id,s.user_id,s.client_type,s.created_at AS session_created_at,u.id,u.google_sub,u.email,u.name,u.picture_url,u.role_code,u.status,u.blocked_at,u.blocked_reason,u.first_login_at,u.last_login_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() AND u.blocked_at IS NULL LIMIT 1",
    [hash]
  );
  const row = rows[0];
  if (!row) return null;
  await q('UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1', [row.session_id]);
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
    'SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users WHERE google_sub=$1 OR lower(email)=lower($2) ORDER BY CASE WHEN google_sub=$1 THEN 0 ELSE 1 END LIMIT 1',
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

const renderStatusEmail = (item) => {
  const displayName = cleanText(item.sender_display_name || 'LockOn ServiceOS', 80).replace(/[\r\n]+/g, ' ');
  const footer = cleanText(item.footer_text || 'W razie pytań skontaktuj się bezpośrednio z punktem serwisowym.', 500);

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
    item.tracking_url ? 'Śledź zlecenie: ' + item.tracking_url : '',
    '',
    footer,
    '',
    'To automatyczna wiadomość z ' + displayName + '.'
  ].filter((line,index,array)=>line!=='' || (index>0 && array[index-1]!=='' )).join('\n');

  const html = '<!doctype html><html lang="pl"><body style="margin:0;background:#111318;color:#eceff3;font-family:Arial,sans-serif">' +
    '<div style="max-width:620px;margin:0 auto;padding:28px 18px">' +
      '<div style="border:1px solid #2a2f37;border-radius:16px;background:#171a20;overflow:hidden">' +
        '<div style="padding:18px 22px;border-bottom:1px solid #2a2f37;background:#13161b">' +
          '<div style="font-size:12px;color:#ff7b45;font-weight:700;letter-spacing:.08em">LOCKON SERVICEOS</div>' +
          '<div style="font-size:20px;font-weight:800;margin-top:6px">Aktualizacja zlecenia #' + escapeHtml(item.order_number) + '</div>' +
        '</div>' +
        '<div style="padding:22px">' +
          '<p style="margin:0 0 16px">Dzień dobry <strong>' + escapeHtml(item.first_name) + '</strong>,</p>' +
          '<p style="margin:0 0 14px;color:#aeb6c0;line-height:1.55">' + escapeHtml(intro) + '</p>' +
          '<div style="padding:16px;border-radius:12px;background:#101318;border:1px solid #333944">' +
            '<div style="font-size:11px;color:#7f8995;text-transform:uppercase">Aktualny etap</div>' +
            '<div style="font-size:21px;font-weight:800;color:#ff8754;margin-top:5px">' + escapeHtml(label) + '</div>' +
          '</div>' +
          (transferNote ? '<p style="margin:14px 0 0;padding:12px;border-radius:10px;background:#12161c;color:#aeb6c0;font-size:12px;line-height:1.5">' + escapeHtml(transferNote) + '</p>' : '') +
          '<div style="margin-top:16px;font-size:13px;color:#aeb6c0">' +
            '<strong style="color:#e8ebef">' + escapeHtml(item.brand) + ' ' + escapeHtml(item.model) + '</strong><br>' +
            'Punkt prowadzący: ' + escapeHtml(item.point_name) +
          '</div>' +
          (item.tracking_url ? '<a href="' + escapeHtml(item.tracking_url) + '" style="display:inline-block;margin-top:18px;padding:12px 16px;border-radius:10px;background:#ff7445;color:#fff;text-decoration:none;font-size:13px;font-weight:800">Śledź naprawę i historię urządzenia</a>' : '') +
          '<p style="margin:20px 0 0;font-size:12px;color:#818b97;line-height:1.5">' + escapeHtml(footer) + '</p>' +
        '</div>' +
      '</div>' +
      '<div style="padding:12px 4px;text-align:center;font-size:10px;color:#626b75">Automatyczne powiadomienie z ' + escapeHtml(displayName) + '.</div>' +
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

const processNotification = async (notificationId) => {
  const { rows } = await q(
    "SELECT n.id,n.recipient,n.service_order_id,n.template_key,n.payload,n.attempts,n.subject,n.body_text,n.body_html,s.order_number,s.status,s.point_id,p.name AS point_name,c.first_name,d.brand,d.model,e.sender_point_id,e.sender_email,e.refresh_token_ciphertext,e.oauth_client_secret_ciphertext,e.sender_status,coalesce(ns.sender_display_name,'LockOn ServiceOS') AS sender_display_name,ns.footer_text FROM notification_outbox n JOIN service_orders s ON s.id=n.service_order_id JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN LATERAL (SELECT pe.point_id AS sender_point_id,pe.sender_email,pe.refresh_token_ciphertext,pe.oauth_client_secret_ciphertext,pe.status AS sender_status FROM point_email_senders pe WHERE pe.status='ACTIVE' AND pe.refresh_token_ciphertext IS NOT NULL ORDER BY CASE WHEN pe.point_id=s.point_id THEN 0 ELSE 1 END,pe.connected_at DESC NULLS LAST,pe.updated_at DESC LIMIT 1) e ON true LEFT JOIN point_notification_settings ns ON ns.point_id=s.point_id WHERE n.id=$1 LIMIT 1",
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
    if (settings.automatic_email_enabled !== true) return { queued:false,sent:false,reason:'AUTOMATIC_EMAIL_DISABLED' };

    const sender = await loadActiveMailSender(orderData.point_id);
    if (!sender) return { queued:false,sent:false,reason:'NO_SENDER' };

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

      if (lower.includes('notatk')) {
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

      return { text: lines.join('\n') };
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
        return { text: lines.join('\n') };
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

  return { text: 'Mogę pomóc w obsłudze ServiceOS, wyszukać klienta lub zlecenie w Twoim zakresie, sprawdzić historię statusów i notatki oraz wygenerować jednorazowy kod logowania na stronę. Napisz np. "historia klienta Kowalski", "zlecenie 123 statusy", "zlecenie 123 notatki" albo "kod do strony".' };
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
      "SELECT s.id,s.order_number,s.order_type,s.handling_mode,s.issue_description,s.status,s.estimated_cost,s.final_cost,s.currency,s.estimated_completion_at,s.received_at,s.completed_at,s.created_at,s.updated_at,d.brand,d.model,p.name AS point_name,hp.name AS home_point_name,cp.name AS current_point_name FROM service_orders s JOIN devices d ON d.id=s.device_id JOIN points p ON p.id=s.point_id LEFT JOIN points hp ON hp.id=COALESCE(s.home_point_id,s.point_id) LEFT JOIN points cp ON cp.id=s.current_point_id WHERE s.tracking_token_hash=$1 LIMIT 1",
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
        device:{brand:order.brand,model:order.model},
        pointName:order.point_name,
        homePointName:order.home_point_name||order.point_name,
        currentPointName:order.current_point_name||null,
        estimatedCost:order.estimated_cost==null?null:Number(order.estimated_cost),
        finalCost:order.final_cost==null?null:Number(order.final_cost),
        currency:String(order.currency||'PLN').trim(),
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
      const userResult = await client.query("SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users WHERE id=$1 AND status='ACTIVE'", [result.rows[0].user_id]);
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

  if (method === 'GET' && url.pathname === '/admin/overview') {
    const session = await requireActive(request);
    if (session.user.role_code !== 'OWNER') throw Object.assign(new Error('Brak uprawnień.'), { status: 403 });
    const [points, users, loginEvents, pendingRevenue, sessions, recentAudit, transferSummary] = await Promise.all([
      q("SELECT p.id,p.name,p.city,p.active,p.service_enabled,p.accepts_external_repairs,p.external_repairs_paused,p.service_note,coalesce(t.active_technician_count,0)::int AS active_technician_count,(p.service_enabled OR coalesce(t.active_technician_count,0)>0) AS effective_service_enabled,(NOT p.external_repairs_paused AND (coalesce(t.active_technician_count,0)>0 OR (p.service_enabled AND p.accepts_external_repairs))) AS effective_accepts_external_repairs FROM points p LEFT JOIN LATERAL (SELECT count(*)::int AS active_technician_count FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=p.id AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL) t ON true ORDER BY p.name"),
      q("SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users ORDER BY created_at DESC"),
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
    await audit(session.user.id,'POINT_CREATED','point',pointId,pointId,{serviceEnabled,acceptsExternalRepairs});
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
        "UPDATE users SET role_code=$1,technician_split_percent=CASE WHEN $1='TECHNICIAN' THEN $2 ELSE technician_split_percent END,status='ACTIVE',updated_at=now() WHERE id=$3",
        [role,technicianSplitPercent,target.id]
      );
      await client.query('DELETE FROM user_point_access WHERE user_id=$1',[target.id]);
      if(!GLOBAL_ROLES.has(role)) for(const pointId of pointIds) await client.query('INSERT INTO user_point_access(user_id,point_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[target.id,pointId]);
      await client.query("UPDATE access_requests SET status='APPROVED',resolved_at=now(),resolved_by_user_id=$2 WHERE user_id=$1 AND status='PENDING'",[target.id,session.user.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally{client.release();}
    await audit(session.user.id,'USER_APPROVED','user',target.id,null,{role,pointIds,technicianSplitPercent});
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
    await audit(session.user.id,'POINT_SERVICE_UPDATED','point',row.id,row.id,{serviceEnabled,acceptsExternalRepairs,externalRepairsPaused:row.external_repairs_paused,activeTechnicianCount:techCount});
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
      await audit(session.user.id,'USER_BLOCKED','user',target.id,null,{reason:reason||null});
    }else{
      await q("UPDATE users SET blocked_at=NULL,blocked_reason=NULL,blocked_by_user_id=NULL,updated_at=now() WHERE id=$1",[target.id]);
      await audit(session.user.id,'USER_UNBLOCKED','user',target.id);
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
    await audit(session.user.id,'USER_SESSIONS_REVOKED','user',target.id,null,{revoked:Number(result.rowCount||0)});
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
    await audit(session.user.id,'ALL_SESSIONS_REVOKED','session',null,null,{revoked:Number(result.rowCount||0),exceptCurrent});
    return json(request,{ok:true,revoked:Number(result.rowCount||0),exceptCurrent});
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
        "'customers',(SELECT count(*) FROM customers)," +
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
    await audit(u.id,'TECHNICIAN_SETTLEMENT_UPDATED','user',u.id,null,{technicianPercent,bossPercent:Math.round((100-technicianPercent)*100)/100});
    return json(request,{configured:true,technicianPercent,bossPercent:Math.round((100-technicianPercent)*100)/100});
  }

  if(method==='GET'&&url.pathname==='/finance/revenues'){
    const session=await requireActive(request);const u=session.user;
    let rows;
    if(GLOBAL_ROLES.has(u.role_code)) rows=(await q("SELECT r.*,usr.name AS technician_name,usr.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users usr ON usr.id=r.user_id JOIN points p ON p.id=r.point_id ORDER BY r.occurred_at DESC")).rows;
    else if(u.role_code==='TECHNICIAN') rows=(await q("SELECT r.*,usr.name AS technician_name,usr.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users usr ON usr.id=r.user_id JOIN points p ON p.id=r.point_id WHERE r.user_id=$1 ORDER BY r.occurred_at DESC",[u.id])).rows;
    else rows=(await q("SELECT DISTINCT r.*,usr.name AS technician_name,usr.email AS technician_email,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users usr ON usr.id=r.user_id JOIN points p ON p.id=r.point_id JOIN user_point_access a ON a.point_id=r.point_id AND a.user_id=$1 ORDER BY r.occurred_at DESC",[u.id])).rows;
    const entries=rows.map((r)=>{const amount=Number(r.amount);const approved=r.status==='APPROVED'||r.status==='SETTLED';const split=splitRevenueAmount(amount,r.technician_percent);return{id:r.id,userId:r.user_id,pointId:r.point_id,serviceOrderId:r.service_order_id||null,amount,workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,splitTechnicianPercent:split.technicianPercent,splitBossPercent:split.bossPercent,technicianShare:approved?split.technicianShare:0,bossShare:approved?split.bossShare:0,submittedAt:r.created_at,reviewedAt:r.approved_at||null,technician:{id:r.user_id,name:r.technician_name,email:r.technician_email},point:{id:r.point_id,name:r.point_name,city:r.point_city,active:r.point_active}}});
    const approved=entries.filter((e)=>e.status==='APPROVED'||e.status==='SETTLED'),pending=entries.filter((e)=>e.status==='PENDING');
    return json(request,{entries,summary:{approvedRevenue:approved.reduce((s,e)=>s+e.amount,0),technicianShare:approved.reduce((s,e)=>s+e.technicianShare,0),bossShare:approved.reduce((s,e)=>s+e.bossShare,0),pendingRevenue:pending.reduce((s,e)=>s+e.amount,0)}});
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
    await audit(session.user.id,'REVENUE_AUTO_APPROVED','revenue',id,pointId,{amount:rounded,manual:true,technicianPercent});
    return json(request,{id,userId:session.user.id,pointId,serviceOrderId:null,amount:rounded,workDate,note,status:'APPROVED',splitTechnicianPercent:split.technicianPercent,splitBossPercent:split.bossPercent,technicianShare:split.technicianShare,bossShare:split.bossShare,submittedAt:row.created_at,reviewedAt:row.approved_at},201);
  }

  const review=url.pathname.match(/^\/finance\/revenues\/([^/]+)\/review$/);
  if(method==='POST'&&review){
    const session=await requireActive(request);if(!GLOBAL_ROLES.has(session.user.role_code))throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const body=await readJson(request),action=String(body.action||'');if(!['APPROVE','REJECT'].includes(action))return json(request,{error:'ACTION'},400);
    const result=await q("UPDATE revenue_entries SET status=$1,approved_by_user_id=$2,approved_at=now() WHERE id=$3 RETURNING *",[action==='APPROVE'?'APPROVED':'REJECTED',session.user.id,review[1]]);
    if(!result.rows[0])return json(request,{error:'NOT_FOUND'},404);
    const r=result.rows[0],amount=Number(r.amount),approved=r.status==='APPROVED';const split=splitRevenueAmount(amount,r.technician_percent);
    return json(request,{id:r.id,userId:r.user_id,pointId:r.point_id,amount,workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,splitTechnicianPercent:split.technicianPercent,splitBossPercent:split.bossPercent,technicianShare:approved?split.technicianShare:0,bossShare:approved?split.bossShare:0,submittedAt:r.created_at,reviewedAt:r.approved_at});
  }

  if(method==='GET'&&url.pathname==='/dashboard'){
    const session=await requireActive(request),u=session.user,ids=await visiblePointIds(u);
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
    await audit(u.id,'SERVICE_NOTE_ADDED','service_order',order.id,order.point_id,{length:note.length});
    return json(request,{id,body:note,createdAt:nowIso(),authorUserId:u.id,authorName:u.name||u.email},201);
  }

  const detailsMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/details$/);
  if(method==='POST'&&detailsMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do edycji zlecenia.'),{status:403});
    const found=(await q('SELECT id,point_id,home_point_id,current_point_id,handling_mode,device_id,assigned_technician_id,estimated_cost,final_cost,estimated_completion_at FROM service_orders WHERE id=$1 LIMIT 1',[detailsMatch[1]])).rows[0];
    if(!found)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,found.id);
    const body=await readJson(request);
    const imei=cleanText(body.imei,32).replace(/\s+/g,'');
    const serialNumber=cleanText(body.serialNumber,120);
    const deviceNotes=cleanText(body.deviceNotes,1000);
    if(imei&&!/^\d{14,16}$/.test(imei))return json(request,{error:'IMEI',message:'IMEI powinien zawierać 14–16 cyfr.'},400);

    if(imei){
      const conflict=(await q('SELECT id FROM devices WHERE imei=$1 AND id<>$2 LIMIT 1',[imei,found.device_id])).rows[0];
      if(conflict)return json(request,{error:'IMEI_CONFLICT',message:'Ten IMEI jest już przypisany do innego urządzenia.'},409);
    }

    const etaText=found.handling_mode==='TRANSFER_ONLY'?'':cleanText(body.estimatedCompletionAt,64);
    let estimatedCompletionAt=found.handling_mode==='TRANSFER_ONLY'?found.estimated_completion_at:null;
    if(etaText){
      const date=new Date(etaText);
      if(Number.isNaN(date.getTime()))return json(request,{error:'ETA',message:'Nieprawidłowy przewidywany termin.'},400);
      estimatedCompletionAt=date;
    }

    const canManageAssignment=SERVICE_MANAGE_ROLES.has(u.role_code);
    const canEditCosts=SERVICE_EDIT_ROLES.has(u.role_code);
    if(found.handling_mode==='TRANSFER_ONLY'&&('assignedTechnicianId' in body||'estimatedCost' in body||'finalCost' in body)){
      return json(request,{error:'TRANSFER_ONLY_DETAILS_LOCKED',message:'W trybie „Tylko przekazanie” nie ustawia się serwisanta ani cen naprawy.'},409);
    }
    if(!canManageAssignment&&'assignedTechnicianId' in body){
      throw Object.assign(new Error('Tylko kierownictwo punktu może zmieniać przypisanego technika.'),{status:403});
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

    await audit(u.id,'SERVICE_ORDER_DETAILS_UPDATED','service_order',found.id,found.point_id,{
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
    const etaText=cleanText(body.estimatedCompletionAt,64);
    let estimatedCompletionAt=null;
    if(etaText){
      const eta=new Date(etaText);
      if(Number.isNaN(eta.getTime()))return json(request,{error:'ETA',message:'Nieprawidłowy przewidywany termin.'},400);
      estimatedCompletionAt=eta;
    }
    const canManage=SERVICE_MANAGE_ROLES.has(u.role_code);
    let assignedTechnicianId=u.role_code==='TECHNICIAN'?u.id:(canManage?(cleanText(body.assignedTechnicianId,80)||null):null);
    let estimatedCost=null;
    if(body.estimatedCost!==undefined&&body.estimatedCost!==''){
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
        const senderReady=Boolean(await loadActiveMailSender(pointId));
        if(!customer.email){
          notification={queued:false,sent:false,reason:'NO_CUSTOMER_EMAIL'};
        }else if(settings.automatic_email_enabled!==true){
          notification={queued:false,sent:false,reason:'AUTOMATIC_EMAIL_DISABLED'};
        }else if(!Array.isArray(settings.notify_statuses)||!settings.notify_statuses.includes('RECEIVED')){
          notification={queued:false,sent:false,reason:'STATUS_NOT_ENABLED'};
        }else if(!senderReady){
          notification={queued:false,sent:false,reason:'NO_SENDER'};
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
        await audit(u.id,'SERVICE_ORDER_CREATED','service_order',oid,pointId,{orderType,handlingMode,notification});
      }catch(auditError){
        console.error('[service order audit]',auditError);
      }
      return json(request,{customer:customerView(customer),order:{id:order.id,orderNumber:Number(order.order_number),pointId,customerId:customer.id,deviceId:did,orderType,handlingMode,issueDescription:issue,status:'RECEIVED',assignedTechnicianId:handlingMode==='TRANSFER_ONLY'?null:assignedTechnicianId,estimatedCost:handlingMode==='TRANSFER_ONLY'?null:estimatedCost,estimatedCompletionAt:order.estimated_completion_at||null,receivedAt:order.received_at},reusedCustomer:reused,reusedDevice,notification},201);
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  const statusMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/status$/);
  if(method==='POST'&&statusMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do zmiany statusu.'),{status:403});
    const body=await readJson(request),next=String(body.status||'').toUpperCase(),note=cleanText(body.note,500);
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
      const senderReady=Boolean(await loadActiveMailSender(found.point_id));

      if(!customer?.email){
        notification={queued:false,sent:false,reason:'NO_CUSTOMER_EMAIL'};
      }else if(settings.automatic_email_enabled!==true){
        notification={queued:false,sent:false,reason:'AUTOMATIC_EMAIL_DISABLED'};
      }else if(!Array.isArray(settings.notify_statuses)||!settings.notify_statuses.includes(next)){
        notification={queued:false,sent:false,reason:'STATUS_NOT_ENABLED'};
      }else if(!senderReady){
        notification={queued:false,sent:false,reason:'NO_SENDER'};
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
      await audit(u.id,'SERVICE_STATUS_CHANGED','service_order',found.id,found.point_id,{from:found.status,to:next,notification});
    }catch(auditError){
      console.error('[service status audit]',auditError);
    }
    const view=(await listVisibleOrders(u)).find((o)=>o.id===found.id);
    return json(request,{order:view,notification,settlement});
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
    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do przekazywania zleceń.'),{status:403});
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
    await audit(u.id,kind==='RETURN_HOME'?'SERVICE_RETURN_SENT':'SERVICE_TRANSFER_SENT','service_order',order.id,fromPointId,{transferId,toPointId,kind,homePointId,notification});
    const enriched=(await loadTransfersForOrders([order.id])).get(order.id)?.find((item)=>item.id===transferId);
    return json(request,{transfer:enriched||transferView({...row,from_point_name:'',to_point_name:destination.name}),notification},201);
  }

  const transferStatusMatch=url.pathname.match(/^\/service\/transfers\/([^/]+)\/status$/);
  if(method==='POST'&&transferStatusMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do obsługi przekazania.'),{status:403});
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

    await audit(u.id,'SERVICE_TRANSFER_'+next,'service_order',transfer.service_order_id,sourceAction?transfer.from_point_id:transfer.to_point_id,{transferId:transfer.id,kind:transfer.kind,notification});
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
    await audit(u.id,'GMAIL_CONNECTED','point',pointId,pointId,{senderEmail:profile.email,identitySource:'GOOGLE_ID_TOKEN',credentialLocation:'SERVER'});
    return json(request,{connected:true,needsReconnect:false,pointId,email:profile.email,status:'ACTIVE'});
  }

  if(method==='POST'&&url.pathname==='/integrations/gmail/connect'){
    const session=await requireActive(request),u=session.user;if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do połączenia Gmail.'),{status:403});
    const body=await readJson(request),pointId=cleanText(body.pointId,80),refreshToken=cleanText(body.refreshToken,4096),idToken=cleanText(body.idToken,8192),clientSecret=cleanText(body.clientSecret,4096);
    await requirePoint(u,pointId);
    if(!refreshToken||!idToken||!clientSecret)return json(request,{error:'TOKEN',message:'Brak kompletnych danych autoryzacji Google.'},400);

    const profile=await verifyGoogle(idToken,GOOGLE_DESKTOP_CLIENT_ID);
    await refreshGmailAccess(refreshToken,clientSecret);

    await q("INSERT INTO point_email_senders(point_id,connected_by_user_id,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,status,last_error,connected_at,updated_at) VALUES($1,$2,$3,$4,$5,'ACTIVE',NULL,now(),now()) ON CONFLICT(point_id) DO UPDATE SET connected_by_user_id=EXCLUDED.connected_by_user_id,sender_email=EXCLUDED.sender_email,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,oauth_client_secret_ciphertext=EXCLUDED.oauth_client_secret_ciphertext,status='ACTIVE',last_error=NULL,connected_at=now(),updated_at=now()",[pointId,u.id,profile.email,encryptSecret(refreshToken),encryptSecret(clientSecret)]);

    await audit(u.id,'GMAIL_CONNECTED','point',pointId,pointId,{senderEmail:profile.email,identitySource:'GOOGLE_ID_TOKEN'});
    return json(request,{connected:true,needsReconnect:false,pointId,email:profile.email,status:'ACTIVE'});
  }

  if(method==='DELETE'&&url.pathname==='/integrations/gmail'){
    const session=await requireActive(request),u=session.user;if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień.'),{status:403});
    const pointId=cleanText(url.searchParams.get('pointId'),80);await requirePoint(u,pointId);await q('DELETE FROM point_email_senders WHERE point_id=$1',[pointId]);await audit(u.id,'GMAIL_DISCONNECTED','point',pointId,pointId,{});
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
    await audit(u.id,'NOTIFICATION_SETTINGS_UPDATED','point',pointId,pointId,{automaticEmailEnabled,notifyStatuses});
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
      await audit(u.id,'GMAIL_TEST_SENT','point',pointId,pointId,{recipient,messageId:sent.id,senderPointId:sender.sender_point_id,inherited:sender.sender_point_id!==pointId});
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
    await audit(u.id,'NOTIFICATION_RETRIED','notification',row.id,row.point_id,result);
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
