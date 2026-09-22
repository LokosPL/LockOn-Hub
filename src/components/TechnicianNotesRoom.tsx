import { useEffect, useMemo, useState } from 'react';
import { Filter, NotebookPen, Pin, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import type { TechnicianPrivateNote } from '../types/electron';
import { appConfirm } from '../appDialog';

const TEMPLATES=['Części do zamówienia','Telefon do klienta','Do sprawdzenia jutro','Ważne ustalenia'] as const;

export function TechnicianNotesRoom(){
  const [notes,setNotes]=useState<TechnicianPrivateNote[]>([]);
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [query,setQuery]=useState('');
  const [onlyPinned,setOnlyPinned]=useState(false);
  const [pinned,setPinned]=useState(false);
  const [opened,setOpened]=useState<TechnicianPrivateNote|null>(null);
  const [editTitle,setEditTitle]=useState('');
  const [editBody,setEditBody]=useState('');
  const [editPinned,setEditPinned]=useState(false);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=async()=>{
    if(busy)return;
    setBusy('load');setError('');
    try{setNotes(await window.lockOn.service.listTechnicianNotes());}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać notatek.');}
    finally{setBusy('');}
  };
  useEffect(()=>{void load();},[]);

  const visible=useMemo(()=>{
    const term=query.trim().toLocaleLowerCase('pl-PL');
    return [...notes]
      .filter((note)=>!onlyPinned||note.pinned)
      .filter((note)=>!term||(`${note.title} ${note.body}`).toLocaleLowerCase('pl-PL').includes(term))
      .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||String(b.updatedAt).localeCompare(String(a.updatedAt)));
  },[notes,query,onlyPinned]);

  const add=async()=>{
    if(busy||!body.trim())return;
    setBusy('add');setError('');setNotice('');
    try{
      const note=await window.lockOn.service.addTechnicianNote({title:title.trim(),body:body.trim(),pinned});
      setNotes((current)=>[note,...current]);setTitle('');setBody('');setPinned(false);setNotice('Notatka zapisana.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zapisać notatki.');}
    finally{setBusy('');}
  };
  const openNote=(note:TechnicianPrivateNote)=>{setOpened(note);setEditTitle(note.title);setEditBody(note.body);setEditPinned(note.pinned);};
  const saveOpened=async()=>{
    if(!opened||busy||!editBody.trim())return;
    setBusy('edit:'+opened.id);setError('');setNotice('');
    try{
      const updated=await window.lockOn.service.updateTechnicianNote(opened.id,{title:editTitle.trim(),body:editBody.trim(),pinned:editPinned});
      setNotes((current)=>current.map((item)=>item.id===updated.id?updated:item));setOpened(updated);setNotice('Notatka została zaktualizowana.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zapisać zmian.');}
    finally{setBusy('');}
  };
  const remove=async(note:TechnicianPrivateNote)=>{
    if(busy)return;
    const confirmed=await appConfirm({title:'Usunąć prywatną notatkę?',message:`„${note.title||'Bez tytułu'}” zostanie trwale usunięta z Twojego notatnika.`,confirmLabel:'Usuń notatkę',tone:'danger'});
    if(!confirmed)return;
    setBusy(note.id);setError('');setNotice('');
    try{await window.lockOn.service.deleteTechnicianNote(note.id);setNotes((current)=>current.filter((item)=>item.id!==note.id));if(opened?.id===note.id)setOpened(null);setNotice('Notatka usunięta.');}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się usunąć notatki.');}
    finally{setBusy('');}
  };
  const useTemplate=(value:string)=>{setTitle(value);setBody((current)=>current.trim()?current:value+':\n');};

  return <section className="notes-shell">
    <header className="notes-head">
      <div><span className="eyebrow"><NotebookPen size={13}/> MOJE NOTATKI</span><h2>Prywatny notatnik serwisanta.</h2><p>Kliknij notatkę, aby otworzyć ją w takim samym panelu jak szczegóły zlecenia.</p></div>
      <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()}><RefreshCw size={14} className={busy==='load'?'spin':''}/> Odśwież</button>
    </header>
    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}
    <div className="notes-layout">
      <aside className="notes-compose">
        <div className="notes-compose-title"><span><Plus size={15}/></span><div><strong>Nowa notatka</strong><small>{body.length}/4000 znaków</small></div></div>
        <label><span>Tytuł</span><input value={title} maxLength={120} disabled={Boolean(busy)} onChange={(e)=>setTitle(e.target.value)} placeholder="Np. Samsung S24 — ekran"/></label>
        <label><span>Treść</span><textarea value={body} maxLength={4000} rows={8} disabled={Boolean(busy)} onChange={(e)=>setBody(e.target.value)} placeholder="Co trzeba zrobić, zamówić albo sprawdzić?"/></label>
        <div className="notes-templates"><span><Sparkles size={12}/> SZYBKI START</span><div>{TEMPLATES.map((template)=><button type="button" key={template} onClick={()=>useTemplate(template)} disabled={Boolean(busy)}>{template}</button>)}</div></div>
        <div className="notes-compose-bottom"><label className="notes-pin"><input type="checkbox" checked={pinned} onChange={(e)=>setPinned(e.target.checked)}/><Pin size={13}/> Przypnij</label><button className="button primary" disabled={Boolean(busy)||!body.trim()} onClick={()=>void add()}><Plus size={14}/>{busy==='add'?'Zapisuję…':'Zapisz'}</button></div>
      </aside>
      <section className="notes-browser">
        <div className="notes-toolbar"><label><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Szukaj w notatkach…"/></label><button type="button" className={onlyPinned?'active':''} onClick={()=>setOnlyPinned((value)=>!value)}><Filter size={14}/>{onlyPinned?'Przypięte':'Wszystkie'}</button></div>
        <div className="notes-meta"><strong>{visible.length}</strong><span>{visible.length===1?'notatka':'notatek'}</span><i/> <small>{notes.filter((note)=>note.pinned).length} przypiętych</small></div>
        <div className="notes-list">
          {visible.map((note)=><article key={note.id} className={note.pinned?'pinned':''} onClick={()=>openNote(note)}>
            <div className="notes-card-icon">{note.pinned?<Pin size={15}/>:<NotebookPen size={15}/>}</div>
            <div className="notes-card-body"><header><div><strong>{note.title||'Bez tytułu'}</strong><time>{new Date(note.updatedAt).toLocaleString('pl-PL')}</time></div><button title="Usuń" disabled={Boolean(busy)} onClick={(e)=>{e.stopPropagation();void remove(note);}}><Trash2 size={14}/></button></header><p>{note.body}</p></div>
          </article>)}
          {!visible.length&&<div className="notes-empty"><NotebookPen size={30}/><strong>{notes.length?'Brak wyników':'Jeszcze nic tu nie ma'}</strong><span>{notes.length?'Zmień filtr albo wyszukiwanie.':'Dodaj pierwszą krótką notatkę po lewej.'}</span></div>}
        </div>
      </section>
    </div>
    {opened&&<div className="service-order-details-backdrop" role="presentation" onMouseDown={()=>setOpened(null)}>
      <section className="service-order-details-dialog note-details-dialog" role="dialog" aria-modal="true" onMouseDown={(e)=>e.stopPropagation()}>
        <header className="service-order-details-header"><div><span>PRYWATNA NOTATKA</span><h2>{opened.title||'Bez tytułu'}</h2><small>Ostatnia zmiana: {new Date(opened.updatedAt).toLocaleString('pl-PL')}</small></div><button className="service-order-details-close" onClick={()=>setOpened(null)}><X size={20}/></button></header>
        <div className="note-details-body"><label><span>Tytuł</span><input maxLength={120} value={editTitle} onChange={(e)=>setEditTitle(e.target.value)}/></label><label><span>Treść</span><textarea rows={14} maxLength={4000} value={editBody} onChange={(e)=>setEditBody(e.target.value)}/></label><label className="notes-pin"><input type="checkbox" checked={editPinned} onChange={(e)=>setEditPinned(e.target.checked)}/><Pin size={13}/> Przypnij na górze</label></div>
        <footer className="note-details-footer"><button className="button secondary danger" onClick={()=>void remove(opened)}><Trash2 size={14}/> Usuń</button><button className="button primary" disabled={Boolean(busy)||!editBody.trim()} onClick={()=>void saveOpened()}>Zapisz zmiany</button></footer>
      </section>
    </div>}
  </section>;
}
