import { useEffect, useState } from 'react';
import { NotebookPen, Pin, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { TechnicianPrivateNote } from '../types/electron';

export function TechnicianNotesRoom(){
  const [notes,setNotes]=useState<TechnicianPrivateNote[]>([]);
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [pinned,setPinned]=useState(false);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');

  const load=async()=>{
    if(busy)return;
    setBusy('load');setError('');
    try{setNotes(await window.lockOn.service.listTechnicianNotes());}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać prywatnych notatek.');}
    finally{setBusy('');}
  };

  useEffect(()=>{void load();},[]);

  const add=async()=>{
    if(busy||!body.trim())return;
    setBusy('add');setError('');
    try{
      const note=await window.lockOn.service.addTechnicianNote({title:title.trim(),body:body.trim(),pinned});
      setNotes((current)=>[note,...current]);
      setTitle('');setBody('');setPinned(false);
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zapisać notatki.');}
    finally{setBusy('');}
  };

  const remove=async(note:TechnicianPrivateNote)=>{
    if(busy)return;
    if(!window.confirm('Usunąć tę prywatną notatkę?'))return;
    setBusy(note.id);setError('');
    try{
      await window.lockOn.service.deleteTechnicianNote(note.id);
      setNotes((current)=>current.filter((item)=>item.id!==note.id));
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się usunąć notatki.');}
    finally{setBusy('');}
  };

  return <section className="panel-card technician-notes-room">
    <div className="panel-heading">
      <div><span className="eyebrow"><NotebookPen size={13}/> MÓJ POKÓJ NOTATEK</span><h2>Prywatne notatki serwisanta</h2><p>Te notatki należą wyłącznie do Twojego konta TECHNICIAN i nie są częścią historii klienta ani zlecenia.</p></div>
      <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()}><RefreshCw className={busy==='load'?'spin':''} size={14}/> Odśwież</button>
    </div>
    {error&&<div className="service-inline-error">{error}</div>}
    <div className="technician-note-compose">
      <input maxLength={120} placeholder="Tytuł, np. Zamówienia na jutro" value={title} onChange={(e)=>setTitle(e.target.value)} disabled={Boolean(busy)}/>
      <textarea rows={6} maxLength={4000} placeholder="Twoja prywatna notatka…" value={body} onChange={(e)=>setBody(e.target.value)} disabled={Boolean(busy)}/>
      <div>
        <label><input type="checkbox" checked={pinned} onChange={(e)=>setPinned(e.target.checked)} disabled={Boolean(busy)}/><Pin size={13}/> Przypnij</label>
        <button className="button primary small" disabled={Boolean(busy)||!body.trim()} onClick={()=>void add()}><Plus size={13}/> Zapisz notatkę</button>
      </div>
    </div>
    <div className="technician-note-grid">
      {notes.map((note)=><article key={note.id} className={note.pinned?'pinned':''}>
        <header><div>{note.pinned&&<Pin size={13}/>}<strong>{note.title||'Notatka'}</strong></div><button disabled={Boolean(busy)} title="Usuń" onClick={()=>void remove(note)}><Trash2 size={14}/></button></header>
        <p>{note.body}</p>
        <small>{new Date(note.updatedAt).toLocaleString('pl-PL')}</small>
      </article>)}
      {!notes.length&&<div className="service-history-empty">Twój pokój notatek jest pusty.</div>}
    </div>
  </section>;
}
