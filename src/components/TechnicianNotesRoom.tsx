import { useEffect, useMemo, useState } from 'react';
import { Filter, NotebookPen, Pin, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { TechnicianPrivateNote } from '../types/electron';

const NOTE_TEMPLATES=[
  'Części do zamówienia',
  'Telefony do klienta',
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

  return <section className="panel-card technician-notes-room technician-notes-room-v2">
    <div className="panel-heading">
      <div>
        <span className="eyebrow"><NotebookPen size={13}/> MÓJ NOTATNIK</span>
        <h2>Prywatne notatki serwisanta</h2>
        <p>Krótko, szybko i bez mieszania z historią klienta. Przypięte notatki zawsze są na górze.</p>
      </div>
      <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()}><RefreshCw className={busy==='load'?'spin':''} size={14}/> Odśwież</button>
    </div>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="technician-notes-layout">
      <section className="technician-note-compose technician-note-compose-v2">
        <div className="service-workspace-title"><Plus size={15}/><div><strong>Nowa notatka</strong><span>{body.length}/4000 znaków</span></div></div>
        <div className="technician-note-templates">
          {NOTE_TEMPLATES.map((template)=><button type="button" key={template} disabled={Boolean(busy)} onClick={()=>applyTemplate(template)}>{template}</button>)}
        </div>
        <input maxLength={120} placeholder="Tytuł notatki" value={title} onChange={(e)=>setTitle(e.target.value)} disabled={Boolean(busy)}/>
        <textarea rows={8} maxLength={4000} placeholder="Zapisz ustalenia, części do zamówienia, telefony do wykonania…" value={body} onChange={(e)=>setBody(e.target.value)} disabled={Boolean(busy)}/>
        <div>
          <label><input type="checkbox" checked={pinned} onChange={(e)=>setPinned(e.target.checked)} disabled={Boolean(busy)}/><Pin size={13}/> Przypnij na górze</label>
          <button className="button primary small" disabled={Boolean(busy)||!body.trim()} onClick={()=>void add()}><Plus size={13}/>{busy==='add'?'Zapisywanie…':'Zapisz'}</button>
        </div>
      </section>

      <section className="technician-note-browser">
        <div className="technician-note-toolbar">
          <label><Search size={14}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Szukaj w notatkach…"/></label>
          <button type="button" className={onlyPinned?'active':''} onClick={()=>setOnlyPinned((value)=>!value)}><Filter size={14}/>{onlyPinned?'Tylko przypięte':'Wszystkie'}</button>
        </div>
        <div className="technician-note-count"><strong>{visibleNotes.length}</strong><span>{visibleNotes.length===1?'notatka':'notatek'}</span></div>
        <div className="technician-note-grid technician-note-grid-v2">
          {visibleNotes.map((note)=><article key={note.id} className={note.pinned?'pinned':''}>
            <header>
              <div>{note.pinned&&<Pin size={13}/>}<strong>{note.title||'Notatka'}</strong></div>
              <button disabled={Boolean(busy)} title="Usuń" onClick={()=>void remove(note)}><Trash2 size={14}/></button>
            </header>
            <p>{note.body}</p>
            <small>{new Date(note.updatedAt).toLocaleString('pl-PL')}</small>
          </article>)}
          {!visibleNotes.length&&<div className="service-history-empty">{notes.length?'Brak notatek pasujących do filtra.':'Twój notatnik jest pusty.'}</div>}
        </div>
      </section>
    </div>
  </section>;
}
