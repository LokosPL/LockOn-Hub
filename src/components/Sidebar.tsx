import {
  BadgeDollarSign,
  Boxes,
  Bot,
  Gauge,
  Globe2,
  Headphones,
  LogOut,
  PackageSearch,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  Wrench,
  UserCog
} from 'lucide-react';
import logo from '../assets/logo.svg';
import type { AuthState } from '../types/electron';
import { ROLE_DEFINITIONS, ROLE_ORDER, roleCanNavigate, type UserRole } from '../config/roles';

export type NavigationKey =
  | 'dashboard'
  | 'administration'
  | 'repairs'
  | 'customers'
  | 'parts'
  | 'offers'
  | 'earnings'
  | 'browser'
  | 'ai'
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
  { key: 'dashboard', label: 'Panel główny', icon: Gauge, ready: true },
  { key: 'administration', label: 'Administracja', icon: UserCog, ready: true },
  { key: 'repairs', label: 'Zlecenia', icon: Wrench, ready: false },
  { key: 'customers', label: 'Klienci', icon: UsersRound, ready: false },
  { key: 'parts', label: 'Części', icon: Boxes, ready: false },
  { key: 'offers', label: 'Oferty i ceny', icon: PackageSearch, ready: false },
  { key: 'earnings', label: 'Rozliczenia', icon: BadgeDollarSign, ready: true },
  { key: 'browser', label: 'Przeglądarka', icon: Globe2, ready: true },
  { key: 'ai', label: 'LockOn AI', icon: Bot, ready: false },
  { key: 'support', label: 'Centrum wsparcia', icon: Headphones, ready: true }
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
    ? `Wszystkie punkty (${auth.points.length})`
    : auth.points.length > 1
      ? `${auth.points.length} przypisane punkty`
      : auth.point?.name ?? 'Brak punktu';

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-logo-box"><img src={logo} alt="LockOn ServiceOS" /></div>
        <div className="brand-copy"><div className="brand-name">LockOn</div><div className="brand-subtitle">ServiceOS</div></div>
      </div>

      <div className="branch-pill" title={pointLabel}>
        <span className="branch-dot" />
        <span className="branch-label">{pointLabel}</span>
      </div>

      <div className="role-pill" title={roleDefinition.label}>
        <ShieldCheck size={15} />
        <div><span>Rola</span><strong>{roleDefinition.shortLabel}</strong></div>
      </div>

      <nav className="nav-list">
        {items.filter(({ key }) => roleCanNavigate(effectiveRole, key)).map(({ key, label, icon: Icon, ready }) => (
          <button key={key} className={`nav-item ${active === key ? 'active' : ''}`} onClick={() => onChange(key)} title={label}>
            <Icon size={19} /><span>{label}</span>{!ready && <small>Wkrótce</small>}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <button className="nav-item help-item" onClick={onOpenHelp} title="Otwórz czat pomocy">
        <Headphones size={19} /><span>Pomoc</span><small>Chat</small>
      </button>

      {roleCanNavigate(effectiveRole, 'settings') && (
        <button className={`nav-item settings-item ${active === 'settings' ? 'active' : ''}`} onClick={() => onChange('settings')}>
          <Settings size={19} /><span>Ustawienia</span>
        </button>
      )}

      {ownerCanPreview && (
        <div className="role-preview-box">
          <div className="role-preview-heading"><span>Podgląd interfejsu</span>{previewRole && <small>AKTYWNY</small>}</div>
          <select value={previewRole ?? actualRole} onChange={(event) => {
            const next = event.target.value as UserRole;
            onPreviewRoleChange(next === actualRole ? null : next);
          }}>
            {ROLE_ORDER.map((role) => <option key={role} value={role}>{ROLE_DEFINITIONS[role].label}</option>)}
          </select>
          <p>Symuluje widok danej roli. Nie zmienia Twoich prawdziwych uprawnień.</p>
        </div>
      )}

      <div className="account-card">
        {auth.user?.picture ? (
          <img className="account-avatar-image" src={auth.user.picture} alt="Profil" referrerPolicy="no-referrer" />
        ) : <div className="account-avatar">{initials || <UserRound size={17} />}</div>}
        <div className="account-copy">
          <strong>{auth.user?.name ?? 'Użytkownik'}</strong>
          <span>{auth.user?.email ?? ''}</span>
          <em>{ROLE_DEFINITIONS[actualRole].shortLabel}</em>
        </div>
        <button className="logout-button" onClick={() => void onLogout()} title="Wyloguj"><LogOut size={16} /></button>
      </div>
    </aside>
  );
}
