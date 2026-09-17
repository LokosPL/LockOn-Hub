import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Building2,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UsersRound,
  XCircle
} from 'lucide-react';
import { ROLE_DEFINITIONS, type UserRole } from '../config/roles';
import type { AdminOverview, AdminUser } from '../types/electron';

const ASSIGNABLE_ROLES: UserRole[] = ['BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER'];
type AdminTab = 'PENDING' | 'ACTIVE' | 'AUDIT';

function formatDate(value?: string) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return value; }
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((value) => value[0]).join('').toUpperCase() || '?';
}

export function AdministrationPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<AdminTab>('PENDING');
  const [query, setQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { role: UserRole; pointIds: string[]; useRequested: boolean }>>({});

  const load = async (silent = false) => {
    if (!silent) setBusy(true);
    if (!silent) setNotice('');
    try {
      setData(await window.lockOn.admin.getOverview());
      setLastRefresh(new Date());
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : 'Nie udało się pobrać administracji.');
    } finally {
      if (!silent) setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const draftFor = (user: AdminUser) => {
    if (user.role === 'OWNER') {
      return drafts[user.id] ?? { role: 'OWNER' as UserRole, pointIds: [], useRequested: false };
    }
    const requestedRole = user.requestedPoint?.requestedRole;
    const suggestedRole = requestedRole && requestedRole !== 'OWNER' ? requestedRole : 'USER';
    return drafts[user.id] ?? {
      role: (user.role ?? suggestedRole) as UserRole,
      pointIds: user.pointIds ?? [],
      useRequested: Boolean(user.requestedPoint) && suggestedRole !== 'BOSS'
    };
  };

  const patchDraft = (user: AdminUser, patch: Partial<{ role: UserRole; pointIds: string[]; useRequested: boolean }>) => {
    setDrafts((current) => ({ ...current, [user.id]: { ...draftFor(user), ...patch } }));
  };

  const approve = async (user: AdminUser) => {
    const draft = draftFor(user);
    const globalRole = draft.role === 'BOSS';
    setBusy(true); setNotice('');
    try {
      await window.lockOn.admin.approveUser(user.id, {
        role: draft.role,
        pointIds: globalRole || draft.useRequested ? [] : draft.pointIds,
        createRequestedPoint: !globalRole && draft.useRequested
      });
      setNotice(`✓ ${user.email} ma teraz aktywne konto z rolą ${ROLE_DEFINITIONS[draft.role].label}.`);
      setDrafts((current) => { const next = { ...current }; delete next[user.id]; return next; });
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się aktywować konta.');
    } finally { setBusy(false); }
  };

  const reject = async (user: AdminUser) => {
    setBusy(true); setNotice('');
    try {
      await window.lockOn.admin.rejectUser(user.id);
      setNotice(`Konto ${user.email} zostało odrzucone. Użytkownik może poprawić zgłoszenie i wysłać je ponownie.`);
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się odrzucić konta.');
    } finally { setBusy(false); }
  };

  const saveAccess = async (user: AdminUser) => {
    const draft = draftFor(user);
    setBusy(true); setNotice('');
    try {
      await window.lockOn.admin.updateUserAccess(user.id, { role: draft.role, pointIds: draft.pointIds });
      setNotice(`Zapisano rolę i dostęp dla ${user.email}.`);
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się zapisać dostępu.');
    } finally { setBusy(false); }
  };

  const togglePoint = (user: AdminUser, pointId: string) => {
    const draft = draftFor(user);
    const next = draft.pointIds.includes(pointId) ? draft.pointIds.filter((id) => id !== pointId) : [...draft.pointIds, pointId];
    patchDraft(user, { pointIds: next, useRequested: false });
  };

  const normalizedQuery = query.trim().toLowerCase();
  const pendingUsers = useMemo(() => (data?.pendingUsers ?? []).filter((user) => {
    if (!normalizedQuery) return true;
    return [user.name, user.email, user.requestedPoint?.pointName, user.requestedPoint?.city]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery));
  }), [data?.pendingUsers, normalizedQuery]);

  const activeUsers = useMemo(() => (data?.users ?? []).filter((user) => user.status === 'ACTIVE').filter((user) => {
    if (!normalizedQuery) return true;
    return [user.name, user.email, user.role ? ROLE_DEFINITIONS[user.role].label : '']
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery));
  }), [data?.users, normalizedQuery]);

  return (
    <div className="admin-page page-enter">
      <section className="admin-heading admin-heading-v2">
        <div>
          <div className="eyebrow">CENTRUM WŁAŚCICIELA LOCKONOS</div>
          <h1>Użytkownicy i dostęp</h1>
          <p>Nowa osoba loguje się przez Google, podaje swój punkt i wybiera rolę, o którą prosi. Niczego nie dostaje automatycznie — tutaj zatwierdzasz punkt, rolę albo zmieniasz je przed akceptacją.</p>
        </div>
        <div className="admin-live-controls">
          <label className="auto-refresh-toggle"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /><span>Auto-odświeżanie</span></label>
          <button className="button secondary" onClick={() => void load()} disabled={busy}><RefreshCw className={busy ? 'spin' : ''} size={16}/> Odśwież</button>
        </div>
      </section>

      {notice && <div className="admin-notice">{notice}</div>}

      <section className="admin-stats">
        <article className={data?.pendingUsers.length ? 'stat-attention' : ''}><Clock3 size={20}/><div><span>Do akceptacji</span><strong>{data?.pendingUsers.length ?? 0}</strong></div></article>
        <article><UsersRound size={20}/><div><span>Aktywne konta</span><strong>{(data?.users ?? []).filter((u) => u.status === 'ACTIVE').length}</strong></div></article>
        <article><Building2 size={20}/><div><span>Punkty</span><strong>{data?.points.length ?? 0}</strong></div></article>
        <article><Activity size={20}/><div><span>Logowania</span><strong>{data?.loginEvents.length ?? 0}</strong></div></article>
      </section>

      <section className="admin-toolbar panel-card">
        <div className="admin-tabs">
          <button className={tab === 'PENDING' ? 'active' : ''} onClick={() => setTab('PENDING')}><Clock3 size={15}/> Do akceptacji <span>{data?.pendingUsers.length ?? 0}</span></button>
          <button className={tab === 'ACTIVE' ? 'active' : ''} onClick={() => setTab('ACTIVE')}><UsersRound size={15}/> Aktywne konta</button>
          <button className={tab === 'AUDIT' ? 'active' : ''} onClick={() => setTab('AUDIT')}><ShieldCheck size={15}/> Dziennik logowań</button>
        </div>
        <div className="admin-search"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Szukaj po nazwie, e-mailu lub punkcie…" /></div>
        <small className="admin-last-refresh">{autoRefresh ? '● AUTO' : 'AUTO wyłączone'}{lastRefresh ? ` • ${lastRefresh.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : ''}</small>
      </section>

      {tab === 'PENDING' && (
        <section className="panel-card admin-section">
          <div className="panel-heading"><div><span className="eyebrow">WYMAGA TWOJEJ DECYZJI</span><h2>Nowe zgłoszenia dostępu</h2></div><div className="roadmap-count">{pendingUsers.length}</div></div>
          <div className="pending-users-list">
            {pendingUsers.length === 0 && <div className="empty-admin">{normalizedQuery ? 'Brak zgłoszeń pasujących do wyszukiwania.' : 'Brak kont oczekujących na akceptację.'}</div>}
            {pendingUsers.map((user) => {
              const draft = draftFor(user);
              const requestRole = user.requestedPoint?.requestedRole ?? 'USER';
              const globalRole = draft.role === 'BOSS';
              return (
                <article className="pending-user-card pending-user-card-v2" key={user.id}>
                  <div className="pending-user-main">
                    <div className="pending-avatar">{initials(user.name)}</div>
                    <div><strong>{user.name}</strong><span>{user.email}</span><small>Pierwsze logowanie: {formatDate(user.firstLoginAt)}</small></div>
                  </div>

                  <div className="request-intent-box">
                    <div className="request-intent-item"><span>Zgłoszony punkt</span><strong>{user.requestedPoint?.pointName ?? 'Nie podano'}</strong><small>{user.requestedPoint?.city ?? '—'}</small></div>
                    <div className="request-intent-item role-intent"><span>Prosi o rolę</span><strong>{ROLE_DEFINITIONS[requestRole].label}</strong><small>To propozycja użytkownika — możesz ją zmienić.</small></div>
                  </div>

                  <div className="approval-controls approval-controls-v2">
                    <div className="approval-title"><UserCheck size={16}/><div><strong>Twoja decyzja</strong><span>Sprawdź i zatwierdź dostęp.</span></div></div>
                    <label><span>Rola po akceptacji</span><select value={draft.role} onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      patchDraft(user, { role: nextRole, useRequested: nextRole === 'BOSS' ? false : draft.useRequested });
                    }}>{ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{ROLE_DEFINITIONS[role].label}</option>)}</select></label>

                    {globalRole ? (
                      <div className="global-access-note"><ShieldCheck size={15}/><span>Rola <strong>Szef</strong> ma dostęp globalny do wszystkich punktów. Nie trzeba przypisywać punktu.</span></div>
                    ) : (
                      <>
                        {user.requestedPoint && (
                          <label className="requested-toggle"><input type="checkbox" checked={draft.useRequested} onChange={(e) => patchDraft(user, { useRequested: e.target.checked })}/><span>Przypisz zgłoszony punkt: <strong>{user.requestedPoint.pointName}, {user.requestedPoint.city}</strong></span></label>
                        )}
                        {!draft.useRequested && (
                          <div className="point-check-grid">{(data?.points ?? []).map((point) => <label key={point.id}><input type="checkbox" checked={draft.pointIds.includes(point.id)} onChange={() => togglePoint(user, point.id)}/><span>{point.name}<small>{point.city}</small></span></label>)}</div>
                        )}
                      </>
                    )}

                    <div className="approval-summary">
                      <CheckCircle2 size={15}/><span>Po akceptacji użytkownik zobaczy aplikację automatycznie podczas najbliższego sprawdzenia statusu — bez ponownego logowania Google.</span>
                    </div>
                    <div className="button-row"><button className="button primary" onClick={() => void approve(user)} disabled={busy}><UserCheck size={16}/> Akceptuj dostęp</button><button className="button danger-soft" onClick={() => void reject(user)} disabled={busy}><XCircle size={16}/> Odrzuć</button></div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'ACTIVE' && (
        <section className="panel-card admin-section">
          <div className="panel-heading"><div><span className="eyebrow">ZESPÓŁ</span><h2>Aktywne konta i uprawnienia</h2></div></div>
          <div className="users-table">
            {activeUsers.map((user) => {
              const owner = user.role === 'OWNER';
              const draft = draftFor(user);
              return <article className="user-access-row" key={user.id}>
                <div className="user-access-identity"><strong>{user.name}</strong><span>{user.email}</span><small>Ostatnie logowanie: {formatDate(user.lastLoginAt)}</small></div>
                <label><span>Rola</span><select disabled={owner} value={draft.role} onChange={(e) => patchDraft(user, { role: e.target.value as UserRole })}>{owner ? <option value="OWNER">Właściciel aplikacji</option> : ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{ROLE_DEFINITIONS[role].label}</option>)}</select></label>
                <div className="user-points-mini">{owner || draft.role === 'BOSS' ? <span className="global-chip">Wszystkie punkty</span> : <div className="inline-point-checks">{(data?.points ?? []).map((point) => <label key={point.id}><input type="checkbox" checked={draft.pointIds.includes(point.id)} onChange={() => togglePoint(user, point.id)}/><span>{point.name}</span></label>)}</div>}</div>
                {!owner && <button className="button small secondary" onClick={() => void saveAccess(user)} disabled={busy}><CheckCircle2 size={14}/> Zapisz zmiany</button>}
              </article>;
            })}
            {activeUsers.length === 0 && <div className="empty-admin">Brak aktywnych kont pasujących do wyszukiwania.</div>}
          </div>
        </section>
      )}

      {tab === 'AUDIT' && (
        <section className="panel-card admin-section">
          <div className="panel-heading"><div><span className="eyebrow">AUDYT</span><h2>Dziennik logowań</h2></div></div>
          <div className="login-events">{(data?.loginEvents ?? []).filter((event) => !normalizedQuery || `${event.name} ${event.email}`.toLowerCase().includes(normalizedQuery)).slice(0, 100).map((event) => {
            const pointNames = event.role === 'OWNER' || event.role === 'BOSS'
              ? 'Wszystkie punkty'
              : (data?.points ?? []).filter((point) => event.pointIds.includes(point.id)).map((point) => point.name).join(', ') || 'Bez przypisanego punktu';
            return <div key={event.id}><div><strong>{event.name}</strong><span>{event.email}</span></div><div className="login-event-access"><strong>{event.role ? ROLE_DEFINITIONS[event.role].shortLabel : 'Oczekuje'}</strong><small>{pointNames}</small></div><time>{formatDate(event.createdAt)}</time></div>;
          })}</div>
        </section>
      )}
    </div>
  );
}
