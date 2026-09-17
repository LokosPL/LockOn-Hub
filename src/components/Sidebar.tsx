import {
  BadgeDollarSign,
  Gauge,
  Globe2,
  Headphones,
  LogOut,
  Settings,
  ShieldCheck,
  UserRound,
  UserCog
} from 'lucide-react';
import logo from '../assets/logo.svg';
import type { AuthState } from '../types/electron';
import { ROLE_DEFINITIONS, ROLE_ORDER, roleCanNavigate, type UserRole } from '../config/roles';

export type NavigationKey =
  | 'dashboard'
  | 'administration'
  | 'earnings'
  | 'browser'
  | 'support'
  | 'settings';

interface SidebarProps {
  active: NavigationKey;
  onChange: (key: NavigationKey) => void;
  auth: AuthState;
  effectiveRole: UserRole;
  previewRole: UserRole | null;
  onPreviewRoleChange: (role: UserRole | null) => void;
  onLogout: () => void | Promise<void>;
  onOpenHelp: () => void;
}

const items = [
  { key: 'dashboard', label: 'Start', icon: Gauge },
  { key: 'browser', label: 'Przeglądarka', icon: Globe2 },
  { key: 'earnings', label: 'Rozliczenia', icon: BadgeDollarSign },
  { key: 'administration', label: 'Administracja', icon: UserCog },
  { key: 'support', label: 'Wsparcie', icon: Headphones }
] as const;

export function Sidebar({
  active,
  onChange,
  auth,
  effectiveRole,
  previewRole,
  onPreviewRoleChange,
  onLogout,
  onOpenHelp
}: SidebarProps) {
  const actualRole = (auth.role ?? 'USER') as UserRole;
  const roleDefinition = ROLE_DEFINITIONS[effectiveRole];
  const ownerCanPreview = actualRole === 'OWNER';
  const initials = auth.user?.name
    ? auth.user.name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : 'LO';

  const pointLabel = roleDefinition.scope === 'GLOBAL'
    ? 'Wszystkie punkty'
    : auth.points.length > 1
      ? `${auth.points.length} punkty`
      : auth.point?.name ?? 'Brak punktu';

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-logo-box"><img src={logo} alt="" /></div>
        <div className="brand-copy"><div className="brand-name">LockOn</div><div className="brand-subtitle">ServiceOS</div></div>
      </div>

      <div className="branch-pill" title={pointLabel}>
        <span className="branch-dot" />
        <span className="branch-label">{pointLabel}</span>
      </div>

      <nav className="nav-list" aria-label="Nawigacja">
        {items.filter(({ key }) => roleCanNavigate(effectiveRole, key)).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`nav-item ${active === key ? 'active' : ''}`}
            onClick={() => onChange(key)}
            title={label}
          >
            <Icon size={18} /><span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <button className="nav-item help-item" onClick={onOpenHelp} title="Pomoc">
        <Headphones size={18} /><span>Pomoc</span><small>Chat</small>
      </button>

      {roleCanNavigate(effectiveRole, 'settings') && (
        <button className={`nav-item settings-item ${active === 'settings' ? 'active' : ''}`} onClick={() => onChange('settings')}>
          <Settings size={18} /><span>Ustawienia</span>
        </button>
      )}

      {ownerCanPreview && (
        <div className="role-preview-box">
          <div className="role-preview-heading">
            <span>Podgląd roli</span>
            {previewRole && <small>AKTYWNY</small>}
          </div>
          <select value={previewRole ?? actualRole} onChange={(event) => {
            const next = event.target.value as UserRole;
            onPreviewRoleChange(next === actualRole ? null : next);
          }}>
            {ROLE_ORDER.map((role) => <option key={role} value={role}>{ROLE_DEFINITIONS[role].label}</option>)}
          </select>
        </div>
      )}

      <div className="account-card">
        {auth.user?.picture ? (
          <img className="account-avatar-image" src={auth.user.picture} alt="Profil" referrerPolicy="no-referrer" />
        ) : <div className="account-avatar">{initials || <UserRound size={17} />}</div>}
        <div className="account-copy">
          <strong>{auth.user?.name ?? 'Użytkownik'}</strong>
          <span>{ROLE_DEFINITIONS[actualRole].shortLabel}</span>
        </div>
        <button className="logout-button" onClick={() => void onLogout()} title="Wyloguj"><LogOut size={16} /></button>
      </div>
    </aside>
  );
}
