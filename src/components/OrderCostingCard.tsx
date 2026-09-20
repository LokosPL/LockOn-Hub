import { useEffect, useMemo, useState } from 'react';
import { Calculator, Download, FileText, PackagePlus, ReceiptText, Save, Trash2, Upload } from 'lucide-react';
import type { ServiceCosting, ServiceInvoice, ServiceOrderPart, ServiceOrderSummary } from '../types/electron';

interface Props {
  order: ServiceOrderSummary;
  disabled?: boolean;
}

type PartDraft = Pick<ServiceOrderPart,'description'|'quantity'|'unitCostGross'|'invoiceReceived'> & {
  invoiceNumber?:string;
  supplier?:string;
  purchasedAt?:string;
};

const money = (value:number|null|undefined,currency='PLN') =>
  value == null ? '—' : new Intl.NumberFormat('pl-PL',{style:'currency',currency}).format(value);

const emptyPart = ():PartDraft => ({
  description:'',
  quantity:1,
  unitCostGross:0,
  invoiceReceived:false,
  invoiceNumber:'',
  supplier:'',
  purchasedAt:''
});

export function OrderCostingCard({ order, disabled=false }:Props) {
  const [data,setData]=useState<ServiceCosting|null>(null);
  const [parts,setParts]=useState<PartDraft[]>([]);
  const [labor,setLabor]=useState('0');
  const [other,setOther]=useState('0');
  const [invoiceMeta,setInvoiceMeta]=useState({invoiceNumber:'',supplier:'',invoiceDate:'',grossAmount:''});
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=async()=>{
    setBusy((current)=>current||'load');
    setError('');
    try{
      const result=await window.lockOn.service.getCosting(order.id);
      setData(result);
      setLabor(String(result.laborCostGross||0));
      setOther(String(result.otherCostGross||0));
      setParts(result.parts.map((part)=>({
        description:part.description,
        quantity:part.quantity,
        unitCostGross:part.unitCostGross,
        invoiceReceived:part.invoiceReceived,
        invoiceNumber:part.invoiceNumber||'',
        supplier:part.supplier||'',
        purchasedAt:part.purchasedAt?String(part.purchasedAt).slice(0,10):''
      })));
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Nie udało się pobrać rozliczenia zlecenia.');
    }finally{setBusy('');}
  };

  useEffect(()=>{void load();},[order.id]);

  const localTotals=useMemo(()=>{
    const partsCost=parts.reduce((sum,part)=>sum+(Number(part.quantity)||0)*(Number(part.unitCostGross)||0),0);
    const internal=partsCost+(Number(labor)||0)+(Number(other)||0);
    const customer=order.finalCost??order.estimatedCost??null;
    return {
      partsCost:Math.round(partsCost*100)/100,
      internal:Math.round(internal*100)/100,
      margin:customer==null?null:Math.round((customer-internal)*100)/100
    };
  },[parts,labor,other,order.finalCost,order.estimatedCost]);

  const patchPart=(index:number,patch:Partial<PartDraft>)=>{
    setParts((current)=>current.map((part,i)=>i===index?{...part,...patch}:part));
  };

  const save=async()=>{
    if(busy||disabled)return;
    if(parts.some((part)=>!part.description.trim())){
      setError('Każda część musi mieć opis.');
      return;
    }
    setBusy('save');setError('');setNotice('');
    try{
      const result=await window.lockOn.service.saveCosting(order.id,{
        laborCostGross:Number(String(labor).replace(',','.'))||0,
        otherCostGross:Number(String(other).replace(',','.'))||0,
        parts:parts.map((part)=>({
          description:part.description.trim(),
          quantity:Number(part.quantity)||1,
          unitCostGross:Number(part.unitCostGross)||0,
          invoiceReceived:part.invoiceReceived,
          invoiceNumber:part.invoiceReceived?(part.invoiceNumber||'').trim():'',
          supplier:part.invoiceReceived?(part.supplier||'').trim():'',
          purchasedAt:part.invoiceReceived?(part.purchasedAt||''):''
        }))
      });
      setData(result);
      setNotice('Koszty części i robocizny zostały zapisane.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Nie udało się zapisać kosztów.');
    }finally{setBusy('');}
  };

  const uploadInvoice=async()=>{
    if(busy||disabled)return;
    setBusy('upload');setError('');setNotice('');
    try{
      const result=await window.lockOn.service.uploadInvoice(order.id,{
        invoiceNumber:invoiceMeta.invoiceNumber.trim(),
        supplier:invoiceMeta.supplier.trim(),
        invoiceDate:invoiceMeta.invoiceDate,
        grossAmount:invoiceMeta.grossAmount===''?null:Number(String(invoiceMeta.grossAmount).replace(',','.'))
      });
      if(result.cancelled)return;
      setInvoiceMeta({invoiceNumber:'',supplier:'',invoiceDate:'',grossAmount:''});
      setNotice('Faktura PDF została bezpiecznie dodana do magazynu.');
      await load();
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Nie udało się dodać faktury PDF.');
    }finally{setBusy('');}
  };

  const downloadInvoice=async(invoice:ServiceInvoice)=>{
    if(busy)return;
    setBusy('download:'+invoice.id);setError('');setNotice('');
    try{
      const result=await window.lockOn.service.downloadInvoice(invoice.id);
      if(!result.cancelled)setNotice('Faktura została zapisana na komputerze.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać faktury.');}
    finally{setBusy('');}
  };

  const removeInvoice=async(invoice:ServiceInvoice)=>{
    if(busy||disabled)return;
    if(!window.confirm('Usunąć fakturę „'+invoice.fileName+'” z magazynu?'))return;
    setBusy('delete:'+invoice.id);setError('');setNotice('');
    try{
      await window.lockOn.service.deleteInvoice(invoice.id);
      setNotice('Faktura została usunięta z magazynu.');
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się usunąć faktury.');}
    finally{setBusy('');}
  };

  return <section className="service-workspace-card service-costing-card">
    <div className="service-workspace-title">
      <Calculator size={16}/>
      <div><strong>Wycena, części i faktury</strong><span>Wewnętrzne koszty serwisu. Nie są pokazywane klientowi.</span></div>
    </div>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="service-cost-summary">
      <article><span>Części</span><strong>{money(localTotals.partsCost)}</strong></article>
      <article><span>Robocizna</span><strong>{money(Number(labor)||0)}</strong></article>
      <article><span>Inne koszty</span><strong>{money(Number(other)||0)}</strong></article>
      <article><span>Koszt wewnętrzny</span><strong>{money(localTotals.internal)}</strong></article>
      <article><span>Cena klienta</span><strong>{money(order.finalCost??order.estimatedCost)}</strong></article>
      <article className={(localTotals.margin??0)<0?'danger':''}><span>Marża informacyjna</span><strong>{money(localTotals.margin)}</strong></article>
    </div>

    <div className="service-cost-inputs">
      <label><span>Kwota za robociznę (PLN)</span><input disabled={disabled||Boolean(busy)} type="number" min="0" step="0.01" value={labor} onChange={(e)=>setLabor(e.target.value)}/></label>
      <label><span>Inne koszty (PLN)</span><input disabled={disabled||Boolean(busy)} type="number" min="0" step="0.01" value={other} onChange={(e)=>setOther(e.target.value)}/></label>
    </div>

    <div className="service-parts-head">
      <div><PackagePlus size={15}/><span>Części użyte w naprawie</span></div>
      <button className="button small secondary" disabled={disabled||Boolean(busy)} onClick={()=>setParts((current)=>[...current,emptyPart()])}><PackagePlus size={13}/> Dodaj część</button>
    </div>

    <div className="service-parts-list">
      {parts.map((part,index)=><article className="service-part-row" key={index}>
        <div className="service-part-main">
          <input disabled={disabled||Boolean(busy)} maxLength={240} placeholder="Np. wyświetlacz Samsung S25" value={part.description} onChange={(e)=>patchPart(index,{description:e.target.value})}/>
          <div className="service-part-numbers">
            <label><span>Ilość</span><input disabled={disabled||Boolean(busy)} type="number" min="0.01" step="0.01" value={part.quantity} onChange={(e)=>patchPart(index,{quantity:Number(e.target.value)})}/></label>
            <label><span>Koszt szt. brutto</span><input disabled={disabled||Boolean(busy)} type="number" min="0" step="0.01" value={part.unitCostGross} onChange={(e)=>patchPart(index,{unitCostGross:Number(e.target.value)})}/></label>
            <div><span>Razem</span><strong>{money((Number(part.quantity)||0)*(Number(part.unitCostGross)||0))}</strong></div>
          </div>
        </div>
        <label className="service-part-invoice-check"><input disabled={disabled||Boolean(busy)} type="checkbox" checked={part.invoiceReceived} onChange={(e)=>patchPart(index,{invoiceReceived:e.target.checked})}/><span>Mam FV zakupu za tę część</span></label>
        {part.invoiceReceived&&<div className="service-part-invoice-meta">
          <input disabled={disabled||Boolean(busy)} maxLength={120} placeholder="Numer faktury" value={part.invoiceNumber||''} onChange={(e)=>patchPart(index,{invoiceNumber:e.target.value})}/>
          <input disabled={disabled||Boolean(busy)} maxLength={180} placeholder="Dostawca" value={part.supplier||''} onChange={(e)=>patchPart(index,{supplier:e.target.value})}/>
          <input disabled={disabled||Boolean(busy)} type="date" value={part.purchasedAt||''} onChange={(e)=>patchPart(index,{purchasedAt:e.target.value})}/>
        </div>}
        <button className="service-part-remove" disabled={disabled||Boolean(busy)} title="Usuń część" onClick={()=>setParts((current)=>current.filter((_,i)=>i!==index))}><Trash2 size={14}/></button>
      </article>)}
      {!parts.length&&<div className="service-history-empty">Nie dodano jeszcze kosztów części.</div>}
    </div>

    <button className="button primary small" disabled={disabled||Boolean(busy)} onClick={()=>void save()}><Save size={13}/>{busy==='save'?'Zapisywanie…':'Zapisz wycenę i części'}</button>

    <div className="service-invoice-divider"/>
    <div className="service-parts-head">
      <div><ReceiptText size={15}/><span>Faktury zakupu PDF</span></div>
      <small>PDF do 20 MB · prywatny magazyn</small>
    </div>
    <div className="service-invoice-upload-grid">
      <input disabled={disabled||Boolean(busy)} maxLength={120} placeholder="Numer faktury (opcjonalnie)" value={invoiceMeta.invoiceNumber} onChange={(e)=>setInvoiceMeta({...invoiceMeta,invoiceNumber:e.target.value})}/>
      <input disabled={disabled||Boolean(busy)} maxLength={180} placeholder="Dostawca (opcjonalnie)" value={invoiceMeta.supplier} onChange={(e)=>setInvoiceMeta({...invoiceMeta,supplier:e.target.value})}/>
      <input disabled={disabled||Boolean(busy)} type="date" value={invoiceMeta.invoiceDate} onChange={(e)=>setInvoiceMeta({...invoiceMeta,invoiceDate:e.target.value})}/>
      <input disabled={disabled||Boolean(busy)} type="number" min="0" step="0.01" placeholder="Kwota brutto" value={invoiceMeta.grossAmount} onChange={(e)=>setInvoiceMeta({...invoiceMeta,grossAmount:e.target.value})}/>
      <button className="button secondary small" disabled={disabled||Boolean(busy)} onClick={()=>void uploadInvoice()}><Upload size={13}/>{busy==='upload'?'Wysyłanie…':'Dodaj FV w PDF'}</button>
    </div>

    <div className="service-invoice-list">
      {(data?.invoices??[]).map((invoice)=><article key={invoice.id}>
        <FileText size={17}/>
        <div><strong>{invoice.invoiceNumber||invoice.fileName}</strong><span>{invoice.supplier||'Bez dostawcy'}{invoice.invoiceDate?' · '+invoice.invoiceDate:''}{invoice.grossAmount!=null?' · '+money(invoice.grossAmount):''}</span><small>{invoice.fileName} · {(invoice.sizeBytes/1024/1024).toFixed(2)} MB</small></div>
        <button title="Pobierz PDF" disabled={Boolean(busy)} onClick={()=>void downloadInvoice(invoice)}><Download size={14}/></button>
        <button title="Usuń PDF" disabled={disabled||Boolean(busy)} onClick={()=>void removeInvoice(invoice)}><Trash2 size={14}/></button>
      </article>)}
      {(data?.invoices??[]).length===0&&<div className="service-history-empty">Brak faktur PDF dla tego zlecenia.</div>}
    </div>
  </section>;
}
