import { useEffect, useMemo, useState } from 'react';
import { Filter, NotebookPen, Pin, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import type { TechnicianPrivateNote } from '../types/electron';

const NOTE_TEMPLATES=[
  'Części do zamówienia',
  'Telefon do klienta',
  'Do sprawdzenia jutro',
  'Ważne ustalenia'
] as const;

export function TechnicianNotesRoom(){
  const [notes,setNotes]=useState<TechnicianPrivateNote[]>([]);
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [query,setQuery]=useState('');
  const [onlyPinned,setOnlyPinned]=useState(false);
  const [pinned,setPinned]=useState(false);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=async()=>{
    if(busy)return;
    setBusy('load');setError('');
    try{setNotes(await window.lockOn.service.listTechnicianNotes());}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać prywatnych notatek.');}
    finally{setBusy('');}
  };

  useEffect(()=>{void load();},[]);

  const visibleNotes=useMemo(()=>{
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
      setNotes((current)=>[note,...current]);
      setTitle('');setBody('');setPinned(false);
      setNotice('Notatka zapisana.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zapisać notatki.');}
    finally{setBusy('');}
  };

  const remove=async(note:TechnicianPrivateNote)=>{
    if(busy)return;
    if(!window.confirm('Usunąć tę prywatną notatkę?'))return;
    setBusy(note.id);setError('');setNotice('');
    try{
      await window.lockOn.service.deleteTechnicianNote(note.id);
      setNotes((current)=>current.filter((item)=>item.id!==note.id));
      setNotice('Notatka usunięta.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się usunąć notatki.');}
    finally{setBusy('');}
  };

  const applyTemplate=(template:string)=>{
    setTitle((current)=>current.trim()?current:template);
    setBody((current)=>current.trim()?current:template+':\n');
  };

  const pinnedCount=notes.filter((note)=>note.pinned).length;

  return <section className="technician-notes-room technician-notes-hotfix technician-notes-v2">
    <header className="technician-notes-top">
      <div>
        <span className="eyebrow"><NotebookPen size={13}/> PRYWATNY NOTATNIK</span>
        <h2>Rzeczy, których nie chcesz trzymać w głowie.</h2>
        <p>Tylko dla Twojego konta. Notatki nie trafiają do klienta ani do historii zlecenia.</p>
      </div>
      <div className="technician-notes-top-actions">
        <div><strong>{notes.length}</strong><span>wszystkich</span></div>
        <div><strong>{pinnedCount}</strong><span>przypiętych</span></div>
        <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()} title="Odśwież"><RefreshCw className={busy==='load'?'spin':''} size={14}/></button>
      </div>
    </header>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="technician-notes-workspace">
      <aside className="technician-note-compose-clean technician-note-compose-v2">
        <div className="technician-note-compose-head">
          <div><span><Plus size={14}/></span><strong>Nowa notatka</strong></div>
          <small>{body.length}/4000</small>
        </div>

        <label className="technician-note-field">
          <span>Tytuł</span>
          <input maxLength={120} placeholder="Np. iPhone 14 — zamówić ekran" value={title} onChange={(e)=>setTitle(e.target.value)} disabled={Boolean(busy)}/>
        </label>
        <label className="technician-note-field">
          <span>Treść</span>
          <textarea rows={8} maxLength={4000} placeholder="Zapisz ustalenia, części do zamówienia albo co sprawdzić później…" value={body} onChange={(e)=>setBody(e.target.value)} disabled={Boolean(busy)}/>
        </label>

        <div className="technician-note-templates-v2">
          <span><Sparkles size={12}/> Szybkie szablony</span>
          <div>{NOTE_TEMPLATES.map((template)=><button type="button" key={template} disabled={Boolean(busy)} onClick={()=>applyTemplate(template)}>{template}</button>)}</div>
        </div>

        <div className="technician-note-compose-actions">
          <label><input type="checkbox" checked={pinned} onChange={(e)=>setPinned(e.target.checked)} disabled={Boolean(busy)}/><Pin size={13}/> Przypnij na górze</label>
          <button className="button primary" disabled={Boolean(busy)||!body.trim()} onClick={()=>void add()}><Plus size={14}/>{busy==='add'?'Zapisywanie…':'Zapisz notatkę'}</button>
        </div>
      </aside>

      <section className="technician-note-browser-clean technician-note-browser-v2">
        <div className="technician-note-toolbar-clean">
          <label><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Szukaj po tytule lub treści…"/></label>
          <button type="button" className={onlyPinned?'active':''} onClick={()=>setOnlyPinned((value)=>!value)}><Filter size={14}/>{onlyPinned?'Tylko przypięte':'Wszystkie'}</button>
        </div>

        <div className="technician-note-list-v2">
          {visibleNotes.map((note)=><article key={note.id} className={note.pinned?'pinned':''}>
            <div className="technician-note-accent">{note.pinned?<Pin size={14}/>:<NotebookPen size={14}/>}</div>
            <div className="technician-note-content-v2">
              <header>
                <div>
                  <strong>{note.title||'Bez tytułu'}</strong>
                  <time>{new Date(note.updatedAt).toLocaleString('pl-PL')}</time>
                </div>
                <button disabled={Boolean(busy)} title="Usuń notatkę" onClick={()=>void remove(note)}><Trash2 size={14}/></button>
              </header>
              <p>{note.body}</p>
            </div>
          </article>)}
          {!visibleNotes.length&&<div className="technician-notes-empty">
            <NotebookPen size={28}/>
            <strong>{notes.length?'Nic nie pasuje do filtra':'Notatnik jest pusty'}</strong>
            <span>{notes.length?'Zmień wyszukiwanie albo pokaż wszystkie notatki.':'Dodaj pierwszą notatkę po lewej. Będzie widoczna tylko dla Ciebie.'}</span>
          </div>}
        </div>
      </section>
    </div>
  </section>;
}
