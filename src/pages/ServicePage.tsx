import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeDollarSign, BellRing, CalendarClock, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, ClipboardPlus,
  Clock3, FileArchive, History, IdCard, Mail, MailCheck, MapPin, MessageSquareText, NotebookPen, PackageCheck, Printer, RefreshCw, RotateCcw, Save, Search, Send,
  Settings2, Smartphone, StickyNote, Truck, UserCog, UserRound, XCircle
} from 'lucide-react';
import { InvoiceWarehouse } from '../components/InvoiceWarehouse';
import { MonthlyInvoicePrompt } from '../components/MonthlyInvoicePrompt';
import { OrderCostingCard } from '../components/OrderCostingCard';
import { TechnicianCalendar } from '../components/TechnicianCalendar';
import { TechnicianNotesRoom } from '../components/TechnicianNotesRoom';
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

interface ServicePageProps {
  auth: AuthState;
  effectiveRole: UserRole;
  focusOrderId?: string | null;
}

const emptyForm = {
  firstName: '', lastName: '', email: '', phone: '',
  brand: '', model: '', imei: '', serialNumber: '', deviceNotes: '',
  issueDescription: '', orderType: 'REPAIR' as 'REPAIR' | 'COMPLAINT',
  assignedTechnicianId: '', estimatedCost: '', estimatedCompletionAt: ''
};

const toLocalDateTimeInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
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

type ServiceTab = 'CALENDAR' | 'NEW' | 'ORDERS' | 'TRANSFERS' | 'QUOTES' | 'EMAILS' | 'INVOICES' | 'TECH_NOTES';

export function ServicePage({ auth, effectiveRole, focusOrderId = null }: ServicePageProps) {
  const isActualTechnician = auth.role === 'TECHNICIAN';
  const [tab, setTab] = useState<ServiceTab>(isActualTechnician ? 'CALENDAR' : 'NEW');
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [orderFilter, setOrderFilter] = useState('ALL');
  const [matches, setMatches] = useState<ServiceCustomer[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchRequestRef = useRef(0);
  const [orders, setOrders] = useState<ServiceOrderSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [result, setResult] = useState<ServiceCreateOrderResult | null>(null);
  const [cardChoice, setCardChoice] = useState<{orderId:string;orderNumber:number}|null>(null);
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
  const [orderHistories, setOrderHistories] = useState<Record<string, ServiceStatusHistoryItem[]>>({});
  const [orderNotes, setOrderNotes] = useState<Record<string, ServiceOrderNote[]>>({});
  const [customerCards, setCustomerCards] = useState<Record<string, ServiceCustomerDetail>>({});
  const [techniciansByPoint, setTechniciansByPoint] = useState<Record<string, ServiceTechnician[]>>({});
  const [detailsDrafts, setDetailsDrafts] = useState<Record<string, OrderDetailsDraft>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);
  const [technicians, setTechnicians] = useState<ServiceTechnician[]>([]);
  const [servicePoints, setServicePoints] = useState<AdminPoint[]>([]);
  const [transfers, setTransfers] = useState<ServiceTransfer[]>([]);
  const [transferDrafts, setTransferDrafts] = useState<Record<string,{toPointId:string;note:string}>>({});
  const [customerQuotes, setCustomerQuotes] = useState<CustomerQuoteRequest[]>([]);
  const [quoteBusyId, setQuoteBusyId] = useState<string | null>(null);
  const [quoteReplyDrafts, setQuoteReplyDrafts] = useState<Record<string,string>>({});
  const [quoteAmountDrafts, setQuoteAmountDrafts] = useState<Record<string,string>>({});
  const [quoteNoteDrafts, setQuoteNoteDrafts] = useState<Record<string,string>>({});

  const pointOptions = useMemo(() => auth.points, [auth.points]);
  const [pointId, setPointId] = useState(auth.point?.id ?? auth.points[0]?.id ?? '');
  const canEditStatus = ['OWNER', 'BOSS', 'COORDINATOR', 'TECHNICIAN'].includes(effectiveRole);
  const canCreateService = canEditStatus || effectiveRole === 'USER';
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

  const workflowFilters = useMemo(() => [
    {code:'ALL',label:'Wszystkie',count:orders.length},
    {code:'ACTION_NOW',label:'Wymaga działania teraz',count:orders.filter((order)=>order.workflow?.flags.includes('ACTION_NOW')).length},
    {code:'DUE_SOON',label:'Kończy się termin',count:orders.filter((order)=>order.workflow?.flags.includes('DUE_SOON')).length},
    {code:'OVERDUE',label:'Po terminie',count:orders.filter((order)=>order.workflow?.flags.includes('OVERDUE')).length},
    {code:'IN_TRANSIT',label:'W drodze',count:orders.filter((order)=>order.workflow?.flags.includes('IN_TRANSIT')).length},
    {code:'WAITING_SERVICE',label:'Czeka na serwis',count:orders.filter((order)=>order.workflow?.flags.includes('WAITING_SERVICE')).length},
    {code:'WAITING_PARTS',label:'Czeka na części',count:orders.filter((order)=>order.workflow?.flags.includes('WAITING_PARTS')).length},
    {code:'READY_FOR_PICKUP',label:'Gotowe do odbioru',count:orders.filter((order)=>order.workflow?.flags.includes('READY_FOR_PICKUP')).length}
  ], [orders]);

  const visibleOrders = useMemo(
    () => orderFilter === 'ALL' ? orders : orders.filter((order)=>order.workflow?.flags.includes(orderFilter)),
    [orders,orderFilter]
  );

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const loadOrders = async () => {
    setOrdersBusy(true);
    try {
      setOrders(await window.lockOn.service.listOrders());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać zleceń.');
    } finally {
      setOrdersBusy(false);
    }
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
        serialNumber: order.serialNumber ?? '',
        deviceNotes: order.deviceNotes ?? '',
        assignedTechnicianId: order.assignedTechnicianId ?? '',
        estimatedCost: order.estimatedCost == null ? '' : String(order.estimatedCost),
        finalCost: order.finalCost == null ? '' : String(order.finalCost),
        estimatedCompletionAt: toLocalDateTimeInput(order.estimatedCompletionAt)
      }
    }));

    setHistoryBusyId(order.id);
    setError('');
    try {
      const requests: Promise<unknown>[] = [];
      if (!orderHistories[order.id]) {
        requests.push(window.lockOn.service.getHistory(order.id).then((history) =>
          setOrderHistories((current) => ({ ...current, [order.id]: history }))
        ));
      }
      if (canEditStatus && !orderNotes[order.id]) {
        requests.push(window.lockOn.service.getNotes(order.id).then((notes) =>
          setOrderNotes((current) => ({ ...current, [order.id]: notes }))
        ));
      }
      if (!customerCards[order.customerId]) {
        requests.push(window.lockOn.service.getCustomer(order.customerId).then((card) =>
          setCustomerCards((current) => ({ ...current, [order.customerId]: card }))
        ));
      }
      const workPointId = order.currentPointId || order.homePointId || order.pointId;
      if (canManageOrderMeta && !techniciansByPoint[workPointId]) {
        requests.push(window.lockOn.service.listTechnicians(workPointId).then((items) =>
          setTechniciansByPoint((current) => ({ ...current, [workPointId]: items }))
        ));
      }
      await Promise.all(requests);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać szczegółów zlecenia.');
    } finally {
      setHistoryBusyId(null);
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
    void loadOrders();
    void loadTransfers();
    if (canHandleCustomerQuotes) void loadCustomerQuotes(pointId);
  }, []);

  useEffect(() => {
    if (!canHandleCustomerQuotes) return;
    void loadCustomerQuotes(pointId);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadCustomerQuotes(pointId);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [pointId, effectiveRole]);

  useEffect(() => {
    setNotificationSettings(null);
    setNotificationHistory([]);
    void loadGmailStatus(pointId);
  }, [pointId, canManageGmail]);

  useEffect(() => {
    if (!pointId || !canManageOrderMeta) {
      setTechnicians([]);
      return;
    }
    void window.lockOn.service.listTechnicians(pointId)
      .then(setTechnicians)
      .catch(() => setTechnicians([]));
  }, [pointId, canManageOrderMeta]);

  useEffect(() => {
    if (!focusOrderId || expandedOrderId === focusOrderId) return;
    const order = orders.find((item)=>item.id===focusOrderId);
    if (!order) return;
    setTab('ORDERS');
    void toggleOrderHistory(order);
    window.setTimeout(() => document.querySelector('[data-service-order-id="'+CSS.escape(focusOrderId)+'"]')?.scrollIntoView({behavior:'smooth',block:'center'}), 120);
  }, [focusOrderId,orders]);

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

  const submit = async () => {
    const cleanEmail = form.email.trim();
    const cleanPhone = form.phone.replace(/\D/g, '');
    if (!form.firstName.trim() || !form.lastName.trim() || !form.brand.trim() || !form.model.trim() || !form.issueDescription.trim()) {
      setError('Uzupełnij imię, nazwisko, markę, model i opis usterki.');
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

    setBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      const created = await window.lockOn.service.createOrder({
        ...form,
        imei: cleanImei,
        pointId,
        estimatedCost: canEditCosts && form.estimatedCost !== '' ? Number(form.estimatedCost) : undefined,
        assignedTechnicianId: canManageOrderMeta ? form.assignedTechnicianId || undefined : undefined,
        estimatedCompletionAt: form.estimatedCompletionAt ? new Date(form.estimatedCompletionAt).toISOString() : undefined
      });
      setResult(created);
      if(created.serviceCard?.required && created.order.orderNumber != null){
        setCardChoice({orderId:created.order.id,orderNumber:created.order.orderNumber});
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
      setForm(emptyForm);
      setMatches([]);
      setQuery('');
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się utworzyć zlecenia.');
    } finally { setBusy(false); }
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

  const changeStatus = async (order: ServiceOrderSummary, status: string) => {
    if (orderBusyId || status === order.status) return;
    if (status === 'CANCELLED' && !window.confirm(`Anulować zlecenie #${order.orderNumber}? Tej zmiany nie należy używać zamiast zwykłego etapu naprawy.`)) return;
    if (status === 'COMPLETED' && !window.confirm(`Zakończyć zlecenie #${order.orderNumber}? ServiceOS zapisze rozliczenie na podstawie kosztu końcowego.`)) return;
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
          : (draft.estimatedCompletionAt ? new Date(draft.estimatedCompletionAt).toISOString() : null),
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
          estimatedCompletionAt: toLocalDateTimeInput(updated.estimatedCompletionAt)
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
    if (!window.confirm(`Przekazać urządzenie ze zlecenia #${order.orderNumber} do ${destination?.name || 'wybranego punktu'}?`)) return;
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
    if (!window.confirm(`Odesłać urządzenie ze zlecenia #${order.orderNumber} do punktu macierzystego?`)) return;
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
    if (status === 'CANCELLED' && !window.confirm(`Anulować przekazanie zlecenia #${transfer.orderNumber}? Urządzenie wróci logicznie do punktu źródłowego.`)) return;
    if (status === 'REJECTED' && !window.confirm(`Odrzucić przekazanie zlecenia #${transfer.orderNumber}? Potwierdź tylko, jeśli punkt docelowy faktycznie odmawia przyjęcia.`)) return;
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
    if (!window.confirm('Zamknąć tę rozmowę o wycenie? Klient nie będzie mógł kontynuować tego wątku.')) return;
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
    if (!window.confirm('Odłączyć Gmail od tego punktu? Automatyczne wiadomości przestaną być wysyłane do ponownego połączenia konta.')) return;
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

  const openOrderFromWorkspace = (order: ServiceOrderSummary) => {
    setTab('ORDERS');
    if (expandedOrderId !== order.id) void toggleOrderHistory(order);
    window.setTimeout(() => document.querySelector('[data-service-order-id="'+CSS.escape(order.id)+'"]')?.scrollIntoView({behavior:'smooth',block:'center'}), 120);
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
          {isActualTechnician && <button className={tab === 'CALENDAR' ? 'active' : ''} onClick={() => setTab('CALENDAR')}><CalendarDays size={15}/> Plan pracy</button>}
          <button className={tab === 'NEW' ? 'active' : ''} onClick={() => setTab('NEW')}><ClipboardPlus size={15}/> Nowe zlecenie</button>
          <button className={tab === 'ORDERS' ? 'active' : ''} onClick={() => setTab('ORDERS')}><ClipboardList size={15}/> Zlecenia</button>
          <button className={tab === 'TRANSFERS' ? 'active' : ''} onClick={() => {setTab('TRANSFERS');void loadTransfers();}}><Truck size={15}/> Przekazania</button>
          {canHandleCustomerQuotes && <button className={tab === 'QUOTES' ? 'active' : ''} onClick={() => {setTab('QUOTES');void loadCustomerQuotes(pointId);}}><MessageSquareText size={15}/> Wyceny klientów{customerQuotes.filter((item)=>item.status==='OPEN').length > 0 && <b className="service-tab-count">{customerQuotes.filter((item)=>item.status==='OPEN').length}</b>}</button>}
          {canEditCosts && <button className={tab === 'INVOICES' ? 'active' : ''} onClick={() => setTab('INVOICES')}><FileArchive size={15}/> Magazyn faktur</button>}
          {isActualTechnician && <button className={tab === 'TECH_NOTES' ? 'active' : ''} onClick={() => setTab('TECH_NOTES')}><NotebookPen size={15}/> Moje notatki</button>}
          {canManageGmail && <button className={tab === 'EMAILS' ? 'active' : ''} onClick={() => { setTab('EMAILS'); void loadMailData(pointId); }}><BellRing size={15}/> Powiadomienia</button>}
        </div>
      </section>

      {cardChoice && <div className="service-card-choice-backdrop" role="presentation">
        <section className="service-card-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="service-card-choice-title">
          <div className="service-card-choice-icon"><Printer size={24}/></div>
          <span>KARTA SERWISOWA · ZLECENIE #{cardChoice.orderNumber}</span>
          <h2 id="service-card-choice-title">Jaką kartę przygotować przy ladzie?</h2>
          <p>Karta klienta PDF została automatycznie przypięta do potwierdzenia e-mail. Wybierz wydruk dla obsługi fizycznej urządzenia.</p>
          <div className="service-card-choice-options">
            <button disabled={cardBusy} onClick={()=>void openCreatedServiceCard('PHYSICAL_AND_ONLINE')}>
              <strong>A4 · fizyczna + online</strong><span>Pozioma kartka: karta urządzenia + karta klienta, z linią cięcia pośrodku.</span>
            </button>
            <button disabled={cardBusy} onClick={()=>void openCreatedServiceCard('ONLINE_ONLY')}>
              <strong>Tylko online</strong><span>Drukowana jest wyłącznie karta do urządzenia. Klient korzysta z PDF/QR z e-maila i panelu.</span>
            </button>
          </div>
          {cardBusy && <small>Generuję zabezpieczony PDF…</small>}
        </section>
      </div>}
      {isActualTechnician && <MonthlyInvoicePrompt onOpenWarehouse={() => setTab('INVOICES')}/>}
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
      {tab === 'INVOICES' && canEditCosts && <InvoiceWarehouse/>}
      {tab === 'TECH_NOTES' && isActualTechnician && <TechnicianNotesRoom/>}

      {tab === 'NEW' && (
        <div className="service-grid">
          <section className="panel-card service-card">
            <div className="panel-heading"><div><span className="eyebrow"><Search size={13}/> KLIENT</span><h2>Wyszukaj istniejącego</h2></div></div>
            <div className="service-search-row">
              <input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter') void search(); }} placeholder="Nazwisko, email lub telefon"/>
              <button className="button secondary" disabled={searchBusy||query.trim().length<2} onClick={()=>void search()}><Search className={searchBusy?'spin':''} size={14}/>{searchBusy?' Szukam…':' Szukaj'}</button>
            </div>
            <div className="service-customer-results">
              {matches.map((customer)=><button key={customer.id} onClick={()=>useCustomer(customer)}>
                <UserRound size={16}/><span><strong>{customer.firstName} {customer.lastName}</strong><small>{customer.email || customer.phone || 'Brak kontaktu'}</small></span>
              </button>)}
            </div>
            <div className="service-form-grid">
              <label><span>Imię</span><input value={form.firstName} onChange={(e)=>update('firstName',e.target.value)} /></label>
              <label><span>Nazwisko</span><input value={form.lastName} onChange={(e)=>update('lastName',e.target.value)} /></label>
              <label><span>Email</span><input type="email" value={form.email} onChange={(e)=>update('email',e.target.value)} /></label>
              <label><span>Telefon</span><input value={form.phone} onChange={(e)=>update('phone',e.target.value)} /></label>
            </div>
          </section>

          <section className="panel-card service-card">
            <div className="panel-heading"><div><span className="eyebrow"><Smartphone size={13}/> URZĄDZENIE</span><h2>Telefon i usterka</h2></div></div>
            <div className="service-form-grid">
              <label><span>Marka</span><input value={form.brand} onChange={(e)=>update('brand',e.target.value)} /></label>
              <label><span>Model</span><input value={form.model} onChange={(e)=>update('model',e.target.value)} /></label>
              <label><span>IMEI</span><input inputMode="numeric" maxLength={16} value={form.imei} onChange={(e)=>update('imei',e.target.value.replace(/\D/g,''))} placeholder="Opcjonalnie"/></label>
              <label><span>Numer seryjny</span><input maxLength={120} value={form.serialNumber} onChange={(e)=>update('serialNumber',e.target.value)} placeholder="Opcjonalnie"/></label>
              <div className="service-auto-intake full">
                <div><MapPin size={15}/><span>Punkt przyjęcia</span><strong>{pointOptions.find((p)=>p.id===pointId)?.name ?? 'Brak aktywnego punktu'}</strong></div>
                <div><ClipboardList size={15}/><span>Sposób obsługi</span><strong>{form.orderType==='COMPLAINT'?'Reklamacja — ustawione automatycznie':'Standardowa naprawa — ustawione automatycznie'}</strong></div>
              </div>
              <label><span>Typ</span><select value={form.orderType} onChange={(e)=>update('orderType', e.target.value as 'REPAIR' | 'COMPLAINT')}><option value="REPAIR">Naprawa</option><option value="COMPLAINT">Reklamacja</option></select></label>
              {canEditStatus && <label><span>Przewidywany termin</span><input type="datetime-local" value={form.estimatedCompletionAt} onChange={(e)=>update('estimatedCompletionAt',e.target.value)} /></label>}
              {canManageOrderMeta && <label><span>Technik</span><select value={form.assignedTechnicianId} onChange={(e)=>update('assignedTechnicianId',e.target.value)}><option value="">Nieprzypisany</option>{technicians.map((technician)=><option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></label>}
              {canEditCosts && <label><span>Cena orientacyjna (PLN)</span><input type="number" min="0" step="0.01" value={form.estimatedCost} onChange={(e)=>update('estimatedCost',e.target.value)} placeholder="0,00"/></label>}
              <label className="full"><span>Uwagi do urządzenia</span><textarea rows={3} maxLength={1000} value={form.deviceNotes} onChange={(e)=>update('deviceNotes',e.target.value)} placeholder="Stan obudowy, hasło serwisowe przekazane osobno, akcesoria…"/></label>
              <label className="full"><span>Opis usterki</span><textarea rows={6} value={form.issueDescription} onChange={(e)=>update('issueDescription',e.target.value)} /></label>
            </div>
            <button className="button primary wide service-submit" disabled={busy || !pointId} onClick={()=>void submit()}>{busy ? 'Zapisywanie…' : 'Utwórz zlecenie'}</button>
            <small className="service-intake-email-note">Po przyjęciu klient zawsze otrzymuje e-mail z kartą serwisową PDF i bezpośrednim QR do swojego panelu.</small>
          </section>
        </div>
      )}

      {tab === 'ORDERS' && (
        <section className="panel-card service-orders-card">
          <div className="panel-heading">
            <div><span className="eyebrow"><ClipboardList size={13}/> ZLECENIA</span><h2>Ostatnie naprawy</h2><p>Widoczne są wyłącznie zlecenia z punktów dostępnych dla Twojego konta.</p></div>
            <button className="button small secondary" disabled={ordersBusy} onClick={() => void loadOrders()}><RefreshCw className={ordersBusy ? 'spin' : ''} size={14}/> Odśwież</button>
          </div>
          <div className="service-workflow-filters">
            {workflowFilters.map((filter)=><button
              key={filter.code}
              className={orderFilter===filter.code?'active':''}
              onClick={()=>setOrderFilter(filter.code)}
            ><span>{filter.label}</span><strong>{filter.count}</strong></button>)}
          </div>
          <div className="service-orders-list">
            {visibleOrders.map((order) => {
              const draft = detailsDrafts[order.id];
              const card = customerCards[order.customerId];
              const notes = orderNotes[order.id] ?? [];
              const currentServicePointId = order.openTransfer ? '' : (order.currentPointId || order.homePointId || order.pointId);
              const pointTechnicians = currentServicePointId ? (techniciansByPoint[currentServicePointId] ?? []) : [];
              const canOperateCurrentPoint = Boolean(currentServicePointId) && pointId === currentServicePointId && (['OWNER','BOSS'].includes(effectiveRole) || pointOptions.some((point)=>point.id===currentServicePointId));
              const canEditOrderHere = canEditStatus && canOperateCurrentPoint && !order.openTransfer;
              const canEditIntakeHere = canEditIntake && canOperateCurrentPoint && !order.openTransfer;
              const canTransferHere = canTransferService && canOperateCurrentPoint && !order.openTransfer;
              const canCancelHere = canCancelService && canOperateCurrentPoint && !order.openTransfer;
              const canUseOrderFinance = canEditCosts && (!isActualTechnician || order.assignedTechnicianId === auth.user?.id);
              return (
                <article key={order.id} data-service-order-id={order.id} className={`service-order-wrap ${expandedOrderId === order.id ? 'expanded' : ''} workflow-${(order.workflow?.attentionCode || 'ACTIVE').toLowerCase()}`}>
                  <div className="service-order-row">
                    <div className="service-order-number"><strong>#{order.orderNumber}</strong><span>{new Date(order.receivedAt).toLocaleString('pl-PL')}</span></div>
                    <div className="service-order-main">
                      <strong>{order.customerName}</strong>
                      <span>{order.brand} {order.model} · {order.pointName}</span>
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
                          : <><span><UserCog size={11}/>{order.assignedTechnicianName || 'Nieprzypisany'}</span><span><CalendarClock size={11}/>{order.estimatedCompletionAt ? new Date(order.estimatedCompletionAt).toLocaleString('pl-PL') : 'Brak terminu'}</span></>}
                        <span><MapPin size={11}/>Macierzysty: {order.homePointName || order.pointName}</span>
                        <span><Truck size={11}/>Lokalizacja: {order.currentLocationLabel || order.currentPointName || order.pointName}</span>
                        {canEditCosts && order.handlingMode !== 'TRANSFER_ONLY' && <span><BadgeDollarSign size={11}/>{order.finalCost != null ? `${order.finalCost.toFixed(2)} PLN` : order.estimatedCost != null ? `~${order.estimatedCost.toFixed(2)} PLN` : 'Brak wyceny'}</span>}
                      </div>
                    </div>
                    <div className="service-order-actions">
                      <div className="service-order-status">
                        {canCancelHere && !canEditStatus && order.status !== 'CANCELLED' ? (
                          <div className="transfer-only-status"><span className="status-badge">{order.handlingMode === 'TRANSFER_ONLY' ? 'Tylko przekazanie' : order.statusLabel}</span><button className="button small danger-soft" disabled={Boolean(orderBusyId)} onClick={() => void changeStatus(order,'CANCELLED')}>Anuluj</button></div>
                        ) : canEditOrderHere && order.handlingMode === 'TRANSFER_ONLY' ? (
                          <div className="transfer-only-status"><span className="status-badge">Tylko przekazanie</span>{order.status !== 'CANCELLED' && <button className="button small danger-soft" disabled={Boolean(orderBusyId)} onClick={() => void changeStatus(order,'CANCELLED')}>Anuluj</button>}</div>
                        ) : canEditOrderHere ? (
                          <select value={order.status} disabled={Boolean(orderBusyId)} onChange={(e) => void changeStatus(order, e.target.value)}>
                            {statuses.map(([value,label]) => <option key={value} value={value} disabled={(value==='READY' && (order.canMarkReady===false || order.status!=='REPAIR_DONE')) || (value==='COMPLETED' && order.status!=='READY')}>{label}</option>)}
                          </select>
                        ) : (
                          <div className="service-status-readonly">
                            <span className="status-badge">{order.handlingMode==='TRANSFER_ONLY' && order.status!=='CANCELLED' ? 'Tylko przekazanie' : order.statusLabel}</span>
                            {canEditStatus && <small>{order.openTransfer ? 'Status zablokowany na czas transportu.' : 'Status zmienia punkt, w którym fizycznie znajduje się urządzenie.'}</small>}
                          </div>
                        )}
                      </div>
                      <button className="button small secondary service-history-button" onClick={() => void toggleOrderHistory(order)}>
                        <History size={13}/>
                        Szczegóły
                        {expandedOrderId === order.id ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                      </button>
                    </div>
                  </div>

                  {expandedOrderId === order.id && (
                    <div className="service-order-workspace">
                      {historyBusyId === order.id && <div className="service-history-empty">Pobieram pełne dane zlecenia…</div>}

                      {draft && (
                        <section className="service-workspace-card">
                          <div className="service-workspace-title"><Smartphone size={15}/><div><strong>Urządzenie i realizacja</strong><span>Dane techniczne, termin i przypisanie naprawy.</span></div></div>
                          <div className="service-details-grid">
                            <label><span>IMEI</span><input disabled={!canEditIntakeHere} inputMode="numeric" maxLength={16} value={draft.imei} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],imei:e.target.value.replace(/\D/g,'')}}))}/></label>
                            <label><span>Numer seryjny</span><input disabled={!canEditIntakeHere} maxLength={120} value={draft.serialNumber} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],serialNumber:e.target.value}}))}/></label>
                            {order.handlingMode !== 'TRANSFER_ONLY' && canEditStatus && <label><span>Przewidywany termin</span><input disabled={!canEditOrderHere} type="datetime-local" value={draft.estimatedCompletionAt} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],estimatedCompletionAt:e.target.value}}))}/></label>}
                            {order.handlingMode !== 'TRANSFER_ONLY' && canManageOrderMeta && <label><span>Technik</span><select disabled={!canEditOrderHere} value={draft.assignedTechnicianId} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],assignedTechnicianId:e.target.value}}))}><option value="">Nieprzypisany</option>{pointTechnicians.map((technician)=><option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></label>}
                            {order.handlingMode !== 'TRANSFER_ONLY' && canEditCosts && <label><span>Cena orientacyjna (PLN)</span><input disabled={!canEditOrderHere} type="number" min="0" step="0.01" value={draft.estimatedCost} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],estimatedCost:e.target.value}}))}/></label>}
                            {order.handlingMode !== 'TRANSFER_ONLY' && canEditCosts && <label><span>Cena końcowa (PLN)</span><input disabled={!canEditOrderHere} type="number" min="0" step="0.01" value={draft.finalCost} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],finalCost:e.target.value}}))}/></label>}
                            <label className="full"><span>Uwagi do urządzenia</span><textarea disabled={!canEditIntakeHere} rows={3} maxLength={1000} value={draft.deviceNotes} onChange={(e)=>setDetailsDrafts((current)=>({...current,[order.id]:{...current[order.id],deviceNotes:e.target.value}}))}/></label>
                          </div>
                          {canEditIntakeHere && <button className="button primary small" disabled={Boolean(orderBusyId)} onClick={()=>void saveOrderDetails(order)}><Save size={13}/>{orderBusyId===order.id?'Zapisywanie…':'Zapisz szczegóły'}</button>}
                        </section>
                      )}

                      {canUseOrderFinance && <OrderCostingCard order={order}/>}

                      <section className="service-workspace-card service-transfer-card">
                        <div className="service-workspace-title"><Truck size={15}/><div><strong>Logistyka urządzenia</strong><span>Punkt macierzysty jest stały, a transport jest prowadzony niezależnie od statusu naprawy.</span></div></div>
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
                      </section>

                      <section className="service-workspace-card service-print-card">
                        <div className="service-workspace-title"><Printer size={15}/><div><strong>Karta serwisowa</strong><span>QR klienta otwiera portal bez wpisywania kodu; QR urządzenia obsługuje logistykę pracownika.</span></div></div>
                        <div className="service-print-card-actions">
                          <button className="button secondary small" disabled={Boolean(serviceCardBusyId)} onClick={()=>void reopenServiceCard(order,'PHYSICAL_AND_ONLINE')}><Printer size={13}/> A4: klient + urządzenie</button>
                          <button className="button secondary small" disabled={Boolean(serviceCardBusyId)} onClick={()=>void reopenServiceCard(order,'ONLINE_ONLY')}><Printer size={13}/> Tylko karta urządzenia</button>
                        </div>
                      </section>

                      <section className="service-workspace-card">
                        <div className="service-workspace-title"><IdCard size={15}/><div><strong>Karta klienta</strong><span>Historia widoczna tylko w Twoim zakresie punktów.</span></div></div>
                        {card ? <>
                          <div className="service-customer-card-head">
                            <div><strong>{card.customer.firstName} {card.customer.lastName}</strong><span>{card.customer.email || 'brak e-maila'} · {card.customer.phone || 'brak telefonu'}</span></div>
                            <b>{card.totalVisibleOrders} zleceń</b>
                          </div>
                          <div className="service-customer-order-mini">
                            {card.orders.slice(0,5).map((item)=><div key={item.id}><span>#{item.orderNumber} · {item.brand} {item.model}</span><small>{item.statusLabel} · {new Date(item.receivedAt).toLocaleDateString('pl-PL')}</small></div>)}
                          </div>
                        </> : <div className="service-history-empty">Pobieram kartę klienta…</div>}
                      </section>

                      <section className="service-workspace-card">
                        <div className="service-workspace-title"><StickyNote size={15}/><div><strong>Notatki wewnętrzne</strong><span>Nie są wysyłane klientowi.</span></div></div>
                        {canEditStatus && <div className="service-note-compose">
                          <textarea rows={3} maxLength={2000} value={noteDrafts[order.id] ?? ''} onChange={(e)=>setNoteDrafts((current)=>({...current,[order.id]:e.target.value}))} placeholder="Diagnoza technika, zamówione części, ustalenia z klientem…"/>
                          <button className="button secondary small" disabled={Boolean(orderBusyId) || !(noteDrafts[order.id] ?? '').trim()} onClick={()=>void addOrderNote(order.id)}>Dodaj notatkę</button>
                        </div>}
                        <div className="service-note-list">
                          {notes.map((note)=><div key={note.id}><div><strong>{note.authorName}</strong><span>{new Date(note.createdAt).toLocaleString('pl-PL')}</span></div><p>{note.body}</p></div>)}
                          {notes.length===0 && <div className="service-history-empty">Brak notatek wewnętrznych.</div>}
                        </div>
                      </section>

                      <section className="service-workspace-card service-workspace-history">
                        <div className="service-workspace-title"><History size={15}/><div><strong>Historia statusów</strong><span>Pełna oś czasu zlecenia #{order.orderNumber}</span></div></div>
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
                        {(orderHistories[order.id] ?? []).length === 0 && <div className="service-history-empty">Brak zapisanych zmian statusu.</div>}
                      </section>
                    </div>
                  )}
                </article>
              );
            })}
            {!ordersBusy && orders.length === 0 && <div className="service-empty">Brak zleceń w Twoim zakresie.</div>}
            {!ordersBusy && orders.length > 0 && visibleOrders.length === 0 && <div className="service-empty">Brak zleceń w wybranej sekcji.</div>}
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
