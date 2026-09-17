import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
const ALLOW_DEV_LOGIN = process.env.LOCKON_ALLOW_DEV_LOGIN === '1';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 30;

const ROLES = ['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER'];
const REQUESTABLE_ROLES = new Set(['BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER']);
const GLOBAL_ROLES = new Set(['OWNER', 'BOSS']);

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
const normalizeEmail = (value = '') => value.trim().toLowerCase();
const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);

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
const findUserById = (userId) => db.users.find((u) => u.id === userId);

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
    'Cache-Control': 'no-store'
  });
  res.end(data);
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) reject(new Error('Payload too large'));
  });
  req.on('end', () => {
    if (!body) return resolve({});
    try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
  });
  req.on('error', reject);
});

const createSession = (user) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  db.sessions = db.sessions.filter((s) => Number(s.expiresAt) > Date.now());
  db.sessions.push({ token, userId: user.id, createdAt, expiresAt: createdAt + SESSION_TTL_MS });
  return token;
};

const currentUser = (req) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const now = Date.now();
  const session = db.sessions.find((s) => s.token === token && Number(s.expiresAt) > now);
  if (!session) return null;

  // Sesja działa w trybie "sliding": jeżeli zostało mniej niż 30 dni,
  // przedłużamy ją do 90 dni. Dzięki temu aplikacja może logować użytkownika
  // automatycznie przy kolejnych uruchomieniach bez ponownego OAuth Google.
  if (Number(session.expiresAt) - now < SESSION_REFRESH_THRESHOLD_MS) {
    session.expiresAt = now + SESSION_TTL_MS;
    saveDb();
  }

  return findUserById(session.userId) || null;
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

const verifyGoogleAccessToken = async (accessToken) => {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error('Google nie potwierdził tokena użytkownika.');
  const profile = await response.json();
  if (!profile.email) throw new Error('Google nie zwrócił adresu e-mail.');
  return {
    sub: profile.sub || null,
    email: normalizeEmail(profile.email),
    name: cleanText(profile.name || profile.email, 120),
    picture: profile.picture || null
  };
};

const loginProfile = (profile) => {
  let user = findUserByEmail(profile.email);
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

const revenueVisibleTo = (user, entry) => {
  if (GLOBAL_ROLES.has(user.role)) return true;
  if (user.role === 'TECHNICIAN') return entry.userId === user.id;
  if (user.role === 'COORDINATOR') return canSeePoint(user, entry.pointId);
  return false;
};

const revenueView = (entry) => {
  const technician = findUserById(entry.userId);
  const point = db.points.find((p) => p.id === entry.pointId);
  return {
    ...entry,
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
    if (!body.accessToken) return json(res, 400, { error: 'MISSING_TOKEN', message: 'Brak tokena Google.' });
    try {
      const profile = await verifyGoogleAccessToken(body.accessToken);
      return json(res, 200, loginProfile(profile));
    } catch (error) {
      return json(res, 401, { error: 'GOOGLE_AUTH_FAILED', message: error instanceof Error ? error.message : 'Błąd Google.' });
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

  if (method === 'POST' && url.pathname === '/access/request-point') {
    const user = requireUser(req, res);
    if (!user) return;
    if (user.status === 'ACTIVE') return json(res, 400, { error: 'ALREADY_ACTIVE', message: 'Konto jest już aktywne.' });
    const body = await readBody(req);
    const pointName = cleanText(body.pointName, 90);
    const city = cleanText(body.city, 90);
    const requestedRole = String(body.requestedRole || 'USER').toUpperCase();
    if (!pointName || !city) return json(res, 400, { error: 'VALIDATION', message: 'Wpisz nazwę punktu i miasto.' });
    if (!REQUESTABLE_ROLES.has(requestedRole)) return json(res, 400, { error: 'ROLE', message: 'Wybierz prawidłową rolę.' });
    user.requestedPoint = { pointName, city, requestedRole, requestedAt: nowIso() };
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
    const entry = {
      id: id('rev'),
      userId: user.id,
      pointId,
      amount: Math.round(amount * 100) / 100,
      workDate,
      note,
      status: 'PENDING',
      splitTechnicianPercent: 50,
      splitBossPercent: 50,
      technicianShare: 0,
      bossShare: 0,
      submittedAt: nowIso(),
      reviewedAt: null,
      reviewedBy: null
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
      entry.technicianShare = Math.round(entry.amount * 0.5 * 100) / 100;
      entry.bossShare = Math.round(entry.amount * 0.5 * 100) / 100;
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
    if (!res.headersSent) json(res, 500, { error: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Błąd serwera.' });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`LockOn ServiceOS API: http://${HOST}:${PORT}`);
  console.log(`Baza danych: ${DATA_FILE}`);
  console.log(`Właściciel: ${OWNER_EMAIL}`);
  if (ALLOW_DEV_LOGIN) console.log('Tryb lokalnego logowania właściciela: AKTYWNY (development)');
});
