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
    description: 'Pełna administracja LockOnOS: wszystkie punkty, konta, role, logowania, finanse, wsparcie i aktualizacje.',
    navigation: ['dashboard', 'administration', 'repairs', 'customers', 'parts', 'offers', 'earnings', 'browser', 'ai', 'support', 'settings'],
    canManageUpdates: true,
    canManageSettings: true,
    canUseSupportDesk: true,
    canPreviewRoles: true,
    scope: 'GLOBAL'
  },
  BOSS: {
    label: 'Szef',
    shortLabel: 'Szef',
    description: 'Widok biznesowy wszystkich punktów, zleceń i rozliczeń. Może zatwierdzać przychody serwisantów.',
    navigation: ['dashboard', 'repairs', 'customers', 'parts', 'offers', 'earnings', 'browser', 'ai'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: false,
    canPreviewRoles: false,
    scope: 'GLOBAL'
  },
  COORDINATOR: {
    label: 'Koordynator',
    shortLabel: 'Koordynator',
    description: 'Koordynuje pracę wybranych punktów i ma wgląd w ich operacje bez globalnej administracji aplikacji.',
    navigation: ['dashboard', 'repairs', 'customers', 'parts', 'offers', 'browser', 'ai'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: false,
    canPreviewRoles: false,
    scope: 'POINTS'
  },
  SUPPORT: {
    label: 'Wsparcie LockOnOS',
    shortLabel: 'Wsparcie',
    description: 'Wsparcie techniczne przypisywane do wybranych punktów. Ma dostęp do centrum pomocy i narzędzi diagnostycznych.',
    navigation: ['dashboard', 'browser', 'ai', 'support'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: true,
    canPreviewRoles: false,
    scope: 'POINTS'
  },
  TECHNICIAN: {
    label: 'Serwisant',
    shortLabel: 'Serwisant',
    description: 'Obsługuje naprawy i sam zgłasza swój przychód. Zatwierdzony przychód jest dzielony automatycznie 50/50 z Szefem.',
    navigation: ['dashboard', 'repairs', 'customers', 'parts', 'offers', 'earnings', 'browser', 'ai'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: false,
    canPreviewRoles: false,
    scope: 'POINTS'
  },
  USER: {
    label: 'Użytkownik',
    shortLabel: 'Użytkownik',
    description: 'Podstawowy dostęp do zleceń, klientów, przeglądarki i pomocy dla przypisanego punktu.',
    navigation: ['dashboard', 'repairs', 'customers', 'browser'],
    canManageUpdates: false,
    canManageSettings: false,
    canUseSupportDesk: false,
    canPreviewRoles: false,
    scope: 'POINTS'
  }
};

export const roleCanNavigate = (role: UserRole, key: NavigationKey) => ROLE_DEFINITIONS[role].navigation.includes(key);
