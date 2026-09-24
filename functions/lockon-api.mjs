import crypto from 'node:crypto';
import { Pool } from 'pg';
import { OAuth2Client } from 'google-auth-library';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import pdfMake from 'pdfmake/build/pdfmake.js';
import pdfFonts from 'pdfmake/build/vfs_fonts.js';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { buildLiveKitGrant, canJoinMeeting, getMeetingTransition, normalizeLiveKitUrls, resolveMeetingPublishPermissions } from './meeting-policy.mjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', (error) => console.error('[postgres idle client]', error));

const OWNER_EMAIL = String(process.env.LOCKON_OWNER_EMAIL || '').trim().toLowerCase();
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
const LIVEKIT_URL = String(process.env.LIVEKIT_URL || '').trim();
const LIVEKIT_API_KEY = String(process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = String(process.env.LIVEKIT_API_SECRET || '').trim();
let LIVEKIT_CONFIG = null;
let LIVEKIT_CONFIG_ERROR = '';
try {
  LIVEKIT_CONFIG = normalizeLiveKitUrls(LIVEKIT_URL);
} catch (error) {
  LIVEKIT_CONFIG_ERROR = error instanceof Error ? error.message : 'Nieprawidłowa konfiguracja LIVEKIT_URL.';
  console.error('[livekit config]', { message:LIVEKIT_CONFIG_ERROR });
}
const LIVEKIT_SERVER_URL = LIVEKIT_CONFIG?.serverUrl || '';
const LIVEKIT_CLIENT_URL = LIVEKIT_CONFIG?.clientUrl || '';
const livekitConfigured = () => Boolean(LIVEKIT_CONFIG && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
const livekitRooms = () => {
  if (!livekitConfigured()) {
    if (LIVEKIT_CONFIG_ERROR) console.error('[livekit unavailable]', { message:LIVEKIT_CONFIG_ERROR });
    throw Object.assign(new Error('Usługa spotkań audio nie jest jeszcze skonfigurowana.'),{status:503,code:'LIVEKIT_NOT_CONFIGURED'});
  }
  return new RoomServiceClient(LIVEKIT_SERVER_URL,LIVEKIT_API_KEY,LIVEKIT_API_SECRET);
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const WEB_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const WEB_SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 365 * 5;
const WEBSITE_CODE_TTL_MS = 1000 * 60 * 5;
const PUBLIC_AUTH_RATE_WINDOW_MS = 60_000;
const PUBLIC_CODE_ATTEMPT_LIMIT = 12;
const PUBLIC_GOOGLE_ATTEMPT_LIMIT = 30;
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
const MEETING_MANAGE_ROLES = new Set(['OWNER', 'BOSS']);
const CUSTOMER_QUOTE_STAFF_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const FINANCE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const DEV_TEST_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER', 'SUPPORT']);
const CUSTOMER_PORTAL_SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const SERVICE_INVOICE_BUCKET = 'service-invoices';
const SERVICE_INVOICE_MAX_BYTES = 20 * 1024 * 1024;
const SERVICE_INVOICE_URL_TTL_SECONDS = 10 * 60;
const googleVerifier = new OAuth2Client();
const invoiceStorage = process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_REGION
  ? new S3Client({
      region: process.env.AWS_REGION,
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED'
    })
  : null;
const pdfFontVfs = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs || pdfFonts;
if (pdfFontVfs && typeof pdfFontVfs === 'object') pdfMake.vfs = pdfFontVfs;
const SERVICE_SCAN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SERVICE_CARD_VARIANTS = new Set(['PHYSICAL','DEVICE','CUSTOMER']);

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
const googleIdentityMatchesUser = (profile, user) => {
  const profileSub=String(profile?.sub||'').trim();
  const userSub=String(user?.google_sub||'').trim();
  if(userSub)return Boolean(profileSub)&&profileSub===userSub;
  const profileEmail=normalizeEmail(profile?.email);
  return Boolean(profileEmail)&&profileEmail===normalizeEmail(user?.email);
};
const OWNER_OPERATIONAL_NAME = 'System LockOn';
const OWNER_SUPPORT_NAME = 'Właściciel aplikacji';
const isOwnerIdentity = (email, role = null) =>
  String(role || '').trim().toUpperCase() === 'OWNER' ||
  (Boolean(OWNER_EMAIL) && normalizeEmail(email) === OWNER_EMAIL);
const operationalIdentityName = (name, email, role = null) =>
  isOwnerIdentity(email, role) ? OWNER_OPERATIONAL_NAME : (name || email || null);
const operationalIdentityEmail = (email, role = null) =>
  isOwnerIdentity(email, role) ? null : (email || null);
const supportIdentityName = (name, email, role = null) =>
  isOwnerIdentity(email, role) ? OWNER_SUPPORT_NAME : (name || email || null);
const supportIdentityEmail = (email, role = null) =>
  isOwnerIdentity(email, role) ? null : (email || null);
const sanitizeOperationalValue = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeOperationalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeOperationalValue(item)]));
  }
  if (typeof value === 'string' && OWNER_EMAIL) {
    if (normalizeEmail(value) === OWNER_EMAIL) return null;
    let result = value;
    let lower = result.toLowerCase();
    let index = lower.indexOf(OWNER_EMAIL);
    while (index >= 0) {
      result = result.slice(0,index) + OWNER_OPERATIONAL_NAME + result.slice(index + OWNER_EMAIL.length);
      lower = result.toLowerCase();
      index = lower.indexOf(OWNER_EMAIL);
    }
    return result;
  }
  return value;
};
const normalizePhone = (value = '') => String(value).replace(/\D/g, '').slice(-15);
const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const normalizeTechnicianPercent = (value) => {
  if (value === null || value === undefined || value === '') return null;
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

const publicAuthAttempts = new Map();
const requestClientAddress = (request) => {
  const direct = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip');
  const forwarded = request.headers.get('x-forwarded-for');
  return cleanText(direct || forwarded?.split(',')[0] || '', 96);
};
const consumePublicAuthAttempt = (request, bucket, limit) => {
  const address = requestClientAddress(request);
  if (!address) return null;
  const key = bucket + ':' + address;
  const now = Date.now();
  let state = publicAuthAttempts.get(key);
  if (!state || state.resetAt <= now) state = { count: 0, resetAt: now + PUBLIC_AUTH_RATE_WINDOW_MS };
  if (state.count >= limit) {
    throw Object.assign(new Error('Zbyt wiele prób logowania. Spróbuj ponownie za minutę.'), { status: 429, code: 'RATE_LIMITED' });
  }
  state.count += 1;
  publicAuthAttempts.set(key, state);
  if (publicAuthAttempts.size > 4096) {
    for (const [entryKey, entry] of publicAuthAttempts) {
      if (entry.resetAt <= now) publicAuthAttempts.delete(entryKey);
      if (publicAuthAttempts.size <= 3072) break;
    }
  }
  return key;
};
const clearPublicAuthAttempts = (key) => {
  if (key) publicAuthAttempts.delete(key);
};

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
  email: operationalIdentityEmail(user.email, user.role_code),
  name: operationalIdentityName(user.name, user.email, user.role_code),
  picture: isOwnerIdentity(user.email, user.role_code) ? null : (user.picture_url || null),
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

const authPayload = async (user, activePointId = null) => ({
  user: await publicUser(user),
  points: await loadPointsForUser(user),
  activePointId: activePointId || null,
  gmail: await gmailStatusForUser(user)
});

const defaultActivePointIdForUser = async (user) => {
  const points=await loadPointsForUser(user);
  return points[0]?.id || null;
};

const createSession = async (userId, clientType) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const webSession = clientType === 'WEB';
  const ttl = webSession ? WEB_SESSION_TTL_MS : SESSION_TTL_MS;
  const absoluteTtl = webSession ? WEB_SESSION_ABSOLUTE_TTL_MS : SESSION_ABSOLUTE_TTL_MS;
  const user=await loadUser(userId);
  const activePointId=user?await defaultActivePointIdForUser(user):null;
  await q(
    'INSERT INTO auth_sessions(id,user_id,token_hash,client_type,active_point_id,created_at,last_seen_at,expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$5,now(),now(),$6,$7)',
    [makeId('ses'), userId, tokenHash(token), clientType, activePointId, new Date(now + ttl), new Date(now + absoluteTtl)]
  );
  return {token,activePointId};
};

const currentSession = async (request) => {
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer /i.test(auth)) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const hash = tokenHash(token);
  const { rows } = await q(
    "SELECT s.id AS session_id,s.user_id,s.client_type,s.active_point_id,s.created_at AS session_created_at,u.id,u.google_sub,u.email,u.name,u.picture_url,u.role_code,u.technician_split_percent,u.support_enabled,u.status,u.blocked_at,u.blocked_reason,u.first_login_at,u.last_login_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() AND u.blocked_at IS NULL LIMIT 1",
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
    activePointId: row.active_point_id || null,
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
    [makeId('aud'), actorUserId, action, entityType, entityId, pointId, JSON.stringify(sanitizeOperationalValue(enrichedMetadata))]
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

const verifyGoogleAccessToken = async (accessToken, audience) => {
  if (!audience) throw new Error('Google OAuth audience is not configured.');
  const token = cleanText(accessToken,4096);
  if (!token) throw new Error('Brak tokena Google.');
  const tokenInfoResponse = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), {
    headers:{Accept:'application/json'},
    redirect:'error'
  });
  const tokenInfo = await tokenInfoResponse.json().catch(() => ({}));
  const tokenAudience = cleanText(tokenInfo.aud || tokenInfo.audience || tokenInfo.issued_to || '',300);
  if (!tokenInfoResponse.ok || tokenAudience !== audience || String(tokenInfo.email_verified || '').toLowerCase() !== 'true') {
    throw new Error('Google nie potwierdził tożsamości.');
  }
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers:{Authorization:'Bearer ' + token,Accept:'application/json'},
    redirect:'error'
  });
  const userInfo = await userInfoResponse.json().catch(() => ({}));
  const sub = cleanText(userInfo.sub || tokenInfo.sub || '',180);
  const email = normalizeEmail(userInfo.email || tokenInfo.email || '');
  if (!userInfoResponse.ok || !sub || !email || (userInfo.email_verified !== undefined && userInfo.email_verified !== true)) {
    throw new Error('Google nie potwierdził tożsamości.');
  }
  return {
    sub,
    email,
    name: cleanText(userInfo.name || email,120),
    picture: cleanText(userInfo.picture || '',1000) || null
  };
};

const verifyCustomerGoogleCredential = async (body) => {
  if (body?.idToken) return verifyGoogle(String(body.idToken),GOOGLE_CUSTOMER_WEB_CLIENT_ID);
  if (body?.accessToken) return verifyGoogleAccessToken(String(body.accessToken),GOOGLE_CUSTOMER_WEB_CLIENT_ID);
  throw Object.assign(new Error('Brak tokena Google.'),{code:'MISSING_TOKEN'});
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

  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        client_id: GOOGLE_DESKTOP_CLIENT_ID,
        client_secret: GOOGLE_DESKTOP_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw Object.assign(new Error('Google nie odpowiedział na czas. Spróbuj zalogować się ponownie.'), {
        status: 504,
        code: 'GOOGLE_UPSTREAM_TIMEOUT'
      });
    }
    throw error;
  }
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

  if (OWNER_EMAIL && profile.email === OWNER_EMAIL) {
    await q(
      "INSERT INTO users(id,google_sub,email,name,picture_url,role_code,status,first_login_at,last_login_at,updated_at) VALUES('usr_owner',$1,$2,$3,$4,'OWNER','ACTIVE',now(),now(),now()) ON CONFLICT(id) DO UPDATE SET google_sub=EXCLUDED.google_sub,email=EXCLUDED.email,name=EXCLUDED.name,picture_url=EXCLUDED.picture_url,role_code='OWNER',status='ACTIVE',last_login_at=now(),updated_at=now()",
      [profile.sub, OWNER_EMAIL, profile.name || OWNER_OPERATIONAL_NAME, profile.picture]
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

  const session = await createSession(user.id, clientType);
  await audit({ user, clientType }, 'LOGIN_' + clientType, 'user', user.id, null, {});
  return { token:session.token, ...(await authPayload(user,session.activePointId)) };
};

const visiblePointIds = async (user) => {
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q('SELECT id FROM points WHERE active=true');
    return rows.map((r) => r.id);
  }
  const { rows } = await q('SELECT point_id AS id FROM user_point_access WHERE user_id=$1', [user.id]);
  return rows.map((r) => r.id);
};

const meetingCanManage = (user, meeting) =>
  MEETING_MANAGE_ROLES.has(user.role_code) ||
  meeting?.created_by_user_id === user.id ||
  meeting?.host_user_id === user.id;

const meetingEligible = async (user, meetingId) => {
  if (MEETING_MANAGE_ROLES.has(user.role_code)) return true;
  const row=(await q(
    "SELECT EXISTS(SELECT 1 FROM meeting_audience a WHERE a.meeting_id=$1 AND (a.audience_type='ALL' OR (a.audience_type='USER' AND a.user_id=$2) OR (a.audience_type='POINT' AND EXISTS(SELECT 1 FROM user_point_access upa WHERE upa.user_id=$2 AND upa.point_id=a.point_id)))) AS allowed",
    [meetingId,user.id]
  )).rows[0];
  return row?.allowed===true;
};

const meetingView = (row, user) => ({
  id:row.id,
  title:row.title,
  description:row.description||'',
  startsAt:row.starts_at,
  plannedMinutes:Number(row.planned_minutes||60),
  status:row.status,
  maxParticipants:Number(row.max_participants||50),
  allowParticipantAudio:row.allow_participant_audio===true,
  allowParticipantScreenShare:row.allow_participant_screen_share===true,
  registeredCount:Number(row.registered_count||0),
  registeredByMe:row.registered_by_me===true,
  canManage:meetingCanManage(user,row),
  createdByUserId:row.created_by_user_id,
  createdByName:operationalIdentityName(row.creator_name,row.creator_email,row.creator_role)||'ServiceOS',
  hostUserId:row.host_user_id,
  hostName:operationalIdentityName(row.host_name,row.host_email,row.host_role)||'Prowadzący',
  audience:Array.isArray(row.audience)?row.audience:[],
  startedAt:row.started_at||null,
  endedAt:row.ended_at||null,
  cancelledAt:row.cancelled_at||null,
  createdAt:row.created_at,
  updatedAt:row.updated_at
});

const listMeetingsForUser = async (user) => {
  const global=MEETING_MANAGE_ROLES.has(user.role_code);
  const visibility=global
    ? 'true'
    : "(m.created_by_user_id=$1 OR m.host_user_id=$1 OR EXISTS(SELECT 1 FROM meeting_audience a WHERE a.meeting_id=m.id AND (a.audience_type='ALL' OR (a.audience_type='USER' AND a.user_id=$1) OR (a.audience_type='POINT' AND EXISTS(SELECT 1 FROM user_point_access upa WHERE upa.user_id=$1 AND upa.point_id=a.point_id)))))";
  const sql=
    "SELECT m.*,cu.name AS creator_name,cu.email AS creator_email,cu.role_code AS creator_role,hu.name AS host_name,hu.email AS host_email,hu.role_code AS host_role,"+
    "(SELECT count(*)::int FROM meeting_registrations r WHERE r.meeting_id=m.id AND r.status='REGISTERED') AS registered_count,"+
    "EXISTS(SELECT 1 FROM meeting_registrations r WHERE r.meeting_id=m.id AND r.user_id=$1 AND r.status='REGISTERED') AS registered_by_me,"+
    "COALESCE((SELECT json_agg(json_build_object('type',a.audience_type,'pointId',a.point_id,'pointName',p.name,'userId',a.user_id,'userName',operational.name)) FROM meeting_audience a LEFT JOIN points p ON p.id=a.point_id LEFT JOIN LATERAL (SELECT CASE WHEN au.role_code='OWNER' THEN $2 ELSE COALESCE(NULLIF(au.name,''),au.email) END AS name FROM users au WHERE au.id=a.user_id) operational ON true WHERE a.meeting_id=m.id),'[]'::json) AS audience "+
    "FROM meetings m JOIN users cu ON cu.id=m.created_by_user_id JOIN users hu ON hu.id=m.host_user_id WHERE "+visibility+
    (global?"":" AND m.status<>'CANCELLED'")+
    " ORDER BY CASE m.status WHEN 'LIVE' THEN 0 WHEN 'SCHEDULED' THEN 1 WHEN 'ENDED' THEN 2 ELSE 3 END,m.starts_at ASC,m.created_at DESC LIMIT 100";
  const rows=(await q(sql,[user.id,OWNER_OPERATIONAL_NAME])).rows;
  return rows.map((row)=>meetingView(row,user));
};

const loadMeeting = async (meetingId) =>
  (await q("SELECT * FROM meetings WHERE id=$1 LIMIT 1",[meetingId])).rows[0]||null;

const meetingEvent = async (meetingId, actorUserId, eventType, metadata={}) =>
  q("INSERT INTO meeting_events(id,meeting_id,actor_user_id,event_type,metadata) VALUES($1,$2,$3,$4,$5::jsonb)",[
    makeId('mte'),meetingId,actorUserId||null,eventType,JSON.stringify(metadata||{})
  ]);

const meetingRoomName = (meetingId) => 'lockon-' + String(meetingId).replace(/[^A-Za-z0-9_-]/g,'').slice(0,100);
const meetingParticipantIdentity = (meetingId,userId) =>
  'p_' + crypto.createHash('sha256').update(meetingId+':'+userId).digest('hex').slice(0,28);

const meetingPublishSources = (meeting,user,isManager,control=null) => {
  const permissions=resolveMeetingPublishPermissions({
    isManager,
    allowParticipantAudio:meeting.allow_participant_audio===true,
    allowParticipantScreenShare:meeting.allow_participant_screen_share===true,
    microphoneAllowed:control?.microphone_allowed ?? null
  });
  const sources=[];
  if(permissions.microphone)sources.push(TrackSource.MICROPHONE);
  if(permissions.screenShare)sources.push(TrackSource.SCREEN_SHARE,TrackSource.SCREEN_SHARE_AUDIO);
  return { sources, permissions };
};

const createMeetingJoinToken = async (meeting,user) => {
  if(!livekitConfigured())throw Object.assign(new Error('Usługa spotkań audio nie jest jeszcze skonfigurowana.'),{status:503,code:'LIVEKIT_NOT_CONFIGURED'});
  const isManager=meetingCanManage(user,meeting);
  const control=isManager?null:(await q("SELECT microphone_allowed,removed_at FROM meeting_participant_controls WHERE meeting_id=$1 AND user_id=$2 LIMIT 1",[meeting.id,user.id])).rows[0]||null;
  if(control?.removed_at)throw Object.assign(new Error('Prowadzący usunął Cię z tego spotkania.'),{status:403,code:'MEETING_REMOVED'});
  const {sources,permissions}=meetingPublishSources(meeting,user,isManager,control);
  const room=meetingRoomName(meeting.id);
  const identity=meetingParticipantIdentity(meeting.id,user.id);
  const token=new AccessToken(LIVEKIT_API_KEY,LIVEKIT_API_SECRET,{
    identity,
    name:operationalIdentityName(user.name,user.email,user.role_code)||'Uczestnik',
    metadata:JSON.stringify({serviceOsUserId:user.id,role:user.role_code||null,meetingId:meeting.id,manager:isManager}),
    ttl:'10m'
  });
  token.addGrant(buildLiveKitGrant(room,sources));
  const jwt=await token.toJwt();
  console.info('[meeting join-token]', {
    meetingId:meeting.id,
    roomName:room,
    identity,
    livekitHost:LIVEKIT_CONFIG?.hostname || null,
    livekitCloud:LIVEKIT_CONFIG?.isCloud === true,
    microphone:permissions.microphone,
    screenShare:permissions.screenShare,
    manager:isManager
  });
  return {
    serverUrl:LIVEKIT_CLIENT_URL,
    token:jwt,
    roomName:room,
    identity,
    canManage:isManager,
    permissions
  };
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
    "SELECT DISTINCT c.id,c.first_name,c.last_name,c.email,c.phone FROM customers c JOIN service_orders s ON s.customer_id=c.id WHERE lower(c.first_name||' '||c.last_name||' '||coalesce(c.email,'')||' '||coalesce(c.phone,'')) LIKE '%'||lower($1)||'%' AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND (a.point_id=COALESCE(s.home_point_id,s.point_id) OR a.point_id=COALESCE(s.current_point_id,s.home_point_id,s.point_id))) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id AND t.status IN ('REQUESTED','IN_TRANSIT','DELIVERED'))) ORDER BY c.last_name,c.first_name LIMIT 20",
    [query, user.id]
  );
  return rows.map(customerView);
};

const warrantyCardNumberFor = (orderNumber,startedAt=null) => {
  const date=startedAt?new Date(startedAt):new Date();
  const year=Number.isNaN(date.getTime())?new Date().getFullYear():date.getFullYear();
  return 'GW-'+year+'-'+String(Number(orderNumber)||0).padStart(6,'0');
};

const warrantyPortalView = (row) => {
  if(!row.warranty_months)return null;
  const expiresAt=row.warranty_expires_at||null;
  const expiresMs=expiresAt?new Date(expiresAt).getTime():NaN;
  const active=Number.isFinite(expiresMs)&&expiresMs>=Date.now();
  return {
    months:Number(row.warranty_months),
    startedAt:row.warranty_started_at||null,
    expiresAt,
    cardPrintedAt:row.warranty_card_printed_at||null,
    cardAvailable:Boolean(row.warranty_card_printed_at),
    cardNumber:warrantyCardNumberFor(row.order_number,row.warranty_started_at),
    repairSummary:row.repair_summary||null,
    status:active?'ACTIVE':'EXPIRED',
    active,
    daysRemaining:active?Math.max(0,Math.ceil((expiresMs-Date.now())/86400000)):0
  };
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
  customerFirstName: row.first_name,
  customerLastName: row.last_name,
  customerEmail: row.email || null,
  customerPhone: row.phone || null,
  deviceId: row.device_id,
  brand: row.brand,
  model: row.model,
  imei: row.imei || null,
  serialNumber: row.serial_number || null,
  deviceNotes: row.device_notes || null,
  orderType: row.order_type,
  originalOrderId: row.original_order_id || null,
  handlingMode: row.handling_mode || 'STANDARD',
  issueDescription: row.issue_description,
  status: row.status,
  statusLabel: STATUS_LABELS[row.status] || row.status,
  assignedTechnicianId: isOwnerIdentity(row.technician_email, row.technician_role) ? null : (row.assigned_technician_id || null),
  assignedTechnicianName: isOwnerIdentity(row.technician_email, row.technician_role) ? null : (row.technician_name || null),
  assignedTechnicianEmail: isOwnerIdentity(row.technician_email, row.technician_role) ? null : (row.technician_email || null),
  estimatedCost: row.estimated_cost == null ? null : Number(row.estimated_cost),
  finalCost: row.final_cost == null ? null : Number(row.final_cost),
  currency: row.currency || 'PLN',
  estimatedCompletionAt: row.estimated_completion_at || null,
  planPosition: Number(row.plan_position || 0),
  repairSummary: row.repair_summary || null,
  warrantyMonths: row.warranty_months == null ? null : Number(row.warranty_months),
  warrantyStartedAt: row.warranty_started_at || null,
  warrantyExpiresAt: row.warranty_expires_at || null,
  warrantyCardPrintedAt: row.warranty_card_printed_at || null,
  warrantyCardPrintCount: Number(row.warranty_card_print_count || 0),
  warrantyCardNumber: row.warranty_months ? warrantyCardNumberFor(row.order_number,row.warranty_started_at) : null,
  warrantyReady: Boolean(row.warranty_months && row.warranty_expires_at && row.warranty_card_printed_at),
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
  sentByName: operationalIdentityName(row.sent_by_name, row.sent_by_email, row.sent_by_role) || 'Użytkownik',
  acceptedByUserId: row.accepted_by_user_id || null,
  acceptedByName: row.accepted_by_user_id ? operationalIdentityName(row.accepted_by_name, row.accepted_by_email, row.accepted_by_role) : null,
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
    } else if (!order.warrantyReady) {
      nextActionCode = 'PREPARE_WARRANTY';
      nextAction = 'Ustaw okres gwarancji i wydrukuj kartę gwarancyjną przed oznaczeniem urządzenia jako gotowe.';
      flags.push('ACTION_NOW','WARRANTY_REQUIRED');
    } else {
      nextActionCode = 'MARK_READY';
      nextAction = 'Gwarancja jest przygotowana. Oznacz urządzenie jako gotowe do odbioru.';
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
    "SELECT t.*,fp.name AS from_point_name,fp.city AS from_point_city,tp.name AS to_point_name,tp.city AS to_point_city,su.name AS sent_by_name,su.email AS sent_by_email,su.role_code AS sent_by_role,au.name AS accepted_by_name,au.email AS accepted_by_email,au.role_code AS accepted_by_role FROM service_order_transfers t JOIN points fp ON fp.id=t.from_point_id JOIN points tp ON tp.id=t.to_point_id JOIN users su ON su.id=t.sent_by_user_id LEFT JOIN users au ON au.id=t.accepted_by_user_id WHERE t.service_order_id=ANY($1::text[]) ORDER BY t.requested_at DESC",
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
    const warrantyReady = Boolean(order.warrantyReady);
    const canMarkReady = !openTransfer && currentPointId === homePointId && !returnRequired && warrantyReady;
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

const canReadOrder = async (user, orderId) => {
  if (GLOBAL_ROLES.has(user.role_code)) return true;
  const { rowCount } = await q(
    "SELECT 1 FROM service_orders s WHERE s.id=$1 AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND (a.point_id=COALESCE(s.home_point_id,s.point_id) OR a.point_id=COALESCE(s.current_point_id,s.home_point_id,s.point_id))) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id AND t.status IN ('REQUESTED','IN_TRANSIT','DELIVERED'))) LIMIT 1",
    [orderId, user.id]
  );
  return rowCount > 0;
};

const requireReadableOrder = async (user, orderId) => {
  if (!(await canReadOrder(user, orderId))) {
    throw Object.assign(new Error('Brak dostępu do podglądu tego zlecenia.'), { status:403, code:'ORDER_READ_FORBIDDEN' });
  }
};

const canSeeOrder = async (user, orderId) => {
  if (GLOBAL_ROLES.has(user.role_code)) return true;
  const { rowCount } = await q(
    "SELECT 1 FROM service_orders s WHERE s.id=$1 AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND a.point_id=COALESCE(s.current_point_id,s.home_point_id,s.point_id)) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id AND t.status IN ('REQUESTED','IN_TRANSIT','DELIVERED'))) LIMIT 1",
    [orderId, user.id]
  );
  return rowCount > 0;
};

const requireOrder = async (user, orderId) => {
  if (!(await canSeeOrder(user, orderId))) {
    throw Object.assign(new Error('Brak dostępu do tego zlecenia.'), { status: 403, code: 'ORDER_FORBIDDEN' });
  }
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const nullableMoney = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 10_000_000
    ? roundMoney(number)
    : null;
};

const requireServiceFinanceOrder = async (user, orderId) => {
  if (!SERVICE_EDIT_ROLES.has(user.role_code)) {
    throw Object.assign(new Error('Brak uprawnień do kosztów części, robocizny i faktur.'), { status:403, code:'SERVICE_FINANCE_FORBIDDEN' });
  }
  await requireOrder(user, orderId);
  const order=(await q(
    'SELECT id,order_number,point_id,home_point_id,assigned_technician_id,estimated_cost,final_cost,labor_cost_gross,other_cost_gross,currency FROM service_orders WHERE id=$1 LIMIT 1',
    [orderId]
  )).rows[0];
  if(!order) throw Object.assign(new Error('Nie znaleziono zlecenia.'),{status:404,code:'NOT_FOUND'});
  if(user.role_code==='TECHNICIAN' && order.assigned_technician_id!==user.id){
    throw Object.assign(new Error('Koszty i faktury tego zlecenia może edytować przypisany serwisant.'),{status:403,code:'TECHNICIAN_ORDER_REQUIRED'});
  }
  return order;
};

const servicePartView = (row) => ({
  id:row.id,
  description:row.description,
  quantity:Number(row.quantity),
  unitCostGross:Number(row.unit_cost_gross),
  totalCostGross:roundMoney(Number(row.quantity)*Number(row.unit_cost_gross)),
  invoiceReceived:row.invoice_received===true,
  invoiceNumber:row.invoice_number||null,
  supplier:row.supplier||null,
  purchasedAt:row.purchased_at||null,
  createdAt:row.created_at,
  updatedAt:row.updated_at
});

const serviceInvoiceView = (row) => ({
  id:row.id,
  orderId:row.service_order_id,
  orderNumber:row.order_number==null?null:Number(row.order_number),
  pointId:row.point_id||null,
  pointName:row.point_name||null,
  customerName:row.customer_name||null,
  device:row.device_label||null,
  fileName:row.file_name,
  sizeBytes:Number(row.size_bytes),
  invoiceNumber:row.invoice_number||null,
  supplier:row.supplier||null,
  invoiceDate:row.invoice_date||null,
  grossAmount:row.gross_amount==null?null:Number(row.gross_amount),
  uploadedByUserId:row.uploaded_by_user_id,
  uploadedByName:row.uploaded_by_user_id ? operationalIdentityName(row.uploaded_by_name,row.uploaded_by_email,row.uploaded_by_role) : null,
  createdAt:row.created_at,
  readyAt:row.ready_at||null
});

const loadOrderCosting = async (user, orderId) => {
  const order=await requireServiceFinanceOrder(user,orderId);
  const parts=(await q(
    'SELECT id,description,quantity,unit_cost_gross,invoice_received,invoice_number,supplier,purchased_at,created_at,updated_at FROM service_order_parts WHERE service_order_id=$1 ORDER BY created_at ASC,id ASC',
    [orderId]
  )).rows.map(servicePartView);
  const invoices=(await q(
    "SELECT i.*,s.order_number,u.name AS uploaded_by_name,u.email AS uploaded_by_email,u.role_code AS uploaded_by_role FROM service_order_invoices i JOIN service_orders s ON s.id=i.service_order_id LEFT JOIN users u ON u.id=i.uploaded_by_user_id WHERE i.service_order_id=$1 AND i.status='READY' ORDER BY COALESCE(i.invoice_date,i.created_at::date) DESC,i.created_at DESC",
    [orderId]
  )).rows.map(serviceInvoiceView);
  const partsTotal=roundMoney(parts.reduce((sum,item)=>sum+item.totalCostGross,0));
  const laborCostGross=order.labor_cost_gross==null?0:Number(order.labor_cost_gross);
  const otherCostGross=order.other_cost_gross==null?0:Number(order.other_cost_gross);
  const internalCostGross=roundMoney(partsTotal+laborCostGross+otherCostGross);
  const customerPrice=order.final_cost==null?(order.estimated_cost==null?null:Number(order.estimated_cost)):Number(order.final_cost);
  return {
    orderId:order.id,
    orderNumber:Number(order.order_number),
    currency:String(order.currency||'PLN').trim(),
    parts,
    invoices,
    partsCostGross:partsTotal,
    laborCostGross:roundMoney(laborCostGross),
    otherCostGross:roundMoney(otherCostGross),
    internalCostGross,
    estimatedCost:order.estimated_cost==null?null:Number(order.estimated_cost),
    finalCost:order.final_cost==null?null:Number(order.final_cost),
    customerPrice,
    marginGross:customerPrice==null?null:roundMoney(customerPrice-internalCostGross)
  };
};

const requireInvoiceStorage = () => {
  if (!invoiceStorage) {
    throw Object.assign(new Error('Magazyn faktur PDF nie jest obecnie dostępny.'), { status:503, code:'INVOICE_STORAGE_UNAVAILABLE' });
  }
  return invoiceStorage;
};

const safePdfFileName = (value) => {
  const base=String(value||'faktura.pdf').trim().replace(/[\\/\0-\x1f<>:"|?*]+/g,'_').replace(/\s+/g,' ').slice(0,180);
  return /\.pdf$/i.test(base)?base:(base+'.pdf');
};

const invoicePeriodBounds = (period) => {
  const match=/^(\d{4})-(\d{2})$/.exec(String(period||''));
  if(!match) return null;
  const year=Number(match[1]),month=Number(match[2]);
  if(year<2020||year>2200||month<1||month>12)return null;
  const start=match[1]+'-'+match[2]+'-01';
  const nextMonth=month===12?1:month+1;
  const nextYear=month===12?year+1:year;
  const end=String(nextYear).padStart(4,'0')+'-'+String(nextMonth).padStart(2,'0')+'-01';
  return {period:match[1]+'-'+match[2],start,end};
};

const warsawCalendarDate = () => {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date()).filter((item)=>item.type!=='literal').map((item)=>[item.type,item.value]));
  return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day)};
};

const monthlyInvoicePromptPeriod = () => {
  const now=warsawCalendarDate();
  if(now.day>=25) return String(now.year).padStart(4,'0')+'-'+String(now.month).padStart(2,'0');
  if(now.day<=5){
    const month=now.month===1?12:now.month-1;
    const year=now.month===1?now.year-1:now.year;
    return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0');
  }
  return null;
};

const listAccessibleInvoices = async (user, period, pointId) => {
  if(!SERVICE_EDIT_ROLES.has(user.role_code)) throw Object.assign(new Error('Brak dostępu do magazynu faktur.'),{status:403,code:'SERVICE_FINANCE_FORBIDDEN'});
  const bounds=invoicePeriodBounds(period);
  if(!bounds) throw Object.assign(new Error('Nieprawidłowy miesiąc.'),{status:400,code:'INVOICE_PERIOD'});
  const safePointId=cleanText(pointId,80);
  if(!safePointId) throw Object.assign(new Error('Wybierz punkt dla magazynu faktur.'),{status:400,code:'INVOICE_POINT_REQUIRED'});
  await requirePoint(user,safePointId);
  const params=[bounds.start,bounds.end,safePointId];
  let access=' AND s.point_id=$3';
  if(user.role_code==='TECHNICIAN'){
    params.push(user.id);
    access+=' AND s.assigned_technician_id=$4';
  }
  const {rows}=await q(
    "SELECT i.*,s.order_number,s.point_id,p.name AS point_name,(c.first_name||' '||c.last_name) AS customer_name,(d.brand||' '||d.model) AS device_label,u.name AS uploaded_by_name,u.email AS uploaded_by_email,u.role_code AS uploaded_by_role FROM service_order_invoices i JOIN service_orders s ON s.id=i.service_order_id JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users u ON u.id=i.uploaded_by_user_id WHERE i.status='READY' AND COALESCE(i.invoice_date,i.created_at::date)>=$1::date AND COALESCE(i.invoice_date,i.created_at::date)<$2::date"+access+" ORDER BY COALESCE(i.invoice_date,i.created_at::date) DESC,i.created_at DESC LIMIT 300",
    params
  );
  return rows.map(serviceInvoiceView);
};

const getVisibleOrderByNumber = async (user, number) => {
  const params = [Number(number)];
  let access = '';
  if (!GLOBAL_ROLES.has(user.role_code)) {
    params.push(user.id);
    access = " AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND (a.point_id=COALESCE(s.home_point_id,s.point_id) OR a.point_id=COALESCE(s.current_point_id,s.home_point_id,s.point_id))) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id AND t.status IN ('REQUESTED','IN_TRANSIT','DELIVERED')))";
  }
  const { rows } = await q(
    "SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email,tech.role_code AS technician_role FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id LEFT JOIN customer_portal_accounts ca ON ca.customer_id=c.id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id WHERE s.order_number=$1" + access + ' LIMIT 1',
    params
  );
  if (!rows[0]) return null;
  return (await attachTransfers([orderViewForUser(rows[0], user)]))[0];
};

const listVisibleOrders = async (user,paging=null) => {
  const requestedLimit=Number(paging?.limit);
  const requestedOffset=Number(paging?.offset);
  const limit=Number.isFinite(requestedLimit)?Math.max(1,Math.min(Math.trunc(requestedLimit),150)):150;
  const offset=Number.isFinite(requestedOffset)?Math.max(0,Math.min(Math.trunc(requestedOffset),5000)):0;
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q(
      "SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email,tech.role_code AS technician_role FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id ORDER BY s.updated_at DESC,s.created_at DESC LIMIT $1 OFFSET $2",
      [limit,offset]
    );
    return sortOrdersByWorkflow(await attachTransfers(rows.map((row) => orderViewForUser(row, user))));
  }
  const { rows } = await q(
    "SELECT DISTINCT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email,tech.role_code AS technician_role FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id WHERE EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$1 AND (a.point_id=COALESCE(s.home_point_id,s.point_id) OR a.point_id=COALESCE(s.current_point_id,s.home_point_id,s.point_id))) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$1 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id AND t.status IN ('REQUESTED','IN_TRANSIT','DELIVERED')) ORDER BY s.updated_at DESC,s.created_at DESC LIMIT $2 OFFSET $3",
    [user.id,limit,offset]
  );
  return sortOrdersByWorkflow(await attachTransfers(rows.map((row) => orderViewForUser(row, user))));
};

const searchVisibleOrders = async (user, term) => {
  const query = cleanText(term, 120);
  if (query.length < 2) return [];
  const searchableQuery = query.replace(/^#\s*/, '');
  if (searchableQuery.length < 1) return [];
  const pattern = '%' + searchableQuery + '%';
  const commonMatch = `(
    CAST(s.order_number AS text) ILIKE $1 OR
    lower(c.first_name||' '||c.last_name||' '||coalesce(c.email,'')||' '||coalesce(c.phone,'')||' '||coalesce(d.brand,'')||' '||coalesce(d.model,'')||' '||coalesce(d.imei,'')||' '||coalesce(d.serial_number,'')) LIKE lower($1)
  )`;
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q(
      `SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email,tech.role_code AS technician_role
       FROM service_orders s
       JOIN points p ON p.id=s.point_id
       JOIN customers c ON c.id=s.customer_id
       JOIN devices d ON d.id=s.device_id
       LEFT JOIN users tech ON tech.id=s.assigned_technician_id
       WHERE ${commonMatch}
       ORDER BY s.created_at DESC
       LIMIT 24`,
      [pattern]
    );
    return attachTransfers(rows.map((row) => orderViewForUser(row, user)));
  }
  const { rows } = await q(
    `SELECT DISTINCT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email,tech.role_code AS technician_role
     FROM service_orders s
     JOIN points p ON p.id=s.point_id
     JOIN customers c ON c.id=s.customer_id
     JOIN devices d ON d.id=s.device_id
     LEFT JOIN users tech ON tech.id=s.assigned_technician_id
     WHERE ${commonMatch}
       AND (
         EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND (a.point_id=COALESCE(s.home_point_id,s.point_id) OR a.point_id=COALESCE(s.current_point_id,s.home_point_id,s.point_id)))
         OR EXISTS(
           SELECT 1 FROM service_order_transfers t
           JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id)
           WHERE t.service_order_id=s.id AND t.status IN ('REQUESTED','IN_TRANSIT','DELIVERED')
         )
       )
     ORDER BY s.created_at DESC
     LIMIT 24`,
    [pattern, user.id]
  );
  return attachTransfers(rows.map((row) => orderViewForUser(row, user)));
};

const listVisibleCustomerOrders = async (user, customerId) => {
  if (GLOBAL_ROLES.has(user.role_code)) {
    const { rows } = await q(
      "SELECT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email,tech.role_code AS technician_role FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id WHERE s.customer_id=$1 ORDER BY s.created_at DESC LIMIT 100",
      [customerId]
    );
    return attachTransfers(rows.map((row) => orderViewForUser(row, user)));
  }
  const { rows } = await q(
    "SELECT DISTINCT s.*,p.name AS point_name,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,tech.name AS technician_name,tech.email AS technician_email,tech.role_code AS technician_role FROM service_orders s JOIN points p ON p.id=s.point_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id LEFT JOIN users tech ON tech.id=s.assigned_technician_id WHERE s.customer_id=$1 AND (EXISTS(SELECT 1 FROM user_point_access a WHERE a.user_id=$2 AND (a.point_id=COALESCE(s.home_point_id,s.point_id) OR a.point_id=COALESCE(s.current_point_id,s.home_point_id,s.point_id))) OR EXISTS(SELECT 1 FROM service_order_transfers t JOIN user_point_access a ON a.user_id=$2 AND (a.point_id=t.from_point_id OR a.point_id=t.to_point_id) WHERE t.service_order_id=s.id AND t.status IN ('REQUESTED','IN_TRANSIT','DELIVERED'))) ORDER BY s.created_at DESC LIMIT 100",
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

const loadUserMailSender = async (userId) => {
  if (!userId) return null;
  const { rows } = await q(
    "SELECT user_id AS sender_user_id,sender_email,google_sub,refresh_token_ciphertext,oauth_client_secret_ciphertext,granted_scopes,status,last_error,connected_at,updated_at FROM user_gmail_credentials WHERE user_id=$1 AND status='ACTIVE' AND refresh_token_ciphertext IS NOT NULL LIMIT 1",
    [userId]
  );
  const sender = rows[0] || null;
  if (!sender) return null;
  if (!GOOGLE_DESKTOP_CLIENT_SECRET && !sender.oauth_client_secret_ciphertext) return null;
  return sender;
};

const gmailStatusForUser = async (user) => {
  if (!user?.id) return { connected:false, reason:'NOT_CONNECTED' };
  if (user.role_code === 'OWNER') return { connected:false, skipped:true, reason:'OWNER_PRIVACY' };
  const row = (await q(
    "SELECT sender_email,status,last_error,connected_at FROM user_gmail_credentials WHERE user_id=$1 LIMIT 1",
    [user.id]
  )).rows[0];
  if (!row) return { connected:false, reason:'NOT_CONNECTED' };
  return {
    connected:row.status==='ACTIVE',
    needsReconnect:row.status==='REVOKED',
    email:operationalIdentityEmail(row.sender_email,user.role_code),
    status:row.status,
    reason:row.status==='ACTIVE'?'ACTIVE':row.status,
    lastError:row.last_error||null,
    connectedAt:row.connected_at
  };
};

const recoverNoSenderNotificationsForUser = async (userId) => {
  const { rows } = await q(
    "UPDATE notification_outbox SET status='PENDING',attempts=0,last_error=NULL,available_at=now(),updated_at=now() WHERE user_id=$1 AND status='FAILED' AND last_error IN ('Brak aktywnego, kompletnego nadawcy Gmail dla punktu.','Brak aktywnego Gmail zalogowanego pracownika.') RETURNING id",
    [userId]
  );
  let sent = 0;
  for (const row of rows) {
    const result = await processNotification(row.id);
    if (result?.sent) sent += 1;
  }
  return { recovered: rows.length, sent };
};


const autoConnectGmailFromPrimaryLogin = async (loginPayload, profile, tokens) => {
  const role = cleanText(loginPayload?.user?.role, 40).toUpperCase();
  const pointId = cleanText(loginPayload?.activePointId, 80);
  const userId = cleanText(loginPayload?.user?.id, 120);
  const status = cleanText(loginPayload?.user?.status, 40).toUpperCase();

  // OWNER pozostaje anonimowy operacyjnie. Pozostali aktywni pracownicy
  // wysyłają wiadomości wyłącznie ze swojego konta Google.
  if (role === 'OWNER') {
    return { connected:false, skipped:true, reason:'OWNER_PRIVACY', pointId:pointId || null };
  }
  if (!role || status !== 'ACTIVE' || !userId) {
    return { connected:false, skipped:true, reason:'ROLE_OR_STATUS', pointId:pointId || null };
  }

  const refreshToken = cleanText(tokens?.refresh_token, 4096);
  const grantedScopes = String(tokens?.scope || '').split(/\s+/).filter(Boolean);
  if (!grantedScopes.includes('https://www.googleapis.com/auth/gmail.send')) {
    return { connected:false, skipped:false, reason:'GMAIL_SCOPE_NOT_GRANTED', pointId:pointId || null };
  }

  if (!refreshToken) {
    const existing = (await q(
      "SELECT sender_email,google_sub,refresh_token_ciphertext,status FROM user_gmail_credentials WHERE user_id=$1 AND status='ACTIVE' AND lower(sender_email)=lower($2) AND (google_sub=$3 OR google_sub IS NULL) AND refresh_token_ciphertext IS NOT NULL LIMIT 1",
      [userId,profile.email,profile.sub]
    )).rows[0];
    if (existing?.refresh_token_ciphertext) {
      try {
        await refreshGmailAccess(decryptSecret(existing.refresh_token_ciphertext), '');
        await q("UPDATE user_gmail_credentials SET google_sub=COALESCE(google_sub,$2),last_error=NULL,status='ACTIVE',updated_at=now() WHERE user_id=$1",[userId,profile.sub]);
        return {
          connected:true,
          skipped:false,
          pointId:pointId || null,
          email:operationalIdentityEmail(existing.sender_email, role),
          status:'ACTIVE',
          reason:'EXISTING_USER_SENDER_REUSED'
        };
      } catch {
        console.warn('[gmail user credential reuse at login] stored credential could not be refreshed');
      }
    }
    return { connected:false, skipped:false, reason:'REFRESH_TOKEN_MISSING', pointId:pointId || null };
  }

  try {
    await refreshGmailAccess(refreshToken, '');
    await q(
      "INSERT INTO user_gmail_credentials(user_id,google_sub,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,granted_scopes,status,last_error,connected_at,updated_at) VALUES($1,$2,$3,$4,NULL,$5::text[],'ACTIVE',NULL,now(),now()) ON CONFLICT(user_id) DO UPDATE SET google_sub=EXCLUDED.google_sub,sender_email=EXCLUDED.sender_email,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,oauth_client_secret_ciphertext=NULL,granted_scopes=EXCLUDED.granted_scopes,status='ACTIVE',last_error=NULL,connected_at=now(),updated_at=now()",
      [userId,profile.sub,profile.email,encryptSecret(refreshToken),grantedScopes]
    );
    if (pointId) {
      await q(
        "INSERT INTO point_notification_settings(point_id,automatic_email_enabled,notify_statuses,sender_display_name,updated_by_user_id,updated_at) VALUES($1,true,$2::text[],'LockOn ServiceOS',$3,now()) ON CONFLICT(point_id) DO NOTHING",
        [pointId,[...DEFAULT_NOTIFY_STATUSES],userId]
      );
    }

    const recovery = await recoverNoSenderNotificationsForUser(userId);
    const user = await loadUser(userId);
    if (user) {
      await audit(
        { user, clientType:'DESKTOP' },
        'GMAIL_CONNECTED_AT_LOGIN',
        'user',
        userId,
        pointId || null,
        {
          senderEmail: operationalIdentityEmail(profile.email, role),
          identitySource:'PRIMARY_GOOGLE_OAUTH',
          credentialLocation:'SERVER_USER',
          recoveredNotifications:recovery.recovered,
          recoveredSent:recovery.sent
        }
      );
    }
    return {
      connected:true,
      skipped:false,
      pointId:pointId || null,
      email:operationalIdentityEmail(profile.email, role),
      status:'ACTIVE',
      recoveredNotifications:recovery.recovered,
      recoveredSent:recovery.sent
    };
  } catch {
    console.warn('[gmail auto-connect at login] connection failed');
    return {
      connected:false,
      skipped:false,
      pointId:pointId || null,
      reason:'GMAIL_AUTO_CONNECT_FAILED'
    };
  }
};

const autoConnectMeetingGmailFromOwner = async (loginPayload, profile, tokens) => {
  const role=cleanText(loginPayload?.user?.role,40).toUpperCase();
  const userId=cleanText(loginPayload?.user?.id,120);
  const status=cleanText(loginPayload?.user?.status,40).toUpperCase();
  if(role!=='OWNER'||status!=='ACTIVE'||!userId)return {connected:false,skipped:true,reason:'NOT_OWNER'};
  const scopes=String(tokens?.scope||'').split(/\s+/).filter(Boolean);
  if(!scopes.includes('https://www.googleapis.com/auth/gmail.send'))return {connected:false,skipped:false,reason:'GMAIL_SCOPE_NOT_GRANTED'};
  const refreshToken=cleanText(tokens?.refresh_token,4096);
  if(!refreshToken){
    const existing=(await q("SELECT sender_email,refresh_token_ciphertext,status FROM meeting_email_sender WHERE id='default' LIMIT 1")).rows[0];
    if(existing?.status==='ACTIVE'&&existing.refresh_token_ciphertext){
      try{
        await refreshGmailAccess(decryptSecret(existing.refresh_token_ciphertext),'');
        return {connected:true,skipped:false,email:existing.sender_email,status:'ACTIVE',reason:'EXISTING_MEETING_SENDER_REUSED'};
      }catch{
        console.warn('[meeting gmail credential reuse] stored credential could not be refreshed');
      }
    }
    return {connected:false,skipped:false,reason:'REFRESH_TOKEN_MISSING'};
  }
  try{
    await refreshGmailAccess(refreshToken,'');
    await q(
      "INSERT INTO meeting_email_sender(id,connected_by_user_id,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,status,last_error,connected_at,updated_at) VALUES('default',$1,$2,$3,NULL,'ACTIVE',NULL,now(),now()) ON CONFLICT(id) DO UPDATE SET connected_by_user_id=EXCLUDED.connected_by_user_id,sender_email=EXCLUDED.sender_email,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,oauth_client_secret_ciphertext=NULL,status='ACTIVE',last_error=NULL,connected_at=now(),updated_at=now()",
      [userId,profile.email,encryptSecret(refreshToken)]
    );
    return {connected:true,skipped:false,email:profile.email,status:'ACTIVE'};
  }catch{
    console.warn('[meeting gmail auto-connect] connection failed');
    return {connected:false,skipped:false,reason:'MEETING_GMAIL_AUTO_CONNECT_FAILED'};
  }
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

const normalizeServiceScanCode = (value) => {
  const raw=String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^SV/,'');
  return /^[A-Z0-9]{8}$/.test(raw)?'SV-'+raw.slice(0,4)+'-'+raw.slice(4):'';
};

const generateServiceScanCode = () => {
  let raw='';
  for(let i=0;i<8;i+=1)raw+=SERVICE_SCAN_ALPHABET[crypto.randomInt(0,SERVICE_SCAN_ALPHABET.length)];
  return 'SV-'+raw.slice(0,4)+'-'+raw.slice(4);
};

const ensureServiceCardIdentity = async (orderId) => {
  let row=(await q("SELECT * FROM service_order_cards WHERE service_order_id=$1 LIMIT 1",[orderId])).rows[0];
  if(row){
    return {
      printMode:row.print_mode||null,
      staffScanToken:decryptSecret(row.staff_scan_token_ciphertext),
      staffScanCode:decryptSecret(row.staff_scan_code_ciphertext),
      generatedAt:row.generated_at,
      printCount:Number(row.print_count||0),
      customerEmailSentAt:row.customer_email_sent_at||null
    };
  }
  for(let attempt=0;attempt<5;attempt+=1){
    const staffScanToken=crypto.randomBytes(32).toString('base64url');
    const staffScanCode=generateServiceScanCode();
    try{
      row=(await q(
        "INSERT INTO service_order_cards(service_order_id,staff_scan_token_hash,staff_scan_token_ciphertext,staff_scan_code_hash,staff_scan_code_ciphertext) VALUES($1,$2,$3,$4,$5) ON CONFLICT(service_order_id) DO NOTHING RETURNING *",
        [orderId,tokenHash(staffScanToken),encryptSecret(staffScanToken),tokenHash(staffScanCode),encryptSecret(staffScanCode)]
      )).rows[0];
      if(row)return {printMode:null,staffScanToken,staffScanCode,generatedAt:row.generated_at,printCount:0,customerEmailSentAt:null};
      row=(await q("SELECT * FROM service_order_cards WHERE service_order_id=$1 LIMIT 1",[orderId])).rows[0];
      if(row)return {
        printMode:row.print_mode||null,
        staffScanToken:decryptSecret(row.staff_scan_token_ciphertext),
        staffScanCode:decryptSecret(row.staff_scan_code_ciphertext),
        generatedAt:row.generated_at,
        printCount:Number(row.print_count||0),
        customerEmailSentAt:row.customer_email_sent_at||null
      };
    }catch(error){
      if(String(error?.code||'')!=='23505')throw error;
    }
  }
  throw new Error('Nie udało się przygotować identyfikatora karty serwisowej.');
};

const customerPortalAutoUrl = (portalCode, orderId='') =>
  PUBLIC_PORTAL_URL+'/klient.html#code='+encodeURIComponent(portalCode)+(orderId?'&order='+encodeURIComponent(orderId):'')+'&auto=1';

const staffServiceScanUrl = (token) =>
  PUBLIC_PORTAL_URL+'/panel.html#scan='+encodeURIComponent(token);

const pdfToBuffer = (definition) => new Promise((resolve,reject)=>{
  try{
    pdfMake.createPdf(definition).getBuffer((buffer)=>resolve(Buffer.from(buffer)));
  }catch(error){reject(error);}
});

const loadServiceCardContext = async (orderId) => {
  const row=(await q(
    "SELECT s.id,s.order_number,s.order_type,s.handling_mode,s.issue_description,s.repair_summary,s.status,s.received_at,s.estimated_completion_at,s.estimated_cost,s.currency,s.warranty_months,s.warranty_started_at,s.warranty_expires_at,s.warranty_card_printed_at,s.point_id,s.home_point_id,s.current_point_id,c.id AS customer_id,c.first_name,c.last_name,c.email,c.phone,d.brand,d.model,d.imei,d.serial_number,d.notes AS device_notes,p.name AS point_name,p.city AS point_city FROM service_orders s JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id JOIN points p ON p.id=s.point_id WHERE s.id=$1 LIMIT 1",
    [orderId]
  )).rows[0];
  if(!row)throw Object.assign(new Error('Nie znaleziono zlecenia.'),{status:404,code:'NOT_FOUND'});
  const [portal,card]=await Promise.all([ensureCustomerPortalCode(row.customer_id),ensureServiceCardIdentity(orderId)]);
  const customerUrl=customerPortalAutoUrl(portal.code,orderId);
  const staffUrl=staffServiceScanUrl(card.staffScanToken);
  const receivedAt=new Date(row.received_at);
  const serviceCardNumber='KS-'+(Number.isNaN(receivedAt.getTime())?'0000':receivedAt.getFullYear())+'-'+String(Number(row.order_number)).padStart(6,'0');
  return {
    orderId:row.id,
    orderNumber:Number(row.order_number),
    serviceCardNumber,
    warrantyCardNumber:warrantyCardNumberFor(row.order_number,row.warranty_started_at),
    orderType:row.order_type,
    handlingMode:row.handling_mode||'STANDARD',
    issueDescription:row.issue_description,
    repairSummary:row.repair_summary||'',
    status:row.status,
    receivedAt:row.received_at,
    estimatedCompletionAt:row.estimated_completion_at||null,
    estimatedCost:row.estimated_cost==null?null:Number(row.estimated_cost),
    currency:String(row.currency||'PLN').trim()||'PLN',
    warrantyMonths:row.warranty_months==null?null:Number(row.warranty_months),
    warrantyStartedAt:row.warranty_started_at||null,
    warrantyExpiresAt:row.warranty_expires_at||null,
    warrantyCardPrintedAt:row.warranty_card_printed_at||null,
    pointId:row.point_id,
    pointName:row.point_name,
    pointCity:row.point_city||'',
    customerId:row.customer_id,
    customerName:[row.first_name,row.last_name].filter(Boolean).join(' '),
    customerEmail:row.email||'',
    customerPhone:row.phone||'',
    device:[row.brand,row.model].filter(Boolean).join(' '),
    imei:row.imei||'',
    serialNumber:row.serial_number||'',
    deviceNotes:row.device_notes||'',
    customerPortalCode:portal.code,
    customerPortalBaseUrl:PUBLIC_PORTAL_URL+'/klient.html',
    customerPortalUrl:customerUrl,
    staffScanCode:card.staffScanCode,
    staffScanUrl:staffUrl,
    printMode:card.printMode||null,
    generatedAt:card.generatedAt
  };
};

const formatServiceCardDate = (value) => {
  if(!value)return '—';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':date.toLocaleDateString('pl-PL',{timeZone:'Europe/Warsaw'});
};

const formatServiceCardDateTime = (value) => {
  if(!value)return '—';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':date.toLocaleString('pl-PL',{
    timeZone:'Europe/Warsaw',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  });
};

const formatServiceCardMoney = (value,currency='PLN') =>
  value==null?'Nie określono':new Intl.NumberFormat('pl-PL',{style:'currency',currency}).format(Number(value));

const serviceCardHeader = (context,title,subtitle,lineWidth=515) => ({
  stack:[
    {columns:[
      {stack:[
        {text:[{text:'LockOn',bold:true,color:'#ff7048'},{text:'  ServiceOS',color:'#475467'}],fontSize:15},
        {text:title,fontSize:18,bold:true,margin:[0,8,0,2],color:'#101828'},
        {text:subtitle,fontSize:7.5,color:'#667085'}
      ],width:'*'},
      {stack:[
        {text:'NUMER KARTY',fontSize:6.5,bold:true,color:'#98a2b3',alignment:'right'},
        {text:context.serviceCardNumber,fontSize:11.5,bold:true,color:'#101828',alignment:'right',margin:[0,2,0,4]},
        {text:'Zlecenie #'+context.orderNumber,fontSize:7.5,color:'#667085',alignment:'right'}
      ],width:132}
    ]},
    {canvas:[{type:'line',x1:0,y1:0,x2:lineWidth,y2:0,lineWidth:1,lineColor:'#eaecf0'}],margin:[0,10,0,10]}
  ]
});

const serviceCardInfoTable = (rows,{labelWidth=94,labelFontSize=7,valueFontSize=8,rowMargin=2.5}={}) => ({
  table:{
    widths:[labelWidth,'*'],
    body:rows.map(([label,value])=>[
      {text:String(label),fontSize:labelFontSize,bold:true,color:'#111827',margin:[0,rowMargin,0,rowMargin]},
      {text:String(value===null||value===undefined||value===''?'—':value),fontSize:valueFontSize,color:'#101828',margin:[0,rowMargin,0,rowMargin]}
    ])
  },
  layout:{
    hLineWidth:()=>0.7,vLineWidth:()=>0.7,
    hLineColor:()=> '#9ca3af',vLineColor:()=> '#9ca3af',
    paddingLeft:()=>7,paddingRight:()=>7,paddingTop:()=>2,paddingBottom:()=>2
  }
});

const serviceCardTerms = [
  'Klient oświadcza, że jest właścicielem urządzenia albo jest uprawniony do zlecenia jego serwisu.',
  'Urządzenie wydawane jest po okazaniu karty serwisowej albo potwierdzeniu uprawnienia do odbioru w panelu klienta lub na podstawie danych zlecenia.',
  'Przed oddaniem urządzenia wykonaj kopię zapasową. Diagnostyka lub naprawa może spowodować utratę danych. Serwis nie gwarantuje ich zachowania i nie odpowiada za szkody będące następstwem utraty, jeśli wynika ona z usterki, stanu nośnika lub niezbędnych czynności serwisowych; nie ogranicza to odpowiedzialności, której nie można wyłączyć prawem.',
  'Cena orientacyjna jest szacunkiem. Wady ukryte lub dodatkowe uszkodzenia mogą zmienić zakres i koszt. Prace poza zaakceptowaną wyceną wymagają poinformowania klienta i jego akceptacji.',
  'Urządzenie należy odebrać w ciągu 90 dni od powiadomienia o gotowości telefonicznie lub e-mailem. Po tym terminie serwis może ponownie wezwać do odbioru i naliczyć uzasadnione koszty przechowania przewidziane w zaakceptowanym regulaminie lub cenniku. Nieodebranie urządzenia nie oznacza porzucenia ani przeniesienia własności na sklep; dalsze postępowanie odbywa się zgodnie z prawem.'
];

const serviceCardTermsBlock = ({titleFontSize=8,fontSize=5.8,marginTop=8}={}) => ({
  stack:[
    {text:'Warunki przyjęcia i odbioru',fontSize:titleFontSize,bold:true,color:'#000000',margin:[0,marginTop,0,5]},
    {
      ul:serviceCardTerms.map((text)=>({text,fontSize,color:'#111827',lineHeight:1.22,margin:[0,0,0,4]})),
      margin:[10,0,0,0]
    }
  ]
});

const deviceServiceCardContent = (context,{compact=false}={}) => ({
  stack:[
    serviceCardHeader(context,'Karta urządzenia','Identyfikator pozostaje z urządzeniem przez cały proces serwisowy.',compact?350:515),
    serviceCardInfoTable([
      ['Punkt macierzysty',context.pointName+(context.pointCity?' · '+context.pointCity:'')],
      ['Klient',context.customerName],
      ['Urządzenie',context.device],
      ['IMEI',context.imei||'Nie podano'],
      ['Numer seryjny',context.serialNumber||'Nie podano'],
      ['Typ',context.orderType==='COMPLAINT'?'Reklamacja':'Naprawa'],
      ['Przyjęto',formatServiceCardDateTime(context.receivedAt)],
      ['Cena orientacyjna',formatServiceCardMoney(context.estimatedCost,context.currency)],
      ['Przewidywany termin',formatServiceCardDate(context.estimatedCompletionAt)],
      ['Opis usterki',context.issueDescription],
      ['Uwagi',context.deviceNotes||'—']
    ],compact?{labelWidth:82,labelFontSize:6.5,valueFontSize:7.3,rowMargin:2}:{labelWidth:94}),
    {columns:[
      {stack:[
        {text:'Kod ręczny',fontSize:7,bold:true,color:'#667085',margin:[0,9,0,2]},
        {text:context.staffScanCode,fontSize:13,bold:true,color:'#101828',characterSpacing:1},
        {text:'Kod ręczny — użyj, gdy nie możesz zeskanować QR.',fontSize:compact?5.7:6.4,color:'#667085',margin:[0,4,8,0]},
        {text:'Skan wymaga zalogowanego pracownika i właściwego punktu.',fontSize:compact?5.5:6.1,color:'#667085',margin:[0,3,8,0]}
      ],width:'*'},
      {stack:[
        {text:'Kod QR ServiceOS',fontSize:6.5,bold:true,color:'#667085',alignment:'center',margin:[0,6,0,2]},
        {qr:context.staffScanUrl,fit:compact?68:84,alignment:'center',margin:[0,2,0,4]},
        {text:'Zeskanuj kod QR w ServiceOS, aby otworzyć zlecenie i obsłużyć urządzenie.',fontSize:compact?5.4:6.2,color:'#475467',alignment:'center',lineHeight:1.1}
      ],width:compact?116:150}
    ],columnGap:compact?8:14,margin:[0,2,0,0]},
    {text:'NIE USUWAĆ — karta identyfikuje urządzenie w logistyce ServiceOS.',fontSize:7,bold:true,color:'#b42318',margin:[0,7,0,0]}
  ]
});

const customerServiceCardContent = (context,{compact=false}={}) => ({
  stack:[
    serviceCardHeader(context,'Karta serwisowa','Potwierdzenie przyjęcia urządzenia i dane dostępu do panelu klienta.',compact?350:515),
    serviceCardInfoTable([
      ['Klient',context.customerName],
      ['Urządzenie',context.device],
      ['IMEI',context.imei||'Nie podano'],
      ['Numer seryjny',context.serialNumber||'Nie podano'],
      ['Punkt',context.pointName+(context.pointCity?' · '+context.pointCity:'')],
      ['Typ',context.orderType==='COMPLAINT'?'Reklamacja':'Naprawa'],
      ['Przyjęto',formatServiceCardDateTime(context.receivedAt)],
      ['Cena orientacyjna',formatServiceCardMoney(context.estimatedCost,context.currency)],
      ['Przewidywany termin',formatServiceCardDate(context.estimatedCompletionAt)],
      ['Opis usterki',context.issueDescription]
    ],compact?{labelWidth:82,labelFontSize:6.5,valueFontSize:7.2,rowMargin:2}:{labelWidth:94}),
    {columns:[
      {stack:[
        {text:'Panel klienta',fontSize:7,bold:true,color:'#667085',margin:[0,8,0,2]},
        {text:context.customerPortalBaseUrl,fontSize:7.2,bold:true,color:'#175cd3'},
        {text:'Kod klienta',fontSize:6.5,bold:true,color:'#667085',margin:[0,6,0,2]},
        {text:context.customerPortalCode,fontSize:12,bold:true,color:'#101828',characterSpacing:.5},
        {text:'QR otwiera bezpośrednio to zlecenie i przekazuje kod automatycznie.',fontSize:6.2,color:'#667085',margin:[0,4,8,0]}
      ],width:'*'},
      {qr:context.customerPortalUrl,fit:compact?72:80,alignment:'right',width:compact?80:88}
    ],margin:[0,1,0,0]},
    serviceCardTermsBlock(compact?{titleFontSize:7.4,fontSize:5.25,marginTop:6}:{}),
    {text:'Zachowaj kartę do czasu odbioru urządzenia.',fontSize:7,bold:true,color:'#ff7048',margin:[0,6,0,0]}
  ]
});

const customerServiceCardPortraitContent = (context) => ({
  stack:[
    {
      stack:[
        {columns:[
          {stack:[
            {text:[{text:'LockOn',bold:true,color:'#111827'},{text:'  ServiceOS',color:'#111827'}],fontSize:18},
            {text:'Karta serwisowa',fontSize:24,bold:true,margin:[0,8,0,3],color:'#000000'},
            {text:'Potwierdzenie przyjęcia urządzenia i dane potrzebne do obsługi zlecenia.',fontSize:10.5,color:'#111827',lineHeight:1.15}
          ],width:'*'},
          {stack:[
            {text:'NUMER KARTY',fontSize:9,bold:true,color:'#374151',alignment:'right'},
            {text:context.serviceCardNumber,fontSize:16,bold:true,color:'#000000',alignment:'right',margin:[0,3,0,5]},
            {text:'Zlecenie #'+context.orderNumber,fontSize:10,color:'#111827',alignment:'right'}
          ],width:170}
        ]},
        {canvas:[{type:'line',x1:0,y1:0,x2:515,y2:0,lineWidth:1.2,lineColor:'#4b5563'}],margin:[0,12,0,14]}
      ]
    },
    {text:'Przyjęcie i urządzenie',fontSize:13,bold:true,color:'#000000',margin:[0,0,0,7]},
    serviceCardInfoTable([
      ['Klient',context.customerName],
      ['Urządzenie',context.device],
      ['IMEI',context.imei||'Nie podano'],
      ['Numer seryjny',context.serialNumber||'Nie podano'],
      ['Punkt przyjęcia',context.pointName+(context.pointCity?' · '+context.pointCity:'')],
      ['Typ zlecenia',context.orderType==='COMPLAINT'?'Reklamacja':'Naprawa'],
      ['Przyjęto',formatServiceCardDateTime(context.receivedAt)]
    ],{labelWidth:122,labelFontSize:10,valueFontSize:11,rowMargin:3}),
    {text:'Obsługa serwisowa',fontSize:13,bold:true,color:'#000000',margin:[0,13,0,7]},
    serviceCardInfoTable([
      ['Cena orientacyjna',formatServiceCardMoney(context.estimatedCost,context.currency)],
      ['Przewidywany termin',formatServiceCardDate(context.estimatedCompletionAt)],
      ['Opis usterki',context.issueDescription],
      ['Uwagi',context.deviceNotes||'Brak uwag']
    ],{labelWidth:122,labelFontSize:10,valueFontSize:11,rowMargin:3}),
    {
      table:{
        widths:['*'],
        body:[[
          {
            margin:[14,12,14,12],
            columns:[
              {
                width:'*',
                stack:[
                  {text:'PANEL KLIENTA',fontSize:10,bold:true,color:'#000000',characterSpacing:.5},
                  {text:'Zeskanuj kod QR albo wpisz kod klienta ręcznie.',fontSize:10,color:'#111827',lineHeight:1.2,margin:[0,5,12,10]},
                  {text:'Adres WWW',fontSize:9,bold:true,color:'#111827',margin:[0,0,0,3]},
                  {text:context.customerPortalBaseUrl,fontSize:10.5,bold:true,color:'#000000',margin:[0,0,0,9]},
                  {text:'Kod klienta',fontSize:9,bold:true,color:'#111827',margin:[0,0,0,3]},
                  {text:context.customerPortalCode,fontSize:18,bold:true,color:'#000000',characterSpacing:1}
                ]
              },
              {
                width:124,
                stack:[
                  {qr:context.customerPortalUrl,fit:108,alignment:'center'},
                  {text:'Zeskanuj QR',fontSize:9,bold:true,color:'#000000',alignment:'center',margin:[0,6,0,0]}
                ]
              }
            ],
            columnGap:14
          }
        ]]
      },
      layout:{
        hLineWidth:()=>1,vLineWidth:()=>1,
        hLineColor:()=> '#4b5563',vLineColor:()=> '#4b5563',
        paddingLeft:()=>0,paddingRight:()=>0,paddingTop:()=>0,paddingBottom:()=>0
      },
      margin:[0,13,0,0]
    },
    serviceCardTermsBlock({titleFontSize:11.5,fontSize:8.8,marginTop:10}),
    {text:'Zachowaj kartę do czasu odbioru urządzenia.',fontSize:10,bold:true,color:'#000000',margin:[0,7,0,0]}
  ]
});

const renderServiceCardPdf = async (orderId,variant='CUSTOMER') => {
  const normalized=SERVICE_CARD_VARIANTS.has(String(variant).toUpperCase())?String(variant).toUpperCase():'CUSTOMER';
  const context=await loadServiceCardContext(orderId);
  const common={
    defaultStyle:{font:'Roboto',fontSize:8},
    info:{title:'LockOn ServiceOS · '+context.serviceCardNumber,author:'LockOn ServiceOS',subject:'Karta serwisowa'},
    compress:true
  };
  let definition;
  if(normalized==='PHYSICAL'){
    definition={
      ...common,
      pageSize:'A4',pageOrientation:'landscape',pageMargins:[20,20,20,20],
      content:[
        {columns:[
          {width:'48%',...deviceServiceCardContent(context,{compact:true})},
          {width:'4%',stack:[
            {text:'PRZETNIJ TUTAJ',fontSize:5.5,bold:true,color:'#98a2b3',alignment:'center',margin:[0,235,0,0]}
          ]},
          {width:'48%',...customerServiceCardContent(context,{compact:true})}
        ],columnGap:7},
        {canvas:[{type:'line',x1:0,y1:0,x2:0,y2:545,lineWidth:.8,lineColor:'#98a2b3',dash:{length:5,space:4}}],absolutePosition:{x:421,y:24}}
      ]
    };
  }else if(normalized==='CUSTOMER'){
    definition={
      ...common,
      pageSize:'A4',pageOrientation:'portrait',pageMargins:[30,24,30,24],
      defaultStyle:{font:'Roboto',fontSize:10,color:'#000000'},
      content:[customerServiceCardPortraitContent(context)]
    };
  }else{
    definition={
      ...common,
      pageSize:'A5',pageOrientation:'landscape',pageMargins:[18,18,18,18],
      content:[deviceServiceCardContent(context)]
    };
  }
  const buffer=await pdfToBuffer(definition);
  return {
    context,
    variant:normalized,
    fileName:(normalized==='CUSTOMER'?'Karta-klienta-':normalized==='DEVICE'?'Karta-urzadzenia-':'Karta-serwisowa-A4-')+context.serviceCardNumber+'.pdf',
    buffer
  };
};

const renderWarrantyCardPdf = async (orderId) => {
  const context=await loadServiceCardContext(orderId);
  if(!context.warrantyMonths || !context.warrantyStartedAt || !context.warrantyExpiresAt){
    throw Object.assign(new Error('Najpierw ustaw okres gwarancji serwisowej.'),{status:409,code:'WARRANTY_REQUIRED'});
  }
  const definition={
    pageSize:'A4',
    pageOrientation:'portrait',
    pageMargins:[46,38,46,38],
    defaultStyle:{font:'Roboto',fontSize:10,color:'#111827'},
    info:{title:'LockOn ServiceOS · karta gwarancyjna · '+context.serviceCardNumber,author:'LockOn ServiceOS',subject:'Karta gwarancyjna naprawy'},
    compress:true,
    content:[
      {columns:[
        {width:'*',stack:[
          {text:[{text:'LockOn',bold:true,color:'#111827'},{text:'  ServiceOS',color:'#4b5563'}],fontSize:16},
          {text:'Karta gwarancyjna naprawy',fontSize:22,bold:true,margin:[0,8,0,4],color:'#000000'},
          {text:'Dokument gwarancji serwisowej dla wykonanego zlecenia.',fontSize:9.5,color:'#374151'}
        ]},
        {width:118,stack:[
          {text:'ZLECENIE',fontSize:8,bold:true,color:'#4b5563',alignment:'right'},
          {text:'#'+context.orderNumber,fontSize:16,bold:true,color:'#000000',alignment:'right',margin:[0,3,0,0]}
        ]}
      ]},
      {canvas:[{type:'line',x1:0,y1:0,x2:352,y2:0,lineWidth:1.2,lineColor:'#4b5563'}],margin:[0,12,0,14]},
      serviceCardInfoTable([
        ['Numer karty',context.warrantyCardNumber],
        ['Klient',context.customerName],
        ['Urządzenie',context.device||'Nie podano'],
        ['IMEI',context.imei||'Nie podano'],
        ['Numer seryjny',context.serialNumber||'Nie podano'],
        ['Punkt',context.pointName+(context.pointCity?' · '+context.pointCity:'')],
        ['Okres gwarancji',context.warrantyMonths+' mies.'],
        ['Data wykonania naprawy',formatServiceCardDate(context.warrantyStartedAt)],
        ['Ważna do',formatServiceCardDate(context.warrantyExpiresAt)]
      ],{labelWidth:105,labelFontSize:9.3,valueFontSize:10.3,rowMargin:3}),
      {text:'Wykonana naprawa',fontSize:10,bold:true,color:'#000000',margin:[0,12,0,4]},
      {text:context.repairSummary||'Nie podano opisu wykonanej naprawy.',fontSize:9.5,color:'#111827',lineHeight:1.25,margin:[0,0,0,10]},
      {
        table:{widths:['*',110],body:[[
          {margin:[10,10,10,10],stack:[
            {text:'PANEL KLIENTA',fontSize:9,bold:true,color:'#000000'},
            {text:'Status gwarancji, zlecenia i dokumenty sprawdzisz w panelu klienta.',fontSize:9,color:'#374151',lineHeight:1.25,margin:[0,5,0,9]},
            {text:context.customerPortalBaseUrl,fontSize:8.8,bold:true,color:'#000000',margin:[0,0,0,7]},
            {text:'Kod klienta',fontSize:8,bold:true,color:'#4b5563'},
            {text:context.customerPortalCode,fontSize:15,bold:true,color:'#000000',characterSpacing:.7,margin:[0,2,0,0]}
          ]},
          {margin:[4,8,4,8],stack:[
            {qr:context.customerPortalUrl,fit:92,alignment:'center'},
            {text:'Zeskanuj QR',fontSize:8,bold:true,alignment:'center',margin:[0,4,0,0]}
          ]}
        ]]},
        layout:{hLineWidth:()=>1,vLineWidth:()=>1,hLineColor:()=> '#6b7280',vLineColor:()=> '#6b7280'}
      },
      {text:'Zakres gwarancji',fontSize:12,bold:true,color:'#000000',margin:[0,14,0,6]},
      {ul:[
        {text:'Gwarancja dotyczy wykonanej usługi serwisowej i elementów objętych naprawą.',fontSize:9,lineHeight:1.25},
        {text:'Okres gwarancji liczony jest od daty wskazanej powyżej.',fontSize:9,lineHeight:1.25},
        {text:'Uszkodzenia mechaniczne, zalanie lub ingerencja osób trzecich mogą wymagać osobnej oceny serwisu.',fontSize:9,lineHeight:1.25},
        {text:'Gwarancja serwisowa nie ogranicza praw klienta wynikających z bezwzględnie obowiązujących przepisów prawa.',fontSize:9,lineHeight:1.25}
      ],margin:[10,0,0,0]},
      {text:'Zachowaj kartę razem z urządzeniem. Aktualny status gwarancji jest również widoczny w panelu klienta.',fontSize:9.2,bold:true,color:'#000000',margin:[0,13,0,0]}
    ]
  };
  const buffer=await pdfToBuffer(definition);
  return {context,fileName:'Karta-gwarancyjna-'+context.warrantyCardNumber+'.pdf',buffer};
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

const revokeCustomerPortalSessions = async (customerId, authMethod = null) => {
  const result = authMethod
    ? await q("DELETE FROM customer_portal_sessions WHERE customer_id=$1 AND auth_method=$2 RETURNING id",[customerId,authMethod])
    : await q("DELETE FROM customer_portal_sessions WHERE customer_id=$1 RETURNING id",[customerId]);
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
      "SELECT s.id,s.order_number,s.order_type,s.handling_mode,s.issue_description,s.repair_summary,s.status,s.estimated_completion_at,s.estimated_cost,s.final_cost,s.currency,s.warranty_months,s.warranty_started_at,s.warranty_expires_at,s.warranty_card_printed_at,s.received_at,s.completed_at,s.created_at,s.updated_at,d.brand,d.model,d.imei,d.serial_number,p.id AS point_id,p.name AS point_name,hp.id AS home_point_id,hp.name AS home_point_name,cp.id AS current_point_id,cp.name AS current_point_name FROM service_orders s JOIN devices d ON d.id=s.device_id JOIN points p ON p.id=s.point_id LEFT JOIN points hp ON hp.id=COALESCE(s.home_point_id,s.point_id) LEFT JOIN points cp ON cp.id=s.current_point_id WHERE s.customer_id=$1 ORDER BY s.received_at DESC,s.order_number DESC",
      [customerId]
    ),
    q(
      "SELECT r.*,rp.name AS requested_point_name,rrp.name AS routed_point_name,u.name AS technician_name,u.email AS technician_email,u.role_code AS technician_role FROM customer_quote_requests r JOIN points rp ON rp.id=r.requested_point_id JOIN points rrp ON rrp.id=r.routed_point_id LEFT JOIN users u ON u.id=r.assigned_technician_id WHERE r.customer_id=$1 ORDER BY r.updated_at DESC",
      [customerId]
    ),
    q("SELECT id,name,city FROM points WHERE active=true ORDER BY city,name")
  ]);

  const quoteIds = quotesResult.rows.map((row)=>row.id);
  let messageRows = [];
  if (quoteIds.length) {
    messageRows = (await q(
      "SELECT m.id,m.request_id,m.sender_kind,m.body,m.created_at,u.name AS sender_name,u.email AS sender_email,u.role_code AS sender_role FROM customer_quote_messages m LEFT JOIN users u ON u.id=m.sender_user_id WHERE m.request_id=ANY($1::text[]) ORDER BY m.created_at ASC",
      [quoteIds]
    )).rows;
  }
  const messagesByRequest = new Map();
  for (const row of messageRows) {
    const list = messagesByRequest.get(row.request_id) || [];
    list.push({id:row.id,senderKind:row.sender_kind,senderName:row.sender_kind==='STAFF'?operationalIdentityName(row.sender_name,row.sender_email,row.sender_role):(row.sender_name||null),body:row.body,createdAt:row.created_at});
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
      warranty:warrantyPortalView(row),
      receivedAt:row.received_at,completedAt:row.completed_at||null,createdAt:row.created_at,updatedAt:row.updated_at,
      serviceCardAvailable:true
    })),
    points:pointsResult.rows.map((row)=>({id:row.id,name:row.name,city:row.city})),
    quoteRequests:quotesResult.rows.map((row)=>({
      id:row.id,requestedPointId:row.requested_point_id,requestedPointName:row.requested_point_name,
      routedPointId:row.routed_point_id,routedPointName:row.routed_point_name,assignedTechnicianName:isOwnerIdentity(row.technician_email,row.technician_role)?null:(row.technician_name||null),
      serviceOrderId:row.service_order_id||null,deviceDescription:row.device_description,issueDescription:row.issue_description,
      status:row.status,quoteAmount:row.quote_amount==null?null:Number(row.quote_amount),currency:row.currency||'PLN',
      quoteNote:row.quote_note||null,routingReason:row.routing_reason,createdAt:row.created_at,updatedAt:row.updated_at,
      quotedAt:row.quoted_at||null,closedAt:row.closed_at||null,messages:messagesByRequest.get(row.id)||[]
    }))
  };
};

const requireCustomerAccountAccess = async (user, customerId, accessMode = 'SUPPORT') => {
  if (accessMode === 'SERVICE') {
    if (!SERVICE_CREATE_ROLES.has(user?.role_code) && !hasSupportAccess(user)) {
      throw Object.assign(new Error('Brak uprawnień do obsługi klienta serwisowego.'),{status:403,code:'SERVICE_CUSTOMER_FORBIDDEN'});
    }
  } else {
    requireSupportAccess(user);
  }
  const customer=(await q(
    "SELECT id,first_name,last_name,email,phone,portal_code_created_at FROM customers WHERE id=$1 LIMIT 1",
    [customerId]
  )).rows[0];
  if (!customer) throw Object.assign(new Error('Nie znaleziono klienta.'),{status:404,code:'CUSTOMER_NOT_FOUND'});
  if (GLOBAL_ROLES.has(user.role_code)) return customer;
  const ids=await visiblePointIds(user);
  if (!ids.length) throw Object.assign(new Error('Brak dostępu do tego klienta.'),{status:403,code:'CUSTOMER_FORBIDDEN'});
  const visible=(await q(
    accessMode==='SERVICE'
      ? "SELECT 1 WHERE EXISTS(SELECT 1 FROM service_orders s WHERE s.customer_id=$1 AND (COALESCE(s.home_point_id,s.point_id)=ANY($2::text[]) OR COALESCE(s.current_point_id,s.home_point_id,s.point_id)=ANY($2::text[]))) LIMIT 1"
      : "SELECT 1 WHERE EXISTS(SELECT 1 FROM service_orders s WHERE s.customer_id=$1 AND (COALESCE(s.home_point_id,s.point_id)=ANY($2::text[]) OR COALESCE(s.current_point_id,s.home_point_id,s.point_id)=ANY($2::text[]))) OR EXISTS(SELECT 1 FROM customer_quote_requests r WHERE r.customer_id=$1 AND (r.requested_point_id=ANY($2::text[]) OR r.routed_point_id=ANY($2::text[]))) LIMIT 1",
    [customerId,ids]
  )).rows[0];
  if (!visible) throw Object.assign(new Error('Brak dostępu do tego klienta.'),{status:403,code:'CUSTOMER_FORBIDDEN'});
  return customer;
};

const customerAccountManagementOverview = async (user, search = '', accessMode = 'SUPPORT') => {
  const serviceView=accessMode==='SERVICE';
  if(serviceView){
    if(user?.role_code!=='USER'){
      throw Object.assign(new Error('Ten uproszczony widok klientów jest dostępny dla pracownika punktu.'),{status:403,code:'SERVICE_CUSTOMER_FORBIDDEN'});
    }
  }else{
    requireSupportAccess(user);
  }
  const supportView=hasSupportAccess(user);
  const ids=GLOBAL_ROLES.has(user.role_code) ? [] : await visiblePointIds(user);
  const params=[GLOBAL_ROLES.has(user.role_code),ids];
  let filter=serviceView
    ? " WHERE ($1::boolean OR EXISTS(SELECT 1 FROM service_orders s0 WHERE s0.customer_id=c.id AND (COALESCE(s0.home_point_id,s0.point_id)=ANY($2::text[]) OR COALESCE(s0.current_point_id,s0.home_point_id,s0.point_id)=ANY($2::text[]))))"
    : " WHERE ($1::boolean OR EXISTS(SELECT 1 FROM service_orders s0 WHERE s0.customer_id=c.id AND (COALESCE(s0.home_point_id,s0.point_id)=ANY($2::text[]) OR COALESCE(s0.current_point_id,s0.home_point_id,s0.point_id)=ANY($2::text[]))) OR EXISTS(SELECT 1 FROM customer_quote_requests r0 WHERE r0.customer_id=c.id AND (r0.requested_point_id=ANY($2::text[]) OR r0.routed_point_id=ANY($2::text[]))))";
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
    "(SELECT count(*)::int FROM service_orders s WHERE s.customer_id=c.id AND ($1::boolean OR COALESCE(s.home_point_id,s.point_id)=ANY($2::text[]) OR COALESCE(s.current_point_id,s.home_point_id,s.point_id)=ANY($2::text[]))) AS order_count,"+
    "(SELECT count(*)::int FROM customer_quote_requests r WHERE r.customer_id=c.id AND r.status IN ('OPEN','QUOTED') AND ($1::boolean OR r.requested_point_id=ANY($2::text[]) OR r.routed_point_id=ANY($2::text[]))) AS open_quote_count "+
    "FROM customers c LEFT JOIN customer_portal_accounts a ON a.customer_id=c.id"+filter+
    " ORDER BY c.updated_at DESC,c.last_name,c.first_name LIMIT 250",
    params
  )).rows;
  const customers=rows.map(row=>({
    id:row.id,
    name:[row.first_name,row.last_name].filter(Boolean).join(' '),
    email:row.email||null,
    phone:row.phone||null,
    codeCreatedAt:supportView?(row.portal_code_created_at||null):null,
    googleLinked:supportView?Boolean(row.google_sub):false,
    googleEmail:supportView?(row.google_email||null):null,
    googleName:supportView?(row.google_name||null):null,
    googlePicture:supportView?(row.google_picture_url||null):null,
    linkedAt:supportView?(row.linked_at||null):null,
    lastLoginAt:supportView?(row.last_login_at||null):null,
    blocked:supportView?Boolean(row.blocked_at):false,
    blockedAt:supportView?(row.blocked_at||null):null,
    blockedReason:supportView?(row.blocked_reason||null):null,
    activeSessions:supportView?Number(row.active_sessions||0):0,
    lastSeenAt:supportView?(row.last_seen_at||null):null,
    orders:Number(row.order_count||0),
    openQuotes:supportView?Number(row.open_quote_count||0):0,
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
      googleAccounts:supportView?customers.filter(item=>item.googleLinked).length:0,
      activeSessions:supportView?customers.reduce((sum,item)=>sum+item.activeSessions,0):0,
      blocked:supportView?customers.filter(item=>item.blocked).length:0
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
  const isIntakeCard = item.template_key === 'SERVICE_INTAKE_CARD';
  const isEtaChange = item.template_key === 'SERVICE_ETA_CHANGED';
  const etaRaw = item.payload?.newEstimatedCompletionAt || null;
  const etaDate = etaRaw ? new Date(etaRaw) : null;
  const etaLabel = etaDate && !Number.isNaN(etaDate.getTime())
    ? etaDate.toLocaleDateString('pl-PL',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})
    : 'termin do ponownego ustalenia';
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
  const label = isEtaChange ? ('Nowy przewidywany termin: ' + etaLabel) : isTransfer ? transferLabels[transferStatus] : (STATUS_LABELS[targetStatus] || targetStatus);
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

  const subject = isIntakeCard
    ? 'LockOn ServiceOS · karta serwisowa · zlecenie #' + item.order_number
    : isEtaChange
      ? 'LockOn ServiceOS · zmiana terminu · zlecenie #' + item.order_number
      : 'LockOn ServiceOS · zlecenie #' + item.order_number + ' · ' + label;
  const intro = isIntakeCard
    ? 'Przyjęliśmy urządzenie ' + item.brand + ' ' + item.model + ' do punktu ' + item.point_name + '. W załączniku znajdziesz kartę serwisową PDF.'
    : isEtaChange
      ? (etaRaw
          ? 'Przewidywany termin realizacji Twojego zlecenia został zmieniony. Nowy termin to ' + etaLabel + '.'
          : 'Przewidywany termin realizacji Twojego zlecenia został zmieniony i zostanie ustalony ponownie przez serwis.')
    : isTransfer
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
    item.customer_google_sub && item.customer_portal_url ? 'Masz połączone konto Google? Zaloguj się bez kodu: ' + item.customer_portal_url + '?google=1' : '',
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
          '<div style="font-size:26px;line-height:1.15;font-weight:850;margin-top:8px">' + (isIntakeCard ? 'Potwierdzenie przyjęcia urządzenia' : isEtaChange ? 'Zmieniliśmy przewidywany termin' : 'Mamy aktualizację Twojej naprawy') + '</div>' +
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
          (item.customer_portal_code ? '<div style="margin-top:18px;padding-top:17px;border-top:1px solid #252b33"><div style="font-size:10px;color:#747f8a;text-transform:uppercase;letter-spacing:.07em;font-weight:800">Twój kod klienta</div><div style="font-size:17px;font-weight:800;color:#e9edf1;letter-spacing:.045em;margin-top:5px">' + escapeHtml(item.customer_portal_code) + '</div>' + (item.customer_portal_url ? '<a href="' + escapeHtml(item.customer_portal_url) + '" style="display:inline-block;margin-top:9px;color:#ff9a76;font-size:12px;font-weight:800;text-decoration:none">Otwórz portal bez wpisywania kodu →</a>' : '') + (item.customer_google_sub ? '<div style="margin-top:10px;color:#9ca7b1;font-size:11px;font-weight:700">Pełne konto Google pozostaje dostępne w portalu klienta.</div>' : '') + '</div>' : '') +
          '<p style="margin:18px 0 0;font-size:11px;color:#707b86;line-height:1.5">' + escapeHtml(footer) + '</p>' +
        '</div>' +
      '</div>' +
      '<div style="padding:13px 4px;text-align:center;font-size:10px;color:#59636d">Automatyczna wiadomość z ' + escapeHtml(displayName) + '.</div>' +
    '</div></body></html>';
  return { subject, text, html, displayName };
};

const sendGmail = async (sender, recipient, subject, textBody, htmlBody, displayName = 'LockOn ServiceOS', attachments = []) => {
  const refreshToken = decryptSecret(sender.refresh_token_ciphertext);
  const legacyClientSecret = sender.oauth_client_secret_ciphertext ? decryptSecret(sender.oauth_client_secret_ciphertext) : '';
  const accessToken = await refreshGmailAccess(refreshToken, legacyClientSecret);
  const altBoundary = 'lockon_alt_' + crypto.randomBytes(12).toString('hex');
  const mixedBoundary = 'lockon_mix_' + crypto.randomBytes(12).toString('hex');
  const fromName = encodeSubject(sanitizeHeader(displayName || 'LockOn ServiceOS'));
  const safeAttachments=(Array.isArray(attachments)?attachments:[]).slice(0,4).map((item)=>({
    fileName:sanitizeHeader(item?.fileName||'dokument.pdf').replace(/[\\/"]/g,'_').slice(0,160),
    contentType:sanitizeHeader(item?.contentType||'application/octet-stream').slice(0,120),
    content:Buffer.isBuffer(item?.content)?item.content:Buffer.from(item?.content||'')
  })).filter((item)=>item.content.length>0&&item.content.length<=8*1024*1024);

  const alternative=[
    '--' + altBoundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(textBody, 'utf8').toString('base64'),
    '--' + altBoundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody, 'utf8').toString('base64'),
    '--' + altBoundary + '--'
  ];

  const rawLines=[
    'From: ' + fromName + ' <' + sanitizeHeader(sender.sender_email) + '>',
    'To: ' + sanitizeHeader(recipient),
    'Subject: ' + encodeSubject(sanitizeHeader(subject)),
    'MIME-Version: 1.0'
  ];

  if(safeAttachments.length){
    rawLines.push('Content-Type: multipart/mixed; boundary="' + mixedBoundary + '"','',
      '--' + mixedBoundary,
      'Content-Type: multipart/alternative; boundary="' + altBoundary + '"','',
      ...alternative
    );
    for(const attachment of safeAttachments){
      rawLines.push(
        '--' + mixedBoundary,
        'Content-Type: ' + attachment.contentType + '; name="' + attachment.fileName + '"',
        'Content-Disposition: attachment; filename="' + attachment.fileName + '"',
        'Content-Transfer-Encoding: base64',
        '',
        attachment.content.toString('base64')
      );
    }
    rawLines.push('--' + mixedBoundary + '--');
  }else{
    rawLines.push('Content-Type: multipart/alternative; boundary="' + altBoundary + '"','',...alternative);
  }

  const raw=rawLines.join('\r\n');
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

const loadMeetingMailSender = async () => {
  const sender=(await q("SELECT sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,status,last_error FROM meeting_email_sender WHERE id='default' AND status='ACTIVE' AND refresh_token_ciphertext IS NOT NULL LIMIT 1")).rows[0]||null;
  if(!sender)return null;
  if(!GOOGLE_DESKTOP_CLIENT_SECRET&&!sender.oauth_client_secret_ciphertext)return null;
  return sender;
};

const meetingEmailRecipients = async (meetingId) => {
  const {rows}=await q(
    "SELECT DISTINCT u.id,u.email FROM users u WHERE u.status='ACTIVE' AND u.blocked_at IS NULL AND u.role_code IS NOT NULL AND ("+
    "EXISTS(SELECT 1 FROM meeting_audience a WHERE a.meeting_id=$1 AND a.audience_type='ALL') OR "+
    "EXISTS(SELECT 1 FROM meeting_audience a WHERE a.meeting_id=$1 AND a.audience_type='USER' AND a.user_id=u.id) OR "+
    "EXISTS(SELECT 1 FROM meeting_audience a JOIN user_point_access upa ON upa.point_id=a.point_id AND upa.user_id=u.id WHERE a.meeting_id=$1 AND a.audience_type='POINT'))",
    [meetingId]
  );
  return rows.filter((row)=>normalizeEmail(row.email));
};

const queueMeetingEmailEvent = async (meetingId,eventKey) => {
  const recipients=await meetingEmailRecipients(meetingId);
  let queued=0;
  for(const recipient of recipients){
    const result=await q(
      "INSERT INTO meeting_email_outbox(id,meeting_id,recipient_user_id,recipient_email,event_key,status) VALUES($1,$2,$3,$4,$5,'PENDING') ON CONFLICT(meeting_id,recipient_user_id,event_key) DO NOTHING RETURNING id",
      [makeId('mml'),meetingId,recipient.id,recipient.email,eventKey]
    );
    queued+=Number(result.rowCount||0);
  }
  return {eligible:recipients.length,queued};
};

const meetingEmailContent = (meeting,eventKey) => {
  const starts=new Intl.DateTimeFormat('pl-PL',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Warsaw'}).format(new Date(meeting.starts_at));
  const cancelled=String(eventKey).startsWith('CANCELLED');
  const changed=String(eventKey).startsWith('RESCHEDULED');
  const subject=cancelled
    ? 'LockOn ServiceOS — spotkanie zostało anulowane'
    : changed
      ? 'LockOn ServiceOS — termin spotkania został zmieniony'
      : 'LockOn ServiceOS — zaproszenie na spotkanie';
  const title=cleanText(meeting.title,120);
  const description=cleanText(meeting.description||'',1800);
  const intro=cancelled
    ? 'Zaplanowane spotkanie zostało anulowane.'
    : changed
      ? 'Termin spotkania został zmieniony.'
      : 'Zapraszamy na wewnętrzne spotkanie zespołu w LockOn ServiceOS.';
  const action=cancelled?'Nie musisz nic robić.':'Otwórz ServiceOS i zapisz się na spotkanie na ekranie Start.';
  const text=[intro,'','Spotkanie: '+title,'Termin: '+starts,description?('Opis: '+description):'', '',action].filter((line)=>line!==null).join('\n');
  const html='<!doctype html><html lang="pl"><body style="margin:0;background:#0b0e12;color:#edf1f4;font-family:Arial,sans-serif">'+
    '<div style="max-width:600px;margin:auto;padding:30px 16px"><div style="font-size:13px;font-weight:850">LockOn <span style="color:#7e8994">ServiceOS</span></div>'+
    '<div style="margin-top:18px;padding:24px;border:1px solid #293039;border-radius:18px;background:#12171d">'+
    '<div style="font-size:11px;color:#ff8f69;text-transform:uppercase;letter-spacing:.08em;font-weight:850">'+escapeHtml(cancelled?'Spotkanie anulowane':changed?'Zmiana terminu':'Zaproszenie na spotkanie')+'</div>'+
    '<h1 style="font-size:22px;margin:9px 0 12px">'+escapeHtml(title)+'</h1>'+
    '<p style="font-size:14px;color:#d9dfe5"><strong>'+escapeHtml(starts)+'</strong></p>'+
    (description?'<p style="font-size:13px;color:#aeb8c1;line-height:1.55">'+escapeHtml(description)+'</p>':'')+
    '<p style="margin-top:20px;font-size:13px;color:#d9dfe5">'+escapeHtml(action)+'</p>'+
    '</div><p style="font-size:10px;color:#66717b;text-align:center">Wiadomość organizacyjna LockOn ServiceOS.</p></div></body></html>';
  return {subject,text,html};
};

const processMeetingEmail = async (outboxId) => {
  const item=(await q(
    "SELECT o.*,m.title,m.description,m.starts_at,m.status AS meeting_status FROM meeting_email_outbox o JOIN meetings m ON m.id=o.meeting_id WHERE o.id=$1 LIMIT 1",
    [outboxId]
  )).rows[0];
  if(!item)return {sent:false,reason:'NOT_FOUND'};
  const attempt=Number(item.attempts||0)+1;
  const retryMinutes=Math.min(240,5*Math.pow(2,Math.max(0,attempt-1)));
  const nextAttemptAt=new Date(Date.now()+retryMinutes*60_000);
  const sender=await loadMeetingMailSender();
  if(!sender){
    const error='Brak aktywnego adminowskiego Gmail dla zaproszeń na spotkania.';
    await q("UPDATE meeting_email_outbox SET status='FAILED',attempts=$2,last_error=$3,available_at=$4,updated_at=now() WHERE id=$1",[outboxId,attempt,error,nextAttemptAt]);
    return {sent:false,reason:'MEETING_SENDER_NOT_CONFIGURED',attempts:attempt};
  }
  const content=meetingEmailContent(item,item.event_key);
  try{
    await q("UPDATE meeting_email_outbox SET status='PROCESSING',attempts=$2,last_error=NULL,updated_at=now() WHERE id=$1",[outboxId,attempt]);
    const sent=await sendGmail(sender,item.recipient_email,content.subject,content.text,content.html,'LockOn ServiceOS');
    await q("UPDATE meeting_email_outbox SET status='SENT',sent_at=now(),provider_message_id=$2,last_error=NULL,updated_at=now() WHERE id=$1",[outboxId,sent.id]);
    await q("UPDATE meeting_email_sender SET status='ACTIVE',last_error=NULL,updated_at=now() WHERE id='default'");
    return {sent:true,messageId:sent.id,attempts:attempt};
  }catch(error){
    const message=cleanText(error instanceof Error?error.message:error,500);
    await q("UPDATE meeting_email_outbox SET status='FAILED',last_error=$2,available_at=$3,updated_at=now() WHERE id=$1",[outboxId,message,nextAttemptAt]);
    if(isGmailReauthError(error))await q("UPDATE meeting_email_sender SET status='REVOKED',last_error=$1,updated_at=now() WHERE id='default'",[message]);
    else await q("UPDATE meeting_email_sender SET last_error=$1,updated_at=now() WHERE id='default'",[message]);
    return {sent:false,reason:isGmailReauthError(error)?'MEETING_GMAIL_REAUTH_REQUIRED':'SEND_FAILED',attempts:attempt};
  }
};

const sendCustomerPortalEventEmail = async ({
  customerId,
  pointId,
  senderUserId,
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
  const sender=await loadUserMailSender(senderUserId);
  if(!sender)return {sent:false,reason:'NO_USER_SENDER'};
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
    "SELECT n.id,n.user_id AS sender_user_id,n.recipient,n.service_order_id,n.template_key,n.payload,n.attempts,n.subject,n.body_text,n.body_html,s.order_number,s.status,s.point_id,s.customer_id,p.name AS point_name,cp.name AS current_point_name,c.first_name,ca.google_sub AS customer_google_sub,d.brand,d.model,e.sender_email,e.refresh_token_ciphertext,e.oauth_client_secret_ciphertext,e.status AS sender_status,coalesce(ns.sender_display_name,'LockOn ServiceOS') AS sender_display_name,ns.footer_text FROM notification_outbox n JOIN service_orders s ON s.id=n.service_order_id JOIN points p ON p.id=s.point_id LEFT JOIN points cp ON cp.id=s.current_point_id JOIN customers c ON c.id=s.customer_id LEFT JOIN customer_portal_accounts ca ON ca.customer_id=c.id JOIN devices d ON d.id=s.device_id LEFT JOIN user_gmail_credentials e ON e.user_id=n.user_id LEFT JOIN point_notification_settings ns ON ns.point_id=s.point_id WHERE n.id=$1 LIMIT 1",
    [notificationId]
  );
  const item = rows[0];
  if (!item) return { sent: false, reason: 'NOT_FOUND' };

  const attempt = Number(item.attempts || 0) + 1;
  const retryMinutes = Math.min(240, 5 * Math.pow(2, Math.max(0, attempt - 1)));
  const nextAttemptAt = new Date(Date.now() + retryMinutes * 60_000);

  if (!item.sender_email || item.sender_status !== 'ACTIVE' || !item.refresh_token_ciphertext || (!GOOGLE_DESKTOP_CLIENT_SECRET && !item.oauth_client_secret_ciphertext)) {
    const error = 'Brak aktywnego Gmail zalogowanego pracownika.';
    await q(
      "UPDATE notification_outbox SET status='FAILED',attempts=$2,last_error=$3,available_at=$4,updated_at=now() WHERE id=$1",
      [notificationId, attempt, error, nextAttemptAt]
    );
    return { sent: false, reason: 'NO_SENDER', senderUserId:item.sender_user_id||null, attempts: attempt, nextAttemptAt: nextAttemptAt.toISOString() };
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
      item.customer_portal_url = customerPortalAutoUrl(portalIdentity.code,item.service_order_id);
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
    const attachments=[];
    if(item.template_key==='SERVICE_INTAKE_CARD'){
      const card=await renderServiceCardPdf(item.service_order_id,'CUSTOMER');
      attachments.push({fileName:card.fileName,contentType:'application/pdf',content:card.buffer});
    }
    const sent = await sendGmail(item, item.recipient, subject, textBody, htmlBody, rendered.displayName, attachments);
    await q(
      "UPDATE notification_outbox SET status='SENT',sent_at=now(),provider_message_id=$2,last_error=NULL,updated_at=now() WHERE id=$1",
      [notificationId, sent.id]
    );
    if(item.template_key==='SERVICE_INTAKE_CARD'){
      await q("UPDATE service_order_cards SET customer_email_sent_at=now(),customer_email_last_error=NULL,updated_at=now() WHERE service_order_id=$1",[item.service_order_id]);
    }
    if(item.sender_user_id) await q("UPDATE user_gmail_credentials SET status='ACTIVE',last_error=NULL,updated_at=now() WHERE user_id=$1", [item.sender_user_id]);
    return { sent: true, status: 'SENT', messageId: sent.id, senderUserId:item.sender_user_id||null, attempts: attempt };
  } catch (error) {
    const message = cleanText(error instanceof Error ? error.message : error, 500);
    await q(
      "UPDATE notification_outbox SET status='FAILED',last_error=$2,available_at=$3,updated_at=now() WHERE id=$1",
      [notificationId, message, nextAttemptAt]
    );
    if(item.template_key==='SERVICE_INTAKE_CARD'){
      await q("UPDATE service_order_cards SET customer_email_last_error=$2,updated_at=now() WHERE service_order_id=$1",[item.service_order_id,message]).catch(()=>undefined);
    }
    if(isGmailReauthError(error)){
      if(item.sender_user_id) await q("UPDATE user_gmail_credentials SET status='REVOKED',last_error=$2,updated_at=now() WHERE user_id=$1", [item.sender_user_id, message]);
    }else{
      if(item.sender_user_id) await q("UPDATE user_gmail_credentials SET last_error=$2,updated_at=now() WHERE user_id=$1", [item.sender_user_id, message]);
    }
    return { sent: false, status: 'FAILED', reason: isGmailReauthError(error) ? 'GMAIL_REAUTH_REQUIRED' : 'SEND_FAILED', senderUserId:item.sender_user_id||null, attempts: attempt, nextAttemptAt: nextAttemptAt.toISOString() };
  }
};

const queueEtaChangedNotification = async (actor, orderId, oldEta, newEta) => {
  try {
    const orderData = (await q(
      "SELECT s.id,s.point_id,s.customer_id,c.email FROM service_orders s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1 LIMIT 1",
      [orderId]
    )).rows[0];
    if (!orderData?.email) return { queued:false,sent:false,reason:'NO_CUSTOMER_EMAIL' };
    const settings = await mailSettingsForPoint(orderData.point_id);
    const customerPrefs = await customerNotificationPreferences(orderData.customer_id);
    if (customerPrefs.serviceUpdates === false) return { queued:false,sent:false,reason:'CUSTOMER_PREF_DISABLED' };
    if (settings.automatic_email_enabled !== true) return { queued:false,sent:false,reason:'AUTOMATIC_EMAIL_DISABLED' };
    const notificationId = makeId('ntf');
    await q(
      "INSERT INTO notification_outbox(id,user_id,customer_id,service_order_id,channel,template_key,recipient,payload,status) VALUES($1,$2,$3,$4,'EMAIL','SERVICE_ETA_CHANGED',$5,$6::jsonb,'PENDING')",
      [notificationId,actor.id,orderData.customer_id,orderId,orderData.email,JSON.stringify({
        oldEstimatedCompletionAt:oldEta ? new Date(oldEta).toISOString() : null,
        newEstimatedCompletionAt:newEta ? new Date(newEta).toISOString() : null
      })]
    );
    return { queued:true,...(await processNotification(notificationId)) };
  } catch (error) {
    console.error('[eta notification]',error);
    return { queued:false,sent:false,reason:'NOTIFICATION_ERROR' };
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

const normalizeSupportTarget = (value) =>
  String(value || '').trim().toUpperCase() === 'CONSULTANT' ? 'CONSULTANT' : 'BOT';

const supportMessageView = (row) => {
  const author = row.sender_kind.toLowerCase();
  const explicitTarget = row.metadata?.target;
  const target = explicitTarget === 'BOT' || explicitTarget === 'CONSULTANT'
    ? explicitTarget
    : row.sender_kind === 'ASSISTANT'
      ? 'BOT'
      : row.sender_kind === 'SUPPORT'
        ? 'CONSULTANT'
        : null;
  return {
    id: row.id,
    author,
    text: row.body,
    action: row.metadata?.action || null,
    target,
    createdAt: row.created_at
  };
};

const repairSelfSupportAssignment = async (session) => {
  const { rows } = await q(
    "UPDATE support_conversations SET assigned_support_user_id=NULL,taken_at=NULL,consultant_requested_at=NULL,consultant_joined_at=NULL,updated_at=now() WHERE user_id=$1 AND assigned_support_user_id=$1 AND status='OPEN' RETURNING id,point_id",
    [session.user.id]
  );
  for (const row of rows) {
    await q(
      "INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,NULL,'SYSTEM',$3,$4::jsonb)",
      [makeId('msg'),row.id,'ServiceOS zakończył nieprawidłowe przypisanie własnej rozmowy do tego samego konta. Bot pozostaje dostępny.',JSON.stringify({target:'CONSULTANT',event:'SELF_ASSIGNMENT_REPAIR'})]
    );
    await audit(session,'SUPPORT_SELF_ASSIGNMENT_REPAIRED','support_conversation',row.id,row.point_id,{});
  }
  return rows.length;
};

const conversationPayload = async (userId) => {
  const conversation = (await q(
    "SELECT sc.*,ass.name AS assigned_support_name,ass.email AS assigned_support_email,ass.role_code AS assigned_support_role FROM support_conversations sc LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE sc.user_id=$1 AND sc.status='OPEN' ORDER BY sc.updated_at DESC LIMIT 1",
    [userId]
  )).rows[0] || await getOrCreateConversation(userId);
  const { rows } = await q(
    'SELECT id,sender_user_id,sender_kind,body,metadata,created_at FROM support_messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 200',
    [conversation.id]
  );
  rows.reverse();
  return {
    id: conversation.id,
    status: conversation.status,
    consultantRequestedAt: conversation.consultant_requested_at || null,
    consultantJoinedAt: conversation.consultant_joined_at || conversation.taken_at || null,
    assignedSupportUserId: conversation.assigned_support_user_id || null,
    assignedSupportName: conversation.assigned_support_user_id ? supportIdentityName(conversation.assigned_support_name,conversation.assigned_support_email,conversation.assigned_support_role) : null,
    consultantState: conversation.assigned_support_user_id ? 'JOINED' : conversation.consultant_requested_at ? 'WAITING' : 'BOT',
    messages: rows.map(supportMessageView)
  };
};

const roleSelfDescription = (role, supportEnabled = false) => {
  const base = ({
    OWNER: 'Jesteś właścicielem ServiceOS. Masz pełny dostęp do administracji, punktów, serwisu, rozliczeń, audytu i bezpieczeństwa.',
    BOSS: 'Jesteś Szefem. Masz globalny dostęp operacyjny do punktów, napraw, przychodów i rozliczeń.',
    COORDINATOR: 'Jesteś Koordynatorem. Pracujesz na przypisanych punktach i możesz zarządzać ich obsługą serwisową.',
    SUPPORT: 'Masz rolę Wsparcie LockOn. Możesz obsługiwać zgłoszenia użytkowników i kanał konsultanta w przypisanym zakresie, bez dostępu do rozliczeń ani administracji właściciela.',
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
    return { text:'Najpierw jestem do Twojej dyspozycji jako Bot ServiceOS i spróbuję rozwiązać sprawę od razu. Gdy potrzebujesz człowieka, wybierz „Poproś konsultanta”. Możesz nadal pisać do mnie także w kolejce i po dołączeniu konsultanta — wybierasz odbiorcę każdej wiadomości. Prywatne wiadomości do bota nie są udostępniane konsultantowi.', action:navAction('support','Otwórz Pomoc i infolinię') };
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
          'SELECT n.body,n.created_at,usr.name AS author_name,usr.email AS author_email,usr.role_code AS author_role FROM service_order_notes n JOIN users usr ON usr.id=n.author_user_id WHERE n.service_order_id=$1 ORDER BY n.created_at DESC LIMIT 3',
          [order.id]
        );
        if (rows.length) {
          lines.push('Ostatnie notatki wewnętrzne:');
          for (const note of rows) {
            lines.push('- ' + (operationalIdentityName(note.author_name,note.author_email,note.author_role) || 'Użytkownik') + ' · ' + new Date(note.created_at).toLocaleString('pl-PL') + ': ' + cleanText(note.body, 240));
          }
        } else {
          lines.push('Brak notatek wewnętrznych.');
        }
      }

      if (lower.includes('histori') || lower.includes('statusy')) {
        const { rows } = await q(
          'SELECT h.from_status,h.to_status,h.note,h.created_at,usr.name AS changed_by_name,usr.email AS changed_by_email,usr.role_code AS changed_by_role FROM service_order_status_history h LEFT JOIN users usr ON usr.id=h.changed_by_user_id WHERE h.service_order_id=$1 ORDER BY h.created_at DESC LIMIT 6',
          [order.id]
        );
        if (rows.length) {
          lines.push('Ostatnie zmiany statusu:');
          for (const item of rows.reverse()) {
            const from = item.from_status ? (STATUS_LABELS[item.from_status] || item.from_status) + ' → ' : '';
            const to = STATUS_LABELS[item.to_status] || item.to_status;
            const who = operationalIdentityName(item.changed_by_name,item.changed_by_email,item.changed_by_role) || 'System';
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

  return { text: 'Jasne — spróbuję Ci pomóc. Mogę wyszukać klienta lub zlecenie w Twoim zakresie, sprawdzić historię i notatki, otworzyć właściwy ekran, wyjaśnić przekazania, rozliczenia, Gmail i uprawnienia, przetestować internet i połączenie z API oraz znaleźć filmy albo materiały techniczne do naprawy. Zacznij od konkretu, np. „zlecenie 123 statusy”, „historia klienta Kowalski” albo „diagnostyka połączenia”. Jeśli po mojej odpowiedzi nadal będzie potrzebna pomoc człowieka, poproś konsultanta — w czasie oczekiwania nadal będę z Tobą pracować.' };
};

const route = async (request) => {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if(method==='POST'&&url.pathname==='/internal/notifications/process'){
    const triggerId=request.headers.get('x-neon-trigger-invocation-id');
    if(!triggerId)return json(request,{error:'TRIGGER_REQUIRED'},403);
    const triggerBody=await readJson(request).catch(()=>({}));
    const {rows}=await q("SELECT id FROM notification_outbox WHERE status IN ('PENDING','FAILED') AND available_at<=now() AND attempts<5 ORDER BY available_at ASC,created_at ASC LIMIT 25");
    const meetingRows=(await q("SELECT id FROM meeting_email_outbox WHERE status IN ('PENDING','FAILED') AND available_at<=now() AND attempts<5 ORDER BY available_at ASC,created_at ASC LIMIT 25")).rows;
    const results=[],meetingResults=[];
    for(const row of rows)results.push({id:row.id,...(await processNotification(row.id))});
    for(const row of meetingRows)meetingResults.push({id:row.id,...(await processMeetingEmail(row.id))});
    console.log('[notification worker]',{triggerId,scheduledAt:triggerBody?.data?.scheduled_at||null,processed:results.length,meetingProcessed:meetingResults.length});
    return json(request,{ok:true,processed:results.length,meetingProcessed:meetingResults.length,results,meetingResults});
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
    const portalRateKey = consumePublicAuthAttempt(request, 'customer-code', PUBLIC_CODE_ATTEMPT_LIMIT);
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
    clearPublicAuthAttempts(portalRateKey);
    await q("INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,NULL,'CUSTOMER_PORTAL_LOGIN','customer',$2,$3::jsonb)",[
      makeId('aud'),customer.id,JSON.stringify({clientType:'CUSTOMER_PORTAL',authMethod:'CODE'})
    ]);
    return json(request,{sessionToken:session.token,expiresAt:session.expiresAt,...(await loadCustomerPortalPayload(customer.id,{auth_method:'CODE'}))});
  }

  if (method === 'POST' && url.pathname === '/public/customer-portal/google/link') {
    const customerSession = await requireCustomerPortal(request);
    if (!GOOGLE_CUSTOMER_WEB_CLIENT_ID) return json(request,{error:'GOOGLE_NOT_CONFIGURED',message:'Logowanie Google dla klientów nie jest jeszcze dostępne.'},503);
    const body = await readJson(request);
    let profile;
    try { profile = await verifyCustomerGoogleCredential(body); }
    catch (error) {
      if (error?.code === 'MISSING_TOKEN') return json(request,{error:'MISSING_TOKEN',message:'Brak tokena Google.'},400);
      return json(request,{error:'GOOGLE_AUTH_FAILED',message:'Google nie potwierdził tożsamości. Spróbuj ponownie wybrać konto Google.'},401);
    }
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
    consumePublicAuthAttempt(request, 'customer-google', PUBLIC_GOOGLE_ATTEMPT_LIMIT);
    if (!GOOGLE_CUSTOMER_WEB_CLIENT_ID) return json(request,{error:'GOOGLE_NOT_CONFIGURED',message:'Logowanie Google dla klientów nie jest jeszcze dostępne.'},503);
    const body=await readJson(request);
    let profile;
    try { profile=await verifyCustomerGoogleCredential(body); }
    catch (error) {
      if (error?.code === 'MISSING_TOKEN') return json(request,{error:'MISSING_TOKEN',message:'Brak tokena Google.'},400);
      return json(request,{error:'GOOGLE_AUTH_FAILED',message:'Google nie potwierdził tożsamości. Spróbuj ponownie wybrać konto Google.'},401);
    }
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

  const customerServiceCardMatch=url.pathname.match(/^\/public\/customer-portal\/orders\/([^/]+)\/service-card$/);
  if(method==='GET'&&customerServiceCardMatch){
    const customerSession=await requireCustomerPortal(request);
    const owned=(await q("SELECT id FROM service_orders WHERE id=$1 AND customer_id=$2 LIMIT 1",[customerServiceCardMatch[1],customerSession.customer_id])).rows[0];
    if(!owned)return json(request,{error:'NOT_FOUND',message:'Nie znaleziono tej karty serwisowej.'},404);
    const card=await renderServiceCardPdf(owned.id,'CUSTOMER');
    return json(request,{orderId:owned.id,orderNumber:card.context.orderNumber,fileName:card.fileName,mimeType:'application/pdf',pdfBase64:card.buffer.toString('base64')});
  }

  const customerWarrantyCardMatch=url.pathname.match(/^\/public\/customer-portal\/orders\/([^/]+)\/warranty-card$/);
  if(method==='GET'&&customerWarrantyCardMatch){
    const customerSession=await requireCustomerPortal(request);
    const owned=(await q("SELECT id,warranty_card_printed_at FROM service_orders WHERE id=$1 AND customer_id=$2 LIMIT 1",[customerWarrantyCardMatch[1],customerSession.customer_id])).rows[0];
    if(!owned)return json(request,{error:'NOT_FOUND',message:'Nie znaleziono tej karty gwarancyjnej.'},404);
    if(!owned.warranty_card_printed_at)return json(request,{error:'WARRANTY_CARD_NOT_READY',message:'Karta gwarancyjna nie została jeszcze przygotowana przez serwis.'},409);
    const card=await renderWarrantyCardPdf(owned.id);
    await q("INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,NULL,'CUSTOMER_WARRANTY_CARD_DOWNLOADED','service_order',$2,$3::jsonb)",[
      makeId('aud'),owned.id,JSON.stringify({clientType:'CUSTOMER_PORTAL'})
    ]);
    return json(request,{orderId:owned.id,orderNumber:card.context.orderNumber,warrantyCardNumber:card.context.warrantyCardNumber,fileName:card.fileName,mimeType:'application/pdf',pdfBase64:card.buffer.toString('base64')});
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
    return json(request,{ok:true,requestId,routedPointName:routedPoint.name,...(await loadCustomerPortalPayload(customerSession.customer_id,customerSession))},201);
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
    return json(request,{ok:true,...(await loadCustomerPortalPayload(customerSession.customer_id,customerSession))});
  }

  if (method === 'GET' && url.pathname === '/health') return json(request, { ok: true, service: 'LockOn ServiceOS Central API', time: nowIso() });

  if (method === 'POST' && url.pathname === '/auth/google-code') {
    const body = await readJson(request);
    try {
      const tokens = await exchangeDesktopAuthorizationCode(body, '/oauth2/callback');
      if (!tokens?.id_token) return json(request, { error:'GOOGLE_ID_TOKEN', message:'Google nie zwrócił tokena tożsamości.' }, 400);
      const profile = await verifyGoogle(String(tokens.id_token), GOOGLE_DESKTOP_CLIENT_ID);
      const login = await loginProfile(profile, 'DESKTOP', true);
      const meetingGmail = await autoConnectMeetingGmailFromOwner(login, profile, tokens);
      const gmail = await autoConnectGmailFromPrimaryLogin(login, profile, tokens);
      return json(request, { ...login, gmail, meetingGmail });
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

  if (method === 'POST' && url.pathname === '/auth/dev-role') {
    if (!ALLOW_DEV_LOGIN) return json(request, { error: 'NOT_FOUND' }, 404);
    const body = await readJson(request);
    const role = String(body.role || '').trim().toUpperCase();
    if (!DEV_TEST_ROLES.has(role)) return json(request, { error:'DEV_ROLE_INVALID', message:'Nieprawidłowa rola testowa.' }, 400);
    if (role === 'OWNER') {
      if (!OWNER_EMAIL) return json(request,{error:'OWNER_EMAIL_NOT_CONFIGURED'},503);
      return json(request, await loginProfile({ sub:'dev-owner', email:OWNER_EMAIL, name:OWNER_OPERATIONAL_NAME, picture:null }, 'DESKTOP', true));
    }

    const roleSlug = role.toLowerCase();
    const userId = 'usr_ci_' + roleSlug;
    const email = 'ci-' + roleSlug + '@invalid.test';
    const name = 'CI ' + role;
    await q(
      "INSERT INTO users(id,google_sub,email,name,picture_url,role_code,technician_split_percent,support_enabled,status,first_login_at,last_login_at,updated_at) VALUES($1,$2,$3,$4,NULL,$5,$6,$7,'ACTIVE',now(),now(),now()) ON CONFLICT(id) DO UPDATE SET google_sub=EXCLUDED.google_sub,email=EXCLUDED.email,name=EXCLUDED.name,role_code=EXCLUDED.role_code,technician_split_percent=EXCLUDED.technician_split_percent,support_enabled=EXCLUDED.support_enabled,status='ACTIVE',blocked_at=NULL,blocked_reason=NULL,blocked_by_user_id=NULL,last_login_at=now(),updated_at=now()",
      [userId, 'dev-role-' + roleSlug, email, name, role, role === 'TECHNICIAN' ? 50 : null, role === 'SUPPORT']
    );
    await q('DELETE FROM user_point_access WHERE user_id=$1', [userId]);
    if (!GLOBAL_ROLES.has(role)) {
      const point = (await q('SELECT id FROM points WHERE active=true ORDER BY name,id LIMIT 1')).rows[0];
      if (!point) return json(request, { error:'DEV_POINT_REQUIRED', message:'Brak aktywnego punktu do testu roli.' }, 409);
      await q('INSERT INTO user_point_access(user_id,point_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [userId, point.id]);
    }
    const user = await loadUser(userId);
    const session = await createSession(user.id, 'DESKTOP');
    await audit({ user, clientType:'DESKTOP' }, 'LOGIN_DEV_ROLE', 'user', user.id, null, { role });
    return json(request, { token:session.token, ...(await authPayload(user,session.activePointId)) });
  }

  if (method === 'POST' && url.pathname === '/auth/dev-owner') {
    if (!ALLOW_DEV_LOGIN) return json(request, { error: 'NOT_FOUND' }, 404);
    if (!OWNER_EMAIL) return json(request,{error:'OWNER_EMAIL_NOT_CONFIGURED'},503);
    return json(request, await loginProfile({ sub: 'dev-owner', email: OWNER_EMAIL, name: OWNER_OPERATIONAL_NAME, picture: null }, 'DESKTOP', true));
  }

  if (method === 'GET' && url.pathname === '/me') {
    const session = await requireUser(request);
    return json(request, await authPayload(session.user,session.activePointId));
  }

  if(method==='POST'&&url.pathname==='/me/active-point'){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    const pointId=cleanText(body.pointId,80);
    if(!pointId)return json(request,{error:'ACTIVE_POINT_REQUIRED',message:'Wybierz aktywny punkt.'},400);
    await requirePoint(u,pointId);
    await q('UPDATE auth_sessions SET active_point_id=$2,last_seen_at=now() WHERE id=$1',[session.sessionId,pointId]);
    await audit(session,'SESSION_ACTIVE_POINT_CHANGED','point',pointId,pointId,{clientType:session.clientType});
    return json(request,await authPayload(u,pointId));
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
    const redeemRateKey = consumePublicAuthAttempt(request, 'employee-code', PUBLIC_CODE_ATTEMPT_LIMIT);
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
      const activePointId=await defaultActivePointIdForUser(userResult.rows[0]);
      await client.query(
        'INSERT INTO auth_sessions(id,user_id,token_hash,client_type,active_point_id,created_at,last_seen_at,expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$5,now(),now(),$6,$7)',
        [makeId('ses'), userResult.rows[0].id, tokenHash(token), 'WEB', activePointId, new Date(now + SESSION_TTL_MS), new Date(now + SESSION_ABSOLUTE_TTL_MS)]
      );
      await client.query('COMMIT');
      clearPublicAuthAttempts(redeemRateKey);
      return json(request, { token, ...(await authPayload(userResult.rows[0],activePointId)) });
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
      ? normalizeTechnicianPercent(splitRaw)
      : null;
    if (!pointName || !city || !REQUESTABLE_ROLES.has(requestedRole)) return json(request, { error: 'VALIDATION', message: 'Nieprawidłowe zgłoszenie punktu.' }, 400);
    if (requestedRole === 'TECHNICIAN' && technicianSplitPercent === null) {
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
    const serviceView=session.user.role_code==='USER';
    if(!serviceView&&!hasSupportAccess(session.user)){
      throw Object.assign(new Error('Brak uprawnień do klientów tego punktu.'),{status:403,code:'SERVICE_CUSTOMER_FORBIDDEN'});
    }
    return json(request,await customerAccountManagementOverview(session.user,url.searchParams.get('q')||'',serviceView?'SERVICE':'SUPPORT'));
  }

  const customerAccountCodeMatch=url.pathname.match(/^\/customer-accounts\/([^/]+)\/code$/);
  if(method==='POST'&&customerAccountCodeMatch){
    const session=await requireActive(request),u=session.user;
    const customer=await requireCustomerAccountAccess(u,customerAccountCodeMatch[1]);
    const body=await readJson(request);
    const rotate=body.rotate===true;
    const identity=rotate ? await rotateCustomerPortalCode(customer.id) : await ensureCustomerPortalCode(customer.id);
    let revoked=0;
    if(rotate) revoked=await revokeCustomerPortalSessions(customer.id,'CODE');
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
    const sender=await loadUserMailSender(u.id);
    if(!sender)return json(request,{error:'NO_USER_SENDER',message:'Twoje konto Google nie ma aktywnej zgody Gmail. Zaloguj się ponownie przez Google.'},409);
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

  const customerNotificationPrefsMatch=url.pathname.match(/^\/customer-accounts\/([^/]+)\/notification-preferences$/);
  if((method==='GET'||method==='POST')&&customerNotificationPrefsMatch){
    const session=await requireActive(request),u=session.user;
    const customer=await requireCustomerAccountAccess(u,customerNotificationPrefsMatch[1],'SERVICE');
    const current=await customerNotificationPreferences(customer.id);
    if(method==='GET')return json(request,current);
    const body=await readJson(request);
    const preferences={
      serviceUpdates:body.serviceUpdates===undefined?current.serviceUpdates:body.serviceUpdates===true,
      readyForPickup:body.readyForPickup===undefined?current.readyForPickup:body.readyForPickup===true,
      quoteUpdates:body.quoteUpdates===undefined?current.quoteUpdates:body.quoteUpdates===true,
      messages:body.messages===undefined?current.messages:body.messages===true
    };
    await q(
      "INSERT INTO customer_portal_accounts(customer_id,notify_service_updates,notify_ready_for_pickup,notify_quote_updates,notify_messages,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(customer_id) DO UPDATE SET notify_service_updates=EXCLUDED.notify_service_updates,notify_ready_for_pickup=EXCLUDED.notify_ready_for_pickup,notify_quote_updates=EXCLUDED.notify_quote_updates,notify_messages=EXCLUDED.notify_messages,updated_at=now()",
      [customer.id,preferences.serviceUpdates,preferences.readyForPickup,preferences.quoteUpdates,preferences.messages]
    );
    await audit(session,'CUSTOMER_NOTIFICATION_PREFERENCES_UPDATED','customer',customer.id,null,{preferences});
    return json(request,{ok:true,preferences});
  }

  const customerAccountProfileMatch=url.pathname.match(/^\/customer-accounts\/([^/]+)\/profile$/);
  if(method==='POST'&&customerAccountProfileMatch){
    const session=await requireActive(request),u=session.user;
    const customer=await requireCustomerAccountAccess(u,customerAccountProfileMatch[1],u.role_code==='USER'?'SERVICE':'SUPPORT');
    const body=await readJson(request);
    const firstName=cleanText(body.firstName,100);
    const lastName=cleanText(body.lastName,100);
    const email=normalizeEmail(body.email||'')||null;
    const phone=cleanText(body.phone,40)||null;
    if(!firstName)return json(request,{error:'CUSTOMER_NAME_REQUIRED',message:'Podaj imię klienta.'},400);
    if(email&&(!email.includes('@')||email.length>200))return json(request,{error:'CUSTOMER_EMAIL_INVALID',message:'Podaj prawidłowy adres e-mail.'},400);
    const before={firstName:customer.first_name,lastName:customer.last_name,email:customer.email||null,phone:customer.phone||null};
    const account=await customerPortalAccount(customer.id);
    const emailChanged=normalizeEmail(customer.email||'')!==normalizeEmail(email||'');
    let googleDisconnected=false;
    let revokedGoogleSessions=0;
    if(emailChanged&&account?.google_sub){
      await q("UPDATE customer_portal_accounts SET google_sub=NULL,google_email=NULL,google_name=NULL,google_picture_url=NULL,linked_at=NULL,last_login_at=NULL,updated_at=now() WHERE customer_id=$1",[customer.id]);
      revokedGoogleSessions=await revokeCustomerPortalSessions(customer.id,'GOOGLE');
      googleDisconnected=true;
    }
    const updated=(await q(
      "UPDATE customers SET first_name=$2,last_name=$3,email=$4,phone=$5,updated_at=now() WHERE id=$1 RETURNING id,first_name,last_name,email,phone,created_at,updated_at",
      [customer.id,firstName,lastName,email,phone]
    )).rows[0];
    await audit(session,'CUSTOMER_PROFILE_UPDATED','customer',customer.id,null,{
      before,after:{firstName:updated.first_name,lastName:updated.last_name,email:updated.email||null,phone:updated.phone||null},
      googleDisconnected,revokedGoogleSessions
    });
    return json(request,{ok:true,customer:{...customerView(updated),createdAt:updated.created_at,updatedAt:updated.updated_at},googleDisconnected,revokedGoogleSessions});
  }

  const customerAccountGoogleUnlinkMatch=url.pathname.match(/^\/customer-accounts\/([^/]+)\/google\/unlink$/);
  if(method==='POST'&&customerAccountGoogleUnlinkMatch){
    const session=await requireActive(request),u=session.user;
    const customer=await requireCustomerAccountAccess(u,customerAccountGoogleUnlinkMatch[1]);
    const account=await customerPortalAccount(customer.id);
    if(!account?.google_sub)return json(request,{ok:true,unlinked:false,revoked:0});
    await q(
      "UPDATE customer_portal_accounts SET google_sub=NULL,google_email=NULL,google_name=NULL,google_picture_url=NULL,linked_at=NULL,last_login_at=NULL,updated_at=now() WHERE customer_id=$1",
      [customer.id]
    );
    const revoked=await revokeCustomerPortalSessions(customer.id,'GOOGLE');
    await audit(session,'CUSTOMER_GOOGLE_UNLINKED_BY_STAFF','customer',customer.id,null,{googleEmail:account.google_email||null,revokedSessions:revoked});
    return json(request,{ok:true,unlinked:true,revoked});
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
    const [points, users, loginEvents, pendingRevenue, sessions, recentAudit, transferSummary, customerPortalSummary] = await Promise.all([
      q("SELECT p.id,p.name,p.city,p.active,p.service_enabled,p.accepts_external_repairs,p.external_repairs_paused,p.service_note,coalesce(t.active_technician_count,0)::int AS active_technician_count,(p.service_enabled OR coalesce(t.active_technician_count,0)>0) AS effective_service_enabled,(NOT p.external_repairs_paused AND (coalesce(t.active_technician_count,0)>0 OR (p.service_enabled AND p.accepts_external_repairs))) AS effective_accepts_external_repairs FROM points p LEFT JOIN LATERAL (SELECT count(*)::int AS active_technician_count FROM user_point_access a JOIN users u ON u.id=a.user_id WHERE a.point_id=p.id AND u.role_code='TECHNICIAN' AND u.status='ACTIVE' AND u.blocked_at IS NULL) t ON true ORDER BY p.name"),
      q("SELECT id,google_sub,email,name,picture_url,role_code,technician_split_percent,support_enabled,status,blocked_at,blocked_reason,blocked_by_user_id,first_login_at,last_login_at FROM users ORDER BY created_at DESC"),
      q("SELECT a.id,a.actor_user_id AS user_id,u.email,u.name,u.role_code AS role,u.status,a.created_at FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.action LIKE 'LOGIN_%' ORDER BY a.created_at DESC LIMIT 100"),
      q("SELECT r.*,u.name AS technician_name,u.email AS technician_email,u.role_code AS technician_role,p.name AS point_name,p.city AS point_city,p.active AS point_active FROM revenue_entries r JOIN users u ON u.id=r.user_id JOIN points p ON p.id=r.point_id WHERE r.status='PENDING' ORDER BY r.created_at DESC"),
      q("SELECT client_type,count(*)::int AS count FROM auth_sessions WHERE revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now() GROUP BY client_type"),
      q("SELECT a.id,a.action,a.entity_type,a.entity_id,a.point_id,a.metadata,a.created_at,u.name AS actor_name,u.email AS actor_email,u.role_code AS actor_role FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 80"),
      q("SELECT status,count(*)::int AS count FROM service_order_transfers GROUP BY status"),
      q("SELECT (SELECT count(*)::int FROM customer_portal_accounts WHERE google_sub IS NOT NULL) AS google_accounts,(SELECT count(*)::int FROM customer_portal_accounts WHERE blocked_at IS NOT NULL) AS blocked_accounts,(SELECT count(*)::int FROM customer_portal_sessions WHERE expires_at>now()) AS active_customer_sessions")
    ]);
    const mappedUsers = [];
    for (const user of users.rows) {
      if (isOwnerIdentity(user.email,user.role_code)) continue;
      mappedUsers.push(await publicUser(user));
    }
    const revenues = pendingRevenue.rows.map((r) => ({
      id:r.id,userId:r.user_id,pointId:r.point_id,amount:Number(r.amount),workDate:String(r.occurred_at).slice(0,10),note:r.note||'',status:r.status,
      splitTechnicianPercent:Number(r.technician_percent ?? 50),splitBossPercent:100-Number(r.technician_percent ?? 50),technicianShare:0,bossShare:0,submittedAt:r.created_at,reviewedAt:r.approved_at||null,
      technician:{id:r.user_id,name:operationalIdentityName(r.technician_name,r.technician_email,r.technician_role),email:operationalIdentityEmail(r.technician_email,r.technician_role)},point:{id:r.point_id,name:r.point_name,city:r.point_city,active:r.point_active}
    }));
    const sessionCounts=Object.fromEntries(sessions.rows.map((row)=>[row.client_type,Number(row.count)]));
    const transferCounts=Object.fromEntries(transferSummary.rows.map((row)=>[row.status,Number(row.count)]));
    return json(request, {
      points: points.rows.map(pointView),
      users: mappedUsers,
      pendingUsers: mappedUsers.filter((u) => u.status === 'PENDING' && !u.blocked),
      blockedUsers: mappedUsers.filter((u) => u.blocked),
      loginEvents: loginEvents.rows.map((e) => ({id:e.id,userId:e.user_id,email:operationalIdentityEmail(e.email,e.role)||'',name:operationalIdentityName(e.name,e.email,e.role)||'System',role:e.role||null,status:e.status||'PENDING',pointIds:[],createdAt:e.created_at})),
      pendingRevenue: revenues,
      system: {
        activeSessions: Object.values(sessionCounts).reduce((sum,value)=>sum+Number(value||0),0),
        desktopSessions: Number(sessionCounts.DESKTOP||0),
        webSessions: Number(sessionCounts.WEB||0),
        servicePoints: points.rows.filter((point)=>point.effective_service_enabled===true).length,
        openTransfers: Number(transferCounts.REQUESTED||0)+Number(transferCounts.IN_TRANSIT||0)+Number(transferCounts.DELIVERED||0),
        blockedUsers: mappedUsers.filter((u)=>u.blocked).length,
        customerGoogleAccounts:Number(customerPortalSummary.rows[0]?.google_accounts||0),
        customerPortalSessions:Number(customerPortalSummary.rows[0]?.active_customer_sessions||0),
        blockedCustomerAccounts:Number(customerPortalSummary.rows[0]?.blocked_accounts||0)
      },
      transferSummary: transferCounts,
      recentAudit: recentAudit.rows.map((row)=>({
        id:row.id,
        action:row.action,
        entityType:row.entity_type,
        entityId:row.entity_id||null,
        pointId:row.point_id||null,
        actorName:operationalIdentityName(row.actor_name,row.actor_email,row.actor_role)||'System',
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
      "target_u.name AS target_user_name,target_u.email AS target_user_email,target_u.role_code AS target_user_role,target_p.name AS target_point_name," +
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
        const metadata = sanitizeOperationalValue(row.metadata || {});
        const actionTransferStatus = String(row.action || '').startsWith('SERVICE_TRANSFER_')
          ? String(row.action).slice('SERVICE_TRANSFER_'.length)
          : null;
        return {
          id: row.id,
          actorUserId: row.actor_user_id || null,
          actorName: operationalIdentityName(row.actor_name,row.actor_email,row.actor_role) || 'System',
          actorEmail: operationalIdentityEmail(row.actor_email,row.actor_role),
          actorRole: row.actor_role || metadata.actorRole || null,
          pointId: row.point_id || null,
          pointName: row.point_name || null,
          entityType: row.entity_type,
          entityId: row.entity_id || null,
          entityName: operationalIdentityName(row.target_user_name,row.target_user_email,row.target_user_role) || row.target_point_name || null,
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
      "'notifications',(SELECT count(*) FROM notification_outbox)," +
      "'meetings',(SELECT count(*) FROM meetings)" +
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
      await remove('meeting_email_outbox');
      await remove('meeting_email_sender');
      await remove('meeting_events');
      await remove('meeting_attendance');
      await remove('meeting_participant_controls');
      await remove('meeting_registrations');
      await remove('meeting_audience');
      await remove('meetings');
      await remove('notification_outbox');
      await remove('revenue_entries');
      await remove('service_order_notes');
      await remove('service_order_status_history');
      await remove('service_order_transfers');
      await remove('service_orders');
      await remove('devices');
      await remove('customers');
      await remove('settlements');
      await remove('user_gmail_credentials');
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
        "'meetings',(SELECT count(*) FROM meetings)," +
        "'meeting_audience',(SELECT count(*) FROM meeting_audience)," +
        "'meeting_registrations',(SELECT count(*) FROM meeting_registrations)," +
        "'meeting_attendance',(SELECT count(*) FROM meeting_attendance)," +
        "'meeting_participant_controls',(SELECT count(*) FROM meeting_participant_controls)," +
        "'meeting_events',(SELECT count(*) FROM meeting_events)," +
        "'meeting_email_outbox',(SELECT count(*) FROM meeting_email_outbox)," +
        "'meeting_email_sender',(SELECT count(*) FROM meeting_email_sender)," +
        "'service_orders',(SELECT count(*) FROM service_orders)," +
        "'service_order_transfers',(SELECT count(*) FROM service_order_transfers)," +
        "'service_order_notes',(SELECT count(*) FROM service_order_notes)," +
        "'service_order_status_history',(SELECT count(*) FROM service_order_status_history)," +
        "'customers',(SELECT count(*) FROM customers)," +
        "'devices',(SELECT count(*) FROM devices)," +
        "'revenue_entries',(SELECT count(*) FROM revenue_entries)," +
        "'settlements',(SELECT count(*) FROM settlements)," +
        "'user_gmail_credentials',(SELECT count(*) FROM user_gmail_credentials)," +
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
    if(!FINANCE_READ_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do rozliczeń.'),{status:403});
    const baseSelect="SELECT r.*,usr.name AS technician_name,usr.email AS technician_email,usr.role_code AS technician_role,p.name AS point_name,p.city AS point_city,p.active AS point_active,so.order_number FROM revenue_entries r JOIN users usr ON usr.id=r.user_id JOIN points p ON p.id=r.point_id LEFT JOIN service_orders so ON so.id=r.service_order_id ";
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
        technician:{id:r.user_id,name:operationalIdentityName(r.technician_name,r.technician_email,r.technician_role),email:operationalIdentityEmail(r.technician_email,r.technician_role)},
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

  if(method==='GET'&&url.pathname==='/meetings'){
    const session=await requireActive(request);
    return json(request,{meetings:await listMeetingsForUser(session.user),serverTime:nowIso()});
  }

  if(method==='GET'&&url.pathname==='/meetings/options'){
    const session=await requireActive(request),u=session.user;
    if(!MEETING_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do planowania spotkań.'),{status:403,code:'MEETING_MANAGE_FORBIDDEN'});
    const [pointsResult,usersResult]=await Promise.all([
      q("SELECT id,name,city FROM points WHERE active=true ORDER BY name"),
      q("SELECT id,name,email,role_code FROM users WHERE status='ACTIVE' AND blocked_at IS NULL AND role_code IS NOT NULL ORDER BY lower(name),lower(email)")
    ]);
    return json(request,{
      points:pointsResult.rows.map((row)=>({id:row.id,name:row.name,city:row.city})),
      users:usersResult.rows.map((row)=>({id:row.id,name:operationalIdentityName(row.name,row.email,row.role_code),email:operationalIdentityEmail(row.email,row.role_code),role:row.role_code}))
    });
  }

  if(method==='POST'&&url.pathname==='/meetings'){
    const session=await requireActive(request),u=session.user;
    if(!MEETING_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Spotkania może planować OWNER lub BOSS.'),{status:403,code:'MEETING_MANAGE_FORBIDDEN'});
    const body=await readJson(request);
    const title=cleanText(body.title,120),description=cleanText(body.description,2000);
    const startsAtRaw=cleanText(body.startsAt,80),startsAt=new Date(startsAtRaw);
    const plannedMinutes=Math.max(10,Math.min(480,Math.trunc(Number(body.plannedMinutes)||60)));
    const maxParticipants=Math.max(2,Math.min(500,Math.trunc(Number(body.maxParticipants)||50)));
    if(title.length<3)return json(request,{error:'MEETING_TITLE',message:'Tytuł spotkania musi mieć co najmniej 3 znaki.'},400);
    if(!startsAtRaw||Number.isNaN(startsAt.getTime()))return json(request,{error:'MEETING_DATE',message:'Podaj prawidłowy termin spotkania.'},400);
    if(startsAt.getTime()<Date.now()-10*60_000)return json(request,{error:'MEETING_DATE',message:'Nie można zaplanować spotkania w przeszłości.'},400);

    let hostUserId=cleanText(body.hostUserId,120)||u.id;
    const host=(await q("SELECT id,status,blocked_at FROM users WHERE id=$1 LIMIT 1",[hostUserId])).rows[0];
    if(!host||host.status!=='ACTIVE'||host.blocked_at)return json(request,{error:'MEETING_HOST',message:'Wybrany prowadzący nie ma aktywnego konta.'},409);

    const sourceAudience=Array.isArray(body.audience)&&body.audience.length?body.audience:[{type:'ALL'}];
    const audience=[];
    const seen=new Set();
    for(const raw of sourceAudience.slice(0,100)){
      const type=String(raw?.type||'').toUpperCase();
      if(type==='ALL'){
        if(!seen.has('ALL')){seen.add('ALL');audience.push({type:'ALL',pointId:null,userId:null});}
      }else if(type==='POINT'){
        const pointId=cleanText(raw?.pointId,80);if(!pointId)continue;
        const key='POINT:'+pointId;if(!seen.has(key)){seen.add(key);audience.push({type:'POINT',pointId,userId:null});}
      }else if(type==='USER'){
        const userId=cleanText(raw?.userId,120);if(!userId)continue;
        const key='USER:'+userId;if(!seen.has(key)){seen.add(key);audience.push({type:'USER',pointId:null,userId});}
      }
    }
    if(!audience.length)audience.push({type:'ALL',pointId:null,userId:null});
    if(audience.some((item)=>item.type==='ALL'))audience.splice(0,audience.length,{type:'ALL',pointId:null,userId:null});

    const meetingId=makeId('mtg');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO meetings(id,created_by_user_id,host_user_id,title,description,starts_at,planned_minutes,max_participants,allow_participant_audio,allow_participant_screen_share) VALUES($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10)",
        [meetingId,u.id,hostUserId,title,description,startsAt.toISOString(),plannedMinutes,maxParticipants,body.allowParticipantAudio!==false,body.allowParticipantScreenShare===true]
      );
      for(const item of audience){
        if(item.type==='POINT'){
          const exists=(await client.query("SELECT id FROM points WHERE id=$1 AND active=true LIMIT 1",[item.pointId])).rows[0];
          if(!exists)throw Object.assign(new Error('Nie znaleziono aktywnego punktu dla odbiorców spotkania.'),{status:409,code:'MEETING_AUDIENCE_POINT'});
        }
        if(item.type==='USER'){
          const exists=(await client.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' AND blocked_at IS NULL LIMIT 1",[item.userId])).rows[0];
          if(!exists)throw Object.assign(new Error('Nie znaleziono aktywnego użytkownika dla odbiorców spotkania.'),{status:409,code:'MEETING_AUDIENCE_USER'});
        }
        await client.query(
          "INSERT INTO meeting_audience(id,meeting_id,audience_type,point_id,user_id) VALUES($1,$2,$3,$4,$5)",
          [makeId('mau'),meetingId,item.type,item.pointId,item.userId]
        );
      }
      await client.query(
        "INSERT INTO meeting_events(id,meeting_id,actor_user_id,event_type,metadata) VALUES($1,$2,$3,'CREATED',$4::jsonb)",
        [makeId('mte'),meetingId,u.id,JSON.stringify({audienceCount:audience.length})]
      );
      await client.query('COMMIT');
    }catch(error){
      try{await client.query('ROLLBACK');}catch{}
      throw error;
    }finally{client.release();}
    await audit(session,'MEETING_CREATED','meeting',meetingId,null,{startsAt:startsAt.toISOString(),plannedMinutes,maxParticipants,audience});
    const invitationQueue=await queueMeetingEmailEvent(meetingId,'CREATED');
    await meetingEvent(meetingId,u.id,'EMAIL_INVITATIONS_QUEUED',invitationQueue);
    const meetings=await listMeetingsForUser(u);
    return json(request,{ok:true,meeting:meetings.find((item)=>item.id===meetingId)||null},201);
  }

  const meetingUpdate=url.pathname.match(/^\/meetings\/([^/]+)$/);
  if(method==='PATCH'&&meetingUpdate){
    const session=await requireActive(request),u=session.user,meetingId=cleanText(meetingUpdate[1],120);
    const meeting=await loadMeeting(meetingId);
    if(!meeting)return json(request,{error:'NOT_FOUND'},404);
    if(!meetingCanManage(u,meeting))return json(request,{error:'MEETING_MANAGE_FORBIDDEN',message:'Nie możesz zmieniać tego spotkania.'},403);
    if(meeting.status!=='SCHEDULED')return json(request,{error:'MEETING_STATE',message:'Spotkanie można edytować tylko przed rozpoczęciem.'},409);

    const body=await readJson(request);
    const title=body.title===undefined?meeting.title:cleanText(body.title,120);
    const description=body.description===undefined?(meeting.description||''):cleanText(body.description,2000);
    if(title.length<3)return json(request,{error:'MEETING_TITLE',message:'Tytuł spotkania musi mieć co najmniej 3 znaki.'},400);

    const startsAtRaw=body.startsAt===undefined?new Date(meeting.starts_at).toISOString():cleanText(body.startsAt,80);
    const startsAt=new Date(startsAtRaw);
    if(!startsAtRaw||Number.isNaN(startsAt.getTime()))return json(request,{error:'MEETING_DATE',message:'Podaj prawidłowy termin spotkania.'},400);
    if(startsAt.getTime()<Date.now()-10*60_000)return json(request,{error:'MEETING_DATE',message:'Nie można ustawić spotkania w przeszłości.'},400);

    const plannedMinutes=body.plannedMinutes===undefined
      ? Number(meeting.planned_minutes||60)
      : Math.max(10,Math.min(480,Math.trunc(Number(body.plannedMinutes)||0)));
    const maxParticipants=body.maxParticipants===undefined
      ? Number(meeting.max_participants||50)
      : Math.max(2,Math.min(500,Math.trunc(Number(body.maxParticipants)||0)));
    if(body.plannedMinutes!==undefined&&(!Number.isFinite(Number(body.plannedMinutes))||Number(body.plannedMinutes)<10||Number(body.plannedMinutes)>480)){
      return json(request,{error:'MEETING_DURATION',message:'Przewidywany czas musi mieścić się w zakresie 10–480 minut.'},400);
    }
    if(body.maxParticipants!==undefined&&(!Number.isFinite(Number(body.maxParticipants))||Number(body.maxParticipants)<2||Number(body.maxParticipants)>500)){
      return json(request,{error:'MEETING_LIMIT',message:'Limit uczestników musi mieścić się w zakresie 2–500.'},400);
    }

    const allowParticipantAudio=body.allowParticipantAudio===undefined?meeting.allow_participant_audio===true:body.allowParticipantAudio===true;
    const allowParticipantScreenShare=body.allowParticipantScreenShare===undefined?meeting.allow_participant_screen_share===true:body.allowParticipantScreenShare===true;

    let audience=null;
    if(body.audience!==undefined){
      const sourceAudience=Array.isArray(body.audience)&&body.audience.length?body.audience:[{type:'ALL'}];
      audience=[];
      const seen=new Set();
      for(const raw of sourceAudience.slice(0,100)){
        const type=String(raw?.type||'').toUpperCase();
        if(type==='ALL'){
          if(!seen.has('ALL')){seen.add('ALL');audience.push({type:'ALL',pointId:null,userId:null});}
        }else if(type==='POINT'){
          const pointId=cleanText(raw?.pointId,80);if(!pointId)continue;
          const key='POINT:'+pointId;if(!seen.has(key)){seen.add(key);audience.push({type:'POINT',pointId,userId:null});}
        }else if(type==='USER'){
          const userId=cleanText(raw?.userId,120);if(!userId)continue;
          const key='USER:'+userId;if(!seen.has(key)){seen.add(key);audience.push({type:'USER',pointId:null,userId});}
        }
      }
      if(!audience.length)audience.push({type:'ALL',pointId:null,userId:null});
      if(audience.some((item)=>item.type==='ALL'))audience.splice(0,audience.length,{type:'ALL',pointId:null,userId:null});
    }

    const oldStartsAt=new Date(meeting.starts_at).toISOString();
    const newStartsAt=startsAt.toISOString();
    const scheduleChanged=oldStartsAt!==newStartsAt;
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const locked=(await client.query("SELECT status,(SELECT count(*)::int FROM meeting_registrations r WHERE r.meeting_id=meetings.id AND r.status='REGISTERED') AS registered_count FROM meetings WHERE id=$1 FOR UPDATE",[meetingId])).rows[0];
      if(!locked)throw Object.assign(new Error('Spotkanie już nie istnieje.'),{status:404});
      if(locked.status!=='SCHEDULED')throw Object.assign(new Error('Stan spotkania zmienił się w międzyczasie.'),{status:409,code:'MEETING_STATE_CHANGED'});
      if(Number(locked.registered_count||0)>maxParticipants)throw Object.assign(new Error('Nowy limit jest mniejszy niż liczba zapisanych uczestników.'),{status:409,code:'MEETING_LIMIT_REGISTERED'});

      if(audience){
        for(const item of audience){
          if(item.type==='POINT'){
            const exists=(await client.query("SELECT id FROM points WHERE id=$1 AND active=true LIMIT 1",[item.pointId])).rows[0];
            if(!exists)throw Object.assign(new Error('Nie znaleziono aktywnego punktu dla odbiorców spotkania.'),{status:409,code:'MEETING_AUDIENCE_POINT'});
          }
          if(item.type==='USER'){
            const exists=(await client.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' AND blocked_at IS NULL LIMIT 1",[item.userId])).rows[0];
            if(!exists)throw Object.assign(new Error('Nie znaleziono aktywnego użytkownika dla odbiorców spotkania.'),{status:409,code:'MEETING_AUDIENCE_USER'});
          }
        }
      }

      await client.query(
        "UPDATE meetings SET title=$2,description=NULLIF($3,''),starts_at=$4,planned_minutes=$5,max_participants=$6,allow_participant_audio=$7,allow_participant_screen_share=$8,updated_at=now() WHERE id=$1 AND status='SCHEDULED'",
        [meetingId,title,description,newStartsAt,plannedMinutes,maxParticipants,allowParticipantAudio,allowParticipantScreenShare]
      );
      if(audience){
        await client.query("DELETE FROM meeting_audience WHERE meeting_id=$1",[meetingId]);
        for(const item of audience){
          await client.query(
            "INSERT INTO meeting_audience(id,meeting_id,audience_type,point_id,user_id) VALUES($1,$2,$3,$4,$5)",
            [makeId('mau'),meetingId,item.type,item.pointId,item.userId]
          );
        }
      }
      await client.query(
        "INSERT INTO meeting_events(id,meeting_id,actor_user_id,event_type,metadata) VALUES($1,$2,$3,'EDITED',$4::jsonb)",
        [makeId('mte'),meetingId,u.id,JSON.stringify({scheduleChanged,titleChanged:title!==meeting.title,audienceChanged:Boolean(audience),plannedMinutes,maxParticipants,allowParticipantAudio,allowParticipantScreenShare})]
      );
      if(scheduleChanged){
        await client.query(
          "INSERT INTO meeting_events(id,meeting_id,actor_user_id,event_type,metadata) VALUES($1,$2,$3,'RESCHEDULED',$4::jsonb)",
          [makeId('mte'),meetingId,u.id,JSON.stringify({from:oldStartsAt,to:newStartsAt})]
        );
      }
      await client.query('COMMIT');
    }catch(error){
      try{await client.query('ROLLBACK');}catch{}
      throw error;
    }finally{client.release();}

    await audit(session,'MEETING_UPDATED','meeting',meetingId,null,{scheduleChanged,from:oldStartsAt,to:newStartsAt,plannedMinutes,maxParticipants,audienceChanged:Boolean(audience)});
    let email={eligible:0,queued:0,unchanged:true};
    if(scheduleChanged){
      email=await queueMeetingEmailEvent(meetingId,'RESCHEDULED:'+Date.now()+':'+crypto.randomBytes(4).toString('hex'));
      await meetingEvent(meetingId,u.id,'EMAIL_RESCHEDULE_QUEUED',email);
    }
    const view=(await listMeetingsForUser(u)).find((item)=>item.id===meetingId)||null;
    return json(request,{ok:true,meeting:view,email});
  }

  const meetingJoinToken=url.pathname.match(/^\/meetings\/([^/]+)\/join-token$/);
  if(method==='POST'&&meetingJoinToken){
    const session=await requireActive(request),u=session.user,meetingId=cleanText(meetingJoinToken[1],120);
    const meeting=await loadMeeting(meetingId);
    if(!meeting)return json(request,{error:'NOT_FOUND'},404);
    if(!canJoinMeeting(meeting.status))return json(request,{error:'MEETING_NOT_LIVE',message:'Do pokoju można dołączyć dopiero po rozpoczęciu spotkania.'},409);
    if(!await meetingEligible(u,meetingId)&&!meetingCanManage(u,meeting))return json(request,{error:'MEETING_NOT_ELIGIBLE',message:'To spotkanie nie jest przeznaczone dla Twojego konta.'},403);
    if(!meetingCanManage(u,meeting)){
      const registration=(await q("SELECT status FROM meeting_registrations WHERE meeting_id=$1 AND user_id=$2 LIMIT 1",[meetingId,u.id])).rows[0];
      if(registration?.status!=='REGISTERED')return json(request,{error:'MEETING_REGISTRATION_REQUIRED',message:'Najpierw zapisz się na spotkanie.'},409);
    }
    const payload=await createMeetingJoinToken(meeting,u);
    await meetingEvent(meetingId,u.id,'JOIN_TOKEN_ISSUED',{identity:payload.identity});
    return json(request,payload);
  }

  const meetingAttendanceAction=url.pathname.match(/^\/meetings\/([^/]+)\/attendance$/);
  if(meetingAttendanceAction&&method==='POST'){
    const session=await requireActive(request),u=session.user,meetingId=cleanText(meetingAttendanceAction[1],120);
    const meeting=await loadMeeting(meetingId);
    if(!meeting)return json(request,{error:'NOT_FOUND'},404);
    if(!await meetingEligible(u,meetingId)&&!meetingCanManage(u,meeting))return json(request,{error:'MEETING_NOT_ELIGIBLE'},403);
    const body=await readJson(request),action=String(body.action||'').toUpperCase();
    if(action==='JOIN'&&!canJoinMeeting(meeting.status))return json(request,{error:'MEETING_NOT_LIVE',message:'Obecność można rozpocząć dopiero po uruchomieniu spotkania.'},409);
    if(action==='JOIN'){
      await q(
        "INSERT INTO meeting_attendance(meeting_id,user_id,first_joined_at,last_joined_at,join_count,updated_at) VALUES($1,$2,now(),now(),1,now()) ON CONFLICT(meeting_id,user_id) DO UPDATE SET first_joined_at=COALESCE(meeting_attendance.first_joined_at,now()),last_joined_at=now(),join_count=meeting_attendance.join_count+1,updated_at=now()",
        [meetingId,u.id]
      );
      await meetingEvent(meetingId,u.id,'ATTENDANCE_JOIN',{});
    }else if(action==='LEAVE'){
      await q(
        "UPDATE meeting_attendance SET total_seconds=total_seconds+GREATEST(0,LEAST(43200,EXTRACT(EPOCH FROM (now()-last_joined_at))::int)),last_left_at=now(),updated_at=now() WHERE meeting_id=$1 AND user_id=$2 AND last_joined_at IS NOT NULL AND (last_left_at IS NULL OR last_left_at<last_joined_at)",
        [meetingId,u.id]
      );
      await meetingEvent(meetingId,u.id,'ATTENDANCE_LEAVE',{});
    }else return json(request,{error:'MEETING_ATTENDANCE_ACTION'},400);
    return json(request,{ok:true});
  }

  const meetingAttendanceList=url.pathname.match(/^\/meetings\/([^/]+)\/attendance$/);
  if(meetingAttendanceList&&method==='GET'){
    const session=await requireActive(request),u=session.user,meetingId=cleanText(meetingAttendanceList[1],120);
    const meeting=await loadMeeting(meetingId);
    if(!meeting)return json(request,{error:'NOT_FOUND'},404);
    if(!meetingCanManage(u,meeting))return json(request,{error:'MEETING_MANAGE_FORBIDDEN'},403);
    const {rows}=await q(
      "SELECT usr.id AS user_id,usr.name,usr.email,usr.role_code,r.status AS registration_status,r.registered_at,a.first_joined_at,a.last_joined_at,a.last_left_at,a.total_seconds,a.join_count FROM (SELECT user_id FROM meeting_registrations WHERE meeting_id=$1 UNION SELECT user_id FROM meeting_attendance WHERE meeting_id=$1) x JOIN users usr ON usr.id=x.user_id LEFT JOIN meeting_registrations r ON r.meeting_id=$1 AND r.user_id=x.user_id LEFT JOIN meeting_attendance a ON a.meeting_id=$1 AND a.user_id=x.user_id ORDER BY COALESCE(r.registered_at,a.first_joined_at) ASC",
      [meetingId]
    );
    return json(request,{meetingId,attendance:rows.map((row)=>({
      userId:row.user_id,
      name:operationalIdentityName(row.name,row.email,row.role_code)||'Użytkownik',
      registrationStatus:row.registration_status||'NOT_REGISTERED',
      registeredAt:row.registered_at,
      joined:Boolean(row.first_joined_at),
      firstJoinedAt:row.first_joined_at||null,
      lastJoinedAt:row.last_joined_at||null,
      lastLeftAt:row.last_left_at||null,
      totalSeconds:Number(row.total_seconds||0),
      joinCount:Number(row.join_count||0)
    }))});
  }

  const meetingParticipants=url.pathname.match(/^\/meetings\/([^/]+)\/participants$/);
  if(method==='GET'&&meetingParticipants){
    const session=await requireActive(request),u=session.user,meetingId=cleanText(meetingParticipants[1],120);
    const meeting=await loadMeeting(meetingId);
    if(!meeting)return json(request,{error:'NOT_FOUND'},404);
    if(!meetingCanManage(u,meeting))return json(request,{error:'MEETING_MANAGE_FORBIDDEN'},403);
    if(!livekitConfigured())return json(request,{participants:[],configured:false});
    const participants=await livekitRooms().listParticipants(meetingRoomName(meetingId));
    return json(request,{
      configured:true,
      participants:participants.map((item)=>({
        identity:item.identity,
        name:item.name||'Uczestnik',
        metadata:item.metadata||'',
        joinedAt:item.joinedAt?String(item.joinedAt):null,
        tracks:(item.tracks||[]).map((track)=>({sid:track.sid,source:track.source,muted:track.muted===true}))
      }))
    });
  }

  const meetingModerate=url.pathname.match(/^\/meetings\/([^/]+)\/moderate$/);
  if(method==='POST'&&meetingModerate){
    const session=await requireActive(request),u=session.user,meetingId=cleanText(meetingModerate[1],120);
    const meeting=await loadMeeting(meetingId);
    if(!meeting)return json(request,{error:'NOT_FOUND'},404);
    if(!meetingCanManage(u,meeting))return json(request,{error:'MEETING_MANAGE_FORBIDDEN'},403);
    const body=await readJson(request),identity=cleanText(body.identity,120),action=String(body.action||'').toUpperCase();
    if(!identity||!['MUTE','REMOVE','ALLOW_MIC','BLOCK_MIC'].includes(action))return json(request,{error:'MEETING_MODERATION_ACTION'},400);
    const room=meetingRoomName(meetingId),client=livekitRooms();
    const participant=await client.getParticipant(room,identity);
    let participantUserId='';
    try{
      const metadata=JSON.parse(participant.metadata||'{}');
      participantUserId=cleanText(metadata?.serviceOsUserId,120);
    }catch{}
    if(!participantUserId)return json(request,{error:'MEETING_PARTICIPANT_IDENTITY',message:'Nie udało się powiązać uczestnika z kontem ServiceOS.'},409);
    if(action==='REMOVE'){
      await q(
        "INSERT INTO meeting_participant_controls(meeting_id,user_id,removed_at,updated_by_user_id,updated_at) VALUES($1,$2,now(),$3,now()) ON CONFLICT(meeting_id,user_id) DO UPDATE SET removed_at=now(),updated_by_user_id=$3,updated_at=now()",
        [meetingId,participantUserId,u.id]
      );
      await client.removeParticipant(room,identity);
    }else if(action==='MUTE'){
      const mic=(participant.tracks||[]).find((track)=>track.source===TrackSource.MICROPHONE);
      if(mic)await client.mutePublishedTrack(room,identity,mic.sid,true);
    }else{
      const allowMic=action==='ALLOW_MIC';
      await q(
        "INSERT INTO meeting_participant_controls(meeting_id,user_id,microphone_allowed,updated_by_user_id,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(meeting_id,user_id) DO UPDATE SET microphone_allowed=$3,updated_by_user_id=$4,updated_at=now()",
        [meetingId,participantUserId,allowMic,u.id]
      );
      const sources=[];
      if(allowMic)sources.push(TrackSource.MICROPHONE);
      if(meeting.allow_participant_screen_share===true)sources.push(TrackSource.SCREEN_SHARE,TrackSource.SCREEN_SHARE_AUDIO);
      await client.updateParticipant(room,identity,{
        permission:{canSubscribe:true,canPublish:sources.length>0,canPublishData:false,canPublishSources:sources}
      });
      if(!allowMic){
        const mic=(participant.tracks||[]).find((track)=>track.source===TrackSource.MICROPHONE);
        if(mic)await client.mutePublishedTrack(room,identity,mic.sid,true).catch(()=>undefined);
      }
    }
    await meetingEvent(meetingId,u.id,'MODERATION',{identity,participantUserId,action});
    await audit(session,'MEETING_MODERATION','meeting',meetingId,null,{identity,action});
    return json(request,{ok:true});
  }

  const meetingAction=url.pathname.match(/^\/meetings\/([^/]+)\/(register|unregister|start|end|cancel)$/);
  if(meetingAction&&method==='POST'){
    const session=await requireActive(request),u=session.user,meetingId=cleanText(meetingAction[1],120),action=meetingAction[2];
    const meeting=await loadMeeting(meetingId);
    if(!meeting)return json(request,{error:'NOT_FOUND'},404);

    if(action==='register'||action==='unregister'){
      if(!await meetingEligible(u,meetingId))return json(request,{error:'MEETING_NOT_ELIGIBLE',message:'To spotkanie nie jest przeznaczone dla Twojego konta.'},403);
      if(action==='register'&&!['SCHEDULED','LIVE'].includes(meeting.status))return json(request,{error:'MEETING_CLOSED',message:'Zapisy na to spotkanie są zamknięte.'},409);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const locked=(await client.query("SELECT id,status,max_participants FROM meetings WHERE id=$1 FOR UPDATE",[meetingId])).rows[0];
        if(!locked)throw Object.assign(new Error('Spotkanie już nie istnieje.'),{status:404});
        if(action==='register'){
          const existing=(await client.query("SELECT status FROM meeting_registrations WHERE meeting_id=$1 AND user_id=$2",[meetingId,u.id])).rows[0];
          if(existing?.status!=='REGISTERED'){
            const count=Number((await client.query("SELECT count(*)::int AS count FROM meeting_registrations WHERE meeting_id=$1 AND status='REGISTERED'",[meetingId])).rows[0]?.count||0);
            if(count>=Number(locked.max_participants))throw Object.assign(new Error('Limit miejsc na to spotkanie został osiągnięty.'),{status:409,code:'MEETING_FULL'});
            await client.query(
              "INSERT INTO meeting_registrations(meeting_id,user_id,status,registered_at,updated_at) VALUES($1,$2,'REGISTERED',now(),now()) ON CONFLICT(meeting_id,user_id) DO UPDATE SET status='REGISTERED',registered_at=now(),updated_at=now()",
              [meetingId,u.id]
            );
          }
        }else{
          await client.query("UPDATE meeting_registrations SET status='CANCELLED',updated_at=now() WHERE meeting_id=$1 AND user_id=$2",[meetingId,u.id]);
        }
        await client.query(
          "INSERT INTO meeting_events(id,meeting_id,actor_user_id,event_type,metadata) VALUES($1,$2,$3,$4,'{}'::jsonb)",
          [makeId('mte'),meetingId,u.id,action==='register'?'REGISTERED':'UNREGISTERED']
        );
        await client.query('COMMIT');
      }catch(error){
        try{await client.query('ROLLBACK');}catch{}
        throw error;
      }finally{client.release();}
      await audit(session,action==='register'?'MEETING_REGISTERED':'MEETING_UNREGISTERED','meeting',meetingId,null,{});
      const view=(await listMeetingsForUser(u)).find((item)=>item.id===meetingId)||null;
      return json(request,{ok:true,meeting:view});
    }

    if(!meetingCanManage(u,meeting))return json(request,{error:'MEETING_MANAGE_FORBIDDEN',message:'Nie możesz zarządzać tym spotkaniem.'},403);
    const target=getMeetingTransition(meeting.status,action);
    if(!target)return json(request,{error:'MEETING_STATE',message:'Ta zmiana etapu spotkania nie jest teraz dostępna.'},409);
    if(action==='start'){
      const client=livekitRooms();
      const room=meetingRoomName(meetingId);
      const existing=await client.listRooms([room]);
      if(!existing.length)await client.createRoom({name:room,maxParticipants:Number(meeting.max_participants||50),emptyTimeout:15*60,departureTimeout:5*60,metadata:JSON.stringify({meetingId})});
    }
    const result=await q(
      "UPDATE meetings SET status=$2,started_at=CASE WHEN $2='LIVE' THEN COALESCE(started_at,now()) ELSE started_at END,ended_at=CASE WHEN $2='ENDED' THEN now() ELSE ended_at END,cancelled_at=CASE WHEN $2='CANCELLED' THEN now() ELSE cancelled_at END,updated_at=now() WHERE id=$1 AND status=$3 RETURNING *",
      [meetingId,target,meeting.status]
    );
    if(!result.rows[0])return json(request,{error:'MEETING_STATE_CHANGED',message:'Stan spotkania zmienił się w międzyczasie.'},409);
    if((target==='ENDED'||target==='CANCELLED')&&livekitConfigured()){
      await livekitRooms().deleteRoom(meetingRoomName(meetingId)).catch(()=>undefined);
    }
    await meetingEvent(meetingId,u.id,target,{});
    if(target==='ENDED'||target==='CANCELLED'){
      await q("UPDATE meeting_attendance SET total_seconds=total_seconds+GREATEST(0,LEAST(43200,EXTRACT(EPOCH FROM (now()-last_joined_at))::int)),last_left_at=now(),updated_at=now() WHERE meeting_id=$1 AND last_joined_at IS NOT NULL AND (last_left_at IS NULL OR last_left_at<last_joined_at)",[meetingId]);
    }
    if(target==='CANCELLED'){
      const cancellationQueue=await queueMeetingEmailEvent(meetingId,'CANCELLED');
      await meetingEvent(meetingId,u.id,'EMAIL_CANCELLATION_QUEUED',cancellationQueue);
    }
    await audit(session,'MEETING_'+target,'meeting',meetingId,null,{});
    const view=(await listMeetingsForUser(u)).find((item)=>item.id===meetingId)||null;
    return json(request,{ok:true,meeting:view});
  }

  if(method==='GET'&&url.pathname==='/dashboard'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code==='USER')return json(request,{pointCount:0,activeUsers:0,pendingUsers:0,approvedRevenue:0,pendingRevenue:0,bossShare:0,technicianShare:0});
    const ids=await visiblePointIds(u);
    const revenue=(await q("SELECT amount,status,user_id,technician_percent FROM revenue_entries WHERE point_id=ANY($1::text[])",[ids])).rows;
    const users=(await q("SELECT COUNT(DISTINCT u.id)::int AS count FROM users u LEFT JOIN user_point_access a ON a.user_id=u.id WHERE u.status='ACTIVE' AND u.role_code IS DISTINCT FROM 'OWNER' AND ($2::boolean OR a.point_id=ANY($1::text[]))",[ids,GLOBAL_ROLES.has(u.role_code)])).rows[0].count;
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

  if(method==='GET'&&url.pathname==='/service/orders/search'){
    const session=await requireActive(request);
    if(!SERVICE_READ_ROLES.has(session.user.role_code)) throw Object.assign(new Error('Brak uprawnień do wyszukiwania zleceń.'),{status:403});
    return json(request,await searchVisibleOrders(session.user,url.searchParams.get('q')||''));
  }

  if(method==='GET'&&url.pathname==='/service/orders'){
    const session=await requireActive(request);
    if(!SERVICE_READ_ROLES.has(session.user.role_code)) throw Object.assign(new Error('Brak uprawnień do zleceń.'),{status:403});
    const rawLimit=Number(url.searchParams.get('limit')||40),rawOffset=Number(url.searchParams.get('offset')||0);
    const limit=Number.isFinite(rawLimit)?Math.max(1,Math.min(Math.trunc(rawLimit),60)):40;
    const offset=Number.isFinite(rawOffset)?Math.max(0,Math.min(Math.trunc(rawOffset),5000)):0;
    return json(request,await listVisibleOrders(session.user,{limit,offset}));
  }

  if(method==='GET'&&url.pathname==='/service/technician-workspace'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code!=='TECHNICIAN')throw Object.assign(new Error('Ten widok jest przeznaczony dla serwisanta.'),{status:403,code:'TECHNICIAN_ONLY'});
    const all=await listVisibleOrders(u);
    const orders=all.filter((order)=>order.assignedTechnicianId===u.id&&!CLOSED_ORDER_STATUSES.has(order.status));
    const counts={
      active:orders.length,
      received:orders.filter((order)=>order.status==='RECEIVED').length,
      diagnosis:orders.filter((order)=>order.status==='DIAGNOSIS').length,
      waitingParts:orders.filter((order)=>order.status==='WAITING_PARTS').length,
      inRepair:orders.filter((order)=>order.status==='IN_REPAIR').length,
      readyForPickup:orders.filter((order)=>['REPAIR_DONE','READY'].includes(order.status)).length,
      overdue:orders.filter((order)=>order.workflow?.flags?.includes('OVERDUE')).length
    };
    return json(request,{technician:{id:u.id,name:u.name,email:u.email},counts,orders,generatedAt:nowIso()});
  }

  if((method==='GET'||method==='POST')&&url.pathname==='/service/technician-notes'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code!=='TECHNICIAN')throw Object.assign(new Error('Prywatny pokój notatek jest dostępny dla serwisanta.'),{status:403,code:'TECHNICIAN_ONLY'});
    if(method==='GET'){
      const {rows}=await q('SELECT id,title,body,pinned,created_at,updated_at FROM technician_private_notes WHERE user_id=$1 ORDER BY pinned DESC,updated_at DESC LIMIT 200',[u.id]);
      return json(request,rows.map((row)=>({id:row.id,title:row.title||'',body:row.body,pinned:row.pinned===true,createdAt:row.created_at,updatedAt:row.updated_at})));
    }
    const body=await readJson(request);
    const title=cleanText(body.title,120),note=cleanText(body.body,4000),pinned=body.pinned===true;
    if(!note)return json(request,{error:'NOTE_REQUIRED',message:'Notatka nie może być pusta.'},400);
    const id=makeId('tnn');
    await q('INSERT INTO technician_private_notes(id,user_id,title,body,pinned) VALUES($1,$2,NULLIF($3,\'\'),$4,$5)',[id,u.id,title,note,pinned]);
    await audit(session,'TECHNICIAN_PRIVATE_NOTE_CREATED','technician_note',id,null,{pinned,length:note.length});
    return json(request,{id,title,body:note,pinned,createdAt:nowIso(),updatedAt:nowIso()},201);
  }

  const technicianNoteUpdateMatch=url.pathname.match(/^\/service\/technician-notes\/([^/]+)$/);
  if(method==='POST'&&technicianNoteUpdateMatch){
    const session=await requireActive(request),u=session.user;
    if(u.role_code!=='TECHNICIAN')throw Object.assign(new Error('Prywatny pokój notatek jest dostępny dla serwisanta.'),{status:403,code:'TECHNICIAN_ONLY'});
    const body=await readJson(request);
    const title=cleanText(body.title,120),note=cleanText(body.body,4000),pinned=body.pinned===true;
    if(!note)return json(request,{error:'NOTE_REQUIRED',message:'Notatka nie może być pusta.'},400);
    const updated=(await q("UPDATE technician_private_notes SET title=NULLIF($3,''),body=$4,pinned=$5,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id,title,body,pinned,created_at,updated_at",[technicianNoteUpdateMatch[1],u.id,title,note,pinned])).rows[0];
    if(!updated)return json(request,{error:'NOT_FOUND'},404);
    await audit(session,'TECHNICIAN_PRIVATE_NOTE_UPDATED','technician_note',updated.id,null,{pinned,length:note.length});
    return json(request,{id:updated.id,title:updated.title||'',body:updated.body,pinned:updated.pinned===true,createdAt:updated.created_at,updatedAt:updated.updated_at});
  }

  const technicianNoteDeleteMatch=url.pathname.match(/^\/service\/technician-notes\/([^/]+)$/);
  if(method==='DELETE'&&technicianNoteDeleteMatch){
    const session=await requireActive(request),u=session.user;
    if(u.role_code!=='TECHNICIAN')throw Object.assign(new Error('Prywatny pokój notatek jest dostępny dla serwisanta.'),{status:403,code:'TECHNICIAN_ONLY'});
    const result=await q('DELETE FROM technician_private_notes WHERE id=$1 AND user_id=$2',[technicianNoteDeleteMatch[1],u.id]);
    if(!result.rowCount)return json(request,{error:'NOT_FOUND'},404);
    await audit(session,'TECHNICIAN_PRIVATE_NOTE_DELETED','technician_note',technicianNoteDeleteMatch[1],null,{});
    return json(request,{ok:true});
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


  const serviceCardMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/service-card$/);
  if(method==='POST'&&serviceCardMatch){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    if(!SERVICE_TRANSFER_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do karty serwisowej.'),{status:403,code:'SERVICE_CARD_FORBIDDEN'});
    const order=(await q('SELECT id,point_id,home_point_id,current_point_id FROM service_orders WHERE id=$1 LIMIT 1',[serviceCardMatch[1]])).rows[0];
    if(!order)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,order.id);
    const activePointId=order.current_point_id||order.home_point_id||order.point_id;
    await requirePoint(u,activePointId);
    const printMode=String(body.printMode||'').toUpperCase();
    if(!['PHYSICAL_AND_ONLINE','ONLINE_ONLY'].includes(printMode)){
      return json(request,{error:'SERVICE_CARD_MODE',message:'Wybierz kartę fizyczną albo online.'},400);
    }
    await ensureServiceCardIdentity(order.id);
    const variant=printMode==='PHYSICAL_AND_ONLINE'?'PHYSICAL':'DEVICE';
    const card=await renderServiceCardPdf(order.id,variant);
    await q(
      "UPDATE service_order_cards SET print_mode=$2,last_printed_at=now(),print_count=print_count+1,updated_at=now() WHERE service_order_id=$1",
      [order.id,printMode]
    );
    await audit(session,'SERVICE_CARD_PRINTED','service_order',order.id,activePointId,{printMode,variant});
    return json(request,{
      orderId:order.id,
      orderNumber:card.context.orderNumber,
      printMode,
      variant,
      fileName:card.fileName,
      mimeType:'application/pdf',
      pdfBase64:card.buffer.toString('base64'),
      staffScanCode:card.context.staffScanCode
    });
  }

  if(method==='POST'&&url.pathname==='/service/scan'){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    if(!SERVICE_TRANSFER_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do skanowania urządzeń.'),{status:403,code:'SERVICE_SCAN_FORBIDDEN'});
    const actingPointId=session.activePointId;
    if(!actingPointId)return json(request,{error:'ACTIVE_POINT_REQUIRED',message:'Wybierz aktywny punkt przed skanowaniem.'},400);
    await requirePoint(u,actingPointId);

    const token=cleanText(body.token,100);
    const code=normalizeServiceScanCode(body.code);
    if(!token&&!code)return json(request,{error:'SCAN_CODE_REQUIRED',message:'Zeskanuj QR albo wpisz kod z karty urządzenia.'},400);
    const tokenDigest=token?tokenHash(token):'';
    const codeDigest=code?tokenHash(code):'';
    const cardRow=(await q(
      "SELECT c.service_order_id FROM service_order_cards c WHERE ($1<>'' AND c.staff_scan_token_hash=$1) OR ($2<>'' AND c.staff_scan_code_hash=$2) LIMIT 1",
      [tokenDigest,codeDigest]
    )).rows[0];
    if(!cardRow)return json(request,{error:'SERVICE_SCAN_NOT_FOUND',message:'Nie znaleziono urządzenia dla tego kodu.'},404);

    const client=await pool.connect();
    let scanAction='OPEN_ORDER';
    let acceptedTransfer=null;
    let readyChanged=false;
    let pointForAudit=actingPointId;
    try{
      await client.query('BEGIN');
      const order=(await client.query(
        "SELECT id,order_number,point_id,home_point_id,current_point_id,status,handling_mode,assigned_technician_id,customer_id,warranty_months,warranty_expires_at,warranty_card_printed_at FROM service_orders WHERE id=$1 FOR UPDATE",
        [cardRow.service_order_id]
      )).rows[0];
      if(!order)throw Object.assign(new Error('Nie znaleziono zlecenia.'),{status:404,code:'NOT_FOUND'});
      const homePointId=order.home_point_id||order.point_id;
      const transfer=(await client.query(
        "SELECT * FROM service_order_transfers WHERE service_order_id=$1 AND status IN ('REQUESTED','IN_TRANSIT','DELIVERED') ORDER BY requested_at DESC LIMIT 1 FOR UPDATE",
        [order.id]
      )).rows[0]||null;

      if(transfer){
        if(transfer.to_point_id!==actingPointId){
          throw Object.assign(new Error('Ta przesyłka jest skierowana do innego punktu.'),{status:409,code:'WRONG_SCAN_POINT'});
        }
        acceptedTransfer=(await client.query(
          "UPDATE service_order_transfers SET status='ACCEPTED',accepted_by_user_id=$2,shipped_at=COALESCE(shipped_at,now()),delivered_at=COALESCE(delivered_at,now()),accepted_at=now(),updated_at=now() WHERE id=$1 AND status IN ('REQUESTED','IN_TRANSIT','DELIVERED') RETURNING *",
          [transfer.id,u.id]
        )).rows[0];
        if(!acceptedTransfer)throw Object.assign(new Error('Przekazanie zmieniło się w międzyczasie. Zeskanuj ponownie.'),{status:409,code:'TRANSFER_STATUS_CHANGED'});

        const assignTechnician=transfer.kind==='OUTBOUND_SERVICE'&&u.role_code==='TECHNICIAN'&&order.handling_mode!=='TRANSFER_ONLY';
        const warrantyReady=Boolean(order.warranty_months&&order.warranty_expires_at&&order.warranty_card_printed_at);
        const shouldReady=transfer.kind==='RETURN_HOME'&&actingPointId===homePointId&&order.status==='REPAIR_DONE'&&warrantyReady;
        await client.query(
          "UPDATE service_orders SET current_point_id=$2,assigned_technician_id=CASE WHEN $3::boolean THEN $4 ELSE assigned_technician_id END,status=CASE WHEN $5::boolean THEN 'READY' ELSE status END,updated_at=now() WHERE id=$1",
          [order.id,actingPointId,assignTechnician,u.id,shouldReady]
        );
        if(shouldReady){
          readyChanged=true;
          await client.query(
            "INSERT INTO service_order_status_history(id,service_order_id,from_status,to_status,note,changed_by_user_id) VALUES($1,$2,'REPAIR_DONE','READY',$3,$4)",
            [makeId('hst'),order.id,'Automatyczne przyjęcie zwrotu skanem karty urządzenia.',u.id]
          );
        }
        scanAction=transfer.kind==='RETURN_HOME'
          ? (shouldReady?'RETURN_ACCEPTED_READY':(order.status==='REPAIR_DONE'&&!warrantyReady?'RETURN_ACCEPTED_WARRANTY_REQUIRED':'RETURN_ACCEPTED'))
          : 'SERVICE_ACCEPTED';
      }else{
        const currentPointId=order.current_point_id||homePointId;
        if(currentPointId!==actingPointId){
          throw Object.assign(new Error('Urządzenie nie ma aktywnego przekazania do tego punktu. Najpierw utwórz transport w ServiceOS.'),{status:409,code:'TRANSFER_REQUIRED'});
        }
        scanAction='ALREADY_AT_POINT';
      }

      await client.query(
        "UPDATE service_order_cards SET last_scanned_at=now(),last_scanned_by_user_id=$2,last_scan_point_id=$3,updated_at=now() WHERE service_order_id=$1",
        [order.id,u.id,actingPointId]
      );
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>undefined);
      throw error;
    }finally{client.release();}

    let notification={queued:false,sent:false,reason:'NOT_REQUIRED'};
    if(acceptedTransfer&&!(acceptedTransfer.kind==='RETURN_HOME'&&readyChanged)){
      notification=await queueTransferNotification(u,cardRow.service_order_id,acceptedTransfer,'ACCEPTED','Przyjęto urządzenie skanem karty serwisowej.');
    }
    if(readyChanged){
      try{
        const customer=(await q("SELECT s.customer_id,c.email FROM service_orders s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1 LIMIT 1",[cardRow.service_order_id])).rows[0];
        if(customer?.email){
          const prefs=await customerNotificationPreferences(customer.customer_id);
          const settings=await mailSettingsForPoint(actingPointId);
          if(prefs.readyForPickup!==false&&settings.automatic_email_enabled===true&&Array.isArray(settings.notify_statuses)&&settings.notify_statuses.includes('READY')){
            const nid=makeId('ntf');
            await q(
              "INSERT INTO notification_outbox(id,user_id,customer_id,service_order_id,channel,template_key,recipient,payload,status) VALUES($1,$2,$3,$4,'EMAIL','SERVICE_STATUS_CHANGED',$5,$6::jsonb,'PENDING')",
              [nid,u.id,customer.customer_id,cardRow.service_order_id,customer.email,JSON.stringify({from:'REPAIR_DONE',to:'READY',note:'Przyjęto zwrot skanem.'})]
            );
            notification={queued:true,...(await processNotification(nid))};
          }
        }
      }catch(error){console.error('[scan ready notification]',error);}
    }
    await audit(session,'SERVICE_CARD_SCANNED','service_order',cardRow.service_order_id,pointForAudit,{scanAction,readyChanged,transferId:acceptedTransfer?.id||null});
    const view=(await listVisibleOrders(u)).find((item)=>item.id===cardRow.service_order_id)||null;
    return json(request,{ok:true,scanAction,readyChanged,order:view,notification});
  }

  const historyMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/history$/);
  if(method==='GET'&&historyMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_READ_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do historii zlecenia.'),{status:403});
    const order=(await q('SELECT id,point_id FROM service_orders WHERE id=$1 LIMIT 1',[historyMatch[1]])).rows[0];
    if(!order)return json(request,{error:'NOT_FOUND'},404);
    await requireReadableOrder(u,order.id);
    const {rows}=await q(
      "SELECT h.id,h.from_status,h.to_status,h.note,h.created_at,h.changed_by_user_id,usr.name AS changed_by_name,usr.email AS changed_by_email,usr.role_code AS changed_by_role FROM service_order_status_history h LEFT JOIN users usr ON usr.id=h.changed_by_user_id WHERE h.service_order_id=$1 ORDER BY h.created_at ASC,h.id ASC",
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
      changedByName:operationalIdentityName(row.changed_by_name,row.changed_by_email,row.changed_by_role)||'System'
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
        'SELECT n.id,n.body,n.created_at,n.author_user_id,usr.name AS author_name,usr.email AS author_email,usr.role_code AS author_role FROM service_order_notes n JOIN users usr ON usr.id=n.author_user_id WHERE n.service_order_id=$1 ORDER BY n.created_at DESC,n.id DESC',
        [order.id]
      );
      return json(request,rows.map((row)=>({
        id:row.id,
        body:row.body,
        createdAt:row.created_at,
        authorUserId:row.author_user_id,
        authorName:operationalIdentityName(row.author_name,row.author_email,row.author_role)
      })));
    }

    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do dodawania notatek.'),{status:403});
    const body=await readJson(request),note=cleanText(body.body,2000);
    if(!note)return json(request,{error:'NOTE_REQUIRED',message:'Notatka nie może być pusta.'},400);
    const id=makeId('not');
    await q('INSERT INTO service_order_notes(id,service_order_id,author_user_id,body) VALUES($1,$2,$3,$4)',[id,order.id,u.id,note]);
    await audit(session,'SERVICE_NOTE_ADDED','service_order',order.id,order.point_id,{length:note.length});
    return json(request,{id,body:note,createdAt:nowIso(),authorUserId:u.id,authorName:operationalIdentityName(u.name,u.email,u.role_code)},201);
  }


  const costingMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/costing$/);
  if(costingMatch&&(method==='GET'||method==='POST')){
    const session=await requireActive(request),u=session.user;
    if(method==='GET')return json(request,await loadOrderCosting(u,costingMatch[1]));

    const order=await requireServiceFinanceOrder(u,costingMatch[1]);
    const body=await readJson(request);
    const laborRaw=body.laborCostGross;
    const otherRaw=body.otherCostGross;
    const laborCostGross=laborRaw==null||laborRaw===''?0:Number(laborRaw);
    const otherCostGross=otherRaw==null||otherRaw===''?0:Number(otherRaw);
    if(!Number.isFinite(laborCostGross)||laborCostGross<0||laborCostGross>10_000_000)return json(request,{error:'LABOR_COST',message:'Nieprawidłowa kwota robocizny.'},400);
    if(!Number.isFinite(otherCostGross)||otherCostGross<0||otherCostGross>10_000_000)return json(request,{error:'OTHER_COST',message:'Nieprawidłowa kwota innych kosztów.'},400);
    const inputParts=Array.isArray(body.parts)?body.parts:[];
    if(inputParts.length>100)return json(request,{error:'PARTS_LIMIT',message:'Jedno zlecenie może mieć maksymalnie 100 pozycji części.'},400);
    const parts=[];
    for(const raw of inputParts){
      const description=cleanText(raw?.description,240);
      const quantity=Number(raw?.quantity);
      const unitCostGross=Number(raw?.unitCostGross);
      const invoiceReceived=raw?.invoiceReceived===true;
      const invoiceNumber=invoiceReceived?cleanText(raw?.invoiceNumber,120):'';
      const supplier=invoiceReceived?cleanText(raw?.supplier,180):'';
      const purchasedAt=invoiceReceived?cleanText(raw?.purchasedAt,10):'';
      if(!description)return json(request,{error:'PART_DESCRIPTION',message:'Każda część musi mieć opis.'},400);
      if(!Number.isFinite(quantity)||quantity<=0||quantity>9999)return json(request,{error:'PART_QUANTITY',message:'Nieprawidłowa ilość części.'},400);
      if(!Number.isFinite(unitCostGross)||unitCostGross<0||unitCostGross>10_000_000)return json(request,{error:'PART_COST',message:'Nieprawidłowy koszt części.'},400);
      if(purchasedAt&&!/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt))return json(request,{error:'PURCHASE_DATE',message:'Nieprawidłowa data zakupu części.'},400);
      parts.push({description,quantity:Math.round(quantity*100)/100,unitCostGross:roundMoney(unitCostGross),invoiceReceived,invoiceNumber,supplier,purchasedAt});
    }
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT id FROM service_orders WHERE id=$1 FOR UPDATE',[order.id]);
      await client.query('UPDATE service_orders SET labor_cost_gross=$1,other_cost_gross=$2,updated_at=now() WHERE id=$3',[roundMoney(laborCostGross),roundMoney(otherCostGross),order.id]);
      await client.query('DELETE FROM service_order_parts WHERE service_order_id=$1',[order.id]);
      for(const part of parts){
        await client.query(
          'INSERT INTO service_order_parts(id,service_order_id,description,quantity,unit_cost_gross,invoice_received,invoice_number,supplier,purchased_at,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,\'\'),NULLIF($8,\'\'),$9,$10)',
          [makeId('prt'),order.id,part.description,part.quantity,part.unitCostGross,part.invoiceReceived,part.invoiceNumber,part.supplier,part.purchasedAt||null,u.id]
        );
      }
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>undefined);
      throw error;
    }finally{client.release();}
    const partsTotal=roundMoney(parts.reduce((sum,part)=>sum+part.quantity*part.unitCostGross,0));
    await audit(session,'SERVICE_COSTING_UPDATED','service_order',order.id,order.point_id,{
      partsCount:parts.length,partsCostGross:partsTotal,laborCostGross:roundMoney(laborCostGross),otherCostGross:roundMoney(otherCostGross)
    });
    return json(request,await loadOrderCosting(u,order.id));
  }

  const invoiceUploadMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/invoices\/upload-intent$/);
  if(method==='POST'&&invoiceUploadMatch){
    const session=await requireActive(request),u=session.user;
    const order=await requireServiceFinanceOrder(u,invoiceUploadMatch[1]);
    const storage=requireInvoiceStorage();
    const body=await readJson(request);
    const sizeBytes=Number(body.sizeBytes);
    const sha256=String(body.sha256||'').trim().toLowerCase();
    const fileName=safePdfFileName(body.fileName);
    const invoiceNumber=cleanText(body.invoiceNumber,120);
    const supplier=cleanText(body.supplier,180);
    const invoiceDate=cleanText(body.invoiceDate,10);
    const grossAmount=body.grossAmount==null||body.grossAmount===''?null:nullableMoney(body.grossAmount);
    if(!Number.isInteger(sizeBytes)||sizeBytes<=0||sizeBytes>SERVICE_INVOICE_MAX_BYTES)return json(request,{error:'PDF_SIZE',message:'Faktura PDF może mieć maksymalnie 20 MB.'},400);
    if(!/^[a-f0-9]{64}$/.test(sha256))return json(request,{error:'PDF_HASH',message:'Nieprawidłowy skrót pliku PDF.'},400);
    if(invoiceDate&&!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate))return json(request,{error:'INVOICE_DATE',message:'Nieprawidłowa data faktury.'},400);
    if(body.grossAmount!==null&&body.grossAmount!==undefined&&body.grossAmount!==''&&grossAmount===null)return json(request,{error:'INVOICE_AMOUNT',message:'Nieprawidłowa kwota faktury.'},400);
    const id=makeId('inv');
    const period=invoiceDate?invoiceDate.slice(0,7):nowIso().slice(0,7);
    const objectKey='service-orders/'+period+'/'+order.id+'/'+id+'.pdf';
    await q(
      "INSERT INTO service_order_invoices(id,service_order_id,uploaded_by_user_id,object_key,file_name,content_type,size_bytes,sha256,invoice_number,supplier,invoice_date,gross_amount,status) VALUES($1,$2,$3,$4,$5,'application/pdf',$6,$7,NULLIF($8,''),NULLIF($9,''),$10,$11,'UPLOADING')",
      [id,order.id,u.id,objectKey,fileName,sizeBytes,sha256,invoiceNumber,supplier,invoiceDate||null,grossAmount]
    );
    const uploadUrl=await getSignedUrl(storage,new PutObjectCommand({
      Bucket:SERVICE_INVOICE_BUCKET,
      Key:objectKey,
      ContentType:'application/pdf',
      Metadata:{sha256}
    }),{expiresIn:SERVICE_INVOICE_URL_TTL_SECONDS});
    await audit(session,'SERVICE_INVOICE_UPLOAD_STARTED','service_order_invoice',id,order.point_id,{orderId:order.id,sizeBytes,invoiceNumber:invoiceNumber||null});
    return json(request,{invoiceId:id,uploadUrl,expiresInSeconds:SERVICE_INVOICE_URL_TTL_SECONDS,requiredHeaders:{'content-type':'application/pdf','x-amz-meta-sha256':sha256}});
  }

  const invoiceCompleteMatch=url.pathname.match(/^\/service\/invoices\/([^/]+)\/complete$/);
  if(method==='POST'&&invoiceCompleteMatch){
    const session=await requireActive(request),u=session.user;
    const invoice=(await q("SELECT i.*,s.point_id FROM service_order_invoices i JOIN service_orders s ON s.id=i.service_order_id WHERE i.id=$1 AND i.status='UPLOADING' LIMIT 1",[invoiceCompleteMatch[1]])).rows[0];
    if(!invoice)return json(request,{error:'NOT_FOUND'},404);
    await requireServiceFinanceOrder(u,invoice.service_order_id);
    const storage=requireInvoiceStorage();
    let head;
    try{head=await storage.send(new HeadObjectCommand({Bucket:SERVICE_INVOICE_BUCKET,Key:invoice.object_key}));}
    catch{return json(request,{error:'PDF_NOT_UPLOADED',message:'Nie znaleziono przesłanego pliku PDF. Spróbuj dodać fakturę ponownie.'},409);}
    const remoteSize=Number(head.ContentLength||0);
    const remoteHash=String(head.Metadata?.sha256||'').toLowerCase();
    const remoteType=String(head.ContentType||'').split(';')[0].trim().toLowerCase();
    let magic='';
    try{
      const prefix=await storage.send(new GetObjectCommand({Bucket:SERVICE_INVOICE_BUCKET,Key:invoice.object_key,Range:'bytes=0-4'}));
      const bytes=await prefix.Body?.transformToByteArray();
      magic=bytes?Buffer.from(bytes).toString('ascii'):'';
    }catch{}
    if(remoteSize!==Number(invoice.size_bytes)||remoteHash!==String(invoice.sha256).toLowerCase()||remoteType!=='application/pdf'||magic!=='%PDF-'){
      return json(request,{error:'PDF_VERIFY_FAILED',message:'Przesłany plik nie przeszedł weryfikacji PDF i integralności.'},409);
    }
    await q("UPDATE service_order_invoices SET status='READY',ready_at=now() WHERE id=$1 AND status='UPLOADING'",[invoice.id]);
    await audit(session,'SERVICE_INVOICE_UPLOADED','service_order_invoice',invoice.id,invoice.point_id,{orderId:invoice.service_order_id,sizeBytes:remoteSize});
    const row=(await q("SELECT i.*,s.order_number,u.name AS uploaded_by_name,u.email AS uploaded_by_email,u.role_code AS uploaded_by_role FROM service_order_invoices i JOIN service_orders s ON s.id=i.service_order_id LEFT JOIN users u ON u.id=i.uploaded_by_user_id WHERE i.id=$1",[invoice.id])).rows[0];
    return json(request,serviceInvoiceView(row));
  }

  if(method==='GET'&&url.pathname==='/service/invoices'){
    const session=await requireActive(request),u=session.user;
    const period=cleanText(url.searchParams.get('month'),7)||nowIso().slice(0,7);
    const pointId=cleanText(url.searchParams.get('pointId'),80)||session.activePointId||'';
    return json(request,{period,pointId,invoices:await listAccessibleInvoices(u,period,pointId)});
  }

  if(method==='GET'&&url.pathname==='/service/invoices/monthly-prompt'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code!=='TECHNICIAN')return json(request,{show:false,period:null,count:0,dismissed:false});
    const period=monthlyInvoicePromptPeriod();
    if(!period)return json(request,{show:false,period:null,count:0,dismissed:false});
    const activePointId=session.activePointId||null;
    if(!activePointId)return json(request,{show:false,period,count:0,dismissed:false});
    const invoices=await listAccessibleInvoices(u,period,activePointId);
    const bounds=invoicePeriodBounds(period);
    const dismissed=(await q('SELECT 1 FROM invoice_monthly_prompt_dismissals WHERE user_id=$1 AND period_month=$2::date LIMIT 1',[u.id,bounds.start])).rowCount>0;
    return json(request,{show:invoices.length>0&&!dismissed,period,count:invoices.length,dismissed});
  }

  if(method==='POST'&&url.pathname==='/service/invoices/monthly-prompt/dismiss'){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    if(u.role_code!=='TECHNICIAN')throw Object.assign(new Error('Ten komunikat dotyczy serwisanta.'),{status:403,code:'TECHNICIAN_ONLY'});
    const bounds=invoicePeriodBounds(cleanText(body.period,7));
    if(!bounds)return json(request,{error:'INVOICE_PERIOD',message:'Nieprawidłowy miesiąc.'},400);
    await q('INSERT INTO invoice_monthly_prompt_dismissals(user_id,period_month,dismissed_at) VALUES($1,$2::date,now()) ON CONFLICT(user_id,period_month) DO UPDATE SET dismissed_at=now()',[u.id,bounds.start]);
    await audit(session,'INVOICE_MONTHLY_PROMPT_DISMISSED','invoice_period',bounds.period,null,{});
    return json(request,{ok:true,period:bounds.period});
  }

  if(method==='POST'&&url.pathname==='/service/invoices/download-batch'){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    const period=cleanText(body.period,7);
    const pointId=cleanText(body.pointId,80)||session.activePointId||'';
    const invoices=await listAccessibleInvoices(u,period,pointId);
    const storage=requireInvoiceStorage();
    const files=[];
    for(const invoice of invoices){
      const row=(await q("SELECT object_key FROM service_order_invoices WHERE id=$1 AND status='READY' LIMIT 1",[invoice.id])).rows[0];
      if(!row)continue;
      const url=await getSignedUrl(storage,new GetObjectCommand({
        Bucket:SERVICE_INVOICE_BUCKET,Key:row.object_key,
        ResponseContentType:'application/pdf',
        ResponseContentDisposition:'attachment; filename="'+safePdfFileName(invoice.fileName).replace(/"/g,'')+'"'
      }),{expiresIn:SERVICE_INVOICE_URL_TTL_SECONDS});
      files.push({...invoice,downloadUrl:url});
    }
    await audit(session,'SERVICE_INVOICE_BATCH_DOWNLOADED','invoice_period',period,pointId,{count:files.length,pointId});
    return json(request,{period,pointId,files,expiresInSeconds:SERVICE_INVOICE_URL_TTL_SECONDS});
  }

  const invoiceDownloadMatch=url.pathname.match(/^\/service\/invoices\/([^/]+)\/download-intent$/);
  if(method==='POST'&&invoiceDownloadMatch){
    const session=await requireActive(request),u=session.user;
    const invoice=(await q("SELECT i.*,s.point_id FROM service_order_invoices i JOIN service_orders s ON s.id=i.service_order_id WHERE i.id=$1 AND i.status='READY' LIMIT 1",[invoiceDownloadMatch[1]])).rows[0];
    if(!invoice)return json(request,{error:'NOT_FOUND'},404);
    await requireServiceFinanceOrder(u,invoice.service_order_id);
    const url=await getSignedUrl(requireInvoiceStorage(),new GetObjectCommand({
      Bucket:SERVICE_INVOICE_BUCKET,Key:invoice.object_key,
      ResponseContentType:'application/pdf',
      ResponseContentDisposition:'attachment; filename="'+safePdfFileName(invoice.file_name).replace(/"/g,'')+'"'
    }),{expiresIn:SERVICE_INVOICE_URL_TTL_SECONDS});
    await audit(session,'SERVICE_INVOICE_DOWNLOADED','service_order_invoice',invoice.id,invoice.point_id,{orderId:invoice.service_order_id});
    return json(request,{invoice:serviceInvoiceView(invoice),downloadUrl:url,expiresInSeconds:SERVICE_INVOICE_URL_TTL_SECONDS});
  }

  const invoiceDeleteMatch=url.pathname.match(/^\/service\/invoices\/([^/]+)$/);
  if(method==='DELETE'&&invoiceDeleteMatch){
    const session=await requireActive(request),u=session.user;
    const invoice=(await q("SELECT i.*,s.point_id FROM service_order_invoices i JOIN service_orders s ON s.id=i.service_order_id WHERE i.id=$1 AND i.status<>'DELETED' LIMIT 1",[invoiceDeleteMatch[1]])).rows[0];
    if(!invoice)return json(request,{error:'NOT_FOUND'},404);
    await requireServiceFinanceOrder(u,invoice.service_order_id);
    await q("UPDATE service_order_invoices SET status='DELETED',deleted_at=now() WHERE id=$1",[invoice.id]);
    try{await requireInvoiceStorage().send(new DeleteObjectCommand({Bucket:SERVICE_INVOICE_BUCKET,Key:invoice.object_key}));}catch(error){console.error('[invoice delete storage]',error);}
    await audit(session,'SERVICE_INVOICE_DELETED','service_order_invoice',invoice.id,invoice.point_id,{orderId:invoice.service_order_id});
    return json(request,{ok:true});
  }

  const planMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/plan$/);
  if(method==='POST'&&planMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do planu pracy.'),{status:403});
    const found=(await q("SELECT id,point_id,home_point_id,current_point_id,assigned_technician_id,estimated_completion_at,plan_position,status FROM service_orders WHERE id=$1 LIMIT 1",[planMatch[1]])).rows[0];
    if(!found)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,found.id);
    if(!found.assigned_technician_id)return json(request,{error:'TECHNICIAN_REQUIRED',message:'Zlecenie musi mieć przypisanego serwisanta, aby trafiło do planu pracy.'},409);
    if(u.role_code==='TECHNICIAN'&&found.assigned_technician_id!==u.id)throw Object.assign(new Error('Możesz układać tylko własny plan pracy.'),{status:403});
    if(['COMPLETED','CANCELLED','REJECTED'].includes(found.status))return json(request,{error:'ORDER_CLOSED',message:'Zamkniętego zlecenia nie można przesuwać w planie.'},409);
    const body=await readJson(request);
    const rawTarget=cleanText(body.estimatedCompletionAt,64);
    let targetDate=null;
    if(rawTarget){
      targetDate=new Date(rawTarget);
      if(Number.isNaN(targetDate.getTime()))return json(request,{error:'ETA',message:'Nieprawidłowy termin planu pracy.'},400);
    }
    const targetIndex=Math.max(0,Math.min(500,Number.isFinite(Number(body.targetIndex))?Math.trunc(Number(body.targetIndex)):500));
    const dayKey=(value)=>value?new Date(value).toISOString().slice(0,10):null;
    const sourceDay=dayKey(found.estimated_completion_at);
    const targetDay=dayKey(targetDate);
    const etaChanged=sourceDay!==targetDay;
    const warsawToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(sourceDay&&!targetDay){
      return json(request,{error:'ETA_CANNOT_REMOVE',message:'Zlecenie z ustalonym terminem może zostać tylko ułożone w tym samym dniu albo przesunięte na późniejszy termin.'},409);
    }
    if(sourceDay&&targetDay&&targetDay<sourceDay){
      return json(request,{error:'ETA_CANNOT_MOVE_BACK',message:'Nie można skrócić przewidywanego terminu w planie pracy. Możesz pozostawić ten sam dzień albo przesunąć zlecenie później.'},409);
    }
    if(!sourceDay&&targetDay&&targetDay<warsawToday){
      return json(request,{error:'ETA_IN_PAST',message:'Nie można zaplanować zlecenia w przeszłości.'},409);
    }

    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("UPDATE service_orders SET estimated_completion_at=$2,updated_at=now() WHERE id=$1",[found.id,targetDate]);

      if(targetDate){
        const targetRows=(await client.query(
          "SELECT id FROM service_orders WHERE assigned_technician_id=$1 AND estimated_completion_at::date=$2::date AND status NOT IN ('COMPLETED','CANCELLED','REJECTED') AND id<>$3 ORDER BY plan_position ASC,estimated_completion_at ASC,created_at ASC FOR UPDATE",
          [found.assigned_technician_id,targetDate,found.id]
        )).rows.map((row)=>row.id);
        targetRows.splice(Math.min(targetIndex,targetRows.length),0,found.id);
        for(let index=0;index<targetRows.length;index+=1){
          await client.query("UPDATE service_orders SET plan_position=$2 WHERE id=$1",[targetRows[index],(index+1)*10]);
        }
      }else{
        await client.query("UPDATE service_orders SET plan_position=0 WHERE id=$1",[found.id]);
      }

      if(sourceDay&&sourceDay!==targetDay){
        const sourceRows=(await client.query(
          "SELECT id FROM service_orders WHERE assigned_technician_id=$1 AND estimated_completion_at::date=$2::date AND status NOT IN ('COMPLETED','CANCELLED','REJECTED') AND id<>$3 ORDER BY plan_position ASC,estimated_completion_at ASC,created_at ASC FOR UPDATE",
          [found.assigned_technician_id,sourceDay,found.id]
        )).rows;
        for(let index=0;index<sourceRows.length;index+=1){
          await client.query("UPDATE service_orders SET plan_position=$2 WHERE id=$1",[sourceRows[index].id,(index+1)*10]);
        }
      }
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>undefined);
      throw error;
    }finally{client.release();}

    await audit(session,etaChanged?'SERVICE_PLAN_MOVED':'SERVICE_PLAN_REORDERED','service_order',found.id,found.point_id,{
      fromDate:sourceDay,toDate:targetDay,targetIndex
    });
    const notification=etaChanged
      ? await queueEtaChangedNotification(u,found.id,found.estimated_completion_at,targetDate)
      : {queued:false,sent:false,reason:'DATE_UNCHANGED'};
    const view=(await listVisibleOrders(u)).find((order)=>order.id===found.id)||null;
    return json(request,{order:view,notification});
  }

  const detailsMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/details$/);
  if(method==='POST'&&detailsMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_INTAKE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do edycji danych przyjęcia.'),{status:403});
    const found=(await q('SELECT id,point_id,home_point_id,current_point_id,handling_mode,device_id,assigned_technician_id,estimated_cost,final_cost,estimated_completion_at FROM service_orders WHERE id=$1 LIMIT 1',[detailsMatch[1]])).rows[0];
    const previousEstimatedCompletionAt=found?.estimated_completion_at||null;
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
    const deviceNotes=cleanText(body.deviceNotes,1000)||'Brak uwag';
    if(imei&&!/^\d{14,16}$/.test(imei))return json(request,{error:'IMEI',message:'IMEI powinien zawierać 14–16 cyfr.'},400);

    if(imei){
      const conflict=(await q('SELECT id FROM devices WHERE imei=$1 AND id<>$2 LIMIT 1',[imei,found.device_id])).rows[0];
      if(conflict)return json(request,{error:'IMEI_CONFLICT',message:'Ten IMEI jest już przypisany do innego urządzenia.'},409);
    }

    const canEditEta=SERVICE_INTAKE_EDIT_ROLES.has(u.role_code);
    let estimatedCompletionAt=found.estimated_completion_at;
    if(canEditEta&&found.handling_mode!=='TRANSFER_ONLY'&&('estimatedCompletionAt' in body)){
      const etaText=cleanText(body.estimatedCompletionAt,64);
      if(!etaText){
        estimatedCompletionAt=null;
      }else{
        const date=new Date(etaText);
        if(Number.isNaN(date.getTime()))return json(request,{error:'ETA',message:'Nieprawidłowy przewidywany termin.'},400);
        estimatedCompletionAt=date;
      }
    }

    const canManageAssignment=SERVICE_MANAGE_ROLES.has(u.role_code);
    const canEditCosts=SERVICE_EDIT_ROLES.has(u.role_code);
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
      await client.query('UPDATE devices SET imei=NULLIF($1,\'\'),serial_number=NULLIF($2,\'\'),notes=$3,updated_at=now() WHERE id=$4',[imei,serialNumber,deviceNotes,found.device_id]);
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
    const previousEtaDay=previousEstimatedCompletionAt?new Date(previousEstimatedCompletionAt).toISOString().slice(0,10):null;
    const nextEtaDay=estimatedCompletionAt?new Date(estimatedCompletionAt).toISOString().slice(0,10):null;
    if(previousEtaDay!==nextEtaDay){
      await queueEtaChangedNotification(u,found.id,previousEstimatedCompletionAt,estimatedCompletionAt);
    }
    const view=(await listVisibleOrders(u)).find((order)=>order.id===found.id);
    return json(request,view);
  }

  if(method==='POST'&&url.pathname==='/service/orders'){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    if(!SERVICE_CREATE_ROLES.has(u.role_code)) throw Object.assign(new Error('Brak uprawnień do tworzenia zleceń.'),{status:403});
    const pointId=session.activePointId;
    if(!pointId)return json(request,{error:'ACTIVE_POINT_REQUIRED',message:'Wybierz aktywny punkt przed przyjęciem urządzenia.'},400);
    await requirePoint(u,pointId);
    const firstName=cleanText(body.firstName,80),lastName=cleanText(body.lastName,100),email=normalizeEmail(cleanText(body.email,180)),phone=cleanText(body.phone,50),phoneNorm=normalizePhone(phone),brandInput=cleanText(body.brand,80),modelInput=cleanText(body.model,120),issue=cleanText(body.issueDescription,2000),orderType=String(body.orderType||'REPAIR').toUpperCase();
    const originalOrderId=orderType==='COMPLAINT'?cleanText(body.originalOrderId,120):'';
    const brand=brandInput||'Nie podano',model=modelInput||'Nie podano';
    const handlingMode=orderType==='COMPLAINT'?'COMPLAINT_FLOW':'STANDARD';
    const imei=cleanText(body.imei,32).replace(/\s+/g,''),serialNumber=cleanText(body.serialNumber,120),deviceNotes=cleanText(body.deviceNotes,1000)||'Brak uwag';
    const canSetIntakeEta=SERVICE_CREATE_ROLES.has(u.role_code);
    const etaProvided=Object.prototype.hasOwnProperty.call(body,'estimatedCompletionAt');
    const etaText=canSetIntakeEta?cleanText(body.estimatedCompletionAt,64):'';
    let estimatedCompletionAt=null;
    if(canSetIntakeEta&&!etaProvided){
      estimatedCompletionAt=new Date(Date.now()+3*24*60*60*1000);
    }else if(etaText){
      const eta=new Date(etaText);
      if(Number.isNaN(eta.getTime()))return json(request,{error:'ETA',message:'Nieprawidłowy przewidywany termin.'},400);
      estimatedCompletionAt=eta;
    }
    const assignedTechnicianId=u.role_code==='TECHNICIAN'?u.id:null;
    const canSetIntakeEstimate=SERVICE_CREATE_ROLES.has(u.role_code);
    let estimatedCost=null;
    if(canSetIntakeEstimate&&body.estimatedCost!==undefined&&body.estimatedCost!==''){
      estimatedCost=Number(body.estimatedCost);
      if(!Number.isFinite(estimatedCost)||estimatedCost<0)return json(request,{error:'ESTIMATED_COST',message:'Nieprawidłowy koszt szacowany.'},400);
    }
    if(body.assignedTechnicianId){
      return json(request,{error:'TECHNICIAN_AT_INTAKE',message:'Technika przypisuje się po utworzeniu zlecenia.'},400);
    }
    if(!firstName||!lastName||!issue||!['REPAIR','COMPLAINT'].includes(orderType))return json(request,{error:'VALIDATION',message:'Uzupełnij imię, nazwisko i opis usterki. Marka, model oraz uwagi są opcjonalne.'},400);
    if(orderType==='COMPLAINT'&&!originalOrderId)return json(request,{error:'COMPLAINT_ORIGINAL_REQUIRED',message:'Wybierz wcześniejsze zlecenie serwisowe, którego dotyczy reklamacja.'},400);
    let originalOrder=null;
    if(originalOrderId){
      await requireOrder(u,originalOrderId);
      originalOrder=(await q('SELECT id,customer_id,device_id FROM service_orders WHERE id=$1 LIMIT 1',[originalOrderId])).rows[0]||null;
      if(!originalOrder)return json(request,{error:'ORIGINAL_ORDER_NOT_FOUND',message:'Nie znaleziono wcześniejszego zlecenia.'},404);
    }
    if(!email||!phoneNorm)return json(request,{error:'CONTACT_REQUIRED',message:'Podaj adres e-mail i numer telefonu klienta. Karta serwisowa jest zawsze wysyłana e-mailem.'},400);
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(request,{error:'EMAIL',message:'Adres e-mail klienta jest nieprawidłowy.'},400);
    if(phone&&phoneNorm.length<7)return json(request,{error:'PHONE',message:'Numer telefonu klienta jest zbyt krótki.'},400);
    if(imei&&!/^\d{14,16}$/.test(imei))return json(request,{error:'IMEI',message:'IMEI powinien zawierać 14–16 cyfr.'},400);
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
        device=(await client.query("SELECT * FROM devices WHERE customer_id=$1 AND lower(serial_number)=lower($2) ORDER BY updated_at DESC LIMIT 1",[customer.id,serialNumber])).rows[0]||null;
      }
      let did='';
      if(device){
        reusedDevice=true;
        did=device.id;
        await client.query("UPDATE devices SET brand=COALESCE(NULLIF($1,''),brand),model=COALESCE(NULLIF($2,''),model),imei=COALESCE(NULLIF($3,''),imei),serial_number=COALESCE(NULLIF($4,''),serial_number),notes=$5,updated_at=now() WHERE id=$6",[brandInput,modelInput,imei,serialNumber,deviceNotes,did]);
      }else{
        did=makeId('dev');
        await client.query("INSERT INTO devices(id,customer_id,brand,model,imei,serial_number,notes) VALUES($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),NULLIF($7,''))",[did,customer.id,brand,model,imei,serialNumber,deviceNotes]);
      }
      if(originalOrder&&(originalOrder.customer_id!==customer.id||originalOrder.device_id!==did)){
        throw Object.assign(new Error('Wybrane wcześniejsze zlecenie nie pasuje do klienta lub urządzenia reklamacji.'),{status:409,code:'COMPLAINT_ORIGINAL_MISMATCH'});
      }
      const oid=makeId('srv');const order=(await client.query("INSERT INTO service_orders(id,point_id,home_point_id,current_point_id,customer_id,device_id,order_type,original_order_id,handling_mode,issue_description,status,assigned_technician_id,created_by_user_id,estimated_cost,estimated_completion_at) VALUES($1,$2,$2,$2,$3,$4,$5,NULLIF($6,''),$7,$8,'RECEIVED',$9,$10,$11,$12) RETURNING *",[oid,pointId,customer.id,did,orderType,originalOrderId,handlingMode,issue,handlingMode==='TRANSFER_ONLY'?null:assignedTechnicianId,u.id,handlingMode==='TRANSFER_ONLY'?null:estimatedCost,estimatedCompletionAt])).rows[0];
      await client.query("INSERT INTO service_order_status_history(id,service_order_id,from_status,to_status,changed_by_user_id) VALUES($1,$2,NULL,'RECEIVED',$3)",[makeId('hst'),oid,u.id]);
      await client.query('COMMIT');

      await ensureServiceCardIdentity(oid);
      let notification={queued:false,sent:false,reason:'NOT_CONFIGURED'};
      try{
        if(!customer.email){
          notification={queued:false,sent:false,reason:'NO_CUSTOMER_EMAIL'};
        }else{
          const nid=makeId('ntf');
          await q(
            "INSERT INTO notification_outbox(id,user_id,customer_id,service_order_id,channel,template_key,recipient,payload,status) VALUES($1,$2,$3,$4,'EMAIL','SERVICE_INTAKE_CARD',$5,$6::jsonb,'PENDING')",
            [nid,u.id,customer.id,oid,customer.email,JSON.stringify({from:null,to:'RECEIVED',note:null,mandatory:true})]
          );
          notification={queued:true,...(await processNotification(nid))};
        }
      }catch(notificationError){
        console.error('[intake service card notification]',notificationError);
        notification={queued:true,sent:false,reason:'NOTIFICATION_ERROR'};
      }

      try{
        await audit(session,'SERVICE_ORDER_CREATED','service_order',oid,pointId,{orderType,handlingMode,notification});
      }catch(auditError){
        console.error('[service order audit]',auditError);
      }
      return json(request,{customer:customerView(customer),order:{id:order.id,orderNumber:Number(order.order_number),pointId,customerId:customer.id,deviceId:did,orderType,originalOrderId:order.original_order_id||null,handlingMode,issueDescription:issue,status:'RECEIVED',assignedTechnicianId,estimatedCost:estimatedCost,estimatedCompletionAt:order.estimated_completion_at||null,receivedAt:order.received_at},reusedCustomer:reused,reusedDevice,notification,serviceCard:{required:true,printMode:null,customerEmailRequired:Boolean(customer.email)}},201);
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  const warrantyMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/warranty$/);
  if(method==='POST'&&warrantyMatch){
    const session=await requireActive(request),u=session.user,body=await readJson(request);
    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do gwarancji serwisowej.'),{status:403});
    const found=(await q("SELECT id,point_id,home_point_id,current_point_id,status,assigned_technician_id,repair_summary,warranty_months,warranty_started_at,warranty_expires_at,warranty_card_printed_at FROM service_orders WHERE id=$1 LIMIT 1",[warrantyMatch[1]])).rows[0];
    if(!found)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,found.id);
    const activePointId=found.current_point_id||found.home_point_id||found.point_id;
    if(!session.activePointId){
      return json(request,{error:'WARRANTY_ACTIVE_POINT_REQUIRED',message:'Wybierz aktywny punkt, w którym fizycznie znajduje się telefon, aby wystawić gwarancję.'},409);
    }
    if(session.activePointId!==activePointId){
      return json(request,{error:'WARRANTY_WRONG_ACTIVE_POINT',message:'Gwarancję można wystawić tylko w aktywnym punkcie, w którym fizycznie znajduje się telefon.'},409);
    }
    const openWarrantyTransfer=(await q("SELECT id FROM service_order_transfers WHERE service_order_id=$1 AND status IN ('REQUESTED','IN_TRANSIT','DELIVERED') ORDER BY requested_at DESC LIMIT 1",[found.id])).rows[0]||null;
    if(openWarrantyTransfer){
      return json(request,{error:'WARRANTY_DEVICE_IN_TRANSFER',message:'Nie można wystawić gwarancji podczas aktywnego przekazania urządzenia.'},409);
    }
    await requirePoint(u,activePointId);
    if(u.role_code==='TECHNICIAN'&&found.assigned_technician_id!==u.id){
      throw Object.assign(new Error('Gwarancję może ustawić serwisant przypisany do tego zlecenia.'),{status:403,code:'TECHNICIAN_ORDER_REQUIRED'});
    }
    if(found.status!=='REPAIR_DONE'){
      return json(request,{error:'REPAIR_DONE_REQUIRED',message:'Okres gwarancji ustaw po zakończeniu naprawy, przed oznaczeniem urządzenia jako gotowe do odbioru.'},409);
    }
    const months=Number(body.months);
    if(!Number.isInteger(months)||months<1||months>60){
      return json(request,{error:'WARRANTY_MONTHS',message:'Podaj okres gwarancji od 1 do 60 miesięcy.'},400);
    }
    const repairSummary=cleanText(body.repairSummary,2000);
    if(!repairSummary)return json(request,{error:'REPAIR_SUMMARY_REQUIRED',message:'Opisz wykonaną naprawę przed zapisaniem gwarancji.'},400);
    const repairDoneAt=(await q("SELECT created_at FROM service_order_status_history WHERE service_order_id=$1 AND to_status='REPAIR_DONE' ORDER BY created_at DESC LIMIT 1",[found.id])).rows[0]?.created_at||nowIso();
    const changed=Number(found.warranty_months||0)!==months||String(found.repair_summary||'')!==repairSummary;
    const row=(await q(
      "UPDATE service_orders SET repair_summary=$3,warranty_months=$2::integer,warranty_started_at=COALESCE(warranty_started_at,$4::timestamptz),warranty_expires_at=COALESCE(warranty_started_at,$4::timestamptz) + ($2::integer::text || ' months')::interval,warranty_card_printed_at=CASE WHEN $5::boolean THEN NULL ELSE warranty_card_printed_at END,updated_at=now() WHERE id=$1 RETURNING repair_summary,warranty_months,warranty_started_at,warranty_expires_at,warranty_card_printed_at,warranty_card_print_count",
      [found.id,months,repairSummary,repairDoneAt,changed]
    )).rows[0];
    await audit(session,'SERVICE_WARRANTY_SET','service_order',found.id,found.point_id,{months,repairSummaryLength:repairSummary.length,cardReprintRequired:changed});
    const view=(await listVisibleOrders(u)).find((order)=>order.id===found.id)||null;
    return json(request,{ok:true,warranty:{months:Number(row.warranty_months),startedAt:row.warranty_started_at,expiresAt:row.warranty_expires_at,cardPrintedAt:row.warranty_card_printed_at||null,cardPrintCount:Number(row.warranty_card_print_count||0),repairSummary:row.repair_summary,warrantyCardNumber:warrantyCardNumberFor(view?.orderNumber||0,row.warranty_started_at)},order:view});
  }

  const warrantyCardMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/warranty-card$/);
  if(method==='POST'&&warrantyCardMatch){
    const session=await requireActive(request),u=session.user;
    if(!SERVICE_EDIT_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do karty gwarancyjnej.'),{status:403});
    const found=(await q("SELECT id,point_id,home_point_id,current_point_id,status,assigned_technician_id,warranty_months,warranty_expires_at FROM service_orders WHERE id=$1 LIMIT 1",[warrantyCardMatch[1]])).rows[0];
    if(!found)return json(request,{error:'NOT_FOUND'},404);
    await requireOrder(u,found.id);
    const activePointId=found.current_point_id||found.home_point_id||found.point_id;
    if(!session.activePointId){
      return json(request,{error:'WARRANTY_ACTIVE_POINT_REQUIRED',message:'Wybierz aktywny punkt, w którym fizycznie znajduje się telefon, aby wystawić gwarancję.'},409);
    }
    if(session.activePointId!==activePointId){
      return json(request,{error:'WARRANTY_WRONG_ACTIVE_POINT',message:'Gwarancję można wystawić tylko w aktywnym punkcie, w którym fizycznie znajduje się telefon.'},409);
    }
    const openWarrantyTransfer=(await q("SELECT id FROM service_order_transfers WHERE service_order_id=$1 AND status IN ('REQUESTED','IN_TRANSIT','DELIVERED') ORDER BY requested_at DESC LIMIT 1",[found.id])).rows[0]||null;
    if(openWarrantyTransfer){
      return json(request,{error:'WARRANTY_DEVICE_IN_TRANSFER',message:'Nie można wystawić gwarancji podczas aktywnego przekazania urządzenia.'},409);
    }
    await requirePoint(u,activePointId);
    if(u.role_code==='TECHNICIAN'&&found.assigned_technician_id!==u.id){
      throw Object.assign(new Error('Kartę gwarancyjną może przygotować serwisant przypisany do tego zlecenia.'),{status:403,code:'TECHNICIAN_ORDER_REQUIRED'});
    }
    if(!found.warranty_months||!found.warranty_expires_at){
      return json(request,{error:'WARRANTY_REQUIRED',message:'Najpierw ustaw okres gwarancji.'},409);
    }
    if(!['REPAIR_DONE','READY'].includes(found.status)){
      return json(request,{error:'WARRANTY_STAGE',message:'Kartę gwarancyjną przygotuj po zakończeniu naprawy i przed wydaniem urządzenia.'},409);
    }
    const card=await renderWarrantyCardPdf(found.id);
    await q("UPDATE service_orders SET warranty_card_printed_at=now(),warranty_card_print_count=warranty_card_print_count+1,updated_at=now() WHERE id=$1",[found.id]);
    await audit(session,'SERVICE_WARRANTY_CARD_PRINTED','service_order',found.id,found.point_id,{months:Number(found.warranty_months)});
    const view=(await listVisibleOrders(u)).find((order)=>order.id===found.id)||null;
    return json(request,{ok:true,fileName:card.fileName,mimeType:'application/pdf',pdfBase64:card.buffer.toString('base64'),order:view});
  }

  const statusMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/status$/);
  if(method==='POST'&&statusMatch){
    const session=await requireActive(request),u=session.user;
    const body=await readJson(request),next=String(body.status||'').toUpperCase(),note=cleanText(body.note,500),actingPointId=session.activePointId;
    const canEditStatus=SERVICE_EDIT_ROLES.has(u.role_code);
    const canCancelOnly=u.role_code==='USER'&&next==='CANCELLED';
    const canCompletePickup=u.role_code==='USER'&&next==='COMPLETED';
    if(!canEditStatus&&!canCancelOnly&&!canCompletePickup)throw Object.assign(new Error('Brak uprawnień do zmiany statusu.'),{status:403});
    if(!SERVICE_STATUSES.has(next))return json(request,{error:'STATUS'},400);

    const found=(await q('SELECT id,order_number,point_id,home_point_id,current_point_id,status,handling_mode,customer_id,assigned_technician_id,created_by_user_id,final_cost,estimated_cost,currency,warranty_months,warranty_started_at,warranty_expires_at,warranty_card_printed_at FROM service_orders WHERE id=$1 LIMIT 1',[statusMatch[1]])).rows[0];
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
      if(next==='READY'&&(!found.warranty_months||!found.warranty_expires_at||!found.warranty_card_printed_at)){
        return json(request,{error:'WARRANTY_REQUIRED',message:'Przed oznaczeniem urządzenia jako gotowe ustaw okres gwarancji i wydrukuj kartę gwarancyjną dołączaną do telefonu.'},409);
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
      const statusUpdate=await statusClient.query(
        "UPDATE service_orders SET status=$1,updated_at=now(),completed_at=CASE WHEN $1='COMPLETED' THEN now() ELSE completed_at END,final_cost=CASE WHEN $1='COMPLETED' AND final_cost IS NULL THEN estimated_cost ELSE final_cost END WHERE id=$2 AND status=$3 RETURNING id",
        [next,found.id,found.status]
      );
      if(statusUpdate.rowCount!==1){
        throw Object.assign(new Error('Status zlecenia zmienił się w międzyczasie. Odśwież dane i spróbuj ponownie.'),{status:409,code:'ORDER_STATUS_CHANGED'});
      }
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
    if(!CUSTOMER_QUOTE_STAFF_ROLES.has(u.role_code)&&!hasSupportAccess(u))throw Object.assign(new Error('Brak uprawnień do wycen klientów.'),{status:403});
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
      "SELECT r.*,c.first_name,c.last_name,c.email,c.phone,rp.name AS requested_point_name,rrp.name AS routed_point_name,u.name AS technician_name,u.email AS technician_email,u.role_code AS technician_role,s.order_number FROM customer_quote_requests r JOIN customers c ON c.id=r.customer_id JOIN points rp ON rp.id=r.requested_point_id JOIN points rrp ON rrp.id=r.routed_point_id LEFT JOIN users u ON u.id=r.assigned_technician_id LEFT JOIN service_orders s ON s.id=r.service_order_id"+where+" ORDER BY CASE WHEN r.status='OPEN' THEN 0 WHEN r.status='QUOTED' THEN 1 ELSE 2 END,r.updated_at DESC LIMIT 150",
      params
    )).rows;
    const ids=rows.map((row)=>row.id);
    let messages=[];
    if(ids.length){
      messages=(await q(
        "SELECT m.id,m.request_id,m.sender_kind,m.body,m.created_at,u.name AS sender_name,u.email AS sender_email,u.role_code AS sender_role FROM customer_quote_messages m LEFT JOIN users u ON u.id=m.sender_user_id WHERE m.request_id=ANY($1::text[]) ORDER BY m.created_at ASC",
        [ids]
      )).rows;
    }
    const byRequest=new Map();
    for(const row of messages){
      const list=byRequest.get(row.request_id)||[];
      list.push({id:row.id,senderKind:row.sender_kind,senderName:row.sender_kind==='STAFF'?operationalIdentityName(row.sender_name,row.sender_email,row.sender_role):(row.sender_name||null),body:row.body,createdAt:row.created_at});
      byRequest.set(row.request_id,list);
    }
    return json(request,rows.map((row)=>({
      id:row.id,customerId:row.customer_id,customerName:[row.first_name,row.last_name].filter(Boolean).join(' '),customerEmail:row.email||null,customerPhone:row.phone||null,
      requestedPointId:row.requested_point_id,requestedPointName:row.requested_point_name,routedPointId:row.routed_point_id,routedPointName:row.routed_point_name,
      assignedTechnicianId:isOwnerIdentity(row.technician_email,row.technician_role)?null:(row.assigned_technician_id||null),assignedTechnicianName:isOwnerIdentity(row.technician_email,row.technician_role)?null:(row.technician_name||null),
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
    if(!CUSTOMER_QUOTE_STAFF_ROLES.has(u.role_code)&&!hasSupportAccess(u))throw Object.assign(new Error('Brak uprawnień do odpowiedzi klientowi.'),{status:403});
    const quote=await staffQuoteVisible(u,staffQuoteReplyMatch[1]);
    if(!quote)return json(request,{error:'NOT_FOUND'},404);
    if(['CLOSED','CANCELLED'].includes(quote.status))return json(request,{error:'QUOTE_CLOSED',message:'To zapytanie jest zamknięte.'},409);
    const body=await readJson(request),message=cleanText(body.message,1000);
    if(!message)return json(request,{error:'MESSAGE_REQUIRED',message:'Wpisz odpowiedź dla klienta.'},400);
    await q("INSERT INTO customer_quote_messages(id,request_id,sender_kind,sender_user_id,body) VALUES($1,$2,'STAFF',$3,$4)",[makeId('cqm'),quote.id,u.id,message]);
    await q("UPDATE customer_quote_requests SET assigned_technician_id=CASE WHEN assigned_technician_id IS NULL AND $2='TECHNICIAN' THEN $3 ELSE assigned_technician_id END,updated_at=now() WHERE id=$1",[quote.id,u.role_code,u.id]);
    const emailResult=await sendCustomerPortalEventEmail({
      customerId:quote.customer_id,
      pointId:quote.routed_point_id,
      senderUserId:u.id,
      preference:'messages',
      subject:'LockOn ServiceOS · nowa wiadomość z serwisu',
      title:'Masz nową wiadomość z serwisu',
      message
    });
    await audit(session,'CUSTOMER_QUOTE_REPLIED','customer_quote_request',quote.id,quote.routed_point_id,{customerId:quote.customer_id,email:emailResult});
    return json(request,{ok:true,email:emailResult});
  }

  const staffQuotePriceMatch=url.pathname.match(/^\/service\/customer-quotes\/([^/]+)\/quote$/);
  if(method==='POST'&&staffQuotePriceMatch){
    const session=await requireActive(request),u=session.user;
    if(!CUSTOMER_QUOTE_STAFF_ROLES.has(u.role_code)&&!hasSupportAccess(u))throw Object.assign(new Error('Brak uprawnień do wyceny.'),{status:403});
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
    const emailResult=await sendCustomerPortalEventEmail({
      customerId:quote.customer_id,
      pointId:quote.routed_point_id,
      senderUserId:u.id,
      preference:'quoteUpdates',
      subject:'LockOn ServiceOS · wycena jest gotowa',
      title:'Wycena jest gotowa',
      message:'Wycena: '+rounded.toFixed(2)+' PLN'+(note?' · '+note:'')
    });
    await audit(session,'CUSTOMER_QUOTE_PRICED','customer_quote_request',quote.id,quote.routed_point_id,{customerId:quote.customer_id,amount:rounded,currency:'PLN',email:emailResult});
    return json(request,{ok:true,amount:rounded,currency:'PLN',email:emailResult});
  }

  const staffQuoteCloseMatch=url.pathname.match(/^\/service\/customer-quotes\/([^/]+)\/close$/);
  if(method==='POST'&&staffQuoteCloseMatch){
    const session=await requireActive(request),u=session.user;
    if(!CUSTOMER_QUOTE_STAFF_ROLES.has(u.role_code)&&!hasSupportAccess(u))throw Object.assign(new Error('Brak uprawnień do zamknięcia zapytania.'),{status:403});
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
      "SELECT t.*,fp.name AS from_point_name,fp.city AS from_point_city,tp.name AS to_point_name,tp.city AS to_point_city,su.name AS sent_by_name,su.email AS sent_by_email,su.role_code AS sent_by_role,au.name AS accepted_by_name,au.email AS accepted_by_email,au.role_code AS accepted_by_role,s.order_number,c.first_name,c.last_name,d.brand,d.model FROM service_order_transfers t JOIN points fp ON fp.id=t.from_point_id JOIN points tp ON tp.id=t.to_point_id JOIN users su ON su.id=t.sent_by_user_id LEFT JOIN users au ON au.id=t.accepted_by_user_id JOIN service_orders s ON s.id=t.service_order_id JOIN customers c ON c.id=s.customer_id JOIN devices d ON d.id=s.device_id" + where + " ORDER BY t.requested_at DESC LIMIT 150",
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
      if(!SERVICE_TRANSFER_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do przyjęcia urządzenia.'),{status:403});
      acceptedBy=u.id;
    }

    const updated=(await q(
      "UPDATE service_order_transfers SET status=$1,note=CASE WHEN NULLIF($2,'') IS NULL THEN note ELSE $2 END,accepted_by_user_id=CASE WHEN $1='ACCEPTED' THEN $3 ELSE accepted_by_user_id END,shipped_at=CASE WHEN $1='IN_TRANSIT' THEN COALESCE(shipped_at,now()) ELSE shipped_at END,delivered_at=CASE WHEN $1='DELIVERED' THEN now() ELSE delivered_at END,accepted_at=CASE WHEN $1='ACCEPTED' THEN now() ELSE accepted_at END,updated_at=now() WHERE id=$4 AND status=$5 RETURNING *",
      [next,note,acceptedBy,transfer.id,transfer.status]
    )).rows[0];
    if(!updated)return json(request,{error:'TRANSFER_STATUS_CHANGED',message:'Etap przekazania zmienił się w międzyczasie. Odśwież dane i spróbuj ponownie.'},409);

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
    const session=await requireActive(request),u=session.user,pointId=cleanText(url.searchParams.get('pointId'),80);
    if(u.role_code==='OWNER')return json(request,{connected:false,pointId:pointId||null,needsReconnect:false,connectionState:'NOT_CONNECTED',reason:'OWNER_PRIVACY',checkedAt:nowIso()});
    if(pointId)await requirePoint(u,pointId);
    const row=(await q(
      "SELECT user_id,sender_email,status,last_error,connected_at,updated_at,refresh_token_ciphertext,oauth_client_secret_ciphertext,(refresh_token_ciphertext IS NOT NULL) AS refresh_complete,(oauth_client_secret_ciphertext IS NOT NULL) AS legacy_secret_complete FROM user_gmail_credentials WHERE user_id=$1 LIMIT 1",
      [u.id]
    )).rows[0]||null;
    const checkedAt=nowIso();
    if(!row)return json(request,{connected:false,pointId:pointId||null,needsReconnect:false,connectionState:'NOT_CONNECTED',reason:'NOT_CONNECTED',checkedAt});

    const credentialsComplete=row.refresh_complete===true&&Boolean(GOOGLE_DESKTOP_CLIENT_SECRET||row.legacy_secret_complete);
    if(!credentialsComplete||row.status==='REVOKED'){
      return json(request,{
        connected:false,
        needsReconnect:true,
        connectionState:'REAUTH_REQUIRED',
        pointId:pointId||null,
        inherited:false,
        email:operationalIdentityEmail(row.sender_email,u.role_code),
        status:row.status,
        lastError:row.last_error||'Połączenie Gmail wymaga ponownej autoryzacji.',
        connectedAt:row.connected_at,
        checkedAt
      });
    }

    try{
      const refreshToken=decryptSecret(row.refresh_token_ciphertext);
      const legacyClientSecret=row.oauth_client_secret_ciphertext?decryptSecret(row.oauth_client_secret_ciphertext):'';
      await refreshGmailAccess(refreshToken,legacyClientSecret);
      if(row.status!=='ACTIVE'||row.last_error){
        await q("UPDATE user_gmail_credentials SET status='ACTIVE',last_error=NULL,updated_at=now() WHERE user_id=$1",[u.id]);
      }
      return json(request,{
        connected:true,
        needsReconnect:false,
        connectionState:'CONNECTED',
        pointId:pointId||null,
        inherited:false,
        email:operationalIdentityEmail(row.sender_email,u.role_code),
        status:'ACTIVE',
        lastError:null,
        connectedAt:row.connected_at,
        checkedAt
      });
    }catch(error){
      const reauth=isGmailReauthError(error);
      const message=cleanText(error instanceof Error?error.message:error,500);
      if(reauth){
        await q("UPDATE user_gmail_credentials SET status='REVOKED',last_error=$2,updated_at=now() WHERE user_id=$1",[u.id,message]);
      }else{
        await q("UPDATE user_gmail_credentials SET last_error=$2,updated_at=now() WHERE user_id=$1",[u.id,message]);
      }
      return json(request,{
        connected:false,
        needsReconnect:reauth,
        connectionState:reauth?'REAUTH_REQUIRED':'TEMPORARY_ERROR',
        pointId:pointId||null,
        inherited:false,
        email:operationalIdentityEmail(row.sender_email,u.role_code),
        status:reauth?'REVOKED':row.status,
        lastError:reauth?message:'Nie udało się teraz potwierdzić połączenia Gmail. ServiceOS spróbuje ponownie automatycznie.',
        connectedAt:row.connected_at,
        checkedAt
      });
    }
  }

  if(method==='POST'&&url.pathname==='/integrations/gmail/connect-code'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code==='OWNER')throw Object.assign(new Error('Konto OWNER nie jest używane jako nadawca operacyjny.'),{status:403,code:'OWNER_PRIVACY'});
    const body=await readJson(request),pointId=cleanText(body.pointId,80);
    if(pointId)await requirePoint(u,pointId);

    const tokens=await exchangeDesktopAuthorizationCode(body,'/gmail/callback');
    if(!tokens?.refresh_token)return json(request,{error:'REFRESH_TOKEN',message:'Google nie zwrócił refresh tokena. Odłącz wcześniejszy dostęp ServiceOS w koncie Google i spróbuj ponownie.'},400);
    if(!tokens?.id_token)return json(request,{error:'GOOGLE_ID_TOKEN',message:'Google nie zwrócił tokena tożsamości.'},400);
    const profile=await verifyGoogle(String(tokens.id_token),GOOGLE_DESKTOP_CLIENT_ID);
    if(!googleIdentityMatchesUser(profile,u))return json(request,{error:'GMAIL_IDENTITY_MISMATCH',message:'Połącz Gmail tego samego konta Google, którym jesteś zalogowany w ServiceOS.'},409);
    await refreshGmailAccess(String(tokens.refresh_token),'');
    const scopes=String(tokens.scope||'').split(/\s+/).filter(Boolean);
    await q(
      "INSERT INTO user_gmail_credentials(user_id,google_sub,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,granted_scopes,status,last_error,connected_at,updated_at) VALUES($1,$2,$3,$4,NULL,$5::text[],'ACTIVE',NULL,now(),now()) ON CONFLICT(user_id) DO UPDATE SET google_sub=EXCLUDED.google_sub,sender_email=EXCLUDED.sender_email,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,oauth_client_secret_ciphertext=NULL,granted_scopes=EXCLUDED.granted_scopes,status='ACTIVE',last_error=NULL,connected_at=now(),updated_at=now()",
      [u.id,profile.sub,profile.email,encryptSecret(String(tokens.refresh_token)),scopes]
    );
    if(pointId)await q(
      "INSERT INTO point_notification_settings(point_id,automatic_email_enabled,notify_statuses,sender_display_name,updated_by_user_id,updated_at) VALUES($1,true,$2::text[],'LockOn ServiceOS',$3,now()) ON CONFLICT(point_id) DO NOTHING",
      [pointId,[...DEFAULT_NOTIFY_STATUSES],u.id]
    );
    const recovery=await recoverNoSenderNotificationsForUser(u.id);
    await audit(session,'GMAIL_CONNECTED','user',u.id,pointId||null,{senderEmail:profile.email,identitySource:'GOOGLE_ID_TOKEN',credentialLocation:'SERVER_USER',recoveredNotifications:recovery.recovered,recoveredSent:recovery.sent});
    return json(request,{connected:true,needsReconnect:false,pointId:pointId||null,email:operationalIdentityEmail(profile.email,u.role_code),status:'ACTIVE',recoveredNotifications:recovery.recovered,recoveredSent:recovery.sent});
  }

  if(method==='POST'&&url.pathname==='/integrations/gmail/connect'){
    const session=await requireActive(request),u=session.user;
    if(u.role_code==='OWNER')throw Object.assign(new Error('Konto OWNER nie jest używane jako nadawca operacyjny.'),{status:403,code:'OWNER_PRIVACY'});
    const body=await readJson(request),pointId=cleanText(body.pointId,80),refreshToken=cleanText(body.refreshToken,4096),idToken=cleanText(body.idToken,8192),clientSecret=cleanText(body.clientSecret,4096);
    if(pointId)await requirePoint(u,pointId);
    if(!refreshToken||!idToken||!clientSecret)return json(request,{error:'TOKEN',message:'Brak kompletnych danych autoryzacji Google.'},400);

    const profile=await verifyGoogle(idToken,GOOGLE_DESKTOP_CLIENT_ID);
    if(!googleIdentityMatchesUser(profile,u))return json(request,{error:'GMAIL_IDENTITY_MISMATCH',message:'Połącz Gmail tego samego konta Google, którym jesteś zalogowany w ServiceOS.'},409);
    await refreshGmailAccess(refreshToken,clientSecret);
    await q(
      "INSERT INTO user_gmail_credentials(user_id,google_sub,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,granted_scopes,status,last_error,connected_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::text[],'ACTIVE',NULL,now(),now()) ON CONFLICT(user_id) DO UPDATE SET google_sub=EXCLUDED.google_sub,sender_email=EXCLUDED.sender_email,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,oauth_client_secret_ciphertext=EXCLUDED.oauth_client_secret_ciphertext,granted_scopes=EXCLUDED.granted_scopes,status='ACTIVE',last_error=NULL,connected_at=now(),updated_at=now()",
      [u.id,profile.sub,profile.email,encryptSecret(refreshToken),encryptSecret(clientSecret),['https://www.googleapis.com/auth/gmail.send']]
    );
    if(pointId)await q(
      "INSERT INTO point_notification_settings(point_id,automatic_email_enabled,notify_statuses,sender_display_name,updated_by_user_id,updated_at) VALUES($1,true,$2::text[],'LockOn ServiceOS',$3,now()) ON CONFLICT(point_id) DO NOTHING",
      [pointId,[...DEFAULT_NOTIFY_STATUSES],u.id]
    );
    const recovery=await recoverNoSenderNotificationsForUser(u.id);
    await audit(session,'GMAIL_CONNECTED','user',u.id,pointId||null,{senderEmail:profile.email,identitySource:'GOOGLE_ID_TOKEN',credentialLocation:'SERVER_USER',recoveredNotifications:recovery.recovered,recoveredSent:recovery.sent});
    return json(request,{connected:true,needsReconnect:false,pointId:pointId||null,email:operationalIdentityEmail(profile.email,u.role_code),status:'ACTIVE',recoveredNotifications:recovery.recovered,recoveredSent:recovery.sent});
  }

  if(method==='DELETE'&&url.pathname==='/integrations/gmail'){
    const session=await requireActive(request),u=session.user;
    const pointId=cleanText(url.searchParams.get('pointId'),80);
    if(pointId)await requirePoint(u,pointId);
    await q('DELETE FROM user_gmail_credentials WHERE user_id=$1',[u.id]);
    await audit(session,'GMAIL_DISCONNECTED','user',u.id,pointId||null,{});
    return json(request,{ok:true});
  }

  if(method==='GET'&&url.pathname==='/notifications/settings'){
    const session=await requireActive(request),u=session.user;
    if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do ustawień powiadomień.'),{status:403,code:'NOTIFICATIONS_FORBIDDEN'});
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
    if(!GMAIL_MANAGE_ROLES.has(u.role_code))throw Object.assign(new Error('Brak uprawnień do historii powiadomień.'),{status:403,code:'NOTIFICATIONS_FORBIDDEN'});
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
    if(u.role_code==='OWNER')throw Object.assign(new Error('Konto OWNER nie jest używane jako nadawca operacyjny.'),{status:403,code:'OWNER_PRIVACY'});
    const body=await readJson(request),pointId=cleanText(body.pointId,80);
    if(pointId)await requirePoint(u,pointId);
    const senderBase=await loadUserMailSender(u.id);
    if(!senderBase)return json(request,{error:'NO_USER_SENDER',message:'Twoje konto Google nie ma aktywnej zgody Gmail.'},409);
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
      await q("UPDATE user_gmail_credentials SET last_error=NULL,status='ACTIVE',updated_at=now() WHERE user_id=$1",[u.id]);
      await audit(session,'GMAIL_TEST_SENT','user',u.id,pointId||null,{recipient,messageId:sent.id,senderEmail:sender.sender_email});
      return json(request,{ok:true,recipient,messageId:sent.id});
    }catch(error){
      const message=cleanText(error instanceof Error?error.message:error,500);
      if(isGmailReauthError(error)){
        await q("UPDATE user_gmail_credentials SET status='REVOKED',last_error=$2,updated_at=now() WHERE user_id=$1",[u.id,message]);
      }else{
        await q("UPDATE user_gmail_credentials SET last_error=$2,updated_at=now() WHERE user_id=$1",[u.id,message]);
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
    const session=await requireActive(request);
    await repairSelfSupportAssignment(session);
    return json(request,await conversationPayload(session.user.id));
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
    if(note)await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,$3,'USER',$4,$5::jsonb)",[makeId('msg'),conversation.id,u.id,note,JSON.stringify({target:'CONSULTANT'})]);
    const firstRequest=!conversation.consultant_requested_at;
    if(firstRequest){
      await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,NULL,'SYSTEM',$3,$4::jsonb)",[makeId('msg'),conversation.id,'Poproszono konsultanta o pomoc. Bot pozostaje dostępny niezależnie od kanału konsultanta.',JSON.stringify({target:'CONSULTANT',event:'CONSULTANT_REQUESTED'})]);
    }
    await q("UPDATE support_conversations SET consultant_requested_at=COALESCE(consultant_requested_at,now()),updated_at=now() WHERE id=$1",[conversation.id]);
    await audit(session,'SUPPORT_REQUESTED','support_conversation',conversation.id,pointId,{firstRequest});
    return json(request,{ok:true,conversationId:conversation.id,pointId,consultantState:'WAITING'},201);
  }

  if(method==='POST'&&url.pathname==='/support/leave'){
    const session=await requireActive(request),u=session.user;
    const conversation=(await q("SELECT id,point_id,assigned_support_user_id,consultant_requested_at FROM support_conversations WHERE user_id=$1 AND status='OPEN' ORDER BY updated_at DESC LIMIT 1",[u.id])).rows[0];
    if(!conversation)return json(request,{ok:true,consultantState:'BOT'});
    const hadHumanChannel=Boolean(conversation.assigned_support_user_id||conversation.consultant_requested_at);
    if(hadHumanChannel){
      await q("UPDATE support_conversations SET assigned_support_user_id=NULL,taken_at=NULL,consultant_requested_at=NULL,consultant_joined_at=NULL,updated_at=now() WHERE id=$1",[conversation.id]);
      await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,NULL,'SYSTEM',$3,$4::jsonb)",[makeId('msg'),conversation.id,'Rozmowa z konsultantem została zakończona. Bot nadal jest dostępny.',JSON.stringify({target:'CONSULTANT',event:'CONSULTANT_LEFT'})]);
      await audit(session,'SUPPORT_LEFT','support_conversation',conversation.id,conversation.point_id,{});
    }
    return json(request,{ok:true,consultantState:'BOT'});
  }

  if(method==='GET'&&url.pathname==='/support/presence'){
    const session=await requireActive(request),u=session.user;
    requireSupportAccess(u);
    const ids=await visiblePointIds(u);
    const global=u.role_code==='OWNER'||GLOBAL_ROLES.has(u.role_code);
    const sql=global
      ? "SELECT usr.id,usr.name,usr.email,usr.role_code,usr.support_enabled,max(s.last_seen_at) AS last_seen_at,array_agg(DISTINCT s.client_type) AS client_types,sc.id AS conversation_id,sc.consultant_requested_at,sc.assigned_support_user_id,ass.name AS assigned_support_name,ass.email AS assigned_support_email,ass.role_code AS assigned_support_role,sc.updated_at AS conversation_updated_at FROM users usr JOIN auth_sessions s ON s.user_id=usr.id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() LEFT JOIN LATERAL (SELECT x.* FROM support_conversations x WHERE x.user_id=usr.id AND x.status='OPEN' ORDER BY x.updated_at DESC LIMIT 1) sc ON true LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE usr.status='ACTIVE' AND usr.blocked_at IS NULL AND usr.id<>$1 AND s.last_seen_at>now()-interval '10 minutes' GROUP BY usr.id,usr.name,usr.email,usr.role_code,usr.support_enabled,sc.id,sc.consultant_requested_at,sc.assigned_support_user_id,ass.name,ass.email,ass.role_code,sc.updated_at ORDER BY max(s.last_seen_at) DESC"
      : "SELECT usr.id,usr.name,usr.email,usr.role_code,usr.support_enabled,max(s.last_seen_at) AS last_seen_at,array_agg(DISTINCT s.client_type) AS client_types,sc.id AS conversation_id,sc.consultant_requested_at,sc.assigned_support_user_id,ass.name AS assigned_support_name,ass.email AS assigned_support_email,ass.role_code AS assigned_support_role,sc.updated_at AS conversation_updated_at FROM users usr JOIN auth_sessions s ON s.user_id=usr.id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() LEFT JOIN LATERAL (SELECT x.* FROM support_conversations x WHERE x.user_id=usr.id AND x.status='OPEN' ORDER BY x.updated_at DESC LIMIT 1) sc ON true LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE usr.status='ACTIVE' AND usr.blocked_at IS NULL AND usr.id<>$1 AND s.last_seen_at>now()-interval '10 minutes' AND (usr.role_code='OWNER' OR EXISTS(SELECT 1 FROM user_point_access target_access WHERE target_access.user_id=usr.id AND target_access.point_id=ANY($2::text[]))) GROUP BY usr.id,usr.name,usr.email,usr.role_code,usr.support_enabled,sc.id,sc.consultant_requested_at,sc.assigned_support_user_id,ass.name,ass.email,ass.role_code,sc.updated_at ORDER BY max(s.last_seen_at) DESC";
    const rows=global?(await q(sql,[u.id])).rows:(await q(sql,[u.id,ids])).rows;
    return json(request,rows.map(row=>({
      userId:row.id,name:supportIdentityName(row.name,row.email,row.role_code),email:supportIdentityEmail(row.email,row.role_code),role:row.role_code||null,supportEnabled:row.support_enabled===true,
      online:true,lastSeenAt:row.last_seen_at,clientTypes:row.client_types||[],
      conversationId:row.consultant_requested_at?row.conversation_id:null,
      consultantState:row.assigned_support_user_id?'JOINED':row.consultant_requested_at?'WAITING':'BOT',
      assignedSupportUserId:row.assigned_support_user_id||null,assignedSupportName:row.assigned_support_user_id?supportIdentityName(row.assigned_support_name,row.assigned_support_email,row.assigned_support_role):null,
      conversationUpdatedAt:row.consultant_requested_at?row.conversation_updated_at:null
    })));
  }

  if(method==='GET'&&url.pathname==='/support/tickets'){
    const session=await requireActive(request),u=session.user;
    requireSupportAccess(u);
    const ids=await visiblePointIds(u);
    const {rows}=GLOBAL_ROLES.has(u.role_code)
      ? await q("SELECT sc.*,usr.name AS user_name,usr.email AS user_email,usr.role_code AS user_role,p.name AS point_name,ass.name AS assigned_name,ass.email AS assigned_email,ass.role_code AS assigned_role FROM support_conversations sc JOIN users usr ON usr.id=sc.user_id LEFT JOIN points p ON p.id=sc.point_id LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE sc.consultant_requested_at IS NOT NULL AND sc.user_id<>$1 ORDER BY CASE WHEN sc.status='OPEN' THEN 0 ELSE 1 END,sc.updated_at DESC LIMIT 200",[u.id])
      : await q("SELECT sc.*,usr.name AS user_name,usr.email AS user_email,usr.role_code AS user_role,p.name AS point_name,ass.name AS assigned_name,ass.email AS assigned_email,ass.role_code AS assigned_role FROM support_conversations sc JOIN users usr ON usr.id=sc.user_id LEFT JOIN points p ON p.id=sc.point_id LEFT JOIN users ass ON ass.id=sc.assigned_support_user_id WHERE sc.consultant_requested_at IS NOT NULL AND sc.point_id=ANY($1::text[]) AND sc.user_id<>$2 ORDER BY CASE WHEN sc.status='OPEN' THEN 0 ELSE 1 END,sc.updated_at DESC LIMIT 200",[ids,u.id]);
    const tickets=[];
    for(const row of rows){
      const messages=(await q("SELECT id,sender_user_id,sender_kind,body,metadata,created_at FROM support_messages WHERE conversation_id=$1 AND (metadata->>'target'='CONSULTANT' OR sender_kind='SUPPORT' OR (sender_kind='USER' AND metadata->>'target' IS NULL AND $2::timestamptz IS NOT NULL AND created_at >= $2::timestamptz)) ORDER BY created_at DESC LIMIT 200",[row.id,row.consultant_joined_at||row.taken_at||null])).rows.reverse();
      tickets.push({id:row.id,userId:row.user_id,userName:supportIdentityName(row.user_name,row.user_email,row.user_role),userEmail:supportIdentityEmail(row.user_email,row.user_role),pointId:row.point_id,pointName:row.point_name||'Brak punktu',status:row.status,assignedSupportUserId:row.assigned_support_user_id||null,assignedSupportName:row.assigned_support_user_id?supportIdentityName(row.assigned_name,row.assigned_email,row.assigned_role):null,consultantRequestedAt:row.consultant_requested_at||null,consultantJoinedAt:row.consultant_joined_at||row.taken_at||null,createdAt:row.created_at,updatedAt:row.updated_at,messages:messages.map(supportMessageView)});
    }
    return json(request,tickets);
  }

  const supportTicketAction=url.pathname.match(/^\/support\/tickets\/([^/]+)\/(take|reply|close)$/);
  if(method==='POST'&&supportTicketAction){
    const session=await requireActive(request),u=session.user;
    requireSupportAccess(u);
    const ticket=(await q("SELECT * FROM support_conversations WHERE id=$1 LIMIT 1",[supportTicketAction[1]])).rows[0];
    if(!ticket)return json(request,{error:'NOT_FOUND'},404);
    if(ticket.user_id===u.id)return json(request,{error:'SELF_SUPPORT_NOT_ALLOWED',message:'Nie możesz obsługiwać jako konsultant własnej rozmowy.'},409);
    if(ticket.point_id)await requirePoint(u,ticket.point_id);
    const action=supportTicketAction[2],body=await readJson(request);
    if(action==='take'){
      if(!ticket.consultant_requested_at)return json(request,{error:'CONSULTANT_NOT_REQUESTED',message:'Użytkownik nie poprosił jeszcze konsultanta o dołączenie.'},409);
      if(ticket.assigned_support_user_id&&ticket.assigned_support_user_id!==u.id)return json(request,{error:'SUPPORT_ALREADY_ASSIGNED',message:'Ta rozmowa jest już obsługiwana przez innego konsultanta.'},409);
      const firstJoin=!ticket.assigned_support_user_id;
      const claimed=(await q("UPDATE support_conversations SET assigned_support_user_id=$2,taken_at=COALESCE(taken_at,now()),consultant_joined_at=COALESCE(consultant_joined_at,now()),updated_at=now() WHERE id=$1 AND (assigned_support_user_id IS NULL OR assigned_support_user_id=$2) RETURNING id",[ticket.id,u.id])).rows[0];
      if(!claimed)return json(request,{error:'SUPPORT_ALREADY_ASSIGNED',message:'Ta rozmowa została właśnie przejęta przez innego konsultanta.'},409);
      if(firstJoin)await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,$3,'SYSTEM',$4,$5::jsonb)",[makeId('msg'),ticket.id,u.id,(supportIdentityName(u.name,u.email,u.role_code)||'Konsultant')+' dołączył do rozmowy. Bot nadal działa równolegle.',JSON.stringify({target:'CONSULTANT',event:'CONSULTANT_JOINED'})]);
      await audit(session,'SUPPORT_TAKEN','support_conversation',ticket.id,ticket.point_id,{firstJoin});
    }else if(action==='reply'){
      const message=cleanText(body.message,2000);if(!message)return json(request,{error:'MESSAGE_REQUIRED'},400);
      if(ticket.status!=='OPEN')return json(request,{error:'TICKET_CLOSED',message:'Zgłoszenie jest zamknięte.'},409);
      if(!ticket.consultant_requested_at)return json(request,{error:'CONSULTANT_NOT_REQUESTED',message:'Użytkownik nie poprosił konsultanta o dołączenie.'},409);
      if(ticket.assigned_support_user_id&&ticket.assigned_support_user_id!==u.id)return json(request,{error:'SUPPORT_ALREADY_ASSIGNED',message:'Ta rozmowa jest już obsługiwana przez innego konsultanta.'},409);
      const firstJoin=!ticket.assigned_support_user_id;
      const claimed=(await q("UPDATE support_conversations SET assigned_support_user_id=COALESCE(assigned_support_user_id,$2),taken_at=COALESCE(taken_at,now()),consultant_joined_at=COALESCE(consultant_joined_at,now()),updated_at=now() WHERE id=$1 AND (assigned_support_user_id IS NULL OR assigned_support_user_id=$2) RETURNING id",[ticket.id,u.id])).rows[0];
      if(!claimed)return json(request,{error:'SUPPORT_ALREADY_ASSIGNED',message:'Ta rozmowa została właśnie przejęta przez innego konsultanta.'},409);
      if(firstJoin)await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,$3,'SYSTEM',$4,$5::jsonb)",[makeId('msg'),ticket.id,u.id,(supportIdentityName(u.name,u.email,u.role_code)||'Konsultant')+' dołączył do rozmowy. Bot nadal działa równolegle.',JSON.stringify({target:'CONSULTANT',event:'CONSULTANT_JOINED'})]);
      await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,$3,'SUPPORT',$4,$5::jsonb)",[makeId('msg'),ticket.id,u.id,message,JSON.stringify({target:'CONSULTANT'})]);
      await audit(session,'SUPPORT_REPLIED','support_conversation',ticket.id,ticket.point_id,{length:message.length,firstJoin});
    }else{
      if(ticket.assigned_support_user_id&&ticket.assigned_support_user_id!==u.id)return json(request,{error:'SUPPORT_ALREADY_ASSIGNED',message:'Ta rozmowa jest obsługiwana przez innego konsultanta.'},409);
      const closed=(await q("UPDATE support_conversations SET assigned_support_user_id=NULL,taken_at=NULL,consultant_requested_at=NULL,consultant_joined_at=NULL,updated_at=now() WHERE id=$1 AND (assigned_support_user_id IS NULL OR assigned_support_user_id=$2) RETURNING id",[ticket.id,u.id])).rows[0];
      if(!closed)return json(request,{error:'SUPPORT_ALREADY_ASSIGNED',message:'Ta rozmowa została właśnie przejęta przez innego konsultanta.'},409);
      await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,$3,'SYSTEM',$4,$5::jsonb)",[makeId('msg'),ticket.id,u.id,'Konsultant zakończył kanał rozmowy. Bot nadal jest dostępny.',JSON.stringify({target:'CONSULTANT',event:'CONSULTANT_CLOSED'})]);
      await audit(session,'SUPPORT_CLOSED','support_conversation',ticket.id,ticket.point_id,{});
    }
    return json(request,{ok:true});
  }

  if(method==='POST'&&url.pathname==='/assistant/chat'){
    const session=await requireActive(request),body=await readJson(request),message=cleanText(body.message,1500);if(!message)return json(request,{error:'MESSAGE'},400);
    await repairSelfSupportAssignment(session);
    const target=normalizeSupportTarget(body.target);
    const conv=await getOrCreateConversation(session.user.id);
    const live=(await q("SELECT assigned_support_user_id,consultant_requested_at FROM support_conversations WHERE id=$1",[conv.id])).rows[0]||{};
    const consultantState=live.assigned_support_user_id?'JOINED':live.consultant_requested_at?'WAITING':'BOT';
    if(target==='CONSULTANT'&&!live.consultant_requested_at){
      return json(request,{error:'CONSULTANT_NOT_REQUESTED',message:'Najpierw poproś konsultanta o dołączenie.'},409);
    }
    const uid=makeId('msg');
    await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,$3,'USER',$4,$5::jsonb)",[uid,conv.id,session.user.id,message,JSON.stringify({target})]);
    await q('UPDATE support_conversations SET updated_at=now() WHERE id=$1',[conv.id]);
    const userMessage={id:uid,author:'user',text:message,target,createdAt:nowIso()};
    if(target==='CONSULTANT'){
      return json(request,{userMessage,assistantMessage:null,action:null,consultantState});
    }
    const reply=await assistantReply(session,message);
    const aid=makeId('msg');
    await q("INSERT INTO support_messages(id,conversation_id,sender_user_id,sender_kind,body,metadata) VALUES($1,$2,NULL,'ASSISTANT',$3,$4::jsonb)",[aid,conv.id,reply.text,JSON.stringify({target:'BOT',action:reply.action||null})]);
    return json(request,{userMessage,assistantMessage:{id:aid,author:'assistant',text:reply.text,target:'BOT',action:reply.action||null,createdAt:nowIso()},action:reply.action||null,consultantState});
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
