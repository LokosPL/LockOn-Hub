import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const loadLocalEnv = () => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {}
};
loadLocalEnv();

const PORT = Number(process.env.LOCKON_API_PORT || 8787);
const HOST = process.env.LOCKON_API_HOST || '127.0.0.1';
const DATA_FILE = process.env.LOCKON_DATA_FILE || path.join(process.cwd(), 'server', 'data', 'database.json');
const OWNER_EMAIL = (process.env.LOCKON_OWNER_EMAIL || '').trim().toLowerCase();
const GOOGLE_CLIENT_ID = (process.env.LOCKON_GOOGLE_CLIENT_ID || '996585439932-e10mu53j95s6u13vrua841tm4oco38so.apps.googleusercontent.com').trim();
const ALLOW_DEV_LOGIN = process.env.LOCKON_ALLOW_DEV_LOGIN === '1';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7;
const BODY_LIMIT_BYTES = 64 * 1024;
const googleVerifier = new OAuth2Client();

const ROLES = ['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER'];
const REQUESTABLE_ROLES = new Set(['BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const GLOBAL_ROLES = new Set(['OWNER', 'BOSS']);
const SERVICE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER']);
const SERVICE_CREATE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const SERVICE_INTAKE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_MANAGE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR']);
const FINANCE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const OWNER_OPERATIONAL_NAME = 'System LockOn';
const OWNER_SUPPORT_NAME = 'Właściciel aplikacji';
const isOwnerIdentity = (user) => Boolean(user) && (
  user.role === 'OWNER' ||
  (Boolean(OWNER_EMAIL) && normalizeEmail(user.email) === OWNER_EMAIL)
);
const operationalIdentityName = (user) => isOwnerIdentity(user) ? OWNER_OPERATIONAL_NAME : (user?.name || user?.email || null);
const operationalIdentityEmail = (user) => isOwnerIdentity(user) ? null : (user?.email || null);
const supportIdentityName = (user) => isOwnerIdentity(user) ? OWNER_SUPPORT_NAME : (user?.name || user?.email || null);
const supportIdentityEmail = (user) => isOwnerIdentity(user) ? null : (user?.email || null);
const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const normalizeTechnicianPercent = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 100) / 100 : null;
};
const splitRevenueAmount = (amount, technicianPercent) => {
  const percent = normalizeTechnicianPercent(technicianPercent) ?? 50;
  const technicianShare = Math.round(Number(amount) * percent) / 100;
  return {
    technicianPercent: percent,
    bossPercent: Math.round((100-percent)*100)/100,
    technicianShare,
    bossShare: Math.round((Number(amount)-technicianShare)*100)/100
  };
};
const normalizePhone = (value = '') => String(value).replace(/\D/g, '').slice(-15);
const customerView = (customer) => ({
  id: customer.id,
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email || null,
  phone: customer.phone || null
});

const ensureDir = () => fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

const initialDb = () => ({
  version: 2,
  users: [],
  points: [
    {
      id: 'nowogard',
      name: 'Punkt Nowogard',
      city: 'Nowogard',
      active: true,
      createdAt: nowIso()
    }
  ],
  loginEvents: [],
  auditLog: [],
  revenueEntries: [],
  customers: [],
  devices: [],
  serviceOrders: [],
  serviceOrderStatusHistory: [],
  serviceOrderNotes: [],
  serviceOrderParts: [],
  serviceOrderInvoices: [],
  technicianPrivateNotes: [],
  invoicePromptDismissals: [],
  notificationSettings: [],
  notificationHistory: [],
  supportConversations: [],
  supportMessages: [],
  sessions: []
});

const loadDb = () => {
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) {
    const db = initialDb();
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      ...initialDb(),
      ...raw,
      version: 2,
      users: Array.isArray(raw.users) ? raw.users : [],
      points: Array.isArray(raw.points) && raw.points.length ? raw.points : initialDb().points,
      loginEvents: Array.isArray(raw.loginEvents) ? raw.loginEvents : [],
      auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : [],
      revenueEntries: Array.isArray(raw.revenueEntries) ? raw.revenueEntries : [],
      customers: Array.isArray(raw.customers) ? raw.customers : [],
      devices: Array.isArray(raw.devices) ? raw.devices : [],
      serviceOrders: Array.isArray(raw.serviceOrders) ? raw.serviceOrders : [],
      serviceOrderStatusHistory: Array.isArray(raw.serviceOrderStatusHistory) ? raw.serviceOrderStatusHistory : [],
      serviceOrderNotes: Array.isArray(raw.serviceOrderNotes) ? raw.serviceOrderNotes : [],
      serviceOrderParts: Array.isArray(raw.serviceOrderParts) ? raw.serviceOrderParts : [],
      serviceOrderInvoices: Array.isArray(raw.serviceOrderInvoices) ? raw.serviceOrderInvoices : [],
      technicianPrivateNotes: Array.isArray(raw.technicianPrivateNotes) ? raw.technicianPrivateNotes : [],
      invoicePromptDismissals: Array.isArray(raw.invoicePromptDismissals) ? raw.invoicePromptDismissals : [],
      notificationSettings: Array.isArray(raw.notificationSettings) ? raw.notificationSettings : [],
      notificationHistory: Array.isArray(raw.notificationHistory) ? raw.notificationHistory : [],
      supportConversations: Array.isArray(raw.supportConversations) ? raw.supportConversations : [],
      supportMessages: Array.isArray(raw.supportMessages) ? raw.supportMessages : [],
      sessions: Array.isArray(raw.sessions) ? raw.sessions : []
    };
  } catch {
    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    try { fs.copyFileSync(DATA_FILE, backup); } catch {}
    const db = initialDb();
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
  }
};

let db = loadDb();

const saveDb = () => {
  ensureDir();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
};

const localAudit = (actor, action, entityType, entityId = null, pointId = null, metadata = {}) => {
  db.auditLog.unshift({
    id:id('aud'), actorUserId:actor?.id || null, actorName:operationalIdentityName(actor) || 'System',
    actorRole:actor?.role || null, action, entityType, entityId, pointId,
    metadata:{...metadata,clientType:metadata.clientType || 'DESKTOP'}, createdAt:nowIso()
  });
  db.auditLog = db.auditLog.slice(0, 500);
  saveDb();
};

const pointSummary = (point) => ({ id: point.id, name: point.name, city: point.city, active: point.active !== false });

const publicUser = (user) => ({
  id: user.id,
  email: operationalIdentityEmail(user),
  name: operationalIdentityName(user),
  picture: isOwnerIdentity(user) ? null : user.picture,
  role: user.role ?? null,
  technicianSplitPercent: user.technicianSplitPercent ?? null,
  supportEnabled: user.supportEnabled === true || user.role === 'SUPPORT' || user.role === 'OWNER',
  status: user.status,
  blocked: Boolean(user.blockedAt),
  blockedAt: user.blockedAt ?? null,
  blockedReason: user.blockedReason ?? null,
  pointIds: Array.isArray(user.pointIds) ? user.pointIds : [],
  requestedPoint: user.requestedPoint ?? null,
  firstLoginAt: user.firstLoginAt,
  lastLoginAt: user.lastLoginAt
});

const pointsForUser = (user) => {
  if (GLOBAL_ROLES.has(user.role)) return db.points.filter((p) => p.active !== false).map(pointSummary);
  const ids = new Set(user.pointIds || []);
  return db.points.filter((p) => ids.has(p.id) && p.active !== false).map(pointSummary);
};

const authPayload = (user) => ({
  user: publicUser(user),
  points: pointsForUser(user)
});

const findUserByEmail = (email) => db.users.find((u) => normalizeEmail(u.email) === normalizeEmail(email));
const findUserByGoogleSub = (sub) => sub ? db.users.find((u) => u.googleSub === sub) : null;
const findUserById = (userId) => db.users.find((u) => u.id === userId);
const sessionTokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

const ensureOwner = (profile = {}) => {
  if (!OWNER_EMAIL) return null;
  let owner = findUserByEmail(OWNER_EMAIL);
  if (!owner) {
    owner = {
      id: id('usr'),
      googleSub: profile.sub || null,
      email: OWNER_EMAIL,
      name: profile.name || OWNER_OPERATIONAL_NAME,
      picture: profile.picture || null,
      role: 'OWNER',
      supportEnabled: true,
      status: 'ACTIVE',
      pointIds: [],
      requestedPoint: null,
      firstLoginAt: nowIso(),
      lastLoginAt: nowIso()
    };
    db.users.push(owner);
  } else {
    owner.role = 'OWNER';
    owner.supportEnabled = true;
    owner.blockedAt = null;
    owner.blockedReason = null;
    owner.status = 'ACTIVE';
    owner.pointIds = [];
    owner.googleSub = profile.sub || owner.googleSub || null;
    owner.name = profile.name || owner.name;
    owner.picture = profile.picture || owner.picture;
    owner.lastLoginAt = nowIso();
  }
  return owner;
};

if (OWNER_EMAIL) ensureOwner();
saveDb();

const json = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
  });
  res.end(data);
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  let size = 0;
  let settled = false;
  req.on('data', (chunk) => {
    if (settled) return;
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT_BYTES) {
      settled = true;
      reject(new Error('PAYLOAD_TOO_LARGE'));
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    if (settled) return;
    settled = true;
    if (!body) return resolve({});
    try { resolve(JSON.parse(body)); } catch { reject(new Error('INVALID_JSON')); }
  });
  req.on('error', (error) => {
    if (settled) return;
    settled = true;
    reject(error);
  });
});

const createSession = (user) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  db.sessions = db.sessions.filter((s) => Number(s.expiresAt) > createdAt && Number(s.absoluteExpiresAt || s.expiresAt) > createdAt);
  db.sessions.push({
    tokenHash: sessionTokenHash(token),
    userId: user.id,
    createdAt,
    lastSeenAt: createdAt,
    expiresAt: createdAt + SESSION_TTL_MS,
    absoluteExpiresAt: createdAt + SESSION_ABSOLUTE_TTL_MS
  });
  return token;
};

const findSession = (token) => {
  if (!token) return null;
  const now = Date.now();
  const hash = sessionTokenHash(token);
  const session = db.sessions.find((s) => {
    const tokenMatches = s.tokenHash ? s.tokenHash === hash : s.token === token;
    return tokenMatches && Number(s.expiresAt) > now && Number(s.absoluteExpiresAt || s.expiresAt) > now;
  });
  if (!session) return null;

  // Migracja starych sesji: od tej wersji na dysku backendu zostaje tylko hash tokena.
  if (!session.tokenHash) {
    session.tokenHash = hash;
    delete session.token;
  }
  session.lastSeenAt = now;
  const absoluteExpiry = Number(session.absoluteExpiresAt || (Number(session.createdAt) + SESSION_ABSOLUTE_TTL_MS));
  session.absoluteExpiresAt = absoluteExpiry;
  if (Number(session.expiresAt) - now < SESSION_REFRESH_THRESHOLD_MS) {
    session.expiresAt = Math.min(now + SESSION_TTL_MS, absoluteExpiry);
  }
  saveDb();
  return session;
};

const currentUser = (req) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const session = findSession(token);
  return session ? (findUserById(session.userId) || null) : null;
};

const requireUser = (req, res) => {
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { error: 'UNAUTHORIZED', message: 'Sesja wygasła albo jest nieprawidłowa.' });
    return null;
  }
  if (user.blockedAt) {
    json(res, 401, { error: 'ACCOUNT_BLOCKED', message: user.blockedReason ? 'Konto zostało zablokowane: '+user.blockedReason : 'Konto zostało zablokowane.' });
    return null;
  }
  return user;
};

const requireActive = (req, res) => {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.status !== 'ACTIVE') {
    json(res, 403, { error: 'ACCOUNT_NOT_ACTIVE', message: 'Konto nie zostało jeszcze aktywowane.' });
    return null;
  }
  return user;
};

const requireRole = (req, res, roles) => {
  const user = requireActive(req, res);
  if (!user) return null;
  if (!roles.includes(user.role)) {
    json(res, 403, { error: 'FORBIDDEN', message: 'Brak uprawnień do tej operacji.' });
    return null;
  }
  return user;
};

const hasSupportAccess = (user) => user?.role === 'OWNER' || user?.role === 'SUPPORT' || user?.supportEnabled === true;
const requireSupportAccess = (req, res) => {
  const user = requireActive(req, res);
  if (!user) return null;
  if (!hasSupportAccess(user)) {
    json(res,403,{error:'SUPPORT_FORBIDDEN',message:'Brak uprawnienia Wsparcie LockOn.'});
    return null;
  }
  return user;
};

const recordLogin = (user) => {
  db.loginEvents.unshift({
    id: id('log'),
    userId: user.id,
    email: operationalIdentityEmail(user),
    name: operationalIdentityName(user),
    role: user.role ?? null,
    status: user.status,
    pointIds: user.pointIds || [],
    createdAt: nowIso()
  });
  db.loginEvents = db.loginEvents.slice(0, 1000);
};

const verifyGoogleIdToken = async (idToken) => {
  const ticket = await googleVerifier.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });
  const profile = ticket.getPayload();
  if (!profile?.sub || !profile.email || profile.email_verified !== true) {
    throw new Error('Google nie potwierdził tożsamości użytkownika.');
  }
  return {
    sub: profile.sub,
    email: normalizeEmail(profile.email),
    name: cleanText(profile.name || profile.email, 120),
    picture: profile.picture || null
  };
};

const loginProfile = (profile) => {
  let user = findUserByGoogleSub(profile.sub) || findUserByEmail(profile.email);
  const timestamp = nowIso();

  if (OWNER_EMAIL && normalizeEmail(profile.email) === OWNER_EMAIL) {
    user = ensureOwner(profile);
  } else if (!user) {
    user = {
      id: id('usr'),
      googleSub: profile.sub || null,
      email: normalizeEmail(profile.email),
      name: profile.name,
      picture: profile.picture || null,
      role: null,
      supportEnabled: false,
      status: 'PENDING',
      pointIds: [],
      requestedPoint: null,
      firstLoginAt: timestamp,
      lastLoginAt: timestamp
    };
    db.users.push(user);
  } else {
    user.googleSub = profile.sub || user.googleSub || null;
    user.name = profile.name || user.name;
    user.picture = profile.picture || user.picture;
    user.lastLoginAt = timestamp;
  }

  recordLogin(user);
  const token = createSession(user);
  saveDb();
  return { token, ...authPayload(user) };
};

const canSeePoint = (user, pointId) => {
  if (GLOBAL_ROLES.has(user.role)) return true;
  return (user.pointIds || []).includes(pointId);
};

const LOCAL_STATUS_LABELS = {
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

const localOrderView = (order) => {
  const customer = db.customers.find((item) => item.id === order.customerId);
  const device = db.devices.find((item) => item.id === order.deviceId);
  const point = db.points.find((item) => item.id === order.pointId);
  const technician = order.assignedTechnicianId ? findUserById(order.assignedTechnicianId) : null;
  return {
    ...order,
    pointName: point?.name || 'Punkt',
    customerName: customer ? `${customer.firstName} ${customer.lastName}` : 'Klient',
    customerEmail: customer?.email || null,
    customerPhone: customer?.phone || null,
    brand: device?.brand || '',
    model: device?.model || '',
    imei: device?.imei || null,
    serialNumber: device?.serialNumber || null,
    deviceNotes: device?.notes || null,
    assignedTechnicianId: isOwnerIdentity(technician) ? null : (order.assignedTechnicianId || null),
    assignedTechnicianName: isOwnerIdentity(technician) ? null : (technician?.name || null),
    assignedTechnicianEmail: isOwnerIdentity(technician) ? null : (technician?.email || null),
    statusLabel: LOCAL_STATUS_LABELS[order.status] || order.status,
    currency: order.currency || 'PLN'
  };
};

const localOrderViewForUser = (order, user) => {
  const view = localOrderView(order);
  if (!SERVICE_EDIT_ROLES.has(user.role)) {
    view.estimatedCost = null;
    view.finalCost = null;
  }
  return view;
};

const revenueVisibleTo = (user, entry) => {
  if (GLOBAL_ROLES.has(user.role)) return true;
  if (user.role === 'TECHNICIAN') return entry.userId === user.id;
  if (user.role === 'COORDINATOR') return canSeePoint(user, entry.pointId);
  return false;
};

const revenueView = (entry) => {
  const technician = findUserById(entry.userId);
  const point = db.points.find((p) => p.id === entry.pointId);
  const split = splitRevenueAmount(entry.amount, entry.splitTechnicianPercent ?? entry.technicianPercent ?? 50);
  const approved = entry.status === 'APPROVED' || entry.status === 'SETTLED';
  return {
    ...entry,
    splitTechnicianPercent: split.technicianPercent,
    splitBossPercent: split.bossPercent,
    technicianShare: approved ? split.technicianShare : 0,
    bossShare: approved ? split.bossShare : 0,
    technician: technician ? { id: technician.id, name: operationalIdentityName(technician), email: operationalIdentityEmail(technician) } : null,
    point: point ? pointSummary(point) : null
  };
};

const handle = async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  if (method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'LockOn ServiceOS API', time: nowIso() });
  }

  if (method === 'POST' && url.pathname === '/auth/google') {
    const body = await readBody(req);
    if (!body.idToken) return json(res, 400, { error: 'MISSING_TOKEN', message: 'Brak tokena tożsamości Google.' });
    try {
      const profile = await verifyGoogleIdToken(String(body.idToken));
      return json(res, 200, loginProfile(profile));
    } catch {
      return json(res, 401, { error: 'GOOGLE_AUTH_FAILED', message: 'Google nie potwierdził tożsamości.' });
    }
  }

  if (method === 'POST' && url.pathname === '/auth/dev-owner') {
    if (!ALLOW_DEV_LOGIN) return json(res, 404, { error: 'NOT_FOUND' });
    if (!OWNER_EMAIL) return json(res,503,{error:'OWNER_EMAIL_NOT_CONFIGURED'});
    const result = loginProfile({ email: OWNER_EMAIL, name: OWNER_OPERATIONAL_NAME, sub: 'dev-owner', picture: null });
    return json(res, 200, result);
  }

  if (method === 'GET' && url.pathname === '/me') {
    const user = requireUser(req, res);
    if (!user) return;
    return json(res, 200, authPayload(user));
  }

  if (method === 'POST' && url.pathname === '/auth/logout') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const session = findSession(token);
    if (session) {
      db.sessions = db.sessions.filter((candidate) => candidate !== session);
      saveDb();
    }
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && url.pathname === '/access/request-point') {
    const user = requireUser(req, res);
    if (!user) return;
    if (user.status === 'ACTIVE') return json(res, 400, { error: 'ALREADY_ACTIVE', message: 'Konto jest już aktywne.' });
    const body = await readBody(req);
    const pointName = cleanText(body.pointName, 90);
    const city = cleanText(body.city, 90);
    const requestedRole = String(body.requestedRole || 'USER').toUpperCase();
    const technicianSplitPercent = requestedRole === 'TECHNICIAN' ? normalizeTechnicianPercent(body.technicianSplitPercent) : null;
    if (!pointName || !city) return json(res, 400, { error: 'VALIDATION', message: 'Wpisz nazwę punktu i miasto.' });
    if (!REQUESTABLE_ROLES.has(requestedRole)) return json(res, 400, { error: 'ROLE', message: 'Wybierz prawidłową rolę.' });
    if (requestedRole === 'TECHNICIAN' && technicianSplitPercent === null) return json(res, 400, { error: 'TECHNICIAN_SPLIT', message: 'Ustaw swój procent rozliczenia serwisanta.' });
    user.requestedPoint = { pointName, city, requestedRole, technicianSplitPercent, requestedAt: nowIso() };
    user.status = 'PENDING';
    saveDb();
    return json(res, 200, authPayload(user));
  }

  if (method === 'GET' && url.pathname === '/admin/overview') {
    const owner = requireRole(req, res, ['OWNER']);
    if (!owner) return;
    const employeeUsers = db.users.filter((u) => !isOwnerIdentity(u));
    const pendingUsers = employeeUsers.filter((u) => u.status === 'PENDING').map(publicUser);
    const users = employeeUsers.map(publicUser);
    const logins = db.loginEvents.slice(0, 100).map((event)=>({
      ...event,
      email:event.role==='OWNER'?null:event.email,
      name:event.role==='OWNER'?OWNER_OPERATIONAL_NAME:event.name
    }));
    const pendingRevenue = db.revenueEntries.filter((r) => r.status === 'PENDING').map(revenueView);
    const activeSessions=db.sessions.filter((session)=>Number(session.expiresAt)>Date.now()&&Number(session.absoluteExpiresAt||session.expiresAt)>Date.now()).length;
    return json(res, 200, {
      points: db.points.map(pointSummary),
      users,
      pendingUsers: pendingUsers.filter((user)=>!user.blocked),
      blockedUsers: users.filter((user)=>user.blocked),
      loginEvents: logins,
      pendingRevenue,
      system:{activeSessions,desktopSessions:activeSessions,webSessions:0,servicePoints:db.points.length,openTransfers:0,blockedUsers:users.filter((user)=>user.blocked).length}
    });
  }

  if (method === 'GET' && url.pathname === '/admin/audit') {
    const owner = requireRole(req, res, ['OWNER']);
    if (!owner) return;
    const userId = cleanText(url.searchParams.get('userId') || '',80);
    const pointId = cleanText(url.searchParams.get('pointId') || '',80);
    const action = cleanText(url.searchParams.get('action') || '',120).toLowerCase();
    const orderNumber = Number(url.searchParams.get('orderNumber') || 0);
    const dateFrom = url.searchParams.get('dateFrom') ? new Date(url.searchParams.get('dateFrom')) : null;
    const dateTo = url.searchParams.get('dateTo') ? new Date(url.searchParams.get('dateTo') + 'T23:59:59.999Z') : null;
    const events = (db.auditLog || []).filter((event) => {
      if (userId && event.actorUserId !== userId) return false;
      if (pointId && event.pointId !== pointId) return false;
      if (action && !String(event.action || '').toLowerCase().includes(action)) return false;
      if (Number.isFinite(orderNumber) && orderNumber > 0 && Number(event.metadata?.orderNumber || 0) !== orderNumber) return false;
      const time = new Date(event.createdAt).getTime();
      if (dateFrom && !Number.isNaN(dateFrom.getTime()) && time < dateFrom.getTime()) return false;
      if (dateTo && !Number.isNaN(dateTo.getTime()) && time > dateTo.getTime()) return false;
      return true;
    }).slice(0,300).map((event) => ({
      ...event,
      actorName:event.actorRole==='OWNER'?OWNER_OPERATIONAL_NAME:event.actorName,
      actorEmail:null, pointName:db.points.find((point)=>point.id===event.pointId)?.name || null,
      before:event.metadata?.before ?? event.metadata?.from ?? null,
      after:event.metadata?.after ?? event.metadata?.to ?? null,
      orderNumber:event.metadata?.orderNumber ?? null,
      customerSummary:event.metadata?.customerSummary ?? null,
      deviceSummary:event.metadata?.deviceSummary ?? null,
      notificationStatus:event.metadata?.notification?.status ?? null,
      transferStatus:event.metadata?.transferStatus ?? null,
      settlementStatus:event.metadata?.settlementStatus ?? null,
      clientType:event.metadata?.clientType ?? 'DESKTOP'
    }));
    return json(res,200,{events});
  }

  if (method === 'POST' && url.pathname === '/admin/points') {
    const owner = requireRole(req, res, ['OWNER']);
    if (!owner) return;
    const body = await readBody(req);
    const name = cleanText(body.name, 90);
    const city = cleanText(body.city, 90);
    if (!name || !city) return json(res, 400, { error: 'VALIDATION', message: 'Wpisz nazwę punktu i miasto.' });
    const existing = db.points.find((p) => p.name.toLowerCase() === name.toLowerCase() && p.city.toLowerCase() === city.toLowerCase());
    if (existing) return json(res, 200, pointSummary(existing));
    const point = { id: id('pnt'), name, city, active: true, createdAt: nowIso() };
    db.points.push(point);
    saveDb();
    return json(res, 201, pointSummary(point));
  }

  const approveMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/approve$/);
  if (method === 'POST' && approveMatch) {
    const owner = requireRole(req, res, ['OWNER']);
    if (!owner) return;
    const target = findUserById(approveMatch[1]);
    if (!target) return json(res, 404, { error: 'NOT_FOUND', message: 'Nie znaleziono użytkownika.' });
    const body = await readBody(req);
    const role = String(body.role || target.requestedPoint?.requestedRole || 'USER');
    if (!REQUESTABLE_ROLES.has(role)) return json(res, 400, { error: 'ROLE', message: 'Nieprawidłowa rola.' });

    let pointIds = Array.isArray(body.pointIds) ? body.pointIds.filter((value) => db.points.some((p) => p.id === value)) : [];
    if (body.createRequestedPoint === true && target.requestedPoint) {
      const request = target.requestedPoint;
      let point = db.points.find((p) => p.name.toLowerCase() === request.pointName.toLowerCase() && p.city.toLowerCase() === request.city.toLowerCase());
      if (!point) {
        point = { id: id('pnt'), name: request.pointName, city: request.city, active: true, createdAt: nowIso() };
        db.points.push(point);
      }
      pointIds = [point.id];
    }

    if (!GLOBAL_ROLES.has(role) && pointIds.length === 0) {
      return json(res, 400, { error: 'POINT_REQUIRED', message: 'Ta rola wymaga przypisania co najmniej jednego punktu.' });
    }

    target.role = role;
    target.supportEnabled = body.supportEnabled === true;
    if (role === 'TECHNICIAN' && target.requestedPoint?.requestedRole === 'TECHNICIAN') {
      target.technicianSplitPercent = target.requestedPoint.technicianSplitPercent ?? null;
    }
    target.status = 'ACTIVE';
    target.pointIds = GLOBAL_ROLES.has(role) ? [] : pointIds;
    target.requestedPoint = null;
    saveDb();
    return json(res, 200, authPayload(target));
  }

  const rejectMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/reject$/);
  if (method === 'POST' && rejectMatch) {
    const owner = requireRole(req, res, ['OWNER']);
    if (!owner) return;
    const target = findUserById(rejectMatch[1]);
    if (!target) return json(res, 404, { error: 'NOT_FOUND' });
    if (target.role === 'OWNER') return json(res, 400, { error: 'OWNER_PROTECTED' });
    target.status = 'REJECTED';
    target.role = null;
    target.pointIds = [];
    saveDb();
    return json(res, 200, { ok: true });
  }

  const updateAccessMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/access$/);
  if (method === 'POST' && updateAccessMatch) {
    const owner = requireRole(req, res, ['OWNER']);
    if (!owner) return;
    const target = findUserById(updateAccessMatch[1]);
    if (!target) return json(res, 404, { error: 'NOT_FOUND' });
    if (target.role === 'OWNER') return json(res, 400, { error: 'OWNER_PROTECTED', message: 'Nie można zmienić roli głównego właściciela.' });
    const body = await readBody(req);
    const role = String(body.role || target.role || 'USER');
    if (!REQUESTABLE_ROLES.has(role)) return json(res, 400, { error: 'ROLE' });
    const pointIds = Array.isArray(body.pointIds) ? body.pointIds.filter((value) => db.points.some((p) => p.id === value)) : [];
    if (!GLOBAL_ROLES.has(role) && pointIds.length === 0) return json(res, 400, { error: 'POINT_REQUIRED', message: 'Wybierz co najmniej jeden punkt.' });
    const technicianSplitPercent = role === 'TECHNICIAN'
      ? normalizeTechnicianPercent(body.technicianSplitPercent ?? target.technicianSplitPercent)
      : null;
    if (role === 'TECHNICIAN' && technicianSplitPercent === null) return json(res, 400, { error: 'TECHNICIAN_SPLIT', message: 'Ustaw procent rozliczenia serwisanta.' });
    target.role = role;
    target.supportEnabled = body.supportEnabled === true;
    target.technicianSplitPercent = technicianSplitPercent;
    target.status = 'ACTIVE';
    target.pointIds = GLOBAL_ROLES.has(role) ? [] : pointIds;
    saveDb();
    localAudit(owner,'USER_ACCESS_UPDATED','user',target.id,null,{role,pointIds,technicianSplitPercent:target.technicianSplitPercent,supportEnabled:target.supportEnabled});
    return json(res, 200, authPayload(target));
  }


  const blockUserMatch=url.pathname.match(/^\/admin\/users\/([^/]+)\/block$/);
  if(method==='POST'&&blockUserMatch){
    const owner=requireRole(req,res,['OWNER']);if(!owner)return;
    const target=findUserById(blockUserMatch[1]);if(!target)return json(res,404,{error:'NOT_FOUND'});
    if(target.role==='OWNER')return json(res,400,{error:'OWNER_PROTECTED',message:'Konta właściciela nie można zablokować.'});
    const body=await readBody(req),blocked=body.blocked!==false;
    if(blocked){
      target.blockedAt=nowIso();target.blockedReason=cleanText(body.reason,500)||null;
      db.sessions=db.sessions.filter((session)=>session.userId!==target.id);
      localAudit(owner,'USER_BLOCKED','user',target.id,null,{reason:target.blockedReason});
    }else{
      target.blockedAt=null;target.blockedReason=null;
      localAudit(owner,'USER_UNBLOCKED','user',target.id);
    }
    saveDb();
    return json(res,200,publicUser(target));
  }

  const logoutUserMatch=url.pathname.match(/^\/admin\/users\/([^/]+)\/logout-all$/);
  if(method==='POST'&&logoutUserMatch){
    const owner=requireRole(req,res,['OWNER']);if(!owner)return;
    const target=findUserById(logoutUserMatch[1]);if(!target)return json(res,404,{error:'NOT_FOUND'});
    const before=db.sessions.length;
    db.sessions=db.sessions.filter((session)=>session.userId!==target.id || target.id===owner.id);
    const revoked=before-db.sessions.length;
    saveDb();localAudit(owner,'USER_SESSIONS_REVOKED','user',target.id,null,{revoked});
    return json(res,200,{ok:true,revoked});
  }

  if(method==='POST'&&url.pathname==='/admin/logout-all'){
    const owner=requireRole(req,res,['OWNER']);if(!owner)return;
    const before=db.sessions.length;
    const currentOwnerIds=new Set(db.sessions.filter((session)=>session.userId===owner.id).map((session)=>session.tokenHash));
    db.sessions=db.sessions.filter((session)=>session.userId===owner.id && currentOwnerIds.has(session.tokenHash));
    const revoked=before-db.sessions.length;
    saveDb();localAudit(owner,'ALL_SESSIONS_REVOKED','auth_session',null,null,{revoked});
    return json(res,200,{ok:true,revoked,exceptCurrent:true});
  }

  if (method === 'GET' && url.pathname === '/service/customers/search') {
    const user = requireActive(req, res);
    if (!user) return;
    if (!SERVICE_READ_ROLES.has(user.role)) return json(res, 403, { error: 'FORBIDDEN', message: 'Brak uprawnień do danych klientów.' });
    const query = cleanText(url.searchParams.get('q') || '', 120).toLowerCase();
    if (query.length < 2) return json(res, 200, []);

    const visibleCustomerIds = GLOBAL_ROLES.has(user.role)
      ? null
      : new Set(
          db.serviceOrders
            .filter((order) => canSeePoint(user, order.pointId))
            .map((order) => order.customerId)
        );

    const matches = db.customers
      .filter((customer) => {
        if (visibleCustomerIds && !visibleCustomerIds.has(customer.id)) return false;
        const haystack = [
          customer.firstName,
          customer.lastName,
          customer.email || '',
          customer.phone || ''
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 20)
      .map(customerView);

    return json(res, 200, matches);
  }

  if (method === 'GET' && url.pathname === '/service/technicians') {
    const user = requireActive(req, res);
    if (!user) return;
    if (!SERVICE_MANAGE_ROLES.has(user.role)) return json(res, 403, { error: 'FORBIDDEN' });
    const pointId = cleanText(url.searchParams.get('pointId'), 80);
    if (!pointId || !canSeePoint(user, pointId)) return json(res, 403, { error: 'POINT' });
    const technicians = db.users
      .filter((candidate) =>
        candidate.role === 'TECHNICIAN' &&
        candidate.status === 'ACTIVE' &&
        (candidate.pointIds || []).includes(pointId)
      )
      .map((candidate) => ({ id: candidate.id, name: candidate.name, email: candidate.email }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    return json(res, 200, technicians);
  }

  const localCustomerDetail = url.pathname.match(/^\/service\/customers\/([^/]+)$/);
  if (method === 'GET' && localCustomerDetail) {
    const user = requireActive(req, res);
    if (!user) return;
    if (!SERVICE_READ_ROLES.has(user.role)) return json(res, 403, { error: 'FORBIDDEN' });
    const customer = db.customers.find((item) => item.id === localCustomerDetail[1]);
    if (!customer) return json(res, 404, { error: 'NOT_FOUND' });
    const orders = db.serviceOrders
      .filter((order) => order.customerId === customer.id && canSeePoint(user, order.pointId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100)
      .map((order) => localOrderViewForUser(order, user));
    if (!GLOBAL_ROLES.has(user.role) && orders.length === 0) return json(res, 404, { error: 'NOT_FOUND' });
    const devices = [...new Map(orders.map((order) => [order.deviceId, {
      id: order.deviceId,
      brand: order.brand,
      model: order.model,
      imei: order.imei || null,
      serialNumber: order.serialNumber || null,
      notes: order.deviceNotes || null
    }])).values()];
    return json(res, 200, {
      customer: { ...customerView(customer), createdAt: customer.createdAt, updatedAt: customer.updatedAt },
      devices,
      orders,
      totalVisibleOrders: orders.length
    });
  }

  if (method === 'POST' && url.pathname === '/service/orders') {
    const user = requireActive(req, res);
    if (!user) return;
    if (!SERVICE_CREATE_ROLES.has(user.role)) return json(res, 403, { error: 'FORBIDDEN', message: 'Brak uprawnień do tworzenia zleceń.' });

    const body = await readBody(req);
    const pointId = cleanText(body.pointId, 80);
    if (!pointId || !canSeePoint(user, pointId)) {
      return json(res, 403, { error: 'POINT', message: 'Nie masz dostępu do wybranego punktu.' });
    }

    const firstName = cleanText(body.firstName, 80);
    const lastName = cleanText(body.lastName, 100);
    const email = normalizeEmail(cleanText(body.email, 180));
    const phone = cleanText(body.phone, 50);
    const phoneNormalized = normalizePhone(phone);
    const brand = cleanText(body.brand, 80);
    const model = cleanText(body.model, 120);
    const imei = cleanText(body.imei, 32).replace(/\s+/g, '');
    const serialNumber = cleanText(body.serialNumber, 120);
    const deviceNotes = cleanText(body.deviceNotes, 1000);
    const issueDescription = cleanText(body.issueDescription, 2000);
    const orderType = String(body.orderType || 'REPAIR').toUpperCase();
    const handlingMode = orderType === 'COMPLAINT' ? 'COMPLAINT_FLOW' : 'STANDARD';
    const canEditWorkflow = SERVICE_EDIT_ROLES.has(user.role);
    const etaText = canEditWorkflow ? cleanText(body.estimatedCompletionAt, 64) : '';
    let estimatedCompletionAt = null;
    if (etaText) {
      const eta = new Date(etaText);
      if (Number.isNaN(eta.getTime())) return json(res, 400, { error: 'ETA', message: 'Nieprawidłowy przewidywany termin.' });
      estimatedCompletionAt = eta.toISOString();
    }
    const canManage = SERVICE_MANAGE_ROLES.has(user.role);
    let assignedTechnicianId = user.role === 'TECHNICIAN'
      ? user.id
      : (canManage ? (cleanText(body.assignedTechnicianId, 80) || null) : null);
    let estimatedCost = null;
    if (!SERVICE_EDIT_ROLES.has(user.role) && body.estimatedCost !== undefined && body.estimatedCost !== '') return json(res, 403, { error:'FORBIDDEN', message:'Brak uprawnień do danych kosztowych zlecenia.' });
    if (SERVICE_EDIT_ROLES.has(user.role) && body.estimatedCost !== undefined && body.estimatedCost !== '') {
      estimatedCost = Number(body.estimatedCost);
      if (!Number.isFinite(estimatedCost) || estimatedCost < 0) return json(res, 400, { error: 'ESTIMATED_COST', message: 'Nieprawidłowy koszt szacowany.' });
    }

    if (!firstName || !lastName || !brand || !model || !issueDescription) {
      return json(res, 400, { error: 'VALIDATION', message: 'Uzupełnij klienta, markę, model i opis usterki.' });
    }
    if (!email || !phoneNormalized) {
      return json(res, 400, { error: 'CONTACT_REQUIRED', message: 'Podaj adres e-mail i numer telefonu klienta.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { error: 'EMAIL', message: 'Adres e-mail klienta jest nieprawidłowy.' });
    }
    if (phone && phoneNormalized.length < 7) {
      return json(res, 400, { error: 'PHONE', message: 'Numer telefonu klienta jest zbyt krótki.' });
    }
    if (imei && !/^\d{14,16}$/.test(imei)) {
      return json(res, 400, { error: 'IMEI', message: 'IMEI powinien zawierać 14–16 cyfr.' });
    }
    if (assignedTechnicianId && user.role !== 'TECHNICIAN') {
      const technician = db.users.find((candidate) =>
        candidate.id === assignedTechnicianId &&
        candidate.role === 'TECHNICIAN' &&
        candidate.status === 'ACTIVE' &&
        (candidate.pointIds || []).includes(pointId)
      );
      if (!technician) return json(res, 400, { error: 'TECHNICIAN', message: 'Wybrany technik nie ma dostępu do tego punktu.' });
    }
    if (!['REPAIR', 'COMPLAINT'].includes(orderType)) {
      return json(res, 400, { error: 'ORDER_TYPE', message: 'Nieprawidłowy typ zlecenia.' });
    }

    let customer = db.customers.find((candidate) =>
      (email && normalizeEmail(candidate.email || '') === email) ||
      (phoneNormalized && normalizePhone(candidate.phone || '') === phoneNormalized)
    );
    const reusedCustomer = Boolean(customer);

    if (!customer) {
      customer = {
        id: id('cst'),
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        phoneNormalized: phoneNormalized || null,
        createdByUserId: user.id,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.customers.push(customer);
    } else {
      customer.firstName = firstName || customer.firstName;
      customer.lastName = lastName || customer.lastName;
      if (email) customer.email = email;
      if (phone) customer.phone = phone;
      if (phoneNormalized) customer.phoneNormalized = phoneNormalized;
      customer.updatedAt = nowIso();
    }

    let device = null;
    if (imei) {
      const byImei = db.devices.find((candidate) => candidate.imei === imei);
      if (byImei && byImei.customerId !== customer.id) {
        return json(res, 409, { error: 'IMEI_CONFLICT', message: 'Urządzenie z tym IMEI jest przypisane do innego klienta.' });
      }
      device = byImei || null;
    }
    if (!device && serialNumber) {
      device = db.devices.find((candidate) =>
        candidate.customerId === customer.id &&
        String(candidate.brand || '').toLowerCase() === brand.toLowerCase() &&
        String(candidate.model || '').toLowerCase() === model.toLowerCase() &&
        String(candidate.serialNumber || '').toLowerCase() === serialNumber.toLowerCase()
      ) || null;
    }
    const reusedDevice = Boolean(device);
    if (!device) {
      device = {
        id: id('dev'),
        customerId: customer.id,
        brand,
        model,
        imei: imei || null,
        serialNumber: serialNumber || null,
        notes: deviceNotes || null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.devices.push(device);
    } else {
      device.brand = brand;
      device.model = model;
      if (imei) device.imei = imei;
      if (serialNumber) device.serialNumber = serialNumber;
      if (deviceNotes) device.notes = deviceNotes;
      device.updatedAt = nowIso();
    }

    const order = {
      id: id('srv'),
      orderNumber: db.serviceOrders.reduce((max, item) => Math.max(max, Number(item.orderNumber) || 0), 0) + 1,
      pointId,
      customerId: customer.id,
      deviceId: device.id,
      orderType,
      handlingMode,
      issueDescription,
      status: 'RECEIVED',
      assignedTechnicianId,
      createdByUserId: user.id,
      estimatedCost,
      finalCost: null,
      currency: 'PLN',
      estimatedCompletionAt,
      receivedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.serviceOrders.unshift(order);
    db.serviceOrderStatusHistory.push({
      id: id('hst'),
      serviceOrderId: order.id,
      fromStatus: null,
      toStatus: 'RECEIVED',
      changedByUserId: user.id,
      createdAt: nowIso()
    });

    saveDb();
    return json(res, 201, {
      customer: customerView(customer),
      order,
      reusedCustomer,
      reusedDevice
    });
  }


  if (method === 'GET' && url.pathname === '/service/orders') {
    const user = requireActive(req, res);
    if (!user) return;
    if (!SERVICE_READ_ROLES.has(user.role)) return json(res, 403, { error: 'FORBIDDEN', message: 'Brak uprawnień do zleceń.' });
    const orders = db.serviceOrders
      .filter((order) => canSeePoint(user, order.pointId))
      .map((order) => localOrderViewForUser(order, user));
    return json(res, 200, orders);
  }


  if (method === 'GET' && url.pathname === '/service/technician-workspace') {
    const user=requireActive(req,res);if(!user)return;
    if(user.role!=='TECHNICIAN')return json(res,403,{error:'TECHNICIAN_ONLY',message:'Ten widok jest przeznaczony dla serwisanta.'});
    const orders=db.serviceOrders
      .filter((order)=>order.assignedTechnicianId===user.id&&!['COMPLETED','CANCELLED','REJECTED'].includes(order.status)&&canSeePoint(user,order.pointId))
      .map((order)=>localOrderViewForUser(order,user));
    const now=Date.now();
    const counts={
      active:orders.length,
      received:orders.filter((order)=>order.status==='RECEIVED').length,
      diagnosis:orders.filter((order)=>order.status==='DIAGNOSIS').length,
      waitingParts:orders.filter((order)=>order.status==='WAITING_PARTS').length,
      inRepair:orders.filter((order)=>order.status==='IN_REPAIR').length,
      readyForPickup:orders.filter((order)=>['REPAIR_DONE','READY'].includes(order.status)).length,
      overdue:orders.filter((order)=>order.estimatedCompletionAt&&new Date(order.estimatedCompletionAt).getTime()<now).length
    };
    return json(res,200,{technician:{id:user.id,name:user.name,email:user.email},counts,orders,generatedAt:nowIso()});
  }

  if ((method === 'GET' || method === 'POST') && url.pathname === '/service/technician-notes') {
    const user=requireActive(req,res);if(!user)return;
    if(user.role!=='TECHNICIAN')return json(res,403,{error:'TECHNICIAN_ONLY',message:'Prywatny pokój notatek jest dostępny dla serwisanta.'});
    if(method==='GET'){
      const notes=db.technicianPrivateNotes.filter((item)=>item.userId===user.id).sort((a,b)=>(Number(b.pinned)-Number(a.pinned))||String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return json(res,200,notes);
    }
    const body=await readBody(req),title=cleanText(body.title,120),note=cleanText(body.body,4000),pinned=body.pinned===true;
    if(!note)return json(res,400,{error:'NOTE_REQUIRED',message:'Notatka nie może być pusta.'});
    const created={id:id('tnn'),userId:user.id,title,body:note,pinned,createdAt:nowIso(),updatedAt:nowIso()};
    db.technicianPrivateNotes.push(created);localAudit(user,'TECHNICIAN_PRIVATE_NOTE_CREATED','technician_note',created.id,null,{pinned,length:note.length});saveDb();
    return json(res,201,created);
  }

  const localTechnicianNoteDelete=url.pathname.match(/^\/service\/technician-notes\/([^/]+)$/);
  if(method==='DELETE'&&localTechnicianNoteDelete){
    const user=requireActive(req,res);if(!user)return;
    if(user.role!=='TECHNICIAN')return json(res,403,{error:'TECHNICIAN_ONLY'});
    const before=db.technicianPrivateNotes.length;
    db.technicianPrivateNotes=db.technicianPrivateNotes.filter((item)=>!(item.id===localTechnicianNoteDelete[1]&&item.userId===user.id));
    if(db.technicianPrivateNotes.length===before)return json(res,404,{error:'NOT_FOUND'});
    localAudit(user,'TECHNICIAN_PRIVATE_NOTE_DELETED','technician_note',localTechnicianNoteDelete[1]);saveDb();
    return json(res,200,{ok:true});
  }

  const localCostingMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/costing$/);
  if(localCostingMatch&&(method==='GET'||method==='POST')){
    const user=requireActive(req,res);if(!user)return;
    if(!SERVICE_EDIT_ROLES.has(user.role))return json(res,403,{error:'SERVICE_FINANCE_FORBIDDEN'});
    const order=db.serviceOrders.find((item)=>item.id===localCostingMatch[1]);
    if(!order)return json(res,404,{error:'NOT_FOUND'});
    if(!canSeePoint(user,order.pointId))return json(res,403,{error:'POINT'});
    if(user.role==='TECHNICIAN'&&order.assignedTechnicianId!==user.id)return json(res,403,{error:'TECHNICIAN_ORDER_REQUIRED'});
    if(method==='POST'){
      const body=await readBody(req);
      const labor=Number(body.laborCostGross||0),other=Number(body.otherCostGross||0),parts=Array.isArray(body.parts)?body.parts:[];
      if(!Number.isFinite(labor)||labor<0||!Number.isFinite(other)||other<0||parts.length>100)return json(res,400,{error:'COSTING'});
      const normalized=[];
      for(const raw of parts){
        const description=cleanText(raw?.description,240),quantity=Number(raw?.quantity),unit=Number(raw?.unitCostGross);
        if(!description||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unit)||unit<0)return json(res,400,{error:'PARTS'});
        normalized.push({
          id:id('prt'),serviceOrderId:order.id,description,quantity,unitCostGross:unit,
          invoiceReceived:raw?.invoiceReceived===true,invoiceNumber:cleanText(raw?.invoiceNumber,120)||null,
          supplier:cleanText(raw?.supplier,180)||null,purchasedAt:cleanText(raw?.purchasedAt,10)||null,
          createdAt:nowIso(),updatedAt:nowIso()
        });
      }
      order.laborCostGross=labor;order.otherCostGross=other;
      db.serviceOrderParts=db.serviceOrderParts.filter((item)=>item.serviceOrderId!==order.id).concat(normalized);
      localAudit(user,'SERVICE_COSTING_UPDATED','service_order',order.id,order.pointId,{partsCount:normalized.length,laborCostGross:labor,otherCostGross:other});saveDb();
    }
    const parts=db.serviceOrderParts.filter((item)=>item.serviceOrderId===order.id).map((item)=>({...item,totalCostGross:Math.round(item.quantity*item.unitCostGross*100)/100}));
    const partsCostGross=Math.round(parts.reduce((sum,item)=>sum+item.totalCostGross,0)*100)/100;
    const laborCostGross=Number(order.laborCostGross||0),otherCostGross=Number(order.otherCostGross||0);
    const internalCostGross=Math.round((partsCostGross+laborCostGross+otherCostGross)*100)/100;
    const customerPrice=order.finalCost??order.estimatedCost??null;
    return json(res,200,{
      orderId:order.id,orderNumber:order.orderNumber,currency:order.currency||'PLN',parts,
      invoices:[],partsCostGross,laborCostGross,otherCostGross,internalCostGross,
      estimatedCost:order.estimatedCost??null,finalCost:order.finalCost??null,customerPrice,
      marginGross:customerPrice==null?null:Math.round((customerPrice-internalCostGross)*100)/100
    });
  }

  if(method==='GET'&&url.pathname==='/service/invoices'){
    const user=requireActive(req,res);if(!user)return;
    if(!SERVICE_EDIT_ROLES.has(user.role))return json(res,403,{error:'SERVICE_FINANCE_FORBIDDEN'});
    return json(res,200,{period:cleanText(url.searchParams.get('month')||new Date().toISOString().slice(0,7),7),invoices:[]});
  }
  if(method==='GET'&&url.pathname==='/service/invoices/monthly-prompt'){
    const user=requireActive(req,res);if(!user)return;
    return json(res,200,{show:false,period:null,count:0,dismissed:false});
  }
  if(method==='POST'&&url.pathname==='/service/invoices/monthly-prompt/dismiss'){
    const user=requireActive(req,res);if(!user)return;
    const body=await readBody(req);
    return json(res,200,{ok:true,period:cleanText(body.period,7)});
  }
  if(method==='POST'&&url.pathname==='/service/invoices/download-batch'){
    const user=requireActive(req,res);if(!user)return;
    if(!SERVICE_EDIT_ROLES.has(user.role))return json(res,403,{error:'SERVICE_FINANCE_FORBIDDEN'});
    const body=await readBody(req);
    return json(res,200,{period:cleanText(body.period,7),files:[],expiresInSeconds:0});
  }
  const localInvoiceUploadIntent=url.pathname.match(/^\/service\/orders\/([^/]+)\/invoices\/upload-intent$/);
  if(method==='POST'&&localInvoiceUploadIntent){
    const user=requireActive(req,res);if(!user)return;
    return json(res,503,{error:'INVOICE_STORAGE_UNAVAILABLE',message:'Lokalny backend developerski nie przechowuje PDF. Użyj centralnego API Neon do testowania magazynu faktur.'});
  }

  const serviceHistoryMatch = url.pathname.match(/^\/service\/orders\/([^/]+)\/history$/);
  if (method === 'GET' && serviceHistoryMatch) {
    const user = requireActive(req, res);
    if (!user) return;
    if (!SERVICE_READ_ROLES.has(user.role)) {
      return json(res, 403, { error: 'FORBIDDEN', message: 'Brak uprawnień do historii zlecenia.' });
    }
    const order = db.serviceOrders.find((item) => item.id === serviceHistoryMatch[1]);
    if (!order) return json(res, 404, { error: 'NOT_FOUND' });
    if (!canSeePoint(user, order.pointId)) return json(res, 403, { error: 'POINT' });

    const labels = {
      RECEIVED: 'Przyjęto urządzenie',
      DIAGNOSIS: 'Diagnoza',
      WAITING_PARTS: 'Oczekiwanie na części',
      IN_REPAIR: 'W naprawie',
      READY: 'Gotowe do odbioru',
      COMPLETED: 'Zakończone',
      CANCELLED: 'Anulowane',
      REJECTED: 'Odrzucone'
    };
    const history = db.serviceOrderStatusHistory
      .filter((item) => item.serviceOrderId === order.id)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((item) => {
        const changedBy = db.users.find((candidate) => candidate.id === item.changedByUserId);
        return {
          id: item.id,
          fromStatus: item.fromStatus || null,
          fromLabel: item.fromStatus ? (labels[item.fromStatus] || item.fromStatus) : null,
          toStatus: item.toStatus,
          toLabel: labels[item.toStatus] || item.toStatus,
          note: item.note || null,
          changedAt: item.createdAt,
          changedByUserId: item.changedByUserId || null,
          changedByName: operationalIdentityName(changedBy) || 'System'
        };
      });
    return json(res, 200, history);
  }

  const localNotesMatch = url.pathname.match(/^\/service\/orders\/([^/]+)\/notes$/);
  if (localNotesMatch && (method === 'GET' || method === 'POST')) {
    const user = requireActive(req, res);
    if (!user) return;
    if (!SERVICE_READ_ROLES.has(user.role)) return json(res, 403, { error: 'FORBIDDEN' });
    const order = db.serviceOrders.find((item) => item.id === localNotesMatch[1]);
    if (!order) return json(res, 404, { error: 'NOT_FOUND' });
    if (!canSeePoint(user, order.pointId)) return json(res, 403, { error: 'POINT' });

    if (method === 'GET') {
      if (!SERVICE_EDIT_ROLES.has(user.role)) return json(res, 403, { error:'FORBIDDEN', message:'Brak uprawnień do notatek wewnętrznych zlecenia.' });
      const notes = db.serviceOrderNotes
        .filter((item) => item.serviceOrderId === order.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((item) => {
          const author = findUserById(item.authorUserId);
          return {
            id: item.id,
            body: item.body,
            createdAt: item.createdAt,
            authorUserId: item.authorUserId,
            authorName: operationalIdentityName(author) || 'Użytkownik'
          };
        });
      return json(res, 200, notes);
    }

    if (!SERVICE_EDIT_ROLES.has(user.role)) return json(res, 403, { error: 'FORBIDDEN' });
    const body = await readBody(req);
    const note = cleanText(body.body, 2000);
    if (!note) return json(res, 400, { error: 'NOTE_REQUIRED', message: 'Notatka nie może być pusta.' });
    const created = { id: id('not'), serviceOrderId: order.id, authorUserId: user.id, body: note, createdAt: nowIso() };
    db.serviceOrderNotes.push(created);
    saveDb();
    return json(res, 201, { ...created, authorName: operationalIdentityName(user) });
  }

  const localDetailsMatch = url.pathname.match(/^\/service\/orders\/([^/]+)\/details$/);
  if (method === 'POST' && localDetailsMatch) {
    const user = requireActive(req, res);
    if (!user) return;
    if (!SERVICE_INTAKE_EDIT_ROLES.has(user.role)) return json(res, 403, { error: 'FORBIDDEN' });
    const order = db.serviceOrders.find((item) => item.id === localDetailsMatch[1]);
    if (!order) return json(res, 404, { error: 'NOT_FOUND' });
    if (!canSeePoint(user, order.pointId)) return json(res, 403, { error: 'POINT' });
    const device = db.devices.find((item) => item.id === order.deviceId);
    if (!device) return json(res, 404, { error: 'DEVICE_NOT_FOUND' });

    const body = await readBody(req);
    const imei = cleanText(body.imei, 32).replace(/\s+/g, '');
    const serialNumber = cleanText(body.serialNumber, 120);
    const deviceNotes = cleanText(body.deviceNotes, 1000);
    if (imei && !/^\d{14,16}$/.test(imei)) return json(res, 400, { error: 'IMEI', message: 'IMEI powinien zawierać 14–16 cyfr.' });
    const otherDevice = imei ? db.devices.find((item) => item.imei === imei && item.id !== device.id) : null;
    if (otherDevice) return json(res, 409, { error: 'IMEI_CONFLICT', message: 'Ten IMEI jest już przypisany do innego urządzenia.' });

    const etaText = SERVICE_EDIT_ROLES.has(user.role) ? cleanText(body.estimatedCompletionAt, 64) : '';
    let estimatedCompletionAt = null;
    if (etaText) {
      const eta = new Date(etaText);
      if (Number.isNaN(eta.getTime())) return json(res, 400, { error: 'ETA', message: 'Nieprawidłowy przewidywany termin.' });
      estimatedCompletionAt = eta.toISOString();
    }

    const canManageAssignment = SERVICE_MANAGE_ROLES.has(user.role);
    const canEditWorkflow = SERVICE_EDIT_ROLES.has(user.role);
    const canEditCosts = SERVICE_EDIT_ROLES.has(user.role);
    if (!canEditWorkflow && 'estimatedCompletionAt' in body && body.estimatedCompletionAt) return json(res, 403, { error:'FORBIDDEN', message:'Rola USER nie może zmieniać terminu realizacji.' });
    if (!canEditCosts && ('estimatedCost' in body || 'finalCost' in body)) return json(res, 403, { error:'FORBIDDEN', message:'Brak uprawnień do danych kosztowych zlecenia.' });
    if (!canManageAssignment && 'assignedTechnicianId' in body) {
      return json(res, 403, { error: 'FORBIDDEN', message: 'Tylko kierownictwo punktu może zmieniać przypisanego technika.' });
    }

    if (canManageAssignment) {
      const assignedTechnicianId = cleanText(body.assignedTechnicianId, 80) || null;
      if (assignedTechnicianId) {
        const technician = db.users.find((candidate) =>
          candidate.id === assignedTechnicianId &&
          candidate.role === 'TECHNICIAN' &&
          candidate.status === 'ACTIVE' &&
          (candidate.pointIds || []).includes(order.pointId)
        );
        if (!technician) return json(res, 400, { error: 'TECHNICIAN', message: 'Wybrany technik nie ma dostępu do tego punktu.' });
      }
      order.assignedTechnicianId = assignedTechnicianId;
    }
    if (canEditCosts && 'estimatedCost' in body) {
      const estimatedCost = body.estimatedCost == null || body.estimatedCost === '' ? null : Number(body.estimatedCost);
      if (estimatedCost != null && (!Number.isFinite(estimatedCost) || estimatedCost < 0)) return json(res, 400, { error: 'ESTIMATED_COST' });
      order.estimatedCost = estimatedCost;
    }
    if (canEditCosts && 'finalCost' in body) {
      const finalCost = body.finalCost == null || body.finalCost === '' ? null : Number(body.finalCost);
      if (finalCost != null && (!Number.isFinite(finalCost) || finalCost < 0)) return json(res, 400, { error: 'FINAL_COST' });
      order.finalCost = finalCost;
    }

    device.imei = imei || null;
    device.serialNumber = serialNumber || null;
    device.notes = deviceNotes || null;
    device.updatedAt = nowIso();
    order.estimatedCompletionAt = estimatedCompletionAt;
    order.updatedAt = nowIso();
    saveDb();
    return json(res, 200, localOrderView(order));
  }

  const serviceStatusMatch = url.pathname.match(/^\/service\/orders\/([^/]+)\/status$/);
  if (method === 'POST' && serviceStatusMatch) {
    const user = requireActive(req, res);
    if (!user) return;
    const order = db.serviceOrders.find((item) => item.id === serviceStatusMatch[1]);
    if (!order) return json(res, 404, { error: 'NOT_FOUND' });
    if (!canSeePoint(user, order.pointId)) return json(res, 403, { error: 'POINT' });
    const body = await readBody(req);
    const status = String(body.status || '').toUpperCase();
    if (!SERVICE_EDIT_ROLES.has(user.role) && !(user.role === 'USER' && status === 'CANCELLED')) {
      return json(res, 403, { error: 'FORBIDDEN', message: 'Brak uprawnień do zmiany statusu.' });
    }
    const allowed = ['RECEIVED', 'DIAGNOSIS', 'WAITING_PARTS', 'IN_REPAIR', 'REPAIR_DONE', 'READY', 'COMPLETED', 'CANCELLED', 'REJECTED'];
    if (!allowed.includes(status)) return json(res, 400, { error: 'STATUS' });
    if ((order.handlingMode || 'STANDARD') === 'TRANSFER_ONLY' && status !== order.status && status !== 'CANCELLED') {
      return json(res, 409, { error:'TRANSFER_ONLY_STATUS_LOCKED', message:'To zlecenie służy wyłącznie do przekazywania urządzenia. Możesz je tylko anulować.' });
    }
    if (status === 'READY' && order.status !== 'REPAIR_DONE') {
      return json(res, 409, { error:'REPAIR_DONE_REQUIRED', message:'Status „Gotowe do odbioru” można ustawić dopiero po zakończeniu naprawy.' });
    }
    if (status === 'COMPLETED' && order.status !== 'READY') {
      return json(res, 409, { error:'READY_REQUIRED', message:'Zlecenie można zakończyć dopiero po statusie „Gotowe do odbioru”.' });
    }
    const previous = order.status;
    order.status = status;
    order.updatedAt = nowIso();
    if (status === 'COMPLETED') order.completedAt = nowIso();
    db.serviceOrderStatusHistory.push({
      id: id('hst'),
      serviceOrderId: order.id,
      fromStatus: previous,
      toStatus: status,
      note: cleanText(body.note, 500) || null,
      changedByUserId: user.id,
      createdAt: nowIso()
    });
    saveDb();
    return json(res, 200, {
      order: localOrderView(order),
      notification: { queued: false, sent: false, reason: 'CENTRAL_API_REQUIRED' }
    });
  }

  if (method === 'GET' && url.pathname === '/integrations/gmail') {
    const user = requireActive(req, res);
    if (!user) return;
    const pointId = cleanText(url.searchParams.get('pointId'), 80);
    if (!canSeePoint(user, pointId)) return json(res, 403, { error: 'POINT' });
    return json(res, 200, { connected: false, pointId, status: 'CENTRAL_API_REQUIRED' });
  }

  if ((method === 'POST' && url.pathname === '/integrations/gmail/connect') ||
      (method === 'DELETE' && url.pathname === '/integrations/gmail')) {
    const user = requireActive(req, res);
    if (!user) return;
    return json(res, 409, {
      error: 'CENTRAL_API_REQUIRED',
      message: 'Połączenie Gmail jest dostępne w centralnym API. Ustaw LOCKON_API_URL na endpoint Neon podczas testu.'
    });
  }

  if (method === 'GET' && url.pathname === '/notifications/settings') {
    const user = requireActive(req, res);
    if (!user) return;
    const pointId = cleanText(url.searchParams.get('pointId'), 80);
    if (!canSeePoint(user, pointId)) return json(res, 403, { error: 'POINT' });
    let settings = db.notificationSettings.find((item) => item.pointId === pointId);
    if (!settings) {
      settings = {
        pointId,
        automaticEmailEnabled: true,
        notifyStatuses: ['RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','REPAIR_DONE','READY','COMPLETED','REJECTED'],
        senderDisplayName: 'LockOn ServiceOS',
        footerText: '',
        updatedAt: nowIso()
      };
      db.notificationSettings.push(settings);
      saveDb();
    }
    return json(res, 200, settings);
  }

  if (method === 'POST' && url.pathname === '/notifications/settings') {
    const user = requireActive(req, res);
    if (!user) return;
    if (!['OWNER','BOSS','COORDINATOR'].includes(user.role)) return json(res, 403, { error: 'FORBIDDEN' });
    const body = await readBody(req);
    const pointId = cleanText(body.pointId, 80);
    if (!canSeePoint(user, pointId)) return json(res, 403, { error: 'POINT' });
    const allowed = new Set(['RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','REPAIR_DONE','READY','COMPLETED','CANCELLED','REJECTED']);
    const notifyStatuses = Array.isArray(body.notifyStatuses)
      ? [...new Set(body.notifyStatuses.map((value) => String(value).toUpperCase()).filter((value) => allowed.has(value)))]
      : [];
    const next = {
      pointId,
      automaticEmailEnabled: body.automaticEmailEnabled !== false,
      notifyStatuses,
      senderDisplayName: cleanText(body.senderDisplayName || 'LockOn ServiceOS', 80),
      footerText: cleanText(body.footerText || '', 500),
      updatedAt: nowIso()
    };
    const index = db.notificationSettings.findIndex((item) => item.pointId === pointId);
    if (index >= 0) db.notificationSettings[index] = next;
    else db.notificationSettings.push(next);
    saveDb();
    return json(res, 200, { ok: true, ...next });
  }

  if (method === 'GET' && url.pathname === '/notifications/history') {
    const user = requireActive(req, res);
    if (!user) return;
    const pointId = cleanText(url.searchParams.get('pointId'), 80);
    if (!canSeePoint(user, pointId)) return json(res, 403, { error: 'POINT' });
    return json(res, 200, db.notificationHistory.filter((item) => item.pointId === pointId).slice(0, 100));
  }

  if (method === 'POST' && url.pathname === '/integrations/gmail/test') {
    const user = requireActive(req, res);
    if (!user) return;
    return json(res, 409, {
      error: 'CENTRAL_API_REQUIRED',
      message: 'Test Gmail wymaga centralnego API Neon.'
    });
  }

  const localRetryNotification = url.pathname.match(/^\/notifications\/([^/]+)\/retry$/);
  if (method === 'POST' && localRetryNotification) {
    const user = requireActive(req, res);
    if (!user) return;
    return json(res, 409, {
      error: 'CENTRAL_API_REQUIRED',
      message: 'Ponowienie wysyłki wymaga centralnego API Neon.'
    });
  }

  const localConversationFor = (userId) => {
    let conversation = db.supportConversations.find((item) => item.userId === userId && item.status === 'OPEN');
    if (!conversation) {
      conversation = {
        id:id('sup'), userId, pointId:null, status:'OPEN',
        assignedSupportUserId:null, consultantRequestedAt:null, consultantJoinedAt:null,
        createdAt:nowIso(), updatedAt:nowIso()
      };
      db.supportConversations.push(conversation);
    }
    return conversation;
  };
  const localSupportTarget = (value) =>
    String(value || '').trim().toUpperCase() === 'CONSULTANT' ? 'CONSULTANT' : 'BOT';
  const localSupportMessageView = (item) => ({
    id:item.id,
    author:item.author,
    text:item.text,
    action:item.action||null,
    target:item.target==='BOT'||item.target==='CONSULTANT'
      ? item.target
      : item.author==='assistant'
        ? 'BOT'
        : item.author==='support'
          ? 'CONSULTANT'
          : null,
    createdAt:item.createdAt
  });
  const localConversationPayload = (conversation) => ({
    id:conversation.id,
    status:conversation.status,
    consultantRequestedAt:conversation.consultantRequestedAt || null,
    consultantJoinedAt:conversation.consultantJoinedAt || conversation.takenAt || null,
    assignedSupportUserId:conversation.assignedSupportUserId || null,
    assignedSupportName:conversation.assignedSupportUserId ? supportIdentityName(findUserById(conversation.assignedSupportUserId)) : null,
    consultantState:conversation.assignedSupportUserId ? 'JOINED' : conversation.consultantRequestedAt ? 'WAITING' : 'BOT',
    messages:db.supportMessages
      .filter((item)=>item.conversationId===conversation.id)
      .map(localSupportMessageView)
  });

  if (method === 'GET' && url.pathname === '/support/conversation') {
    const user = requireActive(req, res);
    if (!user) return;
    const conversation = localConversationFor(user.id);
    if(conversation.assignedSupportUserId===user.id){
      conversation.assignedSupportUserId=null;
      conversation.takenAt=null;
      conversation.consultantRequestedAt=null;
      conversation.consultantJoinedAt=null;
      conversation.updatedAt=nowIso();
      db.supportMessages.push({
        id:id('msg'),conversationId:conversation.id,author:'system',
        text:'ServiceOS zakończył nieprawidłowe przypisanie własnej rozmowy do tego samego konta. Bot pozostaje dostępny.',
        target:'CONSULTANT',event:'SELF_ASSIGNMENT_REPAIR',createdAt:nowIso()
      });
      localAudit(user,'SUPPORT_SELF_ASSIGNMENT_REPAIRED','support_conversation',conversation.id,conversation.pointId,{});
    }
    saveDb();
    return json(res, 200, localConversationPayload(conversation));
  }

  if (method === 'POST' && url.pathname === '/support/request') {
    const user=requireActive(req,res);if(!user)return;
    const body=await readBody(req);
    const conversation=localConversationFor(user.id);
    const pointId=cleanText(body.pointId,80) || (user.pointIds||[])[0] || null;
    if(pointId&&!canSeePoint(user,pointId))return json(res,403,{error:'POINT_FORBIDDEN',message:'Brak dostępu do wybranego punktu.'});
    conversation.pointId=pointId;
    if(!conversation.consultantRequestedAt){
      conversation.consultantRequestedAt=nowIso();
      db.supportMessages.push({
        id:id('msg'),conversationId:conversation.id,author:'system',
        text:'Poproszono konsultanta o pomoc. Bot pozostaje dostępny niezależnie od kanału konsultanta.',
        target:'CONSULTANT',event:'CONSULTANT_REQUESTED',createdAt:nowIso()
      });
    }
    const note=cleanText(body.message,1500);
    if(note)db.supportMessages.push({id:id('msg'),conversationId:conversation.id,author:'user',text:note,target:'CONSULTANT',createdAt:nowIso()});
    conversation.updatedAt=nowIso();
    localAudit(user,'SUPPORT_REQUESTED','support_conversation',conversation.id,pointId,{});
    saveDb();
    return json(res,201,{ok:true,conversationId:conversation.id,pointId,consultantState:'WAITING'});
  }

  if (method === 'POST' && url.pathname === '/support/leave') {
    const user=requireActive(req,res);if(!user)return;
    const conversation=db.supportConversations
      .filter((item)=>item.userId===user.id&&item.status==='OPEN')
      .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]||null;
    if(!conversation)return json(res,200,{ok:true,consultantState:'BOT'});
    if(conversation.assignedSupportUserId||conversation.consultantRequestedAt){
      conversation.assignedSupportUserId=null;
      conversation.takenAt=null;
      conversation.consultantRequestedAt=null;
      conversation.consultantJoinedAt=null;
      conversation.updatedAt=nowIso();
      db.supportMessages.push({
        id:id('msg'),conversationId:conversation.id,author:'system',
        text:'Rozmowa z konsultantem została zakończona. Bot nadal jest dostępny.',
        target:'CONSULTANT',event:'CONSULTANT_LEFT',createdAt:nowIso()
      });
      localAudit(user,'SUPPORT_LEFT','support_conversation',conversation.id,conversation.pointId,{});
      saveDb();
    }
    return json(res,200,{ok:true,consultantState:'BOT'});
  }

  if (method === 'GET' && url.pathname === '/support/presence') {
    const support=requireSupportAccess(req,res);if(!support)return;
    const cutoff=Date.now()-10*60*1000;
    const global=GLOBAL_ROLES.has(support.role);
    const visiblePoints=new Set(support.pointIds||[]);
    const latestSessionByUser=new Map();
    for(const session of db.sessions){
      if(Number(session.expiresAt)<=Date.now()||Number(session.absoluteExpiresAt||session.expiresAt)<=Date.now()||Number(session.lastSeenAt||0)<cutoff)continue;
      const current=latestSessionByUser.get(session.userId);
      if(!current||Number(session.lastSeenAt||0)>Number(current.lastSeenAt||0))latestSessionByUser.set(session.userId,session);
    }
    const rows=db.users.filter((candidate)=>{
      if(candidate.id===support.id||candidate.status!=='ACTIVE'||candidate.blockedAt||!latestSessionByUser.has(candidate.id))return false;
      return global||candidate.role==='OWNER'||(candidate.pointIds||[]).some((pointId)=>visiblePoints.has(pointId));
    }).map((candidate)=>{
      const conversation=db.supportConversations.filter((item)=>item.userId===candidate.id&&item.status==='OPEN').sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]||null;
      const session=latestSessionByUser.get(candidate.id);
      return {
        userId:candidate.id,name:supportIdentityName(candidate),email:supportIdentityEmail(candidate),role:candidate.role||null,supportEnabled:candidate.supportEnabled===true,
        online:true,lastSeenAt:new Date(Number(session.lastSeenAt||Date.now())).toISOString(),clientTypes:['DESKTOP'],
        conversationId:conversation?.consultantRequestedAt?conversation.id:null,
        consultantState:conversation?.assignedSupportUserId?'JOINED':conversation?.consultantRequestedAt?'WAITING':'BOT',
        assignedSupportUserId:conversation?.assignedSupportUserId||null,
        assignedSupportName:conversation?.assignedSupportUserId?supportIdentityName(findUserById(conversation.assignedSupportUserId)):null,
        conversationUpdatedAt:conversation?.consultantRequestedAt?conversation.updatedAt:null
      };
    });
    return json(res,200,rows);
  }

  if (method === 'GET' && url.pathname === '/support/tickets') {
    const support=requireSupportAccess(req,res);if(!support)return;
    const global=GLOBAL_ROLES.has(support.role),visiblePoints=new Set(support.pointIds||[]);
    const tickets=db.supportConversations
      .filter((conversation)=>conversation.userId!==support.id && conversation.consultantRequestedAt && (global || !conversation.pointId || visiblePoints.has(conversation.pointId)))
      .sort((a,b)=>(a.status===b.status?String(b.updatedAt).localeCompare(String(a.updatedAt)):a.status==='OPEN'?-1:1))
      .slice(0,200)
      .map((conversation)=>{
        const owner=findUserById(conversation.userId);
        const point=db.points.find((item)=>item.id===conversation.pointId);
        return {
          id:conversation.id,userId:conversation.userId,userName:supportIdentityName(owner)||'Użytkownik',userEmail:supportIdentityEmail(owner),
          pointId:conversation.pointId||null,pointName:point?.name||'Brak punktu',status:conversation.status,
          assignedSupportUserId:conversation.assignedSupportUserId||null,
          assignedSupportName:conversation.assignedSupportUserId?supportIdentityName(findUserById(conversation.assignedSupportUserId)):null,
          consultantRequestedAt:conversation.consultantRequestedAt||null,consultantJoinedAt:conversation.consultantJoinedAt||conversation.takenAt||null,
          createdAt:conversation.createdAt,updatedAt:conversation.updatedAt,
          messages:db.supportMessages
            .filter((item)=>{
              if(item.conversationId!==conversation.id)return false;
              if(item.target==='CONSULTANT'||item.author==='support')return true;
              const joinedAt=conversation.consultantJoinedAt||conversation.takenAt||null;
              return item.author==='user'&&!item.target&&joinedAt&&new Date(item.createdAt).getTime()>=new Date(joinedAt).getTime();
            })
            .map(localSupportMessageView)
        };
      });
    return json(res,200,tickets);
  }

  const localSupportAction=url.pathname.match(/^\/support\/tickets\/([^/]+)\/(take|reply|close)$/);
  if(method==='POST'&&localSupportAction){
    const support=requireSupportAccess(req,res);if(!support)return;
    const conversation=db.supportConversations.find((item)=>item.id===localSupportAction[1]);
    if(!conversation)return json(res,404,{error:'NOT_FOUND'});
    if(conversation.userId===support.id)return json(res,409,{error:'SELF_SUPPORT_NOT_ALLOWED',message:'Nie możesz obsługiwać jako konsultant własnej rozmowy.'});
    if(conversation.pointId&&!GLOBAL_ROLES.has(support.role)&&!(support.pointIds||[]).includes(conversation.pointId))return json(res,403,{error:'POINT_FORBIDDEN'});
    const action=localSupportAction[2],body=await readBody(req);
    const assignedElsewhere=conversation.assignedSupportUserId&&conversation.assignedSupportUserId!==support.id;
    if(assignedElsewhere)return json(res,409,{error:'SUPPORT_ALREADY_ASSIGNED',message:'Ta rozmowa jest już obsługiwana przez innego konsultanta.'});
    if(action==='take'){
      if(!conversation.consultantRequestedAt)return json(res,409,{error:'CONSULTANT_NOT_REQUESTED'});
      const firstJoin=!conversation.assignedSupportUserId;
      conversation.assignedSupportUserId=support.id;
      conversation.takenAt=conversation.takenAt||nowIso();
      conversation.consultantJoinedAt=conversation.consultantJoinedAt||nowIso();
      if(firstJoin)db.supportMessages.push({
        id:id('msg'),conversationId:conversation.id,author:'system',
        text:(supportIdentityName(support)||'Konsultant')+' dołączył do rozmowy. Bot nadal działa równolegle.',
        target:'CONSULTANT',event:'CONSULTANT_JOINED',createdAt:nowIso()
      });
      localAudit(support,'SUPPORT_TAKEN','support_conversation',conversation.id,conversation.pointId,{firstJoin});
    }else if(action==='reply'){
      const message=cleanText(body.message,2000);if(!message)return json(res,400,{error:'MESSAGE'});
      if(conversation.status!=='OPEN')return json(res,409,{error:'TICKET_CLOSED'});
      if(!conversation.consultantRequestedAt)return json(res,409,{error:'CONSULTANT_NOT_REQUESTED'});
      const firstJoin=!conversation.assignedSupportUserId;
      if(firstJoin){
        conversation.assignedSupportUserId=support.id;
        conversation.takenAt=conversation.takenAt||nowIso();
        conversation.consultantJoinedAt=conversation.consultantJoinedAt||nowIso();
        db.supportMessages.push({
          id:id('msg'),conversationId:conversation.id,author:'system',
          text:(supportIdentityName(support)||'Konsultant')+' dołączył do rozmowy. Bot nadal działa równolegle.',
          target:'CONSULTANT',event:'CONSULTANT_JOINED',createdAt:nowIso()
        });
      }
      db.supportMessages.push({id:id('msg'),conversationId:conversation.id,author:'support',text:message,target:'CONSULTANT',createdAt:nowIso()});
      localAudit(support,'SUPPORT_REPLIED','support_conversation',conversation.id,conversation.pointId,{firstJoin});
    }else{
      conversation.assignedSupportUserId=null;
      conversation.takenAt=null;
      conversation.consultantRequestedAt=null;
      conversation.consultantJoinedAt=null;
      db.supportMessages.push({
        id:id('msg'),conversationId:conversation.id,author:'system',
        text:'Konsultant zakończył kanał rozmowy. Bot nadal jest dostępny.',
        target:'CONSULTANT',event:'CONSULTANT_CLOSED',createdAt:nowIso()
      });
      localAudit(support,'SUPPORT_CLOSED','support_conversation',conversation.id,conversation.pointId,{});
    }
    conversation.updatedAt=nowIso();saveDb();
    return json(res,200,{ok:true});
  }

  if (method === 'POST' && url.pathname === '/assistant/chat') {
    const user = requireActive(req, res);
    if (!user) return;
    const body = await readBody(req);
    const message = cleanText(body.message, 1500);
    if (!message) return json(res, 400, { error: 'MESSAGE' });
    const target=localSupportTarget(body.target);
    const conversation = localConversationFor(user.id);
    const consultantState=conversation.assignedSupportUserId?'JOINED':conversation.consultantRequestedAt?'WAITING':'BOT';
    if(target==='CONSULTANT'&&!conversation.consultantRequestedAt){
      return json(res,409,{error:'CONSULTANT_NOT_REQUESTED',message:'Najpierw poproś konsultanta o dołączenie.'});
    }
    const userMessage = { id: id('msg'), conversationId: conversation.id, author: 'user', text: message, target, createdAt: nowIso() };
    db.supportMessages.push(userMessage);
    conversation.updatedAt=nowIso();
    if(target==='CONSULTANT'){
      saveDb();
      return json(res,200,{userMessage:localSupportMessageView(userMessage),assistantMessage:null,action:null,consultantState});
    }
    const lower = message.toLocaleLowerCase('pl-PL');
    let answer = 'Jasne — spróbuję Ci pomóc. Opisz, co chcesz zrobić w ServiceOS albo co nie działa. Mogę też uruchomić test internetu, sprawdzić połączenie oraz otworzyć wyszukiwanie filmów i materiałów technicznych. Jeśli będzie potrzebny człowiek, poproś konsultanta — bot nadal pozostanie dostępny.';
    let action = null;
    if(/^\s*\/net\b/i.test(message)||lower.includes('test internetu')||lower.includes('test prędkości')||lower.includes('test predkosci')||lower.includes('prędkość internetu')||lower.includes('predkosc internetu')||lower.includes('speedtest')){
      answer='Uruchamiam lokalny test łącza na tym urządzeniu. Zmierzę opóźnienie, pobieranie i wysyłanie.';
      action={type:'SPEED_TEST',label:'Uruchom test internetu'};
    }else if(/^\s*\/diag\b/i.test(message)||lower.includes('diagnostyka połączenia')||lower.includes('diagnostyka polaczenia')||lower.includes('czy api działa')||lower.includes('czy api dziala')){
      answer='Sprawdzę połączenie tego urządzenia z internetem i ServiceOS.';
      action={type:'CONNECTIVITY_TEST',label:'Uruchom diagnostykę'};
    }else if(/^\s*\/(video|film)\b/i.test(message)||lower.includes('youtube')||lower.includes('film jak')||lower.includes('tutorial')){
      const query=cleanText(message.replace(/^\s*\/(video|film)\b/i,'').replace(/\b(znajdź|znajdz|wyszukaj|pokaż|pokaz|film|wideo|video|youtube|tutorial|jak zrobić|jak zrobic)\b/giu,' ').replace(/\s+/g,' ').trim(),180);
      if(query.length>=3){answer='Otworzę filmy instruktażowe dla: „'+query+'”.';action={type:'BROWSER_SEARCH',provider:'YOUTUBE',query,label:'Znajdź filmy na YouTube'};}
      else answer='Podaj urządzenie i czynność, np. „film jak wymienić ekran iPhone 15”.';
    }else if(/^\s*\/web\b/i.test(message)||lower.includes('service manual')||lower.includes('instrukcja serwisowa')||lower.includes('datasheet')||lower.includes('schemat płyty')||lower.includes('schemat plyty')){
      const query=cleanText(message.replace(/^\s*\/web\b/i,'').trim(),180);
      if(query.length>=3){answer='Otworzę materiały techniczne dla: „'+query+'”.';action={type:'BROWSER_SEARCH',provider:'WEB',query,label:'Szukaj materiałów technicznych'};}
    }else if (lower.includes('aktualiz')) {
      answer = 'ServiceOS sprawdza aktualizacje po starcie, cyklicznie podczas pracy i po powrocie do aplikacji.';
    }else if (lower.includes('klient')) {
      const term = lower.replace(/znajdź|znajdz|wyszukaj|klienta|klient|pokaż|pokaz|szukaj/g, ' ').trim();
      const found = term.length >= 2 ? db.customers.filter((item) => `${item.firstName} ${item.lastName} ${item.email || ''} ${item.phone || ''}`.toLowerCase().includes(term)).slice(0, 5) : [];
      if (found.length) answer = 'Znalazłem lokalnie:\n' + found.map((item) => `- ${item.firstName} ${item.lastName} · ${item.email || item.phone || 'brak kontaktu'}`).join('\n');
    }
    const assistantMessage = { id: id('msg'), conversationId: conversation.id, author: 'assistant', text: answer, action, target:'BOT', createdAt: nowIso() };
    db.supportMessages.push(assistantMessage);
    saveDb();
    return json(res, 200, { userMessage:localSupportMessageView(userMessage), assistantMessage:localSupportMessageView(assistantMessage), action, consultantState });
  }

  if (method === 'GET' && url.pathname === '/finance/technician-settings') {
    const user = requireRole(req, res, ['TECHNICIAN']);
    if (!user) return;
    const technicianPercent = normalizeTechnicianPercent(user.technicianSplitPercent);
    return json(res, 200, {
      configured: technicianPercent !== null,
      technicianPercent,
      bossPercent: technicianPercent === null ? null : Math.round((100-technicianPercent)*100)/100
    });
  }

  if (method === 'POST' && url.pathname === '/finance/technician-settings') {
    const user = requireRole(req, res, ['TECHNICIAN']);
    if (!user) return;
    const body = await readBody(req);
    const technicianPercent = normalizeTechnicianPercent(body.technicianPercent);
    if (technicianPercent === null) return json(res, 400, { error:'TECHNICIAN_SPLIT', message:'Ustaw procent serwisanta od 0 do 100%.' });
    user.technicianSplitPercent = technicianPercent;
    saveDb();
    return json(res, 200, {
      configured:true,
      technicianPercent,
      bossPercent:Math.round((100-technicianPercent)*100)/100
    });
  }

  if (method === 'GET' && url.pathname === '/finance/revenues') {
    const user = requireActive(req, res);
    if (!user) return;
    if (!FINANCE_READ_ROLES.has(user.role)) return json(res, 403, { error:'FORBIDDEN', message:'Brak uprawnień do rozliczeń.' });
    const entries = db.revenueEntries.filter((entry) => revenueVisibleTo(user, entry)).map((entry) => {
      const view = revenueView(entry);
      const order = entry.serviceOrderId ? db.serviceOrders.find((candidate)=>candidate.id===entry.serviceOrderId) : null;
      return { ...view, orderNumber: order?.orderNumber ?? null };
    });
    const approved = entries.filter((e) => e.status === 'APPROVED' || e.status === 'SETTLED');
    const pending = entries.filter((e) => e.status === 'PENDING');
    const pointMap = new Map();
    for (const entry of entries) {
      let bucket = pointMap.get(entry.pointId);
      if (!bucket) {
        bucket = { pointId:entry.pointId, pointName:entry.point?.name || 'Punkt', pointCity:entry.point?.city || '', approvedRevenue:0, technicianShare:0, bossShare:0, pendingRevenue:0, entries:[] };
        pointMap.set(entry.pointId,bucket);
      }
      bucket.entries.push(entry);
      if (entry.status === 'APPROVED' || entry.status === 'SETTLED') {
        bucket.approvedRevenue += entry.amount;
        bucket.technicianShare += entry.technicianShare;
        bucket.bossShare += entry.bossShare;
      } else if (entry.status === 'PENDING') bucket.pendingRevenue += entry.amount;
    }
    return json(res, 200, {
      entries,
      points:[...pointMap.values()].sort((a,b)=>a.pointName.localeCompare(b.pointName,'pl')),
      summary: {
        approvedRevenue: approved.reduce((sum, e) => sum + e.amount, 0),
        technicianShare: approved.reduce((sum, e) => sum + e.technicianShare, 0),
        bossShare: approved.reduce((sum, e) => sum + e.bossShare, 0),
        pendingRevenue: pending.reduce((sum, e) => sum + e.amount, 0)
      }
    });
  }

  if (method === 'POST' && url.pathname === '/finance/revenues') {
    const user = requireRole(req, res, ['TECHNICIAN']);
    if (!user) return;
    const body = await readBody(req);
    const amount = Number(body.amount);
    const pointId = String(body.pointId || '');
    const workDate = cleanText(body.workDate, 20) || new Date().toISOString().slice(0, 10);
    const note = cleanText(body.note, 700);
    if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'AMOUNT', message: 'Wpisz prawidłową kwotę przychodu.' });
    if (!user.pointIds.includes(pointId)) return json(res, 403, { error: 'POINT', message: 'Nie masz dostępu do tego punktu.' });
    const technicianPercent = normalizeTechnicianPercent(user.technicianSplitPercent);
    if (technicianPercent === null) return json(res, 409, { error:'SETTLEMENT_REQUIRED', message:'Najpierw ustaw swoje rozliczenie serwisanta.' });
    const rounded = Math.round(amount * 100) / 100;
    const split = splitRevenueAmount(rounded, technicianPercent);
    const entry = {
      id: id('rev'),
      userId: user.id,
      pointId,
      amount: rounded,
      workDate,
      note,
      status: 'APPROVED',
      splitTechnicianPercent: split.technicianPercent,
      splitBossPercent: split.bossPercent,
      technicianShare: split.technicianShare,
      bossShare: split.bossShare,
      submittedAt: nowIso(),
      reviewedAt: nowIso(),
      reviewedBy: user.id
    };
    db.revenueEntries.unshift(entry);
    saveDb();
    return json(res, 201, revenueView(entry));
  }

  const reviewRevenueMatch = url.pathname.match(/^\/finance\/revenues\/([^/]+)\/review$/);
  if (method === 'POST' && reviewRevenueMatch) {
    const reviewer = requireRole(req, res, ['OWNER', 'BOSS']);
    if (!reviewer) return;
    const entry = db.revenueEntries.find((r) => r.id === reviewRevenueMatch[1]);
    if (!entry) return json(res, 404, { error: 'NOT_FOUND' });
    const body = await readBody(req);
    const action = String(body.action || '');
    if (!['APPROVE', 'REJECT'].includes(action)) return json(res, 400, { error: 'ACTION' });
    entry.status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    entry.reviewedAt = nowIso();
    entry.reviewedBy = reviewer.id;
    if (entry.status === 'APPROVED') {
      const split = splitRevenueAmount(entry.amount, entry.splitTechnicianPercent ?? 50);
      entry.technicianShare = split.technicianShare;
      entry.bossShare = split.bossShare;
    } else {
      entry.technicianShare = 0;
      entry.bossShare = 0;
    }
    saveDb();
    localAudit(reviewer,'REVENUE_REVIEWED','revenue',entry.id,entry.pointId,{after:entry.status,amount:entry.amount,technicianPercent:entry.splitTechnicianPercent,settlementStatus:entry.status});
    return json(res, 200, revenueView(entry));
  }

  if (method === 'GET' && url.pathname === '/dashboard') {
    const user = requireActive(req, res);
    if (!user) return;
    if (user.role === 'USER') return json(res, 200, { pointCount:0,activeUsers:0,pendingUsers:0,approvedRevenue:0,pendingRevenue:0,bossShare:0,technicianShare:0 });
    const visibleEntries = db.revenueEntries.filter((entry) => revenueVisibleTo(user, entry));
    const visiblePointIds = GLOBAL_ROLES.has(user.role) ? db.points.map((p) => p.id) : user.pointIds || [];
    const visibleUsers = GLOBAL_ROLES.has(user.role)
      ? db.users.filter((u) => u.status === 'ACTIVE' && !isOwnerIdentity(u))
      : db.users.filter((u) => u.status === 'ACTIVE' && !isOwnerIdentity(u) && (u.pointIds || []).some((pid) => visiblePointIds.includes(pid)));
    const approved = visibleEntries.filter((r) => r.status === 'APPROVED');
    const pending = visibleEntries.filter((r) => r.status === 'PENDING');
    const ownApproved = approved.filter((r) => r.userId === user.id);
    return json(res, 200, {
      pointCount: visiblePointIds.length,
      activeUsers: visibleUsers.length,
      pendingUsers: user.role === 'OWNER' ? db.users.filter((u) => u.status === 'PENDING').length : 0,
      approvedRevenue: approved.reduce((sum, r) => sum + r.amount, 0),
      pendingRevenue: pending.reduce((sum, r) => sum + r.amount, 0),
      bossShare: approved.reduce((sum, r) => sum + r.bossShare, 0),
      technicianShare: user.role === 'TECHNICIAN' ? ownApproved.reduce((sum, r) => sum + r.technicianShare, 0) : approved.reduce((sum, r) => sum + r.technicianShare, 0)
    });
  }

  return json(res, 404, { error: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' });
};

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[LockOn API]', error);
    if (!res.headersSent) {
      if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') return json(res, 413, { error: 'PAYLOAD_TOO_LARGE', message: 'Żądanie jest zbyt duże.' });
      if (error instanceof Error && error.message === 'INVALID_JSON') return json(res, 400, { error: 'INVALID_JSON', message: 'Nieprawidłowe dane żądania.' });
      json(res, 500, { error: 'SERVER_ERROR', message: 'Wewnętrzny błąd serwera.' });
    }
    else res.end();
  });
});

server.maxHeadersCount = 60;
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
  console.log(`LockOn ServiceOS API: http://${HOST}:${PORT}`);
  console.log(`Baza danych: ${DATA_FILE}`);
  console.log(`Właściciel: ${OWNER_EMAIL}`);
  if (ALLOW_DEV_LOGIN) console.log('Tryb lokalnego logowania właściciela: AKTYWNY (development)');
});
