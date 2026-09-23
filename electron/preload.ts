import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lockOn', {
  app: { getInfo: () => ipcRenderer.invoke('app:getInfo'), markReady: () => ipcRenderer.invoke('app:renderer-ready') },
  ui: {
    setScale: (scale: 'auto' | 'compact' | 'comfortable' | 'large') => ipcRenderer.invoke('ui:setScale', scale)
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  auth: {
    getState: () => ipcRenderer.invoke('auth:getState'),
    loginGoogle: () => ipcRenderer.invoke('auth:loginGoogle'),
    loginLocal: () => ipcRenderer.invoke('auth:loginLocal'),
    logout: () => ipcRenderer.invoke('auth:logout')
  },
  access: {
    requestPoint: (payload: unknown) => ipcRenderer.invoke('access:requestPoint', payload)
  },
  admin: {
    getOverview: () => ipcRenderer.invoke('admin:getOverview'),
    getAudit: (filters?: unknown) => ipcRenderer.invoke('admin:getAudit', filters),
    createPoint: (payload: unknown) => ipcRenderer.invoke('admin:createPoint', payload),
    updatePointService: (pointId: string, payload: unknown) => ipcRenderer.invoke('admin:updatePointService', pointId, payload),
    approveUser: (userId: string, payload: unknown) => ipcRenderer.invoke('admin:approveUser', userId, payload),
    rejectUser: (userId: string) => ipcRenderer.invoke('admin:rejectUser', userId),
    updateUserAccess: (userId: string, payload: unknown) => ipcRenderer.invoke('admin:updateUserAccess', userId, payload),
    blockUser: (userId: string, blocked: boolean, reason?: string) => ipcRenderer.invoke('admin:blockUser', userId, blocked, reason),
    logoutUserSessions: (userId: string) => ipcRenderer.invoke('admin:logoutUserSessions', userId),
    logoutAllSessions: (exceptCurrent = true) => ipcRenderer.invoke('admin:logoutAllSessions', exceptCurrent),
    factoryResetPreview: () => ipcRenderer.invoke('admin:factoryResetPreview'),
    factoryReset: (payload: unknown) => ipcRenderer.invoke('admin:factoryReset', payload)
  },
  customers: {
    list: (query?: string) => ipcRenderer.invoke('customers:list', query),
    updateProfile: (customerId: string, payload: unknown) => ipcRenderer.invoke('customers:updateProfile', customerId, payload),
    unlinkGoogle: (customerId: string) => ipcRenderer.invoke('customers:unlinkGoogle', customerId),
    getCode: (customerId: string, rotate = false) => ipcRenderer.invoke('customers:getCode', customerId, rotate),
    sendCode: (customerId: string) => ipcRenderer.invoke('customers:sendCode', customerId),
    getNotificationPreferences: (customerId: string) => ipcRenderer.invoke('customers:getNotificationPreferences', customerId),
    updateNotificationPreferences: (customerId: string, payload: unknown) => ipcRenderer.invoke('customers:updateNotificationPreferences', customerId, payload),
    block: (customerId: string, blocked: boolean, reason?: string) => ipcRenderer.invoke('customers:block', customerId, blocked, reason),
    logoutAll: (customerId: string) => ipcRenderer.invoke('customers:logoutAll', customerId)
  },
  finance: {
    list: () => ipcRenderer.invoke('finance:list'),
    getTechnicianSettings: () => ipcRenderer.invoke('finance:getTechnicianSettings'),
    updateTechnicianSettings: (technicianPercent: number) => ipcRenderer.invoke('finance:updateTechnicianSettings', technicianPercent),
    submit: (payload: unknown) => ipcRenderer.invoke('finance:submit', payload),
    review: (revenueId: string, action: 'APPROVE' | 'REJECT') => ipcRenderer.invoke('finance:review', revenueId, action)
  },
  data: {
    getDashboard: () => ipcRenderer.invoke('data:getDashboard'),
    getWeather: (city: string) => ipcRenderer.invoke('data:getWeather', city)
  },
  meetings: {
    list: () => ipcRenderer.invoke('meetings:list'),
    options: () => ipcRenderer.invoke('meetings:options'),
    create: (payload: unknown) => ipcRenderer.invoke('meetings:create', payload),
    action: (meetingId: string, action: 'register'|'unregister'|'start'|'end'|'cancel') => ipcRenderer.invoke('meetings:action', meetingId, action),
    joinToken: (meetingId: string) => ipcRenderer.invoke('meetings:joinToken', meetingId),
    participants: (meetingId: string) => ipcRenderer.invoke('meetings:participants', meetingId),
    moderate: (meetingId: string, payload: unknown) => ipcRenderer.invoke('meetings:moderate', meetingId, payload),
    screenSources: () => ipcRenderer.invoke('meetings:screenSources')
  },
  service: {
    searchCustomers: (query: string) => ipcRenderer.invoke('service:searchCustomers', query),
    searchOrders: (query: string) => ipcRenderer.invoke('service:searchOrders', query),
    getCustomer: (customerId: string) => ipcRenderer.invoke('service:getCustomer', customerId),
    listTechnicians: (pointId: string) => ipcRenderer.invoke('service:listTechnicians', pointId),
    listServicePoints: () => ipcRenderer.invoke('service:listServicePoints'),
    listTransfers: (incoming?: boolean, status?: string) => ipcRenderer.invoke('service:listTransfers', incoming, status),
    transferOrder: (orderId: string, payload: unknown) => ipcRenderer.invoke('service:transferOrder', orderId, payload),
    updateTransferStatus: (transferId: string, status: string, note?: string) => ipcRenderer.invoke('service:updateTransferStatus', transferId, status, note),
    createOrder: (payload: unknown) => ipcRenderer.invoke('service:createOrder', payload),
    openServiceCard: (orderId: string, printMode: 'PHYSICAL_AND_ONLINE' | 'ONLINE_ONLY') => ipcRenderer.invoke('service:openServiceCard', orderId, printMode),
    updateWarranty: (orderId: string, payload: unknown) => ipcRenderer.invoke('service:updateWarranty', orderId, payload),
    openWarrantyCard: (orderId: string) => ipcRenderer.invoke('service:openWarrantyCard', orderId),
    scanServiceCard: (payload: unknown) => ipcRenderer.invoke('service:scanServiceCard', payload),
    listOrders: (limit?: number, offset?: number) => ipcRenderer.invoke('service:listOrders', limit, offset),
    getHistory: (orderId: string) => ipcRenderer.invoke('service:getHistory', orderId),
    getNotes: (orderId: string) => ipcRenderer.invoke('service:getNotes', orderId),
    addNote: (orderId: string, body: string) => ipcRenderer.invoke('service:addNote', orderId, body),
    getCosting: (orderId: string) => ipcRenderer.invoke('service:getCosting', orderId),
    saveCosting: (orderId: string, payload: unknown) => ipcRenderer.invoke('service:saveCosting', orderId, payload),
    uploadInvoice: (orderId: string, payload: unknown) => ipcRenderer.invoke('service:uploadInvoice', orderId, payload),
    downloadInvoice: (invoiceId: string) => ipcRenderer.invoke('service:downloadInvoice', invoiceId),
    listInvoices: (month: string, pointId: string) => ipcRenderer.invoke('service:listInvoices', month, pointId),
    downloadInvoiceBatch: (month: string, pointId: string) => ipcRenderer.invoke('service:downloadInvoiceBatch', month, pointId),
    deleteInvoice: (invoiceId: string) => ipcRenderer.invoke('service:deleteInvoice', invoiceId),
    getInvoiceMonthlyPrompt: () => ipcRenderer.invoke('service:getInvoiceMonthlyPrompt'),
    dismissInvoiceMonthlyPrompt: (period: string) => ipcRenderer.invoke('service:dismissInvoiceMonthlyPrompt', period),
    getTechnicianWorkspace: () => ipcRenderer.invoke('service:getTechnicianWorkspace'),
    listTechnicianNotes: () => ipcRenderer.invoke('service:listTechnicianNotes'),
    addTechnicianNote: (payload: unknown) => ipcRenderer.invoke('service:addTechnicianNote', payload),
    updateTechnicianNote: (noteId: string, payload: unknown) => ipcRenderer.invoke('service:updateTechnicianNote', noteId, payload),
    deleteTechnicianNote: (noteId: string) => ipcRenderer.invoke('service:deleteTechnicianNote', noteId),
    updateDetails: (orderId: string, payload: unknown) => ipcRenderer.invoke('service:updateDetails', orderId, payload),
    updatePlan: (orderId: string, payload: unknown) => ipcRenderer.invoke('service:updatePlan', orderId, payload),
    updateStatus: (orderId: string, status: string, note?: string, actingPointId?: string) => ipcRenderer.invoke('service:updateStatus', orderId, status, note, actingPointId),
    listCustomerQuotes: (pointId?: string) => ipcRenderer.invoke('service:listCustomerQuotes', pointId),
    replyCustomerQuote: (requestId: string, message: string) => ipcRenderer.invoke('service:replyCustomerQuote', requestId, message),
    priceCustomerQuote: (requestId: string, amount: number, note?: string) => ipcRenderer.invoke('service:priceCustomerQuote', requestId, amount, note),
    closeCustomerQuote: (requestId: string) => ipcRenderer.invoke('service:closeCustomerQuote', requestId)
  },
  gmail: {
    getStatus: (pointId: string) => ipcRenderer.invoke('gmail:getStatus', pointId),
    connect: (pointId: string) => ipcRenderer.invoke('gmail:connect', pointId),
    disconnect: (pointId: string) => ipcRenderer.invoke('gmail:disconnect', pointId),
    test: (pointId: string) => ipcRenderer.invoke('gmail:test', pointId)
  },
  notifications: {
    getSettings: (pointId: string) => ipcRenderer.invoke('notifications:getSettings', pointId),
    updateSettings: (payload: unknown) => ipcRenderer.invoke('notifications:updateSettings', payload),
    getHistory: (pointId: string) => ipcRenderer.invoke('notifications:getHistory', pointId),
    retry: (notificationId: string) => ipcRenderer.invoke('notifications:retry', notificationId)
  },
  assistant: {
    getConversation: () => ipcRenderer.invoke('assistant:getConversation'),
    send: (message: string, target?: 'BOT' | 'CONSULTANT') => ipcRenderer.invoke('assistant:send', message, target)
  },
  diagnostics: {
    internetSpeed: () => ipcRenderer.invoke('diagnostics:internetSpeed'),
    connectivity: () => ipcRenderer.invoke('diagnostics:connectivity')
  },
  support: {
    request: (pointId?: string, message?: string) => ipcRenderer.invoke('support:request', pointId, message),
    presence: () => ipcRenderer.invoke('support:presence'),
    listTickets: () => ipcRenderer.invoke('support:listTickets'),
    take: (ticketId: string) => ipcRenderer.invoke('support:take', ticketId),
    reply: (ticketId: string, message: string) => ipcRenderer.invoke('support:reply', ticketId, message),
    close: (ticketId: string) => ipcRenderer.invoke('support:close', ticketId),
    leave: () => ipcRenderer.invoke('support:leave')
  },
  website: {
    createAuthCode: () => ipcRenderer.invoke('website:createAuthCode')
  },
  browser: {
    getState: () => ipcRenderer.invoke('browser:getState'),
    setVisible: (visible: boolean) => ipcRenderer.invoke('browser:setVisible', visible),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('browser:setBounds', bounds),
    navigate: (input: string) => ipcRenderer.invoke('browser:navigate', input),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    home: () => ipcRenderer.invoke('browser:home'),
    openExternal: () => ipcRenderer.invoke('browser:openExternal'),
    onState: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on('browser:state', listener);
      return () => ipcRenderer.removeListener('browser:state', listener);
    }
  },
  updater: {
    getState: () => ipcRenderer.invoke('update:getState'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    }
  },
  splash: {
    onProgress: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on('splash:progress', listener);
      return () => ipcRenderer.removeListener('splash:progress', listener);
    }
  }
});
