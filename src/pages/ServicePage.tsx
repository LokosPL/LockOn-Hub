import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeDollarSign, BellRing, CalendarClock, CalendarDays, CheckCircle2, ClipboardList, ClipboardPlus,
  Clock3, FileArchive, History, IdCard, Mail, MailCheck, MapPin, MessageSquareText, NotebookPen, PackageCheck, Printer, RefreshCw, RotateCcw, Save, Search, Send,
  Settings2, ShieldCheck, Smartphone, StickyNote, Truck, UserCog, UserRound, Wrench, XCircle
} from 'lucide-react';
import { InvoiceWarehouse } from '../components/InvoiceWarehouse';
import { MonthlyInvoicePrompt } from '../components/MonthlyInvoicePrompt';
import { OrderCostingCard } from '../components/OrderCostingCard';
import { TechnicianCalendar } from '../components/TechnicianCalendar';
import { TechnicianNotesRoom } from '../components/TechnicianNotesRoom';
import { useAppDialog } from '../components/AppDialog';
import type {
  AdminPoint,
  AuthState,
  CustomerQuoteRequest,
  GmailConnectionStatus,
  NotificationHistoryItem,
  NotificationSettings,
  ServiceCreateOrderResult,
  ServiceCustomer,
  ServiceCustomerDetail,
  ServiceOrderNote,
  ServiceOrderSummary,
  ServiceStatusHistoryItem,
  ServiceTechnician,
  ServiceTransfer
} from '../types/electron';
import type { UserRole } from '../config/roles';
import { PHONE_BRANDS } from '../config/phoneBrands';

interface ServicePageProps {
  auth: AuthState;
  effectiveRole: UserRole;
  focusOrderId?: string | null;
}

const dateInputAfterDays = (days: number) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
};

const makeEmptyForm = () => ({
  firstName: '', lastName: '', email: '', phone: '',
  brand: '', model: '', imei: '', serialNumber: '', deviceNotes: 'Brak uwag',
  issueDescription: '', orderType: 'REPAIR' as 'REPAIR' | 'COMPLAINT',
  estimatedCost: '', estimatedCompletionAt: dateInputAfterDays(3)
});

type ServiceIntakeForm = ReturnType<typeof makeEmptyForm>;

const DEVICE_NOTE_PRESETS = [
  'Brak uwag',
  'Rysy / ślady użytkowania',
  'Pęknięty ekran',
  'Uszkodzona obudowa',
  'Urządzenie w etui',
  'Akcesoria w zestawie'
] as const;

const formatDeviceLabel = (brand?: string | null, model?: string | null) => {
  const parts = [brand, model].filter((value) => value && value !== 'Nie podano');
  return parts.length ? parts.join(' ') : 'Telefon — marka/model nie podane';
};

const toLocalDateInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
};

const toApiDateTime = (value: string) => {
  if (!value) return null;
  const date = new Date(value + 'T12:00:00');
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

type OrderDetailsDraft = {
  imei: string;
  serialNumber: string;
  deviceNotes: string;
  assignedTechnicianId: string;
  estimatedCost: string;
  finalCost: string;
  estimatedCompletionAt: string;
};

const statuses = [
  ['RECEIVED', 'Przyjęto urządzenie'],
  ['DIAGNOSIS', 'Diagnoza'],
  ['WAITING_PARTS', 'Oczekiwanie na części'],
  ['IN_REPAIR', 'W naprawie'],
  ['REPAIR_DONE', 'Naprawa zakończona'],
  ['READY', 'Gotowe do odbioru'],
  ['COMPLETED', 'Zakończone'],
  ['CANCELLED', 'Anulowane'],
  ['REJECTED', 'Odrzucone']
] as const;

const mailStatusOptions = statuses;

const deliveryLabel = (status: NotificationHistoryItem['status']) => ({
  PENDING: 'Oczekuje',
  PROCESSING: 'Wysyłanie',
  SENT: 'Wysłano',
  FAILED: 'Błąd',
  CANCELLED: 'Anulowano'
}[status]);

const isTransferredToService = (order: ServiceOrderSummary) =>
  order.openTransfer?.kind === 'OUTBOUND_SERVICE' ||
  Boolean(order.homePointId && order.currentPointId && order.currentPointId !== order.homePointId) ||
  Boolean(order.returnRequired && order.currentPointId && order.currentPointId !== (order.homePointId || order.pointId));

const CLOSED_SERVICE_STATUSES = new Set(['COMPLETED','CANCELLED','REJECTED']);
const INTERNAL_NO_SERIAL_PREFIX = 'BRAK-SN-ZL-';
const isInternalNoSerial = (value?: string | null) => Boolean(value?.startsWith(INTERNAL_NO_SERIAL_PREFIX));
const readableSerialNumber = (value?: string | null) => value && !isInternalNoSerial(value) ? value : null;
const complaintFallbackSerial = (order: ServiceOrderSummary) =>
  `${INTERNAL_NO_SERIAL_PREFIX}${order.orderNumber ?? order.deviceId.slice(-10)}`;

const sortOrdersForList = (items: ServiceOrderSummary[]) => [...items].sort((a,b) => {
  const closedA = CLOSED_SERVICE_STATUSES.has(a.status);
  const closedB = CLOSED_SERVICE_STATUSES.has(b.status);
  if (closedA !== closedB) return closedA ? 1 : -1;
  if (closedA) {
    const timeA = new Date(a.completedAt || a.updatedAt || a.createdAt || a.receivedAt || 0).getTime();
    const timeB = new Date(b.completedAt || b.updatedAt || b.createdAt || b.receivedAt || 0).getTime();
    return timeA - timeB;
  }
  const timeA = new Date(a.receivedAt || a.createdAt || a.updatedAt || 0).getTime();
  const timeB = new Date(b.receivedAt || b.createdAt || b.updatedAt || 0).getTime();
  return timeB - timeA;
});

type ServiceTab = 'CALENDAR' | 'NEW' | 'ORDERS' | 'TRANSFERS' | 'QUOTES' | 'EMAILS' | 'INVOICES' | 'TECH_NOTES';

export function ServicePage({ auth, effectiveRole, focusOrderId = null }: ServicePageProps) {
  const {confirm}=useAppDialog();
  const isActualTechnician = auth.role === 'TECHNICIAN';
  const [tab, setTab] = useState<ServiceTab>(isActualTechnician ? 'CALENDAR' : 'ORDERS');
  const [form, setForm] = useState<ServiceIntakeForm>(() => makeEmptyForm());
  const [intakeStage, setIntakeStage] = useState<'TYPE'|'DETAILS'>('TYPE');
  const [brandOpen, setBrandOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [complaintQuery, setComplaintQuery] = useState('');
  const [complaintMatches, setComplaintMatches] = useState<ServiceOrderSummary[]>([]);
  const [complaintSearchBusy, setComplaintSearchBusy] = useState(false);
  const [complaintOriginal, setComplaintOriginal] = useState<ServiceOrderSummary | null>(null);
  const [orderFilter, setOrderFilter] = useState('ALL');
  const [matches, setMatches] = useState<ServiceCustomer[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchRequestRef = useRef(0);
  const [orders, setOrders] = useState<ServiceOrderSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const submitBusyRef = useRef(false);
  const [ordersBusy, setOrdersBusy] = useState(false);
  const ordersLoadedRef = useRef(false);
  const [ordersVisibleLimit,setOrdersVisibleLimit]=useState(28);
  const [ordersHasMore,setOrdersHasMore]=useState(true);
  const [ordersPageBusy,setOrdersPageBusy]=useState(false);
  const [result, setResult] = useState<ServiceCreateOrderResult | null>(null);
  const [cardChoice, setCardChoice] = useState<{orderId:string;orderNumber:number}|null>(null);
  const [notificationChoice, setNotificationChoice] = useState<{
    customerId:string; orderId:string; orderNumber:number;
    serviceUpdates:boolean; readyForPickup:boolean; quoteUpdates:boolean; messages:boolean;
  }|null>(null);
  const [notificationChoiceBusy, setNotificationChoiceBusy] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [serviceCardBusyId, setServiceCardBusyId] = useState<string|null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [gmail, setGmail] = useState<GmailConnectionStatus | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailChecking, setGmailChecking] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [notificationHistory, setNotificationHistory] = useState<NotificationHistoryItem[]>([]);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const [orderHistories, setOrderHistories] = useState<Record<string, ServiceStatusHistoryItem[]>>({});
  const [orderNotes, setOrderNotes] = useState<Record<string, ServiceOrderNote[]>>({});
  const [customerCards, setCustomerCards] = useState<Record<string, ServiceCustomerDetail>>({});
  const [techniciansByPoint, setTechniciansByPoint] = useState<Record<string, ServiceTechnician[]>>({});
  const [detailsDrafts, setDetailsDrafts] = useState<Record<string, OrderDetailsDraft>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);
  const [warrantyBusyId, setWarrantyBusyId] = useState<string | null>(null);
  const [warrantyDrafts, setWarrantyDrafts] = useState<Record<string,string>>({});
  const [warrantyRepairDrafts, setWarrantyRepairDrafts] = useState<Record<string,string>>({});
  const [servicePoints, setServicePoints] = useState<AdminPoint[]>([]);
  const [transfers, setTransfers] = useState<ServiceTransfer[]>([]);
  const [transferDrafts, setTransferDrafts] = useState<Record<string,{toPointId:string;note:string}>>({});
  const [customerQuotes, setCustomerQuotes] = useState<CustomerQuoteRequest[]>([]);
  const [quoteBusyId, setQuoteBusyId] = useState<string | null>(null);
  const [quoteReplyDrafts, setQuoteReplyDrafts] = useState<Record<string,string>>({});
  const [quoteAmountDrafts, setQuoteAmountDrafts] = useState<Record<string,string>>({});
  const [quoteNoteDrafts, setQuoteNoteDrafts] = useState<Record<string,string>>({});

  const pointOptions = useMemo(() => auth.points, [auth.points]);
  const pointAccessSet = useMemo(() => new Set(pointOptions.map((point)=>point.id)), [pointOptions]);
  const [pointId, setPointId] = useState(auth.point?.id ?? auth.points[0]?.id ?? '');
  useEffect(() => {
    const nextPointId = auth.point?.id ?? auth.points[0]?.id ?? '';
    setPointId(nextPointId);
  }, [auth.point?.id, auth.points]);
  const canEditStatus = ['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN'].includes(effectiveRole);
  const canCreateService = canEditStatus || effectiveRole === 'USER';
  const canSetIntakeEstimate = canCreateService;
  const canSetIntakeEta = canCreateService;
  const canEditIntake = canCreateService;
  const canTransferService = canCreateService;
  const canCancelService = canCreateService;
  const canEditCosts = ['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN'].includes(effectiveRole);
  const canManageOrderMeta = ['OWNER', 'BOSS', 'COORDINATOR'].includes(effectiveRole);
  const canManageGmail = ['OWNER', 'BOSS', 'COORDINATOR'].includes(effectiveRole);
  const canHandleCustomerQuotes = ['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN'].includes(effectiveRole);
  const gmailState = gmail?.connectionState ?? (
    gmail?.connected ? 'CONNECTED' :
    gmail?.needsReconnect ? 'REAUTH_REQUIRED' :
    gmail?.status ? 'TEMPORARY_ERROR' :
    'NOT_CONNECTED'
  );
  const showGmailOnboarding = Boolean(
    canManageGmail &&
    !gmailChecking &&
    gmail &&
    !gmail.connected &&
    (gmailState === 'NOT_CONNECTED' || gmailState === 'REAUTH_REQUIRED')
  );

  const transferredToServiceCount = useMemo(() => orders.filter(isTransferredToService).length, [orders]);

  const workflowFilters = useMemo(() => [
    {code:'ALL',label:'Wszystkie',count:orders.length},
    {code:'TRANSFERRED_SERVICE',label:'Przekazane do serwisu',count:transferredToServiceCount},
    {code:'ACTION_NOW',label:'Wymaga działania teraz',count:orders.filter((order)=>order.workflow?.flags.includes('ACTION_NOW')).length},
    {code:'DUE_SOON',label:'Kończy się termin',count:orders.filter((order)=>order.workflow?.flags.includes('DUE_SOON')).length},
    {code:'OVERDUE',label:'Po terminie',count:orders.filter((order)=>order.workflow?.flags.includes('OVERDUE')).length},
    {code:'IN_TRANSIT',label:'W drodze',count:orders.filter((order)=>order.workflow?.flags.includes('IN_TRANSIT')).length},
    {code:'WAITING_SERVICE',label:'Czeka na serwis',count:orders.filter((order)=>order.workflow?.flags.includes('WAITING_SERVICE')).length},
    {code:'WAITING_PARTS',label:'Czeka na części',count:orders.filter((order)=>order.workflow?.flags.includes('WAITING_PARTS')).length},
    {code:'READY_FOR_PICKUP',label:'Gotowe do odbioru',count:orders.filter((order)=>order.workflow?.flags.includes('READY_FOR_PICKUP')).length}
  ], [orders,transferredToServiceCount]);

  const visibleOrders = useMemo(() => {
    const filtered = orderFilter === 'ALL'
      ? orders
      : orderFilter === 'TRANSFERRED_SERVICE'
        ? orders.filter(isTransferredToService)
        : orders.filter((order)=>order.workflow?.flags.includes(orderFilter));
    return sortOrdersForList(filtered);
  }, [orders,orderFilter]);
  const renderedOrders=useMemo(()=>visibleOrders.slice(0,ordersVisibleLimit),[visibleOrders,ordersVisibleLimit]);
  useEffect(()=>{setOrdersVisibleLimit(28);},[orderFilter]);

  const brandSuggestions = useMemo(() => {
    const term = form.brand.trim().toLocaleLowerCase('pl-PL');
    if (!term) return PHONE_BRANDS.slice(0, 10);
    const starts = PHONE_BRANDS.filter((brand) => brand.toLocaleLowerCase('pl-PL').startsWith(term));
    const contains = PHONE_BRANDS.filter((brand) => {
      const normalized = brand.toLocaleLowerCase('pl-PL');
      return !normalized.startsWith(term) && normalized.includes(term);
    });
    return [...starts, ...contains].slice(0, 10);
  }, [form.brand]);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const loadOrders = async () => {
    setOrdersBusy(true);
    try {
      const page=await window.lockOn.service.listOrders(40,0);
      setOrders(page);
      setOrdersHasMore(page.length===40);
      setOrdersVisibleLimit(28);
      ordersLoadedRef.current=true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać zleceń.');
    } finally {
      setOrdersBusy(false);
    }
  };

  const loadMoreOrders=async()=>{
    if(ordersPageBusy||!ordersHasMore)return;
    setOrdersPageBusy(true);setError('');
    try{
      const page=await window.lockOn.service.listOrders(40,orders.length);
      setOrders((current)=>{
        const known=new Set(current.map((item)=>item.id));
        return [...current,...page.filter((item)=>!known.has(item.id))];
      });
      setOrdersHasMore(page.length===40);
      setOrdersVisibleLimit((value)=>value+40);
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się pobrać kolejnych zleceń.');}
    finally{setOrdersPageBusy(false);}
  };

  const loadTransfers = async () => {
    try {
      const [points, items] = await Promise.all([
        window.lockOn.service.listServicePoints(),
        window.lockOn.service.listTransfers(false)
      ]);
      setServicePoints(points);
      setTransfers(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać przekazań serwisowych.');
    }
  };

  const loadCustomerQuotes = async (selectedPointId = pointId) => {
    if (!canHandleCustomerQuotes) {
      setCustomerQuotes([]);
      return;
    }
    try {
      const scopedPointId = ['OWNER','BOSS'].includes(effectiveRole) ? undefined : (selectedPointId || undefined);
      setCustomerQuotes(await window.lockOn.service.listCustomerQuotes(scopedPointId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać zapytań klientów o wycenę.');
    }
  };

  const toggleOrderHistory = async (order: ServiceOrderSummary) => {
    if (expandedOrderId === order.id) {
      setExpandedOrderId(null);
      return;
    }

    setExpandedOrderId(order.id);
    setDetailsDrafts((current) => ({
      ...current,
      [order.id]: current[order.id] ?? {
        imei: order.imei ?? '',
        serialNumber: readableSerialNumber(order.serialNumber) ?? '',
        deviceNotes: order.deviceNotes ?? '',
        assignedTechnicianId: order.assignedTechnicianId ?? '',
        estimatedCost: order.estimatedCost == null ? '' : String(order.estimatedCost),
        finalCost: order.finalCost == null ? '' : String(order.finalCost),
        estimatedCompletionAt: toLocalDateInput(order.estimatedCompletionAt)
      }
    }));
    setWarrantyDrafts((current)=>({
      ...current,
      [order.id]: current[order.id] ?? (order.warrantyMonths ? String(order.warrantyMonths) : '')
    }));
    setWarrantyRepairDrafts((current)=>({
      ...current,
      [order.id]: current[order.id] ?? (order.repairSummary || '')
    }));
    setError('');
  };

  const setPanelOpen = (orderId:string, panel:string, open:boolean) => {
    const key = orderId + ':' + panel;
    setOpenPanels((current)=> current[key] === open ? current : {...current,[key]:open});
  };

  const ensureOrderHistory = async (orderId:string) => {
    if (orderHistories[orderId]) return;
    setHistoryBusyId(orderId);
    try {
      const history = await window.lockOn.service.getHistory(orderId);
      setOrderHistories((current)=>({...current,[orderId]:history}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać historii zlecenia.');
    } finally {
      setHistoryBusyId((current)=>current===orderId?null:current);
    }
  };

  const ensureOrderNotes = async (orderId:string) => {
    if (orderNotes[orderId]) return;
    setHistoryBusyId(orderId);
    try {
      const notes = await window.lockOn.service.getNotes(orderId);
      setOrderNotes((current)=>({...current,[orderId]:notes}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać notatek zlecenia.');
    } finally {
      setHistoryBusyId((current)=>current===orderId?null:current);
    }
  };

  const ensureCustomerCard = async (order:ServiceOrderSummary) => {
    if (customerCards[order.customerId]) return;
    setHistoryBusyId(order.id);
    try {
      const card = await window.lockOn.service.getCustomer(order.customerId);
      setCustomerCards((current)=>({...current,[order.customerId]:card}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać historii klienta.');
    } finally {
      setHistoryBusyId((current)=>current===order.id?null:current);
    }
  };

  const ensureTechnicians = async (order:ServiceOrderSummary) => {
    const workPointId = order.currentPointId || order.homePointId || order.pointId;
    if (!canManageOrderMeta || !workPointId || techniciansByPoint[workPointId]) return;
    try {
      const items = await window.lockOn.service.listTechnicians(workPointId);
      setTechniciansByPoint((current)=>({...current,[workPointId]:items}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać listy serwisantów.');
    }
  };

  const ensureServicePoints = async () => {
    if (!canTransferService || servicePoints.length > 0) return;
    try {
      setServicePoints(await window.lockOn.service.listServicePoints());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać punktów serwisowych.');
    }
  };

  const loadGmailStatus = async (selectedPointId = pointId) => {
    if (!selectedPointId || !canManageGmail) {
      setGmail(null);
      return;
    }
    setGmailChecking(true);
    try {
      setGmail(await window.lockOn.gmail.getStatus(selectedPointId));
    } catch (e) {
      setGmail({
        connected:false,
        needsReconnect:false,
        connectionState:'TEMPORARY_ERROR',
        pointId:selectedPointId,
        lastError:e instanceof Error ? e.message : 'Nie udało się teraz sprawdzić połączenia Gmail.'
      });
    } finally {
      setGmailChecking(false);
    }
  };

  const loadMailData = async (selectedPointId = pointId) => {
    if (!selectedPointId || !canManageGmail) {
      setGmail(null);
      setNotificationSettings(null);
      setNotificationHistory([]);
      return;
    }
    setNotificationBusy(true);
    try {
      const [gmailConnection, settings, history] = await Promise.all([
        window.lockOn.gmail.getStatus(selectedPointId),
        window.lockOn.notifications.getSettings(selectedPointId),
        window.lockOn.notifications.getHistory(selectedPointId)
      ]);
      setGmail(gmailConnection);
      setNotificationSettings(settings);
      setNotificationHistory(history);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać ustawień powiadomień.');
    } finally {
      setNotificationBusy(false);
    }
  };

  useEffect(() => {
    if(tab!=='ORDERS'||ordersLoadedRef.current)return;
    void loadOrders();
  }, [tab]);

  useEffect(() => {
    if(!focusOrderId)return;
    if(!ordersLoadedRef.current) void loadOrders();
    setTab('ORDERS');
  }, [focusOrderId]);

  useEffect(() => {
    if (!canHandleCustomerQuotes || tab !== 'QUOTES') return;
    void loadCustomerQuotes(pointId);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadCustomerQuotes(pointId);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [tab, pointId, effectiveRole]);

  useEffect(() => {
    setNotificationSettings(null);
    setNotificationHistory([]);
    void loadGmailStatus(pointId);
  }, [pointId, canManageGmail]);

  useEffect(() => {
    if (tab !== 'ORDERS' || !focusOrderId || expandedOrderId === focusOrderId) return;
    const order = orders.find((item)=>item.id===focusOrderId);
    if (!order) return;
    void toggleOrderHistory(order);
  }, [focusOrderId,orders,tab]);

  useEffect(() => {
    if (!expandedOrderId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedOrderId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedOrderId]);

  const search = async () => {
    const clean = query.trim();
    const requestId = ++searchRequestRef.current;
    if (clean.length < 2) { setMatches([]); setSearchBusy(false); return; }
    setSearchBusy(true);
    setError('');
    try {
      const result = await window.lockOn.service.searchCustomers(clean);
      if (requestId === searchRequestRef.current) setMatches(result);
    } catch (e) {
      if (requestId === searchRequestRef.current) setError(e instanceof Error ? e.message : 'Nie udało się wyszukać klienta.');
    } finally {
      if (requestId === searchRequestRef.current) setSearchBusy(false);
    }
  };

  const useCustomer = (customer: ServiceCustomer) => {
    setForm((current) => ({
      ...current,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email ?? '',
      phone: customer.phone ?? ''
    }));
  };

  const searchComplaintOrders = async () => {
    const clean = complaintQuery.trim();
    if (clean.length < 2) { setComplaintMatches([]); return; }
    setComplaintSearchBusy(true);
    setError('');
    try {
      const found = await window.lockOn.service.searchOrders(clean);
      setComplaintMatches(found.filter((order)=>order.handlingMode!=='TRANSFER_ONLY'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się znaleźć wcześniejszej naprawy.');
    } finally {
      setComplaintSearchBusy(false);
    }
  };

  const useComplaintOrder = (order: ServiceOrderSummary) => {
    const fallbackParts = order.customerName.trim().split(/\s+/);
    const firstName = order.customerFirstName || fallbackParts[0] || '';
    const lastName = order.customerLastName || fallbackParts.slice(1).join(' ') || '';
    const serialNumber = order.serialNumber || (!order.imei ? complaintFallbackSerial(order) : '');
    setComplaintOriginal(order);
    setComplaintMatches([]);
    setMatches([]);
    setQuery('');
    setComplaintQuery('#' + String(order.orderNumber ?? ''));
    setForm((current) => ({
      ...current,
      orderType:'COMPLAINT',
      firstName,
      lastName,
      email:order.customerEmail || '',
      phone:order.customerPhone || '',
      brand:order.brand || '',
      model:order.model || '',
      imei:order.imei || '',
      serialNumber,
      deviceNotes:order.deviceNotes || 'Brak uwag'
    }));
  };

  const submit = async () => {
    if (submitBusyRef.current) return;
    const cleanEmail = form.email.trim();
    const cleanPhone = form.phone.replace(/\D/g, '');
    if (form.orderType === 'COMPLAINT' && !complaintOriginal) {
      setError('Najpierw znajdź i wybierz wcześniejsze zlecenie, którego dotyczy reklamacja.');
      return;
    }
    if (!form.firstName.trim() || !form.lastName.trim() || !form.issueDescription.trim()) {
      setError('Uzupełnij imię, nazwisko i opis usterki. Marka, model oraz uwagi mogą pozostać niepodane.');
      return;
    }
    if (!cleanEmail || !cleanPhone) {
      setError('Podaj adres e-mail i numer telefonu klienta.');
      return;
    }
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Adres e-mail klienta jest nieprawidłowy.');
      return;
    }
    if (form.phone.trim() && cleanPhone.length < 7) {
      setError('Numer telefonu klienta jest zbyt krótki.');
      return;
    }
    const cleanImei = form.imei.replace(/\s/g, '');
    if (cleanImei && !/^\d{14,16}$/.test(cleanImei)) {
      setError('IMEI powinien zawierać 14–16 cyfr.');
      return;
    }

    submitBusyRef.current = true;
    setBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      if (
        form.orderType === 'COMPLAINT' &&
        complaintOriginal &&
        !complaintOriginal.imei &&
        !complaintOriginal.serialNumber
      ) {
        await window.lockOn.service.updateDetails(complaintOriginal.id, {
          imei:'',
          serialNumber:form.serialNumber || complaintFallbackSerial(complaintOriginal),
          deviceNotes:complaintOriginal.deviceNotes || 'Brak uwag'
        });
      }

      const created = await window.lockOn.service.createOrder({
        ...form,
        brand: form.brand.trim(),
        model: form.model.trim(),
        deviceNotes: form.deviceNotes.trim() || 'Brak uwag',
        imei: cleanImei,
        pointId,
        originalOrderId: form.orderType === 'COMPLAINT' ? complaintOriginal?.id : undefined,
        estimatedCost: canSetIntakeEstimate && form.estimatedCost !== '' ? Number(form.estimatedCost) : undefined,
        estimatedCompletionAt: canSetIntakeEta
          ? (form.estimatedCompletionAt ? toApiDateTime(form.estimatedCompletionAt) : null)
          : undefined
      });
      setResult(created);
      if(created.order.orderNumber != null){
        let preferences = {serviceUpdates:true,readyForPickup:true,quoteUpdates:true,messages:true};
        try{
          preferences = await window.lockOn.customers.getNotificationPreferences(created.customer.id);
        }catch{
          // Nowe konto klienta ma domyślnie wszystkie powiadomienia włączone.
        }
        setNotificationChoice({
          customerId:created.customer.id,
          orderId:created.order.id,
          orderNumber:created.order.orderNumber,
          ...preferences
        });
      }
      if (created.reusedDevice) {
        setNotice('Zlecenie utworzone. Rozpoznano istniejące urządzenie klienta i użyto jego karty.');
      }
      if (created.notification?.sent) {
        setNotice('Zlecenie utworzone. Potwierdzenie przyjęcia urządzenia zostało wysłane do klienta.');
      } else if (created.notification?.queued) {
        setNotice('Zlecenie utworzone. Potwierdzenie e-mail trafiło do kolejki i zostanie ponowione automatycznie w razie błędu.');
      } else if (created.notification?.reason === 'NO_CUSTOMER_EMAIL') {
        setNotice('Zlecenie utworzone. Klient nie ma adresu e-mail, więc potwierdzenie nie zostało wysłane.');
      } else if (created.notification?.reason === 'NO_SENDER') {
        setNotice('Zlecenie utworzone, ale nie znaleziono aktywnego firmowego nadawcy Gmail.');
      }
      setForm(makeEmptyForm());
      setMatches([]);
      setQuery('');
      setComplaintQuery('');
      setComplaintMatches([]);
      setComplaintOriginal(null);
      setIntakeStage('TYPE');
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się utworzyć zlecenia.');
    } finally { submitBusyRef.current = false; setBusy(false); }
  };

  const saveCustomerNotificationChoice = async () => {
    if(!notificationChoice||notificationChoiceBusy)return;
    setNotificationChoiceBusy(true);setError('');
    try{
      await window.lockOn.customers.updateNotificationPreferences(notificationChoice.customerId,{
        serviceUpdates:notificationChoice.serviceUpdates,
        readyForPickup:notificationChoice.readyForPickup,
        quoteUpdates:notificationChoice.quoteUpdates,
        messages:notificationChoice.messages
      });
      const nextCard={orderId:notificationChoice.orderId,orderNumber:notificationChoice.orderNumber};
      setNotificationChoice(null);
      setNotice(notificationChoice.serviceUpdates||notificationChoice.readyForPickup
        ? 'Preferencje powiadomień klienta zapisane.'
        : 'Klient wybrał brak dodatkowych e-maili o przebiegu serwisu.');
      setCardChoice(nextCard);
    }catch(e){
      setError(e instanceof Error?e.message:'Nie udało się zapisać preferencji powiadomień klienta.');
    }finally{setNotificationChoiceBusy(false);}
  };

  const openCreatedServiceCard = async (printMode:'PHYSICAL_AND_ONLINE'|'ONLINE_ONLY') => {
    if(!cardChoice||cardBusy)return;
    setCardBusy(true);setError('');
    try{
      await window.lockOn.service.openServiceCard(cardChoice.orderId,printMode);
      setNotice(printMode==='PHYSICAL_AND_ONLINE'
        ? 'Otworzono kartę A4: część do urządzenia + część dla klienta. Dokument klienta został także wysłany e-mailem.'
        : 'Otworzono kartę do urządzenia. Dokument klienta został wysłany e-mailem i pozostaje w jego panelu.');
      setCardChoice(null);
    }catch(e){
      setError(e instanceof Error?e.message:'Nie udało się otworzyć karty serwisowej.');
    }finally{setCardBusy(false);}
  };

  const reopenServiceCard = async (order:ServiceOrderSummary,printMode:'PHYSICAL_AND_ONLINE'|'ONLINE_ONLY') => {
    if(serviceCardBusyId)return;
    setServiceCardBusyId(order.id);setError('');setNotice('');
    try{
      await window.lockOn.service.openServiceCard(order.id,printMode);
      setNotice(printMode==='PHYSICAL_AND_ONLINE'
        ? 'Otworzono pełną kartę A4 z linią cięcia.'
        : 'Otworzono kartę do urządzenia.');
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się otworzyć karty serwisowej.');}
    finally{setServiceCardBusyId(null);}
  };

  const saveWarranty = async (order: ServiceOrderSummary) => {
    if(warrantyBusyId)return;
    const months=Number(warrantyDrafts[order.id]||0);
    if(!Number.isInteger(months)||months<1||months>60){
      setError('Podaj okres gwarancji od 1 do 60 miesięcy.');
      return;
    }
    const repairSummary=(warrantyRepairDrafts[order.id]||'').trim();
    if(!repairSummary){
      setError('Opisz wykonaną naprawę przed zapisaniem gwarancji.');
      return;
    }
    setWarrantyBusyId(order.id);setError('');setNotice('');
    try{
      const result=await window.lockOn.service.updateWarranty(order.id,{months,repairSummary});
      if(result.order)setOrders((current)=>current.map((item)=>item.id===order.id?result.order!:item));
      setWarrantyDrafts((current)=>({...current,[order.id]:String(months)}));
      setNotice(result.warranty.cardPrintedAt
        ? `Gwarancja ${months} mies. została zapisana.`
        : `Gwarancja ${months} mies. została zapisana. Teraz wydrukuj kartę gwarancyjną.`);
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się zapisać gwarancji.');}
    finally{setWarrantyBusyId(null);}
  };

  const openWarrantyCard = async (order: ServiceOrderSummary) => {
    if(warrantyBusyId)return;
    setWarrantyBusyId(order.id);setError('');setNotice('');
    try{
      const result=await window.lockOn.service.openWarrantyCard(order.id);
      if(result.order)setOrders((current)=>current.map((item)=>item.id===order.id?result.order!:item));
      setNotice('Karta gwarancyjna została przygotowana i oznaczona jako wydrukowana. Dołącz ją do urządzenia.');
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się przygotować karty gwarancyjnej.');}
    finally{setWarrantyBusyId(null);}
  };

  const changeStatus = async (order: ServiceOrderSummary, status: string) => {
    if (orderBusyId || status === order.status) return;
    if(status==='READY'&&!order.warrantyReady){
      setError('Przed statusem „Gotowe do odbioru” ustaw gwarancję i wydrukuj kartę gwarancyjną.');
      return;
    }
    if (status === 'CANCELLED' && !await confirm({
      title:`Anulować zlecenie #${order.orderNumber}?`,
      message:'Zlecenie zostanie oznaczone jako anulowane.',
      detail:'Tej operacji używaj tylko wtedy, gdy zlecenie faktycznie ma zostać anulowane — nie zamiast zwykłego etapu naprawy.',
      confirmLabel:'Anuluj zlecenie',tone:'danger'
    })) return;
    if (status === 'COMPLETED' && !await confirm({
      title:`Zakończyć zlecenie #${order.orderNumber}?`,
      message:'ServiceOS zamknie obsługę tego urządzenia.',
      detail:'Rozliczenie zostanie zapisane na podstawie kosztu końcowego. Upewnij się, że urządzenie zostało wydane klientowi.',
      confirmLabel:'Zakończ zlecenie'
    })) return;
    setOrderBusyId(order.id);
    setError('');
    setNotice('');
    try {
      const updated = await window.lockOn.service.updateStatus(order.id, status, undefined, pointId);
      setOrders((current) => current.map((item) => item.id === order.id ? updated.order : item));
      if (orderHistories[order.id]) {
        const history = await window.lockOn.service.getHistory(order.id);
        setOrderHistories((current) => ({ ...current, [order.id]: history }));
      }
      const n = updated.notification;
      const settlementText = updated.settlement
        ? ` Rozliczenie ${updated.settlement.amount.toFixed(2)} ${updated.settlement.currency} zostało dodane automatycznie bez weryfikacji.`
        : '';
      if (n.sent) {
        setNotice('Status zapisany. Wiadomość e-mail została wysłana do klienta.' + settlementText);
      } else if (n.queued) {
        setNotice((n.nextAttemptAt
          ? 'Status zapisany. Wysyłka nie powiodła się i została zaplanowana do ponowienia.'
          : 'Status zapisany. Wiadomość czeka w kolejce.') + settlementText);
      } else if (n.reason === 'AUTOMATIC_EMAIL_DISABLED') {
        setNotice('Status zapisany. Automatyczne wiadomości dla tego punktu są wyłączone.');
      } else if (n.reason === 'STATUS_NOT_ENABLED') {
        setNotice('Status zapisany. Dla tego statusu powiadomienia e-mail są wyłączone.');
      } else if (n.reason === 'NO_CUSTOMER_EMAIL') {
        setNotice('Status zapisany. Klient nie ma adresu e-mail.' + settlementText);
      } else if (n.reason === 'NO_SENDER') {
        setNotice('Status zapisany, ale nie znaleziono aktywnego firmowego nadawcy Gmail.' + settlementText);
      } else {
        setNotice('Status zapisany.' + settlementText);
      }
      if (canManageGmail) void loadMailData(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zmienić statusu.');
      await loadOrders();
    } finally {
      setOrderBusyId(null);
    }
  };

  const saveOrderDetails = async (order: ServiceOrderSummary) => {
    if (orderBusyId) return;
    const draft = detailsDrafts[order.id];
    if (!draft) return;
    const cleanImei = draft.imei.replace(/\s/g, '');
    if (cleanImei && !/^\d{14,16}$/.test(cleanImei)) {
      setError('IMEI powinien zawierać 14–16 cyfr.');
      return;
    }
    setOrderBusyId(order.id); setError(''); setNotice('');
    try {
      const updated = await window.lockOn.service.updateDetails(order.id, {
        imei: cleanImei,
        serialNumber: draft.serialNumber,
        deviceNotes: draft.deviceNotes,
        estimatedCompletionAt: order.handlingMode === 'TRANSFER_ONLY'
          ? null
          : (draft.estimatedCompletionAt ? toApiDateTime(draft.estimatedCompletionAt) : null),
        ...(order.handlingMode !== 'TRANSFER_ONLY' && canManageOrderMeta ? {
          assignedTechnicianId: draft.assignedTechnicianId || null
        } : {}),
        ...(order.handlingMode !== 'TRANSFER_ONLY' && canEditCosts ? {
          estimatedCost: draft.estimatedCost === '' ? null : Number(draft.estimatedCost),
          finalCost: draft.finalCost === '' ? null : Number(draft.finalCost)
        } : {})
      });
      setOrders((current) => current.map((item) => item.id === order.id ? updated : item));
      setDetailsDrafts((current) => ({
        ...current,
        [order.id]: {
          imei: updated.imei ?? '',
          serialNumber: updated.serialNumber ?? '',
          deviceNotes: updated.deviceNotes ?? '',
          assignedTechnicianId: updated.assignedTechnicianId ?? '',
          estimatedCost: updated.estimatedCost == null ? '' : String(updated.estimatedCost),
          finalCost: updated.finalCost == null ? '' : String(updated.finalCost),
          estimatedCompletionAt: toLocalDateInput(updated.estimatedCompletionAt)
        }
      }));
      if (customerCards[order.customerId]) {
        const card = await window.lockOn.service.getCustomer(order.customerId);
        setCustomerCards((current) => ({ ...current, [order.customerId]: card }));
      }
      setNotice('Szczegóły zlecenia zostały zapisane.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać szczegółów zlecenia.');
    } finally {
      setOrderBusyId(null);
    }
  };

  const addOrderNote = async (orderId: string) => {
    if (orderBusyId) return;
    const body = (noteDrafts[orderId] ?? '').trim();
    if (!body) return;
    setOrderBusyId(orderId); setError(''); setNotice('');
    try {
      const note = await window.lockOn.service.addNote(orderId, body);
      setOrderNotes((current) => ({ ...current, [orderId]: [note, ...(current[orderId] ?? [])] }));
      setNoteDrafts((current) => ({ ...current, [orderId]: '' }));
      setNotice('Notatka została dodana do zlecenia.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się dodać notatki.');
    } finally {
      setOrderBusyId(null);
    }
  };

  const sendTransfer = async (order: ServiceOrderSummary) => {
    if (orderBusyId) return;
    const draft = transferDrafts[order.id] ?? {toPointId:'',note:''};
    if (!draft.toPointId) { setError('Wybierz docelowy punkt serwisowy.'); return; }
    const destination=servicePoints.find((point)=>point.id===draft.toPointId);
    if (!await confirm({
      title:'Przekazać urządzenie do serwisu?',
      message:`Zlecenie #${order.orderNumber} → ${destination?.name || 'wybrany punkt'}`,
      detail:'Po potwierdzeniu rozpocznie się proces logistyczny, a klient może otrzymać automatyczną wiadomość.',
      confirmLabel:'Rozpocznij przekazanie'
    })) return;
    setOrderBusyId(order.id); setError(''); setNotice('');
    try {
      const currentPointId = order.currentPointId || order.homePointId || order.pointId;
      const homePointId = order.homePointId || order.pointId;
      const kind = order.handlingMode === 'TRANSFER_ONLY' && currentPointId !== homePointId && draft.toPointId === homePointId
        ? 'RETURN_HOME'
        : 'OUTBOUND_SERVICE';
      const result = await window.lockOn.service.transferOrder(order.id, {...draft,kind});
      setNotice(result.notification?.sent
        ? 'Zlecenie wysłano do serwisu i klient otrzymał wiadomość.'
        : 'Zlecenie wysłano do serwisu.');
      setTransferDrafts((current)=>({...current,[order.id]:{toPointId:'',note:''}}));
      await Promise.all([loadOrders(),loadTransfers()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się wysłać zlecenia.');
    } finally { setOrderBusyId(null); }
  };

  const sendReturnHome = async (order: ServiceOrderSummary) => {
    if (orderBusyId) return;
    const draft = transferDrafts[order.id] ?? {toPointId:'',note:''};
    if (!await confirm({
      title:'Odesłać urządzenie do punktu macierzystego?',
      message:`Zlecenie #${order.orderNumber}`,
      detail:'ServiceOS rozpocznie przekazanie zwrotne i zaktualizuje lokalizację urządzenia zgodnie z kolejnymi potwierdzeniami.',
      confirmLabel:'Rozpocznij powrót'
    })) return;
    setOrderBusyId(order.id); setError(''); setNotice('');
    try {
      const result = await window.lockOn.service.transferOrder(order.id, {
        kind:'RETURN_HOME',
        toPointId:order.homePointId || order.pointId,
        note:draft.note
      });
      setNotice(result.notification?.sent
        ? 'Urządzenie odesłano do punktu macierzystego. Klient otrzymał wiadomość e-mail.'
        : 'Urządzenie odesłano do punktu macierzystego.');
      setTransferDrafts((current)=>({...current,[order.id]:{toPointId:'',note:''}}));
      await Promise.all([loadOrders(),loadTransfers()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się rozpocząć zwrotu do punktu macierzystego.');
    } finally { setOrderBusyId(null); }
  };

  const changeTransferStatus = async (transfer: ServiceTransfer, status: ServiceTransfer['status']) => {
    if (orderBusyId) return;
    if (status === 'CANCELLED' && !await confirm({
      title:'Anulować przekazanie?',
      message:`Zlecenie #${transfer.orderNumber}`,
      detail:'Urządzenie wróci logicznie do punktu źródłowego. Potwierdź tylko, jeśli transport faktycznie został anulowany.',
      confirmLabel:'Anuluj przekazanie',tone:'danger'
    })) return;
    if (status === 'REJECTED' && !await confirm({
      title:'Odrzucić przekazanie?',
      message:`Zlecenie #${transfer.orderNumber}`,
      detail:'Potwierdź tylko, jeśli punkt docelowy faktycznie odmawia przyjęcia urządzenia.',
      confirmLabel:'Odrzuć przekazanie',tone:'danger'
    })) return;
    setOrderBusyId(transfer.id); setError(''); setNotice('');
    try {
      const result = await window.lockOn.service.updateTransferStatus(transfer.id,status);
      setNotice(result.notification?.sent
        ? 'Etap przekazania zapisany. Klient otrzymał wiadomość e-mail.'
        : 'Etap przekazania został zapisany.');
      await Promise.all([loadOrders(),loadTransfers()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zmienić etapu przekazania.');
    } finally { setOrderBusyId(null); }
  };

  const quoteStatusLabel = (status: CustomerQuoteRequest['status']) => ({
    OPEN:'Oczekuje na odpowiedź',
    QUOTED:'Wycena wysłana',
    CLOSED:'Zamknięte',
    CANCELLED:'Anulowane'
  }[status]);

  const replyCustomerQuote = async (requestId: string) => {
    if (quoteBusyId) return;
    const message=(quoteReplyDrafts[requestId] || '').trim();
    if (!message) {
      setError('Wpisz wiadomość dla klienta.');
      return;
    }
    setQuoteBusyId(requestId); setError(''); setNotice('');
    try {
      await window.lockOn.service.replyCustomerQuote(requestId,message);
      setQuoteReplyDrafts((current)=>({...current,[requestId]:''}));
      setNotice('Odpowiedź została zapisana w portalu klienta.');
      await loadCustomerQuotes(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się wysłać odpowiedzi.');
    } finally { setQuoteBusyId(null); }
  };

  const priceCustomerQuote = async (requestId: string) => {
    if (quoteBusyId) return;
    const amount=Number(quoteAmountDrafts[requestId] ?? customerQuotes.find((item)=>item.id===requestId)?.quoteAmount ?? '');
    const note=(quoteNoteDrafts[requestId] || '').trim();
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Podaj prawidłową kwotę wyceny.');
      return;
    }
    setQuoteBusyId(requestId); setError(''); setNotice('');
    try {
      await window.lockOn.service.priceCustomerQuote(requestId,amount,note);
      setNotice('Wycena została przekazana klientowi i jest widoczna w jego portalu.');
      await loadCustomerQuotes(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać wyceny.');
    } finally { setQuoteBusyId(null); }
  };

  const closeCustomerQuote = async (requestId: string) => {
    if (quoteBusyId) return;
    if (!await confirm({
      title:'Zamknąć rozmowę o wycenie?',
      message:'Klient nie będzie mógł kontynuować tego wątku.',
      detail:'Historia rozmowy i przygotowana wycena pozostaną zapisane.',
      confirmLabel:'Zamknij rozmowę',tone:'warning'
    })) return;
    setQuoteBusyId(requestId); setError(''); setNotice('');
    try {
      await window.lockOn.service.closeCustomerQuote(requestId);
      setNotice('Zapytanie klienta zostało zamknięte.');
      await loadCustomerQuotes(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zamknąć zapytania.');
    } finally { setQuoteBusyId(null); }
  };

  const connectGmail = async () => {
    if (!pointId) return;
    setGmailBusy(true); setError(''); setNotice('');
    try {
      const status = await window.lockOn.gmail.connect(pointId);
      setGmail(status);
      setNotice(status.recoveredNotifications
        ? 'Gmail został połączony. ServiceOS odblokował ' + status.recoveredNotifications + ' wcześniejsze wiadomości i rozpoczął ich ponowną wysyłkę.'
        : 'Gmail został bezpiecznie połączony z tym punktem.');
      await loadMailData(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się połączyć Gmail.');
    } finally { setGmailBusy(false); }
  };

  const disconnectGmail = async () => {
    if (!pointId || gmailBusy) return;
    if (!await confirm({
      title:'Odłączyć Gmail od punktu?',
      message:'Automatyczne wiadomości przestaną być wysyłane.',
      detail:'Wysyłkę można przywrócić przez ponowne połączenie konta Google.',
      confirmLabel:'Odłącz Gmail',tone:'warning'
    })) return;
    setGmailBusy(true); setError(''); setNotice('');
    try {
      await window.lockOn.gmail.disconnect(pointId);
      setGmail({ connected: false, pointId });
      setNotice('Gmail został odłączony od punktu.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się odłączyć Gmail.');
    } finally { setGmailBusy(false); }
  };

  const testGmail = async () => {
    if (!pointId) return;
    setGmailBusy(true); setError(''); setNotice('');
    try {
      const test = await window.lockOn.gmail.test(pointId);
      setNotice('Test wysłany na ' + test.recipient + '. Gmail zwrócił poprawny identyfikator wiadomości.');
      await loadMailData(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test Gmail nie powiódł się.');
    } finally { setGmailBusy(false); }
  };

  const saveNotificationSettings = async () => {
    if (!pointId || !notificationSettings) return;
    setNotificationBusy(true); setError(''); setNotice('');
    try {
      const saved = await window.lockOn.notifications.updateSettings({
        pointId,
        automaticEmailEnabled: notificationSettings.automaticEmailEnabled,
        notifyStatuses: notificationSettings.notifyStatuses,
        senderDisplayName: notificationSettings.senderDisplayName,
        footerText: notificationSettings.footerText
      });
      setNotificationSettings(saved);
      setNotice('Ustawienia automatycznych powiadomień zostały zapisane.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać ustawień powiadomień.');
    } finally { setNotificationBusy(false); }
  };

  const toggleNotifyStatus = (status: string) => {
    setNotificationSettings((current) => {
      if (!current) return current;
      const enabled = current.notifyStatuses.includes(status);
      return {
        ...current,
        notifyStatuses: enabled
          ? current.notifyStatuses.filter((item) => item !== status)
          : [...current.notifyStatuses, status]
      };
    });
  };

  const switchServiceTab = (next:ServiceTab) => {
    setExpandedOrderId(null);
    setHistoryBusyId(null);
    setBrandOpen(false);
    setError('');
    setTab(next);
  };

  const openOrderFromWorkspace = (order: ServiceOrderSummary) => {
    if (tab !== 'ORDERS') setTab('ORDERS');
    if (expandedOrderId !== order.id) void toggleOrderHistory(order);
  };

  const retryNotification = async (id: string) => {
    setNotificationBusy(true); setError(''); setNotice('');
    try {
      const result = await window.lockOn.notifications.retry(id);
      setNotice(result.sent ? 'Wiadomość została wysłana ponownie.' : 'Ponowienie zapisane. Następna próba została zaplanowana.');
      await loadMailData(pointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się ponowić wiadomości.');
    } finally { setNotificationBusy(false); }
  };

  return (
    <div className="service-page page-enter">
      <section className="service-heading">
        <div>
          <div className="eyebrow"><ClipboardPlus size={13}/> SERWIS</div>
          <h1>Klienci i naprawy</h1>
          <p>Przyjęcie telefonu, reklamacje, statusy oraz centralne powiadomienia klienta.</p>
        </div>
        <div className="service-tabs">
          {isActualTechnician && <button className={tab === 'CALENDAR' ? 'active' : ''} onClick={() => switchServiceTab('CALENDAR')}><CalendarDays size={15}/> Plan pracy</button>}
          <button className={tab === 'NEW' ? 'active' : ''} onClick={() => { setIntakeStage('TYPE'); switchServiceTab('NEW'); }}><ClipboardPlus size={15}/> Nowe zlecenie</button>
          <button className={tab === 'ORDERS' ? 'active' : ''} onClick={() => switchServiceTab('ORDERS')}><ClipboardList size={15}/> Zlecenia{transferredToServiceCount>0&&<b className="service-tab-count" title="Telefony przekazane do serwisu">{transferredToServiceCount}</b>}</button>
          <button className={tab === 'TRANSFERS' ? 'active' : ''} onClick={() => {switchServiceTab('TRANSFERS');void loadTransfers();}}><Truck size={15}/> Przekazania</button>
          {canHandleCustomerQuotes && <button className={tab === 'QUOTES' ? 'active' : ''} onClick={() => {switchServiceTab('QUOTES');void loadCustomerQuotes(pointId);}}><MessageSquareText size={15}/> Wyceny klientów{customerQuotes.filter((item)=>item.status==='OPEN').length > 0 && <b className="service-tab-count">{customerQuotes.filter((item)=>item.status==='OPEN').length}</b>}</button>}
          {canEditCosts && <button className={tab === 'INVOICES' ? 'active' : ''} onClick={() => switchServiceTab('INVOICES')}><FileArchive size={15}/> Magazyn faktur</button>}
          {isActualTechnician && <button className={tab === 'TECH_NOTES' ? 'active' : ''} onClick={() => switchServiceTab('TECH_NOTES')}><NotebookPen size={15}/> Moje notatki</button>}
          {canManageGmail && <button className={tab === 'EMAILS' ? 'active' : ''} onClick={() => { switchServiceTab('EMAILS'); void loadMailData(pointId); }}><BellRing size={15}/> Powiadomienia</button>}
        </div>
      </section>

      {notificationChoice && <div className="service-card-choice-backdrop service-notification-choice-backdrop" role="presentation">
        <section className="service-notification-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="service-notification-choice-title">
          <div className="service-notification-choice-head">
            <div className="service-card-choice-icon"><BellRing size={24}/></div>
            <div><span>ZLECENIE #{notificationChoice.orderNumber}</span><h2 id="service-notification-choice-title">Jak klient chce dostawać informacje?</h2><p>Potwierdzenie przyjęcia z kartą PDF wysyłamy zawsze. Poniżej wybierasz dodatkowe wiadomości podczas dalszej obsługi.</p></div>
          </div>
          <div className="service-notification-presets">
            <button type="button" onClick={()=>setNotificationChoice((current)=>current?{...current,serviceUpdates:true,readyForPickup:true}:current)}>
              <MailCheck size={18}/><span><strong>Wszystkie aktualizacje</strong><small>Statusy naprawy + gotowe do odbioru.</small></span>
            </button>
            <button type="button" onClick={()=>setNotificationChoice((current)=>current?{...current,serviceUpdates:false,readyForPickup:true}:current)}>
              <PackageCheck size={18}/><span><strong>Tylko gotowe do odbioru</strong><small>Bez wiadomości z każdego etapu.</small></span>
            </button>
            <button type="button" onClick={()=>setNotificationChoice((current)=>current?{...current,serviceUpdates:false,readyForPickup:false}:current)}>
              <BellRing size={18}/><span><strong>Bez dodatkowych e-maili</strong><small>Tylko obowiązkowe potwierdzenie przyjęcia.</small></span>
            </button>
          </div>
          <div className="service-notification-toggles">
            <label><input type="checkbox" checked={notificationChoice.serviceUpdates} onChange={(e)=>setNotificationChoice((current)=>current?{...current,serviceUpdates:e.target.checked}:current)}/><span><strong>Postęp naprawy</strong><small>Diagnoza, części, naprawa i zmiany etapu.</small></span></label>
            <label><input type="checkbox" checked={notificationChoice.readyForPickup} onChange={(e)=>setNotificationChoice((current)=>current?{...current,readyForPickup:e.target.checked}:current)}/><span><strong>Gotowe do odbioru</strong><small>Osobna wiadomość, gdy urządzenie czeka w punkcie.</small></span></label>
          </div>
          {error&&<div className="service-notification-choice-error">{error}</div>}
          <div className="service-notification-choice-actions">
            <small>Ustawienie zapisuje się na koncie klienta i może zostać później zmienione w jego portalu.</small>
            <button type="button" className="button primary" disabled={notificationChoiceBusy} onClick={()=>void saveCustomerNotificationChoice()}>{notificationChoiceBusy?'Zapisywanie…':'Zapisz wybór i przejdź dalej'}</button>
          </div>
        </section>
      </div>}

      {cardChoice && <div className="service-card-choice-backdrop" role="presentation">
        <section className="service-card-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="service-card-choice-title">
          <div className="service-card-choice-icon"><Printer size={24}/></div>
          <span>KARTA SERWISOWA · ZLECENIE #{cardChoice.orderNumber}</span>
          <h2 id="service-card-choice-title">Przygotuj kartę dla klienta</h2>
          <p>Wybierz sposób przekazania dokumentów. Karta klienta jest również dostępna w jego panelu i może zostać wysłana e-mailem.</p>
          <div className="service-card-choice-options">
            <button disabled={cardBusy} onClick={()=>void openCreatedServiceCard('PHYSICAL_AND_ONLINE')}>
              <Printer size={20}/>
              <strong>Wydruk przy ladzie</strong>
              <span>A4 z kartą urządzenia i kartą klienta. Gotowe do przecięcia i wydania razem ze sprzętem.</span>
            </button>
            <button disabled={cardBusy} onClick={()=>void openCreatedServiceCard('ONLINE_ONLY')}>
              <Smartphone size={20}/>
              <strong>Karta online</strong>
              <span>Drukowana jest karta urządzenia, a klient korzysta z PDF, kodu i panelu WWW.</span>
            </button>
          </div>
          {cardBusy && <small>Generuję zabezpieczony PDF…</small>}
        </section>
      </div>}

      {expandedOrderId && (() => {
        const order = orders.find((item)=>item.id===expandedOrderId);
        if (!order) return null;
        const draft = detailsDrafts[order.id];
        const card = customerCards[order.customerId];
        const notes = orderNotes[order.id] ?? [];
        const currentServicePointId = order.openTransfer ? '' : (order.currentPointId || order.homePointId || order.pointId);
        const pointTechnicians = currentServicePointId ? (techniciansByPoint[currentServicePointId] ?? []) : [];
        const operatingPointId = auth.point?.id ?? '';
        const canOperateCurrentPoint = Boolean(currentServicePointId) && operatingPointId === currentServicePointId && (['OWNER','BOSS'].includes(effectiveRole) || pointAccessSet.has(currentServicePointId));
        const canEditOrderHere = canEditStatus && canOperateCurrentPoint && !order.openTransfer;
        const canCompletePickupHere = effectiveRole === 'USER' && order.status === 'READY' && canOperateCurrentPoint && !order.openTransfer;
        const canEditIntakeHere = canEditIntake && canOperateCurrentPoint && !order.openTransfer;
        const canTransferHere = canTransferService && canOperateCurrentPoint && !order.openTransfer;
        const canUseOrderFinance = canEditCosts && (!isActualTechnician || order.assignedTechnicianId === auth.user?.id);
        const physicalPointId = order.currentPointId || order.homePointId || order.pointId;
        const canManageWarrantyHere = canEditOrderHere && Boolean(operatingPointId) && physicalPointId === operatingPointId;
        const canShowWarranty = order.handlingMode!=='TRANSFER_ONLY' && (
          order.status==='REPAIR_DONE' ||
          order.status==='READY' ||
          order.status==='COMPLETED' ||
          Boolean(order.warrantyMonths)
        );
        const canActTransferDestination = Boolean(order.openTransfer) && operatingPointId === order.openTransfer?.toPointId && (['OWNER','BOSS'].includes(effectiveRole) || pointAccessSet.has(operatingPointId));
        const canActTransferSource = Boolean(order.openTransfer) && operatingPointId === order.openTransfer?.fromPointId && (['OWNER','BOSS'].includes(effectiveRole) || pointAccessSet.has(operatingPointId));
        const primaryStageAction = order.handlingMode==='TRANSFER_ONLY' ? undefined : ({
          RECEIVED:{status:'DIAGNOSIS',label:'Rozpocznij diagnozę'},
          DIAGNOSIS:{status:'IN_REPAIR',label:'Rozpocznij naprawę'},
          WAITING_PARTS:{status:'IN_REPAIR',label:'Części są — rozpocznij naprawę'},
          IN_REPAIR:{status:'REPAIR_DONE',label:'Zakończ naprawę'},
          REPAIR_DONE:{status:'READY',label:'Gotowe do odbioru'},
          READY:{status:'COMPLETED',label:'Wydaj telefon klientowi'}
        } as Record<string,{status:string;label:string}>)[order.status];
        const primaryStageBlocked = primaryStageAction?.status==='READY' && (order.canMarkReady===false || !order.warrantyReady);
        const stageSteps=['Przyjęto','Diagnoza','Części','Naprawa','Zakończono','Gotowe','Wydano'];
        const stageIndex=({RECEIVED:0,DIAGNOSIS:1,WAITING_PARTS:2,IN_REPAIR:3,REPAIR_DONE:4,READY:5,COMPLETED:6} as Record<string,number>)[order.status] ?? 0;
        return <div className="service-order-details-page">
          <section className="service-order-details-dialog service-order-details-inline" aria-label={`Szczegóły zlecenia #${order.orderNumber}`}>
            <header className="service-order-details-header">
              <div>
                <span>ZLECENIE #{order.orderNumber}</span>
                <h2>{order.customerName} · {formatDeviceLabel(order.brand,order.model)}</h2>
                <small>{order.statusLabel} · {order.currentLocationLabel || order.currentPointName || order.pointName}</small>
              </div>
              <button className="button secondary small service-order-details-back" title="Wróć do listy" onClick={()=>setExpandedOrderId(null)}>← Wróć do zleceń</button>
            </header>
            <div className={`service-order-workspace ${effectiveRole==='USER'?'service-order-workspace-frontdesk':''}`}>
                      <section className="service-order-keyfacts">
                        <article><span>Klient</span><strong>{order.customerName}</strong><small>{order.customerPhone || order.customerEmail || 'Brak kontaktu'}</small></article>
                        <article><span>Telefon</span><strong>{formatDeviceLabel(order.brand,order.model)}</strong><small>{order.imei ? 'IMEI ' + order.imei : readableSerialNumber(order.serialNumber) ? 'S/N ' + readableSerialNumber(order.serialNumber) : 'Brak IMEI / S/N'}</small></article>
                        <article><span>Zgłoszenie</span><strong>{order.issueDescription}</strong><small>{order.assignedTechnicianName ? 'Serwisant: ' + order.assignedTechnicianName : 'Serwisant jeszcze nieprzypisany'}</small></article>
                        <article><span>Termin</span><strong>{order.estimatedCompletionAt ? new Date(order.estimatedCompletionAt).toLocaleDateString('pl-PL') : 'Nie podano'}</strong><small>{order.repairSummary || 'Opis wykonanej naprawy pojawi się po zakończeniu.'}</small></article>
                      </section>

                      {effectiveRole === 'USER' && <section className="service-frontdesk-card">
                        <div><PackageCheck size={18}/><span><strong>Obsługa klienta przy ladzie</strong><small>{order.status === 'READY' ? 'Telefon jest gotowy. Sprawdź dane klienta i wykonaj krok wydania poniżej.' : 'Tu zobaczysz tylko informacje potrzebne do rozmowy z klientem.'}</small></span></div>
                        <div className="service-frontdesk-meta"><span>{order.statusLabel}</span><span>{order.currentLocationLabel || order.currentPointName || order.pointName}</span>{order.warrantyExpiresAt&&<span>Gwarancja do {new Date(order.warrantyExpiresAt).toLocaleDateString('pl-PL')}</span>}</div>
                      </section>}

                      <section className="service-workspace-card service-stage-card service-stage-guided">
                        <div className="service-process-heading">
                          <div className="service-process-step"><span>KROK {Math.min(stageIndex+1,stageSteps.length)} Z {stageSteps.length}</span><strong>{order.workflow?.nextAction || 'Sprawdź zlecenie.'}</strong></div>
                          <div className="service-process-location"><MapPin size={14}/><span>{order.currentLocationLabel || order.currentPointName || order.pointName}</span></div>
                        </div>
                        <div className="service-stage-overview">
                          <div className="service-stage-progress"><span style={{width:`${order.workflow?.progressPercent ?? 10}%`}}/></div>
                          <div className="service-repair-stage-rail service-repair-stage-rail-compact">
                            {stageSteps.map((label,index)=><span key={label} className={index<stageIndex?'done':index===stageIndex?'current':index===stageIndex+1?'next':''}>{label}</span>)}
                          </div>
                        </div>

                        {order.openTransfer && <div className="service-process-logistics">
                          <div><Truck size={18}/><span><strong>{order.openTransfer.kind==='RETURN_HOME'?'Telefon wraca do punktu macierzystego':'Telefon jest w przekazaniu'}</strong><small>{order.openTransfer.fromPointName} → {order.openTransfer.toPointName}</small></span></div>
                          <div className="service-stage-actions">
                            {order.openTransfer.status==='IN_TRANSIT'&&canActTransferDestination&&<button className="button primary service-stage-primary" disabled={Boolean(orderBusyId)} onClick={()=>void changeTransferStatus(order.openTransfer!,'DELIVERED')}>Telefon dotarł do punktu</button>}
                            {order.openTransfer.status==='DELIVERED'&&canActTransferDestination&&<button className="button primary service-stage-primary" disabled={Boolean(orderBusyId)} onClick={()=>void changeTransferStatus(order.openTransfer!,'ACCEPTED')}><PackageCheck size={14}/> Przyjmij telefon w punkcie</button>}
                            {order.openTransfer.status==='IN_TRANSIT'&&canActTransferSource&&<button className="button secondary" disabled={Boolean(orderBusyId)} onClick={()=>void changeTransferStatus(order.openTransfer!,'CANCELLED')}>Anuluj wysyłkę</button>}
                            {!canActTransferDestination&&!canActTransferSource&&<small>Akcję potwierdza punkt, w którym telefon fizycznie się znajduje lub do którego właśnie dotarł.</small>}
                          </div>
                        </div>}

                        {!order.openTransfer&&order.handlingMode==='TRANSFER_ONLY'&&canTransferHere&&<div className="service-process-logistics">
                          <div><Truck size={18}/><span><strong>Wybierz, dokąd wysłać telefon</strong><small>Po kliknięciu ServiceOS ustawi telefon jako „w drodze”.</small></span></div>
                          <div className="transfer-compose">
                            <select value={(transferDrafts[order.id] ?? {toPointId:'',note:''}).toPointId} onFocus={()=>void ensureServicePoints()} onChange={(e)=>setTransferDrafts((current)=>({...current,[order.id]:{...(current[order.id]??{toPointId:'',note:''}),toPointId:e.target.value}}))}>
                              <option value="">Wybierz punkt docelowy…</option>
                              {currentServicePointId !== (order.homePointId || order.pointId) && <option value={order.homePointId || order.pointId}>{order.homePointName || order.pointName} — punkt macierzysty</option>}
                              {servicePoints.filter((point)=>point.id!==currentServicePointId && point.id!==(order.homePointId || order.pointId)).map((point)=><option key={point.id} value={point.id}>{point.name} — {point.city}</option>)}
                            </select>
                            <button className="button primary" disabled={Boolean(orderBusyId)||!(transferDrafts[order.id]?.toPointId)} onClick={()=>void sendTransfer(order)}><Truck size={14}/> Wyślij telefon</button>
                          </div>
                        </div>}

                        {!order.openTransfer&&order.returnRequired&&order.status==='REPAIR_DONE'&&<div className="service-process-logistics">
                          <div><RotateCcw size={18}/><span><strong>Naprawa zakończona poza punktem macierzystym</strong><small>Teraz odeślij telefon. Po przyjęciu w punkcie macierzystym ServiceOS pokaże krok z gwarancją i odbiorem.</small></span></div>
                          {canTransferHere&&canEditStatus
                            ? <button className="button primary service-stage-primary" disabled={Boolean(orderBusyId)} onClick={()=>void sendReturnHome(order)}>Odeślij do punktu macierzystego</button>
                            : <small>Zwrot rozpoczyna osoba pracująca w punkcie, w którym telefon znajduje się teraz.</small>}
                        </div>}

                        {!order.openTransfer&&order.handlingMode!=='TRANSFER_ONLY'&&<div className="service-stage-actions">
                          {primaryStageAction && (canEditOrderHere || (primaryStageAction.status==='COMPLETED' && canCompletePickupHere)) && <button
                            type="button"
                            className="button primary service-stage-primary"
                            disabled={Boolean(orderBusyId)||primaryStageBlocked||(primaryStageAction.status==='READY'&&Boolean(order.returnRequired))}
                            onClick={()=>void changeStatus(order,primaryStageAction.status)}
                          >{primaryStageAction.label}</button>}
                          {canEditOrderHere && (order.status==='DIAGNOSIS'||order.status==='IN_REPAIR') && <button
                            type="button"
                            className="button secondary"
                            disabled={Boolean(orderBusyId)}
                            onClick={()=>void changeStatus(order,'WAITING_PARTS')}
                          >Czekam na części</button>}
                          {order.status==='REPAIR_DONE' && !order.warrantyReady && !order.returnRequired && <small className="service-stage-gate">Następny krok: wpisz wykonaną naprawę, ustaw gwarancję i przygotuj kartę poniżej.</small>}
                          {!canEditOrderHere&&!canCompletePickupHere&&order.status!=='COMPLETED'&&<small>{!operatingPointId?'Wybierz konkretny aktywny punkt, aby wykonać ten krok.':'Ten krok wykonuje punkt, w którym fizycznie znajduje się telefon.'}</small>}
                          {canEditOrderHere && <details className="service-stage-more">
                            <summary>Ręczna korekta etapu</summary>
                            <label className="service-stage-select">
                              <span>Status</span>
                              <select value={order.status} disabled={Boolean(orderBusyId)} onChange={(e)=>void changeStatus(order,e.target.value)}>
                                {statuses.map(([value,label])=><option key={value} value={value} disabled={(value==='READY'&&(order.status!=='REPAIR_DONE'||order.canMarkReady===false||!order.warrantyReady))||(value==='COMPLETED'&&order.status!=='READY')}>{label}</option>)}
                              </select>
                            </label>
                          </details>}
                        </div>}
                      </section>

                      {canUseOrderFinance && ['WAITING_PARTS','IN_REPAIR'].includes(order.status) && (
                        <section className="service-stage-task-card">
                          <div className="service-workspace-title"><PackageCheck size={16}/><div><strong>{order.status==='WAITING_PARTS'?'Części do tej naprawy':'Części i koszt naprawy'}</strong><span>{order.status==='WAITING_PARTS'?'Dodaj część i fakturę tutaj — bez szukania sekcji niżej.':'Sprawdź części i koszty przed zakończeniem naprawy.'}</span></div></div>
                          <OrderCostingCard order={order} guided />
                        </section>
                      )}

                      {canShowWarranty && (
                        <section className={`service-workspace-card service-warranty-card ${order.warrantyReady?'ready':''}`}>
                          <div className="service-workspace-title"><ShieldCheck size={15}/><div><strong>Gwarancja po naprawie</strong><span>Wymagana przed oznaczeniem urządzenia jako gotowe do odbioru.</span></div></div>
                          <div className="service-warranty-status">
                            <div><span>Okres</span><strong>{order.warrantyMonths ? `${order.warrantyMonths} mies.` : 'Nie ustawiono'}</strong></div>
                            <div><span>Ważna do</span><strong>{order.warrantyExpiresAt ? new Date(order.warrantyExpiresAt).toLocaleDateString('pl-PL') : '—'}</strong></div>
                            <div><span>Karta</span><strong>{order.warrantyCardPrintedAt ? 'Wygenerowana' : 'Do wygenerowania'}</strong></div>
                            <div><span>Numer</span><strong>{order.warrantyCardNumber || '—'}</strong></div>
                          </div>
                          {order.status==='REPAIR_DONE' && canManageWarrantyHere ? <>
                            <div className="service-warranty-controls">
                              <label><span>Gwarancja (miesiące)</span><input type="number" min="1" max="60" step="1" value={warrantyDrafts[order.id]??''} onChange={(e)=>setWarrantyDrafts((current)=>({...current,[order.id]:e.target.value.replace(/\D/g,'').slice(0,2)}))} placeholder="np. 3 lub 6"/></label>
                              <label className="service-warranty-repair-summary"><span>Wykonana naprawa</span><textarea rows={3} maxLength={2000} value={warrantyRepairDrafts[order.id]??''} onChange={(e)=>setWarrantyRepairDrafts((current)=>({...current,[order.id]:e.target.value}))} placeholder="Np. wymiana wyświetlacza, czyszczenie i test funkcjonalny"/></label>
                              <button className="button secondary small" disabled={warrantyBusyId===order.id||!(warrantyRepairDrafts[order.id]??'').trim()} onClick={()=>void saveWarranty(order)}><Save size={13}/> Zapisz gwarancję</button>
                              <button className="button primary small" disabled={warrantyBusyId===order.id||!order.warrantyMonths||!order.repairSummary} onClick={()=>void openWarrantyCard(order)}><Printer size={13}/> Wygeneruj / drukuj kartę</button>
                            </div>
                            <small className="service-warranty-hint">{order.warrantyReady
                              ? 'Gotowe — karta została przygotowana. Możesz teraz ustawić „Gotowe do odbioru”.'
                              : order.warrantyMonths
                                ? 'Wydrukuj kartę gwarancyjną i dołącz ją do telefonu. Dopiero wtedy ServiceOS odblokuje „Gotowe do odbioru”.'
                                : 'Wpisz liczbę miesięcy gwarancji. Po zapisaniu wydrukuj kartę z QR i kodem klienta.'}</small>
                          </> : <small className="service-warranty-hint">{order.status==='READY'||order.status==='COMPLETED'
                            ? 'Gwarancja została przygotowana przed odbiorem urządzenia.'
                            : order.status==='REPAIR_DONE'
                              ? 'Gwarancję wystawia się w aktywnym punkcie, w którym fizycznie znajduje się telefon.'
                              : 'Gwarancja została zapisana dla tego zlecenia.'}</small>}
                        </section>
                      )}

                      {draft && (
                        <details className="service-workspace-card service-workspace-collapse" onToggle={(event)=>{if(event.currentTarget.open)void ensureTechnicians(order);}}>
                          <summary><Smartphone size={15}/><span><strong>Dane urządzenia i realizacja</strong><small>IMEI, numer seryjny, termin, technik i ceny.</small></span></summary>
                          <div className="service-collapse-body">
                          <div className="service-details-grid">
                            <label><span>IMEI</span><input disabled={!canEditIntakeHere} inputMode="numeric" maxLength={16} value={draft.imei} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],imei:e.target.value.replace(/\D/g,'')}}))}/></label>
                            <label><span>Numer seryjny</span><input disabled={!canEditIntakeHere} maxLength={120} value={draft.serialNumber} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],serialNumber:e.target.value}}))}/></label>
                            {order.handlingMode !== 'TRANSFER_ONLY' && canEditIntakeHere && <div className="service-detail-date-field"><span>Przewidywany termin</span><div><input disabled={!canEditIntakeHere} type="date" min={toLocalDateInput(order.estimatedCompletionAt)||undefined} value={draft.estimatedCompletionAt} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],estimatedCompletionAt:e.target.value}}))}/><button type="button" className="button tiny secondary" disabled={!canEditIntakeHere||Boolean(order.estimatedCompletionAt)} title={order.estimatedCompletionAt?'Istniejącego terminu nie można usunąć — można go tylko wydłużyć.':'Brak przewidywanego terminu'} onClick={()=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],estimatedCompletionAt:''}}))}>Nie podano</button></div></div>}
                            {order.handlingMode !== 'TRANSFER_ONLY' && canManageOrderMeta && <label><span>Technik</span><select disabled={!canEditOrderHere} value={draft.assignedTechnicianId} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],assignedTechnicianId:e.target.value}}))}><option value="">Nieprzypisany</option>{pointTechnicians.map((technician)=><option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></label>}
                            {order.handlingMode !== 'TRANSFER_ONLY' && canEditCosts && <label><span>Cena orientacyjna (PLN)</span><input disabled={!canEditOrderHere} type="number" min="0" step="0.01" value={draft.estimatedCost} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],estimatedCost:e.target.value}}))}/></label>}
                            {order.handlingMode !== 'TRANSFER_ONLY' && canEditCosts && <label><span>Cena końcowa (PLN)</span><input disabled={!canEditOrderHere} type="number" min="0" step="0.01" value={draft.finalCost} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],finalCost:e.target.value}}))}/></label>}
                            <label className="full"><span>Uwagi do urządzenia</span><textarea disabled={!canEditIntakeHere} rows={3} maxLength={1000} value={draft.deviceNotes} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],deviceNotes:e.target.value}}))}/></label>
                          </div>
                          {canEditIntakeHere && <button className="button primary small" disabled={Boolean(orderBusyId)} onClick={()=>void saveOrderDetails(order)}><Save size={13}/>{orderBusyId===order.id?'Zapisywanie…':'Zapisz szczegóły'}</button>}
                          </div>
                        </details>
                      )}

                      {canUseOrderFinance && !['WAITING_PARTS','IN_REPAIR'].includes(order.status) && <details className="service-workspace-card service-workspace-collapse" onToggle={(event)=>setPanelOpen(order.id,'finance',event.currentTarget.open)}>
                        <summary><BadgeDollarSign size={15}/><span><strong>Koszty, części i faktury</strong><small>Otwórz tylko, gdy chcesz sprawdzić rozliczenie.</small></span></summary>
                        {openPanels[order.id+':finance']&&<div className="service-collapse-body service-finance-collapse"><OrderCostingCard order={order}/></div>}
                      </details>}

                      <details className="service-workspace-card service-workspace-collapse service-transfer-card" onToggle={(event)=>{if(event.currentTarget.open)void ensureServicePoints();}}>
                        <summary><Truck size={15}/><span><strong>Logistyka urządzenia</strong><small>{order.openTransfer||order.returnRequired?'Wymaga uwagi — sprawdź transport lub powrót.':'Przekazanie do innego punktu, gdy jest potrzebne.'}</small></span></summary>
                        <div className="service-collapse-body">
                        <div className="active-transfer-summary">
                          <div><MapPin size={15}/><span>Macierzysty: {order.homePointName || order.pointName}</span><b>·</b><strong>Teraz: {order.currentLocationLabel || order.currentPointName || 'W transporcie'}</strong></div>
                          <small>{order.returnRequired ? 'Po zakończeniu pracy urządzenie musi fizycznie wrócić do punktu macierzystego.' : 'Urządzenie jest w prawidłowym miejscu dla bieżącego etapu.'}</small>
                        </div>
                        {order.openTransfer ? (
                          <div className="active-transfer-summary">
                            <div><Truck size={15}/><span>{order.openTransfer.fromPointName}</span><b>→</b><strong>{order.openTransfer.toPointName}</strong></div>
                            <small>{order.openTransfer.kind==='RETURN_HOME' ? 'Obowiązkowy zwrot do punktu macierzystego' : 'Wysłanie do zewnętrznego serwisu'} · {order.openTransfer.status==='IN_TRANSIT'?'w drodze':order.openTransfer.status==='DELIVERED'?'dostarczono, czeka na przyjęcie':'oczekuje'}</small>
                          </div>
                        ) : order.handlingMode === 'TRANSFER_ONLY' ? (
                          canTransferHere ? (
                            <div className="transfer-compose">
                              <select value={(transferDrafts[order.id] ?? {toPointId:'',note:''}).toPointId} onChange={(e)=>setTransferDrafts((current)=>({...current,[order.id]:{...(current[order.id]??{toPointId:'',note:''}),toPointId:e.target.value}}))}>
                                <option value="">Wybierz punkt docelowy…</option>
                                {currentServicePointId !== (order.homePointId || order.pointId) && <option value={order.homePointId || order.pointId}>{order.homePointName || order.pointName} — punkt macierzysty</option>}
                                {servicePoints.filter((point)=>point.id!==currentServicePointId && point.id!==(order.homePointId || order.pointId)).map((point)=><option key={point.id} value={point.id}>{point.name} — {point.city}</option>)}
                              </select>
                              <textarea rows={2} maxLength={500} value={(transferDrafts[order.id] ?? {toPointId:'',note:''}).note} onChange={(e)=>setTransferDrafts((current)=>({...current,[order.id]:{...(current[order.id]??{toPointId:'',note:''}),note:e.target.value}}))} placeholder="Notatka do protokołu przekazania (opcjonalnie)"/>
                              <button className="button primary small" disabled={Boolean(orderBusyId) || !(transferDrafts[order.id]?.toPointId)} onClick={()=>void sendTransfer(order)}><Truck size={13}/> Przekaż urządzenie dalej</button>
                            </div>
                          ) : <div className="service-history-empty">Przekazanie może rozpocząć użytkownik obsługujący aktualny punkt urządzenia.</div>
                        ) : order.returnRequired ? (
                          canTransferHere && canEditStatus && order.status==='REPAIR_DONE' ? (
                            <div className="transfer-compose">
                              <textarea rows={2} maxLength={500} value={(transferDrafts[order.id] ?? {toPointId:'',note:''}).note} onChange={(e)=>setTransferDrafts((current)=>({...current,[order.id]:{...(current[order.id]??{toPointId:'',note:''}),note:e.target.value}}))} placeholder="Notatka do zwrotu, np. naprawa zakończona, komplet akcesoriów"/>
                              <button className="button primary small" disabled={Boolean(orderBusyId)} onClick={()=>void sendReturnHome(order)}><RotateCcw size={13}/> Odeślij do punktu macierzystego</button>
                            </div>
                          ) : (
                            <div className="service-history-empty">
                              {order.status==='REPAIR_DONE'
                                ? 'Zwrot do punktu macierzystego musi rozpocząć użytkownik obsługujący aktualny punkt urządzenia.'
                                : 'Urządzenie jest poza punktem macierzystym. Po zakończeniu naprawy ustaw status „Naprawa zakończona”, a następnie rozpocznij obowiązkowy zwrot.'}
                            </div>
                          )
                        ) : canTransferHere ? (
                          <div className="transfer-compose">
                            <select value={(transferDrafts[order.id] ?? {toPointId:'',note:''}).toPointId} onChange={(e)=>setTransferDrafts((current)=>({...current,[order.id]:{...(current[order.id]??{toPointId:'',note:''}),toPointId:e.target.value}}))}>
                              <option value="">Wybierz serwis docelowy…</option>
                              {servicePoints.filter((point)=>point.acceptsExternalRepairs && point.id!==currentServicePointId && point.id!==(order.homePointId || order.pointId)).map((point)=><option key={point.id} value={point.id}>{point.name} — {point.city}</option>)}
                            </select>
                            <textarea rows={2} maxLength={500} value={(transferDrafts[order.id] ?? {toPointId:'',note:''}).note} onChange={(e)=>setTransferDrafts((current)=>({...current,[order.id]:{...(current[order.id]??{toPointId:'',note:''}),note:e.target.value}}))} placeholder="Notatka dla serwisu docelowego, np. podejrzenie uszkodzenia płyty głównej"/>
                            <button className="button secondary small" disabled={Boolean(orderBusyId) || !(transferDrafts[order.id]?.toPointId)} onClick={()=>void sendTransfer(order)}><Truck size={13}/> Wyślij do serwisu</button>
                          </div>
                        ) : <div className="service-history-empty">Brak aktywnego transportu.</div>}
                        {(order.transfers ?? []).length>0 && <div className="transfer-mini-history">
                          {(order.transfers ?? []).slice(0,4).map((item)=><div key={item.id}><span>{item.kind==='RETURN_HOME'?'Powrót: ':'Do serwisu: '}{item.fromPointName} → {item.toPointName}</span><small>{item.status} · {new Date(item.updatedAt).toLocaleString('pl-PL')}</small></div>)}
                        </div>}
                        </div>
                      </details>

                      <details className="service-workspace-card service-workspace-collapse service-print-card">
                        <summary><Printer size={15}/><span><strong>Dokumenty i wydruk</strong><small>Karta serwisowa, QR i wydruk A4.</small></span></summary>
                        <div className="service-print-card-actions service-collapse-body">
                          <button className="button secondary small" disabled={Boolean(serviceCardBusyId)} onClick={()=>void reopenServiceCard(order,'PHYSICAL_AND_ONLINE')}><Printer size={13}/> A4: klient + urządzenie</button>
                          <button className="button secondary small" disabled={Boolean(serviceCardBusyId)} onClick={()=>void reopenServiceCard(order,'ONLINE_ONLY')}><Printer size={13}/> Tylko karta urządzenia</button>
                        </div>
                      </details>

                      <details className="service-workspace-card service-workspace-collapse" onToggle={(event)=>{if(event.currentTarget.open)void ensureCustomerCard(order);}}>
                        <summary><IdCard size={15}/><span><strong>Klient i jego wcześniejsze zlecenia</strong><small>Rozwiń tylko, gdy potrzebujesz historii klienta.</small></span></summary>
                        <div className="service-collapse-body">
                        {card ? <>
                          <div className="service-customer-card-head">
                            <div><strong>{card.customer.firstName} {card.customer.lastName}</strong><span>{card.customer.email || 'brak e-maila'} · {card.customer.phone || 'brak telefonu'}</span></div>
                            <b>{card.totalVisibleOrders} zleceń</b>
                          </div>
                          <div className="service-customer-order-mini">
                            {card.orders.slice(0,5).map((item)=><div key={item.id}><span>#{item.orderNumber} · {item.brand} {item.model}</span><small>{item.statusLabel} · {new Date(item.receivedAt).toLocaleDateString('pl-PL')}</small></div>)}
                          </div>
                        </> : <div className="service-history-empty">{historyBusyId===order.id?'Pobieram historię klienta…':'Otwórz sekcję, aby pobrać historię klienta.'}</div>}
                        </div>
                      </details>

                      <details className="service-workspace-card service-workspace-collapse" onToggle={(event)=>{if(event.currentTarget.open)void ensureOrderNotes(order.id);}}>
                        <summary><StickyNote size={15}/><span><strong>Notatki wewnętrzne</strong><small>Diagnoza, części i ustalenia zespołu.</small></span></summary>
                        <div className="service-collapse-body">
                        {canEditStatus && <div className="service-note-compose">
                          <textarea rows={3} maxLength={2000} value={noteDrafts[order.id] ?? ''} onChange={(e)=>setNoteDrafts((current)=>({...current,[order.id]:e.target.value}))} placeholder="Diagnoza technika, zamówione części, ustalenia z klientem…"/>
                          <button className="button secondary small" disabled={Boolean(orderBusyId) || !(noteDrafts[order.id] ?? '').trim()} onClick={()=>void addOrderNote(order.id)}>Dodaj notatkę</button>
                        </div>}
                        <div className="service-note-list">
                          {notes.map((note)=><div key={note.id}><div><strong>{note.authorName}</strong><span>{new Date(note.createdAt).toLocaleString('pl-PL')}</span></div><p>{note.body}</p></div>)}
                          {notes.length===0 && <div className="service-history-empty">{historyBusyId===order.id?'Pobieram notatki…':'Brak zapisanych notatek.'}</div>}
                        </div>
                        </div>
                      </details>

                      <details className="service-workspace-card service-workspace-collapse service-workspace-history" onToggle={(event)=>{if(event.currentTarget.open)void ensureOrderHistory(order.id);}}>
                        <summary><History size={15}/><span><strong>Historia zlecenia</strong><small>Pełna oś czasu zmian statusu.</small></span></summary>
                        <div className="service-collapse-body">
                        {(orderHistories[order.id] ?? []).map((item, index) => (
                          <div className="service-history-item" key={item.id}>
                            <div className="service-history-line"><i className={index === (orderHistories[order.id] ?? []).length - 1 ? 'current' : ''}></i></div>
                            <div className="service-history-content">
                              <div className="service-history-status">{item.fromLabel && <span>{item.fromLabel}</span>}{item.fromLabel && <b>→</b>}<strong>{item.toLabel}</strong></div>
                              <small>{new Date(item.changedAt).toLocaleString('pl-PL')} · {item.changedByName}</small>
                              {item.note && <p>{item.note}</p>}
                            </div>
                          </div>
                        ))}
                        {(orderHistories[order.id] ?? []).length === 0 && <div className="service-history-empty">{historyBusyId===order.id?'Pobieram historię…':'Brak zapisanych zmian statusu.'}</div>}
                        </div>
                      </details>
                    </div>
          </section>
        </div>;
      })()}
      {isActualTechnician && pointId && <MonthlyInvoicePrompt pointId={pointId} onOpenWarehouse={() => switchServiceTab('INVOICES')}/>} 
      {showGmailOnboarding && (
        <section className="panel-card service-mail-card">
          <div className="service-mail-copy">
            <div className="service-mail-icon"><Mail size={20}/></div>
            <div>
              <span>Automatyczne wiadomości · {pointOptions.find((p) => p.id === pointId)?.name ?? 'punkt'}</span>
              <strong>{gmailState === 'REAUTH_REQUIRED' ? 'Google wymaga ponownej zgody' : 'Włącz automatyczne e-maile'}</strong>
              <small>{gmailState === 'REAUTH_REQUIRED'
                ? 'Poprzednia zgoda Gmail wygasła albo została cofnięta. Połącz konto ponownie, aby wznowić automatyczną wysyłkę.'
                : 'Jednorazowo połącz konto Google nadawcy. Po poprawnym połączeniu ten komunikat zniknie i Gmail będzie działał automatycznie w tle.'}</small>
            </div>
          </div>
          <div className="service-mail-actions">
            <button className="button primary" disabled={gmailBusy || !pointId} onClick={() => void connectGmail()}>
              {gmailBusy ? 'Łączenie…' : gmailState === 'REAUTH_REQUIRED' ? 'Autoryzuj Gmail ponownie' : 'Połącz Gmail'}
            </button>
          </div>
        </section>
      )}

      {result && <div className="service-success">
        <strong>Zlecenie utworzone.</strong>
        <span>{result.reusedCustomer ? 'Użyto istniejącego klienta.' : 'Utworzono nowego klienta.'} Numer: #{result.order.orderNumber ?? result.order.id}</span>
      </div>}
      {notice && <div className="service-success"><span>{notice}</span></div>}
      {error && <div className="service-error">{error}</div>}

      {tab === 'CALENDAR' && isActualTechnician && <TechnicianCalendar onOpenOrder={openOrderFromWorkspace}/>}
      {tab === 'INVOICES' && canEditCosts && <InvoiceWarehouse
        pointId={pointId}
        pointName={pointOptions.find((point)=>point.id===pointId)?.name ?? auth.point?.name ?? 'Punkt'}
        points={pointOptions}
        onPointChange={setPointId}
      />} 
      {tab === 'TECH_NOTES' && isActualTechnician && <TechnicianNotesRoom/>}

      {tab === 'NEW' && (
        <div className="service-intake-hotfix service-intake-v3">
          {intakeStage === 'TYPE' ? (
            <div className="service-intake-page-shell">
              <section className="service-intake-details-card service-intake-details-dialog service-intake-type-dialog service-intake-inline" aria-label="Wybierz typ nowego zlecenia">
                <header className="service-intake-details-head">
                  <div>
                    <span className="eyebrow"><ClipboardPlus size={13}/> NOWE ZLECENIE</span>
                    <h2>Co przyjmujesz?</h2>
                    <p>Wybierz typ, a formularz pozostanie w tym samym dużym panelu ServiceOS.</p>
                  </div>
                </header>
                <section className="service-intake-type-screen">
                  <div className="service-order-type-picker service-order-type-picker-v3" role="group" aria-label="Typ zlecenia">
                    <button type="button" onClick={()=>{setComplaintOriginal(null);setComplaintQuery('');setComplaintMatches([]);update('orderType','REPAIR');setIntakeStage('DETAILS');}}>
                      <i><Wrench size={22}/></i>
                      <span><strong>Nowe zlecenie / Naprawa</strong><small>Standardowe przyjęcie urządzenia do naprawy.</small></span>
                      <b>→</b>
                    </button>
                    <button type="button" onClick={()=>{setComplaintOriginal(null);setComplaintQuery('');setComplaintMatches([]);update('orderType','COMPLAINT');setIntakeStage('DETAILS');}}>
                      <i><RotateCcw size={22}/></i>
                      <span><strong>Reklamacja naprawy</strong><small>Znajdź wcześniejsze zlecenie i przyjmij reklamację w kilka kroków.</small></span>
                      <b>→</b>
                    </button>
                    <button type="button" className="service-order-type-disabled" disabled>
                      <i><Smartphone size={22}/></i>
                      <span><strong>Reklamacja telefonu ze sprzedaży</strong><small>Ta funkcja będzie dostępna później.</small></span>
                      <b>Wkrótce</b>
                    </button>
                  </div>
                </section>
              </section>
            </div>
          ) : (
            <div className="service-intake-page-shell">
            <section className="service-intake-details-card service-intake-details-dialog service-intake-inline" aria-label={form.orderType==='COMPLAINT'?'Nowa reklamacja':'Nowe zlecenie'}>
              <header className="service-intake-details-head">
                <div>
                  <button type="button" className="service-intake-back" onClick={()=>setIntakeStage('TYPE')}>← Zmień typ</button>
                  <span className="eyebrow"><ClipboardPlus size={13}/> {form.orderType==='COMPLAINT'?'REKLAMACJA':'NAPRAWA'}</span>
                  <h2>{form.orderType==='COMPLAINT'?'Reklamacja naprawy':'Nowe zlecenie'}</h2>
                  <p>{form.orderType==='COMPLAINT'?'Najpierw wskaż wcześniejszą naprawę. Dane klienta i telefonu uzupełnią się automatycznie.':'Klient i urządzenie w jednym miejscu. Uzupełnij tylko to, co potrzebne do przyjęcia.'}</p>
                </div>
                <div className="service-intake-type-chip">{form.orderType==='COMPLAINT'?<RotateCcw size={16}/>:<Wrench size={16}/>}<span>{form.orderType==='COMPLAINT'?'Reklamacja':'Naprawa'}</span></div>
              </header>

              <div className="service-intake-details-body">
                {form.orderType==='COMPLAINT' && <section className="service-intake-section service-complaint-lookup">
                  <div className="service-intake-section-title"><RotateCcw size={16}/><div><strong>Znajdź wcześniejszą naprawę</strong><small>Numer zlecenia, nazwisko, telefon, e-mail, IMEI albo numer seryjny.</small></div></div>
                  <div className="service-search-row service-search-row-v3">
                    <input value={complaintQuery} onChange={(e)=>{setComplaintQuery(e.target.value);setComplaintOriginal(null);}} onKeyDown={(e)=>{if(e.key==='Enter')void searchComplaintOrders();}} placeholder="Np. #123, nazwisko klienta lub IMEI"/>
                    <button className="button primary" disabled={complaintSearchBusy||complaintQuery.trim().length<2} onClick={()=>void searchComplaintOrders()}><Search size={14}/>{complaintSearchBusy?'Szukam…':'Znajdź naprawę'}</button>
                  </div>
                  {complaintMatches.length>0&&<div className="service-complaint-results">{complaintMatches.map((item)=><button type="button" key={item.id} onClick={()=>useComplaintOrder(item)}>
                    <span><strong>#{item.orderNumber} · {item.customerName}</strong><small>{formatDeviceLabel(item.brand,item.model)} · {new Date(item.receivedAt).toLocaleDateString('pl-PL')}</small></span>
                    <b>{item.statusLabel}</b>
                  </button>)}</div>}
                  {complaintOriginal&&<div className="service-complaint-selected"><CheckCircle2 size={17}/><div><strong>Reklamacja do zlecenia #{complaintOriginal.orderNumber}</strong><span>{complaintOriginal.customerName} · {formatDeviceLabel(complaintOriginal.brand,complaintOriginal.model)}</span></div><button type="button" className="button tiny secondary" onClick={()=>{setComplaintOriginal(null);setComplaintQuery('');}}>Zmień</button></div>}
                  {!complaintOriginal&&<small className="service-complaint-hint">Reklamacja naprawy wymaga wskazania wcześniejszego zlecenia. Reklamacje telefonów sprzedanych przez sklep będą dodane osobno później.</small>}
                </section>}
                {form.orderType==='COMPLAINT'&&complaintOriginal&&<section className="service-intake-section service-complaint-source">
                  <div className="service-intake-section-title"><CheckCircle2 size={16}/><div><strong>Dane z poprzedniej naprawy są przypięte</strong><small>Nie musisz ponownie wpisywać klienta ani telefonu.</small></div></div>
                  <div className="service-complaint-source-grid">
                    <div><span>Klient</span><strong>{complaintOriginal.customerName}</strong><small>{complaintOriginal.customerPhone||complaintOriginal.customerEmail||'Brak kontaktu'}</small></div>
                    <div><span>Telefon</span><strong>{formatDeviceLabel(complaintOriginal.brand,complaintOriginal.model)}</strong><small>{complaintOriginal.imei?'IMEI '+complaintOriginal.imei:readableSerialNumber(complaintOriginal.serialNumber)?'S/N '+readableSerialNumber(complaintOriginal.serialNumber):'Brak IMEI / S/N'}</small></div>
                    <div><span>Poprzednie zgłoszenie</span><strong>{complaintOriginal.issueDescription}</strong><small>Status: {complaintOriginal.statusLabel}</small></div>
                  </div>
                </section>}
                {!(form.orderType==='COMPLAINT'&&complaintOriginal)&&<section className="service-intake-section service-intake-customer-v3">
                  <div className="service-intake-section-title"><UserRound size={16}/><div><strong>Klient</strong><small>Wyszukaj istniejącego albo wpisz nowego.</small></div></div>
                  <div className="service-search-row service-search-row-v3">
                    <input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void search();}} placeholder="Nazwisko, email lub telefon"/>
                    <button className="button secondary" disabled={searchBusy||query.trim().length<2} onClick={()=>void search()}><Search size={14}/>{searchBusy?'Szukam…':'Szukaj'}</button>
                  </div>
                  {matches.length>0&&<div className="service-customer-results service-customer-results-v3">{matches.map((customer)=><button key={customer.id} onClick={()=>useCustomer(customer)}><UserRound size={15}/><span><strong>{customer.firstName} {customer.lastName}</strong><small>{customer.email||customer.phone||'Brak kontaktu'}</small></span></button>)}</div>}
                  <div className="service-form-grid service-intake-form-v3">
                    <label><span>Imię</span><input value={form.firstName} onChange={(e)=>update('firstName',e.target.value)}/></label>
                    <label><span>Nazwisko</span><input value={form.lastName} onChange={(e)=>update('lastName',e.target.value)}/></label>
                    <label><span>Email</span><input type="email" value={form.email} onChange={(e)=>update('email',e.target.value)}/></label>
                    <label><span>Telefon</span><input value={form.phone} onChange={(e)=>update('phone',e.target.value)}/></label>
                  </div>
                </section>}

                <section className="service-intake-section">
                  <div className="service-intake-section-title"><Smartphone size={16}/><div><strong>{form.orderType==='COMPLAINT'&&complaintOriginal?'Przyjęcie reklamacji':'Urządzenie i realizacja'}</strong><small>{form.orderType==='COMPLAINT'&&complaintOriginal?'Opisz tylko nowy problem i stan telefonu. Reszta danych jest już przypięta.':'Dane techniczne, termin i cena orientacyjna.'}</small></div></div>
                  <div className="service-form-grid service-intake-form-v3">
                    {!(form.orderType==='COMPLAINT'&&complaintOriginal)&&<>
                      <label className="service-brand-field"><span>Marka <em>opcjonalnie</em></span><div className="service-brand-combobox">
                        <input value={form.brand} onFocus={()=>setBrandOpen(true)} onBlur={()=>window.setTimeout(()=>setBrandOpen(false),120)} onChange={(e)=>{update('brand',e.target.value);setBrandOpen(true);}} placeholder="Np. Samsung" autoComplete="off"/>
                        {brandOpen&&brandSuggestions.length>0&&<div className="service-brand-suggestions">{brandSuggestions.map((brand)=><button type="button" key={brand} onMouseDown={(event)=>event.preventDefault()} onClick={()=>{update('brand',brand);setBrandOpen(false);}}><Smartphone size={14}/><span>{brand}</span></button>)}</div>}
                      </div></label>
                      <label><span>Model <em>opcjonalnie</em></span><input value={form.model} onChange={(e)=>update('model',e.target.value)} placeholder="Np. Galaxy S24"/></label>
                      <label><span>IMEI <em>opcjonalnie</em></span><input inputMode="numeric" maxLength={16} value={form.imei} onChange={(e)=>update('imei',e.target.value.replace(/\D/g,''))} placeholder="14–16 cyfr"/></label>
                      <label><span>Numer seryjny <em>opcjonalnie</em></span><input maxLength={120} value={form.serialNumber} onChange={(e)=>update('serialNumber',e.target.value)} placeholder="Jeśli dostępny"/></label>
                      {canSetIntakeEstimate&&<label className="service-estimate-field"><span>Cena orientacyjna (PLN)</span><input type="number" min="0" step="0.01" value={form.estimatedCost} onChange={(e)=>update('estimatedCost',e.target.value)} placeholder="Np. 349,00"/></label>}
                    </>}
                    {canSetIntakeEta&&<div className="service-intake-eta full"><div className="service-field-heading"><span>Przewidywany termin</span><small>domyślnie +3 dni</small></div><div className="service-quick-pills service-eta-pills">
                      <button type="button" className={!form.estimatedCompletionAt?'active':''} onClick={()=>update('estimatedCompletionAt','')}>Bez terminu</button>
                      {[1,2,3].map((days)=><button type="button" key={days} className={form.estimatedCompletionAt===dateInputAfterDays(days)?'active':''} onClick={()=>update('estimatedCompletionAt',dateInputAfterDays(days))}>{days===1?'Jutro':`+${days} dni`}</button>)}
                      <label className="service-custom-date"><span>Inna data</span><input type="date" min={dateInputAfterDays(0)} value={form.estimatedCompletionAt} onChange={(e)=>update('estimatedCompletionAt',e.target.value)}/></label>
                    </div></div>}
                    <div className="service-device-notes full"><div className="service-field-heading"><span>Stan / uwagi do urządzenia</span><small>opcjonalnie</small></div><div className="service-quick-pills service-note-presets">{DEVICE_NOTE_PRESETS.map((note)=><button type="button" key={note} className={form.deviceNotes===note?'active':''} onClick={()=>update('deviceNotes',note)}>{note}</button>)}</div><textarea rows={3} maxLength={1000} value={form.deviceNotes} onChange={(e)=>update('deviceNotes',e.target.value)} placeholder="Dodatkowe uwagi…"/></div>
                    <label className="full"><span>{form.orderType==='COMPLAINT'?'Co klient reklamuje?':'Opis usterki'} <em>wymagane</em></span><textarea rows={5} required value={form.issueDescription} onChange={(e)=>update('issueDescription',e.target.value)} placeholder={form.orderType==='COMPLAINT'?'Opisz, co ponownie nie działa lub co klient zgłasza po naprawie.':'Krótko opisz problem zgłoszony przez klienta.'}/></label>
                  </div>
                </section>
              </div>

              <footer className="service-intake-details-footer">
                <div><strong>Po utworzeniu zlecenia</strong><span>ServiceOS od razu zapyta, jak klient chce być powiadamiany o przebiegu serwisu.</span></div>
                <button className="button primary service-submit service-submit-v2" disabled={busy||!pointId} onClick={()=>void submit()}>{busy?'Tworzę zlecenie…':'Utwórz zlecenie'}</button>
              </footer>
            </section>
            </div>
          )}
        </div>
      )}

      {tab === 'ORDERS' && !expandedOrderId && (
        <section className="panel-card service-orders-card">
          <div className="panel-heading">
            <div><span className="eyebrow"><ClipboardList size={13}/> ZLECENIA</span><h2>Ostatnie naprawy</h2><p>Kliknij zlecenie, aby przejść do prostego ekranu obsługi i następnej wymaganej czynności.</p></div>
            <div className="service-orders-heading-actions">
              <div className="service-transferred-counter"><Truck size={16}/><span>Przekazane do serwisu</span><strong>{transferredToServiceCount}</strong></div>
              <button className="button small secondary" disabled={ordersBusy} onClick={() => void loadOrders()}><RefreshCw className={ordersBusy ? 'spin' : ''} size={14}/> Odśwież</button>
            </div>
          </div>
          <div className="service-workflow-filters">
            {workflowFilters.map((filter)=><button
              key={filter.code}
              className={orderFilter===filter.code?'active':''}
              onClick={()=>setOrderFilter(filter.code)}
            ><span>{filter.label}</span><strong>{filter.count}</strong></button>)}
          </div>
          <div className="service-orders-list">
            {renderedOrders.map((order) => {
              const currentServicePointId = order.openTransfer ? '' : (order.currentPointId || order.homePointId || order.pointId);
              const canOperateCurrentPoint = Boolean(currentServicePointId) && pointId === currentServicePointId && (['OWNER','BOSS'].includes(effectiveRole) || pointOptions.some((point)=>point.id===currentServicePointId));
              const canEditOrderHere = canEditStatus && canOperateCurrentPoint && !order.openTransfer;
              const canCancelHere = canCancelService && canOperateCurrentPoint && !order.openTransfer;
              const transferredToService = isTransferredToService(order);
              return (
                <article key={order.id} data-service-order-id={order.id} className={`service-order-wrap workflow-${(order.workflow?.attentionCode || 'ACTIVE').toLowerCase()}`}>
                  <div className="service-order-row">
                    <div className="service-order-number"><strong>#{order.orderNumber}</strong><span>{new Date(order.receivedAt).toLocaleString('pl-PL')}</span></div>
                    <div className="service-order-main">
                      <strong>{order.customerName}</strong>
                      <span>{formatDeviceLabel(order.brand, order.model)} · {order.pointName}</span>
                      <small>{order.handlingMode === 'TRANSFER_ONLY' ? 'Tylko przekazanie' : (order.orderType === 'COMPLAINT' ? 'Reklamacja' : 'Naprawa')} · {order.customerEmail || order.customerPhone || 'brak kontaktu'}</small>
                      {order.workflow && <div className="service-workflow-summary">
                        <div className="service-workflow-stage">
                          <span>Etap {order.workflow.stageNumber}/{order.workflow.stageTotal}</span>
                          <strong>{order.workflow.stageLabel}</strong>
                          <div className="service-workflow-progress"><i style={{width:`${order.workflow.progressPercent}%`}}/></div>
                        </div>
                        <div className="service-workflow-next">
                          <span>Następna akcja</span>
                          <strong>{order.workflow.nextAction}</strong>
                        </div>
                        <div className={`service-workflow-attention ${order.workflow.attentionCode.toLowerCase()}`}>
                          {order.workflow.attentionLabel}
                          {order.workflow.dueInMinutes != null && order.workflow.dueInMinutes < 0 && <small>{Math.ceil(Math.abs(order.workflow.dueInMinutes)/60)} h po terminie</small>}
                          {order.workflow.dueInMinutes != null && order.workflow.dueInMinutes >= 0 && order.workflow.dueInMinutes <= 1440 && <small>{Math.max(1,Math.ceil(order.workflow.dueInMinutes/60))} h do terminu</small>}
                        </div>
                      </div>}
                      <div className="service-order-quick-meta">
                        {order.handlingMode === 'TRANSFER_ONLY'
                          ? <span className="transfer-only-chip"><Truck size={11}/>Tylko przekazanie</span>
                          : <><span><UserCog size={11}/>{order.assignedTechnicianName || 'Nieprzypisany'}</span><span><CalendarClock size={11}/>{order.estimatedCompletionAt ? new Date(order.estimatedCompletionAt).toLocaleDateString('pl-PL') : 'Brak terminu'}</span></>}
                        <span><MapPin size={11}/>Macierzysty: {order.homePointName || order.pointName}</span>
                        <span><Truck size={11}/>Lokalizacja: {order.currentLocationLabel || order.currentPointName || order.pointName}</span>
                        {transferredToService && <span className="service-transferred-chip"><Truck size={11}/>Przekazane do serwisu</span>}
                        {canEditCosts && order.handlingMode !== 'TRANSFER_ONLY' && <span><BadgeDollarSign size={11}/>{order.finalCost != null ? `${order.finalCost.toFixed(2)} PLN` : order.estimatedCost != null ? `~${order.estimatedCost.toFixed(2)} PLN` : 'Brak wyceny'}</span>}
                      </div>
                    </div>
                    <div className="service-order-actions">
                      <div className="service-order-status">
                        {canCancelHere && !canEditStatus && order.status !== 'CANCELLED' ? (
                          <div className="transfer-only-status"><span className="status-badge">{order.handlingMode === 'TRANSFER_ONLY' ? 'Tylko przekazanie' : order.statusLabel}</span><button className="button small danger-soft" disabled={Boolean(orderBusyId)} onClick={() => void changeStatus(order,'CANCELLED')}>Anuluj</button></div>
                        ) : canEditOrderHere && order.handlingMode === 'TRANSFER_ONLY' ? (
                          <div className="transfer-only-status"><span className="status-badge">Tylko przekazanie</span>{order.status !== 'CANCELLED' && <button className="button small danger-soft" disabled={Boolean(orderBusyId)} onClick={() => void changeStatus(order,'CANCELLED')}>Anuluj</button>}</div>
                        ) : (
                          <div className="service-status-readonly">
                            <span className="status-badge">{order.handlingMode==='TRANSFER_ONLY' && order.status!=='CANCELLED' ? 'Tylko przekazanie' : order.statusLabel}</span>
                            <small>{order.openTransfer ? 'Transport w toku — wejdź w szczegóły.' : canEditOrderHere ? 'Kolejny krok wykonasz w szczegółach.' : canEditStatus ? 'Etap zmienia punkt, w którym jest telefon.' : order.workflow?.attentionLabel}</small>
                          </div>
                        )}
                      </div>
                      <button className="button small secondary service-history-button" onClick={() => void toggleOrderHistory(order)}>
                        <History size={13}/>
                        Szczegóły
                      </button>
                    </div>
                  </div>

                  
                </article>
              );
            })}
            {!ordersBusy && orders.length === 0 && <div className="service-empty">Brak zleceń w Twoim zakresie.</div>}
            {!ordersBusy && orders.length > 0 && visibleOrders.length === 0 && <div className="service-empty">Brak zleceń w wybranej sekcji.</div>}
            {!ordersBusy && (renderedOrders.length < visibleOrders.length || ordersHasMore) && <div className="service-orders-load-more">
              <button className="button secondary" disabled={ordersPageBusy} onClick={()=>renderedOrders.length<visibleOrders.length?setOrdersVisibleLimit((value)=>value+28):void loadMoreOrders()}>
                {renderedOrders.length<visibleOrders.length
                  ? `Pokaż kolejne ${Math.min(28,visibleOrders.length-renderedOrders.length)} zleceń`
                  : ordersPageBusy?'Pobieram…':'Pobierz kolejne z serwera'}
              </button>
              <small>Wyświetlam {renderedOrders.length} z {visibleOrders.length} pobranych. ServiceOS pobiera następne zlecenia dopiero na żądanie.</small>
            </div>}
          </div>
        </section>
      )}

      {tab === 'TRANSFERS' && (
        <section className="panel-card service-orders-card service-transfers-board">
          <div className="panel-heading">
            <div><span className="eyebrow"><Truck size={13}/> LOGISTYKA SERWISOWA</span><h2>Przekazania między punktami</h2><p>Wysłane urządzenia, dostawy oczekujące na przyjęcie i zakończone przekazania.</p></div>
            <button className="button small secondary" onClick={()=>void loadTransfers()}><RefreshCw size={14}/> Odśwież</button>
          </div>
          <div className="transfer-board-list">
            {transfers.map((transfer)=>{
              const canActDestination=pointOptions.some((point)=>point.id===transfer.toPointId);
              const canActSource=pointOptions.some((point)=>point.id===transfer.fromPointId);
              return <article key={transfer.id} className={`transfer-board-row transfer-${transfer.status.toLowerCase()}`}>
                <div className="transfer-board-icon">{transfer.status==='ACCEPTED'?<PackageCheck size={18}/>:<Truck size={18}/>}</div>
                <div className="transfer-board-main">
                  <strong>#{transfer.orderNumber} · {transfer.customerName}</strong>
                  <span>{transfer.device}</span>
                  <small>{transfer.kind==='RETURN_HOME'?'Powrót do punktu macierzystego · ':'Do serwisu · '}{transfer.fromPointName} → {transfer.toPointName}</small>
                  {transfer.note && <p>{transfer.note}</p>}
                </div>
                <div className="transfer-board-status">
                  <strong>{transfer.status==='IN_TRANSIT'?'W drodze':transfer.status==='DELIVERED'?'Dostarczono':transfer.status==='ACCEPTED'?'Przyjęte':transfer.status==='REJECTED'?'Odrzucone':transfer.status==='CANCELLED'?'Anulowane':'Oczekuje'}</strong>
                  <small>{new Date(transfer.updatedAt).toLocaleString('pl-PL')}</small>
                </div>
                <div className="transfer-board-actions">
                  {transfer.status==='IN_TRANSIT' && canActDestination && <button className="button small primary" disabled={Boolean(orderBusyId)} onClick={()=>void changeTransferStatus(transfer,'DELIVERED')}>Dostarczono</button>}
                  {transfer.status==='IN_TRANSIT' && canActSource && <button className="button small secondary" disabled={Boolean(orderBusyId)} onClick={()=>void changeTransferStatus(transfer,'CANCELLED')}>Anuluj</button>}
                  {transfer.status==='DELIVERED' && canActDestination && <button className="button small primary" disabled={Boolean(orderBusyId)} onClick={()=>void changeTransferStatus(transfer,'ACCEPTED')}><PackageCheck size={13}/> Przyjmij</button>}
                  {transfer.status==='DELIVERED' && canActDestination && <button className="button small danger-soft" disabled={Boolean(orderBusyId)} onClick={()=>void changeTransferStatus(transfer,'REJECTED')}>Odrzuć</button>}
                </div>
              </article>;
            })}
            {transfers.length===0 && <div className="service-empty">Brak przekazań w Twoim zakresie.</div>}
          </div>
        </section>
      )}

      {tab === 'QUOTES' && canHandleCustomerQuotes && (
        <section className="panel-card service-quotes-card">
          <div className="panel-heading">
            <div><span className="eyebrow"><MessageSquareText size={13}/> PORTAL KLIENTA</span><h2>Wyceny klientów</h2><p>Zapytania z prywatnego portalu klienta. Jeżeli punkt nie ma serwisanta, ServiceOS automatycznie kieruje sprawę do właściwego serwisu.</p></div>
            <button className="button small secondary" onClick={()=>void loadCustomerQuotes(pointId)}><RefreshCw size={14}/> Odśwież</button>
          </div>
          <div className="desktop-quote-list">
            {customerQuotes.map((item)=>{
              const closed=['CLOSED','CANCELLED'].includes(item.status);
              const routeChanged=item.requestedPointId!==item.routedPointId;
              return <article className="desktop-quote-card" key={item.id}>
                <div className="desktop-quote-head">
                  <div><span>{item.orderNumber != null ? `ZLECENIE #${item.orderNumber}` : 'NOWA WYCENA'}</span><strong>{item.customerName} · {item.deviceDescription}</strong><small>{item.customerEmail || item.customerPhone || 'Brak dodatkowego kontaktu'} · {new Date(item.updatedAt).toLocaleString('pl-PL')}</small></div>
                  <em className={item.status.toLowerCase()}>{quoteStatusLabel(item.status)}</em>
                </div>
                <div className="desktop-quote-route">
                  <span>Klient wybrał <strong>{item.requestedPointName}</strong></span>
                  {routeChanged && <><b>→</b><span>Obsługuje <strong>{item.routedPointName}</strong></span></>}
                  <span>Serwisant: <strong>{item.assignedTechnicianName || 'do przejęcia przez serwis'}</strong></span>
                </div>
                <p className="desktop-quote-issue">{item.issueDescription}</p>
                {item.quoteAmount != null && <div className="desktop-quote-price"><span>Aktualna wycena</span><strong>{item.quoteAmount.toFixed(2)} {item.currency || 'PLN'}</strong>{item.quoteNote && <small>{item.quoteNote}</small>}</div>}
                <div className="desktop-quote-thread">
                  {item.messages.map((message)=><div key={message.id} className={`desktop-quote-message ${message.senderKind.toLowerCase()}`}><div><strong>{message.senderKind==='CUSTOMER'?'Klient':message.senderKind==='STAFF'?(message.senderName || 'Serwis'):'ServiceOS'}</strong><time>{new Date(message.createdAt).toLocaleString('pl-PL')}</time></div><p>{message.body}</p></div>)}
                </div>
                {!closed && <div className="desktop-quote-actions">
                  <div className="desktop-quote-price-form">
                    <label><span>Kwota wyceny</span><input type="number" min="0" step="0.01" value={quoteAmountDrafts[item.id] ?? (item.quoteAmount == null ? '' : String(item.quoteAmount))} onChange={(e)=>setQuoteAmountDrafts((current)=>({...current,[item.id]:e.target.value}))} placeholder="0,00"/></label>
                    <label><span>Opis wyceny</span><input maxLength={1000} value={quoteNoteDrafts[item.id] ?? ''} onChange={(e)=>setQuoteNoteDrafts((current)=>({...current,[item.id]:e.target.value}))} placeholder="Co obejmuje cena?"/></label>
                    <button className="button primary" disabled={Boolean(quoteBusyId)} onClick={()=>void priceCustomerQuote(item.id)}><BadgeDollarSign size={14}/> Wyślij wycenę</button>
                  </div>
                  <div className="desktop-quote-reply-form">
                    <input maxLength={1000} value={quoteReplyDrafts[item.id] ?? ''} onChange={(e)=>setQuoteReplyDrafts((current)=>({...current,[item.id]:e.target.value}))} onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void replyCustomerQuote(item.id);}}} placeholder="Napisz wiadomość do klienta"/>
                    <button className="button secondary" disabled={Boolean(quoteBusyId)} onClick={()=>void replyCustomerQuote(item.id)}><Send size={14}/> Odpowiedz</button>
                    <button className="button secondary danger" disabled={Boolean(quoteBusyId)} onClick={()=>void closeCustomerQuote(item.id)}>Zamknij</button>
                  </div>
                </div>}
              </article>;
            })}
            {customerQuotes.length===0 && <div className="service-empty">Brak zapytań o wycenę w Twoim zakresie.</div>}
          </div>
        </section>
      )}

      {tab === 'EMAILS' && canManageGmail && (
        <>
          <section className="panel-card service-mail-card">
            <div className="service-mail-copy">
              <div className="service-mail-icon">{gmail?.connected ? <MailCheck size={20}/> : <Mail size={20}/>}</div>
              <div>
                <span>Nadawca Gmail · {pointOptions.find((p) => p.id === pointId)?.name ?? 'punkt'}</span>
                <strong>{gmailChecking
                  ? 'Sprawdzanie połączenia…'
                  : gmail?.connected
                    ? (gmail.email || 'Gmail połączony')
                    : gmailState === 'REAUTH_REQUIRED'
                      ? (gmail?.email || 'Wymagana ponowna autoryzacja')
                      : gmailState === 'TEMPORARY_ERROR'
                        ? (gmail?.email || 'Nie udało się potwierdzić połączenia')
                        : 'Brak połączonego Gmail'}</strong>
                <small>{gmailChecking
                  ? 'ServiceOS automatycznie sprawdza, czy zapisany dostęp Gmail nadal działa.'
                  : gmail?.connected
                    ? 'Połączenie działa automatycznie w tle. ServiceOS używa wyłącznie zakresu gmail.send.'
                    : gmailState === 'REAUTH_REQUIRED'
                      ? (gmail?.lastError || 'Zgoda Google wygasła albo została cofnięta.')
                      : gmailState === 'TEMPORARY_ERROR'
                        ? (gmail?.lastError || 'To może być chwilowa awaria Google. Ponowna zgoda nie jest teraz wymagana.')
                        : 'Połącz konto tylko wtedy, gdy ten punkt ma wysyłać automatyczne wiadomości.'}</small>
              </div>
            </div>
            <div className="service-mail-actions">
              {gmail?.connected && <button className="button secondary" disabled={gmailBusy} onClick={() => void testGmail()}><Send size={14}/> Wyślij test</button>}
              {gmail?.connected && <button className="button secondary" disabled={gmailBusy} onClick={() => void disconnectGmail()}>Odłącz Gmail</button>}
              {!gmail?.connected && gmailState === 'REAUTH_REQUIRED' && <button className="button primary" disabled={gmailBusy} onClick={() => void connectGmail()}>{gmailBusy ? 'Łączenie…' : 'Autoryzuj ponownie'}</button>}
              {!gmail?.connected && gmailState === 'NOT_CONNECTED' && <button className="button primary" disabled={gmailBusy} onClick={() => void connectGmail()}>{gmailBusy ? 'Łączenie…' : 'Połącz Gmail'}</button>}
              {gmailState === 'TEMPORARY_ERROR' && <button className="button secondary" disabled={gmailChecking} onClick={() => void loadGmailStatus(pointId)}><RefreshCw className={gmailChecking ? 'spin' : ''} size={14}/> Sprawdź ponownie</button>}
            </div>
          </section>

          <div className="notification-layout">
          <section className="panel-card notification-settings-card">
            <div className="panel-heading">
              <div><span className="eyebrow"><Settings2 size={13}/> AUTOMATYKA</span><h2>Ustawienia wiadomości</h2><p>Konfiguracja jest zapisana centralnie dla wybranego punktu.</p></div>
            </div>
            {notificationSettings && <>
              <label className="notification-toggle">
                <input
                  type="checkbox"
                  checked={notificationSettings.automaticEmailEnabled}
                  onChange={(e)=>setNotificationSettings({...notificationSettings,automaticEmailEnabled:e.target.checked})}
                />
                <span><strong>Automatyczne e-maile</strong><small>Po zmianie wybranego statusu ServiceOS od razu spróbuje wysłać wiadomość.</small></span>
              </label>

              <div className="notification-field">
                <span>Nazwa nadawcy</span>
                <input value={notificationSettings.senderDisplayName} maxLength={80} onChange={(e)=>setNotificationSettings({...notificationSettings,senderDisplayName:e.target.value})}/>
              </div>

              <div className="notification-field">
                <span>Stopka wiadomości</span>
                <textarea rows={3} maxLength={500} value={notificationSettings.footerText} onChange={(e)=>setNotificationSettings({...notificationSettings,footerText:e.target.value})} placeholder="Np. W razie pytań zadzwoń do punktu serwisowego."/>
              </div>

              <div className="notification-field">
                <span>Wyślij wiadomość po statusie</span>
                <div className="notification-status-grid">
                  {mailStatusOptions.map(([value,label]) => (
                    <button key={value} className={notificationSettings.notifyStatuses.includes(value) ? 'active' : ''} onClick={()=>toggleNotifyStatus(value)}>
                      {notificationSettings.notifyStatuses.includes(value) ? <CheckCircle2 size={14}/> : <Clock3 size={14}/>}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <button className="button primary" disabled={notificationBusy} onClick={()=>void saveNotificationSettings()}>
                {notificationBusy ? 'Zapisywanie…' : 'Zapisz ustawienia'}
              </button>
            </>}
          </section>

          <section className="panel-card notification-history-card">
            <div className="panel-heading">
              <div><span className="eyebrow"><MailCheck size={13}/> HISTORIA</span><h2>Ostatnie wiadomości</h2><p>Wynik Gmail, liczba prób i błędy dostawy.</p></div>
              <button className="button small secondary" disabled={notificationBusy} onClick={()=>void loadMailData(pointId)}><RefreshCw className={notificationBusy ? 'spin' : ''} size={14}/> Odśwież</button>
            </div>
            <div className="notification-history-list">
              {notificationHistory.map((item) => (
                <article key={item.id} className={'notification-history-row status-' + item.status.toLowerCase()}>
                  <div className="notification-delivery-icon">
                    {item.status === 'SENT' ? <CheckCircle2 size={17}/> : item.status === 'FAILED' ? <XCircle size={17}/> : <Clock3 size={17}/>}
                  </div>
                  <div className="notification-history-main">
                    <strong>{item.orderNumber ? '#' + item.orderNumber + ' · ' : ''}{item.customerName || item.recipient}</strong>
                    <span>{item.device || item.recipient}</span>
                    <small>{deliveryLabel(item.status)} · próby: {item.attempts}{item.sentAt ? ' · ' + new Date(item.sentAt).toLocaleString('pl-PL') : ''}</small>
                    {item.lastError && <small className="notification-error-text">{item.lastError}</small>}
                  </div>
                  {item.status === 'FAILED' && (
                    <button className="button small secondary" disabled={notificationBusy} onClick={()=>void retryNotification(item.id)}><RotateCcw size={13}/> Ponów</button>
                  )}
                </article>
              ))}
              {!notificationBusy && notificationHistory.length === 0 && <div className="service-empty">Brak wysłanych powiadomień dla tego punktu.</div>}
            </div>
          </section>
          </div>
        </>
      )}
    </div>
  );
}
