import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  Clock3,
  Globe2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserCheck,
  UsersRound,
  Wrench,
  XCircle
} from 'lucide-react';
import { ROLE_DEFINITIONS, type UserRole } from '../config/roles';
import type { AdminOverview, AdminPoint, AdminUser } from '../types/electron';

const ASSIGNABLE_ROLES: UserRole[] = ['BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER'];
type AdminTab = 'PENDING' | 'ACTIVE' | 'SECURITY' | 'POINTS' | 'AUDIT';

function formatDate(value?: string | null) {
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
  const [drafts, setDrafts] = useState<Record<string, { role: UserRole; pointIds: string[]; useRequested: boolean; technicianSplitPercent: number | null }>>({});
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [pointForm, setPointForm] = useState({ name:'', city:'', serviceEnabled:false, acceptsExternalRepairs:false, serviceNote:'' });

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
    const timer = window.setInterval(() => void load(true), 12_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const draftFor = (user: AdminUser) => {
    if (user.role === 'OWNER') {
      return drafts[user.id] ?? { role: 'OWNER' as UserRole, pointIds: [], useRequested: false, technicianSplitPercent: null };
    }
    const requestedRole = user.requestedPoint?.requestedRole;
    const suggestedRole = requestedRole && requestedRole !== 'OWNER' ? requestedRole : 'USER';
    return drafts[user.id] ?? {
      role: (user.role ?? suggestedRole) as UserRole,
      pointIds: user.pointIds ?? [],
      useRequested: Boolean(user.requestedPoint) && suggestedRole !== 'BOSS',
      technicianSplitPercent: user.technicianSplitPercent ?? user.requestedPoint?.technicianSplitPercent ?? 50
    };
  };

  const patchDraft = (user: AdminUser, patch: Partial<{ role: UserRole; pointIds: string[]; useRequested: boolean; technicianSplitPercent: number | null }>) => {
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
      setNotice(`Konto ${user.email} zostało odrzucone.`);
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się odrzucić konta.');
    } finally { setBusy(false); }
  };

  const saveAccess = async (user: AdminUser) => {
    const draft = draftFor(user);
    setBusy(true); setNotice('');
    try {
      await window.lockOn.admin.updateUserAccess(user.id, { role: draft.role, pointIds: draft.pointIds, technicianSplitPercent: draft.role === 'TECHNICIAN' ? draft.technicianSplitPercent : null });
      setEditingUserId(null);
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

  const blockUser = async (user: AdminUser, blocked: boolean) => {
    const promptResult = blocked ? window.prompt('Powód blokady (opcjonalnie):', user.blockedReason || '') : '';
    if (blocked && promptResult === null) return;
    const reason = promptResult ?? '';
    setBusy(true); setNotice('');
    try {
      await window.lockOn.admin.blockUser(user.id, blocked, reason);
      setNotice(blocked
        ? `Konto ${user.email} zostało zablokowane, a jego aktywne sesje unieważniono.`
        : `Konto ${user.email} zostało odblokowane.`);
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się zmienić blokady konta.');
    } finally { setBusy(false); }
  };

  const logoutUser = async (user: AdminUser) => {
    if (!window.confirm(`Wylogować konto ${user.email} ze wszystkich urządzeń?`)) return;
    setBusy(true); setNotice('');
    try {
      const result = await window.lockOn.admin.logoutUserSessions(user.id);
      setNotice(`Unieważniono sesje: ${result.revoked}.`);
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się unieważnić sesji.');
    } finally { setBusy(false); }
  };

  const logoutEveryone = async () => {
    if (!window.confirm('Wylogować wszystkich użytkowników ze wszystkich urządzeń? Twoja bieżąca sesja pozostanie aktywna.')) return;
    setBusy(true); setNotice('');
    try {
      const result = await window.lockOn.admin.logoutAllSessions(true);
      setNotice(`Unieważniono ${result.revoked} aktywnych sesji. Bieżąca sesja OWNER pozostała aktywna.`);
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się wylogować wszystkich.');
    } finally { setBusy(false); }
  };

  const updatePointService = async (
    point: AdminPoint,
    serviceEnabled: boolean,
    acceptsExternalRepairs: boolean,
    externalRepairsPaused = point.externalRepairsPaused === true
  ) => {
    setBusy(true); setNotice('');
    try {
      await window.lockOn.admin.updatePointService(point.id, {
        serviceEnabled,
        acceptsExternalRepairs: serviceEnabled && acceptsExternalRepairs,
        externalRepairsPaused,
        serviceNote: point.serviceNote || ''
      });
      setNotice(`Zapisano konfigurację serwisu dla ${point.name}.`);
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się zmienić konfiguracji serwisu.');
    } finally { setBusy(false); }
  };

  const createPoint = async () => {
    if (!pointForm.name.trim() || !pointForm.city.trim()) {
      setNotice('Wpisz nazwę i miasto nowego punktu.');
      return;
    }
    setBusy(true); setNotice('');
    try {
      await window.lockOn.admin.createPoint(pointForm);
      setPointForm({ name:'', city:'', serviceEnabled:false, acceptsExternalRepairs:false, serviceNote:'' });
      setNotice('Nowy punkt został utworzony.');
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się utworzyć punktu.');
    } finally { setBusy(false); }
  };

  const factoryReset = async () => {
    setBusy(true); setNotice('');
    try {
      const preview = await window.lockOn.admin.factoryResetPreview();
      const counts = preview.counts ?? {};
      const summary = [
        `punkty: ${counts.points ?? 0}`,
        `użytkownicy: ${counts.users ?? 0}`,
        `zlecenia: ${counts.serviceOrders ?? 0}`,
        `przekazania: ${counts.transfers ?? 0}`,
        `klienci: ${counts.customers ?? 0}`,
        `urządzenia: ${counts.devices ?? 0}`,
        `rozliczenia: ${counts.revenues ?? 0}`,
        `sesje: ${counts.sessions ?? 0}`
      ].join('\n');
      if (!window.confirm('Factory reset usunie wszystkie dane biznesowe z produkcyjnej bazy ServiceOS.\n\nAktualny stan:\n' + summary + '\n\nSchemat, role, migracje, wiedza systemowa i dziennik resetów pozostaną. Kontynuować?')) return;
      const phrase = window.prompt('Wpisz dokładnie frazę:\n\nUSUŃ WSZYSTKIE DANE');
      if (phrase === null) return;
      if (phrase !== 'USUŃ WSZYSTKIE DANE') {
        setNotice('Reset anulowany: fraza potwierdzająca nie jest identyczna.');
        return;
      }
      if (!window.confirm('OSTATECZNE POTWIERDZENIE\n\nPo kliknięciu OK dane pokazane powyżej zostaną nieodwracalnie usunięte.')) return;
      const result = await window.lockOn.admin.factoryReset({
        phrase,
        confirmed:true,
        reason:'Pełny factory reset uruchomiony przez OWNER z aplikacji desktop'
      });
      const removed = Object.values(result.deleted ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
      setNotice(`Factory reset zakończony. Usunięto ${removed} rekordów operacyjnych. Id: ${result.resetId}.`);
      await window.lockOn.auth.logout().catch(() => undefined);
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Factory reset nie został wykonany.');
    } finally {
      setBusy(false);
    }
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

  const blockedUsers = data?.blockedUsers ?? (data?.users ?? []).filter((user) => user.blocked);

  return (
    <div className="admin-page page-enter">
      <section className="admin-heading admin-heading-v2">
        <div>
          <div className="eyebrow">CENTRUM WŁAŚCICIELA SERVICEOS</div>
          <h1>Administracja i bezpieczeństwo</h1>
          <p>Konta, punkty, serwisy, aktywne sesje i dziennik działań w jednym miejscu. Blokada konta od razu unieważnia jego sesje desktopowe i WWW.</p>
        </div>
        <div className="admin-live-controls">
          <label className="auto-refresh-toggle"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /><span>Auto-odświeżanie</span></label>
          <button className="button secondary" onClick={() => void load()} disabled={busy}><RefreshCw className={busy ? 'spin' : ''} size={16}/> Odśwież</button>
        </div>
      </section>

      {notice && <div className="admin-notice">{notice}</div>}

      <section className="admin-stats admin-stats-security">
        <article className={data?.pendingUsers.length ? 'stat-attention' : ''}><Clock3 size={20}/><div><span>Do akceptacji</span><strong>{data?.pendingUsers.length ?? 0}</strong></div></article>
        <article><UsersRound size={20}/><div><span>Aktywne konta</span><strong>{(data?.users ?? []).filter((u) => u.status === 'ACTIVE' && !u.blocked).length}</strong></div></article>
        <article><Globe2 size={20}/><div><span>Sesje WWW</span><strong>{data?.system?.webSessions ?? 0}</strong></div></article>
        <article><Smartphone size={20}/><div><span>Sesje desktop</span><strong>{data?.system?.desktopSessions ?? 0}</strong></div></article>
        <article><Wrench size={20}/><div><span>Punkty serwisowe</span><strong>{data?.system?.servicePoints ?? 0}</strong></div></article>
        <article className={data?.system?.openTransfers ? 'stat-attention' : ''}><Activity size={20}/><div><span>Przekazania w toku</span><strong>{data?.system?.openTransfers ?? 0}</strong></div></article>
      </section>

      <section className="admin-toolbar panel-card">
        <div className="admin-tabs admin-tabs-wide">
          <button className={tab === 'PENDING' ? 'active' : ''} onClick={() => setTab('PENDING')}><Clock3 size={15}/> Do akceptacji <span>{data?.pendingUsers.length ?? 0}</span></button>
          <button className={tab === 'ACTIVE' ? 'active' : ''} onClick={() => setTab('ACTIVE')}><UsersRound size={15}/> Użytkownicy</button>
          <button className={tab === 'SECURITY' ? 'active' : ''} onClick={() => setTab('SECURITY')}><ShieldCheck size={15}/> Bezpieczeństwo</button>
          <button className={tab === 'POINTS' ? 'active' : ''} onClick={() => setTab('POINTS')}><Building2 size={15}/> Punkty / serwisy</button>
          <button className={tab === 'AUDIT' ? 'active' : ''} onClick={() => setTab('AUDIT')}><Activity size={15}/> Audyt</button>
        </div>
        <div className="admin-search"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Szukaj po nazwie, e-mailu lub punkcie…" /></div>
        <small className="admin-last-refresh">{autoRefresh ? '● AUTO' : 'AUTO wyłączone'}{lastRefresh ? ` • ${lastRefresh.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : ''}</small>
      </section>

      {tab === 'PENDING' && (
        <section className="panel-card admin-section">
          <div className="panel-heading"><div><span className="eyebrow">WYMAGA DECYZJI</span><h2>Nowe zgłoszenia dostępu</h2></div><div className="roadmap-count">{pendingUsers.length}</div></div>
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
                    <div className="request-intent-item role-intent"><span>Prosi o rolę</span><strong>{ROLE_DEFINITIONS[requestRole].label}</strong><small>Możesz ją zmienić przed akceptacją.</small></div>
                    {requestRole === 'TECHNICIAN' && <div className="request-intent-item settlement-intent"><span>Wybrane rozliczenie</span><strong>{user.requestedPoint?.technicianSplitPercent ?? '—'}% dla serwisanta</strong><small>{user.requestedPoint?.technicianSplitPercent == null ? 'Serwisant nie ustawił procentu.' : `${100-user.requestedPoint.technicianSplitPercent}% dla Szefa`}</small></div>}
                  </div>
                  <div className="approval-controls approval-controls-v2">
                    <div className="approval-title"><UserCheck size={16}/><div><strong>Decyzja OWNER</strong><span>Rola i zakres punktów.</span></div></div>
                    <label><span>Rola po akceptacji</span><select value={draft.role} onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      patchDraft(user, { role: nextRole, useRequested: nextRole === 'BOSS' ? false : draft.useRequested });
                    }}>{ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{ROLE_DEFINITIONS[role].label}</option>)}</select></label>
                    {globalRole ? (
                      <div className="global-access-note"><ShieldCheck size={15}/><span>Rola <strong>Szef</strong> ma dostęp globalny.</span></div>
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
                    <div className="button-row"><button className="button primary" onClick={() => void approve(user)} disabled={busy}><UserCheck size={16}/> Akceptuj</button><button className="button danger-soft" onClick={() => void reject(user)} disabled={busy}><XCircle size={16}/> Odrzuć</button></div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'ACTIVE' && (
        <section className="panel-card admin-section">
          <div className="panel-heading"><div><span className="eyebrow">ZESPÓŁ</span><h2>Konta i uprawnienia</h2></div></div>
          <div className="users-table">
            {activeUsers.map((user) => {
              const owner = user.role === 'OWNER';
              const draft = draftFor(user);
              const editing = editingUserId === user.id;
              const pointNames = owner || user.role === 'BOSS'
                ? 'Wszystkie punkty'
                : (data?.points ?? []).filter((point)=>user.pointIds.includes(point.id)).map((point)=>point.name).join(', ') || 'Brak przypisanego punktu';
              return <article className={`user-access-row ${user.blocked ? 'user-blocked' : ''}`} key={user.id}>
                <div className="user-access-identity">
                  <strong>{user.name}{user.blocked && <span className="blocked-chip">ZABLOKOWANE</span>}</strong>
                  <span>{user.email}</span>
                  <small>{user.role ? ROLE_DEFINITIONS[user.role].label : 'Bez roli'} · {pointNames}</small>
                  <small>Status: {user.blocked ? 'Zablokowane' : 'Aktywne'} · ostatnie logowanie: {formatDate(user.lastLoginAt)}</small>
                  {user.role === 'TECHNICIAN' && <small>Rozliczenie: {user.technicianSplitPercent == null ? 'nieustawione' : `${user.technicianSplitPercent}% serwisant / ${100-user.technicianSplitPercent}% firma`}</small>}
                </div>
                {editing && !owner ? <>
                  <label><span>Rola</span><select disabled={user.blocked} value={draft.role} onChange={(e) => patchDraft(user, { role: e.target.value as UserRole })}>{ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{ROLE_DEFINITIONS[role].label}</option>)}</select></label>
                  <div className="user-points-mini">{draft.role === 'BOSS' ? <span className="global-chip">Wszystkie punkty</span> : <div className="inline-point-checks">{(data?.points ?? []).map((point) => <label key={point.id}><input disabled={user.blocked} type="checkbox" checked={draft.pointIds.includes(point.id)} onChange={() => togglePoint(user, point.id)}/><span>{point.name}</span></label>)}</div>}</div>
                  {draft.role === 'TECHNICIAN' && <label><span>Udział serwisanta (%)</span><input type="number" min="0" max="100" step="0.01" value={draft.technicianSplitPercent ?? ''} onChange={(e)=>patchDraft(user,{technicianSplitPercent:e.target.value===''?null:Number(e.target.value)})}/></label>}
                </> : <div className="user-points-mini"><span className="global-chip">{pointNames}</span></div>}
                <div className="user-admin-actions">
                  {!owner && !editing && <button className="button small secondary" onClick={() => setEditingUserId(user.id)} disabled={busy || user.blocked}><CheckCircle2 size={14}/> Edytuj konto</button>}
                  {!owner && editing && <><button className="button small primary" onClick={() => void saveAccess(user)} disabled={busy}><CheckCircle2 size={14}/> Zapisz zmiany</button><button className="button small secondary" onClick={() => setEditingUserId(null)} disabled={busy}>Anuluj</button></>}
                  {!owner && <button className={`button small ${user.blocked ? 'secondary' : 'danger-soft'}`} onClick={() => void blockUser(user,!user.blocked)} disabled={busy}>{user.blocked ? <CheckCircle2 size={14}/> : <Ban size={14}/>}{user.blocked ? 'Odblokuj' : 'Zablokuj'}</button>}
                  <button className="button small secondary" onClick={() => void logoutUser(user)} disabled={busy}><LogOut size={14}/> Wyloguj urządzenia</button>
                </div>
              </article>;
            })}
            {activeUsers.length === 0 && <div className="empty-admin">Brak kont pasujących do wyszukiwania.</div>}
          </div>
        </section>
      )}

      {tab === 'SECURITY' && (
        <div className="admin-security-grid">
          <section className="panel-card admin-section danger-admin-card">
            <div className="panel-heading"><div><span className="eyebrow">SESJE</span><h2>Natychmiastowe wylogowanie</h2><p>Unieważnia tokeny desktopowe i WWW. Nie usuwa kont ani danych.</p></div></div>
            <div className="security-session-stats">
              <div><Smartphone size={17}/><span>Desktop</span><strong>{data?.system?.desktopSessions ?? 0}</strong></div>
              <div><Globe2 size={17}/><span>WWW</span><strong>{data?.system?.webSessions ?? 0}</strong></div>
              <div><ShieldCheck size={17}/><span>Łącznie</span><strong>{data?.system?.activeSessions ?? 0}</strong></div>
            </div>
            <button className="button danger-soft" disabled={busy} onClick={() => void logoutEveryone()}><LogOut size={15}/> Wyloguj wszystkich poza mną</button>
          </section>

          <section className="panel-card admin-section">
            <div className="panel-heading"><div><span className="eyebrow">BLOKADY</span><h2>Zablokowane konta</h2><p>Zablokowane konto nie może używać istniejącej sesji ani utworzyć nowej.</p></div><div className="roadmap-count">{blockedUsers.length}</div></div>
            <div className="blocked-users-list">
              {blockedUsers.map((user)=><article key={user.id}>
                <div><strong>{user.name}</strong><span>{user.email}</span><small>{user.blockedReason || 'Bez podanego powodu'} · {formatDate(user.blockedAt)}</small></div>
                <button className="button small secondary" disabled={busy} onClick={()=>void blockUser(user,false)}>Odblokuj</button>
              </article>)}
              {blockedUsers.length===0 && <div className="empty-admin">Brak zablokowanych kont.</div>}
            </div>
          </section>

          <section className="panel-card admin-section factory-reset-card">
            <div className="panel-heading">
              <div><span className="eyebrow"><AlertTriangle size={13}/> STREFA NIEBEZPIECZNA</span><h2>Factory reset danych ServiceOS</h2><p>Usuwa dane biznesowe, punkty, klientów, urządzenia, zlecenia, użytkowników i sesje. Zachowuje schemat, migracje, role, wiedzę systemową oraz trwały dziennik resetów.</p></div>
            </div>
            <div className="factory-reset-warning">
              <Trash2 size={20}/>
              <div><strong>Operacja nieodwracalna</strong><span>Przed resetem ServiceOS pokaże dokładne liczniki danych do usunięcia. Potem wymaga frazy „USUŃ WSZYSTKIE DANE” i drugiego potwierdzenia.</span></div>
            </div>
            <button className="button danger-soft" disabled={busy} onClick={()=>void factoryReset()}><Trash2 size={15}/> Wymaż całą bazę danych biznesowych</button>
          </section>
        </div>
      )}

      {tab === 'POINTS' && (
        <div className="admin-points-layout">
          <section className="panel-card admin-section">
            <div className="panel-heading"><div><span className="eyebrow">PUNKTY I SERWISY</span><h2>Możliwości punktów</h2><p>„Przyjmuje zewnętrzne” oznacza, że inne punkty mogą wysłać tutaj urządzenie do naprawy.</p></div></div>
            <div className="service-point-admin-list">
              {(data?.points ?? []).map((point)=><article key={point.id}>
                <div className="service-point-admin-title"><Building2 size={17}/><div><strong>{point.name}</strong><span>{point.city}</span></div></div>
                <div className="service-point-auto-meta">
                  <span><Wrench size={13}/> Aktywni technicy: <strong>{point.activeTechnicianCount ?? 0}</strong></span>
                  {point.autoServiceEnabled && <span className="status-badge">Automatyczny cel przekazania</span>}
                  {point.externalRepairsPaused && <span className="status-badge danger">Przyjęcia wstrzymane</span>}
                </div>
                <label><input type="checkbox" checked={point.manualServiceEnabled===true} onChange={(e)=>void updatePointService(point,e.target.checked,e.target.checked ? point.manualAcceptsExternalRepairs===true : false)}/><span>Ręczny wyjątek: punkt działa jako serwis także bez technika</span></label>
                <label><input type="checkbox" disabled={!point.manualServiceEnabled} checked={point.manualAcceptsExternalRepairs===true} onChange={(e)=>void updatePointService(point,true,e.target.checked)}/><span>Ręczny wyjątek: przyjmuj przekazania bez aktywnego technika</span></label>
                <label><input type="checkbox" checked={point.externalRepairsPaused===true} onChange={(e)=>void updatePointService(point,point.manualServiceEnabled===true,point.manualAcceptsExternalRepairs===true,e.target.checked)}/><span>Wstrzymaj nowe przekazania do tego punktu</span></label>
                <small className="service-point-rule">{point.activeTechnicianCount
                  ? 'Aktywny TECHNICIAN automatycznie udostępnia punkt jako cel przekazania. Wstrzymanie ma pierwszeństwo.'
                  : point.acceptsExternalRepairs
                    ? 'Punkt jest dostępny dzięki ręcznej konfiguracji OWNER.'
                    : 'Brak aktywnego TECHNICIAN — punkt nie przyjmuje nowych przekazań.'}</small>
              </article>)}
            </div>
          </section>

          <section className="panel-card admin-section create-service-point-card">
            <div className="panel-heading"><div><span className="eyebrow">NOWA LOKALIZACJA</span><h2>Dodaj punkt / serwis</h2></div></div>
            <div className="service-form-grid">
              <label><span>Nazwa</span><input value={pointForm.name} onChange={(e)=>setPointForm({...pointForm,name:e.target.value})} placeholder="np. Serwis Szczecin"/></label>
              <label><span>Miasto</span><input value={pointForm.city} onChange={(e)=>setPointForm({...pointForm,city:e.target.value})}/></label>
              <label className="full check-line"><input type="checkbox" checked={pointForm.serviceEnabled} onChange={(e)=>setPointForm({...pointForm,serviceEnabled:e.target.checked,acceptsExternalRepairs:e.target.checked?pointForm.acceptsExternalRepairs:false})}/><span>Ręczny serwis bez aktywnego TECHNICIAN</span></label>
              <label className="full check-line"><input type="checkbox" disabled={!pointForm.serviceEnabled} checked={pointForm.acceptsExternalRepairs} onChange={(e)=>setPointForm({...pointForm,acceptsExternalRepairs:e.target.checked})}/><span>Ręcznie przyjmuj przekazania bez aktywnego TECHNICIAN</span></label>
              <label className="full"><span>Notatka wewnętrzna</span><textarea rows={3} value={pointForm.serviceNote} onChange={(e)=>setPointForm({...pointForm,serviceNote:e.target.value})} placeholder="Np. serwis płyt głównych i mikrolutowanie"/></label>
            </div>
            <button className="button primary" disabled={busy} onClick={()=>void createPoint()}><Building2 size={15}/> Dodaj lokalizację</button>
          </section>
        </div>
      )}

      {tab === 'AUDIT' && (
        <section className="panel-card admin-section">
          <div className="panel-heading"><div><span className="eyebrow">AUDYT</span><h2>Ostatnie działania</h2></div></div>
          <div className="login-events audit-events">{(data?.recentAudit ?? []).filter((event)=>!normalizedQuery || `${event.actorName} ${event.action}`.toLowerCase().includes(normalizedQuery)).map((event) => (
            <div key={event.id}>
              <div><strong>{event.actorName}</strong><span>{event.action}</span></div>
              <div className="login-event-access"><strong>{event.entityType}</strong><small>{event.entityId || event.pointId || '—'}</small></div>
              <time>{formatDate(event.createdAt)}</time>
            </div>
          ))}
          {(data?.recentAudit ?? []).length===0 && <div className="empty-admin">Brak danych audytu.</div>}
          </div>
        </section>
      )}
    </div>
  );
}
