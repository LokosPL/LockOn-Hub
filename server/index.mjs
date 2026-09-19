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
const OWNER_EMAIL = (process.env.LOCKON_OWNER_EMAIL || 'nowogar@gmail.com').trim().toLowerCase();
const GOOGLE_CLIENT_ID = (process.env.LOCKON_GOOGLE_CLIENT_ID || '996585439932-e10mu53j95s6u13vrua841tm4oco38so.apps.googleusercontent.com').trim();
const ALLOW_DEV_LOGIN = process.env.LOCKON_ALLOW_DEV_LOGIN === '1';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7;
const BODY_LIMIT_BYTES = 64 * 1024;
const googleVerifier = new OAuth2Client();

const ROLES = ['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER'];
const REQUESTABLE_ROLES = new Set(['BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER']);
const GLOBAL_ROLES = new Set(['OWNER', 'BOSS']);
const SERVICE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER']);
const SERVICE_CREATE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const SERVICE_INTAKE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_MANAGE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR']);

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
const normalizeEmail = (value = '') => value.trim().toLowerCase();
const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const normalizeTechnicianPercent = (value) => {
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
  revenueEntries: [],
  customers: [],
  devices: [],
  serviceOrders: [],
  serviceOrderStatusHistory: [],
  serviceOrderNotes: [],
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
      revenueEntries: Array.isArray(raw.revenueEntries) ? raw.revenueEntries : [],
      customers: Array.isArray(raw.customers) ? raw.customers : [],
      devices: Array.isArray(raw.devices) ? raw.devices : [],
      serviceOrders: Array.isArray(raw.serviceOrders) ? raw.serviceOrders : [],
      serviceOrderStatusHistory: Array.isArray(raw.serviceOrderStatusHistory) ? raw.serviceOrderStatusHistory : [],
      serviceOrderNotes: Array.isArray(raw.serviceOrderNotes) ? raw.serviceOrderNotes : [],
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

const pointSummary = (point) => ({ id: point.id, name: point.name, city: point.city, active: point.active !== false });

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  picture: user.picture,
  role: user.role ?? null,
  technicianSplitPercent: user.technicianSplitPercent ?? null,
  status: user.status,
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
  let owner = findUserByEmail(OWNER_EMAIL);
  if (!owner) {
    owner = {
      id: id('usr'),
      googleSub: profile.sub || null,
      email: OWNER_EMAIL,
      name: profile.name || 'Bartłomiej Motłoch',
      picture: profile.picture || null,
      role: 'OWNER',
      status: 'ACTIVE',
      pointIds: [],
      requestedPoint: null,
      firstLoginAt: nowIso(),
      lastLoginAt: nowIso()
    };
    db.users.push(owner);
  } else {
    owner.role = 'OWNER';
    owner.status = 'ACTIVE';
    owner.pointIds = [];
    owner.googleSub = profile.sub || owner.googleSub || null;
    owner.name = profile.name || owner.name;
    owner.picture = profile.picture || owner.picture;
    owner.lastLoginAt = nowIso();
  }
  return owner;
};

ensureOwner();
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

const recordLogin = (user) => {
  db.loginEvents.unshift({
    id: id('log'),
    userId: user.id,
    email: user.email,
    name: user.name,
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

  if (normalizeEmail(profile.email) === OWNER_EMAIL) {
    user = ensureOwner(profile);
  } else if (!user) {
    user = {
      id: id('usr'),
      googleSub: profile.sub || null,
      email: normalizeEmail(profile.email),
      name: profile.name,
      picture: profile.picture || null,
      role: null,
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
    assignedTechnicianName: technician?.name || null,
    assignedTechnicianEmail: technician?.email || null,
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
    technician: technician ? { id: technician.id, name: technician.name, email: technician.email } : null,
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
    const result = loginProfile({ email: OWNER_EMAIL, name: 'Bartłomiej Motłoch', sub: 'dev-owner', picture: null });
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
    const pendingUsers = db.users.filter((u) => u.status === 'PENDING').map(publicUser);
    const users = db.users.map(publicUser);
    const logins = db.loginEvents.slice(0, 100);
    const pendingRevenue = db.revenueEntries.filter((r) => r.status === 'PENDING').map(revenueView);
    return json(res, 200, {
      points: db.points.map(pointSummary),
      users,
      pendingUsers,
      loginEvents: logins,
      pendingRevenue
    });
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
    if (!ROLES.includes(role) || role === 'OWNER') return json(res, 400, { error: 'ROLE', message: 'Nieprawidłowa rola.' });

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
    if (!ROLES.includes(role) || role === 'OWNER') return json(res, 400, { error: 'ROLE' });
    const pointIds = Array.isArray(body.pointIds) ? body.pointIds.filter((value) => db.points.some((p) => p.id === value)) : [];
    if (!GLOBAL_ROLES.has(role) && pointIds.length === 0) return json(res, 400, { error: 'POINT_REQUIRED', message: 'Wybierz co najmniej jeden punkt.' });
    target.role = role;
    target.status = 'ACTIVE';
    target.pointIds = GLOBAL_ROLES.has(role) ? [] : pointIds;
    saveDb();
    return json(res, 200, authPayload(target));
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
    const handlingMode = String(body.handlingMode || 'STANDARD').toUpperCase();
    const canEditWorkflow = SERVICE_EDIT_ROLES.has(user.role);
    const etaText = canEditWorkflow ? cleanText(body.estimatedCompletionAt, 64) : '';
    let estimatedCompletionAt = canEditWorkflow ? null : order.estimatedCompletionAt;
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
    if (body.estimatedCost !== undefined && body.estimatedCost !== '') {
      estimatedCost = Number(body.estimatedCost);
      if (!Number.isFinite(estimatedCost) || estimatedCost < 0) return json(res, 400, { error: 'ESTIMATED_COST', message: 'Nieprawidłowy koszt szacowany.' });
    }

    if (!firstName || !lastName || !brand || !model || !issueDescription) {
      return json(res, 400, { error: 'VALIDATION', message: 'Uzupełnij klienta, markę, model i opis usterki.' });
    }
    if (!email && !phoneNormalized) {
      return json(res, 400, { error: 'CONTACT_REQUIRED', message: 'Podaj adres e-mail lub numer telefonu klienta.' });
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
    if (!['STANDARD','TRANSFER_ONLY'].includes(handlingMode)) {
      return json(res, 400, { error:'HANDLING_MODE', message:'Nieprawidłowy sposób obsługi zlecenia.' });
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
      assignedTechnicianId: handlingMode === 'TRANSFER_ONLY' ? null : assignedTechnicianId,
      createdByUserId: user.id,
      estimatedCost: handlingMode === 'TRANSFER_ONLY' ? null : estimatedCost,
      finalCost: null,
      currency: 'PLN',
      estimatedCompletionAt: handlingMode === 'TRANSFER_ONLY' ? null : estimatedCompletionAt,
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
          changedByName: changedBy?.name || changedBy?.email || 'System'
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
            authorName: author?.name || author?.email || 'Użytkownik'
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
    return json(res, 201, { ...created, authorName: user.name || user.email });
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

    const etaText = cleanText(body.estimatedCompletionAt, 64);
    let estimatedCompletionAt = null;
    if (etaText) {
      const eta = new Date(etaText);
      if (Number.isNaN(eta.getTime())) return json(res, 400, { error: 'ETA', message: 'Nieprawidłowy przewidywany termin.' });
      estimatedCompletionAt = eta.toISOString();
    }

    const canManageAssignment = SERVICE_MANAGE_ROLES.has(user.role);
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

  if (method === 'GET' && url.pathname === '/support/conversation') {
    const user = requireActive(req, res);
    if (!user) return;
    let conversation = db.supportConversations.find((item) => item.userId === user.id && item.status === 'OPEN');
    if (!conversation) {
      conversation = { id: id('sup'), userId: user.id, status: 'OPEN', createdAt: nowIso(), updatedAt: nowIso() };
      db.supportConversations.push(conversation);
      saveDb();
    }
    const messages = db.supportMessages
      .filter((item) => item.conversationId === conversation.id)
      .map((item) => ({ id: item.id, author: item.author, text: item.text, createdAt: item.createdAt }));
    return json(res, 200, { id: conversation.id, status: conversation.status, messages });
  }

  if (method === 'POST' && url.pathname === '/assistant/chat') {
    const user = requireActive(req, res);
    if (!user) return;
    const body = await readBody(req);
    const message = cleanText(body.message, 1500);
    if (!message) return json(res, 400, { error: 'MESSAGE' });
    let conversation = db.supportConversations.find((item) => item.userId === user.id && item.status === 'OPEN');
    if (!conversation) {
      conversation = { id: id('sup'), userId: user.id, status: 'OPEN', createdAt: nowIso(), updatedAt: nowIso() };
      db.supportConversations.push(conversation);
    }
    const userMessage = { id: id('msg'), conversationId: conversation.id, author: 'user', text: message, createdAt: nowIso() };
    const lower = message.toLowerCase();
    let answer = 'Mogę pomóc w obsłudze ServiceOS. Centralne wyszukiwanie klientów, zleceń i kod WWW działają po podłączeniu aplikacji do Neon API.';
    if (lower.includes('aktualiz')) answer = 'ServiceOS sprawdza aktualizacje po starcie, cyklicznie podczas pracy i po powrocie do aplikacji.';
    if (lower.includes('klient')) {
      const term = lower.replace(/znajdź|znajdz|wyszukaj|klienta|klient|pokaż|pokaz|szukaj/g, ' ').trim();
      const found = term.length >= 2 ? db.customers.filter((item) => `${item.firstName} ${item.lastName} ${item.email || ''} ${item.phone || ''}`.toLowerCase().includes(term)).slice(0, 5) : [];
      if (found.length) answer = 'Znalazłem lokalnie:\n' + found.map((item) => `- ${item.firstName} ${item.lastName} · ${item.email || item.phone || 'brak kontaktu'}`).join('\n');
    }
    const assistantMessage = { id: id('msg'), conversationId: conversation.id, author: 'assistant', text: answer, createdAt: nowIso() };
    db.supportMessages.push(userMessage, assistantMessage);
    conversation.updatedAt = nowIso();
    saveDb();
    return json(res, 200, { userMessage, assistantMessage, action: null });
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
    const entries = db.revenueEntries.filter((entry) => revenueVisibleTo(user, entry)).map(revenueView);
    const approved = entries.filter((e) => e.status === 'APPROVED');
    const pending = entries.filter((e) => e.status === 'PENDING');
    return json(res, 200, {
      entries,
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
    return json(res, 200, revenueView(entry));
  }

  if (method === 'GET' && url.pathname === '/dashboard') {
    const user = requireActive(req, res);
    if (!user) return;
    const visibleEntries = db.revenueEntries.filter((entry) => revenueVisibleTo(user, entry));
    const visiblePointIds = GLOBAL_ROLES.has(user.role) ? db.points.map((p) => p.id) : user.pointIds || [];
    const visibleUsers = GLOBAL_ROLES.has(user.role)
      ? db.users.filter((u) => u.status === 'ACTIVE')
      : db.users.filter((u) => u.status === 'ACTIVE' && (u.pointIds || []).some((pid) => visiblePointIds.includes(pid)));
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
