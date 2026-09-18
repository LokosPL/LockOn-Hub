import { useMemo, useState } from 'react';
import { ClipboardPlus, Search, Smartphone, UserRound } from 'lucide-react';
import type { AuthState, ServiceCreateOrderResult, ServiceCustomer } from '../types/electron';

interface ServicePageProps { auth: AuthState; }

const emptyForm = {
  firstName: '', lastName: '', email: '', phone: '',
  brand: '', model: '', issueDescription: '', orderType: 'REPAIR' as 'REPAIR' | 'COMPLAINT'
};

export function ServicePage({ auth }: ServicePageProps) {
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ServiceCustomer[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ServiceCreateOrderResult | null>(null);
  const [error, setError] = useState('');

  const pointOptions = useMemo(() => auth.points, [auth.points]);
  const [pointId, setPointId] = useState(auth.point?.id ?? auth.points[0]?.id ?? '');

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

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
    setBusy(true); setError(''); setResult(null);
    try {
      const created = await window.lockOn.service.createOrder({ ...form, pointId });
      setResult(created);
      setForm(emptyForm);
      setMatches([]);
      setQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się utworzyć zlecenia.');
    } finally { setBusy(false); }
  };

  return (
    <div className="service-page page-enter">
      <section className="service-heading">
        <div>
          <div className="eyebrow"><ClipboardPlus size={13}/> SERWIS</div>
          <h1>Nowe zlecenie</h1>
          <p>Dodaj klienta i urządzenie. Jeśli klient już istnieje, ServiceOS użyje istniejącego rekordu zamiast tworzyć duplikat.</p>
        </div>
      </section>

      {result && <div className="service-success">
        <strong>Zlecenie utworzone.</strong>
        <span>{result.reusedCustomer ? 'Użyto istniejącego klienta.' : 'Utworzono nowego klienta.'} Numer: #{result.order.orderNumber ?? result.order.id}</span>
      </div>}
      {error && <div className="service-error">{error}</div>}

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
            <label className="full"><span>Punkt</span><select value={pointId} onChange={(e)=>setPointId(e.target.value)}>{pointOptions.map((p)=><option key={p.id} value={p.id}>{p.name}{p.city ? ` — ${p.city}` : ''}</option>)}</select></label>
            <label className="full"><span>Typ</span><select value={form.orderType} onChange={(e)=>update('orderType',e.target.value)}><option value="REPAIR">Nowe zlecenie</option><option value="COMPLAINT">Reklamacja</option></select></label>
            <label className="full"><span>Opis usterki</span><textarea rows={6} value={form.issueDescription} onChange={(e)=>update('issueDescription',e.target.value)} /></label>
          </div>
          <button className="button primary wide service-submit" disabled={busy || !pointId} onClick={()=>void submit()}>{busy ? 'Zapisywanie…' : 'Utwórz zlecenie'}</button>
        </section>
      </div>
    </div>
  );
}
