import { Check, Eye, ShieldCheck } from 'lucide-react';
import { ROLE_DEFINITIONS, ROLE_ORDER, type UserRole } from '../config/roles';
import type { AuthState } from '../types/electron';

interface SettingsPageProps { auth: AuthState; effectiveRole: UserRole; previewRole: UserRole | null; onPreviewRoleChange: (role: UserRole | null) => void; }

export function SettingsPage({ auth, effectiveRole, previewRole, onPreviewRoleChange }: SettingsPageProps) {
  const actualRole = auth.role as UserRole;
  return <div className="settings-page page-enter">
    <section className="settings-heading"><div><div className="eyebrow">UPRAWNIENIA LOCKONOS</div><h1>Role i zakresy dostępu</h1><p>Role nadaje Właściciel aplikacji po weryfikacji konta Google. Szef i Właściciel mają zakres globalny; pozostałe role mogą być przypisywane do konkretnych punktów.</p></div><div className="settings-role-card"><ShieldCheck size={22}/><div><span>Twoja faktyczna rola</span><strong>{ROLE_DEFINITIONS[actualRole].label}</strong></div></div></section>
    {previewRole && actualRole==='OWNER' && <div className="preview-info-card"><Eye size={18}/><div><strong>Tryb podglądu jest aktywny</strong><span>Oglądasz aplikację jako {ROLE_DEFINITIONS[effectiveRole].label}. Uprawnienia konta nie zostały zmienione.</span></div></div>}
    <section className="role-cards-grid">{ROLE_ORDER.map(role=>{const d=ROLE_DEFINITIONS[role];return <article key={role} className={`role-card ${role===actualRole?'current':''} ${actualRole==='OWNER'?'preview-clickable':''}`} onClick={()=>actualRole==='OWNER'&&onPreviewRoleChange(role===actualRole?null:role)}><div className="role-card-topline"><div className="role-card-icon"><ShieldCheck size={19}/></div><span>{role}</span></div><h2>{d.label}</h2><p>{d.description}</p><div className="role-capabilities"><span><Check size={13}/> Zakres: {d.scope==='GLOBAL'?'wszystkie punkty':'przypisane punkty'}</span><span><Check size={13}/> Moduły: {d.navigation.length}</span>{d.canManageUpdates&&<span><Check size={13}/> Aktualizacje</span>}{d.canUseSupportDesk&&<span><Check size={13}/> Obsługa wsparcia</span>}{d.canPreviewRoles&&<span><Check size={13}/> Podgląd ról</span>}</div>{actualRole==='OWNER'&&<button className="role-preview-action" type="button"><Eye size={13}/>{role===actualRole?'Mój widok':'Podejrzyj tę rolę'}</button>}</article>})}</section>
    <section className="panel-card team-config-card"><div><div className="eyebrow">ZASADA DOSTĘPU</div><h2>Google → zgłoszenie punktu → weryfikacja</h2><p>Nowych adresów e-mail nie wpisuje się już do kodu. Użytkownik loguje się Google, podaje nazwę punktu i miasto, a konto pojawia się w <strong>Administracja</strong>. Dopiero tam właściciel nadaje rolę i dostęp.</p></div></section>
  </div>;
}
