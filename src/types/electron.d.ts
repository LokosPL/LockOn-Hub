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
