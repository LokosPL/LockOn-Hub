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
  requestedAt: string;
}

export interface BackendUser {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: BackendUserRole | null;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED';
  pointIds: string[];
  requestedPoint?: BackendRequestedPoint | null;
  firstLoginAt: string;
  lastLoginAt: string;
}

export interface BackendAuthPayload {
  user: BackendUser;
  points: BackendPoint[];
}

export interface BackendLoginPayload extends BackendAuthPayload {
  token: string;
}

const endpoint = (path: string) => `${APP_CONFIG.backend.apiBaseUrl.replace(/\/$/, '')}${path}`;

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
  } catch {
    throw new Error(
      `Nie można połączyć się z LockOn API (${APP_CONFIG.backend.apiBaseUrl}). ` +
      'W development uruchom projekt przez npm run dev.'
    );
  }

  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: unknown }).message || `Błąd API ${response.status}`)
        : `Błąd API ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

export const backendGoogleLogin = (idToken: string) =>
  backendRequest<BackendLoginPayload>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken })
  });

export const backendDevOwnerLogin = () =>
  backendRequest<BackendLoginPayload>('/auth/dev-owner', { method: 'POST', body: '{}' });

export const backendMe = (token: string) => backendRequest<BackendAuthPayload>('/me', {}, token);

export const backendLogout = (token: string) =>
  backendRequest<{ ok: true }>('/auth/logout', { method: 'POST', body: '{}' }, token);
