import { APP_CONFIG } from './appConfig';

export interface BackendPoint {
  id: string;
  name: string;
  city: string;
  active: boolean;
}

export type BackendUserRole = 'OWNER' | 'BOSS' | 'COORDINATOR' | 'SUPPORT' | 'TECHNICIAN' | 'USER';

export interface BackendRequestedPoint {
  pointName: string;
  city: string;
  requestedRole: BackendUserRole;
  technicianSplitPercent?: number | null;
  requestedAt: string;
}

export interface BackendUser {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: BackendUserRole | null;
  technicianSplitPercent?: number | null;
  supportEnabled?: boolean;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED';
  pointIds: string[];
  requestedPoint?: BackendRequestedPoint | null;
  firstLoginAt: string;
  lastLoginAt: string;
}

export interface BackendAuthPayload {
  user: BackendUser;
  points: BackendPoint[];
  activePointId?: string | null;
  gmail?: {
    connected: boolean;
    skipped?: boolean;
    reason?: string;
    pointId?: string | null;
    email?: string | null;
    status?: string;
  };
}

export interface BackendLoginPayload extends BackendAuthPayload {
  token: string;
}

type DeviceUnlockType = 'NONE' | 'PIN' | 'PATTERN';
type DeviceUnlockPayload = {
  type: DeviceUnlockType;
  secret?: string | null;
  updatedAt?: string | null;
};

let activeApiBaseUrl = APP_CONFIG.backend.apiBaseUrl.replace(/\/$/, '');

export const setBackendApiBaseUrl = (value: string) => {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Nieprawidłowy adres LockOn API.');
  }
  activeApiBaseUrl = parsed.toString().replace(/\/$/, '');
};

export const getBackendApiBaseUrl = () => activeApiBaseUrl;

const endpoint = (path: string) => `${activeApiBaseUrl}${path}`;

const deviceUnlockBaseUrl = () => {
  try {
    const parsed = new URL(activeApiBaseUrl);
    const marker = '-lockonapi.compute.';
    if (!parsed.hostname.includes(marker)) return null;
    parsed.hostname = parsed.hostname.replace(marker, '-deviceunlock.compute.');
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const readJsonResponse = async (response: Response) => {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as unknown; }
  catch { return { message: text }; }
};

const requestError = (response: Response, data: unknown) => {
  const message =
    typeof data === 'object' && data && 'message' in data
      ? String((data as { message?: unknown }).message || `Błąd API ${response.status}`)
      : `Błąd API ${response.status}`;
  const error = new Error(message) as Error & { code?: string; status?: number };
  error.code = typeof data === 'object' && data && 'error' in data ? String((data as { error?: unknown }).error || '') : '';
  error.status = response.status;
  return error;
};

const deviceUnlockRequest = async <T>(path: string, options: RequestInit, token: string): Promise<T> => {
  const baseUrl = deviceUnlockBaseUrl();
  if (!baseUrl) throw Object.assign(new Error('Chronione dane blokady są dostępne tylko przez centralny ServiceOS API.'), { code: 'DEVICE_UNLOCK_UNAVAILABLE' });

  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    redirect: 'error',
    cache: 'no-store',
    signal: options.signal ?? AbortSignal.timeout(10_000)
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw requestError(response, data);
  return data as T;
};

const parseRequestBody = (body: BodyInit | null | undefined) => {
  if (typeof body !== 'string') return null;
  try { return JSON.parse(body) as Record<string, unknown>; }
  catch { return null; }
};

const enrichCreatedOrderWithUnlock = async (path: string, options: RequestInit, token: string | undefined, data: unknown) => {
  if (!token || path !== '/service/orders' || String(options.method || 'GET').toUpperCase() !== 'POST') return data;
  const input = parseRequestBody(options.body);
  const type = String(input?.unlockType || '').toUpperCase() as DeviceUnlockType;
  if (!['NONE', 'PIN', 'PATTERN'].includes(type)) return data;
  const orderId = typeof data === 'object' && data && 'order' in data
    ? String((data as { order?: { id?: unknown } }).order?.id || '')
    : '';
  if (!orderId) return data;

  const target = data as Record<string, unknown>;
  try {
    await deviceUnlockRequest<DeviceUnlockPayload>(`/service/orders/${encodeURIComponent(orderId)}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ type, secret: type === 'NONE' ? null : String(input?.unlockSecret || '') })
    }, token);
    target.deviceUnlock = { saved: true, type };
  } catch (error) {
    console.warn('[device unlock save]', error instanceof Error ? error.message : String(error));
    target.deviceUnlock = {
      saved: false,
      type,
      message: error instanceof Error ? error.message : 'Nie udało się zapisać danych blokady.'
    };
  }
  return target;
};

const enrichOrderNotesWithUnlock = async (path: string, options: RequestInit, token: string | undefined, data: unknown) => {
  if (!token || String(options.method || 'GET').toUpperCase() !== 'GET' || !Array.isArray(data)) return data;
  const match = path.match(/^\/service\/orders\/([^/]+)\/notes$/);
  if (!match) return data;

  try {
    const unlock = await deviceUnlockRequest<DeviceUnlockPayload>(`/service/orders/${encodeURIComponent(match[1])}/unlock`, { method: 'GET' }, token);
    if (unlock.type === 'NONE' || !unlock.secret) return data;
    const label = unlock.type === 'PIN' ? 'PIN' : 'wzór';
    const value = unlock.type === 'PATTERN' ? unlock.secret.split('').join(' → ') : unlock.secret;
    return [{
      id: `device-unlock-${match[1]}`,
      body: `Blokada telefonu: ${label}\n${unlock.type === 'PIN' ? 'PIN' : 'Wzór'}: ${value}`,
      authorUserId: 'system-device-unlock',
      authorName: 'Dane przyjęcia — chronione',
      createdAt: unlock.updatedAt || new Date().toISOString()
    }, ...data];
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status !== 403 && status !== 404) {
      console.warn('[device unlock read]', error instanceof Error ? error.message : String(error));
    }
    return data;
  }
};

export async function backendRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(endpoint(path), {
      ...options,
      headers,
      redirect: 'error',
      cache: 'no-store'
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new Error('LockOn API nie odpowiedziało na czas. Sprawdź połączenie i spróbuj ponownie.');
    }
    throw new Error(
      `Nie można połączyć się z LockOn API (${activeApiBaseUrl}). ` +
      'Uruchom ponownie ServiceOS. Jeśli problem wróci, zgłoś go w Pomocy.'
    );
  }

  let data = await readJsonResponse(response);
  if (!response.ok) throw requestError(response, data);

  data = await enrichCreatedOrderWithUnlock(path, options, token, data);
  data = await enrichOrderNotesWithUnlock(path, options, token, data);
  return data as T;
}

export const backendGoogleCodeLogin = (
  payload: { code:string; codeVerifier:string; redirectUri:string },
  signal?: AbortSignal
) =>
  backendRequest<BackendLoginPayload>('/auth/google-code', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal
  });

export const backendGoogleLogin = (idToken: string, signal?: AbortSignal) =>
  backendRequest<BackendLoginPayload>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
    signal
  });

export const backendDevOwnerLogin = () =>
  backendRequest<BackendLoginPayload>('/auth/dev-owner', { method: 'POST', body: '{}' });

export const backendMe = (token: string, signal?: AbortSignal) => backendRequest<BackendAuthPayload>('/me', { signal }, token);

export const backendLogout = (token: string, signal?: AbortSignal) =>
  backendRequest<{ ok: true }>('/auth/logout', { method: 'POST', body: '{}', signal }, token);
