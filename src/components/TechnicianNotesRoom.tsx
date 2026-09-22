import { useEffect, useMemo, useState } from 'react';
import { Filter, NotebookPen, Pin, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
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
    if(!title.trim())setTitle(template);
    if(!body.trim())setBody(template+':\n');
  };

  return <section className="technician-notes-room technician-notes-hotfix">
    <header className="technician-notes-top">
      <div>
        <span className="eyebrow"><NotebookPen size={13}/> MÓJ NOTATNIK</span>
        <h2>Notatki serwisanta</h2>
        <p>Prywatne dla Twojego konta. Szybkie rzeczy do zapamiętania, bez mieszania z historią klienta.</p>
      </div>
      <div className="technician-notes-top-actions">
        <div><strong>{notes.length}</strong><span>{notes.length===1?'notatka':'notatek'}</span></div>
        <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()}><RefreshCw className={busy==='load'?'spin':''} size={14}/></button>
      </div>
    </header>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <section className="technician-note-compose-clean">
      <div className="technician-note-compose-head">
        <strong><Plus size={15}/> Nowa notatka</strong>
        <span>{body.length}/4000</span>
      </div>
      <div className="technician-note-template-row">
        {NOTE_TEMPLATES.map((template)=><button type="button" key={template} disabled={Boolean(busy)} onClick={()=>applyTemplate(template)}>{template}</button>)}
      </div>
      <div className="technician-note-compose-fields">
        <input maxLength={120} placeholder="Tytuł, np. iPhone 14 — zamówić ekran" value={title} onChange={(e)=>setTitle(e.target.value)} disabled={Boolean(busy)}/>
        <textarea rows={4} maxLength={4000} placeholder="Zapisz krótką notatkę…" value={body} onChange={(e)=>setBody(e.target.value)} disabled={Boolean(busy)}/>
      </div>
      <div className="technician-note-compose-actions">
        <label><input type="checkbox" checked={pinned} onChange={(e)=>setPinned(e.target.checked)} disabled={Boolean(busy)}/><Pin size={13}/> Przypnij</label>
        <button className="button primary small" disabled={Boolean(busy)||!body.trim()} onClick={()=>void add()}><Plus size={13}/>{busy==='add'?'Zapisywanie…':'Zapisz notatkę'}</button>
      </div>
    </section>

    <div className="technician-note-browser-clean">
      <div className="technician-note-toolbar-clean">
        <label><Search size={14}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Szukaj w notatkach…"/></label>
        <button type="button" className={onlyPinned?'active':''} onClick={()=>setOnlyPinned((value)=>!value)}><Filter size={14}/>{onlyPinned?'Przypięte':'Wszystkie'}</button>
      </div>

      <div className="technician-note-grid-clean">
        {visibleNotes.map((note)=><article key={note.id} className={note.pinned?'pinned':''}>
          <header>
            <div>{note.pinned&&<Pin size={13}/>}<strong>{note.title||'Notatka'}</strong></div>
            <button disabled={Boolean(busy)} title="Usuń" onClick={()=>void remove(note)}><Trash2 size={14}/></button>
          </header>
          <p>{note.body}</p>
          <footer>{new Date(note.updatedAt).toLocaleString('pl-PL')}</footer>
        </article>)}
        {!visibleNotes.length&&<div className="technician-notes-empty"><NotebookPen size={24}/><strong>{notes.length?'Nic nie pasuje do filtra':'Tu będą Twoje notatki'}</strong><span>{notes.length?'Zmień wyszukiwanie albo pokaż wszystkie.':'Dodaj pierwszą notatkę powyżej.'}</span></div>}
      </div>
    </div>
  </section>;
}
