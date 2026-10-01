import fs from 'node:fs';

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const servicePath = 'src/pages/ServicePage.tsx';
let service = fs.readFileSync(servicePath, 'utf8');

service = replaceOnce(
  service,
  `  brand: '', model: '', imei: '', serialNumber: '', deviceNotes: 'Brak uwag',\n  issueDescription: '', orderType: 'REPAIR' as 'REPAIR' | 'COMPLAINT',`,
  `  brand: '', model: '', imei: '', serialNumber: '', deviceNotes: 'Brak uwag',\n  unlockType: 'NONE' as 'NONE' | 'PIN' | 'PATTERN', unlockSecret: '',\n  issueDescription: '', orderType: 'REPAIR' as 'REPAIR' | 'COMPLAINT',`,
  'empty intake form unlock fields'
);

service = replaceOnce(
  service,
  `    if (cleanImei && !/^\\d{14,16}$/.test(cleanImei)) {\n      setError('IMEI powinien zawierać 14–16 cyfr.');\n      return;\n    }\n\n    submitBusyRef.current = true;`,
  `    if (cleanImei && !/^\\d{14,16}$/.test(cleanImei)) {\n      setError('IMEI powinien zawierać 14–16 cyfr.');\n      return;\n    }\n    if (form.unlockType === 'PIN' && !/^\\d{4,16}$/.test(form.unlockSecret)) {\n      setError('PIN powinien zawierać od 4 do 16 cyfr.');\n      return;\n    }\n    if (form.unlockType === 'PATTERN' && (!/^[1-9]{4,9}$/.test(form.unlockSecret) || new Set(form.unlockSecret.split('')).size !== form.unlockSecret.length)) {\n      setError('Wzór powinien zawierać 4–9 różnych punktów siatki.');\n      return;\n    }\n\n    submitBusyRef.current = true;`,
  'unlock validation'
);

service = replaceOnce(
  service,
  `        deviceNotes: form.deviceNotes.trim() || 'Brak uwag',\n        imei: cleanImei,`,
  `        deviceNotes: form.deviceNotes.trim() || 'Brak uwag',\n        unlockType: form.unlockType,\n        unlockSecret: form.unlockType === 'NONE' ? '' : form.unlockSecret,\n        imei: cleanImei,`,
  'create order unlock payload'
);

service = replaceOnce(
  service,
  `      setResult(created);\n      if(created.order.orderNumber != null){`,
  `      setResult(created);\n      if (created.deviceUnlock?.saved === false) {\n        setNotice('Zlecenie zostało utworzone, ale chronione dane blokady nie zapisały się. Otwórz zlecenie i uzupełnij je ponownie przed przekazaniem telefonu technikowi.');\n      } else if (created.deviceUnlock?.saved && created.deviceUnlock.type !== 'NONE') {\n        setNotice('Zlecenie utworzone. PIN lub wzór zapisano w chronionym magazynie ServiceOS.');\n      }\n      if(created.order.orderNumber != null){`,
  'unlock save result message'
);

const deviceNotesAnchor = `                    <div className="service-device-notes full"><div className="service-field-heading"><span>Stan / uwagi do urządzenia</span><small>opcjonalnie</small></div>`;
const unlockUi = `                    <div className="service-device-unlock full">\n                      <div className="service-field-heading"><span>Blokada telefonu</span><small><ShieldCheck size={12}/> chronione dane serwisowe</small></div>\n                      <div className="service-unlock-type-picker" role="group" aria-label="Rodzaj blokady telefonu">\n                        {(['NONE','PIN','PATTERN'] as const).map((type)=><button type="button" key={type} className={form.unlockType===type?'active':''} onClick={()=>setForm((current)=>({...current,unlockType:type,unlockSecret:''}))}>{type==='NONE'?'Brak blokady':type==='PIN'?'PIN':'Wzór'}</button>)}\n                      </div>\n                      {form.unlockType==='PIN'&&<label className="service-unlock-secret"><span>PIN telefonu <em>wymagany</em></span><input type="password" inputMode="numeric" autoComplete="off" maxLength={16} value={form.unlockSecret} onChange={(event)=>setForm((current)=>({...current,unlockSecret:event.target.value.replace(/\\D/g,'').slice(0,16)}))} placeholder="4–16 cyfr"/><small>PIN jest szyfrowany osobno i nie trafia do zwykłych uwag ani historii klienta.</small></label>}\n                      {form.unlockType==='PATTERN'&&<div className="service-pattern-field"><span>Wzór blokady <em>wymagany</em></span><div className="service-pattern-grid" aria-label="Wybierz wzór blokady">{Array.from({length:9},(_,index)=>String(index+1)).map((point)=><button type="button" key={point} className={form.unlockSecret.includes(point)?'active':''} disabled={form.unlockSecret.includes(point)} onClick={()=>setForm((current)=>({...current,unlockSecret:(current.unlockSecret+point).slice(0,9)}))}>{point}</button>)}</div><div className="service-pattern-sequence"><strong>{form.unlockSecret ? form.unlockSecret.split('').join(' → ') : 'Wybierz minimum 4 punkty'}</strong><button type="button" className="button tiny secondary" onClick={()=>setForm((current)=>({...current,unlockSecret:''}))}>Wyczyść</button></div><small>Wzór jest szyfrowany osobno. ServiceOS zapisuje kolejność punktów 1–9 i pokazuje ją tylko uprawnionym osobom realizującym serwis.</small></div>}\n                    </div>\n`;
service = replaceOnce(service, deviceNotesAnchor, unlockUi + deviceNotesAnchor, 'unlock intake UI');

fs.writeFileSync(servicePath, service);

const typesPath = 'src/types/electron.d.ts';
let types = fs.readFileSync(typesPath, 'utf8');
types = replaceOnce(
  types,
  `export interface ServiceCreateOrderResult { customer:ServiceCustomer; order:ServiceOrder; reusedCustomer:boolean; reusedDevice?:boolean; notification?:{queued:boolean;sent:boolean;reason?:string;status?:string;senderUserId?:string|null;attempts?:number;nextAttemptAt?:string;messageId?:string}; serviceCard?:{required:boolean;printMode?:'PHYSICAL_AND_ONLINE'|'ONLINE_ONLY'|null;customerEmailRequired?:boolean}; }`,
  `export interface ServiceCreateOrderResult { customer:ServiceCustomer; order:ServiceOrder; reusedCustomer:boolean; reusedDevice?:boolean; deviceUnlock?:{saved:boolean;type:'NONE'|'PIN'|'PATTERN';message?:string}; notification?:{queued:boolean;sent:boolean;reason?:string;status?:string;senderUserId?:string|null;attempts?:number;nextAttemptAt?:string;messageId?:string}; serviceCard?:{required:boolean;printMode?:'PHYSICAL_AND_ONLINE'|'ONLINE_ONLY'|null;customerEmailRequired?:boolean}; }`,
  'create order result type'
);

types = replaceOnce(
  types,
  `createOrder:(payload:{pointId:string;firstName:string;lastName:string;email?:string;phone?:string;brand?:string;model?:string;imei?:string;serialNumber?:string;deviceNotes?:string;issueDescription:string;orderType:'REPAIR'|'COMPLAINT';originalOrderId?:string;assignedTechnicianId?:string;estimatedCost?:number;estimatedCompletionAt?:string|null})=>Promise<ServiceCreateOrderResult>;`,
  `createOrder:(payload:{pointId:string;firstName:string;lastName:string;email?:string;phone?:string;brand?:string;model?:string;imei?:string;serialNumber?:string;deviceNotes?:string;unlockType?:'NONE'|'PIN'|'PATTERN';unlockSecret?:string;issueDescription:string;orderType:'REPAIR'|'COMPLAINT';originalOrderId?:string;assignedTechnicianId?:string;estimatedCost?:number;estimatedCompletionAt?:string|null})=>Promise<ServiceCreateOrderResult>;`,
  'create order preload type'
);
fs.writeFileSync(typesPath, types);
