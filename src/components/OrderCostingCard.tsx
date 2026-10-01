import { useEffect, useMemo, useState } from 'react';
import { Calculator, Download, FileText, PackagePlus, ReceiptText, Save, Trash2, Upload } from 'lucide-react';
import type { ServiceCosting, ServiceInvoice, ServiceOrderPart, ServiceOrderSummary } from '../types/electron';
import { useAppDialog } from './AppDialog';

interface Props {
  order: ServiceOrderSummary;
  disabled?: boolean;
  guided?: boolean;
}

type PartDraft = Pick<ServiceOrderPart, 'description' | 'quantity' | 'unitCostGross' | 'invoiceReceived'> & {
  invoiceNumber?: string;
  supplier?: string;
  purchasedAt?: string;
};

const money = (value: number | null | undefined, currency = 'PLN') =>
  value == null ? '—' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(value);

const emptyPart = (): PartDraft => ({
  description: '',
  quantity: 1,
  unitCostGross: 0,
  invoiceReceived: false,
  invoiceNumber: '',
  supplier: '',
  purchasedAt: ''
});

export function OrderCostingCard({ order, disabled = false, guided = false }: Props) {
  const { confirm } = useAppDialog();
  const [data, setData] = useState<ServiceCosting | null>(null);
  const [parts, setParts] = useState<PartDraft[]>([]);
  const [labor, setLabor] = useState('0');
  const [other, setOther] = useState('0');
  const [invoiceMeta, setInvoiceMeta] = useState({
    invoiceNumber: '',
    supplier: '',
    invoiceDate: '',
    grossAmount: '',
    partDescription: ''
  });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setBusy((current) => current || 'load');
    setError('');
    try {
      const result = await window.lockOn.service.getCosting(order.id);
      setData(result);
      setLabor(String(result.laborCostGross || 0));
      setOther(String(result.otherCostGross || 0));
      setParts(result.parts.map((part) => ({
        description: part.description,
        quantity: part.quantity,
        unitCostGross: part.unitCostGross,
        invoiceReceived: part.invoiceReceived,
        invoiceNumber: part.invoiceNumber || '',
        supplier: part.supplier || '',
        purchasedAt: part.purchasedAt ? String(part.purchasedAt).slice(0, 10) : ''
      })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać rozliczenia zlecenia.');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    void load();
  }, [order.id]);

  const totals = useMemo(() => {
    const partsCost = parts.reduce(
      (sum, part) => sum + (Number(part.quantity) || 0) * (Number(part.unitCostGross) || 0),
      0
    );
    const internalCost = partsCost + (Number(labor) || 0) + (Number(other) || 0);
    const customerPrice = order.finalCost ?? order.estimatedCost ?? null;
    const result = customerPrice == null ? null : Math.round((customerPrice - internalCost) * 100) / 100;
    return {
      partsCost: Math.round(partsCost * 100) / 100,
      internalCost: Math.round(internalCost * 100) / 100,
      customerPrice,
      result
    };
  }, [parts, labor, other, order.finalCost, order.estimatedCost]);

  const resultCopy = totals.customerPrice == null
    ? 'Najpierw ustaw cenę dla klienta. Wtedy ServiceOS pokaże wynik naprawy.'
    : totals.result == null
      ? ''
      : totals.result < 0
        ? `Koszty są o ${money(Math.abs(totals.result))} wyższe niż cena klienta. Podnieś cenę albo sprawdź wpisane koszty.`
        : totals.result === 0
          ? 'Cena klienta dokładnie pokrywa wpisane koszty.'
          : `Po odjęciu wpisanych kosztów zostaje ${money(totals.result)}.`;

  const patchPart = (index: number, patch: Partial<PartDraft>) => {
    setParts((current) => current.map((part, itemIndex) => itemIndex === index ? { ...part, ...patch } : part));
  };

  const save = async () => {
    if (busy || disabled) return;
    if (parts.some((part) => !part.description.trim())) {
      setError('Każda część musi mieć opis.');
      return;
    }
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const result = await window.lockOn.service.saveCosting(order.id, {
        laborCostGross: Number(String(labor).replace(',', '.')) || 0,
        otherCostGross: Number(String(other).replace(',', '.')) || 0,
        parts: parts.map((part) => ({
          description: part.description.trim(),
          quantity: Number(part.quantity) || 1,
          unitCostGross: Number(part.unitCostGross) || 0,
          invoiceReceived: part.invoiceReceived,
          invoiceNumber: part.invoiceReceived ? (part.invoiceNumber || '').trim() : '',
          supplier: part.invoiceReceived ? (part.supplier || '').trim() : '',
          purchasedAt: part.invoiceReceived ? (part.purchasedAt || '') : ''
        }))
      });
      setData(result);
      setNotice('Koszty naprawy zostały zapisane.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać kosztów.');
    } finally {
      setBusy('');
    }
  };

  const uploadInvoice = async () => {
    if (busy || disabled) return;
    setBusy('upload');
    setError('');
    setNotice('');
    try {
      const grossAmount = invoiceMeta.grossAmount === ''
        ? null
        : Number(String(invoiceMeta.grossAmount).replace(',', '.'));
      const result = await window.lockOn.service.uploadInvoice(order.id, {
        invoiceNumber: invoiceMeta.invoiceNumber.trim(),
        supplier: invoiceMeta.supplier.trim(),
        invoiceDate: invoiceMeta.invoiceDate,
        grossAmount
      });
      if (result.cancelled) return;

      const invoice = result.invoice;
      const partDescription = invoiceMeta.partDescription.trim();
      if (invoice && partDescription && grossAmount != null && Number.isFinite(grossAmount) && grossAmount >= 0) {
        const nextParts: PartDraft[] = [
          ...parts,
          {
            description: partDescription,
            quantity: 1,
            unitCostGross: grossAmount,
            invoiceReceived: true,
            invoiceNumber: invoice.invoiceNumber || invoiceMeta.invoiceNumber.trim(),
            supplier: invoice.supplier || invoiceMeta.supplier.trim(),
            purchasedAt: invoice.invoiceDate || invoiceMeta.invoiceDate
          }
        ];
        setParts(nextParts);
        const costing = await window.lockOn.service.saveCosting(order.id, {
          laborCostGross: Number(String(labor).replace(',', '.')) || 0,
          otherCostGross: Number(String(other).replace(',', '.')) || 0,
          parts: nextParts.map((part) => ({
            description: part.description.trim(),
            quantity: Number(part.quantity) || 1,
            unitCostGross: Number(part.unitCostGross) || 0,
            invoiceReceived: part.invoiceReceived,
            invoiceNumber: (part.invoiceNumber || '').trim(),
            supplier: (part.supplier || '').trim(),
            purchasedAt: part.purchasedAt || ''
          }))
        });
        setData(costing);
        setNotice('Faktura dodana. Kwota została wpisana jako koszt części — cena dla klienta nie zmieniła się.');
      } else {
        setNotice('Faktura PDF została dodana do magazynu. Sama faktura nie zmienia ceny dla klienta.');
        await load();
      }
      setInvoiceMeta({ invoiceNumber: '', supplier: '', invoiceDate: '', grossAmount: '', partDescription: '' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się dodać faktury PDF.');
    } finally {
      setBusy('');
    }
  };

  const downloadInvoice = async (invoice: ServiceInvoice) => {
    if (busy) return;
    setBusy('download:' + invoice.id);
    setError('');
    setNotice('');
    try {
      const result = await window.lockOn.service.downloadInvoice(invoice.id);
      if (!result.cancelled) setNotice('Faktura została zapisana na komputerze.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać faktury.');
    } finally {
      setBusy('');
    }
  };

  const removeInvoice = async (invoice: ServiceInvoice) => {
    if (busy || disabled) return;
    if (!await confirm({
      title: 'Usunąć fakturę z magazynu?',
      message: invoice.fileName,
      detail: 'Dokument PDF zostanie usunięty z magazynu faktur tego zlecenia.',
      confirmLabel: 'Usuń fakturę',
      tone: 'danger'
    })) return;

    setBusy('delete:' + invoice.id);
    setError('');
    setNotice('');
    try {
      await window.lockOn.service.deleteInvoice(invoice.id);
      setNotice('Faktura została usunięta z magazynu.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się usunąć faktury.');
    } finally {
      setBusy('');
    }
  };

  return <section className="service-workspace-card service-costing-card">
    <div className="service-workspace-title">
      <Calculator size={16}/>
      <div>
        <strong>{guided ? 'Koszt naprawy i faktury' : 'Wycena, części i faktury'}</strong>
        <span>Cena klienta i koszty są rozdzielone. ServiceOS pokazuje wynik prostym językiem.</span>
      </div>
    </div>

    {guided && <div className="service-costing-guide">
      <strong>Jak to działa:</strong>
      <span>1. Cena klienta to kwota uzgodniona za naprawę.</span>
      <span>2. Faktura zakupu to Twój koszt — nie przychód.</span>
      <span>3. Wynik pokazuje, ile zostaje po odjęciu części, robocizny i innych kosztów.</span>
    </div>}

    {error && <div className="service-inline-error">{error}</div>}
    {notice && <div className="service-inline-success">{notice}</div>}

    <div className="service-cost-summary">
      <article><span>Cena dla klienta</span><strong>{money(totals.customerPrice)}</strong></article>
      <article><span>Koszt części</span><strong>{money(totals.partsCost)}</strong></article>
      <article><span>Robocizna</span><strong>{money(Number(labor) || 0)}</strong></article>
      <article><span>Inne koszty</span><strong>{money(Number(other) || 0)}</strong></article>
      <article><span>Łączny koszt naprawy</span><strong>{money(totals.internalCost)}</strong></article>
      <article className={(totals.result ?? 0) < 0 ? 'danger' : ''}>
        <span>{totals.result != null && totals.result < 0 ? 'Brakuje do pokrycia kosztów' : 'Zostaje po kosztach'}</span>
        <strong>{totals.result == null ? '—' : money(totals.result < 0 ? Math.abs(totals.result) : totals.result)}</strong>
      </article>
    </div>

    <div className={(totals.result ?? 0) < 0 ? 'service-inline-error' : 'service-costing-guide'}>
      <strong>{totals.result != null && totals.result < 0 ? 'Uwaga: ta naprawa jest poniżej kosztów.' : 'Podsumowanie'}</strong>
      <span>{resultCopy}</span>
      <small>Dawna „Marża informacyjna” jest teraz pokazana jako „Zostaje po kosztach” albo „Brakuje do pokrycia kosztów”.</small>
    </div>

    <div className="service-cost-inputs">
      <label>
        <span>Kwota za robociznę — koszt wewnętrzny (PLN)</span>
        <input disabled={disabled || Boolean(busy)} type="number" min="0" step="0.01" value={labor} onChange={(event) => setLabor(event.target.value)}/>
      </label>
      <label>
        <span>Inne koszty naprawy (PLN)</span>
        <input disabled={disabled || Boolean(busy)} type="number" min="0" step="0.01" value={other} onChange={(event) => setOther(event.target.value)}/>
      </label>
    </div>

    <div className="service-parts-head">
      <div><PackagePlus size={15}/><span>Części użyte w naprawie</span></div>
      <button className="button small secondary" disabled={disabled || Boolean(busy)} onClick={() => setParts((current) => [...current, emptyPart()])}>
        <PackagePlus size={13}/> Dodaj część
      </button>
    </div>

    <div className="service-parts-list">
      {parts.map((part, index) => <article className="service-part-row" key={index}>
        <div className="service-part-main">
          <input disabled={disabled || Boolean(busy)} maxLength={240} placeholder="Np. wyświetlacz Samsung S25" value={part.description} onChange={(event) => patchPart(index, { description: event.target.value })}/>
          <div className="service-part-numbers">
            <label><span>Ilość</span><input disabled={disabled || Boolean(busy)} type="number" min="0.01" step="0.01" value={part.quantity} onChange={(event) => patchPart(index, { quantity: Number(event.target.value) })}/></label>
            <label><span>Cena zakupu szt. brutto</span><input disabled={disabled || Boolean(busy)} type="number" min="0" step="0.01" value={part.unitCostGross} onChange={(event) => patchPart(index, { unitCostGross: Number(event.target.value) })}/></label>
            <div><span>Koszt części</span><strong>{money((Number(part.quantity) || 0) * (Number(part.unitCostGross) || 0))}</strong></div>
          </div>
        </div>
        <label className="service-part-invoice-check">
          <input disabled={disabled || Boolean(busy)} type="checkbox" checked={part.invoiceReceived} onChange={(event) => patchPart(index, { invoiceReceived: event.target.checked })}/>
          <span>Mam FV zakupu za tę część</span>
        </label>
        {part.invoiceReceived && <div className="service-part-invoice-meta">
          <input disabled={disabled || Boolean(busy)} maxLength={120} placeholder="Numer faktury" value={part.invoiceNumber || ''} onChange={(event) => patchPart(index, { invoiceNumber: event.target.value })}/>
          <input disabled={disabled || Boolean(busy)} maxLength={180} placeholder="Dostawca" value={part.supplier || ''} onChange={(event) => patchPart(index, { supplier: event.target.value })}/>
          <input disabled={disabled || Boolean(busy)} type="date" value={part.purchasedAt || ''} onChange={(event) => patchPart(index, { purchasedAt: event.target.value })}/>
        </div>}
        <button className="service-part-remove" disabled={disabled || Boolean(busy)} title="Usuń część" onClick={() => setParts((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
          <Trash2 size={14}/>
        </button>
      </article>)}
      {!parts.length && <div className="service-history-empty">Nie dodano jeszcze kosztów części.</div>}
    </div>

    <button className="button primary small" disabled={disabled || Boolean(busy)} onClick={() => void save()}>
      <Save size={13}/>{busy === 'save' ? 'Zapisywanie…' : 'Zapisz koszty'}
    </button>

    <div className="service-invoice-divider"/>
    <div className="service-parts-head">
      <div><ReceiptText size={15}/><span>Faktury zakupu PDF</span></div>
      <small>Kwota z faktury = koszt zakupu, nie cena klienta</small>
    </div>

    <div className="service-invoice-upload-grid">
      {guided && <input className="service-invoice-part-description" disabled={disabled || Boolean(busy)} maxLength={240} placeholder="Co kupiono? np. wyświetlacz Samsung S24" value={invoiceMeta.partDescription} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, partDescription: event.target.value })}/>} 
      <input disabled={disabled || Boolean(busy)} maxLength={120} placeholder="Numer faktury (opcjonalnie)" value={invoiceMeta.invoiceNumber} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, invoiceNumber: event.target.value })}/>
      <input disabled={disabled || Boolean(busy)} maxLength={180} placeholder="Dostawca (opcjonalnie)" value={invoiceMeta.supplier} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, supplier: event.target.value })}/>
      <input disabled={disabled || Boolean(busy)} type="date" value={invoiceMeta.invoiceDate} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, invoiceDate: event.target.value })}/>
      <input disabled={disabled || Boolean(busy)} type="number" min="0" step="0.01" placeholder="Kwota zakupu brutto" value={invoiceMeta.grossAmount} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, grossAmount: event.target.value })}/>
      <button className="button secondary small" disabled={disabled || Boolean(busy)} onClick={() => void uploadInvoice()}>
        <Upload size={13}/>{busy === 'upload' ? 'Wysyłanie…' : guided ? 'Dodaj fakturę i koszt' : 'Dodaj FV w PDF'}
      </button>
    </div>

    <div className="service-invoice-list">
      {(data?.invoices ?? []).map((invoice) => <article key={invoice.id}>
        <FileText size={17}/>
        <div>
          <strong>{invoice.invoiceNumber || invoice.fileName}</strong>
          <span>{invoice.supplier || 'Bez dostawcy'}{invoice.invoiceDate ? ' · ' + invoice.invoiceDate : ''}{invoice.grossAmount != null ? ' · koszt ' + money(invoice.grossAmount) : ''}</span>
          <small>{invoice.fileName} · {(invoice.sizeBytes / 1024 / 1024).toFixed(2)} MB</small>
        </div>
        <button title="Pobierz PDF" disabled={Boolean(busy)} onClick={() => void downloadInvoice(invoice)}><Download size={14}/></button>
        <button title="Usuń PDF" disabled={disabled || Boolean(busy)} onClick={() => void removeInvoice(invoice)}><Trash2 size={14}/></button>
      </article>)}
      {(data?.invoices ?? []).length === 0 && <div className="service-history-empty">Brak faktur PDF dla tego zlecenia.</div>}
    </div>
  </section>;
}
