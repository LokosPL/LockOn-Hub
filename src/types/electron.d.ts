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
export interface RequestedPoint { pointName: string; city: string; requestedRole: UserRole; requestedAt: string; }
export interface AuthState {
  configured: boolean; authenticated: boolean; development: boolean; localStarterLoginAllowed: boolean;
  user: AuthUser | null; point: AuthPoint | null; points: AuthPoint[]; role: UserRole | null; status: AccountStatus | null;
  requestedPoint?: RequestedPoint | null; message?: string;
}
export interface BrowserState { url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; }
export interface BrowserBounds { x: number; y: number; width: number; height: number; }
export interface AdminUser { id: string; email: string; name: string; picture?: string | null; role: UserRole | null; status: AccountStatus; pointIds: string[]; requestedPoint?: RequestedPoint | null; firstLoginAt: string; lastLoginAt: string; }
export interface AdminPoint { id: string; name: string; city: string; active: boolean; }
export interface LoginEvent { id: string; userId: string; email: string; name: string; role: UserRole | null; status: AccountStatus; pointIds: string[]; createdAt: string; }
export interface RevenueEntry { id: string; userId: string; pointId: string; amount: number; workDate: string; note: string; status: 'PENDING'|'APPROVED'|'REJECTED'; splitTechnicianPercent: number; splitBossPercent: number; technicianShare: number; bossShare: number; submittedAt: string; reviewedAt?: string|null; technician?: {id:string;name:string;email:string}|null; point?: AdminPoint|null; }
export interface AdminOverview { points: AdminPoint[]; users: AdminUser[]; pendingUsers: AdminUser[]; loginEvents: LoginEvent[]; pendingRevenue: RevenueEntry[]; }
export interface FinancePayload { entries: RevenueEntry[]; summary: { approvedRevenue:number; technicianShare:number; bossShare:number; pendingRevenue:number; }; }
export interface DashboardData { pointCount:number; activeUsers:number; pendingUsers:number; approvedRevenue:number; pendingRevenue:number; bossShare:number; technicianShare:number; }
export interface ServiceCustomer { id:string; firstName:string; lastName:string; email?:string|null; phone?:string|null; }
export interface ServiceOrder { id:string; orderNumber?:number; pointId:string; customerId:string; deviceId:string; orderType:'REPAIR'|'COMPLAINT'; issueDescription:string; status:string; receivedAt:string; }
export interface ServiceOrderSummary extends ServiceOrder { pointName:string; customerName:string; customerEmail?:string|null; customerPhone?:string|null; brand:string; model:string; statusLabel:string; assignedTechnicianId?:string|null; completedAt?:string|null; }
export interface ServiceCreateOrderResult { customer:ServiceCustomer; order:ServiceOrder; reusedCustomer:boolean; notification?:{queued:boolean;sent:boolean;reason?:string;status?:string;attempts?:number;nextAttemptAt?:string;messageId?:string}; }
export interface ServiceStatusResult { order:ServiceOrderSummary; notification:{queued:boolean;sent:boolean;reason?:string;status?:string;attempts?:number;nextAttemptAt?:string;messageId?:string}; }
export interface GmailConnectionStatus { connected:boolean; needsReconnect?:boolean; pointId:string; email?:string; status?:string; lastError?:string|null; connectedAt?:string; recoveredNotifications?:number; }
export interface NotificationSettings { pointId:string; automaticEmailEnabled:boolean; notifyStatuses:string[]; senderDisplayName:string; footerText:string; updatedAt?:string; }
export interface NotificationHistoryItem { id:string; orderId?:string|null; orderNumber?:number|null; recipient:string; status:'PENDING'|'PROCESSING'|'SENT'|'FAILED'|'CANCELLED'; attempts:number; subject?:string|null; providerMessageId?:string|null; lastError?:string|null; availableAt:string; sentAt?:string|null; createdAt:string; updatedAt:string; customerName?:string|null; device?:string|null; }
export interface GmailTestResult { ok:true; recipient:string; messageId:string; }
export interface NotificationRetryResult { id:string; sent:boolean; status?:string; reason?:string; attempts?:number; nextAttemptAt?:string; messageId?:string; }
export interface HelpMessage { id:string; author:'user'|'support'|'system'|'assistant'; text:string; createdAt:string; }
export interface HelpConversation { id:string; status:string; messages:HelpMessage[]; }
export interface AssistantReply { userMessage:HelpMessage; assistantMessage:HelpMessage; action?:{type:string;code?:string;expiresAt?:string}|null; }
export interface WebsiteAuthCode { code:string; expiresAt:string; }

declare global {
  interface Window {
    lockOn: {
      app: { getInfo: () => Promise<AppInfo> };
      ui: { setScale: (scale:'auto'|'compact'|'comfortable'|'large') => Promise<number>; };
      window: { minimize: () => Promise<void>; toggleMaximize: () => Promise<void>; close: () => Promise<void>; };
      auth: { getState: () => Promise<AuthState>; loginGoogle: () => Promise<AuthState>; loginLocal: () => Promise<AuthState>; logout: () => Promise<AuthState>; };
      access: { requestPoint: (payload:{pointName:string;city:string;requestedRole:UserRole}) => Promise<AuthState>; };
      admin: {
        getOverview: () => Promise<AdminOverview>;
        createPoint: (payload:{name:string;city:string}) => Promise<AdminPoint>;
        approveUser: (userId:string,payload:{role:UserRole;pointIds:string[];createRequestedPoint?:boolean}) => Promise<unknown>;
        rejectUser: (userId:string) => Promise<unknown>;
        updateUserAccess: (userId:string,payload:{role:UserRole;pointIds:string[]}) => Promise<unknown>;
      };
      finance: {
        list: () => Promise<FinancePayload>;
        submit: (payload:{amount:number;pointId:string;workDate:string;note?:string}) => Promise<RevenueEntry>;
        review: (revenueId:string, action:'APPROVE'|'REJECT') => Promise<RevenueEntry>;
      };
      data: { getDashboard: () => Promise<DashboardData>; };
      service: {
        searchCustomers: (query:string) => Promise<ServiceCustomer[]>;
        createOrder: (payload:{pointId:string;firstName:string;lastName:string;email?:string;phone?:string;brand:string;model:string;issueDescription:string;orderType:'REPAIR'|'COMPLAINT'}) => Promise<ServiceCreateOrderResult>;
        listOrders: () => Promise<ServiceOrderSummary[]>;
        updateStatus: (orderId:string,status:string,note?:string) => Promise<ServiceStatusResult>;
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
