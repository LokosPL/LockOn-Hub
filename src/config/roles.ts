import type { NavigationKey } from '../components/Sidebar';

export type UserRole = 'OWNER' | 'BOSS' | 'COORDINATOR' | 'SUPPORT' | 'TECHNICIAN' | 'USER';

export interface RoleDefinition {
  label: string;
  shortLabel: string;
  description: string;
  navigation: NavigationKey[];
  canManageUpdates: boolean;
  canManageSettings: boolean;
  canUseSupportDesk: boolean;
  canPreviewRoles: boolean;
  scope: 'GLOBAL' | 'POINTS';
}

export const ROLE_ORDER: UserRole[] = ['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER'];

export const ROLE_DEFINITIONS: Record<UserRole, RoleDefinition> = {
  OWNER: {
    label: 'Właściciel aplikacji',
    shortLabel: 'Właściciel',
    description: 'Pełny dostęp do obecnych funkcji ServiceOS, administracji, rozliczeń, wsparcia i aktualizacji.',
    navigation: ['dashboard', 'service', 'browser', 'earnings', 'administration', 'customers', 'support', 'settings'],
    canManageUpdates: true,
    canManageSettings: true,
    canUseSupportDesk: true,
    canPreviewRoles: true,
    scope: 'GLOBAL'
  },
  BOSS: {
    label: 'Szef',
    shortLabel: 'Szef',
    description: 'Widok wszystkich punktów oraz dostęp do przeglądarki i rozliczeń.',
    navigation: ['dashboard', 'service', 'browser', 'earnings', 'settings'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: false,
    canPreviewRoles: false,
    scope: 'GLOBAL'
  },
  COORDINATOR: {
    label: 'Koordynator',
    shortLabel: 'Koordynator',
    description: 'Dostęp do pulpitu i przeglądarki w zakresie przypisanych punktów.',
    navigation: ['dashboard', 'service', 'browser', 'settings'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: false,
    canPreviewRoles: false,
    scope: 'POINTS'
  },
  SUPPORT: {
    label: 'Wsparcie LockOnOS',
    shortLabel: 'Wsparcie',
    description: 'Dostęp do przypisanych punktów, przeglądarki i modułu wsparcia. Dane klientów może odczytywać wyłącznie w dozwolonym zakresie wsparcia.',
    navigation: ['dashboard', 'browser', 'customers', 'support', 'settings'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: true,
    canPreviewRoles: false,
    scope: 'POINTS'
  },
  TECHNICIAN: {
    label: 'Serwisant',
    shortLabel: 'Serwisant',
    description: 'Dostęp do pulpitu, serwisu, przeglądarki i własnych rozliczeń według indywidualnego procentu.',
    navigation: ['dashboard', 'service', 'browser', 'earnings', 'settings'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: false,
    canPreviewRoles: false,
    scope: 'POINTS'
  },
  USER: {
    label: 'Użytkownik',
    shortLabel: 'Użytkownik',
    description: 'Przyjmowanie zleceń, podstawowa obsługa klienta i przekazania urządzeń w przypisanym punkcie.',
    navigation: ['dashboard', 'service', 'customers', 'browser', 'settings'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: false,
    canPreviewRoles: false,
    scope: 'POINTS'
  }
};

export const roleCanNavigate = (role: UserRole, key: NavigationKey, supportEnabled = false) =>
  ROLE_DEFINITIONS[role].navigation.includes(key) ||
  (supportEnabled && (key === 'support' || key === 'customers'));
