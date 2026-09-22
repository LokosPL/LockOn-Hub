import { useEffect, useMemo, useState } from 'react';
import { Filter, NotebookPen, Pin, Plus, RefreshCw, Save, Search, Sparkles, Trash2, XCircle } from 'lucide-react';
import type { TechnicianPrivateNote } from '../types/electron';
import { useAppDialog } from './AppDialog';

const TEMPLATES=['Części do zamówienia','Telefon do klienta','Do sprawdzenia jutro','Ważne ustalenia'] as const;

export function TechnicianNotesRoom(){
  const {confirm}=useAppDialog();
  const [notes,setNotes]=useState<TechnicianPrivateNote[]>([]);
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [query,setQuery]=useState('');
  const [onlyPinned,setOnlyPinned]=useState(false);
  const [pinned,setPinned]=useState(false);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [editTitle,setEditTitle]=useState('');
  const [editBody,setEditBody]=useState('');
  const [editPinned,setEditPinned]=useState(false);

  const load=async()=>{
    if(busy)return;
    setBusy('load');setError('');
    try{setNotes(await window.lockOn.service.listTechnicianNotes());}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać notatek.');}
    finally{setBusy('');}
  };
  useEffect(()=>{void load();},[]);

  useEffect(()=>{
    if(!selectedId)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelectedId(null);};
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[selectedId]);

  const visible=useMemo(()=>{
    const term=query.trim().toLocaleLowerCase('pl-PL');
    return [...notes]
      .filter((note)=>!onlyPinned||note.pinned)
      .filter((note)=>!term||(`${note.title} ${note.body}`).toLocaleLowerCase('pl-PL').includes(term))
      .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||String(b.updatedAt).localeCompare(String(a.updatedAt)));
  },[notes,query,onlyPinned]);

  const selected=useMemo(()=>notes.find((note)=>note.id===selectedId)??null,[notes,selectedId]);
  useEffect(()=>{
    if(!selected)return;
    setEditTitle(selected.title||'');
    setEditBody(selected.body);
    setEditPinned(selected.pinned);
  },[selectedId]);

  const openNote=(note:TechnicianPrivateNote)=>setSelectedId(note.id);

  const add=async()=>{
    if(busy||!body.trim())return;
    setBusy('add');setError('');setNotice('');
    try{
      const note=await window.lockOn.service.addTechnicianNote({title:title.trim(),body:body.trim(),pinned});
      setNotes((current)=>[note,...current]);setTitle('');setBody('');setPinned(false);setNotice('Notatka zapisana.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zapisać notatki.');}
    finally{setBusy('');}
  };

  const remove=async(note:TechnicianPrivateNote)=>{
    if(busy)return;
    const accepted=await confirm({
      title:'Usunąć prywatną notatkę?',
      message:note.title||'Bez tytułu',
      detail:'Notatka zostanie trwale usunięta z Twojego prywatnego notatnika. Nie wpłynie to na historię zleceń ani dane klientów.',
      confirmLabel:'Usuń notatkę',
      cancelLabel:'Zostaw',
      tone:'danger'
    });
    if(!accepted)return;
    setBusy(note.id);setError('');setNotice('');
    try{
      await window.lockOn.service.deleteTechnicianNote(note.id);
      setNotes((current)=>current.filter((item)=>item.id!==note.id));
      setSelectedId((current)=>current===note.id?null:current);
      setNotice('Notatka została usunięta.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się usunąć notatki.');}
    finally{setBusy('');}
  };

  const saveSelected=async()=>{
    if(!selected||busy||!editBody.trim())return;
    setBusy(selected.id);setError('');setNotice('');
    try{
      const updated=await window.lockOn.service.updateTechnicianNote(selected.id,{title:editTitle.trim(),body:editBody.trim(),pinned:editPinned});
      setNotes((current)=>current.map((item)=>item.id===updated.id?updated:item));
      setNotice('Zmiany w notatce zostały zapisane.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zapisać zmian notatki.');}
    finally{setBusy('');}
  };

  const useTemplate=(value:string)=>{setTitle(value);setBody((current)=>current.trim()?current:value+':\n');};

  return <section className="notes-shell">
    <header className="notes-head">
      <div>
        <span className="eyebrow"><NotebookPen size={13}/> MOJE NOTATKI</span>
        <h2>Prywatny notatnik serwisanta.</h2>
        <p>Kliknij notatkę, aby otworzyć ją tak samo wygodnie jak szczegóły zlecenia. To nie trafia do historii klienta.</p>
      </div>
      <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()}><RefreshCw size={14} className={busy==='load'?'spin':''}/> Odśwież</button>
    </header>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="notes-layout">
      <aside className="notes-compose">
        <div className="notes-compose-title"><span><Plus size={15}/></span><div><strong>Nowa notatka</strong><small>{body.length}/4000 znaków</small></div></div>
        <label><span>Tytuł</span><input value={title} maxLength={120} disabled={Boolean(busy)} onChange={(e)=>setTitle(e.target.value)} placeholder="Np. Samsung S24 — ekran"/></label>
        <label><span>Treść</span><textarea value={body} maxLength={4000} rows={8} disabled={Boolean(busy)} onChange={(e)=>setBody(e.target.value)} placeholder="Co trzeba zrobić, zamówić albo sprawdzić?"/></label>

        <div className="notes-templates">
          <span><Sparkles size={12}/> SZYBKI START</span>
          <div>{TEMPLATES.map((template)=><button type="button" key={template} onClick={()=>useTemplate(template)} disabled={Boolean(busy)}>{template}</button>)}</div>
        </div>

        <div className="notes-compose-bottom">
          <label className="notes-pin"><input type="checkbox" checked={pinned} onChange={(e)=>setPinned(e.target.checked)}/><Pin size={13}/> Przypnij</label>
          <button className="button primary" disabled={Boolean(busy)||!body.trim()} onClick={()=>void add()}><Plus size={14}/>{busy==='add'?'Zapisuję…':'Zapisz'}</button>
        </div>
      </aside>

      <section className="notes-browser">
        <div className="notes-toolbar">
          <label><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Szukaj w notatkach…"/></label>
          <button type="button" className={onlyPinned?'active':''} onClick={()=>setOnlyPinned((value)=>!value)}><Filter size={14}/>{onlyPinned?'Przypięte':'Wszystkie'}</button>
        </div>

        <div className="notes-meta"><strong>{visible.length}</strong><span>{visible.length===1?'notatka':'notatek'}</span><i/> <small>{notes.filter((note)=>note.pinned).length} przypiętych</small></div>

        <div className="notes-list">
          {visible.map((note)=><article
            key={note.id}
            className={(note.pinned?'pinned ':'')+'notes-card-clickable'}
            role="button"
            tabIndex={0}
            onClick={()=>openNote(note)}
            onKeyDown={(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openNote(note);}}}
          >
            <div className="notes-card-icon">{note.pinned?<Pin size={15}/>:<NotebookPen size={15}/>}</div>
            <div className="notes-card-body">
              <header>
                <div><strong>{note.title||'Bez tytułu'}</strong><time>{new Date(note.updatedAt).toLocaleString('pl-PL')}</time></div>
                <button
                  title="Usuń"
                  disabled={Boolean(busy)}
                  onClick={(event)=>{event.stopPropagation();void remove(note);}}
                ><Trash2 size={14}/></button>
              </header>
              <p>{note.body.length>180?note.body.slice(0,180)+'…':note.body}</p>
              <small className="notes-open-hint">Kliknij, aby otworzyć szczegóły →</small>
            </div>
          </article>)}
          {!visible.length&&<div className="notes-empty"><NotebookPen size={30}/><strong>{notes.length?'Brak wyników':'Jeszcze nic tu nie ma'}</strong><span>{notes.length?'Zmień filtr albo wyszukiwanie.':'Dodaj pierwszą krótką notatkę po lewej.'}</span></div>}
        </div>
      </section>
    </div>

    {selected&&<div className="service-order-details-backdrop notes-details-backdrop" role="presentation" onMouseDown={()=>setSelectedId(null)}>
      <section className="service-order-details-dialog notes-details-dialog" role="dialog" aria-modal="true" aria-label="Szczegóły prywatnej notatki" onMouseDown={(event)=>event.stopPropagation()}>
        <header className="service-order-details-header">
          <div>
            <span>{selected.pinned?'PRZYPIĘTA NOTATKA':'PRYWATNA NOTATKA'}</span>
            <h2>{selected.title||'Bez tytułu'}</h2>
            <small>Ostatnia zmiana: {new Date(selected.updatedAt).toLocaleString('pl-PL')}</small>
          </div>
          <button className="service-order-details-close" title="Zamknij" onClick={()=>setSelectedId(null)}><XCircle size={20}/></button>
        </header>
        <div className="notes-details-content">
          <div className="notes-details-meta">
            <span>{selected.pinned?<><Pin size={13}/> Przypięta</>:<><NotebookPen size={13}/> Notatka robocza</>}</span>
            <span>Utworzono {new Date(selected.createdAt).toLocaleString('pl-PL')}</span>
          </div>
          <div className="notes-details-editor">
            <label><span>Tytuł</span><input maxLength={120} value={editTitle} disabled={Boolean(busy)} onChange={(event)=>setEditTitle(event.target.value)}/></label>
            <label><span>Treść</span><textarea rows={12} maxLength={4000} value={editBody} disabled={Boolean(busy)} onChange={(event)=>setEditBody(event.target.value)}/></label>
            <label className="notes-pin"><input type="checkbox" checked={editPinned} disabled={Boolean(busy)} onChange={(event)=>setEditPinned(event.target.checked)}/><Pin size={13}/> Przypnij notatkę</label>
          </div>
          <div className="notes-details-actions">
            <small>Tylko Ty widzisz tę notatkę. Nie jest częścią historii klienta ani zlecenia.</small>
            <div>
              <button className="button secondary" disabled={Boolean(busy)||!editBody.trim()} onClick={()=>void saveSelected()}><Save size={14}/> Zapisz zmiany</button>
              <button className="button danger-soft" disabled={Boolean(busy)} onClick={()=>void remove(selected)}><Trash2 size={14}/> Usuń notatkę</button>
            </div>
          </div>
        </div>
      </section>
    </div>}
  </section>;
}
