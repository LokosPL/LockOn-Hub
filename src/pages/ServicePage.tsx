import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, ClipboardPlus, Mail, MailCheck, RefreshCw, Search, Smartphone, UserRound } from 'lucide-react';
import type {
  AuthState,
  GmailConnectionStatus,
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

export function ServicePage({ auth, effectiveRole }: ServicePageProps) {
  const [tab, setTab] = useState<'NEW' | 'ORDERS'>('NEW');
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

  const loadGmail = async (selectedPointId = pointId) => {
    if (!selectedPointId || !canManageGmail) {
      setGmail(null);
      return;
    }
    try {
      setGmail(await window.lockOn.gmail.getStatus(selectedPointId));
    } catch {
      setGmail(null);
    }
  };

  useEffect(() => {
    void loadOrders();
  }, []);

  useEffect(() => {
    void loadGmail(pointId);
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
      if (updated.notification.queued) {
        setNotice(updated.notification.sent
          ? 'Status zapisany. Klient otrzymał automatyczne powiadomienie e-mail.'
          : 'Status zapisany. E-mail trafił do kolejki, ale nie został jeszcze wysłany.');
      } else {
        setNotice('Status zapisany. Klient nie ma adresu e-mail, więc powiadomienie nie zostało utworzone.');
      }
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

  return (
    <div className="service-page page-enter">
      <section className="service-heading">
        <div>
          <div className="eyebrow"><ClipboardPlus size={13}/> SERWIS</div>
          <h1>Klienci i naprawy</h1>
          <p>Jedno miejsce do przyjęcia telefonu, ponownego użycia istniejącego klienta, reklamacji, statusów i automatycznych powiadomień.</p>
        </div>
        <div className="service-tabs">
          <button className={tab === 'NEW' ? 'active' : ''} onClick={() => setTab('NEW')}><ClipboardPlus size={15}/> Nowe zlecenie</button>
          <button className={tab === 'ORDERS' ? 'active' : ''} onClick={() => setTab('ORDERS')}><ClipboardList size={15}/> Zlecenia</button>
        </div>
      </section>

      {canManageGmail && (
        <section className="panel-card service-mail-card">
          <div className="service-mail-copy">
            <div className="service-mail-icon">{gmail?.connected ? <MailCheck size={20}/> : <Mail size={20}/>}</div>
            <div>
              <span>Powiadomienia klienta · {pointOptions.find((p) => p.id === pointId)?.name ?? 'punkt'}</span>
              <strong>{gmail?.connected ? gmail.email : 'Gmail niepołączony'}</strong>
              <small>ServiceOS używa wyłącznie zakresu gmail.send. Refresh token po połączeniu trafia zaszyfrowany do centralnego backendu i nie jest zapisywany w aplikacji.</small>
            </div>
          </div>
          {gmail?.connected
            ? <button className="button secondary" disabled={gmailBusy} onClick={() => void disconnectGmail()}>Odłącz Gmail</button>
            : <button className="button primary" disabled={gmailBusy || !pointId} onClick={() => void connectGmail()}>{gmailBusy ? 'Łączenie…' : 'Połącz Gmail'}</button>}
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
    </div>
  );
}
