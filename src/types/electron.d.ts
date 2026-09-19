export type UpdateState =
  | { status: 'idle'; message: string }
  | { status: 'checking'; message: string }
  | { status: 'available'; message: string; version: string }
  | { status: 'not-available'; message: string; version: string }
  | { status: 'downloading'; message: string; percent: number }
  | { status: 'downloaded'; message: string; version: string }
  | { status: 'error'; message: string }
  | { status: 'development'; message: string };

export interface AppInfo { name: string; author: string; version: string; platform: string; packaged: boolean; apiBaseUrl?: string; }
export interface SplashProgress { percent: number; label: string; }
export type UserRole = 'OWNER' | 'BOSS' | 'COORDINATOR' | 'SUPPORT' | 'TECHNICIAN' | 'USER';
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED';
export interface AuthUser { id?: string; email: string; name: string; picture?: string | null; }
export interface AuthPoint { id: string; name: string; city?: string; }
export interface RequestedPoint { pointName: string; city: string; requestedRole: UserRole; technicianSplitPercent?:number|null; requestedAt: string; }
export interface AuthState {
  configured: boolean; authenticated: boolean; development: boolean; localStarterLoginAllowed: boolean;
  user: AuthUser | null; point: AuthPoint | null; points: AuthPoint[]; role: UserRole | null; status: AccountStatus | null;
  technicianSplitPercent?:number|null; supportEnabled?:boolean; requestedPoint?: RequestedPoint | null; message?: string;
}
export interface BrowserState { url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; }
export interface BrowserBounds { x: number; y: number; width: number; height: number; }
export interface AdminUser { id: string; email: string; name: string; picture?: string | null; role: UserRole | null; technicianSplitPercent?:number|null; supportEnabled?:boolean; status: AccountStatus; blocked?:boolean; blockedAt?:string|null; blockedReason?:string|null; pointIds: string[]; requestedPoint?: RequestedPoint | null; firstLoginAt: string; lastLoginAt: string; }
export interface AdminPoint {
  id:string; name:string; city:string; active:boolean;
  serviceEnabled?:boolean; acceptsExternalRepairs?:boolean;
  manualServiceEnabled?:boolean; manualAcceptsExternalRepairs?:boolean;
  externalRepairsPaused?:boolean; activeTechnicianCount?:number; autoServiceEnabled?:boolean;
  serviceNote?:string|null;
}
export interface LoginEvent { id: string; userId: string; email: string; name: string; role: UserRole | null; status: AccountStatus; pointIds: string[]; createdAt: string; }
export interface RevenueEntry { id: string; userId: string; pointId: string; serviceOrderId?:string|null; orderNumber?:number|null; amount: number; workDate: string; note: string; status: 'PENDING'|'APPROVED'|'REJECTED'|'SETTLED'; splitTechnicianPercent: number; splitBossPercent: number; technicianShare: number; bossShare: number; submittedAt: string; reviewedAt?: string|null; technician?: {id:string;name:string;email:string}|null; point?: AdminPoint|null; }
export interface AdminAuditEvent { id:string; action:string; entityType:string; entityId?:string|null; entityName?:string|null; pointId?:string|null; pointName?:string|null; actorUserId?:string|null; actorName:string; actorEmail?:string|null; actorRole?:UserRole|null; before?:unknown; after?:unknown; orderNumber?:number|null; customerSummary?:string|null; deviceSummary?:string|null; notificationStatus?:string|null; transferStatus?:string|null; settlementStatus?:string|null; clientType?:string|null; metadata:Record<string,unknown>; createdAt:string; }
export interface AdminAuditFilters { userId?:string; pointId?:string; action?:string; orderNumber?:string; dateFrom?:string; dateTo?:string; }
export interface AdminSystemSummary { activeSessions:number; desktopSessions:number; webSessions:number; servicePoints:number; openTransfers:number; blockedUsers:number; }
export interface AdminOverview { points: AdminPoint[]; users: AdminUser[]; pendingUsers: AdminUser[]; blockedUsers?:AdminUser[]; loginEvents: LoginEvent[]; pendingRevenue: RevenueEntry[]; system?:AdminSystemSummary; transferSummary?:Record<string,number>; recentAudit?:AdminAuditEvent[]; }
export interface FinancePointBreakdown { pointId:string; pointName:string; pointCity?:string; approvedRevenue:number; technicianShare:number; bossShare:number; pendingRevenue:number; entries:RevenueEntry[]; }
export interface FinancePayload { entries: RevenueEntry[]; points: FinancePointBreakdown[]; summary: { approvedRevenue:number; technicianShare:number; bossShare:number; pendingRevenue:number; }; }
export interface TechnicianSettlementSettings { configured:boolean; technicianPercent:number|null; bossPercent:number|null; }
export interface DashboardData { pointCount:number; activeUsers:number; pendingUsers:number; approvedRevenue:number; pendingRevenue:number; bossShare:number; technicianShare:number; }
export interface ServiceCustomer { id:string; firstName:string; lastName:string; email?:string|null; phone?:string|null; }
export interface ServiceOrder { id:string; orderNumber?:number; pointId:string; homePointId?:string; currentPointId?:string|null; customerId:string; deviceId:string; orderType:'REPAIR'|'COMPLAINT'; handlingMode:'STANDARD'|'TRANSFER_ONLY'; issueDescription:string; status:string; receivedAt:string; }
export interface ServiceWorkflow {
  stageNumber:number; stageTotal:number; stageLabel:string;
  nextActionCode:string; nextAction:string;
  attentionCode:'OVERDUE'|'DUE_SOON'|'ACTION_NOW'|'IN_TRANSIT'|'WAITING_SERVICE'|'WAITING_PARTS'|'READY_FOR_PICKUP'|'ACTIVE'|'CLOSED';
  attentionLabel:string; flags:string[]; dueAt?:string|null; dueInMinutes?:number|null;
  progressPercent:number; sortRank:number; canMarkReady:boolean;
}
export interface ServiceOrderSummary extends ServiceOrder {
  pointName:string; homePointName?:string; currentPointName?:string|null; currentLocationLabel?:string|null;
  returnRequired?:boolean; canMarkReady?:boolean; openTransfer?:ServiceTransfer|null;
  customerName:string; customerEmail?:string|null; customerPhone?:string|null;
  brand:string; model:string; imei?:string|null; serialNumber?:string|null; deviceNotes?:string|null;
  statusLabel:string; assignedTechnicianId?:string|null; assignedTechnicianName?:string|null; assignedTechnicianEmail?:string|null;
  estimatedCost?:number|null; finalCost?:number|null; currency?:string; estimatedCompletionAt?:string|null;
  completedAt?:string|null; createdAt?:string; updatedAt?:string;
  workflow?:ServiceWorkflow;
  latestTransfer?:ServiceTransfer|null; transfers?:ServiceTransfer[];
}
export interface ServiceCreateOrderResult { customer:ServiceCustomer; order:ServiceOrder; reusedCustomer:boolean; reusedDevice?:boolean; notification?:{queued:boolean;sent:boolean;reason?:string;status?:string;attempts?:number;nextAttemptAt?:string;messageId?:string}; }
export interface ServiceStatusResult {
  order:ServiceOrderSummary;
  notification:{queued:boolean;sent:boolean;reason?:string;status?:string;attempts?:number;nextAttemptAt?:string;messageId?:string};
  settlement?:{id:string;amount:number;currency:string;status:string;serviceOrderId:string;userId:string;pointId:string;technicianPercent?:number;bossPercent?:number;technicianShare?:number;bossShare?:number;approvedAt?:string|null}|null;
}
export interface ServiceStatusHistoryItem { id:string; fromStatus?:string|null; fromLabel?:string|null; toStatus:string; toLabel:string; note?:string|null; changedAt:string; changedByUserId?:string|null; changedByName:string; }
export interface ServiceTechnician { id:string; name:string; email:string; }
export interface ServiceOrderNote { id:string; body:string; createdAt:string; authorUserId:string; authorName:string; }
export interface ServiceCustomerDevice { id:string; brand:string; model:string; imei?:string|null; serialNumber?:string|null; notes?:string|null; }
export interface ServiceTransfer {
  id:string; orderId:string; orderNumber?:number; customerName?:string; device?:string;
  fromPointId:string; fromPointName?:string; fromPointCity?:string;
  toPointId:string; toPointName?:string; toPointCity?:string;
  kind:'OUTBOUND_SERVICE'|'RETURN_HOME';
  status:'REQUESTED'|'IN_TRANSIT'|'DELIVERED'|'ACCEPTED'|'REJECTED'|'CANCELLED';
  note?:string|null; sentByUserId:string; sentByName?:string; acceptedByUserId?:string|null; acceptedByName?:string|null;
  requestedAt:string; shippedAt?:string|null; deliveredAt?:string|null; acceptedAt?:string|null; updatedAt:string;
}
export interface ServiceCustomerDetail { customer:ServiceCustomer & {createdAt?:string;updatedAt?:string}; devices:ServiceCustomerDevice[]; orders:ServiceOrderSummary[]; totalVisibleOrders:number; }
export interface GmailConnectionStatus { connected:boolean; needsReconnect?:boolean; connectionState?:'CONNECTED'|'NOT_CONNECTED'|'REAUTH_REQUIRED'|'TEMPORARY_ERROR'; pointId:string; senderPointId?:string; inherited?:boolean; email?:string; status?:string; lastError?:string|null; connectedAt?:string; checkedAt?:string; recoveredNotifications?:number; }
export interface NotificationSettings { pointId:string; automaticEmailEnabled:boolean; notifyStatuses:string[]; senderDisplayName:string; footerText:string; updatedAt?:string; }
export interface NotificationHistoryItem { id:string; orderId?:string|null; orderNumber?:number|null; recipient:string; status:'PENDING'|'PROCESSING'|'SENT'|'FAILED'|'CANCELLED'; attempts:number; subject?:string|null; providerMessageId?:string|null; lastError?:string|null; availableAt:string; sentAt?:string|null; createdAt:string; updatedAt:string; customerName?:string|null; device?:string|null; }
export interface GmailTestResult { ok:true; recipient:string; messageId:string; }
export interface NotificationRetryResult { id:string; sent:boolean; status?:string; reason?:string; attempts?:number; nextAttemptAt?:string; messageId?:string; }
export interface HelpAction {
  type:'WEBSITE_CODE'|'NAVIGATE'|'OPEN_ORDER'|'OPEN_USER'|string;
  label?:string; target?:string; code?:string; expiresAt?:string;
  orderId?:string; orderNumber?:number; userId?:string;
}
export interface HelpMessage { id:string; author:'user'|'support'|'system'|'assistant'; text:string; action?:HelpAction|null; createdAt:string; }
export interface HelpConversation {
  id:string; status:string; consultantState?:'BOT'|'WAITING'|'JOINED';
  consultantRequestedAt?:string|null; consultantJoinedAt?:string|null;
  assignedSupportUserId?:string|null; assignedSupportName?:string|null;
  messages:HelpMessage[];
}
export interface AssistantReply { userMessage:HelpMessage; assistantMessage:HelpMessage|null; action?:HelpAction|null; consultantState?:'BOT'|'WAITING'|'JOINED'; }
export interface WebsiteAuthCode { code:string; expiresAt:string; }
export interface SupportPresence {
  userId:string; name:string; email:string; role:UserRole|null; supportEnabled:boolean;
  online:boolean; lastSeenAt:string; clientTypes:string[]; conversationId?:string|null;
  consultantState:'BOT'|'WAITING'|'JOINED'; assignedSupportUserId?:string|null; assignedSupportName?:string|null;
  conversationUpdatedAt?:string|null;
}
export interface SupportTicket {
  id:string; userId:string; userName:string; userEmail:string; pointId:string|null; pointName:string; status:'OPEN'|'CLOSED';
  assignedSupportUserId:string|null; assignedSupportName:string|null; consultantRequestedAt?:string|null; consultantJoinedAt?:string|null;
  createdAt:string; updatedAt:string; messages:HelpMessage[];
}
export interface CustomerQuoteMessage { id:string; senderKind:'CUSTOMER'|'STAFF'|'SYSTEM'; senderName?:string|null; body:string; createdAt:string; }
export interface CustomerQuoteRequest {
  id:string; customerId:string; customerName:string; customerEmail?:string|null; customerPhone?:string|null;
  requestedPointId:string; requestedPointName:string; routedPointId:string; routedPointName:string;
  assignedTechnicianId?:string|null; assignedTechnicianName?:string|null; serviceOrderId?:string|null; orderNumber?:number|null;
  deviceDescription:string; issueDescription:string; status:'OPEN'|'QUOTED'|'CLOSED'|'CANCELLED';
  quoteAmount?:number|null; currency:string; quoteNote?:string|null; routingReason:string;
  createdAt:string; updatedAt:string; quotedAt?:string|null; closedAt?:string|null; messages:CustomerQuoteMessage[];
}

declare global {
  interface Window {
    lockOn: {
      app: { getInfo: () => Promise<AppInfo> };
      ui: { setScale: (scale:'auto'|'compact'|'comfortable'|'large') => Promise<number>; };
      window: { minimize: () => Promise<void>; toggleMaximize: () => Promise<void>; close: () => Promise<void>; };
      auth: { getState: () => Promise<AuthState>; loginGoogle: () => Promise<AuthState>; loginLocal: () => Promise<AuthState>; logout: () => Promise<AuthState>; };
      access: { requestPoint: (payload:{pointName:string;city:string;requestedRole:UserRole;technicianSplitPercent?:number|null}) => Promise<AuthState>; };
      admin: {
        getOverview: () => Promise<AdminOverview>;
        getAudit: (filters?:AdminAuditFilters) => Promise<{events:AdminAuditEvent[]}>;
        createPoint: (payload:{name:string;city:string;serviceEnabled?:boolean;acceptsExternalRepairs?:boolean;serviceNote?:string}) => Promise<AdminPoint>;
        updatePointService: (pointId:string,payload:{serviceEnabled:boolean;acceptsExternalRepairs:boolean;externalRepairsPaused?:boolean;serviceNote?:string}) => Promise<AdminPoint>;
        approveUser: (userId:string,payload:{role:UserRole;pointIds:string[];createRequestedPoint?:boolean;supportEnabled?:boolean}) => Promise<unknown>;
        rejectUser: (userId:string) => Promise<unknown>;
        updateUserAccess: (userId:string,payload:{role:UserRole;pointIds:string[];technicianSplitPercent?:number|null;supportEnabled?:boolean}) => Promise<unknown>;
        blockUser: (userId:string,blocked:boolean,reason?:string) => Promise<AdminUser>;
        logoutUserSessions: (userId:string) => Promise<{ok:true;revoked:number}>;
        logoutAllSessions: (exceptCurrent?:boolean) => Promise<{ok:true;revoked:number;exceptCurrent:boolean}>;
        factoryResetPreview: () => Promise<{ok:true;counts:Record<string,number>}>;
        factoryReset: (payload:{phrase:string;confirmed:boolean;reason?:string}) => Promise<{ok:true;resetId:string;reloginRequired:true;deleted:Record<string,number>}>;
      };
      finance: {
        list: () => Promise<FinancePayload>;
        getTechnicianSettings: () => Promise<TechnicianSettlementSettings>;
        updateTechnicianSettings: (technicianPercent:number) => Promise<TechnicianSettlementSettings>;
        submit: (payload:{amount:number;pointId:string;workDate:string;note?:string}) => Promise<RevenueEntry>;
        review: (revenueId:string, action:'APPROVE'|'REJECT') => Promise<RevenueEntry>;
      };
      data: { getDashboard: () => Promise<DashboardData>; };
      service: {
        searchCustomers: (query:string) => Promise<ServiceCustomer[]>;
        getCustomer: (customerId:string) => Promise<ServiceCustomerDetail>;
        listTechnicians: (pointId:string) => Promise<ServiceTechnician[]>;
        listServicePoints: () => Promise<AdminPoint[]>;
        listTransfers: (incoming?:boolean,status?:string) => Promise<ServiceTransfer[]>;
        transferOrder: (orderId:string,payload:{toPointId?:string;note?:string;kind?:ServiceTransfer['kind']}) => Promise<{transfer:ServiceTransfer;notification?:NotificationRetryResult}>;
        updateTransferStatus: (transferId:string,status:ServiceTransfer['status'],note?:string) => Promise<{transfer:ServiceTransfer;notification?:NotificationRetryResult}>;
        createOrder: (payload:{pointId:string;firstName:string;lastName:string;email?:string;phone?:string;brand:string;model:string;imei?:string;serialNumber?:string;deviceNotes?:string;issueDescription:string;orderType:'REPAIR'|'COMPLAINT';handlingMode?:'STANDARD'|'TRANSFER_ONLY';assignedTechnicianId?:string;estimatedCost?:number|string;estimatedCompletionAt?:string}) => Promise<ServiceCreateOrderResult>;
        listOrders: () => Promise<ServiceOrderSummary[]>;
        getHistory: (orderId:string) => Promise<ServiceStatusHistoryItem[]>;
        getNotes: (orderId:string) => Promise<ServiceOrderNote[]>;
        addNote: (orderId:string,body:string) => Promise<ServiceOrderNote>;
        updateDetails: (orderId:string,payload:{imei?:string;serialNumber?:string;deviceNotes?:string;assignedTechnicianId?:string|null;estimatedCost?:number|string|null;finalCost?:number|string|null;estimatedCompletionAt?:string|null}) => Promise<ServiceOrderSummary>;
        updateStatus: (orderId:string,status:string,note?:string,actingPointId?:string) => Promise<ServiceStatusResult>;
        listCustomerQuotes: (pointId?:string) => Promise<CustomerQuoteRequest[]>;
        replyCustomerQuote: (requestId:string,message:string) => Promise<{ok:true}>;
        priceCustomerQuote: (requestId:string,amount:number,note?:string) => Promise<{ok:true;amount:number;currency:string}>;
        closeCustomerQuote: (requestId:string) => Promise<{ok:true}>;
      };
      gmail: {
        getStatus: (pointId:string) => Promise<GmailConnectionStatus>;
        connect: (pointId:string) => Promise<GmailConnectionStatus>;
        disconnect: (pointId:string) => Promise<{ok:true}>;
        test: (pointId:string) => Promise<GmailTestResult>;
      };
      notifications: {
        getSettings: (pointId:string) => Promise<NotificationSettings>;
        updateSettings: (payload:{pointId:string;automaticEmailEnabled:boolean;notifyStatuses:string[];senderDisplayName:string;footerText:string}) => Promise<NotificationSettings & {ok:true}>;
        getHistory: (pointId:string) => Promise<NotificationHistoryItem[]>;
        retry: (notificationId:string) => Promise<NotificationRetryResult>;
      };
      assistant: {
        getConversation: () => Promise<HelpConversation>;
        send: (message:string) => Promise<AssistantReply>;
      };
      support: {
        request: (pointId?:string,message?:string) => Promise<{ok:true;conversationId:string;pointId:string;consultantState?:'WAITING'}>;
        presence: () => Promise<SupportPresence[]>;
        listTickets: () => Promise<SupportTicket[]>;
        take: (ticketId:string) => Promise<{ok:true}>;
        reply: (ticketId:string,message:string) => Promise<{ok:true}>;
        close: (ticketId:string) => Promise<{ok:true}>;
      };
      website: { createAuthCode: () => Promise<WebsiteAuthCode>; };
      browser: {
        getState: () => Promise<BrowserState>; setVisible: (visible:boolean)=>Promise<void>; setBounds:(bounds:BrowserBounds)=>Promise<void>;
        navigate:(input:string)=>Promise<BrowserState>; back:()=>Promise<BrowserState>; forward:()=>Promise<BrowserState>; reload:()=>Promise<BrowserState>; home:()=>Promise<BrowserState>; openExternal:()=>Promise<void>;
        onState:(callback:(state:BrowserState)=>void)=>()=>void;
      };
      updater: { getState:()=>Promise<UpdateState>; check:()=>Promise<unknown>; download:()=>Promise<void>; install:()=>Promise<void>; onStatus:(callback:(state:UpdateState)=>void)=>()=>void; };
      splash: { onProgress:(callback:(payload:SplashProgress)=>void)=>()=>void; };
    };
  }
}
export {};
