import { useEffect, useMemo, useState } from 'react';
import {
  BellRing, CheckCircle2, ClipboardList, ClipboardPlus, Clock3, Mail, MailCheck,
  RefreshCw, RotateCcw, Search, Send, Settings2, Smartphone, UserRound, XCircle
} from 'lucide-react';
import type {
  AuthState,
  GmailConnectionStatus,
  NotificationHistoryItem,
  NotificationSettings,
  ServiceCreateOrderResult,
  ServiceCustomer,
  ServiceOrderSummary
} from '../types/electron';
import type { UserRole } from '../config/roles';

interface ServicePageProps {
  auth: AuthState;
  effectiveRole: UserRole;
}

const emptyForm = {
  firstName: '', lastName: '', email: '', phone: '',
  brand: '', model: '', issueDescription: '', orderType: 'REPAIR' as 'REPAIR' | 'COMPLAINT'
};

const statuses = [
  ['RECEIVED', 'Przyjęto urządzenie'],
  ['DIAGNOSIS', 'Diagnoza'],
  ['WAITING_PARTS', 'Oczekiwanie na części'],
  ['IN_REPAIR', 'W naprawie'],
  ['READY', 'Gotowe do odbioru'],
  ['COMPLETED', 'Zakończone'],
  ['CANCELLED', 'Anulowane'],
  ['REJECTED', 'Odrzucone']
] as const;

const mailStatusOptions = statuses;

const deliveryLabel = (status: NotificationHistoryItem['status']) => ({
  PENDING: 'Oczekuje',
  PROCESSING: 'Wysyłanie',
  SENT: 'Wysłano',
  FAILED: 'Błąd',
  CANCELLED: 'Anulowano'
}[status]);

export function ServicePage({ auth, effectiveRole }: ServicePageProps) {
  const [tab, setTab] = useState<'NEW' | 'ORDERS' | 'EMAILS'>('NEW');
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ServiceCustomer[]>([]);
  const [orders, setOrders] = useState<ServiceOrderSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [result, setResult] = useState<ServiceCreateOrderResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [gmail, setGmail] = useState<GmailConnectionStatus | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [notificationHistory, setNotificationHistory] = useState<NotificationHistoryItem[]>([]);

  const pointOptions = useMemo(() => auth.points, [auth.points]);
  const [pointId, setPointId] = useState(auth.point?.id ?? auth.points[0]?.id ?? '');
  const canEditStatus = ['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN'].includes(effectiveRole);
  const canManageGmail = ['OWNER', 'BOSS', 'COORDINATOR'].includes(effectiveRole);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const loadOrders = async () => {
    setOrdersBusy(true);
    try {
      setOrders(await window.lockOn.service.listOrders());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać zleceń.');
    } finally {
      setOrdersBusy(false);
    }
  };

  const loadMailData = async (selectedPointId = pointId) => {
    if (!selectedPointId || !canManageGmail) {
      setGmail(null);
      setNotificationSettings(null);
      setNotificationHistory([]);
      return;
    }
    setNotificationBusy(true);
    try {
      const [gmailState, settings, history] = await Promise.all([
        window.lockOn.gmail.getStatus(selectedPointId),
        window.lockOn.notifications.getSettings(selectedPointId),
        window.lockOn.notifications.getHistory(selectedPointId)
      ]);
      setGmail(gmailState);
      setNotificationSettings(settings);
      setNotificationHistory(history);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać ustawień powiadomień.');
    } finally {
      setNotificationBusy(false);
    }
  };

  useEffect(() => {
    void loadOrders();
  }, []);

  useEffect(() => {
    void loadMailData(pointId);
  }, [pointId, canManageGmail]);

  const search = async () => {
    const clean = query.trim();
    if (clean.length < 2) { setMatches([]); return; }
    setError('');
    try { setMatches(await window.lockOn.service.searchCustomers(clean)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się wyszukać klienta.'); }
  };

  const useCustomer = (customer: ServiceCustomer) => {
    setForm((current) => ({
      ...current,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email ?? '',
      phone: customer.phone ?? ''
    }));
  };

  const submit = async () => {
    setBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      const created = await window.lockOn.service.createOrder({ ...form, pointId });
      setResult(created);
      if (created.notification?.sent) {
        setNotice('Zlecenie utworzone. Potwierdzenie przyjęcia urządzenia zostało wysłane do klienta.');
      } else if (created.notification?.queued) {
        setNotice('Zlecenie utworzone. Potwierdzenie e-mail trafiło do kolejki i zostanie ponowione automatycznie w razie błędu.');
      } else if (created.notification?.reason === 'NO_CUSTOMER_EMAIL') {
        setNotice('Zlecenie utworzone. Klient nie ma adresu e-mail, więc potwierdzenie nie zostało wysłane.');
      } else if (created.notification?.reason === 'AUTOMATIC_EMAIL_DISABLED' || created.notification?.reason === 'STATUS_NOT_ENABLED') {
        setNotice('Zlecenie utworzone. Automatyczne potwierdzenie przyjęcia jest wyłączone w ustawieniach punktu.');
      }
      setForm(emptyForm);
      setMatches([]);
      setQuery('');
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się utworzyć zlecenia.');
    } finally { setBusy(false); }
  };

  const changeStatus = async (order: ServiceOrderSummary, status: string) => {
    if (status === order.status) return;
    setError('');
    setNotice('');
    try {
      const updated = await window.lockOn.service.updateStatus(order.id, status);
      setOrders((current) => current.map((item) => item.id === order.id ? updated.order : item));
      const n = updated.notification;
      if (n.sent) {
        setNotice('Status zapisany. Wiadomość e-mail została wysłana do klienta.');
      } else if (n.queued) {
        setNotice(n.nextAttemptAt
          ? 'Status zapisany. Wysyłka nie powiodła się i została zaplanowana do ponowienia.'
          : 'Status zapisany. Wiadomość czeka w kolejce.');
      } else if (n.reason === 'AUTOMATIC_EMAIL_DISABLED') {
        setNotice('Status zapisany. Automatyczne wiadomości dla tego punktu są wyłączone.');
      } else if (n.reason === 'STATUS_NOT_ENABLED') {
        setNotice('Status zapisany. Dla tego statusu powiadomienia e-mail są wyłączone.');
      } else if (n.reason === 'NO_CUSTOMER_EMAIL') {
        setNotice('Status zapisany. Klient nie ma adresu e-mail.');
      } else {
        setNotice('Status zapisany.');
      }
      if (canManageGmail) void loadMailData(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zmienić statusu.');
      await loadOrders();
    }
  };

  const connectGmail = async () => {
    if (!pointId) return;
    setGmailBusy(true); setError(''); setNotice('');
    try {
      const status = await window.lockOn.gmail.connect(pointId);
      setGmail(status);
      setNotice('Gmail został bezpiecznie połączony z tym punktem.');
      await loadMailData(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się połączyć Gmail.');
    } finally { setGmailBusy(false); }
  };

  const disconnectGmail = async () => {
    if (!pointId) return;
    setGmailBusy(true); setError(''); setNotice('');
    try {
      await window.lockOn.gmail.disconnect(pointId);
      setGmail({ connected: false, pointId });
      setNotice('Gmail został odłączony od punktu.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się odłączyć Gmail.');
    } finally { setGmailBusy(false); }
  };

  const testGmail = async () => {
    if (!pointId) return;
    setGmailBusy(true); setError(''); setNotice('');
    try {
      const test = await window.lockOn.gmail.test(pointId);
      setNotice('Test wysłany na ' + test.recipient + '. Gmail zwrócił poprawny identyfikator wiadomości.');
      await loadMailData(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test Gmail nie powiódł się.');
    } finally { setGmailBusy(false); }
  };

  const saveNotificationSettings = async () => {
    if (!pointId || !notificationSettings) return;
    setNotificationBusy(true); setError(''); setNotice('');
    try {
      const saved = await window.lockOn.notifications.updateSettings({
        pointId,
        automaticEmailEnabled: notificationSettings.automaticEmailEnabled,
        notifyStatuses: notificationSettings.notifyStatuses,
        senderDisplayName: notificationSettings.senderDisplayName,
        footerText: notificationSettings.footerText
      });
      setNotificationSettings(saved);
      setNotice('Ustawienia automatycznych powiadomień zostały zapisane.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać ustawień powiadomień.');
    } finally { setNotificationBusy(false); }
  };

  const toggleNotifyStatus = (status: string) => {
    setNotificationSettings((current) => {
      if (!current) return current;
      const enabled = current.notifyStatuses.includes(status);
      return {
        ...current,
        notifyStatuses: enabled
          ? current.notifyStatuses.filter((item) => item !== status)
          : [...current.notifyStatuses, status]
      };
    });
  };

  const retryNotification = async (id: string) => {
    setNotificationBusy(true); setError(''); setNotice('');
    try {
      const result = await window.lockOn.notifications.retry(id);
      setNotice(result.sent ? 'Wiadomość została wysłana ponownie.' : 'Ponowienie zapisane. Następna próba została zaplanowana.');
      await loadMailData(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się ponowić wiadomości.');
    } finally { setNotificationBusy(false); }
  };

  return (
    <div className="service-page page-enter">
      <section className="service-heading">
        <div>
          <div className="eyebrow"><ClipboardPlus size={13}/> SERWIS</div>
          <h1>Klienci i naprawy</h1>
          <p>Przyjęcie telefonu, reklamacje, statusy oraz centralne powiadomienia klienta.</p>
        </div>
        <div className="service-tabs">
          <button className={tab === 'NEW' ? 'active' : ''} onClick={() => setTab('NEW')}><ClipboardPlus size={15}/> Nowe zlecenie</button>
          <button className={tab === 'ORDERS' ? 'active' : ''} onClick={() => setTab('ORDERS')}><ClipboardList size={15}/> Zlecenia</button>
          {canManageGmail && <button className={tab === 'EMAILS' ? 'active' : ''} onClick={() => setTab('EMAILS')}><BellRing size={15}/> Powiadomienia</button>}
        </div>
      </section>

      {canManageGmail && (
        <section className="panel-card service-mail-card">
          <div className="service-mail-copy">
            <div className="service-mail-icon">{gmail?.connected ? <MailCheck size={20}/> : <Mail size={20}/>}</div>
            <div>
              <span>Gmail punktu · {pointOptions.find((p) => p.id === pointId)?.name ?? 'punkt'}</span>
              <strong>{gmail?.connected ? gmail.email : 'Gmail niepołączony'}</strong>
              <small>{gmail?.connected
                ? (gmail.lastError ? 'Ostatni błąd: ' + gmail.lastError : 'Połączenie aktywne. ServiceOS ma wyłącznie zakres gmail.send.')
                : 'Połącz konto nadawcy, aby automatycznie informować klientów o statusie naprawy.'}</small>
            </div>
          </div>
          <div className="service-mail-actions">
            {gmail?.connected && <button className="button secondary" disabled={gmailBusy} onClick={() => void testGmail()}><Send size={14}/> Wyślij test</button>}
            {gmail?.connected
              ? <button className="button secondary" disabled={gmailBusy} onClick={() => void disconnectGmail()}>Odłącz Gmail</button>
              : <button className="button primary" disabled={gmailBusy || !pointId} onClick={() => void connectGmail()}>{gmailBusy ? 'Łączenie…' : 'Połącz Gmail'}</button>}
          </div>
        </section>
      )}

      {result && <div className="service-success">
        <strong>Zlecenie utworzone.</strong>
        <span>{result.reusedCustomer ? 'Użyto istniejącego klienta.' : 'Utworzono nowego klienta.'} Numer: #{result.order.orderNumber ?? result.order.id}</span>
      </div>}
      {notice && <div className="service-success"><span>{notice}</span></div>}
      {error && <div className="service-error">{error}</div>}

      {tab === 'NEW' && (
        <div className="service-grid">
          <section className="panel-card service-card">
            <div className="panel-heading"><div><span className="eyebrow"><Search size={13}/> KLIENT</span><h2>Wyszukaj istniejącego</h2></div></div>
            <div className="service-search-row">
              <input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter') void search(); }} placeholder="Nazwisko, email lub telefon"/>
              <button className="button secondary" onClick={()=>void search()}>Szukaj</button>
            </div>
            <div className="service-customer-results">
              {matches.map((customer)=><button key={customer.id} onClick={()=>useCustomer(customer)}>
                <UserRound size={16}/><span><strong>{customer.firstName} {customer.lastName}</strong><small>{customer.email || customer.phone || 'Brak kontaktu'}</small></span>
              </button>)}
            </div>
            <div className="service-form-grid">
              <label><span>Imię</span><input value={form.firstName} onChange={(e)=>update('firstName',e.target.value)} /></label>
              <label><span>Nazwisko</span><input value={form.lastName} onChange={(e)=>update('lastName',e.target.value)} /></label>
              <label><span>Email</span><input type="email" value={form.email} onChange={(e)=>update('email',e.target.value)} /></label>
              <label><span>Telefon</span><input value={form.phone} onChange={(e)=>update('phone',e.target.value)} /></label>
            </div>
          </section>

          <section className="panel-card service-card">
            <div className="panel-heading"><div><span className="eyebrow"><Smartphone size={13}/> URZĄDZENIE</span><h2>Telefon i usterka</h2></div></div>
            <div className="service-form-grid">
              <label><span>Marka</span><input value={form.brand} onChange={(e)=>update('brand',e.target.value)} /></label>
              <label><span>Model</span><input value={form.model} onChange={(e)=>update('model',e.target.value)} /></label>
              <label className="full"><span>Punkt</span><select value={pointId} onChange={(e)=>setPointId(e.target.value)}>{pointOptions.map((p)=><option key={p.id} value={p.id}>{p.name}{p.city ? ' — ' + p.city : ''}</option>)}</select></label>
              <label className="full"><span>Typ</span><select value={form.orderType} onChange={(e)=>update('orderType', e.target.value as 'REPAIR' | 'COMPLAINT')}><option value="REPAIR">Nowe zlecenie</option><option value="COMPLAINT">Zlecenie reklamacyjne</option></select></label>
              <label className="full"><span>Opis usterki</span><textarea rows={6} value={form.issueDescription} onChange={(e)=>update('issueDescription',e.target.value)} /></label>
            </div>
            <button className="button primary wide service-submit" disabled={busy || !pointId} onClick={()=>void submit()}>{busy ? 'Zapisywanie…' : 'Utwórz zlecenie'}</button>
          </section>
        </div>
      )}

      {tab === 'ORDERS' && (
        <section className="panel-card service-orders-card">
          <div className="panel-heading">
            <div><span className="eyebrow"><ClipboardList size={13}/> ZLECENIA</span><h2>Ostatnie naprawy</h2><p>Widoczne są wyłącznie zlecenia z punktów dostępnych dla Twojego konta.</p></div>
            <button className="button small secondary" disabled={ordersBusy} onClick={() => void loadOrders()}><RefreshCw className={ordersBusy ? 'spin' : ''} size={14}/> Odśwież</button>
          </div>
          <div className="service-orders-list">
            {orders.map((order) => (
              <article key={order.id} className="service-order-row">
                <div className="service-order-number">#{order.orderNumber}</div>
                <div className="service-order-main">
                  <strong>{order.customerName}</strong>
                  <span>{order.brand} {order.model} · {order.pointName}</span>
                  <small>{order.orderType === 'COMPLAINT' ? 'Reklamacja' : 'Naprawa'} · {order.customerEmail || order.customerPhone || 'brak kontaktu'}</small>
                </div>
                <div className="service-order-status">
                  {canEditStatus ? (
                    <select value={order.status} onChange={(e) => void changeStatus(order, e.target.value)}>
                      {statuses.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  ) : <span className="status-badge">{order.statusLabel}</span>}
                </div>
              </article>
            ))}
            {!ordersBusy && orders.length === 0 && <div className="service-empty">Brak zleceń w Twoim zakresie.</div>}
          </div>
        </section>
      )}

      {tab === 'EMAILS' && canManageGmail && (
        <div className="notification-layout">
          <section className="panel-card notification-settings-card">
            <div className="panel-heading">
              <div><span className="eyebrow"><Settings2 size={13}/> AUTOMATYKA</span><h2>Ustawienia wiadomości</h2><p>Konfiguracja jest zapisana centralnie dla wybranego punktu.</p></div>
            </div>
            {notificationSettings && <>
              <label className="notification-toggle">
                <input
                  type="checkbox"
                  checked={notificationSettings.automaticEmailEnabled}
                  onChange={(e)=>setNotificationSettings({...notificationSettings,automaticEmailEnabled:e.target.checked})}
                />
                <span><strong>Automatyczne e-maile</strong><small>Po zmianie wybranego statusu ServiceOS od razu spróbuje wysłać wiadomość.</small></span>
              </label>

              <div className="notification-field">
                <span>Nazwa nadawcy</span>
                <input value={notificationSettings.senderDisplayName} maxLength={80} onChange={(e)=>setNotificationSettings({...notificationSettings,senderDisplayName:e.target.value})}/>
              </div>

              <div className="notification-field">
                <span>Stopka wiadomości</span>
                <textarea rows={3} maxLength={500} value={notificationSettings.footerText} onChange={(e)=>setNotificationSettings({...notificationSettings,footerText:e.target.value})} placeholder="Np. W razie pytań zadzwoń do punktu serwisowego."/>
              </div>

              <div className="notification-field">
                <span>Wyślij wiadomość po statusie</span>
                <div className="notification-status-grid">
                  {mailStatusOptions.map(([value,label]) => (
                    <button key={value} className={notificationSettings.notifyStatuses.includes(value) ? 'active' : ''} onClick={()=>toggleNotifyStatus(value)}>
                      {notificationSettings.notifyStatuses.includes(value) ? <CheckCircle2 size={14}/> : <Clock3 size={14}/>}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <button className="button primary" disabled={notificationBusy} onClick={()=>void saveNotificationSettings()}>
                {notificationBusy ? 'Zapisywanie…' : 'Zapisz ustawienia'}
              </button>
            </>}
          </section>

          <section className="panel-card notification-history-card">
            <div className="panel-heading">
              <div><span className="eyebrow"><MailCheck size={13}/> HISTORIA</span><h2>Ostatnie wiadomości</h2><p>Wynik Gmail, liczba prób i błędy dostawy.</p></div>
              <button className="button small secondary" disabled={notificationBusy} onClick={()=>void loadMailData(pointId)}><RefreshCw className={notificationBusy ? 'spin' : ''} size={14}/> Odśwież</button>
            </div>
            <div className="notification-history-list">
              {notificationHistory.map((item) => (
                <article key={item.id} className={'notification-history-row status-' + item.status.toLowerCase()}>
                  <div className="notification-delivery-icon">
                    {item.status === 'SENT' ? <CheckCircle2 size={17}/> : item.status === 'FAILED' ? <XCircle size={17}/> : <Clock3 size={17}/>}
                  </div>
                  <div className="notification-history-main">
                    <strong>{item.orderNumber ? '#' + item.orderNumber + ' · ' : ''}{item.customerName || item.recipient}</strong>
                    <span>{item.device || item.recipient}</span>
                    <small>{deliveryLabel(item.status)} · próby: {item.attempts}{item.sentAt ? ' · ' + new Date(item.sentAt).toLocaleString('pl-PL') : ''}</small>
                    {item.lastError && <small className="notification-error-text">{item.lastError}</small>}
                  </div>
                  {item.status === 'FAILED' && (
                    <button className="button small secondary" disabled={notificationBusy} onClick={()=>void retryNotification(item.id)}><RotateCcw size={13}/> Ponów</button>
                  )}
                </article>
              ))}
              {!notificationBusy && notificationHistory.length === 0 && <div className="service-empty">Brak wysłanych powiadomień dla tego punktu.</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
