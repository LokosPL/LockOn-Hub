import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lockOn', {
  app: { getInfo: () => ipcRenderer.invoke('app:getInfo') },
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
    createPoint: (payload: unknown) => ipcRenderer.invoke('admin:createPoint', payload),
    updatePointService: (pointId: string, payload: unknown) => ipcRenderer.invoke('admin:updatePointService', pointId, payload),
    approveUser: (userId: string, payload: unknown) => ipcRenderer.invoke('admin:approveUser', userId, payload),
    rejectUser: (userId: string) => ipcRenderer.invoke('admin:rejectUser', userId),
    updateUserAccess: (userId: string, payload: unknown) => ipcRenderer.invoke('admin:updateUserAccess', userId, payload),
    blockUser: (userId: string, blocked: boolean, reason?: string) => ipcRenderer.invoke('admin:blockUser', userId, blocked, reason),
    logoutUserSessions: (userId: string) => ipcRenderer.invoke('admin:logoutUserSessions', userId),
    logoutAllSessions: (exceptCurrent = true) => ipcRenderer.invoke('admin:logoutAllSessions', exceptCurrent)
  },
  finance: {
    list: () => ipcRenderer.invoke('finance:list'),
    submit: (payload: unknown) => ipcRenderer.invoke('finance:submit', payload),
    review: (revenueId: string, action: 'APPROVE' | 'REJECT') => ipcRenderer.invoke('finance:review', revenueId, action)
  },
  data: {
    getDashboard: () => ipcRenderer.invoke('data:getDashboard')
  },
  service: {
    searchCustomers: (query: string) => ipcRenderer.invoke('service:searchCustomers', query),
    getCustomer: (customerId: string) => ipcRenderer.invoke('service:getCustomer', customerId),
    listTechnicians: (pointId: string) => ipcRenderer.invoke('service:listTechnicians', pointId),
    listServicePoints: () => ipcRenderer.invoke('service:listServicePoints'),
    listTransfers: (incoming?: boolean, status?: string) => ipcRenderer.invoke('service:listTransfers', incoming, status),
    transferOrder: (orderId: string, payload: unknown) => ipcRenderer.invoke('service:transferOrder', orderId, payload),
    updateTransferStatus: (transferId: string, status: string, note?: string) => ipcRenderer.invoke('service:updateTransferStatus', transferId, status, note),
    createOrder: (payload: unknown) => ipcRenderer.invoke('service:createOrder', payload),
    listOrders: () => ipcRenderer.invoke('service:listOrders'),
    getHistory: (orderId: string) => ipcRenderer.invoke('service:getHistory', orderId),
    getNotes: (orderId: string) => ipcRenderer.invoke('service:getNotes', orderId),
    addNote: (orderId: string, body: string) => ipcRenderer.invoke('service:addNote', orderId, body),
    updateDetails: (orderId: string, payload: unknown) => ipcRenderer.invoke('service:updateDetails', orderId, payload),
    updateStatus: (orderId: string, status: string, note?: string) => ipcRenderer.invoke('service:updateStatus', orderId, status, note)
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
    send: (message: string) => ipcRenderer.invoke('assistant:send', message)
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
