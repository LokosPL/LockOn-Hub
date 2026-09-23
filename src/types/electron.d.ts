export type UpdateState =
  | { status: 'idle'; message: string }
  | { status: 'checking'; message: string }
  | { status: 'available'; message: string; version: string }
  | { status: 'not-available'; message: string; version: string }
  | { status: 'downloading'; message: string; percent: number }
  | { status: 'downloaded'; message: string; version: string }
  | { status: 'error'; message: string }
  | { status: 'development'; message: string };

export interface AppInfo { name: string; author: string; version: string; buildVersion: string; platform: string; packaged: boolean; apiBaseUrl?: string; }
export interface SplashProgress { percent: number; label: string; }
export type UserRole = 'OWNER' | 'BOSS' | 'COORDINATOR' | 'SUPPORT' | 'TECHNICIAN' | 'USER';
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED';
export interface AuthUser { id?: string; email: string; name: string; picture?: string | null; }
export interface AuthPoint { id: string; name: string; city?: string; }
export interface RequestedPoint { pointName: string; city: string; requestedRole: UserRole; technicianSplitPercent?:number|null; requestedAt: string; }
export interface AuthState {
  configured: boolean; authenticated: boolean; development: boolean; localStarterLoginAllowed: boolean;
  user: AuthUser | null; point: AuthPoint | null; points: AuthPoint[]; role: UserRole | null; status: AccountStatus | null;
  technicianSplitPercent?:number|null; supportEnabled?:boolean; requestedPoint?: RequestedPoint | null; gmailConnected?:boolean; gmailEmail?:string|null; gmailStatus?:string|null; message?: string;
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
export interface AdminSystemSummary { activeSessions:number; desktopSessions:number; webSessions:number; servicePoints:number; openTransfers:number; blockedUsers:number; customerGoogleAccounts?:number; customerPortalSessions?:number; blockedCustomerAccounts?:number; }
export interface AdminOverview { points: AdminPoint[]; users: AdminUser[]; pendingUsers: AdminUser[]; blockedUsers?:AdminUser[]; loginEvents: LoginEvent[]; pendingRevenue: RevenueEntry[]; system?:AdminSystemSummary; transferSummary?:Record<string,number>; recentAudit?:AdminAuditEvent[]; }
export interface CustomerNotificationPreferences { serviceUpdates:boolean; readyForPickup:boolean; quoteUpdates:boolean; messages:boolean; }
export interface CustomerAccountSummary {
  id:string; name:string; email?:string|null; phone?:string|null; codeCreatedAt?:string|null;
  googleLinked:boolean; googleEmail?:string|null; googleName?:string|null; googlePicture?:string|null;
  linkedAt?:string|null; lastLoginAt?:string|null; blocked:boolean; blockedAt?:string|null; blockedReason?:string|null;
  activeSessions:number; lastSeenAt?:string|null; orders:number; openQuotes:number;
  notificationPreferences:CustomerNotificationPreferences;
}
export interface CustomerAccountOverview {
  stats:{customers:number;googleAccounts:number;activeSessions:number;blocked:number};
  customers:CustomerAccountSummary[];
}

export interface FinancePointBreakdown { pointId:string; pointName:string; pointCity?:string; approvedRevenue:number; technicianShare:number; bossShare:number; pendingRevenue:number; entries:RevenueEntry[]; }
export interface FinancePayload { entries: RevenueEntry[]; points: FinancePointBreakdown[]; summary: { approvedRevenue:number; technicianShare:number; bossShare:number; pendingRevenue:number; }; }
export interface TechnicianSettlementSettings { configured:boolean; technicianPercent:number|null; bossPercent:number|null; }
export interface DashboardData { pointCount:number; activeUsers:number; pendingUsers:number; approvedRevenue:number; pendingRevenue:number; bossShare:number; technicianShare:number; }
export interface WeatherData { city:string; region?:string|null; country?:string|null; temperature:number; apparentTemperature:number; minTemperature:number; maxTemperature:number; windSpeed:number; weatherCode:number; condition:string; fetchedAt:string; }
export type MeetingStatus = 'SCHEDULED'|'LIVE'|'ENDED'|'CANCELLED';
export type MeetingAudienceType = 'ALL'|'POINTS'|'USERS';
export interface MeetingSummary {
  id:string; title:string; description:string; startsAt:string; expectedDurationMinutes:number; status:MeetingStatus;
  audienceType:MeetingAudienceType; allowParticipantAudio:boolean; allowParticipantScreenShare:boolean; maxParticipants:number;
  hostUserId:string; hostName:string; registeredCount:number; registered:boolean; canHost:boolean;
  startedAt?:string|null; endedAt?:string|null; cancelledAt?:string|null; createdAt:string; updatedAt:string;
}
export interface MeetingAudienceOptionPoint { id:string; name:string; city:string; }
export interface MeetingAudienceOptionUser { id:string; name:string; email?:string|null; role?:UserRole|null; }
export interface MeetingAudienceOptions { points:MeetingAudienceOptionPoint[]; users:MeetingAudienceOptionUser[]; }
export interface MeetingDetail extends MeetingSummary {
  audience?:{points:MeetingAudienceOptionPoint[];users:Array<{id:string;name:string;role?:UserRole|null}>}|null;
}
export interface MeetingCreateInput {
  title:string; description?:string; startsAt:string; expectedDurationMinutes:number; audienceType:MeetingAudienceType;
  pointIds?:string[]; userIds?:string[]; allowParticipantAudio:boolean; allowParticipantScreenShare:boolean; maxParticipants:number;
}
export interface MeetingAttendanceItem {
  userId:string; name:string; role?:UserRole|null; registered:boolean; joinCount:number; firstJoinedAt?:string|null;
  lastJoinedAt?:string|null; lastLeftAt?:string|null; present:boolean; totalSeconds:number;
}
export interface ServiceCustomer { id:string; firstName:string; lastName:string; email?:string|null; phone?:string|null; }
export interface ServiceOrder { id:string; orderNumber?:number; pointId:string; homePointId?:string; currentPointId?:string|null; customerId:string; deviceId:string; orderType:'REPAIR'|'COMPLAINT'; originalOrderId?:string|null; handlingMode:'STANDARD'|'COMPLAINT_FLOW'|'TRANSFER_ONLY'; issueDescription:string; status:string; receivedAt:string; }
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
  customerName:string; customerFirstName?:string; customerLastName?:string; customerEmail?:string|null; customerPhone?:string|null;
  brand:string; model:string; imei?:string|null; serialNumber?:string|null; deviceNotes?:string|null;
  statusLabel:string; assignedTechnicianId?:string|null; assignedTechnicianName?:string|null; assignedTechnicianEmail?:string|null;
  estimatedCost?:number|null; finalCost?:number|null; currency?:string; estimatedCompletionAt?:string|null; planPosition?:number;
  repairSummary?:string|null; warrantyMonths?:number|null; warrantyStartedAt?:string|null; warrantyExpiresAt?:string|null; warrantyCardPrintedAt?:string|null; warrantyCardPrintCount?:number; warrantyCardNumber?:string|null; warrantyReady?:boolean;
  completedAt?:string|null; createdAt?:string; updatedAt?:string;
  workflow?:ServiceWorkflow;
  latestTransfer?:ServiceTransfer|null; transfers?:ServiceTransfer[];
}
export interface ServiceCreateOrderResult { customer:ServiceCustomer; order:ServiceOrder; reusedCustomer:boolean; reusedDevice?:boolean; notification?:{queued:boolean;sent:boolean;reason?:string;status?:string;attempts?:number;nextAttemptAt?:string;messageId?:string}; serviceCard?:{required:boolean;printMode?:'PHYSICAL_AND_ONLINE'|'ONLINE_ONLY'|null;customerEmailRequired?:boolean}; }
export interface ServiceCardOpenResult { opened:boolean; filePath:string; fileName:string; printMode:'PHYSICAL_AND_ONLINE'|'ONLINE_ONLY'; staffScanCode?:string; }
export interface ServiceWarrantyUpdateResult { ok:true; warranty:{months:number;startedAt:string;expiresAt:string;cardPrintedAt?:string|null;cardPrintCount:number;repairSummary?:string|null;warrantyCardNumber?:string|null}; order:ServiceOrderSummary|null; }
export interface ServiceWarrantyCardOpenResult { opened:boolean; filePath:string; fileName:string; order?:ServiceOrderSummary|null; }
export interface ServiceScanResult { ok:true; scanAction:string; readyChanged:boolean; order:ServiceOrderSummary|null; notification?:NotificationRetryResult; }
export interface ServiceStatusResult {
  order:ServiceOrderSummary;
  notification:{queued:boolean;sent:boolean;reason?:string;status?:string;attempts?:number;nextAttemptAt?:string;messageId?:string};
  settlement?:{id:string;amount:number;currency:string;status:string;serviceOrderId:string;userId:string;pointId:string;technicianPercent?:number;bossPercent?:number;technicianShare?:number;bossShare?:number;approvedAt?:string|null}|null;
}
export interface ServiceStatusHistoryItem { id:string; fromStatus?:string|null; fromLabel?:string|null; toStatus:string; toLabel:string; note?:string|null; changedAt:string; changedByUserId?:string|null; changedByName:string; }
export interface ServiceTechnician { id:string; name:string; email:string; }
export interface ServiceOrderNote { id:string; body:string; createdAt:string; authorUserId:string; authorName:string; }
export interface ServiceOrderPart {
  id:string; description:string; quantity:number; unitCostGross:number; totalCostGross:number;
  invoiceReceived:boolean; invoiceNumber?:string|null; supplier?:string|null; purchasedAt?:string|null;
  createdAt?:string; updatedAt?:string;
}
export interface ServiceInvoice {
  id:string; orderId:string; orderNumber?:number|null; pointId?:string|null; pointName?:string|null; customerName?:string|null; device?:string|null;
  fileName:string; sizeBytes:number; invoiceNumber?:string|null; supplier?:string|null; invoiceDate?:string|null;
  grossAmount?:number|null; uploadedByUserId:string; uploadedByName?:string|null; createdAt:string; readyAt?:string|null;
}
export interface ServiceCosting {
  orderId:string; orderNumber:number; currency:string; parts:ServiceOrderPart[]; invoices:ServiceInvoice[];
  partsCostGross:number; laborCostGross:number; otherCostGross:number; internalCostGross:number;
  estimatedCost?:number|null; finalCost?:number|null; customerPrice?:number|null; marginGross?:number|null;
}
export interface TechnicianWorkspace {
  technician:{id:string;name:string;email:string};
  counts:{active:number;received:number;diagnosis:number;waitingParts:number;inRepair:number;readyForPickup:number;overdue:number};
  orders:ServiceOrderSummary[]; generatedAt:string;
}
export interface TechnicianPrivateNote { id:string; title:string; body:string; pinned:boolean; createdAt:string; updatedAt:string; }
export interface InvoiceMonthlyPrompt { show:boolean; period:string|null; count:number; dismissed:boolean; }
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
export interface GmailConnectionStatus { connected:boolean; needsReconnect?:boolean; connectionState?:'CONNECTED'|'NOT_CONNECTED'|'REAUTH_REQUIRED'|'TEMPORARY_ERROR'|'OWNER_PRIVACY'; pointId:string; senderPointId?:string; inherited?:boolean; email?:string; status?:string; lastError?:string|null; connectedAt?:string; checkedAt?:string; recoveredNotifications?:number; }
export interface NotificationSettings { pointId:string; automaticEmailEnabled:boolean; notifyStatuses:string[]; senderDisplayName:string; footerText:string; updatedAt?:string; }
export interface NotificationHistoryItem { id:string; orderId?:string|null; orderNumber?:number|null; recipient:string; status:'PENDING'|'PROCESSING'|'SENT'|'FAILED'|'CANCELLED'; attempts:number; subject?:string|null; providerMessageId?:string|null; lastError?:string|null; availableAt:string; sentAt?:string|null; createdAt:string; updatedAt:string; customerName?:string|null; device?:string|null; }
export interface GmailTestResult { ok:true; recipient:string; messageId:string; }
export interface NotificationRetryResult { id?:string; queued?:boolean; sent:boolean; status?:string; reason?:string; attempts?:number; nextAttemptAt?:string; messageId?:string; }
export interface HelpAction {
  type:'WEBSITE_CODE'|'NAVIGATE'|'OPEN_ORDER'|'OPEN_USER'|'SPEED_TEST'|'CONNECTIVITY_TEST'|'BROWSER_SEARCH'|string;
  label?:string; target?:string; code?:string; expiresAt?:string;
  orderId?:string; orderNumber?:number; userId?:string;
  provider?:'YOUTUBE'|'WEB'; query?:string;
}
export interface HelpMessage { id:string; author:'user'|'support'|'system'|'assistant'; text:string; action?:HelpAction|null; target?:'BOT'|'CONSULTANT'|null; createdAt:string; }
export interface HelpConversation {
  id:string; status:string; consultantState?:'BOT'|'WAITING'|'JOINED';
  consultantRequestedAt?:string|null; consultantJoinedAt?:string|null;
  assignedSupportUserId?:string|null; assignedSupportName?:string|null;
  messages:HelpMessage[];
}
export interface AssistantReply { userMessage:HelpMessage; assistantMessage:HelpMessage|null; action?:HelpAction|null; consultantState?:'BOT'|'WAITING'|'JOINED'; }
export interface WebsiteAuthCode { code:string; expiresAt:string; }
export interface InternetSpeedResult {
  testedAt:string; downloadMbps:number; uploadMbps:number|null; latencyMs:number;
  quality:string; provider:string; warning?:string|null;
}
export interface ConnectivityDiagnostics {
  testedAt:string; internetOk:boolean; internetLatencyMs:number|null; apiOk:boolean; apiLatencyMs:number|null;
  apiError?:string|null; version:string; buildVersion:string; platform:string; packaged:boolean; apiBaseUrl:string;
}
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
      app: { getInfo: () => Promise<AppInfo>; markReady: () => Promise<void>; };
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
      customers: {
        list: (query?:string) => Promise<CustomerAccountOverview>;
        updateProfile: (customerId:string,payload:{firstName:string;lastName:string;email?:string;phone?:string}) => Promise<{ok:true;customer:ServiceCustomer & {createdAt?:string;updatedAt?:string};googleDisconnected:boolean;revokedGoogleSessions:number}>;
        unlinkGoogle: (customerId:string) => Promise<{ok:true;unlinked:boolean;revoked:number}>;
        getCode: (customerId:string,rotate?:boolean) => Promise<{ok:true;code:string;created:boolean;rotated:boolean;revoked:number}>;
        sendCode: (customerId:string) => Promise<{ok:true;recipient:string;messageId:string}>;
        getNotificationPreferences: (customerId:string) => Promise<CustomerNotificationPreferences>;
        updateNotificationPreferences: (customerId:string,payload:Partial<CustomerNotificationPreferences>) => Promise<{ok:true;preferences:CustomerNotificationPreferences}>;
        block: (customerId:string,blocked:boolean,reason?:string) => Promise<{ok:true;blocked:boolean;revoked:number}>;
        logoutAll: (customerId:string) => Promise<{ok:true;revoked:number}>;
      };
      finance: {
        list: () => Promise<FinancePayload>;
        getTechnicianSettings: () => Promise<TechnicianSettlementSettings>;
        updateTechnicianSettings: (technicianPercent:number) => Promise<TechnicianSettlementSettings>;
        submit: (payload:{amount:number;pointId:string;workDate:string;note?:string}) => Promise<RevenueEntry>;
        review: (revenueId:string, action:'APPROVE'|'REJECT') => Promise<RevenueEntry>;
      };
      data: { getDashboard: () => Promise<DashboardData>; getWeather: (city:string) => Promise<WeatherData>; };
      meetings: {
        list: () => Promise<{meetings:MeetingSummary[]}>;
        getAudienceOptions: () => Promise<MeetingAudienceOptions>;
        get: (meetingId:string) => Promise<{meeting:MeetingDetail}>;
        create: (payload:MeetingCreateInput) => Promise<{meeting:MeetingDetail}>;
        register: (meetingId:string) => Promise<{meeting:MeetingDetail}>;
        unregister: (meetingId:string) => Promise<{meeting:MeetingDetail}>;
        start: (meetingId:string) => Promise<{meeting:MeetingDetail}>;
        end: (meetingId:string) => Promise<{meeting:MeetingDetail}>;
        cancel: (meetingId:string) => Promise<{meeting:MeetingDetail}>;
        getAttendance: (meetingId:string) => Promise<{attendance:MeetingAttendanceItem[]}>;
      };
      service: {
        searchCustomers: (query:string) => Promise<ServiceCustomer[]>;
        searchOrders: (query:string) => Promise<ServiceOrderSummary[]>;
        getCustomer: (customerId:string) => Promise<ServiceCustomerDetail>;
        listTechnicians: (pointId:string) => Promise<ServiceTechnician[]>;
        listServicePoints: () => Promise<AdminPoint[]>;
        listTransfers: (incoming?:boolean,status?:string) => Promise<ServiceTransfer[]>;
        transferOrder: (orderId:string,payload:{toPointId?:string;note?:string;kind?:ServiceTransfer['kind']}) => Promise<{transfer:ServiceTransfer;notification?:NotificationRetryResult}>;
        updateTransferStatus: (transferId:string,status:ServiceTransfer['status'],note?:string) => Promise<{transfer:ServiceTransfer;notification?:NotificationRetryResult}>;
        createOrder: (payload:{pointId:string;firstName:string;lastName:string;email?:string;phone?:string;brand?:string;model?:string;imei?:string;serialNumber?:string;deviceNotes?:string;issueDescription:string;orderType:'REPAIR'|'COMPLAINT';originalOrderId?:string;assignedTechnicianId?:string;estimatedCost?:number|string;estimatedCompletionAt?:string|null}) => Promise<ServiceCreateOrderResult>;
        openServiceCard: (orderId:string,printMode:'PHYSICAL_AND_ONLINE'|'ONLINE_ONLY') => Promise<ServiceCardOpenResult>;
        updateWarranty: (orderId:string,payload:{months:number;repairSummary:string}) => Promise<ServiceWarrantyUpdateResult>;
        openWarrantyCard: (orderId:string) => Promise<ServiceWarrantyCardOpenResult>;
        scanServiceCard: (payload:{actingPointId:string;token?:string;code?:string}) => Promise<ServiceScanResult>;
        listOrders: (limit?:number,offset?:number) => Promise<ServiceOrderSummary[]>;
        getHistory: (orderId:string) => Promise<ServiceStatusHistoryItem[]>;
        getNotes: (orderId:string) => Promise<ServiceOrderNote[]>;
        addNote: (orderId:string,body:string) => Promise<ServiceOrderNote>;
        getCosting: (orderId:string) => Promise<ServiceCosting>;
        saveCosting: (orderId:string,payload:{laborCostGross:number;otherCostGross:number;parts:Array<{description:string;quantity:number;unitCostGross:number;invoiceReceived:boolean;invoiceNumber?:string;supplier?:string;purchasedAt?:string}>}) => Promise<ServiceCosting>;
        uploadInvoice: (orderId:string,payload:{invoiceNumber?:string;supplier?:string;invoiceDate?:string;grossAmount?:number|string|null}) => Promise<{cancelled:boolean;invoice?:ServiceInvoice}>;
        downloadInvoice: (invoiceId:string) => Promise<{cancelled:boolean;filePath?:string}>;
        listInvoices: (month:string,pointId:string) => Promise<{period:string;pointId:string;invoices:ServiceInvoice[]}>;
        downloadInvoiceBatch: (month:string,pointId:string) => Promise<{cancelled:boolean;downloaded:number;folder?:string;failed?:number}>;
        deleteInvoice: (invoiceId:string) => Promise<{ok:true}>;
        getInvoiceMonthlyPrompt: () => Promise<InvoiceMonthlyPrompt>;
        dismissInvoiceMonthlyPrompt: (period:string) => Promise<{ok:true;period:string}>;
        getTechnicianWorkspace: () => Promise<TechnicianWorkspace>;
        listTechnicianNotes: () => Promise<TechnicianPrivateNote[]>;
        addTechnicianNote: (payload:{title?:string;body:string;pinned?:boolean}) => Promise<TechnicianPrivateNote>;
        updateTechnicianNote: (noteId:string,payload:{title?:string;body:string;pinned?:boolean}) => Promise<TechnicianPrivateNote>;
        deleteTechnicianNote: (noteId:string) => Promise<{ok:true}>;
        updateDetails: (orderId:string,payload:{imei?:string;serialNumber?:string;deviceNotes?:string;assignedTechnicianId?:string|null;estimatedCost?:number|string|null;finalCost?:number|string|null;estimatedCompletionAt?:string|null}) => Promise<ServiceOrderSummary>;
        updatePlan: (orderId:string,payload:{estimatedCompletionAt:string|null;targetIndex:number}) => Promise<{order:ServiceOrderSummary|null;notification?:NotificationRetryResult}>;
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
        send: (message:string,target?:'BOT'|'CONSULTANT') => Promise<AssistantReply>;
      };
      diagnostics: {
        internetSpeed: () => Promise<InternetSpeedResult>;
        connectivity: () => Promise<ConnectivityDiagnostics>;
      };
      support: {
        request: (pointId?:string,message?:string) => Promise<{ok:true;conversationId:string;pointId:string;consultantState?:'WAITING'}>;
        presence: () => Promise<SupportPresence[]>;
        listTickets: () => Promise<SupportTicket[]>;
        take: (ticketId:string) => Promise<{ok:true}>;
        reply: (ticketId:string,message:string) => Promise<{ok:true}>;
        close: (ticketId:string) => Promise<{ok:true}>;
        leave: () => Promise<{ok:true;consultantState?:'BOT'}>;
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
