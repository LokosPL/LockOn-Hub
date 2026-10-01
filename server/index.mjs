import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const loadLocalEnv = () => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {}
};
loadLocalEnv();

const PORT = Number(process.env.LOCKON_API_PORT || 8787);
const HOST = process.env.LOCKON_API_HOST || '127.0.0.1';
const DATA_FILE = process.env.LOCKON_DATA_FILE || path.join(process.cwd(), 'server', 'data', 'database.json');
const OWNER_EMAIL = (process.env.LOCKON_OWNER_EMAIL || '').trim().toLowerCase();
const GOOGLE_CLIENT_ID = (process.env.LOCKON_GOOGLE_CLIENT_ID || '996585439932-e10mu53j95s6u13vrua841tm4oco38so.apps.googleusercontent.com').trim();
const ALLOW_DEV_LOGIN = process.env.LOCKON_ALLOW_DEV_LOGIN === '1';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7;
const BODY_LIMIT_BYTES = 64 * 1024;
const googleVerifier = new OAuth2Client();

const ROLES = ['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER'];
const REQUESTABLE_ROLES = new Set(['BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const GLOBAL_ROLES = new Set(['OWNER', 'BOSS']);
const SERVICE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER']);
const SERVICE_CREATE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);
const SERVICE_INTAKE_EDIT_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN', 'USER']);
const SERVICE_MANAGE_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR']);
const FINANCE_READ_ROLES = new Set(['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN']);

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const OWNER_OPERATIONAL_NAME = 'System LockOn';
const OWNER_SUPPORT_NAME = 'Właściciel aplikacji';
const isOwnerIdentity = (user) => Boolean(user) && (
  user.role === 'OWNER' ||
  (Boolean(OWNER_EMAIL) && normalizeEmail(user.email) === OWNER_EMAIL)
);
const operationalIdentityName = (user) => isOwnerIdentity(user) ? OWNER_OPERATIONAL_NAME : (user?.name || user?.email || null);
const operationalIdentityEmail = (user) => isOwnerIdentity(user) ? null : (user?.email || null);
const supportIdentityName = (user) => isOwnerIdentity(user) ? OWNER_SUPPORT_NAME : (user?.name || user?.email || null);
const supportIdentityEmail = (user) => isOwnerIdentity(user) ? null : (user?.email || null);
const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const normalizeTechnicianPercent = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 100) / 100 : null;
};
const splitRevenueAmount = (amount, technicianPercent) => {
  const percent = normalizeTechnicianPercent(technicianPercent) ?? 50;
  const technicianShare = Math.round(Number(amount) * percent) / 100;
  return {
    technicianPercent: percent,
    bossPercent: Math.round((100-percent)*100)/100,
    technicianShare,
    bossShare: Math.round((Number(amount)-technicianShare)*100)/100
  };
};
const normalizePhone = (value = '') => String(value).replace(/\D/g, '').slice(-15);
const customerView = (customer) => ({ id:customer.id, firstName:customer.firstName, lastName:customer.lastName, email:customer.email||null, phone:customer.phone||null });
const ensureDir = () => fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
const initialDb = () => ({version:2,users:[],points:[{id:'nowogard',name:'Punkt Nowogard',city:'Nowogard',active:true,createdAt:nowIso()}],loginEvents:[],auditLog:[],revenueEntries:[],customers:[],devices:[],serviceOrders:[],serviceOrderStatusHistory:[],serviceOrderNotes:[],serviceOrderParts:[],serviceOrderInvoices:[],technicianPrivateNotes:[],customerNotificationPreferences:[],invoicePromptDismissals:[],notificationSettings:[],notificationHistory:[],supportConversations:[],supportMessages:[],sessions:[]});
const loadDb=()=>{ensureDir();if(!fs.existsSync(DATA_FILE)){const d=initialDb();fs.writeFileSync(DATA_FILE,JSON.stringify(d,null,2));return d;}try{const raw=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));return{...initialDb(),...raw,version:2,users:Array.isArray(raw.users)?raw.users:[],points:Array.isArray(raw.points)&&raw.points.length?raw.points:initialDb().points,loginEvents:Array.isArray(raw.loginEvents)?raw.loginEvents:[],auditLog:Array.isArray(raw.auditLog)?raw.auditLog:[],revenueEntries:Array.isArray(raw.revenueEntries)?raw.revenueEntries:[],customers:Array.isArray(raw.customers)?raw.customers:[],devices:Array.isArray(raw.devices)?raw.devices:[],serviceOrders:Array.isArray(raw.serviceOrders)?raw.serviceOrders:[],serviceOrderStatusHistory:Array.isArray(raw.serviceOrderStatusHistory)?raw.serviceOrderStatusHistory:[],serviceOrderNotes:Array.isArray(raw.serviceOrderNotes)?raw.serviceOrderNotes:[],serviceOrderParts:Array.isArray(raw.serviceOrderParts)?raw.serviceOrderParts:[],serviceOrderInvoices:Array.isArray(raw.serviceOrderInvoices)?raw.serviceOrderInvoices:[],technicianPrivateNotes:Array.isArray(raw.technicianPrivateNotes)?raw.technicianPrivateNotes:[],customerNotificationPreferences:Array.isArray(raw.customerNotificationPreferences)?raw.customerNotificationPreferences:[],invoicePromptDismissals:Array.isArray(raw.invoicePromptDismissals)?raw.invoicePromptDismissals:[],notificationSettings:Array.isArray(raw.notificationSettings)?raw.notificationSettings:[],notificationHistory:Array.isArray(raw.notificationHistory)?raw.notificationHistory:[],supportConversations:Array.isArray(raw.supportConversations)?raw.supportConversations:[],supportMessages:Array.isArray(raw.supportMessages)?raw.supportMessages:[],sessions:Array.isArray(raw.sessions)?raw.sessions:[]};}catch{const backup=`${DATA_FILE}.broken-${Date.now()}`;try{fs.copyFileSync(DATA_FILE,backup);}catch{}const d=initialDb();fs.writeFileSync(DATA_FILE,JSON.stringify(d,null,2));return d;}};
let db=loadDb();
const saveDb=()=>{ensureDir();const tmp=`${DATA_FILE}.tmp`;fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DATA_FILE);};
const localAudit=(actor,action,entityType,entityId=null,pointId=null,metadata={})=>{db.auditLog.unshift({id:id('aud'),actorUserId:actor?.id||null,actorName:operationalIdentityName(actor)||'System',actorRole:actor?.role||null,action,entityType,entityId,pointId,metadata:{...metadata,clientType:metadata.clientType||'DESKTOP'},createdAt:nowIso()});db.auditLog=db.auditLog.slice(0,500);saveDb();};
const pointSummary=(point)=>({id:point.id,name:point.name,city:point.city,active:point.active!==false});
const publicUser=(user)=>({id:user.id,email:operationalIdentityEmail(user),name:operationalIdentityName(user),picture:isOwnerIdentity(user)?null:user.picture,role:user.role??null,technicianSplitPercent:user.technicianSplitPercent??null,supportEnabled:user.supportEnabled===true||user.role==='SUPPORT'||user.role==='OWNER',status:user.status,blocked:Boolean(user.blockedAt),blockedAt:user.blockedAt??null,blockedReason:user.blockedReason??null,pointIds:Array.isArray(user.pointIds)?user.pointIds:[],requestedPoint:user.requestedPoint??null,firstLoginAt:user.firstLoginAt,lastLoginAt:user.lastLoginAt});
const pointsForUser=(user)=>{if(GLOBAL_ROLES.has(user.role))return db.points.filter(p=>p.active!==false).map(pointSummary);const ids=new Set(user.pointIds||[]);return db.points.filter(p=>ids.has(p.id)&&p.active!==false).map(pointSummary);};
const authPayload=(user)=>({user:publicUser(user),points:pointsForUser(user)});
const findUserByEmail=(email)=>db.users.find(u=>normalizeEmail(u.email)===normalizeEmail(email));
const findUserByGoogleSub=(sub)=>sub?db.users.find(u=>u.googleSub===sub):null;
const findUserById=(userId)=>db.users.find(u=>u.id===userId);
const sessionTokenHash=(token)=>crypto.createHash('sha256').update(token).digest('hex');
const ensureOwner=(profile={})=>{if(!OWNER_EMAIL)return null;let owner=findUserByEmail(OWNER_EMAIL);if(!owner){owner={id:id('usr'),googleSub:profile.sub||null,email:OWNER_EMAIL,name:profile.name||OWNER_OPERATIONAL_NAME,picture:profile.picture||null,role:'OWNER',supportEnabled:true,status:'ACTIVE',pointIds:[],requestedPoint:null,firstLoginAt:nowIso(),lastLoginAt:nowIso()};db.users.push(owner);}else{owner.role='OWNER';owner.supportEnabled=true;owner.blockedAt=null;owner.blockedReason=null;owner.status='ACTIVE';owner.pointIds=[];owner.googleSub=profile.sub||owner.googleSub||null;owner.name=profile.name||owner.name;owner.picture=profile.picture||owner.picture;owner.lastLoginAt=nowIso();}return owner;};
if(OWNER_EMAIL)ensureOwner();saveDb();
const json=(res,status,body)=>{const data=JSON.stringify(body);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()'});res.end(data);};
const readBody=(req)=>new Promise((resolve,reject)=>{let body='',size=0,settled=false;req.on('data',chunk=>{if(settled)return;size+=Buffer.byteLength(chunk);if(size>BODY_LIMIT_BYTES){settled=true;reject(new Error('PAYLOAD_TOO_LARGE'));return;}body+=chunk;});req.on('end',()=>{if(settled)return;settled=true;if(!body)return resolve({});try{resolve(JSON.parse(body));}catch{reject(new Error('INVALID_JSON'));}});req.on('error',error=>{if(settled)return;settled=true;reject(error);});});
const createSession=(user)=>{const token=crypto.randomBytes(32).toString('base64url'),createdAt=Date.now();db.sessions=db.sessions.filter(s=>Number(s.expiresAt)>createdAt&&Number(s.absoluteExpiresAt||s.expiresAt)>createdAt);db.sessions.push({tokenHash:sessionTokenHash(token),userId:user.id,createdAt,lastSeenAt:createdAt,expiresAt:createdAt+SESSION_TTL_MS,absoluteExpiresAt:createdAt+SESSION_ABSOLUTE_TTL_MS});return token;};
const findSession=(token)=>{if(!token)return null;const now=Date.now(),hash=sessionTokenHash(token);const session=db.sessions.find(s=>{const tokenMatches=s.tokenHash?s.tokenHash===hash:s.token===token;return tokenMatches&&Number(s.expiresAt)>now&&Number(s.absoluteExpiresAt||s.expiresAt)>now;});if(!session)return null;if(!session.tokenHash){session.tokenHash=hash;delete session.token;}session.lastSeenAt=now;const absoluteExpiry=Number(session.absoluteExpiresAt||(Number(session.createdAt)+SESSION_ABSOLUTE_TTL_MS));session.absoluteExpiresAt=absoluteExpiry;if(Number(session.expiresAt)-now<SESSION_REFRESH_THRESHOLD_MS)session.expiresAt=Math.min(now+SESSION_TTL_MS,absoluteExpiry);saveDb();return session;};
const currentUser=(req)=>{const auth=req.headers.authorization||'',token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';const session=findSession(token);return session?(findUserById(session.userId)||null):null;};
const requireUser=(req,res)=>{const user=currentUser(req);if(!user){json(res,401,{error:'UNAUTHORIZED',message:'Sesja wygasła albo jest nieprawidłowa.'});return null;}if(user.blockedAt){json(res,401,{error:'ACCOUNT_BLOCKED',message:user.blockedReason?'Konto zostało zablokowane: '+user.blockedReason:'Konto zostało zablokowane.'});return null;}return user;};
const requireActive=(req,res)=>{const user=requireUser(req,res);if(!user)return null;if(user.status!=='ACTIVE'){json(res,403,{error:'ACCOUNT_NOT_ACTIVE',message:'Konto nie zostało jeszcze aktywowane.'});return null;}return user;};
const requireRole=(req,res,roles)=>{const user=requireActive(req,res);if(!user)return null;if(!roles.includes(user.role)){json(res,403,{error:'FORBIDDEN',message:'Brak uprawnień do tej operacji.'});return null;}return user;};
const hasSupportAccess=(user)=>user?.role==='OWNER'||user?.role==='SUPPORT'||user?.supportEnabled===true;
const requireSupportAccess=(req,res)=>{const user=requireActive(req,res);if(!user)return null;if(!hasSupportAccess(user)){json(res,403,{error:'SUPPORT_FORBIDDEN',message:'Brak uprawnienia Wsparcie LockOn.'});return null;}return user;};
const recordLogin=(user)=>{db.loginEvents.unshift({id:id('log'),userId:user.id,email:operationalIdentityEmail(user),name:operationalIdentityName(user),role:user.role??null,status:user.status,pointIds:user.pointIds||[],createdAt:nowIso()});db.loginEvents=db.loginEvents.slice(0,1000);};
const verifyGoogleIdToken=async(idToken)=>{const ticket=await googleVerifier.verifyIdToken({idToken,audience:GOOGLE_CLIENT_ID}),profile=ticket.getPayload();if(!profile?.sub||!profile.email||profile.email_verified!==true)throw new Error('Google nie potwierdził tożsamości użytkownika.');return{sub:profile.sub,email:normalizeEmail(profile.email),name:cleanText(profile.name||profile.email,120),picture:profile.picture||null};};
const loginProfile=(profile)=>{let user=findUserByGoogleSub(profile.sub)||findUserByEmail(profile.email);const timestamp=nowIso();if(OWNER_EMAIL&&normalizeEmail(profile.email)===OWNER_EMAIL)user=ensureOwner(profile);else if(!user){user={id:id('usr'),googleSub:profile.sub||null,email:normalizeEmail(profile.email),name:profile.name,picture:profile.picture||null,role:null,supportEnabled:false,status:'PENDING',pointIds:[],requestedPoint:null,firstLoginAt:timestamp,lastLoginAt:timestamp};db.users.push(user);}else{user.googleSub=profile.sub||user.googleSub||null;user.name=profile.name||user.name;user.picture=profile.picture||user.picture;user.lastLoginAt=timestamp;}recordLogin(user);const token=createSession(user);saveDb();return{token,...authPayload(user)};};
const canSeePoint=(user,pointId)=>GLOBAL_ROLES.has(user.role)||(user.pointIds||[]).includes(pointId);
const LOCAL_STATUS_LABELS={RECEIVED:'Przyjęto urządzenie',DIAGNOSIS:'Diagnoza',WAITING_PARTS:'Oczekiwanie na części',IN_REPAIR:'W naprawie',REPAIR_DONE:'Naprawa zakończona',READY:'Gotowe do odbioru',COMPLETED:'Zakończone',CANCELLED:'Anulowane',REJECTED:'Odrzucone'};
const localOrderView=(order)=>{const customer=db.customers.find(i=>i.id===order.customerId),device=db.devices.find(i=>i.id===order.deviceId),point=db.points.find(i=>i.id===order.pointId),technician=order.assignedTechnicianId?findUserById(order.assignedTechnicianId):null;return{...order,pointName:point?.name||'Punkt',customerName:customer?`${customer.firstName} ${customer.lastName}`:'Klient',customerEmail:customer?.email||null,customerPhone:customer?.phone||null,brand:device?.brand||'',model:device?.model||'',imei:device?.imei||null,serialNumber:device?.serialNumber||null,deviceNotes:device?.notes||null,assignedTechnicianId:isOwnerIdentity(technician)?null:(order.assignedTechnicianId||null),assignedTechnicianName:isOwnerIdentity(technician)?null:(technician?.name||null),assignedTechnicianEmail:isOwnerIdentity(technician)?null:(technician?.email||null),statusLabel:LOCAL_STATUS_LABELS[order.status]||order.status,currency:order.currency||'PLN'};};
const localOrderViewForUser=(order,user)=>{const view=localOrderView(order);if(!SERVICE_EDIT_ROLES.has(user.role)){view.estimatedCost=null;view.finalCost=null;}return view;};
const revenueVisibleTo=(user,entry)=>GLOBAL_ROLES.has(user.role)?true:user.role==='TECHNICIAN'?entry.userId===user.id:user.role==='COORDINATOR'?canSeePoint(user,entry.pointId):false;
const revenueView=(entry)=>{const technician=findUserById(entry.userId),point=db.points.find(p=>p.id===entry.pointId),split=splitRevenueAmount(entry.amount,entry.splitTechnicianPercent??entry.technicianPercent??50),approved=entry.status==='APPROVED'||entry.status==='SETTLED';return{...entry,splitTechnicianPercent:split.technicianPercent,splitBossPercent:split.bossPercent,technicianShare:approved?split.technicianShare:0,bossShare:approved?split.bossShare:0,technician:technician?{id:technician.id,name:operationalIdentityName(technician),email:operationalIdentityEmail(technician)}:null,point:point?pointSummary(point):null};};

const handle=async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),method=req.method||'GET';
  if(method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,service:'LockOn ServiceOS API',time:nowIso()});
  if(method==='POST'&&url.pathname==='/auth/google'){const body=await readBody(req);if(!body.idToken)return json(res,400,{error:'MISSING_TOKEN',message:'Brak tokena tożsamości Google.'});try{return json(res,200,loginProfile(await verifyGoogleIdToken(String(body.idToken))));}catch{return json(res,401,{error:'GOOGLE_AUTH_FAILED',message:'Google nie potwierdził tożsamości.'});}}
  if(method==='POST'&&url.pathname==='/auth/dev-owner'){if(!ALLOW_DEV_LOGIN)return json(res,404,{error:'NOT_FOUND'});if(!OWNER_EMAIL)return json(res,503,{error:'OWNER_EMAIL_NOT_CONFIGURED'});return json(res,200,loginProfile({email:OWNER_EMAIL,name:OWNER_OPERATIONAL_NAME,sub:'dev-owner',picture:null}));}
  if(method==='GET'&&url.pathname==='/me'){const user=requireUser(req,res);if(!user)return;return json(res,200,authPayload(user));}
  if(method==='POST'&&url.pathname==='/auth/logout'){const auth=req.headers.authorization||'',token=auth.startsWith('Bearer ')?auth.slice(7).trim():'',session=findSession(token);if(session){db.sessions=db.sessions.filter(c=>c!==session);saveDb();}return json(res,200,{ok:true});}

  if(method==='GET'&&(url.pathname==='/service/technician/workspace'||url.pathname==='/service/technician-workspace')){
    const user=requireActive(req,res);if(!user)return;if(user.role!=='TECHNICIAN')return json(res,403,{error:'TECHNICIAN_ONLY',message:'Ten widok jest przeznaczony dla serwisanta.'});
    const orders=db.serviceOrders.filter(order=>order.assignedTechnicianId===user.id&&!['COMPLETED','CANCELLED','REJECTED'].includes(order.status)&&canSeePoint(user,order.pointId)).map(order=>localOrderViewForUser(order,user));
    const now=Date.now(),counts={active:orders.length,received:orders.filter(o=>o.status==='RECEIVED').length,diagnosis:orders.filter(o=>o.status==='DIAGNOSIS').length,waitingParts:orders.filter(o=>o.status==='WAITING_PARTS').length,inRepair:orders.filter(o=>o.status==='IN_REPAIR').length,readyForPickup:orders.filter(o=>['REPAIR_DONE','READY'].includes(o.status)).length,overdue:orders.filter(o=>o.estimatedCompletionAt&&new Date(o.estimatedCompletionAt).getTime()<now).length};
    return json(res,200,{technician:{id:user.id,name:user.name,email:user.email},counts,orders,generatedAt:nowIso()});
  }

  if((method==='GET'||method==='POST')&&(url.pathname==='/service/technician/notes'||url.pathname==='/service/technician-notes')){
    const user=requireActive(req,res);if(!user)return;if(user.role!=='TECHNICIAN')return json(res,403,{error:'TECHNICIAN_ONLY',message:'Prywatny pokój notatek jest dostępny dla serwisanta.'});
    if(method==='GET'){const notes=db.technicianPrivateNotes.filter(i=>i.userId===user.id).sort((a,b)=>(Number(b.pinned)-Number(a.pinned))||String(b.updatedAt).localeCompare(String(a.updatedAt)));return json(res,200,notes);}
    const body=await readBody(req),title=cleanText(body.title,120),note=cleanText(body.body,4000),pinned=body.pinned===true;if(!note)return json(res,400,{error:'NOTE_REQUIRED',message:'Notatka nie może być pusta.'});const created={id:id('tnn'),userId:user.id,title,body:note,pinned,createdAt:nowIso(),updatedAt:nowIso()};db.technicianPrivateNotes.push(created);localAudit(user,'TECHNICIAN_PRIVATE_NOTE_CREATED','technician_note',created.id,null,{pinned,length:note.length});saveDb();return json(res,201,created);
  }

  const localTechnicianNoteDelete=url.pathname.match(/^\/service\/technician(?:\/notes|-notes)\/([^/]+)$/);
  if(method==='DELETE'&&localTechnicianNoteDelete){const user=requireActive(req,res);if(!user)return;if(user.role!=='TECHNICIAN')return json(res,403,{error:'TECHNICIAN_ONLY'});const before=db.technicianPrivateNotes.length;db.technicianPrivateNotes=db.technicianPrivateNotes.filter(i=>!(i.id===localTechnicianNoteDelete[1]&&i.userId===user.id));if(db.technicianPrivateNotes.length===before)return json(res,404,{error:'NOT_FOUND'});localAudit(user,'TECHNICIAN_PRIVATE_NOTE_DELETED','technician_note',localTechnicianNoteDelete[1]);saveDb();return json(res,200,{ok:true});}

  const localCostingMatch=url.pathname.match(/^\/service\/orders\/([^/]+)\/costing$/);
  if(localCostingMatch&&(method==='GET'||method==='POST'||method==='PUT')){
    const user=requireActive(req,res);if(!user)return;if(!SERVICE_EDIT_ROLES.has(user.role))return json(res,403,{error:'SERVICE_FINANCE_FORBIDDEN'});const order=db.serviceOrders.find(i=>i.id===localCostingMatch[1]);if(!order)return json(res,404,{error:'NOT_FOUND'});if(!canSeePoint(user,order.pointId))return json(res,403,{error:'POINT'});if(user.role==='TECHNICIAN'&&order.assignedTechnicianId!==user.id)return json(res,403,{error:'TECHNICIAN_ORDER_REQUIRED'});
    if(method==='POST'||method==='PUT'){const body=await readBody(req),labor=Number(body.laborCostGross||0),other=Number(body.otherCostGross||0),parts=Array.isArray(body.parts)?body.parts:[];if(!Number.isFinite(labor)||labor<0||!Number.isFinite(other)||other<0||parts.length>100)return json(res,400,{error:'COSTING'});const normalized=[];for(const raw of parts){const description=cleanText(raw?.description,240),quantity=Number(raw?.quantity),unit=Number(raw?.unitCostGross);if(!description||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unit)||unit<0)return json(res,400,{error:'PARTS'});normalized.push({id:id('prt'),serviceOrderId:order.id,description,quantity,unitCostGross:unit,invoiceReceived:raw?.invoiceReceived===true,invoiceNumber:cleanText(raw?.invoiceNumber,120)||null,supplier:cleanText(raw?.supplier,180)||null,purchasedAt:cleanText(raw?.purchasedAt,10)||null,createdAt:nowIso(),updatedAt:nowIso()});}order.laborCostGross=labor;order.otherCostGross=other;db.serviceOrderParts=db.serviceOrderParts.filter(i=>i.serviceOrderId!==order.id).concat(normalized);localAudit(user,'SERVICE_COSTING_UPDATED','service_order',order.id,order.pointId,{partsCount:normalized.length,laborCostGross:labor,otherCostGross:other});saveDb();}
    const parts=db.serviceOrderParts.filter(i=>i.serviceOrderId===order.id).map(i=>({...i,totalCostGross:Math.round(i.quantity*i.unitCostGross*100)/100})),partsCostGross=Math.round(parts.reduce((s,i)=>s+i.totalCostGross,0)*100)/100,laborCostGross=Number(order.laborCostGross||0),otherCostGross=Number(order.otherCostGross||0),internalCostGross=Math.round((partsCostGross+laborCostGross+otherCostGross)*100)/100,customerPrice=order.finalCost??order.estimatedCost??null;
    return json(res,200,{orderId:order.id,orderNumber:order.orderNumber,currency:order.currency||'PLN',parts,invoices:[],partsCostGross,laborCostGross,otherCostGross,internalCostGross,estimatedCost:order.estimatedCost??null,finalCost:order.finalCost??null,customerPrice,marginGross:customerPrice==null?null:Math.round((customerPrice-internalCostGross)*100)/100});
  }

  if(method==='GET'&&url.pathname==='/service/orders'){const user=requireActive(req,res);if(!user)return;if(!SERVICE_READ_ROLES.has(user.role))return json(res,403,{error:'FORBIDDEN'});return json(res,200,db.serviceOrders.filter(o=>canSeePoint(user,o.pointId)).map(o=>localOrderViewForUser(o,user)));}
  if(method==='GET'&&url.pathname==='/service/invoices/monthly-prompt'){const user=requireActive(req,res);if(!user)return;return json(res,200,{show:false,period:null,count:0,dismissed:false});}

  return json(res,404,{error:'NOT_FOUND',message:'Nie znaleziono endpointu.'});
};

const server=http.createServer((req,res)=>{handle(req,res).catch((error)=>{console.error(error);if(error?.message==='PAYLOAD_TOO_LARGE')return json(res,413,{error:'PAYLOAD_TOO_LARGE'});if(error?.message==='INVALID_JSON')return json(res,400,{error:'INVALID_JSON'});json(res,500,{error:'INTERNAL_ERROR',message:'Wystąpił błąd serwera.'});});});
server.listen(PORT,HOST,()=>console.log(`LockOn ServiceOS API listening on http://${HOST}:${PORT}`));
